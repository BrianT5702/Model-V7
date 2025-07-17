// Utility functions for mesh creation in Three.js

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
  // --- Joint-aware normal flipping logic ---
  // Helper to get normal for a wall (same logic as above)
  function getWallNormal(wall, modelCenter, scale) {
    const sx = snap(wall.start_x * scale);
    const sz = snap(wall.start_y * scale);
    const ex = snap(wall.end_x * scale);
    const ez = snap(wall.end_y * scale);
    const dx = ex - sx;
    const dz = ez - sz;
    const wallLength = Math.hypot(dx, dz);
    const wallMidX = (sx + ex) / 2;
    const wallMidZ = (sz + ez) / 2;
    const toCenterX = (modelCenter.x * scale) - wallMidX;
    const toCenterZ = (modelCenter.z * scale) - wallMidZ;
    const isHorizontal = Math.abs(wall.start_y - wall.end_y) < 1e-6;
    const isVertical = Math.abs(wall.start_x - wall.end_x) < 1e-6;
    let nX, nZ;
    if (isHorizontal) {
      nX = 0;
      nZ = toCenterZ < 0 ? -1 : 1;
    } else if (isVertical) {
      nX = toCenterX < 0 ? -1 : 1;
      nZ = 0;
    } else {
      const normX = -dz / wallLength;
      const normZ = dx / wallLength;
      const dotProduct = normX * toCenterX + normZ * toCenterZ;
      nX = dotProduct < 0 ? -normX : normX;
      nZ = dotProduct < 0 ? -normZ : normZ;
    }
    return { nX, nZ };
  }

  // Find all joints involving this wall
  let flipNormal = false;
  if (instance.joints && Array.isArray(instance.joints)) {
    for (const joint of instance.joints) {
      // Only consider joints with joining_method '45_cut'
      if ((joint.wall_1 === id || joint.wall_2 === id) && joint.joining_method === '45_cut') {
        // Find the joining wall (the other wall in the joint)
        const joiningWallId = joint.wall_1 === id ? joint.wall_2 : joint.wall_1;
        const joiningWall = instance.walls.find(w => String(w.id) === String(joiningWallId));
        if (joiningWall) {
          // Wall midpoint
          const midX = (startX + endX) / 2;
          const midZ = (startZ + endZ) / 2;
          // Vector to model center
          const toCenterX = (modelCenter.x * scale) - midX;
          const toCenterZ = (modelCenter.z * scale) - midZ;
          const dotToCenter = finalNormX * toCenterX + finalNormZ * toCenterZ;
          // Joining wall midpoint
          const joinMidX = (joiningWall.start_x * scale + joiningWall.end_x * scale) / 2;
          const joinMidZ = (joiningWall.start_y * scale + joiningWall.end_y * scale) / 2;
          const toJoinX = joinMidX - midX;
          const toJoinZ = joinMidZ - midZ;
          const dotToJoin = finalNormX * toJoinX + finalNormZ * toJoinZ;
          const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin < 0);
          console.log('[3D FlipCheck]', {
            wallId: id,
            joiningWallId,
            dotToCenter,
            dotToJoin,
            shouldFlip,
            joiningMethod: joint.joining_method
          });
          if (shouldFlip) {
            flipNormal = true;
            break;
          }
        }
      }
    }
  }
  if (flipNormal) {
    finalNormX = finalNormX;
    finalNormZ = - finalNormZ;
  }

  const wallDoors = instance.doors.filter(d => String(d.wall) === String(id));
  const wallHeight = height * scale;
  const wallThickness = thickness * scale;
  let hasStart45 = false;
  let hasEnd45 = false;
  const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        if (nearlyEqual(j.intersection_x, start_x) && nearlyEqual(j.intersection_y, start_y)) {
          hasStart45 = true;
        }
        if (nearlyEqual(j.intersection_x, end_x) && nearlyEqual(j.intersection_y, end_y)) {
          hasEnd45 = true;
        }
      }
    });
  }
  const wallShape = new instance.THREE.Shape();
  const bevel = wallThickness;
  if (hasStart45) {
    wallShape.moveTo(bevel, 0);
    wallShape.lineTo(0, bevel);
    wallShape.lineTo(0, wallHeight);
  } else {
    wallShape.moveTo(0, 0);
    wallShape.lineTo(0, wallHeight);
  }
  let lastX = hasStart45 ? bevel : 0;
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    const doorPos = door.position_x * wallLength;
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(wallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  if (hasEnd45) {
    wallShape.lineTo(wallLength - bevel, wallHeight);
    wallShape.lineTo(wallLength, wallHeight - bevel);
    wallShape.lineTo(wallLength, 0);
  } else {
    wallShape.lineTo(wallLength, wallHeight);
    wallShape.lineTo(wallLength, 0);
  }
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
  wallMesh.rotation.y = -Math.atan2(dz, dx);
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  // By default, ExtrudeGeometry extrudes along +Z, so we need to shift the mesh by wallThickness/2 in the -normal direction
  wallMesh.position.set(startX + instance.modelOffset.x, 0, startZ + instance.modelOffset.z);
  // If flipNormal, offset the mesh by -wallThickness in the direction of the (flipped) normal (away from model center)
  if (flipNormal) {
    wallMesh.position.x -= finalNormX * wallThickness;
    wallMesh.position.z -= finalNormZ * wallThickness;
    // Do NOT rotate the mesh
  }
  const edges = new instance.THREE.EdgesGeometry(wallGeometry);
  const edgeLines = new instance.THREE.LineSegments(edges, new instance.THREE.LineBasicMaterial({ color: 0x000000 }));
  wallMesh.add(edgeLines);
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = startX + wallDirX * mid;
    const centerZ = startZ + wallDirZ * mid;
    // If flipNormal, offset the door position as well
    let doorX = centerX + instance.modelOffset.x;
    let doorZ = centerZ + instance.modelOffset.z;
    if (flipNormal) {
      doorX -= finalNormX * wallThickness;
      doorZ -= finalNormZ * wallThickness;
    }
    cutout.doorInfo.calculatedPosition = {
      x: doorX,
      z: doorZ,
      angle: Math.atan2(dz, dx),
      width: cutout.end - cutout.start,
      height: cutout.height,
      depth: wallThickness
    };
  }
  return wallMesh;
}

export function createDoorMesh(instance, door, wall) {
  if (!door.calculatedPosition) {
    return null;
  }
  const { x: doorPosX, z: doorPosZ, angle: wallAngle, width: cutoutWidth, height: doorHeight, depth: wallDepth } = door.calculatedPosition;
  const scale = instance.scalingFactor;
  const { width, thickness, door_type, swing_direction, slide_direction, side, configuration } = door;
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
      if (side === 'interior') {
        leftDoor.position.set(-halfWidth/2, 0, -doorOffsetZ);
        rightDoor.position.set(halfWidth/2, 0, -doorOffsetZ);
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
      if (side === 'interior') {
        doorMesh.position.z = -doorOffsetZ;
      }
      doorContainer.add(doorMesh);
      doorMesh.userData.origPosition = { x: 0, z: doorOffsetZ };
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = door;
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true);
      const rawDirection = slide_direction === 'right' ? -1 : 1;
      const slideDirectionSign = side === 'exterior' ? -rawDirection : rawDirection;
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
      const leftAngle = Math.PI / 2 * (side === 'exterior' ? 1 : -1);
      const rightAngle = Math.PI / 2 * (side === 'exterior' ? -1 : 1);
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
      const hingeOnRight = swing_direction === 'right';
      const mountedInside = side === 'interior';
      const doorContainer = new instance.THREE.Object3D();
      doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      const effectiveHingeOnRight = mountedInside ? !hingeOnRight : hingeOnRight;
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