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

class Ceiling(models.Model):
    room = models.ForeignKey(Room, related_name='ceilings', on_delete=models.CASCADE)
    thickness = models.FloatField(help_text="Thickness of the ceiling in mm")
    length = models.FloatField(help_text="Length of the ceiling in mm")
    width = models.FloatField(help_text="Width of the ceiling in mm")

    def __str__(self):
        return f"Ceiling in {self.room.room_name} of Project {self.room.project.name}"


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