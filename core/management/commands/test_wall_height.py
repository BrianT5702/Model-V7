from django.core.management.base import BaseCommand
from core.models import Project, Wall
from core.services import RoomService


class Command(BaseCommand):
    help = 'Test wall height update functionality'

    def handle(self, *args, **options):
        self.stdout.write("Testing wall height update functionality...")
        
        # Create a test project
        project = Project.objects.create(
            name="Test Project",
            width=1000,
            length=1000,
            height=3000,
            wall_thickness=200
        )
        self.stdout.write(f"Created test project: {project.name}")
        
        # Create some test walls with different heights
        wall1 = Wall.objects.create(
            project=project,
            start_x=0,
            start_y=0,
            end_x=1000,
            end_y=0,
            height=2500,
            thickness=200
        )
        
        wall2 = Wall.objects.create(
            project=project,
            start_x=1000,
            start_y=0,
            end_x=1000,
            end_y=1000,
            height=3000,
            thickness=200
        )
        
        wall3 = Wall.objects.create(
            project=project,
            start_x=1000,
            start_y=1000,
            end_x=0,
            end_y=1000,
            height=2800,
            thickness=200
        )
        
        self.stdout.write(f"Created walls with heights: {wall1.height}, {wall2.height}, {wall3.height}")
        
        # Test minimum height calculation
        wall_ids = [wall1.id, wall2.id, wall3.id]
        min_height = RoomService.calculate_minimum_wall_height(wall_ids)
        self.stdout.write(f"Minimum wall height: {min_height}")
        
        # Test wall height update
        new_height = 3500
        updated_count = RoomService.update_wall_heights_for_room(wall_ids, new_height)
        self.stdout.write(f"Updated {updated_count} walls to height {new_height}")
        
        # Verify the update
        for wall in Wall.objects.filter(id__in=wall_ids):
            self.stdout.write(f"Wall {wall.id}: height = {wall.height}")
        
        # Test room creation with height
        room_data = {
            'project': project.id,
            'room_name': 'Test Room',
            'floor_type': 'Slab',
            'floor_thickness': 100,
            'temperature': 22.0,
            'height': 4000,
            'remarks': 'Test room',
            'walls': wall_ids,
            'room_points': [{'x': 0, 'y': 0}, {'x': 1000, 'y': 0}, {'x': 1000, 'y': 1000}, {'x': 0, 'y': 1000}]
        }
        
        room = RoomService.create_room_with_height(room_data)
        self.stdout.write(f"Created room: {room.room_name} with height: {room.height}")
        
        # Check wall heights after room creation
        for wall in room.walls.all():
            self.stdout.write(f"Room wall {wall.id}: height = {wall.height}")
        
        # Clean up
        project.delete()
        self.stdout.write("Test completed and cleaned up.") 