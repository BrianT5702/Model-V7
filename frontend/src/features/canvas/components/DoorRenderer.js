// Door rendering module for Three.js 3D system
import { createDoorMesh } from '../meshUtils';
import { THREE_CONFIG } from '../threeConfig';

export class DoorRenderer {
  constructor(instance) {
    this.instance = instance;
    this.THREE = instance.THREE;
  }

  // Render all doors with error handling
  renderDoors(doors) {
    const renderedDoors = [];
    
    doors.forEach(door => {
      try {
        if (door.calculatedPosition) {
          const doorMesh = this.createDoorMesh(door, null);
          if (doorMesh) {
            this.instance.scene.add(doorMesh);
            renderedDoors.push(doorMesh);
          }
        }
      } catch (doorError) {
        console.error(`Error creating door ${door.id}:`, doorError);
      }
    });

    return renderedDoors;
  }

  // Create door mesh using meshUtils
  createDoorMesh(door, wallMesh) {
    return createDoorMesh(this.instance, door, wallMesh);
  }

  // Handle door interaction (click/toggle)
  handleDoorInteraction(door, event) {
    try {
      // Find the door mesh in the scene
      const doorMesh = this.findDoorMesh(door.id);
      if (doorMesh) {
        // Toggle door state
        const currentState = doorMesh.userData.isOpen || false;
        doorMesh.userData.isOpen = !currentState;
        
        // Animate door opening/closing
        this.animateDoor(doorMesh, !currentState);
        
        return true;
      }
    } catch (error) {
      console.error(`Error handling door interaction for door ${door.id}:`, error);
    }
    return false;
  }

  // Find door mesh by ID
  findDoorMesh(doorId) {
    let doorMesh = null;
    this.instance.scene.traverse((child) => {
      if (child.userData && child.userData.isDoor && child.userData.doorId === doorId) {
        doorMesh = child;
      }
    });
    return doorMesh;
  }

  // Animate door opening/closing
  animateDoor(doorMesh, isOpening) {
    if (!this.instance.gsap) return;

    const doorFrame = doorMesh.children.find(child => child.userData.isDoorFrame);
    const doorPanel = doorMesh.children.find(child => child.userData.isDoorPanel);

    if (doorFrame && doorPanel) {
      const duration = THREE_CONFIG.ANIMATION.DOOR_DURATION;
      const ease = THREE_CONFIG.ANIMATION.EASE;

      if (isOpening) {
        // Open door
        this.instance.gsap.to(doorPanel.rotation, {
          y: doorPanel.userData.openAngle || Math.PI / 2,
          duration,
          ease
        });
      } else {
        // Close door
        this.instance.gsap.to(doorPanel.rotation, {
          y: 0,
          duration,
          ease
        });
      }
    }
  }

  // Update door positions when walls change
  updateDoorPositions(doors, walls) {
    doors.forEach(door => {
      const doorMesh = this.findDoorMesh(door.id);
      if (doorMesh) {
        // Recalculate door position based on updated walls
        const wall = walls.find(w => w.id === door.wall || w.id === door.wall_id);
        if (wall) {
          // Update door position logic here
          this.repositionDoor(doorMesh, door, wall);
        }
      }
    });
  }

  // Reposition door based on wall changes
  repositionDoor(doorMesh, door, wall) {
    try {
      // Calculate new position based on wall
      const { start_x, start_y, end_x, end_y } = wall;
      const scale = this.instance.scalingFactor;
      
      // Simple repositioning logic - can be enhanced
      const wallLength = Math.sqrt((end_x - start_x) ** 2 + (end_y - start_y) ** 2);
      const doorPosition = (door.position || 0.5) * wallLength;
      
      const midX = (start_x + end_x) / 2 * scale;
      const midZ = (start_y + end_y) / 2 * scale;
      
      doorMesh.position.set(
        midX + this.instance.modelOffset.x,
        doorMesh.position.y,
        midZ + this.instance.modelOffset.z
      );
      
    } catch (error) {
      console.error(`Error repositioning door ${door.id}:`, error);
    }
  }

  // Get all door meshes
  getAllDoorMeshes() {
    const doorMeshes = [];
    this.instance.scene.traverse((child) => {
      if (child.userData && child.userData.isDoor) {
        doorMeshes.push(child);
      }
    });
    return doorMeshes;
  }

  // Clean up door animations
  cleanupDoorAnimations() {
    const doorMeshes = this.getAllDoorMeshes();
    doorMeshes.forEach(doorMesh => {
      if (this.instance.gsap) {
        this.instance.gsap.killTweensOf(doorMesh.rotation);
      }
    });
  }
}

export default DoorRenderer;
