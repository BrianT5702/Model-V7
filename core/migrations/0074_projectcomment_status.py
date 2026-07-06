from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0073_plan_annotations'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectcomment',
            name='status',
            field=models.CharField(
                choices=[('open', 'Open'), ('done', 'Done')],
                default='open',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='projectcomment',
            name='resolved_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='projectcomment',
            name='resolved_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='resolved_project_comments',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
