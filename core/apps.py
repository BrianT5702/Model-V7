from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        from django.contrib.auth.models import User
        from django.db.models.signals import post_save
        from .role_utils import ensure_user_profile
        from .signals import connect_project_activity_signals

        def create_user_profile(sender, instance, created, **kwargs):
            if created:
                ensure_user_profile(instance)

        post_save.connect(create_user_profile, sender=User, dispatch_uid='core_create_user_profile')
        connect_project_activity_signals()
