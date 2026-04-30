// Drawing functions extracted from Canvas2D.js

// Import dimension filtering helper
import { shouldShowWallDimension, shouldShowPanelDimension } from './dimensionFilter.js';
// Import dimension configuration
import { DIMENSION_CONFIG } from './DimensionConfig.js';
// Import collision detection utilities
import { hasLabelOverlap, calculateHorizontalLabelBounds, calculateVerticalLabelBounds, smartPlacement } from './collisionDetection.js';
import { isPointInPolygon } from './utils.js';

// Store placement decisions for dimensions to prevent position changes on zoom
// Module-level Map that persists across renders
const dimensionPlacementMemory = new Map();

/** Same geometry as pdfVectorWallPlan: extension segments outside strict interior of model AABB (screen px) */
function extensionSegmentsOutsideModelRect(x1, y1, x2, y2, rect) {
    if (!rect) return [{ x1, y1, x2, y2 }];
    const { left, right, top, bottom } = rect;
    if (!(left < right && top < bottom)) return [{ x1, y1, x2, y2 }];
    const insideStrict = (x, y) => x > left && x < right && y > top && y < bottom;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const ts = [0, 1];
    const addT = (t) => {
        if (t > 1e-8 && t < 1 - 1e-8) ts.push(t);
    };
    if (Math.abs(dx) > 1e-12) {
        addT((left - x1) / dx);
        addT((right - x1) / dx);
    }
    if (Math.abs(dy) > 1e-12) {
        addT((top - y1) / dy);
        addT((bottom - y1) / dy);
    }
    ts.sort((a, b) => a - b);
    const uniq = [];
    for (let i = 0; i < ts.length; i++) {
        if (i === 0 || ts[i] - ts[i - 1] > 1e-7) uniq.push(ts[i]);
    }
    const out = [];
    for (let i = 0; i < uniq.length - 1; i++) {
        const ta = uniq[i];
        const tb = uniq[i + 1];
        const xa = x1 + ta * dx;
        const ya = y1 + ta * dy;
        const xb = x1 + tb * dx;
        const yb = y1 + tb * dy;
        const mx = (xa + xb) / 2;
        const my = (ya + yb) / 2;
        if (!insideStrict(mx, my)) {
            const len = Math.hypot(xb - xa, yb - ya);
            if (len > 1e-4) out.push({ x1: xa, y1: ya, x2: xb, y2: yb });
        }
    }
    return out.length > 0 ? out : [];
}

function modelBoundsToScreenRect(modelBounds, scaleFactor, offsetX, offsetY) {
    if (!modelBounds) return null;
    return {
        left: modelBounds.minX * scaleFactor + offsetX,
        right: modelBounds.maxX * scaleFactor + offsetX,
        top: modelBounds.minY * scaleFactor + offsetY,
        bottom: modelBounds.maxY * scaleFactor + offsetY
    };
}

/**
 * Dash pattern aligned with pdfVectorWallPlan: pdfExtDash = [1.2 * PX_TO_MM, 2 * PX_TO_MM] (jsPDF mm).
 * Canvas uses CSS px; scale lightly with zoom so dashes stay readable.
 */
function getCanvasExtensionDashPattern(scaleFactor) {
    const ref = Math.max(0.01, scaleFactor);
    const zoom = Math.max(0.5, Math.min(ref * 0.04, 4));
    return [Math.max(2, 1.2 * zoom), Math.max(2, 2 * zoom)];
}

/** Matches pdfVectorWallPlan: pdfExtLineW ≈ LINE_WIDTH * PX_TO_MM * 0.9 — lighter than solid dimension line */
function getCanvasExtensionLineWidth() {
    return Math.max(0.5, DIMENSION_CONFIG.LINE_WIDTH * 0.9);
}

function formatDimMmCanvas(lengthMm) {
    return `${Math.round(Number(lengthMm))} mm`;
}

/** Perpendicular tick marks at outer ends of dimension line (| style — match PDF) */
function canvasHorizontalDimArrows(context, x0, x1, y, color, tickPx) {
    context.save();
    context.setLineDash([]);
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    context.beginPath();
    context.moveTo(x0, y - tickPx);
    context.lineTo(x0, y + tickPx);
    context.moveTo(x1, y - tickPx);
    context.lineTo(x1, y + tickPx);
    context.stroke();
    context.restore();
}

function canvasVerticalDimArrows(context, x, y0, y1, color, tickPx) {
    context.save();
    context.setLineDash([]);
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    context.beginPath();
    context.moveTo(x - tickPx, y0);
    context.lineTo(x + tickPx, y0);
    context.moveTo(x - tickPx, y1);
    context.lineTo(x + tickPx, y1);
    context.stroke();
    context.restore();
}

function canvasObliqueDimArrows(context, x0, y0, x1, y1, ux, uy, color, tickPx) {
    canvasObliqueTicks(context, x0, y0, ux, uy, color, tickPx);
    canvasObliqueTicks(context, x1, y1, ux, uy, color, tickPx);
}

function canvasObliqueTicks(context, px, py, ux, uy, color, tickPx) {
    const vx = -uy;
    const vy = ux;
    context.save();
    context.setLineDash([]);
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    context.beginPath();
    context.moveTo(px - vx * tickPx, py - vy * tickPx);
    context.lineTo(px + vx * tickPx, py + vy * tickPx);
    context.stroke();
    context.restore();
}

// Check if a label bounds rectangle overlaps with a wall line segment
// Returns true if the label would overlap with the wall line
function doesLabelOverlapWallLine(labelBounds, line, scaleFactor, offsetX, offsetY, padding = 1) {
    // Convert line points to screen coordinates
    const lineStartX = line[0].x * scaleFactor + offsetX;
    const lineStartY = line[0].y * scaleFactor + offsetY;
    const lineEndX = line[1].x * scaleFactor + offsetX;
    const lineEndY = line[1].y * scaleFactor + offsetY;
    
    // Add padding to label bounds for safety margin
    const paddedBounds = {
        x: labelBounds.x - padding,
        y: labelBounds.y - padding,
        width: labelBounds.width + padding * 2,
        height: labelBounds.height + padding * 2
    };
    
    // Check if line segment intersects with the rectangle
    // Using line-rectangle intersection algorithm
    const rectLeft = paddedBounds.x;
    const rectRight = paddedBounds.x + paddedBounds.width;
    const rectTop = paddedBounds.y;
    const rectBottom = paddedBounds.y + paddedBounds.height;
    
    // Check if line is completely outside the rectangle
    const lineMinX = Math.min(lineStartX, lineEndX);
    const lineMaxX = Math.max(lineStartX, lineEndX);
    const lineMinY = Math.min(lineStartY, lineEndY);
    const lineMaxY = Math.max(lineStartY, lineEndY);
    
    // Quick rejection test
    if (lineMaxX < rectLeft || lineMinX > rectRight || lineMaxY < rectTop || lineMinY > rectBottom) {
        return false;
    }
    
    // Check if any point of the line is inside the rectangle
    if ((lineStartX >= rectLeft && lineStartX <= rectRight && lineStartY >= rectTop && lineStartY <= rectBottom) ||
        (lineEndX >= rectLeft && lineEndX <= rectRight && lineEndY >= rectTop && lineEndY <= rectBottom)) {
        return true;
    }
    
    // Check if line segment intersects rectangle edges
    // Check intersection with top edge
    if (lineMinY <= rectTop && lineMaxY >= rectTop) {
        const t = (rectTop - lineStartY) / (lineEndY - lineStartY);
        if (t >= 0 && t <= 1) {
            const intersectX = lineStartX + t * (lineEndX - lineStartX);
            if (intersectX >= rectLeft && intersectX <= rectRight) {
                return true;
            }
        }
    }
    
    // Check intersection with bottom edge
    if (lineMinY <= rectBottom && lineMaxY >= rectBottom) {
        const t = (rectBottom - lineStartY) / (lineEndY - lineStartY);
        if (t >= 0 && t <= 1) {
            const intersectX = lineStartX + t * (lineEndX - lineStartX);
            if (intersectX >= rectLeft && intersectX <= rectRight) {
                return true;
            }
        }
    }
    
    // Check intersection with left edge
    if (lineMinX <= rectLeft && lineMaxX >= rectLeft) {
        const t = (rectLeft - lineStartX) / (lineEndX - lineStartX);
        if (t >= 0 && t <= 1) {
            const intersectY = lineStartY + t * (lineEndY - lineStartY);
            if (intersectY >= rectTop && intersectY <= rectBottom) {
                return true;
            }
        }
    }
    
    // Check intersection with right edge
    if (lineMinX <= rectRight && lineMaxX >= rectRight) {
        const t = (rectRight - lineStartX) / (lineEndX - lineStartX);
        if (t >= 0 && t <= 1) {
            const intersectY = lineStartY + t * (lineEndY - lineStartY);
            if (intersectY >= rectTop && intersectY <= rectBottom) {
                return true;
            }
        }
    }
    
    return false;
}

// Check if label bounds overlap with any wall lines
function doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY) {
    if (!wallLinesMap || wallLinesMap.size === 0) return false;
    
    for (const [, wallData] of wallLinesMap) {
        const { line1, line2 } = wallData;
        
        // Check both line1 and line2
        if (line1 && doesLabelOverlapWallLine(labelBounds, line1, scaleFactor, offsetX, offsetY)) {
            return true;
        }
        if (line2 && doesLabelOverlapWallLine(labelBounds, line2, scaleFactor, offsetX, offsetY)) {
            return true;
        }
    }
    
    return false;
}

// Utility function to normalize wall coordinates
// Ensures horizontal walls are created from left to right
// and vertical walls are created from top to bottom
export function normalizeWallCoordinates(startPoint, endPoint) {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    
    // Determine if wall is horizontal or vertical
    const isHorizontal = Math.abs(dy) < Math.abs(dx);
    
    if (isHorizontal) {
        // For horizontal walls, ensure start_x < end_x (left to right)
        if (startPoint.x > endPoint.x) {
            return {
                startPoint: { x: endPoint.x, y: endPoint.y },
                endPoint: { x: startPoint.x, y: startPoint.y }
            };
        }
    } else {
        // For vertical walls, ensure start_y < end_y (top to bottom)
        if (startPoint.y > endPoint.y) {
            return {
                startPoint: { x: endPoint.x, y: endPoint.y },
                endPoint: { x: startPoint.x, y: startPoint.y }
            };
        }
    }
    
    // No change needed
    return {
        startPoint: { x: startPoint.x, y: startPoint.y },
        endPoint: { x: endPoint.x, y: endPoint.y }
    };
}

// Test function to verify normalization logic
export function testNormalization() {
    console.log('Testing wall coordinate normalization...');
    
    // Test horizontal wall (should be left to right)
    const horizontalTest1 = normalizeWallCoordinates({ x: 100, y: 50 }, { x: 50, y: 50 });
    console.log('Horizontal wall (right to left):', horizontalTest1);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 100, y: 50}
    
    const horizontalTest2 = normalizeWallCoordinates({ x: 50, y: 50 }, { x: 100, y: 50 });
    console.log('Horizontal wall (left to right):', horizontalTest2);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 100, y: 50}
    
    // Test vertical wall (should be top to bottom)
    const verticalTest1 = normalizeWallCoordinates({ x: 50, y: 100 }, { x: 50, y: 50 });
    console.log('Vertical wall (bottom to top):', verticalTest1);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 50, y: 100}
    
    const verticalTest2 = normalizeWallCoordinates({ x: 50, y: 50 }, { x: 50, y: 100 });
    console.log('Vertical wall (top to bottom):', verticalTest2);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 50, y: 100}
    
    // Test diagonal wall (should not change)
    const diagonalTest = normalizeWallCoordinates({ x: 50, y: 50 }, { x: 100, y: 100 });
    console.log('Diagonal wall:', diagonalTest);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 100, y: 100}
}

// Draw the grid on the canvas
export function drawGrid(context, canvasWidth, canvasHeight, gridSize, isDrawing) {
    context.strokeStyle = isDrawing ? DIMENSION_CONFIG.COLORS.GRID_ACTIVE : DIMENSION_CONFIG.COLORS.GRID;
    context.lineWidth = isDrawing ? DIMENSION_CONFIG.GRID_LINE_WIDTH_ACTIVE : DIMENSION_CONFIG.GRID_LINE_WIDTH;
    for (let x = 0; x <= canvasWidth; x += gridSize) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvasHeight);
        context.stroke();
    }
    for (let y = 0; y <= canvasHeight; y += gridSize) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvasWidth, y);
        context.stroke();
    }
}

// Get room label positions for interactive labels
export function getRoomLabelPositions(rooms, walls, scaleFactor, offsetX, offsetY, calculateRoomArea, calculatePolygonVisualCenter) {
    const labelPositions = [];
    
    rooms.forEach(room => {
        const roomWalls = room.walls.map(wallId => 
            walls.find(w => w.id === wallId)
        ).filter(Boolean);
        const areaPoints = (room.room_points && room.room_points.length >= 3)
            ? { insetPoints: room.room_points }
            : calculateRoomArea(roomWalls);
        if (!areaPoints || !areaPoints.insetPoints || areaPoints.insetPoints.length < 3) return;
        
        // Use stored label position if available, otherwise calculate center
        let position;
        if (room.label_position && room.label_position.x !== undefined && room.label_position.y !== undefined) {
            position = room.label_position;
        } else {
            const center = calculatePolygonVisualCenter(areaPoints.insetPoints);
            if (center) {
                position = center;
            } else {
                return; // Skip if no position can be determined
            }
        }
        
        labelPositions.push({
            roomId: room.id,
            position: position,
            room: room
        });
    });
    
    return labelPositions;
}

// Draw the preview of a room being defined
export function drawRoomPreview(context, selectedRoomPoints, scaleFactor, offsetX, offsetY) {
    if (selectedRoomPoints.length < 2) return;
    selectedRoomPoints.forEach(pt => {
        context.beginPath();
        context.arc(
            pt.x * scaleFactor + offsetX,
            pt.y * scaleFactor + offsetY,
            4, 0, 2 * Math.PI
        );
        context.fillStyle = '#007bff';
        context.fill();
    });  
    context.beginPath();
    context.moveTo(
        selectedRoomPoints[0].x * scaleFactor + offsetX,
        selectedRoomPoints[0].y * scaleFactor + offsetY
    );
    for (let i = 1; i < selectedRoomPoints.length; i++) {
        context.lineTo(
            selectedRoomPoints[i].x * scaleFactor + offsetX,
            selectedRoomPoints[i].y * scaleFactor + offsetY
        );
    }          
    context.strokeStyle = DIMENSION_CONFIG.COLORS.ROOM_PREVIEW;
    context.lineWidth = DIMENSION_CONFIG.ROOM_PREVIEW_LINE_WIDTH;
    context.setLineDash(DIMENSION_CONFIG.ROOM_PREVIEW_DASH);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = DIMENSION_CONFIG.COLORS.ROOM_PREVIEW_FILL;
    context.fill();
}

// Draw wall endpoints
export function drawEndpoints(context, x, y, scaleFactor, offsetX, offsetY, hoveredPoint, color = null, size = null) {
    // Use config defaults if not provided
    if (color === null) {
        color = DIMENSION_CONFIG.COLORS.ENDPOINT;
    }
    if (size === null) {
        size = DIMENSION_CONFIG.ENDPOINT_SIZE;
    }
    
    if (hoveredPoint && hoveredPoint.x === x && hoveredPoint.y === y) {
        color = DIMENSION_CONFIG.COLORS.ENDPOINT_HOVER; // Highlight color for hovered endpoint
        size = DIMENSION_CONFIG.ENDPOINT_SIZE_HOVER; // Slightly larger size for visual feedback
    }
    context.beginPath();
    context.arc(
        x * scaleFactor + offsetX,
        y * scaleFactor + offsetY,
        size,
        0,
        2 * Math.PI
    );
    context.fillStyle = color;
    context.fill();
}

// Calculate actual project dimensions from wall boundaries
export function calculateActualProjectDimensions(walls) {
    if (!walls || walls.length === 0) {
        return { width: 0, length: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    
    // Find the bounding box of all walls
    const minX = Math.min(...walls.map((wall) => Math.min(wall.start_x, wall.end_x)));
    const maxX = Math.max(...walls.map((wall) => Math.max(wall.start_x, wall.end_x)));
    const minY = Math.min(...walls.map((wall) => Math.min(wall.start_y, wall.end_y)));
    const maxY = Math.max(...walls.map((wall) => Math.max(wall.start_y, wall.end_y)));
    
    return {
        width: maxX - minX,
        length: maxY - minY,
        minX,
        maxX,
        minY,
        maxY
    };
}

// Compare actual dimensions with declared project dimensions
export function compareDimensions(actualDimensions, declaredProject) {
    if (!declaredProject || !actualDimensions) {
        return { exceeds: false, warnings: [] };
    }
    
    const warnings = [];
    let exceeds = false;
    
    // Check if actual width exceeds declared width
    if (actualDimensions.width > declaredProject.width) {
        warnings.push(`Actual width (${Math.round(actualDimensions.width)}mm) exceeds declared width (${declaredProject.width}mm)`);
        exceeds = true;
    }
    
    // Check if actual length exceeds declared length
    if (actualDimensions.length > declaredProject.length) {
        warnings.push(`Actual length (${Math.round(actualDimensions.length)}mm) exceeds declared length (${declaredProject.length}mm)`);
        exceeds = true;
    }
    
    return { exceeds, warnings };
}

// Draw overall project dimensions (actual dimensions from wall boundaries)
export function drawOverallProjectDimensions(context, walls, scaleFactor, offsetX, offsetY, placedLabels = [], allLabels = [], initialScale = 1, wallLinesMap = null) {
    if (!walls || walls.length === 0) return;
    
    const actualDimensions = calculateActualProjectDimensions(walls);
    const { width, length, minX, maxX, minY, maxY } = actualDimensions;
    
    // Create model bounds for external dimensioning with larger padding for outermost placement
    const modelBounds = {
        minX: minX - 100, // Larger padding to ensure outermost placement
        maxX: maxX + 100,
        minY: minY - 100,
        maxY: maxY + 100
    };
    
    // Use dedicated project base offset for outermost placement
    const PROJECT_BASE_OFFSET = DIMENSION_CONFIG.PROJECT_BASE_OFFSET;
    
    // Clip extension lines to wall extents (same as PDF)
    const clipBoundsModel = { minX, maxX, minY, maxY };
    
    // Draw overall width dimension (top) with enhanced collision detection
    drawProjectDimension(
        context,
        minX, minY, // start point
        maxX, minY, // end point (horizontal line)
        scaleFactor, offsetX, offsetY,
        DIMENSION_CONFIG.COLORS.PROJECT,
        modelBounds, placedLabels, allLabels, PROJECT_BASE_OFFSET, 'horizontal',
        initialScale, wallLinesMap,
        clipBoundsModel
    );
    
    // Draw overall length dimension (right side) with enhanced collision detection
    drawProjectDimension(
        context,
        maxX, minY, // start point
        maxX, maxY, // end point (vertical line)
        scaleFactor, offsetX, offsetY,
        DIMENSION_CONFIG.COLORS.PROJECT,
        modelBounds, placedLabels, allLabels, PROJECT_BASE_OFFSET, 'vertical',
        initialScale, wallLinesMap,
        clipBoundsModel
    );
}

// Enhanced function to draw project dimensions (aligned with pdfVectorWallPlan: clip extensions, dashed/solid, mm label)
function drawProjectDimension(
    context,
    startX,
    startY,
    endX,
    endY,
    scaleFactor,
    offsetX,
    offsetY,
    color,
    modelBounds,
    placedLabels,
    allLabels,
    baseOffset,
    orientation,
    initialScale = 1,
    wallLinesMap = null,
    clipBoundsModel = null
) {
    const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));

    if (length === 0) return;

    const wallMidX = (startX + endX) / 2;
    const wallMidY = (startY + endY) / 2;

    context.save();
    context.fillStyle = color;
    const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor;
    let fontSize;
    let sqrtScaledFontSize = 0;
    if (initialScale > 0 && scaleFactor > initialScale) {
        const zoomRatio = scaleFactor / initialScale;
        sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
    }
    if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
        fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
    } else {
        fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
    }
    fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
    context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
    const text = formatDimMmCanvas(length);
    const textWidth = context.measureText(text).width;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    const { minX, maxX, minY, maxY } = modelBounds;
    const rectScreen = clipBoundsModel ? modelBoundsToScreenRect(clipBoundsModel, scaleFactor, offsetX, offsetY) : null;
    const extDash = getCanvasExtensionDashPattern(scaleFactor);
    const dimLineW = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    const extLineW = getCanvasExtensionLineWidth();
    const tickPx = 4;

    if (orientation === 'horizontal') {
        const side = 'top';
        let labelY;
        let labelX;
        let offset = baseOffset;
        let attempts = 0;
        const maxAttempts = DIMENSION_CONFIG.PROJECT_MAX_ATTEMPTS;

        do {
            labelY = minY * scaleFactor + offsetY - offset;
            labelX = wallMidX * scaleFactor + offsetX;

            const labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 4, 10);
            const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
            const hasWallOverlap = wallLinesMap
                ? doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY)
                : false;

            if (!hasOverlap && !hasWallOverlap) break;

            const wallAvoidanceIncrementPx =
                hasWallOverlap && !hasOverlap ? 3 * scaleFactor : DIMENSION_CONFIG.PROJECT_OFFSET_INCREMENT;
            offset += wallAvoidanceIncrementPx;
            attempts++;
        } while (attempts < maxAttempts);

        const textPadding = 4;
        const textLeft = labelX - textWidth / 2 - textPadding;
        const textRight = labelX + textWidth / 2 + textPadding;
        const startXScreen = startX * scaleFactor + offsetX;
        const endXScreen = endX * scaleFactor + offsetX;
        const yWallStart = startY * scaleFactor + offsetY;
        const yWallEnd = endY * scaleFactor + offsetY;

        context.strokeStyle = color;
        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, startXScreen, yWallStart, startXScreen, labelY, rectScreen);
        canvasDrawExtensionDashed(context, endXScreen, yWallEnd, endXScreen, labelY, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        context.beginPath();
        if (startXScreen < textLeft) {
            context.moveTo(startXScreen, labelY);
            context.lineTo(textLeft, labelY);
        }
        if (endXScreen > textRight) {
            context.moveTo(textRight, labelY);
            context.lineTo(endXScreen, labelY);
        }
        context.stroke();

        if (startXScreen < textLeft || endXScreen > textRight) {
            canvasHorizontalDimArrows(context, startXScreen, endXScreen, labelY, color, tickPx);
        }

        context.fillStyle = '#ffffff';
        context.fillRect(labelX - textWidth / 2 - 3, labelY - fontSize * 0.35 - 2, textWidth + 6, fontSize * 0.75 + 4);
        context.fillStyle = color;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, labelX, labelY);

        placedLabels.push({
            x: labelX - textWidth / 2 - 4,
            y: labelY - 10,
            width: textWidth + 8,
            height: 20,
            side: side,
            text: text,
            angle: angle,
            type: 'project'
        });
    } else {
        const side = 'right';
        let labelX;
        let labelY;
        let offset = Math.max(baseOffset, DIMENSION_CONFIG.PROJECT_MIN_VERTICAL_OFFSET);
        let attempts = 0;
        const maxAttempts = DIMENSION_CONFIG.PROJECT_MAX_ATTEMPTS;

        do {
            labelX = maxX * scaleFactor + offsetX + offset;
            labelY = wallMidY * scaleFactor + offsetY;

            const labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 4, 10);
            const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
            const hasWallOverlap = wallLinesMap
                ? doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY)
                : false;

            if (!hasOverlap && !hasWallOverlap) break;

            const wallAvoidanceIncrementPx =
                hasWallOverlap && !hasOverlap ? 3 * scaleFactor : DIMENSION_CONFIG.PROJECT_OFFSET_INCREMENT;
            offset += wallAvoidanceIncrementPx;
            attempts++;
        } while (attempts < maxAttempts);

        const textPadding = 4;
        const textTop = labelY - textWidth / 2 - textPadding;
        const textBottom = labelY + textWidth / 2 + textPadding;
        const xWallStart = startX * scaleFactor + offsetX;
        const xWallEnd = endX * scaleFactor + offsetX;
        const yStart = startY * scaleFactor + offsetY;
        const yEnd = endY * scaleFactor + offsetY;

        context.strokeStyle = color;
        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, xWallStart, yStart, labelX, yStart, rectScreen);
        canvasDrawExtensionDashed(context, xWallEnd, yEnd, labelX, yEnd, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        context.beginPath();
        const startYScreen = yStart;
        const endYScreen = yEnd;
        if (startYScreen < textTop) {
            context.moveTo(labelX, startYScreen);
            context.lineTo(labelX, textTop);
        }
        if (endYScreen > textBottom) {
            context.moveTo(labelX, textBottom);
            context.lineTo(labelX, endYScreen);
        }
        context.stroke();

        if (startYScreen < textTop || endYScreen > textBottom) {
            canvasVerticalDimArrows(context, labelX, startYScreen, endYScreen, color, tickPx);
        }

        context.save();
        context.translate(labelX - 4, labelY);
        context.rotate(-Math.PI / 2);
        const tw = textWidth;
        const th = fontSize * 0.75;
        context.fillStyle = '#ffffff';
        context.fillRect(-tw / 2 - 3, -th / 2 - 2, tw + 6, th + 4);
        context.fillStyle = color;
        context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 0, 0);
        context.restore();

        placedLabels.push({
            x: labelX - 10,
            y: labelY - textWidth / 2 - 4,
            width: 20,
            height: textWidth + 8,
            side: side,
            text: text,
            angle: angle,
            type: 'project'
        });
    }

    context.restore();
}

/**
 * Draw dashed extensions (clip outside model interior). One stroke per segment so dash phase
 * matches pdfVectorWallPlan (each doc.line() is independent).
 */
function canvasDrawExtensionDashed(context, x1, y1, x2, y2, rectScreen) {
    const segs = extensionSegmentsOutsideModelRect(x1, y1, x2, y2, rectScreen);
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        context.lineDashOffset = 0;
        context.beginPath();
        context.moveTo(s.x1, s.y1);
        context.lineTo(s.x2, s.y2);
        context.stroke();
    }
}

/**
 * Orthogonal plan dimensions (ceiling/floor canvas): same geometry as wall plan —
 * clipped dashed extensions, solid dimension line with text gap, tick marks at ends.
 * `labelX` / `labelY` are canvas pixels; `clipModelBounds` is model-space AABB (same as drawDimensions).
 */
export function drawOrthoPlanDimensionGeometryLikeWall(
    context,
    { startX, startY, endX, endY, isHorizontal, labelX, labelY, textWidth, color },
    scaleFactor,
    offsetX,
    offsetY,
    clipModelBounds
) {
    const rectScreen = modelBoundsToScreenRect(clipModelBounds, scaleFactor, offsetX, offsetY);
    const extDash = getCanvasExtensionDashPattern(scaleFactor);
    const extLineW = getCanvasExtensionLineWidth();
    const dimLineW = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    const tickPx = 4;
    const textPadding = 2;

    context.save();
    context.strokeStyle = color;

    if (isHorizontal) {
        const startXScreen = startX * scaleFactor + offsetX;
        const endXScreen = endX * scaleFactor + offsetX;
        const centeredLabelX = (startXScreen + endXScreen) / 2;
        const centeredTextLeft = centeredLabelX - textWidth / 2 - textPadding;
        const centeredTextRight = centeredLabelX + textWidth / 2 + textPadding;

        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, startXScreen, startY * scaleFactor + offsetY, startXScreen, labelY, rectScreen);
        canvasDrawExtensionDashed(context, endXScreen, endY * scaleFactor + offsetY, endXScreen, labelY, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        context.beginPath();
        if (startXScreen < centeredTextLeft) {
            context.moveTo(startXScreen, labelY);
            context.lineTo(centeredTextLeft, labelY);
        }
        if (endXScreen > centeredTextRight) {
            context.moveTo(centeredTextRight, labelY);
            context.lineTo(endXScreen, labelY);
        }
        context.stroke();
        canvasHorizontalDimArrows(context, startXScreen, endXScreen, labelY, color, tickPx);
    } else {
        const textTop = labelY - textWidth / 2 - textPadding;
        const textBottom = labelY + textWidth / 2 + textPadding;
        const xStart = startX * scaleFactor + offsetX;
        const xEnd = endX * scaleFactor + offsetX;
        const startYScreen = startY * scaleFactor + offsetY;
        const endYScreen = endY * scaleFactor + offsetY;

        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, xStart, startYScreen, labelX, startYScreen, rectScreen);
        canvasDrawExtensionDashed(context, xEnd, endYScreen, labelX, endYScreen, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        context.beginPath();
        if (startYScreen < textTop) {
            context.moveTo(labelX, startYScreen);
            context.lineTo(labelX, textTop);
        }
        if (endYScreen > textBottom) {
            context.moveTo(labelX, textBottom);
            context.lineTo(labelX, endYScreen);
        }
        context.stroke();
        canvasVerticalDimArrows(context, labelX, startYScreen, endYScreen, color, tickPx);
    }
    context.restore();
}

// Draw wall dimensions
export function drawDimensions(context, startX, startY, endX, endY, scaleFactor, offsetX, offsetY, color = 'blue', modelBounds = null, placedLabels = [], allLabels = [], collectOnly = false, initialScale = 1, wallLinesMap = null, dimensionValuesSeen = null) {
    const length = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    );

    // Global value dedup: skip if this value already shown (match floor/ceiling)
    if (dimensionValuesSeen && typeof length === 'number') {
        const roundedLength = Math.round(length);
        if (dimensionValuesSeen.has(roundedLength)) return;
        dimensionValuesSeen.add(roundedLength);
    }

    let midX = 0;
    let midY = 0;

    // Calculate wall midpoint
    const wallMidX = (startX + endX) / 2;
    const wallMidY = (startY + endY) / 2;
    
    context.save();
    context.fillStyle = color;
    // Calculate font size: if calculated value is below minimum, use minimum; when zooming, scale from minimum
    const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor;
    let fontSize;
    
    // Calculate square root scaled font size if user has zoomed in
    let sqrtScaledFontSize = 0;
    if (initialScale > 0 && scaleFactor > initialScale) {
        // User has zoomed in - scale from minimum using square root to reduce aggressiveness
        // This means 2x zoom only results in ~1.41x text size, not 2x
        const zoomRatio = scaleFactor / initialScale;
        sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
    }
    
    // Use the maximum of calculated and square root scaled to prevent discontinuity
    // This ensures smooth transition when crossing the minimum threshold
    if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
        // Below minimum threshold - use square root scaling if zoomed, otherwise minimum
        fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
    } else {
        // Above minimum threshold - use max of calculated and square root scaled
        // This prevents sudden drop when crossing the threshold
        fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
    }
    
    fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
    context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
    const text = formatDimMmCanvas(length);
    const textWidth = context.measureText(text).width;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // If modelBounds is provided, use external dimensioning
    if (modelBounds) {
        const { minX, maxX, minY, maxY } = modelBounds;
        const rectScreen = modelBoundsToScreenRect(modelBounds, scaleFactor, offsetX, offsetY);
        const extDash = getCanvasExtensionDashPattern(scaleFactor);
        const dimLineW = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
        const extLineW = getCanvasExtensionLineWidth();
        const tickPx = 4;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const useObliqueWallDim =
            adx > 1e-9 && ady > 1e-9 && Math.min(adx, ady) / Math.max(adx, ady) >= 0.3;
        
        // Create unique key for this dimension to remember placement decision
        const dimensionKey = `${startX.toFixed(2)}_${startY.toFixed(2)}_${endX.toFixed(2)}_${endY.toFixed(2)}_wall`;
        
        // Check if we have a stored placement decision for this dimension
        const storedPlacement = dimensionPlacementMemory.get(dimensionKey);
        const lockedSide = storedPlacement ? storedPlacement.side : null;
        
        // Smart placement: determine if dimension is "small" relative to project size
        // Small dimensions can be placed near the wall, large ones go outside project area
        const projectWidth = (maxX - minX) || 1;
        const projectHeight = (maxY - minY) || 1;
        const projectSize = Math.max(projectWidth, projectHeight);
        const isSmallDimension = length < (projectSize * DIMENSION_CONFIG.SMALL_DIMENSION_THRESHOLD);
        
        // Use smaller offset for small dimensions (place near wall), larger offset for big dimensions (outside project)
        const baseOffset = isSmallDimension ? DIMENSION_CONFIG.BASE_OFFSET_SMALL : DIMENSION_CONFIG.BASE_OFFSET;

        const Ps = { x: startX * scaleFactor + offsetX, y: startY * scaleFactor + offsetY };
        const Pe = { x: endX * scaleFactor + offsetX, y: endY * scaleFactor + offsetY };
        const wvx = Pe.x - Ps.x;
        const wvy = Pe.y - Ps.y;
        const pdfLenOblique = Math.hypot(wvx, wvy);

        if (useObliqueWallDim && pdfLenOblique >= 1e-6) {
            const ux = wvx / pdfLenOblique;
            const uy = wvy / pdfLenOblique;
            const nx = -uy;
            const ny = ux;

            const obliqueBounds = (lx, ly, tw) => {
                const rad = Math.atan2(uy, ux);
                const c = Math.abs(Math.cos(rad));
                const s = Math.abs(Math.sin(rad));
                const fh = fontSize * 0.45;
                const bw = tw * c + fh * s + 4;
                const bh = tw * s + fh * c + 4;
                return { x: lx - bw / 2, y: ly - bh / 2, width: bw, height: bh };
            };

            const placement = smartPlacement({
                calculatePositionSide1: (off) => {
                    const mx = (Ps.x + Pe.x) / 2;
                    const my = (Ps.y + Pe.y) / 2;
                    return { labelX: mx + nx * off, labelY: my + ny * off };
                },
                calculatePositionSide2: (off) => {
                    const mx = (Ps.x + Pe.x) / 2;
                    const my = (Ps.y + Pe.y) / 2;
                    return { labelX: mx - nx * off, labelY: my - ny * off };
                },
                calculateBounds: (lx, ly, tw) => obliqueBounds(lx, ly, tw),
                textWidth: textWidth,
                placedLabels: placedLabels,
                baseOffset: baseOffset,
                offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                maxAttempts: DIMENSION_CONFIG.MAX_ATTEMPTS,
                preferredSide: 'side1',
                lockedSide: null
            });

            let labelX = placement.labelX;
            let labelY = placement.labelY;

            if (wallLinesMap) {
                let labelBounds = obliqueBounds(labelX, labelY, textWidth);
                let hasWallOverlap = doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY);
                let wallCheckAttempts = 0;
                const maxWallCheckAttempts = 10;
                const wallAvoidanceIncrement = 2 * scaleFactor;
                const sign = placement.side === 'side1' ? 1 : -1;
                while (hasWallOverlap && wallCheckAttempts < maxWallCheckAttempts) {
                    labelX += sign * nx * wallAvoidanceIncrement;
                    labelY += sign * ny * wallAvoidanceIncrement;
                    labelBounds = obliqueBounds(labelX, labelY, textWidth);
                    hasWallOverlap = doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY);
                    wallCheckAttempts++;
                }
            }

            const pmx = (Ps.x + Pe.x) / 2;
            const pmy = (Ps.y + Pe.y) / 2;
            const dOff = (labelX - pmx) * nx + (labelY - pmy) * ny;
            const Ps_ = { x: Ps.x + nx * dOff, y: Ps.y + ny * dOff };
            const Pe_ = { x: Pe.x + nx * dOff, y: Pe.y + ny * dOff };

            context.strokeStyle = color;
            context.lineWidth = extLineW;
            context.setLineDash(extDash);
            canvasDrawExtensionDashed(context, Ps.x, Ps.y, Ps_.x, Ps_.y, rectScreen);
            canvasDrawExtensionDashed(context, Pe.x, Pe.y, Pe_.x, Pe_.y, rectScreen);

            const textPadding = 2;
            const halfText = textWidth / 2 + textPadding;
            const midS = pdfLenOblique / 2;
            const leftS = midS - halfText;
            const rightS = midS + halfText;

            context.setLineDash([]);
            context.lineWidth = dimLineW;
            context.strokeStyle = color;
            context.beginPath();
            if (rightS <= leftS) {
                context.moveTo(Ps_.x, Ps_.y);
                context.lineTo(Pe_.x, Pe_.y);
            } else {
                const drawSeg = (s0, s1) => {
                    if (s1 <= s0 + 1e-4) return;
                    context.moveTo(Ps_.x + ux * s0, Ps_.y + uy * s0);
                    context.lineTo(Ps_.x + ux * s1, Ps_.y + uy * s1);
                };
                drawSeg(0, Math.max(0, leftS));
                drawSeg(Math.min(pdfLenOblique, rightS), pdfLenOblique);
            }
            context.stroke();

            canvasObliqueDimArrows(context, Ps_.x, Ps_.y, Pe_.x, Pe_.y, ux, uy, color, tickPx);
            if (rightS > leftS && leftS > 0) {
                canvasObliqueTicks(context, Ps_.x + ux * leftS, Ps_.y + uy * leftS, ux, uy, color, tickPx);
            }
            if (rightS > leftS && rightS < pdfLenOblique) {
                canvasObliqueTicks(context, Ps_.x + ux * rightS, Ps_.y + uy * rightS, ux, uy, color, tickPx);
            }

            const textAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
            if (!storedPlacement) {
                dimensionPlacementMemory.set(dimensionKey, { side: placement.side });
            }
            const lb = obliqueBounds(labelX, labelY, textWidth);
            const obliqueLabel = {
                x: lb.x,
                y: lb.y,
                width: lb.width,
                height: lb.height,
                side: placement.side === 'side1' ? 'oblique1' : 'oblique2',
                text: text,
                angle: angle,
                type: 'wall',
                obliqueAngle: textAngleDeg
            };
            placedLabels.push(obliqueLabel);
            if (collectOnly) {
                allLabels.push({ ...obliqueLabel });
            }
        } else if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
            // Horizontal wall - smart placement: try both top and bottom, choose best
            // Smart placement: evaluate both top and bottom sides
            const placement = smartPlacement({
                calculatePositionSide1: (offset) => {
                    // Side 1: Top (above)
                    if (isSmallDimension) {
                        return {
                            labelX: wallMidX * scaleFactor + offsetX,
                            labelY: wallMidY * scaleFactor + offsetY - offset
                        };
                    } else {
                        return {
                            labelX: wallMidX * scaleFactor + offsetX,
                            labelY: minY * scaleFactor + offsetY - offset
                        };
                    }
                },
                calculatePositionSide2: (offset) => {
                    // Side 2: Bottom (below)
                    if (isSmallDimension) {
                        return {
                            labelX: wallMidX * scaleFactor + offsetX,
                            labelY: wallMidY * scaleFactor + offsetY + offset
                        };
                    } else {
                        return {
                            labelX: wallMidX * scaleFactor + offsetX,
                            labelY: maxY * scaleFactor + offsetY + offset
                        };
                    }
                },
                calculateBounds: (labelX, labelY, textWidth) => calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8),
                textWidth: textWidth,
                placedLabels: placedLabels,
                baseOffset: baseOffset,
                offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                maxAttempts: DIMENSION_CONFIG.MAX_ATTEMPTS,
                preferredSide: 'side1', // Prefer top for horizontal dimensions (professional standard)
                lockedSide: lockedSide // Use stored side if available
            });
            
            // Store the placement decision for future renders (to prevent position changes on zoom)
            if (!storedPlacement) {
                dimensionPlacementMemory.set(dimensionKey, { side: placement.side });
            }
            
            let labelX = placement.labelX;
            let labelY = placement.labelY;
            let side = placement.side === 'side1' ? 'top' : 'bottom';
            
            // Additional check: ensure label doesn't overlap with wall lines
            if (wallLinesMap) {
                let labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8);
                let hasWallOverlap = doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY);
                let wallCheckAttempts = 0;
                const maxWallCheckAttempts = 10;
                // Scale-aware increment: 2mm in model units, converted to screen pixels
                const wallAvoidanceIncrement = 200 * scaleFactor;
                
                while (hasWallOverlap && wallCheckAttempts < maxWallCheckAttempts) {
                    // Increase offset gradually to move label away from wall
                    if (placement.side === 'side1') {
                        // Top side - move up
                        labelY = labelY - wallAvoidanceIncrement;
                    } else {
                        // Bottom side - move down
                        labelY = labelY + wallAvoidanceIncrement;
                    }
                    labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8);
                    hasWallOverlap = doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY);
                    wallCheckAttempts++;
                }
            }
            
            const textPadding = 2;
            const startXScreen = startX * scaleFactor + offsetX;
            const endXScreen = endX * scaleFactor + offsetX;
            const dimensionLineMidpoint = (startXScreen + endXScreen) / 2;
            const centeredLabelX = dimensionLineMidpoint;
            const centeredTextLeft = centeredLabelX - textWidth / 2 - textPadding;
            const centeredTextRight = centeredLabelX + textWidth / 2 + textPadding;

            context.strokeStyle = color;
            context.lineWidth = extLineW;
            context.setLineDash(extDash);
            canvasDrawExtensionDashed(context, startXScreen, startY * scaleFactor + offsetY, startXScreen, labelY, rectScreen);
            canvasDrawExtensionDashed(context, endXScreen, endY * scaleFactor + offsetY, endXScreen, labelY, rectScreen);

            context.setLineDash([]);
            context.lineWidth = dimLineW;
            context.beginPath();
            if (startXScreen < centeredTextLeft) {
                context.moveTo(startXScreen, labelY);
                context.lineTo(centeredTextLeft, labelY);
            }
            if (endXScreen > centeredTextRight) {
                context.moveTo(centeredTextRight, labelY);
                context.lineTo(endXScreen, labelY);
            }
            context.stroke();

            const wallHTickXs = [];
            if (startXScreen < centeredTextLeft) wallHTickXs.push(startXScreen, centeredTextLeft);
            if (endXScreen > centeredTextRight) wallHTickXs.push(centeredTextRight, endXScreen);
            if (wallHTickXs.length > 0) {
                canvasHorizontalDimArrows(context, startXScreen, endXScreen, labelY, color, tickPx);
            }

            const hLabel = {
                x: centeredLabelX - textWidth / 2 - 2,
                y: labelY - 8,
                width: textWidth + 4,
                height: 16,
                side: side,
                text: text,
                angle: angle,
                type: 'wall'
            };
            placedLabels.push(hLabel);
            if (collectOnly) {
                allLabels.push({ ...hLabel });
            }
        } else {
            // Vertical wall - smart placement: try both left and right, choose best
            const minVerticalOffset = isSmallDimension ? DIMENSION_CONFIG.MIN_VERTICAL_OFFSET_SMALL : DIMENSION_CONFIG.MIN_VERTICAL_OFFSET;
            const baseVerticalOffset = Math.max(baseOffset, minVerticalOffset);
            
            // Smart placement: evaluate both left and right sides
            const placement = smartPlacement({
                calculatePositionSide1: (offset) => {
                    // Side 1: Left
                    if (isSmallDimension) {
                        return {
                            labelX: wallMidX * scaleFactor + offsetX - offset,
                            labelY: wallMidY * scaleFactor + offsetY
                        };
                    } else {
                        return {
                            labelX: minX * scaleFactor + offsetX - offset,
                            labelY: wallMidY * scaleFactor + offsetY
                        };
                    }
                },
                calculatePositionSide2: (offset) => {
                    // Side 2: Right
                    if (isSmallDimension) {
                        return {
                            labelX: wallMidX * scaleFactor + offsetX + offset,
                            labelY: wallMidY * scaleFactor + offsetY
                        };
                    } else {
                        return {
                            labelX: maxX * scaleFactor + offsetX + offset,
                            labelY: wallMidY * scaleFactor + offsetY
                        };
                    }
                },
                calculateBounds: (labelX, labelY, textWidth) => calculateVerticalLabelBounds(labelX, labelY, textWidth, 2, 8),
                textWidth: textWidth,
                placedLabels: placedLabels,
                baseOffset: baseVerticalOffset,
                offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                maxAttempts: DIMENSION_CONFIG.MAX_ATTEMPTS,
                preferredSide: 'side2', // Prefer right for vertical dimensions (professional standard)
                lockedSide: lockedSide // Use stored side if available
            });
            
            // Store the placement decision for future renders (to prevent position changes on zoom)
            if (!storedPlacement) {
                dimensionPlacementMemory.set(dimensionKey, { side: placement.side });
            }
            
            let labelX = placement.labelX;
            let labelY = placement.labelY;
            let side = placement.side === 'side1' ? 'left' : 'right';
            
            // Additional check: ensure label doesn't overlap with wall lines
            if (wallLinesMap) {
                let labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 2, 8);
                let hasWallOverlap = doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY);
                let wallCheckAttempts = 0;
                const maxWallCheckAttempts = 10;
                // Scale-aware increment: 2mm in model units, converted to screen pixels
                const wallAvoidanceIncrement = 2 * scaleFactor;
                
                while (hasWallOverlap && wallCheckAttempts < maxWallCheckAttempts) {
                    // Increase offset gradually to move label away from wall
                    if (placement.side === 'side1') {
                        // Left side - move left
                        labelX = labelX - wallAvoidanceIncrement;
                    } else {
                        // Right side - move right
                        labelX = labelX + wallAvoidanceIncrement;
                    }
                    labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 2, 8);
                    hasWallOverlap = doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY);
                    wallCheckAttempts++;
                }
            }
            
            const textPadding = 2;
            const textTop = labelY - textWidth / 2 - textPadding;
            const textBottom = labelY + textWidth / 2 + textPadding;
            const xStart = startX * scaleFactor + offsetX;
            const xEnd = endX * scaleFactor + offsetX;
            const startYScreen = startY * scaleFactor + offsetY;
            const endYScreen = endY * scaleFactor + offsetY;

            context.strokeStyle = color;
            context.lineWidth = extLineW;
            context.setLineDash(extDash);
            canvasDrawExtensionDashed(context, xStart, startYScreen, labelX, startYScreen, rectScreen);
            canvasDrawExtensionDashed(context, xEnd, endYScreen, labelX, endYScreen, rectScreen);

            context.setLineDash([]);
            context.lineWidth = dimLineW;
            context.beginPath();
            if (startYScreen < textTop) {
                context.moveTo(labelX, startYScreen);
                context.lineTo(labelX, textTop);
            }
            if (endYScreen > textBottom) {
                context.moveTo(labelX, textBottom);
                context.lineTo(labelX, endYScreen);
            }
            context.stroke();

            const wallVTickYs = [];
            if (startYScreen < textTop) wallVTickYs.push(startYScreen, textTop);
            if (endYScreen > textBottom) wallVTickYs.push(textBottom, endYScreen);
            if (wallVTickYs.length > 0) {
                canvasVerticalDimArrows(context, labelX, startYScreen, endYScreen, color, tickPx);
            }

            const vLabel = {
                x: labelX - 8,
                y: labelY - textWidth / 2 - 2,
                width: 16,
                height: textWidth + 4,
                side: side,
                text: text,
                angle: angle,
                type: 'wall'
            };
            placedLabels.push(vLabel);
            if (collectOnly) {
                allLabels.push({ ...vLabel });
            }
        }
    } else {
        // Original internal dimensioning (fallback)
        if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
            // Horizontal wall (original simple style)
            midX = ((startX + endX) / 2) * scaleFactor + offsetX;
            midY = ((startY + endY) / 2) * scaleFactor + offsetY - 15;
            context.fillStyle = color;
            context.fillText(text, midX - textWidth / 2, midY + 4);
        } else {
            // Vertical wall (original simple style)
            midX = ((startX + endX) / 2) * scaleFactor + offsetX + 15;
            midY = ((startY + endY) / 2) * scaleFactor + offsetY;
            context.translate(midX, midY);
            context.rotate(-Math.PI / 2);
            context.fillStyle = color;
            context.fillText(text, -textWidth / 2, 4);
            context.restore();
        }
    }
    context.restore();
}

function normalizeRoomPointModel(p) {
    if (p == null) return null;
    if (Array.isArray(p)) {
        const x = Number(p[0]);
        const y = Number(p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

/** Shoelace centroid and absolute area (model mm²). Used to weight “inner” side toward real rooms. */
export function getRoomPolygonCentroidAndArea(roomPoints) {
    const pts = (roomPoints || []).map(normalizeRoomPointModel).filter(Boolean);
    const n = pts.length;
    if (n < 3) return { centroid: null, area: 0 };
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        twiceArea += cross;
        cx += (pts[i].x + pts[j].x) * cross;
        cy += (pts[i].y + pts[j].y) * cross;
    }
    const absArea = Math.abs(twiceArea) / 2;
    if (absArea < 1e-6) return { centroid: null, area: 0 };
    cx /= 3 * twiceArea;
    cy /= 3 * twiceArea;
    return { centroid: { x: cx, y: cy }, area: absArea };
}

function pointToSegmentDistSq(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq < 1e-12) return apx * apx + apy * apy;
    let t = (apx * abx + apy * aby) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * abx;
    const qy = ay + t * aby;
    const dx = px - qx;
    const dy = py - qy;
    return dx * dx + dy * dy;
}

function roomPolygonTouchesWallMm(room, wall, tolMm) {
    const ax = wall.start_x;
    const ay = wall.start_y;
    const bx = wall.end_x;
    const by = wall.end_y;
    if (ax == null || ay == null || bx == null || by == null) return false;
    const tolSq = tolMm * tolMm;
    const pts = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
    for (let i = 0; i < pts.length; i++) {
        if (pointToSegmentDistSq(pts[i].x, pts[i].y, ax, ay, bx, by) <= tolSq) {
            return true;
        }
    }
    return false;
}

/** When vertices are offset from the wall polyline, room centroid may still lie near the segment. */
function roomCentroidNearWallSegmentMm(room, wall, maxPerpMm) {
    const ax = wall.start_x;
    const ay = wall.start_y;
    const bx = wall.end_x;
    const by = wall.end_y;
    if (ax == null || ay == null || bx == null || by == null) return false;
    let { centroid: c } = getRoomPolygonCentroidAndArea(room.room_points);
    if (!c) {
        const raw = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
        if (raw.length === 0) return false;
        c = {
            x: raw.reduce((s, p) => s + p.x, 0) / raw.length,
            y: raw.reduce((s, p) => s + p.y, 0) / raw.length,
        };
    }
    const maxSq = maxPerpMm * maxPerpMm;
    return pointToSegmentDistSq(c.x, c.y, ax, ay, bx, by) <= maxSq;
}

function normalizeRoomPolygonPoints(roomPoints) {
    return (roomPoints || []).map(normalizeRoomPointModel).filter(Boolean);
}

/**
 * Rooms associated with this wall (M2M, vertex proximity, or centroid strip), in model space.
 * @param {{ adjacencyToleranceMm?: number }} [options]
 */
export function getRoomsLinkedToWall(wall, rooms, options) {
    const adjacencyToleranceMm =
        options && Number.isFinite(options.adjacencyToleranceMm)
            ? options.adjacencyToleranceMm
            : 40;

    if (!wall || !Array.isArray(rooms) || rooms.length === 0) return [];

    const wallId = String(wall.id);
    const linkedIds = new Set();

    if (Array.isArray(wall.rooms)) {
        wall.rooms.forEach((r) => {
            if (r == null) return;
            linkedIds.add(String(typeof r === 'object' ? r.id : r));
        });
    }

    for (const room of rooms) {
        if (!room || room.id == null) continue;
        const rw = room.walls;
        if (!Array.isArray(rw)) continue;
        if (rw.some((w) => String(typeof w === 'object' && w !== null ? w.id : w) === wallId)) {
            linkedIds.add(String(room.id));
        }
    }

    if (linkedIds.size === 0) {
        for (const room of rooms) {
            if (!room || room.id == null) continue;
            if (roomPolygonTouchesWallMm(room, wall, adjacencyToleranceMm)) {
                linkedIds.add(String(room.id));
            }
        }
    }
    if (linkedIds.size === 0) {
        const stripMm = Math.min(450, Math.max(180, (wall.thickness || 200) * 2.2));
        for (const room of rooms) {
            if (!room || room.id == null) continue;
            if (roomCentroidNearWallSegmentMm(room, wall, stripMm)) {
                linkedIds.add(String(room.id));
            }
        }
    }

    return rooms.filter((room) => room && room.id != null && linkedIds.has(String(room.id)));
}

/**
 * Pick inner offset using point-in-polygon on **linked** room outlines (fixes L-shaped rooms where
 * the global centroid lies on the wrong side of one edge, e.g. wall 7611).
 * @returns {boolean|null} `shouldFlip` for calculateOffsetPoints, or null if ambiguous / no data.
 */
function resolveInteriorShouldFlipFromPolygonProbes(wall, rooms, midX, midY, normalX, normalY) {
    const linked = getRoomsLinkedToWall(wall, rooms);
    const polys = linked
        .map((r) => normalizeRoomPolygonPoints(r.room_points))
        .filter((p) => p.length >= 3);
    if (!polys.length) return null;

    const probeDist = Math.min(80, Math.max(35, ((wall.thickness || 100) + 10) / 2));
    const pointInsideAny = (x, y) => polys.some((poly) => isPointInPolygon({ x, y }, poly));

    const insideMinusN = pointInsideAny(
        midX - probeDist * normalX,
        midY - probeDist * normalY
    );
    const insidePlusN = pointInsideAny(
        midX + probeDist * normalX,
        midY + probeDist * normalY
    );

    if (insideMinusN && !insidePlusN) return false;
    if (!insideMinusN && insidePlusN) return true;
    return null;
}

/**
 * Samples { x, y, w } for walls tied to rooms.
 * - Always unions `wall.rooms` with `room.walls` (previously an incomplete `wall.rooms` skipped `room.walls`).
 * - If still none, treats rooms whose boundary lies within `adjacencyToleranceMm` of the wall segment as adjacent (PDF/canvas often lack M2M).
 * - Weights by area × proximity to wall mid so a small pocket beats a large far room on the other side.
 *
 * @param {{ adjacencyToleranceMm?: number }} [options]
 */
export function getWallOffsetScoringSamples(wall, rooms, options) {
    if (!wall || !Array.isArray(rooms) || rooms.length === 0) return [];

    const linked = getRoomsLinkedToWall(wall, rooms, options);

    const wmidX = ((wall.start_x || 0) + (wall.end_x || 0)) / 2;
    const wmidY = ((wall.start_y || 0) + (wall.end_y || 0)) / 2;

    const samples = [];
    for (const room of linked) {
        let { centroid, area } = getRoomPolygonCentroidAndArea(room.room_points);
        if (!centroid) {
            const raw = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
            if (raw.length > 0) {
                centroid = {
                    x: raw.reduce((s, p) => s + p.x, 0) / raw.length,
                    y: raw.reduce((s, p) => s + p.y, 0) / raw.length,
                };
                area = 1;
            }
        }
        if (centroid) {
            const baseA = area > 1e-6 ? area : 1;
            const dist = Math.hypot(centroid.x - wmidX, centroid.y - wmidY);
            const proximity = 1 / ((dist + 150) * (dist + 150));
            samples.push({ x: centroid.x, y: centroid.y, w: baseA * proximity });
        }
    }
    return samples;
}

/** Nearest room centroid to the wall segment (local “interior” hint when M2M data is missing). */
function getNearestRoomCentroidToWallSegment(wall, rooms) {
    if (!wall || !Array.isArray(rooms) || rooms.length === 0) return null;
    const ax = wall.start_x ?? 0;
    const ay = wall.start_y ?? 0;
    const bx = wall.end_x ?? 0;
    const by = wall.end_y ?? 0;
    let best = null;
    let bestD = Infinity;
    for (const room of rooms) {
        if (!room) continue;
        let { centroid: c } = getRoomPolygonCentroidAndArea(room.room_points);
        if (!c) {
            const raw = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
            if (raw.length === 0) continue;
            c = {
                x: raw.reduce((s, p) => s + p.x, 0) / raw.length,
                y: raw.reduce((s, p) => s + p.y, 0) / raw.length,
            };
        }
        const dSq = pointToSegmentDistSq(c.x, c.y, ax, ay, bx, by);
        if (dSq < bestD) {
            bestD = dSq;
            best = c;
        }
    }
    return best;
}

/**
 * Options for `calculateOffsetPoints`: prefer room-weighted scoring, else nearest-room reference,
 * else undefined (caller uses plain `center` in calculateOffsetPoints).
 */
export function buildWallOffsetOptions(wall, rooms) {
    if (!wall) return undefined;
    const roomsList = Array.isArray(rooms) ? rooms : [];
    const base = { wall, rooms: roomsList };
    const scoringSamples = getWallOffsetScoringSamples(wall, roomsList);
    if (scoringSamples.length > 0) {
        base.scoringSamples = scoringSamples;
        return base;
    }
    const nearest = getNearestRoomCentroidToWallSegment(wall, roomsList);
    if (nearest) {
        base.innerReferencePoint = nearest;
    }
    return base;
}

/**
 * For shared walls, prefer the side indicated by connected 45_cut joints.
 * Returns `true|false` for shouldFlip, or null if no usable 45_cut context.
 */
export function resolve45CutForceShouldFlip(wall, intersections, allWalls) {
    if (!wall || !Array.isArray(intersections) || intersections.length === 0 || !Array.isArray(allWalls)) {
        return null;
    }
    let joinVecX = 0;
    let joinVecY = 0;
    let joinCount = 0;
    for (const inter of intersections) {
        const pairs = Array.isArray(inter.pairs)
            ? inter.pairs
            : [{ wall1: { id: inter.wall_1 }, wall2: { id: inter.wall_2 }, joining_method: inter.joining_method }];
        for (const pair of pairs) {
            if (!pair || pair.joining_method !== '45_cut') continue;
            const wall1Id = pair.wall1 && pair.wall1.id != null ? pair.wall1.id : inter.wall_1;
            const wall2Id = pair.wall2 && pair.wall2.id != null ? pair.wall2.id : inter.wall_2;
            if (wall1Id !== wall.id && wall2Id !== wall.id) continue;
            const otherWallId = wall1Id === wall.id ? wall2Id : wall1Id;
            const otherWall = allWalls.find((w) => w.id === otherWallId);
            if (!otherWall) continue;
            const wallMidX = (wall.start_x + wall.end_x) / 2;
            const wallMidY = (wall.start_y + wall.end_y) / 2;
            const otherMidX = (otherWall.start_x + otherWall.end_x) / 2;
            const otherMidY = (otherWall.start_y + otherWall.end_y) / 2;
            joinVecX += otherMidX - wallMidX;
            joinVecY += otherMidY - wallMidY;
            joinCount += 1;
        }
    }
    if (joinCount === 0) return null;
    const dx = wall.end_x - wall.start_x;
    const dy = wall.end_y - wall.start_y;
    const len = Math.hypot(dx, dy) || 1;
    const normalX = dy / len;
    const normalY = -dx / len;
    const joinDot = normalX * (joinVecX / joinCount) + normalY * (joinVecY / joinCount);
    return joinDot > 0;
}

/** Area-weighted centroid of rooms touching the wall; falls back to `center` if unknown. */
export function getWallOffsetFallbackReference(wall, rooms, center) {
    const samples = getWallOffsetScoringSamples(wall, rooms);
    if (!samples.length) {
        const n = getNearestRoomCentroidToWallSegment(wall, rooms);
        return n || center;
    }
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (const s of samples) {
        const w = s.w > 0 ? s.w : 1;
        sw += w;
        sx += s.x * w;
        sy += s.y * w;
    }
    if (sw <= 0) return center;
    return { x: sx / sw, y: sy / sw };
}

/**
 * @param {object} [offsetOptions]
 * @param {object} [offsetOptions.wall] — with `offsetOptions.rooms` enables polygon interior probe (overrides centroid heuristics when unambiguous)
 * @param {object[]} [offsetOptions.rooms]
 * @param {{ x: number, y: number, w?: number }[]} [offsetOptions.scoringSamples] — prefer flip that puts more weighted room mass on the inner half-plane
 * @param {{ x: number, y: number }} [offsetOptions.innerReferencePoint] — tie-break / fallback instead of `center`
 * @param {boolean} [offsetOptions.forceShouldFlip] — hard override for side selection (used by FloorCanvas 45_cut priority)
 */
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor, offsetOptions) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;

    const scoringSamples =
        offsetOptions && Array.isArray(offsetOptions.scoringSamples) && offsetOptions.scoringSamples.length > 0
            ? offsetOptions.scoringSamples
            : null;

    const scoreFlip = (shouldFlip) => {
        const finalOffsetX = shouldFlip ? -offsetX : offsetX;
        const finalOffsetY = shouldFlip ? -offsetY : offsetY;
        const ix = -finalOffsetX;
        const iy = -finalOffsetY;
        const ilen = Math.hypot(ix, iy) || 1;
        const inx = ix / ilen;
        const iny = iy / ilen;
        let weightSum = 0;
        let count = 0;
        for (const sample of scoringSamples) {
            const wx = sample.x - midX;
            const wy = sample.y - midY;
            const weight = sample.w != null && sample.w > 0 ? sample.w : 1;
            if (wx * inx + wy * iny > 0) {
                weightSum += weight;
                count += 1;
            }
        }
        return { weightSum, count };
    };

    let shouldFlip;
    const forcedFlip =
        offsetOptions && typeof offsetOptions.forceShouldFlip === 'boolean'
            ? offsetOptions.forceShouldFlip
            : null;
    const polygonResolved =
        offsetOptions &&
        offsetOptions.wall &&
        Array.isArray(offsetOptions.rooms) &&
        offsetOptions.rooms.length > 0
            ? resolveInteriorShouldFlipFromPolygonProbes(
                  offsetOptions.wall,
                  offsetOptions.rooms,
                  midX,
                  midY,
                  normalX,
                  normalY
              )
            : null;

    if (forcedFlip !== null) {
        shouldFlip = forcedFlip;
    } else if (polygonResolved !== null) {
        shouldFlip = polygonResolved;
    } else if (scoringSamples) {
        const aFalse = scoreFlip(false);
        const aTrue = scoreFlip(true);
        if (aTrue.weightSum > aFalse.weightSum) shouldFlip = true;
        else if (aFalse.weightSum > aTrue.weightSum) shouldFlip = false;
        else if (aTrue.count !== aFalse.count) shouldFlip = aTrue.count > aFalse.count;
        else {
            let ref = offsetOptions && offsetOptions.innerReferencePoint;
            if (!ref) {
                let sw = 0;
                let sx = 0;
                let sy = 0;
                for (const sample of scoringSamples) {
                    const wt = sample.w != null && sample.w > 0 ? sample.w : 1;
                    sw += wt;
                    sx += sample.x * wt;
                    sy += sample.y * wt;
                }
                if (sw > 0) ref = { x: sx / sw, y: sy / sw };
            }
            ref = ref || center;
            const dotProduct = normalX * (ref.x - midX) + normalY * (ref.y - midY);
            shouldFlip = dotProduct > 0;
        }
    } else {
        const ref = (offsetOptions && offsetOptions.innerReferencePoint) || center;
        const dotProduct = normalX * (ref.x - midX) + normalY * (ref.y - midY);
        shouldFlip = dotProduct > 0;
    }

    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX, y: y1 - finalOffsetY },
            { x: x2 - finalOffsetX, y: y2 - finalOffsetY },
        ],
    };
}

// Draw a pair of wall lines
export function drawWallLinePair(context, lines, scaleFactor, offsetX, offsetY, color, dashPattern = [], innerColor = null) {
    // If innerColor is provided and different from color, draw each line with different color
    // line1 (outer face) uses color, line2 (inner face) uses innerColor
    if (innerColor && innerColor !== color && lines.length >= 2) {
        // Draw outer face (line1) with outer color
        context.strokeStyle = color;
        context.lineWidth = DIMENSION_CONFIG.WALL_LINE_WIDTH;
        context.setLineDash(dashPattern);
        context.beginPath();
        context.moveTo(
            lines[0][0].x * scaleFactor + offsetX,
            lines[0][0].y * scaleFactor + offsetY
        );
        context.lineTo(
            lines[0][1].x * scaleFactor + offsetX,
            lines[0][1].y * scaleFactor + offsetY
        );
        context.stroke();
        
        // Draw inner face (line2) with inner color
        context.strokeStyle = innerColor;
        context.beginPath();
        context.moveTo(
            lines[1][0].x * scaleFactor + offsetX,
            lines[1][0].y * scaleFactor + offsetY
        );
        context.lineTo(
            lines[1][1].x * scaleFactor + offsetX,
            lines[1][1].y * scaleFactor + offsetY
        );
        context.stroke();
    } else {
        // Same material on both faces - use single color
        context.strokeStyle = color;
        context.lineWidth = DIMENSION_CONFIG.WALL_LINE_WIDTH;
        context.setLineDash(dashPattern);
        lines.forEach(line => {
            context.beginPath();
            context.moveTo(
                line[0].x * scaleFactor + offsetX,
                line[0].y * scaleFactor + offsetY
            );
            context.lineTo(
                line[1].x * scaleFactor + offsetX,
                line[1].y * scaleFactor + offsetY
            );
            context.stroke();
        });
    }
    context.setLineDash([]); // Reset dash
}

// Draw wall caps for double-line walls
export function drawWallCaps(context, wall, joints, center, intersections, SNAP_THRESHOLD, currentScaleFactor, offsetX, offsetY, scaleFactor) {
    if (!wall._line1 || !wall._line2) return;
    const endpoints = [
        { label: 'start', x: wall.start_x, y: wall.start_y },
        { label: 'end', x: wall.end_x, y: wall.end_y }
    ];
    endpoints.forEach((pt) => {
        // Find intersections involving this wall (by wall ID)
        const relevantIntersections = intersections.filter(inter => 
            inter.wall_1 === wall.id || inter.wall_2 === wall.id
        );

        let joiningMethod = 'butt_in';
        let isPrimaryWall = true;
        let joiningWall = null;
        relevantIntersections.forEach(inter => {
            if (inter.wall_1 === wall.id || inter.wall_2 === wall.id) {
                joiningMethod = inter.joining_method;
                if (inter.wall_2 === wall.id) {
                        isPrimaryWall = false;
                    joiningWall = { id: inter.wall_1 };
                    } else {
                    joiningWall = { id: inter.wall_2 };
                }
            }
        });

        if (joiningMethod === '45_cut' && !isPrimaryWall) {
            return; // Avoid drawing duplicate cap from other wall
        }
        const cap1 = pt.label === 'start' ? wall._line1[0] : wall._line1[1];
        const cap2 = pt.label === 'start' ? wall._line2[0] : wall._line2[1];
        if (joiningMethod === '45_cut' && joiningWall) {
            // Draw mitered cap at 45°
            const wallVec = pt.label === 'start'
                ? { x: wall.end_x - wall.start_x, y: wall.end_y - wall.start_y }
                : { x: wall.start_x - wall.end_x, y: wall.start_y - wall.end_y };
            let joinVec = null;
            if (Math.abs(joiningWall.start_x - pt.x) < 1e-3 && Math.abs(joiningWall.start_y - pt.y) < 1e-3) {
                joinVec = { x: joiningWall.end_x - joiningWall.start_x, y: joiningWall.end_y - joiningWall.start_y };
            } else {
                joinVec = { x: joiningWall.start_x - joiningWall.end_x, y: joiningWall.start_y - joiningWall.end_y };
            }
            const norm = v => {
                const len = Math.hypot(v.x, v.y);
                return len ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
            };
            const v1 = norm(wallVec);
            const v2 = norm(joinVec);
            const bisector = norm({ x: v1.x + v2.x, y: v1.y + v2.y });
            const capLength = wall.thickness * 1.5;
            context.beginPath();
            context.moveTo(
                cap1.x * scaleFactor + offsetX,
                cap1.y * scaleFactor + offsetY
            );
            context.lineTo(
                (cap1.x + bisector.x * capLength) * scaleFactor + offsetX,
                (cap1.y + bisector.y * capLength) * scaleFactor + offsetY
            );
            context.moveTo(
                cap2.x * scaleFactor + offsetX,
                cap2.y * scaleFactor + offsetY
            );
            context.lineTo(
                (cap2.x + bisector.x * capLength) * scaleFactor + offsetX,
                (cap2.y + bisector.y * capLength) * scaleFactor + offsetY
            );
            context.strokeStyle = 'red'; // For debugging 45_cut
            context.setLineDash([]);
            context.lineWidth = DIMENSION_CONFIG.WALL_CAP_LINE_WIDTH;
            context.stroke();
        } else {
            // Default: perpendicular cap (butt_in)
            context.beginPath();
            context.moveTo(
                cap1.x * scaleFactor + offsetX,
                cap1.y * scaleFactor + offsetY
            );
            context.lineTo(
                cap2.x * scaleFactor + offsetX,
                cap2.y * scaleFactor + offsetY
            );
            context.strokeStyle = 'black';
            context.setLineDash([]);
            context.lineWidth = DIMENSION_CONFIG.WALL_CAP_LINE_WIDTH;
            context.stroke();
        }
    });
}

// Build a unique key for wall finish + thickness combination
function getWallFinishKey(wall) {
    const intMat = wall.inner_face_material || 'PPGI';
    const intThk = wall.inner_face_thickness != null ? wall.inner_face_thickness : 0.5;
    const extMat = wall.outer_face_material || 'PPGI';
    const extThk = wall.outer_face_thickness != null ? wall.outer_face_thickness : 0.5;
    const coreThk = wall.thickness;
    return `${coreThk}|INT:${intThk} ${intMat}|EXT:${extThk} ${extMat}`;
}

// Generate distinct colors for combinations of (thickness + inner/outer finishes)
function generateThicknessColorMap(walls) {
    if (!walls || walls.length === 0) return new Map();

    // Collect unique combination keys (full wall specs)
    const keys = [...new Set(walls.map(getWallFinishKey))];
    
    
    // If only one combination, use default grayscale
    if (keys.length === 1) {
        const colorMap = new Map();
        const onlyKey = keys[0];
        const wall = walls.find(w => getWallFinishKey(w) === onlyKey);
        const hasDiffFaces = wall && 
            (wall.inner_face_material || 'PPGI') !== (wall.outer_face_material || 'PPGI');
        
        if (hasDiffFaces) {
            // Generate colors for inner and outer separately
            const innerHue = 200; // Blue-ish for inner
            const outerHue = 0; // Red-ish for outer
            colorMap.set(onlyKey, {
                wall: `hsl(${outerHue}, 70%, 35%)`,
                partition: `hsl(${outerHue}, 60%, 50%)`,
                innerWall: `hsl(${innerHue}, 70%, 35%)`,
                innerPartition: `hsl(${innerHue}, 60%, 50%)`,
                label: onlyKey,
                hasDifferentFaces: true
            });
        } else {
            colorMap.set(onlyKey, { wall: '#333', partition: '#666', label: onlyKey, hasDifferentFaces: false });
        }
        return colorMap;
    }

    // Assign distinct hues for each combination
    const colorMap = new Map();
    keys.forEach((key, index) => {
        const wall = walls.find(w => getWallFinishKey(w) === key);
        const hasDiffFaces = wall && 
            (wall.inner_face_material || 'PPGI') !== (wall.outer_face_material || 'PPGI');
        
        if (hasDiffFaces) {
            // Different materials - assign separate colors for inner and outer
            const hueOuter = (index * 360) / keys.length;
            const hueInner = ((index * 360) / keys.length + 180) % 360; // Opposite side of color wheel
            
            const wallColor = `hsl(${hueOuter}, 70%, 35%)`;
            const partitionColor = `hsl(${hueOuter}, 60%, 50%)`;
            const innerWallColor = `hsl(${hueInner}, 70%, 35%)`;
            const innerPartitionColor = `hsl(${hueInner}, 60%, 50%)`;
            
            const parts = key.split('|');
            const label = `${parts[0]}mm | ${parts[1].replace('INT:', 'Int: ')} | ${parts[2].replace('EXT:', 'Ext: ')}`;
            
            colorMap.set(key, {
                wall: wallColor,
                partition: partitionColor,
                innerWall: innerWallColor,
                innerPartition: innerPartitionColor,
                label,
                hasDifferentFaces: true
            });
        } else {
            // Same material on both faces
            const hue = (index * 360) / keys.length;
            const wallColor = `hsl(${hue}, 70%, 35%)`;
            const partitionColor = `hsl(${hue}, 60%, 50%)`;
            const parts = key.split('|');
            const label = `${parts[0]}mm | ${parts[1].replace('INT:', 'Int: ')} | ${parts[2].replace('EXT:', 'Ext: ')}`;
            colorMap.set(key, { wall: wallColor, partition: partitionColor, label, hasDifferentFaces: false });
        }
    });

    return colorMap;
}

// Draw all walls on the canvas
export function drawWalls({
    context,
    walls,
    highlightWalls,
    selectedWallsForRoom,
    selectedWall,
    hoveredWall,
    isEditingMode,
    joints,
    intersections,
    tempWall,
    snapToClosestPoint,
    scaleFactor,
    offsetX,
    offsetY,
    center,
    currentScaleFactor,
    SNAP_THRESHOLD,
    drawPartitionSlashes,
    hoveredPoint,
    drawWallLinePair,
    drawWallCaps,
    drawEndpoints,
    drawDimensions,
    wallPanelsMap, // <-- added
    drawPanelDivisions, // <-- added
    filteredDimensions, // <-- added for dimension filtering
    placedLabels = [], // <-- added for shared collision detection
    allLabels = [], // <-- added for shared collision detection
    dimensionVisibility = {},
    showPanelLines = false, // <-- added for panel lines visibility toggle
    initialScale = 1, // <-- added for proper zoom scaling from minimum
    dimensionValuesSeen = null, // <-- shared Set: skip drawing if value already shown (match floor/ceiling dedup)
    rooms = [] // room list for inner-face offset (wall.rooms / room.walls)
}) {
    if (!Array.isArray(walls) || !walls) return;
    
    const showWallDimensions = dimensionVisibility?.wall !== false;
    const showPanelDimensions = dimensionVisibility?.panel !== false;
    
    // Generate color map based on (thickness + inner/outer finishes)
    const thicknessColorMap = generateThicknessColorMap(walls);
    
    // Calculate model bounds for external dimensioning
    // Use project dimensions as the boundary to keep wall dimensions inside
    const actualDimensions = calculateActualProjectDimensions(walls);
    const modelBounds = walls.length > 0 ? {
        minX: actualDimensions.minX,
        maxX: actualDimensions.maxX,
        minY: actualDimensions.minY,
        maxY: actualDimensions.maxY
    } : null;
    
    // Use shared label arrays for collision detection (don't create new ones)
    // placedLabels and allLabels are passed as parameters
    const allPanelLabels = [];
    // Collect wall dimension specs so we can sort by length: smaller inner, larger outer when overlapping
    const wallDimensionSpecs = [];

    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall

    walls.forEach((wall) => {
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        const offsetOpts = buildWallOffsetOptions(wall, rooms) || {};
        const forcedFlip = resolve45CutForceShouldFlip(wall, intersections, walls);
        if (typeof forcedFlip === 'boolean') {
            offsetOpts.forceShouldFlip = forcedFlip;
        }

        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor,
            offsetOpts
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
    
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        const tolerance = SNAP_THRESHOLD / currentScaleFactor;
        
        // Find all walls that meet at this intersection
        const wallsAtIntersection = [];
        
        walls.forEach(wall => {
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            // Check if intersection point lies on the wall body (not just at endpoints)
            // Only mark as isOnBody if it's clearly in the middle, not near endpoints
            let isOnBody = false;
            if (!isAtStart && !isAtEnd) {
                const dx = wall.end_x - wall.start_x;
                const dy = wall.end_y - wall.start_y;
                const wallLength = Math.hypot(dx, dy);
                
                if (wallLength > 0) {
                    // Vector from wall start to intersection point
                    const toInterX = inter.x - wall.start_x;
                    const toInterY = inter.y - wall.start_y;
                    
                    // Project intersection point onto wall direction
                    const wallDirX = dx / wallLength;
                    const wallDirY = dy / wallLength;
                    const projectionLength = toInterX * wallDirX + toInterY * wallDirY;
                    
                    // Perpendicular distance from intersection to wall line
                    const perpX = toInterX - projectionLength * wallDirX;
                    const perpY = toInterY - projectionLength * wallDirY;
                    const perpDistance = Math.hypot(perpX, perpY);
                    
                    // Check if point is on the wall segment and within tolerance
                    // Also check that it's not too close to endpoints (account for floating point precision)
                    const distanceFromStart = projectionLength;
                    const distanceFromEnd = wallLength - projectionLength;
                    const isNearEndpoint = distanceFromStart < tolerance * 2 || distanceFromEnd < tolerance * 2;
                    
                    if (projectionLength >= -tolerance && projectionLength <= wallLength + tolerance && 
                        perpDistance < tolerance && !isNearEndpoint) {
                        isOnBody = true;
                    }
                }
            }
            
            if (isAtStart || isAtEnd || isOnBody) {
                const wallData = wallLinesMap.get(wall.id);
                if (wallData) {
                    wallsAtIntersection.push({
                        wall,
                        wallData,
                        isAtStart,
                        isAtEnd,
                        isOnBody
                    });
                }
            }
        });
        
        // Process intersections with 2 or more walls
        if (wallsAtIntersection.length >= 2) {
            // Find all vertical-horizontal pairs at this intersection
            const vhPairs = [];
            
            for (let i = 0; i < wallsAtIntersection.length; i++) {
                for (let j = i + 1; j < wallsAtIntersection.length; j++) {
                    const wall1Data = wallsAtIntersection[i];
                    const wall2Data = wallsAtIntersection[j];
                    const wall1 = wall1Data.wall;
                    const wall2 = wall2Data.wall;
                    
                    // Determine if one is vertical and one is horizontal
                    const wall1Dx = wall1.end_x - wall1.start_x;
                    const wall1Dy = wall1.end_y - wall1.start_y;
                    const wall2Dx = wall2.end_x - wall2.start_x;
                    const wall2Dy = wall2.end_y - wall2.start_y;
                    
                    const wall1IsVertical = Math.abs(wall1Dx) < Math.abs(wall1Dy);
                    const wall2IsVertical = Math.abs(wall2Dx) < Math.abs(wall2Dy);
                    
                    // Only process if one is vertical and one is horizontal
                    if (wall1IsVertical !== wall2IsVertical) {
                        const verticalWall = wall1IsVertical ? wall1Data : wall2Data;
                        const horizontalWall = wall1IsVertical ? wall2Data : wall1Data;
                        
                        // Find joint type for this pair
                        let joiningMethod = null;
                        let jointWall1Id = null;
                        let jointWall2Id = null;
                        
                        if (inter.pairs && Array.isArray(inter.pairs)) {
                            inter.pairs.forEach(pair => {
                                // Handle both object format { id: ... } and direct ID format
                                const pairWall1Id = typeof pair.wall1 === 'object' ? (pair.wall1?.id ?? pair.wall1) : pair.wall1;
                                const pairWall2Id = typeof pair.wall2 === 'object' ? (pair.wall2?.id ?? pair.wall2) : pair.wall2;
                                
                                // Convert to strings for comparison to handle number/string mismatches
                                const vWallIdStr = String(verticalWall.wall.id);
                                const hWallIdStr = String(horizontalWall.wall.id);
                                const pairWall1IdStr = String(pairWall1Id);
                                const pairWall2IdStr = String(pairWall2Id);
                                
                                const matchesVertical = (pairWall1IdStr === vWallIdStr || pairWall2IdStr === vWallIdStr);
                                const matchesHorizontal = (pairWall1IdStr === hWallIdStr || pairWall2IdStr === hWallIdStr);
                                
                                if (matchesVertical && matchesHorizontal) {
                                    joiningMethod = pair.joining_method || 'none';
                                    jointWall1Id = pairWall1Id;
                                    jointWall2Id = pairWall2Id;
                                }
                            });
                        }
                        
                        // If no joint method found, default to 'none' (extension only, no shortening)
                        if (!joiningMethod) {
                            joiningMethod = 'none';
                        }
                        
                        // Always process intersections (for extension), but only shorten for butt_in
                        vhPairs.push({
                            verticalWall,
                            horizontalWall,
                            joiningMethod,
                            jointWall1Id,
                            jointWall2Id
                        });
                    }
                }
            }

            // Two passes over all V–H pairs: extends first, then shortens (butt-in). Avoids dropping
            // valid pairs at 3-wall T-junctions while keeping extend-before-shorten order globally.
            const runVhPairPhase = (phase) => {
            vhPairs.forEach(pairData => {
                const { verticalWall, horizontalWall, joiningMethod, jointWall1Id, jointWall2Id } = pairData;
                
                const vWall = verticalWall.wall;
                const hWall = horizontalWall.wall;
                const vLines = verticalWall.wallData;
                const hLines = horizontalWall.wallData;
                
                // Determine which end of vertical wall is at intersection
                // If intersection is on body, determine which endpoint is closer
                let vIsAtStart = verticalWall.isAtStart;
                if (verticalWall.isOnBody) {
                    const distToStart = Math.hypot(inter.x - vWall.start_x, inter.y - vWall.start_y);
                    const distToEnd = Math.hypot(inter.x - vWall.end_x, inter.y - vWall.end_y);
                    vIsAtStart = distToStart < distToEnd;
                }
                
                // Determine which end of horizontal wall is at intersection
                // If intersection is on body, determine which endpoint is closer
                let hIsAtStart = horizontalWall.isAtStart;
                if (horizontalWall.isOnBody) {
                    const distToStart = Math.hypot(inter.x - hWall.start_x, inter.y - hWall.start_y);
                    const distToEnd = Math.hypot(inter.x - hWall.end_x, inter.y - hWall.end_y);
                    hIsAtStart = distToStart < distToEnd;
                }
                
                const hasButtIn = joiningMethod === 'butt_in';
                
                // For vertical wall: extend to upper/lower line of horizontal
                // Determine which line of horizontal is upper and which is lower
                const hLine1Y = (hLines.line1[0].y + hLines.line1[1].y) / 2;
                const hLine2Y = (hLines.line2[0].y + hLines.line2[1].y) / 2;
                const hUpperLine = hLine1Y < hLine2Y ? hLines.line1 : hLines.line2;
                const hLowerLine = hLine1Y < hLine2Y ? hLines.line2 : hLines.line1;
                
                // Determine which end of vertical is joining (top or bottom)
                // Top = smaller Y, Bottom = larger Y
                const vEndpointY = vIsAtStart ? vWall.start_y : vWall.end_y;
                const vOtherY = vIsAtStart ? vWall.end_y : vWall.start_y;
                const isTopEnd = vEndpointY < vOtherY;
                
                if (hasButtIn) {
                    // BUTT-IN JOINT: First extend wall2, then shorten wall1
                    // wall1 is the one that should be shortened visually (first wall in the joint pair)
                    // wall2 should be extended (remains extended)
                    // Determine which wall is wall1 and which is wall2 based on joint definition
                    // Use string comparison to handle number/string ID mismatches
                    const isVerticalWall1 = String(jointWall1Id) === String(vWall.id);
                    const isHorizontalWall1 = String(jointWall1Id) === String(hWall.id);

                    if (phase === 'extend') {
                    // First, extend wall2 (the one that should remain extended)
                    // Case A: Vertical is wall2, Horizontal is wall1
                    // Only extend wall2 if the intersection is at an actual endpoint of wall2
                    // If wall2 is intersected in the middle (isOnBody), skip extension (it should remain full length)
                    if (isHorizontalWall1 && !isVerticalWall1 && !verticalWall.isOnBody) {
                        // Extend vertical wall (wall2) to horizontal wall's line
                        const vEndpointYCaseA = vIsAtStart ? vWall.start_y : vWall.end_y;
                        const vOtherYCaseA = vIsAtStart ? vWall.end_y : vWall.start_y;
                        const isTopEndCaseA = vEndpointYCaseA < vOtherYCaseA;
                        let targetY;
                        if (isTopEndCaseA) {
                            // Top end -> extend to upper line
                            const hUpperStartX = hUpperLine[0].x;
                            const hUpperStartY = hUpperLine[0].y;
                            const hUpperEndX = hUpperLine[1].x;
                            const hUpperEndY = hUpperLine[1].y;
                            const hUpperDx = hUpperEndX - hUpperStartX;
                            const hUpperDy = hUpperEndY - hUpperStartY;
                            if (Math.abs(hUpperDx) > 0.001) {
                                const t = (inter.x - hUpperStartX) / hUpperDx;
                                targetY = hUpperStartY + t * hUpperDy;
                            } else {
                                targetY = hUpperStartY;
                            }
                        } else {
                            // Bottom end -> extend to lower line
                            const hLowerStartX = hLowerLine[0].x;
                            const hLowerStartY = hLowerLine[0].y;
                            const hLowerEndX = hLowerLine[1].x;
                            const hLowerEndY = hLowerLine[1].y;
                            const hLowerDx = hLowerEndX - hLowerStartX;
                            const hLowerDy = hLowerEndY - hLowerStartY;
                            if (Math.abs(hLowerDx) > 0.001) {
                                const t = (inter.x - hLowerStartX) / hLowerDx;
                                targetY = hLowerStartY + t * hLowerDy;
                            } else {
                                targetY = hLowerStartY;
                            }
                        }
                        
                        // Extend vertical wall (wall2) lines to horizontal wall's line
                        if (vIsAtStart) {
                            vLines.line1[0].y = targetY;
                            vLines.line2[0].y = targetY;
                        } else {
                            vLines.line1[1].y = targetY;
                            vLines.line2[1].y = targetY;
                        }
                    }
                    // Case B: Horizontal is wall2, Vertical is wall1
                    // Only extend wall2 if the intersection is at an actual endpoint of wall2
                    // If wall2 is intersected in the middle (isOnBody), skip extension (it should remain full length)
                    else if (isVerticalWall1 && !isHorizontalWall1 && !horizontalWall.isOnBody) {
                        // Extend horizontal wall (wall2) to vertical wall's line
                        const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                        const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                        const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                        const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                        
                        const hMidX = (hWall.start_x + hWall.end_x) / 2;
                        const vIntersectionX = inter.x;
                        const isHorizontalOnLeft = hMidX < vIntersectionX;
                        
                        let targetX;
                        if (isHorizontalOnLeft) {
                            // Horizontal on LEFT of vertical -> extend to RIGHTMOST line (opposite side)
                            const vRightStartX = vRightmostLine[0].x;
                            const vRightStartY = vRightmostLine[0].y;
                            const vRightEndX = vRightmostLine[1].x;
                            const vRightEndY = vRightmostLine[1].y;
                            const vRightDx = vRightEndX - vRightStartX;
                            const vRightDy = vRightEndY - vRightStartY;
                            if (Math.abs(vRightDy) > 0.001) {
                                const t = (inter.y - vRightStartY) / vRightDy;
                                targetX = vRightStartX + t * vRightDx;
                            } else {
                                targetX = vRightStartX;
                            }
                        } else {
                            // Horizontal on RIGHT of vertical -> extend to LEFTMOST line (opposite side)
                            const vLeftStartX = vLeftmostLine[0].x;
                            const vLeftStartY = vLeftmostLine[0].y;
                            const vLeftEndX = vLeftmostLine[1].x;
                            const vLeftEndY = vLeftmostLine[1].y;
                            const vLeftDx = vLeftEndX - vLeftStartX;
                            const vLeftDy = vLeftEndY - vLeftStartY;
                            if (Math.abs(vLeftDy) > 0.001) {
                                const t = (inter.y - vLeftStartY) / vLeftDy;
                                targetX = vLeftStartX + t * vLeftDx;
                            } else {
                                targetX = vLeftStartX;
                            }
                        }
                        
                        // Extend horizontal wall (wall2) lines to vertical wall's line
                        if (hIsAtStart) {
                            hLines.line1[0].x = targetX;
                            hLines.line2[0].x = targetX;
                        } else {
                            hLines.line1[1].x = targetX;
                            hLines.line2[1].x = targetX;
                        }
                    }
                    }

                    if (phase === 'shorten') {
                    // Now shorten wall1 to connect to wall2
                    // Only shorten wall1 if the intersection is at an actual endpoint of wall1
                    // If wall1 is intersected in the middle (isOnBody), skip shortening (it should remain full length)
                    // Case 1: Vertical is wall1, Horizontal is wall2
                    if (isVerticalWall1 && !isHorizontalWall1 && !verticalWall.isOnBody) {
                        // Use geometry at the intersection (nearest endpoint) so stem direction — and thus
                        // which horizontal edge is the inner face — is not flipped when wall1/2 flags disagree.
                        const distJointToStart = Math.hypot(inter.x - vWall.start_x, inter.y - vWall.start_y);
                        const distJointToEnd = Math.hypot(inter.x - vWall.end_x, inter.y - vWall.end_y);
                        const jointAtVerticalStart = distJointToStart < distJointToEnd;
                        const jointY = jointAtVerticalStart ? vWall.start_y : vWall.end_y;
                        const otherVerticalY = jointAtVerticalStart ? vWall.end_y : vWall.start_y;
                        const horizontalOnTopAtButtIn = otherVerticalY > jointY;

                        // Determine target line based on horizontal wall (wall2) position relative to intersection
                        // If horizontal (wall2) is on top → vertical (wall1) should connect to bottom line of wall2
                        // If horizontal (wall2) is at bottom → vertical (wall1) should connect to upper line of wall2
                        let targetLine;
                        let targetY;
                        
                        if (horizontalOnTopAtButtIn) {
                            // Horizontal wall2 is on top, vertical wall1 should connect to bottom line of wall2
                            targetLine = hLowerLine;
                        } else {
                            // Horizontal wall2 is at bottom, vertical wall1 should connect to upper line of wall2
                            targetLine = hUpperLine;
                        }
                        
                        // Get Y from target line (horizontal wall, so Y is constant)
                        // For butt-in joint: wall1 should connect to wall2's inner face
                        // The targetLine (hLowerLine or hUpperLine) is already the inner face of wall2
                        // So we just connect to that line directly - no additional shortening needed
                        targetY = targetLine[0].y; // Y coordinate is constant for horizontal wall
                        
                        // Shorten vertical wall (wall1) visually by moving both lines to target line
                        // This creates the visual effect of the wall being shortened to connect to wall2
                        // For vertical walls, we only modify Y coordinate, keeping X coordinates to maintain vertical orientation
                        // Ensure both lines are modified by directly accessing the arrays
                        const vLine1Endpoint = jointAtVerticalStart ? vLines.line1[0] : vLines.line1[1];
                        const vLine2Endpoint = jointAtVerticalStart ? vLines.line2[0] : vLines.line2[1];
                        
                        vLine1Endpoint.y = targetY;
                        vLine2Endpoint.y = targetY;
                        
                        // Keep X coordinates unchanged to maintain wall thickness
                    }
                    // Case 2: Horizontal is wall1, Vertical is wall2
                    // Only shorten wall1 if the intersection is at an actual endpoint of wall1
                    // If wall1 is intersected in the middle (isOnBody), skip shortening (it should remain full length)
                    else if (isHorizontalWall1 && !isVerticalWall1 && !horizontalWall.isOnBody) {
                        // Determine which line of vertical (wall2) to connect to
                        const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                        const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                        const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                        const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                        
                        // Determine which side of the horizontal wall the vertical wall (wall2) is on
                        // Compare vertical wall's X position with horizontal wall's midpoint X
                        // Since vertical wall's X is approximately constant, use intersection X (where they meet)
                        const vIntersectionX = inter.x;
                        const hMidX = (hWall.start_x + hWall.end_x) / 2;
                        const isVerticalOnLeft = vIntersectionX < hMidX; // Vertical wall2 is on left side of horizontal
                        const isVerticalOnRight = vIntersectionX > hMidX; // Vertical wall2 is on right side of horizontal
                        
                        // Determine target line based on vertical wall position relative to horizontal
                        // If vertical is on LEFT of horizontal → horizontal should connect to RIGHT line of vertical
                        // If vertical is on RIGHT of horizontal → horizontal should connect to LEFT line of vertical
                        let targetVLine;
                        let baseTargetX;
                        
                        if (isVerticalOnLeft) {
                            // Vertical is on LEFT of horizontal, horizontal wall1 should connect to RIGHT line of vertical wall2
                            targetVLine = vRightmostLine;
                        } else if (isVerticalOnRight) {
                            // Vertical is on RIGHT of horizontal, horizontal wall1 should connect to LEFT line of vertical wall2
                            targetVLine = vLeftmostLine;
                        } else {
                            // Default to right line if ambiguous (vertical aligns with horizontal center)
                            targetVLine = vRightmostLine;
                        }
                        
                        // Get X from target vertical line at intersection Y
                        // For butt-in joint: wall1 should connect to wall2's inner face
                        // The targetVLine (vLeftmostLine or vRightmostLine) is already the inner face of wall2
                        // So we just connect to that line directly - no additional shortening needed
                        const targetVStartX = targetVLine[0].x;
                        const targetVStartY = targetVLine[0].y;
                        const targetVEndX = targetVLine[1].x;
                        const targetVEndY = targetVLine[1].y;
                        const targetVDx = targetVEndX - targetVStartX;
                        const targetVDy = targetVEndY - targetVStartY;
                        let targetX;
                        if (Math.abs(targetVDy) > 0.001) {
                            const t = (inter.y - targetVStartY) / targetVDy;
                            targetX = targetVStartX + t * targetVDx;
                        } else {
                            targetX = targetVStartX;
                        }
                        
                        // Shorten horizontal wall (wall1) visually
                        // This creates the visual effect of the wall being shortened to connect to wall2
                        // For horizontal walls, we only modify X coordinate, keeping Y coordinates to maintain horizontal orientation
                        // Ensure both lines are modified by directly accessing the arrays
                        const hLine1Endpoint = hIsAtStart ? hLines.line1[0] : hLines.line1[1];
                        const hLine2Endpoint = hIsAtStart ? hLines.line2[0] : hLines.line2[1];
                        
                        hLine1Endpoint.x = targetX;
                        hLine2Endpoint.x = targetX;
                        
                        // Keep Y coordinates unchanged to maintain wall thickness
                    }
                    }
                } else {
                    if (phase === 'extend') {
                    // NOT butt-in: Extend walls normally (existing logic)
                    // Calculate intersection point on horizontal line
                    // Project intersection point onto horizontal line to get exact Y coordinate
                    // Get Y coordinate from the appropriate horizontal line at intersection X
                    let targetY;
                    if (isTopEnd) {
                        // Top end -> extend to upper line
                        // Get Y from upper line at intersection X
                        const hUpperStartX = hUpperLine[0].x;
                        const hUpperStartY = hUpperLine[0].y;
                        const hUpperEndX = hUpperLine[1].x;
                        const hUpperEndY = hUpperLine[1].y;
                        const hUpperDx = hUpperEndX - hUpperStartX;
                        const hUpperDy = hUpperEndY - hUpperStartY;
                        if (Math.abs(hUpperDx) > 0.001) {
                            const t = (inter.x - hUpperStartX) / hUpperDx;
                            targetY = hUpperStartY + t * hUpperDy;
                        } else {
                            targetY = hUpperStartY; // Vertical line, use start Y
                        }
                    } else {
                        // Bottom end -> extend to lower line
                        // Get Y from lower line at intersection X
                        const hLowerStartX = hLowerLine[0].x;
                        const hLowerStartY = hLowerLine[0].y;
                        const hLowerEndX = hLowerLine[1].x;
                        const hLowerEndY = hLowerLine[1].y;
                        const hLowerDx = hLowerEndX - hLowerStartX;
                        const hLowerDy = hLowerEndY - hLowerStartY;
                        if (Math.abs(hLowerDx) > 0.001) {
                            const t = (inter.x - hLowerStartX) / hLowerDx;
                            targetY = hLowerStartY + t * hLowerDy;
                        } else {
                            targetY = hLowerStartY; // Vertical line, use start Y
                        }
                    }
                    
                    // Extend vertical wall lines to horizontal wall's line
                    // Only extend if intersection is at an endpoint (not in the middle)
                    if (!verticalWall.isOnBody) {
                        if (vIsAtStart) {
                            vLines.line1[0].y = targetY;
                            vLines.line2[0].y = targetY;
                        } else {
                            vLines.line1[1].y = targetY;
                            vLines.line2[1].y = targetY;
                        }
                    }
                    
                    // For horizontal wall: extend to leftmost/rightmost line of vertical
                    // Determine which line of vertical is leftmost and which is rightmost
                    const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                    const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                    const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                    const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                    
                    // Determine which SIDE of the vertical wall the horizontal wall is on
                    // Compare horizontal wall midpoint X with vertical wall X at intersection
                    const hMidX = (hWall.start_x + hWall.end_x) / 2;
                    const vIntersectionX = inter.x;
                    const isHorizontalOnLeft = hMidX < vIntersectionX;
                    
                    // Calculate intersection point on vertical line
                    // Project intersection point onto vertical line to get exact X coordinate
                    let targetX;
                    if (isHorizontalOnLeft) {
                        // Horizontal on LEFT of vertical -> extend to RIGHTMOST line (opposite side)
                        // Get X from rightmost line at intersection Y
                        const vRightStartX = vRightmostLine[0].x;
                        const vRightStartY = vRightmostLine[0].y;
                        const vRightEndX = vRightmostLine[1].x;
                        const vRightEndY = vRightmostLine[1].y;
                        const vRightDx = vRightEndX - vRightStartX;
                        const vRightDy = vRightEndY - vRightStartY;
                        if (Math.abs(vRightDy) > 0.001) {
                            const t = (inter.y - vRightStartY) / vRightDy;
                            targetX = vRightStartX + t * vRightDx;
                        } else {
                            targetX = vRightStartX; // Horizontal line, use start X
                        }
                    } else {
                        // Horizontal on RIGHT of vertical -> extend to LEFTMOST line (opposite side)
                        // Get X from leftmost line at intersection Y
                        const vLeftStartX = vLeftmostLine[0].x;
                        const vLeftStartY = vLeftmostLine[0].y;
                        const vLeftEndX = vLeftmostLine[1].x;
                        const vLeftEndY = vLeftmostLine[1].y;
                        const vLeftDx = vLeftEndX - vLeftStartX;
                        const vLeftDy = vLeftEndY - vLeftStartY;
                        if (Math.abs(vLeftDy) > 0.001) {
                            const t = (inter.y - vLeftStartY) / vLeftDy;
                            targetX = vLeftStartX + t * vLeftDx;
                        } else {
                            targetX = vLeftStartX; // Horizontal line, use start X
                        }
                    }
                    
                    // Extend horizontal wall lines to vertical wall's line
                    // Only extend if intersection is at an endpoint (not in the middle)
                    if (!horizontalWall.isOnBody) {
                        if (hIsAtStart) {
                            hLines.line1[0].x = targetX;
                            hLines.line2[0].x = targetX;
                        } else {
                            hLines.line1[1].x = targetX;
                            hLines.line2[1].x = targetX;
                        }
                    }
                    }
                }
            });
            };
            runVhPairPhase('extend');
            runVhPairPhase('shorten');
        }
    });
    
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        const highlight = highlightWalls.find(h => h.id === wall.id);
        
        // Get color for this wall's combination
        const comboKey = getWallFinishKey(wall);
        const thicknessColors = thicknessColorMap.get(comboKey) || { wall: '#333', partition: '#666', hasDifferentFaces: false };
        const hasDiffFaces = thicknessColors.hasDifferentFaces;
        
        // Check if inner and outer materials are actually different
        const intMat = wall.inner_face_material || 'PPGI';
        const extMat = wall.outer_face_material || 'PPGI';
        const actuallyHasDiffFaces = hasDiffFaces && (intMat !== extMat);
        
        const baseColor = wall.application_type === "partition" ? thicknessColors.partition : thicknessColors.wall;
        const baseInnerColor = actuallyHasDiffFaces 
            ? (wall.application_type === "partition" ? thicknessColors.innerPartition : thicknessColors.innerWall)
            : null;
        
        const wallColor =
            highlight ? highlight.color :
            selectedWallsForRoom.includes(wall.id) ? '#4CAF50' :
            selectedWall === wall.id ? 'red' :
            hoveredWall === wall.id ? '#2196F3' :
            baseColor;
        
        // Inner color (only used if materials differ)
        const innerColor = actuallyHasDiffFaces && !highlight && 
            !selectedWallsForRoom.includes(wall.id) && 
            selectedWall !== wall.id && 
            hoveredWall !== wall.id
            ? baseInnerColor
            : null;
        // Get pre-calculated lines (already extended to intersections)
        let { line1, line2 } = wallLinesMap.get(wall.id);
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // We need to determine which line (left or right) to shorten at each end
        const wallDx = wall.end_x - wall.start_x;
        const wallDy = wall.end_y - wall.start_y;
        const wallLength = Math.hypot(wallDx, wallDy);
        const wallDirX = wallLength > 0 ? wallDx / wallLength : 0;
        const wallDirY = wallLength > 0 ? wallDy / wallLength : 0;
        
        // Determine which line is left and which is right by comparing positions
        const isVertical = Math.abs(wallDx) < Math.abs(wallDy);
        
        // Compare line positions at midpoint
        const line1MidX = (line1[0].x + line1[1].x) / 2;
        const line1MidY = (line1[0].y + line1[1].y) / 2;
        const line2MidX = (line2[0].x + line2[1].x) / 2;
        const line2MidY = (line2[0].y + line2[1].y) / 2;
        
        // Determine which line is on left vs right
        let line1IsLeft;
        if (isVertical) {
            // For vertical walls, left = smaller X
            line1IsLeft = line1MidX < line2MidX;
        } else {
            // For horizontal walls, determine left based on wall direction
            if (wallDirX > 0) {
                line1IsLeft = line1MidY < line2MidY;
            } else {
                line1IsLeft = line1MidY > line2MidY;
            }
        }
        
        // Check start end for 45° cut
        let startHas45 = false;
        let startIsOnLeftSide = false;
        
        // Check end end for 45° cut
        let endHas45 = false;
        let endIsOnLeftSide = false;
        
        // Check each intersection to find 45° cuts at each endpoint
        intersections.forEach(inter => {
            const tolerance = SNAP_THRESHOLD / currentScaleFactor;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                
                if (has45Cut && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        
                        if (isAtStart) {
                            startHas45 = true;
                            // Determine which side (left or right) the joining wall is on
                            if (isVertical) {
                                startIsOnLeftSide = joinMidX < wall.start_x;
                            } else {
                                if (wallDirX > 0) {
                                    startIsOnLeftSide = joinMidY < wall.start_y;
                                } else {
                                    startIsOnLeftSide = joinMidY > wall.start_y;
                                }
                            }
                        } else if (isAtEnd) {
                            endHas45 = true;
                            // Determine which side (left or right) the joining wall is on
                            if (isVertical) {
                                endIsOnLeftSide = joinMidX < wall.end_x;
                            } else {
                                if (wallDirX > 0) {
                                    endIsOnLeftSide = joinMidY < wall.end_y;
                                } else {
                                    endIsOnLeftSide = joinMidY > wall.end_y;
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // Apply 45° cut shortening at each end independently
        // Shorten by wall thickness to match the visual gap
        const wallThickness = wall.thickness || 100; // Default to 100mm if not set
        const finalAdjust = wallThickness; // Shorten by wall thickness
        
        // Make copies of lines for modification
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Shorten at START end
        if (startHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (startIsOnLeftSide) {
                // Shorten left line at start
                if (line1IsLeft) {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                } else {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at start
                if (line1IsLeft) {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                } else {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                }
            }
        }
        
        // Shorten at END end
        if (endHas45) {
            // If joining wall is on LEFT side, shorten the LEFT line
            // If joining wall is on RIGHT side, shorten the RIGHT line
            if (endIsOnLeftSide) {
                // Shorten left line at end
                if (line1IsLeft) {
                    line1[1].x -= wallDirX * finalAdjust;
                    line1[1].y -= wallDirY * finalAdjust;
                } else {
                    line2[1].x -= wallDirX * finalAdjust;
                    line2[1].y -= wallDirY * finalAdjust;
                }
            } else {
                // Shorten right line at end
                if (line1IsLeft) {
                    line2[1].x -= wallDirX * finalAdjust;
                    line2[1].y -= wallDirY * finalAdjust;
                } else {
                    line1[1].x -= wallDirX * finalAdjust;
                    line1[1].y -= wallDirY * finalAdjust;
                }
            }
        }

        // Final role enforcement: ensure line2 (inner) is on forced 45_cut side.
        const forcedFlip = resolve45CutForceShouldFlip(wall, intersections, walls);
        if (typeof forcedFlip === 'boolean') {
            const len = Math.hypot(wallDx, wallDy) || 1;
            const normalX = wallDy / len;
            const normalY = -wallDx / len;
            const wallMidX = (wall.start_x + wall.end_x) / 2;
            const wallMidY = (wall.start_y + wall.end_y) / 2;
            const line2MidXNow = (line2[0].x + line2[1].x) / 2;
            const line2MidYNow = (line2[0].y + line2[1].y) / 2;
            const line2Dot = normalX * (line2MidXNow - wallMidX) + normalY * (line2MidYNow - wallMidY);
            const line2IsPositiveSide = line2Dot > 0;
            if (line2IsPositiveSide !== forcedFlip) {
                const tmp = line1;
                line1 = line2;
                line2 = tmp;
            }
        }
        wall._line1 = line1;
        wall._line2 = line2;
        drawWallLinePair(context, [line1, line2], scaleFactor, offsetX, offsetY, wallColor, [], innerColor);
        drawWallCaps(context, wall, joints, center, intersections, SNAP_THRESHOLD, currentScaleFactor, offsetX, offsetY, scaleFactor);
        if (wall.application_type === "partition") {
            drawPartitionSlashes(context, line1, line2, scaleFactor, offsetX, offsetY);
        }
        // --- Draw panel divisions here (collect panel label info) ---
        if (showPanelLines && wallPanelsMap && drawPanelDivisions) {
            const panels = wallPanelsMap[wall.id];
            if (panels && panels.length > 0) {
                // Calculate gap in pixels based on wall thickness for panel divisions
                const wallThickness = wall.thickness || 100; // Default to 100mm if not set
                const gapPixels = (wallThickness * scaleFactor);
                
                drawPanelDivisions(
                    context,
                    wall,
                    panels,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    undefined,
                    gapPixels,
                    modelBounds,
                    placedLabels,
                    allPanelLabels,
                    true,
                    filteredDimensions,
                    showPanelDimensions
                );
            }
        }
        // --- End panel divisions ---
        if (isEditingMode) {
            const endpointColor = selectedWall === wall.id ? 'red' : '#2196F3';
            drawEndpoints(context, wall.start_x, wall.start_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor);
            drawEndpoints(context, wall.end_x, wall.end_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor);
        }
        // Collect wall dimension spec for sort-then-draw (smaller value inner, larger outer)
        if (showWallDimensions && (!filteredDimensions || shouldShowWallDimension(wall, intersections, filteredDimensions.wallDimensions, walls))) {
            const length = Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y);
            wallDimensionSpecs.push({
                startX: wall.start_x,
                startY: wall.start_y,
                endX: wall.end_x,
                endY: wall.end_y,
                color: selectedWall === wall.id ? 'red' : '#2196F3',
                modelBounds,
                wallLinesMap,
                length
            });
        }
        if (isEditingMode) {
            intersections.forEach((inter) => {
                drawEndpoints(
                    context,
                    inter.x,
                    inter.y,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    hoveredPoint,
                    '#FF9800',
                    6
                );
            });
        }
    });
    // Draw temporary wall while adding wall (skip label collection for temp wall)
    if (tempWall) {
        // Calculate gap in pixels based on wall thickness for temp wall
        const tempWallThickness = tempWall.thickness || 100; // Default to 100mm if not set
        const tempGapPixels = (tempWallThickness * scaleFactor) / 2;
        const tempOffsetOpts = buildWallOffsetOptions(tempWall, rooms);

        const { line1, line2 } = calculateOffsetPoints(
            tempWall.start_x,
            tempWall.start_y,
            tempWall.end_x,
            tempWall.end_y,
            tempGapPixels,
            center,
            scaleFactor,
            tempOffsetOpts
        );
        drawWallLinePair(context, [line1, line2], scaleFactor, offsetX, offsetY, '#4CAF50', [5, 5]);
        drawEndpoints(context, tempWall.start_x, tempWall.start_y, scaleFactor, offsetX, offsetY, hoveredPoint, '#4CAF50');
        drawEndpoints(context, tempWall.end_x, tempWall.end_y, scaleFactor, offsetX, offsetY, hoveredPoint, '#4CAF50');
        if (showWallDimensions) {
            const length = Math.hypot(tempWall.end_x - tempWall.start_x, tempWall.end_y - tempWall.start_y);
            wallDimensionSpecs.push({
                startX: tempWall.start_x,
                startY: tempWall.start_y,
                endX: tempWall.end_x,
                endY: tempWall.end_y,
                color: '#4CAF50',
                modelBounds,
                wallLinesMap: null,
                length
            });
        }
        const snapPoint = snapToClosestPoint(tempWall.end_x, tempWall.end_y);
        if (snapPoint.x !== tempWall.end_x || snapPoint.y !== tempWall.end_y) {
            context.beginPath();
            context.moveTo(
                tempWall.end_x * scaleFactor + offsetX,
                tempWall.end_y * scaleFactor + offsetY
            );
            context.lineTo(
                snapPoint.x * scaleFactor + offsetX,
                snapPoint.y * scaleFactor + offsetY
            );
            context.strokeStyle = 'rgba(76, 175, 80, 0.5)';
            context.lineWidth = 1;
            context.setLineDash([3, 3]);
            context.stroke();
            context.setLineDash([]);
            drawEndpoints(context, snapPoint.x, snapPoint.y, scaleFactor, offsetX, offsetY, hoveredPoint, '#4CAF50', 6);
        }
    }
    // Draw wall dimensions in order of ascending length (smaller inner, larger outer when overlapping)
    wallDimensionSpecs.sort((a, b) => a.length - b.length);
    wallDimensionSpecs.forEach((spec) => {
        drawDimensions(
            context,
            spec.startX,
            spec.startY,
            spec.endX,
            spec.endY,
            scaleFactor,
            offsetX,
            offsetY,
            spec.color,
            spec.modelBounds,
            placedLabels,
            allLabels,
            true, // collectOnly
            initialScale,
            spec.wallLinesMap,
            dimensionValuesSeen
        );
    });
    // Second pass: draw all label backgrounds and text (COMBINED for proper layering)
    // Combine wall and panel labels into one array to ensure proper draw order
    const allCombinedLabels = [...allLabels, ...allPanelLabels];
    
    // Draw all labels together (prevents panel labels from being covered by wall labels)
    allCombinedLabels.forEach(label => { label.draw = makeLabelDrawFn(label, scaleFactor, initialScale); });
    allCombinedLabels.forEach(label => { label.draw(context); });
    
    // Return the thickness color map for legend drawing
    return thicknessColorMap;
}

// Draw diagonal hatching for partitions
export function drawPartitionSlashes(context, line1, line2, scaleFactor, offsetX, offsetY) {
    const spacing = 15;
    const slashLength = 60;
    const dx = line1[1].x - line1[0].x;
    const dy = line1[1].y - line1[0].y;
    const wallLength = Math.sqrt(dx * dx + dy * dy);
    const numSlashes = Math.floor(wallLength * scaleFactor / spacing);
    for (let i = 1; i < numSlashes - 1; i++) {
        const t = i / numSlashes;
        const midX = (line1[0].x + t * (line1[1].x - line1[0].x) + line2[0].x + t * (line2[1].x - line2[0].x)) / 2;
        const midY = (line1[0].y + t * (line1[1].y - line1[0].y) + line2[0].y + t * (line2[1].y - line2[0].y)) / 2;
        const diagX = Math.cos(Math.PI / 4) * slashLength;
        const diagY = Math.sin(Math.PI / 4) * slashLength;
        const x1 = midX - diagX;
        const y1 = midY - diagY;
        const x2 = midX + diagX;
        const y2 = midY + diagY;
        context.beginPath();
        context.moveTo(x1 * scaleFactor + offsetX, y1 * scaleFactor + offsetY);
        context.lineTo(x2 * scaleFactor + offsetX, y2 * scaleFactor + offsetY);
        context.strokeStyle = DIMENSION_CONFIG.COLORS.PARTITION;
        context.lineWidth = DIMENSION_CONFIG.PARTITION_LINE_WIDTH;
        context.stroke();
    }
} 

// Draw panel division lines along a wall
export function drawPanelDivisions(
    context,
    wall,
    panels,
    scaleFactor,
    offsetX,
    offsetY,
    color = '#333',
    FIXED_GAP = 2.5,
    modelBounds = null,
    placedLabels = [],
    allPanelLabels = [],
    collectOnly = false,
    filteredDimensions = null,
    showPanelDimensions = true,
    initialScale = 1
) {
    if (!panels || panels.length === 0 || !wall._line1 || !wall._line2) return;
    const line1 = wall._line1;
    const line2 = wall._line2;
    const wallLength = Math.sqrt(Math.pow(line1[1].x - line1[0].x, 2) + Math.pow(line1[1].y - line1[0].y, 2));
    if (wallLength === 0) return;
    
    let accumulated = 0;
    
    // Draw panel division lines
    for (let i = 0; i < panels.length - 1; i++) {
        accumulated += panels[i].width;
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
        context.save();
        context.beginPath();
        context.moveTo(x1 * scaleFactor + offsetX, y1 * scaleFactor + offsetY);
        context.lineTo(x2 * scaleFactor + offsetX, y2 * scaleFactor + offsetY);
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.stroke();
        context.restore();
    }
    
    // Draw special markers for 1130mm panels (20mm optimization)
    accumulated = 0;
    for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const panelWidth = panel.actualWidth || panel.width;
        
        // Check if this is a 1130mm panel
        if (panelWidth === 1130 || panel.optimizationType === 'RIGHT_OPTIMIZED') {
            const panelStart = accumulated;
            const panelEnd = accumulated + panelWidth;
            const tStart = panelStart / wallLength;
            const tEnd = panelEnd / wallLength;
            
            // Calculate panel boundaries
            const cxStart = line1[0].x + (line1[1].x - line1[0].x) * tStart;
            const cyStart = line1[0].y + (line1[1].y - line1[0].y) * tStart;
            const c2xStart = line2[0].x + (line2[1].x - line2[0].x) * tStart;
            const c2yStart = line2[0].y + (line2[1].y - line2[0].y) * tStart;
            const mxStart = (cxStart + c2xStart) / 2;
            const myStart = (cyStart + c2yStart) / 2;
            
            const cxEnd = line1[0].x + (line1[1].x - line1[0].x) * tEnd;
            const cyEnd = line1[0].y + (line1[1].y - line1[0].y) * tEnd;
            const c2xEnd = line2[0].x + (line2[1].x - line2[0].x) * tEnd;
            const c2yEnd = line2[0].y + (line2[1].y - line2[0].y) * tEnd;
            const mxEnd = (cxEnd + c2xEnd) / 2;
            const myEnd = (cyEnd + c2yEnd) / 2;
            
            // Draw red diagonal slashes for 1130mm panels
            context.save();
            context.strokeStyle = '#FF0000';
            context.lineWidth = 2;
            
            // Calculate diagonal slash pattern
            const slashSpacing = 20; // Spacing between slashes
            const slashLength = 15;
            
            // Direction vector along the panel
            const dx = mxEnd - mxStart;
            const dy = myEnd - myStart;
            const panelLength = Math.sqrt(dx * dx + dy * dy);
            
            if (panelLength > 0) {
                const numSlashes = Math.floor(panelLength / slashSpacing);
                
                for (let k = 0; k < numSlashes; k++) {
                    const t = (k + 0.5) / numSlashes; // Center the slashes
                    const slashX = mxStart + t * dx;
                    const slashY = myStart + t * dy;
                    
                    // Calculate perpendicular direction for slashes
                    const perpX = -dy / panelLength;
                    const perpY = dx / panelLength;
                    
                    // Draw diagonal slash
                    context.beginPath();
                    context.moveTo(
                        (slashX - perpX * slashLength/2) * scaleFactor + offsetX,
                        (slashY - perpY * slashLength/2) * scaleFactor + offsetY
                    );
                    context.lineTo(
                        (slashX + perpX * slashLength/2) * scaleFactor + offsetX,
                        (slashY + perpY * slashLength/2) * scaleFactor + offsetY
                    );
                    context.stroke();
                }
            }
            
            context.restore();
        }
        
        accumulated += panelWidth;
    }
    
    if (!showPanelDimensions) {
        return;
    }

    // Draw side panel length labels (original - only first and last)
    accumulated = 0;
    for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const panelWidth = panel.width;
        
        // Show labels for side panels (first and last panels) and if this panel should show dimensions
        if ((i === 0 || i === panels.length - 1) && 
            (!filteredDimensions || shouldShowPanelDimension(panel, wall.thickness, filteredDimensions.panelDimensions, wall.id, wall))) {
            
            // For 1130mm panels, show only the actual width, not the original 1150mm
            let displayWidth = panelWidth;
            let specialSymbol = '';
            let specialColor = '#FF6B35'; // Default panel color
            
            if (panel.actualWidth && panel.actualWidth === 1130) {
                displayWidth = 1130; // Show only 1130mm
                // No special symbol or color - appear as normal panels
            } else if (panel.optimizationType === 'RIGHT_OPTIMIZED') {
                displayWidth = 1130; // Show only 1130mm
                // No special symbol or color - appear as normal panels
            }
            
            const labelText = `${Math.round(displayWidth)}`;
            const fullLabelText = specialSymbol ? `${labelText} ${specialSymbol}` : labelText;

            // Start and end t values for the panel
            const tStart = accumulated / wallLength;
            const tEnd = (accumulated + panelWidth) / wallLength;

            // Start and end points along the wall centerline
            const cxStart = line1[0].x + (line1[1].x - line1[0].x) * tStart;
            const cyStart = line1[0].y + (line1[1].y - line1[0].y) * tStart;
            const c2xStart = line2[0].x + (line2[1].x - line2[0].x) * tStart;
            const c2yStart = line2[0].y + (line2[1].y - line2[0].y) * tStart;
            const mxStart = (cxStart + c2xStart) / 2;
            const myStart = (cyStart + c2yStart) / 2;

            const cxEnd = line1[0].x + (line1[1].x - line1[0].x) * tEnd;
            const cyEnd = line1[0].y + (line1[1].y - line1[0].y) * tEnd;
            const c2xEnd = line2[0].x + (line2[1].x - line2[0].x) * tEnd;
            const c2yEnd = line2[0].y + (line2[1].y - line2[0].y) * tEnd;
            const mxEnd = (cxEnd + c2xEnd) / 2;
            const myEnd = (cyEnd + c2yEnd) / 2;

            // Calculate direction and angle
            const dx = mxEnd - mxStart;
            const dy = myEnd - myStart;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);

            // Panel midpoint
            const panelMidX = (mxStart + mxEnd) / 2;
            const panelMidY = (myStart + myEnd) / 2;

            // Use the passed modelBounds or fallback to wall bounds
            const bounds = modelBounds || {
                minX: Math.min(wall.start_x, wall.end_x),
                maxX: Math.max(wall.start_x, wall.end_x),
                minY: Math.min(wall.start_y, wall.end_y),
                maxY: Math.max(wall.start_y, wall.end_y)
            };

            const baseOffset = DIMENSION_CONFIG.BASE_OFFSET; // Base distance outside the model
            const text = fullLabelText; // Use the enhanced label text
            
            // IMPORTANT: Set font BEFORE measuring text width!
            // Calculate font size: if calculated value is below minimum, use minimum; when zooming, scale from minimum
            const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor;
            let fontSize;
            
            // Calculate square root scaled font size if user has zoomed in
            let sqrtScaledFontSize = 0;
            if (initialScale > 0 && scaleFactor > initialScale) {
                // User has zoomed in - scale from minimum using square root to reduce aggressiveness
                // This means 2x zoom only results in ~1.41x text size, not 2x
                const zoomRatio = scaleFactor / initialScale;
                sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
            }
            
            // Use the maximum of calculated and square root scaled to prevent discontinuity
            // This ensures smooth transition when crossing the minimum threshold
            if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
                // Below minimum threshold - use square root scaling if zoomed, otherwise minimum
                fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
            } else {
                // Above minimum threshold - use max of calculated and square root scaled
                // This prevents sudden drop when crossing the threshold
                fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
            }
            
            // CRITICAL: Final safety check - ensure fontSize is NEVER below minimum (8px)
            fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            const textWidth = context.measureText(text).width;

            if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
                // Horizontal panel - place on top or bottom
                const isTopHalf = panelMidY < (bounds.minY + bounds.maxY) / 2;
                const side = isTopHalf ? 'top' : 'bottom';
                
                // Find available position to avoid overlaps
                let labelY, labelX;
                let offset = baseOffset;
                let attempts = 0;
                const maxAttempts = DIMENSION_CONFIG.MAX_ATTEMPTS;
                
                do {
                    labelY = isTopHalf ? 
                        (bounds.minY * scaleFactor + offsetY - offset) : 
                        (bounds.maxY * scaleFactor + offsetY + offset);
                    labelX = panelMidX * scaleFactor + offsetX;
                    
                    // Check for overlaps with existing labels
                    const labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8);
                    const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
                    
                    if (!hasOverlap) break;
                    
                    // Increase offset and try again
                    offset += DIMENSION_CONFIG.OFFSET_INCREMENT;
                    attempts++;
                } while (attempts < maxAttempts);
                
                // Calculate final label bounds (use same function for consistency)
                const finalLabelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8);
                
                const textPadding = 2;
                const textLeft = labelX - textWidth / 2 - textPadding;
                const textRight = labelX + textWidth / 2 + textPadding;
                const rectScreenPanel = modelBoundsToScreenRect(bounds, scaleFactor, offsetX, offsetY);
                const extDashPanel = getCanvasExtensionDashPattern(scaleFactor);
                const extLineWPanel = getCanvasExtensionLineWidth();
                const dimLineWPanel = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
                const startXScreen = mxStart * scaleFactor + offsetX;
                const endXScreen = mxEnd * scaleFactor + offsetX;
                const yStartP = myStart * scaleFactor + offsetY;
                const yEndP = myEnd * scaleFactor + offsetY;
                context.strokeStyle = specialColor;
                context.lineWidth = extLineWPanel;
                context.setLineDash(extDashPanel);
                canvasDrawExtensionDashed(context, startXScreen, yStartP, startXScreen, labelY, rectScreenPanel);
                canvasDrawExtensionDashed(context, endXScreen, yEndP, endXScreen, labelY, rectScreenPanel);
                context.setLineDash([]);
                context.lineWidth = dimLineWPanel;
                context.beginPath();
                if (startXScreen < textLeft) {
                    context.moveTo(startXScreen, labelY);
                    context.lineTo(textLeft, labelY);
                }
                if (endXScreen > textRight) {
                    context.moveTo(textRight, labelY);
                    context.lineTo(endXScreen, labelY);
                }
                context.stroke();
                
                // Add to placed labels for future collision detection (use calculated bounds)
                placedLabels.push({
                    x: finalLabelBounds.x,
                    y: finalLabelBounds.y,
                    width: finalLabelBounds.width,
                    height: finalLabelBounds.height,
                    side: side,
                    text: text,
                    angle: angle,
                    type: 'panel'
                });
                 
                 // Collect for second pass if needed (use same bounds for consistency)
                 if (collectOnly) {
                     allPanelLabels.push({
                         x: finalLabelBounds.x,
                         y: finalLabelBounds.y,
                         width: finalLabelBounds.width,
                         height: finalLabelBounds.height,
                         side: side,
                         text: text,
                         angle: angle,
                         type: 'panel'
                     });
                 }
            } else {
                // Vertical panel - place on left or right
                const isLeftHalf = panelMidX < (bounds.minX + bounds.maxX) / 2;
                const side = isLeftHalf ? 'left' : 'right';
                
                // Find available position to avoid overlaps
                let labelX, labelY;
                let offset = Math.max(baseOffset, DIMENSION_CONFIG.MIN_VERTICAL_OFFSET); // Ensure minimum vertical offset
                let attempts = 0;
                const maxAttempts = DIMENSION_CONFIG.MAX_ATTEMPTS;
                
                do {
                    labelX = isLeftHalf ? 
                        (bounds.minX * scaleFactor + offsetX - offset) : 
                        (bounds.maxX * scaleFactor + offsetX + offset);
                    labelY = panelMidY * scaleFactor + offsetY;
                    
                    // Check for overlaps with existing labels (rotated bounding box for vertical text)
                    const labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 2, 8);
                    const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
                    
                    if (!hasOverlap) break;
                    
                    // Increase offset and try again
                    offset += DIMENSION_CONFIG.OFFSET_INCREMENT;
                    attempts++;
                } while (attempts < maxAttempts);
                
                // Calculate final label bounds (use same function for consistency)
                const finalLabelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 2, 8);
                
                const textPadding = 2;
                const textTop = labelY - textWidth / 2 - textPadding;
                const textBottom = labelY + textWidth / 2 + textPadding;
                const rectScreenPanelV = modelBoundsToScreenRect(bounds, scaleFactor, offsetX, offsetY);
                const extDashPanelV = getCanvasExtensionDashPattern(scaleFactor);
                const extLineWPanelV = getCanvasExtensionLineWidth();
                const dimLineWPanelV = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
                const xStartP = mxStart * scaleFactor + offsetX;
                const xEndP = mxEnd * scaleFactor + offsetX;
                const startYScreen = myStart * scaleFactor + offsetY;
                const endYScreen = myEnd * scaleFactor + offsetY;
                context.strokeStyle = specialColor;
                context.lineWidth = extLineWPanelV;
                context.setLineDash(extDashPanelV);
                canvasDrawExtensionDashed(context, xStartP, startYScreen, labelX, startYScreen, rectScreenPanelV);
                canvasDrawExtensionDashed(context, xEndP, endYScreen, labelX, endYScreen, rectScreenPanelV);
                context.setLineDash([]);
                context.lineWidth = dimLineWPanelV;
                context.beginPath();
                if (startYScreen < textTop) {
                    context.moveTo(labelX, startYScreen);
                    context.lineTo(labelX, textTop);
                }
                if (endYScreen > textBottom) {
                    context.moveTo(labelX, textBottom);
                    context.lineTo(labelX, endYScreen);
                }
                context.stroke();
                
                // Add to placed labels for future collision detection (use calculated bounds)
                placedLabels.push({
                    x: finalLabelBounds.x,
                    y: finalLabelBounds.y,
                    width: finalLabelBounds.width,
                    height: finalLabelBounds.height,
                    side: side,
                    text: text,
                    angle: angle,
                    type: 'panel'
                });
                 
                 // Collect for second pass if needed (use same bounds for consistency)
                 if (collectOnly) {
                     allPanelLabels.push({
                         x: finalLabelBounds.x,
                         y: finalLabelBounds.y,
                         width: finalLabelBounds.width,
                         height: finalLabelBounds.height,
                         side: side,
                         text: text,
                         angle: angle,
                         type: 'panel'
                     });
                 }
            }
        }
        
        accumulated += panelWidth;
    }
} 

// Helper to create label draw function (original simple style)
export function makeLabelDrawFn(label, scaleFactor, initialScale = 1) {
    return function(context) {
        context.save();
        if (label.type === 'wall' && label.obliqueAngle != null && !Number.isNaN(label.obliqueAngle)) {
            const centerX = label.x + label.width / 2;
            const centerY = label.y + label.height / 2;
            const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor;
            let fontSize;
            let sqrtScaledFontSize = 0;
            if (initialScale > 0 && scaleFactor > initialScale) {
                const zoomRatio = scaleFactor / initialScale;
                sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
            }
            if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
                fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
            } else {
                fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
            }
            fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            context.translate(centerX, centerY);
            context.rotate((label.obliqueAngle * Math.PI) / 180);
            const tw = context.measureText(label.text).width;
            const th = fontSize * 0.75;
            context.fillStyle = '#ffffff';
            context.fillRect(-tw / 2 - 2, -th / 2 - 1, tw + 4, th + 2);
            context.fillStyle = '#2196F3';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label.text, 0, 0);
            context.restore();
            return;
        }
        if (label.angle && Math.abs(label.angle) > 45 && Math.abs(label.angle) < 135) {
            // Vertical (rotated) — axis-aligned vertical walls only (oblique handled above)
            const centerX = label.x + label.width / 2;
            const centerY = label.y + label.height / 2;
            context.translate(centerX, centerY);
            context.rotate(-Math.PI / 2);
            context.fillStyle = label.type === 'panel' ? '#FF6B35' : '#2196F3';
            // Calculate font size: if calculated value is below minimum, use minimum; when zooming, scale from minimum
            const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor;
            let fontSize;
            
            // Calculate square root scaled font size if user has zoomed in
            let sqrtScaledFontSize = 0;
            if (initialScale > 0 && scaleFactor > initialScale) {
                // User has zoomed in - scale from minimum using square root to reduce aggressiveness
                // This means 2x zoom only results in ~1.41x text size, not 2x
                const zoomRatio = scaleFactor / initialScale;
                sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
            }
            
            // Use the maximum of calculated and square root scaled to prevent discontinuity
            // This ensures smooth transition when crossing the minimum threshold
            if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
                // Below minimum threshold - use square root scaling if zoomed, otherwise minimum
                fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
            } else {
                // Above minimum threshold - use max of calculated and square root scaled
                // This prevents sudden drop when crossing the threshold
                fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
            }
            
            fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            const twV = context.measureText(label.text).width;
            const thV = fontSize * 0.75;
            context.fillStyle = '#ffffff';
            context.fillRect(-twV / 2 - 2, -thV / 2 - 1, twV + 4, thV + 2);
            context.fillStyle = label.textColor != null ? label.textColor : (label.type === 'panel' ? '#FF6B35' : '#2196F3');
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label.text, 0, 0);
        } else {
            // Horizontal
            context.fillStyle = label.textColor != null ? label.textColor : (label.type === 'panel' ? '#FF6B35' : '#2196F3');
            // Calculate font size: if calculated value is below minimum, use minimum; when zooming, scale from minimum
            const calculatedFontSize2 = DIMENSION_CONFIG.FONT_SIZE * scaleFactor;
            let fontSize2;
            
            // Calculate square root scaled font size if user has zoomed in
            let sqrtScaledFontSize2 = 0;
            if (initialScale > 0 && scaleFactor > initialScale) {
                // User has zoomed in - scale from minimum using square root to reduce aggressiveness
                // This means 2x zoom only results in ~1.41x text size, not 2x
                const zoomRatio = scaleFactor / initialScale;
                sqrtScaledFontSize2 = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
            }
            
            // Use the maximum of calculated and square root scaled to prevent discontinuity
            // This ensures smooth transition when crossing the minimum threshold
            if (calculatedFontSize2 < DIMENSION_CONFIG.FONT_SIZE_MIN) {
                // Below minimum threshold - use square root scaling if zoomed, otherwise minimum
                fontSize2 = sqrtScaledFontSize2 > 0 ? sqrtScaledFontSize2 : DIMENSION_CONFIG.FONT_SIZE_MIN;
            } else {
                // Above minimum threshold - use max of calculated and square root scaled
                // This prevents sudden drop when crossing the threshold
                fontSize2 = Math.max(calculatedFontSize2, sqrtScaledFontSize2 || DIMENSION_CONFIG.FONT_SIZE_MIN);
            }
            
            fontSize2 = Math.max(fontSize2, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize2}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            const twH = context.measureText(label.text).width;
            const thH = fontSize2 * 0.75;
            if (label.type === 'wall' || label.textColor != null) {
                context.fillStyle = '#ffffff';
                context.fillRect(label.x, label.y, twH + 4, thH + 2);
            }
            context.fillStyle = label.textColor != null ? label.textColor : (label.type === 'panel' ? '#FF6B35' : '#2196F3');
            context.textAlign = 'left';
            context.textBaseline = 'top';
            context.fillText(label.text, label.x + 2, label.y + 2);
        }
        context.restore();
    };
} 