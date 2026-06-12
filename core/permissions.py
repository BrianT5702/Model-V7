from rest_framework.permissions import SAFE_METHODS, BasePermission

from .role_utils import user_can_comment, user_can_edit, user_is_admin


class IsEditorOrReadOnly(BasePermission):
    """Allow reads for everyone; writes only for Admin and Drafter roles."""

    def has_permission(self, request, view):
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
        if request.method == 'POST':
            return user_can_comment(request.user)
        return False
