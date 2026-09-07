"""Export / import a single project with all related layout data."""

from __future__ import annotations

import copy
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


def _is_concrete_relation_field(field):
    return field.is_relation and field.concrete and not field.many_to_many


def _serialize_model(instance):
    data = {'_pk': instance.pk}
    for field in instance._meta.concrete_fields:
        if field.name == 'id':
            continue
        if field.many_to_many:
            continue
        if field.name == 'baseline_snapshot':
            continue
        if _is_concrete_relation_field(field):
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


def _json_ready(payload: dict) -> dict:
    return json.loads(json.dumps(payload, default=_json_default))


def _as_pk(value):
    if value is None or value == '':
        return None
    return int(value)


def export_project(project: Project, *, include_comments: bool = True) -> dict:
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
        'comments': [_serialize_model(item) for item in collected['comments']] if include_comments else [],
        'room_walls': collected['room_walls'],
        'zone_rooms': collected['zone_rooms'],
    }
    return _json_ready(payload)


def export_project_by_name(project_name: str) -> dict:
    try:
        project = Project.objects.get(name=project_name)
    except Project.DoesNotExist as exc:
        raise ValueError(f'Project not found: {project_name!r}') from exc
    return export_project(project)


def export_project_to_file(project_name: str, output_path: str) -> dict:
    payload = export_project_by_name(project_name)
    with open(output_path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2, default=_json_default)
    return payload


def _create_rows(model, rows, pk_map, fk_maps=None, null_fields=None):
    fk_maps = fk_maps or {}
    null_fields = null_fields or []
    fk_field_names = {
        field.name
        for field in model._meta.concrete_fields
        if _is_concrete_relation_field(field)
    }

    def set_fk(row, field_name, value):
        row.pop(field_name, None)
        if field_name in fk_field_names:
            row[f'{field_name}_id'] = value
        else:
            row[field_name] = value

    def finalize_row_fks(row):
        for field_name in fk_field_names:
            if field_name in row:
                row[f'{field_name}_id'] = row.pop(field_name)

    for row in rows:
        old_pk = _as_pk(row.pop('_pk', None))
        row.pop('id', None)
        row.pop('created_at', None)
        row.pop('updated_at', None)
        for field_name, ref_map in fk_maps.items():
            if field_name not in row:
                continue
            value = row.pop(field_name)
            if value is not None:
                mapped = ref_map.get(_as_pk(value))
                if mapped is None and _as_pk(value) is not None:
                    raise KeyError(f'Could not map {field_name} id {value!r}')
                value = mapped
            set_fk(row, field_name, value)
        for field_name in null_fields:
            row.pop(field_name, None)
            set_fk(row, field_name, None)
        finalize_row_fks(row)
        instance = model.objects.create(**row)
        if old_pk is not None:
            pk_map[old_pk] = instance.pk
            pk_map[str(old_pk)] = instance.pk
    return pk_map


def _map_pk(pk_map, old_pk):
    key = _as_pk(old_pk)
    if key is None:
        raise KeyError(old_pk)
    if key in pk_map:
        return pk_map[key]
    return pk_map[str(key)]


def _project_payload_pk(payload: dict):
    project_row = payload.get('project') or {}
    return _as_pk(project_row.get('_pk') or payload.get('source_project_id'))


def _apply_layout_from_payload(project: Project, payload: dict, *, include_comments: bool = False):
    old_project_pk = _project_payload_pk(payload)
    if old_project_pk is None:
        old_project_pk = project.pk

    storey_map = {}
    wall_map = {}
    room_map = {}
    door_map = {}
    zone_map = {}
    project_pk_map = {old_project_pk: project.pk, str(old_project_pk): project.pk}

    _create_rows(
        Storey,
        [dict(row) for row in payload.get('storeys', [])],
        storey_map,
        fk_maps={'project': project_pk_map},
    )

    wall_rows = []
    for row in payload.get('walls', []):
        item = dict(row)
        item['project_id'] = project.pk
        item.pop('project', None)
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
        item['project_id'] = project.pk
        item.pop('project', None)
        room_rows.append(item)
    _create_rows(
        Room,
        room_rows,
        room_map,
        fk_maps={'storey': storey_map},
    )

    for old_room_pk, old_wall_pks in (payload.get('room_walls') or {}).items():
        room = Room.objects.get(pk=_map_pk(room_map, old_room_pk))
        room.walls.set([
            _map_pk(wall_map, old_wall_pk)
            for old_wall_pk in old_wall_pks
            if _as_pk(old_wall_pk) is not None and (
                _as_pk(old_wall_pk) in wall_map or str(_as_pk(old_wall_pk)) in wall_map
            )
        ])

    door_rows = []
    for row in payload.get('doors', []):
        item = dict(row)
        item['project_id'] = project.pk
        item.pop('project', None)
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
        item['project_id'] = project.pk
        item.pop('project', None)
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
        item['project_id'] = project.pk
        item.pop('project', None)
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
        item['project_id'] = project.pk
        item.pop('project', None)
        zone_rows.append(item)
    _create_rows(
        CeilingZone,
        zone_rows,
        zone_map,
        fk_maps={'storey': storey_map},
    )

    for old_zone_pk, old_room_pks in (payload.get('zone_rooms') or {}).items():
        zone = CeilingZone.objects.get(pk=_map_pk(zone_map, old_zone_pk))
        zone.rooms.set([
            _map_pk(room_map, old_room_pk)
            for old_room_pk in old_room_pks
            if _as_pk(old_room_pk) is not None and (
                _as_pk(old_room_pk) in room_map or str(_as_pk(old_room_pk)) in room_map
            )
        ])

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

    if not include_comments:
        return

    for row in payload.get('comments', []):
        item = dict(row)
        item.pop('_pk', None)
        item.pop('id', None)
        item.pop('created_at', None)
        item['project_id'] = project.pk
        item.pop('project', None)
        item['author_id'] = None
        item.pop('author', None)
        item['resolved_by_id'] = None
        item.pop('resolved_by', None)
        wall_ids = item.get('wall_ids') or []
        remapped = []
        for wall_id in wall_ids:
            key = _as_pk(wall_id)
            if key is None:
                continue
            if key in wall_map:
                remapped.append(wall_map[key])
            elif str(key) in wall_map:
                remapped.append(wall_map[str(key)])
        item['wall_ids'] = remapped
        ProjectComment.objects.create(**item)


def clear_project_layout(project: Project):
    project_id = project.pk
    rooms = Room.objects.filter(project_id=project_id)
    zones = CeilingZone.objects.filter(project_id=project_id)
    room_ids = list(rooms.values_list('pk', flat=True))
    zone_ids = list(zones.values_list('pk', flat=True))
    CeilingPanel.objects.filter(Q(room_id__in=room_ids) | Q(zone_id__in=zone_ids)).delete()
    CeilingPlan.objects.filter(Q(room_id__in=room_ids) | Q(zone_id__in=zone_ids)).delete()
    FloorPanel.objects.filter(room_id__in=room_ids).delete()
    FloorPlan.objects.filter(room_id__in=room_ids).delete()
    zones.delete()
    Window.objects.filter(door__project_id=project_id).delete()
    WallWindow.objects.filter(wall__project_id=project_id).delete()
    Door.objects.filter(project_id=project_id).delete()
    Intersection.objects.filter(project_id=project_id).delete()
    PlanAnnotation.objects.filter(project_id=project_id).delete()
    for room in rooms:
        room.walls.clear()
    rooms.delete()
    Wall.objects.filter(project_id=project_id).delete()
    Storey.objects.filter(project_id=project_id).delete()


LAYOUT_PROJECT_FIELDS = ('width', 'length', 'height', 'wall_thickness', 'panel_optimization')


def _apply_project_layout_fields(project: Project, payload: dict):
    project_row = payload.get('project') or {}
    for field_name in LAYOUT_PROJECT_FIELDS:
        if field_name in project_row:
            setattr(project, field_name, project_row[field_name])


@transaction.atomic
def restore_project_from_payload(project: Project, payload: dict, *, user=None) -> Project:
    if payload.get('version') != EXPORT_VERSION:
        raise ValueError('Unsupported snapshot version.')
    working = copy.deepcopy(payload)
    _apply_project_layout_fields(project, working)
    update_fields = list(LAYOUT_PROJECT_FIELDS)
    if user is not None and getattr(user, 'is_authenticated', False):
        project.last_edited_by = user
        update_fields.append('last_edited_by')
    project.save(update_fields=update_fields)
    clear_project_layout(project)
    _apply_layout_from_payload(project, working, include_comments=False)
    return project


@transaction.atomic
def import_project_from_payload(
    payload: dict,
    *,
    replace: bool = False,
    rename: str | None = None,
    folder=None,
    user=None,
    include_comments: bool = True,
) -> Project:
    if payload.get('version') != EXPORT_VERSION:
        raise ValueError('Unsupported export file version.')

    working = copy.deepcopy(payload)
    project_row = dict(working.get('project') or {})
    project_row.pop('_pk', None)
    project_name = rename or project_row.get('name') or working.get('source_project_name')
    project_row['name'] = project_name
    project_row['folder_id'] = getattr(folder, 'pk', None) if folder is not None else None
    project_row.pop('folder', None)
    project_row['created_by_id'] = user.pk if user is not None and getattr(user, 'is_authenticated', False) else None
    project_row.pop('created_by', None)
    project_row['last_edited_by_id'] = project_row['created_by_id']
    project_row.pop('last_edited_by', None)
    project_row.pop('created_at', None)
    project_row.pop('updated_at', None)

    existing = Project.objects.filter(name=project_name).first()
    if existing and not replace:
        raise ValueError(
            f'Local project {project_name!r} already exists. '
            'Use --replace to overwrite it or --rename to import under a new name.'
        )
    if existing and replace:
        existing.delete()

    for field in Project._meta.concrete_fields:
        if _is_concrete_relation_field(field):
            project_row.pop(field.name, None)

    project = Project.objects.create(**project_row)
    _apply_layout_from_payload(project, working, include_comments=include_comments)
    return project


def copy_project_from_payload(payload: dict, *, name: str, folder=None, user=None) -> Project:
    project = import_project_from_payload(
        payload,
        rename=name,
        folder=folder,
        user=user,
        include_comments=False,
    )
    project.hidden_from_list = True
    project.save(update_fields=['hidden_from_list'])
    return project


def import_project_from_file(file_path: str, *, replace: bool = False, rename: str | None = None) -> Project:
    with open(file_path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    return import_project_from_payload(payload, replace=replace, rename=rename)
