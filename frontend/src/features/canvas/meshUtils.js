// Utility functions for mesh creation in Three.js
// Note: CSG operations are handled via vertex manipulation instead of three-csg-ts

// Calculate intersection point between two line segments
function calculateLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  
  if (Math.abs(denominator) < 1e-10) {
    // Lines are parallel or coincident
    return null;
  }
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;
  
  // Check if intersection is within both line segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      z: y1 + t * (y2 - y1)
    };
  }
  
  return null;
}

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
  const dx = endX - startX;
  const dz = endZ - startZ;
  const wallLength = Math.hypot(dx, dz);
  const wallDirX = dx / wallLength;
  const wallDirZ = dz / wallLength;
  // Calculate the wall's midpoint
  const wallMidX = (startX + endX) / 2;
  const wallMidZ = (startZ + endZ) / 2;
  // Calculate the direction to the model center
  const toCenterX = (modelCenter.x * scale) - wallMidX;
  const toCenterZ = (modelCenter.z * scale) - wallMidZ;

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
  } else {
    // Diagonal wall: use original logic
    const normX = -dz / wallLength;
    const normZ = dx / wallLength;
    const dotProduct = normX * toCenterX + normZ * toCenterZ;
    finalNormX = dotProduct < 0 ? -normX : normX;
    finalNormZ = dotProduct < 0 ? -normZ : normZ;
  }
  // Wall thickness positioning logic will be handled here
  // (Joint flipping logic removed for now)

  const wallDoors = instance.doors.filter(d => String(d.wall) === String(id));
  
  // Determine wall height and base position based on gap-fill mode
  let basePositionY = 0;  // Default: floor level
  let wallHeight;
  
  if (fill_gap_mode && gap_fill_height !== null && gap_base_position !== null) {
    // Gap-fill mode: position wall at gap base, use gap height
    basePositionY = gap_base_position * scale;
    wallHeight = gap_fill_height * scale;
  } else {
    // Normal mode: floor to ceiling
    // Find rooms that contain this wall and use the minimum base elevation
    // This ensures walls are positioned correctly for raised rooms
    let minBaseElevation = 0;
    if (instance.project && instance.project.rooms) {
      const roomsWithWall = instance.project.rooms.filter(room => 
        room.walls && room.walls.some(wallId => String(wallId) === String(id))
      );
      
      if (roomsWithWall.length > 0) {
        // Use the minimum base elevation (lowest room) so wall starts from the lowest point
        const baseElevations = roomsWithWall
          .map(room => room.base_elevation_mm ?? 0)
          .filter(elev => !isNaN(elev));
        
        if (baseElevations.length > 0) {
          minBaseElevation = Math.min(...baseElevations);
        }
      }
    }
    
    basePositionY = minBaseElevation * scale;
    wallHeight = height * scale;
  }
  
  const wallThickness = thickness * scale;
  
  // Flip start/end coordinates based on model center position and joint considerations
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  
  // Check for 45° cut joints first
  let shouldFlipForJoint = false;
  if (instance.joints && Array.isArray(instance.joints)) {
    for (const joint of instance.joints) {
      if ((joint.wall_1 === id || joint.wall_2 === id) && joint.joining_method === '45_cut') {
        // Find the connecting wall (the other wall in the joint)
        const connectingWallId = joint.wall_1 === id ? joint.wall_2 : joint.wall_1;
        const connectingWall = instance.walls.find(w => String(w.id) === String(connectingWallId));
        
        if (connectingWall) {
          // Calculate connecting wall midpoint
          const connectMidX = (connectingWall.start_x + connectingWall.end_x) / 2 * scale;
          const connectMidZ = (connectingWall.start_y + connectingWall.end_y) / 2 * scale;
          
          // Calculate current wall midpoint
          const wallMidX = (startX + endX) / 2;
          const wallMidZ = (startZ + endZ) / 2;
          
          // Determine if connecting wall and model center are on the same side
          let sameSide = false;
          
          if (isHorizontal) {
            // For horizontal wall, compare Z positions
            const modelCenterZ = modelCenter.z * scale;
            const wallZ = wallMidZ;
            const connectZ = connectMidZ;
            
            // Check if both model center and connecting wall are on the same side of the wall
            // For horizontal wall, we compare if both are above or both are below the wall
            const modelAboveWall = modelCenterZ > wallZ;
            const connectAboveWall = connectZ > wallZ;
            sameSide = modelAboveWall === connectAboveWall;
          } else if (isVertical) {
            // For vertical wall, compare X positions
            const modelCenterX = modelCenter.x * scale;
            const wallX = wallMidX;
            const connectX = connectMidX;
            
            // Check if both model center and connecting wall are on the same side of the wall
            // For vertical wall, we compare if both are to the right or both are to the left of the wall
            const modelRightOfWall = modelCenterX > wallX;
            const connectRightOfWall = connectX > wallX;
            sameSide = modelRightOfWall === connectRightOfWall;
          }
          
          // // Debug logging for all cases
          // console.log('[Joint Check]', {
          //   wallId: id,
          //   connectingWallId,
          //   isHorizontal,
          //   modelCenterZ: modelCenter.z * scale,
          //   modelCenterX: modelCenter.x * scale,
          //   wallMidZ,
          //   wallMidX,
          //   connectMidZ,
          //   connectMidX,
          //   sameSide,
          //   shouldFlip: !sameSide
          // });
          
          // If they're on opposite sides, we need to flip
          if (!sameSide) {
            shouldFlipForJoint = true;
            break;
          }
        }
      }
    }
  }
  
  // Apply flipping based on joint logic first, then model center logic
  if (shouldFlipForJoint) {
    if (isHorizontal) {
      // Flip start X with end X for horizontal wall
      finalStartX = endX;
      finalEndX = startX;
    } else if (isVertical) {
      // Flip start Y with end Y (which becomes start Z and end Z in 3D) for vertical wall
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  } else {
    // Original model center logic (only if no joint flipping was applied)
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
  }
  
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
            wall1StartX, wall1StartZ, wall1EndX, wall1EndZ,
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
  
  // console.log('[45° Cut Debug] Final result for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Calculate wall length using final coordinates
  const finalDx = finalEndX - finalStartX;
  const finalDz = finalEndZ - finalStartZ;
  const finalWallLength = Math.hypot(finalDx, finalDz);
  
  const wallShape = new instance.THREE.Shape();
  
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  
  let lastX = 0;
  
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
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : 1.05);
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
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    //console.log('[45° Cut Debug] About to apply boolean operations:', { hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness);
  } else {
    //console.log('[45° Cut Debug] No 45° cuts detected for this wall');
  }
  wallMesh.userData.isWall = true;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
  const edges = new instance.THREE.EdgesGeometry(wallGeometry);
  const edgeLines = new instance.THREE.LineSegments(edges, new instance.THREE.LineBasicMaterial({ color: 0x000000 }));
  wallMesh.add(edgeLines);
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
  return wallMesh;
}

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

export function createDoorMesh(instance, door, wall) {
  if (!door.calculatedPosition) {
    return null;
  }
  
  // IMPORTANT: This function handles door mesh creation with wall flipping adjustments.
  // When walls are flipped (for joint alignment or model center positioning), three things must be adjusted:
  // 1. Door positions - to maintain correct relative placement along the wall
  // 2. Door opening directions - to maintain correct swing/slide behavior
  // 3. Hinge positions - to maintain correct hinge placement relative to the door opening
  //
  // FLOOR PLACEMENT NOTE: 
  // - Swing doors: Positioned at doorHeight/2 (centered vertically) - working perfectly, DO NOT TOUCH
  // - Slide doors: Positioned at (doorHeight/2) + floorThickness to avoid floor intersection
  // Since floors now extend upward from Y=0 to Y=+thickness, slide doors are explicitly positioned above
  // the floor thickness while swing doors maintain their perfect positioning.
  const { x: doorPosX, z: doorPosZ, angle: wallAngle, width: cutoutWidth, height: doorHeight, depth: wallDepth, wasWallFlipped } = door.calculatedPosition;
  const scale = instance.scalingFactor;
  const { width, thickness, door_type, swing_direction, slide_direction, side, configuration } = door;
  
  // IMPORTANT: When wall start/end points are flipped, door properties must be adjusted:
  // 1. Swing doors: flip swing direction to maintain correct visual behavior
  // 2. Slide doors: flip side (interior/exterior) to maintain correct visual behavior
  const adjustedSwingDirection = wasWallFlipped ? (swing_direction === 'right' ? 'left' : 'right') : swing_direction;
  const adjustedSlideDirection = slide_direction; // Keep original slide direction
  const adjustedSide = wasWallFlipped ? (side === 'interior' ? 'exterior' : 'interior') : side;
  
  if (wasWallFlipped) {
    // Door properties adjusted for flipped wall
  }
  const doorWidth = width * scale * 1.05;
  const doorThickness = thickness * instance.scalingFactor;
  const sideCoefficient = side === 'exterior' ? 1 : -1;
  const doorMaterial = new instance.THREE.MeshStandardMaterial({
    color: door_type === 'swing' ? 0xF8F8FF : 0xF8F8FF,
    roughness: 0.5,
    metalness: 0.3,
    transparent: true,
    opacity: 1
  });
  if (door_type === 'slide') {
    // Offset the sliding door to align with the wall face based on side
    // For interior doors: position on inner face (toward room interior)
    // For exterior doors: position on outer face (toward outside)
    const doorOffsetZ = wallDepth/2;
    
    if (configuration === 'double_sided') {
      // Create double sliding doors
      const halfWidth = doorWidth * 0.48; // Slightly less than half to fit with gap
      
      // Create a door container
      const doorContainer = new instance.THREE.Object3D();
      // For slide doors: position above floor thickness to avoid intersection
      const room = instance.project?.rooms?.find(r => r.id === door.room);
      const floorThickness = room?.floor_thickness || 150;
      const baseElevation = (room?.base_elevation_mm ?? 0) * instance.scalingFactor;
      const adjustedY = baseElevation + (doorHeight/2) + (floorThickness * instance.scalingFactor);
      doorContainer.position.set(doorPosX, adjustedY, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      
      // Create both door panels
      const leftDoor = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(halfWidth, doorHeight, doorThickness),
        doorMaterial
      );
      
      const rightDoor = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(halfWidth, doorHeight, doorThickness),
        doorMaterial
      );
      
      // Position doors within the container, with proper offset for the wall side
      // For interior doors: position on inner face (Z = wallThickness, toward model center)
      // For exterior doors: position on outer face (Z = 0, database line face)
      if (adjustedSide === 'interior') {
        leftDoor.position.set(-halfWidth/2, 0, -wallDepth/2);
        rightDoor.position.set(halfWidth/2, 0, -wallDepth/2);
      } else {
        leftDoor.position.set(-halfWidth/2, 0, wallDepth * 1.2);
        rightDoor.position.set(halfWidth/2, 0, wallDepth * 1.2);
      }
      
      // Store original positions
      leftDoor.userData.origPosition = { x: leftDoor.position.x, z: leftDoor.position.z };
      rightDoor.userData.origPosition = { x: rightDoor.position.x, z: rightDoor.position.z };
      
      // Add to container
      doorContainer.add(leftDoor);
      doorContainer.add(rightDoor);
      
      // Register as a door object with metadata
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSlideDirection: adjustedSlideDirection,
        adjustedSide: adjustedSide
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true); // Start in open state
      
      // Animate doors sliding open
      const slideDistance = halfWidth * 0.9;
      
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(leftDoor.position, {
          x: -halfWidth/2 - slideDistance,
          z: leftDoor.position.z,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        
        window.gsap.to(rightDoor.position, {
          x: halfWidth/2 + slideDistance,
          z: rightDoor.position.z,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      
      return doorContainer;
    } else {
      // Single sliding door
      const doorMesh = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(doorWidth, doorHeight, doorThickness),
        doorMaterial
      );
      
      // Create door container to handle rotation and position
      const doorContainer = new instance.THREE.Object3D();
      // For slide doors: position above floor thickness to avoid intersection
      const room = instance.project?.rooms?.find(r => r.id === door.room);
      const floorThickness = room?.floor_thickness || 150;
      const baseElevation = (room?.base_elevation_mm ?? 0) * instance.scalingFactor;
      const adjustedY = baseElevation + (doorHeight/2) + (floorThickness * instance.scalingFactor);
      doorContainer.position.set(doorPosX, adjustedY, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      
      // Position door at wall face
      // For interior doors: position on inner face (Z = wallThickness, toward model center)
      // For exterior doors: position on outer face (Z = 0, database line face)
      if (adjustedSide === 'exterior') {
        doorMesh.position.z = wallDepth * 1.2;
      } else {
        doorMesh.position.z = -wallDepth/2;
      }
      doorContainer.add(doorMesh);
      
      // Store original position
      doorMesh.userData.origPosition = { x: 0, z: doorMesh.position.z };
      
      // Register as a door object with metadata
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSlideDirection: adjustedSlideDirection,
        adjustedSide: adjustedSide
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true); // Start in open state
      
      // Sliding direction
      const rawDirection = adjustedSlideDirection === 'right' ? -1 : 1;
      const slideDirectionSign = adjustedSide === 'exterior' ? -rawDirection : rawDirection;
      const slideDistance = doorWidth * 0.9;
      
      // Animate door sliding
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(doorMesh.position, {
          x: slideDistance * slideDirectionSign,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      
      return doorContainer;
    }
  }
  
  // === SWING DOOR IMPLEMENTATION ===
  else if (door_type === 'swing') {
    if (configuration === 'double_sided') {
      const halfWidth = doorWidth * 0.5;
      const doorContainer = new instance.THREE.Object3D();
      const room = instance.project?.rooms?.find(r => r.id === door.room);
      const baseElevation = (room?.base_elevation_mm ?? 0) * instance.scalingFactor;
      doorContainer.position.set(doorPosX, baseElevation + doorHeight/2, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      const leftPivot = new instance.THREE.Object3D();
      leftPivot.position.set(-cutoutWidth/2 + 0.1, 0, 0);
      doorContainer.add(leftPivot);
      const rightPivot = new instance.THREE.Object3D();
      rightPivot.position.set(cutoutWidth/2 - 0.1, 0, 0);
      doorContainer.add(rightPivot);
      const leftGeometry = new instance.THREE.BoxGeometry(halfWidth, doorHeight, doorThickness);
      leftGeometry.translate(halfWidth / 2, 0, +(wallDepth / 2));
      const rightGeometry = new instance.THREE.BoxGeometry(halfWidth, doorHeight, doorThickness);
      rightGeometry.translate(-halfWidth / 2, 0, +(wallDepth / 2));
      const leftPanel = new instance.THREE.Mesh(leftGeometry, doorMaterial);
      const rightPanel = new instance.THREE.Mesh(rightGeometry, doorMaterial);
      leftPanel.position.set(0, 0, 0);
      rightPanel.position.set(0, 0, 0);
      leftPivot.add(leftPanel);
      rightPivot.add(rightPanel);
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSwingDirection: adjustedSwingDirection,
        adjustedSide: adjustedSide
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}_left`, true);
      instance.doorStates.set(`door_${door.id}_right`, true);
      // For double-sided doors, the swing angles are determined by the side (interior/exterior)
      // When the wall is flipped, the side is adjusted, so the angles are automatically correct
      const leftAngle = Math.PI / 2 * (adjustedSide === 'exterior' ? 1 : -1);
      const rightAngle = Math.PI / 2 * (adjustedSide === 'exterior' ? -1 : 1);
      
      if (wasWallFlipped) {
        // Double door swing angles calculated with adjusted side
      }
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(leftPanel.rotation, {
          y: leftAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        window.gsap.to(rightPanel.rotation, {
          y: rightAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      return doorContainer;
    } else {
      const hingeOnRight = adjustedSwingDirection === 'right';
      const mountedInside = adjustedSide === 'interior';
      const doorContainer = new instance.THREE.Object3D();
      const room = instance.project?.rooms?.find(r => r.id === door.room);
      const baseElevation = (room?.base_elevation_mm ?? 0) * instance.scalingFactor;
      doorContainer.position.set(doorPosX, baseElevation + doorHeight/2, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      
      // IMPORTANT: When wall is flipped, the hinge position should also be flipped
      // to maintain correct visual behavior. The hinge should stay on the same relative side
      // of the door opening, regardless of wall flipping.
      let effectiveHingeOnRight = mountedInside ? !hingeOnRight : hingeOnRight;
      if (wasWallFlipped) {
        effectiveHingeOnRight = !effectiveHingeOnRight;
        // Hinge position flipped for wall flip
      }
      const pivotX = effectiveHingeOnRight ? cutoutWidth/2 - 0.1 : -cutoutWidth/2 + 0.1;
      const pivot = new instance.THREE.Object3D();
      pivot.position.set(pivotX, 0, 0);
      doorContainer.add(pivot);
      const doorGeometry = new instance.THREE.BoxGeometry(doorWidth, doorHeight, doorThickness);
      const offsetX = effectiveHingeOnRight ? -doorWidth/2 : doorWidth/2;
      doorGeometry.translate(offsetX, 0, 0);
      const doorPanel = new instance.THREE.Mesh(doorGeometry, doorMaterial);
      doorPanel.position.set(0, 0, +(wallDepth / 2));
      pivot.add(doorPanel);
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSwingDirection: adjustedSwingDirection,
        adjustedSide: adjustedSide,
        effectiveHingeOnRight: effectiveHingeOnRight
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true);
      let baseDir = 0;
      if (mountedInside) {
        baseDir = effectiveHingeOnRight ? 1 : -1;
      } else {
        baseDir = effectiveHingeOnRight ? -1 : 1;
      }
      const swingAngle = Math.PI / 2 * baseDir;
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(doorPanel.rotation, {
          y: swingAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      return doorContainer;
    }
  }
  return null;
} 