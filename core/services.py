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

    @staticmethod
    def calculate_minimum_wall_height(wall_ids):
        """Calculate the minimum height among the given walls."""
        from .models import Wall
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"calculate_minimum_wall_height called with wall_ids: {wall_ids}")
        
        if not wall_ids:
            logger.warning("No wall_ids provided")
            return None
        
        # Convert wall_ids to integers to handle string IDs from frontend
        try:
            wall_ids = [int(wall_id) for wall_id in wall_ids]
            logger.info(f"Converted wall_ids to integers: {wall_ids}")
        except (ValueError, TypeError) as e:
            logger.error(f"Error converting wall_ids to integers: {e}")
            return None
            
        walls = Wall.objects.filter(id__in=wall_ids)
        logger.info(f"Found {walls.count()} walls")
        
        if not walls.exists():
            logger.warning("No walls found with provided IDs")
            return None
        
        min_height = min(wall.height for wall in walls)
        logger.info(f"Calculated minimum wall height: {min_height}")
        return min_height

    @staticmethod
    def update_wall_heights_for_room(wall_ids, new_height):
        """Update the height of all walls in a room to match the room height."""
        from .models import Wall
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"update_wall_heights_for_room called with wall_ids: {wall_ids}, new_height: {new_height}")
        
        if not wall_ids or new_height is None:
            logger.warning(f"Invalid parameters: wall_ids={wall_ids}, new_height={new_height}")
            return
            
        # Convert wall_ids to integers to handle string IDs from frontend
        try:
            wall_ids = [int(wall_id) for wall_id in wall_ids]
            logger.info(f"Converted wall_ids to integers: {wall_ids}")
        except (ValueError, TypeError) as e:
            logger.error(f"Error converting wall_ids to integers: {e}")
            return 0
            
        walls = Wall.objects.filter(id__in=wall_ids)
        logger.info(f"Found {walls.count()} walls to update")
        
        # Log current wall heights before update
        for wall in walls:
            logger.info(f"Wall {wall.id}: current height = {wall.height}")
        
        updated_count = walls.update(height=new_height)
        logger.info(f"Updated {updated_count} walls to height {new_height}")
        
        # Verify the update
        updated_walls = Wall.objects.filter(id__in=wall_ids)
        for wall in updated_walls:
            logger.info(f"Wall {wall.id}: new height = {wall.height}")
        
        return updated_count

    @staticmethod
    def create_room_with_height(room_data):
        """Create a room with automatic height calculation and wall height updates."""
        from .models import Room, Wall
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"create_room_with_height called with room_data: {room_data}")
        
        # Calculate minimum wall height if room height is not provided
        if not room_data.get('height') and room_data.get('walls'):
            min_height = RoomService.calculate_minimum_wall_height(room_data['walls'])
            logger.info(f"Calculated minimum wall height: {min_height}")
            if min_height:
                room_data['height'] = min_height
        
        # Create the room
        room = Room.objects.create(
            project_id=room_data['project'],
            room_name=room_data['room_name'],
            floor_type=room_data.get('floor_type', 'None'),
            floor_thickness=room_data.get('floor_thickness'),
            temperature=room_data.get('temperature'),
            height=room_data.get('height'),
            remarks=room_data.get('remarks', ''),
            room_points=room_data.get('room_points', [])
        )
        
        logger.info(f"Created room with ID: {room.id}, height: {room.height}")
        
        # Add walls to room and update their heights
        if room_data.get('walls') and room_data.get('height'):
            logger.info(f"Adding {len(room_data['walls'])} walls to room and updating heights")
            
            # Convert wall IDs to integers
            try:
                wall_ids = [int(wall_id) for wall_id in room_data['walls']]
                logger.info(f"Converted wall IDs: {wall_ids}")
            except (ValueError, TypeError) as e:
                logger.error(f"Error converting wall IDs: {e}")
                wall_ids = room_data['walls']
            
            walls = Wall.objects.filter(id__in=wall_ids)
            logger.info(f"Found {walls.count()} walls to add to room")
            
            # Add walls to room
            room.walls.set(walls)
            logger.info(f"Added walls to room {room.id}")
            
            # Update wall heights
            updated_count = RoomService.update_wall_heights_for_room(wall_ids, room_data['height'])
            logger.info(f"Updated {updated_count} walls for room {room.id}")
        
        return room

    @staticmethod
    def update_room_height(room_id, new_height):
        """Update room height and all associated wall heights."""
        from .models import Room
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"update_room_height called with room_id: {room_id}, new_height: {new_height}")
        
        try:
            room = Room.objects.get(id=room_id)
            logger.info(f"Found room: {room.room_name}, current height: {room.height}")
            
            room.height = new_height
            room.save()
            logger.info(f"Updated room height to: {room.height}")
            
            # Update all wall heights for this room
            wall_ids = list(room.walls.values_list('id', flat=True))
            logger.info(f"Found {len(wall_ids)} walls associated with room: {wall_ids}")
            
            updated_count = RoomService.update_wall_heights_for_room(wall_ids, new_height)
            logger.info(f"Updated {updated_count} walls for room {room_id}")
            
            return room
        except Room.DoesNotExist:
            logger.error(f"Room with ID {room_id} not found")
            raise ValueError('Room not found')

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