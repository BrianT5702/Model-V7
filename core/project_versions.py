"""Named project layout snapshots (save / list / restore / delete)."""

from __future__ import annotations

import copy
import json

from django.db import transaction
from django.db.models import Max

from core.models import Project, ProjectVersion
from core.project_copy import (
    _as_pk,
    copy_project_from_payload,
    export_project,
    restore_project_from_payload,
)

MAX_PROJECT_VERSIONS = 20


def serialize_project_version(version: ProjectVersion) -> dict:
    snapshot = version.snapshot or {}
    created_by = version.created_by
    return {
        'id': version.id,
        'number': version.number,
        'label': version.label or '',
        'created_at': version.created_at,
        'created_by_username': created_by.username if created_by is not None else None,
        'wall_count': len(snapshot.get('walls') or []),
        'room_count': len(snapshot.get('rooms') or []),
    }


def unique_copy_name(base: str) -> str:
    base = (base or 'Project').strip() or 'Project'
    name = base[:255]
    if not Project.objects.filter(name=name).exists():
        return name
    index = 2
    while True:
        suffix = f' ({index})'
        name = f'{base[:255 - len(suffix)]}{suffix}'
        if not Project.objects.filter(name=name).exists():
            return name
        index += 1


def _is_layout_snapshot(snapshot) -> bool:
    return isinstance(snapshot, dict) and ('walls' in snapshot or snapshot.get('version') is not None)


def _embedded_original_from_version(version: ProjectVersion | None) -> dict | None:
    if version is None:
        return None
    nested = ((version.snapshot or {}).get('project') or {}).get('baseline_snapshot')
    if _is_layout_snapshot(nested) and nested.get('walls') is not None:
        return nested
    return None


def original_layout_snapshot(project: Project) -> dict | None:
    """Frozen version 0. Named versions must never replace this."""
    stored = project.baseline_snapshot if _is_layout_snapshot(project.baseline_snapshot) else None
    oldest = project.versions.order_by('number', 'id').first()
    embedded = _embedded_original_from_version(oldest)

    if stored and embedded:
        stored_fp = _layout_fingerprint(stored)
        if stored_fp != _layout_fingerprint(embedded):
            for version in project.versions.all():
                if _layout_fingerprint(version.snapshot) == stored_fp:
                    return copy.deepcopy(embedded)
        return copy.deepcopy(stored)
    if stored:
        return copy.deepcopy(stored)
    if embedded:
        return copy.deepcopy(embedded)
    return None


def _persist_original(project: Project, snapshot: dict) -> None:
    Project.objects.filter(pk=project.pk).update(baseline_snapshot=copy.deepcopy(snapshot))
    project.baseline_snapshot = copy.deepcopy(snapshot)


@transaction.atomic
def ensure_project_baseline(project: Project) -> Project:
    """Freeze version 0 once. Never capture a restored working copy as the original."""
    locked = Project.objects.select_for_update().get(pk=project.pk)
    original = original_layout_snapshot(locked)
    if original is not None:
        if not locked.baseline_snapshot or _layout_fingerprint(locked.baseline_snapshot) != _layout_fingerprint(original):
            _persist_original(locked, original)
        return locked
    if locked.versions.exists():
        return locked
    locked.baseline_snapshot = export_project(locked, include_comments=False)
    locked.save(update_fields=['baseline_snapshot'])
    return locked


@transaction.atomic
def create_project_version(project: Project, *, label: str = '', user=None) -> ProjectVersion:
    locked = Project.objects.select_for_update().get(pk=project.pk)
    current_snapshot = export_project(locked, include_comments=False)
    original_snapshot = original_layout_snapshot(locked)
    if original_snapshot is None and not locked.versions.exists():
        original_snapshot = copy.deepcopy(current_snapshot)
        _persist_original(locked, original_snapshot)
    elif original_snapshot is not None:
        if (
            not locked.baseline_snapshot
            or _layout_fingerprint(locked.baseline_snapshot) != _layout_fingerprint(original_snapshot)
        ):
            _persist_original(locked, original_snapshot)
    last_number = locked.versions.aggregate(Max('number'))['number__max'] or 0
    created_by = user if user is not None and getattr(user, 'is_authenticated', False) else None
    if original_snapshot:
        current_snapshot = copy.deepcopy(current_snapshot)
        project_row = dict(current_snapshot.get('project') or {})
        project_row['baseline_snapshot'] = copy.deepcopy(original_snapshot)
        current_snapshot['project'] = project_row
    version = ProjectVersion.objects.create(
        project=locked,
        number=last_number + 1,
        label=(label or '').strip()[:255],
        snapshot=current_snapshot,
        created_by=created_by,
    )
    keep_ids = list(
        locked.versions.order_by('-number', '-id').values_list('pk', flat=True)[:MAX_PROJECT_VERSIONS]
    )
    locked.versions.exclude(pk__in=keep_ids).delete()
    if original_snapshot:
        restore_project_from_payload(locked, original_snapshot, user=user)
        _persist_original(locked, original_snapshot)
    return version


def list_project_versions(project: Project):
    return project.versions.select_related('created_by').all()


def _snapshot_row_as_api(row, project_id):
    item = dict(row or {})
    pk = _as_pk(item.pop('_pk', None) or item.get('id'))
    item.pop('id', None)
    item.pop('created_at', None)
    item.pop('updated_at', None)
    item.pop('created_by', None)
    item['id'] = pk
    item['project'] = project_id
    return item, pk


def build_version_preview(project: Project, snapshot: dict) -> dict:
    snapshot = snapshot or {}
    project_id = project.pk
    project_row = snapshot.get('project') or {}

    storeys = []
    for row in snapshot.get('storeys') or []:
        item, _pk = _snapshot_row_as_api(row, project_id)
        storeys.append(item)

    wall_windows_by_wall = {}
    for row in snapshot.get('wall_windows') or []:
        item, pk = _snapshot_row_as_api(row, project_id)
        wall_id = _as_pk(item.get('wall'))
        wall_windows_by_wall.setdefault(wall_id, []).append(item)

    walls = []
    for row in snapshot.get('walls') or []:
        item, pk = _snapshot_row_as_api(row, project_id)
        item['windows'] = wall_windows_by_wall.get(pk, [])
        item['rooms'] = []
        walls.append(item)
    walls_by_id = {wall['id']: wall for wall in walls if wall.get('id') is not None}

    rooms = []
    room_walls = snapshot.get('room_walls') or {}
    for row in snapshot.get('rooms') or []:
        item, pk = _snapshot_row_as_api(row, project_id)
        raw_walls = room_walls.get(str(pk), room_walls.get(pk, [])) or []
        wall_ids = [_as_pk(wall_id) for wall_id in raw_walls]
        item['walls'] = [wall_id for wall_id in wall_ids if wall_id is not None]
        item['ceiling_zones'] = []
        item['zone_ceiling_plan'] = None
        item['ceiling_plan'] = None
        item['floor_plan'] = None
        rooms.append(item)
        for wall_id in item['walls']:
            wall = walls_by_id.get(wall_id)
            if wall is not None:
                wall.setdefault('rooms', []).append(pk)

    door_windows_by_door = {}
    for row in snapshot.get('windows') or []:
        item, pk = _snapshot_row_as_api(row, project_id)
        door_id = _as_pk(item.get('door'))
        door_windows_by_door.setdefault(door_id, []).append(item)

    doors = []
    for row in snapshot.get('doors') or []:
        item, pk = _snapshot_row_as_api(row, project_id)
        item['windows'] = door_windows_by_door.get(pk, [])
        doors.append(item)

    intersections = []
    for row in snapshot.get('intersections') or []:
        item, _pk = _snapshot_row_as_api(row, project_id)
        intersections.append(item)

    annotations = []
    for row in snapshot.get('plan_annotations') or []:
        item, _pk = _snapshot_row_as_api(row, project_id)
        annotations.append(item)

    return {
        'project': {
            'id': project.pk,
            'name': project.name,
            'width': project_row.get('width', project.width),
            'length': project_row.get('length', project.length),
            'height': project_row.get('height', project.height),
            'wall_thickness': project_row.get('wall_thickness', project.wall_thickness),
            'panel_optimization': project_row.get('panel_optimization', project.panel_optimization),
            'storeys': storeys,
        },
        'storeys': storeys,
        'walls': walls,
        'rooms': rooms,
        'doors': doors,
        'intersections': intersections,
        'plan_annotations': annotations,
    }


def _layout_fingerprint(snapshot: dict) -> tuple:
    snapshot = snapshot or {}
    project_row = snapshot.get('project') or {}

    def num(value):
        try:
            return round(float(value), 2)
        except (TypeError, ValueError):
            return 0.0

    walls = tuple(sorted(
        (
            num(row.get('start_x')),
            num(row.get('start_y')),
            num(row.get('end_x')),
            num(row.get('end_y')),
            num(row.get('height') or 0),
            num(row.get('thickness') or 0),
            (row.get('application_type') or ''),
            bool(row.get('is_default')),
        )
        for row in (snapshot.get('walls') or [])
    ))
    rooms = tuple(sorted(
        (
            (row.get('room_name') or ''),
            (row.get('floor_type') or ''),
            num(row.get('height') or 0),
            json.dumps(row.get('room_points') or [], sort_keys=True, default=str),
        )
        for row in (snapshot.get('rooms') or [])
    ))
    doors = tuple(sorted(
        (
            (row.get('door_type') or ''),
            num(row.get('width')),
            num(row.get('height')),
            num(row.get('position_x')),
            num(row.get('position_y')),
        )
        for row in (snapshot.get('doors') or [])
    ))
    return (
        num(project_row.get('width')),
        num(project_row.get('length')),
        num(project_row.get('height')),
        walls,
        rooms,
        doors,
        len(snapshot.get('storeys') or []),
    )


@transaction.atomic
def prepare_project_original_on_open(project: Project, *, user=None) -> Project:
    """On open: if versions exist, always show frozen V0. If not, V0 is the live drawing."""
    locked = Project.objects.select_for_update().get(pk=project.pk)
    original = original_layout_snapshot(locked)
    if locked.versions.exists():
        if original is None:
            return locked
        if (
            not locked.baseline_snapshot
            or _layout_fingerprint(locked.baseline_snapshot) != _layout_fingerprint(original)
        ):
            _persist_original(locked, original)
        current = export_project(locked, include_comments=False)
        if _layout_fingerprint(current) != _layout_fingerprint(original):
            restore_project_from_payload(locked, original, user=user)
            _persist_original(locked, original)
        return locked
    if original is None:
        locked.baseline_snapshot = export_project(locked, include_comments=False)
        locked.save(update_fields=['baseline_snapshot'])
    return locked


@transaction.atomic
def ensure_live_is_original(project: Project, *, user=None) -> Project:
    """If named versions exist, put the live drawing back to version 0."""
    locked = Project.objects.select_for_update().get(pk=project.pk)
    if not locked.versions.exists():
        return locked
    original = original_layout_snapshot(locked)
    if original is None:
        return locked
    if (
        not locked.baseline_snapshot
        or _layout_fingerprint(locked.baseline_snapshot) != _layout_fingerprint(original)
    ):
        _persist_original(locked, original)
    current = export_project(locked, include_comments=False)
    if _layout_fingerprint(current) != _layout_fingerprint(original):
        restore_project_from_payload(locked, original, user=user)
        _persist_original(locked, original)
    return locked


@transaction.atomic
def delete_project_version(project: Project, version: ProjectVersion) -> None:
    locked = Project.objects.select_for_update().get(pk=project.pk)
    deleted, _ = locked.versions.filter(pk=version.pk).delete()
    if not deleted:
        raise ProjectVersion.DoesNotExist


@transaction.atomic
def restore_project_version(project: Project, version: ProjectVersion, *, user=None) -> ProjectVersion:
    """Load a named snapshot onto the live canvas. Version 0 (baseline) stays frozen."""
    locked = Project.objects.select_for_update().get(pk=project.pk)
    original = original_layout_snapshot(locked)
    restore_project_from_payload(locked, version.snapshot, user=user)
    if original is not None:
        _persist_original(locked, original)
    return version


@transaction.atomic
def copy_project_version(project: Project, version: ProjectVersion, *, user=None) -> Project:
    label = (version.label or '').strip()
    suffix = f'v{version.number}'
    if label:
        suffix = f'{suffix} {label}'
    name = unique_copy_name(f'{project.name} ({suffix})')
    return copy_project_from_payload(
        version.snapshot,
        name=name,
        folder=project.folder,
        user=user,
    )
