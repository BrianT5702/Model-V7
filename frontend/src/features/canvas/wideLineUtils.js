import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import THREE from './threeInstance';
import { THREE_CONFIG } from './threeConfig';

/** All LineMaterials created here — must sync resolution on resize or lines look soft/wrong. */
const trackedLineMaterials = new Set();

let lastResW = 1;
let lastResH = 1;

/**
 * Keep fat-line materials in sync with the drawing buffer size.
 * Call after renderer.setSize / setPixelRatio.
 */
export function syncLineMaterialResolution(width, height, pixelRatio = 1) {
  const w = Math.max(1, Math.floor((width || 1) * (pixelRatio || 1)));
  const h = Math.max(1, Math.floor((height || 1) * (pixelRatio || 1)));
  if (w === lastResW && h === lastResH) return;
  lastResW = w;
  lastResH = h;
  trackedLineMaterials.forEach((mat) => {
    if (mat && mat.resolution) mat.resolution.set(w, h);
  });
}

export function disposeTrackedLineMaterial(mat) {
  if (!mat) return;
  trackedLineMaterials.delete(mat);
  if (typeof mat.dispose === 'function') mat.dispose();
}

function buildLineMaterial(options) {
  const {
    color = 0x000000,
    linewidth = THREE_CONFIG.RENDERER.SCREEN_LINE_WIDTH_PX,
    worldUnits = false,
    depthTest = true,
    depthWrite = false,
    transparent = false,
    opacity = 1,
    alphaToCoverage: alphaToCoverageOpt,
    polygonOffset: polygonOffsetOpt,
    polygonOffsetFactor: polygonOffsetFactorOpt,
    polygonOffsetUnits: polygonOffsetUnitsOpt,
  } = options;

  // Default: bias lines in front of coplanar meshes (reduces flicker when zoomed out); callers may override.
  const polygonOffset =
    polygonOffsetOpt !== undefined
      ? polygonOffsetOpt
      : true;
  const polygonOffsetFactor =
    polygonOffsetFactorOpt !== undefined
      ? polygonOffsetFactorOpt
      : THREE_CONFIG.RENDERER.LINE_POLYGON_OFFSET_FACTOR;
  const polygonOffsetUnits =
    polygonOffsetUnitsOpt !== undefined
      ? polygonOffsetUnitsOpt
      : THREE_CONFIG.RENDERER.LINE_POLYGON_OFFSET_UNITS;

  // With renderer antialias + MSAA, alpha-to-coverage softens LineMaterial sawteeth (opaque lines only).
  const alphaToCoverage =
    alphaToCoverageOpt !== undefined
      ? alphaToCoverageOpt
      : THREE_CONFIG.RENDERER.LINE_ALPHA_TO_COVERAGE && !transparent;

  const mat = new LineMaterial({
    color,
    linewidth,
    worldUnits: Boolean(worldUnits),
    depthTest,
    depthWrite,
    transparent,
    opacity,
    alphaToCoverage,
    polygonOffset,
    polygonOffsetFactor,
    polygonOffsetUnits,
  });
  mat.resolution.set(lastResW, lastResH);
  trackedLineMaterials.add(mat);
  return mat;
}

/**
 * @param {import('three').EdgesGeometry} edgesGeometry — disposed after copy
 */
export function createFatLineSegmentsFromEdgesGeometry(edgesGeometry, options = {}) {
  const geom = new LineSegmentsGeometry();
  geom.fromEdgesGeometry(edgesGeometry);
  edgesGeometry.dispose();
  const mat = buildLineMaterial(options);
  const line = new LineSegments2(geom, mat);
  if (options.renderOrder != null) line.renderOrder = options.renderOrder;
  return line;
}

/** @param {Float32Array|number[]} positions — length multiple of 6 (segment pairs xyz) */
export function createFatLineSegmentsFromPositions(positions, options = {}) {
  const geom = new LineSegmentsGeometry();
  geom.setPositions(positions);
  const mat = buildLineMaterial(options);
  const line = new LineSegments2(geom, mat);
  if (options.renderOrder != null) line.renderOrder = options.renderOrder;
  return line;
}

/** Polyline (replaces THREE.Line). @param {Float32Array|number[]} positions — xyz... */
export function createFatLine2FromPositions(positions, options = {}) {
  const geom = new LineGeometry();
  geom.setPositions(positions);
  const mat = buildLineMaterial(options);
  const line = new Line2(geom, mat);
  line.computeLineDistances();
  if (options.renderOrder != null) line.renderOrder = options.renderOrder;
  return line;
}

const _segmentPoint = new THREE.Vector3();

export function disposeFatLineObject(line) {
  if (!line) return;
  line.removeFromParent();
  if (line.geometry) line.geometry.dispose();
  const materials = Array.isArray(line.material) ? line.material : [line.material];
  materials.forEach((mat) => disposeTrackedLineMaterial(mat));
  line.material = null;
}

function visibilityHost(line) {
  const userData = line.userData || {};
  if (userData.isPanelLine) return 'panel';
  if (userData.isCeilingPanelLine) return 'ceilingPanel';
  let parent = line.parent;
  while (parent) {
    const name = (parent.name || '').toLowerCase();
    if (parent.userData?.isFloor || name.startsWith('floor')) return `floor:${parent.uuid}`;
    if (parent.userData?.isCeiling || name.includes('ceiling')) return 'ceiling';
    parent = parent.parent;
  }
  return 'edges';
}

function fatLineGroupKey(line) {
  const material = line.material || {};
  const color = material.color?.getHexString?.() || '';
  return [
    visibilityHost(line),
    line.visible ? 1 : 0,
    line.renderOrder,
    color,
    material.linewidth,
    material.worldUnits ? 1 : 0,
    material.transparent ? 1 : 0,
    material.opacity,
    material.depthTest ? 1 : 0,
    material.depthWrite ? 1 : 0,
    material.polygonOffset ? 1 : 0,
    material.polygonOffsetFactor,
    material.polygonOffsetUnits,
  ].join('|');
}

function optionsFromLine(line) {
  const material = line.material;
  return {
    color: material.color?.getHex?.() ?? 0x000000,
    linewidth: material.linewidth,
    worldUnits: material.worldUnits,
    transparent: material.transparent,
    opacity: material.opacity,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    polygonOffset: material.polygonOffset,
    polygonOffsetFactor: material.polygonOffsetFactor,
    polygonOffsetUnits: material.polygonOffsetUnits,
    alphaToCoverage: material.alphaToCoverage,
    renderOrder: line.renderOrder,
  };
}

function appendWorldSegments(line, out) {
  const start = line.geometry?.getAttribute?.('instanceStart');
  const end = line.geometry?.getAttribute?.('instanceEnd');
  if (!start || !end) return;
  const matrix = line.matrixWorld;
  const count = Math.min(start.count, end.count);
  for (let i = 0; i < count; i += 1) {
    _segmentPoint.fromBufferAttribute(start, i).applyMatrix4(matrix);
    out.push(_segmentPoint.x, _segmentPoint.y, _segmentPoint.z);
    _segmentPoint.fromBufferAttribute(end, i).applyMatrix4(matrix);
    out.push(_segmentPoint.x, _segmentPoint.y, _segmentPoint.z);
  }
}

/**
 * Replace many identical fat lines with one line per look.
 * A zoomed-out view otherwise issues one draw call per wall seam.
 * Lines that must stay attached to a single floor are left alone.
 */
export function consolidateFatLines(root) {
  if (!root) return [];
  root.updateMatrixWorld(true);
  const lines = [];
  root.traverse((obj) => {
    if (obj.userData?.isFatLineBatch) return;
    if (obj.isLineSegments2 || obj.isLine2) lines.push(obj);
  });

  const groups = new Map();
  lines.forEach((line) => {
    const key = fatLineGroupKey(line);
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  });

  const batches = [];
  groups.forEach((group) => {
    if (group.length < 2) return;
    const positions = [];
    group.forEach((line) => appendWorldSegments(line, positions));
    if (positions.length < 6) return;

    const sample = group[0];
    const batch = createFatLineSegmentsFromPositions(positions, optionsFromLine(sample));
    batch.visible = sample.visible;
    batch.frustumCulled = true;
    batch.matrixAutoUpdate = false;
    batch.raycast = () => {};
    batch.userData.isFatLineBatch = true;
    const host = visibilityHost(sample);
    if (host === 'panel') batch.userData.isPanelLine = true;
    else if (host === 'ceilingPanel') batch.userData.isCeilingPanelLine = true;
    else if (host === 'ceiling') batch.name = 'ceiling_edge_lines';
    root.add(batch);
    group.forEach((line) => disposeFatLineObject(line));
    batches.push(batch);
  });
  return batches;
}
