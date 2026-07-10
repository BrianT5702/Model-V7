from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0074_projectcomment_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='planannotation',
            name='box_width_mm',
            field=models.FloatField(
                blank=True,
                help_text='Text box width in model mm; null uses client default.',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='planannotation',
            name='box_height_mm',
            field=models.FloatField(
                blank=True,
                help_text='Text box height in model mm; null uses client default.',
                null=True,
            ),
        ),
    ]
