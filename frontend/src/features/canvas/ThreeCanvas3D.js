import * as THREE from "three";
import gsap from 'gsap';
import earcut from 'earcut';
import PanelCalculator from '../panel/PanelCalculator';
import { onMouseMoveHandler, onCanvasClickHandler, toggleDoorHandler } from './threeEventHandlers';
import { addGrid, adjustModelScale, addLighting, addControls, calculateModelOffset } from './sceneUtils';
import { createWallMesh, createDoorMesh, createPanelDivisionLines } from './meshUtils';

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
    
    // Panel division lines visibility
    this.showPanelLines = true;
    
    // Bind mesh creation functions
    this.createWallMesh = createWallMesh;
    this.createDoorMesh = createDoorMesh;
    this.createPanelDivisionLines = createPanelDivisionLines;
    
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

  // Helper to get joint types for a wall (copied from Canvas2D.js)
  getWallJointTypes(wall, intersections) {
    // Find all intersections for this wall
    const wallIntersections = intersections.filter(inter => {
      // Handle both the 2D canvas format (with pairs) and the API format
      if (inter.pairs) {
        return inter.pairs.some(pair => 
          pair.wall1.id === wall.id || pair.wall2.id === wall.id
        );
      } else {
        // API format: direct wall_1 and wall_2 properties
        return inter.wall_1 === wall.id || inter.wall_2 === wall.id;
      }
    });
    
    let leftJointType = 'butt_in';
    let rightJointType = 'butt_in';
    
    // Determine wall orientation and which end is left/right
    const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
    const isLeftToRight = wall.end_x > wall.start_x;
    const isBottomToTop = wall.end_y > wall.start_y;
    
    // Track all intersections for each end
    const leftEndIntersections = [];
    const rightEndIntersections = [];
    
    wallIntersections.forEach(inter => {
      let joiningMethod = 'butt_in';
      let wall1Id, wall2Id;
      
      // Handle both data formats
      if (inter.pairs) {
        // 2D canvas format
        inter.pairs.forEach(pair => {
          if (pair.wall1.id === wall.id || pair.wall2.id === wall.id) {
            joiningMethod = pair.joining_method || 'butt_in';
            wall1Id = pair.wall1.id;
            wall2Id = pair.wall2.id;
          }
        });
      } else {
        // API format
        joiningMethod = inter.joining_method || 'butt_in';
        wall1Id = inter.wall_1;
        wall2Id = inter.wall_2;
      }
      
      // Determine which end of the wall this intersection is at
      if (isHorizontal) {
        if (isLeftToRight) {
          if (inter.x === wall.start_x) {
            leftEndIntersections.push(joiningMethod);
          } else if (inter.x === wall.end_x) {
            rightEndIntersections.push(joiningMethod);
          }
        } else {
          if (inter.x === wall.start_x) {
            rightEndIntersections.push(joiningMethod);
          } else if (inter.x === wall.end_x) {
            leftEndIntersections.push(joiningMethod);
          }
        }
      }
      if (isBottomToTop) {
        if (inter.y === wall.start_y) {
          leftEndIntersections.push(joiningMethod);
        } else if (inter.y === wall.end_y) {
          rightEndIntersections.push(joiningMethod);
        }
      } else {
        if (inter.y === wall.start_y) {
          rightEndIntersections.push(joiningMethod);
        } else if (inter.y === wall.end_y) {
          leftEndIntersections.push(joiningMethod);
        }
      }
    });
    
    leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
    rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
    return { left: leftJointType, right: rightJointType };
  }

  // Calculate panels for each wall
  calculateWallPanels() {
    try {
      if (!PanelCalculator) {
        console.error('PanelCalculator not available');
        return {};
      }
      
      const map = {};
      
      this.walls.forEach(wall => {
        try {
          const jointTypes = this.getWallJointTypes(wall, this.joints);
          const calculator = new PanelCalculator();
          const wallLength = Math.sqrt(
            Math.pow(wall.end_x - wall.start_x, 2) + 
            Math.pow(wall.end_y - wall.start_y, 2)
          );
          let panels = calculator.calculatePanels(
            wallLength,
            wall.thickness,
            jointTypes
          );
          
          // Reorder: left side panel (if any), then full panels, then right side panel (if any)
          const leftSide = panels.find(p => p.type === 'side' && p.position === 'left');
          const rightSide = panels.find(p => p.type === 'side' && p.position === 'right');
          const fullPanels = panels.filter(p => p.type === 'full');
          const otherSides = panels.filter(p => p.type === 'side' && p.position !== 'left' && p.position !== 'right');
          
          let orderedPanels = [];
          if (leftSide) orderedPanels.push(leftSide);
          if (otherSides.length > 0 && !leftSide) orderedPanels.push(otherSides[0]);
          orderedPanels = orderedPanels.concat(fullPanels);
          if (rightSide) orderedPanels.push(rightSide);
          if (otherSides.length > 1 || (otherSides.length === 1 && leftSide)) orderedPanels.push(otherSides[otherSides.length - 1]);
          
          // If no side panels, just use the original order
          if (orderedPanels.length === 0) orderedPanels = panels;
          map[wall.id] = orderedPanels;
        } catch (wallError) {
          console.error(`Error calculating panels for wall ${wall.id}:`, wallError);
          map[wall.id] = [];
        }
      });
      
      return map;
    } catch (error) {
      console.error('Error calculating wall panels:', error);
      // Return empty map if panel calculation fails
      return {};
    }
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
        return !child.userData?.isWall && !child.userData?.isDoor && !child.name?.startsWith('ceiling') && !child.userData?.isPanelLines;
      });

      // Clear door objects array
      this.doorObjects = [];

      // Normalize door data: map linked_wall → wall
      this.doors.forEach(d => {
        if (d.linked_wall && !d.wall) d.wall = d.linked_wall;
      });

      // Calculate panels for all walls
      const wallPanelsMap = this.calculateWallPanels();

      // Create all walls
      this.walls.forEach(wall => {
        try {
          const wallMesh = this.createWallMesh(this, wall);
          this.scene.add(wallMesh);
          
          // Create panel division lines for this wall
          const panels = wallPanelsMap[wall.id];
          if (panels && panels.length > 1 && this.showPanelLines) {
            const panelLines = this.createPanelDivisionLines(this, wall, panels);
            if (panelLines) {
              this.scene.add(panelLines);
            }
          }
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

  // Method to toggle panel division lines visibility
  togglePanelLines() {
    this.showPanelLines = !this.showPanelLines;
    
    // Update visibility of existing panel lines
    this.scene.children.forEach(child => {
      if (child.userData?.isPanelLines) {
        child.visible = this.showPanelLines;
      }
    });
  }

  // Method to set panel division lines visibility
  setPanelLinesVisibility(visible) {
    this.showPanelLines = visible;
    
    // Update visibility of existing panel lines
    this.scene.children.forEach(child => {
      if (child.userData?.isPanelLines) {
        child.visible = this.showPanelLines;
      }
    });
  }
}