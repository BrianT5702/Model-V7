"""API views for named project versions."""

import logging

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import Project, ProjectShareLink, ProjectVersion
from .permissions import CanAccessProjectVersions, IsEditorRole
from .project_activity import mark_project_edited
from .project_copy import export_project
from .project_versions import (
    build_version_preview,
    create_project_version,
    delete_project_version,
    list_project_versions,
    original_layout_snapshot,
    restore_project_version,
    serialize_project_version,
)
from .project_visibility import user_can_access_project
from .role_utils import user_can_edit
from .share_utils import get_share_link_from_request

logger = logging.getLogger(__name__)


def _get_project(project_id):
    try:
        return Project.objects.get(pk=project_id)
    except Project.DoesNotExist:
        return None


def _get_version(project, version_id):
    try:
        return project.versions.get(pk=version_id)
    except ProjectVersion.DoesNotExist:
        return None


def _deny_if_inaccessible(request, project):
    if project is None:
        return Response({'error': 'Project not found.'}, status=status.HTTP_404_NOT_FOUND)
    if not user_can_access_project(request, project.pk):
        return Response({'error': 'Project not found.'}, status=status.HTTP_404_NOT_FOUND)
    return None


def _deny_if_cannot_write(request):
    if not user_can_edit(request.user):
        return Response({'error': 'Edit permission required.'}, status=status.HTTP_403_FORBIDDEN)
    share = get_share_link_from_request(request)
    if share is not None and share.mode != ProjectShareLink.MODE_EDIT:
        return Response(
            {'error': 'Version changes are not available on a view-only share link.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


@api_view(['GET', 'POST'])
@permission_classes([CanAccessProjectVersions])
def project_versions_view(request, project_id):
    project = _get_project(project_id)
    denied = _deny_if_inaccessible(request, project)
    if denied is not None:
        return denied

    if request.method == 'GET':
        versions = list_project_versions(project)
        return Response([serialize_project_version(version) for version in versions])

    write_denied = _deny_if_cannot_write(request)
    if write_denied is not None:
        return write_denied

    label = ''
    if isinstance(request.data, dict):
        label = request.data.get('label') or ''
    version = create_project_version(project, label=label, user=request.user)
    preview = build_version_preview(project, version.snapshot)
    preview['version'] = serialize_project_version(version)
    preview['reverted_to_original'] = True
    return Response(preview, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([CanAccessProjectVersions])
def project_version_original_preview_view(request, project_id):
    project = _get_project(project_id)
    denied = _deny_if_inaccessible(request, project)
    if denied is not None:
        return denied

    original = original_layout_snapshot(project)
    if original is None:
        original = export_project(project, include_comments=False)
    preview = build_version_preview(project, original)
    walls = preview.get('walls') or []
    rooms = preview.get('rooms') or []
    preview['version'] = {
        'id': None,
        'number': 0,
        'label': 'Original',
        'created_at': None,
        'created_by_username': None,
        'wall_count': len(walls),
        'room_count': len(rooms),
    }
    return Response(preview)


@api_view(['GET', 'DELETE'])
@permission_classes([CanAccessProjectVersions])
def project_version_detail_view(request, project_id, version_id):
    project = _get_project(project_id)
    denied = _deny_if_inaccessible(request, project)
    if denied is not None:
        return denied

    version = _get_version(project, version_id)
    if version is None:
        return Response({'error': 'Version not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        preview = build_version_preview(project, version.snapshot)
        preview['version'] = serialize_project_version(version)
        return Response(preview)

    write_denied = _deny_if_cannot_write(request)
    if write_denied is not None:
        return write_denied

    try:
        delete_project_version(project, version)
    except ProjectVersion.DoesNotExist:
        return Response({'error': 'Version not found.'}, status=status.HTTP_404_NOT_FOUND)

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([IsEditorRole])
def restore_project_version_view(request, project_id, version_id):
    write_denied = _deny_if_cannot_write(request)
    if write_denied is not None:
        return write_denied

    project = _get_project(project_id)
    denied = _deny_if_inaccessible(request, project)
    if denied is not None:
        return denied

    version = _get_version(project, version_id)
    if version is None:
        return Response({'error': 'Version not found.'}, status=status.HTTP_404_NOT_FOUND)

    try:
        restore_project_version(project, version, user=request.user)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        logger.exception('Failed to restore project %s version %s', project_id, version_id)
        return Response(
            {'error': 'Failed to restore this version.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    mark_project_edited(project.pk, request.user)
    return Response({
        'ok': True,
        'restored_version': serialize_project_version(version),
    })
