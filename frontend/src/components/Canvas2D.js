import React, { useEffect, useRef, useState } from 'react';

const Canvas2D = ({ walls, setWalls, onWallUpdate, onNewWall, isEditingMode, currentMode }) => {
    const canvasRef = useRef(null);
    const [selectedWall, setSelectedWall] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tempWall, setTempWall] = useState(null);
    const [wallHistory, setWallHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [lastClickedEndpoint, setLastClickedEndpoint] = useState(null);
    const [hoveredWall, setHoveredWall] = useState(null);

    const SCALE_FACTOR = 0.1;
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
            const canvas = canvasRef.current;
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
            drawGrid();
    
            // Helper function to draw wall endpoints
            const drawEndpoints = (x, y, color = 'blue', size = 4) => {
                context.beginPath();
                context.arc(
                    x * scaleFactor + offsetX,
                    y * scaleFactor + offsetY,
                    size, 0, 2 * Math.PI
                );
                context.fillStyle = color;
                context.fill();
            };
    
            // Helper function to draw wall dimensions
            const drawDimensions = (startX, startY, endX, endY, color = 'blue') => {
                const midX = ((startX + endX) / 2) * scaleFactor + offsetX;
                const midY = ((startY + endY) / 2) * scaleFactor + offsetY;
                const length = Math.sqrt(
                    Math.pow(endX - startX, 2) +
                    Math.pow(endY - startY, 2)
                );
                
                context.fillStyle = color;
                context.font = '12px Arial';
                const text = `${Math.round(length)} mm`;
                const textWidth = context.measureText(text).width;
                
                // Add background to text for better visibility
                context.fillStyle = 'rgba(255, 255, 255, 0.8)';
                context.fillRect(
                    midX - textWidth/2 - 2,
                    midY - 8,
                    textWidth + 4,
                    16
                );
                
                context.fillStyle = color;
                context.fillText(text, midX - textWidth/2, midY + 4);
            };
    
            // Draw existing walls
            walls.forEach((wall, index) => {
                // Draw wall line
                context.beginPath();
                context.moveTo(
                    wall.start_x * scaleFactor + offsetX,
                    wall.start_y * scaleFactor + offsetY
                );
                context.lineTo(
                    wall.end_x * scaleFactor + offsetX,
                    wall.end_y * scaleFactor + offsetY
                );
                
                // Wall styling based on state
                if (selectedWall === index) {
                    context.strokeStyle = 'red';
                    context.lineWidth = 3;
                } else if (hoveredWall === index) {
                    context.strokeStyle = '#2196F3'; // Material Blue
                    context.lineWidth = 2.5;
                } else {
                    context.strokeStyle = '#333333'; // Darker gray for better contrast
                    context.lineWidth = 2;
                }
                context.stroke();
    
                // Draw endpoints with different colors based on wall state
                const endpointColor = selectedWall === index ? 'red' : '#2196F3';
                drawEndpoints(wall.start_x, wall.start_y, endpointColor);
                drawEndpoints(wall.end_x, wall.end_y, endpointColor);
    
                // Draw dimensions
                drawDimensions(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    selectedWall === index ? 'red' : '#2196F3'
                );
            });
    
            // Draw temporary wall with enhanced visual feedback
            if (tempWall) {
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
    
                // Draw temporary wall
                context.beginPath();
                context.moveTo(
                    tempWall.start_x * scaleFactor + offsetX,
                    tempWall.start_y * scaleFactor + offsetY
                );
                context.lineTo(
                    tempWall.end_x * scaleFactor + offsetX,
                    tempWall.end_y * scaleFactor + offsetY
                );
                context.strokeStyle = '#4CAF50'; // Material Green
                context.lineWidth = 2;
                context.setLineDash([5, 5]);
                context.stroke();
                context.setLineDash([]);
    
                // Draw temporary wall endpoints
                drawEndpoints(tempWall.start_x, tempWall.start_y, '#4CAF50');
                drawEndpoints(tempWall.end_x, tempWall.end_y, '#4CAF50');
    
                // Draw dimensions for temporary wall
                drawDimensions(
                    tempWall.start_x,
                    tempWall.start_y,
                    tempWall.end_x,
                    tempWall.end_y,
                    '#4CAF50'
                );
    
                // Draw intersection points if any
                const { intersection } = findClosestIntersection(
                    { x: tempWall.start_x, y: tempWall.start_y },
                    { x: tempWall.end_x, y: tempWall.end_y }
                );
                if (intersection) {
                    drawEndpoints(intersection.x, intersection.y, '#FF9800', 6); // Orange for intersection points
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
        let closestPoint = snapToGrid(x, y);
        let minDistance = SNAP_THRESHOLD / scaleFactor;

        // Check endpoints first
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

        // Check wall segments
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

    const snapToGrid = (x, y) => ({
        x: Math.round(x / gridSize) * gridSize,
        y: Math.round(y / gridSize) * gridSize
    });

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

    // Function to find the closest intersection point
    const findClosestIntersection = (startPoint, endPoint) => {
        let closestIntersection = null;
        let minDistance = Infinity;
        let intersectingWall = null;

        walls.forEach((wall) => {
            const intersection = calculateIntersection(
                startPoint,
                endPoint,
                { x: wall.start_x, y: wall.start_y },
                { x: wall.end_x, y: wall.end_y }
            );

            if (intersection) {
                const distance = Math.hypot(
                    endPoint.x - intersection.x,
                    endPoint.y - intersection.y
                );

                if (distance < minDistance) {
                    minDistance = distance;
                    closestIntersection = intersection;
                    intersectingWall = wall;
                }
            }
        });

        return { intersection: closestIntersection, wall: intersectingWall };
    };

    // Enhanced click handling with endpoint detection
    const handleCanvasClick = (event) => {
        if (!isEditingMode) return; // Disable if editing mode is off
    
        const { x, y } = getMousePos(event);
    
        if (currentMode === 'add-wall') {
            // Logic for adding a wall
            if (isDrawing) {
                setIsDrawing(false);
    
                if (tempWall) {
                    const startPoint = snapToClosestPoint(tempWall.start_x, tempWall.start_y);
                    const endPoint = snapToClosestPoint(x, y);
    
                    const { intersection } = findClosestIntersection(startPoint, endPoint);
    
                    const finalWall = {
                        start_x: startPoint.x,
                        start_y: startPoint.y,
                        end_x: intersection ? intersection.x : endPoint.x,
                        end_y: intersection ? intersection.y : endPoint.y,
                    };
    
                    onNewWall(finalWall); // Notify parent of the new wall
                    setTempWall(null);
                    addToHistory([...walls, finalWall]); // Save to history
                }
            } else {
                const snappedStart = snapToClosestPoint(x, y);
                setIsDrawing(true);
                setTempWall({
                    start_x: snappedStart.x,
                    start_y: snappedStart.y,
                    end_x: snappedStart.x,
                    end_y: snappedStart.y,
                });
            }
        } else if (currentMode === 'edit-wall') {
            // Logic for selecting a wall
            let selectedIndex = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor;
    
            walls.forEach((wall, index) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
    
                if (distance < minDistance) {
                    minDistance = distance;
                    selectedIndex = index;
                }
            });
    
            setSelectedWall(selectedIndex); // Highlight the selected wall
        }
    };    

    const handleMouseMove = (event) => {
        if (!isEditingMode) return; // Disable interactions if editing mode is off
    
        const { x, y } = getMousePos(event);
    
        if (isDrawing && tempWall && currentMode === 'add-wall') {
            // Update temporary wall during drawing
            const snappedPoint = snapToClosestPoint(x, y);
            setTempWall({
                ...tempWall,
                end_x: snappedPoint.x,
                end_y: snappedPoint.y,
            });
        }
    
        // Check if hovering over a wall
        if (currentMode === 'add-wall' || currentMode === 'edit-wall') {
            let minDistance = SNAP_THRESHOLD / scaleFactor;
            let newHoveredWall = null;
    
            walls.forEach((wall, index) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
    
                if (distance < minDistance) {
                    minDistance = distance;
                    newHoveredWall = index;
                }
            });
    
            setHoveredWall(newHoveredWall);
        }
    
        if (currentMode === 'edit-wall' && selectedWall !== null) {
            // Move selected wall dynamically
            const wall = walls[selectedWall];
            const dx = x - wall.start_x;
            const dy = y - wall.start_y;
    
            const updatedWall = {
                ...wall,
                start_x: wall.start_x + dx,
                start_y: wall.start_y + dy,
                end_x: wall.end_x + dx,
                end_y: wall.end_y + dy,
            };
    
            const updatedWalls = walls.map((w, index) =>
                index === selectedWall ? updatedWall : w
            );
    
            setWalls(updatedWalls); // Update walls state
            onWallUpdate(updatedWalls); // Notify parent about the update
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