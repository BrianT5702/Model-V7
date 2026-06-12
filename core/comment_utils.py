from django.utils import timezone

from .models import ProjectComment, ProjectCommentReadStatus
from .role_utils import user_can_edit


def get_unread_comment_counts(user, project_ids):
    """Return {project_id: unread_count} for editors who have not viewed recent comments."""
    if not user or not user.is_authenticated or not project_ids:
        return {}

    if not user_can_edit(user):
        return {project_id: 0 for project_id in project_ids}

    read_statuses = {
        status.project_id: status.last_read_at
        for status in ProjectCommentReadStatus.objects.filter(
            user=user,
            project_id__in=project_ids,
        )
    }

    counts = {project_id: 0 for project_id in project_ids}
    for project_id in project_ids:
        queryset = ProjectComment.objects.filter(project_id=project_id)
        last_read = read_statuses.get(project_id)
        if last_read is not None:
            queryset = queryset.filter(created_at__gt=last_read)
        counts[project_id] = queryset.count()

    return counts


def mark_project_comments_read(user, project):
    """Mark all comments on a project as read for the given user."""
    if not user or not user.is_authenticated:
        return
    ProjectCommentReadStatus.objects.update_or_create(
        user=user,
        project=project,
        defaults={'last_read_at': timezone.now()},
    )
