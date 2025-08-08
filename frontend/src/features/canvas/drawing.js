// Drawing functions extracted from Canvas2D.js

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
    context.strokeStyle = isDrawing ? '#a0a0a0' : '#ddd';
    context.lineWidth = isDrawing ? 1.5 : 1;
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

// Additional drawing functions (drawRooms, drawWalls, etc.) can be added here as you extract them from Canvas2D.js. 

// Draw rooms on the canvas (without labels - labels are now handled by InteractiveRoomLabel component)
export function drawRooms(context, rooms, walls, scaleFactor, offsetX, offsetY, calculateRoomArea, calculatePolygonVisualCenter) {
    rooms.forEach(room => {
        const roomWalls = room.walls.map(wallId => 
            walls.find(w => w.id === wallId)
        ).filter(Boolean);
        const areaPoints = (room.room_points && room.room_points.length >= 3)
            ? { insetPoints: room.room_points }
            : calculateRoomArea(roomWalls);
        if (!areaPoints || !areaPoints.insetPoints || areaPoints.insetPoints.length < 3) return;
        context.beginPath();
        context.moveTo(
            areaPoints.insetPoints[0].x * scaleFactor + offsetX,
            areaPoints.insetPoints[0].y * scaleFactor + offsetY
        );
        for (let i = 1; i < areaPoints.insetPoints.length; i++) {
            context.lineTo(
                areaPoints.insetPoints[i].x * scaleFactor + offsetX,
                areaPoints.insetPoints[i].y * scaleFactor + offsetY
            );
        }
        context.closePath();
        context.fillStyle = 'rgba(76, 175, 80, 0.5)';
        context.fill();
        context.strokeStyle = 'rgba(76, 175, 80, 0.8)';
        context.lineWidth = 2;
        context.stroke();
    });
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
    context.strokeStyle = 'rgba(0, 123, 255, 0.8)';
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = 'rgba(0, 123, 255, 0.2)';
    context.fill();
}

// Draw wall endpoints
export function drawEndpoints(context, x, y, scaleFactor, offsetX, offsetY, hoveredPoint, color = 'blue', size = 2) {
    if (hoveredPoint && hoveredPoint.x === x && hoveredPoint.y === y) {
        color = '#FF5722'; // Highlight color for hovered endpoint
        size = 6; // Slightly larger size for visual feedback
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

// Draw wall dimensions
export function drawDimensions(context, startX, startY, endX, endY, scaleFactor, offsetX, offsetY, color = 'blue', modelBounds = null, placedLabels = [], allLabels = [], collectOnly = false) {
    let midX = 0;
    let midY = 0;
    const length = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    );
    
    // Calculate wall midpoint
    const wallMidX = (startX + endX) / 2;
    const wallMidY = (startY + endY) / 2;
    
    context.save();
    context.fillStyle = color;
    context.font = '15px Arial';
    const text = `${Math.round(length)} mm`;
    const textWidth = context.measureText(text).width;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // If modelBounds is provided, use external dimensioning
    if (modelBounds) {
        const { minX, maxX, minY, maxY } = modelBounds;
        const baseOffset = 30; // Base distance outside the model
        
        if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
            // Horizontal wall - place on top or bottom
            const isTopHalf = wallMidY < (minY + maxY) / 2;
            const side = isTopHalf ? 'top' : 'bottom';
            
            // Find available position to avoid overlaps
            let labelY, labelX;
            let offset = baseOffset;
            let attempts = 0;
            const maxAttempts = 10;
            
            do {
                labelY = isTopHalf ? 
                    (minY * scaleFactor + offsetY - offset) : 
                    (maxY * scaleFactor + offsetY + offset);
                labelX = wallMidX * scaleFactor + offsetX;
                
                // Check for overlaps with existing labels
                const labelBounds = {
                    x: labelX - textWidth / 2 - 2,
                    y: labelY - 8,
                    width: textWidth + 4,
                    height: 16
                };
                
                const hasOverlap = placedLabels.some(existing => {
                    return !(labelBounds.x + labelBounds.width < existing.x || 
                           existing.x + existing.width < labelBounds.x ||
                           labelBounds.y + labelBounds.height < existing.y ||
                           existing.y + existing.height < labelBounds.y);
                });
                
                if (!hasOverlap) break;
                
                // Increase offset and try again
                offset += 20;
                attempts++;
            } while (attempts < maxAttempts);
            
            // Draw standard architectural dimensioning lines
            context.beginPath();
            context.setLineDash([5, 5]);
            // Extension line from start of wall (perpendicular to wall)
            context.moveTo(startX * scaleFactor + offsetX, startY * scaleFactor + offsetY);
            context.lineTo(startX * scaleFactor + offsetX, labelY);
            // Extension line from end of wall (perpendicular to wall)
            context.moveTo(endX * scaleFactor + offsetX, endY * scaleFactor + offsetY);
            context.lineTo(endX * scaleFactor + offsetX, labelY);
            // Dimension line connecting the two extension lines
            context.moveTo(startX * scaleFactor + offsetX, labelY);
            context.lineTo(endX * scaleFactor + offsetX, labelY);
            context.strokeStyle = color;
            context.lineWidth = 1.5;
            context.stroke();
            context.setLineDash([]);
            
                         // Add to placed labels for future collision detection
             placedLabels.push({
                 x: labelX - textWidth / 2 - 2,
                 y: labelY - 8,
                 width: textWidth + 4,
                 height: 16,
                 side: side,
                 text: text,
                 angle: angle,
                 type: 'wall'
             });
             
             // Collect for second pass if needed
             if (collectOnly) {
                 allLabels.push({
                     x: labelX - textWidth / 2 - 2,
                     y: labelY - 8,
                     width: textWidth + 4,
                     height: 16,
                     side: side,
                     text: text,
                     angle: angle,
                     type: 'wall'
                 });
             }
        } else {
            // Vertical wall - place on left or right
            const isLeftHalf = wallMidX < (minX + maxX) / 2;
            const side = isLeftHalf ? 'left' : 'right';
            
            // Find available position to avoid overlaps
            let labelX, labelY;
            let offset = baseOffset;
            let attempts = 0;
            const maxAttempts = 10;
            
            do {
                labelX = isLeftHalf ? 
                    (minX * scaleFactor + offsetX - offset) : 
                    (maxX * scaleFactor + offsetX + offset);
                labelY = wallMidY * scaleFactor + offsetY;
                
                // Check for overlaps with existing labels (rotated bounding box for vertical text)
                const labelBounds = {
                    x: labelX - 8, // Center the rotated text
                    y: labelY - textWidth / 2 - 2,
                    width: 16, // Swapped with height for rotated text
                    height: textWidth + 4 // Swapped with width for rotated text
                };
                
                const hasOverlap = placedLabels.some(existing => {
                    return !(labelBounds.x + labelBounds.width < existing.x || 
                           existing.x + existing.width < labelBounds.x ||
                           labelBounds.y + labelBounds.height < existing.y ||
                           existing.y + existing.height < labelBounds.y);
                });
                
                if (!hasOverlap) break;
                
                // Increase offset and try again
                offset += 20;
                attempts++;
            } while (attempts < maxAttempts);
            
            // Draw standard architectural dimensioning lines
            context.beginPath();
            context.setLineDash([5, 5]);
            // Extension line from start of wall (perpendicular to wall)
            context.moveTo(startX * scaleFactor + offsetX, startY * scaleFactor + offsetY);
            context.lineTo(labelX, startY * scaleFactor + offsetY);
            // Extension line from end of wall (perpendicular to wall)
            context.moveTo(endX * scaleFactor + offsetX, endY * scaleFactor + offsetY);
            context.lineTo(labelX, endY * scaleFactor + offsetY);
            // Dimension line connecting the two extension lines
            context.moveTo(labelX, startY * scaleFactor + offsetY);
            context.lineTo(labelX, endY * scaleFactor + offsetY);
            context.strokeStyle = color;
            context.lineWidth = 1.5;
            context.stroke();
            context.setLineDash([]);
            
                         // Add to placed labels for future collision detection (rotated bounding box for vertical text)
             placedLabels.push({
                 x: labelX - 8, // Center the rotated text
                 y: labelY - textWidth / 2 - 2,
                 width: 16, // Swapped with height for rotated text
                 height: textWidth + 4, // Swapped with width for rotated text
                 side: side,
                 text: text,
                 angle: angle,
                 type: 'wall'
             });
             
             // Collect for second pass if needed
             if (collectOnly) {
                 allLabels.push({
                     x: labelX - 8, // Center the rotated text
                     y: labelY - textWidth / 2 - 2,
                     width: 16, // Swapped with height for rotated text
                     height: textWidth + 4, // Swapped with width for rotated text
                     side: side,
                     text: text,
                     angle: angle,
                     type: 'wall'
                 });
             }
        }
    } else {
        // Original internal dimensioning (fallback)
        if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
            // Horizontal wall
            midX = ((startX + endX) / 2) * scaleFactor + offsetX;
            midY = ((startY + endY) / 2) * scaleFactor + offsetY - 15;
            context.fillStyle = 'rgba(255, 255, 255, 0.8)';
            context.fillRect(midX - textWidth / 2 - 2, midY - 8, textWidth + 4, 16);
            context.fillStyle = color;
            context.fillText(text, midX - textWidth / 2, midY + 4);
        } else {
            // Vertical wall
            midX = ((startX + endX) / 2) * scaleFactor + offsetX + 15;
            midY = ((startY + endY) / 2) * scaleFactor + offsetY;
            context.translate(midX, midY);
            context.rotate(-Math.PI / 2);
            context.fillStyle = 'rgba(255, 255, 255, 0.8)';
            context.fillRect(-textWidth / 2 - 2, -8, textWidth + 4, 16);
            context.fillStyle = color;
            context.fillText(text, -textWidth / 2, 4);
            context.restore();
        }
    }
    context.restore();
}

// Calculate offset points for double-line walls
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor) {
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
    const dirToCenterX = center.x - midX;
    const dirToCenterY = center.y - midY;
    const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
    const shouldFlip = dotProduct > 0;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;
    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    return {
        line1: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
        ],
        line2: [
            { x: x1 - finalOffsetX * 2, y: y1 - finalOffsetY * 2 },
            { x: x2 - finalOffsetX * 2, y: y2 - finalOffsetY * 2 },
        ],
    };
}

// Draw a pair of wall lines
export function drawWallLinePair(context, lines, scaleFactor, offsetX, offsetY, color, dashPattern = []) {
    context.strokeStyle = color;
    context.lineWidth = 2;
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
            context.lineWidth = 2.5;
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
            context.lineWidth = 1.5;
            context.stroke();
        }
    });
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
    FIXED_GAP,
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
    drawPanelDivisions // <-- added
}) {
    if (!Array.isArray(walls) || !walls) return;
    
    // Calculate model bounds for external dimensioning
    const modelBounds = walls.length > 0 ? {
        minX: Math.min(...walls.map(w => Math.min(w.start_x, w.end_x))),
        maxX: Math.max(...walls.map(w => Math.max(w.start_x, w.end_x))),
        minY: Math.min(...walls.map(w => Math.min(w.start_y, w.end_y))),
        maxY: Math.max(...walls.map(w => Math.max(w.start_y, w.end_y)))
    } : null;
    
    // Track placed labels to prevent overlaps
    const placedLabels = [];
    // Collect label info for second pass
    const allLabels = [];
    const allPanelLabels = [];
    
    // First pass: draw all dashed lines and collect label info
    walls.forEach((wall, index) => {
        const highlight = highlightWalls.find(h => h.id === wall.id);
        const wallColor =
            highlight ? highlight.color :
            selectedWallsForRoom.includes(wall.id) ? '#4CAF50' :
            selectedWall === wall.id ? 'red' :
            hoveredWall === wall.id ? '#2196F3' :
            wall.application_type === "partition" ? "#666" : "#333";
        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            FIXED_GAP,
            center,
            scaleFactor
        );
        // Check for 45° joint at endpoints and possibly flip inner wall side
        const endpoints = [
            { label: 'start', x: wall.start_x, y: wall.start_y },
            { label: 'end', x: wall.end_x, y: wall.end_y }
        ];
        endpoints.forEach((pt, idx) => {
            const relevantIntersections = intersections.filter(inter => {
                const dx = inter.x - pt.x;
                const dy = inter.y - pt.y;
                return Math.hypot(dx, dy) < SNAP_THRESHOLD / currentScaleFactor;
            });
            // Find if this endpoint has a 45_cut and get the joining wall
            let has45 = false;
            let joiningWall = null;
            let joiningWallId = null;
            relevantIntersections.forEach(inter => {
                inter.pairs.forEach(pair => {
                    if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                        has45 = true;
                        // Find the joining wall id
                        joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                    }
                });
            });
            // If 45_cut, check if joining wall is on same side as model center
            if (has45 && joiningWallId) {
                joiningWall = walls.find(w => w.id === joiningWallId);
                if (joiningWall) {
                    // Calculate normal for this wall
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const length = Math.hypot(dx, dy);
                    const normalX = dy / length;
                    const normalY = -dx / length;
                    // Midpoint of this wall
                    const midX = (wall.start_x + wall.end_x) / 2;
                    const midY = (wall.start_y + wall.end_y) / 2;
                    // Vector to model center
                    const toCenterX = center.x - midX;
                    const toCenterY = center.y - midY;
                    const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                    // Vector to joining wall midpoint
                    const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                    const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                    const toJoinX = joinMidX - midX;
                    const toJoinY = joinMidY - midY;
                    const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                    // If dotToCenter and dotToJoin have opposite signs, flip the side for line2
                    const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                    if (shouldFlip) {
                        // Recalculate line2 with flipped offset
                        const gapPixels = FIXED_GAP;
                        const scale = scaleFactor;
                        // Flip the shouldFlip logic in calculateOffsetPoints
                        const offsetX = (gapPixels * normalX) / scale;
                        const offsetY = (gapPixels * normalY) / scale;
                        // Normally, shouldFlip = dotToCenter > 0, so flip it:
                        const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                        const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                        // Only flip the endpoint in question
                        if (pt.label === 'start') {
                            line2[0] = {
                                x: wall.start_x - finalOffsetX * 2,
                                y: wall.start_y - finalOffsetY * 2
                            };
                        } else {
                            line2[1] = {
                                x: wall.end_x - finalOffsetX * 2,
                                y: wall.end_y - finalOffsetY * 2
                            };
                        }
                    }
                }
            }
            // Existing logic for shortening/capping for 45_cut
            if (has45) {
                const dx = wall.end_x - wall.start_x;
                const dy = wall.end_y - wall.start_y;
                const len = Math.hypot(dx, dy);
                const ux = len ? dx / len : 0;
                const uy = len ? dy / len : 0;
                const adjust = 150 * 0.9;
                line2 = [...line2.map(p => ({ ...p }))];
                if (pt.label === 'start') {
                    line2[0].x += ux * adjust;
                    line2[0].y += uy * adjust;
                } else {
                    line2[1].x -= ux * adjust;
                    line2[1].y -= uy * adjust;
                }
            }
        });
        wall._line1 = line1;
        wall._line2 = line2;
        drawWallLinePair(context, [line1, line2], scaleFactor, offsetX, offsetY, wallColor);
        drawWallCaps(context, wall, joints, center, intersections, SNAP_THRESHOLD, currentScaleFactor, offsetX, offsetY, scaleFactor);
        if (wall.application_type === "partition") {
            drawPartitionSlashes(context, line1, line2, scaleFactor, offsetX, offsetY);
        }
        // --- Draw panel divisions here (collect panel label info) ---
        if (wallPanelsMap && drawPanelDivisions) {
            const panels = wallPanelsMap[wall.id];
            if (panels && panels.length > 0) {
                drawPanelDivisions(context, wall, panels, scaleFactor, offsetX, offsetY, undefined, FIXED_GAP, modelBounds, placedLabels, allPanelLabels, true);
            }
        }
        // --- End panel divisions ---
        if (isEditingMode) {
            const endpointColor = selectedWall === wall.id ? 'red' : '#2196F3';
            drawEndpoints(context, wall.start_x, wall.start_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor);
            drawEndpoints(context, wall.end_x, wall.end_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor);
        }
        // Collect wall label info for second pass
        drawDimensions(
            context,
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            scaleFactor,
            offsetX,
            offsetY,
            selectedWall === wall.id ? 'red' : '#2196F3',
            modelBounds,
            placedLabels,
            allLabels,
            true // collectOnly
        );
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
        const { line1, line2 } = calculateOffsetPoints(
            tempWall.start_x,
            tempWall.start_y,
            tempWall.end_x,
            tempWall.end_y,
            FIXED_GAP,
            center,
            scaleFactor
        );
        drawWallLinePair(context, [line1, line2], scaleFactor, offsetX, offsetY, '#4CAF50', [5, 5]);
        drawEndpoints(context, tempWall.start_x, tempWall.start_y, scaleFactor, offsetX, offsetY, hoveredPoint, '#4CAF50');
        drawEndpoints(context, tempWall.end_x, tempWall.end_y, scaleFactor, offsetX, offsetY, hoveredPoint, '#4CAF50');
        drawDimensions(
            context,
            tempWall.start_x,
            tempWall.start_y,
            tempWall.end_x,
            tempWall.end_y,
            scaleFactor,
            offsetX,
            offsetY,
            '#4CAF50',
            modelBounds,
            placedLabels,
            allLabels,
            true // collectOnly
        );
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
    // Second pass: draw all label backgrounds and text for walls
    allLabels.forEach(label => { label.draw = makeLabelDrawFn(label); });
    allLabels.forEach(label => { label.draw(context); });
    // Second pass: draw all label backgrounds and text for panels
    allPanelLabels.forEach(label => { label.draw = makeLabelDrawFn(label); });
    allPanelLabels.forEach(label => { label.draw(context); });
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
        context.strokeStyle = "#666";
        context.lineWidth = 1.5;
        context.stroke();
    }
} 

// Draw panel division lines along a wall
export function drawPanelDivisions(context, wall, panels, scaleFactor, offsetX, offsetY, color = '#333', FIXED_GAP = 2.5, modelBounds = null, placedLabels = [], allPanelLabels = [], collectOnly = false) {
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
    
    // Draw side panel length labels
    accumulated = 0;
    for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const panelWidth = panel.width;
        const panelCenter = accumulated + panelWidth / 2;
        const t = panelCenter / wallLength;
        
        // Calculate position for the label
        const cx = line1[0].x + (line1[1].x - line1[0].x) * t;
        const cy = line1[0].y + (line1[1].y - line1[0].y) * t;
        const c2x = line2[0].x + (line2[1].x - line2[0].x) * t;
        const c2y = line2[0].y + (line2[1].y - line2[0].y) * t;
        const mx = (cx + c2x) / 2;
        const my = (cy + c2y) / 2;
        
        // Direction vector along the wall
        const dx = (line1[1].x - line1[0].x) / wallLength;
        const dy = (line1[1].y - line1[0].y) / wallLength;
        // Perpendicular vector for label offset
        const perpX = -dy;
        const perpY = dx;
        
        // Only show labels for side panels (first and last panels)
        if (i === 0 || i === panels.length - 1) {
            const labelText = `${Math.round(panelWidth)} mm`;

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

            const baseOffset = 30;
            const text = labelText;
            const textWidth = context.measureText(text).width;

            if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
                // Horizontal panel - place on top or bottom
                const isTopHalf = panelMidY < (bounds.minY + bounds.maxY) / 2;
                const side = isTopHalf ? 'top' : 'bottom';
                
                // Find available position to avoid overlaps
                let labelY, labelX;
                let offset = baseOffset;
                let attempts = 0;
                const maxAttempts = 10;
                
                do {
                    labelY = isTopHalf ? 
                        (bounds.minY * scaleFactor + offsetY - offset) : 
                        (bounds.maxY * scaleFactor + offsetY + offset);
                    labelX = panelMidX * scaleFactor + offsetX;
                    
                    // Check for overlaps with existing labels
                    const labelBounds = {
                        x: labelX - textWidth / 2 - 2,
                        y: labelY - 8,
                        width: textWidth + 4,
                        height: 16
                    };
                    
                    const hasOverlap = placedLabels.some(existing => {
                        return !(labelBounds.x + labelBounds.width < existing.x || 
                               existing.x + existing.width < labelBounds.x ||
                               labelBounds.y + labelBounds.height < existing.y ||
                               existing.y + existing.height < labelBounds.y);
                    });
                    
                    if (!hasOverlap) break;
                    
                    // Increase offset and try again
                    offset += 20;
                    attempts++;
                } while (attempts < maxAttempts);
                
                // Draw standard architectural dimensioning lines for panel
                context.beginPath();
                context.setLineDash([5, 5]);
                // Extension line from start of panel (perpendicular to panel)
                context.moveTo(mxStart * scaleFactor + offsetX, myStart * scaleFactor + offsetY);
                context.lineTo(mxStart * scaleFactor + offsetX, labelY);
                // Extension line from end of panel (perpendicular to panel)
                context.moveTo(mxEnd * scaleFactor + offsetX, myEnd * scaleFactor + offsetY);
                context.lineTo(mxEnd * scaleFactor + offsetX, labelY);
                // Dimension line connecting the two extension lines
                context.moveTo(mxStart * scaleFactor + offsetX, labelY);
                context.lineTo(mxEnd * scaleFactor + offsetX, labelY);
                context.strokeStyle = '#FF6B35';
                context.lineWidth = 1.5;
                context.stroke();
                context.setLineDash([]);
                
                                 // Add to placed labels for future collision detection
                 placedLabels.push({
                     x: labelX - textWidth / 2 - 2,
                     y: labelY - 8,
                     width: textWidth + 4,
                     height: 16,
                     side: side,
                     text: text,
                     angle: angle,
                     type: 'panel'
                 });
                 
                 // Collect for second pass if needed
                 if (collectOnly) {
                     allPanelLabels.push({
                         x: labelX - textWidth / 2 - 2,
                         y: labelY - 8,
                         width: textWidth + 4,
                         height: 16,
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
                let offset = baseOffset;
                let attempts = 0;
                const maxAttempts = 10;
                
                do {
                    labelX = isLeftHalf ? 
                        (bounds.minX * scaleFactor + offsetX - offset) : 
                        (bounds.maxX * scaleFactor + offsetX + offset);
                    labelY = panelMidY * scaleFactor + offsetY;
                    
                    // Check for overlaps with existing labels (rotated bounding box for vertical text)
                    const labelBounds = {
                        x: labelX - 8, // Center the rotated text
                        y: labelY - textWidth / 2 - 2,
                        width: 16, // Swapped with height for rotated text
                        height: textWidth + 4 // Swapped with width for rotated text
                    };
                    
                    const hasOverlap = placedLabels.some(existing => {
                        return !(labelBounds.x + labelBounds.width < existing.x || 
                               existing.x + existing.width < labelBounds.x ||
                               labelBounds.y + labelBounds.height < existing.y ||
                               existing.y + existing.height < labelBounds.y);
                    });
                    
                    if (!hasOverlap) break;
                    
                    // Increase offset and try again
                    offset += 20;
                    attempts++;
                } while (attempts < maxAttempts);
                
                // Draw standard architectural dimensioning lines for panel
                context.beginPath();
                context.setLineDash([5, 5]);
                // Extension line from start of panel (perpendicular to panel)
                context.moveTo(mxStart * scaleFactor + offsetX, myStart * scaleFactor + offsetY);
                context.lineTo(labelX, myStart * scaleFactor + offsetY);
                // Extension line from end of panel (perpendicular to panel)
                context.moveTo(mxEnd * scaleFactor + offsetX, myEnd * scaleFactor + offsetY);
                context.lineTo(labelX, myEnd * scaleFactor + offsetY);
                // Dimension line connecting the two extension lines
                context.moveTo(labelX, myStart * scaleFactor + offsetY);
                context.lineTo(labelX, myEnd * scaleFactor + offsetY);
                context.strokeStyle = '#FF6B35';
                context.lineWidth = 1.5;
                context.stroke();
                context.setLineDash([]);
                
                                 // Add to placed labels for future collision detection (rotated bounding box for vertical text)
                 placedLabels.push({
                     x: labelX - 8, // Center the rotated text
                     y: labelY - textWidth / 2 - 2,
                     width: 16, // Swapped with height for rotated text
                     height: textWidth + 4, // Swapped with width for rotated text
                     side: side,
                     text: text,
                     angle: angle,
                     type: 'panel'
                 });
                 
                 // Collect for second pass if needed
                 if (collectOnly) {
                     allPanelLabels.push({
                         x: labelX - 8, // Center the rotated text
                         y: labelY - textWidth / 2 - 2,
                         width: 16, // Swapped with height for rotated text
                         height: textWidth + 4, // Swapped with width for rotated text
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

// Helper to create label draw function
function makeLabelDrawFn(label) {
    return function(context) {
        context.save();
        if (label.angle && Math.abs(label.angle) > 45 && Math.abs(label.angle) < 135) {
            // Vertical (rotated)
            const centerX = label.x + label.width / 2;
            const centerY = label.y + label.height / 2;
            context.translate(centerX, centerY);
            context.rotate(-Math.PI / 2);
            context.fillStyle = 'rgba(255,255,255,0.8)';
            context.fillRect(-label.height / 2, -label.width / 2, label.height, label.width);
            context.fillStyle = label.type === 'panel' ? '#FF6B35' : '#2196F3';
            context.font = '15px Arial';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label.text, 0, 0);
        } else {
            // Horizontal
            context.fillStyle = 'rgba(255,255,255,0.8)';
            context.fillRect(label.x, label.y, label.width, label.height);
            context.fillStyle = label.type === 'panel' ? '#FF6B35' : '#2196F3';
            context.font = '15px Arial';
            context.textAlign = 'left';
            context.textBaseline = 'top';
            context.fillText(label.text, label.x + 2, label.y + 2);
        }
        context.restore();
    };
} 