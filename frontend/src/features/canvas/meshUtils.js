// Utility functions for mesh creation in Three.js

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
  const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
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
  const wallHeight = height * scale;
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
          
          // Debug logging for all cases
          console.log('[Joint Check]', {
            wallId: id,
            connectingWallId,
            isHorizontal,
            modelCenterZ: modelCenter.z * scale,
            modelCenterX: modelCenter.x * scale,
            wallMidZ,
            wallMidX,
            connectMidZ,
            connectMidX,
            sameSide,
            shouldFlip: !sameSide
          });
          
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
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  
  console.log('[45° Cut Debug] Wall ID:', id, 'Joints:', instance.joints);
  
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
            
            console.log('[45° Cut Debug] Checking joint:', {
              wallId: id,
              jointId: j.id,
              otherWallId,
              jointX,
              jointZ,
              finalStartX,
              finalStartZ,
              finalEndX,
              finalEndZ,
              startMatch: nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ),
              endMatch: nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)
            });
            
            // Check if joint is at start (with tolerance)
            if (nearlyEqual(jointX, finalStartX) && nearlyEqual(jointZ, finalStartZ)) {
              hasStart45 = true;
              console.log('[45° Cut Debug] Found start 45° cut for wall:', id);
            }
            // Check if joint is at end (with tolerance)
            if (nearlyEqual(jointX, finalEndX) && nearlyEqual(jointZ, finalEndZ)) {
              hasEnd45 = true;
              console.log('[45° Cut Debug] Found end 45° cut for wall:', id);
            }
          }
        }
      }
    });
  }
  
  console.log('[45° Cut Debug] Final result for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Calculate wall length using final coordinates
  const finalDx = finalEndX - finalStartX;
  const finalDz = finalEndZ - finalStartZ;
  const finalWallLength = Math.hypot(finalDx, finalDz);
  
  const wallShape = new instance.THREE.Shape();
  const bevel = wallThickness; // Make 45° cuts more visible by doubling the depth
  
  console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45, 'bevel:', bevel);
  
  // Create wall shape with 45° cuts
  if (hasStart45) {
    // Start with 45° cut at the beginning
    console.log('[45° Cut Debug] Applying start 45° cut');
    wallShape.moveTo(bevel, 0);                // Start from the bevel point
    wallShape.lineTo(0, bevel);                // 45° cut up to the top
    wallShape.lineTo(0, wallHeight);           // Vertical line to top
  } else {
    // Normal start without bevel
    console.log('[45° Cut Debug] No start 45° cut');
    wallShape.moveTo(0, 0);
    wallShape.lineTo(0, wallHeight);
  }
  
  let lastX = hasStart45 ? bevel : 0;
  
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  
  if (wasWallFlipped && wallDoors.length > 0) {
    console.log('[Door Position Fix] Wall was flipped, adjusting door positions:', {
      wallId: id,
      originalStart: { x: startX, z: startZ },
      finalStart: { x: finalStartX, z: finalStartZ },
      doors: wallDoors.map(d => ({ id: d.id, originalPosition: d.position_x }))
    });
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
      console.log('[Door Position Fix] Door position adjusted:', {
        doorId: door.id,
        originalPosition: door.position_x,
        adjustedPosition: adjustedPositionX,
        doorPos: doorPos
      });
    }
    
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  
  // Continue wall shape to the end
  if (hasEnd45) {
    // End with 45° cut
    console.log('[45° Cut Debug] Applying end 45° cut');
    wallShape.lineTo(finalWallLength - bevel, wallHeight);  // Horizontal to bevel point
    wallShape.lineTo(finalWallLength, wallHeight - bevel);  // 45° cut down
    wallShape.lineTo(finalWallLength, 0);                   // Vertical to bottom
  } else {
    // Normal end without bevel
    console.log('[45° Cut Debug] No end 45° cut');
    wallShape.lineTo(finalWallLength, wallHeight);
    wallShape.lineTo(finalWallLength, 0);
  }
  
  // Close the shape
  wallShape.lineTo(lastX, 0);
  if (hasStart45) {
    wallShape.lineTo(bevel, 0);
  }
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
  const wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  wallMesh.userData.isWall = true;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, 0, finalStartZ + instance.modelOffset.z);
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

export function createDoorMesh(instance, door, wall) {
  if (!door.calculatedPosition) {
    return null;
  }
  
  // IMPORTANT: This function handles door mesh creation with wall flipping adjustments.
  // When walls are flipped (for joint alignment or model center positioning), three things must be adjusted:
  // 1. Door positions - to maintain correct relative placement along the wall
  // 2. Door opening directions - to maintain correct swing/slide behavior
  // 3. Hinge positions - to maintain correct hinge placement relative to the door opening
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
    console.log('[Door Direction Fix] Door properties adjusted:', {
      doorId: door.id,
      doorType: door_type,
      originalSwingDirection: swing_direction,
      adjustedSwingDirection: adjustedSwingDirection,
      originalSlideDirection: slide_direction,
      adjustedSlideDirection: adjustedSlideDirection,
      originalSide: side,
      adjustedSide: adjustedSide
    });
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
    const doorOffsetZ = (wallDepth/2);
    if (configuration === 'double_sided') {
      const halfWidth = doorWidth * 0.48;
      const doorContainer = new instance.THREE.Object3D();
      doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      const leftDoor = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness),
        doorMaterial
      );
      const rightDoor = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness),
        doorMaterial
      );
      if (adjustedSide === 'interior') {
        leftDoor.position.set(-halfWidth/2, 0, -doorOffsetZ);
        rightDoor.position.set(halfWidth/2, 0, -doorOffsetZ);
      } else {
        leftDoor.position.set(-halfWidth/2, 0, doorOffsetZ);
        rightDoor.position.set(halfWidth/2, 0, doorOffsetZ);
      }
      
      if (wasWallFlipped) {
        console.log('[Double Slide Door Position Fix] Door positioning adjusted:', {
          doorId: door.id,
          originalSide: side,
          adjustedSide: adjustedSide,
          doorOffsetZ: doorOffsetZ,
          leftDoorZ: leftDoor.position.z,
          rightDoorZ: rightDoor.position.z,
          wasWallFlipped: wasWallFlipped
        });
      }
      
      leftDoor.userData.origPosition = { x: leftDoor.position.x, z: leftDoor.position.z };
      rightDoor.userData.origPosition = { x: rightDoor.position.x, z: rightDoor.position.z };
      doorContainer.add(leftDoor);
      doorContainer.add(rightDoor);
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = door;
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true);
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
      const doorMesh = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(doorWidth, doorHeight * 0.98, doorThickness),
        doorMaterial
      );
      const doorContainer = new instance.THREE.Object3D();
      doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      if (adjustedSide === 'interior') {
        doorMesh.position.z = -doorOffsetZ;
      } else {
        doorMesh.position.z = doorOffsetZ; // Explicitly set exterior position
      }
      
      if (wasWallFlipped) {
        console.log('[Slide Door Position Fix] Door positioning adjusted:', {
          doorId: door.id,
          originalSide: side,
          adjustedSide: adjustedSide,
          doorOffsetZ: doorOffsetZ,
          doorMeshZ: doorMesh.position.z,
          wasWallFlipped: wasWallFlipped
        });
      }
      
      doorContainer.add(doorMesh);
      doorMesh.userData.origPosition = { x: 0, z: doorMesh.position.z };
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = door;
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true);
      const rawDirection = adjustedSlideDirection === 'right' ? -1 : 1;
      const slideDirectionSign = adjustedSide === 'exterior' ? -rawDirection : rawDirection;
      const slideDistance = doorWidth * 0.9;
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(doorMesh.position, {
          x: slideDistance * slideDirectionSign,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      return doorContainer;
    }
  } else if (door_type === 'swing') {
    if (configuration === 'double_sided') {
      const halfWidth = doorWidth * 0.48;
      const doorContainer = new instance.THREE.Object3D();
      doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
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
      doorContainer.userData.doorInfo = { ...door };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}_left`, true);
      instance.doorStates.set(`door_${door.id}_right`, true);
      // For double-sided doors, the swing angles are determined by the side (interior/exterior)
      // When the wall is flipped, the side is adjusted, so the angles are automatically correct
      const leftAngle = Math.PI / 2 * (adjustedSide === 'exterior' ? 1 : -1);
      const rightAngle = Math.PI / 2 * (adjustedSide === 'exterior' ? -1 : 1);
      
      if (wasWallFlipped) {
        console.log('[Double Door Swing Fix] Swing angles calculated with adjusted side:', {
          doorId: door.id,
          originalSide: side,
          adjustedSide: adjustedSide,
          leftAngle: leftAngle,
          rightAngle: rightAngle,
          wasWallFlipped: wasWallFlipped
        });
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
      doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      
      // IMPORTANT: When wall is flipped, the hinge position should also be flipped
      // to maintain correct visual behavior. The hinge should stay on the same relative side
      // of the door opening, regardless of wall flipping.
      let effectiveHingeOnRight = mountedInside ? !hingeOnRight : hingeOnRight;
      if (wasWallFlipped) {
        effectiveHingeOnRight = !effectiveHingeOnRight;
        console.log('[Hinge Position Fix] Hinge position flipped:', {
          doorId: door.id,
          originalHingeOnRight: !effectiveHingeOnRight,
          adjustedHingeOnRight: effectiveHingeOnRight,
          wasWallFlipped: wasWallFlipped
        });
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
      doorContainer.userData.doorInfo = door;
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