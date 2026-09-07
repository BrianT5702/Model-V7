from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0079_project_visible_to_salesmen'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectVersion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('number', models.PositiveIntegerField()),
                ('label', models.CharField(blank=True, default='', max_length=255)),
                ('snapshot', models.JSONField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'created_by',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='project_versions_created',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'project',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='versions',
                        to='core.project',
                    ),
                ),
            ],
            options={
                'ordering': ['-number', '-id'],
            },
        ),
        migrations.AddConstraint(
            model_name='projectversion',
            constraint=models.UniqueConstraint(
                fields=('project', 'number'),
                name='unique_project_version_number',
            ),
        ),
    ]
