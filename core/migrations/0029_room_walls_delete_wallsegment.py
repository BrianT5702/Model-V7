# Generated by Django 5.1.4 on 2025-05-24 10:39

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0028_remove_room_walls_wallsegment'),
    ]

    operations = [
        migrations.AddField(
            model_name='room',
            name='walls',
            field=models.ManyToManyField(related_name='rooms', to='core.wall'),
        ),
        migrations.DeleteModel(
            name='WallSegment',
        ),
    ]
