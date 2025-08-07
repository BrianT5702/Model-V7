import * as THREE from "three";
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
    
    // Panel lines toggle button
    this.panelButton = document.createElement('button');
    this.panelButton.textContent = 'Show Panel Lines';
    this.panelButton.style.position = 'absolute';
    this.panelButton.style.top = '20px';
    this.panelButton.style.right = '200px';
    this.panelButton.style.padding = '10px 16px';
    this.panelButton.style.backgroundColor = '#2196F3';
    this.panelButton.style.color = 'white';
    this.panelButton.style.border = 'none';
    this.panelButton.style.borderRadius = '4px';
    this.panelButton.style.cursor = 'pointer';
    this.panelButton.style.fontWeight = 'bold';
    this.panelButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
    this.panelButton.style.transition = 'all 0.3s ease';
    this.panelButton.style.pointerEvents = 'auto';
    this.panelButton.addEventListener('click', () => this.togglePanelLines());
    this.uiContainer.appendChild(this.panelButton);
    
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
                ceiling.material.transparent = false;
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
            opacity: 100,
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
      // Remove existing walls, doors, ceilings, and panel lines from the scene
      this.scene.children = this.scene.children.filter(child => {
        return !child.userData?.isWall && !child.userData?.isDoor && !child.name?.startsWith('ceiling') && !child.userData?.isPanelLine;
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
      this.addCeiling();
      
      // Create panel division lines
      this.createPanelDivisionLines();
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
      
      // Create ceiling geometry using triangulation
      const geometry = new this.THREE.BufferGeometry();
      const positions = new Float32Array(triangles.length * 3);
      for (let i = 0; i < triangles.length; i++) {
        const vertexIndex = triangles[i];
        const x = flatVertices[vertexIndex * 2];
        const z = flatVertices[vertexIndex * 2 + 1];
        positions[i * 3] = x;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = z;
      }
      geometry.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      
      // Create material
      const material = new this.THREE.MeshStandardMaterial({
        color: 0xcccccc,
        side: this.THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0.2,
        transparent: true,
        opacity: 0.9
      });
      
      // Create mesh
      const ceiling = new this.THREE.Mesh(geometry, material);
      ceiling.name = 'ceiling';
      
      // Position the ceiling at the top of the walls
      const maxWallHeight = Math.max(...this.walls.map(wall => wall.height));
      ceiling.position.y = maxWallHeight * this.scalingFactor;
      ceiling.castShadow = true;
      ceiling.receiveShadow = true;
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
                console.log(`Wall ${wall.id} will be flipped in calculateWallPanels due to 45° cut joint`);
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
        console.log(`Wall ${wall.id} panels being flipped - swapping left/right positions`);
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
      console.log('Panel calculation result:', wallPanelsMap);
      
      this.walls.forEach(wall => {
        const panels = wallPanelsMap[wall.id];
        if (!panels || panels.length <= 1) {
          console.log(`No panels to divide for wall ${wall.id}`);
          return;
        }
        
        console.log(`Creating panel lines for wall ${wall.id} with ${panels.length} panels:`, panels);
        
        // Debug: Log side panel positions
        const sidePanels = panels.filter(p => p.type === 'side');
        if (sidePanels.length > 0) {
          console.log(`Wall ${wall.id} side panels:`, sidePanels.map(p => ({ position: p.position, width: p.width })));
        }
        
        const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
        const scale = this.scalingFactor;
        const modelCenter = this.calculateModelCenter();
        
        // Calculate initial wall direction and length
        const dx = end_x - start_x;
        const dy = end_y - start_y;
        const wallLength = Math.sqrt(dx * dx + dy * dy);
        
        if (wallLength === 0) {
          console.warn(`Wall ${wall.id} has zero length, skipping panel lines`);
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
                  console.log(`Wall ${wall.id} will be flipped due to 45° cut joint`);
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
            
            console.log(`Wall ${wall.id} flipped - Connecting wall at (${connectingWallMidX}, ${connectingWallMidY})`);
            console.log(`Wall ${wall.id} flipped - Direction to connecting wall: (${toConnectingX}, ${toConnectingY})`);
            
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
            
            console.log(`Wall ${wall.id} flipped - Final normal: (${finalNormX}, ${finalNormZ})`);
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
          const doorWidth = door.width * scale;
          const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : 1.05);
          
          // If wall was flipped, flip the door position
          const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
          const doorPos = adjustedPositionX * finalWallLength;
          
          return {
            start: Math.max(0, doorPos - cutoutWidth / 2),
            end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
            doorInfo: door
          };
        });
        
        let accumulated = 0;
        
        // Create division lines for each panel boundary
        // Note: The panels array from calculateWallPanels() already has the correct flipped positions
        // for side panels when shouldFlipWall is true, so we use them as-is
        for (let i = 0; i < panels.length - 1; i++) {
          accumulated += panels[i].width;
          const t = accumulated / finalWallLength; // Position along wall (0-1)
          const divisionPosition = accumulated; // Position in wall units
          
          // Calculate division point along the wall using final coordinates
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
      
      console.log(`Created ${this.panelLines.length} panel division lines`);
    } catch (error) {
      console.error('Error creating panel division lines:', error);
    }
  }

  // Method to toggle panel division lines visibility
  togglePanelLines() {
    this.showPanelLines = !this.showPanelLines;
    this.panelButton.textContent = this.showPanelLines ? 'Hide Panel Lines' : 'Show Panel Lines';
    this.panelLines.forEach(line => {
      line.visible = this.showPanelLines;
    });
  }

  // Method to create line segments with gaps at door cutouts
  createLineSegmentsWithCutouts(dbLinePoint, offsetLinePoint, wallHeight, cutouts, divisionPosition, finalWallLength, finalStartX, finalStartY, finalEndX, finalEndY, scale) {
    // Check if this division line intersects with any door cutout
    const intersectingCutouts = cutouts.filter(cutout => 
      divisionPosition >= cutout.start && divisionPosition <= cutout.end
    );
    
    if (intersectingCutouts.length === 0) {
      // No cutouts intersect, create continuous lines from floor to wall top
      this.createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight);
      return;
    }
    
    // Get door cutout information for this division line
    const cutout = intersectingCutouts[0]; // Should only be one cutout per division line
    const doorHeight = cutout.doorInfo.height * scale * 1.02; // Same as in meshUtils.js
    
    // Create line only from door top to wall top
    this.createDoorTopToWallTopLines(dbLinePoint, offsetLinePoint, wallHeight, doorHeight);
  }
  
  // Method to create continuous lines (no cutouts)
  createContinuousLines(dbLinePoint, offsetLinePoint, wallHeight) {
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
  }
  
  // Method to create lines only from door top to wall top
  createDoorTopToWallTopLines(dbLinePoint, offsetLinePoint, wallHeight, doorHeight) {
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
    }
  }

  // Method to set panel division lines visibility
  setPanelLinesVisibility(visible) {
    this.showPanelLines = visible;
    this.panelButton.textContent = visible ? 'Hide Panel Lines' : 'Show Panel Lines';
    this.panelLines.forEach(line => {
      line.visible = visible;
    });
  }
}