from django.db import models
from django.contrib.postgres.fields import ArrayField
from .constants import (
    WALL_APPLICATION_TYPES, ROOM_FLOOR_TYPES, ROOM_FLOOR_THICKNESS_CHOICES,
    DOOR_TYPES, DOOR_CONFIGURATIONS, DOOR_SIDES, DOOR_SWING_DIRECTIONS,
    DOOR_SLIDE_DIRECTIONS, WALL_JOINING_METHODS,
    DEFAULT_WALL_THICKNESS, DEFAULT_WALL_HEIGHT, DEFAULT_DOOR_SIDE,
    DEFAULT_DOOR_SWING_DIRECTION, DEFAULT_DOOR_SLIDE_DIRECTION,
    DEFAULT_DOOR_TYPE, DEFAULT_DOOR_CONFIGURATION, DEFAULT_ROOM_FLOOR_TYPE
)

class Project(models.Model):
    name = models.CharField(max_length=255)
    width = models.FloatField(help_text="Width of the site in mm")
    length = models.FloatField(help_text="Length of the site in mm")
    height = models.FloatField(help_text="Height of the site in mm")
    wall_thickness = models.FloatField(default=DEFAULT_WALL_THICKNESS, help_text="Default wall thickness in mm")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Wall(models.Model):
    project = models.ForeignKey(Project, related_name="walls", on_delete=models.CASCADE)
    start_x = models.FloatField(help_text="X-coordinate of the wall's start point")
    start_y = models.FloatField(help_text="Y-coordinate of the wall's start point")
    end_x = models.FloatField(help_text="X-coordinate of the wall's end point")
    end_y = models.FloatField(help_text="Y-coordinate of the wall's end point")
    height = models.FloatField(default=DEFAULT_WALL_HEIGHT, help_text="Height of the wall in mm")
    thickness = models.FloatField(default=DEFAULT_WALL_THICKNESS, help_text="Wall thickness in mm")
    application_type = models.CharField(
        max_length=50,
        choices=WALL_APPLICATION_TYPES,
        default='wall',
        help_text="Specify whether this is a wall or a partition."
    )
    is_default = models.BooleanField(default=True, help_text="True if the wall is a default boundary wall")
    has_concrete_base = models.BooleanField(default=False, help_text="Whether the wall has a concrete base")
    concrete_base_height = models.FloatField(null=True, blank=True, help_text="Height of the concrete base in mm")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Wall {self.id} in Project {self.project.name}"

class Room(models.Model):
    project = models.ForeignKey(Project, related_name='rooms', on_delete=models.CASCADE)
    walls = models.ManyToManyField(Wall, related_name='rooms')
    room_name = models.CharField(max_length=100)
    floor_type = models.CharField(
        max_length=50,
        choices=ROOM_FLOOR_TYPES,
        default=DEFAULT_ROOM_FLOOR_TYPE,
        help_text="Specify the type of floor for the room."
    )
    floor_thickness = models.IntegerField(
        choices=ROOM_FLOOR_THICKNESS_CHOICES,
        help_text="Floor thickness in mm (select from predefined values)."
    )
    temperature = models.DecimalField(
        max_digits=5, 
        decimal_places=2, 
        null=True, 
        blank=True, 
        help_text="Room temperature in °C (Optional)."
    )
    height = models.FloatField(
        null=True, 
        blank=True, 
        help_text="Height of the room in mm (will be set to minimum wall height if not specified)"
    )
    remarks = models.TextField(blank=True, null=True)
    
    room_points = ArrayField(
        base_field=models.JSONField(),
        default=list,
        blank=True,
        help_text="List of points {x, y} defining the room boundary"
    )
    
    label_position = models.JSONField(
        null=True,
        blank=True,
        help_text="Position {x, y} of the room label on the canvas"
    )

    class Meta:
        unique_together = ('project', 'room_name')

    def __str__(self):
        return f"{self.room_name} in Project {self.project.name}"

class CeilingPanel(models.Model):
    """Individual ceiling panel that covers a specific area of a room"""
    room = models.ForeignKey(Room, related_name='ceiling_panels', on_delete=models.CASCADE)
    panel_id = models.CharField(max_length=50, help_text="Unique identifier for the panel")
    start_x = models.FloatField(help_text="X-coordinate of the panel's start point")
    start_y = models.FloatField(help_text="Y-coordinate of the panel's start point")
    end_x = models.FloatField(help_text="X-coordinate of the panel's end point")
    end_y = models.FloatField(help_text="Y-coordinate of the panel's end point")
    width = models.FloatField(help_text="Width of the panel in mm (max 1150mm)")
    length = models.FloatField(help_text="Length of the panel in mm")
    thickness = models.FloatField(default=20.0, help_text="Thickness of the ceiling panel in mm")
    material_type = models.CharField(
        max_length=50,
        default='standard',
        choices=[
            ('standard', 'Standard Panel'),
            ('acoustic', 'Acoustic Panel'),
            ('fire_rated', 'Fire Rated Panel'),
            ('moisture_resistant', 'Moisture Resistant Panel')
        ]
    )
    is_cut_panel = models.BooleanField(default=False, help_text="Whether this panel was cut to fit")
    cut_notes = models.TextField(blank=True, null=True, help_text="Notes about any cuts made to the panel")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('room', 'panel_id')

    def __str__(self):
        return f"Ceiling Panel {self.panel_id} in {self.room.room_name}"

    def get_area(self):
        """Calculate the area of the panel in square mm"""
        return self.width * self.length

    def get_dimensions(self):
        """Get panel dimensions as a dictionary"""
        return {
            'width': self.width,
            'length': self.length,
            'thickness': self.thickness
        }

class CeilingPlan(models.Model):
    """Represents the complete ceiling plan for a room with automatic panel generation"""
    room = models.OneToOneField(Room, related_name='ceiling_plan', on_delete=models.CASCADE)
    total_area = models.FloatField(help_text="Total ceiling area in square mm")
    total_panels = models.IntegerField(default=0, help_text="Total number of panels used")
    full_panels = models.IntegerField(default=0, help_text="Number of full panels used")
    cut_panels = models.IntegerField(default=0, help_text="Number of cut panels used")
    waste_percentage = models.FloatField(default=0.0, help_text="Percentage of material wasted")
    generation_method = models.CharField(
        max_length=50,
        default='automatic',
        choices=[
            ('automatic', 'Automatic Generation'),
            ('manual', 'Manual Placement'),
            ('hybrid', 'Hybrid (Auto + Manual)')
        ]
    )
    
    # CRITICAL: Generation parameters that MUST be saved for consistency and 3D generation
    ceiling_thickness = models.FloatField(
        default=150, 
        help_text="Ceiling thickness used for this plan (critical for 3D generation)"
    )
    orientation_strategy = models.CharField(
        max_length=50, 
        default='auto', 
        help_text="Orientation strategy used for panel layout"
    )
    panel_width = models.FloatField(
        default=1150, 
        help_text="Panel width used for this plan"
    )
    panel_length = models.CharField(
        max_length=20, 
        default='auto', 
        help_text="Panel length setting used for this plan"
    )
    custom_panel_length = models.FloatField(
        null=True, 
        blank=True, 
        help_text="Custom panel length if not auto"
    )
    
    # Support configuration
    support_type = models.CharField(
        max_length=20, 
        default='nylon', 
        help_text="Support system type used"
    )
    support_config = models.JSONField(
        default=dict, 
        help_text="Support configuration options used"
    )
    
    notes = models.TextField(blank=True, null=True, help_text="Additional notes about the ceiling plan")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Ceiling Plan for {self.room.room_name}"

    def update_statistics(self, leftover_tracker=None):
        """Update statistics based on current panels, accounting for leftover reuse"""
        panels = self.room.ceiling_panels.all()
        self.total_panels = panels.count()
        self.full_panels = panels.filter(is_cut_panel=False).count()
        self.cut_panels = panels.filter(is_cut_panel=True).count()
        
        # Calculate total area
        total_panel_area = sum(panel.get_area() for panel in panels)
        self.total_area = total_panel_area
        
        # Calculate waste percentage per room (for individual room display)
        # Note: Project-wide waste is calculated at the service level using leftover area
        room_area = self.calculate_room_area()
        if room_area > 0 and total_panel_area > 0:
            waste_area = max(0, total_panel_area - room_area)
            self.waste_percentage = (waste_area / total_panel_area) * 100
        else:
            self.waste_percentage = 0.0
            
        # Log leftover statistics for information (doesn't change waste calculation)
        if leftover_tracker:
            import logging
            logger = logging.getLogger(__name__)
            stats = leftover_tracker.get_stats()
            logger.info(f"Ceiling - Leftover stats: {stats['leftovers_created']} created, "
                       f"{stats['leftovers_reused']} reused, "
                       f"{stats['full_panels_saved']} panels saved")
        
        self.save()

    def calculate_room_area(self):
        """Calculate the actual room area from room points"""
        if not self.room.room_points:
            return 0.0
        
        # Simple polygon area calculation (shoelace formula)
        points = self.room.room_points
        n = len(points)
        area = 0.0
        
        for i in range(n):
            j = (i + 1) % n
            area += points[i]['x'] * points[j]['y']
            area -= points[j]['x'] * points[i]['y']
        
        return abs(area) / 2.0

class FloorPanel(models.Model):
    """Individual floor panel that covers a specific area of a room (excluding walls)"""
    room = models.ForeignKey(Room, related_name='floor_panels', on_delete=models.CASCADE)
    panel_id = models.CharField(max_length=50, help_text="Unique identifier for the floor panel")
    start_x = models.FloatField(help_text="X-coordinate of the panel's start point")
    start_y = models.FloatField(help_text="Y-coordinate of the panel's start point")
    end_x = models.FloatField(help_text="X-coordinate of the panel's end point")
    end_y = models.FloatField(help_text="Y-coordinate of the panel's end point")
    width = models.FloatField(help_text="Width of the floor panel in mm")
    length = models.FloatField(help_text="Length of the floor panel in mm")
    thickness = models.FloatField(default=20.0, help_text="Thickness of the floor panel in mm")
    material_type = models.CharField(
        max_length=50,
        default='standard',
        choices=[
            ('standard', 'Standard Floor Panel'),
            ('waterproof', 'Waterproof Panel'),
            ('acoustic', 'Acoustic Panel'),
            ('heated', 'Heated Floor Panel'),
            ('insulated', 'Insulated Panel')
        ]
    )
    is_cut_panel = models.BooleanField(default=False, help_text="Whether this panel was cut to fit")
    cut_notes = models.TextField(blank=True, null=True, help_text="Notes about any cuts made to the panel")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('room', 'panel_id')

    def __str__(self):
        return f"Floor Panel {self.panel_id} in {self.room.room_name}"

    def get_area(self):
        """Calculate the area of the floor panel in square mm"""
        return self.width * self.length

    def get_dimensions(self):
        """Get panel dimensions as a dictionary"""
        return {
            'width': self.width,
            'length': self.length,
            'thickness': self.thickness
        }

class FloorPlan(models.Model):
    """Represents the complete floor plan for a room with automatic panel generation (excluding walls)"""
    room = models.OneToOneField(Room, related_name='floor_plan', on_delete=models.CASCADE)
    total_area = models.FloatField(default=0.0, help_text="Total floor area in square mm (excluding walls)")
    total_panels = models.IntegerField(default=0, help_text="Total number of floor panels used")
    full_panels = models.IntegerField(default=0, help_text="Number of full floor panels used")
    cut_panels = models.IntegerField(default=0, help_text="Number of cut floor panels used")
    waste_percentage = models.FloatField(default=0.0, help_text="Percentage of material wasted")
    generation_method = models.CharField(
        max_length=50,
        default='automatic',
        choices=[
            ('automatic', 'Automatic Generation'),
            ('manual', 'Manual Placement'),
            ('hybrid', 'Hybrid (Auto + Manual)')
        ]
    )
    
    # Generation parameters that MUST be saved for consistency and 3D generation
    orientation_strategy = models.CharField(
        max_length=50, 
        default='auto', 
        help_text="Orientation strategy used for floor panel layout"
    )
    panel_width = models.FloatField(
        default=1150, 
        help_text="Floor panel width used for this plan"
    )
    panel_length = models.CharField(
        max_length=20, 
        default='auto', 
        help_text="Floor panel length setting used for this plan"
    )
    custom_panel_length = models.FloatField(
        null=True, 
        blank=True, 
        help_text="Custom floor panel length if not auto"
    )
    
    notes = models.TextField(blank=True, null=True, help_text="Additional notes about the floor plan")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Floor Plan for {self.room.room_name}"

    def update_statistics(self, leftover_tracker=None):
        """Update statistics based on current floor panels
        Note: Project-wide waste is calculated at the service level using leftover area
        """
        panels = self.room.floor_panels.all()
        self.total_panels = panels.count()
        self.full_panels = panels.filter(is_cut_panel=False).count()
        self.cut_panels = panels.filter(is_cut_panel=True).count()
        
        # Calculate total area from panels
        if panels.exists():
            total_panel_area = sum(panel.get_area() for panel in panels)
            self.total_area = total_panel_area
        else:
            # If no panels, calculate from room area
            room_area = self.calculate_room_floor_area()
            self.total_area = room_area if room_area > 0 else 0.0
        
        # Calculate waste percentage per room (for individual room display)
        if self.total_area > 0:
            room_area = self.calculate_room_floor_area()
            if room_area > 0:
                waste_area = max(0, self.total_area - room_area)
                self.waste_percentage = (waste_area / self.total_area) * 100
            else:
                self.waste_percentage = 0.0
        else:
            self.waste_percentage = 0.0
        
        self.save()

    def calculate_room_floor_area(self):
        """Calculate the actual room floor area from room points (excluding walls)"""
        if not self.room.room_points:
            return 0.0
        
        # Get wall thickness from project
        wall_thickness = self.room.project.wall_thickness if self.room.project else 200
        
        # Calculate floor area by reducing room area by wall thickness
        # This gives us the area INSIDE the walls where floor panels can be placed
        points = self.room.room_points
        n = len(points)
        area = 0.0
        
        for i in range(n):
            j = (i + 1) % n
            area += points[i]['x'] * points[j]['y']
            area -= points[j]['x'] * points[i]['y']
        
        room_area = abs(area) / 2.0
        
        # Calculate perimeter to estimate wall area
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
        
        return max(0, floor_area)  # Ensure non-negative

class Door(models.Model):
    project = models.ForeignKey(Project, related_name='doors', on_delete=models.CASCADE)
    door_type = models.CharField(
        max_length=50,
        choices=DOOR_TYPES,
        default=DEFAULT_DOOR_TYPE,
        help_text="Specify the type of door."
    )
    configuration = models.CharField(
        max_length=50,
        choices=DOOR_CONFIGURATIONS,
        default=DEFAULT_DOOR_CONFIGURATION,
        help_text="Specify the configuration of the door."
    )
    side = models.CharField(
        max_length=20,
        choices=DOOR_SIDES,
        default=DEFAULT_DOOR_SIDE,
        help_text="Specify if the door opens to the interior or exterior side."
    )
    swing_direction = models.CharField(
        max_length=20,
        choices=DOOR_SWING_DIRECTIONS,
        default=DEFAULT_DOOR_SWING_DIRECTION,
        null=True,
        blank=True,
        help_text="Swing direction for sweep doors."
    )
    slide_direction = models.CharField(
        max_length=20,
        choices=DOOR_SLIDE_DIRECTIONS,
        default=DEFAULT_DOOR_SLIDE_DIRECTION,
        null=True,
        blank=True,
        help_text="Sliding direction for slide doors."
    )
    width = models.FloatField(help_text="Width of the door in mm")
    height = models.FloatField(help_text="Height of the door in mm")
    thickness = models.FloatField(help_text="thickness of the Door Panel in mm")
    position_x = models.FloatField(help_text="X-coordinate of the door's position")
    position_y = models.FloatField(help_text="Y-coordinate of the door's position")
    orientation = models.CharField(
        max_length=50,
        choices=[('horizontal', 'Horizontal'), ('vertical', 'Vertical')],
        default='horizontal',
        help_text="Orientation of the door in the plan."
    )
    linked_wall = models.ForeignKey(Wall, related_name='doors', on_delete=models.CASCADE, null=True, blank=True)

    def __str__(self):
        return f"Door {self.id} ({self.door_type}, {self.configuration}) in Project {self.project.name}"

class Intersection(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='intersections')
    wall_1 = models.ForeignKey(Wall, on_delete=models.CASCADE, related_name='intersections_as_wall1')
    wall_2 = models.ForeignKey(Wall, on_delete=models.CASCADE, related_name='intersections_as_wall2')
    joining_method = models.CharField(max_length=20, choices=WALL_JOINING_METHODS)

    class Meta:
        unique_together = ('wall_1', 'wall_2')
        
    def __str__(self):
        return f"Intersection between Wall {self.wall_1.id} and Wall {self.wall_2.id} in Project {self.project.name}"