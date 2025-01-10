from rest_framework import serializers
from .models import Project, Wall

class WallSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wall
        fields = ['id', 'start_x', 'start_y', 'end_x', 'end_y', 'height', 'thickness']

class ProjectSerializer(serializers.ModelSerializer):
    walls = WallSerializer(many=True, read_only=True)

    class Meta:
        model = Project
        fields = ['id', 'name', 'width', 'length', 'height', 'wall_thickness', 'walls']
