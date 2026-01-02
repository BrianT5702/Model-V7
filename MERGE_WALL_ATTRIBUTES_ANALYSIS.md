# Merge Wall Features - Attribute Inheritance Analysis

## Overview
The `merge_walls` function in `core/services.py` merges two walls that share endpoints and have matching basic properties.

## Location
```242:287:core/services.py
def merge_walls(wall_1, wall_2):
    """Merge two walls if they share endpoints and have matching properties."""
    if (
        wall_1.application_type != wall_2.application_type or
        wall_1.height != wall_2.height or
        wall_1.thickness != wall_2.thickness
    ):
        raise ValueError('Walls must have the same type, height, and thickness to merge.')

    # Check if walls share endpoints
    if wall_1.end_x == wall_2.start_x and wall_1.end_y == wall_2.start_y:
        # wall1's end connects to wall2's start
        new_start_x = wall_1.start_x
        new_start_y = wall_1.start_y
        new_end_x = wall_2.end_x
        new_end_y = wall_2.end_y
    elif wall_2.end_x == wall_1.start_x and wall_2.end_y == wall_1.start_y:
        # wall2's end connects to wall1's start
        new_start_x = wall_2.start_x
        new_start_y = wall_2.start_y
        new_end_x = wall_1.end_x
        new_end_y = wall_1.end_y
    else:
        raise ValueError('Walls do not share endpoints')

    # Normalize the merged wall coordinates
    norm_start_x, norm_start_y, norm_end_x, norm_end_y = normalize_wall_coordinates(
        new_start_x, new_start_y, new_end_x, new_end_y
    )
    
    # Create the merged wall
    merged_wall = Wall.objects.create(
        project=wall_1.project,
        storey=wall_1.storey,
        start_x=norm_start_x,
        start_y=norm_start_y,
        end_x=norm_end_x,
        end_y=norm_end_y,
        height=wall_1.height,
        thickness=wall_1.thickness,
        application_type=wall_1.application_type
    )

    wall_1.delete()
    wall_2.delete()
    return merged_wall
```

## Validation Requirements (Pre-Merge Checks)
Before merging, the function validates that both walls have:
1. ✅ **Same `application_type`** (wall/partition)
2. ✅ **Same `height`**
3. ✅ **Same `thickness`**
4. ✅ **Shared endpoints** (one wall's end point connects to the other's start point)

If any of these don't match, merging is rejected with a `ValueError`.

## Attribute Inheritance Behavior

### ✅ Explicitly Inherited from `wall_1`
The merged wall explicitly copies these attributes from `wall_1`:
- `project` - Project reference
- `storey` - Storey reference
- `height` - Wall height
- `thickness` - Wall thickness
- `application_type` - Wall or partition type
- `start_x`, `start_y`, `end_x`, `end_y` - Calculated merged coordinates

### ❌ NOT Inherited (Uses Model Defaults)
The following attributes are **NOT** copied from either wall and will use their **model default values**:

#### Face Material Attributes
- `inner_face_material` → Default: `'PPGI'`
- `inner_face_thickness` → Default: `0.5` mm
- `outer_face_material` → Default: `'PPGI'`
- `outer_face_thickness` → Default: `0.5` mm

#### Concrete Base Attributes
- `has_concrete_base` → Default: `False`
- `concrete_base_height` → Default: `None`

#### Gap Fill Attributes
- `fill_gap_mode` → Default: `False`
- `gap_fill_height` → Default: `None`
- `gap_base_position` → Default: `None`

#### Ceiling Joint Attributes
- `ceiling_joint_type` → Default: `None`
- `ceiling_cut_l_horizontal_extension` → Default: `None`

#### Other Attributes
- `is_default` → Default: `True`

## Complete Wall Model Attributes Reference

```62:125:core/models.py
class Wall(models.Model):
    project = models.ForeignKey(Project, related_name="walls", on_delete=models.CASCADE)
    storey = models.ForeignKey(Storey, related_name='walls', on_delete=models.CASCADE, null=True, blank=True)
    start_x = models.FloatField(help_text="X-coordinate of the wall's start point")
    start_y = models.FloatField(help_text="Y-coordinate of the wall's start point")
    end_x = models.FloatField(help_text="X-coordinate of the wall's end point")
    end_y = models.FloatField(help_text="Y-coordinate of the wall's end point")
    height = models.FloatField(default=DEFAULT_WALL_HEIGHT, help_text="Height of the wall in mm")
    thickness = models.FloatField(default=DEFAULT_WALL_THICKNESS, help_text="Wall thickness in mm")
    
    # Face finishes (materials and sheet thickness)
    inner_face_material = models.CharField(max_length=20, choices=FACE_MATERIALS, default='PPGI')
    inner_face_thickness = models.FloatField(default=DEFAULT_FACE_THICKNESS)
    outer_face_material = models.CharField(max_length=20, choices=FACE_MATERIALS, default='PPGI')
    outer_face_thickness = models.FloatField(default=DEFAULT_FACE_THICKNESS)
    
    application_type = models.CharField(max_length=50, choices=WALL_APPLICATION_TYPES, default='wall')
    is_default = models.BooleanField(default=True)
    has_concrete_base = models.BooleanField(default=False)
    concrete_base_height = models.FloatField(null=True, blank=True)
    fill_gap_mode = models.BooleanField(default=False)
    gap_fill_height = models.FloatField(null=True, blank=True)
    gap_base_position = models.FloatField(null=True, blank=True)
    ceiling_joint_type = models.CharField(max_length=20, choices=CEILING_JOINT_TYPES, null=True, blank=True)
    ceiling_cut_l_horizontal_extension = models.FloatField(null=True, blank=True)
```

## Key Observations

### 1. Asymmetric Inheritance
Only `wall_1`'s attributes are used for the few attributes that are explicitly copied. `wall_2`'s values are ignored even if they might be more appropriate.

### 2. Missing Attribute Inheritance
Many important attributes are not inherited, which means:
- Face material settings are lost and reset to defaults
- Concrete base configurations are lost
- Gap fill settings are lost
- Ceiling joint configurations are lost

### 3. Potential Data Loss
When walls with different face materials, concrete bases, or other configurations are merged, those configurations are **lost** rather than inherited.

### 4. Room Relationships
The merged wall's room relationships are handled separately in the view:
```214:240:core/views.py
@action(detail=False, methods=['post'])
def merge_walls(self, request):
    """Merge two walls into one"""
    # ... validation ...
    
    # Get rooms that contain these walls before merging
    rooms_with_walls = set()
    rooms_with_walls.update(wall_1.rooms.all())
    rooms_with_walls.update(wall_2.rooms.all())
    
    merged_wall = WallService.merge_walls(wall_1, wall_2)
    
    # After merging walls, recalculate room boundaries for all affected rooms
    from .services import RoomService
    for room in rooms_with_walls:
        RoomService.recalculate_room_boundary_from_walls(room.id)
    
    return Response(WallSerializer(merged_wall).data, status=status.HTTP_201_CREATED)
```

**Note**: The merged wall does NOT automatically inherit the room relationships from either `wall_1` or `wall_2`. Room boundaries are recalculated, which should re-establish the relationships, but this happens **after** the merge.

## Recommendations for Improvement

### Option 1: Inherit All Attributes from `wall_1`
Copy all attributes from `wall_1` to ensure no data loss:
```python
merged_wall = Wall.objects.create(
    project=wall_1.project,
    storey=wall_1.storey,
    start_x=norm_start_x,
    start_y=norm_start_y,
    end_x=norm_end_x,
    end_y=norm_end_y,
    height=wall_1.height,
    thickness=wall_1.thickness,
    application_type=wall_1.application_type,
    # Add all other attributes from wall_1
    inner_face_material=wall_1.inner_face_material,
    inner_face_thickness=wall_1.inner_face_thickness,
    outer_face_material=wall_1.outer_face_material,
    outer_face_thickness=wall_1.outer_face_thickness,
    has_concrete_base=wall_1.has_concrete_base,
    concrete_base_height=wall_1.concrete_base_height,
    fill_gap_mode=wall_1.fill_gap_mode,
    gap_fill_height=wall_1.gap_fill_height,
    gap_base_position=wall_1.gap_base_position,
    ceiling_joint_type=wall_1.ceiling_joint_type,
    ceiling_cut_l_horizontal_extension=wall_1.ceiling_cut_l_horizontal_extension,
    is_default=wall_1.is_default,
)
```

### Option 2: Smart Merge Strategy
Implement logic to merge compatible attributes or prefer non-default values:
- If both walls have the same value → use that value
- If one wall has a non-default value and the other is default → use the non-default
- If both have different non-default values → use `wall_1`'s value (or raise error if incompatible)

### Option 3: Validate Additional Attributes
Add validation to ensure more attributes match before allowing merge:
```python
if (
    wall_1.application_type != wall_2.application_type or
    wall_1.height != wall_2.height or
    wall_1.thickness != wall_2.thickness or
    wall_1.inner_face_material != wall_2.inner_face_material or
    wall_1.outer_face_material != wall_2.outer_face_material or
    # ... more validations
):
    raise ValueError('Walls must have matching properties to merge.')
```









