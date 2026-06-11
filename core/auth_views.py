from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .permissions import IsAdminRole
from .role_utils import (
    ROLE_DRAFTER,
    ROLE_SALESMAN,
    ensure_user_profile,
    get_user_role,
    user_can_edit,
    user_is_admin,
    user_is_manageable_by_admin,
)

REGISTERABLE_ROLES = {ROLE_DRAFTER, ROLE_SALESMAN}


def _serialize_user(user, *, request_user=None):
    role = get_user_role(user)
    data = {
        'id': user.id,
        'username': user.username,
        'role': role,
        'is_staff': user.is_staff,
        'can_edit': user_can_edit(user),
        'is_admin': user_is_admin(user),
        'date_joined': user.date_joined.isoformat() if user.date_joined else None,
        'last_login': user.last_login.isoformat() if user.last_login else None,
    }
    if request_user is not None:
        data['is_self'] = user.id == request_user.id
        data['can_manage'] = user_is_manageable_by_admin(user)
    return data


def _admin_user_queryset():
    return User.objects.select_related('profile').order_by('username')


def _get_managed_user(user_id):
    try:
        return _admin_user_queryset().get(pk=user_id)
    except User.DoesNotExist:
        return None


@api_view(['GET'])
@permission_classes([AllowAny])
def current_user_view(request):
    if request.user.is_authenticated:
        return Response({
            'authenticated': True,
            'user': _serialize_user(request.user),
        })
    return Response({
        'authenticated': False,
        'user': None,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    username = (request.data.get('username') or '').strip()
    password = request.data.get('password') or ''

    if not username or not password:
        return Response(
            {'error': 'Username and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = authenticate(request, username=username, password=password)
    if user is None:
        return Response(
            {'error': 'Invalid username or password.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    ensure_user_profile(user)
    login(request, user)
    return Response({
        'authenticated': True,
        'user': _serialize_user(user),
    })


@api_view(['POST'])
@permission_classes([IsAdminRole])
def register_view(request):
    username = (request.data.get('username') or '').strip()
    password = request.data.get('password') or ''
    role = (request.data.get('role') or ROLE_DRAFTER).strip().lower()

    if not username or not password:
        return Response(
            {'error': 'Username and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(password) < 6:
        return Response(
            {'error': 'Password must be at least 6 characters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if role not in REGISTERABLE_ROLES:
        return Response(
            {'error': 'Role must be drafter or salesman.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if User.objects.filter(username=username).exists():
        return Response(
            {'error': 'Username is already taken.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = User.objects.create_user(username=username, password=password)
    ensure_user_profile(user, role=role)
    return Response(
        {
            'user': _serialize_user(user),
            'message': f'Account "{username}" created as {role}.',
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([IsAdminRole])
def list_users_view(request):
    users = [
        _serialize_user(user, request_user=request.user)
        for user in _admin_user_queryset()
    ]
    return Response({'users': users})


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAdminRole])
def user_detail_view(request, user_id):
    target = _get_managed_user(user_id)
    if target is None:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        if target.id == request.user.id:
            return Response(
                {'error': 'You cannot delete your own account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not user_is_manageable_by_admin(target):
            return Response(
                {'error': 'Only Drafter and Salesman accounts can be removed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        username = target.username
        target.delete()
        return Response({'message': f'Account "{username}" removed.'})

    role = request.data.get('role')
    password = request.data.get('password') or ''

    if role is not None:
        role = str(role).strip().lower()
        if not user_is_manageable_by_admin(target):
            return Response(
                {'error': 'Only Drafter and Salesman accounts can be edited.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if role not in REGISTERABLE_ROLES:
            return Response(
                {'error': 'Role must be drafter or salesman.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ensure_user_profile(target, role=role)

    if password:
        if not user_is_manageable_by_admin(target):
            return Response(
                {'error': 'Only Drafter and Salesman accounts can be edited.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(password) < 6:
            return Response(
                {'error': 'Password must be at least 6 characters.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        target.set_password(password)
        target.save(update_fields=['password'])

    target.refresh_from_db()
    return Response({
        'user': _serialize_user(target, request_user=request.user),
        'message': f'Account "{target.username}" updated.',
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    logout(request)
    return Response({'message': 'Logged out successfully.'})
