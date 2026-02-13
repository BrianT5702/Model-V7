// Centralized Three.js instance to prevent multiple imports
// This ensures all modules use the same Three.js instance

import * as THREE from "three";

// Detect and warn if multiple Three.js instances are detected
if (typeof window !== 'undefined') {
  if (window.THREE && window.THREE !== THREE) {
    console.warn(
      '⚠️ Multiple Three.js instances detected!',
      'This can cause performance issues and unexpected behavior.',
      'Please ensure all imports use the centralized threeInstance.js module.'
    );
  } else {
    // Store reference to detect conflicts
    window.__THREE_INSTANCE = THREE;
  }
}

// Export the same THREE instance that will be used across the application
export default THREE;

// Also export commonly used Three.js modules
export { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
export { Line2 } from 'three/examples/jsm/lines/Line2.js';
export { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
export { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

