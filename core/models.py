from django.db import models

class Project(models.Model):
    name = models.CharField(max_length=255)
    width = models.FloatField(help_text="Width of the site in mm")
    length = models.FloatField(help_text="Length of the site in mm")
    height = models.FloatField(help_text="Height of the site in mm")
    wall_thickness = models.FloatField(default=200.0, help_text="Default wall thickness in mm")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Wall(models.Model):
    APPLICATION_TYPE_CHOICES = [
        ('wall', 'Wall'),
        ('partition', 'Partition'),
    ]

    project = models.ForeignKey(Project, related_name="walls", on_delete=models.CASCADE)
    start_x = models.FloatField(help_text="X-coordinate of the wall's start point")
    start_y = models.FloatField(help_text="Y-coordinate of the wall's start point")
    end_x = models.FloatField(help_text="X-coordinate of the wall's end point")
    end_y = models.FloatField(help_text="Y-coordinate of the wall's end point")
    height = models.FloatField(default=1000.0, help_text="Height of the wall in mm")
    thickness = models.FloatField(default=200.0, help_text="Wall thickness in mm")
    application_type = models.CharField(
        max_length=50,
        choices=APPLICATION_TYPE_CHOICES,
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


from django.db import models

class Room(models.Model):
    FLOOR_TYPE_CHOICES = [
        ('Slab', 'Slab'),
        ('Panel', 'Panel'),
        ('None', 'None'),
    ]

    FLOOR_THICKNESS_CHOICES = [
        (50, '50 mm'),
        (75, '75 mm'),
        (100, '100 mm'),
        (125, '125 mm'),
        (150, '150 mm'),
        (175, '175 mm'),
        (200, '200 mm'),
    ]

    project = models.ForeignKey(Project, related_name='rooms', on_delete=models.CASCADE)
    walls = models.ManyToManyField(Wall, related_name='rooms')
    room_name = models.CharField(max_length=100)
    floor_type = models.CharField(
        max_length=50,
        choices=FLOOR_TYPE_CHOICES,
        default='None',
        help_text="Specify the type of floor for the room."
    )
    floor_thickness = models.IntegerField(
        choices=FLOOR_THICKNESS_CHOICES,
        help_text="Floor thickness in mm (select from predefined values)."
    )
    temperature = models.DecimalField(
        max_digits=5, 
        decimal_places=2, 
        null=True, 
        blank=True, 
        help_text="Room temperature in °C (Optional)."
    )
    remarks = models.TextField(blank=True, null=True)

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
    DOOR_TYPE_CHOICES = [
        ('swing', 'Swing Door'),
        ('slide', 'Slide Door'),
    ]

    CONFIGURATION_CHOICES = [
        ('single_sided', 'Single-Sided'),
        ('double_sided', 'Double-Sided'),
    ]
    
    DOOR_SIDE_CHOICES = [
    ('interior', 'Interior'),
    ('exterior', 'Exterior'),
    ]
    
    side = models.CharField(
        max_length=20,
        choices=DOOR_SIDE_CHOICES,
        default='interior',
        help_text="Specify if the door opens to the interior or exterior side."
    )
    
    SWING_DIRECTION_CHOICES = [
    ('left', 'Left'),
    ('right', 'Right'),
    ]
    
    swing_direction = models.CharField(
        max_length=20,
        choices=SWING_DIRECTION_CHOICES,
        default='right',
        null=True,  # ✅ allow null
        blank=True,
        help_text="Swing direction for sweep doors."
    )
    
    SLIDE_DIRECTION_CHOICES = [
    ('left', 'Left'),
    ('right', 'Right'),
    ]
    
    slide_direction = models.CharField(
        max_length=20,
        choices=SLIDE_DIRECTION_CHOICES,
        default='right',
        null=True,  # ✅ allow null
        blank=True,
        help_text="Sliding direction for slide doors."
    )

    project = models.ForeignKey(Project, related_name='doors', on_delete=models.CASCADE)
    door_type = models.CharField(
        max_length=50,
        choices=DOOR_TYPE_CHOICES,
        default='sweep',
        help_text="Specify the type of door."
    )
    configuration = models.CharField(
        max_length=50,
        choices=CONFIGURATION_CHOICES,
        default='single_sided',
        help_text="Specify the configuration of the door."
    )
    width = models.FloatField(help_text="Width of the door in mm")
    height = models.FloatField(help_text="Height of the door in mm")
    thickness = models.FloatField(help_text = "thickness of the Door Panel in mm")
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
    JOINING_METHOD_CHOICES = [
        ('45_cut', '45° Cut'),
        ('butt_in', 'Butt In'),
    ]

    project = models.ForeignKey(Project, related_name='intersections', on_delete=models.CASCADE)
    wall_1 = models.ForeignKey(Wall, related_name='intersection_wall_1', on_delete=models.CASCADE)
    wall_2 = models.ForeignKey(Wall, related_name='intersection_wall_2', on_delete=models.CASCADE)
    joining_method = models.CharField(
        max_length=50,
        choices=JOINING_METHOD_CHOICES,
        default='butt_in',
        help_text="Specify the joining method at this intersection."
    )

    class Meta:
        unique_together = ('wall_1', 'wall_2')  # Add this
        ordering = ['wall_1_id', 'wall_2_id']
        
    def __str__(self):
        return f"Intersection between Wall {self.wall_1.id} and Wall {self.wall_2.id} in Project {self.project.name}"
