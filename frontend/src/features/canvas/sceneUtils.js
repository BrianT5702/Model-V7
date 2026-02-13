// Utility functions for Three.js scene setup and model building

import { OrbitControls } from './threeInstance';
import earcut from 'earcut';
import { THREE_CONFIG } from './threeConfig';

// Helper function to calculate polygon center (centroid)
function calculatePolygonCenter(vertices) {
  if (!vertices || vertices.length === 0) return null;
  let sumX = 0, sumZ = 0;
  vertices.forEach(v => {
    sumX += v.x;
    sumZ += v.z;
  });
  return {
    x: sumX / vertices.length,
    z: sumZ / vertices.length
  };
}

// Helper function to shrink polygon vertices inward by wall thickness
function shrinkPolygonByWallThickness(instance, vertices, wallThickness) {
  if (!vertices || vertices.length < 3 || wallThickness <= 0) {
    return vertices; // Return original if invalid
  }
  
  // Calculate polygon center to determine inward direction
  const center = calculatePolygonCenter(vertices);
  if (!center) {
    return vertices;
  }
  
  const scaledWallThickness = wallThickness * instance.scalingFactor;
  const shrunkVertices = [];
  const len = vertices.length;
  
  for (let i = 0; i < len; i++) {
    const prev = vertices[(i - 1 + len) % len];
    const curr = vertices[i];
    const next = vertices[(i + 1) % len];
    
    // Calculate vectors for previous and next segments (in XZ plane)
    const v1 = {
      x: curr.x - prev.x,
      z: curr.z - prev.z
    };
    const v2 = {
      x: next.x - curr.x,
      z: next.z - curr.z
    };
    
    // Normalize vectors
    const len1 = Math.sqrt(v1.x * v1.x + v1.z * v1.z);
    const len2 = Math.sqrt(v2.x * v2.x + v2.z * v2.z);
    
    if (len1 < 1e-6 || len2 < 1e-6) {
      // Degenerate edge, keep original point
      shrunkVertices.push({ x: curr.x, z: curr.z });
      continue;
    }
    
    // Calculate both possible normals for each edge (left and right perpendicular)
    const n1_left = {
      x: -v1.z / len1,  // Left perpendicular to v1
      z: v1.x / len1
    };
    const n1_right = {
      x: v1.z / len1,   // Right perpendicular to v1
      z: -v1.x / len1
    };
    
    const n2_left = {
      x: -v2.z / len2,  // Left perpendicular to v2
      z: v2.x / len2
    };
    const n2_right = {
      x: v2.z / len2,   // Right perpendicular to v2
      z: -v2.x / len2
    };
    
    // Determine which normal points inward (toward center)
    // Calculate direction from current vertex to center
    const toCenter = {
      x: center.x - curr.x,
      z: center.z - curr.z
    };
    const toCenterLen = Math.sqrt(toCenter.x * toCenter.x + toCenter.z * toCenter.z);
    
    if (toCenterLen < 1e-6) {
      // Vertex is at center, use left normals as default
      const n1 = n1_left;
      const n2 = n2_left;
      
      // Calculate average normal vector (bisector)
      const bisector = {
        x: (n1.x + n2.x) / 2,
        z: (n1.z + n2.z) / 2
      };
      
      const bisectorLen = Math.sqrt(bisector.x * bisector.x + bisector.z * bisector.z);
      if (bisectorLen > 1e-6) {
        shrunkVertices.push({
          x: curr.x + (bisector.x / bisectorLen) * scaledWallThickness,
          z: curr.z + (bisector.z / bisectorLen) * scaledWallThickness
        });
      } else {
        shrunkVertices.push({ x: curr.x, z: curr.z });
      }
      continue;
    }
    
    // Normalize toCenter
    const toCenterNorm = {
      x: toCenter.x / toCenterLen,
      z: toCenter.z / toCenterLen
    };
    
    // Choose the normal that points more toward the center
    // Dot product with toCenter direction tells us which points inward
    const dot1_left = n1_left.x * toCenterNorm.x + n1_left.z * toCenterNorm.z;
    const dot1_right = n1_right.x * toCenterNorm.x + n1_right.z * toCenterNorm.z;
    const dot2_left = n2_left.x * toCenterNorm.x + n2_left.z * toCenterNorm.z;
    const dot2_right = n2_right.x * toCenterNorm.x + n2_right.z * toCenterNorm.z;
    
    // Use the normal with higher dot product (points more toward center)
    const n1 = dot1_left > dot1_right ? n1_left : n1_right;
    const n2 = dot2_left > dot2_right ? n2_left : n2_right;
    
    // Calculate average normal vector (bisector)
    const bisector = {
      x: (n1.x + n2.x) / 2,
      z: (n1.z + n2.z) / 2
    };
    
    // Calculate angle between segments
    const dot = n1.x * n2.x + n1.z * n2.z;
    const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
    
    // Handle very small angles (near-collinear segments)
    if (angle < 1e-6 || Math.abs(angle - Math.PI) < 1e-6) {
      // Use simple offset along bisector (already points toward center)
      const bisectorLen = Math.sqrt(bisector.x * bisector.x + bisector.z * bisector.z);
      if (bisectorLen > 1e-6) {
        shrunkVertices.push({
          x: curr.x + (bisector.x / bisectorLen) * scaledWallThickness,
          z: curr.z + (bisector.z / bisectorLen) * scaledWallThickness
        });
      } else {
        shrunkVertices.push({ x: curr.x, z: curr.z });
      }
      continue;
    }
    
    // Calculate fixed inset distance for the corner
    const offsetDist = scaledWallThickness / Math.sin(angle / 2);
    
    // Calculate inset point
    const bisectorLen = Math.sqrt(bisector.x * bisector.x + bisector.z * bisector.z);
    if (bisectorLen > 1e-6) {
      shrunkVertices.push({
        x: curr.x + (bisector.x / bisectorLen) * offsetDist,
        z: curr.z + (bisector.z / bisectorLen) * offsetDist
      });
    } else {
      shrunkVertices.push({ x: curr.x, z: curr.z });
    }
  }
  
  return shrunkVertices;
}

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
  // Bright ambient lighting for white metallic materials
  
  // Strong hemisphere light for bright ambient white appearance
  const hemisphereLight = new instance.THREE.HemisphereLight(
    0xffffff, // Pure white sky for bright ambient
    0xffffff, // Pure white ground for maximum brightness
    1.5 // High intensity for bright ambient white
  );
  instance.scene.add(hemisphereLight);
  
  // Strong ambient light for overall brightness
  const ambientLight = new instance.THREE.AmbientLight(0xffffff, 1.2);
  instance.scene.add(ambientLight);
  
  // Main directional light (sun) - primary light source with high intensity
  const mainLight = new instance.THREE.DirectionalLight(0xffffff, 2.0);
  mainLight.position.set(150, 300, 150);
  mainLight.castShadow = true;
  
  // Configure shadow properties for better quality
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 2000;
  mainLight.shadow.camera.left = -500;
  mainLight.shadow.camera.right = 500;
  mainLight.shadow.camera.top = 500;
  mainLight.shadow.camera.bottom = -500;
  mainLight.shadow.bias = -0.0001;
  mainLight.shadow.normalBias = 0.02;
  
  instance.scene.add(mainLight);
  
  // Strong fill light from opposite side for even brightness
  const fillLight = new instance.THREE.DirectionalLight(0xffffff, 1.0);
  fillLight.position.set(-150, 200, -150);
  fillLight.castShadow = false;
  instance.scene.add(fillLight);
  
  // Additional top light for maximum brightness
  const topLight = new instance.THREE.DirectionalLight(0xffffff, 0.8);
  topLight.position.set(0, 400, 0);
  topLight.castShadow = false;
  instance.scene.add(topLight);
  
  // Store main light reference for potential updates
  instance.mainLight = mainLight;
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

// Helper function to get default Cut L horizontal extension based on wall thickness
function getCutLDefaultHorizontalExtension(wallThickness) {
  if (wallThickness >= 200) return 125.0;
  if (wallThickness >= 150) return 100.0;
  if (wallThickness >= 125) return 75.0;
  if (wallThickness >= 100) return 75.0;
  if (wallThickness >= 75) return 50.0;
  return 50.0;
}

// Helper function to get Cut L horizontal extension for a wall
function getCutLHorizontalExtension(wall) {
  if (wall.ceiling_cut_l_horizontal_extension !== null && wall.ceiling_cut_l_horizontal_extension !== undefined) {
    return wall.ceiling_cut_l_horizontal_extension;
  }
  return getCutLDefaultHorizontalExtension(wall.thickness || 150);
}

// Calculate Cut L wall offsets for a room
function calculateCutLWallOffsets(room, walls) {
  const offsets = {};
  if (!room || !walls) return offsets;
  
  // Get walls for this room - handle both array of IDs and array of objects
  let roomWallIds = [];
  if (Array.isArray(room.walls)) {
    roomWallIds = room.walls.map(w => String(typeof w === 'object' ? w.id : w));
  }
  
  // Also try to find walls by proximity to room_points if room.walls is empty
  let wallsToCheck = [];
  if (roomWallIds.length > 0) {
    // Use walls from room.walls
    wallsToCheck = walls.filter(wall => roomWallIds.includes(String(wall.id)));
  } else if (room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3) {
    // Find walls by proximity to room_points (within 1mm tolerance)
    const tolerance = 1.0;
    wallsToCheck = walls.filter(wall => {
      return room.room_points.some(point => {
        const distToStart = Math.sqrt(Math.pow(point.x - wall.start_x, 2) + Math.pow(point.y - wall.start_y, 2));
        const distToEnd = Math.sqrt(Math.pow(point.x - wall.end_x, 2) + Math.pow(point.y - wall.end_y, 2));
        return distToStart < tolerance || distToEnd < tolerance;
      });
    });
  } else {
    // Fallback: check all walls
    wallsToCheck = walls;
  }
  
  wallsToCheck.forEach(wall => {
    if (wall.ceiling_joint_type === 'cut_l') {
      const horizontalExtension = getCutLHorizontalExtension(wall);
      const offset = (wall.thickness || 150) - horizontalExtension;
      offsets[wall.id] = offset;
      console.log(`[Cut L] Room ${room.id || 'unknown'}: Wall ${wall.id} - thickness: ${wall.thickness}mm, extension: ${horizontalExtension}mm, offset: ${offset}mm`);
    }
  });
  
  if (Object.keys(offsets).length === 0) {
    console.log(`[Cut L] Room ${room.id || 'unknown'}: No Cut L joints found (checked ${wallsToCheck.length} walls)`);
  }
  
  return offsets;
}

// Shrink room vertices based on Cut L offsets
function shrinkRoomVerticesForCutL(roomVertices, room, walls, scale, modelOffset) {
  const offsets = calculateCutLWallOffsets(room, walls);
  
  // If no Cut L joints, return original vertices
  if (Object.keys(offsets).length === 0) {
    return roomVertices;
  }
  
  // Calculate bounding box of original vertices (in 2D coordinates)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  roomVertices.forEach(v => {
    const x = (v.x - modelOffset.x) / scale;
    const y = (v.z - modelOffset.z) / scale;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  
  const originalBoundingBox = { min_x: minX, max_x: maxX, min_y: minY, max_y: maxY };
  
  // Adjust bounding box for Cut L offsets (similar to backend logic)
  const adjustedBoundingBox = { ...originalBoundingBox };
  const tolerance = 1.0;
  
  // Get walls that have offsets (only process walls with Cut L joints)
  const wallsWithOffsets = walls.filter(wall => offsets[wall.id]);
  
  console.log(`[Cut L Shrink] Room ${room.id || 'unknown'}: Processing ${wallsWithOffsets.length} walls with Cut L joints`);
  
  wallsWithOffsets.forEach(wall => {
    const offset = offsets[wall.id];
      const wallStartX = wall.start_x;
      const wallStartY = wall.start_y;
      const wallEndX = wall.end_x;
      const wallEndY = wall.end_y;
      
      // Debug: log wall position relative to bounding box
      const wallOnLeft = Math.abs(wallStartX - originalBoundingBox.min_x) < tolerance && Math.abs(wallEndX - originalBoundingBox.min_x) < tolerance;
      const wallOnRight = Math.abs(wallStartX - originalBoundingBox.max_x) < tolerance && Math.abs(wallEndX - originalBoundingBox.max_x) < tolerance;
      const wallOnBottom = Math.abs(wallStartY - originalBoundingBox.min_y) < tolerance && Math.abs(wallEndY - originalBoundingBox.min_y) < tolerance;
      const wallOnTop = Math.abs(wallStartY - originalBoundingBox.max_y) < tolerance && Math.abs(wallEndY - originalBoundingBox.max_y) < tolerance;
      
      if (!wallOnLeft && !wallOnRight && !wallOnBottom && !wallOnTop) {
        console.log(`[Cut L Shrink] Wall ${wall.id}: Not on boundary - start: (${wallStartX}, ${wallStartY}), end: (${wallEndX}, ${wallEndY}), bbox: (${originalBoundingBox.min_x}-${originalBoundingBox.max_x}, ${originalBoundingBox.min_y}-${originalBoundingBox.max_y})`);
      }
      
      // Check which boundary this wall touches and adjust (matching backend logic exactly)
    // LEFT BOUNDARY (min_x) - both endpoints on left boundary
    if (Math.abs(wallStartX - originalBoundingBox.min_x) < tolerance && 
        Math.abs(wallEndX - originalBoundingBox.min_x) < tolerance) {
      adjustedBoundingBox.min_x = Math.max(adjustedBoundingBox.min_x, originalBoundingBox.min_x + offset);
    }
    // RIGHT BOUNDARY (max_x) - both endpoints on right boundary
    else if (Math.abs(wallStartX - originalBoundingBox.max_x) < tolerance && 
             Math.abs(wallEndX - originalBoundingBox.max_x) < tolerance) {
      adjustedBoundingBox.max_x = Math.min(adjustedBoundingBox.max_x, originalBoundingBox.max_x - offset);
    }
    // BOTTOM BOUNDARY (min_y) - both endpoints on bottom boundary
    else if (Math.abs(wallStartY - originalBoundingBox.min_y) < tolerance && 
             Math.abs(wallEndY - originalBoundingBox.min_y) < tolerance) {
      adjustedBoundingBox.min_y = Math.max(adjustedBoundingBox.min_y, originalBoundingBox.min_y + offset);
    }
    // TOP BOUNDARY (max_y) - both endpoints on top boundary
    else if (Math.abs(wallStartY - originalBoundingBox.max_y) < tolerance && 
             Math.abs(wallEndY - originalBoundingBox.max_y) < tolerance) {
      adjustedBoundingBox.max_y = Math.min(adjustedBoundingBox.max_y, originalBoundingBox.max_y - offset);
    }
    // SPANNING / TOUCHING WALLS - check individual endpoints
    else {
      // Check Start Point
      if (Math.abs(wallStartX - originalBoundingBox.min_x) < tolerance) {
        adjustedBoundingBox.min_x = Math.max(adjustedBoundingBox.min_x, originalBoundingBox.min_x + offset);
      } else if (Math.abs(wallStartX - originalBoundingBox.max_x) < tolerance) {
        adjustedBoundingBox.max_x = Math.min(adjustedBoundingBox.max_x, originalBoundingBox.max_x - offset);
      } else if (Math.abs(wallStartY - originalBoundingBox.min_y) < tolerance) {
        adjustedBoundingBox.min_y = Math.max(adjustedBoundingBox.min_y, originalBoundingBox.min_y + offset);
      } else if (Math.abs(wallStartY - originalBoundingBox.max_y) < tolerance) {
        adjustedBoundingBox.max_y = Math.min(adjustedBoundingBox.max_y, originalBoundingBox.max_y - offset);
      }
      
      // Check End Point
      if (Math.abs(wallEndX - originalBoundingBox.min_x) < tolerance) {
        adjustedBoundingBox.min_x = Math.max(adjustedBoundingBox.min_x, originalBoundingBox.min_x + offset);
      } else if (Math.abs(wallEndX - originalBoundingBox.max_x) < tolerance) {
        adjustedBoundingBox.max_x = Math.min(adjustedBoundingBox.max_x, originalBoundingBox.max_x - offset);
      } else if (Math.abs(wallEndY - originalBoundingBox.min_y) < tolerance) {
        adjustedBoundingBox.min_y = Math.max(adjustedBoundingBox.min_y, originalBoundingBox.min_y + offset);
      } else if (Math.abs(wallEndY - originalBoundingBox.max_y) < tolerance) {
        adjustedBoundingBox.max_y = Math.min(adjustedBoundingBox.max_y, originalBoundingBox.max_y - offset);
      }
    }
  });
  
  // Check if bounding box was actually adjusted
  if (Math.abs(adjustedBoundingBox.min_x - originalBoundingBox.min_x) < 0.1 &&
      Math.abs(adjustedBoundingBox.max_x - originalBoundingBox.max_x) < 0.1 &&
      Math.abs(adjustedBoundingBox.min_y - originalBoundingBox.min_y) < 0.1 &&
      Math.abs(adjustedBoundingBox.max_y - originalBoundingBox.max_y) < 0.1) {
    return roomVertices; // No adjustment needed
  }
  
  // Adjust vertices based on which boundary they're on
  const adjustedVertices = roomVertices.map(v => {
    const x = (v.x - modelOffset.x) / scale;
    const y = (v.z - modelOffset.z) / scale;
    
    let adjustedX = x;
    let adjustedY = y;
    
    // Adjust x coordinate if on left or right boundary
    if (Math.abs(x - originalBoundingBox.min_x) < tolerance) {
      adjustedX = adjustedBoundingBox.min_x;
    } else if (Math.abs(x - originalBoundingBox.max_x) < tolerance) {
      adjustedX = adjustedBoundingBox.max_x;
    }
    
    // Adjust y coordinate if on bottom or top boundary
    if (Math.abs(y - originalBoundingBox.min_y) < tolerance) {
      adjustedY = adjustedBoundingBox.min_y;
    } else if (Math.abs(y - originalBoundingBox.max_y) < tolerance) {
      adjustedY = adjustedBoundingBox.max_y;
    }
    
    // Convert back to 3D coordinates
    return {
      x: adjustedX * scale + modelOffset.x,
      z: adjustedY * scale + modelOffset.z
    };
  });
  
  return adjustedVertices;
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
  let vertices = getBuildingFootprint(instance);
  if (vertices.length < 3) {
    return;
  }
  
  // Apply Cut L shrinking for fallback ceiling
  // For fallback ceiling, we shrink each room's vertices and then compute the combined footprint
  const shrunkRoomVerticesList = [];
  validRooms.forEach(room => {
    // Get room vertices in 3D coordinates
    if (!room.room_points || room.room_points.length < 3) return;
    
    const roomVertices = room.room_points.map(point => ({
      x: point.x * instance.scalingFactor + instance.modelOffset.x,
      z: point.y * instance.scalingFactor + instance.modelOffset.z
    }));
    
    // Shrink room vertices for Cut L joints
    const shrunkRoomVertices = shrinkRoomVerticesForCutL(
      roomVertices, 
      room, 
      instance.walls, 
      instance.scalingFactor, 
      instance.modelOffset
    );
    
    if (shrunkRoomVertices.length >= 3) {
      shrunkRoomVerticesList.push(shrunkRoomVertices);
    }
  });
  
  // If we have shrunk vertices from rooms, compute convex hull of all shrunk rooms
  // Otherwise use original vertices
  if (shrunkRoomVerticesList.length > 0) {
    // Flatten all shrunk room vertices
    const allShrunkVertices = shrunkRoomVerticesList.flat();
    // Compute convex hull of all shrunk room vertices
    vertices = computeConvexHull(allShrunkVertices);
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
  // Create material using professional config
  const material = new instance.THREE.MeshStandardMaterial({
    color: THREE_CONFIG.MATERIALS.CEILING.color,
    side: instance.THREE.DoubleSide,
    roughness: THREE_CONFIG.MATERIALS.CEILING.roughness,
    metalness: THREE_CONFIG.MATERIALS.CEILING.metalness,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });
  // Create mesh
  const ceiling = new instance.THREE.Mesh(geometry, material);
  ceiling.name = 'ceiling';
  // Set render order to render after walls (higher number = renders later)
  ceiling.renderOrder = 1;
  // Position the ceiling at the calculated elevation (storey elevation + room base + room height)
  // Add a tiny offset to prevent z-fighting with wall tops
  ceiling.position.y = maxCeilingElevation * instance.scalingFactor + 0.001;
  
  // Add edge lines to match wall appearance
  const edges = new instance.THREE.EdgesGeometry(geometry);
  const edgeLines = new instance.THREE.LineSegments(
    edges, 
    new instance.THREE.LineBasicMaterial({ 
      color: 0x000000, // Black edge lines like walls
      depthTest: true,
      depthWrite: false, // Don't write to depth buffer to prevent z-fighting
      transparent: false
    })
  );
  // Set render order to render edge lines after the ceiling mesh to prevent blinking
  edgeLines.renderOrder = 2; // Higher than ceiling mesh (which is 1)
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
  let vertices = getBuildingFootprint(instance);
  if (vertices.length < 3) {
    return;
  }
  
  // Floor shrinking removed - using original footprint directly
  
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
    new instance.THREE.LineBasicMaterial({ 
      color: 0x000000, // Black edge lines like walls
      depthTest: true,
      depthWrite: false, // Don't write to depth buffer to prevent z-fighting
      transparent: false
    })
  );
  // Set render order to render edge lines after the floor mesh to prevent blinking
  edgeLines.renderOrder = 2; // Higher than floor mesh (which is 0 by default)
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