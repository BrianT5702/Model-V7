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
    FAR: 10000, // Increased from 2000 to prevent cut-off when zooming out
    DEFAULT_POSITION: { x: 200, y: 200, z: 200 }
  },
  
  // Grid settings
  GRID: {
    SIZE: 10000, // Increased from 1000 to cover whole area
    DIVISIONS: 100, // Increased divisions for better detail at larger size
    COLOR: 0x888888,
    SECONDARY_COLOR: 0xcccccc
  },
  
  // Materials - Bright white metallic with ambient white appearance
  MATERIALS: {
    WALL: {
      color: 0xFFFFFF, // Pure white for bright ambient appearance
      roughness: 0.2, // Lower roughness for more reflective/metallic look
      metalness: 0.4, // Metallic but will reflect bright white environment
      transparent: false
    },
    FLOOR: {
      color: 0xFFFFFF, // Pure white for bright ambient appearance
      roughness: 0.3, // Lower roughness for metallic floor
      metalness: 0.5, // Metallic floor surface
      transparent: false
    },
    CEILING: {
      color: 0xFFFFFF, // Pure white for bright ambient appearance
      roughness: 0.15, // More glossy for metallic ceiling
      metalness: 0.45, // Metallic ceiling
      transparent: false
    },
    DOOR: {
      color: 0xFFFFFF, // Pure white for bright ambient appearance
      roughness: 0.25, // More glossy
      metalness: 0.5, // Metallic doors
      transparent: true,
      opacity: 0.95 // Slightly transparent for glass effect
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
