from django.core.management.base import BaseCommand
from django.db.models import Q
from core.models import Intersection


class Command(BaseCommand):
    help = 'Clean up duplicate intersections where the same wall pair exists with swapped wall IDs'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be deleted without actually deleting',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN MODE - No deletions will be performed'))
        
        # Find all intersections
        all_intersections = Intersection.objects.all().order_by('project_id', 'id')
        
        processed_pairs = set()
        duplicates_to_delete = []
        
        for intersection in all_intersections:
            # Create a normalized pair key (sorted wall IDs to handle both orders)
            wall_ids = sorted([intersection.wall_1_id, intersection.wall_2_id])
            pair_key = (intersection.project_id, tuple(wall_ids))
            
            if pair_key in processed_pairs:
                # This is a duplicate
                duplicates_to_delete.append(intersection)
                self.stdout.write(
                    self.style.WARNING(
                        f'Found duplicate: Intersection {intersection.id} '
                        f'(project={intersection.project_id}, walls={intersection.wall_1_id}/{intersection.wall_2_id})'
                    )
                )
            else:
                # Check if there's another intersection with swapped walls
                existing = Intersection.objects.filter(
                    project=intersection.project
                ).filter(
                    (Q(wall_1_id=intersection.wall_2_id) & Q(wall_2_id=intersection.wall_1_id))
                ).exclude(id=intersection.id).first()
                
                if existing:
                    # Found a duplicate with swapped IDs - keep the first one, mark the second for deletion
                    duplicates_to_delete.append(existing)
                    self.stdout.write(
                        self.style.WARNING(
                            f'Found duplicate with swapped IDs: '
                            f'Keeping Intersection {intersection.id} (walls={intersection.wall_1_id}/{intersection.wall_2_id}), '
                            f'will delete Intersection {existing.id} (walls={existing.wall_1_id}/{existing.wall_2_id})'
                        )
                    )
                    # Mark this pair as processed so we don't process the duplicate again
                    processed_pairs.add(pair_key)
                else:
                    # First occurrence of this pair
                    processed_pairs.add(pair_key)
        
        if duplicates_to_delete:
            self.stdout.write(
                self.style.ERROR(f'\nFound {len(duplicates_to_delete)} duplicate intersection(s) to delete')
            )
            
            if dry_run:
                self.stdout.write(self.style.WARNING('DRY RUN: Would delete the following intersections:'))
                for dup in duplicates_to_delete:
                    self.stdout.write(f'  - Intersection {dup.id} (project={dup.project_id}, walls={dup.wall_1_id}/{dup.wall_2_id}, method={dup.joining_method})')
            else:
                # Delete duplicates
                deleted_count = 0
                for dup in duplicates_to_delete:
                    self.stdout.write(
                        f'Deleting Intersection {dup.id} (project={dup.project_id}, walls={dup.wall_1_id}/{dup.wall_2_id})'
                    )
                    dup.delete()
                    deleted_count += 1
                
                self.stdout.write(
                    self.style.SUCCESS(f'\nSuccessfully deleted {deleted_count} duplicate intersection(s)')
                )
        else:
            self.stdout.write(self.style.SUCCESS('No duplicate intersections found. Database is clean!'))


