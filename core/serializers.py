from rest_framework import serializers
from .models import Project, Wall, Room, CeilingPanel, CeilingPlan, FloorPanel, FloorPlan, Door, Intersection, CeilingZone

class WallSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wall
        fields = [
            'id', 'start_x', 'start_y', 'end_x', 'end_y',
            'height', 'thickness', 'application_type',
            'inner_face_material', 'inner_face_thickness',
            'outer_face_material', 'outer_face_thickness',
            'is_default', 'has_concrete_base', 'concrete_base_height',
            'fill_gap_mode', 'gap_fill_height', 'gap_base_position'
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

    def validate_inner_face_thickness(self, value):
        if value <= 0:
            raise serializers.ValidationError("Inner face thickness must be greater than 0")
        return value

    def validate_outer_face_thickness(self, value):
        if value <= 0:
            raise serializers.ValidationError("Outer face thickness must be greater than 0")
        return value


class CeilingPanelSerializer(serializers.ModelSerializer):
    is_cut = serializers.BooleanField(source='is_cut_panel', read_only=True)
    room_id = serializers.IntegerField(source='room.id', read_only=True)
    zone_id = serializers.IntegerField(source='zone.id', read_only=True)
    zone = serializers.PrimaryKeyRelatedField(queryset=CeilingZone.objects.all(), allow_null=True, required=False)
    
    class Meta:
        model = CeilingPanel
        fields = [
            'id', 'room', 'room_id', 'zone', 'zone_id', 'panel_id', 'start_x', 'start_y', 'end_x', 'end_y',
            'width', 'length', 'thickness', 'material_type', 'is_cut_panel', 'cut_notes', 'is_cut'
        ]

    def validate(self, attrs):
        room = attrs.get('room') or getattr(self.instance, 'room', None)
        zone = attrs.get('zone') or getattr(self.instance, 'zone', None)
        if not room and not zone:
            raise serializers.ValidationError('A ceiling panel must belong to a room or a zone.')
        if room and zone:
            raise serializers.ValidationError('A ceiling panel cannot belong to both a room and a zone.')
        return super().validate(attrs)

    def validate_width(self, value):
        """Validate that width is not greater than 1150mm"""
        if value > 1150:
            raise serializers.ValidationError("Panel width cannot exceed 1150mm")
        if value <= 0:
            raise serializers.ValidationError("Width must be greater than 0")
        return value

    def validate_length(self, value):
        """Validate that length is greater than 0"""
        if value <= 0:
            raise serializers.ValidationError("Length must be greater than 0")
        return value

class FloorPanelSerializer(serializers.ModelSerializer):
    room_id = serializers.IntegerField(source='room.id', read_only=True)
    
    class Meta:
        model = FloorPanel
        fields = '__all__'

class FloorPlanSerializer(serializers.ModelSerializer):
    floor_panels = FloorPanelSerializer(many=True, read_only=True, source='room.floor_panels')
    room_id = serializers.IntegerField(source='room.id', read_only=True)
    
    class Meta:
        model = FloorPlan
        fields = [
            'id', 'room', 'room_id', 'total_area', 'total_panels', 'full_panels', 
            'cut_panels', 'waste_percentage', 'generation_method', 
            'orientation_strategy', 'panel_width', 
            'panel_length', 'custom_panel_length', 
            'notes', 'floor_panels'
        ]
    
    def to_representation(self, instance):
        """Custom representation to include floor panels"""
        data = super().to_representation(instance)
        
        # Get the actual floor panels from the room
        if instance.room:
            panels = instance.room.floor_panels.all()
            data['floor_panels'] = FloorPanelSerializer(panels, many=True).data
        
        return data

class CeilingPlanSerializer(serializers.ModelSerializer):
    ceiling_panels = CeilingPanelSerializer(many=True, read_only=True, source='room.ceiling_panels')
    zone_id = serializers.IntegerField(source='zone.id', read_only=True)
    zone = serializers.PrimaryKeyRelatedField(queryset=CeilingZone.objects.all(), required=False, allow_null=True)
    
    class Meta:
        model = CeilingPlan
        fields = [
            'id', 'room', 'zone', 'zone_id', 'total_area', 'total_panels', 'full_panels', 
            'cut_panels', 'waste_percentage', 'generation_method', 
            'ceiling_thickness', 'orientation_strategy', 'panel_width', 
            'panel_length', 'custom_panel_length', 'support_type', 
            'support_config', 'notes', 'ceiling_panels'
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.zone:
            data['ceiling_panels'] = CeilingPanelSerializer(instance.zone.ceiling_panels.all(), many=True).data
        return data


class CeilingZoneSerializer(serializers.ModelSerializer):
    ceiling_plan = CeilingPlanSerializer(read_only=True)
    ceiling_panels = CeilingPanelSerializer(many=True, read_only=True)
    room_ids = serializers.PrimaryKeyRelatedField(source='rooms', many=True, queryset=Room.objects.all())

    class Meta:
        model = CeilingZone
        fields = [
            'id', 'project', 'room_ids', 'ceiling_thickness', 'orientation_strategy', 'panel_width',
            'panel_length', 'custom_panel_length', 'support_type', 'support_config', 'outline_points',
            'total_area', 'total_panels', 'full_panels', 'cut_panels', 'waste_percentage',
            'ceiling_plan', 'ceiling_panels', 'created_at', 'updated_at'
        ]

    def create(self, validated_data):
        rooms = validated_data.pop('rooms', [])
        zone = CeilingZone.objects.create(**validated_data)
        zone.rooms.set(rooms)
        return zone

    def update(self, instance, validated_data):
        rooms = validated_data.pop('rooms', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if rooms is not None:
            instance.rooms.set(rooms)
        return instance


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
    ceiling_plan = CeilingPlanSerializer(read_only=True)

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