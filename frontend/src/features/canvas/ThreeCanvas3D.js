import * as THREE from "three";
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';
import gsap from 'gsap';
import earcut from 'earcut';
import { onMouseMoveHandler, onCanvasClickHandler, toggleDoorHandler } from './threeEventHandlers';
import { addGrid, adjustModelScale, addLighting, addControls, calculateModelOffset } from './sceneUtils';
import { createWallMesh, createDoorMesh } from './meshUtils';
import PanelCalculator from '../panel/PanelCalculator';

window.gsap = gsap;

export default class ThreeCanvas {
  constructor(containerId, walls, joints = [], doors = [], scalingFactor = 0.01, project = null) {
    this.container = document.getElementById(containerId);
    this.THREE = THREE;
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
    this.project = project;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.doorObjects = []; // Store references to door objects
    this.doorStates = new Map(); // Track door open/closed states
    
    // Panel division lines
    this.panelLines = []; // Store panel division line objects
    this.showPanelLines = false; // Toggle for panel lines visibility
    
    // Store HTML container for UI elements
    this.uiContainer = document.createElement('div');
    this.uiContainer.style.position = 'absolute';
    this.uiContainer.style.top = '0';
    this.uiContainer.style.left = '0';
    this.uiContainer.style.width = '100%';
    this.uiContainer.style.height = '100%';
    this.uiContainer.style.pointerEvents = 'none';
    this.container.appendChild(this.uiContainer);
    
    // Create a button container for better organization
    this.buttonContainer = document.createElement('div');
    this.buttonContainer.className = 'button-container';
    this.buttonContainer.style.position = 'absolute';
    this.buttonContainer.style.top = '20px';
    this.buttonContainer.style.right = '20px';
    this.buttonContainer.style.display = 'flex';
    this.buttonContainer.style.flexDirection = 'row';
    this.buttonContainer.style.gap = '12px';
    this.buttonContainer.style.alignItems = 'center';
    this.uiContainer.appendChild(this.buttonContainer);
    
    // Panel lines toggle button - now handled by React component
    // this.panelButton = document.createElement('button');
    // this.panelButton.textContent = 'Show Panel Lines';
    // this.panelButton.style.padding = '8px 16px';
    // this.panelButton.style.backgroundColor = '#2196F3';
    // this.panelButton.style.color = 'white';
    // this.panelButton.style.border = 'none';
    // this.panelButton.style.borderRadius = '6px';
    // this.panelButton.style.cursor = 'pointer';
    // this.panelButton.style.fontWeight = '500';
    // this.panelButton.style.fontSize = '14px';
    // this.panelButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    // this.panelButton.style.transition = 'all 0.2s ease';
    // this.panelButton.style.pointerEvents = 'auto';
    // this.panelButton.addEventListener('click', () => this.togglePanelLines());
    // this.buttonContainer.appendChild(this.panelButton);
    
    // Door button
    this.doorButton = document.createElement('button');
    this.doorButton.textContent = 'No Door Selected';
    this.doorButton.style.padding = '8px 16px';
    this.doorButton.style.backgroundColor = '#4CAF50';
    this.doorButton.style.color = 'white';
    this.doorButton.style.border = 'none';
    this.doorButton.style.borderRadius = '6px';
    this.doorButton.style.cursor = 'pointer';
    this.doorButton.style.fontWeight = '500';
    this.doorButton.style.fontSize = '14px';
    this.doorButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    this.doorButton.style.transition = 'all 0.2s ease';
    this.doorButton.style.pointerEvents = 'auto';
    this.doorButton.style.display = 'block'; // Always visible
    this.doorButton.style.opacity = '0.7'; // Semi-transparent when no door selected
    this.doorButton.disabled = true; // Disabled by default
    this.buttonContainer.appendChild(this.doorButton);
    
         // Test button for ceiling and floor functionality
     this.testCeilingButton = document.createElement('button');
     this.testCeilingButton.textContent = 'Test Ceilings & Floors';
    this.testCeilingButton.style.padding = '8px 16px';
    this.testCeilingButton.style.backgroundColor = '#FF9800';
    this.testCeilingButton.style.color = 'white';
    this.testCeilingButton.style.border = 'none';
    this.testCeilingButton.style.borderRadius = '6px';
    this.testCeilingButton.style.cursor = 'pointer';
    this.testCeilingButton.style.fontWeight = '500';
    this.testCeilingButton.style.fontSize = '14px';
    this.testCeilingButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    this.testCeilingButton.style.transition = 'all 0.2s ease';
    this.testCeilingButton.style.pointerEvents = 'auto';
    this.testCeilingButton.addEventListener('click', () => this.testCeilingFunctionality());
    this.buttonContainer.appendChild(this.testCeilingButton);
    
    // Current door being interacted with
    this.activeDoor = null;
    
    // Bind mesh creation functions
    this.createWallMesh = createWallMesh;
    this.createDoorMesh = createDoorMesh;
    
    // Initialize
    this.init();
  }

  init() {
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);
    this.container.addEventListener('mousemove', (event) => onMouseMoveHandler(this, event));
    this.container.addEventListener('click', (event) => onCanvasClickHandler(this, event));
    this.doorButton.addEventListener('click', () => toggleDoorHandler(this));
    // Add double-click to animate door
    this.container.addEventListener('dblclick', (event) => {
      // Only animate if a door is selected (activeDoor)
      if (this.activeDoor) {
        toggleDoorHandler(this);
      }
    });
  
    // Adjust initial camera position for better view
    this.camera.position.set(200, 200, 200);
    this.camera.lookAt(0, 0, 0);
  
    addGrid(this);
    addLighting(this);
    adjustModelScale(this);
    addControls(this);
    calculateModelOffset(this);
    this.buildModel();

    // Add a red dot at the model center
    const modelCenter = this.calculateModelCenter();
    const dotGeometry = new THREE.SphereGeometry(100 * this.scalingFactor, 20, 20);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const dotMesh = new THREE.Mesh(dotGeometry, dotMaterial);
    dotMesh.position.set(modelCenter.x, 10 * this.scalingFactor, modelCenter.z);
    dotMesh.name = 'model_center_dot';
    this.scene.add(dotMesh);
  
    this.animate();
  }

  animateToInteriorView() {
    const bounds = this.getModelBounds();
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;

    // Handle multiple ceiling types: room-specific ceilings, level ceilings, and single ceiling
    const ceilingLevels = [];
    
    // Check for room-specific ceilings from the new enhanced system
    // Search for any object with "ceiling_room_" in the name
    this.scene.children.forEach(child => {
      if (child.name && child.name.startsWith('ceiling_room_')) {
        ceilingLevels.push(child);
      }
    });
    
    // Check for legacy ceiling level naming conventions
    for (let i = 0; i < 10; i++) { // Check for up to 10 ceiling levels
      const ceiling = this.scene.getObjectByName(`ceiling_level_${i}`);
      if (ceiling) {
        ceilingLevels.push(ceiling);
      }
    }
    
    // Check for single ceiling
    const singleCeiling = this.scene.getObjectByName('ceiling');
    if (singleCeiling) {
      ceilingLevels.push(singleCeiling);
    }
    
    // Also search for any objects with "ceiling" in the name or userData
    this.scene.children.forEach(child => {
      if (child.name && child.name.toLowerCase().includes('ceiling') && !ceilingLevels.includes(child)) {
        ceilingLevels.push(child);
        console.log(`🔍 Found ceiling by name search: ${child.name}`);
      }
      if (child.userData && child.userData.isCeiling && !ceilingLevels.includes(child)) {
        ceilingLevels.push(child);
        console.log(`🔍 Found ceiling by userData: ${child.name}`);
      }
    });

    // Handle floors: room-specific floors and fallback floor
    const floorLevels = [];
    
    // Check for room-specific floors from the new enhanced system
    this.scene.children.forEach(child => {
      if (child.name && child.name.startsWith('floor_room_')) {
        floorLevels.push(child);
      }
    });
    
    // Check for fallback floor
    const fallbackFloor = this.scene.getObjectByName('floor');
    if (fallbackFloor) {
      floorLevels.push(fallbackFloor);
    }
    
    // Also search for any objects with "floor" in the name or userData
    this.scene.children.forEach(child => {
      if (child.name && child.name.toLowerCase().includes('floor') && !floorLevels.includes(child)) {
        floorLevels.push(child);
        console.log(`🔍 Found floor by name search: ${child.name}`);
      }
      if (child.userData && child.userData.isFloor && !floorLevels.includes(child)) {
        floorLevels.push(child);
        console.log(`🔍 Found floor by userData: ${child.name}`);
      }
    });

    console.log(`🏠 Interior view: Animating ${ceilingLevels.length} ceilings and ${floorLevels.length} floors out of view`);
    
    // Log what ceilings and floors we found
    if (ceilingLevels.length === 0) {
      console.log('🔍 No ceilings found! Check the console for more details.');
    } else {
      ceilingLevels.forEach(ceiling => {
        console.log(`🔍 Found ceiling: ${ceiling.name}, material:`, ceiling.material);
      });
    }
    
    if (floorLevels.length === 0) {
      console.log('🔍 No floors found! Check the console for more details.');
    } else {
      floorLevels.forEach(floor => {
        console.log(`🔍 Found floor: ${floor.name}, material:`, floor.material);
      });
    }

    // Animate all ceiling levels
    ceilingLevels.forEach(ceiling => {
      console.log(`🎬 Hiding ceiling ${ceiling.name}`);
      
      // Since ceilings are no longer transparent, just hide them directly
      ceiling.visible = false;
      console.log(`✅ Ceiling ${ceiling.name} hidden`);
    });
    
    // Animate all floor levels
    floorLevels.forEach(floor => {
      console.log(`🎬 Hiding floor ${floor.name}`);
      
      // Since floors are no longer transparent, just hide them directly
      floor.visible = false;
      console.log(`✅ Floor ${floor.name} hidden`);
    });

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

    // Handle multiple ceiling types: room-specific ceilings, level ceilings, and single ceiling
    const ceilingLevels = [];
    
    // Check for room-specific ceilings from the new enhanced system
    // Search for any object with "ceiling_room_" in the name
    this.scene.children.forEach(child => {
      if (child.name && child.name.startsWith('ceiling_room_')) {
        ceilingLevels.push(child);
      }
    });
    
    // Check for legacy ceiling level naming conventions
    for (let i = 0; i < 10; i++) { // Check for up to 10 ceiling levels
      const ceiling = this.scene.getObjectByName(`ceiling_level_${i}`);
      if (ceiling) {
        ceilingLevels.push(ceiling);
      }
    }
    
    // Check for single ceiling
    const singleCeiling = this.scene.getObjectByName('ceiling');
    if (singleCeiling) {
      ceilingLevels.push(singleCeiling);
    }
    
    // Also search for any objects with "ceiling" in the name or userData
    this.scene.children.forEach(child => {
      if (child.name && child.name.toLowerCase().includes('ceiling') && !ceilingLevels.includes(child)) {
        ceilingLevels.push(child);
        console.log(`🔍 Found ceiling by name search: ${child.name}`);
      }
      if (child.userData && child.userData.isCeiling && !ceilingLevels.includes(child)) {
        ceilingLevels.push(child);
        console.log(`🔍 Found ceiling by userData: ${child.name}`);
      }
    });

    // Handle floors: room-specific floors and fallback floor
    const floorLevels = [];
    
    // Check for room-specific floors from the new enhanced system
    this.scene.children.forEach(child => {
      if (child.name && child.name.startsWith('floor_room_')) {
        floorLevels.push(child);
      }
    });
    
    // Check for fallback floor
    const fallbackFloor = this.scene.getObjectByName('floor');
    if (fallbackFloor) {
      floorLevels.push(fallbackFloor);
    }
    
    // Also search for any objects with "floor" in the name or userData
    this.scene.children.forEach(child => {
      if (child.name && child.name.toLowerCase().includes('floor') && !floorLevels.includes(child)) {
        floorLevels.push(child);
        console.log(`🔍 Found floor by name search: ${child.name}`);
      }
      if (child.userData && child.userData.isFloor && !floorLevels.includes(child)) {
        floorLevels.push(child);
        console.log(`🔍 Found floor by userData: ${child.name}`);
      }
    });

    console.log(`🏠 Exterior view: Animating ${ceilingLevels.length} ceilings and ${floorLevels.length} floors into view`);

    // Animate all ceiling levels
    ceilingLevels.forEach(ceiling => {
      console.log(`🎬 Showing ceiling ${ceiling.name}`);
      
      // Since ceilings are no longer transparent, just show them directly
      ceiling.visible = true;
      console.log(`✅ Ceiling ${ceiling.name} shown`);
    });
    
    // Animate all floor levels
    floorLevels.forEach(floor => {
      console.log(`🎬 Showing floor ${floor.name}`);
      
      // Since floors are no longer transparent, just show them directly
      floor.visible = true;
      console.log(`✅ Floor ${floor.name} shown`);
    });

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

  calculateModelCenter() {
    if (this.project && this.project.width && this.project.length) {
      // Match 2D logic: center is at (width/2, length/2)
      return { x: this.project.width / 2 * this.scalingFactor, z: this.project.length / 2 * this.scalingFactor };
    } else {
      let sumX = 0, sumZ = 0, count = 0;
      const scale = this.scalingFactor;
      const offsetX = this.modelOffset.x;
      const offsetZ = this.modelOffset.z;
      this.walls.forEach(wall => {
        sumX += wall.start_x * scale + offsetX;
        sumX += wall.end_x * scale + offsetX;
        sumZ += wall.start_y * scale + offsetZ;
        sumZ += wall.end_y * scale + offsetZ;
        count += 2;
      });
      return { x: sumX / count, z: sumZ / count };
    }
  }  

  createBeveledWallShape(length, height, thickness, hasStart45, hasEnd45) {
    const shape = new THREE.Shape();
    const bevel = thickness; // Since tan(45°) = 1
  
    if (hasStart45) {
      shape.moveTo(bevel, 0);                // Start from slant point
      shape.lineTo(0, bevel);                // 45° cut
      shape.lineTo(0, height);               // Left vertical
    } else {
      shape.moveTo(0, 0);
      shape.lineTo(0, height);
    }
  
    if (hasEnd45) {
      shape.lineTo(length - bevel, height);  // Right vertical stop early
      shape.lineTo(length, height - bevel);  // 45° cut
      shape.lineTo(length, 0);               // Down to base
    } else {
      shape.lineTo(length, height);
      shape.lineTo(length, 0);
    }
  
    shape.lineTo(hasStart45 ? bevel : 0, 0); // Close shape
    return shape;
  }

  // Animation loop
  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
    this.controls.update();
  }

  // Method to update data and rebuild model
  updateData(walls, joints, doors) {
    this.walls = walls;
    this.joints = joints;
    this.doors = doors;
    this.buildModel();
  }

  // Method to rebuild the model
  buildModel() {
    try {
      // Remove existing walls, doors, ceilings, floors, and panel lines from the scene
      this.scene.children = this.scene.children.filter(child => {
        return !child.userData?.isWall && !child.userData?.isDoor && !child.name?.startsWith('ceiling') && !child.name?.startsWith('floor') && !child.userData?.isPanelLine;
      });

      // Clear door objects array and panel lines
      this.doorObjects = [];
      this.panelLines = [];

      // Normalize door data: map linked_wall → wall
      this.doors.forEach(d => {
        if (d.linked_wall && !d.wall) d.wall = d.linked_wall;
      });

      // Create all walls
      this.walls.forEach(wall => {
        try {
          const wallMesh = this.createWallMesh(this, wall);
          this.scene.add(wallMesh);
        } catch (wallError) {
          console.error(`Error creating wall ${wall.id}:`, wallError);
        }
      });

      // Create all doors
      this.doors.forEach(door => {
        try {
          if (door.calculatedPosition) {
            const doorMesh = this.createDoorMesh(this, door, null);
            if (doorMesh) this.scene.add(doorMesh);
          }
        } catch (doorError) {
          console.error(`Error creating door ${door.id}:`, doorError);
        }
      });

      // Add ceiling after walls and doors are created
      this.addRoomSpecificCeilings();
      
      // Add floor after ceilings are created
      this.addRoomSpecificFloors();
      
      // Create panel division lines only if they're enabled
      if (this.showPanelLines) {
        this.createPanelDivisionLines();
      }
    } catch (error) {
      console.error('Error building model:', error);
    }
  }

  // Method to add ceiling (copied from sceneUtils)
  addCeiling() {
    try {
      // Remove existing ceiling
      const existingCeiling = this.scene.getObjectByName('ceiling');
      if (existingCeiling) {
        this.scene.remove(existingCeiling);
      }

      // Get the building footprint vertices
      const vertices = this.getBuildingFootprint();
      if (vertices.length < 3) {
        console.log('Not enough vertices for ceiling, skipping...');
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
        console.log('Failed to triangulate ceiling, skipping...');
        return;
      }
      
      // Create ceiling geometry with thickness extending downward
      // Use a reasonable default thickness for fallback ceiling
      const ceilingThickness = 150 * this.scalingFactor; // 150mm default thickness
      
      // Create the top surface (flat ceiling)
      const topGeometry = new this.THREE.BufferGeometry();
      const topPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        topPositions[i * 3] = x;
        topPositions[i * 3 + 1] = 0; // Top surface at Y=0
        topPositions[i * 3 + 2] = z;
      }
      topGeometry.setAttribute('position', new this.THREE.BufferAttribute(topPositions, 3));
      topGeometry.computeVertexNormals();
      
      // Create the bottom surface (thickness bottom)
      const bottomGeometry = new this.THREE.BufferGeometry();
      const bottomPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        bottomPositions[i * 3] = x;
        bottomPositions[i * 3 + 1] = -ceilingThickness; // Bottom surface at Y=-thickness
        bottomPositions[i * 3 + 2] = z;
      }
      bottomGeometry.setAttribute('position', new this.THREE.BufferAttribute(bottomPositions, 3));
      bottomGeometry.computeVertexNormals();
      
      // Create side walls to connect top and bottom surfaces
      const sideGeometry = new this.THREE.BufferGeometry();
      const sidePositions = [];
      
      // For each edge of the room, create two triangles to form a side wall
      for (let i = 0; i < vertices.length; i++) {
        const current = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        
        // Side wall quad (two triangles)
        // Triangle 1
        sidePositions.push(
          current.x, 0, current.z,                    // Top front
          next.x, 0, next.z,                          // Top back
          current.x, -ceilingThickness, current.z      // Bottom front
        );
        
        // Triangle 2
        sidePositions.push(
          next.x, 0, next.z,                          // Top back
          next.x, -ceilingThickness, next.z,           // Bottom back
          current.x, -ceilingThickness, current.z      // Bottom front
        );
      }
      
      sideGeometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(sidePositions), 3));
      sideGeometry.computeVertexNormals();
      
      // Merge all geometries into one
      const geometry = new this.THREE.BufferGeometry();
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
      
      geometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(mergedPositions), 3));
      geometry.computeVertexNormals();
      
      // Create material to match wall appearance
      const material = new this.THREE.MeshStandardMaterial({
        color: 0xFFFFFFF, // Same white color as walls
        side: this.THREE.DoubleSide,
        roughness: 0.5,   // Same roughness as walls
        metalness: 0.7,   // Same metalness as walls
        transparent: false // Not transparent like walls
      });
      
      // Create mesh
      const ceiling = new this.THREE.Mesh(geometry, material);
      ceiling.name = 'ceiling';
      
      // Position the ceiling at the top of the walls
      const maxWallHeight = Math.max(...this.walls.map(wall => wall.height));
      ceiling.position.y = maxWallHeight * this.scalingFactor;
      
      // Add edge lines to match wall appearance
      const edges = new this.THREE.EdgesGeometry(geometry);
      const edgeLines = new this.THREE.LineSegments(
        edges, 
        new this.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
      );
      ceiling.add(edgeLines);
      
      // Set shadow properties to match walls
      ceiling.castShadow = true;
      ceiling.receiveShadow = true;
      
      // Store thickness in userData
      ceiling.userData = {
        isCeiling: true,
        thickness: ceilingThickness
      };
      
      this.scene.add(ceiling);
    } catch (error) {
      console.error('Error creating ceiling:', error);
      // Don't crash the app if ceiling creation fails
    }
  }

  // Method to get building footprint (copied from sceneUtils)
  getBuildingFootprint() {
    // Build a map of all wall endpoints and their connections
    const pointMap = new Map();
    const toKey = (x, z) => `${x.toFixed(4)},${z.toFixed(4)}`;
    const fromKey = (pt) => toKey(pt.x, pt.z);
    
    this.walls.forEach(wall => {
      const start = {
        x: wall.start_x * this.scalingFactor + this.modelOffset.x,
        z: wall.start_y * this.scalingFactor + this.modelOffset.z
      };
      const end = {
        x: wall.end_x * this.scalingFactor + this.modelOffset.x,
        z: wall.end_y * this.scalingFactor + this.modelOffset.z
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

  // Enhanced method to add room-specific ceilings
  addRoomSpecificCeilings() {
    try {
      // Remove existing ceilings
      const existingCeilings = this.scene.children.filter(child => 
        child.name && child.name.startsWith('ceiling')
      );
      existingCeilings.forEach(ceiling => this.scene.remove(ceiling));

      // If we have room data, create room-specific ceilings
      if (this.project && this.project.rooms && this.project.rooms.length > 0) {
        this.createRoomSpecificCeilings();
      } else {
        // Fallback to building-wide ceiling for backward compatibility
        this.addCeiling();
      }
    } catch (error) {
      console.error('Error creating room-specific ceilings:', error);
      // Fallback to original method
      this.addCeiling();
    }
  }

  // Create room-specific ceilings at correct heights
  createRoomSpecificCeilings() {
    console.log('🏠 Creating room-specific ceilings for', this.project.rooms.length, 'rooms');
    
    // Get ceiling thickness from project settings or use default
    // Note: ceiling_thickness is stored in individual room ceiling plans, not at project level
    const defaultCeilingThickness = 150; // Default fallback
    
    // First, analyze wall heights and room relationships
    const wallHeightMap = new Map();
    const roomWallMap = new Map();
    
    // Build wall height mapping
    this.walls.forEach(wall => {
      wallHeightMap.set(wall.id, wall.height);
    });
    
    // Build room-wall relationship mapping
    this.project.rooms.forEach(room => {
      if (room.walls && room.walls.length > 0) {
        roomWallMap.set(room.id, room.walls);
      }
    });
    
    this.project.rooms.forEach((room, roomIndex) => {
      try {
        if (!room.room_points || room.room_points.length < 3) {
          console.log(`⚠️ Room ${room.id} has insufficient points, skipping ceiling`);
          return;
        }

        // Determine the correct ceiling height for this room
        let roomCeilingHeight = this.determineRoomCeilingHeight(room, wallHeightMap, roomWallMap);
        
        if (!roomCeilingHeight) {
          console.log(`⚠️ Could not determine ceiling height for room ${room.id}, skipping`);
          return;
        }

        console.log(`🏠 Room ${room.id} (${room.room_name || 'Unnamed'}) - Ceiling Height: ${roomCeilingHeight}mm`);
        
        // Log ceiling thickness information
        if (room.ceiling_plan?.ceiling_thickness) {
          console.log(`🏠 Room ${room.id} using ceiling thickness from plan: ${room.ceiling_plan.ceiling_thickness}mm`);
        } else {
          console.log(`🏠 Room ${room.id} using default ceiling thickness: ${defaultCeilingThickness}mm`);
        }

        // Convert room points to 3D coordinates
        const roomVertices = room.room_points.map(point => ({
          x: point.x * this.scalingFactor + this.modelOffset.x,
          z: point.y * this.scalingFactor + this.modelOffset.z
        }));

        // Get ceiling thickness from room's ceiling plan or use default
        const roomCeilingThickness = (room.ceiling_plan?.ceiling_thickness || defaultCeilingThickness) * this.scalingFactor;
        
        // Create ceiling geometry for this room
        const ceilingMesh = this.createRoomCeilingMesh(roomVertices, roomCeilingHeight, room, roomCeilingThickness);
        
        if (ceilingMesh) {
          // Position ceiling at the correct height
          ceilingMesh.position.y = roomCeilingHeight * this.scalingFactor;
          ceilingMesh.name = `ceiling_room_${room.id}`;
          ceilingMesh.userData = {
            isCeiling: true,
            roomId: room.id,
            roomName: room.room_name || `Room ${room.id}`,
            height: roomCeilingHeight,
            thickness: roomCeilingThickness
          };
          
          this.scene.add(ceilingMesh);
          console.log(`✅ Created ceiling for room ${room.id} at height ${roomCeilingHeight}mm`);
        }
      } catch (error) {
        console.error(`❌ Error creating ceiling for room ${room.id}:`, error);
      }
    });
  }

  // Determine the correct ceiling height for a room based on its walls
  determineRoomCeilingHeight(room, wallHeightMap, roomWallMap) {
    try {
      // If room has a specific height defined, use it
      if (room.height && room.height > 0) {
        return room.height;
      }
      
      // Get walls that belong to this room
      const roomWalls = roomWallMap.get(room.id);
      if (!roomWalls || roomWalls.length === 0) {
        // If no walls defined for room, try to find walls by proximity
        return this.findRoomHeightByProximity(room);
      }
      
      // Get heights of walls that belong to this room
      const roomWallHeights = roomWalls
        .map(wallId => wallHeightMap.get(wallId))
        .filter(height => height && height > 0);
      
      if (roomWallHeights.length === 0) {
        // Fallback to proximity-based height detection
        return this.findRoomHeightByProximity(room);
      }
      
      // For rooms with shared walls, use the LOWEST height to ensure proper coverage
      // This prevents the ceiling from extending beyond the lower room's walls
      const minWallHeight = Math.min(...roomWallHeights);
      
      console.log(`🏠 Room ${room.id} walls: ${roomWalls.join(', ')}`);
      console.log(`🏠 Room ${room.id} wall heights: ${roomWallHeights.join(', ')}mm`);
      console.log(`🏠 Room ${room.id} using minimum height: ${minWallHeight}mm`);
      
      return minWallHeight;
      
    } catch (error) {
      console.error(`❌ Error determining ceiling height for room ${room.id}:`, error);
      return null;
    }
  }

  // Find room height by analyzing nearby walls when room-wall mapping is not available
  findRoomHeightByProximity(room) {
    try {
      // Calculate room center
      const roomCenter = {
        x: room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length,
        y: room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length
      };
      
      // Find walls that are close to this room's center
      const nearbyWalls = this.walls.filter(wall => {
        const wallCenter = {
          x: (wall.start_x + wall.end_x) / 2,
          y: (wall.start_y + wall.end_y) / 2
        };
        
        const distance = Math.sqrt(
          Math.pow(wallCenter.x - roomCenter.x, 2) + 
          Math.pow(wallCenter.y - roomCenter.y, 2)
        );
        
        // Consider walls within 1000mm (1 meter) of room center
        return distance < 1000;
      });
      
      if (nearbyWalls.length > 0) {
        const heights = nearbyWalls.map(wall => wall.height).filter(h => h > 0);
        if (heights.length > 0) {
          const minHeight = Math.min(...heights);
          console.log(`🏠 Room ${room.id} using proximity-based height: ${minHeight}mm`);
          return minHeight;
        }
      }
      
      // Final fallback to default height
      console.log(`🏠 Room ${room.id} using default height: 3000mm`);
      return 3000; // 3 meters default
      
    } catch (error) {
      console.error(`❌ Error finding room height by proximity for room ${room.id}:`, error);
      return 3000; // 3 meters default
    }
  }

  // Create individual room ceiling mesh with thickness
  createRoomCeilingMesh(roomVertices, roomHeight, room, ceilingThickness) {
    try {
      // Convert vertices to format required by earcut
      const flatVertices = [];
      roomVertices.forEach(vertex => {
        flatVertices.push(vertex.x);
        flatVertices.push(vertex.z);
      });
      
      // Triangulate the room polygon
      const triangles = earcut(flatVertices);
      if (triangles.length === 0) {
        console.log(`⚠️ Failed to triangulate room ${room.id}, skipping`);
        return null;
      }
      
      // Use the passed ceiling thickness parameter
      
      // Create the top surface (flat ceiling)
      const topGeometry = new this.THREE.BufferGeometry();
      const topPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        topPositions[i * 3] = x;
        topPositions[i * 3 + 1] = 0; // Top surface at Y=0
        topPositions[i * 3 + 2] = z;
      }
      topGeometry.setAttribute('position', new this.THREE.BufferAttribute(topPositions, 3));
      topGeometry.computeVertexNormals();
      
      // Create the bottom surface (thickness bottom)
      const bottomGeometry = new this.THREE.BufferGeometry();
      const bottomPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        bottomPositions[i * 3] = x;
        bottomPositions[i * 3 + 1] = -ceilingThickness; // Bottom surface at Y=-thickness
        bottomPositions[i * 3 + 2] = z;
      }
      bottomGeometry.setAttribute('position', new this.THREE.BufferAttribute(bottomPositions, 3));
      bottomGeometry.computeVertexNormals();
      
      // Create side walls to connect top and bottom surfaces
      const sideGeometry = new this.THREE.BufferGeometry();
      const sidePositions = [];
      
      // For each edge of the room, create two triangles to form a side wall
      for (let i = 0; i < roomVertices.length; i++) {
        const current = roomVertices[i];
        const next = roomVertices[(i + 1) % roomVertices.length];
        
        // Side wall quad (two triangles)
        // Triangle 1
        sidePositions.push(
          current.x, 0, current.z,                    // Top front
          next.x, 0, next.z,                          // Top back
          current.x, -ceilingThickness, current.z      // Bottom front
        );
        
        // Triangle 2
        sidePositions.push(
          next.x, 0, next.z,                          // Top back
          next.x, -ceilingThickness, next.z,           // Bottom back
          current.x, -ceilingThickness, current.z      // Bottom front
        );
      }
      
      sideGeometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(sidePositions), 3));
      sideGeometry.computeVertexNormals();
      
      // Merge all geometries into one
      const geometry = new this.THREE.BufferGeometry();
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
      
      geometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(mergedPositions), 3));
      geometry.computeVertexNormals();
      
      // Create material to match wall appearance
      const material = new this.THREE.MeshStandardMaterial({
        color: 0xFFFFFFF, // Same white color as walls
        side: this.THREE.DoubleSide,
        roughness: 0.5,   // Same roughness as walls
        metalness: 0.7,   // Same metalness as walls
        transparent: false // Not transparent like walls
      });
      
      // Create mesh
      const ceiling = new this.THREE.Mesh(geometry, material);
      
      // Add edge lines to match wall appearance
      const edges = new this.THREE.EdgesGeometry(geometry);
      const edgeLines = new this.THREE.LineSegments(
        edges, 
        new this.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
      );
      ceiling.add(edgeLines);
      
      // Set shadow properties to match walls
      ceiling.castShadow = true;
      ceiling.receiveShadow = true;
      
      // Add room label on the ceiling
      this.addRoomLabelToCeiling(ceiling, room, roomVertices);
      
      return ceiling;
    } catch (error) {
      console.error(`❌ Error creating room ceiling mesh for room ${room.id}:`, error);
      return null;
    }
  }

  // Get unique color for each room ceiling (now using wall-like appearance)
  getRoomCeilingColor(roomId) {
    // All ceilings now use the same white color to match walls
    return 0xFFFFFFF;
  }

  // Add room label on the ceiling
  addRoomLabelToCeiling(ceiling, room, roomVertices) {
    try {
      // Calculate room center
      const centerX = roomVertices.reduce((sum, v) => sum + v.x, 0) / roomVertices.length;
      const centerZ = roomVertices.reduce((sum, v) => sum + v.z, 0) / roomVertices.length;
      
      // Create text geometry for room label
      const textGeometry = new TextGeometry(room.room_name || `Room ${room.id}`, {
        font: undefined, // Will use default font
        size: 50 * this.scalingFactor,
        height: 5 * this.scalingFactor,
        curveSegments: 12,
        bevelEnabled: false
      });
      
      // Center the text geometry
      textGeometry.computeBoundingBox();
      const textWidth = textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x;
      const textHeight = textGeometry.boundingBox.max.y - textGeometry.boundingBox.min.y;
      
      // Create text mesh
      const textMaterial = new this.THREE.MeshBasicMaterial({ 
        color: 0x000000, // Black text for better visibility on white ceiling
        transparent: true,
        opacity: 0.8
      });
      
      const textMesh = new this.THREE.Mesh(textGeometry, textMaterial);
      
      // Position text on ceiling
      textMesh.position.set(
        centerX - textWidth / 2,
        5 * this.scalingFactor, // Slightly above ceiling surface
        centerZ - textHeight / 2
      );
      
      // Rotate text to face up
      textMesh.rotation.x = -Math.PI / 2;
      
      // Add text to ceiling
      ceiling.add(textMesh);
      
      console.log(`🏷️ Added label "${room.room_name || `Room ${room.id}`}" to ceiling`);
    } catch (error) {
      console.warn(`⚠️ Could not add room label to ceiling:`, error);
      // Text geometry might not be available, skip label
    }
  }

  // Method to get wall joint types (copied from Canvas2D logic)
  getWallJointTypes(wall) {
    // Find all joints for this wall
    const wallJoints = this.joints.filter(joint => 
      joint.wall_1 === wall.id || joint.wall_2 === wall.id
    );
    
    let leftJointType = 'butt_in';
    let rightJointType = 'butt_in';
    
    // Determine wall orientation and which end is left/right
    const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
    const isLeftToRight = wall.end_x > wall.start_x;
    const isBottomToTop = wall.end_y > wall.start_y;
    
    // Track all joints for each end
    const leftEndJoints = [];
    const rightEndJoints = [];
    
    wallJoints.forEach(joint => {
      // Find the other wall in this joint
      const otherWallId = joint.wall_1 === wall.id ? joint.wall_2 : joint.wall_1;
      const otherWall = this.walls.find(w => w.id === otherWallId);
      
      if (otherWall) {
        // Calculate intersection point between the two walls
        const intersection = this.calculateWallIntersection(wall, otherWall);
        
        if (intersection) {
          // For horizontal walls
          if (isHorizontal) {
            if (isLeftToRight) {
              // Wall goes left to right
              if (Math.abs(intersection.x - wall.start_x) < 1) {
                leftEndJoints.push(joint.joining_method);
              } else if (Math.abs(intersection.x - wall.end_x) < 1) {
                rightEndJoints.push(joint.joining_method);
              }
            } else {
              // Wall goes right to left
              if (Math.abs(intersection.x - wall.start_x) < 1) {
                rightEndJoints.push(joint.joining_method);
              } else if (Math.abs(intersection.x - wall.end_x) < 1) {
                leftEndJoints.push(joint.joining_method);
              }
            }
          }
          // For vertical walls
          if (isBottomToTop) {
            // Wall goes bottom to top
            if (Math.abs(intersection.y - wall.start_y) < 1) {
              leftEndJoints.push(joint.joining_method);
            } else if (Math.abs(intersection.y - wall.end_y) < 1) {
              rightEndJoints.push(joint.joining_method);
            }
          } else {
            // Wall goes top to bottom
            if (Math.abs(intersection.y - wall.start_y) < 1) {
              rightEndJoints.push(joint.joining_method);
            } else if (Math.abs(intersection.y - wall.end_y) < 1) {
              leftEndJoints.push(joint.joining_method);
            }
          }
        }
      }
    });
    
    leftJointType = leftEndJoints.includes('45_cut') ? '45_cut' : 'butt_in';
    rightJointType = rightEndJoints.includes('45_cut') ? '45_cut' : 'butt_in';
    return { left: leftJointType, right: rightJointType };
  }

  // Helper method to calculate intersection between two walls
  calculateWallIntersection(wall1, wall2) {
    const x1 = wall1.start_x;
    const y1 = wall1.start_y;
    const x2 = wall1.end_x;
    const y2 = wall1.end_y;
    const x3 = wall2.start_x;
    const y3 = wall2.start_y;
    const x4 = wall2.end_x;
    const y4 = wall2.end_y;
    
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
        y: y1 + t * (y2 - y1)
      };
    }
    
    return null;
  }

  // Calculate panels for each wall
  calculateWallPanels() {
    const wallPanelsMap = {};
    const calculator = new PanelCalculator();
    
    this.walls.forEach(wall => {
      const jointTypes = this.getWallJointTypes(wall);
      const wallLength = Math.sqrt(
        Math.pow(wall.end_x - wall.start_x, 2) + 
        Math.pow(wall.end_y - wall.start_y, 2)
      );
      
      let panels = calculator.calculatePanels(
        wallLength,
        wall.thickness,
        jointTypes
      );
      
      // Check if wall should be flipped due to joint types
      let shouldFlipWall = false;
      const { start_x, start_y, end_x, end_y, id } = wall;
      const modelCenter = this.calculateModelCenter();
      const scale = this.scalingFactor;
      
      // Determine if the wall is horizontal, vertical, or diagonal
      const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
      const isVertical = Math.abs(start_x - end_x) < 1e-6;
      
      if (this.joints && Array.isArray(this.joints)) {
        for (const joint of this.joints) {
          if ((joint.wall_1 === id || joint.wall_2 === id) && joint.joining_method === '45_cut') {
            // Find the connecting wall
            const connectingWallId = joint.wall_1 === id ? joint.wall_2 : joint.wall_1;
            const connectingWall = this.walls.find(w => w.id === connectingWallId);
            
            if (connectingWall) {
              // Calculate wall midpoints
              const wallMidX = (start_x + end_x) / 2;
              const wallMidY = (start_y + end_y) / 2;
              const connectMidX = (connectingWall.start_x + connectingWall.end_x) / 2;
              const connectMidY = (connectingWall.start_y + connectingWall.end_y) / 2;
              
              // Calculate model center in database coordinates
              const modelCenterX = modelCenter.x / scale;
              const modelCenterY = modelCenter.z / scale;
              
              // Determine if connecting wall and model center are on the same side
              let sameSide = false;
              
              if (isHorizontal) {
                // For horizontal wall, compare Y positions
                const modelAboveWall = modelCenterY > wallMidY;
                const connectAboveWall = connectMidY > wallMidY;
                sameSide = modelAboveWall === connectAboveWall;
              } else if (isVertical) {
                // For vertical wall, compare X positions
                const modelRightOfWall = modelCenterX > wallMidX;
                const connectRightOfWall = connectMidX > wallMidX;
                sameSide = modelRightOfWall === connectRightOfWall;
              } else {
                // For diagonal walls, use dot product
                const dx = end_x - start_x;
                const dy = end_y - start_y;
                const wallLength = Math.sqrt(dx * dx + dy * dy);
                const wallNormalX = -dy / wallLength;
                const wallNormalY = dx / wallLength;
                const toModelX = modelCenterX - wallMidX;
                const toModelY = modelCenterY - wallMidY;
                const toConnectX = connectMidX - wallMidX;
                const toConnectY = connectMidY - wallMidY;
                
                const dotModel = wallNormalX * toModelX + wallNormalY * toModelY;
                const dotConnect = wallNormalX * toConnectX + wallNormalY * toConnectY;
                sameSide = (dotModel > 0) === (dotConnect > 0);
              }
              
              // If they're on opposite sides, we need to flip
              if (!sameSide) {
                shouldFlipWall = true;
                // Wall will be flipped in calculateWallPanels due to 45° cut joint
                break;
              }
            }
          }
        }
      }
      
      // Reorder: left side panel (if any), then full panels, then right side panel (if any)
      const leftSide = panels.find(p => p.type === 'side' && p.position === 'left');
      const rightSide = panels.find(p => p.type === 'side' && p.position === 'right');
      const fullPanels = panels.filter(p => p.type === 'full');
      const otherSides = panels.filter(p => p.type === 'side' && p.position !== 'left' && p.position !== 'right');
      
      let orderedPanels = [];
      
      // If wall is flipped, swap left and right side panel positions
      if (shouldFlipWall) {
        // Wall panels being flipped - swapping left/right positions
        // Swap left and right side panels
        if (rightSide) {
          const flippedRightSide = { ...rightSide, position: 'left' };
          console.log(`  Right side panel (${rightSide.width}mm) -> Left side panel`);
          orderedPanels.push(flippedRightSide);
        }
        if (otherSides.length > 0 && !rightSide) orderedPanels.push(otherSides[0]);
        orderedPanels = orderedPanels.concat(fullPanels);
        if (leftSide) {
          const flippedLeftSide = { ...leftSide, position: 'right' };
          console.log(`  Left side panel (${leftSide.width}mm) -> Right side panel`);
          orderedPanels.push(flippedLeftSide);
        }
        if (otherSides.length > 1 || (otherSides.length === 1 && rightSide)) orderedPanels.push(otherSides[otherSides.length - 1]);
      } else {
        // Normal ordering (not flipped)
        if (leftSide) orderedPanels.push(leftSide);
        if (otherSides.length > 0 && !leftSide) orderedPanels.push(otherSides[0]);
        orderedPanels = orderedPanels.concat(fullPanels);
        if (rightSide) orderedPanels.push(rightSide);
        if (otherSides.length > 1 || (otherSides.length === 1 && leftSide)) orderedPanels.push(otherSides[otherSides.length - 1]);
      }
      
      // If no side panels, just use the original order
      if (orderedPanels.length === 0) orderedPanels = panels;
      
      wallPanelsMap[wall.id] = orderedPanels;
    });
    
    return wallPanelsMap;
  }

  // Create panel division lines in 3D
  createPanelDivisionLines() {
    try {
      // Clear existing panel lines
      this.panelLines.forEach(line => {
        this.scene.remove(line);
      });
      this.panelLines = [];
      
      const wallPanelsMap = this.calculateWallPanels();
      
      let wallsWithPanels = 0;
      let totalPanelLines = 0;
      
      this.walls.forEach(wall => {
        const panels = wallPanelsMap[wall.id];
        if (!panels || panels.length <= 1) {
          return;
        }
        
        wallsWithPanels++;
        totalPanelLines += panels.length - 1; // Each panel division creates one line
        
        // Creating panel lines for wall
        
        // Debug: Log side panel positions
        const sidePanels = panels.filter(p => p.type === 'side');
        
        const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
        const scale = this.scalingFactor;
        const modelCenter = this.calculateModelCenter();
        
        // Calculate initial wall direction and length
        const dx = end_x - start_x;
        const dy = end_y - start_y;
        const wallLength = Math.sqrt(dx * dx + dy * dy);
        
        if (wallLength === 0) {
          // Wall has zero length, skipping panel lines
          return;
        }
        
        // Determine if the wall is horizontal, vertical, or diagonal
        const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
        const isVertical = Math.abs(start_x - end_x) < 1e-6;
        
        // Check if wall should be flipped due to joint types (same logic as in calculateWallPanels)
        let shouldFlipWall = false;
        if (this.joints && Array.isArray(this.joints)) {
          for (const joint of this.joints) {
            if ((joint.wall_1 === id || joint.wall_2 === id) && joint.joining_method === '45_cut') {
              // Find the connecting wall
              const connectingWallId = joint.wall_1 === id ? joint.wall_2 : joint.wall_1;
              const connectingWall = this.walls.find(w => w.id === connectingWallId);
              
              if (connectingWall) {
                // Calculate wall midpoints
                const wallMidX = (start_x + end_x) / 2;
                const wallMidY = (start_y + end_y) / 2;
                const connectMidX = (connectingWall.start_x + connectingWall.end_x) / 2;
                const connectMidY = (connectingWall.start_y + connectingWall.end_y) / 2;
                
                // Calculate model center in database coordinates
                const modelCenterX = modelCenter.x / scale;
                const modelCenterY = modelCenter.z / scale;
                
                // Determine if connecting wall and model center are on the same side
                let sameSide = false;
                
                if (isHorizontal) {
                  // For horizontal wall, compare Y positions
                  const modelAboveWall = modelCenterY > wallMidY;
                  const connectAboveWall = connectMidY > wallMidY;
                  sameSide = modelAboveWall === connectAboveWall;
                } else if (isVertical) {
                  // For vertical wall, compare X positions
                  const modelRightOfWall = modelCenterX > wallMidX;
                  const connectRightOfWall = connectMidX > wallMidX;
                  sameSide = modelRightOfWall === connectRightOfWall;
                } else {
                  // For diagonal walls, use dot product
                  const wallNormalX = -dy / wallLength;
                  const wallNormalY = dx / wallLength;
                  const toModelX = modelCenterX - wallMidX;
                  const toModelY = modelCenterY - wallMidY;
                  const toConnectX = connectMidX - wallMidX;
                  const toConnectY = connectMidY - wallMidY;
                  
                  const dotModel = wallNormalX * toModelX + wallNormalY * toModelY;
                  const dotConnect = wallNormalX * toConnectX + wallNormalY * toConnectY;
                  sameSide = (dotModel > 0) === (dotConnect > 0);
                }
                
                // If they're on opposite sides, we need to flip
                if (!sameSide) {
                  shouldFlipWall = true;
                  // Wall will be flipped due to 45° cut joint
                  break;
                }
              }
            }
          }
        }
        
        // Apply wall flipping if needed
        let finalStartX, finalStartY, finalEndX, finalEndY;
        if (shouldFlipWall) {
          // Flip the wall coordinates - match the logic from meshUtils.js
          if (isVertical) {
            // For vertical walls: flip start Y with end Y (which becomes start Z and end Z in 3D)
            finalStartX = start_x;
            finalStartY = end_y;
            finalEndX = end_x;
            finalEndY = start_y;
          } else if (isHorizontal) {
            // For horizontal walls: flip start X with end X
            finalStartX = end_x;
            finalStartY = start_y;
            finalEndX = start_x;
            finalEndY = end_y;
          } else {
            // For diagonal walls: flip both coordinates
            finalStartX = end_x;
            finalStartY = end_y;
            finalEndX = start_x;
            finalEndY = start_y;
          }
        } else {
          // Keep original coordinates
          finalStartX = start_x;
          finalStartY = start_y;
          finalEndX = end_x;
          finalEndY = end_y;
        }
        
        // Calculate final wall direction and length
        const finalDx = finalEndX - finalStartX;
        const finalDy = finalEndY - finalStartY;
        const finalWallLength = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
        
        // Calculate wall length in unscaled coordinates (mm) for panel and door calculations
        const finalWallLengthUnscaled = finalWallLength / scale;
        
        console.log(`Wall ${wall.id} - Scaled length: ${finalWallLength}, Unscaled length: ${finalWallLengthUnscaled}mm, Scale: ${scale}`);
        
        // Calculate wall normal (perpendicular to final wall direction)
        const wallDirX = finalDx / finalWallLength;
        const wallDirY = finalDy / finalWallLength;
        const normX = -wallDirY;
        const normZ = wallDirX;
        
        // Wall thickness in scaled units
        const wallThickness = thickness * scale;
        
        // Wall height in scaled units
        const wallHeight = height * scale;
        
        // Calculate the wall's midpoint using final coordinates
        const wallMidX = (finalStartX + finalEndX) / 2;
        const wallMidY = (finalStartY + finalEndY) / 2;
        
        // Calculate the direction to the model center
        const toCenterX = modelCenter.x / scale - wallMidX;
        const toCenterY = modelCenter.z / scale - wallMidY;
        
        // Determine final normal direction based on flipped wall orientation
        let finalNormX, finalNormZ;
        
        // Check if the final wall is horizontal, vertical, or diagonal
        const isFinalHorizontal = Math.abs(finalStartY - finalEndY) < 1e-6;
        const isFinalVertical = Math.abs(finalStartX - finalEndX) < 1e-6;
        
        if (shouldFlipWall) {
          // For walls flipped due to joint types, calculate normal based on connecting wall position
          let connectingWallMidX = 0, connectingWallMidY = 0;
          let foundConnectingWall = false;
          
          // Find the connecting wall that caused the flip
          for (const joint of this.joints) {
            if ((joint.wall_1 === wall.id || joint.wall_2 === wall.id) && joint.joining_method === '45_cut') {
              const connectingWallId = joint.wall_1 === wall.id ? joint.wall_2 : joint.wall_1;
              const connectingWall = this.walls.find(w => w.id === connectingWallId);
              
              if (connectingWall) {
                connectingWallMidX = (connectingWall.start_x + connectingWall.end_x) / 2;
                connectingWallMidY = (connectingWall.start_y + connectingWall.end_y) / 2;
                foundConnectingWall = true;
                break;
              }
            }
          }
          
          if (foundConnectingWall) {
            // Calculate direction to connecting wall
            const toConnectingX = connectingWallMidX - wallMidX;
            const toConnectingY = connectingWallMidY - wallMidY;
            
            // Wall flipped - Connecting wall position
            // Wall flipped - Direction to connecting wall
            
            if (isFinalHorizontal) {
              // Normal is along Y axis (up or down)
              if (toConnectingY < 0) {
                finalNormX = 0;
                finalNormZ = -1;
              } else {
                finalNormX = 0;
                finalNormZ = 1;
              }
            } else if (isFinalVertical) {
              // Normal is along X axis (left or right)
              if (toConnectingX < 0) {
                finalNormX = -1;
                finalNormZ = 0;
              } else {
                finalNormX = 1;
                finalNormZ = 0;
              }
            } else {
              // Diagonal wall: use dot product with final wall normal
              const dotProduct = normX * toConnectingX + normZ * toConnectingY;
              finalNormX = dotProduct < 0 ? -normX : normX;
              finalNormZ = dotProduct < 0 ? -normZ : normZ;
            }
            
            // Wall flipped - Final normal
          } else {
            // Fallback to model center logic if connecting wall not found
            if (isFinalHorizontal) {
              if (toCenterY < 0) {
                finalNormX = 0;
                finalNormZ = -1;
              } else {
                finalNormX = 0;
                finalNormZ = 1;
              }
            } else if (isFinalVertical) {
              if (toCenterX < 0) {
                finalNormX = -1;
                finalNormZ = 0;
              } else {
                finalNormX = 1;
                finalNormZ = 0;
              }
            } else {
              const dotProduct = normX * toCenterX + normZ * toCenterY;
              finalNormX = dotProduct < 0 ? -normX : normX;
              finalNormZ = dotProduct < 0 ? -normZ : normZ;
            }
          }
        } else {
          // For non-flipped walls, use model center logic
          if (isFinalHorizontal) {
            // Normal is along Y axis (up or down)
            if (toCenterY < 0) {
              finalNormX = 0;
              finalNormZ = -1;
            } else {
              finalNormX = 0;
              finalNormZ = 1;
            }
          } else if (isFinalVertical) {
            // Normal is along X axis (left or right)
            if (toCenterX < 0) {
              finalNormX = -1;
              finalNormZ = 0;
            } else {
              finalNormX = 1;
              finalNormZ = 0;
            }
          } else {
            // Diagonal wall: use dot product with final wall normal
            const dotProduct = normX * toCenterX + normZ * toCenterY;
            finalNormX = dotProduct < 0 ? -normX : normX;
            finalNormZ = dotProduct < 0 ? -normZ : normZ;
          }
        }
        
        // Get doors for this wall and calculate cutouts
        const wallDoors = this.doors.filter(door => 
          (door.linked_wall === wall.id || door.wall === wall.id || door.wall_id === wall.id)
        );
        
        // Calculate door cutouts (same logic as in meshUtils.js)
        const wasWallFlipped = (finalStartX !== start_x) || (finalStartY !== start_y);
        wallDoors.sort((a, b) => a.position_x - b.position_x);
        const cutouts = wallDoors.map(door => {
          const isSlideDoor = (door.door_type === 'slide');
          const doorWidth = door.width; // Use UNSCALED width (mm) since finalWallLength is already scaled
          const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : 1.05); // cutout width in mm
          const doorHeight = door.height * scale * 1.02; // Store height in cutout object like meshUtils.js
          
          // If wall was flipped, flip the door position
          const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
          const doorPos = adjustedPositionX * finalWallLength;
          
          const cutout = {
            start: Math.max(0, doorPos - cutoutWidth / 2),
            end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
            height: doorHeight, // Store height directly in cutout object
            doorInfo: door
          };
          
          console.log(`🚪 DOOR CUTOUT CREATION - Door ${door.id}:`, {
            doorType: door.door_type,
            originalPosition: door.position_x,
            adjustedPosition: adjustedPositionX,
            doorPos: doorPos,
            doorWidth: doorWidth,
            cutoutWidth: cutoutWidth,
            doorHeight: doorHeight,
            wallFlipped: wasWallFlipped,
            finalWallLength: finalWallLength,
            cutoutStart: cutout.start,
            cutoutEnd: cutout.end,
            cutoutRange: `${cutout.start}mm to ${cutout.end}mm`,
            cutoutWidth: cutout.end - cutout.start,
            scale: scale,
            originalDoorWidth: door.width
          });
          
          return cutout;
        });
        
        console.log(`📋 ALL CUTOUTS CREATED:`, cutouts.map(c => ({
          doorId: c.doorInfo.id,
          start: c.start,
          end: c.end,
          range: `${c.start}mm to ${c.end}mm`,
          height: c.height
        })));
        
        let accumulated = 0;
        
        // Wall panel division positions
        
        // Create division lines for each panel boundary
        // Note: The panels array from calculateWallPanels() already has the correct flipped positions
        // for side panels when shouldFlipWall is true, so we use them as-is
        console.log(`🔧 WALL ${wall.id} PANEL DIVISION PROCESSING:`);
        console.log(`  - Total panels: ${panels.length}`);
        console.log(`  - Wall length: ${finalWallLength}mm`);
        console.log(`  - Available cutouts:`, cutouts.map(c => `Door ${c.doorInfo.id}: ${c.start}-${c.end}mm`));
        
        for (let i = 0; i < panels.length - 1; i++) {
          accumulated += panels[i].width;
          const t = accumulated / finalWallLength; // Position along wall (0-1)
          const divisionPosition = accumulated; // Position in wall units (mm)
          
          console.log(`\n🔧 Panel division ${i + 1}:`);
          console.log(`  - Panel ${i} width: ${panels[i].width}mm`);
          console.log(`  - Accumulated: ${accumulated}mm`);
          console.log(`  - Division position: ${divisionPosition}mm (${(t*100).toFixed(1)}% of wall)`);
          console.log(`  - Will check against cutouts:`, cutouts.map(c => `${c.start}-${c.end}mm`));
          
          // Panel division created
          
          // Calculate division point along the wall using final coordinates
          // Use scaled coordinates for 3D positioning
          const divX = finalStartX + (finalEndX - finalStartX) * t;
          const divY = finalStartY + (finalEndY - finalStartY) * t;
          
          // Convert to 3D coordinates
          const divX3D = divX * scale + this.modelOffset.x;
          const divZ3D = divY * scale + this.modelOffset.z;
          
          // Position lines: one at database coordinate (0 position) and one offset by wall thickness
          const dbLinePoint = {
            x: divX3D,
            z: divZ3D
          };
          const offsetLinePoint = {
            x: divX3D + finalNormX * wallThickness,
            z: divZ3D + finalNormZ * wallThickness
          };
          
          console.log(`  - 3D coordinates: (${divX3D.toFixed(2)}, ${divZ3D.toFixed(2)})`);
          console.log(`  - Calling createLineSegmentsWithCutouts with position ${divisionPosition}mm`);
          
          // Create line segments that break at door cutouts
          this.createLineSegmentsWithCutouts(
            dbLinePoint, 
            offsetLinePoint, 
            wallHeight, 
            cutouts, 
            divisionPosition, 
            finalWallLength,
            finalStartX,
            finalStartY,
            finalEndX,
            finalEndY,
            scale
          );
        }
      });
      
      // Fallback: If no panels were calculated, create basic wall division lines
      if (wallsWithPanels === 0) {
        this.createFallbackPanelLines();
      }
      
      // Panel division lines created
    } catch (error) {
      console.error('Error creating panel division lines:', error);
    }
  }

  // Create fallback panel lines when no panels are calculated
  createFallbackPanelLines() {
    try {
      this.walls.forEach((wall, wallIndex) => {
        const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
        const scale = this.scalingFactor;
        
        // Calculate wall direction and length
        const dx = end_x - start_x;
        const dy = end_y - start_y;
        const wallLength = Math.sqrt(dx * dx + dy * dy);
        
        if (wallLength === 0) return;
        
        // Create a simple division line at the middle of each wall
        const midX = (start_x + end_x) / 2;
        const midY = (start_y + end_y) / 2;
        
        // Convert to 3D coordinates
        const divX3D = midX * scale + this.modelOffset.x;
        const divZ3D = midY * scale + this.modelOffset.z;
        
        // Create line from floor to ceiling
        const lineGeometry = new this.THREE.BufferGeometry();
        const vertices = new Float32Array([
          // Line at wall position
          divX3D, 0, divZ3D,
          divX3D, height * scale, divZ3D,
          // Line offset by wall thickness
          divX3D + (dy / wallLength) * thickness * scale, 0, divZ3D - (dx / wallLength) * thickness * scale,
          divX3D + (dy / wallLength) * thickness * scale, height * scale, divZ3D - (dx / wallLength) * thickness * scale
        ]);
        
        lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
        
        const lineMaterial = new this.THREE.LineBasicMaterial({ 
          color: 0x00ff00, 
          linewidth: 2,
          transparent: true,
          opacity: 0.8
        });
        
        const line = new this.THREE.LineSegments(lineGeometry, lineMaterial);
        line.userData = { isPanelLines: true, wallId: id };
        line.visible = this.showPanelLines;
        
        this.scene.add(line);
        this.panelLines.push(line);
      });
    } catch (error) {
      console.error('Error creating fallback panel lines:', error);
    }
  }

  // Method to toggle panel division lines visibility
  togglePanelLines() {
    this.showPanelLines = !this.showPanelLines;
    
    // Button text is now handled by React component
    
    if (this.showPanelLines && this.panelLines.length === 0) {
      // Create panel lines only when first enabled
      this.createPanelDivisionLines();
    } else {
      // Just toggle visibility of existing lines
      this.panelLines.forEach(line => {
        line.visible = this.showPanelLines;
      });
    }
  }

  // Method to create line segments with gaps at door cutouts
  createLineSegmentsWithCutouts(dbLinePoint, offsetLinePoint, wallHeight, cutouts, divisionPosition, finalWallLength, finalStartX, finalStartY, finalEndX, finalEndY, scale) {
    console.log(`🔍 LINE DETECTION START - Panel line at position ${divisionPosition}mm`);
    console.log(`📏 Wall length: ${finalWallLength}mm, Wall height: ${wallHeight}mm`);
    console.log(`📍 Line position: ${divisionPosition}mm (${(divisionPosition/finalWallLength*100).toFixed(1)}% of wall)`);
    
    // Check if this division line intersects with any door cutout
    // A door cutout is an area/range, so we check if the panel line falls within that area
    const intersectingCutouts = cutouts.filter(cutout => {
      const isWithinCutout = divisionPosition >= cutout.start && divisionPosition <= cutout.end;
      
      console.log(`🔍 Checking cutout for door ${cutout.doorInfo.id}:`, {
        cutoutStart: cutout.start,
        cutoutEnd: cutout.end,
        cutoutRange: `${cutout.start}mm to ${cutout.end}mm`,
        divisionPosition: divisionPosition,
        isWithinCutout: isWithinCutout,
        startCheck: `${divisionPosition} >= ${cutout.start} = ${divisionPosition >= cutout.start}`,
        endCheck: `${divisionPosition} <= ${cutout.end} = ${divisionPosition <= cutout.end}`
      });
      
      if (isWithinCutout) {
        console.log(`✅ Panel line at ${divisionPosition}mm is WITHIN door cutout ${cutout.start}-${cutout.end}mm`);
      } else {
        console.log(`❌ Panel line at ${divisionPosition}mm is OUTSIDE door cutout ${cutout.start}-${cutout.end}mm`);
      }
      
      return isWithinCutout;
    });
    
    // Debug logging
    console.log(`📊 INTERSECTION RESULTS:`);
    console.log(`  - Available cutouts:`, cutouts.map(c => `${c.doorInfo.id}: ${c.start}-${c.end}mm`));
    console.log(`  - Intersecting cutouts:`, intersectingCutouts.length);
    console.log(`  - Division position: ${divisionPosition}mm`);
    
    if (intersectingCutouts.length === 0) {
      console.log(`🚫 Creating full line - no door intersection detected`);
      this.createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight);
      return;
    }
    
    // Get door cutout information for this division line
    const cutout = intersectingCutouts[0]; // Should only be one cutout per division line
    
    // Validate cutout data
    if (!cutout || typeof cutout.height !== 'number' || cutout.height < 0) {
      console.error(`❌ Invalid cutout data:`, cutout);
      console.log(`🔄 Falling back to full line due to invalid cutout data`);
      this.createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight);
      return;
    }
    
    const doorHeight = cutout.height; // Use the height stored in the cutout object
    
    console.log(`✅ Creating partial line - door intersection confirmed`);
    console.log(`📏 Door height: ${doorHeight}mm, Wall height: ${wallHeight}mm`);
    console.log(`🔍 Height comparison: doorHeight ${doorHeight >= wallHeight ? '>=' : '<'} wallHeight`);
    console.log(`🚪 Selected cutout: Door ${cutout.doorInfo.id}, Range: ${cutout.start}-${cutout.end}mm`);
    
    // Create line only from door top to wall top
    this.createDoorTopToWallTopLines(dbLinePoint, offsetLinePoint, wallHeight, doorHeight);
  }
  
  // Method to create lines only from door top to wall top
  createDoorTopToWallTopLines(dbLinePoint, offsetLinePoint, wallHeight, doorHeight) {
    console.log(`🎯 Creating door top to wall top line:`);
    console.log(`  - Door height: ${doorHeight}mm`);
    console.log(`  - Wall height: ${wallHeight}mm`);
    
    // Only create line from door top to wall top (no line from floor to door bottom)
    if (doorHeight < wallHeight) {
      const lineGeometry = new this.THREE.BufferGeometry();
      const vertices = new Float32Array([
        // Line at database coordinate position (0 position) - from door top to wall top
        dbLinePoint.x, doorHeight, dbLinePoint.z,
        dbLinePoint.x, wallHeight, dbLinePoint.z,
        // Line offset by wall thickness - from door top to wall top
        offsetLinePoint.x, doorHeight, offsetLinePoint.z,
        offsetLinePoint.x, wallHeight, offsetLinePoint.z
      ]);
      
      lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
      
      const lineMaterial = new this.THREE.LineBasicMaterial({
        color: 0xFFFFFF,
        linewidth: 3,
        transparent: true,
        opacity: 0.6
      });
      
      const line = new this.THREE.Line(lineGeometry, lineMaterial);
      line.userData.isPanelLine = true;
      line.visible = this.showPanelLines;
      
      this.scene.add(line);
      this.panelLines.push(line);
      
      console.log(`✅ Created partial line from door top (${doorHeight}mm) to wall top (${wallHeight}mm)`);
    } else {
      // Handle case where door height >= wall height
      // In this case, the door covers the entire wall height, so no line should be visible
      console.log(`⚠️ Door height (${doorHeight}mm) >= wall height (${wallHeight}mm) - creating minimal line`);
      
      // Create a very short line at the very top to maintain visual consistency
      const lineGeometry = new this.THREE.BufferGeometry();
      const vertices = new Float32Array([
        // Line at database coordinate position (0 position) - very short at top
        dbLinePoint.x, wallHeight - 1, dbLinePoint.z,
        dbLinePoint.x, wallHeight, dbLinePoint.z,
        // Line offset by wall thickness - very short at top
        offsetLinePoint.x, wallHeight - 1, offsetLinePoint.z,
        offsetLinePoint.x, wallHeight, offsetLinePoint.z
      ]);
      
      lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
      
      const lineMaterial = new this.THREE.LineBasicMaterial({
        color: 0xFFFFFF,
        linewidth: 3,
        transparent: true,
        opacity: 0.6
      });
      
      const line = new this.THREE.Line(lineGeometry, lineMaterial);
      line.userData.isPanelLine = true;
      line.visible = this.showPanelLines;
      
      this.scene.add(line);
      this.panelLines.push(line);
      
      console.log(`✅ Created minimal line at wall top for door that covers entire wall height`);
    }
  }
  
  // Method to create continuous lines (no cutouts)
  createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight) {
    console.log(`🎯 Creating continuous line:`);
    console.log(`  - From floor (0mm) to ceiling (${wallHeight}mm)`);
    console.log(`  - Position: (${dbLinePoint.x.toFixed(2)}, ${dbLinePoint.z.toFixed(2)})`);
    
    // Create the division line geometry - two lines: one at DB position, one offset
    const lineGeometry = new this.THREE.BufferGeometry();
    const vertices = new Float32Array([
      // Line at database coordinate position (0 position)
      dbLinePoint.x, 0, dbLinePoint.z,
      dbLinePoint.x, wallHeight, dbLinePoint.z,
      // Line offset by wall thickness
      offsetLinePoint.x, 0, offsetLinePoint.z,
      offsetLinePoint.x, wallHeight, offsetLinePoint.z
    ]);
    
    lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
    
    // Create line material
    const lineMaterial = new this.THREE.LineBasicMaterial({
      color: 0xFFFFFF,
      linewidth: 3,
      transparent: true,
      opacity: 0.6
    });
    
    // Create the line mesh
    const divisionLine = new this.THREE.Line(lineGeometry, lineMaterial);
    divisionLine.userData.isPanelLine = true;
    divisionLine.visible = this.showPanelLines;
    
    // Add to scene and store reference
    this.scene.add(divisionLine);
    this.panelLines.push(divisionLine);
    
    console.log(`✅ Created continuous line from floor to ceiling. Total panel lines: ${this.panelLines.length}`);
  }
  


  // Method to set panel division lines visibility
  setPanelLinesVisibility(visible) {
    this.showPanelLines = visible;
    // Button text is now handled by React component
    
    if (visible && this.panelLines.length === 0) {
      this.createPanelDivisionLines();
    } else {
      this.panelLines.forEach(line => {
        line.visible = visible;
      });
    }
  }

  // Test method for ceiling and floor functionality
  testCeilingFunctionality() {
    console.log('🧪 Testing ceiling and floor functionality...');
    
    // Log all scene objects
    console.log('🔍 All scene objects:', this.scene.children.map(child => ({
      name: child.name,
      type: child.type,
      userData: child.userData,
      visible: child.visible
    })));
    
    // Find all ceilings
    const allCeilings = this.scene.children.filter(child => 
      child.name && child.name.toLowerCase().includes('ceiling')
    );
    
    // Find all floors
    const allFloors = this.scene.children.filter(child => 
      child.name && child.name.toLowerCase().includes('floor')
    );
    
    console.log('🔍 Found ceilings by name search:', allCeilings.map(c => c.name));
    console.log('🔍 Found floors by name search:', allFloors.map(f => f.name));
    
    // Test direct opacity change for ceilings
    allCeilings.forEach(ceiling => {
      if (ceiling.material) {
        console.log(`🧪 Testing direct opacity change for ceiling ${ceiling.name}`);
        console.log(`  - Current opacity: ${ceiling.material.opacity}`);
        console.log(`  - Material:`, ceiling.material);
        
        // Try to change opacity directly
        ceiling.material.opacity = 0.3;
        ceiling.material.transparent = true;
        
        // Force render update
        if (this.renderer) {
          this.renderer.render(this.scene, this.camera);
        }
        
        console.log(`  - New opacity: ${ceiling.material.opacity}`);
      }
    });
    
    // Test direct opacity change for floors
    allFloors.forEach(floor => {
      if (floor.material) {
        console.log(`🧪 Testing direct opacity change for floor ${floor.name}`);
        console.log(`  - Current opacity: ${floor.material.opacity}`);
        console.log(`  - Material:`, floor.material);
        
        // Try to change opacity directly
        floor.material.opacity = 0.3;
        floor.material.transparent = true;
        
        // Force render update
        if (this.renderer) {
          this.renderer.render(this.scene, this.camera);
        }
        
        console.log(`  - New opacity: ${floor.material.opacity}`);
      }
    });
    
    // Test GSAP for ceilings
    if (allCeilings.length > 0 && allCeilings[0].material) {
      console.log('🧪 Testing GSAP animation for ceilings...');
      try {
        gsap.to(allCeilings[0].material, {
          opacity: 0,
          duration: 2,
          ease: "power2.inOut",
          onUpdate: () => {
            console.log(`🔄 GSAP update - ceiling opacity: ${allCeilings[0].material.opacity}`);
            if (this.renderer) {
              this.renderer.render(this.scene, this.camera);
            }
          },
          onComplete: () => {
            console.log('✅ GSAP animation for ceilings completed');
          }
        });
      } catch (error) {
        console.error('❌ GSAP test for ceilings failed:', error);
      }
    }
    
    // Test GSAP for floors
    if (allFloors.length > 0 && allFloors[0].material) {
      console.log('🧪 Testing GSAP animation for floors...');
      try {
        gsap.to(allFloors[0].material, {
          opacity: 0,
          duration: 2,
          ease: "power2.inOut",
          onUpdate: () => {
            console.log(`🔄 GSAP update - floor opacity: ${allFloors[0].material.opacity}`);
            if (this.renderer) {
              this.renderer.render(this.scene, this.camera);
            }
          },
          onComplete: () => {
            console.log('✅ GSAP animation for floors completed');
          }
        });
      } catch (error) {
        console.error('❌ GSAP test for floors failed:', error);
      }
    }
  }

  // Enhanced method to add room-specific floors with thickness
  addRoomSpecificFloors() {
    try {
      // Remove existing floors
      const existingFloors = this.scene.children.filter(child => 
        child.name && child.name.startsWith('floor')
      );
      existingFloors.forEach(floor => this.scene.remove(floor));

      // If we have room data, create room-specific floors
      if (this.project && this.project.rooms && this.project.rooms.length > 0) {
        this.createRoomSpecificFloors();
      } else {
        // Fallback to building-wide floor for backward compatibility
        this.addFloor();
      }
    } catch (error) {
      console.error('Error creating room-specific floors:', error);
      // Fallback to original method
      this.addFloor();
    }
  }

  // Create room-specific floors at correct heights with thickness
  createRoomSpecificFloors() {
    console.log('🏠 Creating room-specific floors for', this.project.rooms.length, 'rooms');
    
    // Default floor thickness if not specified
    const defaultFloorThickness = 150; // 150mm default
    
    this.project.rooms.forEach((room, roomIndex) => {
      try {
        if (!room.room_points || room.room_points.length < 3) {
          console.log(`⚠️ Room ${room.id} has insufficient points, skipping floor`);
          return;
        }

        // Get floor thickness from room data or use default
        const roomFloorThickness = (room.floor_thickness || defaultFloorThickness) * this.scalingFactor;
        
        console.log(`🏠 Room ${room.id} (${room.room_name || 'Unnamed'}) - Floor Thickness: ${room.floor_thickness || defaultFloorThickness}mm`);
        
        // Convert room points to 3D coordinates
        const roomVertices = room.room_points.map(point => ({
          x: point.x * this.scalingFactor + this.modelOffset.x,
          z: point.y * this.scalingFactor + this.modelOffset.z
        }));

        // Create floor geometry for this room
        const floorMesh = this.createRoomFloorMesh(roomVertices, room, roomFloorThickness);
        
        if (floorMesh) {
          // Position floor at ground level (Y=0) - floor extends upward from here
          floorMesh.position.y = 0;
          floorMesh.name = `floor_room_${room.id}`;
          floorMesh.userData = {
            isFloor: true,
            roomId: room.id,
            roomName: room.room_name || `Room ${room.id}`,
            thickness: roomFloorThickness
          };
          
          this.scene.add(floorMesh);
          console.log(`✅ Created floor for room ${room.id} with thickness ${room.floor_thickness || defaultFloorThickness}mm (extends upward from Y=0 to Y=+${room.floor_thickness || defaultFloorThickness}mm)`);
        }
      } catch (error) {
        console.error(`❌ Error creating floor for room ${room.id}:`, error);
      }
    });
  }

  // Create individual room floor mesh with thickness
  createRoomFloorMesh(roomVertices, room, floorThickness) {
    try {
      // Convert vertices to format required by earcut
      const flatVertices = [];
      roomVertices.forEach(vertex => {
        flatVertices.push(vertex.x);
        flatVertices.push(vertex.z);
      });
      
      // Triangulate the room polygon
      const triangles = earcut(flatVertices);
      if (triangles.length === 0) {
        console.log(`⚠️ Failed to triangulate room ${room.id}, skipping`);
        return null;
      }
      
      // Create the top surface (floor surface - at the top of the floor thickness)
      const topGeometry = new this.THREE.BufferGeometry();
      const topPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        topPositions[i * 3] = x;
        topPositions[i * 3 + 1] = floorThickness; // Top surface at Y=+thickness
        topPositions[i * 3 + 2] = z;
      }
      topGeometry.setAttribute('position', new this.THREE.BufferAttribute(topPositions, 3));
      topGeometry.computeVertexNormals();
      
      // Create the bottom surface (ground level)
      const bottomGeometry = new this.THREE.BufferGeometry();
      const bottomPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        bottomPositions[i * 3] = x;
        bottomPositions[i * 3 + 1] = 0; // Bottom surface at Y=0 (ground level)
        bottomPositions[i * 3 + 2] = z;
      }
      bottomGeometry.setAttribute('position', new this.THREE.BufferAttribute(bottomPositions, 3));
      bottomGeometry.computeVertexNormals();
      
      // Create side walls to connect top and bottom surfaces
      const sideGeometry = new this.THREE.BufferGeometry();
      const sidePositions = [];
      
      // For each edge of the room, create two triangles to form a side wall
      for (let i = 0; i < roomVertices.length; i++) {
        const current = roomVertices[i];
        const next = roomVertices[(i + 1) % roomVertices.length];
        
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
      
      sideGeometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(sidePositions), 3));
      sideGeometry.computeVertexNormals();
      
      // Merge all geometries into one
      const geometry = new this.THREE.BufferGeometry();
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
      
      geometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(mergedPositions), 3));
      geometry.computeVertexNormals();
      
      // Create material to match wall appearance but with floor-specific color
      const material = new this.THREE.MeshStandardMaterial({
        color: 0xE5E7EB, // Light gray color for floors (different from walls)
        side: this.THREE.DoubleSide,
        roughness: 0.8,   // More rough than walls for floor texture
        metalness: 0.2,   // Less metallic than walls
        transparent: false
      });
      
      // Create mesh
      const floor = new this.THREE.Mesh(geometry, material);
      
      // Add edge lines to match wall appearance
      const edges = new this.THREE.EdgesGeometry(geometry);
      const edgeLines = new this.THREE.LineSegments(
        edges, 
        new this.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
      );
      floor.add(edgeLines);
      
      // Set shadow properties to match walls
      floor.castShadow = true;
      floor.receiveShadow = true;
      
      // Add room label on the floor
      this.addRoomLabelToFloor(floor, room, roomVertices, floorThickness);
      
      return floor;
    } catch (error) {
      console.error(`❌ Error creating room floor mesh for room ${room.id}:`, error);
      return null;
    }
  }

  // Add room label on the floor
  addRoomLabelToFloor(floor, room, roomVertices, floorThickness) {
    try {
      // Calculate room center
      const centerX = roomVertices.reduce((sum, v) => sum + v.x, 0) / roomVertices.length;
      const centerZ = roomVertices.reduce((sum, v) => sum + v.z, 0) / roomVertices.length;
      
      // Create text geometry for room label
      const textGeometry = new TextGeometry(room.room_name || `Room ${room.id}`, {
        font: undefined, // Will use default font
        size: 50 * this.scalingFactor,
        height: 5 * this.scalingFactor,
        curveSegments: 12,
        bevelEnabled: false
      });
      
      // Center the text geometry
      textGeometry.computeBoundingBox();
      const textWidth = textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x;
      const textHeight = textGeometry.boundingBox.max.y - textGeometry.boundingBox.min.y;
      
      // Create text mesh
      const textMaterial = new this.THREE.MeshBasicMaterial({ 
        color: 0x000000, // Black text for better visibility on light gray floor
        transparent: true,
        opacity: 0.8
      });
      
      const textMesh = new this.THREE.Mesh(textGeometry, textMaterial);
      
      // Position text on top of floor (at the top surface)
      textMesh.position.set(
        centerX - textWidth / 2,
        floorThickness + 5 * this.scalingFactor, // Slightly above floor top surface
        centerZ - textHeight / 2
      );
      
      // Rotate text to face up
      textMesh.rotation.x = -Math.PI / 2;
      
      // Add text to floor
      floor.add(textMesh);
      
      console.log(`🏷️ Added label "${room.room_name || `Room ${room.id}`}" to floor`);
    } catch (error) {
      console.warn(`⚠️ Could not add room label to floor:`, error);
      // Text geometry might not be available, skip label
    }
  }

  // Method to add floor (fallback method)
  addFloor() {
    try {
      // Remove existing floor
      const existingFloor = this.scene.getObjectByName('floor');
      if (existingFloor) {
        this.scene.remove(existingFloor);
      }

      // Get the building footprint vertices
      const vertices = this.getBuildingFootprint();
      if (vertices.length < 3) {
        console.log('Not enough vertices for floor, skipping...');
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
        console.log('Failed to triangulate floor, skipping...');
        return;
      }
      
      // Create floor geometry with thickness extending upward
      // Use a reasonable default thickness for fallback floor
      const floorThickness = 150 * this.scalingFactor; // 150mm default thickness
      
      // Create the top surface (floor top surface - at the top of the floor thickness)
      const topGeometry = new this.THREE.BufferGeometry();
      const topPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        topPositions[i * 3] = x;
        topPositions[i * 3 + 1] = floorThickness; // Top surface at Y=+thickness
        topPositions[i * 3 + 2] = z;
      }
      topGeometry.setAttribute('position', new this.THREE.BufferAttribute(topPositions, 3));
      topGeometry.computeVertexNormals();
      
      // Create the bottom surface (ground level)
      const bottomGeometry = new this.THREE.BufferGeometry();
      const bottomPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        bottomPositions[i * 3] = x;
        bottomPositions[i * 3 + 1] = 0; // Bottom surface at Y=0 (ground level)
        bottomPositions[i * 3 + 2] = z;
      }
      bottomGeometry.setAttribute('position', new this.THREE.BufferAttribute(bottomPositions, 3));
      bottomGeometry.computeVertexNormals();
      
      // Create side walls to connect top and bottom surfaces
      const sideGeometry = new this.THREE.BufferGeometry();
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
      
      sideGeometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(sidePositions), 3));
      sideGeometry.computeVertexNormals();
      
      // Merge all geometries into one
      const geometry = new this.THREE.BufferGeometry();
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
      
      geometry.setAttribute('position', new this.THREE.BufferAttribute(new Float32Array(mergedPositions), 3));
      geometry.computeVertexNormals();
      
      // Create material for floor
      const material = new this.THREE.MeshStandardMaterial({
        color: 0xE5E7EB, // Light gray color for floor
        side: this.THREE.DoubleSide,
        roughness: 0.8,   // More rough than walls for floor texture
        metalness: 0.2,   // Less metallic than walls
        transparent: false
      });
      
      // Create mesh
      const floor = new this.THREE.Mesh(geometry, material);
      floor.name = 'floor';
      
      // Position the floor at ground level
      floor.position.y = 0;
      
      // Add edge lines to match wall appearance
      const edges = new this.THREE.EdgesGeometry(geometry);
      const edgeLines = new this.THREE.LineSegments(
        edges, 
        new this.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
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
      
      this.scene.add(floor);
      console.log('✅ Created fallback floor with thickness extending upward from Y=0 to Y=+150mm');
    } catch (error) {
      console.error('Error creating floor:', error);
      // Don't crash the app if floor creation fails
    }
  }
}