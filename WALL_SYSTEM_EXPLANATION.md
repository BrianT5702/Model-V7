# Complete Wall System Explanation

## 1. Coordinate System

### Database Coordinates (2D)
- **Origin**: (0, 0) is at **top-left**
- **X-axis**: Increases **rightward** (→)
- **Y-axis**: Increases **downward** (↓)
- **Wall Data**: `start_x`, `start_y`, `end_x`, `end_y` are in **millimeters (mm)**

### 3D Coordinates (Three.js)
- **X-axis**: Same as 2D X (rightward)
- **Y-axis**: **Vertical** (upward in 3D space, represents height/elevation)
- **Z-axis**: Maps to 2D Y (forward in 3D, downward in 2D view)
- **Scaling**: All coordinates are multiplied by `scalingFactor` (typically 0.01) to convert mm to meters

### Coordinate Conversion
```javascript
// 2D to 3D conversion
startX = start_x * scale          // X stays X
startZ = start_y * scale          // 2D Y becomes 3D Z
endX = end_x * scale
endZ = end_y * scale
```

## 2. Wall Data Structure

### Database Fields
- `start_x`, `start_y`: Starting point in 2D (mm)
- `end_x`, `end_y`: Ending point in 2D (mm)
- `thickness`: Wall thickness (mm)
- `height`: Wall height (mm)
- `base_elevation_mm`: Base elevation (absolute, in mm)
- `base_elevation_manual`: Boolean - if true, use wall's base_elevation_mm; if false, use room's base_elevation_mm

## 3. Wall Processing Pipeline

### STEP 0: Initial Setup
1. **Scale coordinates**: Convert from mm to 3D units
   ```javascript
   startX = snap(start_x * scale)
   startZ = snap(start_y * scale)  // Note: Y becomes Z
   endX = snap(end_x * scale)
   endZ = snap(end_y * scale)
   ```

2. **Determine orientation**:
   - `isHorizontal`: `Math.abs(start_y - end_y) < 1e-6`
   - `isVertical`: `Math.abs(start_x - end_x) < 1e-6`

3. **Calculate model center**:
   - If project has `width` and `length`: `center = (width/2 * scale, length/2 * scale)`
   - Otherwise: Average of all wall endpoints

### STEP 1: Wall Flipping (Based on Model Center Only)

**Purpose**: Ensure consistent wall orientation for thickness direction calculation.

**Rules**:
- **Horizontal walls**: If `modelCenter.z < startZ` (center is above wall), flip start/end X coordinates
- **Vertical walls**: If `modelCenter.x > startX` (center is to the right), flip start/end Z coordinates

**Result**: `finalStartX`, `finalStartZ`, `finalEndX`, `finalEndZ`

**Important**: Flipping is **ONLY** based on model center position. Joints do NOT affect flipping.

### STEP 2: Normal Calculation

**Purpose**: Determine which direction the wall thickness extends (toward room interior).

**Process**:
1. Calculate wall direction vector: `(finalEndX - finalStartX, finalEndZ - finalStartZ)`
2. Calculate perpendicular normal: `(-uz, ux)` where `(ux, uz)` is normalized wall direction
3. Calculate vector from wall midpoint to model center
4. Use dot product to determine if normal points toward center:
   - If `dot < 0`: Normal points away from center, flip it
   - Result: `finalNormX`, `finalNormZ` (points toward model center = room interior)

**The normal indicates the direction of wall thickness expansion.**

### STEP 3: Wall Extension (Perpendicular Walls Only)

**Purpose**: Extend walls to meet at joints, ensuring walls connect properly.

**Process**:
1. For each joint with another wall:
   - Check if walls are perpendicular (one horizontal, one vertical)
   - Calculate other wall's inner/outer surfaces based on its normal
   - Extend this wall's endpoint to meet the other wall's surface

**Extension Logic**:
- **Horizontal wall + Vertical wall**:
  - If vertical wall is on the right: Extend horizontal wall's rightmost endpoint to vertical wall's rightmost surface
  - If vertical wall is on the left: Extend horizontal wall's leftmost endpoint to vertical wall's leftmost surface
- **Vertical wall + Horizontal wall**:
  - If horizontal wall is on top: Extend vertical wall's topmost endpoint to horizontal wall's topmost surface
  - If horizontal wall is on bottom: Extend vertical wall's bottommost endpoint to horizontal wall's bottommost surface

**Result**: Extended `finalStartX`, `finalStartZ`, `finalEndX`, `finalEndZ`

### STEP 4: Butt-In Joint Shortening

**Purpose**: Shorten `wall_1` at butt-in joints by the joining wall's thickness.

**Process**:
1. Find all `butt_in` joints where this wall is `wall_1`
2. For each joint:
   - Find intersection point with joining wall
   - Determine if joint is at start or end
   - Calculate shortening distance = joining wall's thickness
3. Shorten wall by moving start/end points inward along wall direction:
   - Start: `finalStartX += wallDirX * startShorteningThickness`
   - End: `finalEndX -= wallDirX * endShorteningThickness`

**Result**: Shortened `finalStartX`, `finalStartZ`, `finalEndX`, `finalEndZ`

### STEP 5: 45-Degree Cut Detection

**Purpose**: Detect 45-degree miter joints and determine which face to cut from.

**Process**:
1. For each `45_cut` joint:
   - Find intersection point with joining wall
   - Determine if joint is at start or end
   - Calculate bisector direction (average of wall directions)
   - Determine if cut should be on inner or outer face:
     - `startCutOnInner`: Joining wall is on inner side
     - `endCutOnInner`: Joining wall is on inner side

**Result**: `hasStart45`, `hasEnd45`, `startCutOnInner`, `endCutOnInner`

## 4. Wall Mesh Creation

### Geometry Creation
1. **Shape**: Rectangle from `(0, 0)` to `(finalWallLength, wallHeight)`
2. **Extrusion**: Extrude along Z-axis by `wallThickness`
   - The shape is in local coordinates: X along wall, Y vertical, Z depth
   - Extrusion depth = `wallThickness`

### Mesh Positioning
```javascript
// Position mesh at finalStartX, finalStartZ (the database line position)
wallMesh.position.set(
  finalStartX + instance.modelOffset.x,  // X position
  basePositionY,                          // Y position (base elevation)
  finalStartZ + instance.modelOffset.z   // Z position
);

// Rotate to align with wall direction
wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
```

### Critical Understanding: Wall Thickness Direction

**The wall mesh is positioned so that:**
- **Outer face** (database line) is at `(finalStartX, finalStartZ)` to `(finalEndX, finalEndZ)`
- **Thickness extends** in the direction of `finalNormX, finalNormZ` by `wallThickness`
- **Inner face** is at: `outerFace + (normal * thickness)`

**In the wall's local coordinate system:**
- The shape is created at Z=0 (outer face)
- Extrusion extends to Z=wallThickness (inner face)
- The normal direction determines which way "Z" points in world space

## 5. Wall Faces

### Outer Face (Database Line)
- **Position**: `(finalStartX, finalStartZ)` to `(finalEndX, finalEndZ)`
- **This is the original database coordinate line**
- **Color**: RED in debug visualization

### Inner Face (Room Interior)
- **Position**: 
  ```javascript
  innerStartX = finalStartX + finalNormX * wallThickness
  innerStartZ = finalStartZ + finalNormZ * wallThickness
  innerEndX = finalEndX + finalNormX * wallThickness
  innerEndZ = finalEndZ + finalNormZ * wallThickness
  ```
- **This is the face that the floor should align with**
- **Color**: BLUE in debug visualization

### Normal Vector
- **Direction**: Points from outer face toward inner face
- **Length**: 1.0 (normalized)
- **Color**: GREEN in debug visualization

## 6. Wall Base Elevation

### Calculation Priority
1. **If `base_elevation_manual === true`**:
   - Use `wall.base_elevation_mm` (absolute value in mm)

2. **If `base_elevation_manual === false`**:
   - Find all rooms containing this wall
   - Use minimum `room.base_elevation_mm` from those rooms (absolute value in mm)

3. **Convert to 3D**:
   ```javascript
   basePositionY = wallBaseElevation * scale
   ```

### Wall Height
- **Wall extends from**: `basePositionY` to `basePositionY + wallHeight`
- **Wall height**: `height * scale`

## 7. Key Points for Floor Generation

### Final Wall Coordinates
After all processing, the wall's final coordinates are:
- **Outer face**: `(finalStartX, finalStartZ)` to `(finalEndX, finalEndZ)`
- **Inner face**: `(innerStartX, innerStartZ)` to `(innerEndX, innerEndZ)`

### For Floor Alignment
- **Floor should align with the INNER FACE** of walls
- **Use the FINAL coordinates** (after flipping, extension, shortening)
- **Normal direction** indicates which side is the interior

### Coordinate Consistency
- All coordinates are in **scaled 3D space** (meters, not mm)
- Model center is **already scaled**, don't scale again
- Wall positions include `modelOffset` for centering in scene

## 8. Example: Wall 7255

### Database Data
```javascript
{
  id: 7255,
  start_x: 3049.0,  // mm
  start_y: 2243.0,  // mm (Y increases downward)
  end_x: 5000.0,
  end_y: 2243.0,
  thickness: 150.0   // mm
}
```

### Processing Steps
1. **Initial**: `(30.49, 22.43)` to `(50.0, 22.43)` (scaled)
2. **After Flip**: `(50.0, 22.43)` to `(30.49, 22.43)` (flipped because model center is below)
3. **After Extension**: Extended to meet perpendicular walls
4. **After Shortening**: Shortened at butt-in joints
5. **Final Normal**: Should point downward (positive Z) toward model center

### Final Result
- **Outer face**: `(50.0, 22.43)` to `(30.49, 22.43)` (or extended version)
- **Inner face**: Outer face + `(normal * 1.5)` (150mm = 1.5 in scaled units)
- **Normal**: Points toward model center (downward for this wall)

## 9. Common Issues

### Issue 1: Normal Direction Wrong
- **Symptom**: Wall thickness extends in wrong direction
- **Cause**: Normal calculation or flipping logic incorrect
- **Fix**: Ensure normal points toward model center

### Issue 2: Walls Don't Meet
- **Symptom**: Gaps at joints
- **Cause**: Extension logic not working or wrong surface calculation
- **Fix**: Ensure extension uses correct inner/outer surfaces

### Issue 3: Floor Doesn't Align
- **Symptom**: Floor overlaps or has gaps with walls
- **Cause**: Using wrong coordinates or not accounting for wall processing
- **Fix**: Use final inner face coordinates after all processing

### Issue 4: Double Scaling
- **Symptom**: Model center appears at wrong position
- **Cause**: Scaling model center twice
- **Fix**: Model center is already scaled, don't scale again

## 10. Debug Visualization

For Wall 7255, debug lines show:
- **RED line**: Outer face (database line position)
- **BLUE line**: Inner face (outer face + normal * thickness)
- **GREEN arrow**: Normal direction (thickness expansion direction)

These help verify:
1. Wall coordinates are correct
2. Normal direction is correct
3. Inner face position is correct





