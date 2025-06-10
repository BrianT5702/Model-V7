from django.db import transaction
from .models import Project, Wall, Room, Door, Intersection

class WallService:
    @staticmethod
    def create_default_walls(project):
        """Create default boundary walls for a project."""
        width = project.width
        length = project.length
        height = project.height
        thickness = project.wall_thickness

        walls = [
            {'project': project, 'start_x': 0, 'start_y': 0, 'end_x': width, 'end_y': 0, 'height': height, 'thickness': thickness},
            {'project': project, 'start_x': width, 'start_y': 0, 'end_x': width, 'end_y': length, 'height': height, 'thickness': thickness},
            {'project': project, 'start_x': width, 'start_y': length, 'end_x': 0, 'end_y': length, 'height': height, 'thickness': thickness},
            {'project': project, 'start_x': 0, 'start_y': length, 'end_x': 0, 'end_y': 0, 'height': height, 'thickness': thickness},
        ]

        return Wall.objects.bulk_create([Wall(**wall) for wall in walls])

    @staticmethod
    def split_wall(wall_id, intersection_x, intersection_y):
        """Split a wall at a specific intersection point."""
        with transaction.atomic():
            wall = Wall.objects.get(pk=wall_id)
            
            split_wall_1 = Wall.objects.create(
                project=wall.project,
                start_x=wall.start_x,
                start_y=wall.start_y,
                end_x=intersection_x,
                end_y=intersection_y,
                height=wall.height,
                thickness=wall.thickness,
                application_type=wall.application_type
            )
            
            split_wall_2 = Wall.objects.create(
                project=wall.project,
                start_x=intersection_x,
                start_y=intersection_y,
                end_x=wall.end_x,
                end_y=wall.end_y,
                height=wall.height,
                thickness=wall.thickness,
                application_type=wall.application_type
            )

            wall.delete()
            return split_wall_1, split_wall_2

    @staticmethod
    def merge_walls(wall_1, wall_2):
        """Merge two walls if they share endpoints and have matching properties."""
        if (
            wall_1.application_type != wall_2.application_type or
            wall_1.height != wall_2.height or
            wall_1.thickness != wall_2.thickness
        ):
            raise ValueError('Walls must have the same type, height, and thickness to merge.')

        # Check if walls share endpoints
        if wall_1.end_x == wall_2.start_x and wall_1.end_y == wall_2.start_y:
            # wall1's end connects to wall2's start
            new_start_x = wall_1.start_x
            new_start_y = wall_1.start_y
            new_end_x = wall_2.end_x
            new_end_y = wall_2.end_y
        elif wall_2.end_x == wall_1.start_x and wall_2.end_y == wall_1.start_y:
            # wall2's end connects to wall1's start
            new_start_x = wall_2.start_x
            new_start_y = wall_2.start_y
            new_end_x = wall_1.end_x
            new_end_y = wall_1.end_y
        else:
            raise ValueError('Walls do not share endpoints')

        # Create the merged wall
        merged_wall = Wall.objects.create(
            project=wall_1.project,
            start_x=new_start_x,
            start_y=new_start_y,
            end_x=new_end_x,
            end_y=new_end_y,
            height=wall_1.height,
            thickness=wall_1.thickness,
            application_type=wall_1.application_type
        )

        wall_1.delete()
        wall_2.delete()
        return merged_wall

class RoomService:
    @staticmethod
    def validate_room_points(room_points):
        """Validate that room points form a valid polygon."""
        if not room_points or len(room_points) < 3:
            raise ValueError('At least 3 points are required to define a room polygon.')
        return True

class DoorService:
    @staticmethod
    def validate_door_placement(door_data):
        """Validate door placement and properties."""
        required_fields = ['project', 'width', 'height', 'thickness', 'position_x', 'position_y']
        for field in required_fields:
            if field not in door_data:
                raise ValueError(f'{field} is required for door placement')

        # Validate wall link if provided
        wall_id = door_data.get('linked_wall')
        if wall_id:
            try:
                wall = Wall.objects.get(pk=wall_id)
                # Validate that the wall belongs to the same project
                if str(wall.project.id) != str(door_data['project']):
                    raise ValueError('Linked wall must belong to the same project')
            except Wall.DoesNotExist:
                raise ValueError('Linked wall not found')

    @staticmethod
    def create_door(door_data):
        """Create a door with proper validation and wall linking."""
        DoorService.validate_door_placement(door_data)
        
        # Get the linked wall if provided
        linked_wall = None
        if door_data.get('linked_wall'):
            linked_wall = Wall.objects.get(pk=door_data['linked_wall'])
        
        # Create the door with all necessary data
        door = Door.objects.create(
            project_id=door_data['project'],
            door_type=door_data.get('door_type', 'swing'),
            configuration=door_data.get('configuration', 'single_sided'),
            side=door_data.get('side', 'interior'),
            swing_direction=door_data.get('swing_direction'),
            slide_direction=door_data.get('slide_direction'),
            width=door_data['width'],
            height=door_data['height'],
            thickness=door_data['thickness'],
            position_x=door_data['position_x'],
            position_y=door_data['position_y'],
            orientation=door_data.get('orientation', 'horizontal'),
            linked_wall=linked_wall
        )
        
        return door 