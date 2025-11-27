# Generated manually to fix database schema mismatch

from django.db import migrations


def remove_base_elevation_from_wall(apps, schema_editor):
    """Remove base_elevation_mm column from core_wall table if it exists"""
    from django.db import connection
    with connection.cursor() as cursor:
        # Check if column exists
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='core_wall' AND column_name='base_elevation_mm';
        """)
        if cursor.fetchone():
            # Column exists, drop it
            cursor.execute("ALTER TABLE core_wall DROP COLUMN IF EXISTS base_elevation_mm;")
            print("Removed base_elevation_mm column from core_wall table")
        else:
            print("base_elevation_mm column does not exist in core_wall table")


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0047_add_floor_layers'),
    ]

    operations = [
        migrations.RunPython(remove_base_elevation_from_wall, migrations.RunPython.noop),
    ]

