import React, { useEffect, useRef, useState } from 'react';

const Canvas2D = ({ 
    walls = [], 
    setWalls, 
    onNewWall, 
    onWallTypeSelect,
    isEditingMode, 
    currentMode, 
    onWallSelect, 
    onWallDelete, 
    selectedWallsForRoom = [], 
    onRoomWallsSelect = () => {},
    onRoomSelect = () => {},
    rooms = []
}) => {

    const canvasRef = useRef(null);
    const [selectedWall, setSelectedWall] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tempWall, setTempWall] = useState(null);
    const [hoveredWall, setHoveredWall] = useState(null);
    const [hoveredPoint, setHoveredPoint] = useState(null);

    const SNAP_THRESHOLD = 10;
    const gridSize = 50;
    
    let offsetX = 0;
    let offsetY = 0;
    let scaleFactor = 1;

    //start here about the room area defining
    const calculateRoomArea = (roomWalls) => {
        if (!roomWalls || roomWalls.length < 3) return null;
    
        // Step 1: Collect all unique points from the walls
        let points = new Set();
        roomWalls.forEach(wall => {
            points.add(JSON.stringify({ x: wall.start_x, y: wall.start_y }));
            points.add(JSON.stringify({ x: wall.end_x, y: wall.end_y }));
        });
        points = [...points].map(p => JSON.parse(p));
    
        // Step 2: Order points to form a valid polygon using Convex Hull (Graham's Scan)
        const orderedPoints = getConvexHull(points);
    
        return orderedPoints;
    };
    
    const crossProduct = (o, a, b) => {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    };
    
    const getConvexHull = (points) => {
        if (points.length < 3) return points;
        points.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
    
        let lower = [];
        for (let p of points) {
            while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }
    
        let upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            let p = points[i];
            while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }
    
        upper.pop();
        lower.pop();
        return lower.concat(upper);
    };
    
    //room defining ends here (but got problem, nid futher improvement on the logic)

    //Here is about the room selecting
    const isPointInPolygon = (point, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            
            const intersect = ((yi > point.y) !== (yj > point.y))
                && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        canvas.width = 800;
        canvas.height = 600;

        // Update cursor style based on drawing mode
        canvas.style.cursor = isDrawing ? 'crosshair' : 'default';

        const minX = Math.min(...walls.map((wall) => Math.min(wall.start_x, wall.end_x)), 0);
        const maxX = Math.max(...walls.map((wall) => Math.max(wall.start_x, wall.end_x)), 0);
        const minY = Math.min(...walls.map((wall) => Math.min(wall.start_y, wall.end_y)), 0);
        const maxY = Math.max(...walls.map((wall) => Math.max(wall.start_y, wall.end_y)), 0);

        const wallWidth = maxX - minX || 1;
        const wallHeight = maxY - minY || 1;

        const padding = 50;
        scaleFactor = Math.min(
            (canvas.width - 2 * padding) / wallWidth,
            (canvas.height - 2 * padding) / wallHeight
        );

        offsetX = (canvas.width - wallWidth * scaleFactor) / 2 - minX * scaleFactor;
        offsetY = (canvas.height - wallHeight * scaleFactor) / 2 - minY * scaleFactor;

        //Grid drawing in the 2D view
        const drawGrid = () => {
            context.strokeStyle = isDrawing ? '#a0a0a0' : '#ddd';
            context.lineWidth = isDrawing ? 1.5 : 1;

            for (let x = 0; x <= canvas.width; x += gridSize) {
                context.beginPath();
                context.moveTo(x, 0);
                context.lineTo(x, canvas.height);
                context.stroke();
            }

            for (let y = 0; y <= canvas.height; y += gridSize) {
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(canvas.width, y);
                context.stroke();
            }
        };

        //Rooms drawing(need improvement on the room area defining so this work smoothly)
        const drawRooms = () => {
            rooms.forEach(room => {
                // Get walls for the room
                const roomWalls = room.walls.map(wallId => 
                    walls.find(w => w.id === wallId)
                ).filter(Boolean);
        
                // Calculate area points
                const areaPoints = calculateRoomArea(roomWalls);
                if (!areaPoints) return;
        
                // Draw the room area
                context.beginPath();
                context.moveTo(
                    areaPoints[0].x * scaleFactor + offsetX,
                    areaPoints[0].y * scaleFactor + offsetY
                );
        
                for (let i = 1; i < areaPoints.length; i++) {
                    context.lineTo(
                        areaPoints[i].x * scaleFactor + offsetX,
                        areaPoints[i].y * scaleFactor + offsetY
                    );
                }
        
                context.closePath();
        
                // Fill the room area
                context.fillStyle = 'rgba(76, 175, 80, 0.5)';
                context.fill();
        
                // Add a subtle border
                context.strokeStyle = 'rgba(76, 175, 80, 0.8)';
                context.lineWidth = 2;
                context.stroke();
        
                // Draw the room name
                const centerX = areaPoints.reduce((sum, p) => sum + p.x, 0) / areaPoints.length;
                const centerY = areaPoints.reduce((sum, p) => sum + p.y, 0) / areaPoints.length;
        
                // Add text background
                context.fillStyle = 'white';
                context.font = '14px Arial';
                const textMetrics = context.measureText(room.room_name);
                const padding = 4;
        
                context.fillRect(
                    centerX * scaleFactor + offsetX - textMetrics.width / 2 - padding,
                    centerY * scaleFactor + offsetY - 14 - padding,
                    textMetrics.width + padding * 2,
                    18 + padding * 2
                );
        
                // Draw the room name
                context.fillStyle = '#000';
                context.textAlign = 'center';
                context.fillText(
                    room.room_name,
                    centerX * scaleFactor + offsetX,
                    centerY * scaleFactor + offsetY
                );
            });
        };
        //Room drawing end here

        // Wall drawing, including the hover through color change and the select color change, and also the dimension showing thing
        const drawWalls = () => {
            const FIXED_GAP = 2.5; // Fixed gap in pixels for double-line walls
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
            drawGrid();

            // Helper function to differentiate the visual presentation for patition
            const drawPartitionSlashes = (line1, line2) => {
                const spacing = 15; // Adjust spacing between slashes
                const slashLength = 60; // Adjust length of each slash
            
                const dx = line1[1].x - line1[0].x;
                const dy = line1[1].y - line1[0].y;
                const wallLength = Math.sqrt(dx * dx + dy * dy);
            
                const numSlashes = Math.floor(wallLength * scaleFactor / spacing);
            
                for (let i = 1; i < numSlashes - 1; i++) {
                    // Calculate interpolation factor
                    const t = i / numSlashes;
            
                    // Compute midpoint between the two parallel lines
                    const midX = (line1[0].x + t * (line1[1].x - line1[0].x) + line2[0].x + t * (line2[1].x - line2[0].x)) / 2;
                    const midY = (line1[0].y + t * (line1[1].y - line1[0].y) + line2[0].y + t * (line2[1].y - line2[0].y)) / 2;
            
                    // Fix: Keep slashes always at 45° using fixed diagonal offsets
                    const diagX = Math.cos(Math.PI / 4) * slashLength;
                    const diagY = Math.sin(Math.PI / 4) * slashLength;
            
                    // Compute diagonal slash endpoints (always 45°)
                    const x1 = midX - diagX;
                    const y1 = midY - diagY;
                    const x2 = midX + diagX;
                    const y2 = midY + diagY;
            
                    // Draw diagonal slashes inside partition
                    context.beginPath();
                    context.moveTo(x1 * scaleFactor + offsetX, y1 * scaleFactor + offsetY);
                    context.lineTo(x2 * scaleFactor + offsetX, y2 * scaleFactor + offsetY);
                    context.strokeStyle = "#666"; // Gray color for partition slashes
                    context.lineWidth = 1.5;
                    context.stroke();
                }
            };                                                    

            // Helper function to draw wall endpoints
            const drawEndpoints = (x, y, color = 'blue', size = 4) => {
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
            };            

            // Wall Dimensions display in here, if got problem change here
            const drawDimensions = (startX, startY, endX, endY, color = 'blue') => {
                const midX = ((startX + endX) / 2) * scaleFactor + offsetX;
                const midY = ((startY + endY) / 2) * scaleFactor + offsetY;
                const length = Math.sqrt(
                    Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
                );

                context.fillStyle = color;
                context.font = '12px Arial';
                const text = `${Math.round(length)} mm`;
                const textWidth = context.measureText(text).width;

                // Add background to text for better visibility
                context.fillStyle = 'rgba(255, 255, 255, 0.8)';
                context.fillRect(midX - textWidth / 2 - 2, midY - 8, textWidth + 4, 16);

                context.fillStyle = color;
                context.fillText(text, midX - textWidth / 2, midY + 4);
            };

            // Function to calculate offset points for double-line walls
            const calculateOffsetPoints = (x1, y1, x2, y2, gapPixels) => {
                const dx = x2 - x1;
                const dy = y2 - y1;
                const length = Math.sqrt(dx * dx + dy * dy);

                const offsetX = (gapPixels * dy) / length;
                const offsetY = -(gapPixels * dx) / length;

                return {
                    line1: [
                        { x: x1 + offsetX / scaleFactor, y: y1 + offsetY / scaleFactor },
                        { x: x2 + offsetX / scaleFactor, y: y2 + offsetY / scaleFactor },
                    ],
                    line2: [
                        { x: x1 - offsetX / scaleFactor, y: y1 - offsetY / scaleFactor },
                        { x: x2 - offsetX / scaleFactor, y: y2 - offsetY / scaleFactor },
                    ],
                };
            };

            // Draw existing walls
            walls.forEach((wall, index) => {
                const { line1, line2 } = calculateOffsetPoints(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    FIXED_GAP
                );

                // Change color if hovered
                const wallColor = 
                    selectedWallsForRoom.includes(wall.id) ? '#4CAF50' : // Green for room selection
                    selectedWall === index ? 'red' :
                    hoveredWall === index ? '#2196F3' :
                    wall.application_type === "partition" ? "#666" : "#333"; // Darker gray for partitions

                // Draw the first line of the wall
                context.beginPath();
                context.moveTo(
                    line1[0].x * scaleFactor + offsetX,
                    line1[0].y * scaleFactor + offsetY
                );
                context.lineTo(
                    line1[1].x * scaleFactor + offsetX,
                    line1[1].y * scaleFactor + offsetY
                );
                context.strokeStyle = wallColor;
                context.lineWidth = 2;
                context.stroke();

                // Draw the second line of the wall
                context.beginPath();
                context.moveTo(
                    line2[0].x * scaleFactor + offsetX,
                    line2[0].y * scaleFactor + offsetY
                );
                context.lineTo(
                    line2[1].x * scaleFactor + offsetX,
                    line2[1].y * scaleFactor + offsetY
                );
                context.strokeStyle = wallColor;
                context.lineWidth = 2;
                context.stroke();

                // Draw diagonal hatching for partitions
                if (wall.application_type === "partition") {
                    drawPartitionSlashes(line1, line2);
                }

                // Draw endpoints with different colors based on wall state
                const endpointColor = selectedWall === index ? 'red' : '#2196F3';
                drawEndpoints(wall.start_x, wall.start_y, endpointColor);
                drawEndpoints(wall.end_x, wall.end_y, endpointColor);

                // Draw dimensions (on the central line)
                drawDimensions(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    selectedWall === index ? 'red' : '#2196F3'
                );

                // Draw intersection points (if any)
                walls.forEach((otherWall) => {
                    if (wall !== otherWall) {
                        const intersection = calculateIntersection(
                            { x: wall.start_x, y: wall.start_y },
                            { x: wall.end_x, y: wall.end_y },
                            { x: otherWall.start_x, y: otherWall.start_y },
                            { x: otherWall.end_x, y: otherWall.end_y }
                        );
                        if (intersection) {
                            drawEndpoints(
                                intersection.x,
                                intersection.y,
                                '#FF9800', // Orange for intersection points
                                6
                            );
                        }
                    }
                });
            });

            // Draw temporary wall while adding wall
            if (tempWall) {
                const { line1, line2 } = calculateOffsetPoints(
                    tempWall.start_x,
                    tempWall.start_y,
                    tempWall.end_x,
                    tempWall.end_y,
                    FIXED_GAP
                );

                // Draw the first line of the temporary wall
                context.beginPath();
                context.moveTo(
                    line1[0].x * scaleFactor + offsetX,
                    line1[0].y * scaleFactor + offsetY
                );
                context.lineTo(
                    line1[1].x * scaleFactor + offsetX,
                    line1[1].y * scaleFactor + offsetY
                );
                context.strokeStyle = '#4CAF50'; // Green for temporary walls
                context.lineWidth = 2;
                context.setLineDash([5, 5]);
                context.stroke();

                // Draw the second line of the temporary wall
                context.beginPath();
                context.moveTo(
                    line2[0].x * scaleFactor + offsetX,
                    line2[0].y * scaleFactor + offsetY
                );
                context.lineTo(
                    line2[1].x * scaleFactor + offsetX,
                    line2[1].y * scaleFactor + offsetY
                );
                context.strokeStyle = '#4CAF50'; // Green for temporary walls
                context.lineWidth = 2;
                context.setLineDash([5, 5]);
                context.stroke();

                context.setLineDash([]); // Reset dash style

                // Draw endpoints for temporary wall
                drawEndpoints(tempWall.start_x, tempWall.start_y, '#4CAF50');
                drawEndpoints(tempWall.end_x, tempWall.end_y, '#4CAF50');

                // Draw dimensions (on the central line)
                drawDimensions(
                    tempWall.start_x,
                    tempWall.start_y,
                    tempWall.end_x,
                    tempWall.end_y,
                    '#4CAF50'
                );

                // Draw snapping preview if close to existing walls
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
                    context.strokeStyle = 'rgba(76, 175, 80, 0.5)'; // Semi-transparent green
                    context.lineWidth = 1;
                    context.setLineDash([3, 3]);
                    context.stroke();
                    context.setLineDash([]);

                    // Draw snap point indicator
                    drawEndpoints(snapPoint.x, snapPoint.y, '#4CAF50', 6);
                }
            }
        }        

        drawWalls();
        drawRooms();

        return () => {
            context.clearRect(0, 0, canvas.width, canvas.height);
        };
    }, [walls, selectedWall, tempWall, isDrawing, hoveredWall, selectedWallsForRoom, rooms]);

    //Use for getting correct mouse position
    const getMousePos = (event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const x = (event.clientX - rect.left - offsetX) / scaleFactor;
        const y = (event.clientY - rect.top - offsetY) / scaleFactor;
        return { x, y };
    };

    // Enhanced snapping with wall continuation
    const snapToClosestPoint = (x, y) => {
        let closestPoint = { x, y }; // Default to the provided point
        let minDistance = SNAP_THRESHOLD / scaleFactor;
    
        // Check snapping to wall endpoints (start and end points)
        walls.forEach((wall) => {
            ['start', 'end'].forEach((point) => {
                const px = wall[`${point}_x`];
                const py = wall[`${point}_y`];
                const distance = Math.hypot(px - x, py - y);
    
                if (distance < minDistance) {
                    closestPoint = { x: px, y: py };
                    minDistance = distance;
                }
            });
        });
    
        // Check snapping to wall segments (for existing intersections)
        walls.forEach((wall) => {
            const segmentPoint = snapToWallSegment(x, y, wall);
            if (segmentPoint) {
                const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                if (distance < minDistance) {
                    closestPoint = segmentPoint;
                    minDistance = distance;
                }
            }
        });
    
        return closestPoint;
    };                   

    const snapToWallSegment = (x, y, wall) => {
        const wallVector = {
            x: wall.end_x - wall.start_x,
            y: wall.end_y - wall.start_y
        };
        const pointVector = {
            x: x - wall.start_x,
            y: y - wall.start_y
        };

        const wallLengthSquared = wallVector.x * wallVector.x + wallVector.y * wallVector.y;
        if (wallLengthSquared === 0) return null;

        const t = Math.max(0, Math.min(1,
            (pointVector.x * wallVector.x + pointVector.y * wallVector.y) / wallLengthSquared
        ));

        return {
            x: wall.start_x + t * wallVector.x,
            y: wall.start_y + t * wallVector.y
        };
    };

    // Calculate the intersection
    const calculateIntersection = (wall1Start, wall1End, wall2Start, wall2End) => {
        const denominator = ((wall2End.y - wall2Start.y) * (wall1End.x - wall1Start.x)) -
                        ((wall2End.x - wall2Start.x) * (wall1End.y - wall1Start.y));
                        
        if (denominator === 0) return null;

        const ua = (((wall2End.x - wall2Start.x) * (wall1Start.y - wall2Start.y)) -
                ((wall2End.y - wall2Start.y) * (wall1Start.x - wall2Start.x))) / denominator;
        const ub = (((wall1End.x - wall1Start.x) * (wall1Start.y - wall2Start.y)) -
                ((wall1End.y - wall1Start.y) * (wall1Start.x - wall2Start.x))) / denominator;

        // Check if intersection occurs within both line segments
        if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
            return {
                x: wall1Start.x + (ua * (wall1End.x - wall1Start.x)),
                y: wall1Start.y + (ua * (wall1End.y - wall1Start.y))
            };
        }

        return null;
    };

    // Enhanced click handling with endpoint detection
    const handleCanvasClick = async (event) => {
        if (!isEditingMode) return;
    
        const { x, y } = getMousePos(event);
        const clickPoint = { x, y };
    
        if (currentMode === 'add-wall') {
            if (isDrawing) {
                setIsDrawing(false);
    
                if (tempWall) {
                    const startPoint = hoveredPoint || snapToClosestPoint(tempWall.start_x, tempWall.start_y);
                    let endPoint = hoveredPoint || snapToClosestPoint(x, y);
    
                    // Check if ending at an existing endpoint
                    const isEndingAtExistingEndpoint = walls.some((wall) =>
                        (Math.abs(wall.start_x - endPoint.x) < SNAP_THRESHOLD / scaleFactor &&
                         Math.abs(wall.start_y - endPoint.y) < SNAP_THRESHOLD / scaleFactor) ||
                        (Math.abs(wall.end_x - endPoint.x) < SNAP_THRESHOLD / scaleFactor &&
                         Math.abs(wall.end_y - endPoint.y) < SNAP_THRESHOLD / scaleFactor)
                    );
    
                    // Calculate the angle for snapping
                    const dx = endPoint.x - startPoint.x;
                    const dy = endPoint.y - startPoint.y;
                    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
                    // Snap to 90 degrees if within the threshold
                    if (Math.abs(angle - 90) <= 2 || Math.abs(angle + 90) <= 2) {
                        endPoint.x = startPoint.x; // Snap vertically
                    } else if (Math.abs(angle) <= 2 || Math.abs(angle - 180) <= 2) {
                        endPoint.y = startPoint.y; // Snap horizontally
                    }
    
                    let wallsToAdd = [];
                    let wallsToDelete = [];
    
                    const isStartingAtExistingEndpoint = walls.some((wall) =>
                        (wall.start_x === startPoint.x && wall.start_y === startPoint.y) ||
                        (wall.end_x === startPoint.x && wall.end_y === startPoint.y)
                    );
    
                    // Get reference wall properties
                    const getReferenceWall = () => {
                        const intersectingWall = walls.find(wall => 
                            calculateIntersection(
                                { x: wall.start_x, y: wall.start_y },
                                { x: wall.end_x, y: wall.end_y },
                                startPoint,
                                endPoint
                            )
                        );
    
                        if (intersectingWall) {
                            return {
                                height: intersectingWall.height,
                                thickness: intersectingWall.thickness
                            };
                        }
    
                        const connectedWall = walls.find(wall => 
                            (Math.abs(wall.start_x - startPoint.x) < SNAP_THRESHOLD / scaleFactor &&
                             Math.abs(wall.start_y - startPoint.y) < SNAP_THRESHOLD / scaleFactor) ||
                            (Math.abs(wall.end_x - startPoint.x) < SNAP_THRESHOLD / scaleFactor &&
                             Math.abs(wall.end_y - startPoint.y) < SNAP_THRESHOLD / scaleFactor)
                        );
    
                        if (connectedWall) {
                            return {
                                height: connectedWall.height,
                                thickness: connectedWall.thickness
                            };
                        }
    
                        return walls.length > 0 ? {
                            height: walls[0].height,
                            thickness: walls[0].thickness
                        } : null;
                    };
    
                    const wallProperties = getReferenceWall();
    
                    // Handle wall splitting
                    if (!isStartingAtExistingEndpoint) {
                        for (const wall of walls) {
                            const startSegmentPoint = snapToWallSegment(startPoint.x, startPoint.y, wall);
                            if (
                                startSegmentPoint &&
                                Math.hypot(startSegmentPoint.x - startPoint.x, startSegmentPoint.y - startPoint.y) <
                                    SNAP_THRESHOLD / scaleFactor
                            ) {
                                wallsToDelete.push(wall);
                
                                wallsToAdd.push({
                                    start_x: wall.start_x,
                                    start_y: wall.start_y,
                                    end_x: startPoint.x,
                                    end_y: startPoint.y,
                                    height: wall.height,
                                    thickness: wall.thickness,
                                    application_type: wall.application_type
                                });
                
                                wallsToAdd.push({
                                    start_x: startPoint.x,
                                    start_y: startPoint.y,
                                    end_x: wall.end_x,
                                    end_y: wall.end_y,
                                    height: wall.height,
                                    thickness: wall.thickness,
                                    application_type: wall.application_type
                                });
                            }
                        }
                    }
    
                    if (!isEndingAtExistingEndpoint) {
                        for (const wall of walls) {
                            if (wallsToDelete.includes(wall)) continue;
    
                            const endSegmentPoint = snapToWallSegment(endPoint.x, endPoint.y, wall);
                            if (
                                endSegmentPoint &&
                                Math.hypot(endSegmentPoint.x - endPoint.x, endSegmentPoint.y - endPoint.y) <
                                    SNAP_THRESHOLD / scaleFactor
                            ) {
                                wallsToDelete.push(wall);
    
                                wallsToAdd.push({
                                    start_x: wall.start_x,
                                    start_y: wall.start_y,
                                    end_x: endPoint.x,
                                    end_y: endPoint.y,
                                    height: wall.height,
                                    thickness: wall.thickness,
                                    application_type: wall.application_type
                                });
    
                                wallsToAdd.push({
                                    start_x: endPoint.x,
                                    start_y: endPoint.y,
                                    end_x: wall.end_x,
                                    end_y: wall.end_y,
                                    height: wall.height,
                                    thickness: wall.thickness,
                                    application_type: wall.application_type
                                });
                            }
                        }
                    }
    
                    // Add the new wall regardless of endpoint conditions
                    if (wallProperties && 
                        (startPoint.x !== endPoint.x || startPoint.y !== endPoint.y)) {
                        wallsToAdd.push({
                            start_x: startPoint.x,
                            start_y: startPoint.y,
                            end_x: endPoint.x,
                            end_y: endPoint.y,
                            height: wallProperties.height,
                            thickness: wallProperties.thickness,
                            application_type: onWallTypeSelect
                        });
                    }
    
                    try {
                        const createdWalls = [];
                        for (const wallData of wallsToAdd) {
                            const newWall = await onNewWall(wallData);
                            createdWalls.push(newWall);
                        }
    
                        for (const wall of wallsToDelete) {
                            if (wall.id) {
                                await onWallDelete(wall.id);
                            }
                        }
    
                        const remainingWalls = walls.filter((wall) => !wallsToDelete.includes(wall));
                        const updatedWalls = [...remainingWalls, ...createdWalls];
                        setWalls(updatedWalls);
                    } catch (error) {
                        console.error('Error managing walls:', error);
                    }
    
                    setTempWall(null);
                }
            } else {
                const snappedStart = hoveredPoint || snapToClosestPoint(x, y);
                setIsDrawing(true);
                setTempWall({
                    start_x: snappedStart.x,
                    start_y: snappedStart.y,
                    end_x: snappedStart.x,
                    end_y: snappedStart.y,
                });
            }
        } 
        else if (currentMode === 'edit-wall') {
            let selectedIndex = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor;
    
            walls.forEach((wall, index) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                if (segmentPoint) {
                    const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                    if (distance < minDistance) {
                        minDistance = distance;
                        selectedIndex = index;
                    }
                }
            });
    
            setSelectedWall(selectedIndex);
            onWallSelect(selectedIndex);
        } 
        if (currentMode === 'define-room') {
            let selectedIndex = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor;

            for (const room of rooms) {
                const roomWalls = room.walls.map(wallId => 
                    walls.find(w => w.id === wallId)
                ).filter(Boolean);
                
                const areaPoints = calculateRoomArea(roomWalls);
                if (areaPoints && isPointInPolygon(clickPoint, areaPoints)) {
                    onRoomSelect(room.id);
                    return;
                }
            }
            
            walls.forEach((wall, index) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                if (segmentPoint) {
                    const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                    if (distance < minDistance) {
                        minDistance = distance;
                        selectedIndex = index;
                    }
                }
            });

            if (selectedIndex !== null) {
                const clickedWall = walls[selectedIndex];
                const updatedSelection = [...selectedWallsForRoom];
                const wallIndex = updatedSelection.indexOf(clickedWall.id);
                
                if (wallIndex === -1) {
                    // Add wall to selection if not already selected
                    updatedSelection.push(clickedWall.id);
                } else {
                    // Remove wall from selection if already selected
                    updatedSelection.splice(wallIndex, 1);
                }
                
                onRoomWallsSelect(updatedSelection);
            }
        }
    }
    
    const handleMouseMove = (event) => {
        if (!isEditingMode) return;
    
        const { x, y } = getMousePos(event);
    
        // Endpoint Hover Detection
        let closestPoint = null;
        let minDistance = SNAP_THRESHOLD / scaleFactor;
    
        walls.forEach((wall) => {
            const points = [
                { x: wall.start_x, y: wall.start_y },
                { x: wall.end_x, y: wall.end_y },
            ];
            points.forEach((point) => {
                const distance = Math.hypot(point.x - x, point.y - y);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPoint = point;
                }
            });
        });
    
        setHoveredPoint(closestPoint);
    
        // Wall Hover Detection
        if (currentMode === 'add-wall' || currentMode === 'edit-wall' || currentMode ==='define-room') {
            let minWallDistance = SNAP_THRESHOLD / scaleFactor;
            let newHoveredWall = null;
    
            walls.forEach((wall, index) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                if (segmentPoint) {
                    const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                    if (distance < minWallDistance) {
                        minWallDistance = distance;
                        newHoveredWall = index;
                    }
                }
            });
    
            setHoveredWall(newHoveredWall);
        }
    
        // Update `tempWall` if in drawing mode
        if (isDrawing && tempWall && currentMode === 'add-wall') {
            const snappedPoint = snapToClosestPoint(x, y);
            let adjustedX = snappedPoint ? snappedPoint.x : x;
            let adjustedY = snappedPoint ? snappedPoint.y : y;
    
            // Calculate angle for snapping
            const dx = adjustedX - tempWall.start_x;
            const dy = adjustedY - tempWall.start_y;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
            // Snapping to 90 degrees
            if (Math.abs(angle - 90) <= 2 || Math.abs(angle + 90) <= 2) {
                adjustedX = tempWall.start_x; // Snap vertically
            } else if (Math.abs(angle) <= 2 || Math.abs(angle - 180) <= 2) {
                adjustedY = tempWall.start_y; // Snap horizontally
            }
    
            setTempWall({
                ...tempWall,
                end_x: adjustedX,
                end_y: adjustedY,
            });
        }
    };
    
    return (
        <div className="flex flex-col items-center gap-4">
            <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                tabIndex={0}
                className="border border-gray-300 bg-gray-50"
            />
        </div>
    );
};

export default Canvas2D;