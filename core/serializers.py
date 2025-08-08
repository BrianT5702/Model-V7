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

    def validate_height(self, value):
        """Validate that height is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Height must be greater than 0")
        return value

    def validate_thickness(self, value):
        """Validate that thickness is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Thickness must be greater than 0")
        return value


class CeilingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ceiling
        fields = ['id', 'room', 'thickness', 'length', 'width']


class DoorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Door
        fields = '__all__'

    def validate_width(self, value):
        """Validate that width is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Width must be greater than 0")
        return value

    def validate_height(self, value):
        """Validate that height is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Height must be greater than 0")
        return value

    def validate_thickness(self, value):
        """Validate that thickness is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Thickness must be greater than 0")
        return value


class IntersectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Intersection
        fields = ['id', 'project', 'wall_1', 'wall_2', 'joining_method']


class RoomSerializer(serializers.ModelSerializer):
    walls = serializers.PrimaryKeyRelatedField(many=True, queryset=Wall.objects.all(), required=False)
    ceilings = CeilingSerializer(many=True, read_only=True)

    class Meta:
        model = Room
        fields = '__all__'

    def update(self, instance, validated_data):
        """Override update to handle partial updates properly"""
        # Handle the walls field separately since it's a ManyToManyField
        walls_data = validated_data.pop('walls', None)
        
        # Update all other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        instance.save()
        
        # Update walls if provided
        if walls_data is not None:
            instance.walls.set(walls_data)
        
        return instance


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

    def validate_name(self, value):
        """Validate that project name is unique"""
        # When updating, exclude the current instance from the uniqueness check
        project_qs = Project.objects.filter(name=value)
        if self.instance:
            project_qs = project_qs.exclude(pk=self.instance.pk)
        if project_qs.exists():
            raise serializers.ValidationError("A project with this name already exists.")
        return value

    def validate_width(self, value):
        """Validate that width is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Width must be greater than 0")
        return value

    def validate_length(self, value):
        """Validate that length is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Length must be greater than 0")
        return value

    def validate_height(self, value):
        """Validate that height is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Height must be greater than 0")
        return value

    def validate_wall_thickness(self, value):
        """Validate that wall_thickness is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Wall thickness must be greater than 0")
        return value