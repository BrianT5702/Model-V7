// Configuration constants for Three.js 3D system

export const THREE_CONFIG = {
  // Scaling and dimensions
  SCALING_FACTOR: 0.01,
  DEFAULT_CEILING_THICKNESS: 150,
  DEFAULT_FLOOR_THICKNESS: 150,
  DEFAULT_WALL_HEIGHT: 3000,
  DEFAULT_WALL_THICKNESS: 200,
  
  // Camera settings
  CAMERA: {
    FOV: 75,
    NEAR: 0.1,
    FAR: 2000,
    DEFAULT_POSITION: { x: 200, y: 200, z: 200 }
  },
  
  // Grid settings
  GRID: {
    SIZE: 1000,
    DIVISIONS: 20,
    COLOR: 0x888888,
    SECONDARY_COLOR: 0xcccccc
  },
  
  // Materials
  MATERIALS: {
    WALL: {
      color: 0xFFFFFF,
      roughness: 0.5,
      metalness: 0.7,
      transparent: false
    },
    FLOOR: {
      color: 0xE5E7EB,
      roughness: 0.8,
      metalness: 0.2,
      transparent: false
    },
    CEILING: {
      color: 0xFFFFFF,
      roughness: 0.5,
      metalness: 0.7,
      transparent: false
    },
    DOOR: {
      color: 0xF8F8FF,
      roughness: 0.5,
      metalness: 0.3,
      transparent: true,
      opacity: 1
    }
  },
  
  // Animation settings
  ANIMATION: {
    DOOR_DURATION: 1.5,
    CAMERA_DURATION: 2,
    EASE: 'power2.inOut'
  },
  
  // UI settings
  UI: {
    BUTTON_STYLE: {
      padding: '8px 16px',
      borderRadius: '6px',
      fontWeight: '500',
      fontSize: '14px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      transition: 'all 0.2s ease'
    }
  }
};

export default THREE_CONFIG;
