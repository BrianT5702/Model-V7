from rest_framework.permissions import SAFE_METHODS, BasePermission

from .project_visibility import user_can_access_obj
from .role_utils import user_can_comment, user_can_edit, user_is_admin
from .share_utils import (
    extract_project_id_from_obj,
    get_share_link_from_request,
)


def _view_basename(view) -> str:
    return getattr(view, 'basename', None) or ''


def _view_action(view) -> str | None:
    return getattr(view, 'action', None)


def _is_authenticated(user) -> bool:
    return bool(user and getattr(user, 'is_authenticated', False))


def _share_matches_obj(share, obj) -> bool:
    if share is None or obj is None:
        return False
    project_id = extract_project_id_from_obj(obj)
    if project_id is None:
        return False
    try:
        return int(project_id) == int(share.project_id)
    except (TypeError, ValueError):
        return False


class IsEditorOrReadOnly(BasePermission):
    """Authenticated (or share-scoped) reads; writes for Admin/Drafter only."""

    def has_permission(self, request, view):
        basename = _view_basename(view)
        action = _view_action(view)
        share = get_share_link_from_request(request)
        is_authed = _is_authenticated(request.user)

        if request.method in SAFE_METHODS:
            # Share visitors must not browse the full project / folder list.
            if (
                share is not None
                and not user_can_edit(request.user)
                and basename in ('project', 'project-folder')
                and action == 'list'
            ):
                return False

            if is_authed:
                return True

            # Anonymous share session: allow read APIs (object/queryset scope the project).
            return share is not None

        return user_can_edit(request.user)

    def has_object_permission(self, request, view, obj):
        if user_can_edit(request.user):
            return True

        if request.method not in SAFE_METHODS:
            return False

        if _is_authenticated(request.user):
            return user_can_access_obj(request, obj)

        share = get_share_link_from_request(request)
        return _share_matches_obj(share, obj)


class IsAdminRole(BasePermission):
    """Only users with the Admin role."""

    def has_permission(self, request, view):
        return user_is_admin(request.user)


class IsAuthenticatedReadOnly(BasePermission):
    """Authenticated users can read; no write access via this permission alone."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return _is_authenticated(request.user)
        return False


class CanAddProjectComment(BasePermission):
    """Authenticated salesman can post comments; editors can read and mark read."""

    def has_permission(self, request, view):
        if not _is_authenticated(request.user):
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method == 'POST' and getattr(view, 'action', None) == 'mark_comments_read':
            return user_can_edit(request.user)
        if request.method == 'PATCH' and getattr(view, 'action', None) == 'update_comment_status':
            return user_can_edit(request.user)
        if request.method == 'POST':
            return user_can_comment(request.user)
        return False


class PlanAnnotationPermission(BasePermission):
    """Authenticated/share-scoped users can view plan annotations; only editors can modify."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            if _is_authenticated(request.user):
                return True
            return get_share_link_from_request(request) is not None
        return user_can_edit(request.user)

    def has_object_permission(self, request, view, obj):
        if user_can_edit(request.user):
            return True
        if request.method not in SAFE_METHODS:
            return False
        if _is_authenticated(request.user):
            return user_can_access_obj(request, obj)
        share = get_share_link_from_request(request)
        return _share_matches_obj(share, obj)


class IsEditorRole(BasePermission):
    """Admin or Drafter."""

    def has_permission(self, request, view):
        return user_can_edit(request.user)


class CanManageProjectShareLinks(BasePermission):
    """Only editors can create/list/revoke share links."""

    def has_permission(self, request, view):
        return user_can_edit(request.user)
