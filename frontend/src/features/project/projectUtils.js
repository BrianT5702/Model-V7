import { normalizeWallCoordinates } from '../canvas/drawing';

/**
 * Check if two walls are collinear (vector approach)
 */
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

export function areCollinearWalls(wall1, wall2) {
  const vector1 = {
    x: wall1.end_x - wall1.start_x,
    y: wall1.end_y - wall1.start_y
  };
  const vector2 = {
    x: wall2.end_x - wall2.start_x,
    y: wall2.end_y - wall2.start_y
  };
  const crossProduct = vector1.x * vector2.y - vector1.y * vector2.x;
  if (Math.abs(crossProduct) > 0.001) return false;
  const dx = wall2.start_x - wall1.start_x;
  const dy = wall2.start_y - wall1.start_y;
  const crossPointCheck = dx * vector1.y - dy * vector1.x;
  return Math.abs(crossPointCheck) < 0.001;
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
    const toleranceSquared = tolerance * tolerance;

    // For each segment of the polygon, find walls that exactly match the segment
    for (let i = 0; i < polygonPoints.length; i++) {
        const currentPoint = polygonPoints[i];
        const nextPoint = polygonPoints[(i + 1) % polygonPoints.length];

        console.log(`Checking polygon segment ${i}: (${currentPoint.x}, ${currentPoint.y}) → (${nextPoint.x}, ${nextPoint.y})`);

        // Find walls that exactly connect these two points (within tolerance)
        const matchingWalls = walls.filter(wall => {
            // Check if wall connects current point to next point
            const wallStartToCurrent = Math.hypot(wall.start_x - currentPoint.x, wall.start_y - currentPoint.y);
            const wallEndToNext = Math.hypot(wall.end_x - nextPoint.x, wall.end_y - nextPoint.y);
            
            // Check if wall connects next point to current point (reverse direction)
            const wallStartToNext = Math.hypot(wall.start_x - nextPoint.x, wall.start_y - nextPoint.y);
            const wallEndToCurrent = Math.hypot(wall.end_x - currentPoint.x, wall.end_y - currentPoint.y);

            // Wall matches if either direction connects the points within tolerance
            const forwardMatch = wallStartToCurrent <= tolerance && wallEndToNext <= tolerance;
            const reverseMatch = wallStartToNext <= tolerance && wallEndToCurrent <= tolerance;

            if (forwardMatch || reverseMatch) {
                console.log(`Found matching wall ${wall.id}: (${wall.start_x}, ${wall.start_y}) → (${wall.end_x}, ${wall.end_y})`);
            }

            return forwardMatch || reverseMatch;
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
  return null;
}

/** True when two walls can be merged as a pair (properties, collinear, shared endpoint). */
export function canMergeWallPair(wallA, wallB, epsilon = 0.5) {
  if (!wallA || !wallB || wallA.id === wallB.id) return false;
  if (!wallsHaveSameMergeProperties([wallA, wallB])) return false;
  if (!areCollinearWalls(wallA, wallB)) return false;
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
      error: 'No continuous identical walls to merge. Walls need matching properties, collinear alignment, and end-to-end connection.',
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