from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0082_project_baseline_snapshot'),
    ]

    operations = [
        migrations.AddField(
            model_name='wall',
            name='side_panel_length',
            field=models.FloatField(
                blank=True,
                help_text='Drafter-set length (mm) of one end panel. Empty uses the automatic split (half the remainder, or the whole remainder on one end).',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='wall',
            name='side_panel_end',
            field=models.CharField(
                choices=[('start', 'Start'), ('end', 'End')],
                default='start',
                help_text='Which wall end side_panel_length applies to. The other end is calculated.',
                max_length=10,
            ),
        ),
    ]
