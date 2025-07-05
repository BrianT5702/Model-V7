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