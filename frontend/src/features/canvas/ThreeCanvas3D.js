import THREE, { TextGeometry } from './threeInstance';
import gsap from 'gsap';
import earcut from 'earcut';
import { onMouseMoveHandler, onCanvasClickHandler, toggleDoorHandler } from './threeEventHandlers';
import { addGrid, adjustModelScale, addLighting, addControls, calculateModelOffset } from './sceneUtils';
import { createWallMesh, createDoorMesh } from './meshUtils';
import PanelCalculator from '../panel/PanelCalculator';
import { THREE_CONFIG } from './threeConfig';
import WallRenderer from './components/WallRenderer';
import DoorRenderer from './components/DoorRenderer';
import AnimationManager from './managers/AnimationManager';

const isThreeDebugEnabled = process.env.REACT_APP_DEBUG_THREE === 'true';
const debugLog = (...args) => {
  if (isThreeDebugEnabled) {
    console.log(...args);
  }
};
const debugWarn = (...args) => {
  if (isThreeDebugEnabled) {
    console.warn(...args);
  }
};

window.gsap = gsap;

// Mobile-specific constants (matching Canvas2D)
const MAX_CANVAS_HEIGHT_RATIO = typeof window !== 'undefined' && window.innerWidth < 640 ? 0.85 : 0.7;
const MIN_CANVAS_WIDTH = 320; // Reduced from 480 for better mobile support
const MIN_CANVAS_HEIGHT = 240; // Reduced from 320 for better mobile support

export default class ThreeCanvas {
  constructor(containerId, walls, joints = [], doors = [], scalingFactor = 0.01, project = null) {
    this.container = document.getElementById(containerId);
    this.THREE = THREE;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      THREE_CONFIG.CAMERA.FOV,
      this.container.clientWidth / this.container.clientHeight,
      THREE_CONFIG.CAMERA.NEAR,
      THREE_CONFIG.CAMERA.FAR
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.walls = walls;
    this.joints = joints;
    this.doors = doors;
    this.scalingFactor = scalingFactor || THREE_CONFIG.SCALING_FACTOR;
    this.modelOffset = { x: 0, z: 0 };
    this.buildingHeight = 3;
    this.gridSize = THREE_CONFIG.GRID.SIZE;
    this.isInteriorView = false;
    this.project = project;
    
    // Resize handling references for cleanup
    this.resizeObserver = null;
    this.handleWindowResize = null;

    // Initialize renderer modules
    this.wallRenderer = new WallRenderer(this);
    this.doorRenderer = new DoorRenderer(this);
    this.animationManager = new AnimationManager(this);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.doorObjects = []; // Store references to door objects
    this.doorStates = new Map(); // Track door open/closed states
    
    // Panel division lines
    this.panelLines = []; // Store panel division line objects
    this.showPanelLines = false; // Toggle for panel lines visibility
    
    // Ceiling panel division lines
    this.ceilingPanelLines = []; // Store ceiling panel division line objects
    this.showCeilingPanelLines = false; // Toggle for ceiling panel lines visibility
    
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
    
    // Prevent default touch behaviors that might interfere with OrbitControls
    // This allows pinch-to-zoom to work properly
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.userSelect = 'none';
    
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
    
    // Prevent default touch behaviors on container for better touch control
    this.container.addEventListener('touchstart', (e) => {
      // Allow OrbitControls to handle touch events
      // Only prevent default if it's not a two-finger gesture
      if (e.touches.length === 1) {
        // Single touch - allow default for potential scrolling
        // But OrbitControls will still handle rotation
      } else if (e.touches.length === 2) {
        // Two-finger gesture (pinch) - prevent default to allow zoom
        e.preventDefault();
      }
    }, { passive: false });
    
    this.container.addEventListener('touchmove', (e) => {
      // Prevent default scrolling when using two fingers for zoom
      if (e.touches.length === 2) {
        e.preventDefault();
      }
    }, { passive: false });
  
    // Adjust initial camera position for better view
    this.camera.position.set(
      THREE_CONFIG.CAMERA.DEFAULT_POSITION.x,
      THREE_CONFIG.CAMERA.DEFAULT_POSITION.y,
      THREE_CONFIG.CAMERA.DEFAULT_POSITION.z
    );
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
  
    // Setup responsive resize handling
    this.setupResizeHandlers();
  
    this.animate();
  }

  // Handle window/container resize for mobile responsiveness
  handleResize() {
    if (!this.container) return;
    
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    
    // Update camera aspect ratio
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    
    // Update renderer size
    this.renderer.setSize(width, height);
    
    debugLog(`📱 Resize: ${width}x${height} (aspect: ${this.camera.aspect.toFixed(2)})`);
  }

  // Setup ResizeObserver and window resize listener
  setupResizeHandlers() {
    if (!this.container) return;

    // Create window resize handler
    this.handleWindowResize = () => {
      // Use requestAnimationFrame to throttle resize updates
      requestAnimationFrame(() => {
        this.handleResize();
      });
    };

    // Create orientation change handler (for mobile devices)
    this.handleOrientationChange = () => {
      // Delay slightly to allow browser to finish orientation change
      setTimeout(() => {
        requestAnimationFrame(() => {
          this.handleResize();
        });
      }, 100);
    };

    // Add window resize listener
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleWindowResize);
      window.addEventListener('orientationchange', this.handleOrientationChange);
      // Also listen for visual viewport changes (better for mobile)
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', this.handleWindowResize);
      }
    }

    // Setup ResizeObserver for container size changes
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.target === this.container) {
            // Use requestAnimationFrame to throttle resize updates
            requestAnimationFrame(() => {
              this.handleResize();
            });
          }
        });
      });

      this.resizeObserver.observe(this.container);
    } else {
      // Fallback: use window resize only if ResizeObserver is not available
      debugWarn('ResizeObserver not available, using window resize only');
    }
  }

  // Cleanup resize handlers
  dispose() {
    // Remove window resize listener
    if (this.handleWindowResize && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleWindowResize);
      this.handleWindowResize = null;
    }

    // Remove orientation change listener
    if (this.handleOrientationChange && typeof window !== 'undefined') {
      window.removeEventListener('orientationchange', this.handleOrientationChange);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.handleWindowResize);
      }
      this.handleOrientationChange = null;
    }

    // Disconnect ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Dispose of controls if they exist
    if (this.controls) {
      this.controls.dispose();
    }

    // Dispose of renderer
    if (this.renderer) {
      this.renderer.dispose();
      // Remove renderer DOM element if it exists
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }

    // Clean up UI container
    if (this.uiContainer && this.uiContainer.parentNode) {
      this.uiContainer.parentNode.removeChild(this.uiContainer);
    }
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
      }
      if (child.userData && child.userData.isCeiling && !ceilingLevels.includes(child)) {
        ceilingLevels.push(child);
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
      }
      if (child.userData && child.userData.isFloor && !floorLevels.includes(child)) {
        floorLevels.push(child);
      }
    });

    // Debug: Interior view animation
    // debugLog(`🏠 Interior view: Hiding ${ceilingLevels.length} ceilings, keeping ${floorLevels.length} floors visible`);

    // Hide only ceilings for interior view (keep floors visible)
    ceilingLevels.forEach(ceiling => {
      ceiling.visible = false;
    });
    
    // Keep all floors visible for interior view
    floorLevels.forEach(floor => {
      floor.visible = true;
    });

    // Hide only ceiling panel lines for interior view (keep wall panel lines visible)
    this.ceilingPanelLines.forEach(line => { line.visible = false; });

    // Animate camera position using AnimationManager
    const modelCenter = {
      x: centerX,
      y: 0,
      z: centerZ
    };
    this.animationManager.animateToInteriorView(modelCenter);

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
      }
      if (child.userData && child.userData.isCeiling && !ceilingLevels.includes(child)) {
        ceilingLevels.push(child);
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
      }
      if (child.userData && child.userData.isFloor && !floorLevels.includes(child)) {
        floorLevels.push(child);
      }
    });

    // Debug: Exterior view animation
    // debugLog(`🏠 Exterior view: Animating ${ceilingLevels.length} ceilings and ${floorLevels.length} floors into view`);

    // Animate all ceiling levels
    ceilingLevels.forEach(ceiling => {
      // Show ceilings for exterior view
      ceiling.visible = true;
    });
    
    // Animate all floor levels
    floorLevels.forEach(floor => {
      // Show floors for exterior view
      floor.visible = true;
    });

    // Restore ceiling panel lines visibility to their previous state for exterior view
    // Wall panel lines visibility remains unchanged (they were never hidden)
    const shouldShowCeilingPanelLines = this.showCeilingPanelLines;
    this.ceilingPanelLines.forEach(line => { line.visible = shouldShowCeilingPanelLines; });

    // Animate camera position using AnimationManager
    const modelCenter = { x: centerX, y: 0, z: centerZ };
    this.animationManager.animateToExteriorView(modelCenter);

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


  // Fallback wall mesh creation moved to WallRenderer module

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
      // Properly dispose of old geometries and materials before removing objects
      this.scene.traverse((object) => {
        if (object.userData?.isWall || object.userData?.isDoor || 
            object.name?.startsWith('ceiling') || object.name?.startsWith('floor') || 
            object.userData?.isPanelLine || object.userData?.isCeilingPanelLine) {
          
          // Dispose of geometry
          if (object.geometry) {
            object.geometry.dispose();
          }
          
          // Dispose of materials
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(material => {
                if (material.map) material.map.dispose();
                material.dispose();
              });
            } else {
              if (object.material.map) object.material.map.dispose();
              object.material.dispose();
            }
          }
          
          // Remove from scene
          this.scene.remove(object);
        }
      });

      // Clear door objects array and panel lines
      this.doorObjects = [];
      this.panelLines = [];
      this.ceilingPanelLines = [];

      // Clear GSAP animations to prevent memory leaks
      this.animationManager.killAllAnimations();

      // Normalize door data: map linked_wall → wall
      this.doors.forEach(d => {
        if (d.linked_wall && !d.wall) d.wall = d.linked_wall;
      });

      // Create all walls using WallRenderer
      this.wallRenderer.renderWalls(this.walls);

      // Create all doors using DoorRenderer
      this.doorRenderer.renderDoors(this.doors);

      // Add ceiling after walls and doors are created
      this.addRoomSpecificCeilings();
      
      // Add floor after ceilings are created
      this.addRoomSpecificFloors();
      
      // Create panel division lines only if they're enabled
      if (this.showPanelLines) {
        this.createPanelDivisionLines();
      }
      
      // Create ceiling panel division lines only if they're enabled
      if (this.showCeilingPanelLines) {
        this.createCeilingPanelDivisionLines();
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
          return;
        }

        // Determine the correct ceiling height for this room
        let roomCeilingHeight = this.determineRoomCeilingHeight(room, wallHeightMap, roomWallMap);
        
        if (!roomCeilingHeight) {
          return;
        }

        // Get base elevation (default to 0 if not set)
        const baseElevation = (room.base_elevation_mm ?? 0) * this.scalingFactor;

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
          // Position ceiling at base elevation + room height (absolute ceiling position)
          ceilingMesh.position.y = baseElevation + (roomCeilingHeight * this.scalingFactor);
          ceilingMesh.name = `ceiling_room_${room.id}`;
          ceilingMesh.userData = {
            isCeiling: true,
            roomId: room.id,
            roomName: room.room_name || `Room ${room.id}`,
            height: roomCeilingHeight,
            baseElevation: room.base_elevation_mm ?? 0,
            absoluteHeight: baseElevation + (roomCeilingHeight * this.scalingFactor),
            thickness: roomCeilingThickness
          };
          
          this.scene.add(ceilingMesh);
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
          return minHeight;
        }
      }
      
      // Final fallback to default height
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
      
      debugLog(`🏷️ Added label "${room.room_name || `Room ${room.id}`}" to ceiling`);
    } catch (error) {
      debugWarn(`⚠️ Could not add room label to ceiling:`, error);
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
    
    leftJointType = 'butt_in';
    rightJointType = 'butt_in';
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
      
      // Removed 45-degree joint logic - using simple butt-in joints only
      
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
          debugLog(`  Right side panel (${rightSide.width}mm) -> Left side panel`);
          orderedPanels.push(flippedRightSide);
        }
        if (otherSides.length > 0 && !rightSide) orderedPanels.push(otherSides[0]);
        orderedPanels = orderedPanels.concat(fullPanels);
        if (leftSide) {
          const flippedLeftSide = { ...leftSide, position: 'right' };
          debugLog(`  Left side panel (${leftSide.width}mm) -> Right side panel`);
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

  // Calculate ceiling panels for each room based on ceiling plan data
  calculateCeilingPanels() {
    const ceilingPanelsMap = {};
    
    if (!this.project || !this.project.rooms) {
      return ceilingPanelsMap;
    }

    this.project.rooms.forEach(room => {
      debugLog(`🏠 Checking room ${room.id} (${room.room_name}):`, {
        ceiling_plan: room.ceiling_plan,
        ceiling_panels_from_plan: room.ceiling_plan?.ceiling_panels,
        hasCeilingPanels: room.ceiling_plan?.ceiling_panels && room.ceiling_plan.ceiling_panels.length > 0
      });
      
      // Check for ceiling panels via ceiling_plan.ceiling_panels (correct path)
      if (room.ceiling_plan?.ceiling_panels && room.ceiling_plan.ceiling_panels.length > 0) {
        // Use the actual ceiling panel data from the database
        debugLog(`🏠 Room ${room.id}: Using actual ceiling panel data (${room.ceiling_plan.ceiling_panels.length} panels)`);
        const panels = room.ceiling_plan.ceiling_panels.map(panel => ({
          id: panel.panel_id,
          width: panel.width,
          length: panel.length,
          start_x: panel.start_x,
          start_y: panel.start_y,
          end_x: panel.end_x,
          end_y: panel.end_y,
          is_cut_panel: panel.is_cut_panel,
          material_type: panel.material_type,
          thickness: panel.thickness,
          cut_notes: panel.cut_notes
        }));
        
        ceilingPanelsMap[room.id] = {
          room: room,
          panels: panels,
          ceiling_plan: room.ceiling_plan
        };
        
        debugLog(`🏠 Room ${room.id} (${room.room_name}): Found ${panels.length} ceiling panels`);
      } else {
        // Fallback: Generate panels using PanelCalculator if no ceiling plan exists
        debugLog(`🏠 Room ${room.id} (${room.room_name}): No ceiling panel data, generating fallback panels`);
        const fallbackPanels = this.generateFallbackCeilingPanels(room);
        if (fallbackPanels.length > 0) {
          ceilingPanelsMap[room.id] = {
            room: room,
            panels: fallbackPanels,
            ceiling_plan: null
          };
        }
      }
    });
    
    return ceilingPanelsMap;
  }

  // Generate fallback ceiling panels when no ceiling plan data exists
  generateFallbackCeilingPanels(room) {
    if (!room.room_points || room.room_points.length < 3) {
      return [];
    }

    // Calculate room dimensions
    const roomBounds = this.calculateRoomBounds(room.room_points);
    const roomWidth = roomBounds.width;
    const roomLength = roomBounds.length;
    
    // Use PanelCalculator to generate panels for each dimension
    const calculator = new PanelCalculator();
    const maxPanelWidth = 1150; // mm
    
    const panels = [];
    
    // Calculate panels along the width (X-axis)
    const widthPanels = calculator.calculatePanels(roomWidth, 20, { left: 'butt_in', right: 'butt_in' });
    const lengthPanels = calculator.calculatePanels(roomLength, 20, { left: 'butt_in', right: 'butt_in' });
    
    // Create a grid of panels
    let accumulatedLength = 0;
    lengthPanels.forEach((lengthPanel, lengthIndex) => {
      let accumulatedWidth = 0;
      widthPanels.forEach((widthPanel, widthIndex) => {
        const panel = {
          id: `fallback_${room.id}_${lengthIndex}_${widthIndex}`,
          width: widthPanel.actualWidth || widthPanel.width,
          length: lengthPanel.actualWidth || lengthPanel.width,
          start_x: roomBounds.minX + accumulatedWidth,
          start_y: roomBounds.minY + accumulatedLength,
          end_x: roomBounds.minX + accumulatedWidth + (widthPanel.actualWidth || widthPanel.width),
          end_y: roomBounds.minY + accumulatedLength + (lengthPanel.actualWidth || lengthPanel.width),
          is_cut_panel: widthPanel.isSidePanel || lengthPanel.isSidePanel,
          material_type: 'standard',
          thickness: 20,
          cut_notes: widthPanel.isSidePanel || lengthPanel.isSidePanel ? 'Generated fallback panel' : null,
          isFallback: true
        };
        
        panels.push(panel);
        accumulatedWidth += widthPanel.actualWidth || widthPanel.width;
      });
      accumulatedLength += lengthPanel.actualWidth || lengthPanel.width;
    });
    
    debugLog(`🏠 Generated ${panels.length} fallback ceiling panels for room ${room.id}`);
    return panels;
  }

  // Calculate room bounds from room points
  calculateRoomBounds(roomPoints) {
    if (!roomPoints || roomPoints.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, length: 0 };
    }
    
    const xs = roomPoints.map(p => p.x);
    const ys = roomPoints.map(p => p.y);
    
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    return {
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      width: maxX - minX,
      length: maxY - minY
    };
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
        
        const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
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
        
        // Removed 45-degree joint logic - using simple butt-in joints only
        let shouldFlipWall = false;
        
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
        
        // Debug: Wall length calculation
        // debugLog(`Wall ${wall.id} - Scaled length: ${finalWallLength}, Unscaled length: ${finalWallLengthUnscaled}mm, Scale: ${scale}`);
        
        // Calculate wall normal (perpendicular to final wall direction)
        const wallDirX = finalDx / finalWallLength;
        const wallDirY = finalDy / finalWallLength;
        const normX = -wallDirY;
        const normZ = wallDirX;
        
        // Wall thickness in scaled units
        const wallThickness = thickness * scale;
        
        // Wall height in scaled units - adjust for gap-fill mode
        let wallHeight;
        let wallBaseY = 0; // Default: floor level
        if (fill_gap_mode && gap_fill_height !== null && gap_base_position !== null) {
          // Gap-fill mode: position at gap base, use gap height
          wallBaseY = gap_base_position * scale;
          wallHeight = gap_fill_height * scale;
        } else {
          // Normal mode: floor to ceiling
          // Find rooms that contain this wall and use the minimum base elevation
          if (this.project && this.project.rooms) {
            const roomsWithWall = this.project.rooms.filter(room => 
              room.walls && room.walls.some(wallId => String(wallId) === String(id))
            );
            
            if (roomsWithWall.length > 0) {
              const baseElevations = roomsWithWall
                .map(room => room.base_elevation_mm ?? 0)
                .filter(elev => !isNaN(elev));
              
              if (baseElevations.length > 0) {
                wallBaseY = Math.min(...baseElevations) * scale;
              }
            }
          }
          wallHeight = height * scale;
        }
        
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
        
        // Simplified wall normal calculation without 45-degree joints
        if (isFinalHorizontal) {
          // For horizontal walls: if model center is at < Y position, normal points down
          if (modelCenter.z / scale < finalStartY) {
            finalNormX = 0;
            finalNormZ = -1;
          } else {
            finalNormX = 0;
            finalNormZ = 1;
          }
        } else if (isFinalVertical) {
          // For vertical walls: if model center is at > X position, normal points right
          if (modelCenter.x / scale > finalStartX) {
            finalNormX = 1;
            finalNormZ = 0;
          } else {
            finalNormX = -1;
            finalNormZ = 0;
          }
        } else {
          // Diagonal wall: use original logic
          const normX = -finalDy / finalWallLength;
          const normZ = finalDx / finalWallLength;
          const wallMidX = (finalStartX + finalEndX) / 2;
          const wallMidY = (finalStartY + finalEndY) / 2;
          const toCenterX = (modelCenter.x / scale) - wallMidX;
          const toCenterY = (modelCenter.z / scale) - wallMidY;
          const dotProduct = normX * toCenterX + normZ * toCenterY;
          finalNormX = dotProduct < 0 ? -normX : normX;
          finalNormZ = dotProduct < 0 ? -normZ : normZ;
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
          
          
          return cutout;
        });
        
        
        let accumulated = 0;
        
        // Wall panel division positions
        
        // Create division lines for each panel boundary
        // Note: The panels array from calculateWallPanels() already has the correct flipped positions
        // for side panels when shouldFlipWall is true, so we use them as-is
        
        for (let i = 0; i < panels.length - 1; i++) {
          accumulated += panels[i].width;
          const t = accumulated / finalWallLength; // Position along wall (0-1)
          const divisionPosition = accumulated; // Position in wall units (mm)
          
          
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
          
          debugLog(`  - 3D coordinates: (${divX3D.toFixed(2)}, ${divZ3D.toFixed(2)})`);
          debugLog(`  - Calling createLineSegmentsWithCutouts with position ${divisionPosition}mm`);
          
          // Get the current panel and next panel to determine if this is a cut panel boundary
          const currentPanel = panels[i];
          const nextPanel = panels[i + 1];
          const isCutPanel = currentPanel.type === 'side' || nextPanel.type === 'side';
          
          debugLog(`🔨 Wall ${wall.id} panel line ${i + 1}:`, {
            currentPanel: { type: currentPanel.type, width: currentPanel.width },
            nextPanel: { type: nextPanel.type, width: nextPanel.width },
            isCutPanel: isCutPanel,
            lineColor: isCutPanel ? 'RED (cut)' : 'TEAL (full)'
          });
          
          // Create line segments that break at door cutouts
          this.createLineSegmentsWithCutouts(
            dbLinePoint, 
            offsetLinePoint, 
            wallHeight, 
            wallBaseY,
            cutouts, 
            divisionPosition, 
            finalWallLength,
            finalStartX,
            finalStartY,
            finalEndX,
            finalEndY,
            scale,
            isCutPanel,
            wall.id,
            currentPanel,
            nextPanel
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
        const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
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
        
        // Calculate wall height and base position for gap-fill mode
        let wallHeight;
        let wallBaseY = 0; // Default: floor level
        if (fill_gap_mode && gap_fill_height !== null && gap_base_position !== null) {
          // Gap-fill mode: position at gap base, use gap height
          wallBaseY = gap_base_position * scale;
          wallHeight = gap_fill_height * scale;
        } else {
          // Normal mode: find rooms that contain this wall and use minimum base elevation
          if (this.project && this.project.rooms) {
            const roomsWithWall = this.project.rooms.filter(room => 
              room.walls && room.walls.some(wallId => String(wallId) === String(id))
            );
            
            if (roomsWithWall.length > 0) {
              const baseElevations = roomsWithWall
                .map(room => room.base_elevation_mm ?? 0)
                .filter(elev => !isNaN(elev));
              
              if (baseElevations.length > 0) {
                wallBaseY = Math.min(...baseElevations) * scale;
              }
            }
          }
          wallHeight = height * scale;
        }
        
        // Create line from wall base to wall top
        const wallTopY = wallBaseY + wallHeight;
        const lineGeometry = new this.THREE.BufferGeometry();
        const vertices = new Float32Array([
          // Line at wall position
          divX3D, wallBaseY, divZ3D,
          divX3D, wallTopY, divZ3D,
          // Line offset by wall thickness
          divX3D + (dy / wallLength) * thickness * scale, wallBaseY, divZ3D - (dx / wallLength) * thickness * scale,
          divX3D + (dy / wallLength) * thickness * scale, wallTopY, divZ3D - (dx / wallLength) * thickness * scale
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

  // Method to toggle ceiling panel division lines visibility
  toggleCeilingPanelLines() {
    this.showCeilingPanelLines = !this.showCeilingPanelLines;
    debugLog('🏠 Toggling ceiling panel lines to:', this.showCeilingPanelLines);
    
    if (this.showCeilingPanelLines && this.ceilingPanelLines.length === 0) {
      // Create ceiling panel lines only when first enabled
      debugLog('🏠 Creating new ceiling panel lines...');
      this.createCeilingPanelDivisionLines();
    } else {
      // Just toggle visibility of existing ceiling panel lines
      debugLog('🏠 Toggling visibility of existing ceiling panel lines:', this.ceilingPanelLines.length);
      this.ceilingPanelLines.forEach(line => {
        line.visible = this.showCeilingPanelLines;
      });
    }
  }

  // Method to set ceiling panel division lines visibility
  setCeilingPanelLinesVisibility(visible) {
    this.showCeilingPanelLines = visible;
    
    // Only show ceiling panel lines if NOT in interior view
    if (!this.isInteriorView) {
      if (visible && this.ceilingPanelLines.length === 0) {
        this.createCeilingPanelDivisionLines();
      } else {
        this.ceilingPanelLines.forEach(line => {
          line.visible = visible;
        });
      }
    } else {
      // In interior view, keep ceiling panel lines hidden
      this.ceilingPanelLines.forEach(line => {
        line.visible = false;
      });
    }
  }

  // Method to toggle both wall and ceiling panel lines together
  toggleAllPanelLines() {
    const newState = !this.showPanelLines;
    this.showPanelLines = newState;
    this.showCeilingPanelLines = newState;
    
    debugLog('🏠 Toggling ALL panel lines to:', newState);
    debugLog('🏠 Wall panel lines count:', this.panelLines.length);
    debugLog('🏠 Ceiling panel lines count:', this.ceilingPanelLines.length);
    
    // Handle wall panel lines
    if (newState && this.panelLines.length === 0) {
      debugLog('🏠 Creating new wall panel lines...');
      this.createPanelDivisionLines();
    } else {
      debugLog('🏠 Toggling existing wall panel lines visibility...');
      this.panelLines.forEach(line => {
        line.visible = newState;
      });
    }
    
    // Handle ceiling panel lines
    // Only show ceiling panel lines if NOT in interior view
    if (!this.isInteriorView) {
      if (newState && this.ceilingPanelLines.length === 0) {
        debugLog('🏠 Creating new ceiling panel lines...');
        this.createCeilingPanelDivisionLines();
      } else {
        debugLog('🏠 Toggling existing ceiling panel lines visibility...');
        this.ceilingPanelLines.forEach(line => {
          line.visible = newState;
        });
      }
    } else {
      // In interior view, keep ceiling panel lines hidden
      debugLog('🏠 Interior view: Keeping ceiling panel lines hidden');
      this.ceilingPanelLines.forEach(line => {
        line.visible = false;
      });
    }
  }

  // Method to set both wall and ceiling panel lines visibility
  setAllPanelLinesVisibility(visible) {
    this.showPanelLines = visible;
    this.showCeilingPanelLines = visible;
    
    // Handle wall panel lines
    if (visible && this.panelLines.length === 0) {
      this.createPanelDivisionLines();
    } else {
      this.panelLines.forEach(line => {
        line.visible = visible;
      });
    }
    
    // Handle ceiling panel lines
    // Only show ceiling panel lines if NOT in interior view
    if (!this.isInteriorView) {
      if (visible && this.ceilingPanelLines.length === 0) {
        this.createCeilingPanelDivisionLines();
      } else {
        this.ceilingPanelLines.forEach(line => {
          line.visible = visible;
        });
      }
    } else {
      // In interior view, keep ceiling panel lines hidden
      this.ceilingPanelLines.forEach(line => {
        line.visible = false;
      });
    }
  }

  // Method to create line segments with gaps at door cutouts
  createLineSegmentsWithCutouts(dbLinePoint, offsetLinePoint, wallHeight, wallBaseY, cutouts, divisionPosition, finalWallLength, finalStartX, finalStartY, finalEndX, finalEndY, scale, isCutPanel = false, wallId = null, currentPanel = null, nextPanel = null) {
    
    // Check if this division line intersects with any door cutout
    // A door cutout is an area/range, so we check if the panel line falls within that area
    const intersectingCutouts = cutouts.filter(cutout => {
      const isWithinCutout = divisionPosition >= cutout.start && divisionPosition <= cutout.end;
      
      debugLog(`🔍 Checking cutout for door ${cutout.doorInfo.id}:`, {
        cutoutStart: cutout.start,
        cutoutEnd: cutout.end,
        cutoutRange: `${cutout.start}mm to ${cutout.end}mm`,
        divisionPosition: divisionPosition,
        isWithinCutout: isWithinCutout,
        startCheck: `${divisionPosition} >= ${cutout.start} = ${divisionPosition >= cutout.start}`,
        endCheck: `${divisionPosition} <= ${cutout.end} = ${divisionPosition <= cutout.end}`
      });
      
      if (isWithinCutout) {
        debugLog(`✅ Panel line at ${divisionPosition}mm is WITHIN door cutout ${cutout.start}-${cutout.end}mm`);
      } else {
        debugLog(`❌ Panel line at ${divisionPosition}mm is OUTSIDE door cutout ${cutout.start}-${cutout.end}mm`);
      }
      
      return isWithinCutout;
    });
    
    
    if (intersectingCutouts.length === 0) {
      this.createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight, wallBaseY, isCutPanel, wallId, currentPanel, nextPanel);
      return;
    }
    
    // Get door cutout information for this division line
    const cutout = intersectingCutouts[0]; // Should only be one cutout per division line
    
    // Validate cutout data
    if (!cutout || typeof cutout.height !== 'number' || cutout.height < 0) {
      console.error(`❌ Invalid cutout data:`, cutout);
      this.createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight, wallBaseY, isCutPanel, wallId, currentPanel, nextPanel);
      return;
    }
    
    const doorHeight = cutout.height; // Use the height stored in the cutout object
    
    
    // Create line only from door top to wall top
    this.createDoorTopToWallTopLines(dbLinePoint, offsetLinePoint, wallHeight, wallBaseY, doorHeight, isCutPanel, wallId, currentPanel, nextPanel);
  }
  
  // Method to create lines only from door top to wall top
  createDoorTopToWallTopLines(dbLinePoint, offsetLinePoint, wallHeight, wallBaseY, doorHeight, isCutPanel = false, wallId = null, currentPanel = null, nextPanel = null) {
    
    // Only create line from door top to wall top (no line from floor to door bottom)
    // doorHeight and wallHeight are relative to wallBaseY
    const doorTopY = wallBaseY + doorHeight;
    const wallTopY = wallBaseY + wallHeight;
    
    if (doorHeight < wallHeight) {
      const lineGeometry = new this.THREE.BufferGeometry();
      const vertices = new Float32Array([
        // Line at database coordinate position (0 position) - from door top to wall top
        dbLinePoint.x, doorTopY, dbLinePoint.z,
        dbLinePoint.x, wallTopY, dbLinePoint.z,
        // Line offset by wall thickness - from door top to wall top
        offsetLinePoint.x, doorTopY, offsetLinePoint.z,
        offsetLinePoint.x, wallTopY, offsetLinePoint.z
      ]);
      
      lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
      
      // Use different colors for cut panels vs full panels (same as ceiling panel lines)
      const lineColor = isCutPanel ? 0xFF6B6B : 0x4ECDC4; // Red for cut panels, teal for full panels
      
      const lineMaterial = new this.THREE.LineBasicMaterial({
        color: lineColor,
        linewidth: 3,
        transparent: true,
        opacity: 0.6
      });
      
      const line = new this.THREE.Line(lineGeometry, lineMaterial);
      line.userData.isPanelLine = true;
      line.visible = this.showPanelLines;
      
      this.scene.add(line);
      this.panelLines.push(line);
      
    } else {
      // Handle case where door height >= wall height
      // In this case, the door covers the entire wall height, so no line should be visible
      
      // Create a very short line at the very top to maintain visual consistency
      const lineGeometry = new this.THREE.BufferGeometry();
      const vertices = new Float32Array([
        // Line at database coordinate position (0 position) - very short at top
        dbLinePoint.x, wallTopY - 1, dbLinePoint.z,
        dbLinePoint.x, wallTopY, dbLinePoint.z,
        // Line offset by wall thickness - very short at top
        offsetLinePoint.x, wallTopY - 1, offsetLinePoint.z,
        offsetLinePoint.x, wallTopY, offsetLinePoint.z
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
      
    }
  }
  
  // Method to create continuous lines (no cutouts)
  createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight, wallBaseY, isCutPanel = false, wallId = null, currentPanel = null, nextPanel = null) {
    
    // Create the division line geometry - two lines: one at DB position, one offset
    const lineGeometry = new this.THREE.BufferGeometry();
    const vertices = new Float32Array([
      // Line at database coordinate position (0 position)
      dbLinePoint.x, wallBaseY, dbLinePoint.z,
      dbLinePoint.x, wallBaseY + wallHeight, dbLinePoint.z,
      // Line offset by wall thickness
      offsetLinePoint.x, wallBaseY, offsetLinePoint.z,
      offsetLinePoint.x, wallBaseY + wallHeight, offsetLinePoint.z
    ]);
    
    lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
    
    // Use different colors for cut panels vs full panels (same as ceiling panel lines)
    const lineColor = isCutPanel ? 0xFF6B6B : 0x4ECDC4; // Red for cut panels, teal for full panels
    
    // Create line material
    const lineMaterial = new this.THREE.LineBasicMaterial({
      color: lineColor,
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

  // Create ceiling panel division lines in 3D
  // This method creates visual lines on ceilings showing the actual panel layout
  // It uses the ceiling plan data from the database to show where panels are placed
  // Lines are colored differently for cut panels (red) vs full panels (teal)
  // Grid lines (gray) show the overall panel arrangement
  createCeilingPanelDivisionLines() {
    try {
      debugLog('🏠 Starting ceiling panel division lines creation...');
      
      // Clear existing ceiling panel lines
      this.ceilingPanelLines.forEach(line => {
        this.scene.remove(line);
      });
      this.ceilingPanelLines = [];
      
      const ceilingPanelsMap = this.calculateCeilingPanels();
      debugLog('🏠 Ceiling panels map:', ceilingPanelsMap);
      
      let roomsWithCeilingPanels = 0;
      let totalCeilingPanelLines = 0;
      
      Object.values(ceilingPanelsMap).forEach(({ room, panels }) => {
        if (!panels || panels.length <= 1) {
          return;
        }
        
        roomsWithCeilingPanels++;
        
        // Get ceiling height for this room
        const roomCeilingHeight = this.determineRoomCeilingHeight(room, new Map(), new Map());
        if (!roomCeilingHeight) {
          return;
        }
        
        debugLog(`🏠 Creating ceiling panel lines for room ${room.id} (${room.room_name || 'Unnamed'}) with ${panels.length} panels`);
        
        // Convert room points to 3D coordinates
        const roomVertices = room.room_points.map(point => ({
          x: point.x * this.scalingFactor + this.modelOffset.x,
          z: point.y * this.scalingFactor + this.modelOffset.z
        }));
        
        // Create ceiling panel lines
        this.createCeilingPanelLinesForRoom(room, panels, roomVertices, roomCeilingHeight);
        
        totalCeilingPanelLines += this.calculateCeilingPanelLineCount(panels);
      });
      
      debugLog(`🏠 Created ceiling panel lines for ${roomsWithCeilingPanels} rooms, ${totalCeilingPanelLines} total lines`);
      
    } catch (error) {
      console.error('Error creating ceiling panel division lines:', error);
    }
  }

  // Create ceiling panel lines for a specific room
  createCeilingPanelLinesForRoom(room, panels, roomVertices, roomCeilingHeight) {
    const scale = this.scalingFactor;
    const ceilingY = roomCeilingHeight * scale;
    
    // Create panel boundary lines
    this.createCeilingPanelBoundaryLines(room, panels, roomVertices, ceilingY);
    
    // Create panel grid lines (internal panel divisions)
    this.createCeilingPanelGridLines(room, panels, roomVertices, ceilingY);
  }

  // Create boundary lines around ceiling panels
  createCeilingPanelBoundaryLines(room, panels, roomVertices, ceilingY) {
    const scale = this.scalingFactor;
    
    debugLog(`🏠 Creating boundary lines for room ${room.id} with ${panels.length} panels`);
    
    // Create lines along panel boundaries
    panels.forEach((panel, panelIndex) => {
      debugLog(`🏠 Panel ${panelIndex + 1} (${panel.id}):`, {
        start: { x: panel.start_x, y: panel.start_y },
        end: { x: panel.end_x, y: panel.end_y },
        width: panel.width,
        length: panel.length,
        is_cut_panel: panel.is_cut_panel
      });
      
      // Convert panel coordinates to 3D
      const panelStartX = panel.start_x * scale + this.modelOffset.x;
      const panelStartZ = panel.start_y * scale + this.modelOffset.z;
      const panelEndX = panel.end_x * scale + this.modelOffset.x;
      const panelEndZ = panel.end_y * scale + this.modelOffset.z;
      
      // Create boundary lines for this panel (4 edges)
      // Top edge
      this.createCeilingPanelBoundaryLine(
        panelStartX, panelStartZ, panelEndX, panelStartZ, ceilingY,
        room.id, panel.id, panel.is_cut_panel
      );
      
      // Right edge
      this.createCeilingPanelBoundaryLine(
        panelEndX, panelStartZ, panelEndX, panelEndZ, ceilingY,
        room.id, panel.id, panel.is_cut_panel
      );
      
      // Bottom edge
      this.createCeilingPanelBoundaryLine(
        panelEndX, panelEndZ, panelStartX, panelEndZ, ceilingY,
        room.id, panel.id, panel.is_cut_panel
      );
      
      // Left edge
      this.createCeilingPanelBoundaryLine(
        panelStartX, panelEndZ, panelStartX, panelStartZ, ceilingY,
        room.id, panel.id, panel.is_cut_panel
      );
    });
  }

  // Create a single ceiling panel boundary line
  createCeilingPanelBoundaryLine(startX, startZ, endX, endZ, ceilingY, roomId, panelId, isCutPanel) {
    const scale = this.scalingFactor;
    
    debugLog(`🏠 Creating ceiling panel line:`, {
      start: { x: startX, z: startZ },
      end: { x: endX, z: endZ },
      ceilingY: ceilingY,
      roomId: roomId,
      panelId: panelId,
      isCutPanel: isCutPanel
    });
    
    // Create line geometry
    const lineGeometry = new this.THREE.BufferGeometry();
    const vertices = new Float32Array([
      // Line at ceiling surface
      startX, ceilingY, startZ,
      endX, ceilingY, endZ
    ]);
    
    lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
    
    // Create line material with different colors for cut vs full panels
    const lineMaterial = new this.THREE.LineBasicMaterial({
      color: isCutPanel ? 0xFF6B6B : 0x4ECDC4, // Red for cut panels, teal for full panels
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    });
    
    // Create line mesh
    const line = new this.THREE.Line(lineGeometry, lineMaterial);
    line.userData.isCeilingPanelLine = true;
    line.userData.roomId = roomId;
    line.userData.panelId = panelId;
    line.userData.isCutPanel = isCutPanel;
    line.visible = this.showCeilingPanelLines;
    
    // Add to scene and store reference
    this.scene.add(line);
    this.ceilingPanelLines.push(line);
    
    debugLog(`🏠 Added ceiling panel line to scene. Total ceiling panel lines: ${this.ceilingPanelLines.length}`);
  }

  // Create grid lines showing internal panel divisions
  createCeilingPanelGridLines(room, panels, roomVertices, ceilingY) {
    const scale = this.scalingFactor;
    
    // Group panels by their Y position to create horizontal grid lines
    const panelRows = new Map();
    const panelCols = new Map();
    
    panels.forEach(panel => {
      const rowKey = Math.round(panel.start_y);
      const colKey = Math.round(panel.start_x);
      
      if (!panelRows.has(rowKey)) {
        panelRows.set(rowKey, []);
      }
      if (!panelCols.has(colKey)) {
        panelCols.set(colKey, []);
      }
      
      panelRows.get(rowKey).push(panel);
      panelCols.get(colKey).push(panel);
    });
    
    // Create horizontal grid lines
    panelRows.forEach((rowPanels, rowKey) => {
      if (rowPanels.length > 1) {
        rowPanels.sort((a, b) => a.start_x - b.start_x);
        
        // Create line from first panel start to last panel end
        const firstPanel = rowPanels[0];
        const lastPanel = rowPanels[rowPanels.length - 1];
        
        const startX = firstPanel.start_x * scale + this.modelOffset.x;
        const startZ = firstPanel.start_y * scale + this.modelOffset.z;
        const endX = lastPanel.end_x * scale + this.modelOffset.x;
        const endZ = lastPanel.start_y * scale + this.modelOffset.z;
        
        this.createCeilingGridLine(startX, startZ, endX, endZ, ceilingY, room.id, 'horizontal');
      }
    });
    
    // Create vertical grid lines
    panelCols.forEach((colPanels, colKey) => {
      if (colPanels.length > 1) {
        colPanels.sort((a, b) => a.start_y - b.start_y);
        
        // Create line from first panel start to last panel end
        const firstPanel = colPanels[0];
        const lastPanel = colPanels[colPanels.length - 1];
        
        const startX = firstPanel.start_x * scale + this.modelOffset.x;
        const startZ = firstPanel.start_y * scale + this.modelOffset.z;
        const endX = firstPanel.start_x * scale + this.modelOffset.x;
        const endZ = lastPanel.end_y * scale + this.modelOffset.z;
        
        this.createCeilingGridLine(startX, startZ, endX, endZ, ceilingY, room.id, 'vertical');
      }
    });
  }

  // Create a single ceiling grid line
  createCeilingGridLine(startX, startZ, endX, endZ, ceilingY, roomId, direction) {
    const lineGeometry = new this.THREE.BufferGeometry();
    const vertices = new Float32Array([
      startX, ceilingY, startZ,
      endX, ceilingY, endZ
    ]);
    
    lineGeometry.setAttribute('position', new this.THREE.BufferAttribute(vertices, 3));
    
    // Create line material for grid lines
    const lineMaterial = new this.THREE.LineBasicMaterial({
      color: 0x95A5A6, // Gray color for grid lines
      linewidth: 1,
      transparent: true,
      opacity: 0.5
    });
    
    // Create line mesh
    const line = new this.THREE.Line(lineGeometry, lineMaterial);
    line.userData.isCeilingPanelLine = true;
    line.userData.roomId = roomId;
    line.userData.isGridLine = true;
    line.userData.direction = direction;
    line.visible = this.showCeilingPanelLines;
    
    // Add to scene and store reference
    this.scene.add(line);
    this.ceilingPanelLines.push(line);
  }

  // Calculate the number of ceiling panel lines that will be created
  calculateCeilingPanelLineCount(panels) {
    // Each panel has 4 boundary lines, but shared boundaries are counted once
    // This is a simplified calculation - actual count may vary based on panel arrangement
    return panels.length * 2; // Rough estimate: 2 lines per panel on average
  }

  // Method to create a simple 3D demonstration of 45-degree joints
  create45DegreeJointDemo() {
    try {
      debugLog('🔨 Creating 45-degree joint demonstration...');
      
      // Clear existing demo objects
      this.scene.traverse((object) => {
        if (object.userData?.isDemo45Joint) {
          this.scene.remove(object);
        }
      });
      
      // Create two walls for demonstration
      // Wall A: Vertical wall (from bottom to top)
      const wallA = {
        id: 'demo_wall_a',
        start_x: 0,
        start_y: 0,
        end_x: 0,
        end_y: 3000, // 3m tall vertical wall
        height: 2500, // 2.5m high
        thickness: 150,
        application_type: 'wall'
      };
      
      // Wall B: Horizontal wall (from left to right)
      const wallB = {
        id: 'demo_wall_b', 
        start_x: 0,
        start_y: 0,
        end_x: 3000, // 3m long horizontal wall
        end_y: 0,
        height: 2500, // 2.5m high
        thickness: 150,
        application_type: 'wall'
      };
      
      // Create intersection data for 45-degree joint
      const joint = {
        id: 'demo_joint',
        wall_1: 'demo_wall_a',
        wall_2: 'demo_wall_b',
        joining_method: '45_cut'
      };
      
      // Create the walls using the existing mesh creation logic
      const wallAMesh = this.createWallMeshWith45Cut(wallA, [joint]);
      const wallBMesh = this.createWallMeshWith45Cut(wallB, [joint]);
      
      if (wallAMesh) {
        wallAMesh.userData.isDemo45Joint = true;
        wallAMesh.userData.wallId = 'demo_wall_a';
        wallAMesh.material.color.setHex(0x4ECDC4); // Teal for Wall A
        this.scene.add(wallAMesh);
        debugLog('✅ Created demo Wall A (vertical)');
      }
      
      if (wallBMesh) {
        wallBMesh.userData.isDemo45Joint = true;
        wallBMesh.userData.wallId = 'demo_wall_b';
        wallBMesh.material.color.setHex(0xFF6B6B); // Red for Wall B
        this.scene.add(wallBMesh);
        debugLog('✅ Created demo Wall B (horizontal)');
      }
      
      debugLog('🎯 45-degree joint demonstration created!');
      debugLog('   - Wall A (Vertical): Teal color');
      debugLog('   - Wall B (Horizontal): Red color');
      debugLog('   - Joint: 45-degree mitered corner');
      
    } catch (error) {
      console.error('❌ Error creating 45-degree joint demo:', error);
    }
  }
  
  // Helper method to create wall mesh with 45-degree cuts
  createWallMeshWith45Cut(wall, joints) {
    try {
      const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
      const scale = this.scalingFactor;
      
      // Convert to 3D coordinates
      const startX = start_x * scale + this.modelOffset.x;
      const startZ = start_y * scale + this.modelOffset.z;
      const endX = end_x * scale + this.modelOffset.x;
      const endZ = end_y * scale + this.modelOffset.z;
      
      // Calculate wall direction and length
      const dx = endX - startX;
      const dz = endZ - startZ;
      const wallLength = Math.sqrt(dx * dx + dz * dz);
      
      if (wallLength === 0) return null;
      
      // Create basic wall geometry
      const wallGeometry = new this.THREE.BoxGeometry(wallLength, height * scale, thickness * scale);
      
      // Position the wall
      const wallMesh = new this.THREE.Mesh(wallGeometry, new this.THREE.MeshStandardMaterial());
      wallMesh.position.set(
        (startX + endX) / 2,
        (height * scale) / 2,
        (startZ + endZ) / 2
      );
      
      // Rotate wall to match direction
      const angle = Math.atan2(dz, dx);
      wallMesh.rotation.y = angle;
      
      // Apply 45-degree cuts if joint exists
      const has45Joint = joints.some(j => 
        (j.wall_1 === id || j.wall_2 === id) && j.joining_method === '45_cut'
      );
      
      if (has45Joint) {
        debugLog(`🔨 Applying 45-degree cut to wall ${id}`);
        // For demo purposes, we'll create a simplified 45-degree cut
        // In the full implementation, this would use CSG operations
        
        // Create a visual indicator of the 45-degree cut
        const cutGeometry = new this.THREE.ConeGeometry(thickness * scale * 0.3, thickness * scale * 0.8, 4);
        const cutMaterial = new this.THREE.MeshBasicMaterial({ 
          color: 0xFFFF00, // Yellow for cut indicator
          transparent: true,
          opacity: 0.7
        });
        
        const cutIndicator = new this.THREE.Mesh(cutGeometry, cutMaterial);
        cutIndicator.userData.isDemo45Joint = true;
        cutIndicator.userData.isCutIndicator = true;
        
        // Position cut indicator at the joint
        cutIndicator.position.set(endX, height * scale * 0.5, endZ);
        cutIndicator.rotation.y = angle + Math.PI / 4; // 45 degrees
        
        this.scene.add(cutIndicator);
        debugLog(`✅ Added 45-degree cut indicator for wall ${id}`);
      }
      
      return wallMesh;
      
    } catch (error) {
      console.error(`❌ Error creating wall mesh for ${wall.id}:`, error);
      return null;
    }
  }

  // Test method for ceiling panel lines functionality
  testCeilingPanelLinesFunctionality() {
    debugLog('🧪 Testing ceiling panel lines functionality...');
    
    // First, let's check what project data we have
    debugLog('🏠 Project data:', this.project);
    if (this.project && this.project.rooms) {
      debugLog('🏠 Rooms data:', this.project.rooms);
      this.project.rooms.forEach(room => {
        debugLog(`🏠 Room ${room.id} (${room.room_name}):`, {
          ceiling_plan: room.ceiling_plan,
          ceiling_panels_from_plan: room.ceiling_plan?.ceiling_panels,
          ceiling_panels_count: room.ceiling_plan?.ceiling_panels ? room.ceiling_plan.ceiling_panels.length : 0,
          room_points: room.room_points,
          room_points_count: room.room_points ? room.room_points.length : 0
        });
        
        // If we have ceiling panels, show some sample data
        if (room.ceiling_plan?.ceiling_panels && room.ceiling_plan.ceiling_panels.length > 0) {
          debugLog(`🏠 Sample ceiling panels for room ${room.id}:`, room.ceiling_plan.ceiling_panels.slice(0, 3));
        }
      });
    }
    
    // Test ceiling panel calculation
    const ceilingPanelsMap = this.calculateCeilingPanels();
    debugLog('🏠 Ceiling panels map:', ceilingPanelsMap);
    
    // Test individual methods
    Object.values(ceilingPanelsMap).forEach(({ room, panels }) => {
      debugLog(`🏠 Room ${room.id} (${room.room_name}): ${panels.length} panels`);
      panels.forEach((panel, index) => {
        debugLog(`  Panel ${index + 1}: ${panel.width}x${panel.length}mm at (${panel.start_x}, ${panel.start_y}) - (${panel.end_x}, ${panel.end_y})`);
        if (panel.is_cut_panel) {
          debugLog(`    ⚠️ Cut panel: ${panel.cut_notes || 'No notes'}`);
        }
      });
    });
    
    // Test toggle functionality
    debugLog('🔄 Testing ceiling panel lines toggle...');
    this.toggleCeilingPanelLines();
    debugLog('✅ Ceiling panel lines toggled ON');
    
    setTimeout(() => {
      this.toggleCeilingPanelLines();
      debugLog('✅ Ceiling panel lines toggled OFF');
    }, 2000);
    
    // Test combined toggle
    setTimeout(() => {
      debugLog('🔄 Testing combined panel lines toggle...');
      this.toggleAllPanelLines();
      debugLog('✅ All panel lines toggled ON');
    }, 4000);
    
    setTimeout(() => {
      this.toggleAllPanelLines();
      debugLog('✅ All panel lines toggled OFF');
    }, 6000);
  }

  // Test method for ceiling and floor functionality
  testCeilingFunctionality() {
    debugLog('🧪 Testing ceiling and floor functionality...');
    
    // Log all scene objects
    debugLog('🔍 All scene objects:', this.scene.children.map(child => ({
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
    
    
    // Test direct opacity change for ceilings
    allCeilings.forEach(ceiling => {
      if (ceiling.material) {
        
        // Try to change opacity directly
        ceiling.material.opacity = 0.3;
        ceiling.material.transparent = true;
        
        // Force render update
        if (this.renderer) {
          this.renderer.render(this.scene, this.camera);
        }
        
        debugLog(`  - New opacity: ${ceiling.material.opacity}`);
      }
    });
    
    // Test direct opacity change for floors
    allFloors.forEach(floor => {
      if (floor.material) {
        
        // Try to change opacity directly
        floor.material.opacity = 0.3;
        floor.material.transparent = true;
        
        // Force render update
        if (this.renderer) {
          this.renderer.render(this.scene, this.camera);
        }
      }
    });
    
    // Test GSAP for ceilings
    if (allCeilings.length > 0 && allCeilings[0].material) {
      try {
        gsap.to(allCeilings[0].material, {
          opacity: 0,
          duration: 2,
          ease: "power2.inOut",
          onUpdate: () => {
            debugLog(`🔄 GSAP update - ceiling opacity: ${allCeilings[0].material.opacity}`);
            if (this.renderer) {
              this.renderer.render(this.scene, this.camera);
            }
          },
          onComplete: () => {
            debugLog('✅ GSAP animation for ceilings completed');
          }
        });
      } catch (error) {
        console.error('❌ GSAP test for ceilings failed:', error);
      }
    }
    
    // Test GSAP for floors
    if (allFloors.length > 0 && allFloors[0].material) {
      debugLog('🧪 Testing GSAP animation for floors...');
      try {
        gsap.to(allFloors[0].material, {
          opacity: 0,
          duration: 2,
          ease: "power2.inOut",
          onUpdate: () => {
            debugLog(`🔄 GSAP update - floor opacity: ${allFloors[0].material.opacity}`);
            if (this.renderer) {
              this.renderer.render(this.scene, this.camera);
            }
          },
          onComplete: () => {
            debugLog('✅ GSAP animation for floors completed');
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
    debugLog('🏠 Creating room-specific floors for', this.project.rooms.length, 'rooms');
    
    // Default floor thickness if not specified
    const defaultFloorThickness = 150; // 150mm default
    
    this.project.rooms.forEach((room, roomIndex) => {
      try {
        if (!room.room_points || room.room_points.length < 3) {
          debugLog(`⚠️ Room ${room.id} has insufficient points, skipping floor`);
          return;
        }

        // Get floor thickness from room data or use default
        const roomFloorThickness = (room.floor_thickness || defaultFloorThickness) * this.scalingFactor;
        
        // Get base elevation (default to 0 if not set)
        const baseElevation = (room.base_elevation_mm ?? 0) * this.scalingFactor;
        
        debugLog(`🏠 Room ${room.id} (${room.room_name || 'Unnamed'}) - Floor Thickness: ${room.floor_thickness || defaultFloorThickness}mm, Base Elevation: ${room.base_elevation_mm ?? 0}mm`);
        
        // Convert room points to 3D coordinates
        const roomVertices = room.room_points.map(point => ({
            x: point.x * this.scalingFactor + this.modelOffset.x,
            z: point.y * this.scalingFactor + this.modelOffset.z
        }));

        // Create floor geometry for this room
        const floorMesh = this.createRoomFloorMesh(roomVertices, room, roomFloorThickness);
        
        if (floorMesh) {
            // Position floor at base elevation - floor extends upward from here
            floorMesh.position.y = baseElevation;
          floorMesh.name = `floor_room_${room.id}`;
          floorMesh.userData = {
            isFloor: true,
            roomId: room.id,
            roomName: room.room_name || `Room ${room.id}`,
            thickness: roomFloorThickness
          };
          
          this.scene.add(floorMesh);
          debugLog(`✅ Created floor for room ${room.id} with thickness ${room.floor_thickness || defaultFloorThickness}mm at base elevation ${room.base_elevation_mm ?? 0}mm (extends from Y=${room.base_elevation_mm ?? 0}mm to Y=${(room.base_elevation_mm ?? 0) + (room.floor_thickness || defaultFloorThickness)}mm)`);
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
      
      debugLog(`🏷️ Added label "${room.room_name || `Room ${room.id}`}" to floor`);
    } catch (error) {
      debugWarn(`⚠️ Could not add room label to floor:`, error);
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
        debugLog('Not enough vertices for floor, skipping...');
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
        debugLog('Failed to triangulate floor, skipping...');
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
      debugLog('✅ Created fallback floor with thickness extending upward from Y=0 to Y=+150mm');
    } catch (error) {
      console.error('Error creating floor:', error);
      // Don't crash the app if floor creation fails
    }
  }
  
  // Method to test 45-degree joint demonstration
  test45DegreeJointDemo() {
    debugLog('🧪 Testing 45-degree joint demonstration...');
    this.create45DegreeJointDemo();
    debugLog('✅ 45-degree joint demo created! Check the 3D view.');
  }
}
