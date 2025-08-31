// Utility functions extracted from Canvas2D.js

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

    const x1 = wall.start_x;
    const y1 = wall.start_y;
    const x2 = wall.end_x;
    const y2 = wall.end_y;

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const doorCenterX = x1 + (x2 - x1) * door.position_x;
    const doorCenterY = y1 + (y2 - y1) * door.position_x;

    // For the door panel itself
    const dx = x - doorCenterX;
    const dy = y - doorCenterY;

    // Rotate point to align with wall orientation
    const localX = dx * Math.cos(-angle) - dy * Math.sin(-angle);
    const localY = dx * Math.sin(-angle) + dy * Math.cos(-angle);

    // Define a larger selection area that covers the entire door area
    const halfW = door.width / 2;
    const halfT = wall.thickness * 1.5; // Make it a bit larger for easier selection
    
    // Check main door area (slashed wall portion)
    if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfT) {
      return door;
    }
    
    // For swing doors, also check the arc and door panel area
    if (door.door_type === 'swing') {
      const radius = door.width;
      const arcDirection = door.swing_direction === 'right' ? 1 : -1;
      const startAngle = arcDirection === 1 ? Math.PI : 0;
      const endAngle = arcDirection === 1 ? Math.PI * 1.5 : -Math.PI * 0.5;
      
      // Calculate arc end position
      const arcEndX = doorCenterX + Math.cos(angle + endAngle) * radius;
      const arcEndY = doorCenterY + Math.sin(angle + endAngle) * radius;
      
      // Calculate door panel rectangle points
      const panelDirX = Math.cos(angle + Math.PI/2 * arcDirection);
      const panelDirY = Math.sin(angle + Math.PI/2 * arcDirection);
      
      // Check if click is within arc radius
      const distanceToCenter = Math.hypot(x - doorCenterX, y - doorCenterY);
      if (distanceToCenter <= radius) {
        // Determine the angle of the click point from the door center
        const clickAngle = Math.atan2(y - doorCenterY, x - doorCenterX);
        
        // Normalize the angles for comparison
        let normClickAngle = (clickAngle - angle) % (2 * Math.PI);
        if (normClickAngle < 0) normClickAngle += 2 * Math.PI;
        
        let normStartAngle = startAngle % (2 * Math.PI);
        if (normStartAngle < 0) normStartAngle += 2 * Math.PI;
        
        let normEndAngle = endAngle % (2 * Math.PI);
        if (normEndAngle < 0) normEndAngle += 2 * Math.PI;
        
        // Check if the click angle is within the arc range
        if ((arcDirection === 1 && normClickAngle >= normStartAngle && normClickAngle <= normEndAngle) ||
            (arcDirection === -1 && (normClickAngle <= normStartAngle || normClickAngle >= normEndAngle))) {
          return door;
        }
      }
      
      // Check if click is within door panel rectangle
      const panelEndX = arcEndX + panelDirX * door.width;
      const panelEndY = arcEndY + panelDirY * door.width;
      
      const panelVector = {
        x: panelEndX - arcEndX,
        y: panelEndY - arcEndY
      };
      
      const clickVector = {
        x: x - arcEndX,
        y: y - arcEndY
      };
      
      // Project the click vector onto the panel vector
      const panelLength = Math.hypot(panelVector.x, panelVector.y);
      const dotProduct = (clickVector.x * panelVector.x + clickVector.y * panelVector.y) / panelLength;
      
      // Calculate the projection point
      const projX = arcEndX + (panelVector.x / panelLength) * dotProduct;
      const projY = arcEndY + (panelVector.y / panelLength) * dotProduct;
      
      // Check if projection point is within panel length
      const distanceAlongPanel = Math.hypot(projX - arcEndX, projY - arcEndY);
      const distanceToPanel = Math.hypot(x - projX, y - projY);
      
      if (distanceAlongPanel <= door.width && distanceToPanel <= wall.thickness) {
        return door;
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

        const x1 = wall.start_x;
        const y1 = wall.start_y;
        const x2 = wall.end_x;
        const y2 = wall.end_y;

        const wallLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const slashLength = (door.door_type === 'swing') ? door.width : door.width * 0.85;
        const halfSlashRatio = (slashLength / wallLength) / 2;

        const gap = 200;
        const gapRatio = gap / wallLength;

        const clampedPosition = Math.min(
            Math.max(door.position_x, halfSlashRatio + gapRatio),
            1 - halfSlashRatio - gapRatio
        );

        const doorCenterX = x1 + (x2 - x1) * clampedPosition;
        const doorCenterY = y1 + (y2 - y1) * clampedPosition;

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const doorWidth = door.width;
        const doorThickness = 150;

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
        if (door.side === 'interior') {
            ctx.rotate(Math.PI);
        }

        // === Slashed Wall Section ===
        const slashHalf = slashLength / 2;
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

        if (isHovered) {
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, 2 * Math.PI);
            ctx.strokeStyle = '#0066FF';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // === SWING DOOR DRAWING ===
        if (door.door_type === 'swing') {
            const radius = doorWidth / (door.configuration === 'double_sided' ? 2 : 1);
            const thickness = doorThickness;
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

                ctx.save();
                ctx.translate(arcEndX, arcEndY);
                ctx.rotate(Math.atan2(arcEndY, arcEndX));
                ctx.fillStyle = doorColor;
                ctx.fillRect(-radius * scale, -thickness * scale / 2, radius * scale, thickness * scale);
                ctx.restore();
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
            const halfLength = (doorWidth) * 1.1;
            const thickness = doorThickness * 0.8;

            const drawSlidePanel = (offsetX, direction) => {
                ctx.save();
                ctx.translate(offsetX * scale, thickness * scale);
                ctx.fillStyle = doorColor;
                ctx.fillRect(-halfLength * scale / 2, -thickness * scale / 2, halfLength * scale, thickness * scale);

                // Draw arrow
                const arrowY = thickness * scale * 2;
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
                return { x: pt.x, y: pt.y };
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
            // A endpoint in body of B
            const touchAinB = wallTouchesWallBody(aEndpoints, wallB);
            if (touchAinB) {
                const key = `${Math.round(touchAinB.x)}-${Math.round(touchAinB.y)}`;
                if (!map.has(key)) map.set(key, { x: touchAinB.x, y: touchAinB.y, pairs: [] });
                map.get(key).pairs.push({ wall1: wallA, wall2: wallB });
                continue;
            }
            // B endpoint in body of A
            const touchBinA = wallTouchesWallBody(bEndpoints, wallA);
            if (touchBinA) {
                const key = `${Math.round(touchBinA.x)}-${Math.round(touchBinA.y)}`;
                if (!map.has(key)) map.set(key, { x: touchBinA.x, y: touchBinA.y, pairs: [] });
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
export function exportCanvasAsSVG(canvasRef, walls, rooms, doors, intersections, filename = '2d_sketch.svg') {
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
        </style>
    </defs>
    <rect width="${width}" height="${height}" fill="white"/>
    
    <!-- Grid lines -->
    <g class="grid">
`;

    // Add grid lines
    const gridSize = 50 * scale;
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
            const wallLength = Math.sqrt(
                Math.pow(wall.end_x - wall.start_x, 2) + 
                Math.pow(wall.end_y - wall.start_y, 2)
            );
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
            const height = room.height ? `EXT HT: ${room.height}mm` : 'EXT HT: No height';
            const description = room.remarks || 'No description';
            
            const labelSpacing = 15 * scale;
            svgContent += `<text x="${pos.x}" y="${pos.y - labelSpacing}" class="room-label">${name}</text>`;
            svgContent += `<text x="${pos.x}" y="${pos.y}" class="room-label">${height}</text>`;
            svgContent += `<text x="${pos.x}" y="${pos.y + labelSpacing}" class="room-label">${description}</text>`;
        }
    });

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