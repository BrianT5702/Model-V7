from django.db import migrations, models


def copy_height_to_range(apps, schema_editor):
    Room = apps.get_model('core', 'Room')
    for room in Room.objects.exclude(height__isnull=True):
        room.height_min = room.height
        room.height_max = room.height
        room.save(update_fields=['height_min', 'height_max'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0070_project_comments'),
    ]

    operations = [
        migrations.AddField(
            model_name='room',
            name='height_min',
            field=models.FloatField(
                blank=True,
                help_text='Minimum room height in mm when a range is specified',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='room',
            name='height_max',
            field=models.FloatField(
                blank=True,
                help_text='Maximum room height in mm when a range is specified',
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name='room',
            name='height',
            field=models.FloatField(
                blank=True,
                help_text='Primary room height in mm (max when a range is set; used for wall/plan calculations)',
                null=True,
            ),
        ),
        migrations.RunPython(copy_height_to_range, migrations.RunPython.noop),
    ]
