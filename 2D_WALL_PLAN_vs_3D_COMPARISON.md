# 2D Wall Plan (Canvas2D) vs 3D Model Creation - Detailed Comparison

## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.




## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.




## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.



## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.


## Overview
This document compares the **2D wall plan** drawing process in `Canvas2D.js` (using `drawWalls` from `drawing.js`) with the **3D model** creation process in `ThreeCanvas3D.js` (using `createWallMesh` from `meshUtils.js`).

---

## 1. Dataset Points Usage

### 2D Wall Plan (drawing.js)

**Source Points:**
- Each wall uses: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`
- These are direct coordinates from the database

**First Pass - Create Double Lines:**
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**Key Points:**
- Uses X/Y coordinates directly (no conversion)
- Creates double lines immediately: `line1` (outer) and `line2` (inner)
- `line1` = database line (outer face)
- `line2` = offset inward by `gapPixels * 2` (inner face)

### 3D Model (meshUtils.js)

**Source Points:**
- Same dataset: `start_x, start_y, end_x, end_y`

**Coordinate Transformation:**
```27:39:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
```

**Key Points:**
- Converts Y → Z (Three.js uses Y-up, Z is depth)
- Applies scaling factor (typically 0.01)
- Snaps to precision 0.01
- Model offset applied later

**Difference:** 
- **2D**: Direct X/Y, creates lines immediately
- **3D**: Converts Y→Z, creates geometry later

---

## 2. Order of Operations

### 2D Wall Plan - Three Pass System

**PASS 1: Create Double Lines First** (Lines 1331-1351)
```1331:1351:frontend/src/features/canvas/drawing.js
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
    
    walls.forEach((wall) => {
        // ... calculate gapPixels ...
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
```

**PASS 2: Extend to Intersections (Butt-In Joints)** (Lines 1353-1846)
```1353:1486:frontend/src/features/canvas/drawing.js
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        // ... find walls at intersection ...
        // ... process vertical-horizontal pairs ...
        // ... extend wall2, shorten wall1 for butt_in joints ...
    });
```

**PASS 3: Apply 45° Cuts and Draw** (Lines 1861-2054)
```1861:2054:frontend/src/features/canvas/drawing.js
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        // ... get lines from wallLinesMap (already extended) ...
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // ... detection logic ...
        
        // Apply 45° cut shortening at each end independently
        if (startHas45) {
            // Shorten appropriate line at start
        }
        
        if (endHas45) {
            // Shorten appropriate line at end
        }
        
        // Draw the final lines
        drawWallLinePair(context, [line1, line2], ...);
    });
```

**Order Summary (2D):**
1. ✅ **First**: Create double lines (`line1`, `line2`) using `calculateOffsetPoints`
2. ✅ **Then**: Extend lines to intersections (butt_in joints)
3. ✅ **Then**: Apply 45° cut shortening
4. ✅ **Finally**: Draw the lines

### 3D Model - Single Pass with Geometry Creation

**STEP 1: Process Coordinates** (Lines 27-130)
```27:130:frontend/src/features/canvas/meshUtils.js
export function createWallMesh(instance, wall) {
  const { start_x, start_y, end_x, end_y, height, thickness, id, ... } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  
  // Snap and scale coordinates
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  
  // Flip start/end based on model center
  // ... flipping logic ...
```

**STEP 2: Detect 45° Joints** (Lines 132-235)
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  // ... detection logic using intersections ...
```

**STEP 3: Create Wall Shape** (Lines 243-296)
```243:296:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  // Add door cutouts
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    // ... create cutout holes ...
  });
  
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    // ... create hole path ...
    wallShape.holes.push(doorHole);
  }
```

**STEP 4: Extrude Geometry** (Lines 297-304)
```297:304:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
```

**STEP 5: Apply 45° Cuts via Vertex Manipulation** (Lines 306-312, 342-380)
```306:312:frontend/src/features/canvas/meshUtils.js
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
```

**Order Summary (3D):**
1. ✅ Process coordinates (scale, snap, flip)
2. ✅ **Detect 45° joints** (before geometry creation)
3. ✅ Create 2D shape (rectangle)
4. ✅ Add door holes (as shape holes)
5. ✅ **Extrude** to create 3D geometry
6. ✅ **Apply 45° cuts** via vertex manipulation (after extrusion)
7. ✅ Rotate and position mesh

**Key Difference:**
- **2D**: Creates lines first, then modifies them (extension → 45° cuts)
- **3D**: Creates geometry first (extrusion), then modifies vertices (45° cuts)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 2D Wall Plan

**Double Line Creation:**
```993:1026:frontend/src/features/canvas/drawing.js
// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}
```

**Logic:**
- **Normal vector**: `(dy/length, -dx/length)` - perpendicular to wall
- **Direction to center**: From wall midpoint to model center
- **Dot product** determines which side is inner/outer
- **line1** = database line (outer face)
- **line2** = offset by `-finalOffset * 2` (inner face, toward center)

### 3D Model

**Normal Calculation:**
```47:69:frontend/src/features/canvas/meshUtils.js
  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  let finalNormX, finalNormZ;
  if (isHorizontal) {
    // Normal is along Z axis (up or down)
    if (toCenterZ < 0) {
      finalNormX = 0;
      finalNormZ = -1;
    } else {
      finalNormX = 0;
      finalNormZ = 1;
    }
  } else if (isVertical) {
    // Normal is along X axis (left or right)
    if (toCenterX < 0) {
      finalNormX = -1;
      finalNormZ = 0;
    } else {
      finalNormX = 1;
      finalNormZ = 0;
    }
  }
```

**Extrusion Direction:**
```297:319:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  // ... material ...
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // ... 45° cuts ...
  
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

**Logic:**
- Shape created in X-Y plane
- Extruded along **+Z axis** (depth = thickness)
- **Outer face** (database line) at Z=0
- **Inner face** at Z=thickness (toward model center after rotation)
- Normal vector points toward model center
- Thickness extends in normal direction

**Consistency Check:**
- ✅ Both use **model center** to determine direction
- ✅ Both ensure **outer face** = database line
- ✅ Both ensure **inner face** = toward center
- ✅ Same logic, different coordinate systems

---

## 4. 45° Joint Handling

### 2D Wall Plan

**Detection (Third Pass):**
```1932:1994:frontend/src/features/canvas/drawing.js
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                // ... determine which side (left/right) joining wall is on ...
            }
        });
```

**Application (Shortening Lines):**
```1996:2054:frontend/src/features/canvas/drawing.js
        // Apply 45° cut shortening at each end independently
        // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
        const wallThickness = wall.thickness || 100;
        const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                // ... similar logic ...
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // ... similar shortening logic ...
        }
```

**Process:**
1. Detects 45° joints in **third pass** (after lines are extended)
2. Determines which line (left/right) to shorten based on joining wall position
3. Shortens appropriate line endpoint by `wallThickness * 2` along wall direction
4. Creates visual miter by pulling one line back

### 3D Model

**Detection (Before Geometry Creation):**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const intersection = calculateLineIntersection(...);
          
          if (intersection) {
            // ... calculate bisector for miter angle ...
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = { otherWall, bisector: bisectorNorm, jointPoint: { x: jointX, z: jointZ } };
            }
          }
        }
      }
    });
  }
```

**Application (Vertex Manipulation After Extrusion):**
```342:380:frontend/src/features/canvas/meshUtils.js
function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness) {
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  const epsEndX = Math.max(1e-6 * lenX, 1e-5);

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      arr[ix] = x - t * thickness;
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      arr[ix] = x + t * thickness;
    }
  }

  pos.needsUpdate = true;
  wallMesh.geometry.computeVertexNormals();
  return wallMesh;
}
```

**Process:**
1. Detects 45° joints **before** geometry creation
2. Creates rectangular geometry first (with door holes)
3. Extrudes geometry
4. **After extrusion**, manipulates vertices to create 45° miter:
   - **Start cut**: Inner edge vertices moved forward (toward end)
   - **End cut**: Inner edge vertices moved backward (toward start)
   - Amount of shift depends on depth: `t * thickness` where t=0 (outer) to t=1 (inner)

**Key Difference:**
- **2D**: Shortens one of the double lines by fixed amount (`wallThickness * 2`)
- **3D**: Creates actual 45° miter by vertex manipulation with depth-dependent shift

---

## 5. Door Hole Cutting

### 2D Wall Plan

**No Explicit Door Cutouts:**
- 2D wall plan shows walls as double lines
- Doors are typically not explicitly cut from wall lines
- May be represented as gaps or separate door symbols

### 3D Model

**Door Holes as Shape Holes:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
  }
```

**Process:**
1. Gets doors for this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0): `door.position_x`
3. Accounts for wall flipping: `adjustedPositionX = wasWallFlipped ? (1 - position_x) : position_x`
4. Creates rectangular holes in the wall shape **before extrusion**
5. When extruded, holes become 3D cutouts

**Key Difference:**
- **2D**: No explicit door cutouts in wall lines
- **3D**: Door holes cut from geometry before extrusion

---

## 6. Summary of Key Differences

| Aspect | 2D Wall Plan (Canvas2D) | 3D Model (ThreeCanvas3D) |
|--------|------------------------|--------------------------|
| **Order** | 1. Create double lines<br>2. Extend to intersections<br>3. Apply 45° cuts<br>4. Draw | 1. Process coordinates<br>2. Detect 45° joints<br>3. Create shape + door holes<br>4. Extrude<br>5. Apply 45° cuts |
| **Double Lines** | ✅ Created first using `calculateOffsetPoints` | ❌ No double lines (3D geometry) |
| **Wall Expansion** | Line offset based on model center | Extrusion along Z, normal toward center |
| **45° Cuts** | Shorten one line by fixed amount | Vertex manipulation with depth-dependent shift |
| **Door Holes** | Not explicitly cut from lines | Cut from shape before extrusion |
| **Joint Handling** | Line extensions/shortenings | Vertex manipulations after extrusion |

---

## 7. Potential Issues to Verify

1. **Wall Direction Consistency:**
   - Both use model center to determine inner/outer
   - **Verify**: Do walls expand in the same direction in both views?

2. **45° Joint Alignment:**
   - 2D shortens lines by fixed amount
   - 3D creates actual 45° miter via vertex shift
   - **Verify**: Do joint endpoints align correctly between views?

3. **Door Position Consistency:**
   - 3D accounts for wall flipping
   - **Verify**: Are door positions consistent if doors are shown in 2D?

4. **Coordinate System:**
   - 2D uses X/Y directly
   - 3D converts Y→Z
   - **Verify**: Are start/end points consistent after conversion?

---

## Conclusion

The **2D wall plan** uses a **three-pass system**:
1. **First**: Create double lines (`line1`, `line2`)
2. **Then**: Extend/shorten for intersections (butt_in joints)
3. **Finally**: Apply 45° cut shortening

The **3D model** uses a **single pass** with geometry operations:
1. Create shape with door holes
2. Extrude to 3D
3. Apply 45° cuts via vertex manipulation

Both use the **same dataset points** and **same model center logic** for direction, but process them differently due to the nature of 2D lines vs 3D geometry.




