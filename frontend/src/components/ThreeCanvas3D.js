import * as THREE from "three";
import earcut from 'earcut';
import gsap from 'gsap';
import {CSG} from 'three-csg-ts'

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

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.doorObjects = []; // Store references to door objects
    this.doorStates = new Map(); // Track door open/closed states
    
    // Store HTML container for UI elements
    this.uiContainer = document.createElement('div');
    this.uiContainer.style.position = 'absolute';
    this.uiContainer.style.top = '0';
    this.uiContainer.style.left = '0';
    this.uiContainer.style.width = '100%';
    this.uiContainer.style.height = '100%';
    this.uiContainer.style.pointerEvents = 'none';
    this.container.appendChild(this.uiContainer);
    
    // Door button
    this.doorButton = document.createElement('button');
    this.doorButton.textContent = 'No Door Selected';
    this.doorButton.style.position = 'absolute';
    this.doorButton.style.top = '20px';
    this.doorButton.style.right = '20px';
    this.doorButton.style.padding = '10px 16px';
    this.doorButton.style.backgroundColor = '#4CAF50';
    this.doorButton.style.color = 'white';
    this.doorButton.style.border = 'none';
    this.doorButton.style.borderRadius = '4px';
    this.doorButton.style.cursor = 'pointer';
    this.doorButton.style.fontWeight = 'bold';
    this.doorButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
    this.doorButton.style.transition = 'all 0.3s ease';
    this.doorButton.style.pointerEvents = 'auto';
    this.doorButton.style.display = 'block'; // Always visible
    this.doorButton.style.opacity = '0.7'; // Semi-transparent when no door selected
    this.doorButton.disabled = true; // Disabled by default
    this.uiContainer.appendChild(this.doorButton);
    
    // Current door being interacted with
    this.activeDoor = null;
    
    // Initialize
    this.init();
  }

  init() {
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);
    this.container.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.container.addEventListener('click', this.onCanvasClick.bind(this)); // Add this line
    this.doorButton.addEventListener('click', this.toggleDoor.bind(this));
  
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

  onMouseMove(event) {
    // Calculate mouse position in normalized device coordinates
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Update the raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Find intersections with door objects
    const intersects = this.raycaster.intersectObjects(this.doorObjects, true);
    
    // Add a subtle hover effect for doors
    if (intersects.length > 0) {
      let doorObj = intersects[0].object;
      while (doorObj && !doorObj.userData.doorId) {
        doorObj = doorObj.parent;
      }
      
      if (doorObj && doorObj.material) {
        // We can add a subtle hover effect here if desired
        // But we shouldn't change the active door selection just from hovering
        document.body.style.cursor = 'pointer'; // Change cursor to indicate clickable
      }
    } else {
      document.body.style.cursor = 'default';
    }
  }

  onCanvasClick(event) {
    // Calculate mouse position for this click event specifically
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    // Update the raycaster
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Find intersections with door objects
    const intersects = this.raycaster.intersectObjects(this.doorObjects, true);
    
    if (intersects.length > 0) {
      // Find the door object (might be a child of a pivot/group)
      let doorObj = intersects[0].object;
      while (doorObj && !doorObj.userData.doorId) {
        doorObj = doorObj.parent;
      }
      
      if (doorObj && doorObj.userData.doorId) {
        // Found a door - select it and update the button
        this.activeDoor = doorObj;
        
        // Update button text based on door state
        const isOpen = this.doorStates.get(doorObj.userData.doorId) || false;
        this.doorButton.textContent = isOpen ? 'Close Door' : 'Open Door';
        
        // Enable the button and update style
        this.doorButton.disabled = false;
        this.doorButton.style.opacity = '1';
        this.doorButton.style.backgroundColor = '#4CAF50';
        
        // Add a visual indicator for the selected door (optional)
        // This could be a temporary highlight effect
        if (doorObj.material) {
          const originalColor = doorObj.material.color.clone();
          doorObj.material.color.set(0xffcc00); // Highlight color
          
          // Reset after a short delay
          setTimeout(() => {
            doorObj.material.color.copy(originalColor);
          }, 500);
        }
        
        // Show a visual feedback that the door was selected
        gsap.to(this.doorButton, {
          scale: 1.2,
          duration: 0.2,
          yoyo: true,
          repeat: 1,
          ease: 'power1.inOut'
        });
        
        console.log('Door selected:', doorObj.userData.doorId);
        return;
      }
    }
    
    // If we clicked elsewhere (not on a door), deselect the current door
    if (this.activeDoor) {
      this.activeDoor = null;
      this.doorButton.textContent = 'No Door Selected';
      this.doorButton.disabled = true;
      this.doorButton.style.opacity = '0.7';
      this.doorButton.style.backgroundColor = '#999999';
    }
  } 

  toggleDoor() {
    if (!this.activeDoor) {
      console.log('No door selected to toggle');
      return;
    }
    
    const doorId = this.activeDoor.userData.doorId;
    const isCurrentlyOpen = this.doorStates.get(doorId) || false;
    const newState = !isCurrentlyOpen;
    
    console.log(`Toggling door ${doorId} from ${isCurrentlyOpen ? 'open' : 'closed'} to ${newState ? 'open' : 'closed'}`);
    
    // Update state
    this.doorStates.set(doorId, newState);
    
    // Get the door info
    const doorInfo = this.activeDoor.userData.doorInfo;
    
    // Handle animation based on door type
    if (doorInfo.door_type === 'swing') {
      this.toggleSwingDoor(doorInfo, newState);
    } 
    else if (doorInfo.door_type === 'slide') {
      this.toggleSlideDoor(doorInfo, newState);
    }
    
    // Update button text
    this.doorButton.textContent = newState ? 'Close Door' : 'Open Door';
  }
  
  // New helper method for swing doors
  toggleSwingDoor(doorInfo, newState) {
    if (doorInfo.configuration === 'double_sided') {
      // For double-sided swing doors
      const doorContainer = this.activeDoor;
      
      // Find the left and right pivots (which should be the first two children)
      if (doorContainer.children.length >= 2) {
        const leftPivot = doorContainer.children[0];
        const rightPivot = doorContainer.children[1];
        
        // Get the door panels (first child of each pivot)
        const leftPanel = leftPivot.children[0];
        const rightPanel = rightPivot.children[0];
        
        // Get swing parameters
        const mountedInside = doorInfo.side === 'interior';
        
        // Calculate angles for both doors
        const leftAngle = newState ? Math.PI / 2 * (mountedInside ? -1 : 1) : 0;
        const rightAngle = newState ? Math.PI / 2 * (mountedInside ? 1 : -1) : 0;
        
        // Animate both doors
        gsap.to(leftPanel.rotation, {
          y: leftAngle,
          duration: 1,
          ease: 'power2.inOut'
        });
        
        gsap.to(rightPanel.rotation, {
          y: rightAngle,
          duration: 1,
          ease: 'power2.inOut'
        });
      }
    } else {
      // Single swing door
      const doorContainer = this.activeDoor;
      const pivot = doorContainer.children[0]; // First child should be the pivot
      const doorPanel = pivot.children[0]; // First child of pivot is the door panel
      
      // Get swing parameters
      const mountedInside = doorInfo.side === 'interior';
      const hingeOnRight = doorInfo.swing_direction === 'right';
      const effectiveHingeOnRight = mountedInside ? !hingeOnRight : hingeOnRight;
      
      // Determine swing direction
      let baseDir = 0;
      if (mountedInside) {
        baseDir = effectiveHingeOnRight ? 1 : -1;
      } else {
        baseDir = effectiveHingeOnRight ? -1 : 1;
      }
      
      // Target angle (open = Math.PI/2 in correct direction, closed = 0)
      const targetAngle = newState ? Math.PI / 2 * baseDir : 0;
      
      // Animate
      gsap.to(doorPanel.rotation, {
        y: targetAngle,
        duration: 1,
        ease: 'power2.inOut'
      });
    }
  }
  
  // New helper method for slide doors
  toggleSlideDoor(doorInfo, newState) {
    if (doorInfo.configuration === 'double_sided') {
      // For double-sided sliding doors
      const doorContainer = this.activeDoor;
      
      if (doorContainer.children.length >= 2) {
        const leftDoor = doorContainer.children[0];
        const rightDoor = doorContainer.children[1];
        
        // Get original positions from userData
        const origLeftPos = leftDoor.userData.origPosition || { x: leftDoor.position.x, z: leftDoor.position.z };
        const origRightPos = rightDoor.userData.origPosition || { x: rightDoor.position.x, z: rightDoor.position.z };
        
        // Store original positions if not already stored
        if (!leftDoor.userData.origPosition) {
          leftDoor.userData.origPosition = { ...origLeftPos };
          rightDoor.userData.origPosition = { ...origRightPos };
        }
        
        // Get door dimensions
        const doorWidth = doorInfo.width * this.scalingFactor;
        const slideDistance = doorWidth * 0.48 * 0.9; // Slightly less than half-width
        
        if (newState) {
          // Open doors - slide apart
          gsap.to(leftDoor.position, {
            x: origLeftPos.x - slideDistance,
            duration: 1,
            ease: 'power2.inOut'
          });
          
          gsap.to(rightDoor.position, {
            x: origRightPos.x + slideDistance,
            duration: 1,
            ease: 'power2.inOut'
          });
        } else {
          // Close doors - return to original positions
          gsap.to(leftDoor.position, {
            x: origLeftPos.x,
            duration: 1,
            ease: 'power2.inOut'
          });
          
          gsap.to(rightDoor.position, {
            x: origRightPos.x,
            duration: 1,
            ease: 'power2.inOut'
          });
        }
      }
    } else {
      // Single sliding door
      const doorContainer = this.activeDoor;
      const doorPanel = doorContainer.children[0]; // First child is the door panel
      
      // Get original position
      const origPos = doorPanel.userData.origPosition || { x: doorPanel.position.x, z: doorPanel.position.z };
      
      // Store original position if not already stored
      if (!doorPanel.userData.origPosition) {
        doorPanel.userData.origPosition = { ...origPos };
      }
      
      // Calculate slide direction and distance
      const slideDirection = doorInfo.slide_direction === 'right' ? -1 : 1;
      const sideCoefficient = doorInfo.side === 'exterior' ? -1 : 1;
      const effectiveDirection = slideDirection * sideCoefficient;
      const slideDistance = doorInfo.width * this.scalingFactor * 0.9;
      
      if (newState) {
        // Open door - slide in the appropriate direction
        gsap.to(doorPanel.position, {
          x: origPos.x + slideDistance * effectiveDirection,
          duration: 1,
          ease: 'power2.inOut'
        });
      } else {
        // Close door - return to original position
        gsap.to(doorPanel.position, {
          x: origPos.x,
          duration: 1,
          ease: 'power2.inOut'
        });
      }
    }
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

    // Handle multiple ceiling levels
    const ceilingLevels = [];
    for (let i = 0; i < 10; i++) { // Check for up to 10 ceiling levels
        const ceiling = this.scene.getObjectByName(`ceiling_level_${i}`);
    if (ceiling) {
            ceilingLevels.push(ceiling);
        }
    }
    
    // Also check for single ceiling
    const singleCeiling = this.scene.getObjectByName('ceiling');
    if (singleCeiling) {
        ceilingLevels.push(singleCeiling);
    }

    // Animate all ceiling levels
    ceilingLevels.forEach(ceiling => {
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

    // Handle multiple ceiling levels
    const ceilingLevels = [];
    for (let i = 0; i < 10; i++) { // Check for up to 10 ceiling levels
        const ceiling = this.scene.getObjectByName(`ceiling_level_${i}`);
    if (ceiling) {
            ceilingLevels.push(ceiling);
        }
    }
    
    // Also check for single ceiling
    const singleCeiling = this.scene.getObjectByName('ceiling');
    if (singleCeiling) {
        ceilingLevels.push(singleCeiling);
    }

    // Animate all ceiling levels
    ceilingLevels.forEach(ceiling => {
        ceiling.visible = true;
        gsap.to(ceiling.material, {
            opacity: 0.9,
            duration: 1,
            onComplete: () => {
                ceiling.material.transparent = false;
            }
        });
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
    // Remove existing walls, doors, and ceilings from the scene
    this.scene.children = this.scene.children.filter(child => {
      // Keep everything except walls, doors, joint lines, and ceilings
      return !child.userData.isWall && 
             !child.userData.isJointLine && 
             !child.userData.isDoor && 
             !child.name.startsWith('ceiling');
    });
  
    // Clear door objects array
    this.doorObjects = [];
    
    // Normalize door data: map linked_wall → wall
    this.doors.forEach(d => {
      if (d.linked_wall && !d.wall) d.wall = d.linked_wall;
    });
    
    // First, create all walls with cutouts
    console.log('Creating walls with cutouts...');
    this.walls.forEach(wall => {
      const wallMesh = this.createWallMesh(wall);
      this.scene.add(wallMesh);
    });
    
    // Then create all doors using the calculated positions from wall creation
    console.log('Creating doors in cutouts...');
    this.doors.forEach(door => {
      if (door.calculatedPosition) {
        const doorMesh = this.createDoorMesh(door, null); // Wall reference not needed anymore
        if (doorMesh) this.scene.add(doorMesh);
      } else {
        console.warn(`Door ${door.id} has no calculated position`);
      }
    });

    // Add ceiling after walls and doors are created
    console.log('Creating ceiling...');
    this.addCeiling();
  }  

  calculateModelCenter() {
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
  
  // Complete method with door object tracking added
  createWallMesh(wall) {
    const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
    const scale = this.scalingFactor;
  
    // Calculate center of the model to determine interior direction
    const modelCenter = this.calculateModelCenter();
    
    // Scale wall coordinates
    let startX = start_x * scale;
    let startZ = start_y * scale;
    let endX = end_x * scale;
    let endZ = end_y * scale;
  
    // Calculate wall vector
    const dx = endX - startX;
    const dz = endZ - startZ;
    const wallLength = Math.hypot(dx, dz);
  
    // Calculate wall direction and normal vectors
    const wallDirX = dx / wallLength;
    const wallDirZ = dz / wallLength;
    const normX = -dz / wallLength;
    const normZ = dx / wallLength;
    
    // Calculate wall midpoint
    const wallMidX = (startX + endX) / 2;
    const wallMidZ = (startZ + endZ) / 2;
    
    // Determine if this is an external wall
    const isExternalWall = 
        Math.abs(startX) < 0.001 || Math.abs(startX - 15000 * scale) < 0.001 ||
        Math.abs(startZ) < 0.001 || Math.abs(startZ - 8000 * scale) < 0.001;
    
    let finalNormX, finalNormZ;
    
    if (isExternalWall) {
        // For external walls, explicitly set the normal to point inward
        if (Math.abs(startX) < 0.001) {
            // Left wall
            finalNormX = 1;
            finalNormZ = 0;
        } else if (Math.abs(startX - 15000 * scale) < 0.001) {
            // Right wall
            finalNormX = -1;
            finalNormZ = 0;
        } else if (Math.abs(startZ) < 0.001) {
            // Bottom wall
            finalNormX = 0;
            finalNormZ = 1;
        } else {
            // Top wall
            finalNormX = 0;
            finalNormZ = -1;
        }
    } else {
        // For internal walls, use the center-based logic
        const toCenterX = (modelCenter.x * scale) - wallMidX;
        const toCenterZ = (modelCenter.z * scale) - wallMidZ;
        const dotProduct = normX * toCenterX + normZ * toCenterZ;
        finalNormX = dotProduct < 0 ? -normX : normX;
        finalNormZ = dotProduct < 0 ? -normZ : normZ;
    }
    
    // Calculate offset based on wall thickness (always toward inside)
    const offsetX = finalNormX * (thickness * scale / 2);
    const offsetZ = finalNormZ * (thickness * scale / 2);
    
    // Apply offset to wall position
    startX += offsetX;
    startZ += offsetZ;
    endX += offsetX;
    endZ += offsetZ;
  
    const wallDoors = this.doors.filter(d => String(d.wall) === String(id));
    const wallHeight = height * scale;
    const wallThickness = thickness * scale;
  
    // Check for 45 degree cuts
    let hasStart45 = false;
    let hasEnd45 = false;
    const nearlyEqual = (a, b) => Math.abs(a - b) < 0.001;
    if (this.joints && this.joints.length) {
      this.joints.forEach(j => {
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
  
    // 🔵 Create Wall Base Shape
    const wallShape = new THREE.Shape();
    const bevel = wallThickness;

    if (hasStart45) {
      wallShape.moveTo(bevel, 0);              // Start slightly ahead
      wallShape.lineTo(0, bevel);               // Go up diagonally for 45 cut
      wallShape.lineTo(0, wallHeight);
    } else {
      wallShape.moveTo(0, 0);
      wallShape.lineTo(0, wallHeight);
    }
  
    let lastX = hasStart45 ? bevel : 0;
    wallDoors.sort((a, b) => a.position_x - b.position_x);
  
    const cutouts = wallDoors.map(door => {
      const isSlideDoor = (door.door_type === 'slide'); // Changed from door.type to door.door_type
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
  
    // Draw top edge of the wall
    if (hasEnd45) {
      wallShape.lineTo(wallLength - bevel, wallHeight); // End before the bevel
      wallShape.lineTo(wallLength, wallHeight - bevel); // Down to 45° cut
      wallShape.lineTo(wallLength, 0);                  // Then down to bottom
    } else {
      wallShape.lineTo(wallLength, wallHeight);
      wallShape.lineTo(wallLength, 0);
    }
  
    wallShape.lineTo(lastX, 0);
    if (hasStart45) {
      wallShape.lineTo(bevel, 0);
    }
  
    // ➕ Add door holes properly
    for (const cutout of cutouts) {
      const doorHole = new THREE.Path();
      doorHole.moveTo(cutout.start, 0);
      doorHole.lineTo(cutout.end, 0);
      doorHole.lineTo(cutout.end, cutout.height);
      doorHole.lineTo(cutout.start, cutout.height);
      doorHole.lineTo(cutout.start, 0);
      wallShape.holes.push(doorHole);
    }
  
    // 🏗️ Extrude wall
    const extrudeSettings = {
      depth: wallThickness,
      bevelEnabled: false
    };
  
    const wallGeometry = new THREE.ExtrudeGeometry(wallShape, extrudeSettings);
    wallGeometry.computeVertexNormals();
  
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.7, metalness: 0.2 });
    const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
    wallMesh.userData.isWall = true;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
  
    // ➡️ Position and rotate
    wallMesh.rotation.y = -Math.atan2(dz, dx);
    wallMesh.position.set(startX + this.modelOffset.x, 0, startZ + this.modelOffset.z);
  
    // ⚡ Correct wall centerline
    wallMesh.position.x -= finalNormX * (wallThickness / 2); // Using finalNormX instead of normX
    wallMesh.position.z -= finalNormZ * (wallThickness / 2); // Using finalNormZ instead of normZ
  
    // ➕ Black outline edges
    const edges = new THREE.EdgesGeometry(wallGeometry);
    const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
    wallMesh.add(edgeLines);
  
    // 🛠️ Set calculated door positions for createDoorFrame
    for (const cutout of cutouts) {
      const mid = (cutout.start + cutout.end) / 2;
      const centerX = startX + wallDirX * mid;
      const centerZ = startZ + wallDirZ * mid;
      cutout.doorInfo.calculatedPosition = {
        x: centerX + this.modelOffset.x - finalNormX * (wallThickness / 2), // Using finalNormX
        z: centerZ + this.modelOffset.z - finalNormZ * (wallThickness / 2), // Using finalNormZ
        angle: Math.atan2(dz, dx),
        width: cutout.end - cutout.start,
        height: cutout.height,
        depth: wallThickness
      };
    }
  
    return wallMesh;
  }

  // New method to create door frames/edges around cutouts
  createDoorFrame(wallGroup, centerX, centerZ, width, height, depth, wallAngle, doorInfo) {
    // Create frame border using a thin edge around the cutout
    const frameThickness = Math.min(0.1, depth * 0.2); // Thin frame edge
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      roughness: 0.7,
      metalness: 0.1
    });
    
    // Create frame edges: left, right, top
    // Left vertical frame
    const leftFrame = new THREE.Mesh(
      new THREE.BoxGeometry(frameThickness, height, depth),
      frameMaterial
    );
    leftFrame.position.set(
      centerX - (width/2 - frameThickness/2) * Math.cos(wallAngle),
      height/2,
      centerZ - (width/2 - frameThickness/2) * Math.sin(wallAngle)
    );
    leftFrame.rotation.y = -wallAngle;
    wallGroup.add(leftFrame);
    
    // Right vertical frame
    const rightFrame = new THREE.Mesh(
      new THREE.BoxGeometry(frameThickness, height, depth),
      frameMaterial
    );
    rightFrame.position.set(
      centerX + (width/2 - frameThickness/2) * Math.cos(wallAngle),
      height/2,
      centerZ + (width/2 - frameThickness/2) * Math.sin(wallAngle)
    );
    rightFrame.rotation.y = -wallAngle;
    wallGroup.add(rightFrame);
    
    // Top horizontal frame
    const topFrame = new THREE.Mesh(
      new THREE.BoxGeometry(width - 2 * frameThickness, frameThickness, depth),
      frameMaterial
    );
    topFrame.position.set(
      centerX,
      height - frameThickness/2,
      centerZ
    );
    topFrame.rotation.y = -wallAngle;
    wallGroup.add(topFrame);
    
    // Store the doorway center position for door creation
    doorInfo.calculatedPosition = {
      x: centerX,
      z: centerZ,
      angle: wallAngle,
      width: width,
      height: height,
      depth: depth
    };
  }
  
  // Modified createDoorMesh to work with wall cutouts
  createDoorMesh(door, wall) {
    // Skip door creation here if we don't have calculated position yet
    // (Doors will be created after wall segments in buildModel)
    if (!door.calculatedPosition) {
      return null;
    }
    
    // Extract calculated position data
    const { x: doorPosX, z: doorPosZ, angle: wallAngle, width: cutoutWidth, 
            height: doorHeight, depth: wallDepth } = door.calculatedPosition;
    
    // Scale factors
    const scale = this.scalingFactor;
    
    // Extract door properties
    const { width, thickness, door_type, swing_direction, slide_direction, side, configuration } = door;
    const doorWidth = width * scale * 1.1;
    const doorThickness = thickness * this.scalingFactor;
    
    // Side coefficient (1 for exterior, -1 for interior)
    const sideCoefficient = side === 'exterior' ? 1 : -1;
    
    // Door material
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: door_type === 'swing' ? 0xFFA500 : 0x00FF00,
      roughness: 0.5,
      metalness: 0.3,
      transparent: true,
      opacity: 1
    });
    
    // === SLIDING DOOR IMPLEMENTATION ===
    if (door_type === 'slide') {
      // Offset the sliding door to align with the wall face based on side
      const doorOffsetZ = (wallDepth/2);
      
      if (configuration === 'double_sided') {
        // Create double sliding doors
        const halfWidth = doorWidth * 0.48; // Slightly less than half to fit with gap
        
        // Create a door container
        const doorContainer = new THREE.Object3D();
        doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
        doorContainer.rotation.y = -wallAngle;
        
        // Create both door panels
        const leftDoor = new THREE.Mesh(
          new THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness),
          doorMaterial
        );
        
        const rightDoor = new THREE.Mesh(
          new THREE.BoxGeometry(halfWidth, doorHeight * 0.98, doorThickness),
          doorMaterial
        );
        
        // Position doors within the container, with proper offset for the wall side
        if (side === 'interior') {
          leftDoor.position.set(-halfWidth/2, 0, -doorOffsetZ);
          rightDoor.position.set(halfWidth/2, 0, -doorOffsetZ);
        }
        
        // Store original positions
        leftDoor.userData.origPosition = { x: leftDoor.position.x, z: leftDoor.position.z };
        rightDoor.userData.origPosition = { x: rightDoor.position.x, z: rightDoor.position.z };
        
        // Add to container
        doorContainer.add(leftDoor);
        doorContainer.add(rightDoor);
        
        // Register as a door object with metadata
        doorContainer.userData.isDoor = true;
        doorContainer.userData.doorId = `door_${door.id}`;
        doorContainer.userData.doorInfo = door;
        this.doorObjects.push(doorContainer);
        this.doorStates.set(`door_${door.id}`, true); // Start in open state
        
        // Animate doors sliding open
        const slideDistance = halfWidth * 0.9;
        
        gsap.to(leftDoor.position, {
          x: -halfWidth/2 - slideDistance,
          z: leftDoor.position.z,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        
        gsap.to(rightDoor.position, {
          x: halfWidth/2 + slideDistance,
          z: rightDoor.position.z,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        
        return doorContainer;
      } else {
        // Single sliding door
        const doorMesh = new THREE.Mesh(
          new THREE.BoxGeometry(doorWidth, doorHeight * 0.98, doorThickness),
          doorMaterial
        );
        
        // Create door container to handle rotation and position
        const doorContainer = new THREE.Object3D();
        doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
        doorContainer.rotation.y = -wallAngle;
        
        // Position door at wall face
        if (side === 'interior') {
          doorMesh.position.z = -doorOffsetZ;
        }
        doorContainer.add(doorMesh);
        
        // Store original position
        doorMesh.userData.origPosition = { x: 0, z: doorOffsetZ };
        
        // Register as a door object with metadata
        doorContainer.userData.isDoor = true;
        doorContainer.userData.doorId = `door_${door.id}`;
        doorContainer.userData.doorInfo = door;
        this.doorObjects.push(doorContainer);
        this.doorStates.set(`door_${door.id}`, true); // Start in open state
        
        // Sliding direction
        const rawDirection = slide_direction === 'right' ? -1 : 1;
        const slideDirectionSign = side === 'exterior' ? -rawDirection : rawDirection;
        const slideDistance = doorWidth * 0.9;
        
        // Animate door sliding
        gsap.to(doorMesh.position, {
          x: slideDistance * slideDirectionSign,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        
        return doorContainer;
      }
    }
    
    // === SWING DOOR IMPLEMENTATION ===
    else if (door_type === 'swing') {
      // For swing doors, position in the middle of the door hole
      if (configuration === 'double_sided') {
        const halfWidth = doorWidth * 0.48;
      
        // Create door container
        const doorContainer = new THREE.Object3D();
        doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
        doorContainer.rotation.y = -wallAngle;
      
        // Left hinge
        const leftPivot = new THREE.Object3D();
        leftPivot.position.set(-cutoutWidth/2 + 0.1, 0, 0);
        doorContainer.add(leftPivot);
      
        // Right hinge
        const rightPivot = new THREE.Object3D();
        rightPivot.position.set(cutoutWidth/2 - 0.1, 0, 0);
        doorContainer.add(rightPivot);
      
        // Translated geometry so hinge is at edge
        const leftGeometry = new THREE.BoxGeometry(halfWidth, doorHeight, doorThickness);
        leftGeometry.translate(halfWidth / 2, 0, +(wallDepth / 2)); // Extend from left edge to center
      
        const rightGeometry = new THREE.BoxGeometry(halfWidth, doorHeight, doorThickness);
        rightGeometry.translate(-halfWidth / 2, 0, +(wallDepth / 2)); // Extend from right edge to center
      
        // Mesh panels
        const leftPanel = new THREE.Mesh(leftGeometry, doorMaterial);
        const rightPanel = new THREE.Mesh(rightGeometry, doorMaterial);
      
        // Position panels in the middle of the wall thickness
        leftPanel.position.set(0, 0, 0);
        rightPanel.position.set(0, 0, 0);
      
        // Add to pivots
        leftPivot.add(leftPanel);
        rightPivot.add(rightPanel);
      
        // Register as door objects with metadata
        doorContainer.userData.isDoor = true;
        doorContainer.userData.doorId = `door_${door.id}`;
        doorContainer.userData.doorInfo = { ...door };
        
        this.doorObjects.push(doorContainer);
        this.doorStates.set(`door_${door.id}_left`, true); // Start in open state
        this.doorStates.set(`door_${door.id}_right`, true); // Start in open state
      
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
      
        return doorContainer;
      }
      else {
        // Single swing door section
        const hingeOnRight = swing_direction === 'right';
        const mountedInside = side === 'interior';
  
        // Create door container to handle position and rotation
        const doorContainer = new THREE.Object3D();
        doorContainer.position.set(doorPosX, doorHeight/2, doorPosZ);
        doorContainer.rotation.y = -wallAngle;
        
        // IMPORTANT: For interior doors, we need to flip which side the hinge is on
        const effectiveHingeOnRight = mountedInside ? !hingeOnRight : hingeOnRight;
  
        // Create pivot at the correct edge of the cutout
        const pivotX = effectiveHingeOnRight ? cutoutWidth/2 - 0.1 : -cutoutWidth/2 + 0.1;
        const pivot = new THREE.Object3D();
        pivot.position.set(pivotX, 0, 0);
        doorContainer.add(pivot);
  
        // Build panel with hinge at edge
        const doorGeometry = new THREE.BoxGeometry(doorWidth, doorHeight, doorThickness);
        
        // Offset geometry so hinge is at edge
        const offsetX = effectiveHingeOnRight ? -doorWidth/2 : doorWidth/2;
        doorGeometry.translate(offsetX, 0, 0);
  
        const doorPanel = new THREE.Mesh(doorGeometry, doorMaterial);
        
        // Position panel in the middle of the wall
        doorPanel.position.set(0, 0, +(wallDepth / 2));
        pivot.add(doorPanel);
  
        // Register as a door object with metadata
        doorContainer.userData.isDoor = true;
        doorContainer.userData.doorId = `door_${door.id}`;
        doorContainer.userData.doorInfo = door;
        this.doorObjects.push(doorContainer);
        this.doorStates.set(`door_${door.id}`, true); // Start in open state
  
        // Determine swing direction correctly
        let baseDir = 0;
        if (mountedInside) {
          baseDir = effectiveHingeOnRight ? 1 : -1;
        } else {
          baseDir = effectiveHingeOnRight ? -1 : 1;
        }
        
        // The swing angle
        const swingAngle = Math.PI / 2 * baseDir;
  
        gsap.to(doorPanel.rotation, {
          y: swingAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
  
        return doorContainer;
      }
    }
    
    return null;
  }

  handleResize() {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  addCeiling() {
    // Remove existing ceiling
    const existingCeiling = this.scene.getObjectByName('ceiling');
    if (existingCeiling) {
        this.scene.remove(existingCeiling);
    }

    // Check if we have rooms with different heights
    const roomHeights = this.getRoomHeights();
    
    if (roomHeights.length > 1) {
        // Create multi-level ceiling
        this.createMultiLevelCeiling(roomHeights);
    } else {
        // Create single-level ceiling
        this.createSingleLevelCeiling();
    }
  }

  // Get unique room heights from walls
  getRoomHeights() {
    const heights = new Set();
    this.walls.forEach(wall => {
        heights.add(wall.height);
    });
    return Array.from(heights).sort((a, b) => a - b);
  }

  // Create a single-level ceiling for the entire building
  createSingleLevelCeiling() {
    // Get the building footprint vertices
    const vertices = this.getBuildingFootprint();
    
    if (vertices.length < 3) {
        console.warn('Not enough vertices to create ceiling');
        this.createBoundingBoxCeiling();
        return;
    }

    // Extend the vertices outward to ensure complete coverage
    const extendedVertices = this.extendVerticesOutward(vertices, 50 * this.scalingFactor);

    // Convert vertices to format required by earcut
    const flatVertices = [];
    extendedVertices.forEach(vertex => {
        flatVertices.push(vertex.x);
        flatVertices.push(vertex.z);
    });

    // Triangulate the polygon
    const triangles = earcut(flatVertices);

    if (triangles.length === 0) {
        console.warn('Failed to triangulate ceiling polygon, trying bounding box approach');
        this.createBoundingBoxCeiling();
        return;
    }

    // Create ceiling geometry using triangulation
    const geometry = new THREE.BufferGeometry();
    
    // Create vertices array for the geometry
    const positions = new Float32Array(triangles.length * 3);
    for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        
        positions[i * 3] = x;
        positions[i * 3 + 1] = 0;  // Y coordinate (will be transformed later)
        positions[i * 3 + 2] = z;
    }

    // Add the vertices to the geometry
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    // Calculate normals
    geometry.computeVertexNormals();

    // Create material
    const material = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        side: THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0.2,
        transparent: true,
        opacity: 0.9
    });

    // Create mesh
    const ceiling = new THREE.Mesh(geometry, material);
    ceiling.name = 'ceiling';
    
    // Position the ceiling at the top of the walls
    const maxWallHeight = Math.max(...this.walls.map(wall => wall.height));
    ceiling.position.y = maxWallHeight * this.scalingFactor;
    
    // Enable shadows
    ceiling.castShadow = true;
    ceiling.receiveShadow = true;

    this.scene.add(ceiling);
    
    console.log(`Single-level ceiling created with ${triangles.length / 3} triangles covering ${extendedVertices.length} vertices`);
  }

  // Extend vertices outward to ensure complete coverage
  extendVerticesOutward(vertices, distance) {
    if (vertices.length < 3) return vertices;
    
    // Calculate the centroid of all vertices
    const centroid = { x: 0, z: 0 };
    vertices.forEach(vertex => {
        centroid.x += vertex.x;
        centroid.z += vertex.z;
    });
    centroid.x /= vertices.length;
    centroid.z /= vertices.length;
    
    // Extend each vertex outward from the centroid
    return vertices.map(vertex => {
        const dx = vertex.x - centroid.x;
        const dz = vertex.z - centroid.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        
        if (length === 0) return vertex;
        
        const scale = (length + distance) / length;
        
        return {
            x: centroid.x + dx * scale,
            z: centroid.z + dz * scale
        };
    });
  }

  // Create a simple bounding box ceiling as fallback
  createBoundingBoxCeiling() {
    const bounds = this.getModelBounds();
    const margin = 150 * this.scalingFactor; // Large margin for complete coverage
    
    const vertices = [
        { x: bounds.minX - margin, z: bounds.minZ - margin },
        { x: bounds.maxX + margin, z: bounds.minZ - margin },
        { x: bounds.maxX + margin, z: bounds.maxZ + margin },
        { x: bounds.minX - margin, z: bounds.maxZ + margin }
    ];
    
    // Convert to flat array for earcut
    const flatVertices = [];
    vertices.forEach(vertex => {
        flatVertices.push(vertex.x);
        flatVertices.push(vertex.z);
    });
    
    // Triangulate (should be simple for a rectangle)
    const triangles = earcut(flatVertices);
    
    if (triangles.length === 0) {
        console.error('Failed to create even bounding box ceiling');
        return;
    }
    
    // Create geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(triangles.length * 3);
    
    for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        
        positions[i * 3] = x;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = z;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    
    // Create material
    const material = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        side: THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0.2,
        transparent: true,
        opacity: 0.9
    });
    
    // Create mesh
    const ceiling = new THREE.Mesh(geometry, material);
    ceiling.name = 'ceiling';
    
    const maxWallHeight = Math.max(...this.walls.map(wall => wall.height));
    ceiling.position.y = maxWallHeight * this.scalingFactor;
    
    ceiling.castShadow = true;
    ceiling.receiveShadow = true;
    
    this.scene.add(ceiling);
    
    console.log(`Bounding box ceiling created with ${triangles.length / 3} triangles`);
  }

  // Create multi-level ceiling for buildings with different room heights
  createMultiLevelCeiling(roomHeights) {
    console.log(`Creating multi-level ceiling for ${roomHeights.length} different heights`);
    
    roomHeights.forEach((height, index) => {
        // Get walls at this height
        const wallsAtHeight = this.walls.filter(wall => wall.height === height);
        
        if (wallsAtHeight.length === 0) return;
        
        // Create ceiling for this height level
        const vertices = this.getBuildingFootprintForHeight(wallsAtHeight);
        
        if (vertices.length < 3) return;
        
        // Convert vertices to format required by earcut
        const flatVertices = [];
        vertices.forEach(vertex => {
            flatVertices.push(vertex.x);
            flatVertices.push(vertex.z);
        });

        // Triangulate the polygon
        const triangles = earcut(flatVertices);

        if (triangles.length === 0) return;

        // Create ceiling geometry
        const geometry = new THREE.BufferGeometry();
        
        const positions = new Float32Array(triangles.length * 3);
        for (let i = 0; i < triangles.length; i++) {
            const vertexIndex = triangles[i];
            const x = flatVertices[vertexIndex * 2];
            const z = flatVertices[vertexIndex * 2 + 1];
            
            positions[i * 3] = x;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = z;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.computeVertexNormals();

        // Create material with slight color variation based on height
        const material = new THREE.MeshStandardMaterial({
            color: 0xcccccc + (index * 0x111111),
            side: THREE.DoubleSide,
            roughness: 0.7,
            metalness: 0.2,
            transparent: true,
            opacity: 0.9
        });

        // Create mesh
        const ceiling = new THREE.Mesh(geometry, material);
        ceiling.name = `ceiling_level_${index}`;
        ceiling.position.y = height * this.scalingFactor;
        
        ceiling.castShadow = true;
        ceiling.receiveShadow = true;

        this.scene.add(ceiling);
        
        console.log(`Ceiling level ${index} created at height ${height} with ${triangles.length / 3} triangles`);
    });
  }

  // Get building footprint for a specific set of walls (for multi-level ceilings)
  getBuildingFootprintForHeight(walls) {
    // Build a map of all wall endpoints and their connections for this height
    const pointMap = new Map();
    const toKey = (x, z) => `${x.toFixed(4)},${z.toFixed(4)}`;
    const fromKey = (pt) => toKey(pt.x, pt.z);

    walls.forEach(wall => {
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
        console.warn('No wall vertices found for this height');
        return this.createBoundingBoxVertices();
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
        // Find the next neighbor that is not the previous point and not already visited (unless closing the loop)
        let nextKey = null;
        let minAngle = Infinity;
        for (const neighborKey of current.neighbors) {
            if (neighborKey === prevKey) continue;
            if (neighborKey === startKey && boundary.length > 2) {
                nextKey = neighborKey;
                break;
            }
            if (visited.has(neighborKey)) continue;
            // Prefer the leftmost turn (smallest angle from previous segment)
            if (prevKey) {
                const prev = pointMap.get(prevKey).pt;
                const curr = current.pt;
                const next = pointMap.get(neighborKey).pt;
                const angle = Math.atan2(next.z - curr.z, next.x - curr.x) - Math.atan2(curr.z - prev.z, curr.x - prev.x);
                const normAngle = ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // Normalize to [-PI, PI]
                if (normAngle < minAngle) {
                    minAngle = normAngle;
                    nextKey = neighborKey;
                }
            } else {
                // First step, just pick any neighbor
                nextKey = neighborKey;
            }
        }
        if (!nextKey) break;
        prevKey = currentKey;
        currentKey = nextKey;
        safety++;
        if (safety > 1000) {
            console.error('Boundary tracing safety break');
            break;
        }
    } while (currentKey !== startKey);

    // Remove duplicates at the end
    if (boundary.length > 1 &&
        boundary[0].x === boundary[boundary.length - 1].x &&
        boundary[0].z === boundary[boundary.length - 1].z) {
        boundary.pop();
    }

    if (boundary.length < 3) {
        console.warn('Not enough unique boundary vertices for ceiling at this height');
        return this.createBoundingBoxVertices();
    }
    return boundary;
  }

  // Fallback method to create bounding box vertices
  createBoundingBoxVertices() {
    const bounds = this.getModelBounds();
    const margin = 100 * this.scalingFactor; // or any margin you prefer
    return [
        { x: bounds.minX - margin, z: bounds.minZ - margin },
        { x: bounds.maxX + margin, z: bounds.minZ - margin },
        { x: bounds.maxX + margin, z: bounds.maxZ + margin },
        { x: bounds.minX - margin, z: bounds.maxZ + margin }
    ];
  }

  // Animation loop
  animate() {
    requestAnimationFrame(() => this.animate());
    this.renderer.render(this.scene, this.camera);
    this.controls.update();
  }
}