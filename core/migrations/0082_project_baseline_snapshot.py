from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0081_project_hidden_from_list'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='baseline_snapshot',
            field=models.JSONField(
                blank=True,
                default=None,
                help_text='Frozen original layout. Save version stores the current drawing, then reverts the live project to this snapshot.',
                null=True,
            ),
        ),
    ]
