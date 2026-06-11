from django.db import migrations


def clear_staff_for_non_admin_roles(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    UserProfile = apps.get_model('core', 'UserProfile')

    non_admin_user_ids = UserProfile.objects.exclude(role='admin').values_list('user_id', flat=True)
    User.objects.filter(id__in=non_admin_user_ids, is_staff=True).update(is_staff=False)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0068_userprofile_role'),
    ]

    operations = [
        migrations.RunPython(clear_staff_for_non_admin_roles, migrations.RunPython.noop),
    ]
