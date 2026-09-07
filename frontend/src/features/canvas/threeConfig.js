// Configuration constants for Three.js 3D system
// Look target: clean web 3D builders (Floorplanner / Cedreo / Homestyler / SketchUp Web)

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

/** Env var must be explicitly falsy (0/false/off/no). Missing = not false. */
function parseEnvFlagFalse(name) {
  if (typeof process === 'undefined' || !process.env) return false;
  const raw = process.env[name];
  if (raw === undefined || raw === '') return false;
  const v = String(raw).toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

export const THREE_CONFIG = {
  SCALING_FACTOR: 0.01,
  DEFAULT_CEILING_THICKNESS: 150,
  DEFAULT_FLOOR_THICKNESS: 150,
  DEFAULT_WALL_HEIGHT: 3000,
  DEFAULT_WALL_THICKNESS: 200,

  CAMERA: {
    /** Web builders use moderate FOV — not fisheye CAD, not telephoto cinema */
    FOV: 48,
    NEAR: Math.max(0.05, Math.min(5, parseEnvFloat('REACT_APP_THREE_CAMERA_NEAR', 0.35) || 0.35)),
    FAR: 10000,
    DEFAULT_POSITION: { x: 200, y: 200, z: 200 },
  },

  RENDERER: {
    MAX_PIXEL_RATIO: parseEnvNumber('REACT_APP_THREE_MAX_DPR', 3),
    QUALITY_BIAS: parseEnvNumber('REACT_APP_THREE_QUALITY_BIAS', 1.25),
    SCREEN_LINE_WIDTH_PX: parseEnvNumber('REACT_APP_THREE_LINE_WIDTH_PX', 1.75),
    LOG_DEPTH_BUFFER:
      !(
        typeof process !== 'undefined' &&
        process.env &&
        String(process.env.REACT_APP_THREE_LOG_DEPTH || '').toLowerCase() === 'false'
      ),
    LINE_POLYGON_OFFSET_FACTOR: parseEnvFloat('REACT_APP_THREE_LINE_OFFSET_FACTOR', -4),
    LINE_POLYGON_OFFSET_UNITS: parseEnvFloat('REACT_APP_THREE_LINE_OFFSET_UNITS', -4),
    LINE_ALPHA_TO_COVERAGE:
      typeof process !== 'undefined' &&
      process.env &&
      String(process.env.REACT_APP_THREE_LINE_ATOC || '').toLowerCase() === 'true',
  },

  PANEL_LINES: {
    LINE_WIDTH_PX: parseEnvNumber('REACT_APP_THREE_PANEL_LINE_WIDTH_PX', 1.15),
    /**
     * World-space seam width (scene units; 0.04 ≈ 4 mm at scale 0.01).
     * Screen-pixel lines stay the same size when you zoom out and look like CAD ink.
     */
    USE_WORLD_UNITS: true,
    WORLD_WIDTH: parseEnvFloat('REACT_APP_THREE_PANEL_WORLD_WIDTH', 0.042),
    OPACITY: parseEnvFloat('REACT_APP_THREE_PANEL_LINE_OPACITY', 0.48),
    /** Recessed PPGI joint — slightly darker than the off-white face, not slate/cyan ink */
    COLOR_FULL: 0x6f6b65,
    COLOR_CUT: 0x5e6a74,
    COLOR_FALLBACK: 0x6f6b65,
    COLOR_DOOR_GAP: 0x6f6b65,
    SURFACE_OFFSET: parseEnvFloat('REACT_APP_THREE_PANEL_SURFACE_OFFSET', 0.03),
    RENDER_ORDER: 3,
    CEILING_LIFT_MM: parseEnvFloat('REACT_APP_THREE_PANEL_CEILING_LIFT_MM', 2),
  },

  /**
   * Post-FX OFF by default — GTAO caused light/shadow blinking.
   * Opt-in only: REACT_APP_THREE_POST_FX=true
   */
  PRESENTATION: {
    POST_FX: parseEnvFlagTrue('REACT_APP_THREE_POST_FX'),
    AO: false,
    AO_BLEND: parseEnvFloat('REACT_APP_THREE_AO_BLEND', 0.38),
    AO_RADIUS: parseEnvFloat('REACT_APP_THREE_AO_RADIUS', 2.2),
    AO_SAMPLES: parseEnvNumber('REACT_APP_THREE_AO_SAMPLES', 8),
  },

  /**
   * Studio contrast + soft pad under the building.
   */
  SCENE: {
    BACKGROUND_COLOR: 0x7d8fa3,
    FOG_NEAR: 0,
    FOG_FAR: 0,
    FOG_COLOR: 0x7d8fa3,
    STUDIO_GROUND: true,
    STUDIO_GROUND_COLOR: 0x667588,
    /** Flush with wall bottoms (was -0.5 → huge under-wall gap). */
    STUDIO_GROUND_Y: 0,
    STUDIO_GROUND_SIZE: 80000,
    CONTACT_SHADOW: false,
    /** Off: dual ground planes z-fight while orbiting (blinks; zoom-in hides it) */
    STUDIO_PAD: false,
    USE_IBL: true,
    ENVIRONMENT_INTENSITY: parseEnvFloat('REACT_APP_THREE_ENV_INTENSITY', 0.4),
    USE_SKY_GRADIENT: true,
  },

  /**
   * Soft architecture edge lines ON by default (without them white faces look fake/flat).
   * Set REACT_APP_THREE_EDGE_LINES=false to hide.
   */
  EDGE_LINES: {
    ENABLED: !parseEnvFlagFalse('REACT_APP_THREE_EDGE_LINES'),
    /** Soft slate — reads as built edges, not CAD black wireframe */
    COLOR: 0x475569,
    COLOR_OPENING: 0x334155,
    OPACITY: 1,
    LINEWIDTH: parseEnvNumber('REACT_APP_THREE_EDGE_WIDTH_PX', 1.9),
  },

  /** Daylight fill — shadow maps OFF (orbit shadow acne = blink) */
  LIGHTING: {
    HEMISPHERE_SKY: 0xffffff,
    HEMISPHERE_GROUND: 0x6b7788,
    HEMISPHERE_INTENSITY: 0.55,
    AMBIENT_COLOR: 0xffffff,
    AMBIENT_INTENSITY: 0.32,
    SUN_COLOR: 0xfff4e8,
    SUN_INTENSITY: 1.28,
    SUN_POSITION: { x: 210, y: 380, z: 150 },
    FILL_COLOR: 0xdce6f2,
    FILL_INTENSITY: 0.4,
    FILL_POSITION: { x: -170, y: 150, z: -130 },
    RIM_COLOR: 0xeef4fb,
    RIM_INTENSITY: 0.22,
    RIM_POSITION: { x: -70, y: 110, z: 220 },
    SHADOWS: false,
    SHADOW_MAP_SIZE: 2048,
    SHADOW_BIAS: -0.0005,
    SHADOW_NORMAL_BIAS: 0.12,
    SHADOW_RADIUS: 1,
    TONE_MAPPING_EXPOSURE: parseEnvFloat('REACT_APP_THREE_EXPOSURE', 1.06),
  },

  GRID: {
    SIZE: 10000,
    DIVISIONS: 100,
    COLOR: 0x888888,
    SECONDARY_COLOR: 0xcccccc,
    SHOW_IN_3D: parseEnvFlagTrue('REACT_APP_THREE_SHOW_GRID'),
  },

  /**
   * PPGI micro-rib face. One texture tile = TILE_WORLD scene units
   * (1 unit = 100 mm at SCALING_FACTOR 0.01). Grooves mipmap away in orbit
   * and read as recessed slats when the camera is close.
   */
  WALL_SURFACE: {
    ENABLED: true,
    TILE_WORLD: 1,
    RIB_PITCH_MM: 18,
    GROOVE_FRACTION: 0.16,
    TEXTURE_SIZE: 1024,
    NORMAL_SCALE: 0.95,
    NORMAL_DERIV_STRENGTH: 10,
    BUMP_SCALE: 3.2,
  },

  /**
   * Surface variety. Low metalness — IBL specular shimmer looks like blinking while orbiting.
   */
  MATERIALS: {
    WALL: {
      color: 0xffffff,
      roughness: 0.74,
      metalness: 0.02,
      envMapIntensity: 0.28,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: false,
    },
    FLOOR: {
      color: 0xc5bdb2,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.12,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: false,
    },
    CEILING: {
      color: 0xe8ebef,
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.15,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: false,
    },
    DOOR: {
      color: 0xeeeae3,
      roughness: 0.74,
      metalness: 0.02,
      envMapIntensity: 0.2,
      transparent: false,
      opacity: 1,
    },
    DOOR_ALUMINUM: {
      color: 0xd5dde4,
      roughness: 0.26,
      metalness: 0.84,
      envMapIntensity: 0.9,
    },
    DOOR_HARDWARE: {
      color: 0x17181a,
      roughness: 0.5,
      metalness: 0.22,
      envMapIntensity: 0.3,
    },
    GLASS: {
      color: 0xb9d4e2,
      roughness: 0.04,
      metalness: 0.0,
      transparent: true,
      opacity: 0.28,
      envMapIntensity: 1.35,
    },
    WINDOW_FRAME: {
      color: 0xc5ced6,
      roughness: 0.3,
      metalness: 0.7,
      envMapIntensity: 0.7,
    },
  },

  /**
   * Cold-room door hardware (mm). Glass sits in the middle of the leaf,
   * much thinner than the insulated panel.
   */
  DOOR_DETAIL: {
    FRAME_FACE_MM: 32,
    FRAME_PROUD_MM: 4,
    SLIDE_CLEARANCE_MM: 12,
    GLASS_THICKNESS_MM: 10,
    GLAZING_LINING_MM: 22,
    TRACK_HEIGHT_MM: 78,
    TRACK_DEPTH_MM: 62,
    TRACK_GAP_MM: 10,
    ROLLER_MM: 48,
    HANDLE_HEIGHT_MM: 520,
    HANDLE_WIDTH_MM: 28,
    HANDLE_DEPTH_MM: 42,
    HANDLE_INSET_MM: 52,
    SEAM_MM: 2.8,
    PANEL_PITCH_MM: 1150,
  },

  ANIMATION: {
    DOOR_DURATION: 1.5,
    CAMERA_DURATION: 2,
    EASE: 'power2.inOut',
  },

  UI: {
    BUTTON_STYLE: {
      padding: '8px 16px',
      borderRadius: '6px',
      fontWeight: '500',
      fontSize: '14px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      transition: 'all 0.2s ease',
    },
  },
};

export default THREE_CONFIG;
