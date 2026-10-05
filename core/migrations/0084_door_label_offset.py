from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0083_wall_side_panel_length'),
    ]

    operations = [
        migrations.AddField(
            model_name='door',
            name='label_offset',
            field=models.JSONField(
                blank=True,
                help_text='Dragged door-mark offset from the door center, in door-local millimetres {x, y}.',
                null=True,
            ),
        ),
    ]
