"""API views for project share links."""

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Project, ProjectShareLink
from .permissions import CanManageProjectShareLinks
from .share_utils import generate_share_token, resolve_active_share


def _serialize_share_link(link: ProjectShareLink) -> dict:
    return {
        'id': link.id,
        'token': link.token,
        'mode': link.mode,
        'project_id': link.project_id,
        'created_at': link.created_at,
        'revoked_at': link.revoked_at,
        'is_active': link.is_active,
        'path': f'/share/{link.token}',
    }


@api_view(['GET', 'POST'])
@permission_classes([CanManageProjectShareLinks])
def project_share_links_view(request, project_id):
    try:
        project = Project.objects.get(pk=project_id)
    except Project.DoesNotExist:
        return Response({'error': 'Project not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        links = (
            ProjectShareLink.objects
            .filter(project=project, revoked_at__isnull=True)
            .order_by('-created_at', '-id')
        )
        return Response({
            'share_links': [_serialize_share_link(link) for link in links],
        })

    mode = (request.data.get('mode') or ProjectShareLink.MODE_VIEW).strip().lower()
    if mode not in {ProjectShareLink.MODE_VIEW, ProjectShareLink.MODE_EDIT}:
        return Response(
            {'error': 'mode must be "view" or "edit".'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Reuse an existing active link of the same mode when possible.
    existing = (
        ProjectShareLink.objects
        .filter(project=project, mode=mode, revoked_at__isnull=True)
        .order_by('-created_at', '-id')
        .first()
    )
    if existing:
        return Response(_serialize_share_link(existing), status=status.HTTP_200_OK)

    link = ProjectShareLink.objects.create(
        project=project,
        token=generate_share_token(),
        mode=mode,
        created_by=request.user if request.user.is_authenticated else None,
    )
    return Response(_serialize_share_link(link), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([CanManageProjectShareLinks])
def revoke_project_share_link_view(request, project_id, link_id):
    try:
        link = ProjectShareLink.objects.get(pk=link_id, project_id=project_id)
    except ProjectShareLink.DoesNotExist:
        return Response({'error': 'Share link not found.'}, status=status.HTTP_404_NOT_FOUND)

    if link.revoked_at is None:
        link.revoked_at = timezone.now()
        link.save(update_fields=['revoked_at'])

    return Response(_serialize_share_link(link), status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([AllowAny])
def resolve_share_link_view(request, token):
    link = resolve_active_share(token)
    if not link:
        return Response({'error': 'Share link is invalid or has been revoked.'}, status=status.HTTP_404_NOT_FOUND)

    project = link.project
    return Response({
        'token': link.token,
        'mode': link.mode,
        'project_id': project.id,
        'project_name': project.name,
        'path': f'/share/{link.token}',
    }, status=status.HTTP_200_OK)
