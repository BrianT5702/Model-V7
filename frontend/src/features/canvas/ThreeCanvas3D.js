import * as THREE from "three";
import earcut from 'earcut';
import gsap from 'gsap';
import {CSG} from 'three-csg-ts'
import { onMouseMoveHandler, onCanvasClickHandler, toggleDoorHandler } from './threeEventHandlers';
import { addGrid, adjustModelScale, addLighting, addControls, calculateModelOffset, buildModel } from './sceneUtils';
import { createWallMesh, createDoorMesh } from './meshUtils';

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
    buildModel(this);

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
}