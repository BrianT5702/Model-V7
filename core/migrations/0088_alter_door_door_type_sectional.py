from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0087_foldersharelink'),
    ]

    operations = [
        migrations.AlterField(
            model_name='door',
            name='door_type',
            field=models.CharField(
                choices=[
                    ('swing', 'Swing Door'),
                    ('slide', 'Slide Door'),
                    ('dock', 'Dock Door'),
                    ('sectional', 'Sectional Door'),
                ],
                default='swing',
                help_text='Specify the type of door.',
                max_length=50,
            ),
        ),
    ]
