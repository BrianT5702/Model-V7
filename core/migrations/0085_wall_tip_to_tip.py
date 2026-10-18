from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0084_door_label_offset'),
    ]

    operations = [
        migrations.AddField(
            model_name='wall',
            name='tip_to_tip',
            field=models.BooleanField(
                default=False,
                help_text='True when the drawn length is tip to tip. Saved corners sit one thickness inside each end.',
            ),
        ),
    ]
