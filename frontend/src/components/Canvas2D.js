import React, { useEffect, useRef, useState } from 'react';

const Canvas2D = ({ walls, setWalls, onWallUpdate, onNewWall, isEditingMode, currentMode, onWallSelect, onWallDelete }) => {
    const canvasRef = useRef(null);
    const [selectedWall, setSelectedWall] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tempWall, setTempWall] = useState(null);
    const [wallHistory, setWallHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [hoveredWall, setHoveredWall] = useState(null);
    const [hoveredPoint, setHoveredPoint] = useState(null); // { x, y } or null

    const SNAP_THRESHOLD = 10;
    const gridSize = 50;
    
    let offsetX = 0;
    let offsetY = 0;
    let scaleFactor = 1;

    // New function to add to history
    const addToHistory = (newWalls) => {
        const newHistory = wallHistory.slice(0, historyIndex + 1);
        newHistory.push([...newWalls]);
        setWallHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    };

    // Undo function
    const handleUndo = () => {
        if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
            const previousWalls = wallHistory[historyIndex - 1];
            onWallUpdate(previousWalls);
        }
    };

    // Redo function
    const handleRedo = () => {
        if (historyIndex < wallHistory.length - 1) {
            setHistoryIndex(historyIndex + 1);
            const nextWalls = wallHistory[historyIndex + 1];
            onWallUpdate(nextWalls);
        }
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

        // Enhanced grid drawing with highlight during wall drawing
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

        // Enhanced wall drawing with hover effects
        const drawWalls = () => {
            const FIXED_GAP = 2; // Fixed gap in pixels for double-line walls
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
            drawGrid();

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

            // Helper function to draw wall dimensions
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
                    selectedWall === index
                        ? 'red'
                        : hoveredWall === index
                        ? '#2196F3' // Hovered wall color
                        : '#333333';

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

                // Draw intersection points if any
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

            // Draw temporary wall with enhanced visual feedback
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
        };        

        drawWalls();

        return () => {
            context.clearRect(0, 0, canvas.width, canvas.height);
        };
    }, [walls, selectedWall, tempWall, isDrawing, hoveredWall]);

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
    
        if (currentMode === 'add-wall') {
            if (isDrawing) {
                setIsDrawing(false);
    
                if (tempWall) {
                    const startPoint = hoveredPoint || snapToClosestPoint(tempWall.start_x, tempWall.start_y);
                    const endPoint = snapToClosestPoint(x, y);
    
                    let wallsToAdd = [];
                    let wallsToDelete = [];
    
                    const isStartingAtExistingEndpoint = walls.some((wall) =>
                        (wall.start_x === startPoint.x && wall.start_y === startPoint.y) ||
                        (wall.end_x === startPoint.x && wall.end_y === startPoint.y)
                    );
    
                    // Find a reference wall to get height and thickness
                    const getReferenceWall = () => {
                        // First try to get properties from an intersecting wall
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
                        
                        // If no intersecting wall, try to get properties from a connected wall
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
                        
                        // If no reference wall found, get properties from the first existing wall
                        return walls.length > 0 ? {
                            height: walls[0].height,
                            thickness: walls[0].thickness
                        } : null;
                    };

                    const wallProperties = getReferenceWall();
    
                    if (!isStartingAtExistingEndpoint) {
                        for (const wall of walls) {
                            const startSegmentPoint = snapToWallSegment(startPoint.x, startPoint.y, wall);
                            if (
                                startSegmentPoint &&
                                Math.hypot(startSegmentPoint.x - startPoint.x, startSegmentPoint.y - startPoint.y) <
                                    SNAP_THRESHOLD / scaleFactor
                            ) {
                                wallsToDelete.push(wall);
    
                                // Create two segments from the split at the start point
                                wallsToAdd.push({
                                    start_x: wall.start_x,
                                    start_y: wall.start_y,
                                    end_x: startPoint.x,
                                    end_y: startPoint.y,
                                    height: wall.height,
                                    thickness: wall.thickness
                                });
    
                                wallsToAdd.push({
                                    start_x: startPoint.x,
                                    start_y: startPoint.y,
                                    end_x: wall.end_x,
                                    end_y: wall.end_y,
                                    height: wall.height,
                                    thickness: wall.thickness
                                });
                            }
                        }
                    }
    
                    // Check for intersections along the new wall
                    for (const wall of walls) {
                        if (wallsToDelete.includes(wall)) continue;
    
                        const intersection = calculateIntersection(
                            { x: wall.start_x, y: wall.start_y },
                            { x: wall.end_x, y: wall.end_y },
                            startPoint,
                            endPoint
                        );
    
                        if (
                            intersection &&
                            !(Math.abs(intersection.x - startPoint.x) < SNAP_THRESHOLD / scaleFactor &&
                            Math.abs(intersection.y - startPoint.y) < SNAP_THRESHOLD / scaleFactor)
                        ) {
                            wallsToDelete.push(wall);
    
                            // Create two segments from the split
                            wallsToAdd.push({
                                start_x: wall.start_x,
                                start_y: wall.start_y,
                                end_x: intersection.x,
                                end_y: intersection.y,
                                height: wall.height,
                                thickness: wall.thickness
                            });
    
                            wallsToAdd.push({
                                start_x: intersection.x,
                                start_y: intersection.y,
                                end_x: wall.end_x,
                                end_y: wall.end_y,
                                height: wall.height,
                                thickness: wall.thickness
                            });
                        }
                    }
    
                    // Add the new connecting wall with properties from reference wall
                    if (wallProperties) {
                        wallsToAdd.push({
                            start_x: startPoint.x,
                            start_y: startPoint.y,
                            end_x: endPoint.x,
                            end_y: endPoint.y,
                            height: wallProperties.height,
                            thickness: wallProperties.thickness
                        });
                    }
    
                    try {
                        // First, create all new walls
                        const createdWalls = [];
                        for (const wallData of wallsToAdd) {
                            const newWall = await onNewWall(wallData);
                            createdWalls.push(newWall);
                        }
    
                        // Then, delete all walls that were split
                        for (const wall of wallsToDelete) {
                            if (wall.id) {
                                await onWallDelete(wall.id);
                            }
                        }
    
                        // Update local state with new walls
                        const remainingWalls = walls.filter((wall) => !wallsToDelete.includes(wall));
                        const updatedWalls = [...remainingWalls, ...createdWalls];
                        setWalls(updatedWalls);
                        addToHistory(updatedWalls);
    
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
        } else if (currentMode === 'edit-wall') {
            // Wall selection logic remains unchanged
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
    };  

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
        if (currentMode === 'add-wall' || currentMode === 'edit-wall') {
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
            if (snappedPoint) {
                setTempWall({
                    ...tempWall,
                    end_x: snappedPoint.x,
                    end_y: snappedPoint.y,
                });
            }
        }
    };         

    return (
        <div className="flex flex-col items-center gap-4">
            <div className="flex gap-2">
                <button
                    onClick={handleUndo}
                    disabled={historyIndex <= 0}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
                >
                    Undo
                </button>
                <button
                    onClick={handleRedo}
                    disabled={historyIndex >= wallHistory.length - 1}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
                >
                    Redo
                </button>
            </div>
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