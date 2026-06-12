from django.contrib.auth.models import User

ROLE_ADMIN = 'admin'
ROLE_DRAFTER = 'drafter'
ROLE_SALESMAN = 'salesman'

ROLE_CHOICES = (
    (ROLE_ADMIN, 'Admin'),
    (ROLE_DRAFTER, 'Drafter'),
    (ROLE_SALESMAN, 'Salesman'),
)

VALID_ROLES = {ROLE_ADMIN, ROLE_DRAFTER, ROLE_SALESMAN}
EDITOR_ROLES = {ROLE_ADMIN, ROLE_DRAFTER}


def _get_user_profile(user):
    if user is None or not getattr(user, 'pk', None):
        return None
    try:
        return user.profile
    except Exception:
        from .models import UserProfile
        try:
            return UserProfile.objects.get(user_id=user.pk)
        except UserProfile.DoesNotExist:
            return None


def get_user_role(user):
    """Return the app role for a user, or None if anonymous."""
    if not user or not user.is_authenticated:
        return None

    profile = _get_user_profile(user)
    if profile is not None:
        return profile.role

    if user.is_superuser or user.is_staff:
        return ROLE_ADMIN
    return ROLE_DRAFTER


def user_can_edit(user):
    return get_user_role(user) in EDITOR_ROLES


def user_can_comment(user):
    """Salesman accounts can leave customer feedback comments."""
    return get_user_role(user) == ROLE_SALESMAN


def user_is_admin(user):
    return get_user_role(user) == ROLE_ADMIN


def user_is_manageable_by_admin(user):
    """Drafter and Salesman accounts can be edited/removed by an admin."""
    return get_user_role(user) in {ROLE_DRAFTER, ROLE_SALESMAN}


def ensure_user_profile(user, role=None):
    from .models import UserProfile

    profile, created = UserProfile.objects.get_or_create(user=user)
    if created and role is None:
        if user.is_superuser or user.is_staff:
            role = ROLE_ADMIN
        else:
            role = ROLE_DRAFTER
    if role is not None and profile.role != role:
        profile.role = role
        profile.save(update_fields=['role'])

    effective_role = profile.role
    if effective_role in {ROLE_DRAFTER, ROLE_SALESMAN} and user.is_staff:
        user.is_staff = False
        user.save(update_fields=['is_staff'])

    return profile
