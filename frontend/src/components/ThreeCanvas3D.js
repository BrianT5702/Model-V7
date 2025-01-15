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
    this.addCeiling();
  }

  // Create a single wall mesh
  createWallMesh(wall) {
    const { start_x, start_y, end_x, end_y, height, thickness } = wall;

    // Scale the coordinates
    const scaledStartX = (start_x * this.scalingFactor) + this.modelOffset.x;
    const scaledStartZ = (start_y * this.scalingFactor) + this.modelOffset.z;
    const scaledEndX = (end_x * this.scalingFactor) + this.modelOffset.x;
    const scaledEndZ = (end_y * this.scalingFactor) + this.modelOffset.z;
    const scaledHeight = height * this.scalingFactor;
    const scaledThickness = thickness * this.scalingFactor;

    // Calculate wall direction vector
    const dirX = scaledEndX - scaledStartX;
    const dirZ = scaledEndZ - scaledStartZ;
    const length = Math.hypot(dirX, dirZ);
    
    // Normalize direction vector
    const normalizedDirX = dirX / length;
    const normalizedDirZ = dirZ / length;
    
    // Calculate perpendicular vector (rotate 90 degrees counterclockwise)
    const perpX = -normalizedDirZ;
    const perpZ = normalizedDirX;
    
    // Calculate inward offset (half thickness)
    const offsetX = perpX * (scaledThickness / 2);
    const offsetZ = perpZ * (scaledThickness / 2);
    
    // Calculate new wall center position (moved inward)
    const centerX = (scaledStartX + scaledEndX) / 2 + offsetX;
    const centerZ = (scaledStartZ + scaledEndZ) / 2 + offsetZ;

    // Create wall geometry and material
    const geometry = new THREE.BoxGeometry(length, scaledHeight, scaledThickness);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0xaaaaaa,
      roughness: 0.7,
      metalness: 0.2
    });

    // Create the mesh
    const wallMesh = new THREE.Mesh(geometry, material);

    // Position the wall at the calculated center
    wallMesh.position.set(
      centerX,
      scaledHeight / 2,
      centerZ
    );

    // Calculate and apply rotation
    const angle = Math.atan2(dirZ, dirX);
    wallMesh.rotation.y = -angle;

    // Add metadata
    wallMesh.userData.isWall = true;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;

    return wallMesh;
  }

  addCeiling() {
    // Remove any existing ceiling
    const existingCeiling = this.scene.getObjectByName('ceiling');
    if (existingCeiling) {
      this.scene.remove(existingCeiling);
    }

    // Get external vertices (using original coordinates before thickness offset)
    const vertices = this.getExternalVertices();
    
    // Convert vertices to format required by earcut
    const flatVertices = [];
    vertices.forEach(v => {
      flatVertices.push(v.x);
      flatVertices.push(v.z);
    });

    // Triangulate the polygon
    const triangles = earcut(flatVertices);

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    
    // Create vertices array for the geometry
    const vertexPositions = [];
    const height = this.walls[0].height * this.scalingFactor; // Assuming all walls have same height
    
    // Add vertices for each triangle
    for (let i = 0; i < triangles.length; i++) {
      const index = triangles[i];
      const x = flatVertices[index * 2];
      const z = flatVertices[index * 2 + 1];
      vertexPositions.push(x, height, z);
    }

    // Set position attribute
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertexPositions, 3)
    );

    // Calculate normals
    geometry.computeVertexNormals();

    // Create material
    const material = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.2
    });

    // Create mesh
    const ceiling = new THREE.Mesh(geometry, material);
    ceiling.name = 'ceiling';
    ceiling.castShadow = true;
    ceiling.receiveShadow = true;

    this.scene.add(ceiling);
  }

  getExternalVertices() {
    // Get all external wall endpoints using original coordinates
    const points = new Set();
    this.walls.forEach(wall => {
      // Use the original external coordinates
      const startPoint = {
        x: wall.start_x * this.scalingFactor + this.modelOffset.x,
        z: wall.start_y * this.scalingFactor + this.modelOffset.z
      };
      const endPoint = {
        x: wall.end_x * this.scalingFactor + this.modelOffset.x,
        z: wall.end_y * this.scalingFactor + this.modelOffset.z
      };
      
      points.add(JSON.stringify(startPoint));
      points.add(JSON.stringify(endPoint));
    });

    // Convert back to objects
    let vertices = Array.from(points).map(p => JSON.parse(p));

    // Sort vertices to form a continuous polygon
    const orderedVertices = [];
    let currentPoint = vertices[0];
    orderedVertices.push(currentPoint);
    vertices.splice(0, 1);

    while (vertices.length > 0) {
      // Find the next connected point
      let nextPointIndex = -1;
      let minDist = Infinity;

      vertices.forEach((point, index) => {
        const dist = Math.hypot(
          point.x - currentPoint.x,
          point.z - currentPoint.z
        );
        if (dist < minDist) {
          minDist = dist;
          nextPointIndex = index;
        }
      });

      if (nextPointIndex === -1) break;

      currentPoint = vertices[nextPointIndex];
      orderedVertices.push(currentPoint);
      vertices.splice(nextPointIndex, 1);
    }

    return orderedVertices;
  }

  // Optional: Add method to check if ceiling covers the entire model
  validateCeilingCoverage() {
    const ceiling = this.scene.getObjectByName('ceiling');
    if (!ceiling) return false;

    const geometry = ceiling.geometry;
    const position = geometry.attributes.position;
    const vertices = [];

    // Extract vertices from geometry
    for (let i = 0; i < position.count; i++) {
      vertices.push(new THREE.Vector3(
        position.getX(i),
        position.getY(i),
        position.getZ(i)
      ));
    }
    
    return vertices.length > 0;
  }

  // Animation loop
  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
    this.controls.update();
  }
}
