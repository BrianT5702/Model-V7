from rest_framework.permissions import SAFE_METHODS, BasePermission

from .role_utils import user_can_comment, user_can_edit, user_is_admin
from .share_utils import get_share_link_from_request


def _view_basename(view) -> str:
    return getattr(view, 'basename', None) or ''


def _view_action(view) -> str | None:
    return getattr(view, 'action', None)


class IsEditorOrReadOnly(BasePermission):
    """Allow reads for everyone; writes only for Admin and Drafter roles."""

    def has_permission(self, request, view):
        basename = _view_basename(view)
        action = _view_action(view)
        share = get_share_link_from_request(request)

        # Share visitors must not browse the full project / folder list.
        if (
            request.method in SAFE_METHODS
            and share is not None
            and not user_can_edit(request.user)
            and basename in ('project', 'project-folder')
            and action == 'list'
        ):
            return False

        if request.method in SAFE_METHODS:
            return True
        return user_can_edit(request.user)


class IsAdminRole(BasePermission):
    """Only users with the Admin role."""

    def has_permission(self, request, view):
        return user_is_admin(request.user)


class IsAuthenticatedReadOnly(BasePermission):
    """Authenticated users can read; no write access via this permission alone."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return request.user and request.user.is_authenticated
        return False


class CanAddProjectComment(BasePermission):
    """Authenticated salesman can post comments; editors can read and mark read."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
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
    """Anyone can view plan annotations; only editors can modify."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return user_can_edit(request.user)


class CanManageProjectShareLinks(BasePermission):
    """Only editors can create/list/revoke share links."""

    def has_permission(self, request, view):
        return user_can_edit(request.user)
