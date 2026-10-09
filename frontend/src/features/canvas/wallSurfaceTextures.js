// Procedural PPGI ribbed wall finish.
// Shared across all walls. One tile is one full panel, with a fixed rib count.

import { THREE_CONFIG } from './threeConfig';

let cached = null;

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Cross-section of one rib period (0–1). Grooves sit on the wrap so the
 * texture tiles. Each slat has a slight crown so side light grades across it.
 */
function ribHeight(t, grooveFrac) {
  const u = ((t % 1) + 1) % 1;
  const half = grooveFrac * 0.5;
  if (u < half || u > 1 - half) {
    const d = Math.min(u, 1 - u) / half;
    return 0.2 + 0.68 * smoothstep(d);
  }
  const inner = (u - half) / (1 - grooveFrac);
  return 0.88 + 0.12 * Math.sin(Math.PI * inner);
}

function fillHeightField(size, ribCount, grooveFrac) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const periodU = u * ribCount;
      height[y * size + x] = ribHeight(periodU, grooveFrac);
    }
  }
  return height;
}

function writeAlbedo(ctx, height, size) {
  const img = ctx.createImageData(size, size);
  const data = img.data;
  // Warm off-white PPGI, close to the real panel photo
  const br = 236;
  const bg = 234;
  const bb = 227;
  for (let i = 0; i < size * size; i += 1) {
    const h = height[i];
    const shade = 0.98 + h * 0.02;
    const o = i * 4;
    data[o] = Math.max(0, Math.min(255, br * shade));
    data[o + 1] = Math.max(0, Math.min(255, bg * shade));
    data[o + 2] = Math.max(0, Math.min(255, bb * shade));
    data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function writeNormal(ctx, height, size, strength) {
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const xl = height[y * size + ((x - 1 + size) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yd = height[((y - 1 + size) % size) * size + x];
      const yu = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength;
      let ny = (yd - yu) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * size + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function writeRoughness(ctx, height, size) {
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let i = 0; i < size * size; i += 1) {
    const h = height[i];
    // Satin coated metal: smooth face, slightly softer in the grooves.
    // Encoded as the real roughness (material.roughness = 1 multiplies this).
    const r = (0.38 + (1 - h) * 0.12) * 255;
    const v = Math.max(0, Math.min(255, r));
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function writeBump(ctx, height, size) {
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let i = 0; i < size * size; i += 1) {
    const v = Math.max(0, Math.min(255, height[i] * 255));
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function makeCanvasTexture(THREE, canvas, { colorSpace, anisotropy }) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.userData.shared = true;
  texture.userData.sharedWallSurface = true;
  if (colorSpace !== undefined) {
    texture.colorSpace = colorSpace;
  }
  texture.needsUpdate = true;
  return texture;
}

function paintToCanvas(size, painter) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  painter(ctx);
  return canvas;
}

export function getWallSurfaceTextures(THREE, renderer) {
  const aniso = renderer?.capabilities?.getMaxAnisotropy?.() || 8;
  const cfg = THREE_CONFIG.WALL_SURFACE || {};
  const key = `${cfg.TEXTURE_SIZE}|${cfg.RIB_PITCH_MM}|${cfg.GROOVE_FRACTION}|${cfg.NORMAL_DERIV_STRENGTH}|${cfg.TILE_WORLD}`;
  if (cached && cached.THREE === THREE && cached.key === key) {
    if (cached.albedo.anisotropy < aniso) {
      cached.albedo.anisotropy = aniso;
      cached.normal.anisotropy = aniso;
      cached.roughness.anisotropy = aniso;
      cached.bump.anisotropy = aniso;
    }
    return cached;
  }

  const size = cfg.TEXTURE_SIZE || 1024;
  const tileMm = (cfg.TILE_WORLD ?? 1) / (THREE_CONFIG.SCALING_FACTOR || 0.01);
  const pitchMm = cfg.RIB_PITCH_MM || (tileMm / 9);
  const ribCount = cfg.RIBS_PER_PANEL || Math.max(2, Math.round(tileMm / pitchMm));
  const grooveFrac = cfg.GROOVE_FRACTION ?? 0.16;
  const height = fillHeightField(size, ribCount, grooveFrac);

  const albedoCanvas = paintToCanvas(size, (ctx) => writeAlbedo(ctx, height, size));
  const normalCanvas = paintToCanvas(size, (ctx) => writeNormal(ctx, height, size, cfg.NORMAL_DERIV_STRENGTH ?? 6.5));
  const roughnessCanvas = paintToCanvas(size, (ctx) => writeRoughness(ctx, height, size));
  const bumpCanvas = paintToCanvas(size, (ctx) => writeBump(ctx, height, size));

  const noColor = THREE.NoColorSpace ?? THREE.LinearSRGBColorSpace;
  cached = {
    THREE,
    key,
    albedo: makeCanvasTexture(THREE, albedoCanvas, {
      colorSpace: THREE.SRGBColorSpace || THREE.sRGBEncoding,
      anisotropy: aniso,
    }),
    normal: makeCanvasTexture(THREE, normalCanvas, { colorSpace: noColor, anisotropy: aniso }),
    roughness: makeCanvasTexture(THREE, roughnessCanvas, { colorSpace: noColor, anisotropy: aniso }),
    bump: makeCanvasTexture(THREE, bumpCanvas, { colorSpace: noColor, anisotropy: aniso }),
  };
  return cached;
}

export function prepareWallSurfaceGeometry(THREE, geometry) {
  if (!geometry || THREE_CONFIG.WALL_SURFACE?.ENABLED === false) return;
  const tile = THREE_CONFIG.WALL_SURFACE?.TILE_WORLD ?? 1;
  const pos = geometry.attributes.position;
  if (!pos) return;

  geometry.computeVertexNormals();
  let uv = geometry.attributes.uv;
  if (!uv || uv.count !== pos.count) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geometry.setAttribute('uv', uv);
  }
  const nrm = geometry.attributes.normal;
  const inv = 1 / tile;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    let u;
    let v;
    if (az >= ax && az >= ay) {
      u = x * inv;
      v = y * inv;
    } else if (ay >= ax && ay >= az) {
      u = x * inv;
      v = z * inv;
    } else {
      u = z * inv;
      v = y * inv;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;

  try {
    if (!geometry.index) {
      const count = pos.count;
      const IndexArray = count > 65535 ? Uint32Array : Uint16Array;
      const index = new IndexArray(count);
      for (let i = 0; i < count; i += 1) index[i] = i;
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
    }
    if (geometry.attributes.tangent) geometry.deleteAttribute('tangent');
    geometry.computeTangents();
  } catch {
    // Bump map on the material covers this case
  }
}

const SURFACE_LOOK = {
  'S/STEEL': { color: 0xc5ccd6, metalness: 0.72, roughness: 0.42 },
  PVC: { color: 0xf3efe4, metalness: 0.04, roughness: 0.92 },
};

/** One material per wall face. Side and surface type stay on the material for later 3D finishes. */
export function createWallFaceMaterial(THREE, renderer, face, fallback) {
  const material = (fallback || createWallSurfaceMaterial(THREE, renderer)).clone();
  const surfaceType = String(face?.material || 'PPGI').trim().toUpperCase();
  const look = SURFACE_LOOK[surfaceType];
  if (look) {
    material.color = new THREE.Color(look.color);
    material.metalness = look.metalness;
    material.roughness = look.roughness;
    if (surfaceType !== 'PPGI') {
      material.map = null;
      material.normalMap = null;
      material.roughnessMap = null;
    }
  }
  material.userData.surfaceType = surfaceType;
  material.userData.faceSide = face?.side;
  material.userData.sheetThickness = face?.thickness;
  return material;
}

/**
 * Split the extruded wall so local +Z and local -Z can carry different face finishes.
 * Local +Z is the side toward the model center. side1OnPositiveZ says whether Side 1 is that face.
 */
export function applyWallFaceSideMaterials(THREE, mesh, renderer, { side1, side2, side1OnPositiveZ }) {
  const geometry = mesh?.geometry;
  const position = geometry?.attributes?.position;
  if (!position) return;

  geometry.computeVertexNormals();
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : position.count / 3;
  const vertex = (tri, corner) => (index ? index.getX(tri * 3 + corner) : tri * 3 + corner);
  const edge = [];
  const positiveZ = [];
  const negativeZ = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let tri = 0; tri < triCount; tri += 1) {
    const i0 = vertex(tri, 0);
    const i1 = vertex(tri, 1);
    const i2 = vertex(tri, 2);
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    const len = normal.length() || 1;
    const nz = normal.z / len;
    if (nz > 0.55) positiveZ.push(tri);
    else if (nz < -0.55) negativeZ.push(tri);
    else edge.push(tri);
  }

  const side1Tris = side1OnPositiveZ ? positiveZ : negativeZ;
  const side2Tris = side1OnPositiveZ ? negativeZ : positiveZ;
  const buckets = [edge, side1Tris, side2Tris];
  const src = index ? index.array : null;
  const next = new (position.count > 65535 ? Uint32Array : Uint16Array)(triCount * 3);
  let cursor = 0;
  const ranges = buckets.map((tris) => {
    const start = cursor;
    tris.forEach((tri) => {
      if (src) {
        next[cursor++] = src[tri * 3];
        next[cursor++] = src[tri * 3 + 1];
        next[cursor++] = src[tri * 3 + 2];
      } else {
        next[cursor++] = tri * 3;
        next[cursor++] = tri * 3 + 1;
        next[cursor++] = tri * 3 + 2;
      }
    });
    return { start, count: cursor - start };
  });

  geometry.setIndex(new THREE.BufferAttribute(next, 1));
  geometry.clearGroups();
  ranges.forEach((range, materialIndex) => {
    if (range.count > 0) geometry.addGroup(range.start, range.count, materialIndex);
  });

  const edgeMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const side1Material = createWallFaceMaterial(THREE, renderer, side1, edgeMaterial);
  const side2Material = createWallFaceMaterial(THREE, renderer, side2, edgeMaterial);
  mesh.material = [edgeMaterial, side1Material, side2Material];
  mesh.userData.faceSides = {
    side1: { ...side1, onPositiveZ: Boolean(side1OnPositiveZ) },
    side2: { ...side2, onPositiveZ: !side1OnPositiveZ },
  };
}

export function createWallSurfaceMaterial(THREE, renderer) {
  const wallCfg = THREE_CONFIG.MATERIALS.WALL;
  if (THREE_CONFIG.WALL_SURFACE?.ENABLED === false) {
    return new THREE.MeshStandardMaterial({
      color: wallCfg.color,
      roughness: wallCfg.roughness,
      metalness: wallCfg.metalness,
      envMapIntensity: wallCfg.envMapIntensity ?? 0.45,
      emissive: wallCfg.emissive ?? 0x000000,
      emissiveIntensity: wallCfg.emissiveIntensity ?? 0,
    });
  }

  const maps = getWallSurfaceTextures(THREE, renderer);
  const nScale = THREE_CONFIG.WALL_SURFACE?.NORMAL_SCALE ?? 0.42;
  return new THREE.MeshStandardMaterial({
    color: wallCfg.color,
    map: maps.albedo,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(nScale, nScale),
    roughnessMap: maps.roughness,
    roughness: 1,
    metalness: wallCfg.metalness,
    envMapIntensity: wallCfg.envMapIntensity ?? 0.35,
    emissive: wallCfg.emissive ?? 0x000000,
    emissiveIntensity: wallCfg.emissiveIntensity ?? 0,
  });
}

/** Same ribbed panel finish as the walls, with mesh-specific side and offset. */
export function createPanelSurfaceMaterial(THREE, renderer, extra = {}) {
  const material = createWallSurfaceMaterial(THREE, renderer);
  Object.assign(material, extra);
  return material;
}

export function finishPanelSurfaceMesh(THREE, mesh, renderer) {
  if (!mesh?.geometry) return;
  prepareWallSurfaceGeometry(THREE, mesh.geometry);
  ensureWallSurfaceDetail(THREE, mesh, renderer);
}

/** If tangents failed, fall back to bump so grooves still read up close. */
export function ensureWallSurfaceDetail(THREE, mesh, renderer) {
  if (!mesh?.geometry || !mesh.material || THREE_CONFIG.WALL_SURFACE?.ENABLED === false) return;
  if (mesh.geometry.attributes.tangent) return;
  const maps = getWallSurfaceTextures(THREE, renderer);
  mesh.material.normalMap = null;
  mesh.material.bumpMap = maps.bump;
  mesh.material.bumpScale = THREE_CONFIG.WALL_SURFACE?.BUMP_SCALE ?? 0.08;
  mesh.material.needsUpdate = true;
}

export function disposeMaterialSafe(material) {
  if (!material) return;
  const list = Array.isArray(material) ? material : [material];
  for (const mat of list) {
    const keys = ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'aoMap', 'metalnessMap', 'emissiveMap'];
    for (const key of keys) {
      const tex = mat[key];
      if (tex && !tex.userData?.shared && !tex.userData?.sharedWallSurface) {
        tex.dispose();
      }
    }
    mat.dispose();
  }
}
