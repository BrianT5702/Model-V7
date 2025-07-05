// Utility functions for mesh creation in Three.js

export function createWallMesh(instance, wall) {
  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  let startX = start_x * scale;
  let startZ = start_y * scale;
  let endX = end_x * scale;
  let endZ = end_y * scale;
  const dx = endX - startX;
  const dz = endZ - startZ;
  const wallLength = Math.hypot(dx, dz);
  const wallDirX = dx / wallLength;
  const wallDirZ = dz / wallLength;
  const normX = -dz / wallLength;
  const normZ = dx / wallLength;
  const wallMidX = (startX + endX) / 2;
  const wallMidZ = (startZ + endZ) / 2;
  const isExternalWall = 
    Math.abs(startX) < 0.001 || Math.abs(startX - 15000 * scale) < 0.001 ||
    Math.abs(startZ) < 0.001 || Math.abs(startZ - 8000 * scale) < 0.001;
  let finalNormX, finalNormZ;
  if (isExternalWall) {
    if (Math.abs(startX) < 0.001) {
      finalNormX = 1; finalNormZ = 0;
    } else if (Math.abs(startX - 15000 * scale) < 0.001) {
      finalNormX = -1; finalNormZ = 0;
    } else if (Math.abs(startZ) < 0.001) {
      finalNormX = 0; finalNormZ = 1;
    } else {
      finalNormX = 0; finalNormZ = -1;
    }
  } else {
    const toCenterX = (modelCenter.x * scale) - wallMidX;
    const toCenterZ = (modelCenter.z * scale) - wallMidZ;
    const dotProduct = normX * toCenterX + normZ * toCenterZ;
    finalNormX = dotProduct < 0 ? -normX : normX;
    finalNormZ = dotProduct < 0 ? -normZ : normZ;
  }
  const offsetX = finalNormX * (thickness * scale / 2);
  const offsetZ = finalNormZ * (thickness * scale / 2);
  startX += offsetX;
  startZ += offsetZ;
  endX += offsetX;
  endZ += offsetZ;
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
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.7, metalness: 0.2 });
  const wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  wallMesh.userData.isWall = true;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  wallMesh.rotation.y = -Math.atan2(dz, dx);
  wallMesh.position.set(startX + instance.modelOffset.x, 0, startZ + instance.modelOffset.z);
  wallMesh.position.x -= finalNormX * (wallThickness / 2);
  wallMesh.position.z -= finalNormZ * (wallThickness / 2);
  const edges = new instance.THREE.EdgesGeometry(wallGeometry);
  const edgeLines = new instance.THREE.LineSegments(edges, new instance.THREE.LineBasicMaterial({ color: 0x000000 }));
  wallMesh.add(edgeLines);
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = startX + wallDirX * mid;
    const centerZ = startZ + wallDirZ * mid;
    cutout.doorInfo.calculatedPosition = {
      x: centerX + instance.modelOffset.x - finalNormX * (wallThickness / 2),
      z: centerZ + instance.modelOffset.z - finalNormZ * (wallThickness / 2),
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
  const doorWidth = width * scale * 1.1;
  const doorThickness = thickness * instance.scalingFactor;
  const sideCoefficient = side === 'exterior' ? 1 : -1;
  const doorMaterial = new instance.THREE.MeshStandardMaterial({
    color: door_type === 'swing' ? 0xFFA500 : 0x00FF00,
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