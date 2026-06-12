from django.conf import settings
from django.db import migrations, models
import django.contrib.postgres.fields
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0069_clear_staff_for_non_admin_roles'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField()),
                ('wall_ids', django.contrib.postgres.fields.ArrayField(
                    base_field=models.IntegerField(),
                    blank=True,
                    default=list,
                    help_text='Wall IDs referenced by this comment.',
                    size=None,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('author', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='project_comments',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('project', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comments',
                    to='core.project',
                )),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.CreateModel(
            name='ProjectCommentReadStatus',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('last_read_at', models.DateTimeField()),
                ('project', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comment_read_statuses',
                    to='core.project',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comment_read_statuses',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('user', 'project')},
            },
        ),
    ]
