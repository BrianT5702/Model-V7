import React, { useEffect, useRef, useState } from 'react';
import api from '../api/api';

const Canvas2D = ({ 
    walls = [], 
    setWalls, 
    projectId,
    joints = [],
    onNewWall, 
    onWallTypeSelect,
    isEditingMode, 
    currentMode, 
    onWallSelect, 
    onWallDelete, 
    selectedWallsForRoom = [], 
    onRoomWallsSelect = () => {},
    onRoomSelect = () => {},
    rooms = [],
    onJointsUpdate
}) => {

    const canvasRef = useRef(null);
    const [selectedWall, setSelectedWall] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tempWall, setTempWall] = useState(null);
    const [hoveredWall, setHoveredWall] = useState(null);
    const [hoveredPoint, setHoveredPoint] = useState(null);
    const [currentScaleFactor, setCurrentScaleFactor] = useState(1);
    const [intersections, setIntersections] = useState([]);
    const [selectedIntersection, setSelectedIntersection] = useState(null);
    const [joiningMethod, setJoiningMethod] = useState("butt_in");
    const [highlightWalls, setHighlightWalls] = useState([]);
    const [selectedJointPair, setSelectedJointPair] = useState(null);

    const SNAP_THRESHOLD = 10;
    const FIXED_GAP = 2.5; // Fixed gap in pixels for double-line walls
    const gridSize = 50;
    
    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const scaleFactor = useRef(1);

    //start here about the room area defining
    const calculateRoomArea = (roomWalls) => {
        if (!roomWalls || roomWalls.length < 3) return null;

        // Calculate ROOM_INSET using current scale factor
        const ROOM_INSET = FIXED_GAP / currentScaleFactor + 150;
    
        // Create a map of wall thicknesses for each segment
        const wallThicknessMap = new Map();
        roomWalls.forEach(wall => {
            const key = `${wall.start_x},${wall.start_y}-${wall.end_x},${wall.end_y}`;
            const reverseKey = `${wall.end_x},${wall.end_y}-${wall.start_x},${wall.start_y}`;
            wallThicknessMap.set(key, wall.thickness);
            wallThicknessMap.set(reverseKey, wall.thickness);
        });
    
        // Get ordered points and pass the thickness map
        const points = getOrderedPoints(roomWalls);
        return calculateInsetPoints(points, ROOM_INSET);
    };
    
    const getOrderedPoints = (roomWalls) => {
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
    };
    
    const calculateInsetPoints = (points, insetDistance) => {
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
            if (bisectorLen > 0) {
                insetPoints.push({
                    x: curr.x + (bisector.x / bisectorLen) * offsetDist,
                    y: curr.y + (bisector.y / bisectorLen) * offsetDist
                });
            } else {
                // Fallback for collinear points
                const avgNormal = {
                    x: (n1.x + n2.x) / 2,
                    y: (n1.y + n2.y) / 2
                };
                insetPoints.push({
                    x: curr.x + avgNormal.x * insetDistance,
                    y: curr.y + avgNormal.y * insetDistance
                });
            }
        }
    
        return insetPoints;
    };

    //room defining ends here (but got problem, nid futher improvement on the logic)

    //This is to get the center of the area
    const calculatePolygonVisualCenter = (points) => {
        if (!points || points.length < 3) return null;

        // If it's a simple rectangle/square (4 points), use regular center
        if (points.length === 4) {
            return {
                x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
                y: points.reduce((sum, p) => sum + p.y, 0) / points.length
            };
        }

        // For L-shaped or irregular rooms, use the centroid of the largest inscribed circle
        // First, triangulate the polygon
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
                    
                    // Check if this ear is valid
                    const isEar = isValidEar(a, b, c, V);
                    
                    if (isEar) {
                        triangles.push([a, b, c]);
                        V.splice((i + 1) % V.length, 1);
                        break;
                    }
                }
            }
            
            if (V.length === 3) {
                triangles.push(V);
            }
            
            return triangles;
        };

        const isValidEar = (a, b, c, vertices) => {
            // Check if triangle abc contains any other vertices
            for (const v of vertices) {
                if (v === a || v === b || v === c) continue;
                
                if (isPointInTriangle(v, a, b, c)) {
                    return false;
                }
            }
            return true;
        };

        const isPointInTriangle = (p, a, b, c) => {
            const area = 0.5 * (-b.y * c.x + a.y * (-b.x + c.x) + a.x * (b.y - c.y) + b.x * c.y);
            const s = 1 / (2 * area) * (a.y * c.x - a.x * c.y + (c.y - a.y) * p.x + (a.x - c.x) * p.y);
            const t = 1 / (2 * area) * (a.x * b.y - a.y * b.x + (a.y - b.y) * p.x + (b.x - a.x) * p.y);
            
            return s >= 0 && t >= 0 && (1 - s - t) >= 0;
        };

        // Calculate centroid of largest triangle
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
    };

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
        const sf = Math.min(
            (canvas.width - 2 * padding) / wallWidth,
            (canvas.height - 2 * padding) / wallHeight
        );

        scaleFactor.current = sf;
        setCurrentScaleFactor(sf);

        offsetX.current = (canvas.width - wallWidth * sf) / 2 - minX * sf;
        offsetY.current = (canvas.height - wallHeight * sf) / 2 - minY * sf;

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
                const roomWalls = room.walls.map(wallId => 
                    walls.find(w => w.id === wallId)
                ).filter(Boolean);
        
                const areaPoints = calculateRoomArea(roomWalls);
                if (!areaPoints) return;
        
                // Draw room area (same as before)
                context.beginPath();
                context.moveTo(
                    areaPoints[0].x * scaleFactor.current + offsetX.current,
                    areaPoints[0].y * scaleFactor.current + offsetY.current
                );
        
                for (let i = 1; i < areaPoints.length; i++) {
                    context.lineTo(
                        areaPoints[i].x * scaleFactor.current + offsetX.current,
                        areaPoints[i].y * scaleFactor.current + offsetY.current
                    );
                }
        
                context.closePath();
                context.fillStyle = 'rgba(76, 175, 80, 0.5)';
                context.fill();
                context.strokeStyle = 'rgba(76, 175, 80, 0.8)';
                context.lineWidth = 2;
                context.stroke();
        
                // Calculate better center position using the new function
                const center = calculatePolygonVisualCenter(areaPoints);
                if (!center) return;
        
                // Draw the room name with the new center position
                context.fillStyle = 'white';
                context.font = '14px Arial';
                const textMetrics = context.measureText(room.room_name);
                const padding = 4;
        
                context.fillRect(
                    center.x * scaleFactor.current + offsetX.current - textMetrics.width / 2 - padding,
                    center.y * scaleFactor.current + offsetY.current - 14 - padding,
                    textMetrics.width + padding * 2,
                    18 + padding * 2
                );
        
                context.fillStyle = '#000';
                context.textAlign = 'center';
                context.fillText(
                    room.room_name,
                    center.x * scaleFactor.current + offsetX.current,
                    center.y * scaleFactor.current + offsetY.current
                );
            });
        };
        //Room drawing end here

        const allIntersections = findIntersectionPointsBetweenWalls();
  
  // Merge with saved joints data
  const mergedIntersections = allIntersections.map(inter => ({
    ...inter,
    pairs: inter.pairs.map(pair => {
      // Find matching joint (check both wall order permutations)
      const joint = joints.find(j => 
        (j.wall_1 === pair.wall1.id && j.wall_2 === pair.wall2.id) ||
        (j.wall_1 === pair.wall2.id && j.wall_2 === pair.wall1.id)
      );
      
      return {
        ...pair,
        joining_method: joint?.joining_method || 'butt_in'
      };
    })
  }));

  setIntersections(mergedIntersections);

        // Wall drawing, including the hover through color change and the select color change, and also the dimension showing thing
        const drawWalls = () => {
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
            
                const numSlashes = Math.floor(wallLength * scaleFactor.current / spacing);
            
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
                    context.moveTo(x1 * scaleFactor.current + offsetX.current, y1 * scaleFactor.current + offsetY.current);
                    context.lineTo(x2 * scaleFactor.current + offsetX.current, y2 * scaleFactor.current + offsetY.current);
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
                    x * scaleFactor.current + offsetX.current,
                    y * scaleFactor.current + offsetY.current,
                    size,
                    0,
                    2 * Math.PI
                );
                context.fillStyle = color;
                context.fill();
            };            

            // Wall Dimensions display in here, if got problem change here
            const drawDimensions = (startX, startY, endX, endY, color = 'blue') => {
                const midX = ((startX + endX) / 2) * scaleFactor.current + offsetX.current;
                const midY = ((startY + endY) / 2) * scaleFactor.current + offsetY.current;
                const length = Math.sqrt(
                    Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
                );
            
                context.save();
                context.fillStyle = color;
                context.font = '15px Arial';
                const text = `${Math.round(length)} mm`;
                const textWidth = context.measureText(text).width;
            
                // Check if the wall is more horizontal or vertical
                const dx = endX - startX;
                const dy = endY - startY;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            
                if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
                    // **Horizontal wall**
                    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    context.fillRect(midX - textWidth / 2 - 2, midY - 8, textWidth + 4, 16);
            
                    context.fillStyle = color;
                    context.fillText(text, midX - textWidth / 2, midY + 4);
                } else {
                    // **Vertical wall**
                    context.translate(midX, midY);
                    context.rotate(-Math.PI / 2); // Rotate text to be vertical
            
                    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    context.fillRect(-textWidth / 2 - 2, -8, textWidth + 4, 16);
            
                    context.fillStyle = color;
                    context.fillText(text, -textWidth / 2, 4);
            
                    context.restore();
                }
            
                context.restore();
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
                        { x: x1 + offsetX / scaleFactor.current, y: y1 + offsetY / scaleFactor.current },
                        { x: x2 + offsetX / scaleFactor.current, y: y2 + offsetY / scaleFactor.current },
                    ],
                    line2: [
                        { x: x1 - offsetX / scaleFactor.current, y: y1 - offsetY / scaleFactor.current },
                        { x: x2 - offsetX / scaleFactor.current, y: y2 - offsetY / scaleFactor.current },
                    ],
                };
            };

            // Draw existing walls
            walls.forEach((wall, index) => {
                const isHighlighted = highlightWalls.includes(wall.id);
                const wallColor = 
                    isHighlighted ? '#FF4081' :  // Pink for highlighted joint walls (higher priority)
                    selectedWallsForRoom.includes(wall.id) ? '#4CAF50' : // Green for room selection
                    selectedWall === index ? 'red' : // Red for selected wall
                    hoveredWall === index ? '#2196F3' :  // Blue for hovered wall
                    wall.application_type === "partition" ? "#666" : "#333"; // Default colors
            
                const { line1, line2 } = calculateOffsetPoints(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    FIXED_GAP
                );

                // Draw the first line of the wall
                context.beginPath();
                context.moveTo(
                    line1[0].x * scaleFactor.current + offsetX.current,
                    line1[0].y * scaleFactor.current + offsetY.current
                );
                context.lineTo(
                    line1[1].x * scaleFactor.current + offsetX.current,
                    line1[1].y * scaleFactor.current + offsetY.current
                );
                context.strokeStyle = wallColor;
                context.lineWidth = 2;
                context.stroke();

                // Draw the second line of the wall
                context.beginPath();
                context.moveTo(
                    line2[0].x * scaleFactor.current + offsetX.current,
                    line2[0].y * scaleFactor.current + offsetY.current
                );
                context.lineTo(
                    line2[1].x * scaleFactor.current + offsetX.current,
                    line2[1].y * scaleFactor.current + offsetY.current
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
                    line1[0].x * scaleFactor.current + offsetX.current,
                    line1[0].y * scaleFactor.current + offsetY.current
                );
                context.lineTo(
                    line1[1].x * scaleFactor.current + offsetX.current,
                    line1[1].y * scaleFactor.current + offsetY.current
                );
                context.strokeStyle = '#4CAF50'; // Green for temporary walls
                context.lineWidth = 2;
                context.setLineDash([5, 5]);
                context.stroke();

                // Draw the second line of the temporary wall
                context.beginPath();
                context.moveTo(
                    line2[0].x * scaleFactor.current + offsetX.current,
                    line2[0].y * scaleFactor.current + offsetY.current
                );
                context.lineTo(
                    line2[1].x * scaleFactor.current + offsetX.current,
                    line2[1].y * scaleFactor.current + offsetY.current
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
                        tempWall.end_x * scaleFactor.current + offsetX.current,
                        tempWall.end_y * scaleFactor.current + offsetY.current
                    );
                    context.lineTo(
                        snapPoint.x * scaleFactor.current + offsetX.current,
                        snapPoint.y * scaleFactor.current + offsetY.current
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
    }, [walls, selectedWall, tempWall, isDrawing, hoveredWall, selectedWallsForRoom, rooms, highlightWalls, joints]);

    //Use for getting correct mouse position
    const getMousePos = (event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const x = (event.clientX - rect.left - offsetX.current) / scaleFactor.current;
        const y = (event.clientY - rect.top - offsetY.current) / scaleFactor.current;
        return { x, y };
    };    

    // Enhanced snapping with wall continuation
    const snapToClosestPoint = (x, y) => {
        let closestPoint = { x, y }; // Default to the provided point
        let minDistance = SNAP_THRESHOLD / scaleFactor.current;
    
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

    const findIntersectionPointsBetweenWalls = () => {
        const map = new Map();
    
        for (let i = 0; i < walls.length; i++) {
            for (let j = i + 1; j < walls.length; j++) {
                const wallA = walls[i];
                const wallB = walls[j];
    
                const intersection = calculateIntersection(
                    { x: wallA.start_x, y: wallA.start_y },
                    { x: wallA.end_x, y: wallA.end_y },
                    { x: wallB.start_x, y: wallB.start_y },
                    { x: wallB.end_x, y: wallB.end_y }
                );
    
                if (intersection) {
                    const key = `${Math.round(intersection.x)}-${Math.round(intersection.y)}`;
                    if (!map.has(key)) {
                        map.set(key, {
                            x: intersection.x,
                            y: intersection.y,
                            pairs: []
                        });
                    }
                    map.get(key).pairs.push({ wall1: wallA, wall2: wallB });
                }
            }
        }
    
        return Array.from(map.values());
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
    
        if (currentMode !== 'add-wall' && currentMode !== 'edit-wall' && currentMode !== 'define-room') {
            for (const inter of intersections) {
                const distance = Math.hypot(inter.x - x, inter.y - y);
                if (distance < SNAP_THRESHOLD / scaleFactor.current) {
                    setSelectedIntersection(inter);
                    setJoiningMethod("butt_in");
                    return; // Skip further processing
                }
            }
        }
    
        if (currentMode === 'add-wall') {
            if (isDrawing) {
                setIsDrawing(false);
    
                if (tempWall) {
                    const startPoint = snapToClosestPoint(tempWall.start_x, tempWall.start_y);
                    let endPoint = hoveredPoint || snapToClosestPoint(x, y);
                    console.log(startPoint.x, ", ", startPoint.y)
                    console.log(endPoint.x, ", ", endPoint.y)
    
                    // Check if the endpoint matches an existing endpoint of any wall
                    const isEndingAtExistingEndpoint = walls.some((wall) =>
                        (Math.abs(wall.start_x - endPoint.x) < SNAP_THRESHOLD / scaleFactor.current &&
                        Math.abs(wall.start_y - endPoint.y) < SNAP_THRESHOLD / scaleFactor.current) ||
                        (Math.abs(wall.end_x - endPoint.x) < SNAP_THRESHOLD / scaleFactor.current &&
                        Math.abs(wall.end_y - endPoint.y) < SNAP_THRESHOLD / scaleFactor.current)
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
                            (Math.abs(wall.start_x - startPoint.x) < SNAP_THRESHOLD / scaleFactor.current &&
                             Math.abs(wall.start_y - startPoint.y) < SNAP_THRESHOLD / scaleFactor.current) ||
                            (Math.abs(wall.end_x - startPoint.x) < SNAP_THRESHOLD / scaleFactor.current &&
                             Math.abs(wall.end_y - startPoint.y) < SNAP_THRESHOLD / scaleFactor.current)
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
    
                    if (!isStartingAtExistingEndpoint) {
                        for (const wall of walls) {
                            const startSegmentPoint = snapToWallSegment(startPoint.x, startPoint.y, wall);
                            if (
                                startSegmentPoint &&
                                Math.hypot(startSegmentPoint.x - startPoint.x, startSegmentPoint.y - startPoint.y) <
                                    SNAP_THRESHOLD / scaleFactor.current
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

                    // Handle wall splitting only if the endpoint is not at an existing endpoint
                    if (!isEndingAtExistingEndpoint) {
                        for (const wall of walls) {
                            if (wallsToDelete.includes(wall)) continue;

                            const endSegmentPoint = snapToWallSegment(endPoint.x, endPoint.y, wall);
                            if (
                                endSegmentPoint &&
                                Math.hypot(endSegmentPoint.x - endPoint.x, endSegmentPoint.y - endPoint.y) <
                                    SNAP_THRESHOLD / scaleFactor.current
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

                    // Ensure the new wall is added regardless of splitting
                    if (wallProperties && (startPoint.x !== endPoint.x || startPoint.y !== endPoint.y)) {
                        // Check for mid intersections between new wall and existing walls
                        const newWallStart = { x: startPoint.x, y: startPoint.y };
                        const newWallEnd = { x: endPoint.x, y: endPoint.y };
                        const midIntersections = [];
                    
                        walls.forEach(existingWall => {
                            if (wallsToDelete.includes(existingWall)) return;
                    
                            const intersection = calculateIntersection(
                                newWallStart,
                                newWallEnd,
                                { x: existingWall.start_x, y: existingWall.start_y },
                                { x: existingWall.end_x, y: existingWall.end_y }
                            );
                            if (intersection) {
                                const isNewWallStart = arePointsEqual(intersection, newWallStart);
                                const isNewWallEnd = arePointsEqual(intersection, newWallEnd);
                                const isExistingWallStart = arePointsEqual(intersection, { x: existingWall.start_x, y: existingWall.start_y });
                                const isExistingWallEnd = arePointsEqual(intersection, { x: existingWall.end_x, y: existingWall.end_y });
                                
                                if (!isNewWallStart && !isNewWallEnd && !isExistingWallStart && !isExistingWallEnd) {
                                    midIntersections.push({
                                        point: intersection,
                                        existingWall: existingWall
                                    });
                                }
                            }
                        });
                    
                        // Sort intersections along the new wall's direction
                        midIntersections.sort((a, b) => {
                            const distA = calculateDistance(newWallStart, a.point);
                            const distB = calculateDistance(newWallStart, b.point);
                            return distA - distB;
                        });
                    
                        // Split the new wall into segments
                        let currentStart = newWallStart;
                        const newWallSegments = [];
                        for (const inter of midIntersections) {
                            newWallSegments.push({
                                start_x: currentStart.x,
                                start_y: currentStart.y,
                                end_x: inter.point.x,
                                end_y: inter.point.y,
                                height: wallProperties.height,
                                thickness: wallProperties.thickness,
                                application_type: onWallTypeSelect
                            });
                            currentStart = inter.point;
                        }
                        newWallSegments.push({
                            start_x: currentStart.x,
                            start_y: currentStart.y,
                            end_x: newWallEnd.x,
                            end_y: newWallEnd.y,
                            height: wallProperties.height,
                            thickness: wallProperties.thickness,
                            application_type: onWallTypeSelect
                        });
                    
                        // Add the split new wall segments
                        wallsToAdd.push(...newWallSegments);
                    
                        // Split existing walls at mid intersections
                        midIntersections.forEach(inter => {
                            const existingWall = inter.existingWall;
                            if (!wallsToDelete.includes(existingWall)) {
                                wallsToDelete.push(existingWall);
                                wallsToAdd.push({
                                    ...existingWall,
                                    end_x: inter.point.x,
                                    end_y: inter.point.y
                                });
                                wallsToAdd.push({
                                    ...existingWall,
                                    start_x: inter.point.x,
                                    start_y: inter.point.y,
                                    end_x: existingWall.end_x,
                                    end_y: existingWall.end_y
                                });
                            }
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
            let minDistance = SNAP_THRESHOLD / scaleFactor.current;
    
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
            let minDistance = SNAP_THRESHOLD / scaleFactor.current;

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

    const arePointsEqual = (p1, p2, epsilon = 0.001) => {
        return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon;
    };
    
    const calculateDistance = (p1, p2) => {
        return Math.hypot(p2.x - p1.x, p2.y - p1.y);
    };    
    
    const handleMouseMove = (event) => {
        if (!isEditingMode) return;

        const { x, y } = getMousePos(event);

        // Endpoint Hover Detection
        let closestPoint = null;
        let minDistance = SNAP_THRESHOLD / scaleFactor.current;
    
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
            let minWallDistance = SNAP_THRESHOLD / scaleFactor.current;
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
            {selectedIntersection && (
            <div className="fixed inset-0 bg-black bg-opacity-10 flex justify-end items-start z-50"> {/* Changed to items-start and justify-end */}
                <div className="bg-white p-4 rounded-lg shadow-lg m-4 max-w-md w-full"> {/* Added margin and reduced padding */}
                <div className="flex justify-between items-center mb-3">
                    <h2 className="text-lg font-semibold">Configure Joints</h2>
                    <button 
                    onClick={() => {
                        setSelectedIntersection(null);
                        setHighlightWalls([]);
                        setSelectedJointPair(null);
                    }}
                    className="text-gray-500 hover:text-gray-700"
                    >
                    ×
                    </button>
                </div>
                <div className="overflow-y-auto max-h-[70vh]"> {/* Add scroll for many joints */}
                    {selectedIntersection.pairs.map((pair, index) => (
                    <div
                        key={index}
                        onClick={() => {
                        setSelectedJointPair(index);
                        setHighlightWalls([pair.wall1.id, pair.wall2.id]);
                        }}
                        className={`mb-2 p-2 rounded cursor-pointer transition-colors ${
                        selectedJointPair === index 
                            ? 'bg-blue-50 border border-blue-200' 
                            : 'hover:bg-gray-100'
                        }`}
                    >
                    <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-400" />
                    <span className="font-medium">Wall {pair.wall1.id}</span>
                    <div className="mx-2">↔</div>
                    <div className="w-3 h-3 rounded-full bg-blue-400" />
                    <span className="font-medium">Wall {pair.wall2.id}</span>
                    </div>
                    <select
                    value={pair.joining_method || 'butt_in'}
                    onChange={(e) => {
                        const updated = [...selectedIntersection.pairs];
                        updated[index].joining_method = e.target.value;
                        setSelectedIntersection({ ...selectedIntersection, pairs: updated });
                    }}
                    className="w-full mt-2 px-2 py-1 border border-gray-300 rounded"
                    >
                    <option value="butt_in">Butt-in</option>
                    <option value="45_cut">45° Cut</option>
                    </select>
                </div>
                ))}
                <div className="flex justify-end gap-2 mt-4">
                <button
                    className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                    onClick={() => {
                        setSelectedIntersection(null);
                        setHighlightWalls([]);
                        setSelectedJointPair(null);
                    }}
                    >
                    Cancel
                    </button>
                    <button
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    onClick={async () => {
                        try {
                            for (const pair of selectedIntersection.pairs) {
                                const payload = {
                                    project: projectId,
                                    wall_1: pair.wall1.id,
                                    wall_2: pair.wall2.id,
                                    joining_method: pair.joining_method || 'butt_in'
                                };
                                await api.post('/intersections/set_joint/', payload);
                            }
                            
                            // Refresh intersections data after saving
                            const response = await api.get(`/intersections/?projectid=${projectId}`);
                            onJointsUpdate(response.data);  // Update parent state
                            
                            alert("All joints saved!");
                            setSelectedIntersection(null);
                            setHighlightWalls([]);
                            setSelectedJointPair(null);
                        } catch (error) {
                            alert("Failed to save joint types.");
                            console.error(error);
                        }
                    }}
                    >
                    Save All
                    </button>
                </div>
                </div>
            </div>
            </div>
            )}
        </div>
    );
};

export default Canvas2D;