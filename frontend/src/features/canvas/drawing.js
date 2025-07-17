// Drawing functions extracted from Canvas2D.js

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

// Draw rooms on the canvas
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
        const center = calculatePolygonVisualCenter(areaPoints.insetPoints);
        if (!center) return;
        context.fillStyle = 'white';
        context.font = '14px Arial';
        const textMetrics = context.measureText(room.room_name);
        const padding = 4;
        context.fillRect(
            center.x * scaleFactor + offsetX - textMetrics.width / 2 - padding,
            center.y * scaleFactor + offsetY - 14 - padding,
            textMetrics.width + padding * 2,
            18 + padding * 2
        );
        context.fillStyle = '#000';
        context.textAlign = 'center';
        context.fillText(
            room.room_name,
            center.x * scaleFactor + offsetX,
            center.y * scaleFactor + offsetY
        );
    });
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
export function drawDimensions(context, startX, startY, endX, endY, scaleFactor, offsetX, offsetY, color = 'blue') {
    let midX = 0;
    let midY = 0;
    const length = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    );
    context.save();
    context.fillStyle = color;
    context.font = '15px Arial';
    const text = `${Math.round(length)} mm`;
    const textWidth = context.measureText(text).width;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
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
}) {
    if (!Array.isArray(walls) || !walls) return;
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
        if (isEditingMode) {
            const endpointColor = selectedWall === wall.id ? 'red' : '#2196F3';
            drawEndpoints(context, wall.start_x, wall.start_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor);
            drawEndpoints(context, wall.end_x, wall.end_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor);
        }
        drawDimensions(
            context,
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            scaleFactor,
            offsetX,
            offsetY,
            selectedWall === wall.id ? 'red' : '#2196F3'
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
    // Draw temporary wall while adding wall
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
            '#4CAF50'
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