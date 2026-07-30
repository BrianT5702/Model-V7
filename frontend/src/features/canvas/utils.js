// Utility functions extracted from Canvas2D.js

import { resolveDoorPlacement, worldToDoorLocal, getSlidePanelYOffset } from './doorPlacement.js';

// Calculate the area of a polygon given its points
export function calculatePolygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

// Get ordered points from room walls
export function getOrderedPoints(roomWalls) {
    const connections = new Map();
    roomWalls.forEach(wall => {
        const start = `${wall.start_x},${wall.start_y}`;
        const end = `${wall.end_x},${wall.end_y}`;
        if (!connections.has(start)) connections.set(start, new Set());
        if (!connections.has(end)) connections.set(end, new Set());
        connections.get(start).add(end);
        connections.get(end).add(start);
    });
    const orderedPoints = [];
    let currentPoint = Array.from(connections.keys())[0];
    const visited = new Set();
    while (orderedPoints.length < connections.size) {
        if (!visited.has(currentPoint)) {
            const [x, y] = currentPoint.split(',').map(Number);
            orderedPoints.push({ x, y });
            visited.add(currentPoint);
            const neighbors = connections.get(currentPoint);
            currentPoint = Array.from(neighbors).find(p => !visited.has(p));
            if (!currentPoint && visited.size < connections.size) {
                currentPoint = Array.from(connections.keys()).find(p => !visited.has(p));
            }
        }
    }
    return orderedPoints;
}

// Calculate inset points for a polygon
export function calculateInsetPoints(points, insetDistance) {
    const insetPoints = [];
    const len = points.length;
    for (let i = 0; i < len; i++) {
        const prev = points[(i - 1 + len) % len];
        const curr = points[i];
        const next = points[(i + 1) % len];
        // Calculate vectors for previous and next segments
        const v1 = {
            x: curr.x - prev.x,
            y: curr.y - prev.y
        };
        const v2 = {
            x: next.x - curr.x,
            y: next.y - curr.y
        };
        // Normalize vectors
        const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
        const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
        const n1 = {
            x: -v1.y / len1,
            y: v1.x / len1
        };
        const n2 = {
            x: -v2.y / len2,
            y: v2.x / len2
        };
        // Calculate average normal vector (bisector)
        const bisector = {
            x: (n1.x + n2.x) / 2,
            y: (n1.y + n2.y) / 2
        };
        // Calculate angle between segments
        const dot = n1.x * n2.x + n1.y * n2.y;
        const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
        // Calculate fixed inset distance for the corner
        const offsetDist = insetDistance / Math.sin(angle / 2);
        // Calculate inset point
        const bisectorLen = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
        insetPoints.push({
            x: curr.x + (bisector.x / bisectorLen) * offsetDist,
            y: curr.y + (bisector.y / bisectorLen) * offsetDist
        });
    }
    return insetPoints;
}

// Calculate the visual center (centroid) of a polygon
export function calculatePolygonVisualCenter(points) {
    if (!points || points.length < 3) return null;
    if (points.length === 4) {
        return {
            x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
            y: points.reduce((sum, p) => sum + p.y, 0) / points.length
        };
    }
    // For L-shaped or irregular rooms, use the centroid of the largest inscribed triangle
    const triangulate = (vertices) => {
        const triangles = [];
        const n = vertices.length;
        if (n < 3) return triangles;
        const V = vertices.map((pt, i) => ({ x: pt.x, y: pt.y, index: i }));
        while (V.length > 3) {
            for (let i = 0; i < V.length; i++) {
                const a = V[i];
                const b = V[(i + 1) % V.length];
                const c = V[(i + 2) % V.length];
                if (isValidEar(a, b, c, V)) {
                    triangles.push([a, b, c]);
                    V.splice((i + 1) % V.length, 1);
                    break;
                }
            }
        }
        if (V.length === 3) triangles.push(V);
        return triangles;
    };
    const isValidEar = (a, b, c, vertices) => {
        for (const v of vertices) {
            if (v === a || v === b || v === c) continue;
            if (isPointInTriangle(v, a, b, c)) return false;
        }
        return true;
    };
    const isPointInTriangle = (p, a, b, c) => {
        const area = 0.5 * (-b.y * c.x + a.y * (-b.x + c.x) + a.x * (b.y - c.y) + b.x * c.y);
        const s = 1 / (2 * area) * (a.y * c.x - a.x * c.y + (c.y - a.y) * p.x + (a.x - c.x) * p.y);
        const t = 1 / (2 * area) * (a.x * b.y - a.y * b.x + (a.y - b.y) * p.x + (b.x - a.x) * p.y);
        return s >= 0 && t >= 0 && (1 - s - t) >= 0;
    };
    const triangles = triangulate(points);
    let maxArea = 0;
    let bestCentroid = null;
    triangles.forEach(triangle => {
        const area = Math.abs(
            (triangle[0].x * (triangle[1].y - triangle[2].y) +
             triangle[1].x * (triangle[2].y - triangle[0].y) +
             triangle[2].x * (triangle[0].y - triangle[1].y)) / 2
        );
        if (area > maxArea) {
            maxArea = area;
            bestCentroid = {
                x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
                y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3
            };
        }
    });
    return bestCentroid;
}

// Check if a point is inside a polygon
export function isPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y))
            && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Check if two points are equal within a small epsilon
export function arePointsEqual(p1, p2, epsilon = 0.001) {
    return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon;
}

// Check if two polygons overlap (simplified: checks if any vertex of one polygon is inside the other)
export function doPolygonsOverlap(polygon1, polygon2) {
    if (!polygon1 || !polygon2 || polygon1.length < 3 || polygon2.length < 3) {
        return false;
    }
    
    // Normalize polygons to have {x, y} format
    const normalizePolygon = (poly) => {
        return poly.map(pt => ({
            x: Number(pt.x) || 0,
            y: Number(pt.y) || 0
        }));
    };
    
    const normPoly1 = normalizePolygon(polygon1);
    const normPoly2 = normalizePolygon(polygon2);
    
    // Check if any vertex of polygon1 is inside polygon2
    for (const vertex of normPoly1) {
        if (isPointInPolygon(vertex, normPoly2)) {
            return true;
        }
    }
    
    // Check if any vertex of polygon2 is inside polygon1
    for (const vertex of normPoly2) {
        if (isPointInPolygon(vertex, normPoly1)) {
            return true;
        }
    }
    
    // Also check if the centroid of one polygon is inside the other
    const centroid1 = {
        x: normPoly1.reduce((sum, p) => sum + p.x, 0) / normPoly1.length,
        y: normPoly1.reduce((sum, p) => sum + p.y, 0) / normPoly1.length
    };
    const centroid2 = {
        x: normPoly2.reduce((sum, p) => sum + p.x, 0) / normPoly2.length,
        y: normPoly2.reduce((sum, p) => sum + p.y, 0) / normPoly2.length
    };
    
    if (isPointInPolygon(centroid1, normPoly2) || isPointInPolygon(centroid2, normPoly1)) {
        return true;
    }
    
    return false;
}

// Calculate the distance between two points
export function calculateDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Get the length of a wall object
export function getWallLength(wall) {
    const dx = wall.end_x - wall.start_x;
    const dy = wall.end_y - wall.start_y;
    return Math.hypot(dx, dy);
}

export function detectClickedDoor(x, y, doors, walls, scale, offsetX, offsetY) {
  for (let door of doors) {
    const wall = walls.find(w => w.id === door.linked_wall || w.id === door.wall_id);
    if (!wall) continue;

    const placement = resolveDoorPlacement(wall, door);
    const { slashHalf, isInterior } = placement;
    const { x: localX, y: localY } = worldToDoorLocal(x, y, placement);

    const halfW = door.width / 2;
    const halfT = wall.thickness * 1.5;

    if (door.door_type === 'dock') {
      const dockDoorWidth = door.width * 0.6;
      const dockDoorHeight = door.width * 0.6 + 500;
      const minY = isInterior ? 0 : -dockDoorHeight;
      const maxY = isInterior ? dockDoorHeight : 0;

      if (Math.abs(localX) <= dockDoorWidth / 2 && localY >= minY && localY <= maxY) {
        return door;
      }
    } else if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfT) {
      return door;
    }

    if (door.door_type === 'swing') {
      const radius = door.width / (door.configuration === 'double_sided' ? 2 : 1);
      const swingLocalY = isInterior ? -localY : localY;
      const swingLocalX = localX;

      const checkSwingPanel = (hingeOffset, direction) => {
        const isRight = direction === 'right';
        const arcStart = isRight ? Math.PI : 0;
        const arcEnd = isRight ? Math.PI * 1.5 : -Math.PI * 0.5;
        const relX = swingLocalX - hingeOffset;
        const relY = swingLocalY;
        const distanceToHinge = Math.hypot(relX, relY);

        if (distanceToHinge <= radius) {
          let clickAngle = Math.atan2(relY, relX);
          if (clickAngle < 0) clickAngle += 2 * Math.PI;
          let normStartAngle = arcStart;
          let normEndAngle = arcEnd;
          if (normEndAngle < 0) normEndAngle += 2 * Math.PI;

          if (
            (isRight && clickAngle >= normStartAngle && clickAngle <= normEndAngle) ||
            (!isRight && (clickAngle <= normStartAngle || clickAngle >= normEndAngle + 2 * Math.PI))
          ) {
            return true;
          }
        }

        const arcEndLocalX = hingeOffset + Math.cos(arcEnd) * radius;
        const arcEndLocalY = Math.sin(arcEnd) * radius;
        const panelEndLocalX = arcEndLocalX + Math.cos(arcEnd + (Math.PI / 2) * (isRight ? 1 : -1)) * door.width;
        const panelEndLocalY = arcEndLocalY + Math.sin(arcEnd + (Math.PI / 2) * (isRight ? 1 : -1)) * door.width;
        const toPanelX = panelEndLocalX - arcEndLocalX;
        const toPanelY = panelEndLocalY - arcEndLocalY;
        const panelLength = Math.hypot(toPanelX, toPanelY) || 1;
        const clickRelArcX = swingLocalX - arcEndLocalX;
        const clickRelArcY = swingLocalY - arcEndLocalY;
        const dotProduct = (clickRelArcX * toPanelX + clickRelArcY * toPanelY) / panelLength;
        const projX = arcEndLocalX + (toPanelX / panelLength) * dotProduct;
        const projY = arcEndLocalY + (toPanelY / panelLength) * dotProduct;
        const distanceAlongPanel = Math.hypot(projX - arcEndLocalX, projY - arcEndLocalY);
        const distanceToPanel = Math.hypot(swingLocalX - projX, swingLocalY - projY);

        return distanceAlongPanel <= door.width && distanceToPanel <= wall.thickness;
      };

      if (door.configuration === 'single_sided') {
        const hingeOffset = door.swing_direction === 'right' ? slashHalf : -slashHalf;
        if (checkSwingPanel(hingeOffset, door.swing_direction)) return door;
      } else if (door.configuration === 'double_sided') {
        if (checkSwingPanel(-slashHalf, 'left') || checkSwingPanel(slashHalf, 'right')) return door;
      }
    }
  }

  return null;
}

export function detectHoveredDoor(x, y, doors, walls, scale, offsetX, offsetY) {
  return detectClickedDoor(x, y, doors, walls, scale, offsetX, offsetY);
}

export function drawDoors(ctx, doors, walls, scale, offsetX, offsetY, hoveredDoorId = null) {
    doors.forEach((door) => {
        const wall = walls.find(w => w.id === door.linked_wall || w.id === door.wall_id);
        if (!wall) return;

        const placement = resolveDoorPlacement(wall, door);
        const { doorCenterX, doorCenterY, angle, ySign, slashHalf, isInterior } = placement;
        const doorWidth = door.width;
        const wallThickness = wall.thickness || 100;
        const doorThickness = wallThickness;

        const isHovered = door.id === hoveredDoorId;
        let doorColor = 'orange';
        let strokeColor = '#000';
        let lineWidth = 2;
        if (isHovered) {
            doorColor = '#FFA500';
            strokeColor = '#0066FF';
            lineWidth = 2.5;
        }

        ctx.save();
        ctx.translate(doorCenterX * scale + offsetX, doorCenterY * scale + offsetY);
        ctx.rotate(angle);
        ctx.scale(1, ySign);

        // === Slashed Wall Section === (skip for dock doors)
        if (door.door_type !== 'dock') {
            const slashStart = { x: -slashHalf, y: 0 };
            const slashEnd = { x: slashHalf, y: 0 };
            const numSlashes = Math.max(2, Math.floor((doorWidth * scale) / 10));
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;

            for (let i = 0; i < numSlashes; i++) {
                const t = i / (numSlashes - 1);
                const px = slashStart.x + (slashEnd.x - slashStart.x) * t;
                const py = 0;
                const slashAngle = Math.PI / 4;
                const lineLen = doorThickness * 0.6;

                ctx.beginPath();
                ctx.moveTo(
                    (px - Math.cos(slashAngle) * lineLen / 2) * scale,
                    (py - Math.sin(slashAngle) * lineLen / 2) * scale
                );
                ctx.lineTo(
                    (px + Math.cos(slashAngle) * lineLen / 2) * scale,
                    (py + Math.sin(slashAngle) * lineLen / 2) * scale
                );
                ctx.stroke();
            }
        }

        if (isHovered) {
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, 2 * Math.PI);
            ctx.strokeStyle = '#0066FF';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // === SWING DOOR DRAWING ===
        if (door.door_type === 'swing') {
            if (isInterior) {
                ctx.scale(1, -1);
            }
            const radius = doorWidth / (door.configuration === 'double_sided' ? 2 : 1);
            const drawSwingPanel = (hingeOffset, direction) => {
                const isRight = direction === 'right';
                const arcStart = isRight ? Math.PI : 0;
                const arcEnd = isRight ? Math.PI * 1.5 : -Math.PI * 0.5;
                const anticlockwise = !isRight;

                ctx.save();
                ctx.translate(hingeOffset * scale, 0);
                ctx.beginPath();
                ctx.arc(0, 0, radius * scale, arcStart, arcEnd, anticlockwise);
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = lineWidth;
                ctx.stroke();

                const arcEndX = Math.cos(arcEnd) * radius * scale;
                const arcEndY = Math.sin(arcEnd) * radius * scale;

                // Plan symbol: thin leaf line from hinge to open position (not a solid block)
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(arcEndX, arcEndY);
                ctx.strokeStyle = doorColor;
                ctx.lineWidth = Math.max(1.5, lineWidth);
                ctx.stroke();
                ctx.restore();
            };

            if (door.configuration === 'single_sided') {
                const hingeOffset = door.swing_direction === 'right' ? slashHalf : -slashHalf;
                drawSwingPanel(hingeOffset, door.swing_direction);
            } else if (door.configuration === 'double_sided') {
                drawSwingPanel(-slashHalf, 'left');
                drawSwingPanel(slashHalf, 'right');
            }
        }

        // === SLIDE DOOR DRAWING ===
        if (door.door_type === 'slide') {
            const halfLength = doorWidth;
            const thickness = wallThickness;
            const panelYOffset = getSlidePanelYOffset(placement, thickness);

            const drawSlidePanel = (offsetX, direction) => {
                ctx.save();
                ctx.translate(offsetX * scale, panelYOffset * scale);
                ctx.strokeStyle = doorColor;
                ctx.lineWidth = Math.max(1.5, lineWidth);
                ctx.strokeRect(
                    -halfLength * scale / 2,
                    -thickness * scale / 2,
                    halfLength * scale,
                    thickness * scale
                );

                const arrowY = panelYOffset * scale * 2;
                const arrowHeadSize = 4;
                const arrowDir = direction === 'right' ? 1 : -1;
                const arrowStart = -halfLength * scale / 2;
                const arrowEnd = halfLength * scale / 2;

                ctx.beginPath();
                ctx.moveTo(arrowStart, arrowY);
                ctx.lineTo(arrowEnd, arrowY);
                if (arrowDir === 1) {
                    ctx.moveTo(arrowEnd, arrowY);
                    ctx.lineTo(arrowEnd - arrowHeadSize, arrowY - arrowHeadSize);
                    ctx.lineTo(arrowEnd - arrowHeadSize, arrowY + arrowHeadSize);
                } else {
                    ctx.moveTo(arrowStart, arrowY);
                    ctx.lineTo(arrowStart + arrowHeadSize, arrowY - arrowHeadSize);
                    ctx.lineTo(arrowStart + arrowHeadSize, arrowY + arrowHeadSize);
                }

                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = lineWidth;
                ctx.stroke();
                ctx.restore();
            };

            if (door.configuration === 'single_sided') {
                drawSlidePanel(0, door.slide_direction);
            } else if (door.configuration === 'double_sided') {
                drawSlidePanel(-slashHalf / 2, 'left');
                drawSlidePanel(slashHalf / 2, 'right');
            }
        }

        // === DOCK DOOR DRAWING ===
        if (door.door_type === 'dock') {
            const rectWidth = door.width * 0.6;
            const rectHeight = door.width * 0.6 + 300;
            const rectX = -rectWidth / 2 * scale;
            const rectW = rectWidth * scale;
            const rectH = rectHeight * scale;
            const rectY = isInterior ? 0 : -rectH;

            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.strokeRect(rectX, rectY, rectW, rectH);

            ctx.beginPath();
            ctx.moveTo(rectX, rectY);
            ctx.lineTo(rectX + rectW, rectY + rectH);
            ctx.moveTo(rectX + rectW, rectY);
            ctx.lineTo(rectX, rectY + rectH);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
            
            // Draw "DL" text in the center of the rectangle
            ctx.save();
            ctx.fillStyle = strokeColor;
            ctx.font = `${Math.max(5, rectW * 0.29)}px Arial`; // Font size based on rectangle width
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const textX = 0;
            const textY = isInterior ? rectH - 10 : rectY + 10;
            ctx.fillText('DL', textX, textY);
            ctx.restore();
        }

        ctx.restore();
    });
} 

// Calculate the intersection point of two line segments
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
 * Intersection of two lines. Optionally treat either side as infinite
 * (needed when a shortened partition must extend to the host centerline).
 */
export function calculateLineIntersection(
    wall1Start,
    wall1End,
    wall2Start,
    wall2End,
    { extendFirst = false, extendSecond = false, paramTolerance = 0.05 } = {}
) {
    const denominator = ((wall2End.y - wall2Start.y) * (wall1End.x - wall1Start.x)) -
                    ((wall2End.x - wall2Start.x) * (wall1End.y - wall1Start.y));
    if (Math.abs(denominator) < 1e-12) return null;
    const ua = (((wall2End.x - wall2Start.x) * (wall1Start.y - wall2Start.y)) -
            ((wall2End.y - wall2Start.y) * (wall1Start.x - wall2Start.x))) / denominator;
    const ub = (((wall1End.x - wall1Start.x) * (wall1Start.y - wall2Start.y)) -
            ((wall1End.y - wall1Start.y) * (wall1Start.x - wall2Start.x))) / denominator;
    const firstOk = extendFirst
        ? true
        : ua >= -paramTolerance && ua <= 1 + paramTolerance;
    const secondOk = extendSecond
        ? true
        : ub >= -paramTolerance && ub <= 1 + paramTolerance;
    if (!firstOk || !secondOk) return null;
    return {
        x: wall1Start.x + (ua * (wall1End.x - wall1Start.x)),
        y: wall1Start.y + (ua * (wall1End.y - wall1Start.y))
    };
}

function wallsAreNearlyCollinear(wallA, wallB, angleTolDeg = 5) {
    const ax = wallA.end_x - wallA.start_x;
    const ay = wallA.end_y - wallA.start_y;
    const bx = wallB.end_x - wallB.start_x;
    const by = wallB.end_y - wallB.start_y;
    const lenA = Math.hypot(ax, ay);
    const lenB = Math.hypot(bx, by);
    if (lenA < 0.001 || lenB < 0.001) return false;
    const dot = Math.abs((ax * bx + ay * by) / (lenA * lenB));
    return dot >= Math.cos((angleTolDeg * Math.PI) / 180);
}

export function isPartitionWall(wall) {
    return wall && String(wall.application_type || '').toLowerCase() === 'partition';
}

/** Host wall that a shortened partition end butts into (within host thickness). */
export function findJoiningWallForPartitionEnd(partition, endPoint, candidateWalls) {
    let bodyHit = null;
    let endpointHit = null;
    let bodyHitDist = Infinity;
    let endpointHitDist = Infinity;
    for (const wall of candidateWalls) {
        if (!wall || wall.id === partition.id) continue;
        if (wallsAreNearlyCollinear(partition, wall)) continue;
        const dx = wall.end_x - wall.start_x;
        const dy = wall.end_y - wall.start_y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) continue;
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        const relX = endPoint.x - wall.start_x;
        const relY = endPoint.y - wall.start_y;
        const along = relX * ux + relY * uy;
        const perp = relX * nx + relY * ny;
        const thick = Number(wall.thickness) || 0;
        // Partition ends are inset by up to full host thickness (plus float error).
        const perpLimit = Math.max(thick * 2, thick + 1) + 1;
        if (along < -1 || along > length + 1 || Math.abs(perp) > perpLimit) {
            continue;
        }
        const onBody = along > 0.001 && along < length - 0.001;
        const dist = Math.abs(perp);
        if (onBody) {
            if (dist < bodyHitDist) {
                bodyHit = wall;
                bodyHitDist = dist;
            }
        } else if (dist < endpointHitDist) {
            endpointHit = wall;
            endpointHitDist = dist;
        }
    }
    return bodyHit || endpointHit;
}

/**
 * Shoot past a shortened partition end along the wall axis and find the nearest
 * non-collinear host segment (more reliable than thickness-band only).
 */
export function findHostWallByPartitionRay(partition, atStart, candidateWalls) {
    const dx = partition.end_x - partition.start_x;
    const dy = partition.end_y - partition.start_y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return null;
    const ux = dx / len;
    const uy = dy / len;
    // Ray continues past the chosen end (outward beyond the shortened tip).
    const origin = atStart
        ? { x: partition.start_x, y: partition.start_y }
        : { x: partition.end_x, y: partition.end_y };
    const rayDx = atStart ? -ux : ux;
    const rayDy = atStart ? -uy : uy;

    let bestWall = null;
    let bestT = Infinity;
    const maxReach = candidateWalls.reduce(
        (m, w) => Math.max(m, (Number(w.thickness) || 0) * 3),
        300
    ) + 50;

    for (const wall of candidateWalls) {
        if (!wall || wall.id === partition.id) continue;
        if (wallsAreNearlyCollinear(partition, wall)) continue;
        const hit = calculateLineIntersection(
            origin,
            { x: origin.x + rayDx, y: origin.y + rayDy },
            { x: wall.start_x, y: wall.start_y },
            { x: wall.end_x, y: wall.end_y },
            { extendFirst: true, extendSecond: false, paramTolerance: 0.02 }
        );
        if (!hit) continue;
        const t = (hit.x - origin.x) * rayDx + (hit.y - origin.y) * rayDy;
        if (t <= 0.001 || t > maxReach || t >= bestT) continue;
        bestT = t;
        bestWall = wall;
    }
    return bestWall;
}

/**
 * True corner where a partition would meet a host if treated like a normal wall
 * (partition reference line extended to host reference line).
 * Note: wall DB coords are the reference face (line1), not geometric centerline.
 */
export function getExtendedPartitionCorner(partition, hostWall) {
    if (!partition || !hostWall) return null;
    const raw = calculateLineIntersection(
        { x: partition.start_x, y: partition.start_y },
        { x: partition.end_x, y: partition.end_y },
        { x: hostWall.start_x, y: hostWall.start_y },
        { x: hostWall.end_x, y: hostWall.end_y },
        { extendFirst: true, extendSecond: true }
    );
    if (!raw) return null;

    const dx = hostWall.end_x - hostWall.start_x;
    const dy = hostWall.end_y - hostWall.start_y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return raw;
    const t = ((raw.x - hostWall.start_x) * dx + (raw.y - hostWall.start_y) * dy) / lenSq;
    const tc = Math.max(0, Math.min(1, t));
    return {
        x: hostWall.start_x + tc * dx,
        y: hostWall.start_y + tc * dy,
    };
}

/**
 * Resolve both partition ends to normal-wall junction points (extended to hosts).
 * Returns { start, end } in model space.
 */
export function getPartitionExtendedEndpoints(partition, walls) {
    if (!partition) return null;
    const others = (walls || []).filter((w) => w && w.id !== partition.id);
    const resolveEnd = (endPt, atStart) => {
        const host =
            findJoiningWallForPartitionEnd(partition, endPt, others)
            || findHostWallByPartitionRay(partition, atStart, others);
        if (!host) return { ...endPt };
        return getExtendedPartitionCorner(partition, host) || { ...endPt };
    };
    return {
        start: resolveEnd({ x: partition.start_x, y: partition.start_y }, true),
        end: resolveEnd({ x: partition.end_x, y: partition.end_y }, false),
    };
}

/**
 * Host whose body this tip sits inside (butt-in thickness deduct), or null if on centerline.
 */
export function findInsetHostForWallTip(wall, endPt, candidateWalls) {
    if (!wall || !endPt) return null;
    let best = null;
    let bestPerp = Infinity;
    for (const host of candidateWalls || []) {
        if (!host || host.id === wall.id) continue;
        const dx = host.end_x - host.start_x;
        const dy = host.end_y - host.start_y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) continue;
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        const relX = endPt.x - host.start_x;
        const relY = endPt.y - host.start_y;
        const along = relX * ux + relY * uy;
        const perp = Math.abs(relX * nx + relY * ny);
        const hostThk = Number(host.thickness) || 0;
        if (along < -1 || along > length + 1 || perp <= 0.75 || perp > hostThk + 1) {
            continue;
        }
        if (perp < bestPerp) {
            bestPerp = perp;
            best = host;
        }
    }
    return best;
}

/**
 * Room-polygon match ends: extend partition + thickness-deducted tips to host
 * centerline junctions so detectRoomWalls / define-room pick the wall.
 */
export function getWallExtendedEndpointsForMatching(wall, walls) {
    if (!wall) return null;
    const list = Array.isArray(walls) ? walls : [];
    if (isPartitionWall(wall)) {
        return getPartitionExtendedEndpoints(wall, list) || {
            start: { x: wall.start_x, y: wall.start_y },
            end: { x: wall.end_x, y: wall.end_y },
        };
    }
    const others = list.filter((w) => w && w.id !== wall.id);
    const resolveEnd = (endPt) => {
        const host = findInsetHostForWallTip(wall, endPt, others);
        if (!host) return { x: endPt.x, y: endPt.y };
        return getExtendedPartitionCorner(wall, host) || { x: endPt.x, y: endPt.y };
    };
    return {
        start: resolveEnd({ x: wall.start_x, y: wall.start_y }),
        end: resolveEnd({ x: wall.end_x, y: wall.end_y }),
    };
}

/**
 * Display / click position for an intersection. Partition butt-ins use the
 * extended host junction (same as orange handles), not the shortened tip.
 */
export function getIntersectionDisplayPoint(inter, walls) {
    if (!inter) return null;
    const list = Array.isArray(walls) ? walls : [];
    const byId = new Map(list.map((w) => [String(w.id), w]));
    const wallIdOf = (ref) => {
        if (ref == null) return null;
        if (typeof ref === 'object') return ref.id != null ? String(ref.id) : null;
        return String(ref);
    };

    const geo = (Number.isFinite(inter.x) && Number.isFinite(inter.y))
        ? { x: inter.x, y: inter.y }
        : null;

    const resolvePartitionDisplay = (partition, preferredHost = null) => {
        // Prefer the extended end nearest the geometric tip (handles top vs bottom).
        const extendedEnds = getPartitionExtendedEndpoints(partition, list);
        if (extendedEnds && geo) {
            const dStart = Math.hypot(extendedEnds.start.x - geo.x, extendedEnds.start.y - geo.y);
            const dEnd = Math.hypot(extendedEnds.end.x - geo.x, extendedEnds.end.y - geo.y);
            return dStart <= dEnd ? extendedEnds.start : extendedEnds.end;
        }
        if (extendedEnds) {
            return extendedEnds.start;
        }
        if (preferredHost) {
            return getExtendedPartitionCorner(partition, preferredHost);
        }
        return null;
    };

    const pairs = Array.isArray(inter.pairs) ? inter.pairs : [];
    if (pairs.length > 0) {
        for (const pair of pairs) {
            const w1 = byId.get(wallIdOf(pair.wall1));
            const w2 = byId.get(wallIdOf(pair.wall2));
            if (!w1 || !w2) continue;
            const partition = isPartitionWall(w1) ? w1 : (isPartitionWall(w2) ? w2 : null);
            if (!partition) continue;
            const host = partition === w1 ? w2 : w1;
            const extended = resolvePartitionDisplay(partition, host);
            if (extended) return extended;
        }
    }

    const j1 = byId.get(wallIdOf(inter.wall_1));
    const j2 = byId.get(wallIdOf(inter.wall_2));
    if (j1 && j2) {
        const partition = isPartitionWall(j1) ? j1 : (isPartitionWall(j2) ? j2 : null);
        if (partition) {
            const host = partition === j1 ? j2 : j1;
            const extended = resolvePartitionDisplay(partition, host);
            if (extended) return extended;
        }
    }

    return geo;
}

/**
 * Snap / orange-handle targets: partition + butt-in-deduct tips are extended to
 * host centerline junctions so room polygons match normal walls (never expose
 * shortened tips — otherwise define-room shows two dots and needs both).
 */
export function getRoomSelectionSnapPoints(walls, intersections = []) {
    const list = Array.isArray(walls) ? walls : [];
    const byId = new Map(list.map((w) => [String(w.id), w]));
    const points = [];
    const seen = new Set();
    // Shortened tips (partition or deduct) — never offer these as room corners.
    const suppressed = new Set();

    const pointKey = (pt) => `${Math.round(pt.x)},${Math.round(pt.y)}`;

    const addPoint = (pt) => {
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
        const key = pointKey(pt);
        if (seen.has(key) || suppressed.has(key)) return;
        seen.add(key);
        points.push({ x: pt.x, y: pt.y });
    };

    const wallIdOf = (ref) => {
        if (ref == null) return null;
        if (typeof ref === 'object') return ref.id != null ? String(ref.id) : null;
        return String(ref);
    };

    /** Host whose body this tip sits inside (inset by thickness), or null if on-centerline. */
    const findInsetHostForTip = (wall, endPt) => findInsetHostForWallTip(wall, endPt, list);

    // 1) Partition ends → extended host junctions only
    list.forEach((wall) => {
        if (!isPartitionWall(wall)) return;
        suppressed.add(pointKey({ x: wall.start_x, y: wall.start_y }));
        suppressed.add(pointKey({ x: wall.end_x, y: wall.end_y }));
        const extended = getPartitionExtendedEndpoints(wall, list);
        if (extended) {
            addPoint(extended.start);
            addPoint(extended.end);
        }
    });

    // 1b) Normal walls with butt-in thickness deduct (tip inside host) → same treatment
    list.forEach((wall) => {
        if (isPartitionWall(wall)) return;
        const ends = [
            { x: wall.start_x, y: wall.start_y },
            { x: wall.end_x, y: wall.end_y },
        ];
        ends.forEach((endPt) => {
            const host = findInsetHostForTip(wall, endPt);
            if (!host) return;
            suppressed.add(pointKey(endPt));
            const extended = getExtendedPartitionCorner(wall, host);
            if (extended) addPoint(extended);
        });
    });

    // 2) Intersection records: extend any pair that includes a partition
    (intersections || []).forEach((inter) => {
        let point = { x: inter.x, y: inter.y };
        const pairs = Array.isArray(inter.pairs) ? inter.pairs : [];
        let isPartitionJoint = false;
        for (const pair of pairs) {
            const w1 = byId.get(wallIdOf(pair.wall1));
            const w2 = byId.get(wallIdOf(pair.wall2));
            if (!w1 || !w2) continue;
            const partition = isPartitionWall(w1) ? w1 : (isPartitionWall(w2) ? w2 : null);
            if (!partition) continue;
            isPartitionJoint = true;
            const host = partition === w1 ? w2 : w1;
            const extended = getExtendedPartitionCorner(partition, host);
            if (extended) {
                point = extended;
                break;
            }
        }
        // Drop raw shortened partition tips even if extension failed.
        if (isPartitionJoint && suppressed.has(pointKey(point))) return;
        // Also drop if this geometric tip was suppressed as a deducted inset.
        if (suppressed.has(pointKey(point))) return;
        addPoint(point);
    });

    // 3) Normal wall endpoints (skip suppressed inset tips)
    list.forEach((wall) => {
        if (isPartitionWall(wall)) return;
        addPoint({ x: wall.start_x, y: wall.start_y });
        addPoint({ x: wall.end_x, y: wall.end_y });
    });

    return points;
}

// Find all intersection points between walls (including shared endpoints, collinear, endpoint-in-body)
export function findIntersectionPointsBetweenWalls(walls) {
    const map = new Map();
    const wallTouchesWallBody = (endpoints, hostWall) => {
        const dx = hostWall.end_x - hostWall.start_x;
        const dy = hostWall.end_y - hostWall.start_y;
        const length = Math.hypot(dx, dy);
        if (length === 0) return null;
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        for (const pt of endpoints) {
            const relX = pt.x - hostWall.start_x;
            const relY = pt.y - hostWall.start_y;
            const along = relX * ux + relY * uy;
            const perp = relX * nx + relY * ny;
            if (along >= 0 && along <= length && Math.abs(perp) <= hostWall.thickness) {
                // Joint lives on the host centerline — not the inset tip — so draw/butt-in
                // can still pair stem + host after thickness deduct.
                return {
                    x: hostWall.start_x + along * ux,
                    y: hostWall.start_y + along * uy,
                };
            }
        }
        return null;
    };
    for (let i = 0; i < walls.length; i++) {
        for (let j = i + 1; j < walls.length; j++) {
            const wallA = walls[i];
            const wallB = walls[j];
            const aEndpoints = [
                { x: wallA.start_x, y: wallA.start_y },
                { x: wallA.end_x, y: wallA.end_y }
            ];
            const bEndpoints = [
                { x: wallB.start_x, y: wallB.start_y },
                { x: wallB.end_x, y: wallB.end_y }
            ];
            // Shared endpoint check
            const sharedPoints = [];
            aEndpoints.forEach(aPt => {
                bEndpoints.forEach(bPt => {
                    if (arePointsEqual(aPt, bPt)) {
                        sharedPoints.push({ x: aPt.x, y: aPt.y });
                    }
                });
            });
            if (sharedPoints.length > 0) {
                sharedPoints.forEach(point => {
                    const key = `${Math.round(point.x)}-${Math.round(point.y)}`;
                    if (!map.has(key)) map.set(key, { x: point.x, y: point.y, pairs: [] });
                    map.get(key).pairs.push({ wall1: wallA, wall2: wallB });
                });
                continue;
            }
            // Regular intersection
            const intersection = calculateIntersection(
                { x: wallA.start_x, y: wallA.start_y },
                { x: wallA.end_x, y: wallA.end_y },
                { x: wallB.start_x, y: wallB.start_y },
                { x: wallB.end_x, y: wallB.end_y }
            );
            if (intersection) {
                const key = `${Math.round(intersection.x)}-${Math.round(intersection.y)}`;
                if (!map.has(key)) map.set(key, { x: intersection.x, y: intersection.y, pairs: [] });
                map.get(key).pairs.push({ wall1: wallA, wall2: wallB });
                continue;
            }
            // A endpoint in body of B (includes partition tips inset by host thickness)
            const touchAinB = wallTouchesWallBody(aEndpoints, wallB);
            if (touchAinB) {
                let point = touchAinB;
                if (isPartitionWall(wallA)) {
                    const ext = getExtendedPartitionCorner(wallA, wallB);
                    if (ext && Number.isFinite(ext.x) && Number.isFinite(ext.y)) point = ext;
                }
                const key = `${Math.round(point.x)}-${Math.round(point.y)}`;
                if (!map.has(key)) map.set(key, { x: point.x, y: point.y, pairs: [] });
                map.get(key).pairs.push({ wall1: wallA, wall2: wallB });
                continue;
            }
            // B endpoint in body of A
            const touchBinA = wallTouchesWallBody(bEndpoints, wallA);
            if (touchBinA) {
                let point = touchBinA;
                if (isPartitionWall(wallB)) {
                    const ext = getExtendedPartitionCorner(wallB, wallA);
                    if (ext && Number.isFinite(ext.x) && Number.isFinite(ext.y)) point = ext;
                }
                const key = `${Math.round(point.x)}-${Math.round(point.y)}`;
                if (!map.has(key)) map.set(key, { x: point.x, y: point.y, pairs: [] });
                map.get(key).pairs.push({ wall1: wallB, wall2: wallA });
                continue;
            }
        }
    }
    return Array.from(map.values());
} 

// Export 2D canvas as image
export function exportCanvasAsImage(canvasRef, filename = '2d_sketch.png') {
    try {
        if (!canvasRef || !canvasRef.current) {
            console.error('Canvas reference not found');
            return;
        }

        const canvas = canvasRef.current;
        
        // Create a temporary canvas for high-quality export
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        if (!tempCtx) {
            console.error('Could not get 2D context for temporary canvas');
            return;
        }
        
        // Set high resolution for better quality
        const scale = 2; // 2x resolution for crisp images
        tempCanvas.width = canvas.width * scale;
        tempCanvas.height = canvas.height * scale;
        
        // Scale the context to match the high resolution
        tempCtx.scale(scale, scale);
        
        // Draw the original canvas content to the temporary canvas
        tempCtx.drawImage(canvas, 0, 0);
        
        // Convert to blob and download
        tempCanvas.toBlob((blob) => {
            if (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                console.error('Failed to create blob from canvas');
            }
        }, 'image/png', 1.0);
    } catch (error) {
        console.error('Error exporting canvas as image:', error);
    }
}

// Export 2D canvas as SVG (for vector format)
export function exportCanvasAsSVG(canvasRef, walls, rooms, doors, intersections, filename = '2d_sketch.svg', wallPanelsMap = null, showPanelLines = false, joints = []) {
    try {
        if (!canvasRef || !canvasRef.current) {
            console.error('Canvas reference not found');
            return;
        }

    const canvas = canvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    
    // Calculate bounds to center the drawing
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // Find bounds from walls
    walls.forEach(wall => {
        minX = Math.min(minX, wall.start_x, wall.end_x);
        minY = Math.min(minY, wall.start_y, wall.end_y);
        maxX = Math.max(maxX, wall.start_x, wall.end_x);
        maxY = Math.max(maxY, wall.start_y, wall.end_y);
    });
    
    // Add padding
    const padding = 50;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    
    // Calculate scale to fit in canvas
    const drawingWidth = maxX - minX;
    const drawingHeight = maxY - minY;
    const scaleX = (width - 100) / drawingWidth;
    const scaleY = (height - 100) / drawingHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
    
    // Calculate offset to center
    const offsetX = (width - drawingWidth * scale) / 2 - minX * scale;
    const offsetY = (height - drawingHeight * scale) / 2 - minY * scale;
    
    // Transform function
    const transform = (x, y) => ({
        x: x * scale + offsetX,
        y: y * scale + offsetY
    });
    
    // Create SVG content
    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <style>
            .wall { stroke: #333; stroke-width: ${Math.max(1, 2 * scale)}; fill: none; }
            .room-fill { fill: rgba(200, 200, 255, 0.3); stroke: #666; stroke-width: ${Math.max(0.5, 1 * scale)}; }
            .door { stroke: #ff6b6b; stroke-width: ${Math.max(1.5, 3 * scale)}; fill: none; }
            .dimension { stroke: #666; stroke-width: ${Math.max(0.5, 1 * scale)}; font-size: ${Math.max(8, 12 * scale)}px; font-family: Arial; }
            .room-label { font-size: ${Math.max(10, 14 * scale)}px; font-family: Arial; fill: #333; text-anchor: middle; }
            .grid { stroke: #ddd; stroke-width: ${Math.max(0.25, 0.5 * scale)}; opacity: 0.5; }
            .panel-division { stroke: #333; stroke-width: ${Math.max(1, 2 * scale)}; fill: none; }
        </style>
    </defs>
    <rect width="${width}" height="${height}" fill="white"/>
    
    <!-- Grid lines -->
    <g class="grid">
`;

    // Add grid lines
    // const gridSize = 50 * scale; // Unused variable
    const gridStartX = Math.floor(minX / 50) * 50;
    const gridStartY = Math.floor(minY / 50) * 50;
    const gridEndX = Math.ceil(maxX / 50) * 50;
    const gridEndY = Math.ceil(maxY / 50) * 50;
    
    for (let x = gridStartX; x <= gridEndX; x += 50) {
        const transformedX = transform(x, 0).x;
        svgContent += `<line x1="${transformedX}" y1="0" x2="${transformedX}" y2="${height}" class="grid"/>`;
    }
    for (let y = gridStartY; y <= gridEndY; y += 50) {
        const transformedY = transform(0, y).y;
        svgContent += `<line x1="0" y1="${transformedY}" x2="${width}" y2="${transformedY}" class="grid"/>`;
    }
    svgContent += '</g>';

    // Add walls
    walls.forEach(wall => {
        const start = transform(wall.start_x, wall.start_y);
        const end = transform(wall.end_x, wall.end_y);
        svgContent += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" class="wall"/>`;
    });

    // Add room fills
    rooms.forEach(room => {
        if (room.room_points && room.room_points.length >= 3) {
            const points = room.room_points.map(p => {
                const transformed = transform(p.x, p.y);
                return `${transformed.x},${transformed.y}`;
            }).join(' ');
            svgContent += `<polygon points="${points}" class="room-fill"/>`;
        }
    });

    // Add doors
    doors.forEach(door => {
        const wall = walls.find(w => w.id === door.wall);
        if (wall) {
            // Calculate door position along the wall
            // const wallLength = Math.sqrt( // Unused variable
            //     Math.pow(wall.end_x - wall.start_x, 2) + 
            //     Math.pow(wall.end_y - wall.start_y, 2)
            // );
            const doorPosition = door.position_along_wall || 0.5;
            
            const doorX = wall.start_x + (wall.end_x - wall.start_x) * doorPosition;
            const doorY = wall.start_y + (wall.end_y - wall.start_y) * doorPosition;
            
            // Draw door as a line perpendicular to the wall
            const wallAngle = Math.atan2(wall.end_y - wall.start_y, wall.end_x - wall.start_x);
            const doorLength = 30 * scale; // Door width scaled
            
            const doorStartX = doorX + Math.cos(wallAngle + Math.PI/2) * doorLength/2;
            const doorStartY = doorY + Math.sin(wallAngle + Math.PI/2) * doorLength/2;
            const doorEndX = doorX + Math.cos(wallAngle - Math.PI/2) * doorLength/2;
            const doorEndY = doorY + Math.sin(wallAngle - Math.PI/2) * doorLength/2;
            
            const doorStart = transform(doorStartX, doorStartY);
            const doorEnd = transform(doorEndX, doorEndY);
            
            svgContent += `<line x1="${doorStart.x}" y1="${doorStart.y}" x2="${doorEnd.x}" y2="${doorEnd.y}" class="door"/>`;
        }
    });

    // Add room labels
    rooms.forEach(room => {
        if (room.label_position) {
            const pos = transform(room.label_position.x, room.label_position.y);
            const name = room.room_name || 'Unnamed Room';
            const height = (() => {
                const min = room.height_min ?? room.height;
                const max = room.height_max ?? room.height;
                if (min != null && max != null && min !== max) {
                    return `EXT. HT. ${min}-${max}mm`;
                }
                return room.height ? `EXT. HT. ${room.height}mm` : 'EXT. HT. No height';
            })();
            const baseElevation = room.base_elevation_mm !== undefined && room.base_elevation_mm !== 0 
                ? `Base: ${room.base_elevation_mm > 0 ? '+' : ''}${room.base_elevation_mm}mm` 
                : '';
            const description = room.remarks || 'No description';
            
            const labelSpacing = 15 * scale;
            let currentY = pos.y - labelSpacing;
            svgContent += `<text x="${pos.x}" y="${currentY}" class="room-label">${name}</text>`;
            currentY += labelSpacing;
            svgContent += `<text x="${pos.x}" y="${currentY}" class="room-label">${height}</text>`;
            if (baseElevation) {
                currentY += labelSpacing;
                svgContent += `<text x="${pos.x}" y="${currentY}" class="room-label">${baseElevation}</text>`;
            }
            currentY += labelSpacing;
            svgContent += `<text x="${pos.x}" y="${currentY}" class="room-label">${description}</text>`;
        }
    });

    // Add panel division lines if enabled and wallPanelsMap is provided
    if (showPanelLines && wallPanelsMap) {
        // Calculate center point for wall line calculations
        const center = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        };
        
        // Helper function to calculate offset points for a wall (similar to calculateOffsetPoints in drawing.js)
        const calculateWallOffsetPoints = (wall) => {
            const x1 = wall.start_x;
            const y1 = wall.start_y;
            const x2 = wall.end_x;
            const y2 = wall.end_y;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const length = Math.sqrt(dx * dx + dy * dy);
            
            if (length === 0) {
                return {
                    line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
                    line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }]
                };
            }
            
            const normalX = dy / length;
            const normalY = -dx / length;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const dirToCenterX = center.x - midX;
            const dirToCenterY = center.y - midY;
            const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
            const shouldFlip = dotProduct > 0;
            
            // Calculate gap based on wall thickness (in model coordinates)
            const wallThickness = wall.thickness || 100; // Default 100mm
            const gapPixels = wallThickness; // Gap in model coordinates (mm)
            const offsetX = gapPixels * normalX;
            const offsetY = gapPixels * normalY;
            const finalOffsetX = shouldFlip ? -offsetX : offsetX;
            const finalOffsetY = shouldFlip ? -offsetY : offsetY;
            
            return {
                line1: [
                    { x: x1, y: y1 },
                    { x: x2, y: y2 }
                ],
                line2: [
                    { x: x1 - finalOffsetX, y: y1 - finalOffsetY },
                    { x: x2 - finalOffsetX, y: y2 - finalOffsetY }
                ]
            };
        };
        
        svgContent += '<g class="panel-divisions">';
        
        walls.forEach(wall => {
            const panels = wallPanelsMap[wall.id];
            if (!panels || panels.length <= 1) return; // Need at least 2 panels to have divisions
            
            const { line1: line1Raw, line2: line2Raw } = calculateWallOffsetPoints(wall);
            const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
            const panelLeftAtLineStart = isHorizontal
                ? wall.end_x >= wall.start_x
                : wall.end_y >= wall.start_y;
            const line1 = panelLeftAtLineStart ? line1Raw : [line1Raw[1], line1Raw[0]];
            const line2 = panelLeftAtLineStart ? line2Raw : [line2Raw[1], line2Raw[0]];
            const wallLength = Math.sqrt(
                Math.pow(line1[1].x - line1[0].x, 2) + 
                Math.pow(line1[1].y - line1[0].y, 2)
            );
            
            if (wallLength === 0) return;
            
            let accumulated = 0;
            
            // Draw panel division lines
            for (let i = 0; i < panels.length - 1; i++) {
                accumulated += panels[i].actualWidth || panels[i].width || 0;
                const t = accumulated / wallLength;
                
                // Center point along the wall (centerline)
                const cx = line1[0].x + (line1[1].x - line1[0].x) * t;
                const cy = line1[0].y + (line1[1].y - line1[0].y) * t;
                const c2x = line2[0].x + (line2[1].x - line2[0].x) * t;
                const c2y = line2[0].y + (line2[1].y - line2[0].y) * t;
                
                // Midpoint between the two wall lines at t
                const mx = (cx + c2x) / 2;
                const my = (cy + c2y) / 2;
                
                // Direction vector along the wall
                const dx = (line1[1].x - line1[0].x) / wallLength;
                const dy = (line1[1].y - line1[0].y) / wallLength;
                
                // Perpendicular vector
                const perpX = -dy;
                const perpY = dx;
                
                // Half the gap between the wall lines at this t
                const halfGap = Math.sqrt(Math.pow(cx - c2x, 2) + Math.pow(cy - c2y, 2)) / 2;
                
                // Endpoints of the perpendicular division line
                const x1 = mx + perpX * halfGap;
                const y1 = my + perpY * halfGap;
                const x2 = mx - perpX * halfGap;
                const y2 = my - perpY * halfGap;
                
                const p1 = transform(x1, y1);
                const p2 = transform(x2, y2);
                
                svgContent += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="panel-division"/>`;
            }
        });
        
        svgContent += '</g>';
    }

    svgContent += '</svg>';

    // Create and download SVG file
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error exporting canvas as SVG:', error);
    }
} 