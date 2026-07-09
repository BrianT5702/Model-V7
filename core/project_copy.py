"""Export / import a single project with all related layout data."""

from __future__ import annotations

import json
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from django.db import transaction
from django.db.models import Q

from core.models import (
    CeilingPanel,
    CeilingPlan,
    CeilingZone,
    Door,
    FloorPanel,
    FloorPlan,
    Intersection,
    PlanAnnotation,
    Project,
    ProjectComment,
    Room,
    Storey,
    Wall,
    WallWindow,
    Window,
)

EXPORT_VERSION = 1


def _json_default(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    raise TypeError(f'Object of type {type(value).__name__} is not JSON serializable')


def _serialize_model(instance):
    data = {'_pk': instance.pk}
    for field in instance._meta.concrete_fields:
        if field.name == 'id':
            continue
        if field.many_to_many:
            continue
        if field.many_to_one:
            data[field.name] = getattr(instance, f'{field.name}_id')
        else:
            data[field.name] = field.value_from_object(instance)
    return data


def _collect_project_queryset(project):
    project_id = project.pk
    walls = list(Wall.objects.filter(project_id=project_id).order_by('id'))
    wall_ids = [wall.pk for wall in walls]
    rooms = list(Room.objects.filter(project_id=project_id).prefetch_related('walls').order_by('id'))
    room_ids = [room.pk for room in rooms]
    storeys = list(Storey.objects.filter(project_id=project_id).order_by('id'))
    doors = list(Door.objects.filter(project_id=project_id).order_by('id'))
    door_ids = [door.pk for door in doors]
    zones = list(
        CeilingZone.objects.filter(project_id=project_id).prefetch_related('rooms').order_by('id')
    )
    zone_ids = [zone.pk for zone in zones]

    return {
        'project': project,
        'storeys': storeys,
        'walls': walls,
        'rooms': rooms,
        'doors': doors,
        'windows': list(Window.objects.filter(door_id__in=door_ids).order_by('id')),
        'wall_windows': list(WallWindow.objects.filter(wall_id__in=wall_ids).order_by('id')),
        'intersections': list(Intersection.objects.filter(project_id=project_id).order_by('id')),
        'plan_annotations': list(
            PlanAnnotation.objects.filter(project_id=project_id).order_by('id')
        ),
        'ceiling_zones': zones,
        'ceiling_panels': list(
            CeilingPanel.objects.filter(
                Q(room_id__in=room_ids) | Q(zone_id__in=zone_ids)
            ).order_by('id')
        ),
        'ceiling_plans': list(
            CeilingPlan.objects.filter(
                Q(room_id__in=room_ids) | Q(zone_id__in=zone_ids)
            ).order_by('id')
        ),
        'floor_panels': list(FloorPanel.objects.filter(room_id__in=room_ids).order_by('id')),
        'floor_plans': list(FloorPlan.objects.filter(room_id__in=room_ids).order_by('id')),
        'comments': list(ProjectComment.objects.filter(project_id=project_id).order_by('id')),
        'room_walls': {
            str(room.pk): [wall.pk for wall in room.walls.all()]
            for room in rooms
        },
        'zone_rooms': {
            str(zone.pk): [room.pk for room in zone.rooms.all()]
            for zone in zones
        },
    }


def export_project_by_name(project_name: str) -> dict:
    try:
        project = Project.objects.get(name=project_name)
    except Project.DoesNotExist as exc:
        raise ValueError(f'Project not found: {project_name!r}') from exc

    collected = _collect_project_queryset(project)
    payload = {
        'version': EXPORT_VERSION,
        'source_project_name': project.name,
        'source_project_id': project.pk,
        'project': _serialize_model(collected['project']),
        'storeys': [_serialize_model(item) for item in collected['storeys']],
        'walls': [_serialize_model(item) for item in collected['walls']],
        'rooms': [_serialize_model(item) for item in collected['rooms']],
        'doors': [_serialize_model(item) for item in collected['doors']],
        'windows': [_serialize_model(item) for item in collected['windows']],
        'wall_windows': [_serialize_model(item) for item in collected['wall_windows']],
        'intersections': [_serialize_model(item) for item in collected['intersections']],
        'plan_annotations': [_serialize_model(item) for item in collected['plan_annotations']],
        'ceiling_zones': [_serialize_model(item) for item in collected['ceiling_zones']],
        'ceiling_panels': [_serialize_model(item) for item in collected['ceiling_panels']],
        'ceiling_plans': [_serialize_model(item) for item in collected['ceiling_plans']],
        'floor_panels': [_serialize_model(item) for item in collected['floor_panels']],
        'floor_plans': [_serialize_model(item) for item in collected['floor_plans']],
        'comments': [_serialize_model(item) for item in collected['comments']],
        'room_walls': collected['room_walls'],
        'zone_rooms': collected['zone_rooms'],
    }
    return payload


def export_project_to_file(project_name: str, output_path: str) -> dict:
    payload = export_project_by_name(project_name)
    with open(output_path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2, default=_json_default)
    return payload


def _create_rows(model, rows, pk_map, fk_maps=None, null_fields=None):
    fk_maps = fk_maps or {}
    null_fields = null_fields or []
    for row in rows:
        old_pk = row.pop('_pk')
        for field_name, ref_map in fk_maps.items():
            if row.get(field_name) is not None:
                row[field_name] = ref_map[row[field_name]]
        for field_name in null_fields:
            row[field_name] = None
        instance = model.objects.create(**row)
        pk_map[old_pk] = instance.pk
    return pk_map


@transaction.atomic
def import_project_from_payload(payload: dict, *, replace: bool = False, rename: str | None = None) -> Project:
    if payload.get('version') != EXPORT_VERSION:
        raise ValueError('Unsupported export file version.')

    project_row = dict(payload['project'])
    old_project_pk = project_row.pop('_pk')
    project_name = rename or project_row.get('name') or payload.get('source_project_name')
    project_row['name'] = project_name
    project_row['folder'] = None
    project_row['created_by'] = None
    project_row['last_edited_by'] = None

    existing = Project.objects.filter(name=project_name).first()
    if existing and not replace:
        raise ValueError(
            f'Local project {project_name!r} already exists. '
            'Use --replace to overwrite it or --rename to import under a new name.'
        )
    if existing and replace:
        existing.delete()

    storey_map = {}
    wall_map = {}
    room_map = {}
    door_map = {}
    zone_map = {}

    project = Project.objects.create(**project_row)

    _create_rows(
        Storey,
        [dict(row) for row in payload.get('storeys', [])],
        storey_map,
        fk_maps={'project': {old_project_pk: project.pk}},
    )

    wall_rows = []
    for row in payload.get('walls', []):
        item = dict(row)
        item['project'] = project.pk
        wall_rows.append(item)
    _create_rows(
        Wall,
        wall_rows,
        wall_map,
        fk_maps={'storey': storey_map},
    )

    room_rows = []
    for row in payload.get('rooms', []):
        item = dict(row)
        item['project'] = project.pk
        room_rows.append(item)
    _create_rows(
        Room,
        room_rows,
        room_map,
        fk_maps={'storey': storey_map},
    )

    for old_room_pk, old_wall_pks in payload.get('room_walls', {}).items():
        room = Room.objects.get(pk=room_map[int(old_room_pk)])
        room.walls.set([wall_map[int(old_wall_pk)] for old_wall_pk in old_wall_pks])

    door_rows = []
    for row in payload.get('doors', []):
        item = dict(row)
        item['project'] = project.pk
        door_rows.append(item)
    _create_rows(
        Door,
        door_rows,
        door_map,
        fk_maps={'storey': storey_map, 'linked_wall': wall_map},
    )

    _create_rows(
        Window,
        [dict(row) for row in payload.get('windows', [])],
        {},
        fk_maps={'door': door_map},
    )

    _create_rows(
        WallWindow,
        [dict(row) for row in payload.get('wall_windows', [])],
        {},
        fk_maps={'wall': wall_map},
    )

    intersection_rows = []
    for row in payload.get('intersections', []):
        item = dict(row)
        item['project'] = project.pk
        intersection_rows.append(item)
    _create_rows(
        Intersection,
        intersection_rows,
        {},
        fk_maps={'wall_1': wall_map, 'wall_2': wall_map},
    )

    annotation_rows = []
    for row in payload.get('plan_annotations', []):
        item = dict(row)
        item['project'] = project.pk
        annotation_rows.append(item)
    _create_rows(
        PlanAnnotation,
        annotation_rows,
        {},
        fk_maps={'storey': storey_map},
        null_fields=['created_by'],
    )

    zone_rows = []
    for row in payload.get('ceiling_zones', []):
        item = dict(row)
        item['project'] = project.pk
        zone_rows.append(item)
    _create_rows(
        CeilingZone,
        zone_rows,
        zone_map,
        fk_maps={'storey': storey_map},
    )

    for old_zone_pk, old_room_pks in payload.get('zone_rooms', {}).items():
        zone = CeilingZone.objects.get(pk=zone_map[int(old_zone_pk)])
        zone.rooms.set([room_map[int(old_room_pk)] for old_room_pk in old_room_pks])

    _create_rows(
        CeilingPanel,
        [dict(row) for row in payload.get('ceiling_panels', [])],
        {},
        fk_maps={'room': room_map, 'zone': zone_map},
    )

    _create_rows(
        CeilingPlan,
        [dict(row) for row in payload.get('ceiling_plans', [])],
        {},
        fk_maps={'room': room_map, 'zone': zone_map},
    )

    _create_rows(
        FloorPanel,
        [dict(row) for row in payload.get('floor_panels', [])],
        {},
        fk_maps={'room': room_map},
    )

    _create_rows(
        FloorPlan,
        [dict(row) for row in payload.get('floor_plans', [])],
        {},
        fk_maps={'room': room_map},
    )

    for row in payload.get('comments', []):
        item = dict(row)
        item.pop('_pk', None)
        item['project'] = project.pk
        item['author'] = None
        item['resolved_by'] = None
        wall_ids = item.get('wall_ids') or []
        item['wall_ids'] = [wall_map[int(wall_id)] for wall_id in wall_ids if int(wall_id) in wall_map]
        ProjectComment.objects.create(**item)

    return project


def import_project_from_file(file_path: str, *, replace: bool = False, rename: str | None = None) -> Project:
    with open(file_path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    return import_project_from_payload(payload, replace=replace, rename=rename)
