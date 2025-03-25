import * as THREE from "three";
import earcut from 'earcut';
import gsap from 'gsap';

export default class ThreeCanvas {
  constructor(containerId, walls, scalingFactor = 0.01) { // Reduced default scaling factor
    this.container = document.getElementById(containerId);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      2000 // Increased far plane for larger scene
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.walls = walls;
    this.scalingFactor = scalingFactor;
    this.modelOffset = { x: 0, z: 0 };
    this.buildingHeight = 3;
    this.gridSize = 1000; // Much larger grid
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
      child => !child.userData.isWall && child.name !== 'ceiling'
    );

    // Create new walls from the data
    this.walls.forEach(wall => {
      const wallMesh = this.createWallMesh(wall);
      this.scene.add(wallMesh);
    });

    // Add ceiling
    // this.addCeiling();
  }

  // Create a single wall mesh
  createWallMesh(wall, index) {
    const { start_x, start_y, end_x, end_y, height, thickness } = wall;

    // Convert coordinates to scene space
    const startX = (start_x * this.scalingFactor) + this.modelOffset.x;
    const startZ = (start_y * this.scalingFactor) + this.modelOffset.z;
    const endX = (end_x * this.scalingFactor) + this.modelOffset.x;
    const endZ = (end_y * this.scalingFactor) + this.modelOffset.z;

    // Calculate wall length without thickness offset
    const length = Math.hypot(endX - startX, endZ - startZ);

    // Create wall geometry with length plus thickness to extend into corners
    const geometry = new THREE.BoxGeometry(
        length + (thickness * this.scalingFactor),
        height * this.scalingFactor,
        thickness * this.scalingFactor
    );
    
    const material = new THREE.MeshStandardMaterial({ 
        color: 0xaaaaaa,
        roughness: 0.7,
        metalness: 0.2,
    });

    const wallMesh = new THREE.Mesh(geometry, material);

    // Position at midpoint
    wallMesh.position.set(
        (startX + endX) / 2,
        height * this.scalingFactor / 2,
        (startZ + endZ) / 2
    );

    // Calculate and apply rotation
    const angle = Math.atan2(endZ - startZ, endX - startX);
    wallMesh.rotation.y = -angle;

    wallMesh.userData.isWall = true;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;

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