import re

from django.db import migrations, models


VERSION_COPY_NAME = re.compile(r' \(v\d+(?: .*)?\)$')


def hide_version_copy_projects(apps, schema_editor):
    Project = apps.get_model('core', 'Project')
    for project in Project.objects.all().iterator():
        if VERSION_COPY_NAME.search(project.name or ''):
            project.hidden_from_list = True
            project.save(update_fields=['hidden_from_list'])


def unhide_version_copy_projects(apps, schema_editor):
    Project = apps.get_model('core', 'Project')
    Project.objects.filter(hidden_from_list=True).update(hidden_from_list=False)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0080_projectversion'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='hidden_from_list',
            field=models.BooleanField(
                default=False,
                help_text='If True, this project is hidden on Home. Used for leftover version copies.',
            ),
        ),
        migrations.RunPython(hide_version_copy_projects, unhide_version_copy_projects),
    ]
