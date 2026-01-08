# 3D Wall Creation Analysis & Comparison with 2D Double Lines

## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)




## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)




## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)



## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)


## Overview
This document provides a detailed analysis of how 3D walls are created in the Three.js system, including how dataset points are used, face creation, wall expansion direction, edge cutting, and door hole cutting. It also compares this with the 2D double-line wall representation.

---

## 1. Dataset Points Usage

### 3D Model (ThreeCanvas3D.js / meshUtils.js)

**Source Points:**
- Each wall uses two endpoints from the dataset: `start_x, start_y` and `end_x, end_y`
- These are raw coordinates in model units (millimeters)

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
- Coordinates are scaled by `scalingFactor` (typically 0.01 to convert mm to Three.js units)
- Y coordinate from dataset becomes Z in 3D (Three.js uses Y-up)
- Points are snapped to precision 0.01 to avoid floating-point errors
- Model offset is applied later for centering

### 2D Plan View (FloorCanvas.js / drawing.js)

**Source Points:**
- Same dataset points: `wall.start_x, wall.start_y, wall.end_x, wall.end_y`

**Coordinate Usage:**
```433:436:frontend/src/features/canvas/FloorCanvas.js
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );
```

**Difference:** 
- 2D uses direct X/Y coordinates (no Y→Z conversion)
- Points are used to calculate offset lines representing wall thickness

---

## 2. Face Creation

### 3D Model - Wall Face Geometry

**Shape Creation:**
```243:251:frontend/src/features/canvas/meshUtils.js
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
```

**Process:**
1. Creates a 2D Shape in the X-Y plane (length × height)
2. Starts at (0, 0) and creates a rectangle
3. **Length** = wall length along X-axis
4. **Height** = wall height along Y-axis
5. The shape represents the **outer face** of the wall (the database line position)

**Extrusion:**
```297:301:frontend/src/features/canvas/meshUtils.js
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
```

- Extrudes the shape along the **Z-axis** (depth = wall thickness)
- Creates a box with dimensions: `length × height × thickness`
- **OUTER FACE** (database line) is at Z=0
- **INNER FACE** (toward model center) is at Z=thickness

**Orientation:**
```316:319:frontend/src/features/canvas/meshUtils.js
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
```

- Mesh is rotated around Y-axis to align with wall direction
- Positioned so the **database line face** is at the start position
- Thickness extends in the direction determined by normal calculation (toward model center)

### 2D Plan View - Double Lines

**Line Calculation:**
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

**Process:**
1. **line1** = original database line (outer face)
2. **line2** = offset inward by `2 × offset` (inner face)
3. Normal vector calculated: `(dy/length, -dx/length)` (perpendicular to wall)
4. Direction toward center determines which side is inner/outer
5. Gap = `wallThickness / 2` in pixels

**Drawing:**
```504:516:frontend/src/features/canvas/FloorCanvas.js
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
```

- **line1** = solid line (outer face)
- **line2** = dashed line (inner face)

---

## 3. Wall Expansion Direction (Inner/Outer)

### 3D Model - Normal Calculation

**Logic for Horizontal/Vertical Walls:**
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

**Key Concept:**
- **Database line** = OUTER face (at Z=0 after extrusion)
- **Thickness extends** in the direction of the normal vector (toward model center)
- If model center is on one side, wall expands to the other side

**Wall Flipping Logic:**
```111:130:frontend/src/features/canvas/meshUtils.js
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
```

**Extrusion Direction:**
- The wall face is created in X-Y plane
- Extruded along **+Z direction** (depth = thickness)
- After rotation, **thickness extends toward model center**

### 2D Plan View - Offset Direction

**Same Logic Applied:**
```1008:1015:frontend/src/features/canvas/drawing.js
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
```

**Key Points:**
- **line1** = outer face (database line, solid)
- **line2** = inner face (offset toward center, dashed)
- If dot product > 0, normal points toward center, so flip offset
- Gap between lines = `wallThickness` (in pixels)

**Consistency Check:**
- Both 3D and 2D use **model center** to determine direction
- Both ensure **outer face** = database line
- Both ensure **inner face** = toward center

---

## 4. Edge Cutting for 45° Joints

### 3D Model - 45° Cut Application

**Detection:**
```132:235:frontend/src/features/canvas/meshUtils.js
  // Check for 45° cut joints using final coordinates
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  // console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        
        if (otherWall) {
          // Calculate intersection point between the two walls
          const wall1StartX = finalStartX;
          const wall1StartZ = finalStartZ;
          const wall1EndX = finalEndX;
          const wall1EndZ = finalEndZ;
          
          const wall2StartX = otherWall.start_x * scale;
          const wall2StartZ = otherWall.start_y * scale;
          const wall2EndX = otherWall.end_x * scale;
          const wall2EndZ = otherWall.end_y * scale;
          
          // Calculate intersection point
          const intersection = calculateLineIntersection(
            wall1StartX, wall1StartZ, finalEndX, finalEndZ,
            wall2StartX, wall2StartZ, wall2EndX, wall2EndZ
          );
          
          if (intersection) {
            const jointX = intersection.x;
            const jointZ = intersection.z;
            
            // console.log('[45° Cut Debug] Checking joint:', {
            //   wallId: id,
            //   jointId: j.id,
            //   otherWallId,
            //   jointX,
            //   jointZ,
            //   finalStartX,
            //   finalStartZ,
            //   finalEndX,
            //   finalEndZ,
            //   startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
            //   endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            // });
            
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            
            const joinVec = {
              x: wall2EndX - wall2StartX,
              z: wall2EndZ - wall2StartZ
            };
            
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
            const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
            
            // Calculate bisector (average of the two vectors)
            const bisector = {
              x: (wallNorm.x + joinNorm.x) / 2,
              z: (wallNorm.z + joinNorm.z) / 2
            };
            
            // Normalize bisector
            const bisectorLen = Math.hypot(bisector.x, bisector.z);
            const bisectorNorm = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              startJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              endJointInfo = {
                otherWall,
                bisector: bisectorNorm,
                jointPoint: { x: jointX, z: jointZ }
              };
              // console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
```

**Vertex Manipulation:**
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
1. Finds joints with `joining_method === '45_cut'`
2. Calculates intersection point between walls
3. Determines if joint is at start or end
4. After extrusion, modifies vertices at the joint edge:
   - **Start cut**: Inner edge vertices moved forward (toward wall end)
   - **End cut**: Inner edge vertices moved backward (toward wall start)
5. Creates a 45° miter by shifting vertices based on their depth (t parameter)
   - t=0 (outer face): no shift
   - t=1 (inner face): maximum shift = thickness

### 2D Plan View - 45° Joint Adjustment

**Logic:**
```438:495:frontend/src/features/canvas/FloorCanvas.js
                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX * 2, y: wall.start_y - finalOffsetY * 2 };
                            line2[1] = { x: wall.end_x - finalOffsetX * 2, y: wall.end_y - finalOffsetY * 2 };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }
```

**Process:**
1. Detects 45° joints same as 3D
2. Adjusts **line2** (inner face) endpoints:
   - Extends inner line endpoints along wall direction
   - Adjustment = `wallThickness * 2` in model units
   - Creates visual representation of miter cut

**Difference:**
- 3D: Actually cuts geometry at 45° angle
- 2D: Extends inner line to show where miter would be

---

## 5. Door Hole Cutting

### 3D Model - Door Cutouts

**Cutout Creation:**
```253:296:frontend/src/features/canvas/meshUtils.js
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  
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
    
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    
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
1. Gets doors associated with this wall: `wallDoors = doors.filter(d => d.wall === wall.id)`
2. Door position is a **ratio** (0.0 to 1.0) along wall length: `door.position_x`
3. If wall is flipped, door position is flipped: `1 - position_x`
4. Calculates cutout:
   - **Center** = `doorPos = position_x * wallLength`
   - **Width** = door width × scale factor (with adjustments: slide 0.95, dock 1.0, swing 1.05)
   - **Height** = door height × scale factor × 1.02
5. Creates a **Path** (hole) in the wall shape
6. Path is added to `wallShape.holes[]`
7. When shape is extruded, holes become cutouts

**Door Position Calculation (for door mesh):**
```323:338:frontend/src/features/canvas/meshUtils.js
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
          cutout.doorInfo.calculatedPosition = {
        x: doorX,
        z: doorZ,
        angle: Math.atan2(finalDz, finalDx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness,
        wasWallFlipped: wasWallFlipped
      };
  }
```

### 2D Plan View - Door Representation

**No Explicit Door Cutouts in 2D:**
- 2D plan view shows walls as double lines
- Doors are typically represented as:
  - Opening in wall (gap in lines)
  - Or separate door symbols
  - Not explicitly cut from wall geometry

**If Doors Were Shown:**
- Would appear as gaps in the wall lines
- Position would use same `door.position_x` ratio
- Would need to account for wall flipping same as 3D

---

## 6. Key Differences & Consistency Issues

### Coordinate System
- **3D:** Y-up (Z = dataset Y, Y = height)
- **2D:** Y-down canvas coordinate system

### Normal Direction Calculation
- **3D:** Uses `toCenterX` and `toCenterZ` (after Y→Z conversion)
- **2D:** Uses `toCenterX` and `toCenterY` (direct)
- **Both:** Use model center to determine inner/outer direction
- **Consistency:** ✅ Same logic, different coordinate systems

### Wall Flipping
- **3D:** Flips start/end coordinates for horizontal/vertical walls based on model center
- **2D:** May not explicitly flip, but offset calculation achieves same result
- **Potential Issue:** ⚠️ Wall flipping in 3D might not match 2D offset logic exactly

### 45° Joint Handling
- **3D:** Actually cuts geometry at 45° angle by vertex manipulation
- **2D:** Extends inner line endpoints to show miter
- **Visual Consistency:** ⚠️ Might not perfectly match due to different approaches

### Door Positions
- **3D:** Accounts for wall flipping when positioning doors
- **2D:** May not show doors explicitly in wall lines
- **If Shown:** Should use same flipping logic

---

## 7. Potential Issues to Check

1. **Wall Direction Mismatch:**
   - 3D flips walls based on model center position
   - 2D uses offset calculation
   - **Verify:** Do walls extend in same direction in both views?

2. **45° Joint Alignment:**
   - 3D cuts at actual 45° angle
   - 2D extends lines
   - **Verify:** Do joint endpoints align correctly?

3. **Door Position Consistency:**
   - 3D flips door positions when wall is flipped
   - 2D may not show doors
   - **Verify:** If 2D shows doors, do they match 3D positions?

4. **Inner/Outer Face Identification:**
   - Both use model center to determine direction
   - **Verify:** Is the same face identified as "inner" in both views?

---

## Conclusion

The 3D wall creation process is comprehensive and handles:
- ✅ Dataset point usage with proper scaling
- ✅ Face creation via 2D shape extrusion
- ✅ Direction determination using model center
- ✅ 45° joint cutting via vertex manipulation
- ✅ Door hole cutting via shape holes

The 2D double-line representation uses similar logic but in 2D space. The main areas to verify are:
- Wall direction consistency between views
- Joint alignment accuracy
- Door position matching (if doors are shown in 2D)




