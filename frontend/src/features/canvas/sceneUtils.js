// Utility functions for Three.js scene setup and model building

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import earcut from 'earcut';

export function addGrid(instance) {
  const size = instance.gridSize;
  const divisions = 20;
  const gridHelper = new instance.THREE.GridHelper(size, divisions, 0x888888, 0xcccccc);
  gridHelper.position.y = 0.01;
  instance.scene.add(gridHelper);
}

export function adjustModelScale(instance) {
  // Example logic, adjust as needed for your app
  // This could be more complex depending on your model
  instance.camera.position.set(200, 200, 200);
  instance.camera.lookAt(0, 0, 0);
}

export function addLighting(instance) {
  const ambientLight = new instance.THREE.AmbientLight(0xffffff, 0.5);
  instance.scene.add(ambientLight);
  const dirLight = new instance.THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(100, 200, 100);
  dirLight.castShadow = true;
  instance.scene.add(dirLight);
}

export function addControls(instance) {
  instance.controls = new OrbitControls(instance.camera, instance.renderer.domElement);
  instance.controls.maxDistance = instance.gridSize;
  instance.controls.minDistance = 10;
}

export function calculateModelOffset(instance) {
  // Example: center the model in the scene
  // You may want to calculate the bounding box and set instance.modelOffset
  instance.modelOffset = { x: 0, z: 0 };
}

export function addCeiling(instance) {
  // Remove existing ceiling
  const existingCeiling = instance.scene.getObjectByName('ceiling');
  if (existingCeiling) {
    instance.scene.remove(existingCeiling);
  }

  // Get the building footprint vertices
  const vertices = getBuildingFootprint(instance);
  if (vertices.length < 3) {
    return;
  }
  // Convert vertices to format required by earcut
  const flatVertices = [];
  vertices.forEach(vertex => {
    flatVertices.push(vertex.x);
    flatVertices.push(vertex.z);
  });
  // Triangulate the polygon
  const triangles = earcut(flatVertices);
  if (triangles.length === 0) {
    return;
  }
  // Create ceiling geometry using triangulation
  const geometry = new instance.THREE.BufferGeometry();
  const positions = new Float32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    const vertexIndex = triangles[i];
    const x = flatVertices[vertexIndex * 2];
    const z = flatVertices[vertexIndex * 2 + 1];
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = z;
  }
  geometry.setAttribute('position', new instance.THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  // Create material
  const material = new instance.THREE.MeshStandardMaterial({
    color: 0xcccccc,
    side: instance.THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9
  });
  // Create mesh
  const ceiling = new instance.THREE.Mesh(geometry, material);
  ceiling.name = 'ceiling';
  // Position the ceiling at the top of the walls
  const maxWallHeight = Math.max(...instance.walls.map(wall => wall.height));
  ceiling.position.y = maxWallHeight * instance.scalingFactor;
  ceiling.castShadow = true;
  ceiling.receiveShadow = true;
  instance.scene.add(ceiling);
}

function getBuildingFootprint(instance) {
  // Build a map of all wall endpoints and their connections
  const pointMap = new Map();
  const toKey = (x, z) => `${x.toFixed(4)},${z.toFixed(4)}`;
  const fromKey = (pt) => toKey(pt.x, pt.z);
  instance.walls.forEach(wall => {
    const start = {
      x: wall.start_x * instance.scalingFactor + instance.modelOffset.x,
      z: wall.start_y * instance.scalingFactor + instance.modelOffset.z
    };
    const end = {
      x: wall.end_x * instance.scalingFactor + instance.modelOffset.x,
      z: wall.end_y * instance.scalingFactor + instance.modelOffset.z
    };
    const startKey = fromKey(start);
    const endKey = fromKey(end);
    if (!pointMap.has(startKey)) pointMap.set(startKey, { pt: start, neighbors: new Set() });
    if (!pointMap.has(endKey)) pointMap.set(endKey, { pt: end, neighbors: new Set() });
    pointMap.get(startKey).neighbors.add(endKey);
    pointMap.get(endKey).neighbors.add(startKey);
  });
  // Find the leftmost, bottommost point to start
  let startKey = null;
  let minX = Infinity, minZ = Infinity;
  for (const [key, val] of pointMap.entries()) {
    if (val.pt.x < minX || (val.pt.x === minX && val.pt.z < minZ)) {
      minX = val.pt.x;
      minZ = val.pt.z;
      startKey = key;
    }
  }
  if (!startKey) {
    return [];
  }
  // Trace the outer boundary in order
  const boundary = [];
  const visited = new Set();
  let currentKey = startKey;
  let prevKey = null;
  let safety = 0;
  do {
    const current = pointMap.get(currentKey);
    boundary.push(current.pt);
    visited.add(currentKey);
    let nextKey = null;
    let minAngle = Infinity;
    for (const neighborKey of current.neighbors) {
      if (neighborKey === prevKey) continue;
      if (neighborKey === startKey && boundary.length > 2) {
        nextKey = neighborKey;
        break;
      }
      if (visited.has(neighborKey)) continue;
      if (prevKey) {
        const prev = pointMap.get(prevKey).pt;
        const curr = current.pt;
        const next = pointMap.get(neighborKey).pt;
        const angle = Math.atan2(next.z - curr.z, next.x - curr.x) - Math.atan2(curr.z - prev.z, curr.x - prev.x);
        const normAngle = ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        if (normAngle < minAngle) {
          minAngle = normAngle;
          nextKey = neighborKey;
        }
      } else {
        nextKey = neighborKey;
      }
    }
    if (!nextKey) break;
    prevKey = currentKey;
    currentKey = nextKey;
    safety++;
    if (safety > 1000) {
      break;
    }
  } while (currentKey !== startKey);
  if (boundary.length > 1 &&
      boundary[0].x === boundary[boundary.length - 1].x &&
      boundary[0].z === boundary[boundary.length - 1].z) {
    boundary.pop();
  }
  if (boundary.length < 3) {
    return [];
  }
  return boundary;
}

export function buildModel(instance) {
  // Remove existing walls, doors, and ceilings from the scene
  instance.scene.children = instance.scene.children.filter(child => {
    return !child.userData?.isWall && !child.userData?.isDoor && !child.name?.startsWith('ceiling');
  });

  // Clear door objects array
  instance.doorObjects = [];

  // Normalize door data: map linked_wall → wall
  instance.doors.forEach(d => {
    if (d.linked_wall && !d.wall) d.wall = d.linked_wall;
  });

  // Create all walls
  instance.walls.forEach(wall => {
    const wallMesh = instance.createWallMesh(instance, wall);
    instance.scene.add(wallMesh);
  });

  // Create all doors
  instance.doors.forEach(door => {
    if (door.calculatedPosition) {
      const doorMesh = instance.createDoorMesh(instance, door, null);
      if (doorMesh) instance.scene.add(doorMesh);
    }
  });

  // Add ceiling after walls and doors are created
  addCeiling(instance);
} 