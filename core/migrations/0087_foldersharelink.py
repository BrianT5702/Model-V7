from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0086_wall_tip_length'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectsharelink',
            name='folder',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='share_links',
                to='core.projectfolder',
            ),
        ),
        migrations.AlterField(
            model_name='projectsharelink',
            name='project',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='share_links',
                to='core.project',
            ),
        ),
        migrations.AddConstraint(
            model_name='projectsharelink',
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(project__isnull=False, folder__isnull=True)
                    | models.Q(project__isnull=True, folder__isnull=False)
                ),
                name='share_link_project_or_folder',
            ),
        ),
    ]
