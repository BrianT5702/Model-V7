# Generated by Django 5.1.4 on 2025-02-06 07:40

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0008_wall_application_type_alter_room_floor_thickness_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='room',
            name='floor_thickness',
            field=models.IntegerField(choices=[(50, '50 mm'), (75, '75 mm'), (100, '100 mm'), (125, '125 mm'), (150, '150 mm'), (175, '175 mm'), (200, '200 mm')], help_text='Floor thickness in mm (select from predefined values).'),
        ),
        migrations.AlterField(
            model_name='room',
            name='floor_type',
            field=models.CharField(choices=[('Slab', 'Slab'), ('Panel', 'Panel'), ('None', 'None')], default='none', help_text='Specify the type of floor for the room.', max_length=50),
        ),
        migrations.AlterUniqueTogether(
            name='room',
            unique_together={('project', 'room_name')},
        ),
    ]
