import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { THREE_CONFIG } from './threeConfig';

function buildLineMaterial(options) {
  const {
    color = 0x000000,
    linewidth = THREE_CONFIG.RENDERER.SCREEN_LINE_WIDTH_PX,
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
    depthTest,
    depthWrite,
    transparent,
    opacity,
    alphaToCoverage,
    polygonOffset,
    polygonOffsetFactor,
    polygonOffsetUnits,
  });
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
