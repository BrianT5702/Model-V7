/**
 * Check if two walls are collinear (vector approach)
 */
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