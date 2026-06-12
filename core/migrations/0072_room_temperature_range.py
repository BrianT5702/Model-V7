from django.db import migrations, models


def copy_temperature_to_range(apps, schema_editor):
    Room = apps.get_model('core', 'Room')
    for room in Room.objects.exclude(temperature__isnull=True):
        room.temperature_min = room.temperature
        room.temperature_max = room.temperature
        room.save(update_fields=['temperature_min', 'temperature_max'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0071_room_height_range'),
    ]

    operations = [
        migrations.AddField(
            model_name='room',
            name='temperature_min',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='Minimum room temperature in °C when a range is specified.',
                max_digits=5,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='room',
            name='temperature_max',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='Maximum room temperature in °C when a range is specified.',
                max_digits=5,
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name='room',
            name='temperature',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='Primary room temperature in °C (max when a range is set).',
                max_digits=5,
                null=True,
            ),
        ),
        migrations.RunPython(copy_temperature_to_range, migrations.RunPython.noop),
    ]
