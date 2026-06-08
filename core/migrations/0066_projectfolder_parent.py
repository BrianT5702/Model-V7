from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0065_room_exclude_from_ceiling'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectfolder',
            name='parent',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='children',
                to='core.projectfolder',
            ),
        ),
    ]
