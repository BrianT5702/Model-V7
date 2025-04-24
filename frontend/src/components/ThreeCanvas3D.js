import * as THREE from "three";
import earcut from 'earcut';
import gsap from 'gsap';

export default class ThreeCanvas {
  constructor(containerId, walls, joints = [], doors = [], scalingFactor = 0.01) {
    this.container = document.getElementById(containerId);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      2000
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.walls = walls;
    this.joints = joints;
    this.doors = doors;
    this.scalingFactor = scalingFactor;
    this.modelOffset = { x: 0, z: 0 };
    this.buildingHeight = 3;
    this.gridSize = 1000;
    this.isInteriorView = false;

    this.init();
    
  }

  init() {
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // Adjust initial camera position for better view
    this.camera.position.set(200, 200, 200);
    this.camera.lookAt(0, 0, 0);

    this.addControls();
    this.addGrid();
    this.addLighting();

    // Calculate and adjust model scale
    this.calculateModelOffset();
    this.adjustModelScale();
    this.buildModel();

    this.animate();
  }

  addGrid() {
    // Create a larger grid with more divisions
    const gridHelper = new THREE.GridHelper(this.gridSize, 50);
    gridHelper.position.y = 0;
    this.scene.add(gridHelper);

    // Add a ground plane matching the grid size
    const groundGeometry = new THREE.PlaneGeometry(this.gridSize, this.gridSize);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xf0f0f0,
      roughness: 0.8,
      metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  adjustModelScale() {
    // Calculate model dimensions
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    this.walls.forEach(wall => {
      minX = Math.min(minX, wall.start_x, wall.end_x);
      maxX = Math.max(maxX, wall.start_x, wall.end_x);
      minZ = Math.min(minZ, wall.start_y, wall.end_y);
      maxZ = Math.max(maxZ, wall.start_y, wall.end_y);
    });

    const modelWidth = maxX - minX;
    const modelDepth = maxZ - minZ;
    const maxDimension = Math.max(modelWidth, modelDepth);

    // Adjust scaling factor to fit model within 1/3 of the grid
    const targetSize = this.gridSize / 3.5;
    this.scalingFactor = targetSize / maxDimension;

    // Recalculate model offset with new scaling
    this.calculateModelOffset();
  }

  addLighting() {
    // Ambient light for general illumination
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);

    // Main directional light with shadows
    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(100, 200, 100);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.far = 1000;
    this.scene.add(mainLight);

    // Secondary fill light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-50, 100, -50);
    this.scene.add(fillLight);
  }

  animateToInteriorView() {
    const bounds = this.getModelBounds();
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const ceiling = this.scene.getObjectByName('ceiling');

    // Animate ceiling opacity
    if (ceiling) {
        gsap.to(ceiling.material, {
            opacity: 0,
            duration: 1,
            onStart: () => {
                ceiling.material.transparent = true;
            },
            onComplete: () => {
                ceiling.visible = false;
            }
        });
    }

    // Animate camera position
    gsap.to(this.camera.position, {
        x: centerX + 50,
        y: 250,
        z: centerZ + 50,
        duration: 2,
        ease: "power2.inOut"
    });

    // Animate camera target
    const targetPosition = new THREE.Vector3(centerX, 25, centerZ);
    gsap.to(this.controls.target, {
        x: targetPosition.x,
        y: targetPosition.y,
        z: targetPosition.z,
        duration: 2,
        ease: "power2.inOut",
        onUpdate: () => this.controls.update()
    });

    this.isInteriorView = true;
}

animateToExteriorView() {
    const bounds = this.getModelBounds();
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const ceiling = this.scene.getObjectByName('ceiling');

    // Animate ceiling opacity
    if (ceiling) {
        ceiling.visible = true;
        gsap.to(ceiling.material, {
            opacity: 1,
            duration: 1,
            onComplete: () => {
                ceiling.material.transparent = false;
            }
        });
    }

    // Animate camera position
    gsap.to(this.camera.position, {
        x: centerX + 200,
        y: 200,
        z: centerZ + 200,
        duration: 2,
        ease: "power2.inOut"
    });

    // Animate camera target
    const targetPosition = new THREE.Vector3(centerX, 0, centerZ);
    gsap.to(this.controls.target, {
        x: targetPosition.x,
        y: targetPosition.y,
        z: targetPosition.z,
        duration: 2,
        ease: "power2.inOut",
        onUpdate: () => this.controls.update()
    });

    this.isInteriorView = false;
}

getModelBounds() {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    this.walls.forEach(wall => {
        const startX = wall.start_x * this.scalingFactor + this.modelOffset.x;
        const startZ = wall.start_y * this.scalingFactor + this.modelOffset.z;
        const endX = wall.end_x * this.scalingFactor + this.modelOffset.x;
        const endZ = wall.end_y * this.scalingFactor + this.modelOffset.z;

        minX = Math.min(minX, startX, endX);
        maxX = Math.max(maxX, startX, endX);
        minZ = Math.min(minZ, startZ, endZ);
        maxZ = Math.max(maxZ, startZ, endZ);
    });

    return { minX, maxX, minZ, maxZ };
  }

  // Keep your existing methods...
  addControls() {
    const { OrbitControls } = require("three/examples/jsm/controls/OrbitControls");
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    
    // Add controls limits for better navigation
    this.controls.maxDistance = this.gridSize;
    this.controls.minDistance = 10;
  }

  calculateModelOffset() {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

    this.walls.forEach((wall) => {
      const startX = wall.start_x * this.scalingFactor;
      const startZ = wall.start_y * this.scalingFactor;
      const endX = wall.end_x * this.scalingFactor;
      const endZ = wall.end_y * this.scalingFactor;

      minX = Math.min(minX, startX, endX);
      minZ = Math.min(minZ, startZ, endZ);
      maxX = Math.max(maxX, startX, endX);
      maxZ = Math.max(maxZ, startZ, endZ);
    });

    this.modelOffset.x = -(minX + maxX) / 2;
    this.modelOffset.z = -(minZ + maxZ) / 2;
  }

  // Build the 3D model using the walls data
  buildModel() {
    // Remove existing walls from the scene
    this.scene.children = this.scene.children.filter(
      child => !child.userData.isWall && !child.userData.isJointLine && !child.userData.isDoor && child.name !== 'ceiling'
    );
  
    // Normalize door data: map linked_wall → wall
    this.doors.forEach(d => {
      if (d.linked_wall && !d.wall) d.wall = d.linked_wall;
    });
  
    // Create new walls and attach doors
    this.walls.forEach(wall => {
      const wallMesh = this.createWallMesh(wall);
      this.scene.add(wallMesh);
  
      console.log('Current Wall ID:', wall.id);
      console.log('Available Doors:', this.doors);
  
      const wallDoors = this.doors.filter(d => String(d.wall) === String(wall.id));
      console.log('Doors matched with wall:', wallDoors);
  
      wallDoors.forEach(door => {
        const doorMesh = this.createDoorMesh(door, wall);
        if (doorMesh) this.scene.add(doorMesh);
      });
    });
  
    // this.addCeiling();
  }  

  createDoorMesh(door, wall) {
    // Scale factors
    const scale = this.scalingFactor;
    
    // Extract door properties
    const { width, height, thickness, position_x, door_type, swing_direction, slide_direction, side, configuration } = door;
    
    // Extract wall properties
    const { start_x, start_y, end_x, end_y, thickness: wallThickness } = wall;
    
    // Calculate scaled dimensions
    const doorWidth = width * scale;
    const doorHeight = height * scale;
    const doorThickness = thickness * scale;
    const scaledWallThickness = wallThickness * scale;
    
    // Calculate wall direction and position
    const startX = start_x * scale + this.modelOffset.x;
    const startZ = start_y * scale + this.modelOffset.z;
    const endX = end_x * scale + this.modelOffset.x;
    const endZ = end_y * scale + this.modelOffset.z;
    
    // Wall vector and length
    const dx = endX - startX;
    const dz = endZ - startZ;
    const wallLength = Math.hypot(dx, dz);
    
    // Normalized wall direction
    const wallDirX = dx / wallLength;
    const wallDirZ = dz / wallLength;
    
    // Wall normal (perpendicular to wall)
    const wallNormX = -wallDirZ;
    const wallNormZ = wallDirX;
    
    // Calculate door position along wall
    const doorPosX = startX + wallDirX * (wallLength * position_x);
    const doorPosZ = startZ + wallDirZ * (wallLength * position_x);
    
    // Side coefficient (1 for exterior, -1 for interior)
    const sideCoefficient = side === 'exterior' ? 1 : -1;
    
    // Door material
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: door_type === 'swing' ? 0xFFA500 : 0x00FF00,
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8
    });
    
    // Frame material
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      roughness: 0.7,
      metalness: 0.1
    });
    
    // Calculate the wall's actual center line position 
    // (This matches how walls are positioned in createWallMesh)
    const wallOffsetX = wallNormX * (scaledWallThickness / 2);
    const wallOffsetZ = wallNormZ * (scaledWallThickness / 2);
    const wallCenterX = doorPosX + wallOffsetX;
    const wallCenterZ = doorPosZ + wallOffsetZ;
    
    // Create a door frame that fits into the wall
    const frameWidth = doorWidth * 1.05;
    const frameHeight = doorHeight * 1.02;
    const frameDepth = scaledWallThickness;
    
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(frameWidth, frameHeight, frameDepth),
      frameMaterial
    );
    
    frame.position.set(wallCenterX, doorHeight / 2, wallCenterZ);
    frame.rotation.y = -Math.atan2(wallDirZ, wallDirX);
    this.scene.add(frame);
    
    // === SLIDING DOOR IMPLEMENTATION ===
    if (door_type === 'slide') {
      // Position sliding door flush with the wall surface
      // The door should be positioned on the interior or exterior side of the wall
      const doorOffsetX = wallNormX * (scaledWallThickness/2) * sideCoefficient;
      const doorOffsetZ = wallNormZ * (scaledWallThickness/2) * sideCoefficient;
      
      if (configuration === 'double_sided') {
        // Create double sliding doors
        const halfWidth = doorWidth * 0.48; // Slightly less than half to fit with gap
        
        // Create both door panels
        const leftDoor = new THREE.Mesh(
          new THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness),
          doorMaterial
        );
        
        const rightDoor = new THREE.Mesh(
          new THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness),
          doorMaterial
        );
        
        // Position doors at the correct wall surface
        const leftPosX = wallCenterX - wallDirX * (halfWidth/2) + doorOffsetX;
        const leftPosZ = wallCenterZ - wallDirZ * (halfWidth/2) + doorOffsetZ;
        const rightPosX = wallCenterX + wallDirX * (halfWidth/2) + doorOffsetX;
        const rightPosZ = wallCenterZ + wallDirZ * (halfWidth/2) + doorOffsetZ;
        
        leftDoor.position.set(leftPosX, doorHeight/2, leftPosZ);
        rightDoor.position.set(rightPosX, doorHeight/2, rightPosZ);
        
        leftDoor.rotation.y = -Math.atan2(wallDirZ, wallDirX);
        rightDoor.rotation.y = -Math.atan2(wallDirZ, wallDirX);
        
        // Animate doors sliding open
        const slideDistance = halfWidth * 0.9;
        
        gsap.to(leftDoor.position, {
          x: leftPosX - wallDirX * slideDistance,
          z: leftPosZ - wallDirZ * slideDistance,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        
        gsap.to(rightDoor.position, {
          x: rightPosX + wallDirX * slideDistance,
          z: rightPosZ + wallDirZ * slideDistance,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        
        this.scene.add(leftDoor);
        this.scene.add(rightDoor);
      } else {
        // Single sliding door
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(doorWidth * 0.95, doorHeight * 0.98, doorThickness),
          doorMaterial
        );
        
        // Position door at wall
        const doorX = wallCenterX + doorOffsetX;
        const doorZ = wallCenterZ + doorOffsetZ;
        
        door.position.set(doorX, doorHeight/2, doorZ);
        door.rotation.y = Math.atan2(wallDirZ, wallDirX);
        
        // Sliding direction
        const rawDirection = slide_direction === 'right' ? -1 : 1;
        const slideDirectionSign = side === 'exterior' ? -rawDirection : rawDirection;
        const slideDistance = doorWidth *0.9;
        
        // Animate door sliding
        gsap.to(door.position, {
          x: doorX + wallDirX * slideDistance * slideDirectionSign,
          z: doorZ + wallDirZ * slideDistance * slideDirectionSign,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        
        this.scene.add(door);
      }
      
      return null;
    }
    
    // === SWING DOOR IMPLEMENTATION ===
    else if (door_type === 'swing') {
      if (configuration === 'double_sided') {
        const halfWidth = doorWidth * 0.48;
      
        // Left hinge
        const leftPivot = new THREE.Object3D();
        const leftHingePos = {
          x: wallCenterX - wallDirX * (frameWidth / 2),
          z: wallCenterZ - wallDirZ * (frameWidth / 2)
        };
        leftPivot.position.set(leftHingePos.x, doorHeight / 2, leftHingePos.z);
        leftPivot.rotation.y = -Math.atan2(wallDirZ, wallDirX);
      
        // Right hinge
        const rightPivot = new THREE.Object3D();
        const rightHingePos = {
          x: wallCenterX + wallDirX * (frameWidth / 2),
          z: wallCenterZ + wallDirZ * (frameWidth / 2)
        };
        rightPivot.position.set(rightHingePos.x, doorHeight / 2, rightHingePos.z);
        rightPivot.rotation.y = -Math.atan2(wallDirZ, wallDirX);
      
        // Translated geometry so hinge is at edge
        const leftGeometry = new THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness);
        leftGeometry.translate(halfWidth / 2, 0, 0); // Extend from left edge to center
      
        const rightGeometry = new THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness);
        rightGeometry.translate(-halfWidth / 2, 0, 0); // Extend from right edge to center
      
        // Mesh panels
        const leftPanel = new THREE.Mesh(leftGeometry, doorMaterial);
        const rightPanel = new THREE.Mesh(rightGeometry, doorMaterial);
      
        // Position panels on wall face
        leftPanel.position.set(0, 0, (scaledWallThickness / 2) * sideCoefficient);
        rightPanel.position.set(0, 0, (scaledWallThickness / 2) * sideCoefficient);
      
        // Add to pivots
        leftPivot.add(leftPanel);
        rightPivot.add(rightPanel);
      
        // Animate swing open (adjust based on installation side)
        const leftAngle = Math.PI / 2 * (side === 'exterior' ? 1 : -1);
        const rightAngle = Math.PI / 2 * (side === 'exterior' ? -1 : 1);
      
        gsap.to(leftPanel.rotation, {
          y: leftAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      
        gsap.to(rightPanel.rotation, {
          y: rightAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      
        this.scene.add(leftPivot);
        this.scene.add(rightPivot);
      }
      else {
        // Single swing door section - FIXED VERSION
        const hingeOnRight = swing_direction === 'right';
        const mountedInside = side === 'interior';
  
        // IMPORTANT FIX: For interior doors, we need to flip which side the hinge is on
        // since we're viewing from the opposite side of the wall
        const effectiveHingeOnRight = mountedInside ? !hingeOnRight : hingeOnRight;
  
        // Determine hinge position based on the effective hinge side
        const hingePos = effectiveHingeOnRight ? {
          x: wallCenterX + wallDirX * (frameWidth / 2),
          z: wallCenterZ + wallDirZ * (frameWidth / 2)
        } : {
          x: wallCenterX - wallDirX * (frameWidth / 2),
          z: wallCenterZ - wallDirZ * (frameWidth / 2)
        };
  
        const pivot = new THREE.Object3D();
        pivot.position.set(hingePos.x, doorHeight / 2, hingePos.z);
        pivot.rotation.y = -Math.atan2(wallDirZ, wallDirX);
  
        // Build panel with hinge at edge
        const doorWidth95 = doorWidth * 0.95;
        const geometry = new THREE.BoxGeometry(doorWidth95, doorHeight * 0.98, doorThickness);
        
        // IMPORTANT FIX: Translate the geometry based on the effective hinge side
        geometry.translate(effectiveHingeOnRight ? -doorWidth95 / 2 : doorWidth95 / 2, 0, 0);
  
        const doorPanel = new THREE.Mesh(geometry, doorMaterial);
  
        // Position panel on wall face based on side
        const wallFaceOffset = (scaledWallThickness / 2) * sideCoefficient;
        doorPanel.position.set(0, 0, wallFaceOffset);
  
        pivot.add(doorPanel);
  
        // FIXED: Determine swing direction correctly
        // The base direction is determined by the effective hinge side
        let baseDir = 0;
        if (mountedInside)
        {
          baseDir = effectiveHingeOnRight ? 1 : -1;
        }
        else
        {
          baseDir = effectiveHingeOnRight ? -1 : 1;
        }
        
        // The swing angle is always positive for exterior doors (opening outward)
        // and negative for interior doors (opening inward)
        const swingAngle = Math.PI / 2 * baseDir;
  
        gsap.to(doorPanel.rotation, {
          y: swingAngle,
          duration: 2,
          ease: 'power2.inOut'
        });
  
        this.scene.add(pivot);
      }
    
      return null;
    }    
    
    return null;
  }

  // Create a single wall mesh
  createWallMesh(wall) {
    const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
    const scale = this.scalingFactor;

    let startX = start_x * scale;
    let startZ = start_y * scale;
    let endX = end_x * scale;
    let endZ = end_y * scale;

    const dx = endX - startX;
    const dz = endZ - startZ;
    const length = Math.hypot(dx, dz);

    const normX = -dz / length;
    const normZ = dx / length;
    const offsetX = normX * (thickness * scale / 2);
    const offsetZ = normZ * (thickness * scale / 2);

    startX += offsetX;
    startZ += offsetZ;
    endX += offsetX;
    endZ += offsetZ;

    const geometry = new THREE.BoxGeometry(
      length,
      height * scale,
      thickness * scale
    );

    const material = new THREE.MeshStandardMaterial({ 
      color: 0xaaaaaa,
      roughness: 0.7,
      metalness: 0.2,
    });

    const wallMesh = new THREE.Mesh(geometry, material);
    wallMesh.position.set(
      (startX + endX) / 2 + this.modelOffset.x,
      height * scale / 2,
      (startZ + endZ) / 2 + this.modelOffset.z
    );

    const angle = Math.atan2(endZ - startZ, endX - startX);
    wallMesh.rotation.y = -angle;

    wallMesh.userData.isWall = true;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;

    const addCutLine = (px, pz, direction = 1) => {
      const t = thickness * scale;
      const h = height * scale;
      const offsetY = 0.05;

      const top = new THREE.Vector3(
        px + direction * normX * t / 2 + this.modelOffset.x,
        h + offsetY,
        pz + direction * normZ * t / 2 + this.modelOffset.z
      );
      const bottom = new THREE.Vector3(
        px - direction * normX * t / 2 + this.modelOffset.x,
        offsetY,
        pz - direction * normZ * t / 2 + this.modelOffset.z
      );

      const points = [bottom, top];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
      const line = new THREE.Line(geometry, material);
      line.userData.isJointLine = true;
      this.scene.add(line);
    };

    const nearlyEqual = (a, b, epsilon = 0.001) => Math.abs(a - b) < epsilon;

    this.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        const isStart = nearlyEqual(j.intersection_x, wall.start_x) && nearlyEqual(j.intersection_y, wall.start_y);
        const isEnd = nearlyEqual(j.intersection_x, wall.end_x) && nearlyEqual(j.intersection_y, wall.end_y);
        if (isStart) addCutLine(startX, startZ);
        if (isEnd) addCutLine(endX, endZ, -1);
      }
    });

    return wallMesh;
  }

// addCeiling() {
//   // Remove existing ceiling
//   const existingCeiling = this.scene.getObjectByName('ceiling');
//   if (existingCeiling) {
//       this.scene.remove(existingCeiling);
//   }

//   // Get ordered vertices of the external walls
//   const vertices = this.getExternalVertices();
  
//   // Convert vertices to format required by earcut
//   const flatVertices = [];
//   vertices.forEach(vertex => {
//       flatVertices.push(vertex.x);
//       flatVertices.push(vertex.z);
//   });

//   // Triangulate the polygon
//   const triangles = earcut(flatVertices);

//   // Create ceiling geometry using triangulation
//   const geometry = new THREE.BufferGeometry();
  
//   // Create vertices array for the geometry
//   const positions = new Float32Array(triangles.length * 3);
//   for (let i = 0; i < triangles.length; i++) {
//       const vertexIndex = triangles[i];
//       const x = flatVertices[vertexIndex * 2];
//       const z = flatVertices[vertexIndex * 2 + 1];
      
//       positions[i * 3] = x;
//       positions[i * 3 + 1] = 0;  // Y coordinate (will be transformed later)
//       positions[i * 3 + 2] = z;
//   }

//   // Add the vertices to the geometry
//   geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
//   // Calculate normals
//   geometry.computeVertexNormals();

//   // Create material
//   const material = new THREE.MeshStandardMaterial({
//       color: 0xcccccc,
//       side: THREE.DoubleSide,
//       roughness: 0.7,
//       metalness: 0.2
//   });

//   // Create mesh
//   const ceiling = new THREE.Mesh(geometry, material);
//   ceiling.name = 'ceiling';
  
//   // Position the ceiling at the top of the walls
//   ceiling.position.y = this.walls[0].height * this.scalingFactor;
  
//   // Enable shadows
//   ceiling.castShadow = true;
//   ceiling.receiveShadow = true;

//   this.scene.add(ceiling);
// }

// Improved version of getExternalVertices to ensure proper vertex ordering
getExternalVertices() {
  // Create a map of all wall segments
  const wallSegments = new Map();
  const vertices = new Map();
  
  this.walls.forEach(wall => {
      const startX = wall.start_x * this.scalingFactor + this.modelOffset.x;
      const startZ = wall.start_y * this.scalingFactor + this.modelOffset.z;
      const endX = wall.end_x * this.scalingFactor + this.modelOffset.x;
      const endZ = wall.end_y * this.scalingFactor + this.modelOffset.z;
      
      // Create unique keys for vertices
      const startKey = `${startX.toFixed(4)},${startZ.toFixed(4)}`;
      const endKey = `${endX.toFixed(4)},${endZ.toFixed(4)}`;
      
      // Store vertices
      vertices.set(startKey, { x: startX, z: startZ });
      vertices.set(endKey, { x: endX, z: endZ });
      
      // Store wall segments
      if (!wallSegments.has(startKey)) wallSegments.set(startKey, new Set());
      if (!wallSegments.has(endKey)) wallSegments.set(endKey, new Set());
      
      wallSegments.get(startKey).add(endKey);
      wallSegments.get(endKey).add(startKey);
  });

  // Find the leftmost vertex to start with (this ensures consistent ordering)
  let startKey = Array.from(vertices.keys()).reduce((a, b) => {
      return vertices.get(a).x < vertices.get(b).x ? a : b;
  });

  // Create ordered list of vertices
  const orderedVertices = [];
  let currentKey = startKey;
  const visited = new Set();

  while (orderedVertices.length < vertices.size) {
      if (visited.has(currentKey)) break;
      
      visited.add(currentKey);
      orderedVertices.push(vertices.get(currentKey));
      
      // Find next unvisited connected vertex
      const connections = wallSegments.get(currentKey);
      currentKey = Array.from(connections).find(key => !visited.has(key));
      
      if (!currentKey) break; // Exit if no unvisited connected vertices found
  }

  return orderedVertices;
}

// Add a method to validate the ceiling
validateCeilingCoverage() {
  const ceiling = this.scene.getObjectByName('ceiling');
  if (!ceiling) return false;

  // Get the bounds of the ceiling
  const geometry = ceiling.geometry;
  geometry.computeBoundingBox();
  const ceilingBounds = geometry.boundingBox;

  // Get the bounds of all walls
  const wallBounds = new THREE.Box3();
  this.scene.children.forEach(child => {
      if (child.userData.isWall) {
          wallBounds.expandByObject(child);
      }
  });

  // Check if ceiling bounds roughly match wall bounds
  const ceilingArea = (ceilingBounds.max.x - ceilingBounds.min.x) * 
                     (ceilingBounds.max.z - ceilingBounds.min.z);
  const wallArea = (wallBounds.max.x - wallBounds.min.x) * 
                  (wallBounds.max.z - wallBounds.min.z);
  
  // Allow for small differences due to triangulation
  return Math.abs(ceilingArea - wallArea) / wallArea < 0.1;
}

  // Animation loop
  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
    this.controls.update();
  }
}