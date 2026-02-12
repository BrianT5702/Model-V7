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

export default class ThreeCanvas3D {
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
    
    // Professional renderer settings
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.THREE.PCFSoftShadowMap; // Soft shadows
    this.renderer.toneMapping = this.THREE.ACESFilmicToneMapping; // Professional tone mapping
    this.renderer.toneMappingExposure = 1.0; // Adjust exposure for brightness
    this.renderer.outputEncoding = this.THREE.sRGBEncoding; // sRGB for better color accuracy
    
    // Set background to pure white for bright ambient appearance
    this.renderer.setClearColor(0xffffff, 1);
    this.scene.background = new this.THREE.Color(0xffffff);
    
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

    // Add a red dot at the model center (disabled for cleaner view)
    // Uncomment the following lines to enable debug marker
    /*
    const modelCenter = this.calculateModelCenter();
    const dotGeometry = new THREE.SphereGeometry(100 * this.scalingFactor, 20, 20);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const dotMesh = new THREE.Mesh(dotGeometry, dotMaterial);
    dotMesh.position.set(modelCenter.x, 10 * this.scalingFactor, modelCenter.z);
    dotMesh.name = 'model_center_dot';
    this.scene.add(dotMesh);
    */
  
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
    
    // Calculate maximum ceiling height from all rooms to determine which floors to hide
    // Hide floors that are above the maximum ceiling height (floors from upper levels)
    let maxCeilingHeight = 0;
    if (this.project && this.project.rooms) {
      this.project.rooms.forEach(room => {
        const roomBaseElevation = room.base_elevation_mm ?? 0;
        const roomHeight = room.height ?? 0;
        const roomCeilingTop = roomBaseElevation + roomHeight;
        if (roomCeilingTop > maxCeilingHeight) {
          maxCeilingHeight = roomCeilingTop;
        }
      });
    }
    
    // Convert to 3D space units
    const maxCeilingHeight3D = maxCeilingHeight * this.scalingFactor;
    const floorVisibilityThreshold = maxCeilingHeight3D + (100 * this.scalingFactor); // Add 100mm buffer above max ceiling
    
    // Show only floors that are at or below the maximum ceiling level (hide upper level floors)
    floorLevels.forEach(floor => {
      // Get floor's Y position (base elevation)
      const floorY = floor.position.y;
      // Floor extends upward by its thickness, so check if the top of the floor is above threshold
      const floorThickness = floor.userData?.thickness || (150 * this.scalingFactor);
      const floorTop = floorY + floorThickness;
      
      // Hide floors that are above the maximum ceiling height (upper level floors)
      if (floorTop > floorVisibilityThreshold) {
        floor.visible = false;
        debugLog(`🏠 Interior view: Hiding upper level floor at Y=${floorY / this.scalingFactor}mm (top=${floorTop / this.scalingFactor}mm, threshold=${floorVisibilityThreshold / this.scalingFactor}mm, maxCeiling=${maxCeilingHeight}mm)`);
      } else {
        floor.visible = true;
      }
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

  // Animation loop
  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
    this.controls.update();
  }

  // Method to update data and rebuild model
  updateData(walls, joints, doors, project = null) {
    this.walls = walls;
    this.joints = joints;
    this.doors = doors;
    // Update project if provided (to include latest storeys and rooms)
    if (project) {
      this.project = project;
    }
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
      
      // Update grid size to cover the entire model area
      this.updateGridSize();
    } catch (error) {
      console.error('Error building model:', error);
    }
  }

  // Update grid size dynamically based on model bounds
  updateGridSize() {
    try {
      const bounds = this.getModelBounds();
      const modelWidth = Math.abs(bounds.maxX - bounds.minX);
      const modelDepth = Math.abs(bounds.maxZ - bounds.minZ);
      const modelSize = Math.max(modelWidth, modelDepth);
      
      // Make grid 3x larger than model size to ensure full coverage, with minimum of 5000
      const newGridSize = Math.max(modelSize * 3, 5000);
      // Round up to nearest 1000 for cleaner grid
      const roundedSize = Math.ceil(newGridSize / 1000) * 1000;
      
      // Calculate appropriate divisions based on size
      const divisions = Math.max(20, Math.min(100, Math.ceil(roundedSize / 100)));
      
      // Remove old grid if it exists
      const oldGrid = this.scene.getObjectByName('grid');
      if (oldGrid) {
        oldGrid.geometry.dispose();
        this.scene.remove(oldGrid);
      }
      
      // Create new grid with calculated size
      const gridHelper = new this.THREE.GridHelper(roundedSize, divisions, 0x888888, 0xcccccc);
      gridHelper.position.y = 0.01;
      gridHelper.name = 'grid';
      this.scene.add(gridHelper);
      this.gridHelper = gridHelper;
      
      debugLog(`📐 Grid updated: size=${roundedSize}, divisions=${divisions}, modelSize=${modelSize.toFixed(2)}`);
    } catch (error) {
      console.warn('Could not update grid size:', error);
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

      // CRITICAL: Only create ceiling if there are declared rooms
      // Do not create ceiling based on wall endpoints alone
      if (!this.project || !this.project.rooms || this.project.rooms.length === 0) {
        console.log('No rooms declared - skipping ceiling creation');
        return;
      }

      // Check if there are rooms with valid room_points
      const validRooms = this.project.rooms.filter(room => 
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
        debugLog(`[Ceiling] Room ${room.id}: baseElevation=${roomBaseElevation}mm, height=${roomHeight}mm, absoluteTop=${absoluteTop}mm`);
        if (absoluteTop > maxCeilingElevation) {
          maxCeilingElevation = absoluteTop;
        }
      });
      debugLog(`[Ceiling] Final maxCeilingElevation: ${maxCeilingElevation}mm`);

      // Get the building footprint vertices (will use room points since rooms exist)
      const vertices = this.getBuildingFootprint();
      if (vertices.length < 3) {
        return;
      }
      
      // Function to find the closest wall to a point and return its height
      const findWallHeightAtPoint = (x, z, room) => {
        // Convert 3D coordinates back to 2D (divide by scaling factor and subtract offset)
        const pointX = (x - this.modelOffset.x) / this.scalingFactor;
        const pointY = (z - this.modelOffset.z) / this.scalingFactor;
        
        // Get walls for this room - room.walls can be array of IDs or wall objects
        let roomWallIds = [];
        if (Array.isArray(room.walls)) {
          roomWallIds = room.walls.map(w => (typeof w === 'object' ? w.id : w));
        }
        
        if (!roomWallIds.length && this.walls) {
          // Try to find walls by matching room points to wall endpoints
          const roomPoints = room.room_points || [];
          roomWallIds = this.walls.filter(wall => {
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
        this.walls.forEach(wall => {
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
        
        const validRooms = this.project.rooms.filter(room => 
          room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3
        );
        
        validRooms.forEach(room => {
          if (!room.room_points || room.room_points.length < 3) return;
          
          // Convert 3D coordinates to 2D
          const pointX = (x - this.modelOffset.x) / this.scalingFactor;
          const pointY = (z - this.modelOffset.z) / this.scalingFactor;
          
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
            return (roomBaseElevation + wallHeight) * this.scalingFactor;
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
          return (roomBaseElevation + wallHeight) * this.scalingFactor;
        }
        
        // Final fallback: use max ceiling elevation
        return maxCeilingElevation * this.scalingFactor;
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
      
      // Create ceiling geometry with thickness extending downward
      // Use a reasonable default thickness for fallback ceiling
      const ceilingThickness = 150 * this.scalingFactor; // 150mm default thickness
      
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
          const relativeHeight = absoluteHeight - (maxCeilingElevation * this.scalingFactor);
          vertexHeightMap.set(key, relativeHeight);
        }
      }
      
      // Create the top surface (sloped ceiling)
      const topGeometry = new this.THREE.BufferGeometry();
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
      topGeometry.setAttribute('position', new this.THREE.BufferAttribute(topPositions, 3));
      topGeometry.computeVertexNormals();
      
      // Create the bottom surface (thickness bottom, also sloped to match top)
      const bottomGeometry = new this.THREE.BufferGeometry();
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
      bottomGeometry.setAttribute('position', new this.THREE.BufferAttribute(bottomPositions, 3));
      bottomGeometry.computeVertexNormals();
      
      // Create side walls to connect top and bottom surfaces
      const sideGeometry = new this.THREE.BufferGeometry();
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
      
      // Position the ceiling at the calculated elevation (storey elevation + room base + room height)
      ceiling.position.y = maxCeilingElevation * this.scalingFactor;
      
      // Add edge lines to match wall appearance
      const edges = new this.THREE.EdgesGeometry(geometry);
      const edgeLines = new this.THREE.LineSegments(
        edges, 
        new this.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
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
      
      this.scene.add(ceiling);
    } catch (error) {
      console.error('Error creating ceiling:', error);
      // Don't crash the app if ceiling creation fails
    }
  }

  // Method to get building footprint (uses room points if available, otherwise wall endpoints)
  getBuildingFootprint() {
    // Priority 1: Use room boundary points (room_points) if available
    if (this.project && this.project.rooms && this.project.rooms.length > 0) {
      // Filter rooms with valid room_points
      const validRooms = this.project.rooms.filter(room => 
        room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3
      );
      
      if (validRooms.length === 1) {
        // Single room: use room points directly in their original order
        const room = validRooms[0];
        return room.room_points.map(point => ({
          x: point.x * this.scalingFactor + this.modelOffset.x,
          z: point.y * this.scalingFactor + this.modelOffset.z
        }));
      } else if (validRooms.length > 1) {
        // Multiple rooms: collect all points and compute convex hull for outer boundary
        const allRoomPoints = [];
        validRooms.forEach(room => {
          room.room_points.forEach(point => {
            allRoomPoints.push({
              x: point.x * this.scalingFactor + this.modelOffset.x,
              z: point.y * this.scalingFactor + this.modelOffset.z
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
          return this.computeConvexHull(uniquePoints);
        }
      }
    }
    
    // Priority 2: Fallback to wall endpoints (original method)
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

  // Helper function to compute convex hull using Graham scan algorithm
  computeConvexHull(points) {
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
             this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], rest[i]) <= 0) {
        hull.pop();
      }
      hull.push(rest[i]);
    }
    
    return hull;
  }

  // Helper function to calculate cross product for convex hull
  crossProduct(o, a, b) {
    return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  }

  // Enhanced method to add room-specific ceilings
  addRoomSpecificCeilings() {
    try {
      // Remove existing ceilings
      const existingCeilings = this.scene.children.filter(child => 
        child.name && child.name.startsWith('ceiling')
      );
      existingCeilings.forEach(ceiling => this.scene.remove(ceiling));

      // Only create ceilings if we have room data (all ceilings are room-based)
      if (this.project && this.project.rooms && this.project.rooms.length > 0) {
        this.createRoomSpecificCeilings();
      } else {
        console.log('No rooms found - skipping ceiling creation (ceilings are room-based)');
      }
    } catch (error) {
      console.error('Error creating room-specific ceilings:', error);
      // Don't create fallback ceiling - ceilings should be room-based only
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

        // Use room base elevation directly (absolute value, no storey elevation)
        const absoluteBaseElevation = room.base_elevation_mm ?? 0;
        debugLog(`🏠 Room ${room.id} Ceiling - Room Base Elevation: ${absoluteBaseElevation}mm (absolute value)`);
        
        const baseElevation = absoluteBaseElevation * this.scalingFactor;

        // Convert room points to 3D coordinates
        let roomVertices = room.room_points.map(point => ({
            x: point.x * this.scalingFactor + this.modelOffset.x,
            z: point.y * this.scalingFactor + this.modelOffset.z
        }));
        
        // Apply Cut L shrinking for ceiling
        roomVertices = this.shrinkRoomVerticesForCutL(roomVertices, room);

        // Get ceiling thickness from room's ceiling plan or use default
        const roomCeilingThickness = (room.ceiling_plan?.ceiling_thickness || defaultCeilingThickness) * this.scalingFactor;
        
        // Create ceiling geometry for this room (returns mesh and max wall height)
        const ceilingResult = this.createRoomCeilingMesh(roomVertices, roomCeilingHeight, room, roomCeilingThickness);
        const ceilingMesh = ceilingResult?.mesh || ceilingResult;
        const maxWallHeight = ceilingResult?.maxWallHeight || roomCeilingHeight;
        
        if (ceilingMesh) {
          // Position ceiling at base elevation + max wall height (absolute ceiling position)
          // Add a tiny offset to prevent z-fighting with wall tops
          ceilingMesh.position.y = baseElevation + (maxWallHeight * this.scalingFactor) + 0.001;
          ceilingMesh.name = `ceiling_room_${room.id}`;
          ceilingMesh.userData = {
            isCeiling: true,
            roomId: room.id,
            roomName: room.room_name || `Room ${room.id}`,
            height: roomCeilingHeight,
            baseElevation: absoluteBaseElevation,
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

  // Helper function to get default Cut L horizontal extension based on wall thickness
  getCutLDefaultHorizontalExtension(wallThickness) {
    if (wallThickness >= 200) return 125.0;
    if (wallThickness >= 150) return 100.0;
    if (wallThickness >= 125) return 75.0;
    if (wallThickness >= 100) return 75.0;
    if (wallThickness >= 75) return 50.0;
    return 50.0;
  }

  // Helper function to get Cut L horizontal extension for a wall
  getCutLHorizontalExtension(wall) {
    if (wall.ceiling_cut_l_horizontal_extension !== null && wall.ceiling_cut_l_horizontal_extension !== undefined) {
      return wall.ceiling_cut_l_horizontal_extension;
    }
    return this.getCutLDefaultHorizontalExtension(wall.thickness || 150);
  }

  // Calculate Cut L wall offsets for a room
  calculateCutLWallOffsets(room) {
    const offsets = {};
    if (!room || !this.walls) return offsets;
    
    // Get walls for this room - handle both array of IDs and array of objects
    let roomWallIds = [];
    if (Array.isArray(room.walls)) {
      roomWallIds = room.walls.map(w => String(typeof w === 'object' ? w.id : w));
    }
    
    // Also try to find walls by proximity to room_points if room.walls is empty
    let wallsToCheck = [];
    if (roomWallIds.length > 0) {
      // Use walls from room.walls
      wallsToCheck = this.walls.filter(wall => roomWallIds.includes(String(wall.id)));
    } else if (room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3) {
      // Find walls by proximity to room_points (within 1mm tolerance)
      const tolerance = 1.0;
      wallsToCheck = this.walls.filter(wall => {
        return room.room_points.some(point => {
          const distToStart = Math.sqrt(Math.pow(point.x - wall.start_x, 2) + Math.pow(point.y - wall.start_y, 2));
          const distToEnd = Math.sqrt(Math.pow(point.x - wall.end_x, 2) + Math.pow(point.y - wall.end_y, 2));
          return distToStart < tolerance || distToEnd < tolerance;
        });
      });
    } else {
      // Fallback: check all walls
      wallsToCheck = this.walls;
    }
    
    wallsToCheck.forEach(wall => {
      if (wall.ceiling_joint_type === 'cut_l') {
        const horizontalExtension = this.getCutLHorizontalExtension(wall);
        const offset = (wall.thickness || 150) - horizontalExtension;
        offsets[wall.id] = offset;
      }
    });
    
    return offsets;
  }

  // Shrink room vertices based on Cut L offsets
  shrinkRoomVerticesForCutL(roomVertices, room) {
    const offsets = this.calculateCutLWallOffsets(room);
    
    // If no Cut L joints, return original vertices
    if (Object.keys(offsets).length === 0) {
      return roomVertices;
    }
    
    // Calculate bounding box of original vertices (in 2D coordinates)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    roomVertices.forEach(v => {
      const x = (v.x - this.modelOffset.x) / this.scalingFactor;
      const y = (v.z - this.modelOffset.z) / this.scalingFactor;
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
    const wallsWithOffsets = this.walls.filter(wall => offsets[wall.id]);
    
    wallsWithOffsets.forEach(wall => {
      const offset = offsets[wall.id];
      const wallStartX = wall.start_x;
      const wallStartY = wall.start_y;
      const wallEndX = wall.end_x;
      const wallEndY = wall.end_y;
      
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
      const x = (v.x - this.modelOffset.x) / this.scalingFactor;
      const y = (v.z - this.modelOffset.z) / this.scalingFactor;
      
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
        x: adjustedX * this.scalingFactor + this.modelOffset.x,
        z: adjustedY * this.scalingFactor + this.modelOffset.z
      };
    });
    
    return adjustedVertices;
  }

  // Create individual room ceiling mesh with thickness
  createRoomCeilingMesh(roomVertices, roomHeight, room, ceilingThickness) {
    try {
      // Get room walls - can be array of IDs or objects
      let roomWallIds = [];
      if (Array.isArray(room.walls)) {
        roomWallIds = room.walls.map(w => (typeof w === 'object' ? w.id : w));
      }
      
      // Create a map of wall heights for this room
      const wallHeightMap = new Map();
      this.walls.forEach(wall => {
        if (roomWallIds.length === 0 || roomWallIds.includes(wall.id)) {
          wallHeightMap.set(wall.id, wall.height || roomHeight || 0);
        }
      });
      
      // Map each room point to its wall height
      const pointHeightMap = new Map();
      room.room_points.forEach((point, index) => {
        // Find wall that has an endpoint at this point
        const wallAtPoint = this.walls.find(wall => {
          if (roomWallIds.length > 0 && !roomWallIds.includes(wall.id)) {
            return false;
          }
          const distToStart = Math.sqrt(Math.pow(point.x - wall.start_x, 2) + Math.pow(point.y - wall.start_y, 2));
          const distToEnd = Math.sqrt(Math.pow(point.x - wall.end_x, 2) + Math.pow(point.y - wall.end_y, 2));
          return distToStart < 1 || distToEnd < 1; // 1mm tolerance
        });
        
        const wallHeight = wallAtPoint ? (wallAtPoint.height || roomHeight || 0) : (roomHeight || 0);
        const pointKey = `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
        pointHeightMap.set(pointKey, wallHeight);
        console.log(`[Ceiling] Room ${room.id} point ${index} (${point.x}, ${point.y}): wall ${wallAtPoint?.id || 'none'} height = ${wallHeight}mm`);
      });
      
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
      
      // Find max wall height for this room to use as reference
      const maxWallHeight = Math.max(...Array.from(pointHeightMap.values()), roomHeight || 0);
      console.log(`[Ceiling] Room ${room.id} max wall height: ${maxWallHeight}mm`);
      
      // Create a function to get height at any 3D vertex
      const getHeightAtVertex = (x, z) => {
        // Convert 3D back to 2D room coordinates
        const pointX = (x - this.modelOffset.x) / this.scalingFactor;
        const pointY = (z - this.modelOffset.z) / this.scalingFactor;
        
        // Find closest room point
        let closestPoint = null;
        let minDist = Infinity;
        room.room_points.forEach(point => {
          const dist = Math.sqrt(Math.pow(point.x - pointX, 2) + Math.pow(point.y - pointY, 2));
          if (dist < minDist) {
            minDist = dist;
            closestPoint = point;
          }
        });
        
        if (closestPoint && minDist < 100) { // 100mm tolerance
          const pointKey = `${closestPoint.x.toFixed(2)},${closestPoint.y.toFixed(2)}`;
          return pointHeightMap.get(pointKey) || roomHeight || 0;
        }
        
        return roomHeight || 0;
      };
      
      // Create the top surface (sloped ceiling based on wall heights)
      const topGeometry = new this.THREE.BufferGeometry();
      const topPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        
        // Get wall height at this vertex
        const wallHeight = getHeightAtVertex(x, z);
        
        // Calculate relative height (relative to max height, so ceiling slopes)
        const relativeHeight = (wallHeight - maxWallHeight) * this.scalingFactor;
        
        topPositions[i * 3] = x;
        topPositions[i * 3 + 1] = relativeHeight; // Top surface with slope based on wall height
        topPositions[i * 3 + 2] = z;
      }
      topGeometry.setAttribute('position', new this.THREE.BufferAttribute(topPositions, 3));
      topGeometry.computeVertexNormals();
      
      // Create the bottom surface (thickness bottom, also sloped)
      const bottomGeometry = new this.THREE.BufferGeometry();
      const bottomPositions = new Float32Array(triangles.length * 3);
      
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        
        // Get wall height at this vertex
        const wallHeight = getHeightAtVertex(x, z);
        
        // Calculate relative height (relative to max height)
        const relativeHeight = (wallHeight - maxWallHeight) * this.scalingFactor;
        
        bottomPositions[i * 3] = x;
        bottomPositions[i * 3 + 1] = relativeHeight - ceilingThickness; // Bottom surface follows slope, offset by thickness
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
        
        // Get heights for current and next vertices
        const currentHeight = getHeightAtVertex(current.x, current.z);
        const nextHeight = getHeightAtVertex(next.x, next.z);
        const currentTopHeight = (currentHeight - maxWallHeight) * this.scalingFactor;
        const nextTopHeight = (nextHeight - maxWallHeight) * this.scalingFactor;
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
      
      // Create material using professional config
      const material = new this.THREE.MeshStandardMaterial({
        color: THREE_CONFIG.MATERIALS.CEILING.color,
        side: this.THREE.DoubleSide,
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
      const ceiling = new this.THREE.Mesh(geometry, material);
      // Set render order to render after walls (higher number = renders later)
      ceiling.renderOrder = 1;
      
      // Add edge lines to match wall appearance
      const edges = new this.THREE.EdgesGeometry(geometry);
      const edgeLines = new this.THREE.LineSegments(
        edges, 
        new this.THREE.LineBasicMaterial({ color: 0x000000 }) // Black edge lines like walls
      );
      ceiling.add(edgeLines);
      
      // Set shadow properties
      // Disable shadow receiving on ceiling to avoid dark shadow rectangles from walls
      ceiling.castShadow = false; // Ceilings don't need to cast shadows
      ceiling.receiveShadow = false; // Disable receiving shadows to prevent dark rectangles on ceiling surface
      
      // Add room label on the ceiling
      this.addRoomLabelToCeiling(ceiling, room, roomVertices);
      
      // Return both mesh and maxWallHeight for positioning
      return { mesh: ceiling, maxWallHeight };
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
    // Disabled: TextGeometry requires a loaded font, and without it creates unwanted box geometries
    // Room labels are better displayed in 2D views
    return;
    
    /* Original code disabled to prevent semi-transparent cube artifacts
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
    */
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
      
      // Prepare face information for panel calculation
      const faceInfo = {
        innerFaceMaterial: wall.inner_face_material || null,
        innerFaceThickness: wall.inner_face_thickness || null,
        outerFaceMaterial: wall.outer_face_material || null,
        outerFaceThickness: wall.outer_face_thickness || null
      };
      
      let panels = calculator.calculatePanels(
        wallLength,
        wall.thickness,
        jointTypes,
        wall.height,
        faceInfo
      );
      
      // Check if wall should be flipped due to joint types
      let shouldFlipWall = false;
      
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

  // Calculate ceiling panels for each room based on ceiling plan data (including zone panels)
  calculateCeilingPanels() {
    const ceilingPanelsMap = {};
    
    if (!this.project || !this.project.rooms) {
      return ceilingPanelsMap;
    }

    // First, collect all zone panels to avoid duplicates
    const zonePanelsMap = new Map(); // zone_id -> { zone, panels, outline_points }
    
    this.project.rooms.forEach(room => {
      debugLog(`🏠 Checking room ${room.id} (${room.room_name}):`, {
        ceiling_plan: room.ceiling_plan,
        zone_ceiling_plan: room.zone_ceiling_plan,
        ceiling_zones: room.ceiling_zones,
        ceiling_panels_from_plan: room.ceiling_plan?.ceiling_panels,
        hasCeilingPanels: room.ceiling_plan?.ceiling_panels && room.ceiling_plan.ceiling_panels.length > 0
      });
      
      // Priority 1: Check if room is in a zone and has zone_ceiling_plan
      if (room.zone_ceiling_plan?.ceiling_panels && room.zone_ceiling_plan.ceiling_panels.length > 0) {
        // Room is in a zone - use zone panels
        const zoneId = room.ceiling_zones?.[0]?.id;
        if (zoneId && !zonePanelsMap.has(zoneId)) {
          // Get zone outline points if available (for proper clipping)
          const zone = room.ceiling_zones[0];
          const outlinePoints = zone.outline_points || null;
          
          debugLog(`🏠 Room ${room.id}: Using zone ceiling panel data (zone ${zoneId}, ${room.zone_ceiling_plan.ceiling_panels.length} panels)`);
          const panels = room.zone_ceiling_plan.ceiling_panels.map(panel => ({
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
            cut_notes: panel.cut_notes,
            shape_data: panel.shape_data || null // Preserve L-shape geometry
          }));
          
          zonePanelsMap.set(zoneId, {
            zone: zone,
            panels: panels,
            outline_points: outlinePoints,
            ceiling_plan: room.zone_ceiling_plan
          });
        }
      }
      // Priority 2: Check for ceiling panels via ceiling_plan.ceiling_panels (individual room)
      else if (room.ceiling_plan?.ceiling_panels && room.ceiling_plan.ceiling_panels.length > 0) {
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
          cut_notes: panel.cut_notes,
          shape_data: panel.shape_data || null // Preserve L-shape geometry
        }));
        
        ceilingPanelsMap[room.id] = {
          room: room,
          panels: panels,
          ceiling_plan: room.ceiling_plan,
          outline_points: null // Individual rooms use room_points
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
            ceiling_plan: null,
            outline_points: null
          };
        }
      }
    });
    
    // Now, map zone panels to each room in the zone
    zonePanelsMap.forEach((zoneData, zoneId) => {
      // Find all rooms in this zone
      this.project.rooms.forEach(room => {
        const roomZoneIds = room.ceiling_zones?.map(z => z.id) || [];
        if (roomZoneIds.includes(zoneId)) {
          // Use zone outline points if available, otherwise use room points
          const outlinePoints = zoneData.outline_points || room.room_points;
          
          ceilingPanelsMap[room.id] = {
            room: room,
            panels: zoneData.panels,
            ceiling_plan: zoneData.ceiling_plan,
            outline_points: outlinePoints, // Use zone outline for proper clipping
            zone: zoneData.zone
          };
          
          debugLog(`🏠 Room ${room.id} (${room.room_name}): Mapped ${zoneData.panels.length} zone panels from zone ${zoneId}`);
        }
      });
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
      
      // Helper function for line intersection (matching meshUtils.js)
      const calculateLineIntersection = (x1, y1, x2, y2, x3, y3, x4, y4, allowExtended = false) => {
        const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denominator) < 1e-10) return null;
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;
        const intersectionX = x1 + t * (x2 - x1);
        const intersectionZ = y1 + t * (y2 - y1);
        if (allowExtended) {
          return { x: intersectionX, z: intersectionZ, t, u };
        }
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          return { x: intersectionX, z: intersectionZ, t, u };
        }
        return null;
      };
      
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
        
        // CRITICAL: Match meshUtils.js coordinate system exactly
        // Scale coordinates first (matching meshUtils.js lines 57-60)
        let startX = start_x * scale;
        let startZ = start_y * scale;
        let endX = end_x * scale;
        let endZ = end_y * scale;
        
        // Determine if the wall is horizontal, vertical, or diagonal
        const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
        const isVertical = Math.abs(start_x - end_x) < 1e-6;
        
        // Apply wall flipping logic EXACTLY matching meshUtils.js (lines 171-188)
        let finalStartX = startX;
        let finalStartZ = startZ;
        let finalEndX = endX;
        let finalEndZ = endZ;
        
        // Apply model center logic for wall orientation (matching meshUtils.js)
        if (isHorizontal) {
          // For horizontal walls: if model center is at < Z position, flip start X with end X
          if (modelCenter.z * scale < startZ) {
            finalStartX = endX;
            finalEndX = startX;
          }
        } else if (isVertical) {
          // For vertical walls: if model center is at > X position, flip start Z with end Z
          if (modelCenter.x * scale > startX) {
            finalStartZ = endZ;
            finalEndZ = startZ;
          }
        }
        
        // CRITICAL: Apply wall extension and shortening to match meshUtils.js exactly
        // This ensures panel lines align with the actual wall mesh positions
        
        // STEP 1: Extend perpendicular walls to surfaces (matching meshUtils.js lines 277-391)
        const snap = (val, precision = 0.01) => Math.round(val / precision) * precision;
        if (this.joints && this.joints.length > 0) {
          this.walls.forEach(otherWall => {
            if (String(otherWall.id) === String(id)) return;
            const joint = this.joints.find(j => 
              (j.wall_1 === id && j.wall_2 === otherWall.id) ||
              (j.wall_2 === id && j.wall_1 === otherWall.id)
            );
            if (!joint) return;
            
            const oSX = snap(otherWall.start_x * scale);
            const oSZ = snap(otherWall.start_y * scale);
            const oEX = snap(otherWall.end_x * scale);
            const oEZ = snap(otherWall.end_y * scale);
            const otherThickness = otherWall.thickness * scale;
            const otherIsHorizontal = Math.abs(otherWall.start_y - otherWall.end_y) < 1e-6;
            const otherIsVertical = Math.abs(otherWall.start_x - otherWall.end_x) < 1e-6;
            
            const otherMidX = (oSX + oEX) / 2;
            const otherMidZ = (oSZ + oEZ) / 2;
            const toOtherCenterX = modelCenter.x - otherMidX;
            const toOtherCenterZ = modelCenter.z - otherMidZ;
            let otherNormX, otherNormZ;
            if (otherIsHorizontal) {
              otherNormX = 0;
              otherNormZ = toOtherCenterZ < 0 ? -1 : 1;
            } else if (otherIsVertical) {
              otherNormX = toOtherCenterX < 0 ? -1 : 1;
              otherNormZ = 0;
            } else {
              return;
            }
            
            const otherOuterX = oSX;
            const otherOuterZ = oSZ;
            const otherInnerX = oSX + otherNormX * otherThickness;
            const otherInnerZ = oSZ + otherNormZ * otherThickness;
            
            if (isHorizontal && otherIsVertical) {
              const thisZ = finalStartZ;
              const otherX = oSX;
              const rightmostX = Math.max(otherOuterX, otherInnerX);
              const leftmostX = Math.min(otherOuterX, otherInnerX);
              const otherMinZ = Math.min(oSZ, oEZ);
              const otherMaxZ = Math.max(oSZ, oEZ);
              if (thisZ < otherMinZ || thisZ > otherMaxZ) return;
              
              const rightEndpointX = Math.max(finalStartX, finalEndX);
              const leftEndpointX = Math.min(finalStartX, finalEndX);
              const thisCenterX = (finalStartX + finalEndX) / 2;
              if (otherX > thisCenterX) {
                if (rightEndpointX < rightmostX) {
                  if (finalEndX > finalStartX) {
                    finalEndX = rightmostX;
                  } else {
                    finalStartX = rightmostX;
                  }
                }
              } else {
                if (leftEndpointX > leftmostX) {
                  if (finalStartX < finalEndX) {
                    finalStartX = leftmostX;
                  } else {
                    finalEndX = leftmostX;
                  }
                }
              }
            } else if (isVertical && otherIsHorizontal) {
              const thisX = finalStartX;
              const otherZ = oSZ;
              const topmostZ = Math.max(otherOuterZ, otherInnerZ);
              const bottommostZ = Math.min(otherOuterZ, otherInnerZ);
              const otherMinX = Math.min(oSX, oEX);
              const otherMaxX = Math.max(oSX, oEX);
              if (thisX < otherMinX || thisX > otherMaxX) return;
              
              const topEndpointZ = Math.max(finalStartZ, finalEndZ);
              const bottomEndpointZ = Math.min(finalStartZ, finalEndZ);
              const thisCenterZ = (finalStartZ + finalEndZ) / 2;
              if (otherZ > thisCenterZ) {
                if (topEndpointZ < topmostZ) {
                  if (finalEndZ > finalStartZ) {
                    finalEndZ = topmostZ;
                  } else {
                    finalStartZ = topmostZ;
                  }
                }
              } else {
                if (bottomEndpointZ > bottommostZ) {
                  if (finalStartZ < finalEndZ) {
                    finalStartZ = bottommostZ;
                  } else {
                    finalEndZ = bottommostZ;
                  }
                }
              }
            }
          });
        }
        
        // STEP 2: Apply butt-in joint shortening (matching meshUtils.js lines 393-504)
        const wallDx = finalEndX - finalStartX;
        const wallDz = finalEndZ - finalStartZ;
        // Recalculate wall length after extension (use different variable to avoid redeclaration)
        const extendedWallLength = Math.hypot(wallDx, wallDz);
        const wallDirX = extendedWallLength > 0 ? wallDx / extendedWallLength : 0;
        const wallDirZ = extendedWallLength > 0 ? wallDz / extendedWallLength : 0;
        
        const buttInJoints = this.joints ? this.joints.filter(j => 
          j.joining_method === 'butt_in' && (j.wall_1 === id || j.wall_2 === id)
        ) : [];
        
        let shouldShortenStart = false;
        let shouldShortenEnd = false;
        let startShorteningThickness = 0;
        let endShorteningThickness = 0;
        
        if (buttInJoints.length > 0) {
          buttInJoints.forEach(j => {
            const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
            const otherWall = this.walls.find(w => String(w.id) === String(otherWallId));
            if (!otherWall) return;
            const isWall1 = j.wall_1 === id;
            if (!isWall1) return;
            
            const joiningWallThickness = (otherWall.thickness || thickness) * scale;
            const oSX = snap(otherWall.start_x * scale);
            const oSZ = snap(otherWall.start_y * scale);
            const oEX = snap(otherWall.end_x * scale);
            const oEZ = snap(otherWall.end_y * scale);
            
            // Calculate intersection
            const intersection = calculateLineIntersection(
              finalStartX, finalStartZ, finalEndX, finalEndZ,
              oSX, oSZ, oEX, oEZ,
              true
            );
            if (!intersection) return;
            
            const jointX = snap(intersection.x);
            const jointZ = snap(intersection.z);
            const startDist = Math.hypot(jointX - finalStartX, jointZ - finalStartZ);
            const endDist = Math.hypot(jointX - finalEndX, jointZ - finalEndZ);
            const isCloserToStart = startDist < endDist;
            
            if (isCloserToStart && startDist < 0.1) {
              shouldShortenStart = true;
              startShorteningThickness = Math.max(startShorteningThickness, joiningWallThickness);
            } else if (!isCloserToStart && endDist < 0.1) {
              shouldShortenEnd = true;
              endShorteningThickness = Math.max(endShorteningThickness, joiningWallThickness);
            }
          });
          
          if (shouldShortenStart) {
            finalStartX = finalStartX + wallDirX * startShorteningThickness;
            finalStartZ = finalStartZ + wallDirZ * startShorteningThickness;
          }
          if (shouldShortenEnd) {
            finalEndX = finalEndX - wallDirX * endShorteningThickness;
            finalEndZ = finalEndZ - wallDirZ * endShorteningThickness;
          }
        }
        
        // Calculate final wall direction and length AFTER extension and shortening
        const finalDx = finalEndX - finalStartX;
        const finalDz = finalEndZ - finalStartZ;
        const finalWallLength = Math.sqrt(finalDx * finalDx + finalDz * finalDz);
        
        // Wall thickness in scaled units
        const wallThickness = thickness * scale;
        
        // Wall height in scaled units - adjust for gap-fill mode
        // CRITICAL: Match meshUtils.js elevation logic exactly (lines 102-168)
        let wallHeight;
        let wallBaseY = 0; // Default: floor level
        if (fill_gap_mode && gap_fill_height !== null && gap_base_position !== null) {
          // Gap-fill mode: position at gap base, use gap height
          wallBaseY = gap_base_position * scale;
          wallHeight = gap_fill_height * scale;
        } else {
          // Normal mode: determine base elevation based on whether it was manually set
          // Use room or wall base elevation directly (absolute values), don't add storey elevation
          let wallBaseElevation = 0;
          
          // If base_elevation_manual is true, use wall's base_elevation_mm (manually set, absolute value)
          // Otherwise, use the minimum base_elevation_mm from rooms containing this wall (absolute value)
          if (wall.base_elevation_manual) {
            // Use manually set wall base elevation (absolute value)
            wallBaseElevation = wall.base_elevation_mm ?? 0;
          } else {
            // Use room base elevation (minimum of all rooms containing this wall, absolute value)
            if (this.project && this.project.rooms) {
              const roomsWithWall = this.project.rooms.filter(room => {
                const roomWalls = Array.isArray(room.walls) ? room.walls : [];
                return roomWalls.some(w => {
                  const wallId = typeof w === 'object' ? w.id : w;
                  return String(wallId) === String(id);
                });
              });
              
              if (roomsWithWall.length > 0) {
                const baseElevations = roomsWithWall
                  .map(room => room.base_elevation_mm)
                  .filter(elev => elev !== undefined && elev !== null)
                  .map(elev => Number(elev) || 0);
                
                if (baseElevations.length > 0) {
                  wallBaseElevation = Math.min(...baseElevations);
                } else {
                  // Fallback to wall's base_elevation_mm if no room base elevations found
                  wallBaseElevation = wall.base_elevation_mm ?? 0;
                }
              } else {
                // No rooms found, fallback to wall's base_elevation_mm
                wallBaseElevation = wall.base_elevation_mm ?? 0;
              }
            } else {
              // No project/rooms data, fallback to wall's base_elevation_mm
              wallBaseElevation = wall.base_elevation_mm ?? 0;
            }
          }
          
          // basePositionY is the Y position for the bottom of the wall in 3D space
          // This matches exactly how walls are positioned in meshUtils.js
          wallBaseY = wallBaseElevation * scale;
          wallHeight = height * scale;
        }
        
        // CRITICAL: Calculate wall normal AFTER extension and shortening
        // This must match meshUtils.js logic exactly (lines 231-276)
        // The normal is recalculated using FINAL coordinates (after extension/shortening)
        const dirX = finalEndX - finalStartX;
        const dirZ = finalEndZ - finalStartZ;
        const len = Math.hypot(dirX, dirZ) || 1;
        const ux = dirX / len;
        const uz = dirZ / len;
        let nx = -uz;
        let nz = ux;
        const midX = (finalStartX + finalEndX) / 2;
        const midZ = (finalStartZ + finalEndZ) / 2;
        // CRITICAL: Model center is already in scaled coordinates, don't scale again!
        // This matches meshUtils.js line 243: modelCenter is already scaled
        const toCenterX = modelCenter.x - midX;
        const toCenterZ = modelCenter.z - midZ;
        const dot = nx * toCenterX + nz * toCenterZ;
        if (dot < 0) {
          nx = -nx;
          nz = -nz;
        }
        const finalNormX = nx;
        const finalNormZ = nz;
        
        // Store unscaled coordinates for panel calculations
        const finalStartXUnscaled = finalStartX / scale;
        const finalStartYUnscaled = finalStartZ / scale; // Note: Z in scaled = Y in unscaled
        const finalEndXUnscaled = finalEndX / scale;
        const finalEndYUnscaled = finalEndZ / scale;
        
        // Get doors for this wall and calculate cutouts
        const wallDoors = this.doors.filter(door => 
          (door.linked_wall === wall.id || door.wall === wall.id || door.wall_id === wall.id)
        );
        
        // Calculate door cutouts (same logic as in meshUtils.js)
        // Check if wall was flipped by comparing scaled coordinates
        const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
        wallDoors.sort((a, b) => a.position_x - b.position_x);
        
        // Calculate panel positions using unscaled coordinates for panel width calculations
        const finalWallLengthUnscaled = finalWallLength / scale;
        
        // Calculate cutouts in UNSCALED space to match divisionPosition
        const cutouts = wallDoors.map(door => {
          const isSlideDoor = (door.door_type === 'slide');
          const doorWidth = door.width; // Keep unscaled (mm)
          // For double-sided slide doors, use full door width (both panels need to fit)
          // For single slide doors, use 95% (slight gap for sliding)
          // For swing doors, use 105% (slight overlap for door swing)
          const isDoubleSidedSlide = isSlideDoor && door.configuration === 'double_sided';
          const cutoutWidth = doorWidth * (isDoubleSidedSlide ? 1.0 : isSlideDoor ? 0.95 : 1.05); // cutout width in mm (unscaled)
          const doorHeight = door.height * scale * 1.02; // Store height in scaled space
          
          // If wall was flipped, flip the door position
          const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
          const doorPos = adjustedPositionX * finalWallLengthUnscaled; // Position in unscaled mm
          
          const cutout = {
            start: Math.max(0, doorPos - cutoutWidth / 2), // Unscaled mm
            end: Math.min(finalWallLengthUnscaled, doorPos + cutoutWidth / 2), // Unscaled mm
            height: doorHeight, // Scaled space
            doorInfo: door
          };
          
          return cutout;
        });
        
        let accumulated = 0;
        
        // Wall panel division positions
        
        // Create division lines for each panel boundary
        // Note: The panels array from calculateWallPanels() uses unscaled coordinates
        // so we need to convert panel widths to scaled space for positioning
        
        for (let i = 0; i < panels.length - 1; i++) {
          accumulated += panels[i].width; // Accumulate in unscaled mm
          const t = accumulated / finalWallLengthUnscaled; // Position along wall (0-1) in unscaled space
          const divisionPosition = accumulated; // Position in wall units (mm, unscaled)
          
          // Calculate division point along the wall using SCALED final coordinates
          // This matches exactly how the wall mesh is positioned
          const divX = finalStartX + (finalEndX - finalStartX) * t;
          const divZ = finalStartZ + (finalEndZ - finalStartZ) * t;
          
          // Convert to 3D world coordinates (add model offset)
          const divX3D = divX + this.modelOffset.x;
          const divZ3D = divZ + this.modelOffset.z;
          
          // CRITICAL: Position panel division lines on BOTH wall surfaces
          // Wall mesh is positioned at database coordinate and extruded by wallThickness
          // in the normal direction (toward model center). Therefore:
          // - Surface 1: At database coordinate (one face of the wall - outer face)
          // - Surface 2: At database coordinate + normal * wallThickness (opposite face - inner face)
          // We place one line on each surface for accurate double-line representation
          // 
          // IMPORTANT: The normal points from outer face (database coordinate) to inner face
          // In ExtrudeGeometry, the shape is in XY plane, extruded in Z direction
          // After rotation, local Y (thickness) aligns with normal in XZ plane
          // So: outer face at Y=0 (local) = database coordinate (world)
          //     inner face at Y=wallThickness (local) = database coordinate + normal * wallThickness (world)
          const dbLinePoint = {
            x: divX3D,
            z: divZ3D
          };
          // Offset by full wall thickness in normal direction to reach the opposite surface
          const offsetLinePoint = {
            x: divX3D + finalNormX * wallThickness,
            z: divZ3D + finalNormZ * wallThickness
          };
          
          // Debug: Verify normal direction for problematic walls
          if (wall.id === 7083 || wall.id === 7180 || wall.id === 7197) {
            console.log(`[Panel Line Debug] Wall ${wall.id} - Normal and line positions:`, {
              wallId: wall.id,
              normal: { x: finalNormX, z: finalNormZ },
              wallThickness: wallThickness,
              dbLinePoint: dbLinePoint,
              offsetLinePoint: offsetLinePoint,
              distanceBetweenLines: Math.hypot(
                offsetLinePoint.x - dbLinePoint.x,
                offsetLinePoint.z - dbLinePoint.z
              ),
              expectedDistance: wallThickness,
              note: "Lines should be on opposite faces, distance should equal wallThickness"
            });
          }
          
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
          // Pass unscaled coordinates for compatibility (though they may not be used)
          this.createLineSegmentsWithCutouts(
            dbLinePoint, 
            offsetLinePoint, 
            wallHeight, 
            wallBaseY,
            cutouts, 
            divisionPosition, 
            finalWallLengthUnscaled, // Pass unscaled length for cutout comparison
            finalStartXUnscaled,
            finalStartYUnscaled,
            finalEndXUnscaled,
            finalEndYUnscaled,
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
        
        // Calculate wall normal EXACTLY matching meshUtils.js logic for precise positioning
        const modelCenter = this.calculateModelCenter();
        const wallMidX = (start_x + end_x) / 2;
        const wallMidY = (start_y + end_y) / 2;
        
        // Wall direction vector (normalized)
        const wallDirX = dx / wallLength;
        const wallDirY = dy / wallLength;
        
        // Perpendicular vector (90-degree rotation: -dy, dx)
        let normX = -wallDirY;
        let normZ = wallDirX;
        
        // Calculate direction to model center (in unscaled mm coordinates)
        const toCenterX = (modelCenter.x / scale) - wallMidX;
        const toCenterY = (modelCenter.z / scale) - wallMidY;
        
        // Choose the normal direction that points toward model center
        // This matches exactly how walls are positioned in meshUtils.js
        const dotProduct = normX * toCenterX + normZ * toCenterY;
        const finalNormX = dotProduct < 0 ? -normX : normX;
        const finalNormZ = dotProduct < 0 ? -normZ : normZ;
        
        // Wall thickness in scaled units
        const wallThickness = thickness * scale;
        
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
        
        // CRITICAL: Position panel division lines on BOTH wall surfaces
        // Use the same precise normal calculation as main panel lines
        const dbLinePoint = { x: divX3D, z: divZ3D };
        const offsetLinePoint = {
          x: divX3D + finalNormX * wallThickness,
          z: divZ3D + finalNormZ * wallThickness
        };
        
        // Create line from wall base to wall top
        const wallTopY = wallBaseY + wallHeight;
        const lineGeometry = new this.THREE.BufferGeometry();
        const vertices = new Float32Array([
          // Line at database coordinate (surface 1)
          dbLinePoint.x, wallBaseY, dbLinePoint.z,
          dbLinePoint.x, wallTopY, dbLinePoint.z,
          // Line offset by wall thickness (surface 2)
          offsetLinePoint.x, wallBaseY, offsetLinePoint.z,
          offsetLinePoint.x, wallTopY, offsetLinePoint.z
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

  clipPolygonByRect(polyPoints, minX, minZ, maxX, maxZ) {
    if (!polyPoints || polyPoints.length < 3) return [];
    
    let output = polyPoints;

    // Clip against Min X
    let input = output; output = [];
    if (input.length === 0) return [];
    let S = input[input.length - 1];
    for (const E of input) {
      if (E.x >= minX) {
        if (S.x < minX) output.push({ x: minX, z: S.z + (E.z - S.z) * (minX - S.x) / (E.x - S.x) });
        output.push(E);
      } else if (S.x >= minX) {
        output.push({ x: minX, z: S.z + (E.z - S.z) * (minX - S.x) / (E.x - S.x) });
      }
      S = E;
    }

    // Clip against Max X
    input = output; output = [];
    if (input.length === 0) return [];
    S = input[input.length - 1];
    for (const E of input) {
      if (E.x <= maxX) {
        if (S.x > maxX) output.push({ x: maxX, z: S.z + (E.z - S.z) * (maxX - S.x) / (E.x - S.x) });
        output.push(E);
      } else if (S.x <= maxX) {
        output.push({ x: maxX, z: S.z + (E.z - S.z) * (maxX - S.x) / (E.x - S.x) });
      }
      S = E;
    }

    // Clip against Min Z
    input = output; output = [];
    if (input.length === 0) return [];
    S = input[input.length - 1];
    for (const E of input) {
      if (E.z >= minZ) {
        if (S.z < minZ) output.push({ x: S.x + (E.x - S.x) * (minZ - S.z) / (E.z - S.z), z: minZ });
        output.push(E);
      } else if (S.z >= minZ) {
        output.push({ x: S.x + (E.x - S.x) * (minZ - S.z) / (E.z - S.z), z: minZ });
      }
      S = E;
    }

    // Clip against Max Z
    input = output; output = [];
    if (input.length === 0) return [];
    S = input[input.length - 1];
    for (const E of input) {
      if (E.z <= maxZ) {
        if (S.z > maxZ) output.push({ x: S.x + (E.x - S.x) * (maxZ - S.z) / (E.z - S.z), z: maxZ });
        output.push(E);
      } else if (S.z <= maxZ) {
        output.push({ x: S.x + (E.x - S.x) * (maxZ - S.z) / (E.z - S.z), z: maxZ });
      }
      S = E;
    }

    return output;
  }

  createCeilingPanelDivisionLines() {
    try {
      // 1. Clear existing lines
      this.ceilingPanelLines.forEach(line => this.scene.remove(line));
      this.ceilingPanelLines = [];
      
      const ceilingPanelsMap = this.calculateCeilingPanels();
      
      Object.values(ceilingPanelsMap).forEach((entry) => {
        const { room, panels, outline_points } = entry;
        if (!panels || panels.length === 0) return;
        
        const scale = this.scalingFactor;
        // Use room base elevation directly (absolute value, no storey elevation)
        const absoluteBaseElevation = room.base_elevation_mm ?? 0;
        const baseElevation = absoluteBaseElevation * scale;
        
        // CRITICAL: Match ceiling mesh positioning exactly
        // The ceiling mesh is positioned at: baseElevation + (maxWallHeight * scale)
        // The top surface varies based on wall heights at each point
        // For panel lines, we need to calculate the ceiling top Y at each point
        
        // Get room walls to calculate max wall height (matching ceiling mesh logic)
        let roomWallIds = [];
        if (Array.isArray(room.walls)) {
          roomWallIds = room.walls.map(w => (typeof w === 'object' ? w.id : w));
        }
        
        // Create a map of wall heights for this room (matching createRoomCeilingMesh logic)
        const wallHeightMap = new Map();
        this.walls.forEach(wall => {
          if (roomWallIds.length === 0 || roomWallIds.includes(wall.id)) {
            wallHeightMap.set(wall.id, wall.height || 0);
          }
        });
        
        // Map each room point to its wall height (matching createRoomCeilingMesh logic)
        const pointHeightMap = new Map();
        room.room_points.forEach((point) => {
          // Find wall that has an endpoint at this point
          const wallAtPoint = this.walls.find(wall => {
            if (roomWallIds.length > 0 && !roomWallIds.includes(wall.id)) {
              return false;
            }
            const distToStart = Math.sqrt(Math.pow(point.x - wall.start_x, 2) + Math.pow(point.y - wall.start_y, 2));
            const distToEnd = Math.sqrt(Math.pow(point.x - wall.end_x, 2) + Math.pow(point.y - wall.end_y, 2));
            return distToStart < 1 || distToEnd < 1; // 1mm tolerance
          });
          
          const wallHeight = wallAtPoint ? (wallAtPoint.height || 0) : 0;
          const pointKey = `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
          pointHeightMap.set(pointKey, wallHeight);
        });
        
        // Find max wall height for this room (matching createRoomCeilingMesh)
        const roomCeilingHeight = this.determineRoomCeilingHeight(room, wallHeightMap, new Map());
        if (!roomCeilingHeight) return;
        
        // Function to get wall height at a 2D point (matching createRoomCeilingMesh)
        const getHeightAtPoint = (pointX, pointY) => {
          // Find closest room point
          let closestPoint = null;
          let minDist = Infinity;
          room.room_points.forEach(point => {
            const dist = Math.sqrt(Math.pow(point.x - pointX, 2) + Math.pow(point.y - pointY, 2));
            if (dist < minDist) {
              minDist = dist;
              closestPoint = point;
            }
          });
          
          if (closestPoint && minDist < 100) { // 100mm tolerance
            const pointKey = `${closestPoint.x.toFixed(2)},${closestPoint.y.toFixed(2)}`;
            return pointHeightMap.get(pointKey) || roomCeilingHeight || 0;
          }
          
          return roomCeilingHeight || 0;
        };
        
        // Calculate ceiling top Y at a point
        // Ceiling mesh position.y = baseElevation + (maxWallHeight * scale)
        // Top surface local Y = (wallHeight - maxWallHeight) * scale
        // World Y = position.y + localY = baseElevation + wallHeight * scale
        const getCeilingTopY = (pointX, pointY) => {
          const wallHeight = getHeightAtPoint(pointX, pointY);
          return baseElevation + (wallHeight * scale) + (0.1 * scale); // Tiny offset for visibility
        };
        
        // 2. Prepare Room/Zone Geometry (in 3D coords)
        // Use zone outline_points if available (for zones), otherwise use room_points
        const geometryPoints = outline_points || room.room_points;
        const roomVertices = geometryPoints.map(point => ({
          x: point.x * scale + this.modelOffset.x,
          z: point.y * scale + this.modelOffset.z
        }));

        // 3. Draw Each Panel (Clipped)
        panels.forEach((panel) => {
           // Calculate Panel Box
           const pStartX = panel.start_x * scale + this.modelOffset.x;
           const pStartZ = panel.start_y * scale + this.modelOffset.z;
           const pEndX = pStartX + (panel.width * scale);
           const pEndZ = pStartZ + (panel.length * scale);

           // CLIP: Intersect Panel Box with Room/Zone Polygon
           // This produces the L-shape if the panel hits a corner
           // For zones, this uses the merged outline_points which properly represents the zone shape
           const clippedShape = this.clipPolygonByRect(roomVertices, pStartX, pStartZ, pEndX, pEndZ);

           if (clippedShape.length > 2) {
             // Create Geometry from clipped points
             // Position lines at ceiling top surface - calculate Y for each point to match sloped ceilings
             const vertices = [];
             clippedShape.forEach(p => {
               // Convert 3D coordinates back to 2D for height lookup
               const pointX = (p.x - this.modelOffset.x) / scale;
               const pointY = (p.z - this.modelOffset.z) / scale;
               const ceilingY = getCeilingTopY(pointX, pointY);
               vertices.push(p.x, ceilingY, p.z);
             });
             // Close loop - recalculate for first point
             const firstPointX = (clippedShape[0].x - this.modelOffset.x) / scale;
             const firstPointY = (clippedShape[0].z - this.modelOffset.z) / scale;
             const firstCeilingY = getCeilingTopY(firstPointX, firstPointY);
             vertices.push(clippedShape[0].x, firstCeilingY, clippedShape[0].z);

             const lineGeometry = new this.THREE.BufferGeometry();
             lineGeometry.setAttribute('position', new this.THREE.Float32BufferAttribute(vertices, 3));

             // Create Material (Thicker and Solid)
             const lineMaterial = new this.THREE.LineBasicMaterial({
               color: panel.is_cut_panel ? 0xFF0000 : 0x00AAAA, // Red for cut, Teal for full
               linewidth: 3, // Request thicker lines
               transparent: false,
               opacity: 1.0,
               depthTest: true
             });

             const line = new this.THREE.Line(lineGeometry, lineMaterial);
             
             // Lines are positioned directly in vertex coordinates (lineY)
             // No additional offset needed - vertices are already at correct height
             line.position.y = 0; 
             
             line.userData.isCeilingPanelLine = true;
             line.visible = this.showCeilingPanelLines;
             
             this.scene.add(line);
             this.ceilingPanelLines.push(line);
           }
        });
      });
      
    } catch (error) {
      console.error('Error creating ceiling panel lines:', error);
    }
  }

  // Calculate the number of ceiling panel lines that will be created
  calculateCeilingPanelLineCount(panels) {
    // Each panel has 4 boundary lines, but shared boundaries are counted once
    // This is a simplified calculation - actual count may vary based on panel arrangement
    return panels.length * 2; // Rough estimate: 2 lines per panel on average
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

  // Helper function to calculate polygon center (centroid)
  calculatePolygonCenter(vertices) {
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

  // Helper function to calculate polygon area (for debugging)
  calculatePolygonArea(vertices) {
    if (!vertices || vertices.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      area += vertices[i].x * vertices[j].z;
      area -= vertices[j].x * vertices[i].z;
    }
    return Math.abs(area) / 2;
  }

  // Calculate extended wall positions for a room (replicating wall extension logic)
  calculateExtendedRoomBoundary(room, wallThickness) {
    if (!room || !room.walls || !this.walls || this.walls.length === 0) {
      return null;
    }

    // Get all walls for this room
    const roomWallIds = Array.isArray(room.walls) 
      ? room.walls.map(w => typeof w === 'object' ? w.id : w)
      : [];
    
    const roomWalls = this.walls.filter(wall => 
      roomWallIds.includes(String(wall.id))
    );

    if (roomWalls.length === 0) {
      return null;
    }

    const scale = this.scalingFactor;
    const modelCenter = this.calculateModelCenter();

    // Helper function to snap values
    function snap(val, precision = 0.01) {
      return Math.round(val / precision) * precision;
    }

    // Calculate extended positions for each wall
    const extendedWalls = roomWalls.map(wall => {
      let startX = snap(wall.start_x * scale);
      let startZ = snap(wall.start_y * scale);
      let endX = snap(wall.end_x * scale);
      let endZ = snap(wall.end_y * scale);

      const isHorizontal = Math.abs(wall.start_y - wall.end_y) < 1e-6;
      const isVertical = Math.abs(wall.start_x - wall.end_x) < 1e-6;

      // Apply wall flipping based on model center (same logic as createWallMesh)
      let finalStartX = startX;
      let finalStartZ = startZ;
      let finalEndX = endX;
      let finalEndZ = endZ;

      if (isHorizontal) {
        if (modelCenter.z * scale < startZ) {
          finalStartX = endX;
          finalEndX = startX;
        }
      } else if (isVertical) {
        if (modelCenter.x * scale > startX) {
          finalStartZ = endZ;
          finalEndZ = startZ;
        }
      }

      // Calculate inward normal
      const dirX = finalEndX - finalStartX;
      const dirZ = finalEndZ - finalStartZ;
      const len = Math.hypot(dirX, dirZ) || 1;
      const ux = dirX / len;
      const uz = dirZ / len;
      let nx = -uz;
      let nz = ux;
      const midX = (finalStartX + finalEndX) / 2;
      const midZ = (finalStartZ + finalEndZ) / 2;
      const toCenterX = (modelCenter.x * scale) - midX;
      const toCenterZ = (modelCenter.z * scale) - midZ;
      const dot = nx * toCenterX + nz * toCenterZ;
      if (dot < 0) {
        nx = -nx;
        nz = -nz;
      }
      const finalNormX = nx;
      const finalNormZ = nz;

      // Apply wall extension (STEP 1 logic)
      if (this.joints && this.joints.length > 0) {
        this.walls.forEach(otherWall => {
          if (String(otherWall.id) === String(wall.id)) return;
          
          const joint = this.joints.find(j => 
            (j.wall_1 === wall.id && j.wall_2 === otherWall.id) ||
            (j.wall_2 === wall.id && j.wall_1 === otherWall.id)
          );
          if (!joint) return;

          const oSX = snap(otherWall.start_x * scale);
          const oSZ = snap(otherWall.start_y * scale);
          const oEX = snap(otherWall.end_x * scale);
          const oEZ = snap(otherWall.end_y * scale);
          const otherThickness = otherWall.thickness * scale;

          const otherIsHorizontal = Math.abs(otherWall.start_y - otherWall.end_y) < 1e-6;
          const otherIsVertical = Math.abs(otherWall.start_x - otherWall.end_x) < 1e-6;

          const otherMidX = (oSX + oEX) / 2;
          const otherMidZ = (oSZ + oEZ) / 2;
          // Model center is already in scaled coordinates, don't scale again
          const toOtherCenterX = modelCenter.x - otherMidX;
          const toOtherCenterZ = modelCenter.z - otherMidZ;
          let otherNormX, otherNormZ;
          if (otherIsHorizontal) {
            otherNormX = 0;
            otherNormZ = toOtherCenterZ < 0 ? -1 : 1;
          } else if (otherIsVertical) {
            otherNormX = toOtherCenterX < 0 ? -1 : 1;
            otherNormZ = 0;
          } else {
            return; // Not perpendicular
          }

          const otherOuterX = oSX;
          const otherOuterZ = oSZ;
          const otherInnerX = oSX + otherNormX * otherThickness;
          const otherInnerZ = oSZ + otherNormZ * otherThickness;

          // Case 1: This wall is horizontal, other wall is vertical
          if (isHorizontal && otherIsVertical) {
            const thisZ = finalStartZ;
            const otherX = oSX;
            const rightmostX = Math.max(otherOuterX, otherInnerX);
            const leftmostX = Math.min(otherOuterX, otherInnerX);
            const otherMinZ = Math.min(oSZ, oEZ);
            const otherMaxZ = Math.max(oSZ, oEZ);
            if (thisZ < otherMinZ || thisZ > otherMaxZ) return;

            const rightEndpointX = Math.max(finalStartX, finalEndX);
            const leftEndpointX = Math.min(finalStartX, finalEndX);
            const thisCenterX = (finalStartX + finalEndX) / 2;
            if (otherX > thisCenterX) {
              if (rightEndpointX < rightmostX) {
                if (finalEndX > finalStartX) {
                  finalEndX = rightmostX;
                } else {
                  finalStartX = rightmostX;
                }
              }
            } else {
              if (leftEndpointX > leftmostX) {
                if (finalStartX < finalEndX) {
                  finalStartX = leftmostX;
                } else {
                  finalEndX = leftmostX;
                }
              }
            }
          }
          // Case 2: This wall is vertical, other wall is horizontal
          else if (isVertical && otherIsHorizontal) {
            const thisX = finalStartX;
            const otherZ = oSZ;
            const topmostZ = Math.max(otherOuterZ, otherInnerZ);
            const bottommostZ = Math.min(otherOuterZ, otherInnerZ);
            const otherMinX = Math.min(oSX, oEX);
            const otherMaxX = Math.max(oSX, oEX);
            if (thisX < otherMinX || thisX > otherMaxX) return;

            const topEndpointZ = Math.max(finalStartZ, finalEndZ);
            const bottomEndpointZ = Math.min(finalStartZ, finalEndZ);
            const thisCenterZ = (finalStartZ + finalEndZ) / 2;
            if (otherZ > thisCenterZ) {
              if (topEndpointZ < topmostZ) {
                if (finalEndZ > finalStartZ) {
                  finalEndZ = topmostZ;
                } else {
                  finalStartZ = topmostZ;
                }
              }
            } else {
              if (bottomEndpointZ > bottommostZ) {
                if (finalStartZ < finalEndZ) {
                  finalStartZ = bottommostZ;
                } else {
                  finalEndZ = bottommostZ;
                }
              }
            }
          }
        });
      }

      // Calculate wall thickness
      const wallThicknessScaled = wall.thickness * scale;

      // Calculate inner face line
      // The wall mesh is positioned so the database line (finalStartX, finalStartZ) is the OUTER face,
      // and thickness extends toward the model center (in the direction of finalNormX, finalNormZ).
      // The wall geometry is extruded in +Z direction, and after rotation, +Z becomes the thickness direction.
      // So: Outer face (Z=0) = database line, Inner face (Z=thickness) = database line + (normal * thickness)
      // Since finalNormX/finalNormZ point INWARD (toward model center), we add them to get inner face
      const innerStartX = finalStartX + finalNormX * wallThicknessScaled;
      const innerStartZ = finalStartZ + finalNormZ * wallThicknessScaled;
      const innerEndX = finalEndX + finalNormX * wallThicknessScaled;
      const innerEndZ = finalEndZ + finalNormZ * wallThicknessScaled;

      return {
        wallId: wall.id,
        innerStart: { x: innerStartX, z: innerStartZ },
        innerEnd: { x: innerEndX, z: innerEndZ },
        originalStart: { x: startX, z: startZ },
        originalEnd: { x: endX, z: endZ },
        extendedStart: { x: finalStartX, z: finalStartZ },
        extendedEnd: { x: finalEndX, z: finalEndZ },
        normal: { x: finalNormX, z: finalNormZ }
      };
    });

    // Build polygon from inner face lines
    // This is a simplified approach - connect inner face endpoints in order
    // For a proper implementation, we'd need to find intersections and build a proper polygon
    const boundaryPoints = [];
    const usedWalls = new Set();

    // Start with the first wall
    if (extendedWalls.length > 0) {
      let currentWall = extendedWalls[0];
      boundaryPoints.push(currentWall.innerStart);
      usedWalls.add(currentWall.wallId);

      // Find connected walls and build the boundary
      let attempts = 0;
      while (boundaryPoints.length < extendedWalls.length && attempts < extendedWalls.length * 2) {
        attempts++;
        const lastPoint = boundaryPoints[boundaryPoints.length - 1];
        let foundNext = false;

        // Find a wall whose start or end point is close to the last point
        for (const wall of extendedWalls) {
          if (usedWalls.has(wall.wallId)) continue;

          const distToStart = Math.hypot(
            lastPoint.x - wall.innerStart.x,
            lastPoint.z - wall.innerStart.z
          );
          const distToEnd = Math.hypot(
            lastPoint.x - wall.innerEnd.x,
            lastPoint.z - wall.innerEnd.z
          );

          const tolerance = 10 * scale; // 10mm tolerance

          if (distToStart < tolerance) {
            boundaryPoints.push(wall.innerEnd);
            usedWalls.add(wall.wallId);
            foundNext = true;
            break;
          } else if (distToEnd < tolerance) {
            boundaryPoints.push(wall.innerStart);
            usedWalls.add(wall.wallId);
            foundNext = true;
            break;
          }
        }

        if (!foundNext) {
          // Try to find closest point
          let minDist = Infinity;
          let closestWall = null;
          let useStart = true;

          for (const wall of extendedWalls) {
            if (usedWalls.has(wall.wallId)) continue;

            const distToStart = Math.hypot(
              lastPoint.x - wall.innerStart.x,
              lastPoint.z - wall.innerStart.z
            );
            const distToEnd = Math.hypot(
              lastPoint.x - wall.innerEnd.x,
              lastPoint.z - wall.innerEnd.z
            );

            if (distToStart < minDist) {
              minDist = distToStart;
              closestWall = wall;
              useStart = true;
            }
            if (distToEnd < minDist) {
              minDist = distToEnd;
              closestWall = wall;
              useStart = false;
            }
          }

          if (closestWall && minDist < 1000 * scale) { // 1m max gap
            if (useStart) {
              boundaryPoints.push(closestWall.innerEnd);
            } else {
              boundaryPoints.push(closestWall.innerStart);
            }
            usedWalls.add(closestWall.wallId);
            foundNext = true;
          } else {
            break; // No more connected walls
          }
        }
      }
    }

    // Convert to room_points format (x, y instead of x, z)
    if (boundaryPoints.length >= 3) {
      return boundaryPoints.map(point => ({
        x: (point.x - this.modelOffset.x) / scale,
        y: (point.z - this.modelOffset.z) / scale
      }));
    }

    // Fallback to original room_points if we couldn't build boundary
    return room.room_points;
  }

  // Build floor boundary directly from extended wall inner faces
  // This ensures the floor aligns with the actual rendered wall positions
  buildFloorBoundaryFromExtendedInnerFaces(room, wallThickness) {
    if (!room || !this.walls || !this.joints) {
      return null;
    }

    // Get all walls for this room
    const roomWallIds = Array.isArray(room.walls) 
      ? room.walls.map(w => typeof w === 'object' ? w.id : w)
      : [];
    
    const roomWalls = this.walls.filter(wall => 
      roomWallIds.includes(String(wall.id))
    );

    if (roomWalls.length === 0) {
      return null;
    }

    const scale = this.scalingFactor;
    const modelCenter = this.calculateModelCenter();

    function snap(val, precision = 0.01) {
      return Math.round(val / precision) * precision;
    }

    // Calculate extended inner face endpoints for each room wall
    const innerFaceEndpoints = [];

    roomWalls.forEach(wall => {
      let startX = snap(wall.start_x * scale);
      let startZ = snap(wall.start_y * scale);
      let endX = snap(wall.end_x * scale);
      let endZ = snap(wall.end_y * scale);

      const isHorizontal = Math.abs(wall.start_y - wall.end_y) < 1e-6;
      const isVertical = Math.abs(wall.start_x - wall.end_x) < 1e-6;

      // Apply wall flipping (same as createWallMesh)
      let finalStartX = startX;
      let finalStartZ = startZ;
      let finalEndX = endX;
      let finalEndZ = endZ;

      if (isHorizontal) {
        if (modelCenter.z * scale < startZ) {
          finalStartX = endX;
          finalEndX = startX;
        }
      } else if (isVertical) {
        if (modelCenter.x * scale > startX) {
          finalStartZ = endZ;
          finalEndZ = startZ;
        }
      }

      // Calculate inward normal
      const dirX = finalEndX - finalStartX;
      const dirZ = finalEndZ - finalStartZ;
      const len = Math.hypot(dirX, dirZ) || 1;
      const ux = dirX / len;
      const uz = dirZ / len;
      let nx = -uz;
      let nz = ux;
      const midX = (finalStartX + finalEndX) / 2;
      const midZ = (finalStartZ + finalEndZ) / 2;
      const toCenterX = (modelCenter.x * scale) - midX;
      const toCenterZ = (modelCenter.z * scale) - midZ;
      const dot = nx * toCenterX + nz * toCenterZ;
      if (dot < 0) {
        nx = -nx;
        nz = -nz;
      }
      const finalNormX = nx;
      const finalNormZ = nz;

      // Apply wall extension (same logic as createWallMesh STEP 1)
      if (this.joints && this.joints.length > 0) {
        this.walls.forEach(otherWall => {
          if (String(otherWall.id) === String(wall.id)) return;
          
          const joint = this.joints.find(j => 
            (j.wall_1 === wall.id && j.wall_2 === otherWall.id) ||
            (j.wall_2 === wall.id && j.wall_1 === otherWall.id)
          );
          if (!joint) return;

          const oSX = snap(otherWall.start_x * scale);
          const oSZ = snap(otherWall.start_y * scale);
          const oEX = snap(otherWall.end_x * scale);
          const oEZ = snap(otherWall.end_y * scale);
          const otherThickness = otherWall.thickness * scale;

          const otherIsHorizontal = Math.abs(otherWall.start_y - otherWall.end_y) < 1e-6;
          const otherIsVertical = Math.abs(otherWall.start_x - otherWall.end_x) < 1e-6;

          const otherMidX = (oSX + oEX) / 2;
          const otherMidZ = (oSZ + oEZ) / 2;
          // Model center is already in scaled coordinates, don't scale again
          const toOtherCenterX = modelCenter.x - otherMidX;
          const toOtherCenterZ = modelCenter.z - otherMidZ;
          let otherNormX, otherNormZ;
          if (otherIsHorizontal) {
            otherNormX = 0;
            otherNormZ = toOtherCenterZ < 0 ? -1 : 1;
          } else if (otherIsVertical) {
            otherNormX = toOtherCenterX < 0 ? -1 : 1;
            otherNormZ = 0;
          } else {
            return;
          }

          const otherOuterX = oSX;
          const otherOuterZ = oSZ;
          const otherInnerX = oSX + otherNormX * otherThickness;
          const otherInnerZ = oSZ + otherNormZ * otherThickness;

          if (isHorizontal && otherIsVertical) {
            const thisZ = finalStartZ;
            const otherX = oSX;
            const rightmostX = Math.max(otherOuterX, otherInnerX);
            const leftmostX = Math.min(otherOuterX, otherInnerX);
            const otherMinZ = Math.min(oSZ, oEZ);
            const otherMaxZ = Math.max(oSZ, oEZ);
            if (thisZ < otherMinZ || thisZ > otherMaxZ) return;

            const rightEndpointX = Math.max(finalStartX, finalEndX);
            const leftEndpointX = Math.min(finalStartX, finalEndX);
            const thisCenterX = (finalStartX + finalEndX) / 2;
            if (otherX > thisCenterX) {
              if (rightEndpointX < rightmostX) {
                if (finalEndX > finalStartX) {
                  finalEndX = rightmostX;
                } else {
                  finalStartX = rightmostX;
                }
              }
            } else {
              if (leftEndpointX > leftmostX) {
                if (finalStartX < finalEndX) {
                  finalStartX = leftmostX;
                } else {
                  finalEndX = leftmostX;
                }
              }
            }
          } else if (isVertical && otherIsHorizontal) {
            const thisX = finalStartX;
            const otherZ = oSZ;
            const topmostZ = Math.max(otherOuterZ, otherInnerZ);
            const bottommostZ = Math.min(otherOuterZ, otherInnerZ);
            const otherMinX = Math.min(oSX, oEX);
            const otherMaxX = Math.max(oSX, oEX);
            if (thisX < otherMinX || thisX > otherMaxX) return;

            const topEndpointZ = Math.max(finalStartZ, finalEndZ);
            const bottomEndpointZ = Math.min(finalStartZ, finalEndZ);
            const thisCenterZ = (finalStartZ + finalEndZ) / 2;
            if (otherZ > thisCenterZ) {
              if (topEndpointZ < topmostZ) {
                if (finalEndZ > finalStartZ) {
                  finalEndZ = topmostZ;
                } else {
                  finalStartZ = topmostZ;
                }
              }
            } else {
              if (bottomEndpointZ > bottommostZ) {
                if (finalStartZ < finalEndZ) {
                  finalStartZ = bottommostZ;
                } else {
                  finalEndZ = bottommostZ;
                }
              }
            }
          }
        });
      }

      // Calculate inner face positions (where the floor should align)
      const wallThicknessScaled = wall.thickness * scale;
      const innerStartX = finalStartX + finalNormX * wallThicknessScaled;
      const innerStartZ = finalStartZ + finalNormZ * wallThicknessScaled;
      const innerEndX = finalEndX + finalNormX * wallThicknessScaled;
      const innerEndZ = finalEndZ + finalNormZ * wallThicknessScaled;

      // Add both endpoints of the inner face
      innerFaceEndpoints.push(
        { x: innerStartX, z: innerStartZ, wallId: wall.id, isStart: true },
        { x: innerEndX, z: innerEndZ, wallId: wall.id, isStart: false }
      );
    });

    // Build a closed polygon from the inner face endpoints
    if (innerFaceEndpoints.length < 6) {
      return null; // Need at least 3 walls (6 endpoints)
    }

    // Use the same polygon building logic as calculateExtendedRoomBoundary
    // Sort endpoints to form a connected polygon
    const boundaryPoints = [];
    const used = new Set();
    
    // Start with the first endpoint
    let current = innerFaceEndpoints[0];
    boundaryPoints.push({ x: current.x, z: current.z });
    used.add(0);

    // Build polygon by finding closest unused endpoint
    while (boundaryPoints.length < innerFaceEndpoints.length && used.size < innerFaceEndpoints.length) {
      let closestIdx = -1;
      let closestDist = Infinity;
      
      for (let i = 0; i < innerFaceEndpoints.length; i++) {
        if (used.has(i)) continue;
        const dist = Math.hypot(
          innerFaceEndpoints[i].x - current.x,
          innerFaceEndpoints[i].z - current.z
        );
        if (dist < closestDist && dist < 200 * scale) { // 200mm tolerance for connecting endpoints
          closestDist = dist;
          closestIdx = i;
        }
      }

      if (closestIdx === -1) {
        // No close endpoint found, try to close the polygon
        break;
      }

      current = innerFaceEndpoints[closestIdx];
      boundaryPoints.push({ x: current.x, z: current.z });
      used.add(closestIdx);
    }

    // Ensure polygon is closed
    if (boundaryPoints.length >= 3) {
      // Check if first and last are close
      const first = boundaryPoints[0];
      const last = boundaryPoints[boundaryPoints.length - 1];
      const dist = Math.hypot(last.x - first.x, last.z - first.z);
      if (dist > 10 * scale) {
        // Not closed, add first point again
        boundaryPoints.push({ x: first.x, z: first.z });
      }
      return boundaryPoints;
    }

    return null;
  }

  // Selective shrinking: Only shrink vertices that are OUTSIDE the wall inner faces
  // This prevents gaps while avoiding overlap
  shrinkPolygonSelectivelyByInnerFace(vertices, room, wallThickness) {
    console.log(`[Floor Shrink] shrinkPolygonSelectivelyByInnerFace called for room ${room?.id}`, {
      verticesCount: vertices?.length,
      hasRoom: !!room,
      hasWalls: !!this.walls,
      hasJoints: !!this.joints,
      wallsCount: this.walls?.length,
      jointsCount: this.joints?.length
    });

    if (!vertices || vertices.length < 3 || !room || !this.walls || !this.joints) {
      console.log(`[Floor Shrink] Fallback to standard shrink - missing data`);
      // Fallback to standard shrink if we can't analyze
      return this.shrinkPolygonByWallThickness(vertices, wallThickness);
    }

    // Get all walls for this room
    const roomWallIds = Array.isArray(room.walls) 
      ? room.walls.map(w => String(typeof w === 'object' ? w.id : w))
      : [];
    
    console.log(`[Floor Shrink] Room ${room.id} wall IDs (as strings):`, roomWallIds);
    console.log(`[Floor Shrink] Available walls:`, this.walls.map(w => ({ id: w.id, idType: typeof w.id, idString: String(w.id) })));
    
    const roomWalls = this.walls.filter(wall => 
      roomWallIds.includes(String(wall.id))
    );

    console.log(`[Floor Shrink] Found ${roomWalls.length} walls for room ${room.id}:`, roomWalls.map(w => ({ id: w.id, start: `${w.start_x},${w.start_y}`, end: `${w.end_x},${w.end_y}` })));

    if (roomWalls.length === 0) {
      console.error(`[Floor Shrink] ERROR: No walls matched!`, {
        roomWallIds,
        availableWallIds: this.walls.map(w => String(w.id)),
        roomWallsData: room.walls,
        firstWallId: this.walls[0] ? { id: this.walls[0].id, idType: typeof this.walls[0].id } : 'no walls'
      });
      console.log(`[Floor Shrink] No walls found, using standard shrink`);
      // No walls, use standard shrink
      return this.shrinkPolygonByWallThickness(vertices, wallThickness);
    }

    const scale = this.scalingFactor;
    const modelCenter = this.calculateModelCenter();
    const tolerance = 200 * scale; // 200mm tolerance for point matching (increased to catch all vertices)

    function snap(val, precision = 0.01) {
      return Math.round(val / precision) * precision;
    }

    // Helper function to calculate line intersection (same as meshUtils.js)
    const calculateLineIntersection = (x1, y1, x2, y2, x3, y3, x4, y4, allowExtended = false) => {
      const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(denominator) < 1e-10) {
        return null;
      }
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
      const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;
      const intersectionX = x1 + t * (x2 - x1);
      const intersectionZ = y1 + t * (y2 - y1);
      if (allowExtended || (t >= 0 && t <= 1 && u >= 0 && u <= 1)) {
        return { x: intersectionX, z: intersectionZ, t, u };
      }
      return null;
    };

    // Calculate extended inner face for each room wall (same logic as createWallMesh)
    console.log(`[Floor Shrink] Calculating inner faces for ${roomWalls.length} walls`);
    const wallInnerFaces = roomWalls.map(wall => {
      console.log(`[Floor Shrink] Processing wall ${wall.id}`);
      let startX = snap(wall.start_x * scale);
      let startZ = snap(wall.start_y * scale);
      let endX = snap(wall.end_x * scale);
      let endZ = snap(wall.end_y * scale);

      const isHorizontal = Math.abs(wall.start_y - wall.end_y) < 1e-6;
      const isVertical = Math.abs(wall.start_x - wall.end_x) < 1e-6;

      // Apply wall flipping (same as createWallMesh)
      // Model center is already in scaled coordinates, don't scale again
      let finalStartX = startX;
      let finalStartZ = startZ;
      let finalEndX = endX;
      let finalEndZ = endZ;

      if (isHorizontal) {
        if (modelCenter.z < startZ) {
          finalStartX = endX;
          finalEndX = startX;
        }
      } else if (isVertical) {
        if (modelCenter.x > startX) {
          finalStartZ = endZ;
          finalEndZ = startZ;
        }
      }

      // Calculate inward normal (same as createWallMesh)
      // IMPORTANT: Normal is calculated BEFORE extension, but we'll recalculate after extension
      // to ensure it's correct for the extended wall position
      // CRITICAL: Apply the same flipped logic as after extension
      let finalNormX, finalNormZ;
      {
        const dirX = finalEndX - finalStartX;
        const dirZ = finalEndZ - finalStartZ;
        const len = Math.hypot(dirX, dirZ) || 1;
        const ux = dirX / len;
        const uz = dirZ / len;
        let nx = -uz;
        let nz = ux;
        const midX = (finalStartX + finalEndX) / 2;
        const midZ = (finalStartZ + finalEndZ) / 2;
        // Model center is already in scaled coordinates, don't scale again
        const toCenterX = modelCenter.x - midX;
        const toCenterZ = modelCenter.z - midZ;
        const dot = nx * toCenterX + nz * toCenterZ;
        // FLIPPED LOGIC: If dot > 0, flip (because actual rendering has opposite direction)
        if (dot > 0) {
          nx = -nx;
          nz = -nz;
        }
        finalNormX = nx;
        finalNormZ = nz;
      }

      // Store original coordinates before extension for debugging
      const originalFinalStartX = finalStartX;
      const originalFinalStartZ = finalStartZ;
      const originalFinalEndX = finalEndX;
      const originalFinalEndZ = finalEndZ;

      // Apply wall extension (same logic as createWallMesh STEP 1)
      if (this.joints && this.joints.length > 0) {
        this.walls.forEach(otherWall => {
          if (String(otherWall.id) === String(wall.id)) return;
          
          const joint = this.joints.find(j => 
            (j.wall_1 === wall.id && j.wall_2 === otherWall.id) ||
            (j.wall_2 === wall.id && j.wall_1 === otherWall.id)
          );
          if (!joint) return;

          const oSX = snap(otherWall.start_x * scale);
          const oSZ = snap(otherWall.start_y * scale);
          const oEX = snap(otherWall.end_x * scale);
          const oEZ = snap(otherWall.end_y * scale);
          const otherThickness = otherWall.thickness * scale;

          const otherIsHorizontal = Math.abs(otherWall.start_y - otherWall.end_y) < 1e-6;
          const otherIsVertical = Math.abs(otherWall.start_x - otherWall.end_x) < 1e-6;

          const otherMidX = (oSX + oEX) / 2;
          const otherMidZ = (oSZ + oEZ) / 2;
          // Model center is already in scaled coordinates, don't scale again
          const toOtherCenterX = modelCenter.x - otherMidX;
          const toOtherCenterZ = modelCenter.z - otherMidZ;
          let otherNormX, otherNormZ;
          if (otherIsHorizontal) {
            otherNormX = 0;
            otherNormZ = toOtherCenterZ < 0 ? -1 : 1;
          } else if (otherIsVertical) {
            otherNormX = toOtherCenterX < 0 ? -1 : 1;
            otherNormZ = 0;
          } else {
            return;
          }

          const otherOuterX = oSX;
          const otherOuterZ = oSZ;
          const otherInnerX = oSX + otherNormX * otherThickness;
          const otherInnerZ = oSZ + otherNormZ * otherThickness;

          if (isHorizontal && otherIsVertical) {
            const thisZ = finalStartZ;
            const otherX = oSX;
            const rightmostX = Math.max(otherOuterX, otherInnerX);
            const leftmostX = Math.min(otherOuterX, otherInnerX);
            const otherMinZ = Math.min(oSZ, oEZ);
            const otherMaxZ = Math.max(oSZ, oEZ);
            if (thisZ < otherMinZ || thisZ > otherMaxZ) return;

            const rightEndpointX = Math.max(finalStartX, finalEndX);
            const leftEndpointX = Math.min(finalStartX, finalEndX);
            const thisCenterX = (finalStartX + finalEndX) / 2;
            if (otherX > thisCenterX) {
              if (rightEndpointX < rightmostX) {
                if (finalEndX > finalStartX) {
                  finalEndX = rightmostX;
                } else {
                  finalStartX = rightmostX;
                }
              }
            } else {
              if (leftEndpointX > leftmostX) {
                if (finalStartX < finalEndX) {
                  finalStartX = leftmostX;
                } else {
                  finalEndX = leftmostX;
                }
              }
            }
          } else if (isVertical && otherIsHorizontal) {
            const thisX = finalStartX;
            const otherZ = oSZ;
            const topmostZ = Math.max(otherOuterZ, otherInnerZ);
            const bottommostZ = Math.min(otherOuterZ, otherInnerZ);
            const otherMinX = Math.min(oSX, oEX);
            const otherMaxX = Math.max(oSX, oEX);
            if (thisX < otherMinX || thisX > otherMaxX) return;

            const topEndpointZ = Math.max(finalStartZ, finalEndZ);
            const bottomEndpointZ = Math.min(finalStartZ, finalEndZ);
            const thisCenterZ = (finalStartZ + finalEndZ) / 2;
            if (otherZ > thisCenterZ) {
              if (topEndpointZ < topmostZ) {
                if (finalEndZ > finalStartZ) {
                  finalEndZ = topmostZ;
                } else {
                  finalStartZ = topmostZ;
                }
              }
            } else {
              if (bottomEndpointZ > bottommostZ) {
                if (finalStartZ < finalEndZ) {
                  finalStartZ = bottommostZ;
                } else {
                  finalEndZ = bottommostZ;
                }
              }
            }
          }
        });
      }

      // STEP 1.5: Apply butt-in joint shortening (same as createWallMesh)
      // Shorten wall_1 at joints where joining_method is 'butt_in'
      if (this.joints && this.joints.length > 0) {
        const buttInJoints = this.joints.filter(j => 
          j.joining_method === 'butt_in' && 
          (j.wall_1 === wall.id || j.wall_2 === wall.id)
        );
        
        if (buttInJoints.length > 0) {
          let shouldShortenStart = false;
          let shouldShortenEnd = false;
          let startShorteningThickness = 0;
          let endShorteningThickness = 0;

          buttInJoints.forEach(j => {
            const otherWallId = j.wall_1 === wall.id ? j.wall_2 : j.wall_1;
            const otherWall = this.walls.find(w => String(w.id) === String(otherWallId));
            if (!otherWall) return;

            const isWall1 = j.wall_1 === wall.id;
            if (!isWall1) return; // Only shorten wall_1

            const joiningWallThickness = (otherWall.thickness || wall.thickness) * scale;
            let oSX = snap(otherWall.start_x * scale);
            let oSZ = snap(otherWall.start_y * scale);
            let oEX = snap(otherWall.end_x * scale);
            let oEZ = snap(otherWall.end_y * scale);

            const intersection = calculateLineIntersection(
              finalStartX, finalStartZ, finalEndX, finalEndZ,
              oSX, oSZ, oEX, oEZ,
              true // allowExtended = true
            );
            if (!intersection) return;

            const jointX = snap(intersection.x);
            const jointZ = snap(intersection.z);
            const startDist = Math.hypot(jointX - finalStartX, jointZ - finalStartZ);
            const endDist = Math.hypot(jointX - finalEndX, jointZ - finalEndZ);
            const tolerance = 0.1; // 10cm tolerance
            const isCloserToStart = startDist < endDist;

            if (isCloserToStart && (startDist < tolerance || startDist < endDist * 0.5)) {
              shouldShortenStart = true;
              startShorteningThickness = Math.max(startShorteningThickness, joiningWallThickness);
            }
            if (!isCloserToStart && (endDist < tolerance || endDist < startDist * 0.5)) {
              shouldShortenEnd = true;
              endShorteningThickness = Math.max(endShorteningThickness, joiningWallThickness);
            }
          });

          // Apply shortening
          if (shouldShortenStart || shouldShortenEnd) {
            const wallDirX = finalEndX - finalStartX;
            const wallDirZ = finalEndZ - finalStartZ;
            const wallLen = Math.hypot(wallDirX, wallDirZ) || 1;
            const wallDirNormX = wallDirX / wallLen;
            const wallDirNormZ = wallDirZ / wallLen;

            if (shouldShortenStart) {
              finalStartX = finalStartX + wallDirNormX * startShorteningThickness;
              finalStartZ = finalStartZ + wallDirNormZ * startShorteningThickness;
            }
            if (shouldShortenEnd) {
              finalEndX = finalEndX - wallDirNormX * endShorteningThickness;
              finalEndZ = finalEndZ - wallDirNormZ * endShorteningThickness;
            }
          }
        }
      }

      // Recalculate normal AFTER extension and shortening to ensure it's correct
      // (Extension might change the wall's midpoint, affecting normal direction)
      // IMPORTANT: The normal should point TOWARD the model center (room interior)
      {
        const dirX = finalEndX - finalStartX;
        const dirZ = finalEndZ - finalStartZ;
        const len = Math.hypot(dirX, dirZ) || 1;
        const ux = dirX / len;
        const uz = dirZ / len;
        // Perpendicular vectors: (-uz, ux) and (uz, -ux)
        // Choose the one pointing toward model center
        let nx = -uz;
        let nz = ux;
        const midX = (finalStartX + finalEndX) / 2;
        const midZ = (finalStartZ + finalEndZ) / 2;
        // Vector from wall midpoint to model center
        // Model center is already in scaled coordinates, don't scale again
        const toCenterX = modelCenter.x - midX;
        const toCenterZ = modelCenter.z - midZ;
        // Dot product: if negative, normal points away from center, so flip it
        // CRITICAL FIX: User reports Wall 7255 thickness goes toward -y (up) when it should go toward +y (down)
        // Wall 7255 is at y=2243, model center is at y=2500 (below wall)
        // Normal SHOULD point toward +y (down) to point toward center
        // But user sees thickness going toward -y (up), meaning normal is pointing AWAY from center
        // This suggests the normal calculation logic is INVERTED
        const dot = nx * toCenterX + nz * toCenterZ;
        // FLIP THE LOGIC: If dot > 0 (points toward center in calculation), 
        // the actual rendered wall has thickness in OPPOSITE direction, so flip it
        if (dot > 0) {
          nx = -nx;
          nz = -nz;
        }
        // If dot < 0 (points away in calculation), that matches actual rendering, so keep it
        finalNormX = nx;
        finalNormZ = nz;
        
        // Debug: Verify normal direction
        if (wall.id === 7255) {
          const wallY = finalStartZ;
          const centerY = modelCenter.z * scale;
          const normalYComponent = finalNormZ;
          console.log(`[Normal Debug] Wall ${wall.id} normal calculation:`, {
            wallDir: { x: ux, z: uz },
            normalBeforeFlip: { x: -uz, z: ux },
            toCenter: { x: toCenterX, z: toCenterZ },
            dot,
            finalNormal: { x: finalNormX, z: finalNormZ },
            midPoint: { x: midX, z: midZ },
            modelCenter: { x: modelCenter.x * scale, z: modelCenter.z * scale },
            wallY,
            centerY,
            normalYComponent,
            expectedDirection: centerY > wallY ? "toward +y (down)" : "toward -y (up)",
            actualDirection: normalYComponent > 0 ? "toward +y (down)" : "toward -y (up)",
            note: "For Wall 7255 at y=2243, center at y=2500, normal should point toward +y (down), but user sees thickness toward -y (up), so we flipped the logic"
          });
        }
      }

      // Calculate inner face positions (where the floor should align)
      // The normal points TOWARD the model center (room interior)
      // Inner face = outer face + (normal * thickness) moves the face inward
      const wallThicknessScaled = wall.thickness * scale;
      
      // Determine wall orientation FIRST (before calculating inner face)
      const isWallHorizontal = Math.abs(finalStartZ - finalEndZ) < 1e-6;
      const isWallVertical = Math.abs(finalStartX - finalEndX) < 1e-6;
      
      // For horizontal walls: ensure inner face has constant Z (use average if start/end differ slightly)
      // For vertical walls: ensure inner face has constant X (use average if start/end differ slightly)
      let innerStartX, innerStartZ, innerEndX, innerEndZ;
      
      if (isWallHorizontal) {
        // Horizontal wall: inner face should have constant Z
        // Use average Z to ensure it's perfectly horizontal
        const avgZ = (finalStartZ + finalEndZ) / 2;
        const innerZ = avgZ + finalNormZ * wallThicknessScaled;
        innerStartX = finalStartX + finalNormX * wallThicknessScaled;
        innerStartZ = innerZ; // Use same Z for both
        innerEndX = finalEndX + finalNormX * wallThicknessScaled;
        innerEndZ = innerZ; // Use same Z for both
      } else if (isWallVertical) {
        // Vertical wall: inner face should have constant X
        // Use average X to ensure it's perfectly vertical
        const avgX = (finalStartX + finalEndX) / 2;
        const innerX = avgX + finalNormX * wallThicknessScaled;
        innerStartX = innerX; // Use same X for both
        innerStartZ = finalStartZ + finalNormZ * wallThicknessScaled;
        innerEndX = innerX; // Use same X for both
        innerEndZ = finalEndZ + finalNormZ * wallThicknessScaled;
      } else {
        // Diagonal wall: calculate normally
        innerStartX = finalStartX + finalNormX * wallThicknessScaled;
        innerStartZ = finalStartZ + finalNormZ * wallThicknessScaled;
        innerEndX = finalEndX + finalNormX * wallThicknessScaled;
        innerEndZ = finalEndZ + finalNormZ * wallThicknessScaled;
      }

      // Debug logging for Wall 7255
      if (wall.id === 7255) {
        console.log(`[Floor Shrink Debug] Wall ${wall.id} (7255) - Inner Face Calculation:`, {
          originalStart: { x: startX, z: startZ },
          originalEnd: { x: endX, z: endZ },
          beforeExtension: { startX: originalFinalStartX, startZ: originalFinalStartZ, endX: originalFinalEndX, endZ: originalFinalEndZ },
          afterExtension: { startX: finalStartX, startZ: finalStartZ, endX: finalEndX, endZ: finalEndZ },
          normal: { x: finalNormX, z: finalNormZ },
          wallThicknessScaled,
          isHorizontal: isWallHorizontal,
          isVertical: isWallVertical,
          innerStart: { x: innerStartX, z: innerStartZ },
          innerEnd: { x: innerEndX, z: innerEndZ },
          innerFaceY: innerStartZ, // This is the Y coordinate in screen space (y=0 is top)
          outerFaceY: finalStartZ,  // Original Y coordinate
          yDifference: innerStartZ - finalStartZ, // Positive = moved DOWN, Negative = moved UP
          note: "yDifference > 0 means inner face moved DOWN (away from y=0), yDifference < 0 means moved UP (toward y=0)"
        });
      }

      return {
        wallId: wall.id,
        innerStart: { x: innerStartX, z: innerStartZ },
        innerEnd: { x: innerEndX, z: innerEndZ },
        normal: { x: finalNormX, z: finalNormZ },
        isHorizontal: isWallHorizontal,
        isVertical: isWallVertical,
        // For horizontal walls: constant Z coordinate (ensured above)
        innerZ: isWallHorizontal ? innerStartZ : null,
        // For vertical walls: constant X coordinate (ensured above)
        innerX: isWallVertical ? innerStartX : null
      };
    });

    // For each vertex, check if it's outside the inner face
    // Only shrink vertices that are outside; keep vertices at or inside (prevents gaps)
    const shrunkVertices = vertices.map((vertex, vertexIndex) => {
      let closestWallFace = null;
      let closestDistance = Infinity;
      let closestPointOnFace = null;
      let closestNormal = null;
      let isOnWallEdge = false; // Track if vertex is actually on a wall edge

      // First pass: Check if vertex is ON a wall edge (within 1mm tolerance)
      // This takes priority over distance-based matching
      wallInnerFaces.forEach((face, faceIndex) => {
        const innerStart = face.innerStart;
        const innerEnd = face.innerEnd;
        
        // Get wall thickness for this face
        const wall = roomWalls[faceIndex];
        const wallThicknessScaled = (wall?.thickness || wallThickness) * scale;
        
        // Check if vertex is on the outer face (database line) of this wall
        // Convert inner face back to outer face for comparison
        const outerStartX = innerStart.x - face.normal.x * wallThicknessScaled;
        const outerStartZ = innerStart.z - face.normal.z * wallThicknessScaled;
        const outerEndX = innerEnd.x - face.normal.x * wallThicknessScaled;
        const outerEndZ = innerEnd.z - face.normal.z * wallThicknessScaled;
        
        const outerDx = outerEndX - outerStartX;
        const outerDz = outerEndZ - outerStartZ;
        const outerLengthSq = outerDx * outerDx + outerDz * outerDz;
        
        if (outerLengthSq > 1e-6) {
          // Project vertex onto outer face line
          const toOuterStartX = vertex.x - (outerStartX + this.modelOffset.x);
          const toOuterStartZ = vertex.z - (outerStartZ + this.modelOffset.z);
          const t = (toOuterStartX * outerDx + toOuterStartZ * outerDz) / outerLengthSq;
          
          // Check if projection is within wall segment (with small extension tolerance)
          if (t >= -0.01 && t <= 1.01) {
            const projX = outerStartX + this.modelOffset.x + t * outerDx;
            const projZ = outerStartZ + this.modelOffset.z + t * outerDz;
            const distToOuter = Math.hypot(vertex.x - projX, vertex.z - projZ);
            
            // If vertex is very close to outer face (within 2mm), it's on this wall
            // Use slightly larger tolerance to account for floating point precision
            if (distToOuter < 2 * scale) {
              isOnWallEdge = true;
              // Calculate inner face position for this vertex
              let innerOnFace;
              if (face.isHorizontal && face.innerZ !== null) {
                innerOnFace = {
                  x: vertex.x,
                  z: face.innerZ + this.modelOffset.z
                };
              } else if (face.isVertical && face.innerX !== null) {
                innerOnFace = {
                  x: face.innerX + this.modelOffset.x,
                  z: vertex.z
                };
              } else {
                // Diagonal: project to inner face
                const innerDx = innerEnd.x - innerStart.x;
                const innerDz = innerEnd.z - innerStart.z;
                innerOnFace = {
                  x: innerStart.x + this.modelOffset.x + t * innerDx,
                  z: innerStart.z + this.modelOffset.z + t * innerDz
                };
              }
              
              const distToInner = Math.hypot(vertex.x - innerOnFace.x, vertex.z - innerOnFace.z);
              if (distToInner < closestDistance) {
                closestDistance = distToInner;
                closestWallFace = face;
                closestPointOnFace = innerOnFace;
                closestNormal = face.normal;
              }
            }
          }
        }
      });
      
      // Second pass: If not on wall edge, find closest inner face (original logic)
      if (!isOnWallEdge) {
        wallInnerFaces.forEach(face => {
          const innerStart = face.innerStart;
          const innerEnd = face.innerEnd;
          
          // Vector along inner face
          const faceDx = innerEnd.x - innerStart.x;
          const faceDz = innerEnd.z - innerStart.z;
          const faceLengthSq = faceDx * faceDx + faceDz * faceDz;
          
          if (faceLengthSq < 1e-6) {
            // Degenerate wall, use point distance
            const dist = Math.hypot(vertex.x - (innerStart.x + this.modelOffset.x), vertex.z - (innerStart.z + this.modelOffset.z));
            if (dist < closestDistance && dist < tolerance) {
              closestDistance = dist;
              closestWallFace = face;
              closestPointOnFace = { x: innerStart.x + this.modelOffset.x, z: innerStart.z + this.modelOffset.z };
              closestNormal = face.normal;
            }
            return;
          }

          // Project vertex onto inner face line
          // For horizontal walls: use constant Z, keep X
          // For vertical walls: use constant X, keep Z
          // This ensures all vertices on the same wall align to the same line
          let closestOnFace;
          if (face.isHorizontal && face.innerZ !== null) {
            // Horizontal wall: project perpendicularly to inner face Z coordinate
            const projectedX = vertex.x; // Keep original X
            const innerFaceZ = face.innerZ + this.modelOffset.z;
            closestOnFace = {
              x: projectedX,
              z: innerFaceZ
            };
          } else if (face.isVertical && face.innerX !== null) {
            // Vertical wall: project perpendicularly to inner face X coordinate
            const innerFaceX = face.innerX + this.modelOffset.x;
            const projectedZ = vertex.z; // Keep original Z
            closestOnFace = {
              x: innerFaceX,
              z: projectedZ
            };
          } else {
            // Diagonal wall: use closest point projection
            const toStartX = vertex.x - (innerStart.x + this.modelOffset.x);
            const toStartZ = vertex.z - (innerStart.z + this.modelOffset.z);
            const t = Math.max(0, Math.min(1, (toStartX * faceDx + toStartZ * faceDz) / faceLengthSq));
            closestOnFace = {
              x: innerStart.x + this.modelOffset.x + t * faceDx,
              z: innerStart.z + this.modelOffset.z + t * faceDz
            };
          }

          // Distance from vertex to inner face
          const dist = Math.hypot(vertex.x - closestOnFace.x, vertex.z - closestOnFace.z);

          if (dist < closestDistance && dist < tolerance) {
            closestDistance = dist;
            closestWallFace = face;
            closestPointOnFace = closestOnFace;
            closestNormal = face.normal;
          }
        });
      }

      // If we found a close wall inner face, shrink the vertex to it
      if (closestWallFace && closestPointOnFace && closestNormal) {
        // Vector from inner face to vertex
        const toVertexX = vertex.x - closestPointOnFace.x;
        const toVertexZ = vertex.z - closestPointOnFace.z;
        
        // Dot product with normal: positive = outside, negative = inside, zero = on face
        const dotWithNormal = toVertexX * closestNormal.x + toVertexZ * closestNormal.z;
        
        // Debug logging for first few vertices
        if (vertexIndex < 3) {
          console.log(`[Floor Shrink] Vertex ${vertexIndex}:`, {
            vertex: { x: vertex.x, z: vertex.z },
            closestWall: closestWallFace.wallId,
            closestOnFace: closestPointOnFace,
            toVertex: { x: toVertexX, z: toVertexZ },
            normal: closestNormal,
            dotWithNormal,
            distance: closestDistance,
            isOnWallEdge,
            willShrink: true
          });
        }
        
        // CRITICAL: Always shrink to inner face if we found a wall face
        // Only exception: if vertex is VERY far inside (more than 5mm), keep it to prevent gaps
        // This ensures the floor aligns with wall inner faces
        const insideTolerance = -5 * scale; // Only keep if very far inside (more than 5mm inside)
        
        if (dotWithNormal < insideTolerance) {
          // Vertex is very far inside inner face - keep original position (prevents large gaps)
          return vertex;
        } else {
          // Shrink to inner face - this covers: outside, on face, or slightly inside
          // This ensures the floor touches the wall inner face without overlap
          return closestPointOnFace;
        }
      }

      // No close wall found - use standard corner shrinking for safety
      // IMPORTANT: Ensure shrinking is INWARD (toward polygon center), not outward
      const prev = vertices[(vertexIndex + vertices.length - 1) % vertices.length];
      const next = vertices[(vertexIndex + 1) % vertices.length];
      const roomCenter = this.calculatePolygonCenter(vertices);
      
      const edge1X = vertex.x - prev.x;
      const edge1Z = vertex.z - prev.z;
      const edge2X = next.x - vertex.x;
      const edge2Z = next.z - vertex.z;
      
      const len1 = Math.hypot(edge1X, edge1Z) || 1;
      const len2 = Math.hypot(edge2X, edge2Z) || 1;
      
      // Calculate edge normals (perpendicular to edges)
      const n1x = -edge1Z / len1;
      const n1z = edge1X / len1;
      const n2x = -edge2Z / len2;
      const n2z = edge2X / len2;
      
      // Check which direction points toward room center
      const toCenterX = roomCenter ? (roomCenter.x - vertex.x) : 0;
      const toCenterZ = roomCenter ? (roomCenter.z - vertex.z) : 0;
      const dot1 = n1x * toCenterX + n1z * toCenterZ;
      const dot2 = n2x * toCenterX + n2z * toCenterZ;
      
      // Use the normal that points toward center (positive dot)
      let inwardNx = n1x;
      let inwardNz = n1z;
      if (Math.abs(dot2) > Math.abs(dot1)) {
        inwardNx = n2x;
        inwardNz = n2z;
      }
      
      // If the chosen normal points away from center, flip it
      const chosenDot = inwardNx * toCenterX + inwardNz * toCenterZ;
      if (chosenDot < 0) {
        inwardNx = -inwardNx;
        inwardNz = -inwardNz;
      }
      
      const bisectorX = n1x + n2x;
      const bisectorZ = n1z + n2z;
      const bisectorLen = Math.hypot(bisectorX, bisectorZ);
      
      if (bisectorLen > 1e-6) {
        // Check if bisector points toward center
        const bisectorDot = (bisectorX / bisectorLen) * toCenterX + (bisectorZ / bisectorLen) * toCenterZ;
        const angle = Math.acos(Math.max(-1, Math.min(1, n1x * n2x + n1z * n2z)));
        const scaledWallThickness = wallThickness * scale;
        
        if (angle > 1e-6) {
          const offsetDist = scaledWallThickness / Math.sin(angle / 2);
          // Use bisector direction, but ensure it points inward
          const finalBisectorX = bisectorDot > 0 ? bisectorX : -bisectorX;
          const finalBisectorZ = bisectorDot > 0 ? bisectorZ : -bisectorZ;
          const finalBisectorLen = Math.hypot(finalBisectorX, finalBisectorZ);
          return {
            x: vertex.x + (finalBisectorX / finalBisectorLen) * offsetDist,
            z: vertex.z + (finalBisectorZ / finalBisectorLen) * offsetDist
          };
        } else {
          // Parallel edges, use inward normal
          return {
            x: vertex.x + inwardNx * scaledWallThickness,
            z: vertex.z + inwardNz * scaledWallThickness
          };
        }
      }
      
      return vertex;
    });

    return shrunkVertices;
  }

  // Adjust floor boundary to account for wall extensions at joints
  // This ensures the floor aligns with extended walls, not just original wall positions
  adjustFloorBoundaryForWallExtensions(shrunkVertices, room, wallThickness) {
    if (!shrunkVertices || shrunkVertices.length < 3 || !room || !this.walls || !this.joints) {
      return shrunkVertices;
    }

    // Get all walls for this room
    const roomWallIds = Array.isArray(room.walls) 
      ? room.walls.map(w => typeof w === 'object' ? w.id : w)
      : [];
    
    const roomWalls = this.walls.filter(wall => 
      roomWallIds.includes(String(wall.id))
    );

    if (roomWalls.length === 0) {
      return shrunkVertices;
    }

    const scale = this.scalingFactor;
    const modelCenter = this.calculateModelCenter();
    const tolerance = 50 * scale; // 50mm tolerance for point matching

    function snap(val, precision = 0.01) {
      return Math.round(val / precision) * precision;
    }

    // Calculate extended positions for each room wall
    const extendedWallData = roomWalls.map(wall => {
      let startX = snap(wall.start_x * scale);
      let startZ = snap(wall.start_y * scale);
      let endX = snap(wall.end_x * scale);
      let endZ = snap(wall.end_y * scale);

      const isHorizontal = Math.abs(wall.start_y - wall.end_y) < 1e-6;
      const isVertical = Math.abs(wall.start_x - wall.end_x) < 1e-6;

      // Apply wall flipping
      let finalStartX = startX;
      let finalStartZ = startZ;
      let finalEndX = endX;
      let finalEndZ = endZ;

      if (isHorizontal) {
        if (modelCenter.z * scale < startZ) {
          finalStartX = endX;
          finalEndX = startX;
        }
      } else if (isVertical) {
        if (modelCenter.x * scale > startX) {
          finalStartZ = endZ;
          finalEndZ = startZ;
        }
      }

      // Calculate inward normal
      const dirX = finalEndX - finalStartX;
      const dirZ = finalEndZ - finalStartZ;
      const len = Math.hypot(dirX, dirZ) || 1;
      const ux = dirX / len;
      const uz = dirZ / len;
      let nx = -uz;
      let nz = ux;
      const midX = (finalStartX + finalEndX) / 2;
      const midZ = (finalStartZ + finalEndZ) / 2;
      const toCenterX = (modelCenter.x * scale) - midX;
      const toCenterZ = (modelCenter.z * scale) - midZ;
      const dot = nx * toCenterX + nz * toCenterZ;
      if (dot < 0) {
        nx = -nx;
        nz = -nz;
      }
      const finalNormX = nx;
      const finalNormZ = nz;

      // Apply wall extension (same logic as createWallMesh STEP 1)
      if (this.joints && this.joints.length > 0) {
        this.walls.forEach(otherWall => {
          if (String(otherWall.id) === String(wall.id)) return;
          
          const joint = this.joints.find(j => 
            (j.wall_1 === wall.id && j.wall_2 === otherWall.id) ||
            (j.wall_2 === wall.id && j.wall_1 === otherWall.id)
          );
          if (!joint) return;

          const oSX = snap(otherWall.start_x * scale);
          const oSZ = snap(otherWall.start_y * scale);
          const oEX = snap(otherWall.end_x * scale);
          const oEZ = snap(otherWall.end_y * scale);
          const otherThickness = otherWall.thickness * scale;

          const otherIsHorizontal = Math.abs(otherWall.start_y - otherWall.end_y) < 1e-6;
          const otherIsVertical = Math.abs(otherWall.start_x - otherWall.end_x) < 1e-6;

          const otherMidX = (oSX + oEX) / 2;
          const otherMidZ = (oSZ + oEZ) / 2;
          // Model center is already in scaled coordinates, don't scale again
          const toOtherCenterX = modelCenter.x - otherMidX;
          const toOtherCenterZ = modelCenter.z - otherMidZ;
          let otherNormX, otherNormZ;
          if (otherIsHorizontal) {
            otherNormX = 0;
            otherNormZ = toOtherCenterZ < 0 ? -1 : 1;
          } else if (otherIsVertical) {
            otherNormX = toOtherCenterX < 0 ? -1 : 1;
            otherNormZ = 0;
          } else {
            return;
          }

          const otherOuterX = oSX;
          const otherOuterZ = oSZ;
          const otherInnerX = oSX + otherNormX * otherThickness;
          const otherInnerZ = oSZ + otherNormZ * otherThickness;

          if (isHorizontal && otherIsVertical) {
            const thisZ = finalStartZ;
            const otherX = oSX;
            const rightmostX = Math.max(otherOuterX, otherInnerX);
            const leftmostX = Math.min(otherOuterX, otherInnerX);
            const otherMinZ = Math.min(oSZ, oEZ);
            const otherMaxZ = Math.max(oSZ, oEZ);
            if (thisZ < otherMinZ || thisZ > otherMaxZ) return;

            const rightEndpointX = Math.max(finalStartX, finalEndX);
            const leftEndpointX = Math.min(finalStartX, finalEndX);
            const thisCenterX = (finalStartX + finalEndX) / 2;
            if (otherX > thisCenterX) {
              if (rightEndpointX < rightmostX) {
                if (finalEndX > finalStartX) {
                  finalEndX = rightmostX;
                } else {
                  finalStartX = rightmostX;
                }
              }
            } else {
              if (leftEndpointX > leftmostX) {
                if (finalStartX < finalEndX) {
                  finalStartX = leftmostX;
                } else {
                  finalEndX = leftmostX;
                }
              }
            }
          } else if (isVertical && otherIsHorizontal) {
            const thisX = finalStartX;
            const otherZ = oSZ;
            const topmostZ = Math.max(otherOuterZ, otherInnerZ);
            const bottommostZ = Math.min(otherOuterZ, otherInnerZ);
            const otherMinX = Math.min(oSX, oEX);
            const otherMaxX = Math.max(oSX, oEX);
            if (thisX < otherMinX || thisX > otherMaxX) return;

            const topEndpointZ = Math.max(finalStartZ, finalEndZ);
            const bottomEndpointZ = Math.min(finalStartZ, finalEndZ);
            const thisCenterZ = (finalStartZ + finalEndZ) / 2;
            if (otherZ > thisCenterZ) {
              if (topEndpointZ < topmostZ) {
                if (finalEndZ > finalStartZ) {
                  finalEndZ = topmostZ;
                } else {
                  finalStartZ = topmostZ;
                }
              }
            } else {
              if (bottomEndpointZ > bottommostZ) {
                if (finalStartZ < finalEndZ) {
                  finalStartZ = bottommostZ;
                } else {
                  finalEndZ = bottommostZ;
                }
              }
            }
          }
        });
      }

      // Calculate inner face positions (where the floor should align)
      const wallThicknessScaled = wall.thickness * scale;
      const innerStartX = finalStartX + finalNormX * wallThicknessScaled;
      const innerStartZ = finalStartZ + finalNormZ * wallThicknessScaled;
      const innerEndX = finalEndX + finalNormX * wallThicknessScaled;
      const innerEndZ = finalEndZ + finalNormZ * wallThicknessScaled;

      return {
        wallId: wall.id,
        originalStart: { x: startX, z: startZ },
        originalEnd: { x: endX, z: endZ },
        extendedStart: { x: finalStartX, z: finalStartZ },
        extendedEnd: { x: finalEndX, z: finalEndZ },
        innerStart: { x: innerStartX, z: innerStartZ },
        innerEnd: { x: innerEndX, z: innerEndZ },
        normal: { x: finalNormX, z: finalNormZ }
      };
    });

    // Adjust shrunk vertices to align with extended wall inner faces
    // The goal is to expand the floor slightly where walls extend, ensuring alignment
    // For each vertex, find if it's near an extended wall inner face and adjust accordingly
    const adjustedVertices = shrunkVertices.map(vertex => {
      let closestWallData = null;
      let closestDistance = Infinity;
      let closestPointOnFace = null;

      // Find the closest extended wall inner face
      extendedWallData.forEach(wallData => {
        const innerStart = wallData.innerStart;
        const innerEnd = wallData.innerEnd;
        
        // Vector along inner face
        const faceDx = innerEnd.x - innerStart.x;
        const faceDz = innerEnd.z - innerStart.z;
        const faceLengthSq = faceDx * faceDx + faceDz * faceDz;
        
        if (faceLengthSq < 1e-6) {
          // Degenerate wall, use point distance
          const dist = Math.hypot(vertex.x - innerStart.x, vertex.z - innerStart.z);
          if (dist < closestDistance && dist < tolerance) {
            closestDistance = dist;
            closestWallData = wallData;
            closestPointOnFace = innerStart;
          }
          return;
        }

        // Project vertex onto inner face line
        const toStartX = vertex.x - innerStart.x;
        const toStartZ = vertex.z - innerStart.z;
        const t = Math.max(0, Math.min(1, (toStartX * faceDx + toStartZ * faceDz) / faceLengthSq));
        
        // Closest point on inner face line
        const closestOnFace = {
          x: innerStart.x + t * faceDx,
          z: innerStart.z + t * faceDz
        };

        // Distance from vertex to inner face
        const dist = Math.hypot(vertex.x - closestOnFace.x, vertex.z - closestOnFace.z);

        if (dist < closestDistance && dist < tolerance) {
          closestDistance = dist;
          closestWallData = wallData;
          closestPointOnFace = closestOnFace;
        }
      });

      // If we found a close wall inner face, adjust the vertex
      if (closestWallData && closestPointOnFace) {
        const toVertexX = vertex.x - closestPointOnFace.x;
        const toVertexZ = vertex.z - closestPointOnFace.z;
        const dotWithNormal = toVertexX * closestWallData.normal.x + toVertexZ * closestWallData.normal.z;
        
        // If vertex is too far inside (negative dot, far from inner face), expand it toward inner face
        // If vertex is outside (positive dot), keep it slightly inside
        // We want the floor to be slightly inside the inner face to avoid overlap
        const smallOffset = 0.5 * scale; // 0.5mm offset inside the inner face
        if (dotWithNormal < -smallOffset) {
          // Vertex is too far inside, expand it toward inner face
          return {
            x: closestPointOnFace.x - closestWallData.normal.x * smallOffset,
            z: closestPointOnFace.z - closestWallData.normal.z * smallOffset
          };
        } else if (dotWithNormal > 0) {
          // Vertex is outside, move it slightly inside
          return {
            x: closestPointOnFace.x - closestWallData.normal.x * smallOffset,
            z: closestPointOnFace.z - closestWallData.normal.z * smallOffset
          };
        }
        // Otherwise, vertex is already in good position, keep it
      }

      return vertex;
    });

    return adjustedVertices;
  }

  // Helper function to shrink polygon vertices inward by wall thickness
  shrinkPolygonByWallThickness(vertices, wallThickness) {
    if (!vertices || vertices.length < 3 || wallThickness <= 0) {
      return vertices; // Return original if invalid
    }
    
    // Calculate polygon center to determine inward direction
    const center = this.calculatePolygonCenter(vertices);
    if (!center) {
      return vertices;
    }
    
    const scaledWallThickness = wallThickness * this.scalingFactor;
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

  // Create room-specific floors at correct heights with thickness
  createRoomSpecificFloors() {
    debugLog('🏠 Creating room-specific floors for', this.project.rooms.length, 'rooms');
    
    // Default floor thickness if not specified
    const defaultFloorThickness = 150; // 150mm default
    
    // Get wall thickness from project
    const wallThickness = this.project?.wall_thickness || 200; // Default 200mm if not specified
    
    this.project.rooms.forEach((room, roomIndex) => {
      try {
        if (!room.room_points || room.room_points.length < 3) {
          debugLog(`⚠️ Room ${room.id} has insufficient points, skipping floor`);
          return;
        }

        // Get floor thickness from room data or use default
        const roomFloorThickness = (room.floor_thickness || defaultFloorThickness) * this.scalingFactor;
        
        // Use room base elevation directly (absolute value, no storey elevation)
        const absoluteBaseElevation = room.base_elevation_mm ?? 0;
        debugLog(`🏠 Room ${room.id} (${room.room_name || 'Unnamed'}) - Room Base Elevation: ${absoluteBaseElevation}mm (absolute value)`);
        
        const baseElevation = absoluteBaseElevation * this.scalingFactor;
        
        debugLog(`🏠 Room ${room.id} (${room.room_name || 'Unnamed'}) - Floor Thickness: ${room.floor_thickness || defaultFloorThickness}mm, Absolute Base Elevation: ${absoluteBaseElevation}mm`);
        
        // Convert room_points to 3D coordinates
        let roomVertices = room.room_points.map(point => ({
            x: point.x * this.scalingFactor + this.modelOffset.x,
            z: point.y * this.scalingFactor + this.modelOffset.z
        }));
        
        // Floor shrinking removed - using original room_points directly

        // Create floor geometry for this room
        const floorMesh = this.createRoomFloorMesh(roomVertices, room, roomFloorThickness);
        
        if (floorMesh) {
            // Position floor at absolute base elevation - floor extends upward from here
            floorMesh.position.y = baseElevation;
          floorMesh.name = `floor_room_${room.id}`;
          floorMesh.userData = {
            isFloor: true,
            roomId: room.id,
            roomName: room.room_name || `Room ${room.id}`,
            thickness: roomFloorThickness
          };
          
          this.scene.add(floorMesh);
          debugLog(`✅ Created floor for room ${room.id} with thickness ${room.floor_thickness || defaultFloorThickness}mm at absolute base elevation ${absoluteBaseElevation}mm (extends from Y=${absoluteBaseElevation}mm to Y=${absoluteBaseElevation + (room.floor_thickness || defaultFloorThickness)}mm)`);
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
      
      // Create material using professional config
      const material = new this.THREE.MeshStandardMaterial({
        color: THREE_CONFIG.MATERIALS.FLOOR.color,
        side: this.THREE.DoubleSide,
        roughness: THREE_CONFIG.MATERIALS.FLOOR.roughness,
        metalness: THREE_CONFIG.MATERIALS.FLOOR.metalness,
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
    // Disabled: TextGeometry requires a loaded font, and without it creates unwanted box geometries
    // Room labels are better displayed in 2D views
    return;
    
    /* Original code disabled to prevent semi-transparent cube artifacts
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
    */
  }

  // Method to add floor (fallback method)
  addFloor() {
    try {
      // Remove existing floor
      const existingFloor = this.scene.getObjectByName('floor');
      if (existingFloor) {
        this.scene.remove(existingFloor);
      }

      // CRITICAL: Only create floor if there are declared rooms
      // Do not create floor based on wall endpoints alone
      if (!this.project || !this.project.rooms || this.project.rooms.length === 0) {
        debugLog('No rooms declared - skipping floor creation');
        return;
      }

      // Check if there are rooms with valid room_points
      const validRooms = this.project.rooms.filter(room => 
        room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3
      );

      if (validRooms.length === 0) {
        debugLog('No rooms with valid room_points - skipping floor creation');
        return;
      }

      // Calculate floor elevation based on room base elevation (absolute values)
      // Don't add storey elevation since room.base_elevation_mm is already an absolute value
      // Use the minimum base elevation (lowest room) for the floor
      let minFloorElevation = Infinity;
      validRooms.forEach(room => {
        const roomBaseElevation = room.base_elevation_mm ?? 0;
        debugLog(`[Floor] Room ${room.id}: baseElevation=${roomBaseElevation}mm`);
        if (roomBaseElevation < minFloorElevation) {
          minFloorElevation = roomBaseElevation;
        }
      });
      debugLog(`[Floor] Final minFloorElevation: ${minFloorElevation}mm`);
      
      // If no valid elevation found, default to 0
      if (minFloorElevation === Infinity) {
        minFloorElevation = 0;
      }

      // Get the building footprint vertices (will use room points since rooms exist)
      let vertices = this.getBuildingFootprint();
      if (vertices.length < 3) {
        debugLog('Not enough vertices for floor, skipping...');
        return;
      }
      
      // Floor shrinking removed - using original footprint directly
      
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
      
      // Create material using professional config
      const material = new this.THREE.MeshStandardMaterial({
        color: THREE_CONFIG.MATERIALS.FLOOR.color,
        side: this.THREE.DoubleSide,
        roughness: THREE_CONFIG.MATERIALS.FLOOR.roughness,
        metalness: THREE_CONFIG.MATERIALS.FLOOR.metalness,
        transparent: false
      });
      
      // Create mesh
      const floor = new this.THREE.Mesh(geometry, material);
      floor.name = 'floor';
      
      // Position the floor at the calculated elevation (storey elevation + room base elevation)
      floor.position.y = minFloorElevation * this.scalingFactor;
      
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
}