"""Signal handlers that mark a project as edited when related content changes."""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .project_activity import mark_project_edited, resolve_project_id


def _touch_related_project(instance, **kwargs):
    if kwargs.get('raw'):
        return
    project_id = resolve_project_id(instance)
    if project_id is not None:
        mark_project_edited(project_id)


def connect_project_activity_signals():
    from .models import (
        CeilingPanel,
        CeilingPlan,
        CeilingZone,
        Door,
        FloorPanel,
        FloorPlan,
        Intersection,
        PlanAnnotation,
        Room,
        Storey,
        Wall,
        WallWindow,
        Window,
    )

    models = (
        Wall,
        Room,
        Storey,
        Door,
        Window,
        WallWindow,
        Intersection,
        CeilingPlan,
        CeilingPanel,
        CeilingZone,
        FloorPlan,
        FloorPanel,
        PlanAnnotation,
    )

    for model in models:
        post_save.connect(
            _touch_related_project,
            sender=model,
            dispatch_uid=f'core_touch_project_on_save_{model.__name__}',
        )
        post_delete.connect(
            _touch_related_project,
            sender=model,
            dispatch_uid=f'core_touch_project_on_delete_{model.__name__}',
        )
