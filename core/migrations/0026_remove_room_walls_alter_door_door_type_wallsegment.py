# Generated by Django 5.1.4 on 2025-05-24 10:21

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0025_room_room_points'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='room',
            name='walls',
        ),
        migrations.AlterField(
            model_name='door',
            name='door_type',
            field=models.CharField(choices=[('swing', 'Swing Door'), ('slide', 'Slide Door')], default='swing', help_text='Specify the type of door.', max_length=50),
        ),
        migrations.CreateModel(
            name='WallSegment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('start_x', models.FloatField(help_text="X-coordinate of the segment's start point")),
                ('start_y', models.FloatField(help_text="Y-coordinate of the segment's start point")),
                ('end_x', models.FloatField(help_text="X-coordinate of the segment's end point")),
                ('end_y', models.FloatField(help_text="Y-coordinate of the segment's end point")),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('room', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='wall_segments', to='core.room')),
                ('wall', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='segments', to='core.wall')),
            ],
            options={
                'unique_together': {('wall', 'room')},
            },
        ),
    ]
