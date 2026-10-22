"""API views for project and folder share links."""

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Project, ProjectFolder, ProjectShareLink
from .permissions import CanManageProjectShareLinks
from .share_utils import descendant_folder_ids, generate_share_token, resolve_active_share


def _serialize_share_link(link: ProjectShareLink) -> dict:
    return {
        'id': link.id,
        'token': link.token,
        'mode': link.mode,
        'kind': link.kind,
        'project_id': link.project_id,
        'folder_id': link.folder_id,
        'created_at': link.created_at,
        'revoked_at': link.revoked_at,
        'is_active': link.is_active,
        'path': f'/share/{link.token}',
    }


def _parse_mode(request):
    mode = (request.data.get('mode') or ProjectShareLink.MODE_VIEW).strip().lower()
    if mode not in {ProjectShareLink.MODE_VIEW, ProjectShareLink.MODE_EDIT}:
        return None, Response(
            {'error': 'mode must be "view" or "edit".'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return mode, None


def _get_or_create_link(request, *, project=None, folder=None):
    mode, error = _parse_mode(request)
    if error is not None:
        return error

    filters = {
        'mode': mode,
        'revoked_at__isnull': True,
    }
    if project is not None:
        filters['project'] = project
    else:
        filters['folder'] = folder

    existing = (
        ProjectShareLink.objects
        .filter(**filters)
        .order_by('-created_at', '-id')
        .first()
    )
    if existing:
        return Response(_serialize_share_link(existing), status=status.HTTP_200_OK)

    link = ProjectShareLink.objects.create(
        project=project,
        folder=folder,
        token=generate_share_token(),
        mode=mode,
        created_by=request.user if request.user.is_authenticated else None,
    )
    return Response(_serialize_share_link(link), status=status.HTTP_201_CREATED)


def _folder_path(folder_id, folders_by_id) -> str:
    parts = []
    seen = set()
    current = folder_id
    while current and current not in seen and current in folders_by_id:
        seen.add(current)
        folder = folders_by_id[current]
        parts.append(folder.name)
        current = folder.parent_id
    return ' / '.join(reversed(parts))


def _folder_projects_payload(folder):
    folder_ids = descendant_folder_ids(folder.pk)
    folders = list(
        ProjectFolder.objects.filter(pk__in=folder_ids).only('id', 'name', 'parent_id')
    )
    folders_by_id = {item.id: item for item in folders}
    projects = (
        Project.objects
        .filter(folder_id__in=folder_ids, hidden_from_list=False)
        .order_by('list_order', 'name', 'id')
    )
    return [
        {
            'id': project.id,
            'name': project.name,
            'width': project.width,
            'length': project.length,
            'height': project.height,
            'folder_id': project.folder_id,
            'folder_name': _folder_path(project.folder_id, folders_by_id),
            'updated_at': project.updated_at,
        }
        for project in projects
    ]


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

    return _get_or_create_link(request, project=project)


@api_view(['GET', 'POST'])
@permission_classes([CanManageProjectShareLinks])
def folder_share_links_view(request, folder_id):
    try:
        folder = ProjectFolder.objects.get(pk=folder_id)
    except ProjectFolder.DoesNotExist:
        return Response({'error': 'Folder not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        links = (
            ProjectShareLink.objects
            .filter(folder=folder, revoked_at__isnull=True)
            .order_by('-created_at', '-id')
        )
        return Response({
            'share_links': [_serialize_share_link(link) for link in links],
        })

    return _get_or_create_link(request, folder=folder)


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

    payload = {
        'token': link.token,
        'mode': link.mode,
        'kind': link.kind,
        'path': f'/share/{link.token}',
    }
    if link.folder_id:
        folder = link.folder
        folder_ids = descendant_folder_ids(folder.pk)
        folders = list(
            ProjectFolder.objects.filter(pk__in=folder_ids).only('id', 'name', 'parent_id')
        )
        folders_by_id = {item.id: item for item in folders}
        payload.update({
            'folder_id': folder.id,
            'folder_name': folder.name,
            'folder_path': _folder_path(folder.id, folders_by_id),
            'projects': _folder_projects_payload(folder),
        })
    else:
        project = link.project
        payload.update({
            'project_id': project.id,
            'project_name': project.name,
        })
    return Response(payload, status=status.HTTP_200_OK)
