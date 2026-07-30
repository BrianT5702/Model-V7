from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0077_projectsharelink'),
    ]

    operations = [
        migrations.AddField(
            model_name='intersection',
            name='deduct_joining_thickness',
            field=models.BooleanField(
                default=False,
                help_text='When True and joining_method is butt_in, shorten wall_1 by the joining (wall_2) thickness.',
            ),
        ),
    ]
