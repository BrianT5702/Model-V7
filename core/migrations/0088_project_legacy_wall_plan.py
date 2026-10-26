from django.db import migrations, models


def mark_existing_projects_legacy(apps, schema_editor):
    Project = apps.get_model('core', 'Project')
    Project.objects.all().update(legacy_wall_plan=True)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0087_foldersharelink'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='legacy_wall_plan',
            field=models.BooleanField(
                default=False,
                help_text='Older projects auto-extend corners and flip wall thickness on the 2D plan. Projects created from now on leave this off.',
            ),
        ),
        migrations.RunPython(mark_existing_projects_legacy, migrations.RunPython.noop),
    ]
