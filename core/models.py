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
    project = models.ForeignKey(Project, related_name="walls", on_delete=models.CASCADE)
    start_x = models.FloatField(help_text="X-coordinate of the wall's start point")
    start_y = models.FloatField(help_text="Y-coordinate of the wall's start point")
    end_x = models.FloatField(help_text="X-coordinate of the wall's end point")
    end_y = models.FloatField(help_text="Y-coordinate of the wall's end point")
    height = models.FloatField(default=1000.0)  # Ensure this field exists
    thickness = models.FloatField(default=200.0, help_text="Wall thickness in mm")
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
    floor_type = models.CharField(max_length=100)
    floor_thickness = models.DecimalField(max_digits=5, decimal_places=2)
    remarks = models.TextField(blank=True, null=True)

    def __str__(self):
        return f"{self.room_name} in Project {self.project.name}"