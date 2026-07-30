import { normalizeWallCoordinates } from '../canvas/drawing';
import { getWallExtendedEndpointsForMatching, isPartitionWall } from '../canvas/utils';

/** True when both walls have the same gap-fill mode and matching gap settings. */
export function gapFillSettingsMatch(wall1, wall2) {
  const gap1 = Boolean(wall1.fill_gap_mode);
  const gap2 = Boolean(wall2.fill_gap_mode);
  if (gap1 !== gap2) return false;
  if (!gap1) return true;
  return (
    wall1.gap_fill_height === wall2.gap_fill_height &&
    wall1.gap_base_position === wall2.gap_base_position
  );
}

/**
 * Check if two walls are collinear (same infinite line, parallel or anti-parallel).
 * Uses length-normalized angle + perpendicular distance so long slant walls still
 * match after mm rounding (raw cross-product grows with length and falsely fails).
 */
export function areCollinearWalls(wall1, wall2, options = {}) {
  const angleTolDeg = options.angleTolDeg ?? 2;
  // Adaptive: tiny angle error grows as L*sin(θ). Default floor 2mm was rejecting
  // valid slant chains (e.g. 650+4818 with ~0.04° drift → ~3.4mm at far end).
  const distTolMm =
    options.distTolMm ??
    Math.max(2, Math.max(
      Math.hypot(
        Number(wall1.end_x) - Number(wall1.start_x),
        Number(wall1.end_y) - Number(wall1.start_y)
      ),
      Math.hypot(
        Number(wall2.end_x) - Number(wall2.start_x),
        Number(wall2.end_y) - Number(wall2.start_y)
      )
    ) * Math.sin((angleTolDeg * Math.PI) / 180));

  const v1x = Number(wall1.end_x) - Number(wall1.start_x);
  const v1y = Number(wall1.end_y) - Number(wall1.start_y);
  const v2x = Number(wall2.end_x) - Number(wall2.start_x);
  const v2y = Number(wall2.end_y) - Number(wall2.start_y);
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 < 1e-6 || len2 < 1e-6) return false;

  // |sin(theta)| from unit-length cross product
  const sinAbs = Math.abs(v1x * v2y - v1y * v2x) / (len1 * len2);
  if (sinAbs > Math.sin((angleTolDeg * Math.PI) / 180)) return false;

  const distToLine1 = (px, py) =>
    Math.abs((px - Number(wall1.start_x)) * v1y - (py - Number(wall1.start_y)) * v1x) / len1;

  return (
    distToLine1(Number(wall2.start_x), Number(wall2.start_y)) <= distTolMm &&
    distToLine1(Number(wall2.end_x), Number(wall2.end_y)) <= distTolMm
  );
}

/** True when wall directions agree within angleTol (parallel or anti-parallel). */
export function areNearlyParallelWalls(wall1, wall2, angleTolDeg = 2) {
  const v1x = Number(wall1.end_x) - Number(wall1.start_x);
  const v1y = Number(wall1.end_y) - Number(wall1.start_y);
  const v2x = Number(wall2.end_x) - Number(wall2.start_x);
  const v2y = Number(wall2.end_y) - Number(wall2.start_y);
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 < 1e-6 || len2 < 1e-6) return false;
  const sinAbs = Math.abs(v1x * v2y - v1y * v2x) / (len1 * len2);
  return sinAbs <= Math.sin((angleTolDeg * Math.PI) / 180);
}

/**
 * Calculate the intersection point of two line segments (if any)
 */
export function calculateIntersection(wall1Start, wall1End, wall2Start, wall2End) {
  const denominator = ((wall2End.y - wall2Start.y) * (wall1End.x - wall1Start.x)) -
    ((wall2End.x - wall2Start.x) * (wall1End.y - wall1Start.y));
  if (denominator === 0) return null;
  const ua = (((wall2End.x - wall2Start.x) * (wall1Start.y - wall2Start.y)) -
    ((wall2End.y - wall2Start.y) * (wall1Start.x - wall2Start.x))) / denominator;
  const ub = (((wall1End.x - wall1Start.x) * (wall1Start.y - wall2Start.y)) -
    ((wall1End.y - wall1Start.y) * (wall1Start.x - wall2Start.x))) / denominator;
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      x: wall1Start.x + (ua * (wall1End.x - wall1Start.x)),
      y: wall1Start.y + (ua * (wall1End.y - wall1Start.y))
    };
  }
  return null;
}

/**
 * Check if two points are equal within a given epsilon
 */
export function arePointsEqual(p1, p2, epsilon = 0.001) {
  return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon;
}

/**
 * Detect walls that form the perimeter of a room based on polygon points
 * @param {Array} polygonPoints - Array of {x, y} points defining the room boundary
 * @param {Array} walls - Array of wall objects
 * @param {number} tolerance - Distance tolerance for considering a wall part of the perimeter (default: 1mm)
 * @returns {Array} Array of wall IDs that form the room perimeter
 */
export function detectRoomWalls(polygonPoints, walls, tolerance = 1) {
    console.log('detectRoomWalls called with:', { polygonPoints, walls: walls.length, tolerance });
    
    if (!polygonPoints || polygonPoints.length < 3 || !walls || walls.length === 0) {
        console.log('Early return - insufficient data');
        return [];
    }

    const detectedWallIds = [];

    // Partition + thickness-deducted tips are matched via extended host junctions.
    const wallMatchEnds = (wall) =>
        getWallExtendedEndpointsForMatching(wall, walls) || {
            start: { x: wall.start_x, y: wall.start_y },
            end: { x: wall.end_x, y: wall.end_y },
        };

    const wallNeedsLooseTipMatch = (wall, ends) => {
        if (isPartitionWall(wall)) return true;
        const rawStartDist = Math.hypot(ends.start.x - wall.start_x, ends.start.y - wall.start_y);
        const rawEndDist = Math.hypot(ends.end.x - wall.end_x, ends.end.y - wall.end_y);
        return rawStartDist > 0.75 || rawEndDist > 0.75;
    };

    // For each segment of the polygon, find walls that exactly match the segment
    for (let i = 0; i < polygonPoints.length; i++) {
        const currentPoint = polygonPoints[i];
        const nextPoint = polygonPoints[(i + 1) % polygonPoints.length];

        console.log(`Checking polygon segment ${i}: (${currentPoint.x}, ${currentPoint.y}) → (${nextPoint.x}, ${nextPoint.y})`);

        // Find walls that exactly connect these two points (within tolerance)
        const matchingWalls = walls.filter(wall => {
            const ends = wallMatchEnds(wall);
            const wallStartToCurrent = Math.hypot(ends.start.x - currentPoint.x, ends.start.y - currentPoint.y);
            const wallEndToNext = Math.hypot(ends.end.x - nextPoint.x, ends.end.y - nextPoint.y);
            
            const wallStartToNext = Math.hypot(ends.start.x - nextPoint.x, ends.start.y - nextPoint.y);
            const wallEndToCurrent = Math.hypot(ends.end.x - currentPoint.x, ends.end.y - currentPoint.y);

            // Inset / partition tips: allow host-thickness slack so extended room
            // corners still pick up the wall.
            const loose = wallNeedsLooseTipMatch(wall, ends);
            const tipTol = loose
                ? Math.max(tolerance, (Number(wall.thickness) || 0) + 1)
                : tolerance;

            const forwardMatch = wallStartToCurrent <= tipTol && wallEndToNext <= tipTol;
            const reverseMatch = wallStartToNext <= tipTol && wallEndToCurrent <= tipTol;

            // Collinear overlap: wall may be longer than the room edge (continues
            // past a T-junction) or shorter (inset / multi-segment edge). Exact
            // endpoint matching misses both; require shared stretch on the same line.
            let overlapMatch = false;
            if (!forwardMatch && !reverseMatch) {
                const segDx = nextPoint.x - currentPoint.x;
                const segDy = nextPoint.y - currentPoint.y;
                const segLen = Math.hypot(segDx, segDy);
                const wdx = wall.end_x - wall.start_x;
                const wdy = wall.end_y - wall.start_y;
                const wLen = Math.hypot(wdx, wdy);
                if (segLen > 0.001 && wLen > 0.001) {
                    const dot = Math.abs((segDx * wdx + segDy * wdy) / (segLen * wLen));
                    if (dot >= 0.999) {
                        const ux = segDx / segLen;
                        const uy = segDy / segLen;
                        const nx = -uy;
                        const ny = ux;
                        const project = (px, py) => {
                            const relX = px - currentPoint.x;
                            const relY = py - currentPoint.y;
                            return {
                                along: relX * ux + relY * uy,
                                perp: Math.abs(relX * nx + relY * ny),
                            };
                        };
                        const a = project(wall.start_x, wall.start_y);
                        const b = project(wall.end_x, wall.end_y);
                        // Centerlines should coincide; allow a little slack for mm rounding.
                        const perpTol = Math.max(tolerance, loose ? ((Number(wall.thickness) || 0) + 1) : 2);
                        if (a.perp <= perpTol && b.perp <= perpTol) {
                            const wMin = Math.min(a.along, b.along);
                            const wMax = Math.max(a.along, b.along);
                            const overlap =
                                Math.min(wMax, segLen + tipTol) - Math.max(wMin, -tipTol);
                            overlapMatch = overlap > Math.max(1, tolerance);
                        }
                    }
                }
            }

            if (forwardMatch || reverseMatch || overlapMatch) {
                console.log(`Found matching wall ${wall.id}: (${wall.start_x}, ${wall.start_y}) → (${wall.end_x}, ${wall.end_y})`);
            }

            return forwardMatch || reverseMatch || overlapMatch;
        });

        // Add matching wall IDs to the result
        matchingWalls.forEach(wall => {
            if (!detectedWallIds.includes(wall.id)) {
                detectedWallIds.push(wall.id);
                console.log(`Added wall ${wall.id} to detected walls`);
            }
        });
    }

    // Remove the second part that was too permissive - we only want exact matches
    console.log('Final detected walls for room:', detectedWallIds);
    return detectedWallIds;
}

/**
 * Calculate distance from a point to a line segment
 * @param {number} px, py - Point coordinates
 * @param {number} x1, y1, x2, y2 - Line segment endpoints
 * @returns {number} Distance from point to line segment
 */
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;

    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Stable key for a wall segment (normalized direction). */
export function getWallSegmentKey(wall) {
  const normalized = normalizeWallCoordinates(
    { x: wall.start_x, y: wall.start_y },
    { x: wall.end_x, y: wall.end_y }
  );
  const { startPoint, endPoint } = normalized;
  return `${startPoint.x}|${startPoint.y}|${endPoint.x}|${endPoint.y}`;
}

/** Elevation (mm) for a storey id; defaults to 0. */
export function getStoreyElevationMm(storeys, storeyId) {
  if (storeyId === null || storeyId === undefined) {
    return 0;
  }
  const storey = (storeys || []).find((s) => String(s.id) === String(storeyId));
  if (!storey || storey.elevation_mm === undefined || storey.elevation_mm === null) {
    return 0;
  }
  return Number(storey.elevation_mm) || 0;
}

/** Vertical base (mm) for 3D: rooms → wall field → storey elevation. */
export function resolveWallBaseElevationMm(wall, project = null) {
  if (wall.base_elevation_manual && wall.base_elevation_mm !== undefined && wall.base_elevation_mm !== null) {
    return Number(wall.base_elevation_mm) || 0;
  }

  const rooms = project?.rooms;
  if (Array.isArray(rooms) && rooms.length > 0) {
    const wallId = String(wall.id);
    const containing = rooms.filter((room) => {
      const roomWalls = Array.isArray(room.walls) ? room.walls : [];
      return roomWalls.some((w) => String(typeof w === 'object' ? w.id : w) === wallId);
    });
    if (containing.length > 0) {
      const elevations = containing
        .map((room) => room.base_elevation_mm)
        .filter((elev) => elev !== undefined && elev !== null)
        .map((elev) => Number(elev) || 0);
      if (elevations.length > 0) {
        return Math.min(...elevations);
      }
    }
  }

  if (wall.base_elevation_mm !== undefined && wall.base_elevation_mm !== null) {
    return Number(wall.base_elevation_mm) || 0;
  }

  const storeyId = wall.storey ?? wall.storey_id;
  return getStoreyElevationMm(project?.storeys, storeyId);
}

/** All walls share type, height, thickness, face finishes, and gap-fill settings. */
export function wallsHaveSameMergeProperties(walls = []) {
  if (!Array.isArray(walls) || walls.length < 2) return false;
  const ref = walls[0];
  return walls.every((wall) => {
    if (
      wall.application_type !== ref.application_type ||
      wall.height !== ref.height ||
      wall.thickness !== ref.thickness
    ) {
      return false;
    }
    if (
      (wall.inner_face_material ?? '') !== (ref.inner_face_material ?? '') ||
      (wall.outer_face_material ?? '') !== (ref.outer_face_material ?? '') ||
      Number(wall.inner_face_thickness) !== Number(ref.inner_face_thickness) ||
      Number(wall.outer_face_thickness) !== Number(ref.outer_face_thickness)
    ) {
      return false;
    }
    return gapFillSettingsMatch(wall, ref);
  });
}

/** Every wall lies on the same line as the first wall. */
export function areAllCollinearWalls(walls = []) {
  if (!Array.isArray(walls) || walls.length < 2) return false;
  const ref = walls[0];
  return walls.every((wall) => areCollinearWalls(ref, wall));
}

/**
 * Order collinear walls into a single end-to-end chain.
 * Returns null when endpoints do not form one straight chain.
 */
export function orderWallsIntoMergeChain(walls = [], epsilon = 0.5) {
  if (!Array.isArray(walls) || walls.length === 0) return null;
  if (walls.length === 1) return walls;

  const endpointEntries = walls.flatMap((wall) => ([
    { wallId: wall.id, end: 'start', point: { x: wall.start_x, y: wall.start_y } },
    { wallId: wall.id, end: 'end', point: { x: wall.end_x, y: wall.end_y } },
  ]));

  const groups = [];
  endpointEntries.forEach((entry) => {
    let group = groups.find((candidate) => arePointsEqual(candidate.point, entry.point, epsilon));
    if (!group) {
      group = { point: entry.point, members: [] };
      groups.push(group);
    }
    group.members.push(entry);
  });

  if (groups.some((group) => group.members.length > 2)) return null;

  const terminalGroups = groups.filter((group) => group.members.length === 1);
  const jointGroups = groups.filter((group) => group.members.length === 2);

  if (terminalGroups.length !== 2 || jointGroups.length !== walls.length - 1) {
    return null;
  }

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const getOtherPoint = (wall, end) => (
    end === 'start'
      ? { x: wall.end_x, y: wall.end_y }
      : { x: wall.start_x, y: wall.start_y }
  );

  const startEntry = terminalGroups[0].members[0];
  const ordered = [];
  const used = new Set();

  let currentWall = wallById.get(startEntry.wallId);
  if (!currentWall) return null;

  ordered.push(currentWall);
  used.add(currentWall.id);
  let openPoint = getOtherPoint(currentWall, startEntry.end);

  while (ordered.length < walls.length) {
    const nextWall = walls.find((wall) => (
      !used.has(wall.id) && (
        arePointsEqual(openPoint, { x: wall.start_x, y: wall.start_y }, epsilon) ||
        arePointsEqual(openPoint, { x: wall.end_x, y: wall.end_y }, epsilon)
      )
    ));

    if (!nextWall) return null;

    ordered.push(nextWall);
    used.add(nextWall.id);

    if (arePointsEqual(openPoint, { x: nextWall.start_x, y: nextWall.start_y }, epsilon)) {
      openPoint = { x: nextWall.end_x, y: nextWall.end_y };
    } else {
      openPoint = { x: nextWall.start_x, y: nextWall.start_y };
    }
  }

  return ordered.length === walls.length ? ordered : null;
}

/** Return [firstWallId, secondWallId] in the order required by the merge API. */
export function getWallMergePairIds(wallA, wallB, epsilon = 0.5) {
  if (
    arePointsEqual(
      { x: wallA.end_x, y: wallA.end_y },
      { x: wallB.start_x, y: wallB.start_y },
      epsilon
    )
  ) {
    return [wallA.id, wallB.id];
  }
  if (
    arePointsEqual(
      { x: wallB.end_x, y: wallB.end_y },
      { x: wallA.start_x, y: wallA.start_y },
      epsilon
    )
  ) {
    return [wallB.id, wallA.id];
  }
  // After normalize, slant segments usually meet end→start, but start↔start /
  // end↔end can still happen; backend resolves free endpoints either way.
  const aStarts = [
    { x: wallA.start_x, y: wallA.start_y },
    { x: wallA.end_x, y: wallA.end_y },
  ];
  const bStarts = [
    { x: wallB.start_x, y: wallB.start_y },
    { x: wallB.end_x, y: wallB.end_y },
  ];
  for (const a of aStarts) {
    for (const b of bStarts) {
      if (arePointsEqual(a, b, epsilon)) {
        return [wallA.id, wallB.id];
      }
    }
  }
  return null;
}

/** True when two walls can be merged as a pair (properties, nearly parallel, shared endpoint). */
export function canMergeWallPair(wallA, wallB, epsilon = 0.5) {
  if (!wallA || !wallB || wallA.id === wallB.id) return false;
  if (!wallsHaveSameMergeProperties([wallA, wallB])) return false;
  // Shared join + nearly parallel is enough. Full collinear distance rejects long
  // slant chains where mm rounding creates a few-mm drift at the far end.
  if (!areNearlyParallelWalls(wallA, wallB, 2)) return false;
  return Boolean(getWallMergePairIds(wallA, wallB, epsilon));
}

/**
 * From a mixed selection, find every continuous identical mergeable chain.
 * Non-matching / disconnected walls are left out (not an error).
 * Returns { ok, groups, skippedCount, error }.
 */
export function findMergeableWallGroups(selectedWallIds = [], walls = [], epsilon = 0.5) {
  if (!Array.isArray(selectedWallIds) || selectedWallIds.length < 2) {
    return { ok: false, groups: [], skippedCount: 0, error: 'Please select at least 2 walls to merge.' };
  }

  const uniqueIds = [...new Set(selectedWallIds)];
  const selectedWalls = uniqueIds
    .map((id) => walls.find((wall) => wall.id === id))
    .filter(Boolean);

  if (selectedWalls.length < 2) {
    return { ok: false, groups: [], skippedCount: 0, error: 'Invalid wall selection.' };
  }

  const adj = new Map(selectedWalls.map((wall) => [wall.id, []]));
  for (let i = 0; i < selectedWalls.length; i += 1) {
    for (let j = i + 1; j < selectedWalls.length; j += 1) {
      const a = selectedWalls[i];
      const b = selectedWalls[j];
      if (!canMergeWallPair(a, b, epsilon)) continue;
      adj.get(a.id).push(b);
      adj.get(b.id).push(a);
    }
  }

  const visited = new Set();
  const groups = [];

  selectedWalls.forEach((seed) => {
    if (visited.has(seed.id)) return;

    const component = [];
    const queue = [seed];
    visited.add(seed.id);

    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);
      (adj.get(current.id) || []).forEach((neighbor) => {
        if (visited.has(neighbor.id)) return;
        visited.add(neighbor.id);
        queue.push(neighbor);
      });
    }

    if (component.length < 2) return;

    const ordered = orderWallsIntoMergeChain(component, epsilon);
    if (!ordered || ordered.length < 2) return;

    const pairsOk = ordered.every((wall, index) => {
      if (index === ordered.length - 1) return true;
      return Boolean(getWallMergePairIds(wall, ordered[index + 1], epsilon));
    });
    if (!pairsOk) return;

    groups.push(ordered);
  });

  if (groups.length === 0) {
    return {
      ok: false,
      groups: [],
      skippedCount: selectedWalls.length,
      error: 'No continuous identical walls to merge. Walls need matching properties, nearly the same direction, and end-to-end connection.',
    };
  }

  const mergedIds = new Set(groups.flatMap((group) => group.map((wall) => wall.id)));
  const skippedCount = selectedWalls.filter((wall) => !mergedIds.has(wall.id)).length;

  return { ok: true, groups, skippedCount, error: null };
}

/**
 * Validate a multi-wall merge selection before calling the API.
 * Mixed selections are allowed: only continuous identical chains are merged.
 * Returns { ok: true, groups } or { ok: false, error }.
 */
export function validateWallsForMerge(selectedWallIds = [], walls = [], epsilon = 0.5) {
  const result = findMergeableWallGroups(selectedWallIds, walls, epsilon);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    groups: result.groups,
    // Back-compat: single-chain callers can still read orderedWalls
    orderedWalls: result.groups.length === 1 ? result.groups[0] : null,
    skippedCount: result.skippedCount,
  };
}

/**
 * Thickness offset direction (centerline → outer face), matching calculateOffsetPoints
 * when thickness flips toward plan center / room reference.
 */
export function getWallThicknessDirUnit(x1, y1, x2, y2, center) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = dy / length;
  const normalY = -dx / length;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const ref = center || { x: midX, y: midY };
  const dotProduct = normalX * (ref.x - midX) + normalY * (ref.y - midY);
  const shouldFlip = dotProduct > 0;
  // line2 = line1 - finalOffset; finalOffset = shouldFlip ? -n : +n  (in normal units)
  // → centerline→face = shouldFlip ? +n : -n
  return shouldFlip ? { x: normalX, y: normalY } : { x: -normalX, y: -normalY };
}

export function estimateWallsPlanCenter(walls = []) {
  if (!walls.length) return { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.start_x, w.end_x);
    minY = Math.min(minY, w.start_y, w.end_y);
    maxX = Math.max(maxX, w.start_x, w.end_x);
    maxY = Math.max(maxY, w.start_y, w.end_y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * When a new wall forms a corner on a free host endpoint and its thickness would
 * stick past that endpoint (e.g. H=8000 then V at the right with thickness out),
 * shorten the host and move the join so the typed overall stays as the outer dim.
 *
 * The new wall's direction and length are preserved (both ends shift by the same
 * delta). Moving only the join would tilt a 90° H/V wall by ~thickness mm.
 *
 * @returns {{ startPoint, endPoint, hostUpdates: Array<{ wall, start_x, start_y, end_x, end_y }> }}
 */
export function compensateExteriorCornerThickness({
  startPoint,
  endPoint,
  newThickness,
  walls = [],
  center = null,
  joinTolMm = 2,
}) {
  const t = Math.round(Number(newThickness) || 0);
  if (t <= 0 || !startPoint || !endPoint) {
    return { startPoint, endPoint, hostUpdates: [] };
  }

  // `center` reserved for future thickness-side gating
  void center;

  let s = { x: startPoint.x, y: startPoint.y };
  let e = { x: endPoint.x, y: endPoint.y };
  const hostUpdates = new Map();

  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= joinTolMm;

  const findExclusiveHostAt = (pt) => {
    const hits = [];
    for (const wall of walls) {
      const atStart = near(pt, { x: wall.start_x, y: wall.start_y });
      const atEnd = near(pt, { x: wall.end_x, y: wall.end_y });
      if (atStart || atEnd) {
        hits.push({ wall, atStart, atEnd });
      }
    }
    // Only auto-adjust a free end (one wall). Multi-wall corners stay as-is.
    if (hits.length !== 1) return null;
    return hits[0];
  };

  /** @returns {{ join: {x,y}, other: {x,y} } | null} */
  const computeJoinShift = (joinPt, otherPt) => {
    const hit = findExclusiveHostAt(joinPt);
    if (!hit) return null;

    const { wall, atStart, atEnd } = hit;
    const hostStart = { x: wall.start_x, y: wall.start_y };
    const hostEnd = { x: wall.end_x, y: wall.end_y };
    const hostLen = Math.hypot(hostEnd.x - hostStart.x, hostEnd.y - hostStart.y);
    if (hostLen < t + 1) return null;

    // Unit along host toward the join
    let uAx;
    let uAy;
    if (atEnd && !atStart) {
      uAx = (hostEnd.x - hostStart.x) / hostLen;
      uAy = (hostEnd.y - hostStart.y) / hostLen;
    } else if (atStart && !atEnd) {
      uAx = (hostStart.x - hostEnd.x) / hostLen;
      uAy = (hostStart.y - hostEnd.y) / hostLen;
    } else {
      return null;
    }

    const newDx = otherPt.x - joinPt.x;
    const newDy = otherPt.y - joinPt.y;
    const newLen = Math.hypot(newDx, newDy);
    if (newLen < 1) return null;

    // Skip near-collinear continuations (not a corner)
    const uBx = newDx / newLen;
    const uBy = newDy / newLen;
    if (Math.abs(uAx * uBx + uAy * uBy) > 0.5) return null;

    // Treat the host's typed length as PDF-style overall that should include this
    // new corner wall's thickness. Shorten the host and move the join inward.
    const shortenBy = t;
    if (shortenBy >= hostLen - 1) return null;

    const newJoin = {
      x: Math.round(joinPt.x - uAx * shortenBy),
      y: Math.round(joinPt.y - uAy * shortenBy),
    };

    const updated = {
      wall,
      start_x: wall.start_x,
      start_y: wall.start_y,
      end_x: wall.end_x,
      end_y: wall.end_y,
    };
    if (atEnd) {
      updated.end_x = newJoin.x;
      updated.end_y = newJoin.y;
    } else {
      updated.start_x = newJoin.x;
      updated.start_y = newJoin.y;
    }
    // Re-normalize host direction after edit
    const normalized = normalizeWallCoordinates(
      { x: updated.start_x, y: updated.start_y },
      { x: updated.end_x, y: updated.end_y }
    );
    updated.start_x = normalized.startPoint.x;
    updated.start_y = normalized.startPoint.y;
    updated.end_x = normalized.endPoint.x;
    updated.end_y = normalized.endPoint.y;

    hostUpdates.set(wall.id, updated);
    // After normalize, attach to the endpoint that matches the shortened join
    const jStart = { x: updated.start_x, y: updated.start_y };
    const jEnd = { x: updated.end_x, y: updated.end_y };
    const join =
      Math.hypot(jStart.x - newJoin.x, jStart.y - newJoin.y) <=
      Math.hypot(jEnd.x - newJoin.x, jEnd.y - newJoin.y)
        ? jStart
        : jEnd;

    // Keep new-wall direction + length: translate the free end by the same delta
    const other = {
      x: Math.round(join.x + (otherPt.x - joinPt.x)),
      y: Math.round(join.y + (otherPt.y - joinPt.y)),
    };
    return { join, other };
  };

  const shiftStart = computeJoinShift(s, e);
  if (shiftStart) {
    s = shiftStart.join;
    e = shiftStart.other;
  }
  const shiftEnd = computeJoinShift(e, s);
  if (shiftEnd) {
    e = shiftEnd.join;
    s = shiftEnd.other;
  }

  return {
    startPoint: s,
    endPoint: e,
    hostUpdates: Array.from(hostUpdates.values()),
  };
}
