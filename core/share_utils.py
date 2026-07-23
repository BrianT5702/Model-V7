"""Helpers for tokenized project share links."""

from __future__ import annotations

import secrets

from .models import ProjectShareLink

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
        .select_related('project')
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


def request_has_edit_share_for_project(request, project_id) -> bool:
    if project_id is None:
        return False
    share = get_share_link_from_request(request)
    if not share or share.mode != ProjectShareLink.MODE_EDIT:
        return False
    try:
        return int(share.project_id) == int(project_id)
    except (TypeError, ValueError):
        return False


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

    if share is not None:
        return share.project_id
    return None
