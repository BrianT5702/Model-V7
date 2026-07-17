from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0075_planannotation_box_size'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='panel_optimization',
            field=models.JSONField(
                blank=True,
                default=None,
                null=True,
                help_text=(
                    "Persisted best optimized wall panel result: "
                    "{fingerprint, wallOrder, score}. Lets a reopened project "
                    "reproduce the previously computed least-waste arrangement."
                ),
            ),
        ),
    ]
