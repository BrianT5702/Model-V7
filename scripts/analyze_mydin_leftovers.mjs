/**
 * Analyze leftover counts for a project payload on stdin.
 * Run: py scripts/export_project_calc_data.py 520 | node scripts/analyze_mydin_leftovers.mjs
 */
import { readFileSync } from 'fs';

const input = readFileSync(0, 'utf8');
const { walls, intersections } = JSON.parse(input);

const { optimizeWallPanelCalculation } = await import('../frontend/src/features/panel/wallPanelOptimizer.js');
const { getWallJointTypes, getWallLength } = await import('../frontend/src/features/panel/wallPanelCalculationUtils.js');

const result = optimizeWallPanelCalculation(walls, intersections);
const { calculator, analysis, score, combinationsTested, optimizationMode } = result;

const leftovers = calculator?.leftovers || [];
const widthBuckets = {};
const heightBuckets = {};
const thicknessBuckets = {};
const edgeBuckets = {};

for (const lo of leftovers) {
  const w = Math.round(lo.longer_face || 0);
  widthBuckets[w] = (widthBuckets[w] || 0) + 1;
  heightBuckets[lo.panelLength] = (heightBuckets[lo.panelLength] || 0) + 1;
  thicknessBuckets[lo.wallThickness] = (thicknessBuckets[lo.wallThickness] || 0) + 1;
  const edge = `${lo.leftEdgeType || '?'}/${lo.rightEdgeType || '?'}`;
  edgeBuckets[edge] = (edgeBuckets[edge] || 0) + 1;
}

const sideCutWidths = {};
let wallsNeedingCut = 0;
for (const wall of walls) {
  const L = getWallLength(wall);
  if (L % 1150 !== 0) wallsNeedingCut += 1;
  const joints = getWallJointTypes(wall, intersections);
  const has45 = joints.left === '45_cut' || joints.right === '45_cut';
  sideCutWidths[L] = sideCutWidths[L] || { count: 0, has45: 0 };
  sideCutWidths[L].count += 1;
  if (has45) sideCutWidths[L].has45 += 1;
}

const topLeftoverWidths = Object.entries(widthBuckets)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15);

const topWallLengths = Object.entries(sideCutWidths)
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 10)
  .map(([len, info]) => ({ length: Number(len), walls: info.count, with45: info.has45 }));

console.log(JSON.stringify({
  projectWalls: walls.length,
  intersections: intersections.length,
  optimizationMode,
  combinationsTested,
  analysis: analysis?.details,
  score,
  leftoverCount: leftovers.length,
  leftoverReused: score?.leftoverReused,
  newStockCuts: score?.fullPanelsUsedForCutting,
  wallsNeedingCut,
  leftoverByHeight: heightBuckets,
  leftoverByThickness: thicknessBuckets,
  leftoverByEdge: edgeBuckets,
  topLeftoverWidths,
  topWallLengths,
  tinyLeftovers: leftovers.filter((lo) => (lo.longer_face || 0) < (lo.wallThickness || 0)).length,
  smallLeftoversUnder200: leftovers.filter((lo) => (lo.longer_face || 0) < 200).length,
}, null, 2));
