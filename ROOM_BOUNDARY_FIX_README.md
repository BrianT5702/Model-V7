# Room Boundary Fix for Ceiling Plan Generation

## Problem Description

The issue was that when walls were updated in the wall plan, the ceiling plan generation was still using outdated room boundary points (`room_points`) from the Room model. This caused the ceiling plan to be generated with incorrect dimensions, showing values like 8036mm instead of 8000mm.

## Root Cause

The `room_points` field in the Room model was not being updated when walls were modified. The ceiling plan generation relied on these points to calculate room boundaries and generate panels, but they were stale.

## Solution Implemented

### 1. Room Boundary Recalculation Service

Added a new method `RoomService.recalculate_room_boundary_from_walls(room_id)` that:
- Collects all unique endpoints from the walls associated with a room
- Recalculates the room boundary points
- Updates the `room_points` field in the database

### 2. Automatic Boundary Updates

Modified the following endpoints to automatically recalculate room boundaries:
- **Wall Update**: When a wall is updated via `PUT/PATCH /walls/{id}/`
- **Wall Split**: When a wall is split via `POST /walls/split_wall/`
- **Wall Merge**: When walls are merged via `POST /walls/merge_walls/`
- **Room Update**: When a room is updated via `PUT/PATCH /rooms/{id}/`

### 3. Enhanced Ceiling Plan Generation

Modified `CeilingService.generate_ceiling_plan()` to:
- Automatically recalculate room boundaries before generating panels
- Refresh room data from the database to ensure fresh information
- Use the most up-to-date wall positions for panel generation

### 4. Manual Boundary Recalculation

Added new endpoints for manual boundary recalculation:
- `POST /rooms/recalculate_boundaries/` - Recalculate boundaries for all rooms in a project
- `POST /rooms/{id}/recalculate_boundary/` - Recalculate boundaries for a specific room

## API Endpoints

### Recalculate All Room Boundaries
```http
POST /api/rooms/recalculate_boundaries/
Content-Type: application/json

{
    "project_id": 123
}
```

### Recalculate Specific Room Boundary
```http
POST /api/rooms/{room_id}/recalculate_boundary/
```

## Usage Examples

### 1. After Updating Walls
When you update wall positions, room boundaries are automatically recalculated. No additional action is needed.

### 2. Manual Boundary Refresh
If you suspect room boundaries are out of sync, you can manually trigger a refresh:

```javascript
// Recalculate boundaries for all rooms in a project
const response = await fetch('/api/rooms/recalculate_boundaries/', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        project_id: projectId
    })
});

const result = await response.json();
console.log(`Updated ${result.updated_count} rooms`);
```

### 3. Before Generating Ceiling Plans
The ceiling plan generation now automatically ensures room boundaries are up-to-date, but you can also manually refresh them first:

```javascript
// Generate ceiling plan (boundaries are automatically recalculated)
const response = await fetch(`/api/ceiling-plans/${roomId}/generate_ceiling_plan/`, {
    method: 'POST'
});
```

## Testing

A test script `test_room_boundary_fix.py` is provided to verify the fix works correctly:

```bash
python test_room_boundary_fix.py
```

This script:
1. Creates a test project with walls
2. Updates wall positions
3. Verifies room boundaries are recalculated
4. Tests ceiling plan generation with updated dimensions

## Benefits

1. **Automatic Sync**: Room boundaries automatically stay in sync with wall positions
2. **Accurate Ceiling Plans**: Ceiling panels now reflect the actual current wall positions
3. **Consistent Data**: No more discrepancies between wall plan and ceiling plan dimensions
4. **Performance**: Efficient recalculation only when needed
5. **Debugging**: Manual recalculation endpoints for troubleshooting

## Migration Notes

- Existing projects will need to have their room boundaries recalculated
- Use the `POST /api/rooms/recalculate_boundaries/` endpoint with your project ID
- Future wall updates will automatically maintain boundary consistency

## Troubleshooting

### Room Boundaries Still Out of Sync?
1. Check if walls are properly associated with rooms
2. Manually trigger boundary recalculation
3. Verify wall coordinates are correct in the database

### Ceiling Plans Still Show Wrong Dimensions?
1. Ensure room boundaries were recalculated after wall updates
2. Check that the ceiling plan generation is using the latest room data
3. Verify the `room_points` field contains current wall endpoints

### Performance Issues?
1. Boundary recalculation only happens when walls are updated
2. For bulk updates, consider using the project-wide recalculation endpoint
3. Monitor database performance during large-scale updates

