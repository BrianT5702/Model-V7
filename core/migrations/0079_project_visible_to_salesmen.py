from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('core', '0078_intersection_deduct_joining_thickness'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='visible_to_salesmen',
            field=models.ManyToManyField(
                blank=True,
                help_text='Salesman accounts that can see this project. Admin and drafter always see all.',
                related_name='visible_projects',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
