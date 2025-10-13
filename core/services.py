from django.db import transaction
from .models import Wall, Room, Door
from django.utils import timezone
import logging
import time

logger = logging.getLogger(__name__)


class LeftoverTracker:
    """
    Tracks leftover panels from cutting operations for reuse in ceiling and floor plans.
    Similar to the wall panel leftover tracking system.
    """
    def __init__(self, context='ACTUAL'):
        """
        Args:
            context: 'ACTUAL' for real generation, 'ANALYSIS' for strategy evaluation
        """
        self.leftovers = []  # Array to store leftover panels
        self.context = context  # Track whether this is for actual generation or just analysis
        self.stats = {
            'leftovers_created': 0,
            'leftovers_reused': 0,
            'full_panels_saved': 0,
            'total_leftover_area': 0.0
        }
    
    def add_leftover(self, length, thickness, width_remaining):
        """
        Add a leftover panel to the tracker.
        
        Args:
            length: Panel length in mm (e.g., 5000mm)
            thickness: Panel thickness in mm (e.g., 150mm)
            width_remaining: Remaining width after cut in mm (e.g., 550mm from 1150mm)
        """
        if width_remaining > 0:
            leftover = {
                'id': f"{int(time.time() * 1000)}_{len(self.leftovers)}",
                'length': length,
                'thickness': thickness,
                'width': width_remaining,
                'created_at': time.time()
            }
            self.leftovers.append(leftover)
            self.stats['leftovers_created'] += 1
            self.stats['total_leftover_area'] += length * width_remaining
            
            # Log with context prefix
            prefix = f"[{self.context}]" if self.context != 'ACTUAL' else "[GENERATION]"
            logger.info(f"{prefix} Leftover created: {width_remaining}mm × {length}mm (thickness: {thickness}mm)")
    
    def find_compatible_leftover(self, needed_width, needed_length, needed_thickness):
        """
        Find a compatible leftover panel that can be used.
        
        Args:
            needed_width: Required panel width in mm
            needed_length: Required panel length in mm
            needed_thickness: Required panel thickness in mm
            
        Returns:
            Compatible leftover dict or None
        """
        for leftover in self.leftovers:
            # Check if leftover matches requirements
            # Allow leftover length >= needed length (we can cut longer panels to shorter length)
            if (leftover['length'] >= needed_length and 
                leftover['thickness'] == needed_thickness and 
                leftover['width'] >= needed_width):
                
                prefix = f"[{self.context}]" if self.context != 'ACTUAL' else "[GENERATION]"
                logger.info(f"{prefix} Compatible leftover found: {leftover['width']}mm × {leftover['length']}mm "
                           f"(needed: {needed_width}mm × {needed_length}mm)")
                return leftover
        
        return None
    
    def use_leftover(self, leftover, width_used):
        """
        Use part of a leftover panel and update its remaining width.
        
        Args:
            leftover: The leftover dict to use
            width_used: Width being used from the leftover in mm
        """
        remaining_width = leftover['width'] - width_used
        
        prefix = f"[{self.context}]" if self.context != 'ACTUAL' else "[GENERATION]"
        logger.info(f"{prefix} Using leftover {leftover['id']}: {width_used}mm from {leftover['width']}mm, "
                   f"remaining: {remaining_width}mm")
        
        if remaining_width > 0:
            # Update leftover width
            leftover['width'] = remaining_width
        else:
            # Leftover fully used, remove it
            self.leftovers.remove(leftover)
            prefix = f"[{self.context}]" if self.context != 'ACTUAL' else "[GENERATION]"
            logger.info(f"{prefix} Leftover {leftover['id']} fully consumed")
        
        self.stats['leftovers_reused'] += 1
        self.stats['full_panels_saved'] += 1  # Each leftover use saves a full panel cut
    
    def cleanup_leftovers(self):
        """Remove leftovers with zero or negative width."""
        before_count = len(self.leftovers)
        self.leftovers = [lo for lo in self.leftovers if lo['width'] > 0]
        after_count = len(self.leftovers)
        
        if before_count != after_count:
            logger.info(f"Cleaned up {before_count - after_count} exhausted leftovers")
    
    def get_stats(self):
        """Get statistics about leftover usage."""
        return {
            **self.stats,
            'current_leftovers_count': len(self.leftovers),
            'current_leftovers': self.leftovers.copy()
        }
    
    def reset(self):
        """Reset the tracker for a new calculation."""
        self.leftovers = []
        self.stats = {
            'leftovers_created': 0,
            'leftovers_reused': 0,
            'full_panels_saved': 0,
            'total_leftover_area': 0.0
        }


def normalize_wall_coordinates(start_x, start_y, end_x, end_y):
    """
    Normalize wall coordinates to ensure:
    - Horizontal walls are created from left to right (start_x < end_x)
    - Vertical walls are created from top to bottom (start_y < end_y)
    """
    dx = end_x - start_x
    dy = end_y - start_y
    
    # Determine if wall is horizontal or vertical
    is_horizontal = abs(dy) < abs(dx)
    
    if is_horizontal:
        # For horizontal walls, ensure start_x < end_x (left to right)
        if start_x > end_x:
            return end_x, end_y, start_x, start_y
    else:
        # For vertical walls, ensure start_y < end_y (top to bottom)
        if start_y > end_y:
            return end_x, end_y, start_x, start_y
    
    # No change needed
    return start_x, start_y, end_x, end_y

class WallService:
    @staticmethod
    def create_default_walls(project):
        """Create default boundary walls for a project."""
        width = project.width
        length = project.length
        height = project.height
        thickness = project.wall_thickness

        # Define wall coordinates and normalize them
        wall_coords = [
            (0, 0, width, 0),  # Bottom wall
            (width, 0, width, length),  # Right wall
            (width, length, 0, length),  # Top wall
            (0, length, 0, 0),  # Left wall
        ]
        
        walls = []
        for start_x, start_y, end_x, end_y in wall_coords:
            # Normalize coordinates
            norm_start_x, norm_start_y, norm_end_x, norm_end_y = normalize_wall_coordinates(start_x, start_y, end_x, end_y)
            walls.append({
                'project': project, 
                'start_x': norm_start_x, 
                'start_y': norm_start_y, 
                'end_x': norm_end_x, 
                'end_y': norm_end_y, 
                'height': height, 
                'thickness': thickness
            })

        return Wall.objects.bulk_create([Wall(**wall) for wall in walls])

    @staticmethod
    def split_wall(wall_id, intersection_x, intersection_y):
        """Split a wall at a specific intersection point."""
        with transaction.atomic():
            wall = Wall.objects.get(pk=wall_id)
            
            # Normalize first segment
            norm_start_x1, norm_start_y1, norm_end_x1, norm_end_y1 = normalize_wall_coordinates(
                wall.start_x, wall.start_y, intersection_x, intersection_y
            )
            split_wall_1 = Wall.objects.create(
                project=wall.project,
                start_x=norm_start_x1,
                start_y=norm_start_y1,
                end_x=norm_end_x1,
                end_y=norm_end_y1,
                height=wall.height,
                thickness=wall.thickness,
                application_type=wall.application_type
            )
            
            # Normalize second segment
            norm_start_x2, norm_start_y2, norm_end_x2, norm_end_y2 = normalize_wall_coordinates(
                intersection_x, intersection_y, wall.end_x, wall.end_y
            )
            split_wall_2 = Wall.objects.create(
                project=wall.project,
                start_x=norm_start_x2,
                start_y=norm_start_y2,
                end_x=norm_end_x2,
                end_y=norm_end_y2,
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

        # Normalize the merged wall coordinates
        norm_start_x, norm_start_y, norm_end_x, norm_end_y = normalize_wall_coordinates(
            new_start_x, new_start_y, new_end_x, new_end_y
        )
        
        # Create the merged wall
        merged_wall = Wall.objects.create(
            project=wall_1.project,
            start_x=norm_start_x,
            start_y=norm_start_y,
            end_x=norm_end_x,
            end_y=norm_end_y,
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
    def recalculate_room_boundary_from_walls(room_id):
        """Recalculate room boundary points from the current walls.
        This ensures room_points are always in sync with the actual wall positions.
        IMPORTANT: This function preserves the original polygon point order to maintain
        proper clockwise/counterclockwise arrangement."""
        from .models import Room
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"Recalculating room boundary for room {room_id}")
        
        try:
            room = Room.objects.get(id=room_id)
            walls = room.walls.all()
            
            if not walls.exists():
                logger.warning(f"No walls found for room {room_id}")
                return False
            
            # Get the original room_points to preserve order
            original_points = room.room_points if room.room_points else []
            
            # Collect all unique endpoints from walls
            endpoints = set()
            for wall in walls:
                endpoints.add((wall.start_x, wall.start_y))
                endpoints.add((wall.end_x, wall.end_y))
            
            # Convert to list
            current_endpoints = list(endpoints)
            
            # If we have original points, try to match them to current endpoints
            # This preserves the polygon order while updating coordinates
            if original_points and len(original_points) == len(current_endpoints):
                # Create a mapping from original points to current endpoints
                # We'll find the closest matching endpoint for each original point
                from math import sqrt
                
                def distance(p1, p2):
                    return sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)
                
                # For each original point, find the closest current endpoint
                new_room_points = []
                used_endpoints = set()
                
                for orig_point in original_points:
                    orig_coords = (orig_point['x'], orig_point['y'])
                    closest_endpoint = None
                    min_distance = float('inf')
                    
                    for endpoint in current_endpoints:
                        if endpoint not in used_endpoints:
                            dist = distance(orig_coords, endpoint)
                            if dist < min_distance:
                                min_distance = dist
                                closest_endpoint = endpoint
                    
                    if closest_endpoint:
                        new_room_points.append({'x': closest_endpoint[0], 'y': closest_endpoint[1]})
                        used_endpoints.add(closest_endpoint)
                    else:
                        # Fallback: use original point if no match found
                        new_room_points.append(orig_point)
                
                room_points = new_room_points
            else:
                # Fallback: if no original points or count mismatch, preserve order as much as possible
                # Sort by angle from center to maintain some semblance of order
                if current_endpoints:
                    center_x = sum(p[0] for p in current_endpoints) / len(current_endpoints)
                    center_y = sum(p[1] for p in current_endpoints) / len(current_endpoints)
                    
                    def angle_from_center(point):
                        import math
                        return math.atan2(point[1] - center_y, point[0] - center_x)
                    
                    # Sort by angle to maintain clockwise/counterclockwise order
                    current_endpoints.sort(key=angle_from_center)
                    room_points = [{'x': x, 'y': y} for x, y in current_endpoints]
                else:
                    room_points = []
            
            # Update the room's room_points
            room.room_points = room_points
            room.save()
            
            logger.info(f"Updated room {room_id} boundary with {len(room_points)} points (order preserved)")
            return True
            
        except Room.DoesNotExist:
            logger.error(f"Room {room_id} not found")
            return False
        except Exception as e:
            logger.error(f"Error recalculating room boundary: {str(e)}")
            return False

    @staticmethod
    def recalculate_all_room_boundaries(project_id):
        """Recalculate room boundaries for all rooms in a project.
        This is useful after bulk wall updates or when debugging room boundary issues."""
        from .models import Room
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"Recalculating room boundaries for all rooms in project {project_id}")
        
        try:
            rooms = Room.objects.filter(project_id=project_id)
            updated_count = 0
            
            for room in rooms:
                if RoomService.recalculate_room_boundary_from_walls(room.id):
                    updated_count += 1
            
            logger.info(f"Successfully updated {updated_count} out of {rooms.count()} rooms")
            return updated_count
            
        except Exception as e:
            logger.error(f"Error recalculating room boundaries for project {project_id}: {str(e)}")
            return 0

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

class FloorService:
    """Service class for floor plan generation and management"""
    
    @staticmethod
    def analyze_floor_orientation_strategies(project_id, panel_width=1150, panel_length='auto'):
        """Analyze different orientation strategies for floor panels (excluding walls)"""
        try:
            from .models import Project, Room
            
            # Get project and rooms
            project = Project.objects.get(id=project_id)
            rooms = Room.objects.filter(project=project)
            
            if not rooms.exists():
                return {'error': 'No rooms found for this project'}
            
            strategies = []
            total_project_waste = 0
            total_project_panels = 0
            
            for room in rooms:
                if not room.room_points or len(room.room_points) < 3:
                    continue
                
                # Check floor type - only analyze panel floors
                if not hasattr(room, 'floor_type') or room.floor_type not in ['panel', 'Panel']:
                    continue
                
                # Calculate floor area (excluding walls)
                floor_area = FloorService._calculate_room_floor_area(room, project.wall_thickness)
                if floor_area <= 0:
                    continue
                
                # Analyze different orientations for this room
                room_strategies = FloorService._analyze_room_floor_orientations(
                    room, panel_width, panel_length
                )
                
                # Add room info to strategies
                for strategy in room_strategies:
                    strategy['room_id'] = room.id
                    strategy['room_name'] = room.room_name
                    strategy['floor_area'] = floor_area
                
                strategies.extend(room_strategies)
                
                # Accumulate project totals
                best_strategy = min(room_strategies, key=lambda x: x['total_waste_percentage'])
                total_project_waste += best_strategy['total_waste_percentage']
                total_project_panels += best_strategy['total_panels']
            
            if not strategies:
                return {'error': 'No valid floor strategies found'}
            
            # Determine recommended strategy
            recommended_strategy = min(strategies, key=lambda x: x['total_waste_percentage'])
            
            return {
                'strategies': strategies,
                'recommended_strategy': recommended_strategy['strategy_name'],
                'total_project_waste': total_project_waste / len(rooms) if rooms else 0,
                'total_project_panels': total_project_panels
            }
            
        except Project.DoesNotExist:
            return {'error': 'Project not found'}
        except Exception as e:
            return {'error': f'Error analyzing floor orientations: {str(e)}'}
    
    @staticmethod
    def _calculate_room_floor_area(room, wall_thickness):
        """Calculate floor area excluding walls"""
        if not room.room_points or len(room.room_points) < 3:
            return 0.0
        
        points = room.room_points
        n = len(points)
        
        # Calculate room area
        area = 0.0
        for i in range(n):
            j = (i + 1) % n
            area += points[i]['x'] * points[j]['y']
            area -= points[j]['x'] * points[i]['y']
        
        room_area = abs(area) / 2.0
        
        # Calculate perimeter
        perimeter = 0.0
        for i in range(n):
            j = (i + 1) % n
            dx = points[j]['x'] - points[i]['x']
            dy = points[j]['y'] - points[i]['y']
            perimeter += (dx * dx + dy * dy) ** 0.5
        
        # Wall area = perimeter * wall_thickness
        wall_area = perimeter * wall_thickness
        
        # Floor area = room area - wall area
        floor_area = room_area - wall_area
        
        return max(0, floor_area)
    
    @staticmethod
    def _analyze_room_floor_orientations(room, panel_width, panel_length):
        """Analyze different orientations for a single room's floor"""
        strategies = []
        
        # Get room bounding box (excluding walls)
        bounding_box = FloorService._calculate_room_floor_bounding_box(room)
        if not bounding_box:
            return strategies
        
        # Strategy 1: All Horizontal (with leftover tracking for analysis)
        horizontal_tracker = LeftoverTracker(context='ANALYSIS-H')  # Mark as analysis
        floor_thickness = float(room.floor_thickness) if hasattr(room, 'floor_thickness') and room.floor_thickness else 20.0
        horizontal_panels = FloorService._generate_floor_panels(
            bounding_box, room.room_points, 'horizontal', panel_width, panel_length, room.project.wall_thickness, horizontal_tracker, floor_thickness
        )
        horizontal_waste = FloorService._calculate_floor_waste(horizontal_panels, room, room.project.wall_thickness, horizontal_tracker)
        horizontal_stats = horizontal_tracker.get_stats()
        
        strategies.append({
            'strategy_name': 'all_horizontal',
            'orientation_type': 'horizontal',
            'total_panels': len(horizontal_panels),
            'total_waste_percentage': horizontal_waste,
            'panels': horizontal_panels,
            'leftover_stats': horizontal_stats
        })
        
        # Strategy 2: All Vertical (with leftover tracking for analysis)
        vertical_tracker = LeftoverTracker(context='ANALYSIS-V')  # Mark as analysis
        vertical_panels = FloorService._generate_floor_panels(
            bounding_box, room.room_points, 'vertical', panel_width, panel_length, room.project.wall_thickness, vertical_tracker, floor_thickness
        )
        vertical_waste = FloorService._calculate_floor_waste(vertical_panels, room, room.project.wall_thickness, vertical_tracker)
        vertical_stats = vertical_tracker.get_stats()
        
        strategies.append({
            'strategy_name': 'all_vertical',
            'orientation_type': 'vertical',
            'total_panels': len(vertical_panels),
            'total_waste_percentage': vertical_waste,
            'panels': vertical_panels,
            'leftover_stats': vertical_stats
        })
        
        # Strategy 3: Mixed (best of both) with leftover tracking for analysis
        mixed_tracker = LeftoverTracker(context='ANALYSIS-M')  # Mark as analysis
        mixed_panels = FloorService._generate_mixed_floor_panels(
            bounding_box, room.room_points, panel_width, panel_length, room.project.wall_thickness, mixed_tracker, floor_thickness
        )
        mixed_waste = FloorService._calculate_floor_waste(mixed_panels, room, room.project.wall_thickness, mixed_tracker)
        mixed_stats = mixed_tracker.get_stats()
        
        strategies.append({
            'strategy_name': 'mixed_optimal',
            'orientation_type': 'mixed',
            'total_panels': len(mixed_panels),
            'total_waste_percentage': mixed_waste,
            'panels': mixed_panels,
            'leftover_stats': mixed_stats
        })
        
        return strategies
    
    @staticmethod
    def _calculate_room_floor_bounding_box(room):
        """Calculate bounding box for floor area (excluding walls)"""
        if not room.room_points or len(room.room_points) < 3:
            return None
        
        # Get wall thickness
        wall_thickness = room.project.wall_thickness if room.project else 200
        
        # Calculate inner bounding box by reducing room dimensions by wall thickness
        points = room.room_points
        min_x = min(p['x'] for p in points) + wall_thickness
        max_x = max(p['x'] for p in points) - wall_thickness
        min_y = min(p['y'] for p in points) + wall_thickness
        max_y = max(p['y'] for p in points) - wall_thickness
        
        # Ensure valid dimensions
        if min_x >= max_x or min_y >= max_y:
            return None
        
        bounding_box = {
            'min_x': min_x,
            'max_x': max_x,
            'min_y': min_y,
            'max_y': max_y,
            'width': max_x - min_x,
            'height': max_y - min_y
        }
        
        # Add room point count information
        bounding_box['point_count'] = len(room.room_points)
        
        return bounding_box
    
    @staticmethod
    def _generate_floor_panels(bounding_box, room_points, orientation, panel_width, panel_length, wall_thickness, leftover_tracker=None, floor_thickness=20.0):
        """Generate floor panels for a specific orientation (excluding wall areas) with leftover tracking"""
        panels = []
        
        # Use the same approach as ceiling plan: shape-aware panel generation
        # This properly handles L-shaped rooms by splitting them into rectangular regions
       
        # Check if room is L-shaped and split into regions if needed
        if len(room_points) > 4:
            return FloorService._generate_shape_aware_floor_panels(
                bounding_box, room_points, orientation, panel_width, panel_length, wall_thickness, leftover_tracker, floor_thickness
            )
        else:
            return FloorService._generate_standard_floor_panels(
                bounding_box, room_points, orientation, panel_width, panel_length, wall_thickness, leftover_tracker, floor_thickness
            )
    
    @staticmethod
    def _generate_standard_floor_panels(bounding_box, room_points, orientation, panel_width, panel_length, wall_thickness, leftover_tracker=None, floor_thickness=20.0):
        """Generate standard floor panels for rectangular rooms with leftover tracking"""
        panels = []
        MAX_PANEL_WIDTH = 1150  # Standard maximum panel width in mm
        # Use actual floor thickness from room, not hardcoded value
        PANEL_THICKNESS = floor_thickness
        
        if orientation == 'horizontal':
            # Generate horizontal panels with 1150mm width constraint
            # For horizontal: panels are placed horizontally, width constraint applies to room height
            panel_id = 1
            
            # Calculate panel length (room width for horizontal orientation)
            panel_length_actual = panel_length if panel_length != 'auto' else (bounding_box['max_x'] - bounding_box['min_x'])
            panel_length_actual = min(panel_length_actual, bounding_box['max_x'] - bounding_box['min_x'])
            
            # Use nested loops to fill the entire area (like ceiling plan)
            current_x = bounding_box['min_x']
            
            while current_x < bounding_box['max_x']:
                current_panel_width = min(panel_length_actual, bounding_box['max_x'] - current_x)
                current_y = bounding_box['min_y']
                
                # Create panels for this column
                while current_y < bounding_box['max_y']:
                    panel_height = min(panel_width, bounding_box['max_y'] - current_y)
                    
                    if panel_height > 0 and current_panel_width > 0:
                        # Check if this panel will be a cut panel (like ceiling plan logic)
                        is_cut = False
                        cut_notes = ""
                        from_leftover = False
                        
                        # LEFTOVER TRACKING: Check if we need a cut panel
                        if panel_height < MAX_PANEL_WIDTH:
                            # This panel needs to be cut
                            if leftover_tracker:
                                # Try to find a compatible leftover
                                compatible_leftover = leftover_tracker.find_compatible_leftover(
                                    needed_width=panel_height,
                                    needed_length=current_panel_width,
                                    needed_thickness=PANEL_THICKNESS
                                )
                                
                                if compatible_leftover:
                                    # Use the leftover
                                    leftover_tracker.use_leftover(compatible_leftover, panel_height)
                                    is_cut = True
                                    cut_notes = f"From leftover {compatible_leftover['id']}"
                                    from_leftover = True
                                else:
                                    # No leftover available, cut from full panel
                                    is_cut = True
                                    cut_notes = "Cut from full panel"
                                    
                                    # Create leftover from the cut
                                    leftover_width = MAX_PANEL_WIDTH - panel_height
                                    if leftover_width > 0:
                                        leftover_tracker.add_leftover(
                                            length=current_panel_width,
                                            thickness=PANEL_THICKNESS,
                                            width_remaining=leftover_width
                                        )
                            else:
                                # No tracker, just mark as cut
                                is_cut = True
                                cut_notes = "Non-standard size"
                        
                        # Additional cut checks
                        if (current_x + current_panel_width > bounding_box['max_x'] or 
                            current_y + panel_height > bounding_box['max_y']):
                            is_cut = True
                            if cut_notes:
                                cut_notes += ", Boundary extension"
                            else:
                                cut_notes = "Boundary extension"
                        
                        # Create panel
                        panel = {
                            'panel_id': f'FP_{panel_id:03d}',
                            'start_x': current_x,
                            'start_y': current_y,
                            'end_x': current_x + current_panel_width,
                            'end_y': current_y + panel_height,
                            'width': current_panel_width,
                            'length': panel_height,
                            'is_cut': is_cut,
                            'cut_notes': cut_notes,
                            'from_leftover': from_leftover
                        }
                        
                        panels.append(panel)
                        panel_id += 1
                    
                    current_y += panel_height
                
                current_x += panel_length_actual
                
        elif orientation == 'vertical':
            # Generate vertical panels with 1150mm width constraint
            # For vertical orientation: panels are placed vertically, width constraint applies to room width
            panel_id = 1
            
            # Calculate panel length (height for vertical orientation)
            panel_length_actual = panel_length if panel_length != 'auto' else (bounding_box['max_y'] - bounding_box['min_y'])
            panel_length_actual = min(panel_length_actual, bounding_box['max_y'] - bounding_box['min_y'])
            
            # Use nested loops to fill the entire area (like ceiling plan)
            current_y = bounding_box['min_y']
            
            while current_y < bounding_box['max_y']:
                current_panel_height = min(panel_length_actual, bounding_box['max_y'] - current_y)
                current_x = bounding_box['min_x']
                
                # Create panels for this row
                while current_x < bounding_box['max_x']:
                    panel_width_actual = min(panel_width, bounding_box['max_x'] - current_x)
                    
                    if panel_width_actual > 0 and current_panel_height > 0:
                        # Check if this panel will be a cut panel (like ceiling plan logic)
                        is_cut = False
                        cut_notes = ""
                        from_leftover = False
                        
                        # LEFTOVER TRACKING: Check if we need a cut panel
                        if panel_width_actual < MAX_PANEL_WIDTH:
                            # This panel needs to be cut
                            if leftover_tracker:
                                # Try to find a compatible leftover
                                compatible_leftover = leftover_tracker.find_compatible_leftover(
                                    needed_width=panel_width_actual,
                                    needed_length=current_panel_height,
                                    needed_thickness=PANEL_THICKNESS
                                )
                                
                                if compatible_leftover:
                                    # Use the leftover
                                    leftover_tracker.use_leftover(compatible_leftover, panel_width_actual)
                                    is_cut = True
                                    cut_notes = f"From leftover {compatible_leftover['id']}"
                                    from_leftover = True
                                else:
                                    # No leftover available, cut from full panel
                                    is_cut = True
                                    cut_notes = "Cut from full panel"
                                    
                                    # Create leftover from the cut
                                    leftover_width = MAX_PANEL_WIDTH - panel_width_actual
                                    if leftover_width > 0:
                                        leftover_tracker.add_leftover(
                                            length=current_panel_height,
                                            thickness=PANEL_THICKNESS,
                                            width_remaining=leftover_width
                                        )
                            else:
                                # No tracker, just mark as cut
                                is_cut = True
                                cut_notes = "Non-standard size"
                        
                        # Additional cut checks
                        if (current_x + panel_width_actual > bounding_box['max_x'] or 
                            current_y + current_panel_height > bounding_box['max_y']):
                            is_cut = True
                            if cut_notes:
                                cut_notes += ", Boundary extension"
                            else:
                                cut_notes = "Boundary extension"
                        
                        # Create panel
                        panel = {
                            'panel_id': f'FP_{panel_id:03d}',
                            'start_x': current_x,
                            'start_y': current_y,
                            'end_x': current_x + panel_width_actual,
                            'end_y': current_y + current_panel_height,
                            'width': panel_width_actual,
                            'length': current_panel_height,
                            'is_cut': is_cut,
                            'cut_notes': cut_notes,
                            'from_leftover': from_leftover
                        }
                        
                        panels.append(panel)
                        panel_id += 1
                    
                    current_x += panel_width_actual
                
                current_y += current_panel_height
        return panels
    
    @staticmethod
    def _generate_shape_aware_floor_panels(bounding_box, room_points, orientation, panel_width, panel_length, wall_thickness, leftover_tracker=None, floor_thickness=20.0):
        """Generate shape-aware floor panels for L-shaped or complex rooms (like ceiling plan does) with leftover tracking"""
        try:
            panels = []
            panel_id = 1
            
            # Analyze room shape to identify distinct rectangular regions
            room_regions = FloorService._analyze_floor_room_shape(room_points, bounding_box, orientation)
            
            if not room_regions:
                # Fallback to standard approach if shape analysis fails
                return FloorService._generate_standard_floor_panels(
                    bounding_box, room_points, orientation, panel_width, panel_length, wall_thickness, leftover_tracker, floor_thickness
                )
            
            # Generate panels for each region based on orientation
            for i, region in enumerate(room_regions):
                region_panels = FloorService._generate_panels_for_floor_region(
                    region, orientation, panel_width, panel_id, panel_length
                )
                
                panels.extend(region_panels)
                panel_id += len(region_panels)
            
            return panels
            
        except Exception as e:
            # Fallback to standard approach
            return FloorService._generate_standard_floor_panels(
                bounding_box, room_points, orientation, panel_width, panel_length, wall_thickness
            )
    
    @staticmethod
    def _analyze_floor_room_shape(room_points, bounding_box, orientation='horizontal'):
        """Analyze floor room shape to identify distinct rectangular regions (like ceiling plan does)"""
        try:
            if not room_points or len(room_points) < 3:
                return []
            
            # Convert room points to a more manageable format
            points = [(p['x'], p['y']) for p in room_points]
            
            # Detect if room is L-shaped by analyzing convexity and finding corners
            is_l_shaped = FloorService._detect_floor_l_shape(points)
            
            if is_l_shaped:
                # Split L-shaped room into rectangular regions with orientation optimization
                regions = FloorService._split_floor_l_shaped_room(points, bounding_box, orientation)
                return regions
            else:
                # Room is roughly rectangular - treat as single region
                regions = [{
                    'min_x': bounding_box['min_x'],
                    'max_x': bounding_box['max_x'],
                    'min_y': bounding_box['min_y'],
                    'max_y': bounding_box['max_y'],
                    'width': bounding_box['width'],
                    'height': bounding_box['height'],
                    'type': 'rectangular'
                }]
                return regions
                
        except Exception as e:
            return []
    
    @staticmethod
    def _detect_floor_l_shape(points):
        """Detect if a floor room has an L-shape by analyzing its geometry (like ceiling plan does)"""
        try:
            if len(points) < 4:
                return False
            
            # Calculate room dimensions
            x_coords = [p[0] for p in points]
            y_coords = [p[1] for p in points]
            
            min_x, max_x = min(x_coords), max(x_coords)
            min_y, max_y = min(y_coords), max(y_coords)
            
            room_width = max_x - min_x
            room_height = max_y - min_y
            
            # Calculate room area
            room_area = room_width * room_height
            
            # Calculate actual polygon area using shoelace formula
            actual_area = FloorService._calculate_floor_polygon_area(points)
            
            # If actual area is significantly less than bounding box area, it's likely L-shaped
            area_ratio = actual_area / room_area
            
            # L-shaped rooms typically have area ratio < 0.8
            return area_ratio < 0.8
            
        except Exception as e:
            return False
    
    @staticmethod
    def _calculate_floor_polygon_area(points):
        """Calculate floor polygon area using shoelace formula (like ceiling plan does)"""
        try:
            n = len(points)
            if n < 3:
                return 0
            
            area = 0
            for i in range(n):
                j = (i + 1) % n
                area += points[i][0] * points[j][1]
                area -= points[j][0] * points[i][1]
            
            return abs(area) / 2
            
        except Exception:
            return 0
    
    @staticmethod
    def _split_floor_l_shaped_room(points, bounding_box, orientation='horizontal'):
        """Split L-shaped floor room into rectangular regions optimized for given orientation (like ceiling plan does)"""
        try:
            
            # Convert points to find coordinates
            x_coords = [p[0] for p in points]
            y_coords = [p[1] for p in points]
            
            # Find the cutout coordinates (inner corner of L)
            cutout_x = None
            cutout_y = None
            
            # Find the inner corner by looking for a point that's not at the extremes
            for point in points:
                x, y = point
                if (x != min(x_coords) and x != max(x_coords) and 
                    y != min(y_coords) and y != max(y_coords)):
                    if cutout_x is None or (x > cutout_x and y > cutout_y):
                        cutout_x = x
                        cutout_y = y

            if not cutout_x or not cutout_y:
                return []
            
            # Choose split strategy based on orientation
            if orientation == 'vertical':
                # VERTICAL SPLIT: Split at x=cutout_x to maximize panel length (height)
                return FloorService._create_floor_vertical_split_regions(
                    x_coords, y_coords, cutout_x, cutout_y
                )
            else:
                # HORIZONTAL SPLIT: Split at y=cutout_y 
                return FloorService._create_floor_horizontal_split_regions(
                    x_coords, y_coords, cutout_x, cutout_y
                )
            
        except Exception as e:  
            return []
    
    @staticmethod
    def _create_floor_vertical_split_regions(x_coords, y_coords, cutout_x, cutout_y):
        """Create floor regions using VERTICAL split at x=cutout_x for maximum panel length (like ceiling plan does)"""
        try:
            regions = []
            
            # Region 1: Bottom-left area ONLY (below the cutout)
            region1 = {
                'min_x': min(x_coords),
                'max_x': cutout_x,
                'min_y': cutout_y,  # Start BELOW the cutout
                'max_y': max(y_coords),
                'width': cutout_x - min(x_coords),
                'height': max(y_coords) - cutout_y,  # Only the bottom part
                'type': 'bottom_left_vertical_arm'
            }
            regions.append(region1)
            
            # Region 2: Right side (the right arm of L-shape)
            region2 = {
                'min_x': cutout_x,
                'max_x': max(x_coords),
                'min_y': min(y_coords),
                'max_y': max(y_coords),
                'width': max(x_coords) - cutout_x,
                'height': max(y_coords) - min(y_coords),  # FULL height!
                'type': 'right_vertical_arm'
            }
            regions.append(region2)
            
            return regions
            
        except Exception as e:
            return []
    
    @staticmethod
    def _create_floor_horizontal_split_regions(x_coords, y_coords, cutout_x, cutout_y):
        """Create floor regions using HORIZONTAL split at y=cutout_y (like ceiling plan does)"""
        try:
            regions = []
            
            # Region 1: Top-right rectangle (only the right part, not covering the cutout area)
            region1 = {
                'min_x': cutout_x,  # Start from cutout_x, not min_x
                'max_x': max(x_coords),
                'min_y': min(y_coords),
                'max_y': cutout_y,
                'width': max(x_coords) - cutout_x,
                'height': cutout_y - min(y_coords),
                'type': 'top_right_arm'
            }
            regions.append(region1)
            # Region 2: Bottom horizontal strip (full width, below the cutout)
            region2 = {
                'min_x': min(x_coords),
                'max_x': max(x_coords),
                'min_y': cutout_y,
                'max_y': max(y_coords),
                'width': max(x_coords) - min(x_coords),
                'height': max(y_coords) - cutout_y,
                'type': 'bottom_arm'
            }
            regions.append(region2)
            return regions
            
        except Exception as e:
            return []
    
    @staticmethod
    def _generate_panels_for_floor_region(region, orientation, panel_width, start_panel_id, panel_length):
        """Generate panels for a specific floor region (like ceiling plan does)"""
        try:
            panel_id = start_panel_id
            
            # Create a bounding box for this region
            region_bounding_box = {
                'min_x': region['min_x'],
                'max_x': region['max_x'],
                'min_y': region['min_y'],
                'max_y': region['max_y'],
                'width': region['width'],
                'height': region['height']
            }
            
            # Generate panels for this region using the standard method
            region_panels = FloorService._generate_standard_floor_panels(
                region_bounding_box, [], orientation, panel_width, panel_length, 0
            )
            
            # Update panel IDs to be unique across all regions
            for panel in region_panels:
                panel['panel_id'] = f'FP_{panel_id:03d}'
                panel_id += 1
            
            return region_panels
            
        except Exception as e:
            return []
    
    @staticmethod
    def _calculate_panel_coverage(panel_corners, room_points, bounding_box):
        """Calculate what percentage of a panel is within the room using normalized coordinates
        This is the same method used by the ceiling plan for L-shaped room handling"""
        # This is a simplified calculation - in a real implementation,
        # you might want to use more sophisticated polygon intersection algorithms
        
        # For now, we'll use a simple approach: check if the panel center is in the room
        center_x = sum(corner['x'] for corner in panel_corners) / 4
        center_y = sum(corner['y'] for corner in panel_corners) / 4
        
        # Convert normalized coordinates back to absolute for room point checking
        abs_center_x = center_x + bounding_box['min_x']
        abs_center_y = center_y + bounding_box['min_y']
        
        if FloorService._is_point_in_polygon(abs_center_x, abs_center_y, room_points):
            return 1.0  # Full coverage
        else:
            # Check if any corner is in the room
            corners_in_room = sum(
                1 for corner in panel_corners 
                if FloorService._is_point_in_polygon(
                    corner['x'] + bounding_box['min_x'], 
                    corner['y'] + bounding_box['min_y'], 
                    room_points
                )
            )
            
            # For cut panels, be more lenient - if any corner is in the room, accept it
            if corners_in_room > 0:
                return max(0.5, corners_in_room / 4.0)  # Minimum 50% coverage for cut panels
            
            return corners_in_room / 4.0  # Partial coverage
    
    @staticmethod
    def _is_point_in_polygon(x, y, polygon_points):
        """Check if a point is inside a polygon using ray casting algorithm
        This is the same method used by the ceiling plan for L-shaped room handling"""
        n = len(polygon_points)
        inside = False
        
        p1x, p1y = polygon_points[0]['x'], polygon_points[0]['y']
        for i in range(n + 1):
            p2x, p2y = polygon_points[i % n]['x'], polygon_points[i % n]['y']
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        
        return inside
    
    @staticmethod
    def _generate_mixed_floor_panels(bounding_box, room_points, panel_width, panel_length, wall_thickness, leftover_tracker=None, floor_thickness=20.0):
        """Generate mixed orientation floor panels for optimal coverage with leftover tracking"""
        # For now, use the better of horizontal or vertical
        horizontal_tracker = leftover_tracker or LeftoverTracker()
        horizontal_panels = FloorService._generate_floor_panels(
            bounding_box, room_points, 'horizontal', panel_width, panel_length, wall_thickness, horizontal_tracker, floor_thickness
        )
        
        vertical_tracker = leftover_tracker or LeftoverTracker()
        vertical_panels = FloorService._generate_floor_panels(
            bounding_box, room_points, 'vertical', panel_width, panel_length, wall_thickness, vertical_tracker, floor_thickness
        )
        
        horizontal_waste = FloorService._calculate_floor_waste(horizontal_panels, None, wall_thickness)
        vertical_waste = FloorService._calculate_floor_waste(vertical_panels, None, wall_thickness)
        
        return horizontal_panels if horizontal_waste <= vertical_waste else vertical_panels
    
    @staticmethod
    def _calculate_floor_waste(panels, room, wall_thickness, leftover_tracker=None):
        """Calculate waste percentage for floor panels using leftover area
        
        New formula: waste% = Leftover Area / Room Area × 100%
        This represents "what percentage of the room area is wasted material"
        """
        if not panels:
            return 100.0
        
        if room and leftover_tracker:
            floor_area = FloorService._calculate_room_floor_area(room, wall_thickness)
            if floor_area > 0:
                # Get leftover area from tracker
                leftover_stats = leftover_tracker.get_stats()
                leftover_area = leftover_stats.get('total_leftover_area', 0)
                
                # Calculate waste percentage using leftover area
                waste_percentage = (leftover_area / floor_area) * 100
                
                return waste_percentage
        
        return 0.0
    
    @staticmethod
    def generate_floor_plan(project_id, orientation_strategy='auto', panel_width=1150, panel_length='auto', 
                           custom_panel_length=None):
        """Generate floor plan with intelligent panel placement (excluding walls)"""
        try:
            from .models import Project, Room, FloorPlan, FloorPanel
            
            # Get project and rooms
            project = Project.objects.get(id=project_id)
            rooms = Room.objects.filter(project=project)
            
            if not rooms.exists():
                return {'error': 'No rooms found for this project'}
            
            # Get orientation analysis
            orientation_analysis = FloorService.analyze_floor_orientation_strategies(
                project_id, panel_width, panel_length
            )
            if 'error' in orientation_analysis:
               return {'error': orientation_analysis['error']}
            
            
            # Determine which strategy to use
            if orientation_strategy == 'auto':
                strategy_name = orientation_analysis['recommended_strategy']
            else:
                strategy_name = orientation_strategy
            
            # Find the selected strategy
            selected_strategy = None
            for strategy in orientation_analysis['strategies']:
                if strategy['strategy_name'] == strategy_name:
                    selected_strategy = strategy
                    break
            
            if not selected_strategy:
                return {'error': f'Strategy {strategy_name} not found'}
            
            # Generate floor panels for all rooms with leftover tracking
            all_floor_panels = []
            created_plans = []
            project_leftover_tracker = LeftoverTracker(context='GENERATION')  # Mark as actual generation - shared across all rooms
            
            for room in rooms:
                if not room.room_points or len(room.room_points) < 3:
                    continue
                
                # Check floor type - only generate floor plans for panel floors
                if not hasattr(room, 'floor_type') or room.floor_type not in ['panel', 'Panel']:
                    continue
                
                
                # Get room's floor bounding box (excluding walls)
                bounding_box = FloorService._calculate_room_floor_bounding_box(room)
                if not bounding_box:
                    continue
                
                # Get floor thickness from room
                floor_thickness = float(room.floor_thickness) if hasattr(room, 'floor_thickness') and room.floor_thickness else 20.0
                
                if selected_strategy['orientation_type'] == 'horizontal':
                    room_panels = FloorService._generate_floor_panels(
                        bounding_box, room.room_points, 'horizontal', panel_width, panel_length, project.wall_thickness, project_leftover_tracker, floor_thickness
                    )
                elif selected_strategy['orientation_type'] == 'vertical':
                    room_panels = FloorService._generate_floor_panels(
                        bounding_box, room.room_points, 'vertical', panel_width, panel_length, project.wall_thickness, project_leftover_tracker, floor_thickness
                    )
                else:  # mixed
                    room_panels = FloorService._generate_mixed_floor_panels(
                        bounding_box, room.room_points, panel_width, panel_length, project.wall_thickness, project_leftover_tracker, floor_thickness
                    )
                    
                # Add room info to panels
                for panel in room_panels:
                    panel['room_id'] = room.id
                    panel['room_name'] = room.room_name
                
                all_floor_panels.extend(room_panels)
                
                # Create or update floor plan
                floor_plan, created = FloorPlan.objects.get_or_create(
                    room=room,
                    defaults={
                        'generation_method': 'automatic',
                        'orientation_strategy': strategy_name,
                        'panel_width': panel_width,
                        'panel_length': panel_length,
                        'custom_panel_length': custom_panel_length,
                    }
                )
                
                if not created:
                    # Update existing plan
                    floor_plan.orientation_strategy = strategy_name
                    floor_plan.panel_width = panel_width
                    floor_plan.panel_length = panel_length
                    floor_plan.custom_panel_length = custom_panel_length
                    floor_plan.save()
                
                # Clear existing floor panels and create new ones
                FloorPanel.objects.filter(room=room).delete()
                
                # Create floor panel objects
                created_panels = []
                for panel_data in room_panels:
                    # Validate panel data
                    if not all(key in panel_data for key in ['panel_id', 'start_x', 'start_y', 'end_x', 'end_y', 'width', 'length']):
                       continue
                    
                    try:
                        panel = FloorPanel.objects.create(
                            room=room,
                            panel_id=panel_data['panel_id'],
                            start_x=panel_data['start_x'],
                            start_y=panel_data['start_y'],
                            end_x=panel_data['end_x'],
                            end_y=panel_data['end_y'],
                            width=panel_data['width'],
                            length=panel_data['length'],
                            thickness=floor_thickness,  # Use actual floor thickness, not hardcoded!
                            material_type='standard',
                            is_cut_panel=panel_data.get('is_cut', False),
                            cut_notes=panel_data.get('cut_notes', '')
                        )
                        created_panels.append(panel)
                    except Exception as e:
                        continue
                
                
                # Update statistics with leftover tracker
                try:
                    floor_plan.update_statistics(project_leftover_tracker)
                    
                    # Refresh the floor_plan object to get updated statistics
                    floor_plan.refresh_from_db()
                    
                    
                    # Ensure total_area is not null
                    if floor_plan.total_area is None:
                        floor_plan.total_area = 0.0
                        floor_plan.save()
                        
                except Exception as e:
                    # Set default values if statistics update fails
                    floor_plan.total_area = 0.0
                    floor_plan.total_panels = len(room_panels)
                    floor_plan.full_panels = len([p for p in room_panels if not p.get('is_cut', False)])
                    floor_plan.cut_panels = len([p for p in room_panels if p.get('is_cut', False)])
                    floor_plan.waste_percentage = 0.0
                    floor_plan.save()
                
                # Add to created plans
                created_plans.append({
                    'id': floor_plan.id,
                    'room_id': floor_plan.room.id,
                    'room_name': floor_plan.room.room_name,
                    'generation_method': floor_plan.generation_method,
                    'total_area': floor_plan.total_area,
                    'total_panels': floor_plan.total_panels,
                    'full_panels': floor_plan.full_panels,
                    'cut_panels': floor_plan.cut_panels,
                    'waste_percentage': floor_plan.waste_percentage,
                    'orientation_strategy': floor_plan.orientation_strategy,
                    'panel_width': floor_plan.panel_width,
                    'panel_length': floor_plan.panel_length,
                    'custom_panel_length': floor_plan.custom_panel_length,
                    'point_count': bounding_box.get('point_count', 0),  # Add point count
                    'created_at': floor_plan.created_at.isoformat() if floor_plan.created_at else None,
                    'updated_at': floor_plan.updated_at.isoformat() if floor_plan.updated_at else None
                })
                
            # Calculate project-wide waste percentage using leftover area
            # Formula: waste% = Leftover Area / Total Room Area × 100%
            leftover_stats = project_leftover_tracker.get_stats()
            leftover_area = leftover_stats.get('total_leftover_area', 0)
            
            # Calculate total room area for all rooms with floor panels
            total_room_area = 0
            for room in rooms:
                if room.room_points and len(room.room_points) >= 3:
                    # Check if room has panel floor
                    if hasattr(room, 'floor_type') and room.floor_type in ['panel', 'Panel']:
                        # Calculate room area using Shoelace formula
                        area = 0
                        for i in range(len(room.room_points)):
                            j = (i + 1) % len(room.room_points)
                            area += room.room_points[i]['x'] * room.room_points[j]['y']
                            area -= room.room_points[j]['x'] * room.room_points[i]['y']
                        room_area = abs(area) / 2
                        total_room_area += room_area
            
            if total_room_area > 0 and leftover_area > 0:
                project_waste_percentage = (leftover_area / total_room_area) * 100
                print(f"🎯 [PROJECT] Floor Plan Project-wide waste calculation:")
                print(f"🎯 [PROJECT] Total Room Area: {total_room_area:,.0f} mm²")
                print(f"🎯 [PROJECT] Total Leftover Area: {leftover_area:,.0f} mm²")
                print(f"🎯 [PROJECT] Project Waste Percentage: {project_waste_percentage:.1f}%")
            else:
                project_waste_percentage = 0.0
                print(f"⚠️ [PROJECT] Cannot calculate floor plan project waste: room_area={total_room_area}, leftover_area={leftover_area}")
            
            # Get all actual FloorPanel objects from the database
            from .serializers import FloorPanelSerializer
            
            # Collect all FloorPanel objects for the project
            actual_floor_panels = []
            for room in rooms:
                room_panels = FloorPanel.objects.filter(room=room)
                for panel in room_panels:
                    # Serialize each panel to get the proper format
                    panel_data = FloorPanelSerializer(panel).data
                    print(f"🔍 Panel {panel.panel_id}: {panel_data}")
                    actual_floor_panels.append(panel_data)
            
           
            return {
                'project_id': project_id,
                'strategy_used': strategy_name,
                'recommended_strategy': orientation_analysis.get('recommended_strategy', strategy_name),  # Include recommended strategy
                'strategy_details': selected_strategy,
                'floor_panels': actual_floor_panels,  # Return actual FloorPanel objects
                'floor_plans': created_plans,
                'leftover_stats': leftover_stats,  # Include leftover reuse statistics
                'summary': {
                    'total_panels': len(actual_floor_panels),
                    'total_rooms': len(created_plans),
                    'average_waste_percentage': sum(p['waste_percentage'] for p in created_plans) / len(created_plans) if created_plans else 0,
                    'project_waste_percentage': project_waste_percentage,  # Add project-wide waste percentage
                    'recommended_strategy': orientation_analysis.get('recommended_strategy', strategy_name),  # Add to summary too
                    'leftovers_created': leftover_stats['leftovers_created'],
                    'leftovers_reused': leftover_stats['leftovers_reused'],
                    'full_panels_saved': leftover_stats['full_panels_saved']
                }
            }
            
        except Project.DoesNotExist:
            return {'error': 'Project not found'}
        except Exception as e:
            return {'error': f'Floor plan generation failed: {str(e)}'}

class CeilingService:
    """Service for managing ceiling plans and automatic panel generation with height-based grouping"""
    
    # Panel dimensions - now configurable via user input
    DEFAULT_PANEL_WIDTH = 1150  # Default panel width in mm
    DEFAULT_PANEL_LENGTH = 'auto'  # Default panel length (auto = project length)
    DEFAULT_WALL_THICKNESS = 150  # Default wall thickness in mm
    
    @staticmethod
    def generate_ceiling_plan(room_id):
        """Automatically generate a complete ceiling plan for a room
        
        Args:
            room_id: ID of the room
        """
        from .models import Room, CeilingPlan, CeilingPanel
        import logging
        
        logger = logging.getLogger(__name__)
        logger.info(f"Generating ceiling plan for room {room_id}")
        
        try:
            room = Room.objects.get(id=room_id)
            logger.info(f"Found room: {room.room_name}")
            
            # Ensure room boundary points are up-to-date with current wall positions
            from .services import RoomService
            RoomService.recalculate_room_boundary_from_walls(room_id)
            
            # Refresh room data to get updated room_points
            room.refresh_from_db()
            
            # Also refresh from database to ensure we have the latest data
            room = Room.objects.get(id=room_id)
            
            # Check if room has valid points
            if not room.room_points or len(room.room_points) < 3:
                raise ValueError('Room must have at least 3 boundary points')
            
            # Calculate room bounding box
            bounding_box = CeilingService._calculate_room_bounding_box(room.room_points)
            logger.info(f"Room bounding box: {bounding_box}")
            
            # Create leftover tracker for this ceiling plan
            ceiling_leftover_tracker = LeftoverTracker(context='GENERATION')
            ceiling_thickness = float(room.ceiling_thickness) if hasattr(room, 'ceiling_thickness') and room.ceiling_thickness else 20.0
            
            # Generate optimal panel layout with leftover tracking
            panels = CeilingService._generate_panel_layout(bounding_box, room.room_points, 1150, 'auto', ceiling_leftover_tracker, ceiling_thickness)
            logger.info(f"Generated {len(panels)} panels")
            logger.info(f"Leftover stats: {ceiling_leftover_tracker.get_stats()}")
            
            # Calculate total area from room points
            total_area = CeilingService._calculate_room_area(room.room_points)
            
            # Create or update ceiling plan
            ceiling_plan, created = CeilingPlan.objects.get_or_create(
                room=room,
                defaults={
                    'generation_method': 'automatic',
                    'total_area': total_area,
                    'total_panels': len(panels),
                    'full_panels': len([p for p in panels if not p['is_cut']]),
                    'cut_panels': len([p for p in panels if p['is_cut']])
                }
            )
            
            if not created:
                ceiling_plan.generation_method = 'automatic'
                ceiling_plan.total_panels = len(panels)
                ceiling_plan.full_panels = len([p for p in panels if not p['is_cut']])
                ceiling_plan.cut_panels = len([p for p in panels if p['is_cut']])
                ceiling_plan.save()
            
            # Clear existing panels and create new ones
            CeilingPanel.objects.filter(room=room).delete()
            
            # Create panel objects
            created_panels = []
            for panel_data in panels:
                panel = CeilingPanel.objects.create(
                    room=room,
                    panel_id=panel_data.get('panel_id', f"CP_{room.id}_{len(created_panels)+1:03d}"),
                    start_x=panel_data['start_x'],
                    start_y=panel_data['start_y'],
                    end_x=panel_data['end_x'],
                    end_y=panel_data['end_y'],
                    width=panel_data['width'],
                    length=panel_data['length'],
                    thickness=ceiling_thickness,  # Use actual ceiling thickness
                    material_type='standard',
                    is_cut_panel=panel_data['is_cut'],
                    cut_notes=panel_data.get('cut_notes', '')
                )
                created_panels.append(panel)
            
            # Update ceiling plan statistics with leftover tracker
            ceiling_plan.update_statistics(ceiling_leftover_tracker)
            logger.info(f"Successfully created ceiling plan with {len(created_panels)} panels")
            
            return ceiling_plan
            
        except Room.DoesNotExist:
            logger.error(f"Room with ID {room_id} not found")
            raise ValueError('Room not found')
        except Exception as e:
            logger.error(f"Error generating ceiling plan: {str(e)}")
            raise e
    
    @staticmethod
    def _calculate_room_area(room_points):
        """Calculate the area of a room from its points using shoelace formula"""
        try:
            if not room_points or len(room_points) < 3:
                return 0.0
            
            # Validate that all points have x and y coordinates
            for point in room_points:
                if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
                    return 0.0
                if not isinstance(point['x'], (int, float)) or not isinstance(point['y'], (int, float)):
                    return 0.0
            
            n = len(room_points)
            area = 0.0
            
            for i in range(n):
                j = (i + 1) % n
                area += room_points[i]['x'] * room_points[j]['y']
                area -= room_points[j]['x'] * room_points[i]['y']
            
            return abs(area) / 2.0
        except Exception as e:
            return 0.0
    
    @staticmethod
    def _calculate_room_bounding_box(room_points):
        """Calculate the bounding box of a room from its points"""
        if not room_points:
            return None
        
        x_coords = [point['x'] for point in room_points]
        y_coords = [point['y'] for point in room_points]
        
        return {
            'min_x': min(x_coords),
            'max_y': max(y_coords),
            'max_x': max(x_coords),
            'min_y': min(y_coords),
            'width': max(x_coords) - min(x_coords),
            'height': max(y_coords) - min(y_coords)
        }
    
    @staticmethod
    def _generate_panel_layout(bounding_box, room_points, panel_width=1150, panel_length='auto', leftover_tracker=None, ceiling_thickness=20.0):
        """Generate optimal panel layout to cover the room with professional precision and leftover tracking
        
        Args:
            bounding_box: Room bounding box
            room_points: Room boundary points
            panel_width: Maximum panel width in mm
            panel_length: Panel length ('auto' or custom value in mm)
            leftover_tracker: LeftoverTracker instance for reuse tracking
            ceiling_thickness: Ceiling panel thickness in mm
        """
        panels = []
        max_width = panel_width  # Use user-specified panel width
        
        room_width = bounding_box['width']
        room_height = bounding_box['height']
        
        # Use the advanced shape-aware panel generation with leftover tracking
        # This properly handles L-shaped rooms and tracks leftover reuse
        panels = CeilingService._generate_shape_aware_panels(
            bounding_box, room_points, 'vertical', max_width, panel_length, leftover_tracker, ceiling_thickness
        )
        
        return panels
    
    @staticmethod
    def _calculate_panel_coverage(panel_corners, room_points, bounding_box):
        """Calculate what percentage of a panel is within the room using normalized coordinates"""
        # This is a simplified calculation - in a real implementation,
        # you might want to use more sophisticated polygon intersection algorithms
        
        # For now, we'll use a simple approach: check if the panel center is in the room
        center_x = sum(corner['x'] for corner in panel_corners) / 4
        center_y = sum(corner['y'] for corner in panel_corners) / 4
        
        # Convert normalized coordinates back to absolute for room point checking
        abs_center_x = center_x + bounding_box['min_x']
        abs_center_y = center_y + bounding_box['min_y']
        
        if CeilingService._is_point_in_polygon(abs_center_x, abs_center_y, room_points):
            return 1.0  # Full coverage
        else:
            # Check if any corner is in the room
            corners_in_room = sum(
                1 for corner in panel_corners 
                if CeilingService._is_point_in_polygon(
                    corner['x'] + bounding_box['min_x'], 
                    corner['y'] + bounding_box['min_y'], 
                    room_points
                )
            )
            
            # For cut panels, be more lenient - if any corner is in the room, accept it
            if corners_in_room > 0:
                return max(0.5, corners_in_room / 4.0)  # Minimum 50% coverage for cut panels
            
            return corners_in_room / 4.0  # Partial coverage
    
    @staticmethod
    def _is_point_in_polygon(x, y, polygon_points):
        """Check if a point is inside a polygon using ray casting algorithm"""
        n = len(polygon_points)
        inside = False
        
        p1x, p1y = polygon_points[0]['x'], polygon_points[0]['y']
        for i in range(n + 1):
            p2x, p2y = polygon_points[i % n]['x'], polygon_points[i % n]['y']
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        
        return inside
    
    @staticmethod
    def regenerate_ceiling_plan(room_id):
        """Regenerate ceiling plan for a room (useful when room dimensions change)"""
        return CeilingService.generate_ceiling_plan(room_id)
    
    @staticmethod
    def get_ceiling_statistics(room_id):
        """Get ceiling statistics for a room"""
        from .models import CeilingPlan
        
        try:
            ceiling_plan = CeilingPlan.objects.get(room_id=room_id)
            ceiling_plan.update_statistics()
            return {
                'total_panels': ceiling_plan.total_panels,
                'full_panels': ceiling_plan.full_panels,
                'cut_panels': ceiling_plan.cut_panels,
                'total_area': ceiling_plan.total_area,
                'waste_percentage': ceiling_plan.waste_percentage
            }
        except CeilingPlan.DoesNotExist:
            return None

    @staticmethod
    def analyze_project_heights(project_id):
        """Enhanced project-level height analysis for intelligent ceiling planning
        
        Returns comprehensive analysis including:
        - Height grouping with detailed room information
        - Room adjacency analysis for potential merging
        - Ceiling level recommendations
        - Area calculations and room characteristics
        """
        from .models import Project, Room
        
        try:
            project = Project.objects.get(id=project_id)
            rooms = Room.objects.filter(project=project)
            
            if not rooms.exists():
                return {'error': 'No rooms found in project'}
            
            # Enhanced height analysis with detailed room information
            height_groups = {}
            total_project_area = 0.0
            valid_rooms_count = 0
            
            for room in rooms:
                # Get room height (room-specific or project default)
                room_height = room.height or project.height
                
                # Validate room has proper geometry
                if not room.room_points or len(room.room_points) < 3:
                    continue  # Skip invalid rooms
                
                # Calculate room area
                room_area = CeilingService._calculate_room_area(room.room_points)
                if room_area <= 0:
                    continue  # Skip rooms with invalid area
                
                # Initialize height group if needed
                if room_height not in height_groups:
                    height_groups[room_height] = {
                        'rooms': [],
                        'total_area': 0.0,
                        'room_count': 0,
                        'bounding_box': None,
                        'connected_rooms': [],
                        'can_merge': False
                    }
                
                # Add room to height group
                room_info = {
                    'id': room.id,
                    'name': room.room_name,
                    'points': room.room_points,
                    'area': room_area,
                    'center': CeilingService._calculate_room_center(room.room_points),
                    'bounding_box': CeilingService._calculate_room_bounding_box(room.room_points)
                }
                
                height_groups[room_height]['rooms'].append(room_info)
                height_groups[room_height]['total_area'] += room_area
                height_groups[room_height]['room_count'] += 1
                total_project_area += room_area
                valid_rooms_count += 1
            
            # Analyze each height group for potential merging and optimization
            for height, group_data in height_groups.items():
                # Calculate group bounding box
                all_group_points = []
                for room_info in group_data['rooms']:
                    all_group_points.extend(room_info['points'])
                
                group_data['bounding_box'] = CeilingService._calculate_project_bounding_box(all_group_points)
                
                # Analyze room connectivity within this height group
                group_data['connected_rooms'] = CeilingService._find_connected_rooms_enhanced(
                    group_data['rooms']
                )
                
                # Determine if rooms in this height group can be merged for ceiling planning
                group_data['can_merge'] = CeilingService._can_merge_rooms_for_ceiling(
                    group_data['rooms'], group_data['bounding_box']
                )
                
                # Calculate potential optimization metrics
                group_data['optimization_metrics'] = CeilingService._calculate_group_optimization_metrics(
                    group_data['rooms'], group_data['bounding_box']
                )
            
            # Determine overall project strategy
            all_same_height = len(height_groups) == 1
            recommended_strategy = CeilingService._determine_recommended_strategy(height_groups)
            
            return {
                'project_id': project_id,
                'project_name': project.name,
                'total_rooms': valid_rooms_count,
                'total_project_area': total_project_area,
                'height_groups': height_groups,
                'all_same_height': all_same_height,
                'recommended_strategy': recommended_strategy,
                'analysis_timestamp': timezone.now().isoformat(),
                'summary': {
                    'height_levels': len(height_groups),
                    'largest_height_group': max(height_groups.values(), key=lambda x: x['room_count'])['room_count'] if height_groups else 0,
                    'mergeable_groups': sum(1 for group in height_groups.values() if group['can_merge']),
                    'total_mergeable_area': sum(group['total_area'] for group in height_groups.values() if group['can_merge'])
                }
            }
            
        except Project.DoesNotExist:
            return {'error': 'Project not found'}
        except Exception as e:
            return {'error': f'Height analysis failed: {str(e)}'}

    @staticmethod
    def _calculate_room_center(room_points):
        """Calculate the center point of a room from its boundary points"""
        if not room_points or len(room_points) < 3:
            return None
        
        try:
            center_x = sum(point['x'] for point in room_points) / len(room_points)
            center_y = sum(point['y'] for point in room_points) / len(room_points)
            return {'x': center_x, 'y': center_y}
        except Exception:
            return None

    @staticmethod
    def _find_connected_rooms_enhanced(rooms):
        """Enhanced room connectivity analysis for ceiling planning optimization"""
        connected_groups = []
        processed_rooms = set()
        
        for room_info in rooms:
            if room_info['id'] in processed_rooms:
                continue
            
            # Start new connected group
            current_group = [room_info]
            processed_rooms.add(room_info['id'])
            
            # Find rooms that are geometrically connected or very close
            for other_room in rooms:
                if other_room['id'] not in processed_rooms:
                    if CeilingService._rooms_are_geometrically_connected(room_info, other_room):
                        current_group.append(other_room)
                        processed_rooms.add(other_room['id'])
            
            connected_groups.append(current_group)
        
        return connected_groups

    @staticmethod
    def _rooms_are_geometrically_connected(room1, room2):
        """Check if two rooms are geometrically connected for ceiling planning purposes"""
        try:
            # Check if rooms share boundaries or are very close
            # This is more sophisticated than the previous simple distance check
            
            # Calculate distance between room centers
            center1 = room1['center']
            center2 = room2['center']
            
            if not center1 or not center2:
                return False
            
            distance = ((center2['x'] - center1['x']) ** 2 + (center2['y'] - center1['y']) ** 2) ** 0.5
            
            # Check if rooms are close enough to consider merging
            # Threshold based on typical wall thickness and construction standards
            proximity_threshold = 500  # 500mm - typical wall thickness + small gap
            
            if distance <= proximity_threshold:
                return True
            
            # Additional check: see if rooms share any boundary points
            # This would indicate they're actually connected
            if CeilingService._rooms_share_boundaries(room1, room2):
                return True
            
            return False
            
        except Exception as e:
            return False

    @staticmethod
    def _rooms_share_boundaries(room1, room2):
        """Check if two rooms share boundary points (indicating they're connected)"""
        try:
            # This is a simplified check - in reality you'd analyze wall connections
            # For now, we'll check if rooms have points that are very close together
            
            tolerance = 100  # 100mm tolerance for "same" point
            
            for point1 in room1['points']:
                for point2 in room2['points']:
                    distance = ((point2['x'] - point1['x']) ** 2 + (point2['y'] - point1['y']) ** 2) ** 0.5
                    if distance <= tolerance:
                        return True
            
            return False
            
        except Exception:
            return False

    @staticmethod
    def _can_merge_rooms_for_ceiling(rooms, group_bounding_box):
        """Determine if rooms in a height group can be merged for ceiling planning"""
        if len(rooms) <= 1:
            return False
        
        # Check if rooms are close enough and have compatible shapes for merging
        total_area = sum(room['area'] for room in rooms)
        merged_bounding_area = group_bounding_box['width'] * group_bounding_box['height']
        
        # If merged area is close to sum of individual areas, merging makes sense
        area_efficiency = total_area / merged_bounding_area if merged_bounding_area > 0 else 0
        
        # Consider rooms mergeable if area efficiency is above threshold
        return area_efficiency > 0.7  # 70% efficiency threshold

    @staticmethod
    def _calculate_group_optimization_metrics(rooms, bounding_box):
        """Calculate optimization metrics for a height group"""
        try:
            total_room_area = sum(room['area'] for room in rooms)
            bounding_area = bounding_box['width'] * bounding_box['height']
            
            # Area efficiency
            area_efficiency = total_room_area / bounding_area if bounding_area > 0 else 0
            
            # Shape complexity (perimeter to area ratio)
            total_perimeter = sum(CeilingService._calculate_room_perimeter(room['points']) for room in rooms)
            shape_complexity = total_perimeter / total_room_area if total_room_area > 0 else 0
            
            # Panel optimization potential
            # Rooms with regular shapes (low complexity) are easier to optimize
            optimization_potential = max(0, 1 - (shape_complexity / 100))  # Normalize to 0-1
            
            return {
                'area_efficiency': area_efficiency,
                'shape_complexity': shape_complexity,
                'optimization_potential': optimization_potential,
                'total_room_area': total_room_area,
                'bounding_area': bounding_area
            }
            
        except Exception as e:
            return {
                'area_efficiency': 0,
                'shape_complexity': 0,
                'optimization_potential': 0,
                'total_room_area': 0,
                'bounding_area': 0
            }

    @staticmethod
    def _calculate_room_perimeter(room_points):
        """Calculate the perimeter of a room from its boundary points"""
        if not room_points or len(room_points) < 3:
            return 0
        
        try:
            perimeter = 0
            for i in range(len(room_points)):
                j = (i + 1) % len(room_points)
                dx = room_points[j]['x'] - room_points[i]['x']
                dy = room_points[j]['y'] - room_points[i]['y']
                perimeter += (dx ** 2 + dy ** 2) ** 0.5
            
            return perimeter
            
        except Exception:
            return 0

    @staticmethod
    def _determine_recommended_strategy(height_groups):
        """Determine the recommended ceiling planning strategy based on height analysis"""
        if not height_groups:
            return 'unknown'
        
        if len(height_groups) == 1:
            # Single height level - check if merging is beneficial
            group = list(height_groups.values())[0]
            if group['can_merge'] and group['room_count'] > 1:
                return 'unified_merged'
            else:
                return 'unified_separate'
        else:
            # Multiple height levels
            mergeable_groups = sum(1 for group in height_groups.values() if group['can_merge'])
            if mergeable_groups > 0:
                return 'height_grouped_with_merging'
            else:
                return 'height_grouped_separate'

    @staticmethod
    def analyze_orientation_strategies(project_id, panel_width=1150, panel_length='auto', ceiling_thickness=150):
        """Stage 2: Analyze different panel orientation strategies to find the least waste
        
        Evaluates:
        1. All rooms same orientation (vertical)
        2. All rooms same orientation (horizontal) 
        3. Each room independent orientation
        4. Whole project merged (if same height)
        
        Returns the strategy with least waste marked as 'recommended'
        """
        try:
            # Get height analysis first
            height_analysis = CeilingService.analyze_project_heights(project_id)
            if 'error' in height_analysis:
                return {'error': height_analysis['error']}
            
            strategies = []
            
            # Strategy 1: All rooms vertical orientation
            vertical_strategy = CeilingService._evaluate_strategy(
                height_analysis, 'vertical', 'all_vertical', panel_width, panel_length
            )
            strategies.append(vertical_strategy)
            
            # Strategy 2: All rooms horizontal orientation
            horizontal_strategy = CeilingService._evaluate_strategy(
                height_analysis, 'horizontal', 'all_horizontal', panel_width, panel_length
            )
            strategies.append(horizontal_strategy)
            
            # Strategy 3: Each room independent orientation (optimal per room)
            independent_strategy = CeilingService._evaluate_strategy(
                height_analysis, 'independent', 'room_optimal', panel_width, panel_length
            )
            strategies.append(independent_strategy)
            
            # Strategy 4: Project merged (if same height and mergeable)
            if height_analysis['all_same_height']:
                merged_strategy = CeilingService._evaluate_strategy(
                    height_analysis, 'merged', 'project_merged', panel_width, panel_length
                )
                strategies.append(merged_strategy)
            
            # Find the strategy with least waste
            strategies.sort(key=lambda x: x['total_waste_percentage'])
            best_strategy = strategies[0]
            best_strategy['is_recommended'] = True
            
            # Mark all others as not recommended
            for strategy in strategies[1:]:
                strategy['is_recommended'] = False
            
            return {
                'project_id': project_id,
                'strategies': strategies,
                'recommended_strategy': best_strategy['strategy_name'],
                'total_waste_savings': best_strategy['total_waste_percentage'] - strategies[-1]['total_waste_percentage'],
                'analysis_timestamp': timezone.now().isoformat(),
                'summary': {
                    'total_strategies': len(strategies),
                    'best_waste_percentage': best_strategy['total_waste_percentage'],
                    'worst_waste_percentage': strategies[-1]['total_waste_percentage'],
                    'average_waste_percentage': sum(s['total_waste_percentage'] for s in strategies) / len(strategies)
                }
            }
            
        except Exception as e:
            return {'error': f'Orientation analysis failed: {str(e)}'}

    @staticmethod
    def _evaluate_strategy(height_analysis, orientation_type, strategy_name, panel_width=1150, panel_length='auto'):
        """Evaluate a specific orientation strategy and calculate waste metrics"""
        try:
            total_panels = 0
            total_waste_area = 0.0
            total_room_area = 0.0
            room_results = []
            
            if orientation_type == 'merged':
                # Evaluate merged project approach
                result = CeilingService._evaluate_merged_strategy(
                    height_analysis, panel_width, panel_length
                )
                return {
                    'strategy_name': strategy_name,
                    'orientation_type': orientation_type,
                    'total_panels': result['total_panels'],
                    'total_waste_percentage': result['waste_percentage'],
                    'total_waste_area': result['waste_area'],
                    'total_room_area': result['total_room_area'],  # Ensure this field is included
                    'room_results': result['room_results'],
                    'merge_benefits': result['merge_benefits']
                }
            
            # Evaluate per-room or per-height-group strategies
            total_leftover_area = 0.0
            for height, group_data in height_analysis['height_groups'].items():
                if orientation_type == 'independent':
                    # Each room gets its optimal orientation
                    group_result = CeilingService._evaluate_group_independent_orientation(
                        group_data, panel_width, panel_length
                    )
                else:
                    # All rooms use the same orientation
                    group_result = CeilingService._evaluate_group_fixed_orientation(
                        group_data, orientation_type, panel_width, panel_length
                    )
                
                total_panels += group_result['total_panels']
                total_waste_area += group_result['total_waste_area']
                total_room_area += group_result['total_room_area']
                total_leftover_area += group_result.get('leftover_area', 0)
                room_results.extend(group_result['room_results'])
            
            # Calculate overall waste percentage using leftover area (new method)
            # Formula: waste% = Leftover Area / Total Room Area × 100%
            total_waste_percentage = (total_leftover_area / total_room_area * 100) if total_room_area > 0 else 0
            
            return {
                'strategy_name': strategy_name,
                'orientation_type': orientation_type,
                'total_panels': total_panels,
                'total_waste_percentage': total_waste_percentage,
                'total_waste_area': total_waste_area,
                'total_leftover_area': total_leftover_area,
                'total_room_area': total_room_area,
                'room_results': room_results,
                'height_groups_analyzed': len(height_analysis['height_groups'])
            }
            
        except Exception as e:
            return {
                'strategy_name': strategy_name,
                'orientation_type': orientation_type,
                'total_panels': 0,
                'total_waste_percentage': 100.0,  # High waste indicates error
                'total_waste_area': 0.0,
                'total_room_area': 0.0,
                'room_results': [],
                'error': str(e)
            }

    @staticmethod
    def _evaluate_group_fixed_orientation(group_data, orientation, panel_width=1150, panel_length='auto'):
        """Evaluate a height group with fixed orientation for all rooms with leftover tracking"""
        total_panels = 0
        total_waste_area = 0.0
        total_room_area = 0.0
        room_results = []
        
        # Create leftover tracker for this strategy evaluation
        strategy_tracker = LeftoverTracker(context=f'ANALYSIS-{orientation[0].upper()}')
        ceiling_thickness = group_data['rooms'][0].get('ceiling_thickness', 20.0) if group_data['rooms'] else 20.0
        
        for room_info in group_data['rooms']:
            # Calculate room area
            room_area = room_info['area']
            total_room_area += room_area
            
            # Generate panels with fixed orientation and leftover tracking
            panels = CeilingService._generate_panels_with_orientation(
                room_info, orientation, panel_width, panel_length, strategy_tracker, ceiling_thickness
            )
            
            # Calculate waste for this room
            room_waste = CeilingService._calculate_room_waste(panels, room_info, orientation)
            total_waste_area += room_waste
            total_panels += len(panels)
            
            # Calculate total panel area for this room for percentage calculation
            room_panel_area = sum(panel['width'] * panel['length'] for panel in panels)
            
            room_results.append({
                'room_id': room_info['id'],
                'room_name': room_info['name'],
                'orientation': orientation,
                'panels': len(panels),
                'waste_area': room_waste,
                'waste_percentage': (room_waste / room_panel_area * 100) if room_panel_area > 0 else 0,  # New formula
                'area': room_area
            })
        
        # Get leftover stats for this strategy
        leftover_stats = strategy_tracker.get_stats()
        leftover_area = leftover_stats.get('total_leftover_area', 0)
        
        # Calculate waste percentage using leftover area (new method)
        # Formula: waste% = Leftover Area / Total Room Area × 100%
        leftover_waste_percentage = (leftover_area / total_room_area * 100) if total_room_area > 0 else 0
        
        return {
            'total_panels': total_panels,
            'total_waste_area': total_waste_area,
            'total_room_area': total_room_area,
            'room_results': room_results,
            'leftover_area': leftover_area,
            'leftover_waste_percentage': leftover_waste_percentage
        }

    @staticmethod
    def _evaluate_group_independent_orientation(group_data, panel_width=1150, panel_length='auto'):
        """Evaluate a height group with each room getting its optimal orientation with leftover tracking"""
        total_panels = 0
        total_waste_area = 0.0
        total_room_area = 0.0
        room_results = []
        
        # Create leftover tracker for this strategy evaluation
        strategy_tracker = LeftoverTracker(context='ANALYSIS-IND')
        ceiling_thickness = group_data['rooms'][0].get('ceiling_thickness', 20.0) if group_data['rooms'] else 20.0
        
        for room_info in group_data['rooms']:
            # Calculate room area
            room_area = room_info['area']
            total_room_area += room_area
            
            # Test both orientations and pick the best one (with leftover tracking)
            vertical_panels = CeilingService._generate_panels_with_orientation(
                room_info, 'vertical', panel_width, panel_length, strategy_tracker, ceiling_thickness
            )
            horizontal_panels = CeilingService._generate_panels_with_orientation(
                room_info, 'horizontal', panel_width, panel_length, strategy_tracker, ceiling_thickness
            )
            
            vertical_waste = CeilingService._calculate_room_waste(vertical_panels, room_info, 'vertical')
            horizontal_waste = CeilingService._calculate_room_waste(horizontal_panels, room_info, 'horizontal')
            
            # Pick the orientation with less waste
            if vertical_waste <= horizontal_waste:
                best_orientation = 'vertical'
                best_panels = vertical_panels
                best_waste = vertical_waste
            else:
                best_orientation = 'horizontal'
                best_panels = horizontal_panels
                best_waste = horizontal_waste
            
            total_waste_area += best_waste
            total_panels += len(best_panels)
            
            # Calculate total panel area for percentage calculation
            best_panel_area = sum(panel['width'] * panel['length'] for panel in best_panels)
            
            room_results.append({
                'room_id': room_info['id'],
                'room_name': room_info['name'],
                'orientation': best_orientation,
                'panels': len(best_panels),
                'waste_area': best_waste,
                'waste_percentage': (best_waste / best_panel_area * 100) if best_panel_area > 0 else 0,  # New formula
                'area': room_area,
                'alternatives': {
                    'vertical': {'panels': len(vertical_panels), 'waste': vertical_waste},
                    'horizontal': {'panels': len(horizontal_panels), 'waste': horizontal_waste}
                }
            })
        
        # Get leftover stats for this strategy
        leftover_stats = strategy_tracker.get_stats()
        leftover_area = leftover_stats.get('total_leftover_area', 0)
        
        # Calculate waste percentage using leftover area (new method)
        # Formula: waste% = Leftover Area / Total Room Area × 100%
        leftover_waste_percentage = (leftover_area / total_room_area * 100) if total_room_area > 0 else 0
        
        return {
            'total_panels': total_panels,
            'total_waste_area': total_waste_area,
            'total_room_area': total_room_area,
            'room_results': room_results,
            'leftover_area': leftover_area,
            'leftover_waste_percentage': leftover_waste_percentage
        }

    @staticmethod
    def _evaluate_merged_strategy(height_analysis, panel_width=1150, panel_length='auto'):
        """Evaluate the merged project strategy (treating all rooms as one ceiling)"""
        try:
            # Get all rooms from the single height group
            height_group = list(height_analysis['height_groups'].values())[0]
            
            # Calculate merged bounding box
            all_points = []
            total_room_area = 0.0
            for room_info in height_group['rooms']:
                all_points.extend(room_info['points'])
                total_room_area += room_info['area']
            
            merged_bounding_box = CeilingService._calculate_project_bounding_box(all_points)
            
            # Generate panels for the merged area
            merged_panels = CeilingService._generate_panels_for_merged_area(
                merged_bounding_box, all_points
            )
            
            # Calculate waste for merged approach
            merged_waste = CeilingService._calculate_merged_waste(
                merged_panels, height_group['rooms'], merged_bounding_box
            )
            
            # Calculate merge benefits
            merge_benefits = CeilingService._calculate_merge_benefits(
                height_group['rooms'], merged_bounding_box, merged_panels
            )
            
            return {
                'total_panels': len(merged_panels),
                'waste_percentage': (merged_waste / total_room_area * 100) if total_room_area > 0 else 0,
                'waste_area': merged_waste,
                'total_room_area': total_room_area,  # Add this missing field
                'room_results': [{
                    'room_id': room_info['id'],
                    'room_name': room_info['name'],
                    'orientation': 'merged',
                    'panels': len([p for p in merged_panels if CeilingService._panel_covers_room(p, room_info)]),
                    'waste_area': 0,  # Individual waste not applicable in merged approach
                    'waste_percentage': 0,
                    'area': room_info['area']
                } for room_info in height_group['rooms']],
                'merge_benefits': merge_benefits
            }
            
        except Exception as e:
            return {
                'total_panels': 0,
                'waste_percentage': 100.0,
                'waste_area': 0.0,
                'total_room_area': 0.0,  # Add this missing field
                'room_results': [],
                'merge_benefits': {'error': str(e)}
            }

    @staticmethod
    def _generate_panels_with_orientation(room_info, orientation, panel_width=1150, panel_length='auto', leftover_tracker=None, ceiling_thickness=20.0):
        """Generate panels for a room with specific orientation with leftover tracking"""
        try:
            bounding_box = room_info['bounding_box']
            
            if orientation == 'vertical':
                # Vertical orientation: panels run up and down (vertical strips)
                return CeilingService._generate_horizontal_panels(bounding_box, room_info['points'], panel_width, panel_length, leftover_tracker, ceiling_thickness)
            else:
                # Horizontal orientation: panels run left to right (horizontal strips)
                return CeilingService._generate_vertical_panels(bounding_box, room_info['points'], panel_width, panel_length, leftover_tracker, ceiling_thickness)
                
        except Exception as e:
            return []

    @staticmethod
    def _generate_vertical_panels(bounding_box, room_points, panel_width=1150, panel_length='auto', leftover_tracker=None, ceiling_thickness=20.0):
        """Generate panels that run left to right (horizontal strips) - used for horizontal orientation with leftover tracking"""
        panels = []
        max_panel_width = panel_width  # Use user-specified panel width
        
        # FIXED: Calculate room-specific bounding box instead of using the passed bounding_box
        room_bounding_box = CeilingService._calculate_room_bounding_box(room_points)
        
        room_width = room_bounding_box['width']
        # room_height = room_bounding_box['height']  # Unused variable
        
        # Calculate panel width based on user's choice
        if panel_length == 'auto':
            # Use full room width when auto (equivalent to panel_length_option = 1)
            panel_width = room_width  # Full width
        else:
            # Use user's custom panel length
            panel_width = float(panel_length)
        
        # Use advanced L-shaped room aware algorithm with room-specific bounding box
        panels = CeilingService._generate_shape_aware_panels(
            room_bounding_box, room_points, 'horizontal', max_panel_width, panel_length, leftover_tracker, ceiling_thickness
        )
        
        return panels

    @staticmethod
    def _generate_horizontal_panels(bounding_box, room_points, panel_width=1150, panel_length='auto', leftover_tracker=None, ceiling_thickness=20.0):
        """Generate panels that run up and down (vertical strips) - used for vertical orientation with leftover tracking"""
        panels = []
        max_panel_width = panel_width  # Use user-specified panel width
        
        # FIXED: Calculate room-specific bounding box instead of using the passed bounding_box
        room_bounding_box = CeilingService._calculate_room_bounding_box(room_points)
        
        # Use advanced L-shaped room aware algorithm with room-specific bounding box
        panels = CeilingService._generate_shape_aware_panels(
            room_bounding_box, room_points, 'vertical', max_panel_width, panel_length, leftover_tracker, ceiling_thickness
        )
        
        return panels

    @staticmethod
    def _generate_shape_aware_panels(bounding_box, room_points, orientation, max_panel_width, panel_length='auto', leftover_tracker=None, ceiling_thickness=20.0):
        """Generate panels that respect the actual room shape (L-shaped, U-shaped, etc.) with leftover tracking"""
        try:
            panels = []
            panel_id = 1
            
            # Analyze room shape to identify distinct rectangular regions
            room_regions = CeilingService._analyze_room_shape(room_points, bounding_box, orientation)
            
            if not room_regions:
                # Fallback to simple approach if shape analysis fails
                return CeilingService._generate_simple_panels_fallback(
                    bounding_box, room_points, orientation, max_panel_width, panel_length, leftover_tracker, ceiling_thickness
                )
            
            # Generate panels for each region based on orientation
            for i, region in enumerate(room_regions):
                region_panels = CeilingService._generate_panels_for_region(
                    region, orientation, max_panel_width, panel_id, panel_length, leftover_tracker, ceiling_thickness
                )
                
                panels.extend(region_panels)
                panel_id += len(region_panels)
            
            # Optimize panel placement within the actual room boundaries
            optimized_panels = CeilingService._optimize_panels_for_room_shape(
                panels, room_points, bounding_box
            )
            return optimized_panels
            
        except Exception as e:
            # Fallback to simple approach
            return CeilingService._generate_simple_panels_fallback(
                bounding_box, room_points, orientation, max_panel_width, panel_length, leftover_tracker, ceiling_thickness
            )

    @staticmethod
    def _analyze_room_shape(room_points, bounding_box, orientation='horizontal'):
        """Analyze room shape to identify distinct rectangular regions (for L-shaped, U-shaped rooms)"""
        try:
            if not room_points or len(room_points) < 3:
                return []
            
            # Convert room points to a more manageable format
            points = [(p['x'], p['y']) for p in room_points]
            
            # Detect if room is L-shaped by analyzing convexity and finding corners
            is_l_shaped = CeilingService._detect_l_shape(points)
            
            if is_l_shaped:
                # Split L-shaped room into rectangular regions with orientation optimization
                regions = CeilingService._split_l_shaped_room(points, bounding_box, orientation)
                return regions
            else:
                # Room is roughly rectangular - treat as single region
                regions = [{
                    'min_x': bounding_box['min_x'],
                    'max_x': bounding_box['max_x'],
                    'min_y': bounding_box['min_y'],
                    'max_y': bounding_box['max_y'],
                    'width': bounding_box['width'],
                    'height': bounding_box['height'],
                    'type': 'rectangular'
                }]
                return regions
                
        except Exception as e:
            logger.error(f"Error analyzing room shape: {str(e)}")
            return []

    @staticmethod
    def _detect_l_shape(points):
        """Detect if a room has an L-shape by analyzing its geometry"""
        try:
            if len(points) < 4:
                return False
            
            # Calculate room dimensions
            x_coords = [p[0] for p in points]
            y_coords = [p[1] for p in points]
            
            min_x, max_x = min(x_coords), max(x_coords)
            min_y, max_y = min(y_coords), max(y_coords)
            
            room_width = max_x - min_x
            room_height = max_y - min_y
            
            # Calculate room area
            room_area = room_width * room_height
            
            # Calculate actual polygon area using shoelace formula
            actual_area = CeilingService._calculate_polygon_area(points)
            
            # If actual area is significantly less than bounding box area, it's likely L-shaped
            area_ratio = actual_area / room_area
            
            # L-shaped rooms typically have area ratio < 0.8
            return area_ratio < 0.8
            
        except Exception as e:
            return False

    @staticmethod
    def _calculate_polygon_area(points):
        """Calculate polygon area using shoelace formula"""
        try:
            n = len(points)
            if n < 3:
                return 0
            
            area = 0
            for i in range(n):
                j = (i + 1) % n
                area += points[i][0] * points[j][1]
                area -= points[j][0] * points[i][1]
            
            return abs(area) / 2
            
        except Exception:
            return 0

    @staticmethod
    def _split_l_shaped_room(points, bounding_box, orientation='horizontal'):
        """Split L-shaped room into rectangular regions optimized for given orientation"""
        try:
            
            # Convert points to find coordinates
            x_coords = [p[0] for p in points]
            y_coords = [p[1] for p in points]
            
            # Find the cutout coordinates (inner corner of L)
            cutout_x = None
            cutout_y = None
            
            # Find the inner corner by looking for a point that's not at the extremes
            for point in points:
                x, y = point
                if (x != min(x_coords) and x != max(x_coords) and 
                    y != min(y_coords) and y != max(y_coords)):
                    if cutout_x is None or (x > cutout_x and y > cutout_y):
                        cutout_x = x
                        cutout_y = y
            
            
            if not cutout_x or not cutout_y:
                return []
            
            # Choose split strategy based on orientation
            if orientation == 'vertical':
                # VERTICAL SPLIT: Split at x=cutout_x to maximize panel length (height)
                return CeilingService._create_vertical_split_regions(
                    x_coords, y_coords, cutout_x, cutout_y
                )
            else:
                # HORIZONTAL SPLIT: Split at y=cutout_y (current approach)
                return CeilingService._create_horizontal_split_regions(
                    x_coords, y_coords, cutout_x, cutout_y
                )
            
        except Exception as e:
            return []

    @staticmethod
    def _create_vertical_split_regions(x_coords, y_coords, cutout_x, cutout_y):
        """Create regions using VERTICAL split at x=cutout_x for maximum panel length"""
        try:
            regions = []
            
            # Region 1: Bottom-left area ONLY (below Room 144)
            # From x=0 to x=cutout_x, from y=cutout_y to y=max (NOT full height!)
            region1 = {
                'min_x': min(x_coords),
                'max_x': cutout_x,
                'min_y': cutout_y,  # Start BELOW Room 144
                'max_y': max(y_coords),
                'width': cutout_x - min(x_coords),
                'height': max(y_coords) - cutout_y,  # Only the bottom part
                'type': 'bottom_left_vertical_arm'
            }
            regions.append(region1)
            
            # Region 2: Right side (the right arm of L-shape)
            # From x=cutout_x to x=max, full height - THIS GETS 10000mm LENGTH!
            region2 = {
                'min_x': cutout_x,
                'max_x': max(x_coords),
                'min_y': min(y_coords),
                'max_y': max(y_coords),
                'width': max(x_coords) - cutout_x,
                'height': max(y_coords) - min(y_coords),  # FULL 10000mm!
                'type': 'right_vertical_arm'
            }
            regions.append(region2)
            
            return regions
            
        except Exception as e:
            return []

    @staticmethod
    def _create_horizontal_split_regions(x_coords, y_coords, cutout_x, cutout_y):
        """Create regions using HORIZONTAL split at y=cutout_y (current approach)"""
        try:
            regions = []
            
            # Region 1: Top-right rectangle (only the right part, not covering Room 144)
            region1 = {
                'min_x': cutout_x,  # Start from cutout_x (8036), not min_x (0)
                'max_x': max(x_coords),
                'min_y': min(y_coords),
                'max_y': cutout_y,
                'width': max(x_coords) - cutout_x,
                'height': cutout_y - min(y_coords),
                'type': 'top_right_arm'
            }
            regions.append(region1)
            
            # Region 2: Bottom horizontal strip (full width, below Room 144)
            region2 = {
                'min_x': min(x_coords),
                'max_x': max(x_coords),
                'min_y': cutout_y,
                'max_y': max(y_coords),
                'width': max(x_coords) - min(x_coords),
                'height': max(y_coords) - cutout_y,
                'type': 'bottom_arm'
            }
            regions.append(region2)
            
            return regions
            
        except Exception as e:
            return []

    @staticmethod
    def _find_l_shape_corner(points):
        """Find the main corner point of an L-shaped room"""
        try:
            if len(points) < 4:
                return None
            
            # Find the point that creates the largest angle (likely the L corner)
            max_angle = 0
            corner_point = None
            
            for i in range(len(points)):
                prev_i = (i - 1) % len(points)
                next_i = (i + 1) % len(points)
                
                # Calculate angle at this point
                angle = CeilingService._calculate_angle(
                    points[prev_i], points[i], points[next_i]
                )
                
                if angle > max_angle:
                    max_angle = angle
                    corner_point = {'x': points[i][0], 'y': points[i][1]}
            
            return corner_point
            
        except Exception as e:
            return None

    @staticmethod
    def _calculate_angle(p1, p2, p3):
        """Calculate angle at point p2 between lines p1-p2 and p2-p3"""
        try:
            import math
            
            # Vector 1: p1 to p2
            v1x = p1[0] - p2[0]
            v1y = p1[1] - p2[1]
            
            # Vector 2: p3 to p2
            v2x = p3[0] - p2[0]
            v2y = p3[1] - p2[1]
            
            # Calculate dot product
            dot_product = v1x * v2x + v1y * v2y
            
            # Calculate magnitudes
            mag1 = math.sqrt(v1x * v1x + v1y * v1y)
            mag2 = math.sqrt(v2x * v2x + v2y * v2y)
            
            if mag1 == 0 or mag2 == 0:
                return 0
            
            # Calculate angle
            cos_angle = dot_product / (mag1 * mag2)
            cos_angle = max(-1, min(1, cos_angle))  # Clamp to valid range
            
            angle = math.acos(cos_angle)
            return math.degrees(angle)
            
        except Exception:
            return 0

    @staticmethod
    def _generate_panels_for_region(region, orientation, max_panel_width, start_panel_id, panel_length='auto', leftover_tracker=None, ceiling_thickness=20.0):
        """Generate panels for a specific rectangular region with leftover tracking"""
        try:
            panels = []
            panel_id = start_panel_id
            MAX_PANEL_WIDTH = 1150  # Standard maximum panel width
            PANEL_THICKNESS = ceiling_thickness  # Use actual ceiling thickness
            
            if orientation == 'horizontal':
                # Panels run left to right (horizontal strips)
                if panel_length == 'auto':
                    # Use full region width when auto (equivalent to panel_length_option = 1)
                    panel_width = region['width']
                else:
                    panel_width = float(panel_length)
                    
                current_x = region['min_x']
                
                while current_x < region['max_x']:
                    current_panel_width = min(panel_width, region['max_x'] - current_x)
                    current_y = region['min_y']
                    
                    # Create panels for this column
                    while current_y < region['max_y']:
                        panel_height = min(max_panel_width, region['max_y'] - current_y)
                        
                        if panel_height > 0 and current_panel_width > 0:
                            # Check if this panel will be a cut panel (extends beyond room boundaries)
                            is_cut = False
                            cut_notes = ""
                            from_leftover = False
                            
                            # LEFTOVER TRACKING: Check if we need a cut panel
                            if panel_height < MAX_PANEL_WIDTH:
                                # This panel needs to be cut
                                if leftover_tracker:
                                    # Try to find a compatible leftover
                                    compatible_leftover = leftover_tracker.find_compatible_leftover(
                                        needed_width=panel_height,
                                        needed_length=current_panel_width,
                                        needed_thickness=PANEL_THICKNESS
                                    )
                                    
                                    if compatible_leftover:
                                        # Use the leftover
                                        leftover_tracker.use_leftover(compatible_leftover, panel_height)
                                        is_cut = True
                                        cut_notes = f"From leftover {compatible_leftover['id']}"
                                        from_leftover = True
                                    else:
                                        # No leftover available, cut from full panel
                                        is_cut = True
                                        cut_notes = "Cut from full panel"
                                        
                                        # Create leftover from the cut
                                        leftover_width = MAX_PANEL_WIDTH - panel_height
                                        if leftover_width > 0:
                                            leftover_tracker.add_leftover(
                                                length=current_panel_width,
                                                thickness=PANEL_THICKNESS,
                                                width_remaining=leftover_width
                                            )
                                else:
                                    # No tracker, just mark as cut
                                    if panel_height < max_panel_width:
                                        is_cut = True
                                        cut_notes = "Non-standard size"
                            
                            # Additional cut checks
                            if (current_x + current_panel_width > region['max_x'] or 
                                current_y + panel_height > region['max_y']):
                                is_cut = True
                                if cut_notes and cut_notes != "Non-standard size":
                                    cut_notes += ", Boundary extension"
                                else:
                                    cut_notes = "Boundary extension"
                            
                            panels.append({
                                'start_x': current_x,
                                'start_y': current_y,
                                'end_x': current_x + current_panel_width,
                                'end_y': current_y + panel_height,
                                'width': current_panel_width,
                                'length': panel_height,
                                'is_cut': is_cut,
                                'cut_notes': cut_notes,
                                'panel_id': f"CP_H_{panel_id:03d}",
                                'coverage': 1.0,
                                'area': current_panel_width * panel_height,
                                'region_type': region['type']
                            })
                            panel_id += 1
                        
                        current_y += panel_height
                    
                    current_x += panel_width
                    
            else:  # vertical orientation
                # Panels run up and down (vertical strips)
                if panel_length == 'auto':
                    # Use full region height when auto (equivalent to panel_length_option = 1)
                    panel_height = region['height']
                else:
                    panel_height = float(panel_length)
                    
                current_y = region['min_y']
                
                while current_y < region['max_y']:
                    current_panel_height = min(panel_height, region['max_y'] - current_y)
                    current_x = region['min_x']
                    
                    # Create panels for this row
                    while current_x < region['max_x']:
                        panel_width = min(max_panel_width, region['max_x'] - current_x)
                        
                        if panel_width > 0 and current_panel_height > 0:
                            # Check if this panel will be a cut panel (extends beyond room boundaries)
                            is_cut = False
                            cut_notes = ""
                            from_leftover = False
                            
                            # LEFTOVER TRACKING: Check if we need a cut panel
                            if panel_width < MAX_PANEL_WIDTH:
                                # This panel needs to be cut
                                if leftover_tracker:
                                    # Try to find a compatible leftover
                                    compatible_leftover = leftover_tracker.find_compatible_leftover(
                                        needed_width=panel_width,
                                        needed_length=current_panel_height,
                                        needed_thickness=PANEL_THICKNESS
                                    )
                                    
                                    if compatible_leftover:
                                        # Use the leftover
                                        leftover_tracker.use_leftover(compatible_leftover, panel_width)
                                        is_cut = True
                                        cut_notes = f"From leftover {compatible_leftover['id']}"
                                        from_leftover = True
                                    else:
                                        # No leftover available, cut from full panel
                                        is_cut = True
                                        cut_notes = "Cut from full panel"
                                        
                                        # Create leftover from the cut
                                        leftover_width = MAX_PANEL_WIDTH - panel_width
                                        if leftover_width > 0:
                                            leftover_tracker.add_leftover(
                                                length=current_panel_height,
                                                thickness=PANEL_THICKNESS,
                                                width_remaining=leftover_width
                                            )
                                else:
                                    # No tracker, just mark as cut
                                    if panel_width < max_panel_width:
                                        is_cut = True
                                        cut_notes = "Non-standard size"
                            
                            # Additional cut checks
                            if (current_x + panel_width > region['max_x'] or 
                                current_y + current_panel_height > region['max_y']):
                                is_cut = True
                                if cut_notes and cut_notes != "Non-standard size":
                                    cut_notes += ", Boundary extension"
                                else:
                                    cut_notes = "Boundary extension"
                            
                            panels.append({
                                'start_x': current_x,
                                'start_y': current_y,
                                'end_x': current_x + panel_width,
                                'end_y': current_y + current_panel_height,
                                'width': panel_width,
                                'length': current_panel_height,
                                'is_cut': is_cut,
                                'cut_notes': cut_notes,
                                'panel_id': f"CP_V_{panel_id:03d}",
                                'coverage': 1.0,
                                'area': panel_width * current_panel_height,
                                'region_type': region['type']
                            })
                            panel_id += 1
                        
                        current_x += panel_width
                    
                    current_y += panel_height
            
            # Panel width optimization removed as requested - return panels as-is
            return panels
            
        except Exception as e:
            return []

    @staticmethod
    def _optimize_panels_for_room_shape(panels, room_points, bounding_box):
        """Optimize panel placement to ensure they fit within the actual room boundaries"""
        try:
            optimized_panels = []
            
            for panel in panels:
                # Check if panel is fully within room boundaries
                panel_coverage = CeilingService._calculate_enhanced_panel_coverage(
                    panel['start_x'], panel['start_y'], 
                    panel['width'], panel['length'], room_points
                )
                
                if panel_coverage > 0.5:  # Only keep panels with >50% coverage
                    # Adjust panel dimensions to fit within room
                    adjusted_panel = CeilingService._adjust_panel_to_room_boundaries(
                        panel, room_points
                    )
                    
                    if adjusted_panel:
                        optimized_panels.append(adjusted_panel)
            
            return optimized_panels
            
        except Exception as e:
            return panels

    @staticmethod
    def _adjust_panel_to_room_boundaries(panel, room_points):
        """Adjust panel dimensions to fit within room boundaries"""
        try:
            # This is a simplified adjustment - in a full implementation,
            # you would use more sophisticated clipping algorithms
            
            # For now, we'll just check if the panel is mostly within the room
            panel_coverage = CeilingService._calculate_enhanced_panel_coverage(
                panel['start_x'], panel['start_y'], 
                panel['width'], panel['length'], room_points
            )
            
            if panel_coverage > 0.8:
                # Panel is mostly within room - keep as is
                return panel
            elif panel_coverage > 0.3:
                # Panel is partially within room - mark as cut
                panel['is_cut'] = True
                panel['cut_notes'] = f"Shape adjusted - {panel_coverage:.1%} coverage"
                return panel
            else:
                # Panel is mostly outside room - discard
                return None
                
        except Exception as e:
            return panel

    @staticmethod
    def _generate_simple_panels_fallback(bounding_box, room_points, orientation, max_panel_width, panel_length='auto'):
        """Fallback to simple panel generation if shape-aware approach fails"""
        try:
            # This is the original simple approach as a fallback
            if orientation == 'horizontal':
                return CeilingService._generate_simple_horizontal_panels(
                    bounding_box, room_points, max_panel_width, panel_length
                )
            else:
                return CeilingService._generate_simple_vertical_panels(
                    bounding_box, room_points, max_panel_width, panel_length
                )
        except Exception as e:
            return []

    @staticmethod
    def _generate_simple_horizontal_panels(bounding_box, room_points, max_panel_width, panel_length='auto'):
        """Simple horizontal panel generation as fallback"""
        try:
            panels = []
            panel_id = 1
            
            # FIXED: Calculate room-specific bounding box instead of using the passed bounding_box
            room_bounding_box = CeilingService._calculate_room_bounding_box(room_points)
            
            # Calculate panel width based on user's choice
            if panel_length == 'auto':
                # Use full room width when auto (equivalent to panel_length_option = 1)
                panel_width = room_width
            else:
                # Use user's custom panel length
                panel_width = float(panel_length)
                
            # Simple grid-based approach using room-specific bounding box
            current_x = room_bounding_box['min_x']
            while current_x < room_bounding_box['max_x']:
                current_panel_width = min(panel_width, room_bounding_box['max_x'] - current_x)
                current_y = room_bounding_box['min_y']
                
                while current_y < room_bounding_box['max_y']:
                    panel_height = min(max_panel_width, room_bounding_box['max_y'] - current_y)
                    
                    if panel_height > 0 and current_panel_width > 0:
                        # Check if this panel will be a cut panel
                        is_cut = False
                        if (current_x + current_panel_width > room_bounding_box['max_x'] or 
                            current_y + panel_height > room_bounding_box['max_y']):
                            is_cut = True
                        
                        panels.append({
                            'start_x': current_x,
                            'start_y': current_y,
                            'end_x': current_x + current_panel_width,
                            'end_y': current_y + panel_height,
                            'width': current_panel_width,
                            'length': panel_height,
                            'is_cut': is_cut,
                            'panel_id': f"CP_H_{panel_id:03d}",
                            'coverage': 1.0,
                            'area': current_panel_width * panel_height
                        })
                        panel_id += 1
                    
                    current_y += panel_height
                
                current_x += panel_width
            
            # Panel width optimization removed as requested - return panels as-is
            return panels
            
        except Exception as e:
            return []

    @staticmethod
    def _generate_simple_vertical_panels(bounding_box, room_points, max_panel_width, panel_length='auto'):
        """Simple vertical panel generation as fallback"""
        try:
            panels = []
            panel_id = 1
            
            # FIXED: Calculate room-specific bounding box instead of using the passed bounding_box
            room_bounding_box = CeilingService._calculate_room_bounding_box(room_points)
            
            # Calculate panel height based on user's choice
            if panel_length == 'auto':
                # Use full room height when auto (equivalent to panel_length_option = 1)
                panel_height = room_height
            else:
                # Use user's custom panel length
                panel_height = float(panel_length)
                
            # Simple grid-based approach using room-specific bounding box
            current_y = room_bounding_box['min_y']
            while current_y < room_bounding_box['max_y']:
                current_panel_height = min(panel_height, room_bounding_box['max_y'] - current_y)
                current_x = room_bounding_box['min_x']
                
                while current_x < room_bounding_box['max_x']:
                    panel_width = min(max_panel_width, room_bounding_box['max_x'] - current_x)
                    
                    if panel_width > 0 and current_panel_height > 0:
                        # Check if this panel will be a cut panel
                        is_cut = False
                        if (current_x + panel_width > room_bounding_box['max_x'] or 
                            current_y + current_panel_height > room_bounding_box['max_y']):
                            is_cut = True
                        
                        panels.append({
                            'start_x': current_x,
                            'start_y': current_y,
                            'end_x': current_x + panel_width,
                            'end_y': current_y + current_panel_height,
                            'width': panel_width,
                            'length': current_panel_height,
                            'is_cut': is_cut,
                            'panel_id': f"CP_V_{panel_id:03d}",
                            'coverage': 1.0,
                            'area': panel_width * current_panel_height
                        })
                        panel_id += 1
                    
                    current_x += panel_width
                
                current_y += current_panel_height
            
            # Panel width optimization removed as requested - return panels as-is
            return panels
            
        except Exception as e:
            return []

    @staticmethod
    def _calculate_merged_waste(merged_panels, rooms, merged_bounding_box):
        """Calculate the total waste area for the merged project approach"""
        total_waste_area = 0.0
        for room_info in rooms:
            room_waste_area = 0.0
            for panel in merged_panels:
                if CeilingService._panel_covers_room(panel, room_info):
                    room_waste_area += panel['width'] * panel['length']
            total_waste_area += room_waste_area
        return total_waste_area

    @staticmethod
    def _calculate_merge_benefits(rooms, merged_bounding_box, merged_panels):
        """Calculate benefits of merging rooms for ceiling planning"""
        total_individual_waste = 0.0
        for room_info in rooms:
            room_waste_area = 0.0
            for panel in merged_panels:
                if CeilingService._panel_covers_room(panel, room_info):
                    room_waste_area += panel['width'] * panel['length']
            total_individual_waste += room_waste_area
        
        # Calculate the total area of the merged bounding box
        merged_total_area = merged_bounding_box['width'] * merged_bounding_box['height']
        
        # Calculate the total area of all individual rooms
        total_individual_rooms_area = sum(room_info['area'] for room_info in rooms)
        
        # Calculate the total waste percentage if each room were planned separately
        total_waste_percentage_if_separate = (total_individual_waste / total_individual_rooms_area * 100) if total_individual_rooms_area > 0 else 0
        
        # Calculate the total waste percentage if the entire project were planned as one ceiling
        total_waste_percentage_if_merged = (total_individual_waste / merged_total_area * 100) if merged_total_area > 0 else 0
        
        # Calculate the waste savings percentage
        waste_savings_percentage = total_waste_percentage_if_separate - total_waste_percentage_if_merged
        
        return {
            'total_individual_waste': total_individual_waste,
            'total_individual_rooms_area': total_individual_rooms_area,
            'merged_total_area': merged_total_area,
            'waste_savings_percentage': waste_savings_percentage
        }

    @staticmethod
    def _panel_covers_room(panel, room_info):
        """Check if a panel covers a specific room's area"""
        
        # Calculate panel center
        panel_center_x = (panel['start_x'] + panel['end_x']) / 2
        panel_center_y = (panel['start_y'] + panel['end_y']) / 2
        
        # Check if panel center is within room's bounding box
        if panel_center_x >= room_info['bounding_box']['min_x'] and \
           panel_center_x <= room_info['bounding_box']['max_x'] and \
           panel_center_y >= room_info['bounding_box']['min_y'] and \
           panel_center_y <= room_info['bounding_box']['max_y']:
            return True
        return False

    @staticmethod
    def _calculate_room_waste(panels, room_info, orientation, leftover_tracker=None):
        """Calculate waste AREA for a room with given panels and orientation
        
        Returns the waste area in mm². Callers should calculate percentage using:
        waste% = (waste_area / total_panel_area) × 100%
        
        Note: Leftover reuse reduces the number of full panels needed,
        which is reflected in the panel count.
        """
        try:
            if not panels:
                return 0.0
            
            # Calculate total panel area
            total_panel_area = sum(panel['width'] * panel['length'] for panel in panels)
            
            # Calculate room area
            room_area = room_info['area']
            
            # Calculate waste area (NOT percentage)
            waste_area = max(0, total_panel_area - room_area)
            
            return waste_area
            
        except Exception as e:
            return 0.0

    @staticmethod
    def _generate_panels_for_merged_area(bounding_box, all_points):
        """Generate panels for a merged project area"""
        try:
            # For merged approach, we'll use horizontal orientation as default
            # This can be enhanced later to test both orientations
            return CeilingService._generate_horizontal_panels(bounding_box, all_points, 1150, 'auto')
            
        except Exception as e:
            return []

    @staticmethod
    def _calculate_merged_waste(merged_panels, rooms, merged_bounding_box):
        """Calculate the total waste area for the merged project approach"""
        try:
            # total_waste_area = 0.0  # Unused variable
            total_room_area = sum(room_info['area'] for room_info in rooms)
            
            # Calculate total panel area
            total_panel_area = sum(panel['width'] * panel['length'] for panel in merged_panels)
            
            # Waste is the difference between panel area and room area
            waste_area = max(0, total_panel_area - total_room_area)
            
            return waste_area
            
        except Exception as e:
            return 0.0

    @staticmethod
    def _calculate_merge_benefits(rooms, merged_bounding_box, merged_panels):
        """Calculate benefits of merging rooms for ceiling planning"""
        try:
            # Calculate the total area of the merged bounding box
            merged_total_area = merged_bounding_box['width'] * merged_bounding_box['height']
            
            # Calculate the total area of all individual rooms
            total_individual_rooms_area = sum(room_info['area'] for room_info in rooms)
            
            # Calculate potential waste reduction
            potential_waste_reduction = merged_total_area - total_individual_rooms_area
            
            # Calculate efficiency improvement
            efficiency_improvement = (total_individual_rooms_area / merged_total_area * 100) if merged_total_area > 0 else 0
            
            return {
                'merged_total_area': merged_total_area,
                'total_individual_rooms_area': total_individual_rooms_area,
                'potential_waste_reduction': potential_waste_reduction,
                'efficiency_improvement': efficiency_improvement,
                'merge_advantage': potential_waste_reduction > 0
            }
            
        except Exception as e:
            return {
                'merged_total_area': 0,
                'total_individual_rooms_area': 0,
                'potential_waste_reduction': 0,
                'efficiency_improvement': 0,
                'merge_advantage': False,
                'error': str(e)
            }

    @staticmethod
    def generate_project_ceiling_plan(project_id):
        """Generate ceiling plans for an entire project using height-based grouping"""
        from .models import Project
        
        try:
            project = Project.objects.get(id=project_id)
            height_analysis = CeilingService.analyze_project_heights(project_id)
            
            if 'error' in height_analysis:
                raise ValueError(height_analysis['error'])
            
            generated_plans = []
            
            if height_analysis['all_same_height']:
                # All rooms have same height - generate unified project ceiling plan
                unified_plan = CeilingService._generate_unified_project_ceiling_plan(
                    project, height_analysis['height_groups']
                )
                generated_plans.append(unified_plan)
            else:
                # Different heights - generate separate plans for each height group
                for height, group_data in height_analysis['height_groups'].items():
                    group_plan = CeilingService._generate_height_group_ceiling_plan(
                        project, height, group_data
                    )
                    generated_plans.append(group_plan)
            
            return {
                'project_id': project_id,
                'project_name': project.name,
                'generated_plans': generated_plans,
                'total_plans': len(generated_plans),
                'approach_used': height_analysis['recommended_strategy']
            }
            
        except Project.DoesNotExist:
            raise ValueError('Project not found')
        except Exception as e:
            raise e

    @staticmethod
    def _find_connected_rooms(rooms):
        """Find rooms that are connected (share walls or are adjacent)"""
        # This is a simplified implementation
        # In a real scenario, you might want to analyze wall connections
        connected_groups = []
        processed_rooms = set()
        
        for room in rooms:
            if room.id in processed_rooms:
                continue
                
            # Start a new connected group
            current_group = [{'id': room.id, 'name': room.room_name}]
            processed_rooms.add(room.id)
            
            # Find rooms that might be connected (simplified logic)
            # This could be enhanced with actual wall connection analysis
            for other_room in rooms:
                if other_room.id not in processed_rooms:
                    # Simple proximity check (rooms within certain distance)
                    if CeilingService._rooms_are_adjacent(room, other_room):
                        current_group.append({'id': other_room.id, 'name': other_room.room_name})
                        processed_rooms.add(other_room.id)
            
            connected_groups.append(current_group)
        
        return connected_groups

    @staticmethod
    def _rooms_are_adjacent(room1, room2):
        """Check if two rooms are adjacent (simplified implementation)"""
        try:
            # This is a simplified check - in reality you'd analyze wall connections
            # For now, we'll assume rooms are adjacent if they're in the same project
            # and have similar coordinates
            if not room1.room_points or not room2.room_points:
                return False
            
            # Validate room points
            if not isinstance(room1.room_points, list) or not isinstance(room2.room_points, list):
                return False
            
            # Check if points have valid structure
            for point in room1.room_points + room2.room_points:
                if not isinstance(point, dict) or 'x' not in point or 'y' not in point:
                    return False
                if not isinstance(point['x'], (int, float)) or not isinstance(point['y'], (int, float)):
                    return False
            
            # Calculate room centers
            center1_x = sum(p['x'] for p in room1.room_points) / len(room1.room_points)
            center1_y = sum(p['y'] for p in room1.room_points) / len(room1.room_points)
            center2_x = sum(p['x'] for p in room2.room_points) / len(room2.room_points)
            center2_y = sum(p['y'] for p in room2.room_points) / len(room2.room_points)
            
            # Calculate distance between centers
            distance = ((center2_x - center1_x) ** 2 + (center2_y - center1_y) ** 2) ** 0.5
            
            # Consider rooms adjacent if they're within reasonable distance
            # This is a simplified approach - real implementation would check wall connections
            return distance < 1000  # 1 meter threshold
        except Exception as e:
            # Log the error and return False to prevent crashes
            return False

    @staticmethod
    def _generate_unified_project_ceiling_plan(project, height_groups):
        """Generate a unified ceiling plan for the entire project when all rooms have same height"""
        from .models import CeilingPlan, CeilingPanel
        
        # Get all rooms from the height group
        all_rooms = []
        for height, group_data in height_groups.items():
            all_rooms.extend(group_data['rooms'])
        
        # Calculate project bounding box
        all_points = []
        for room_data in all_rooms:
            all_points.extend(room_data['points'])
        
        project_bounding_box = CeilingService._calculate_project_bounding_box(all_points)
        
        # Generate panels for the entire project area
        panels = CeilingService._generate_panel_layout(
            project_bounding_box, all_points, 1150, 'auto'
        )
        
        # Create ceiling plans for each room
        created_plans = []
        for room_data in all_rooms:
            room = Room.objects.get(id=room_data['id'])
            
            # Filter panels that belong to this room
            room_panels = CeilingService._filter_panels_for_room(panels, room_data['points'])
            
            # Create or update ceiling plan for this room
            ceiling_plan, created = CeilingPlan.objects.get_or_create(
                room=room,
                defaults={
                    'generation_method': 'unified_project',
                    'total_area': CeilingService._calculate_room_area(room_data['points']),
                    'total_panels': len(room_panels),
                    'full_panels': len([p for p in room_panels if not p['is_cut']]),
                    'cut_panels': len([p for p in room_panels if p['is_cut']])
                }
            )
            
            if not created:
                ceiling_plan.generation_method = 'unified_project'
                ceiling_plan.total_panels = len(room_panels)
                ceiling_plan.full_panels = len([p for p in room_panels if not p['is_cut']])
                ceiling_plan.cut_panels = len([p for p in room_panels if p['is_cut']])
                ceiling_plan.save()
            
            # Clear existing panels and create new ones
            CeilingPanel.objects.filter(room=room).delete()
            
            # Create panel objects for this room
            for panel_data in room_panels:
                CeilingPanel.objects.create(
                    room=room,
                    panel_id=panel_data['panel_id'],
                    start_x=panel_data['start_x'],
                    start_y=panel_data['start_y'],
                    end_x=panel_data['end_x'],
                    end_y=panel_data['end_y'],
                    width=panel_data['width'],
                    length=panel_data['length'],
                    thickness=20.0,
                    material_type='standard',
                    is_cut_panel=panel_data['is_cut'],
                    cut_notes=panel_data.get('cut_notes', '')
                )
            
            ceiling_plan.update_statistics()
            created_plans.append(ceiling_plan)
        
        return {
            'type': 'unified_project',
            'height': list(height_groups.keys())[0],
            'rooms_covered': len(all_rooms),
            'total_panels': sum(len(CeilingService._filter_panels_for_room(panels, r['points'])) for r in all_rooms),
            'ceiling_plans': created_plans
        }

    @staticmethod
    def _generate_height_group_ceiling_plan(project, height, group_data):
        """Generate ceiling plan for a specific height group"""
        # Generate ceiling plans for each room in the height group
        created_plans = []
        
        for room_data in group_data['rooms']:
            room = Room.objects.get(id=room_data['id'])
            
            # Generate ceiling plan for this individual room
            ceiling_plan = CeilingService.generate_ceiling_plan(room.id)
            created_plans.append(ceiling_plan)
        
        return {
            'type': 'height_group',
            'height': height,
            'rooms_covered': len(group_data['rooms']),
            'total_panels': sum(cp.total_panels for cp in created_plans),
            'ceiling_plans': created_plans
        }

    @staticmethod
    def _calculate_project_bounding_box(all_points):
        """Calculate bounding box for all points across multiple rooms"""
        if not all_points:
            return None
        
        x_coords = [point['x'] for point in all_points]
        y_coords = [point['y'] for point in all_points]
        
        return {
            'min_x': min(x_coords),
            'max_y': max(y_coords),
            'max_x': max(x_coords),
            'min_y': min(y_coords),
            'width': max(x_coords) - min(x_coords),
            'height': max(y_coords) - min(y_coords)
        }

    @staticmethod
    def _filter_panels_for_room(project_panels, room_points):
        """Filter panels that belong to a specific room from project-wide panels"""
        room_panels = []
        
        for panel in project_panels:
            panel_coverage = CeilingService._calculate_panel_coverage([
                {'x': panel['start_x'], 'y': panel['start_y']},
                {'x': panel['end_x'], 'y': panel['start_y']},
                {'x': panel['end_x'], 'y': panel['end_y']},
                {'x': panel['start_x'], 'y': panel['end_y']}
            ], room_points)
            
            if panel_coverage > 0.1:  # Panel has significant coverage in this room
                room_panels.append(panel)
        
        return room_panels 

    @staticmethod
    def _calculate_merge_benefits(rooms, merged_bounding_box, merged_panels):
        """Calculate benefits of merging rooms for ceiling planning"""
        try:
            # Calculate the total area of the merged bounding box
            merged_total_area = merged_bounding_box['width'] * merged_bounding_box['height']
            
            # Calculate the total area of all individual rooms
            total_individual_rooms_area = sum(room_info['area'] for room_info in rooms)
            
            # Calculate potential waste reduction
            potential_waste_reduction = merged_total_area - total_individual_rooms_area
            
            # Calculate efficiency improvement
            efficiency_improvement = (total_individual_rooms_area / merged_total_area * 100) if merged_total_area > 0 else 0
            
            return {
                'merged_total_area': merged_total_area,
                'total_individual_rooms_area': total_individual_rooms_area,
                'potential_waste_reduction': potential_waste_reduction,
                'efficiency_improvement': efficiency_improvement,
                'merge_advantage': potential_waste_reduction > 0
            }
            
        except Exception as e:
            return {
                'merged_total_area': 0,
                'total_individual_rooms_area': 0,
                'potential_waste_reduction': 0,
                'efficiency_improvement': 0,
                'merge_advantage': False,
                'error': str(e)
            }

    @staticmethod
    def _analyze_single_room_orientation_strategies(room, panel_width=1150, panel_length='auto', ceiling_thickness=150):
        """Analyze orientation strategies for a single room"""
        try:
            if not room.room_points or len(room.room_points) < 3:
                return {'error': 'Invalid room geometry'}
            
            strategies = []
            room_info = {
                'id': room.id,
                'name': room.room_name,
                'area': CeilingService._calculate_room_area(room.room_points),
                'room_points': room.room_points
            }
            
            # Calculate room bounding box
            xs = [p['x'] if isinstance(p, dict) else p.x for p in room.room_points]
            ys = [p['y'] if isinstance(p, dict) else p.y for p in room.room_points]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            room_width = max_x - min_x
            room_height = max_y - min_y
            
            # Generate vertical panels for this room
            vertical_panels = CeilingService._generate_shape_aware_panels(
                [room_info], panel_width, panel_length, 'vertical'
            )
            vertical_count = len([p for p in vertical_panels if p.get('room_id') == room.id])
            
            # Generate horizontal panels for this room
            horizontal_panels = CeilingService._generate_shape_aware_panels(
                [room_info], panel_width, panel_length, 'horizontal'
            )
            horizontal_count = len([p for p in horizontal_panels if p.get('room_id') == room.id])
            
            # Add strategies
            strategies.append({
                'strategy_name': 'all_vertical',
                'orientation_type': 'vertical',
                'total_panels': vertical_count,
                'room_width': room_width,
                'room_height': room_height
            })
            
            strategies.append({
                'strategy_name': 'all_horizontal',
                'orientation_type': 'horizontal',
                'total_panels': horizontal_count,
                'room_width': room_width,
                'room_height': room_height
            })
            
            # Recommend based on panel count (fewer panels = less waste typically)
            recommended = 'all_vertical' if vertical_count <= horizontal_count else 'all_horizontal'
            
            return {
                'room_id': room.id,
                'room_name': room.room_name,
                'strategies': strategies,
                'recommended_strategy': recommended
            }
            
        except Exception as e:
            return {'error': f'Failed to analyze room orientation: {str(e)}'}
    
    @staticmethod
    def _generate_panels_for_single_room(room, orientation_strategy, panel_width, panel_length, leftover_tracker=None, ceiling_thickness=150):
        """Generate panels for a single room with specified orientation, with optional leftover tracking and reuse"""
        try:
            # Convert room_points to proper format if needed
            if not room.room_points:
                return []
            
            # Ensure room_points is a list of dicts
            room_points = room.room_points
            if isinstance(room_points, list) and len(room_points) > 0:
                # Convert to list of dicts if needed
                if not isinstance(room_points[0], dict):
                    room_points = [{'x': p.x, 'y': p.y} if hasattr(p, 'x') else {'x': p[0], 'y': p[1]} for p in room_points]
            else:
                return []
            
            if len(room_points) < 3:
                return []
            
            # Calculate bounding box for this room
            xs = [p['x'] for p in room_points]
            ys = [p['y'] for p in room_points]
            bounding_box = {
                'min_x': min(xs),
                'max_x': max(xs),
                'min_y': min(ys),
                'max_y': max(ys),
                'width': max(xs) - min(xs),
                'height': max(ys) - min(ys)
            }
            
            # Determine orientation type
            logger.debug(f"Processing room {room.id} ({room.room_name}) with orientation_strategy: {orientation_strategy}")
            
            if orientation_strategy == 'all_vertical':
                orientation_type = 'vertical'
                logger.debug(f"  → Set to VERTICAL")
            elif orientation_strategy == 'all_horizontal':
                orientation_type = 'horizontal'
                logger.debug(f"  → Set to HORIZONTAL")
            elif orientation_strategy == 'auto':
                # Analyze and pick best
                analysis = CeilingService._analyze_single_room_orientation_strategies(
                    room, panel_width, panel_length, 150
                )
                orientation_type = 'vertical' if analysis.get('recommended_strategy') == 'all_vertical' else 'horizontal'
                logger.debug(f"  → AUTO chose {orientation_type.upper()}")
            else:
                orientation_type = 'vertical'  # Default
                logger.warning(f"  → DEFAULTED to VERTICAL (unknown strategy: {orientation_strategy})")
            
            # Generate panels for this room only (with leftover tracking if provided)
            logger.debug(f"  Generating panels: {bounding_box['width']}x{bounding_box['height']}mm, {len(room_points)} points, {orientation_type}")
            
            panels = CeilingService._generate_shape_aware_panels(
                bounding_box, room_points, orientation_type, panel_width, panel_length, 
                leftover_tracker, ceiling_thickness
            )
            
            logger.debug(f"  Generated {len(panels)} raw panels")
            
            # Log leftover usage if tracker is provided
            if leftover_tracker:
                stats = leftover_tracker.get_stats()
                logger.debug(f"  Leftover stats after room {room.id}: {stats['leftovers_created']} created, {stats['leftovers_reused']} reused")
            
            # Assign room_id to all panels
            for panel in panels:
                panel['room_id'] = room.id
                panel['room_name'] = room.room_name
            
            logger.info(f"Successfully generated {len(panels)} panels for room {room.id} ({room.room_name}) with {orientation_type} orientation")
            
            return panels
            
        except Exception as e:
            logger.error(f"Error generating panels for room {room.id}: {str(e)}")
            logger.error(f"  room_points type: {type(room.room_points)}")
            logger.error(f"  room_points value: {room.room_points}")
            import traceback
            logger.error(traceback.format_exc())
            return []
    
    @staticmethod
    def _generate_panels_with_room_specific_orientation(project_id, global_panel_width, global_panel_length, 
                                                          global_ceiling_thickness, global_orientation_strategy, room_specific_config):
        """Generate panels for all rooms, with each room using its own orientation, with leftover tracking and reuse"""
        try:
            from .models import Room
            
            # Create leftover tracker for cross-room leftover reuse
            leftover_tracker = LeftoverTracker(context='GENERATION')
            logger.info("ROOM-SPECIFIC GENERATION STARTING - Created project leftover tracker")
            
            all_panels = []
            rooms = Room.objects.filter(project_id=project_id)
            
            # Get the room ID that has custom configuration
            custom_room_id = room_specific_config.get('room_id')
            custom_orientation = room_specific_config.get('orientation_strategy', global_orientation_strategy)
            
            logger.info(f"Generating ceiling panels for {rooms.count()} rooms (room-specific mode)")
            
            for room in rooms:
                # Determine orientation for this room
                if str(room.id) == str(custom_room_id):
                    # This is the room being updated - use custom orientation
                    room_orientation = custom_orientation
                    logger.info(f"  Room {room.id} ({room.room_name}): Using CUSTOM orientation = {room_orientation}")
                else:
                    # Check if room has existing ceiling plan with orientation
                    if hasattr(room, 'ceiling_plan') and room.ceiling_plan and room.ceiling_plan.orientation_strategy:
                        room_orientation = room.ceiling_plan.orientation_strategy
                        logger.info(f"  Room {room.id} ({room.room_name}): Using SAVED orientation = {room_orientation}")
                    else:
                        room_orientation = global_orientation_strategy
                        logger.info(f"  Room {room.id} ({room.room_name}): Using GLOBAL orientation = {room_orientation}")
                
                # Generate panels for this room with its specific orientation (with leftover tracking)
                room_panels = CeilingService._generate_panels_for_single_room(
                    room, room_orientation, global_panel_width, global_panel_length, 
                    leftover_tracker, global_ceiling_thickness
                )
                
                logger.info(f"  > Generated {len(room_panels)} panels for room {room.id}")
                
                # Add to all panels
                all_panels.extend(room_panels)
            
            logger.info(f"Total panels generated: {len(all_panels)}")
            
            # Log leftover statistics
            leftover_stats = leftover_tracker.get_stats()
            logger.info(f"ROOM-SPECIFIC GENERATION COMPLETE - Leftover stats: {leftover_stats}")
            
            return all_panels, leftover_tracker
            
        except Exception as e:
            logger.error(f"Error in _generate_panels_with_room_specific_orientation: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return [], LeftoverTracker(context='GENERATION')
    
    @staticmethod
    def generate_enhanced_ceiling_plan(project_id, orientation_strategy='auto', panel_width=1150, panel_length='auto', 
                                      ceiling_thickness=150, custom_panel_length=None, support_type='nylon', support_config=None, room_specific_config=None):
        """Stage 3: Generate enhanced ceiling plan with intelligent panel placement
        
        Features:
        - Handles irregular/complex shapes correctly
        - Distinguishes between waste and reusable cut panels
        - Optimizes panel placement for minimal waste
        - Supports different orientation strategies
        """
        try:
            # Check if we have room-specific configuration
            if room_specific_config and room_specific_config.get('room_id'):
                logger.info(f"Room-specific ceiling configuration detected for room {room_specific_config.get('room_id')}")
                logger.debug(f"Config: {room_specific_config}")
                
                # Room-specific generation: generate each room with its own orientation (with leftover tracking)
                enhanced_panels, project_leftover_tracker = CeilingService._generate_panels_with_room_specific_orientation(
                    project_id, panel_width, panel_length, ceiling_thickness,
                    orientation_strategy, room_specific_config
                )
                
                # Get leftover stats from tracker
                leftover_stats = project_leftover_tracker.get_stats()
                logger.info(f"ROOM-SPECIFIC GENERATION - Leftover stats: {leftover_stats}")
                
                # Use a dummy strategy for metadata
                orientation_analysis = CeilingService.analyze_orientation_strategies(
                    project_id, panel_width, panel_length, ceiling_thickness
                )
                if 'error' in orientation_analysis:
                    return {'error': orientation_analysis['error']}
                selected_strategy = orientation_analysis['strategies'][0] if orientation_analysis['strategies'] else {}
                strategy_name = 'mixed'
            else:
                # Original logic: single orientation for all rooms
                # Get orientation analysis first
                orientation_analysis = CeilingService.analyze_orientation_strategies(
                    project_id, 
                    panel_width, 
                    panel_length, 
                    ceiling_thickness
                )
                if 'error' in orientation_analysis:
                    return {'error': orientation_analysis['error']}
                
                # Determine which strategy to use
                if orientation_strategy == 'auto':
                    # Use the recommended strategy
                    strategy_name = orientation_analysis['recommended_strategy']
                else:
                    # Use the specified strategy
                    strategy_name = orientation_strategy
                    
                # Find the selected strategy
                selected_strategy = None
                for strategy in orientation_analysis['strategies']:
                    if strategy['strategy_name'] == strategy_name:
                        selected_strategy = strategy
                        break
                
                if not selected_strategy:
                    return {'error': f'Strategy {strategy_name} not found'}
                
                # Generate enhanced panels based on the selected strategy with leftover tracking
                enhanced_panels, leftover_stats = CeilingService._generate_enhanced_panels_for_strategy(
                    selected_strategy, project_id, panel_width, panel_length, ceiling_thickness
                )
            
            # Calculate enhanced waste analysis
            waste_analysis = CeilingService._analyze_enhanced_waste(enhanced_panels, selected_strategy)
            
            # Calculate project-wide waste percentage using leftover area
            # Formula: waste% = Leftover Area / Total Room Area × 100%
            total_room_area = selected_strategy.get('total_room_area', 0)
            leftover_area = leftover_stats.get('total_leftover_area', 0)
            
            if total_room_area > 0 and leftover_area > 0:
                project_waste_percentage = (leftover_area / total_room_area) * 100
                print(f"🎯 [PROJECT] Project-wide waste calculation:")
                print(f"🎯 [PROJECT] Total Room Area: {total_room_area:,.0f} mm²")
                print(f"🎯 [PROJECT] Total Leftover Area: {leftover_area:,.0f} mm²")
                print(f"🎯 [PROJECT] Project Waste Percentage: {project_waste_percentage:.1f}%")
            else:
                project_waste_percentage = 0.0
                print(f"⚠️ [PROJECT] Cannot calculate project waste: room_area={total_room_area}, leftover_area={leftover_area}")
            
            # Create or update ceiling plans with ALL generation parameters
            ceiling_plans = CeilingService._create_enhanced_ceiling_plans(
                enhanced_panels, project_id, selected_strategy, ceiling_thickness,
                panel_width, panel_length, custom_panel_length, orientation_strategy,
                support_type, support_config, room_specific_config, leftover_stats
            )
            return {
                'project_id': project_id,
                'strategy_used': strategy_name,
                'recommended_strategy': orientation_analysis.get('recommended_strategy', strategy_name),  # Always include system recommendation
                'strategy_details': selected_strategy,
                'enhanced_panels': enhanced_panels,
                'leftover_stats': leftover_stats,  # Include leftover statistics
                'waste_analysis': waste_analysis,
                'ceiling_plans': ceiling_plans,
                'summary': {
                    'total_panels': len(enhanced_panels),
                    'total_waste_percentage': waste_analysis['total_waste_percentage'],
                    'project_waste_percentage': project_waste_percentage,  # Add project-wide waste percentage
                    'recommended_strategy': orientation_analysis.get('recommended_strategy', strategy_name),  # Add to summary too
                    'reusable_cut_panels': waste_analysis['reusable_cut_panels'],
                    'actual_waste_percentage': waste_analysis['actual_waste_percentage'],
                    'efficiency_improvement': waste_analysis['efficiency_improvement'],
                    'leftovers_created': leftover_stats.get('leftovers_created', 0),
                    'leftovers_reused': leftover_stats.get('leftovers_reused', 0),
                    'full_panels_saved': leftover_stats.get('full_panels_saved', 0)
                }
            }
            
        except Exception as e:
            return {'error': f'Enhanced ceiling plan generation failed: {str(e)}'}

    @staticmethod
    def _generate_enhanced_panels_for_strategy(strategy, project_id, panel_width=1150, panel_length='auto', ceiling_thickness=20):
        """Generate enhanced panels for the selected strategy with better shape handling and leftover tracking"""
        try:
            enhanced_panels = []
            
            # Create project-wide leftover tracker for actual generation
            project_leftover_tracker = LeftoverTracker(context='GENERATION')
            logger.info(f"ACTUAL CEILING GENERATION STARTING - Created project leftover tracker")
            
            if strategy['orientation_type'] == 'merged':
                # Generate panels for merged approach with leftover tracking
                enhanced_panels = CeilingService._generate_enhanced_merged_panels(
                    project_id, panel_width, panel_length, project_leftover_tracker, ceiling_thickness
                )
            else:
                # Generate panels for individual rooms with leftover tracking
                enhanced_panels = CeilingService._generate_enhanced_room_panels(
                    strategy, panel_width, panel_length, project_leftover_tracker, ceiling_thickness
                )
            
            # Apply advanced optimization
            enhanced_panels = CeilingService._optimize_panel_placement(enhanced_panels)
            
            # Get leftover statistics
            leftover_stats = project_leftover_tracker.get_stats()
            logger.info(f"CEILING GENERATION COMPLETE - Leftover stats: {leftover_stats}")
            
            return enhanced_panels, leftover_stats
            
        except Exception as e:
            return [], {}

    @staticmethod
    def _generate_enhanced_merged_panels(project_id, panel_width=1150, panel_length='auto', leftover_tracker=None, ceiling_thickness=20):
        """Generate enhanced panels for merged project approach with leftover tracking"""
        try:
            # Get height analysis
            height_analysis = CeilingService.analyze_project_heights(project_id)
            if 'error' in height_analysis:
                return []
            
            # Get all rooms from the single height group
            height_group = list(height_analysis['height_groups'].values())[0]
            
            # FIXED: Generate panels for each room individually instead of using project-wide bounding box
            all_panels = []
            
            for i, room_info in enumerate(height_group['rooms']):
                # Use room-specific bounding box instead of project-wide
                room_bounding_box = CeilingService._calculate_room_bounding_box(room_info['points'])
                # Generate panels for this specific room using its own bounding box with leftover tracking
                room_panels = CeilingService._generate_advanced_panels(
                    room_bounding_box, room_info['points'], 'horizontal', panel_width, panel_length, leftover_tracker, ceiling_thickness
                )
                # Add room identifier to panels
                for panel in room_panels:
                    panel['room_id'] = room_info['id']
                    panel['room_name'] = room_info['name']
                
                all_panels.extend(room_panels)
            
            return all_panels
            
        except Exception as e:
            return []

    @staticmethod
    def _generate_enhanced_room_panels(strategy, panel_width=1150, panel_length='auto', leftover_tracker=None, ceiling_thickness=20):
        """Generate enhanced panels for individual rooms with leftover tracking"""
        try:
            all_panels = []
            
            logger.info(f"_generate_enhanced_room_panels: Processing {len(strategy.get('room_results', []))} rooms")
            
            for room_result in strategy.get('room_results', []):
                room_id = room_result.get('room_id')
                logger.info(f"  Processing room {room_id}: {room_result.get('room_name')}")
                
                # Get room info from height analysis
                room_info = CeilingService._get_room_info_by_id(room_id)
                if not room_info:
                    logger.warning(f"  Could not get room info for room {room_id}")
                    continue
                
                # Generate panels with the specified orientation and leftover tracking
                orientation = room_result['orientation']
                logger.info(f"  Generating {orientation} panels for room {room_id}")
                
                panels = CeilingService._generate_advanced_panels(
                    room_info['bounding_box'], room_info['points'], orientation, panel_width, panel_length, leftover_tracker, ceiling_thickness
                )
                
                logger.info(f"  Generated {len(panels)} panels for room {room_id}")
                
                # Add room identifier to panels
                for panel in panels:
                    panel['room_id'] = room_id
                    panel['room_name'] = room_result['room_name']
                
                all_panels.extend(panels)
            
            logger.info(f"_generate_enhanced_room_panels: Total panels generated: {len(all_panels)}")
            return all_panels
            
        except Exception as e:
            logger.error(f"Error in _generate_enhanced_room_panels: {e}")
            return []

    @staticmethod
    def _generate_advanced_panels(bounding_box, room_points, orientation, panel_width=1150, panel_length='auto', leftover_tracker=None, ceiling_thickness=20):
        """Generate advanced panels with better irregular shape handling and leftover tracking"""
        try:
            if orientation == 'vertical':
                # Vertical orientation: panels run up and down (vertical strips)
                return CeilingService._generate_horizontal_panels(
                    bounding_box, room_points, panel_width, panel_length, leftover_tracker, ceiling_thickness
                )
            elif orientation == 'horizontal':
                # Horizontal orientation: panels run left to right (horizontal strips)
                return CeilingService._generate_vertical_panels(
                    bounding_box, room_points, panel_width, panel_length, leftover_tracker, ceiling_thickness
                )
            elif orientation == 'merged':
                # For merged approach, use horizontal orientation as default
                return CeilingService._generate_vertical_panels(
                    bounding_box, room_points, panel_width, panel_length, leftover_tracker, ceiling_thickness
                )
            else:
                return []
                
        except Exception as e:
            return []

    @staticmethod
    def _generate_enhanced_vertical_panels(bounding_box, room_points, panel_width=1150, panel_length='auto'):
        """Generate enhanced panels that run left to right (horizontal strips) - used for horizontal orientation"""
        panels = []
        max_panel_width = panel_width  # Use user-specified panel width
        
        # FIXED: Calculate room-specific bounding box instead of using the passed bounding_box
        room_bounding_box = CeilingService._calculate_room_bounding_box(room_points)
        
        room_width = room_bounding_box['width']
        room_height = room_bounding_box['height']
        
        # Calculate panel width based on user's choice
        if panel_length == 'auto':
            # Use full room width when auto (equivalent to panel_length_option = 1)
            panel_width = room_width
        else:
            # Use user's custom panel length
            panel_width = float(panel_length)
        
        # Use advanced L-shaped room aware algorithm with room-specific bounding box
        panels = CeilingService._generate_shape_aware_panels(
            room_bounding_box, room_points, 'horizontal', max_panel_width, panel_length
        )
        
        # Panel width optimization removed as requested - return panels as-is
        return panels

    @staticmethod
    def _generate_enhanced_horizontal_panels(bounding_box, room_points, panel_width=1150, panel_length='auto'):
        """Generate enhanced panels that run up and down (vertical strips) - used for vertical orientation"""
        panels = []
        max_panel_width = panel_width  # Use user-specified panel width
        
        # FIXED: Calculate room-specific bounding box instead of using the passed bounding_box
        room_bounding_box = CeilingService._calculate_room_bounding_box(room_points)
        
        room_width = room_bounding_box['width']
        room_height = room_bounding_box['height']
        
        # Calculate panel height based on user's choice
        if panel_length == 'auto':
            # Use full room height when auto (equivalent to panel_length_option = 1)
            panel_height = room_height
        else:
            # Use user's custom panel length
            panel_height = float(panel_length)
        
        # Use advanced L-shaped room aware algorithm with room-specific bounding box
        panels = CeilingService._generate_shape_aware_panels(
            room_bounding_box, room_points, 'vertical', max_panel_width, panel_length
        )
        
        # Panel width optimization removed as requested - return panels as-is
        return panels

    @staticmethod
    def _calculate_enhanced_panel_coverage(start_x, start_y, width, height, room_points):
        """Calculate enhanced panel coverage within room boundaries"""
        try:
            # Create panel corners
            panel_corners = [
                {'x': start_x, 'y': start_y},
                {'x': start_x + width, 'y': start_y},
                {'x': start_x + width, 'y': start_y + height},
                {'x': start_x, 'y': start_y + height}
            ]
            
            # Calculate panel center
            center_x = start_x + width / 2
            center_y = start_y + height / 2
            
            # Check if panel center is within room
            if CeilingService._is_point_in_polygon(center_x, center_y, room_points):
                return 1.0  # Full coverage
            
            # Check corner coverage
            corners_in_room = 0
            for corner in panel_corners:
                if CeilingService._is_point_in_polygon(corner['x'], corner['y'], room_points):
                    corners_in_room += 1
            
            # Calculate coverage based on corners
            if corners_in_room == 0:
                return 0.0  # No coverage
            elif corners_in_room == 4:
                return 1.0  # Full coverage
            else:
                # Partial coverage - estimate based on corners
                return corners_in_room / 4.0
                
        except Exception as e:
            return 0.0

    @staticmethod
    def _optimize_panel_placement(panels):
        """Optimize panel placement to minimize waste and maximize efficiency"""
        try:
            if not panels:
                return panels
            
            # Sort panels by area (largest first) to prioritize larger panels
            panels.sort(key=lambda x: x.get('area', 0), reverse=True)
            
            # Mark panels that can potentially be reused
            for panel in panels:
                if panel.get('is_cut', False):
                    # Check if this cut panel could be reused elsewhere
                    panel['potentially_reusable'] = CeilingService._is_panel_reusable(panel, panels)
                else:
                    panel['potentially_reusable'] = False
            
            return panels
            
        except Exception as e:
            return panels

    @staticmethod
    def _is_panel_reusable(panel, all_panels):
        """Check if a cut panel could potentially be reused"""
        try:
            # This is a simplified check - in reality you'd analyze if the cut piece
            # could fit in other areas of the ceiling plan
            
            panel_area = panel.get('area', 0)
            if panel_area < 100000:  # Less than 0.1 m² - likely not reusable
                return False
            
            # Check if there are other areas where this panel could fit
            # For now, we'll assume panels larger than 0.1 m² are potentially reusable
            return panel_area >= 100000
            
        except Exception:
            return False

    @staticmethod
    def _analyze_enhanced_waste(enhanced_panels, strategy):
        """Analyze waste with distinction between actual waste and reusable cut panels
        
        New formula: waste% = (Total Panel Area - Room Area) / Total Panel Area × 100%
        This represents "what percentage of the panels purchased is wasted"
        """
        try:
            total_panel_area = sum(panel.get('area', 0) for panel in enhanced_panels)
            total_room_area = strategy.get('total_room_area', 0)
            
            if total_panel_area == 0:
                return {
                    'total_waste_area': 0,
                    'total_waste_percentage': 0,
                    'actual_waste_area': 0,
                    'actual_waste_percentage': 0,
                    'reusable_cut_panels': 0,
                    'reusable_cut_area': 0,
                    'efficiency_improvement': 0
                }
            
            # Calculate total waste area
            total_waste_area = max(0, total_panel_area - total_room_area)
            
            # Identify reusable cut panels
            reusable_cut_panels = []
            actual_waste_area = 0
            
            for panel in enhanced_panels:
                if panel.get('is_cut', False):
                    if panel.get('potentially_reusable', False):
                        reusable_cut_panels.append(panel)
                    else:
                        actual_waste_area += panel.get('area', 0)
            
            # Calculate waste percentages using new formula: (waste / total_panels) × 100
            total_waste_percentage = (total_waste_area / total_panel_area * 100)
            actual_waste_percentage = (actual_waste_area / total_panel_area * 100)
            
            # Calculate efficiency improvement
            efficiency_improvement = max(0, total_waste_percentage - actual_waste_percentage)
            
            return {
                'total_waste_area': total_waste_area,
                'total_waste_percentage': total_waste_percentage,
                'actual_waste_area': actual_waste_area,
                'actual_waste_percentage': actual_waste_percentage,
                'reusable_cut_panels': len(reusable_cut_panels),
                'reusable_cut_area': sum(p.get('area', 0) for p in reusable_cut_panels),
                'efficiency_improvement': efficiency_improvement
            }
            
        except Exception as e:
            return {
                'total_waste_area': 0,
                'total_waste_percentage': 0,
                'actual_waste_area': 0,
                'actual_waste_percentage': 0,
                'reusable_cut_panels': 0,
                'reusable_cut_area': 0,
                'efficiency_improvement': 0
            }

    @staticmethod
    def _create_enhanced_ceiling_plans(enhanced_panels, project_id, strategy, ceiling_thickness=150, 
                                      panel_width=1150, panel_length='auto', custom_panel_length=None,
                                      orientation_strategy='auto', support_type='nylon', support_config=None, room_specific_config=None, leftover_stats=None):
        """Create or update ceiling plans with enhanced panel information and generation parameters"""
        try:
            from .models import CeilingPlan, CeilingPanel, Room
            
            # Group panels by room
            room_panels = {}
            for panel in enhanced_panels:
                room_id = panel.get('room_id')
                if room_id not in room_panels:
                    room_panels[room_id] = []
                room_panels[room_id].append(panel)
            
            created_plans = []
            
            for room_id, panels in room_panels.items():
                try:
                    room = Room.objects.get(id=room_id)
                    
                    # Calculate room area
                    room_area = CeilingService._calculate_room_area(room.room_points)
                    
                    # Get room-specific config or use defaults
                    room_config = room_specific_config if room_specific_config and str(room_id) == str(room_specific_config.get('room_id')) else None
                    
                    # Use room-specific config if available, otherwise use global params
                    room_ceiling_thickness = room_config.get('ceiling_thickness', ceiling_thickness) if room_config else ceiling_thickness
                    room_panel_width = room_config.get('panel_width', panel_width) if room_config else panel_width
                    room_panel_length = room_config.get('panel_length', panel_length) if room_config else panel_length
                    room_custom_panel_length = room_config.get('custom_panel_length', custom_panel_length) if room_config else custom_panel_length
                    room_orientation_strategy = room_config.get('orientation_strategy', orientation_strategy) if room_config else orientation_strategy
                    room_support_type = room_config.get('support_type', support_type) if room_config else support_type
                    room_support_config = room_config.get('support_config', support_config) if room_config else support_config
                    
                    # Prepare support configuration
                    if room_support_config is None:
                        room_support_config = {}
                    
                    # Create or update ceiling plan with ALL generation parameters
                    ceiling_plan, created = CeilingPlan.objects.get_or_create(
                        room=room,
                        defaults={
                            'generation_method': 'enhanced_automatic',
                            'total_area': room_area,
                            'total_panels': len(panels),
                            'full_panels': len([p for p in panels if not p.get('is_cut', False)]),
                            'cut_panels': len([p for p in panels if p.get('is_cut', False)]),
                            # CRITICAL: Save all generation parameters (room-specific or global)
                            'ceiling_thickness': room_ceiling_thickness,
                            'orientation_strategy': room_orientation_strategy,
                            'panel_width': room_panel_width,
                            'panel_length': room_panel_length,
                            'custom_panel_length': room_custom_panel_length,
                            'support_type': room_support_type,
                            'support_config': room_support_config
                        }
                    )
                    
                    if not created:
                        # Update existing plan with new parameters (room-specific or global)
                        ceiling_plan.generation_method = 'enhanced_automatic'
                        ceiling_plan.total_panels = len(panels)
                        ceiling_plan.full_panels = len([p for p in panels if not p.get('is_cut', False)])
                        ceiling_plan.cut_panels = len([p for p in panels if p.get('is_cut', False)])
                        # CRITICAL: Update generation parameters (room-specific or global)
                        ceiling_plan.ceiling_thickness = room_ceiling_thickness
                        ceiling_plan.orientation_strategy = room_orientation_strategy
                        ceiling_plan.panel_width = room_panel_width
                        ceiling_plan.panel_length = room_panel_length
                        ceiling_plan.custom_panel_length = room_custom_panel_length
                        ceiling_plan.support_type = room_support_type
                        ceiling_plan.support_config = room_support_config
                        ceiling_plan.save()
                    
                    # Clear existing panels and create new ones
                    CeilingPanel.objects.filter(room=room).delete()
                    
                    # Create enhanced panel objects
                    for panel_data in panels:
                        CeilingPanel.objects.create(
                            room=room,
                            panel_id=panel_data['panel_id'],
                            start_x=panel_data['start_x'],
                            start_y=panel_data['start_y'],
                            end_x=panel_data['end_x'],
                            end_y=panel_data['end_y'],
                            width=panel_data['width'],
                            length=panel_data['length'],
                            thickness=room_ceiling_thickness,  # Use room-specific or global thickness
                            material_type='standard',
                            is_cut_panel=panel_data.get('is_cut', False),
                            cut_notes=panel_data.get('cut_notes', '')
                        )
                    
                    # Create a dummy leftover tracker for individual room calculations
                    # The project-wide waste calculation is done at the service level
                    ceiling_plan.update_statistics()
                    
                    # Convert to serializable dictionary with ALL parameters
                    plan_dict = {
                        'id': ceiling_plan.id,
                        'room_id': ceiling_plan.room.id,
                        'room_name': ceiling_plan.room.room_name,
                        'generation_method': ceiling_plan.generation_method,
                        'total_area': ceiling_plan.total_area,
                        'total_panels': ceiling_plan.total_panels,
                        'full_panels': ceiling_plan.full_panels,
                        'cut_panels': ceiling_plan.cut_panels,
                        'waste_percentage': ceiling_plan.waste_percentage,
                        # CRITICAL: Include all generation parameters in response
                        'ceiling_thickness': ceiling_plan.ceiling_thickness,
                        'orientation_strategy': ceiling_plan.orientation_strategy,
                        'panel_width': ceiling_plan.panel_width,
                        'panel_length': ceiling_plan.panel_length,
                        'custom_panel_length': ceiling_plan.custom_panel_length,
                        'support_type': ceiling_plan.support_type,
                        'support_config': ceiling_plan.support_config,
                        'created_at': ceiling_plan.created_at.isoformat() if ceiling_plan.created_at else None,
                        'updated_at': ceiling_plan.updated_at.isoformat() if ceiling_plan.updated_at else None
                    }
                    
                    created_plans.append(plan_dict)
                    
                except Room.DoesNotExist:
                    print(f"Room {room_id} not found")
                    continue
                except Exception as e:
                    print(f"Error creating ceiling plan for room {room_id}: {str(e)}")
                    continue
            
            return created_plans
            
        except Exception as e:
            return []

    @staticmethod
    def _get_room_info_by_id(room_id):
        """Get room info from height analysis by room ID"""
        try:
            # This is a simplified implementation - in a real scenario you'd cache the height analysis
            # For now, we'll get the room directly from the database
            from .models import Room
            
            room = Room.objects.get(id=room_id)
            if not room.room_points or len(room.room_points) < 3:
                return None
            
            # Calculate room info
            room_area = CeilingService._calculate_room_area(room.room_points)
            bounding_box = CeilingService._calculate_room_bounding_box(room.room_points)
            center = CeilingService._calculate_room_center(room.room_points)
            
            return {
                'id': room.id,
                'name': room.room_name,
                'points': room.room_points,
                'area': room_area,
                'center': center,
                'bounding_box': bounding_box
            }
            
        except Room.DoesNotExist:
            return None
        except Exception as e:
            return None

    @staticmethod
    def generate_project_ceiling_report(project_id, include_detailed_analysis=True):
        """Stage 5: Generate comprehensive project-level ceiling plan report
        
        Features:
        - All rooms with their panels and orientations
        - Which orientation is recommended vs chosen
        - Summary data: panels used, waste percentage, orientation decisions
        - Detailed analysis of each room's ceiling plan
        """
        try:
            # Get comprehensive project analysis
            height_analysis = CeilingService.analyze_project_heights(project_id)
            if 'error' in height_analysis:
                return {'error': height_analysis['error']}
            
            orientation_analysis = CeilingService.analyze_orientation_strategies(project_id, 1)
            if 'error' in orientation_analysis:
                return {'error': orientation_analysis['error']}
            
            # Generate enhanced ceiling plan with recommended strategy
            enhanced_plan = CeilingService.generate_enhanced_ceiling_plan(
                project_id, 1, 'auto'
            )
            if 'error' in enhanced_plan:
                return {'error': enhanced_plan['error']}
            
            # Compile comprehensive report
            report = CeilingService._compile_project_report(
                project_id, height_analysis, orientation_analysis, enhanced_plan, include_detailed_analysis
            )
            
            return report
            
        except Exception as e:
            return {'error': f'Project ceiling report generation failed: {str(e)}'}

    @staticmethod
    def _compile_project_report(project_id, height_analysis, orientation_analysis, enhanced_plan, include_detailed_analysis):
        """Compile comprehensive project ceiling report"""
        try:
            from .models import Project, Room, CeilingPlan, CeilingPanel
            
            project = Project.objects.get(id=project_id)
            
            # Get all rooms and their ceiling plans
            rooms = Room.objects.filter(project=project)
            room_reports = []
            
            total_project_panels = 0
            total_project_waste = 0.0
            total_project_area = 0.0
            
            for room in rooms:
                try:
                    # Get room ceiling plan
                    ceiling_plan = CeilingPlan.objects.filter(room=room).first()
                    ceiling_panels = CeilingPanel.objects.filter(room=room) if ceiling_plan else []
                    
                    # Calculate room statistics
                    room_area = CeilingService._calculate_room_area(room.room_points)
                    total_project_area += room_area
                    
                    room_panels_count = len(ceiling_panels)
                    total_project_panels += room_panels_count
                    
                    # Calculate room waste
                    room_waste_area = 0.0
                    if ceiling_panels:
                        total_panel_area = sum(panel.width * panel.length for panel in ceiling_panels)
                        room_waste_area = max(0, total_panel_area - room_area)
                        total_project_waste += room_waste_area
                    
                    # Get room orientation from enhanced plan
                    room_orientation = 'unknown'
                    room_waste_percentage = 0.0
                    if enhanced_plan and 'enhanced_panels' in enhanced_plan:
                        room_panels = [p for p in enhanced_plan['enhanced_panels'] if p.get('room_id') == room.id]
                        if room_panels:
                            room_orientation = room_panels[0].get('orientation', 'unknown')
                            # Calculate waste percentage for this room using new formula
                            room_total_panel_area = sum(p.get('area', 0) for p in room_panels)
                            room_waste_percentage = ((room_total_panel_area - room_area) / room_total_panel_area * 100) if room_total_panel_area > 0 else 0
                    
                    # Determine if this orientation is recommended
                    is_recommended_orientation = False
                    if orientation_analysis and 'recommended_strategy' in orientation_analysis:
                        recommended_strategy = orientation_analysis['recommended_strategy']
                        for strategy in orientation_analysis['strategies']:
                            if strategy['strategy_name'] == recommended_strategy:
                                for room_result in strategy['room_results']:
                                    if room_result['room_id'] == room.id:
                                        is_recommended_orientation = (room_result['orientation'] == room_orientation)
                                        break
                                break
                    
                    room_report = {
                        'room_id': room.id,
                        'room_name': room.room_name,
                        'room_height': room.height,
                        'room_area': room_area,
                        'ceiling_plan_exists': ceiling_plan is not None,
                        'total_panels': room_panels_count,
                        'full_panels': len([p for p in ceiling_panels if not p.is_cut_panel]),
                        'cut_panels': len([p for p in ceiling_panels if p.is_cut_panel]),
                        'orientation': room_orientation,
                        'is_recommended_orientation': is_recommended_orientation,
                        'waste_area': room_waste_area,
                        'waste_percentage': room_waste_percentage,
                        'panels': []
                    }
                    
                    # Add detailed panel information if requested
                    if include_detailed_analysis and ceiling_panels:
                        for panel in ceiling_panels:
                            panel_info = {
                                'panel_id': panel.panel_id,
                                'start_x': panel.start_x,
                                'start_y': panel.start_y,
                                'end_x': panel.end_x,
                                'end_y': panel.end_y,
                                'width': panel.width,
                                'length': panel.length,
                                'is_cut': panel.is_cut_panel,
                                'cut_notes': panel.cut_notes,
                                'area': panel.width * panel.length
                            }
                            room_report['panels'].append(panel_info)
                    
                    room_reports.append(room_report)
                    
                except Exception as e:
                    print(f"Error processing room {room.id}: {str(e)}")
                    continue
            
            # Calculate project-level statistics
            total_waste_percentage = (total_project_waste / total_project_area * 100) if total_project_area > 0 else 0
            
            # Determine overall project strategy
            project_strategy = enhanced_plan.get('strategy_used', 'unknown')
            recommended_strategy = orientation_analysis.get('recommended_strategy', 'unknown')
            strategy_match = project_strategy == recommended_strategy
            
            # Compile final report
            report = {
                'project_id': project_id,
                'project_name': project.name,
                'report_timestamp': timezone.now().isoformat(),
                'summary': {
                    'total_rooms': len(rooms),
                    'total_panels': total_project_panels,
                    'total_area': total_project_area,
                    'total_waste_area': total_project_waste,
                    'total_waste_percentage': total_waste_percentage,
                    'project_strategy': project_strategy,
                    'recommended_strategy': recommended_strategy,
                    'strategy_match': strategy_match,
                    'efficiency_score': max(0, 100 - total_waste_percentage)
                },
                'height_analysis': {
                    'height_levels': height_analysis.get('summary', {}).get('height_levels', 0),
                    'all_same_height': height_analysis.get('all_same_height', False),
                    'recommended_strategy': height_analysis.get('recommended_strategy', 'unknown')
                },
                'orientation_analysis': {
                    'total_strategies': orientation_analysis.get('summary', {}).get('total_strategies', 0),
                    'best_waste_percentage': orientation_analysis.get('summary', {}).get('best_waste_percentage', 0),
                    'worst_waste_percentage': orientation_analysis.get('summary', {}).get('worst_waste_percentage', 0),
                    'waste_savings': orientation_analysis.get('total_waste_savings', 0)
                },
                'room_reports': room_reports,
                'recommendations': CeilingService._generate_project_recommendations(
                    height_analysis, orientation_analysis, enhanced_plan, room_reports
                )
            }
            
            return report
            
        except Exception as e:
            return {'error': f'Report compilation failed: {str(e)}'}

    @staticmethod
    def _generate_project_recommendations(height_analysis, orientation_analysis, enhanced_plan, room_reports):
        """Generate actionable recommendations for the project"""
        try:
            recommendations = []
            
            # Height-based recommendations
            if height_analysis.get('all_same_height', False):
                recommendations.append({
                    'type': 'height_optimization',
                    'priority': 'high',
                    'title': 'Unified Ceiling Planning',
                    'description': 'All rooms have the same height. Consider using unified ceiling planning to reduce waste and improve efficiency.',
                    'action': 'Use project_merged strategy for optimal results'
                })
            else:
                recommendations.append({
                    'type': 'height_optimization',
                    'priority': 'medium',
                    'title': 'Height-Grouped Planning',
                    'description': 'Rooms have different heights. Group rooms by height for optimal ceiling planning.',
                    'action': 'Use height_grouped strategy for different height levels'
                })
            
            # Orientation recommendations
            if orientation_analysis:
                best_strategy = orientation_analysis.get('recommended_strategy', 'unknown')
                current_strategy = enhanced_plan.get('strategy_used', 'unknown')
                
                if best_strategy != current_strategy:
                    recommendations.append({
                        'type': 'orientation_optimization',
                        'priority': 'high',
                        'title': 'Strategy Mismatch',
                        'description': f'Current strategy ({current_strategy}) differs from recommended strategy ({best_strategy}).',
                        'action': f'Switch to {best_strategy} strategy for better waste reduction'
                    })
                
                waste_savings = orientation_analysis.get('total_waste_savings', 0)
                if waste_savings > 0:
                    recommendations.append({
                        'type': 'waste_reduction',
                        'priority': 'medium',
                        'title': 'Waste Reduction Opportunity',
                        'description': f'Potential waste savings of {waste_savings:.2f}% by using recommended strategy.',
                        'action': 'Implement recommended orientation strategy'
                    })
            
            # Room-specific recommendations
            rooms_with_high_waste = [r for r in room_reports if r.get('waste_percentage', 0) > 5.0]
            if rooms_with_high_waste:
                recommendations.append({
                    'type': 'room_optimization',
                    'priority': 'medium',
                    'title': 'High Waste Rooms',
                    'description': f'{len(rooms_with_high_waste)} rooms have waste above 5%.',
                    'action': 'Review panel layout for these rooms',
                    'affected_rooms': [r['room_name'] for r in rooms_with_high_waste]
                })
            
            # Panel optimization recommendations
            total_cut_panels = sum(r.get('cut_panels', 0) for r in room_reports)
            if total_cut_panels > 0:
                recommendations.append({
                    'type': 'panel_optimization',
                    'priority': 'low',
                    'title': 'Cut Panel Optimization',
                    'description': f'{total_cut_panels} cut panels detected. Some may be reusable.',
                    'action': 'Review cut panels for potential reuse across rooms'
                })
            
            return recommendations
            
        except Exception as e:
            return []

    @staticmethod
    def export_ceiling_report_to_csv(project_id, report_data=None):
        """Export ceiling report to CSV format"""
        try:
            import csv
            from io import StringIO
            
            if not report_data:
                report_data = CeilingService.generate_project_ceiling_report(project_id)
            
            if 'error' in report_data:
                return {'error': report_data['error']}
            
            # Create CSV content
            output = StringIO()
            writer = csv.writer(output)
            
            # Write header
            writer.writerow(['Project Ceiling Report'])
            writer.writerow(['Project:', report_data['project_name']])
            writer.writerow(['Generated:', report_data['report_timestamp']])
            writer.writerow([])
            
            # Write summary
            summary = report_data['summary']
            writer.writerow(['SUMMARY'])
            writer.writerow(['Total Rooms', 'Total Panels', 'Total Area (mm²)', 'Waste %', 'Efficiency Score'])
            writer.writerow([
                summary['total_rooms'],
                summary['total_panels'],
                summary['total_area'],
                f"{summary['total_waste_percentage']:.2f}%",
                f"{summary['efficiency_score']:.1f}"
            ])
            writer.writerow([])
            
            # Write room details
            writer.writerow(['ROOM DETAILS'])
            writer.writerow([
                'Room Name', 'Height (mm)', 'Area (mm²)', 'Panels', 'Orientation', 
                'Recommended', 'Waste %', 'Waste Area (mm²)'
            ])
            
            for room in report_data['room_reports']:
                writer.writerow([
                    room['room_name'],
                    room['room_height'] or 'Default',
                    room['room_area'],
                    room['total_panels'],
                    room['orientation'],
                    'Yes' if room['is_recommended_orientation'] else 'No',
                    f"{room['waste_percentage']:.2f}%",
                    room['waste_area']
                ])
            
            # Write recommendations
            if report_data['recommendations']:
                writer.writerow([])
                writer.writerow(['RECOMMENDATIONS'])
                writer.writerow(['Priority', 'Title', 'Description', 'Action'])
                
                for rec in report_data['recommendations']:
                    writer.writerow([
                        rec['priority'].upper(),
                        rec['title'],
                        rec['description'],
                        rec['action']
                    ])
            
            csv_content = output.getvalue()
            output.close()
            
            return {
                'csv_content': csv_content,
                'filename': f"ceiling_report_{report_data['project_name'].replace(' ', '_')}_{timezone.now().strftime('%Y%m%d_%H%M%S')}.csv"
            }
            
        except Exception as e:
            return {'error': f'CSV export failed: {str(e)}'}

    @staticmethod
    def generate_ceiling_plan_visualization_data(project_id, room_id=None):
        """Generate data for ceiling plan visualization"""
        try:
            from .models import Project, Room, CeilingPlan, CeilingPanel
            
            if room_id:
                # Single room visualization
                room = Room.objects.get(id=room_id)
                ceiling_plan = CeilingPlan.objects.filter(room=room).first()
                ceiling_panels = CeilingPanel.objects.filter(room=room) if ceiling_plan else []
                
                visualization_data = {
                    'room': {
                        'id': room.id,
                        'name': room.room_name,
                        'points': room.room_points,
                        'height': room.height
                    },
                    'panels': [{
                        'id': panel.panel_id,
                        'start_x': panel.start_x,
                        'start_y': panel.start_y,
                        'end_x': panel.end_x,
                        'end_y': panel.end_y,
                        'width': panel.width,
                        'length': panel.length,
                        'is_cut': panel.is_cut_panel,
                        'cut_notes': panel.cut_notes,
                        'color': '#3B82F6' if not panel.is_cut_panel else '#EF4444'
                    } for panel in ceiling_panels],
                    'statistics': {
                        'total_panels': len(ceiling_panels),
                        'full_panels': len([p for p in ceiling_panels if not p.is_cut_panel]),
                        'cut_panels': len([p for p in ceiling_panels if p.is_cut_panel])
                    }
                }
                
                return visualization_data
            else:
                # Project-wide visualization
                project = Project.objects.get(id=project_id)
                rooms = Room.objects.filter(project=project)
                
                project_visualization = {
                    'project': {
                        'id': project.id,
                        'name': project.name
                    },
                    'rooms': []
                }
                
                for room in rooms:
                    ceiling_plan = CeilingPlan.objects.filter(room=room).first()
                    ceiling_panels = CeilingPanel.objects.filter(room=room) if ceiling_plan else []
                    
                    room_data = {
                        'id': room.id,
                        'name': room.room_name,
                        'points': room.room_points,
                        'height': room.height,
                        'panels': [{
                            'id': panel.panel_id,
                            'start_x': panel.start_x,
                            'start_y': panel.start_y,
                            'end_x': panel.end_x,
                            'end_y': panel.end_y,
                            'width': panel.width,
                            'length': panel.length,
                            'is_cut': panel.is_cut_panel,
                            'color': '#3B82F6' if not panel.is_cut_panel else '#EF4444'
                        } for panel in ceiling_panels]
                    }
                    
                    project_visualization['rooms'].append(room_data)
                
                return project_visualization
                
        except Exception as e:
            return {'error': f'Visualization data generation failed: {str(e)}'}

    @staticmethod
    def _optimize_panel_widths(panels, max_panel_width=1150, min_panel_width=350, edge_panel_max_width=1130):
        """
        Optimize panel widths to meet minimum width requirements and edge panel constraints.
        
        Rules:
        1. No panel should be less than min_panel_width (350mm)
        2. Panels max width is max_panel_width (1150mm)
        3. Redistribute excess width from narrow panels to wider panels
        """
        try:
            if not panels or len(panels) <= 1:
                return panels
            
            # Sort panels by their position (x for horizontal, y for vertical)
            # Determine orientation by checking if panels are horizontal or vertical
            is_horizontal = panels[0]['width'] > panels[0]['length']
            
            if is_horizontal:
                # For horizontal panels, sort by x position
                sorted_panels = sorted(panels, key=lambda p: p['start_x'])
            else:
                # For vertical panels, sort by y position
                sorted_panels = sorted(panels, key=lambda p: p['start_y'])
            
            optimized_panels = []
            total_excess = 0
            narrow_panels = []
            
            # First pass: identify narrow panels and calculate excess width
            for i, panel in enumerate(sorted_panels):
                panel_width = panel['width']
                
                # Check if panel is too narrow
                if panel_width < min_panel_width:
                    shortage = min_panel_width - panel_width
                    narrow_panels.append({
                        'panel': panel,
                        'index': i,
                        'shortage': shortage,
                        'is_edge': (i == 0 or i == len(sorted_panels) - 1)
                    })
                else:
                    # Check if panel exceeds edge panel limit
                    if (i == 0 or i == len(sorted_panels) - 1) and panel_width > edge_panel_max_width:
                        excess = panel_width - edge_panel_max_width
                        total_excess += excess
                        # Reduce panel width to edge limit
                        panel['width'] = edge_panel_max_width
                        if is_horizontal:
                            panel['end_x'] = panel['start_x'] + edge_panel_max_width
                        else:
                            panel['end_y'] = panel['start_y'] + edge_panel_max_width
                        panel['area'] = panel['width'] * panel['length']
            
            # Second pass: redistribute excess width to narrow panels
            if narrow_panels and total_excess > 0:
                # Sort narrow panels by shortage (largest shortage first)
                narrow_panels.sort(key=lambda x: x['shortage'], reverse=True)
                
                for narrow_info in narrow_panels:
                    if total_excess <= 0:
                        break
                        
                    panel = narrow_info['panel']
                    shortage = narrow_info['shortage']
                    is_edge = narrow_info['is_edge']
                    
                    # Calculate how much we can add to this panel
                    max_addition = min(shortage, total_excess)
                    
                    # For edge panels, ensure we don't exceed edge_panel_max_width
                    if is_edge:
                        current_width = panel['width']
                        max_addition = min(max_addition, edge_panel_max_width - current_width)
                    
                    if max_addition > 0:
                        # Increase panel width
                        panel['width'] += max_addition
                        if is_horizontal:
                            panel['end_x'] = panel['start_x'] + panel['width']
                        else:
                            panel['end_y'] = panel['start_y'] + panel['width']
                        panel['area'] = panel['width'] * panel['length']
                        
                        # Update total excess
                        total_excess -= max_addition
                        
                        # Mark as cut if it's not a standard size
                        if panel['width'] != max_panel_width:
                            panel['is_cut'] = True
                            panel['cut_notes'] = f"Width optimized from {panel['width'] - max_addition}mm to {panel['width']}mm"
            
            # Third pass: if we still have excess from edge panels, try to redistribute to other edge panels
            if total_excess > 0 and len(sorted_panels) > 1:
                # Find edge panels that could accept more width
                first_panel = sorted_panels[0]
                last_panel = sorted_panels[-1]
                
                # Try to add excess to the last panel if it's an edge panel
                if last_panel['width'] < edge_panel_max_width:
                    available_space = edge_panel_max_width - last_panel['width']
                    addition = min(available_space, total_excess)
                    
                    if addition > 0:
                        last_panel['width'] += addition
                        if is_horizontal:
                            last_panel['end_x'] = last_panel['start_x'] + last_panel['width']
                        else:
                            last_panel['end_y'] = last_panel['start_y'] + last_panel['width']
                        last_panel['area'] = last_panel['width'] * last_panel['length']
                        
                        total_excess -= addition
                        
                        # Mark as cut since it's not standard size
                        last_panel['is_cut'] = True
                        last_panel['cut_notes'] = f"Edge panel width increased from {last_panel['width'] - addition}mm to {last_panel['width']}mm"
                
                # If still have excess, try to add to first panel if possible
                if total_excess > 0 and first_panel['width'] < edge_panel_max_width:
                    available_space = edge_panel_max_width - first_panel['width']
                    addition = min(available_space, total_excess)
                    
                    if addition > 0:
                        first_panel['width'] += addition
                        if is_horizontal:
                            first_panel['end_x'] = first_panel['start_x'] + first_panel['width']
                        else:
                            first_panel['end_y'] = first_panel['start_y'] + first_panel['width']
                        first_panel['area'] = first_panel['width'] * first_panel['length']
                        
                        total_excess -= addition
                        
                        # Mark as cut since it's not standard size
                        first_panel['is_cut'] = True
                        first_panel['cut_notes'] = f"Edge panel width increased from {first_panel['width'] - addition}mm to {first_panel['width']}mm"
            
            # Fourth pass: ensure all panels meet minimum width requirement
            for panel in sorted_panels:
                if panel['width'] < min_panel_width:
                    # If we still have narrow panels, mark them as cut
                    panel['is_cut'] = True
                    panel['cut_notes'] = f"Below minimum width ({panel['width']}mm < {min_panel_width}mm)"
                
                optimized_panels.append(panel)
            
            print(f"🔧 Panel width optimization completed:")
            print(f"   - Total panels: {len(panels)}")
            print(f"   - Narrow panels found: {len(narrow_panels)}")
            print(f"   - Total excess redistributed: {total_excess}mm")
            print(f"   - Edge panel max width: {edge_panel_max_width}mm")
            print(f"   - Middle panel max width: {max_panel_width}mm")
            print(f"   - Minimum panel width: {min_panel_width}mm")
            print(f"   - Edge panel redistribution: {'Yes' if total_excess > 0 else 'No'}")
            
            return optimized_panels
            
        except Exception as e:
            return panels