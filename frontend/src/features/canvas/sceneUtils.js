// Utility functions for Three.js scene setup and model building

import { OrbitControls } from './threeInstance';
import earcut from 'earcut';

export function addGrid(instance) {
  // Calculate dynamic grid size based on model bounds, or use default
  let size = instance.gridSize || 10000;
  
  // Try to calculate grid size from model bounds if available
  if (instance.walls && instance.walls.length > 0 && typeof instance.getModelBounds === 'function') {
    try {
      const bounds = instance.getModelBounds();
      const modelWidth = Math.abs(bounds.maxX - bounds.minX);
      const modelDepth = Math.abs(bounds.maxZ - bounds.minZ);
      const modelSize = Math.max(modelWidth, modelDepth);
      
      // Make grid 3x larger than model size to ensure full coverage, with minimum of 5000
      size = Math.max(modelSize * 3, 5000);
      
      // Round up to nearest 1000 for cleaner grid
      size = Math.ceil(size / 1000) * 1000;
    } catch (error) {
      // Fallback to default size if calculation fails
      console.warn('Could not calculate dynamic grid size, using default:', error);
    }
  }
  
  // Calculate appropriate divisions based on size (more divisions for larger grids)
  const divisions = Math.max(20, Math.min(100, Math.ceil(size / 100)));
  
  const gridHelper = new instance.THREE.GridHelper(size, divisions, 0x888888, 0xcccccc);
  gridHelper.position.y = 0.01;
  gridHelper.name = 'grid'; // Name it so we can update it later
  instance.scene.add(gridHelper);
  instance.gridHelper = gridHelper; // Store reference for potential updates
}

export function adjustModelScale(instance) {
  // Example logic, adjust as needed for your app
  // This could be more complex depending on your model
  instance.camera.position.set(200, 200, 200);
  instance.camera.lookAt(0, 0, 0);
}

export function addLighting(instance) {
  // High ambient light for bright white appearance
  const ambientLight = new instance.THREE.AmbientLight(0xffffff, 1.2);
  instance.scene.add(ambientLight);
  // Additional directional light for even illumination
  const dirLight = new instance.THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(100, 200, 100);
  dirLight.castShadow = true;
  instance.scene.add(dirLight);
  // Add a second directional light from opposite side for even lighting
  const dirLight2 = new instance.THREE.DirectionalLight(0xffffff, 0.6);
  dirLight2.position.set(-100, 200, -100);
  dirLight2.castShadow = false;
  instance.scene.add(dirLight2);
}

export function addControls(instance) {
  instance.controls = new OrbitControls(instance.camera, instance.renderer.domElement);
  instance.controls.maxDistance = 5000; // Increased from 1500 to allow more zoom out
  instance.controls.minDistance = 10;
  
  // Enable touch controls for mobile devices (pinch-to-zoom, pan, rotate)
  instance.controls.enableDamping = true;
  instance.controls.dampingFactor = 0.05;
  
  // Enable all touch gestures
  instance.controls.enablePan = true;
  instance.controls.enableZoom = true;
  instance.controls.enableRotate = true;
  
  // Touch-specific settings for mobile (pinch-to-zoom support)
  // ONE touch = rotate, TWO touches = zoom (dolly) and pan
  if (instance.THREE.TOUCH) {
    instance.controls.touches = {
      ONE: instance.THREE.TOUCH.ROTATE,
      TWO: instance.THREE.TOUCH.DOLLY_PAN  // This enables pinch-to-zoom
    };
  }
  
  // Mouse button settings
  if (instance.THREE.MOUSE) {
    instance.controls.mouseButtons = {
      LEFT: instance.THREE.MOUSE.ROTATE,
      MIDDLE: instance.THREE.MOUSE.DOLLY,
      RIGHT: instance.THREE.MOUSE.PAN
    };
  }
  
  // Set the center of rotation to the model center if possible
  if (typeof instance.calculateModelCenter === 'function') {
    const center = instance.calculateModelCenter();
    instance.controls.target.set(center.x, 0, center.z);
    instance.controls.update();
  }
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

  // CRITICAL: Only create ceiling if there are declared rooms
  // Do not create ceiling based on wall endpoints alone
  if (!instance.project || !instance.project.rooms || instance.project.rooms.length === 0) {
    console.log('No rooms declared - skipping ceiling creation');
    return;
  }

  // Check if there are rooms with valid room_points
  const validRooms = instance.project.rooms.filter(room => 
    room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3
  );

  if (validRooms.length === 0) {
    console.log('No rooms with valid room_points - skipping ceiling creation');
    return;
  }

  // Calculate ceiling elevation based on room base elevation + room height (absolute values)
  // Don't add storey elevation since room.base_elevation_mm is already an absolute value
  // Use the maximum top elevation (highest room) for the ceiling
  let maxCeilingElevation = 0;
  validRooms.forEach(room => {
    const roomBaseElevation = room.base_elevation_mm ?? 0;
    const roomHeight = room.height ?? 0;
    const absoluteTop = roomBaseElevation + roomHeight;
    console.log(`[Ceiling] Room ${room.id}: baseElevation=${roomBaseElevation}mm, height=${roomHeight}mm, absoluteTop=${absoluteTop}mm`);
    if (absoluteTop > maxCeilingElevation) {
      maxCeilingElevation = absoluteTop;
    }
  });
  console.log(`[Ceiling] Final maxCeilingElevation: ${maxCeilingElevation}mm`);

  // Get the building footprint vertices (will use room points since rooms exist)
  const vertices = getBuildingFootprint(instance);
  if (vertices.length < 3) {
    return;
  }
  // Create ceiling geometry with thickness extending downward
  // Use a reasonable default thickness for fallback ceiling
  const ceilingThickness = 150 * instance.scalingFactor; // 150mm default thickness
  
  // Function to find the closest wall to a point and return its height
  const findWallHeightAtPoint = (x, z, room) => {
    // Convert 3D coordinates back to 2D (divide by scaling factor and subtract offset)
    const pointX = (x - instance.modelOffset.x) / instance.scalingFactor;
    const pointY = (z - instance.modelOffset.z) / instance.scalingFactor;
    
    // Get walls for this room - room.walls can be array of IDs or wall objects
    let roomWallIds = [];
    if (Array.isArray(room.walls)) {
      roomWallIds = room.walls.map(w => (typeof w === 'object' ? w.id : w));
    }
    
    if (!roomWallIds.length && instance.walls) {
      // Try to find walls by matching room points to wall endpoints
      const roomPoints = room.room_points || [];
      roomWallIds = instance.walls.filter(wall => {
        // Check if wall endpoints match any room points
        return roomPoints.some(p => {
          const dist1 = Math.sqrt(Math.pow(p.x - wall.start_x, 2) + Math.pow(p.y - wall.start_y, 2));
          const dist2 = Math.sqrt(Math.pow(p.x - wall.end_x, 2) + Math.pow(p.y - wall.end_y, 2));
          return dist1 < 1 || dist2 < 1; // 1mm tolerance
        });
      }).map(w => w.id);
    }
    
    let closestWall = null;
    let minDistance = Infinity;
    
    // Find the closest wall to this point
    instance.walls.forEach(wall => {
      if (roomWallIds.length > 0 && !roomWallIds.includes(wall.id)) {
        return; // Skip walls not in this room
      }
      
      // Calculate distance from point to wall line segment
      const wallStartX = wall.start_x;
      const wallStartY = wall.start_y;
      const wallEndX = wall.end_x;
      const wallEndY = wall.end_y;
      
      // Vector from wall start to end
      const wallDx = wallEndX - wallStartX;
      const wallDy = wallEndY - wallStartY;
      const wallLengthSq = wallDx * wallDx + wallDy * wallDy;
      
      if (wallLengthSq === 0) {
        // Wall is a point, use distance to that point
        const dist = Math.sqrt(Math.pow(pointX - wallStartX, 2) + Math.pow(pointY - wallStartY, 2));
        if (dist < minDistance) {
          minDistance = dist;
          closestWall = wall;
        }
      } else {
        // Calculate projection of point onto wall line
        const t = Math.max(0, Math.min(1, ((pointX - wallStartX) * wallDx + (pointY - wallStartY) * wallDy) / wallLengthSq));
        const projX = wallStartX + t * wallDx;
        const projY = wallStartY + t * wallDy;
        const dist = Math.sqrt(Math.pow(pointX - projX, 2) + Math.pow(pointY - projY, 2));
        
        if (dist < minDistance) {
          minDistance = dist;
          closestWall = wall;
        }
      }
    });
    
    if (closestWall) {
      return closestWall.height || 0;
    }
    
    // Fallback: use room height if no wall found
    return room.height || 0;
  };
  
  // Function to calculate ceiling height at a vertex based on wall heights
  const calculateCeilingHeightAtVertex = (x, z) => {
    // Find which room this vertex belongs to
    let bestRoom = null;
    let minDistance = Infinity;
    
    validRooms.forEach(room => {
      if (!room.room_points || room.room_points.length < 3) return;
      
      // Convert 3D coordinates to 2D
      const pointX = (x - instance.modelOffset.x) / instance.scalingFactor;
      const pointY = (z - instance.modelOffset.z) / instance.scalingFactor;
      
      // Check if point is inside or near this room's polygon
      const roomPoints = room.room_points;
      let isInside = false;
      
      // Simple point-in-polygon test
      for (let i = 0, j = roomPoints.length - 1; i < roomPoints.length; j = i++) {
        const xi = roomPoints[i].x, yi = roomPoints[i].y;
        const xj = roomPoints[j].x, yj = roomPoints[j].y;
        const intersect = ((yi > pointY) !== (yj > pointY)) && (pointX < (xj - xi) * (pointY - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
      }
      
      if (isInside) {
        // Point is inside this room
        const wallHeight = findWallHeightAtPoint(x, z, room);
        const roomBaseElevation = room.base_elevation_mm ?? 0;
        
        // Ceiling height = room base elevation + wall height (absolute values, no storey elevation)
        return (roomBaseElevation + wallHeight) * instance.scalingFactor;
      }
      
      // Calculate distance to room center as fallback
      const centerX = roomPoints.reduce((sum, p) => sum + p.x, 0) / roomPoints.length;
      const centerY = roomPoints.reduce((sum, p) => sum + p.y, 0) / roomPoints.length;
      const dist = Math.sqrt(Math.pow(pointX - centerX, 2) + Math.pow(pointY - centerY, 2));
      
      if (dist < minDistance) {
        minDistance = dist;
        bestRoom = room;
      }
    });
    
    // Use best room found
    if (bestRoom) {
      const wallHeight = findWallHeightAtPoint(x, z, bestRoom);
      const roomBaseElevation = bestRoom.base_elevation_mm ?? 0;
      
      // Ceiling height = room base elevation + wall height (absolute values, no storey elevation)
      return (roomBaseElevation + wallHeight) * instance.scalingFactor;
    }
    
    // Final fallback: use max ceiling elevation
    return maxCeilingElevation * instance.scalingFactor;
  };
  
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
  
  // Create a map to store vertex heights based on actual wall heights
  // Heights are stored relative to maxCeilingElevation (so we subtract it to get relative height)
  const vertexHeightMap = new Map();
  for (let i = 0; i < flatVertices.length; i += 2) {
    const x = flatVertices[i];
    const z = flatVertices[i + 1];
    const key = `${x.toFixed(6)},${z.toFixed(6)}`;
    if (!vertexHeightMap.has(key)) {
      // Calculate absolute ceiling height at this vertex
      const absoluteHeight = calculateCeilingHeightAtVertex(x, z);
      // Convert to relative height (relative to maxCeilingElevation)
      const relativeHeight = absoluteHeight - (maxCeilingElevation * instance.scalingFactor);
      vertexHeightMap.set(key, relativeHeight);
    }
  }
  
  // Create the top surface (sloped ceiling)
  const topGeometry = new instance.THREE.BufferGeometry();
  const topPositions = new Float32Array(triangles.length * 3);
  
  for (let i = 0; i < triangles.length; i++) {
    const vertexIndex = triangles[i];
    const x = flatVertices[vertexIndex * 2];
    const z = flatVertices[vertexIndex * 2 + 1];
    const key = `${x.toFixed(6)},${z.toFixed(6)}`;
    const height = vertexHeightMap.get(key) || 0;
    
    topPositions[i * 3] = x;
    topPositions[i * 3 + 1] = height; // Top surface with slope
    topPositions[i * 3 + 2] = z;
  }
  topGeometry.setAttribute('position', new instance.THREE.BufferAttribute(topPositions, 3));
  topGeometry.computeVertexNormals();
  
  // Create the bottom surface (thickness bottom, also sloped to match top)
  const bottomGeometry = new instance.THREE.BufferGeometry();
  const bottomPositions = new Float32Array(triangles.length * 3);
  
  for (let i = 0; i < triangles.length; i++) {
    const vertexIndex = triangles[i];
    const x = flatVertices[vertexIndex * 2];
    const z = flatVertices[vertexIndex * 2 + 1];
    const key = `${x.toFixed(6)},${z.toFixed(6)}`;
    const height = vertexHeightMap.get(key) || 0;
    
    bottomPositions[i * 3] = x;
    bottomPositions[i * 3 + 1] = height - ceilingThickness; // Bottom surface follows slope, offset by thickness
    bottomPositions[i * 3 + 2] = z;
  }
  bottomGeometry.setAttribute('position', new instance.THREE.BufferAttribute(bottomPositions, 3));
  bottomGeometry.computeVertexNormals();
  
  // Create side walls to connect top and bottom surfaces
  const sideGeometry = new instance.THREE.BufferGeometry();
  const sidePositions = [];
  
  // For each edge of the room, create two triangles to form a side wall
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    
        // Calculate heights for current and next vertices
        const currentKey = `${current.x.toFixed(6)},${current.z.toFixed(6)}`;
        const nextKey = `${next.x.toFixed(6)},${next.z.toFixed(6)}`;
        const currentTopHeight = vertexHeightMap.get(currentKey) || 0;
        const nextTopHeight = vertexHeightMap.get(nextKey) || 0;
    const currentBottomHeight = currentTopHeight - ceilingThickness;
    const nextBottomHeight = nextTopHeight - ceilingThickness;
    
    // Side wall quad (two triangles) - connects top and bottom surfaces
    // Triangle 1
    sidePositions.push(
      current.x, currentTopHeight, current.z,                    // Top front
      next.x, nextTopHeight, next.z,                            // Top back
      current.x, currentBottomHeight, current.z                  // Bottom front
    );
    
    // Triangle 2
    sidePositions.push(
      next.x, nextTopHeight, next.z,                            // Top back
      next.x, nextBottomHeight, next.z,                          // Bottom back
      current.x, currentBottomHeight, current.z                   // Bottom front
    );
  }
  
  sideGeometry.setAttribute('position', new instance.THREE.BufferGeometry(new Float32Array(sidePositions), 3));
  sideGeometry.computeVertexNormals();
  
  // Merge all geometries into one
  const geometry = new instance.THREE.BufferGeometry();
  const mergedPositions = [];
  
  // Add top surface
  for (let i = 0; i < topPositions.length; i += 3) {
    mergedPositions.push(topPositions[i], topPositions[i + 1], topPositions[i + 2]);
  }
  
  // Add bottom surface
  for (let i = 0; i < bottomPositions.length; i += 3) {
    mergedPositions.push(bottomPositions[i], bottomPositions[i + 1], bottomPositions[i + 2]);
  }
  
  // Add side walls
  for (let i = 0; i < sidePositions.length; i += 3) {
    mergedPositions.push(sidePositions[i], sidePositions[i + 1], sidePositions[i + 2]);
  }
  
  geometry.setAttribute('position', new instance.THREE.BufferAttribute(new Float32Array(mergedPositions), 3));
  geometry.computeVertexNormals();
  // Create material to match wall appearance
  const material = new instance.THREE.MeshStandardMaterial({
    color: 0xFFFFFFF, // Same white color as walls
    side: instance.THREE.DoubleSide,
    roughness: 0.2,   // Lower roughness for brighter appearance
    metalness: 0.1,   // Lower metalness for brighter appearance
    transparent: false // Not transparent like walls
  });
  // Create mesh
  const ceiling = new instance.THREE.Mesh(geometry, material);
  ceiling.name = 'ceiling';
  // Position the ceiling at the calculated elevation (storey elevation + room base + room height)
  ceiling.position.y = maxCeilingElevation * instance.scalingFactor;
  
  // Add edge lines to match wall appearance
  const edges = new instance.THREE.EdgesGeometry(geometry);
  const edgeLines = new instance.THREE.LineSegments(
    edges, 
    new instance.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
  );
  ceiling.add(edgeLines);
  
  // Set shadow properties
  // Disable shadow receiving on ceiling to avoid dark shadow rectangles from walls
  ceiling.castShadow = false; // Ceilings don't need to cast shadows
  ceiling.receiveShadow = false; // Disable receiving shadows to prevent dark rectangles on ceiling surface
  
  // Store thickness in userData
  ceiling.userData = {
    isCeiling: true,
    thickness: ceilingThickness
  };
  
  instance.scene.add(ceiling);
}

export function addFloor(instance) {
  // Remove existing floor
  const existingFloor = instance.scene.getObjectByName('floor');
  if (existingFloor) {
    instance.scene.remove(existingFloor);
  }

  // CRITICAL: Only create floor if there are declared rooms
  // Do not create floor based on wall endpoints alone
  if (!instance.project || !instance.project.rooms || instance.project.rooms.length === 0) {
    console.log('No rooms declared - skipping floor creation');
    return;
  }

  // Check if there are rooms with valid room_points
  const validRooms = instance.project.rooms.filter(room => 
    room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3
  );

  if (validRooms.length === 0) {
    console.log('No rooms with valid room_points - skipping floor creation');
    return;
  }

  // Calculate floor elevation based on room base elevation (absolute value)
  // Don't add storey elevation since room.base_elevation_mm is already an absolute value
  // Use the minimum base elevation (lowest room) for the floor
  let minFloorElevation = Infinity;
  validRooms.forEach(room => {
    const roomBaseElevation = room.base_elevation_mm ?? 0;
    console.log(`[Floor] Room ${room.id}: baseElevation=${roomBaseElevation}mm`);
    if (roomBaseElevation < minFloorElevation) {
      minFloorElevation = roomBaseElevation;
    }
  });
  console.log(`[Floor] Final minFloorElevation: ${minFloorElevation}mm`);
  
  // If no valid elevation found, default to 0
  if (minFloorElevation === Infinity) {
    minFloorElevation = 0;
  }

  // Get the building footprint vertices (will use room points since rooms exist)
  const vertices = getBuildingFootprint(instance);
  if (vertices.length < 3) {
    return;
  }
  
  // Create floor geometry with thickness extending upward
  // Use a reasonable default thickness for fallback floor
  const floorThickness = 150 * instance.scalingFactor; // 150mm default thickness
  
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
  
  // Create the top surface (floor top surface - at the top of the floor thickness)
  const topGeometry = new instance.THREE.BufferGeometry();
  const topPositions = new Float32Array(triangles.length * 3);
  
  for (let i = 0; i < triangles.length; i++) {
    const vertexIndex = triangles[i];
    const x = flatVertices[vertexIndex * 2];
    const z = flatVertices[vertexIndex * 2 + 1];
    topPositions[i * 3] = x;
    topPositions[i * 3 + 1] = floorThickness; // Top surface at Y=+thickness
    topPositions[i * 3 + 2] = z;
  }
  topGeometry.setAttribute('position', new instance.THREE.BufferAttribute(topPositions, 3));
  topGeometry.computeVertexNormals();
  
  // Create the bottom surface (ground level)
  const bottomGeometry = new instance.THREE.BufferGeometry();
  const bottomPositions = new Float32Array(triangles.length * 3);
  
  for (let i = 0; i < triangles.length; i++) {
    const vertexIndex = triangles[i];
    const x = flatVertices[vertexIndex * 2];
    const z = flatVertices[vertexIndex * 2 + 1];
    bottomPositions[i * 3] = x;
    bottomPositions[i * 3 + 1] = 0; // Bottom surface at Y=0 (ground level)
    bottomPositions[i * 3 + 2] = z;
  }
  bottomGeometry.setAttribute('position', new instance.THREE.BufferAttribute(bottomPositions, 3));
  bottomGeometry.computeVertexNormals();
  
  // Create side walls to connect top and bottom surfaces
  const sideGeometry = new instance.THREE.BufferGeometry();
  const sidePositions = [];
  
  // For each edge of the room, create two triangles to form a side wall
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    
            // Side wall quad (two triangles)
        // Triangle 1
        sidePositions.push(
          current.x, 0, current.z,                    // Bottom front (ground level)
          next.x, 0, next.z,                          // Bottom back (ground level)
          current.x, floorThickness, current.z         // Top front (floor top)
        );
        
        // Triangle 2
        sidePositions.push(
          next.x, 0, next.z,                          // Bottom back (ground level)
          next.x, floorThickness, next.z,              // Top back (floor top)
          current.x, floorThickness, current.z         // Top front (floor top)
        );
  }
  
  sideGeometry.setAttribute('position', new instance.THREE.BufferAttribute(new Float32Array(sidePositions), 3));
  sideGeometry.computeVertexNormals();
  
  // Merge all geometries into one
  const geometry = new instance.THREE.BufferGeometry();
  const mergedPositions = [];
  
  // Add top surface
  for (let i = 0; i < topPositions.length; i += 3) {
    mergedPositions.push(topPositions[i], topPositions[i + 1], topPositions[i + 2]);
  }
  
  // Add bottom surface
  for (let i = 0; i < bottomPositions.length; i += 3) {
    mergedPositions.push(bottomPositions[i], bottomPositions[i + 1], bottomPositions[i + 2]);
  }
  
  // Add side walls
  for (let i = 0; i < sidePositions.length; i += 3) {
    mergedPositions.push(sidePositions[i], sidePositions[i + 1], sidePositions[i + 2]);
  }
  
  geometry.setAttribute('position', new instance.THREE.BufferAttribute(new Float32Array(mergedPositions), 3));
  geometry.computeVertexNormals();
  
  // Create material for floor
  const material = new instance.THREE.MeshStandardMaterial({
    color: 0xE5E7EB, // Light gray color for floor
    side: instance.THREE.DoubleSide,
    roughness: 0.8,   // More rough than walls for floor texture
    metalness: 0.2,   // Less metallic than walls
    transparent: false
  });
  
  // Create mesh
  const floor = new instance.THREE.Mesh(geometry, material);
  floor.name = 'floor';
  
  // Position the floor at the calculated elevation (storey elevation + room base elevation)
  floor.position.y = minFloorElevation * instance.scalingFactor;
  
  // Add edge lines to match wall appearance
  const edges = new instance.THREE.EdgesGeometry(geometry);
  const edgeLines = new instance.THREE.LineSegments(
    edges, 
    new instance.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
  );
  floor.add(edgeLines);
  
  // Set shadow properties
  floor.castShadow = true;
  floor.receiveShadow = true;
  
  // Store floor info in userData
  floor.userData = {
    isFloor: true,
    thickness: floorThickness
  };
  
  instance.scene.add(floor);
}

function getBuildingFootprint(instance) {
  // Priority 1: Use room boundary points (room_points) if available
  if (instance.project && instance.project.rooms && instance.project.rooms.length > 0) {
    // Filter rooms with valid room_points
    const validRooms = instance.project.rooms.filter(room => 
      room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3
    );
    
    if (validRooms.length === 1) {
      // Single room: use room points directly in their original order
      const room = validRooms[0];
      return room.room_points.map(point => ({
        x: point.x * instance.scalingFactor + instance.modelOffset.x,
        z: point.y * instance.scalingFactor + instance.modelOffset.z
      }));
    } else if (validRooms.length > 1) {
      // Multiple rooms: collect all points and compute convex hull for outer boundary
      const allRoomPoints = [];
      validRooms.forEach(room => {
        room.room_points.forEach(point => {
          allRoomPoints.push({
            x: point.x * instance.scalingFactor + instance.modelOffset.x,
            z: point.y * instance.scalingFactor + instance.modelOffset.z
          });
        });
      });
      
      // Remove duplicate points
      const uniquePoints = [];
      const pointSet = new Set();
      allRoomPoints.forEach(pt => {
        const key = `${pt.x.toFixed(4)},${pt.z.toFixed(4)}`;
        if (!pointSet.has(key)) {
          pointSet.add(key);
          uniquePoints.push(pt);
        }
      });
      
      if (uniquePoints.length >= 3) {
        return computeConvexHull(uniquePoints);
      }
    }
  }
  
  // Priority 2: Fallback to wall endpoints (original method)
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

// Helper function to compute convex hull using Graham scan algorithm
function computeConvexHull(points) {
  if (points.length < 3) {
    return points;
  }
  
  // Create a copy to avoid mutating the original array
  const sortedPoints = [...points];
  
  // Find the bottom-most point (or leftmost in case of tie)
  let bottom = 0;
  for (let i = 1; i < sortedPoints.length; i++) {
    if (sortedPoints[i].z < sortedPoints[bottom].z || 
        (sortedPoints[i].z === sortedPoints[bottom].z && sortedPoints[i].x < sortedPoints[bottom].x)) {
      bottom = i;
    }
  }
  
  // Swap bottom point to first position
  [sortedPoints[0], sortedPoints[bottom]] = [sortedPoints[bottom], sortedPoints[0]];
  
  // Sort points by polar angle with respect to bottom point
  const pivot = sortedPoints[0];
  const rest = sortedPoints.slice(1);
  rest.sort((a, b) => {
    const angleA = Math.atan2(a.z - pivot.z, a.x - pivot.x);
    const angleB = Math.atan2(b.z - pivot.z, b.x - pivot.x);
    if (angleA !== angleB) {
      return angleA - angleB;
    }
    // If angles are equal, sort by distance
    const distA = Math.hypot(a.x - pivot.x, a.z - pivot.z);
    const distB = Math.hypot(b.x - pivot.x, b.z - pivot.z);
    return distA - distB;
  });
  
  // Build convex hull
  const hull = [sortedPoints[0], ...rest.slice(0, 1)];
  
  for (let i = 1; i < rest.length; i++) {
    while (hull.length > 1 && 
           crossProduct(hull[hull.length - 2], hull[hull.length - 1], rest[i]) <= 0) {
      hull.pop();
    }
    hull.push(rest[i]);
  }
  
  return hull;
}

// Helper function to calculate cross product for convex hull
function crossProduct(o, a, b) {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

export function buildModel(instance) {
  // Remove existing walls, doors, ceilings, floors, and panel lines from the scene
  instance.scene.children = instance.scene.children.filter(child => {
    return !child.userData?.isWall && !child.userData?.isDoor && !child.name?.startsWith('ceiling') && !child.name?.startsWith('floor') && !child.userData?.isPanelLines;
  });

  // Clear door objects array
  instance.doorObjects = [];

  // Normalize door data: map linked_wall → wall
  instance.doors.forEach(d => {
    if (d.linked_wall && !d.wall) d.wall = d.linked_wall;
  });

  // Calculate panels for all walls
  const wallPanelsMap = instance.calculateWallPanels();

  // Create all walls
  instance.walls.forEach(wall => {
    const wallMesh = instance.createWallMesh(instance, wall);
    instance.scene.add(wallMesh);
    
    // Create panel division lines for this wall
    const panels = wallPanelsMap[wall.id];
    if (panels && panels.length > 1) {
      const panelLines = instance.createPanelDivisionLines(instance, wall, panels);
      if (panelLines) {
        instance.scene.add(panelLines);
      }
    }
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
  
  // Add floor after ceiling is created
  addFloor(instance);
} 