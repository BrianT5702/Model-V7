from rest_framework.permissions import SAFE_METHODS, BasePermission

from .role_utils import user_can_edit, user_is_admin


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
