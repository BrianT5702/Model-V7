"""Track who last edited a project (including wall/room/plan mutations)."""

from __future__ import annotations

import threading

from django.utils import timezone

_local = threading.local()


def set_request_user(user) -> None:
    _local.user = user
    _local.touched_projects = set()


def clear_request_user() -> None:
    _local.user = None
    _local.touched_projects = set()


def get_request_user():
    return getattr(_local, 'user', None)


def mark_project_edited(project_id, user=None) -> None:
    """Update Project.last_edited_by / updated_at once per request per project."""
    if project_id is None:
        return

    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        return

    touched = getattr(_local, 'touched_projects', None)
    if touched is None:
        touched = set()
        _local.touched_projects = touched
    if project_id in touched:
        return
    touched.add(project_id)

    acting_user = user if user is not None else get_request_user()
    user_id = None
    if acting_user is not None and getattr(acting_user, 'is_authenticated', False):
        user_id = getattr(acting_user, 'pk', None)

    from .models import Project

    updates = {'updated_at': timezone.now()}
    if user_id is not None:
        updates['last_edited_by_id'] = user_id

    Project.objects.filter(pk=project_id).update(**updates)


def resolve_project_id(instance) -> int | None:
    """Best-effort project id from a related model instance."""
    if instance is None:
        return None

    model_name = instance.__class__.__name__
    if model_name == 'Project':
        return getattr(instance, 'pk', None)

    project_id = getattr(instance, 'project_id', None)
    if project_id is not None:
        return project_id

    project = getattr(instance, 'project', None)
    if project is not None:
        return getattr(project, 'pk', None)

    # Nested relations
    wall_id = getattr(instance, 'wall_id', None)
    if wall_id is not None or getattr(instance, 'wall', None) is not None:
        wall = getattr(instance, 'wall', None)
        if wall is not None:
            return getattr(wall, 'project_id', None) or getattr(getattr(wall, 'project', None), 'pk', None)
        from .models import Wall
        return Wall.objects.filter(pk=wall_id).values_list('project_id', flat=True).first()

    door_id = getattr(instance, 'door_id', None)
    if door_id is not None or getattr(instance, 'door', None) is not None:
        door = getattr(instance, 'door', None)
        if door is not None:
            return getattr(door, 'project_id', None) or getattr(getattr(door, 'project', None), 'pk', None)
        from .models import Door
        return Door.objects.filter(pk=door_id).values_list('project_id', flat=True).first()

    room_id = getattr(instance, 'room_id', None)
    if room_id is not None or getattr(instance, 'room', None) is not None:
        room = getattr(instance, 'room', None)
        if room is not None:
            return getattr(room, 'project_id', None) or getattr(getattr(room, 'project', None), 'pk', None)
        from .models import Room
        return Room.objects.filter(pk=room_id).values_list('project_id', flat=True).first()

    zone_id = getattr(instance, 'zone_id', None)
    if zone_id is not None or getattr(instance, 'zone', None) is not None:
        zone = getattr(instance, 'zone', None)
        if zone is not None:
            return getattr(zone, 'project_id', None) or getattr(getattr(zone, 'project', None), 'pk', None)
        from .models import CeilingZone
        return CeilingZone.objects.filter(pk=zone_id).values_list('project_id', flat=True).first()

    return None
