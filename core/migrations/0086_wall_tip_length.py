from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0085_wall_tip_to_tip'),
    ]

    operations = [
        migrations.AddField(
            model_name='wall',
            name='tip_length',
            field=models.FloatField(
                blank=True,
                null=True,
                help_text='Tip-to-tip length in mm, fixed when the wall is drawn. Later joins do not change this number.',
            ),
        ),
    ]
