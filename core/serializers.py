from rest_framework import serializers
from .models import Project, Wall, Room, Ceiling, Door, Intersection

class WallSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wall
        fields = [
            'id', 'start_x', 'start_y', 'end_x', 'end_y',
            'height', 'thickness', 'application_type',
            'is_default', 'has_concrete_base', 'concrete_base_height'
        ]


class CeilingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ceiling
        fields = ['id', 'room', 'thickness', 'length', 'width']


class DoorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Door
        fields = [
            'id', 'project', 'door_type', 'configuration',
            'width', 'height', 'position_x', 'position_y', 'orientation', 'linked_wall'
        ]


class IntersectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Intersection
        fields = ['id', 'project', 'wall_1', 'wall_2', 'joining_method']


class RoomSerializer(serializers.ModelSerializer):
    walls = serializers.PrimaryKeyRelatedField(many=True, queryset=Wall.objects.all())
    ceilings = CeilingSerializer(many=True, read_only=True)

    class Meta:
        model = Room
        fields = [
            'id', 'project', 'walls', 'room_name',
            'floor_type', 'floor_thickness', 'remarks', 'ceilings', 'temperature'
        ]


class ProjectSerializer(serializers.ModelSerializer):
    walls = WallSerializer(many=True, read_only=True)
    rooms = RoomSerializer(many=True, read_only=True)
    doors = DoorSerializer(many=True, read_only=True)
    intersections = IntersectionSerializer(many=True, read_only=True)

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'width', 'length', 'height', 'wall_thickness',
            'walls', 'rooms', 'doors', 'intersections'
        ]
