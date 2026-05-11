// Configuration constants for Three.js 3D system

function parseEnvNumber(name, fallback) {
  if (typeof process === 'undefined' || !process.env) return fallback;
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseEnvFloat(name, fallback) {
  if (typeof process === 'undefined' || !process.env) return fallback;
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Env var must be explicitly truthy (1/true/on/yes). */
function parseEnvFlagTrue(name) {
  if (typeof process === 'undefined' || !process.env) return false;
  const raw = process.env[name];
  if (raw === undefined || raw === '') return false;
  const v = String(raw).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

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
    /** Slightly larger near improves depth precision vs FAR=10000 (less edge flicker). REACT_APP_THREE_CAMERA_NEAR */
    NEAR: Math.max(0.05, Math.min(5, parseEnvFloat('REACT_APP_THREE_CAMERA_NEAR', 0.35) || 0.35)),
    FAR: 10000, // Increased from 2000 to prevent cut-off when zooming out
    DEFAULT_POSITION: { x: 200, y: 200, z: 200 }
  },

  /**
   * Canvas resolution: higher = sharper edges when zoomed out on large models (costs GPU memory).
   * REACT_APP_THREE_MAX_DPR — cap devicePixelRatio (try 2.5–3 on desktop; lower on mobile if needed).
   * REACT_APP_THREE_QUALITY_BIAS — multiply DPR before cap (e.g. 1.1 for ~10% more pixels on 1x displays).
   */
  RENDERER: {
    MAX_PIXEL_RATIO: parseEnvNumber('REACT_APP_THREE_MAX_DPR', 2.5),
    QUALITY_BIAS: parseEnvNumber('REACT_APP_THREE_QUALITY_BIAS', 1),
    /** Screen-space line width for Line2 / LineSegments2 (WebGL ignores linewidth on LineBasicMaterial). */
    SCREEN_LINE_WIDTH_PX: parseEnvNumber('REACT_APP_THREE_LINE_WIDTH_PX', 1.35),
    /**
     * Pull outline lines slightly toward the camera in depth to reduce z-fighting / flicker when zoomed out.
     * REACT_APP_THREE_LINE_OFFSET_FACTOR / UNITS — signed floats (defaults negative).
     */
    /** Gentler bias = less “double”/soft look; increase magnitude (e.g. -4) if edges still flicker. */
    LINE_POLYGON_OFFSET_FACTOR: parseEnvFloat('REACT_APP_THREE_LINE_OFFSET_FACTOR', -2),
    LINE_POLYGON_OFFSET_UNITS: parseEnvFloat('REACT_APP_THREE_LINE_OFFSET_UNITS', -2),
    /**
     * Log depth can interact badly with Line2/LineMaterial (depth shimmer). Default off.
     * Set REACT_APP_THREE_LOG_DEPTH=true only if you need it for huge scenes without lines issues.
     */
    LOG_DEPTH_BUFFER:
      typeof process !== 'undefined' &&
      process.env &&
      String(process.env.REACT_APP_THREE_LOG_DEPTH || '').toLowerCase() === 'true',
    /** MSAA edge softening on opaque Line2 materials. Set REACT_APP_THREE_LINE_ATOC=false if it sparkles on a device. */
    LINE_ALPHA_TO_COVERAGE:
      !(
        typeof process !== 'undefined' &&
        process.env &&
        String(process.env.REACT_APP_THREE_LINE_ATOC || '').toLowerCase() === 'false'
      ),
  },

  /**
   * Wall / ceiling panel division overlays in 3D (Line2 / LineSegments2).
   * Black for standard joints; blue for cut panels, fallbacks, and subtle door-top segments.
   */
  PANEL_LINES: {
    LINE_WIDTH_PX: parseEnvNumber('REACT_APP_THREE_PANEL_LINE_WIDTH_PX', 1.65),
    /** Full / standard panel joints */
    COLOR_FULL: 0x000000,
    /** Cut / partial panels */
    COLOR_CUT: 0x2563eb,
    /** Fallback divisions when panel map is missing */
    COLOR_FALLBACK: 0x2563eb,
    /** Door-top remainder segments (used with transparency in ThreeCanvas3D) */
    COLOR_DOOR_GAP: 0x2563eb,
    /** World-units offset along wall outward normal (reduces z-fight vs mesh) */
    SURFACE_OFFSET: parseEnvFloat('REACT_APP_THREE_PANEL_SURFACE_OFFSET', 0.004),
    /** Draw after wall edge lines (renderOrder 2) */
    RENDER_ORDER: 3,
    /** Extra lift above ceiling mesh for panel loops (mm in DB space × scaling applied in code) */
    CEILING_LIFT_MM: parseEnvFloat('REACT_APP_THREE_PANEL_CEILING_LIFT_MM', 2),
  },

  /**
   * 3D viewport presentation (background + optional studio floor).
   * Keeps building materials white while avoiding a “empty white void” look.
   */
  SCENE: {
    /** Clear color + scene.background (linear-style cool gray) */
    BACKGROUND_COLOR: 0xe8ecf2,
    /** Large horizontal plane under the model (FrontSide only — invisible when orbiting from below). */
    STUDIO_GROUND: true,
    STUDIO_GROUND_COLOR: 0xd6dce6,
    /** World units — plane sits below typical storey floors */
    STUDIO_GROUND_Y: -2.5,
    STUDIO_GROUND_SIZE: 80000,
  },

  // Grid settings
  GRID: {
    SIZE: 10000, // Increased from 1000 to cover whole area
    DIVISIONS: 100, // Increased divisions for better detail at larger size
    COLOR: 0x888888,
    SECONDARY_COLOR: 0xcccccc,
    /**
     * Infinite floor GridHelper in 3D. Floors/rooms already give context; hiding reduces visual noise.
     * Set REACT_APP_THREE_SHOW_GRID=true to show the reference grid.
     */
    SHOW_IN_3D: parseEnvFlagTrue('REACT_APP_THREE_SHOW_GRID'),
  },
  
  // Materials - Bright white metallic with ambient white appearance
  MATERIALS: {
    WALL: {
      color: 0xFFFFFF, // Pure white for bright ambient appearance
      roughness: 0.15, // Lower roughness for more reflective/metallic look
      metalness: 0.8, // High metalness for strong metallic appearance
      emissive: 0xFFFFFF, // Emissive white to make it appear brighter
      emissiveIntensity: 2.0, // Very high emissive intensity for maximum whiteness
      transparent: false
    },
    FLOOR: {
      color: 0xFFFFFF, // Pure white for bright ambient appearance
      roughness: 0.2, // Lower roughness for more metallic floor
      metalness: 0.85, // High metalness for strong metallic floor surface
      emissive: 0xFFFFFF, // Emissive white to make it appear brighter
      emissiveIntensity: 1.0, // Very high emissive intensity for maximum whiteness
      transparent: false
    },
    CEILING: {
      color: 0xFFFFFF, // Pure white for bright ambient appearance
      roughness: 0.1, // Very low roughness for highly reflective metallic ceiling
      metalness: 0.85, // High metalness for strong metallic ceiling
      emissive: 0xFFFFFF, // Emissive white to make it appear brighter
      emissiveIntensity: 1.0, // Very high emissive intensity for maximum whiteness
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
