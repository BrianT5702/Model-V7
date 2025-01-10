from django.contrib import admin
from .models import Project, Wall

@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('name', 'width', 'length', 'height', 'wall_thickness', 'created_at', 'updated_at')

@admin.register(Wall)
class WallAdmin(admin.ModelAdmin):
    list_display = ('project', 'start_x', 'start_y', 'end_x', 'end_y', 'thickness', 'is_default', 'created_at')
