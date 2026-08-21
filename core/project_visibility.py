"""Limit salesman accounts to projects they have been granted access to."""

from django.db.models import Q

from .models import Project, ProjectFolder
from .role_utils import ROLE_SALESMAN, get_user_role, user_can_edit
from .share_utils import extract_project_id_from_obj, get_share_link_from_request


def _share_project_id(request):
    share = get_share_link_from_request(request)
    if share is None:
        return None
    try:
        return int(share.project_id)
    except (TypeError, ValueError):
        return None


def visible_project_ids_for_request(request):
    """Project IDs a salesman may access (assigned projects plus an active share)."""
    user = getattr(request, 'user', None)
    ids = set()
    if user is not None and getattr(user, 'is_authenticated', False):
        ids.update(
            Project.objects.filter(visible_to_salesmen=user).values_list('id', flat=True)
        )
    share_id = _share_project_id(request)
    if share_id is not None:
        ids.add(share_id)
    return ids


def visible_folder_ids_for_request(request, project_ids=None):
    """Folders that contain a salesman's visible projects, plus ancestor folders."""
    if project_ids is None:
        project_ids = visible_project_ids_for_request(request)
    folder_ids = set(
        Project.objects.filter(pk__in=project_ids, folder_id__isnull=False)
        .values_list('folder_id', flat=True)
    )
    if not folder_ids:
        return set()

    parent_by_id = dict(ProjectFolder.objects.values_list('id', 'parent_id'))
    allowed = set(folder_ids)
    for folder_id in list(folder_ids):
        current = parent_by_id.get(folder_id)
        while current is not None and current not in allowed:
            allowed.add(current)
            current = parent_by_id.get(current)
    return allowed


def filter_queryset_to_project_ids(queryset, project_ids):
    """Restrict a related queryset to the given project IDs."""
    project_ids = list(project_ids)
    model = queryset.model
    name = model.__name__

    if name == 'Project':
        return queryset.filter(pk__in=project_ids)
    if name == 'ProjectFolder':
        return queryset.none()
    if name in ('CeilingPanel', 'CeilingPlan'):
        return queryset.filter(Q(room__project_id__in=project_ids) | Q(zone__project_id__in=project_ids))
    if name in ('FloorPanel', 'FloorPlan'):
        return queryset.filter(room__project_id__in=project_ids)
    if name == 'Window':
        return queryset.filter(door__project_id__in=project_ids)
    if name == 'WallWindow':
        return queryset.filter(wall__project_id__in=project_ids)

    field_names = {f.name for f in model._meta.get_fields()}
    if 'project' in field_names:
        return queryset.filter(project_id__in=project_ids)

    return queryset.none()


def scope_queryset_for_salesman(request, queryset):
    """Salesmen only see assigned projects; admin/drafter are unchanged."""
    user = getattr(request, 'user', None)
    if not user or not getattr(user, 'is_authenticated', False):
        return queryset
    if user_can_edit(user):
        return queryset
    if get_user_role(user) != ROLE_SALESMAN:
        return queryset

    project_ids = visible_project_ids_for_request(request)
    if queryset.model.__name__ == 'ProjectFolder':
        folder_ids = visible_folder_ids_for_request(request, project_ids)
        return queryset.filter(pk__in=folder_ids)
    return filter_queryset_to_project_ids(queryset, project_ids)


def user_can_access_project(request, project_id) -> bool:
    """True if the current user may open this project."""
    if project_id is None:
        return False
    user = getattr(request, 'user', None)
    if user_can_edit(user):
        return True
    try:
        project_id = int(project_id)
    except (TypeError, ValueError):
        return False

    if user and getattr(user, 'is_authenticated', False) and get_user_role(user) == ROLE_SALESMAN:
        if Project.objects.filter(pk=project_id, visible_to_salesmen=user).exists():
            return True

    share_id = _share_project_id(request)
    return share_id is not None and share_id == project_id


def user_can_access_obj(request, obj) -> bool:
    if user_can_edit(getattr(request, 'user', None)):
        return True
    project_id = extract_project_id_from_obj(obj)
    if project_id is None:
        # Folders: allow if the folder is in the salesman's visible tree.
        user = getattr(request, 'user', None)
        if (
            obj is not None
            and obj.__class__.__name__ == 'ProjectFolder'
            and user
            and get_user_role(user) == ROLE_SALESMAN
        ):
            return obj.pk in visible_folder_ids_for_request(request)
        return False
    return user_can_access_project(request, project_id)


def filter_project_queryset_for_request(request, queryset):
    """Apply salesman visibility to a Project queryset (editors unchanged)."""
    return scope_queryset_for_salesman(request, queryset)
