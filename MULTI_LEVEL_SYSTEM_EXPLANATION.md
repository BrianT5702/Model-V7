# Multi-Level System Explanation

This document provides a comprehensive understanding of how the multi-level (storey) system works in this application, including creation, wall management, room management, and editing.

## Table of Contents
1. [Core Concepts](#core-concepts)
2. [Data Models](#data-models)
3. [Level Creation](#level-creation)
4. [Adding Walls to Levels](#adding-walls-to-levels)
5. [Adding Rooms to Levels](#adding-rooms-to-levels)
6. [Editing Across Levels](#editing-across-levels)
7. [Key Functions and Workflows](#key-functions-and-workflows)
8. [Visual Filtering](#visual-filtering)

---

## Core Concepts

### What is a Storey/Level?
A **Storey** (also called "Level") represents a vertical floor level within a building project. Each storey has:
- **Name**: Human-readable label (e.g., "Ground Floor", "First Floor")
- **Elevation**: Base elevation in mm relative to project ground level (0 = ground)
- **Default Room Height**: Default height for rooms created on this level
- **Order**: Index for sorting levels from lowest to highest
- **Slab Thickness**: Structural thickness between this level and the one above

### Key Relationships
- **Project** → has many **Storeys**
- **Storey** → has many **Walls** (optional - walls can exist without a storey)
- **Storey** → has many **Rooms**
- **Room** → belongs to one **Storey**
- **Wall** → can belong to one **Storey** (optional)

---

## Data Models

### Storey Model (`core/models.py`)
```python
class Storey(models.Model):
    project = ForeignKey(Project, related_name='storeys')
    name = CharField(max_length=100)
    elevation_mm = FloatField()  # Base elevation in mm
    default_room_height_mm = FloatField(default=3000.0)
    order = PositiveIntegerField(default=0)  # For sorting
    slab_thickness_mm = FloatField(default=0.0)
```

### Wall Model (`core/models.py`)
```python
class Wall(models.Model):
    project = ForeignKey(Project, related_name="walls")
    storey = ForeignKey(Storey, related_name='walls', null=True, blank=True)  # OPTIONAL
    start_x, start_y, end_x, end_y = FloatField()
    height = FloatField(default=2800)
    thickness = FloatField(default=200)
    # ... other properties
```

**Important**: Walls can exist without a storey assignment. When a room is created on a storey, walls are automatically assigned to that storey if they don't already have one.

### Room Model (`core/models.py`)
```python
class Room(models.Model):
    project = ForeignKey(Project, related_name='rooms')
    storey = ForeignKey(Storey, related_name='rooms', null=True, blank=True)
    walls = ManyToManyField(Wall, related_name='rooms')
    room_name = CharField(max_length=100)
    height = FloatField()
    base_elevation_mm = FloatField(default=0.0)  # Relative to storey elevation
    # ... other properties
```

**Important**: 
- Rooms MUST belong to a storey
- `base_elevation_mm` is relative to the storey's `elevation_mm`
- A room's absolute elevation = `storey.elevation_mm + room.base_elevation_mm`

---

## Level Creation

### Automatic Creation
When a project is loaded, if no storeys exist, a default "Ground Floor" is automatically created:

```12:14:frontend/src/features/project/useProjectDetails.js
// Location: ensureStoreys function
const createPayload = {
  project: parseInt(projectId, 10),
  name: 'Ground Floor',
  elevation_mm: 0,
  order: 0,
  default_room_height_mm: fallbackProject.height || 3000,
  slab_thickness_mm: 0,
};
const createdResponse = await api.post('/storeys/', createPayload);
```

### Manual Creation via Storey Wizard
Users can create new levels using the **Storey Wizard**:

1. **Open Wizard**: `openStoreyWizard()` function
   - Automatically suggests next level name (e.g., "Ground Floor +1")
   - Pre-fills elevation based on highest existing level
   - Sets default room height from base storey

2. **Step 1**: Configure level properties
   - Name
   - Elevation (calculated from base level + height + slab thickness)
   - Default room height
   - Slab thickness

3. **Step 2**: Select rooms/areas to duplicate
   - Can select existing rooms from other levels
   - Can draw new areas on canvas
   - Can adjust base elevation and height for each room

4. **Create Storey**: Creates the storey and duplicates selected rooms

**Key Function**: `openStoreyWizard()` in `useProjectDetails.js`

---

## Adding Walls to Levels

### Automatic Assignment
When a room is created on a storey, walls are automatically assigned to that storey:

```716:722:core/services.py
if storey:
    for wall in walls:
        if wall.storey_id is None:
            wall.storey = storey
            wall.save(update_fields=['storey'])
            walls_to_update.append(wall.id)
            logger.info(f"Assigned wall {wall.id} to storey {storey.id}")
```

### Manual Wall Creation
When creating walls manually:
- Walls can be created without a storey (will be assigned when added to a room)
- Or can be explicitly assigned to a storey during creation

### Wall Duplication for Multi-Level
When duplicating a room to another level:

```1566:1616:frontend/src/features/project/useProjectDetails.js
for (const wallId of wallIds) {
  const wall = walls.find(w => w.id === wallId);
  if (!wall) continue;

  // Check if wall can be reused (shared between levels)
  const wallStorey = storeys.find(storey => String(storey.id) === String(wall.storey)) || null;
  const wallBaseElevation = wallStorey && wallStorey.elevation_mm !== undefined
    ? Number(wallStorey.elevation_mm) || 0 : 0;
  const wallHeight = wall.height !== undefined && wall.height !== null
    ? Number(wall.height) || 0 : 0;
  const wallTop = wallBaseElevation + wallHeight;
  const requiredTop = targetElevation + roomHeight;
  const sharedCount = Array.isArray(wall.rooms) ? wall.rooms.length : 0;
  
  // Reuse wall if it's shared and tall enough
  const shouldReuse = sharedCount > 1 && wallTop + 1e-3 >= requiredTop;
  
  if (shouldReuse) {
    reusedWallIds.push(wall.id);
    continue;
  }

  // Otherwise, create a new wall for this level
  const wallPayload = {
    project: projectId,
    storey: targetStoreyId,  // Assign to target storey
    start_x: wall.start_x,
    start_y: wall.start_y,
    end_x: wall.end_x,
    end_y: wall.end_y,
    height: wall.height,
    thickness: wall.thickness,
    // ... copy all other properties
  };
  const wallResponse = await api.post('/walls/', wallPayload);
  createdWalls.push(wallResponse.data);
}
```

**Key Logic**:
- **Reuse walls** if they're shared by multiple rooms AND tall enough to reach the new level
- **Create new walls** if they can't be reused (prevents conflicts)

---

## Adding Rooms to Levels

### Creating Rooms on a Level
When creating a room, you must specify which storey it belongs to:

```1630:1642:frontend/src/features/project/useProjectDetails.js
const roomPayload = {
  project: projectId,
  storey: targetStoreyId,  // REQUIRED: Which level this room is on
  room_name: overrides.room_name || `${room.room_name} (${roomStoreyName})`,
  floor_type: overrides.floor_type || room.floor_type || 'Panel',
  floor_thickness: overrides.floor_thickness ?? room.floor_thickness ?? 0,
  floor_layers: overrides.floor_layers ?? room.floor_layers ?? 1,
  temperature: overrides.temperature ?? room.temperature ?? 0,
  height: roomHeight,
  base_elevation_mm: targetElevation,  // Relative to storey elevation
  remarks: overrides.remarks ?? room.remarks ?? '',
  walls: uniqueWallIds,
  room_points: overrides.room_points || room.room_points || [],
};
```

### Duplicating Rooms to Another Level
The `duplicateRoomToStorey()` function handles copying rooms between levels:

**Process**:
1. Find source room and its properties
2. Calculate target elevation (respects overrides)
3. For each wall in the room:
   - Check if wall can be reused (shared + tall enough)
   - If not, create new wall on target storey
4. Create new room on target storey with:
   - Same room_points (polygon shape)
   - Adjusted base_elevation_mm
   - New or reused walls

**Key Function**: `duplicateRoomToStorey(roomId, targetStoreyId, overrides)`

---

## Editing Across Levels

### Level Edit Mode
The application has a special "Level Edit Mode" for managing rooms across levels:

**Entering Level Edit Mode**:
```169:176:frontend/src/features/project/useProjectDetails.js
const enterLevelEditMode = useCallback(() => {
  setIsLevelEditMode(true);
  setLevelEditSelections([]);
  setLevelEditOverrides({});
  setLevelEditError('');
  setLevelEditSuccess('');
  setSelectionContext('room');
}, []);
```

**Selecting Rooms to Add**:
```192:251:frontend/src/features/project/useProjectDetails.js
const toggleLevelEditRoom = useCallback((roomId) => {
  // Toggle room selection
  // When selecting, automatically calculate suggested base elevation:
  // - Get source room's base + height
  // - Suggest stacking on top of that, or at target level elevation
  const sourceBase = sourceRoom.base_elevation_mm + sourceStorey.elevation_mm;
  const sourceHeight = sourceRoom.height;
  const stackedBase = sourceBase + sourceHeight;
  const suggestedBase = Math.max(stackedBase, targetStoreyElevation);
  
  setLevelEditOverrides((prevOverrides) => ({
    ...prevOverrides,
    [key]: {
      baseElevation: suggestedBase,
      height: sourceHeight,
    },
  }));
}, [activeStorey, rooms, storeys]);
```

**Adding Rooms to Active Level**:
```1649:1742:frontend/src/features/project/useProjectDetails.js
const addRoomsToActiveStorey = useCallback(async () => {
  // Validations
  if (!isLevelEditMode) return;
  if (!activeStoreyId) {
    setLevelEditError('Select a level to edit before adding rooms.');
    return;
  }
  if (!Array.isArray(levelEditSelections) || levelEditSelections.length === 0) {
    setLevelEditError('Select at least one room to add to this level.');
    return;
  }

  const targetStorey = storeys.find((storey) => 
    String(storey.id) === String(activeStoreyId)
  ) || null;

  // For each selected room:
  for (const roomId of levelEditSelections) {
    const sourceRoom = rooms.find((room) => String(room.id) === String(roomId));
    const override = levelEditOverrides[String(roomId)] || {};
    
    // Calculate desired base and height (respects overrides)
    let desiredBase = override.baseElevation ?? targetStorey.elevation_mm;
    let desiredHeight = override.height ?? defaultHeight;
    
    // Ensure base is at least at storey elevation
    const minBase = Number(targetStorey.elevation_mm) || 0;
    if (desiredBase < minBase) {
      desiredBase = minBase;
    }

    // Duplicate room to target storey
    await duplicateRoomToStorey(sourceRoom.id, activeStoreyId, {
      base_elevation_mm: desiredBase,
      height: desiredHeight,
    });
  }
}, [isLevelEditMode, activeStoreyId, levelEditSelections, ...]);
```

### Override System
Users can override room properties when adding to a level:
- **Base Elevation**: Where the room sits vertically (relative to storey)
- **Height**: Room height
- **Room Name**: Optional name override

These overrides are stored in `levelEditOverrides` state and applied during duplication.

---

## Key Functions and Workflows

### 1. Storey Management

**`ensureStoreys(projectData)`**
- Ensures at least one storey exists
- Auto-creates "Ground Floor" if none exist
- Sorts storeys by order, elevation, then ID

**`applyStoreyList(incomingStoreys)`**
- Sorts and applies storey list
- Sets active storey (first one if current is invalid)

**`openStoreyWizard()`**
- Opens wizard to create new level
- Pre-fills defaults based on highest existing level

### 2. Room Duplication

**`duplicateRoomToStorey(roomId, targetStoreyId, overrides)`**
- Main function for copying rooms between levels
- Handles wall reuse logic
- Creates new walls when needed
- Returns created room

**`createRoomFromPolygon(points, targetStoreyId, options)`**
- Creates room from drawn polygon
- Creates walls automatically from polygon edges
- Assigns walls to target storey

### 3. Level Edit Mode

**`enterLevelEditMode()`**
- Activates level editing mode
- Clears previous selections

**`toggleLevelEditRoom(roomId)`**
- Toggles room selection for adding to level
- Auto-calculates suggested elevation

**`addRoomsToActiveStorey()`**
- Applies selected rooms to active level
- Uses overrides if provided
- Shows success/error messages

**`updateLevelEditOverride(roomId, updates)`**
- Updates override values for a room
- Validates values (ensures base >= storey elevation)

### 4. Wall Management

**Wall Assignment Logic** (in `core/services.py`):
```python
if storey:
    for wall in walls:
        if wall.storey_id is None:
            wall.storey = storey  # Auto-assign if unassigned
            wall.save()
        elif wall.storey_id == storey.id:
            # Already on this storey, use it
            pass
        else:
            # Wall belongs to different storey
            # Reuse it (walls can span multiple levels if tall enough)
            pass
```

---

## Visual Filtering

### Active Storey Filtering
The application filters what's visible based on the **active storey**:

```467:500:frontend/src/features/project/useProjectDetails.js
useEffect(() => {
  const matchesActiveStorey = (storeyId) => {
    if (!activeStoreyId) return true;  // Show all if no active storey
    if (storeyId === null || storeyId === undefined) {
      // Unassigned items: show if default storey is active
      return String(defaultStoreyId) === String(activeStoreyId);
    }
    return String(storeyId) === String(activeStoreyId);
  };

  // Filter walls
  const visibleWalls = walls.filter((wall) => 
    matchesActiveStorey(wall.storey)
  );
  setFilteredWalls(visibleWalls);

  // Filter rooms
  const visibleRooms = rooms.filter((room) => 
    matchesActiveStorey(room.storey)
  );
  setFilteredRooms(visibleRooms);

  // Filter doors (via wall association)
  const visibleDoors = doors.filter((door) => {
    const wallStorey = wallStoreyMap.get(String(door.wall));
    return matchesActiveStorey(wallStorey);
  });
  setFilteredDoors(visibleDoors);
}, [activeStoreyId, walls, rooms, doors, defaultStoreyId]);
```

**Key Points**:
- Only items belonging to the active storey are shown
- Unassigned items (storey = null) are shown when default storey is active
- This filtering applies to walls, rooms, doors, and joints

### Ghost Areas
Upper levels show "ghost areas" representing double-height spaces from lower levels:
- These are rooms from lower levels that extend into the current level
- Shown as semi-transparent overlays
- Cannot create new rooms in ghost areas

---

## Summary

### Creating a New Level
1. Click "Create New Storey" → Opens Storey Wizard
2. Configure level properties (name, elevation, height, slab thickness)
3. Select rooms to duplicate OR draw new areas
4. Adjust overrides (base elevation, height) if needed
5. Create storey → Rooms and walls are created/duplicated

### Adding Walls to a Level
- **Automatic**: When creating a room on a level, walls are auto-assigned
- **Manual**: Create walls and assign `storey` field
- **Duplication**: When duplicating rooms, walls are reused if possible, otherwise new walls are created

### Adding Rooms to a Level
- **New Room**: Create room and assign `storey` field
- **Duplicate Room**: Use `duplicateRoomToStorey()` or Level Edit Mode
- **Level Edit Mode**: Select rooms from other levels → Add to active level

### Editing
- **Level Edit Mode**: Special mode for managing rooms across levels
- **Overrides**: Can adjust base elevation and height when adding rooms
- **Active Storey**: Only items on active storey are visible/editable

---

## Important Notes

1. **Walls are Optional**: Walls can exist without a storey, but are auto-assigned when added to a room
2. **Wall Reuse**: Walls can be shared between levels if they're tall enough
3. **Elevation System**: 
   - Storey has `elevation_mm` (absolute from ground)
   - Room has `base_elevation_mm` (relative to storey)
   - Room's absolute elevation = `storey.elevation_mm + room.base_elevation_mm`
4. **Filtering**: Only items on the active storey are shown in the UI
5. **Ground Floor Protection**: The lowest storey (by order) cannot be deleted

---

## Code Locations

- **Models**: `core/models.py` (Storey, Wall, Room models)
- **Frontend Logic**: `frontend/src/features/project/useProjectDetails.js`
- **Backend Services**: `core/services.py` (RoomService)
- **API Views**: `core/views.py` (StoreyViewSet)
- **UI Components**: `frontend/src/features/project/ProjectDetails.js`


