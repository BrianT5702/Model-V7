from rest_framework import serializers
from .models import (
    Project,
    Storey,
    Wall,
    Room,
    CeilingPanel,
    CeilingPlan,
    FloorPanel,
    FloorPlan,
    Door,
    Window,
    WallWindow,
    Intersection,
    CeilingZone,
)


class StoreySerializer(serializers.ModelSerializer):
    class Meta:
        model = Storey
        fields = [
            'id',
            'project',
            'name',
            'elevation_mm',
            'default_room_height_mm',
            'order',
            'slab_thickness_mm',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class WallWindowSerializer(serializers.ModelSerializer):
    class Meta:
        model = WallWindow
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

    def validate_position_x(self, value):
        """Validate that position_x is between 0 and 1"""
        if value < 0 or value > 1:
            raise serializers.ValidationError("Position X must be between 0 and 1")
        return value

    def validate_position_y(self, value):
        """Validate that position_y is between 0 and 1"""
        if value < 0 or value > 1:
            raise serializers.ValidationError("Position Y must be between 0 and 1")
        return value


class WallSerializer(serializers.ModelSerializer):
    rooms = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    windows = WallWindowSerializer(many=True, read_only=True)

    class Meta:
        model = Wall
        fields = [
            'id', 'project', 'storey',
            'start_x', 'start_y', 'end_x', 'end_y',
            'height', 'thickness', 'base_elevation_mm', 'base_elevation_manual', 'application_type',
            'inner_face_material', 'inner_face_thickness',
            'outer_face_material', 'outer_face_thickness',
            'is_default', 'has_concrete_base', 'concrete_base_height',
            'fill_gap_mode', 'gap_fill_height', 'gap_base_position',
            'ceiling_joint_type', 'ceiling_cut_l_horizontal_extension',
            'rooms', 'windows'
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
    
    def update(self, instance, validated_data):
        """Override update to apply AA11 wall height adjustment"""
        from .services import CeilingService
        
        # Update the instance
        instance = super().update(instance, validated_data)
        
        # Apply AA11 wall height adjustment if joint type is AA11
        if instance.ceiling_joint_type == 'AA11':
            # Get all rooms that contain this wall
            rooms = instance.rooms.all()
            for room in rooms:
                CeilingService.apply_aa11_wall_height_adjustment(instance, room)
        
        return instance
    
    def create(self, validated_data):
        """Override create to apply AA11 wall height adjustment"""
        from .services import CeilingService
        
        # Create the instance
        instance = super().create(validated_data)
        
        # Apply AA11 wall height adjustment if joint type is AA11
        if instance.ceiling_joint_type == 'AA11':
            # Get all rooms that contain this wall
            rooms = instance.rooms.all()
            for room in rooms:
                CeilingService.apply_aa11_wall_height_adjustment(instance, room)
        
        return instance


class CeilingPanelSerializer(serializers.ModelSerializer):
    # Custom read-only fields for convenience
    is_cut = serializers.BooleanField(source='is_cut_panel', read_only=True)
    room_id = serializers.IntegerField(source='room.id', read_only=True)
    zone_id = serializers.IntegerField(source='zone.id', read_only=True)
    
    # Zone relation
    zone = serializers.PrimaryKeyRelatedField(queryset=CeilingZone.objects.all(), allow_null=True, required=False)

    # --- NEW FIELD FOR L-SHAPE FIX ---
    # Maps the DB field 'shape_data' to 'shape_points' for the frontend
    shape_points = serializers.JSONField(source='shape_data', required=False, allow_null=True)

    class Meta:
        model = CeilingPanel
        fields = [
            'id', 
            'room', 
            'room_id', 
            'zone', 
            'zone_id', 
            'panel_id', 
            'start_x', 
            'start_y', 
            'end_x', 
            'end_y',
            'width', 
            'length', 
            'thickness',
            'material_type',
            'inner_face_material',
            'inner_face_thickness',
            'outer_face_material',
            'outer_face_thickness',
            'is_cut_panel', 
            'cut_notes', 
            'is_cut',
            'shape_points' # <--- Added this to expose the geometry
        ]

    def validate(self, attrs):
        room = attrs.get('room') or getattr(self.instance, 'room', None)
        zone = attrs.get('zone') or getattr(self.instance, 'zone', None)
        
        # Ensure it belongs to exactly one container (Room OR Zone)
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
    # Expose potential L-shape geometry like ceiling panels do
    shape_points = serializers.JSONField(source='shape_data', required=False, allow_null=True)
    
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
    # Use the updated CeilingPanelSerializer
    # Default source is 'room.ceiling_panels' (for standard rooms)
    ceiling_panels = CeilingPanelSerializer(many=True, read_only=True, source='room.ceiling_panels')
    
    # Zone fields
    zone_id = serializers.IntegerField(source='zone.id', read_only=True)
    zone = serializers.PrimaryKeyRelatedField(queryset=CeilingZone.objects.all(), required=False, allow_null=True)
    
    class Meta:
        model = CeilingPlan
        fields = [
            'id', 
            'room', 
            'zone', 
            'zone_id', 
            'total_area', 
            'total_panels', 
            'full_panels', 
            'cut_panels', 
            'waste_percentage', 
            'generation_method', 
            'ceiling_thickness', 
            'orientation_strategy', 
            'panel_width', 
            'panel_length', 
            'custom_panel_length', 
            'support_type', 
            'support_config', 
            'notes', 
            'ceiling_panels'
        ]

    def to_representation(self, instance):
        """
        Custom logic: If this plan belongs to a Zone, fetch panels from the Zone relation
        instead of the Room relation.
        """
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


class WindowSerializer(serializers.ModelSerializer):
    class Meta:
        model = Window
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

    def validate_position_x(self, value):
        """Validate that position_x is between 0 and 1"""
        if value < 0 or value > 1:
            raise serializers.ValidationError("Position X must be between 0 and 1")
        return value

    def validate_position_y(self, value):
        """Validate that position_y is between 0 and 1"""
        if value < 0 or value > 1:
            raise serializers.ValidationError("Position Y must be between 0 and 1")
        return value


class DoorSerializer(serializers.ModelSerializer):
    windows = WindowSerializer(many=True, read_only=True)
    
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
    floor_plan = FloorPlanSerializer(read_only=True)
    # Include zone information and zone's ceiling plan for rooms in zones
    ceiling_zones = serializers.SerializerMethodField()
    zone_ceiling_plan = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = '__all__'
    
    def get_ceiling_zones(self, obj):
        """Get zones this room belongs to"""
        zones = obj.ceiling_zones.all()
        return [{'id': zone.id, 'name': getattr(zone, 'name', f'Zone {zone.id}')} for zone in zones]
    
    def get_zone_ceiling_plan(self, obj):
        """Get ceiling plan from zone if room is in a zone"""
        zones = obj.ceiling_zones.all()
        for zone in zones:
            if hasattr(zone, 'ceiling_plan') and zone.ceiling_plan:
                return CeilingPlanSerializer(zone.ceiling_plan).data
        return None

    def update(self, instance, validated_data):
        """Override update to handle partial updates properly"""
        # Handle the walls field separately since it's a ManyToManyField
        walls_data = validated_data.pop('walls', None)
        
        # Update all other fields
        for attr, value in validated_data.items():
            if attr == 'room_points':
                from .services import RoomService
                value = RoomService.normalize_room_points(value)
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
    storeys = StoreySerializer(many=True, read_only=True)
    calculated_height = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'width', 'length', 'height', 'calculated_height', 'wall_thickness',
            'storeys', 'walls', 'rooms', 'doors', 'intersections'
        ]

    def get_calculated_height(self, obj):
        """Calculate the maximum height from all rooms and storeys"""
        max_height = 0.0
        
        # Check all rooms
        for room in obj.rooms.all():
            storey = room.storey
            base_elevation = (
                room.base_elevation_mm if room.base_elevation_mm is not None
                else (storey.elevation_mm if storey else 0.0)
            )
            room_height = (
                room.height if room.height is not None
                else (storey.default_room_height_mm if storey else 0.0)
            )
            top = base_elevation + room_height
            if top > max_height:
                max_height = top
        
        # Check all storeys (for default heights even without rooms)
        for storey in obj.storeys.all():
            base_elevation = storey.elevation_mm or 0.0
            default_height = storey.default_room_height_mm or 0.0
            top = base_elevation + default_height
            if top > max_height:
                max_height = top
        
        # Fallback to the stored height if no rooms/storeys exist
        if max_height == 0.0:
            max_height = obj.height or 0.0
        
        return max_height

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


class ProjectListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for project list endpoint.
    Avoids nested walls/rooms/doors/intersections to keep payload small and fast.
    """
    calculated_height = serializers.FloatField(source='height', read_only=True)

    class Meta:
        model = Project
        fields = [
            'id',
            'name',
            'width',
            'length',
            'height',
            'calculated_height',
            'wall_thickness',
            'created_at',
            'updated_at',
        ]