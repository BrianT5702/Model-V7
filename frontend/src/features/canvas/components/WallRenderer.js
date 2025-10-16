// Wall rendering module for Three.js 3D system
import { createWallMesh } from '../meshUtils';
import { THREE_CONFIG } from '../threeConfig';

export class WallRenderer {
  constructor(instance) {
    this.instance = instance;
    this.THREE = instance.THREE;
  }

  // Render all walls with error handling
  renderWalls(walls) {
    const renderedWalls = [];
    
    walls.forEach(wall => {
      try {
        const wallMesh = this.createWallMesh(wall);
        if (wallMesh) {
          this.instance.scene.add(wallMesh);
          renderedWalls.push(wallMesh);
        }
      } catch (wallError) {
        console.error(`Error creating wall ${wall.id}:`, wallError);
        // Create fallback simple wall mesh
        try {
          const fallbackMesh = this.createFallbackWallMesh(wall);
          if (fallbackMesh) {
            this.instance.scene.add(fallbackMesh);
            renderedWalls.push(fallbackMesh);
          }
        } catch (fallbackError) {
          console.error(`Failed to create fallback wall ${wall.id}:`, fallbackError);
        }
      }
    });

    return renderedWalls;
  }

  // Create wall mesh using meshUtils
  createWallMesh(wall) {
    return createWallMesh(this.instance, wall);
  }

  // Create fallback wall mesh for error cases
  createFallbackWallMesh(wall) {
    try {
      const { start_x, start_y, end_x, end_y, height, thickness } = wall;
      const scale = this.instance.scalingFactor;
      
      // Simple rectangular wall without complex features
      const length = Math.sqrt((end_x - start_x) ** 2 + (end_y - start_y) ** 2) * scale;
      const width = thickness * scale;
      const wallHeight = height * scale;
      
      const geometry = new this.THREE.BoxGeometry(length, wallHeight, width);
      const material = new this.THREE.MeshStandardMaterial(THREE_CONFIG.MATERIALS.WALL);
      
      const mesh = new this.THREE.Mesh(geometry, material);
      mesh.userData.isWall = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      // Position the wall
      const midX = (start_x + end_x) / 2 * scale;
      const midZ = (start_y + end_y) / 2 * scale;
      const angle = Math.atan2(end_y - start_y, end_x - start_x);
      
      mesh.position.set(
        midX + this.instance.modelOffset.x, 
        wallHeight / 2, 
        midZ + this.instance.modelOffset.z
      );
      mesh.rotation.y = angle;
      
      return mesh;
    } catch (error) {
      console.error('Failed to create fallback wall mesh:', error);
      return null;
    }
  }

  // Calculate wall joint types (simplified after removing 45-degree joints)
  calculateWallJointTypes(wall, joints) {
    // Simplified to always return butt_in joints
    return { left: 'butt_in', right: 'butt_in' };
  }

  // Calculate wall panels
  calculateWallPanels(wall, joints) {
    const { start_x, start_y, end_x, end_y, height, thickness, id } = wall;
    const scale = this.instance.scalingFactor;
    
    // Calculate final wall coordinates
    let finalStartX, finalStartY, finalEndX, finalEndY;
    
    // Determine wall orientation and apply any necessary flipping
    const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
    const isVertical = Math.abs(start_x - end_x) < 1e-6;
    
    // For now, keep original coordinates (simplified after removing 45-degree logic)
    finalStartX = start_x;
    finalStartY = start_y;
    finalEndX = end_x;
    finalEndY = end_y;
    
    // Calculate final wall direction and length
    const finalDx = finalEndX - finalStartX;
    const finalDy = finalEndY - finalStartY;
    const finalWallLength = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
    
    // Calculate wall normal (perpendicular to final wall direction)
    const wallDirX = finalDx / finalWallLength;
    const wallDirY = finalDy / finalWallLength;
    let finalNormX = -wallDirY;
    let finalNormZ = wallDirX;
    
    // Determine wall normal direction based on model center
    const modelCenter = this.instance.calculateModelCenter();
    const wallMidX = (finalStartX + finalEndX) / 2;
    const wallMidY = (finalStartY + finalEndY) / 2;
    
    // Simplified normal calculation without 45-degree joints
    if (isHorizontal) {
      if (modelCenter.z / scale < finalStartY) {
        finalNormX = 0;
        finalNormZ = -1;
      } else {
        finalNormX = 0;
        finalNormZ = 1;
      }
    } else if (isVertical) {
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
    
    return {
      finalStartX,
      finalStartY,
      finalEndX,
      finalEndY,
      finalWallLength,
      finalNormX,
      finalNormZ,
      wallDirX,
      wallDirY
    };
  }
}

export default WallRenderer;
