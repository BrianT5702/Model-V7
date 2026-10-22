"""Helpers for tokenized project and folder share links."""

from __future__ import annotations

import secrets

from django.db.models import Q

from .models import Project, ProjectFolder, ProjectShareLink

SHARE_TOKEN_HEADER = 'HTTP_X_SHARE_TOKEN'
SHARE_TOKEN_QUERY = 'share_token'


def generate_share_token() -> str:
    return secrets.token_urlsafe(32)


def get_share_token_from_request(request) -> str | None:
    if request is None:
        return None
    meta = getattr(request, 'META', {}) or {}
    header_token = meta.get(SHARE_TOKEN_HEADER) or meta.get('HTTP_X_SHARE_TOKEN')
    if header_token:
        return str(header_token).strip() or None
    # DRF Request wraps Django request
    django_request = getattr(request, '_request', request)
    meta = getattr(django_request, 'META', {}) or {}
    header_token = meta.get('HTTP_X_SHARE_TOKEN')
    if header_token:
        return str(header_token).strip() or None
    query = getattr(request, 'query_params', None)
    if query is not None:
        token = query.get(SHARE_TOKEN_QUERY)
        if token:
            return str(token).strip() or None
    get = getattr(django_request, 'GET', None)
    if get is not None:
        token = get.get(SHARE_TOKEN_QUERY)
        if token:
            return str(token).strip() or None
    return None


def resolve_active_share(token: str | None) -> ProjectShareLink | None:
    if not token:
        return None
    return (
        ProjectShareLink.objects
        .select_related('project', 'folder')
        .filter(token=token, revoked_at__isnull=True)
        .first()
    )


def get_share_link_from_request(request) -> ProjectShareLink | None:
    cached = getattr(request, '_share_link_cache', None)
    if cached is not None or getattr(request, '_share_link_resolved', False):
        return cached
    token = get_share_token_from_request(request)
    share = resolve_active_share(token)
    try:
        request._share_link_cache = share
        request._share_link_resolved = True
    except Exception:
        pass
    return share


def descendant_folder_ids(folder_id) -> set[int]:
    """The folder itself plus every nested folder."""
    try:
        root_id = int(folder_id)
    except (TypeError, ValueError):
        return set()

    children_by_parent = {}
    for fid, parent_id in ProjectFolder.objects.values_list('id', 'parent_id'):
        children_by_parent.setdefault(parent_id, []).append(fid)

    ids = set()
    stack = [root_id]
    while stack:
        current = stack.pop()
        if current in ids:
            continue
        ids.add(current)
        stack.extend(children_by_parent.get(current, []))
    return ids


def folder_ids_for_share(share) -> set[int]:
    if share is None or not share.folder_id:
        return set()
    cached = getattr(share, '_covered_folder_ids', None)
    if cached is not None:
        return cached
    ids = descendant_folder_ids(share.folder_id)
    try:
        share._covered_folder_ids = ids
    except Exception:
        pass
    return ids


def share_project_ids(share) -> set[int]:
    """Projects this link may open. A folder link includes nested folders."""
    if share is None:
        return set()
    cached = getattr(share, '_covered_project_ids', None)
    if cached is not None:
        return cached
    if share.project_id:
        ids = {int(share.project_id)}
    elif share.folder_id:
        ids = set(
            Project.objects.filter(
                folder_id__in=folder_ids_for_share(share),
                hidden_from_list=False,
            ).values_list('id', flat=True)
        )
    else:
        ids = set()
    try:
        share._covered_project_ids = ids
    except Exception:
        pass
    return ids


def share_covers_project(share, project_id) -> bool:
    if share is None or project_id is None:
        return False
    try:
        return int(project_id) in share_project_ids(share)
    except (TypeError, ValueError):
        return False


def request_has_edit_share_for_project(request, project_id) -> bool:
    if project_id is None:
        return False
    share = get_share_link_from_request(request)
    if not share or share.mode != ProjectShareLink.MODE_EDIT:
        return False
    return share_covers_project(share, project_id)


def extract_project_id_from_obj(obj):
    if obj is None:
        return None
    if hasattr(obj, 'project_id') and obj.project_id is not None:
        return obj.project_id
    if hasattr(obj, 'project') and getattr(obj, 'project', None) is not None:
        project = obj.project
        return getattr(project, 'pk', project)
    # Project instance itself
    model_name = obj.__class__.__name__
    if model_name == 'Project':
        return getattr(obj, 'pk', None)
    return None


def extract_project_id_from_request(request, view=None):
    share = get_share_link_from_request(request)
    # Prefer explicit project references on write payloads
    data = getattr(request, 'data', None)
    if data is not None:
        for key in ('project', 'project_id'):
            if key in data and data.get(key) not in (None, ''):
                try:
                    return int(data.get(key))
                except (TypeError, ValueError):
                    pass

    if view is not None:
        basename = getattr(view, 'basename', None) or ''
        kwargs = getattr(view, 'kwargs', {}) or {}
        if basename == 'project' or getattr(view, '__class__', type).__name__ == 'ProjectViewSet':
            pk = kwargs.get('pk')
            if pk is not None:
                try:
                    return int(pk)
                except (TypeError, ValueError):
                    pass

    if share is not None and share.project_id:
        return share.project_id
    return None


def scope_queryset_for_anonymous_share(request, queryset):
    """Limit anonymous share sessions to the shared project, or the shared folder."""
    user = getattr(request, 'user', None)
    if user is not None and getattr(user, 'is_authenticated', False):
        return queryset

    share = get_share_link_from_request(request)
    if share is None:
        return queryset

    project_ids = share_project_ids(share)
    model = queryset.model
    name = model.__name__

    if name == 'Project':
        return queryset.filter(pk__in=project_ids)
    if name == 'ProjectFolder':
        folder_ids = folder_ids_for_share(share)
        if not folder_ids:
            return queryset.none()
        return queryset.filter(pk__in=folder_ids)
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

    # Fail closed for unexpected models under anonymous share.
    return queryset.none()
