# Generated by Django 5.1.4 on 2025-04-07 07:31

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0017_alter_door_slide_direction_and_more'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='intersection',
            options={},
        ),
        migrations.AddField(
            model_name='intersection',
            name='point_x',
            field=models.FloatField(default=0.0),
        ),
        migrations.AddField(
            model_name='intersection',
            name='point_y',
            field=models.FloatField(default=0.0),
        ),
        migrations.AlterField(
            model_name='intersection',
            name='joining_method',
            field=models.CharField(choices=[('butt_in', 'Butt-in'), ('45_cut', '45° Cut')], max_length=20),
        ),
        migrations.AlterField(
            model_name='intersection',
            name='wall_1',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='intersections_as_wall1', to='core.wall'),
        ),
        migrations.AlterField(
            model_name='intersection',
            name='wall_2',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='intersections_as_wall2', to='core.wall'),
        ),
    ]
