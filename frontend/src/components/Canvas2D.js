import React, { useEffect, useRef, useState } from 'react';
import api from '../api/api';

const Canvas2D = ({ 
    walls = [], 
    setWalls, 
    projectId,
    project,
    joints = [],
    onNewWall, 
    onWallTypeSelect,
    isEditingMode, 
    currentMode, 
    onWallSelect, 
    onWallDelete, 
    selectedWallsForRoom = [], 
    onRoomWallsSelect,
    rooms = [],
    onJointsUpdate,
    doors = [],
    onDoorWallSelect,
    onDoorSelect = () => {},
    selectedRoomPoints = [],
    onUpdateRoomPoints = () => {},
    onRoomSelect
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
    const [selectedDoorId, setSelectedDoorId] = useState(null);
    const [hoveredDoorId, setHoveredDoorId] = useState(null);

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
            (canvas.width - 4 * padding) / wallWidth,
            (canvas.height - 4 * padding) / wallHeight
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
        
                const areaPoints = (room.room_points && room.room_points.length >= 3)
                    ? room.room_points
                    : calculateRoomArea(roomWalls);

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

        const drawRoomPreview = () => {
            if (selectedRoomPoints.length < 2) return;

            selectedRoomPoints.forEach(pt => {
                context.beginPath();
                context.arc(
                    pt.x * scaleFactor.current + offsetX.current,
                    pt.y * scaleFactor.current + offsetY.current,
                    4, 0, 2 * Math.PI
                );
                context.fillStyle = '#007bff';
                context.fill();
            });  
        
            context.beginPath();
            context.moveTo(
                selectedRoomPoints[0].x * scaleFactor.current + offsetX.current,
                selectedRoomPoints[0].y * scaleFactor.current + offsetY.current
            );
        
            for (let i = 1; i < selectedRoomPoints.length; i++) {
                context.lineTo(
                    selectedRoomPoints[i].x * scaleFactor.current + offsetX.current,
                    selectedRoomPoints[i].y * scaleFactor.current + offsetY.current
                );
            }          
        
            context.strokeStyle = 'rgba(0, 123, 255, 0.8)';
            context.lineWidth = 2;
            context.setLineDash([5, 5]);
            context.stroke();
            context.setLineDash([]);
        
            // Optionally fill with light transparent color
            context.fillStyle = 'rgba(0, 123, 255, 0.2)';
            context.fill();
        };

        const allIntersections = findIntersectionPointsBetweenWalls();
  
        // Merge with saved joints data

        const mergedIntersections = allIntersections.map(inter => ({
            ...inter,
            pairs: inter.pairs.map(pair => {
                const w1 = pair.wall1.id;
                const w2 = pair.wall2.id;
        
                // Find matching joint (check both wall orders)
                const joint = joints.find(j => 
                    (j.wall_1 === w1 && j.wall_2 === w2) || 
                    (j.wall_1 === w2 && j.wall_2 === w1)
                );
        
                return {
                    ...pair,
                    wall1: joint ? { id: joint.wall_1 } : pair.wall1,
                    wall2: joint ? { id: joint.wall_2 } : pair.wall2,
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

            const center = {
                x: project.width / 2,
                y: project.length / 2,
            };         

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
            const drawEndpoints = (x, y, color = 'blue', size = 2) => {
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
            
                // Check if the wall is more horizontal or vertical
                const dx = endX - startX;
                const dy = endY - startY;
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            
                if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
                    // **Horizontal wall**
                    midX = ((startX + endX) / 2) * scaleFactor.current + offsetX.current;
                    midY = ((startY + endY) / 2) * scaleFactor.current + offsetY.current - 15;
                    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    context.fillRect(midX - textWidth / 2 - 2, midY - 8, textWidth + 4, 16);
            
                    context.fillStyle = color;
                    context.fillText(text, midX - textWidth / 2, midY + 4);
                } else {
                    // **Vertical wall**
                    midX = ((startX + endX) / 2) * scaleFactor.current + offsetX.current + 15;
                    midY = ((startY + endY) / 2) * scaleFactor.current + offsetY.current;
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
            const calculateOffsetPoints = (x1, y1, x2, y2, gapPixels, center) => {
                const dx = x2 - x1;
                const dy = y2 - y1;
                const length = Math.sqrt(dx * dx + dy * dy);
            
                if (length === 0) {
                    return {
                        line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
                        line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
                    };
                }
            
                // Step 1: Get wall normal (perpendicular direction)
                const normalX = dy / length;
                const normalY = -dx / length;
            
                // Step 2: Get midpoint of wall
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;
            
                // Step 3: Direction from wall midpoint to model center
                const dirToCenterX = center.x - midX;
                const dirToCenterY = center.y - midY;
            
                // Step 4: Use dot product to determine offset direction
                const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
                const shouldFlip = dotProduct > 0;
            
                // Step 5: Apply offset
                const offsetX = (gapPixels * normalX) / scaleFactor.current;
                const offsetY = (gapPixels * normalY) / scaleFactor.current;
            
                const finalOffsetX = shouldFlip ? -offsetX : offsetX;
                const finalOffsetY = shouldFlip ? -offsetY : offsetY;
            
                return {
                    line1: [
                        { x: x1, y: y1 },
                        { x: x2, y: y2 },
                    ],
                    line2: [
                        { x: x1 - finalOffsetX *2 , y: y1 - finalOffsetY * 2},
                        { x: x2 - finalOffsetX *2 , y: y2 - finalOffsetY * 2},
                    ],
                };
            };

            const drawWallLinePair = (lines, color, dashPattern = []) => {
                context.strokeStyle = color;
                context.lineWidth = 2;
                context.setLineDash(dashPattern);
                lines.forEach(line => {
                    context.beginPath();
                    context.moveTo(
                        line[0].x * scaleFactor.current + offsetX.current,
                        line[0].y * scaleFactor.current + offsetY.current
                    );
                    context.lineTo(
                        line[1].x * scaleFactor.current + offsetX.current,
                        line[1].y * scaleFactor.current + offsetY.current
                    );
                    context.stroke();
                });
                context.setLineDash([]); // Reset dash
            };

            //draw double lined wall cap
            const drawWallCaps = (context, wall, joints, center) => {
                if (!wall._line1 || !wall._line2) return;
            
                const endpoints = [
                    { label: 'start', x: wall.start_x, y: wall.start_y },
                    { label: 'end', x: wall.end_x, y: wall.end_y }
                ];
            
                endpoints.forEach((pt) => {
                    const relevantIntersections = intersections.filter(inter => {
                        const dx = inter.x - pt.x;
                        const dy = inter.y - pt.y;
                        return Math.hypot(dx, dy) < SNAP_THRESHOLD / currentScaleFactor;
                    });
            
                    let joiningMethod = 'butt_in';
                    let isPrimaryWall = true;
            
                    relevantIntersections.forEach(inter => {
                        inter.pairs.forEach(pair => {
                            if (pair.wall1.id === wall.id || pair.wall2.id === wall.id) {
                                joiningMethod = pair.joining_method;
                                if (pair.wall2.id === wall.id) {
                                    isPrimaryWall = false;
                                }
                            }
                        });
                    });
            
                    if (joiningMethod === '45_cut' && !isPrimaryWall) {
                        return; // Avoid drawing duplicate cap from other wall
                    }
            
                    const cap1 = pt.label === 'start' ? wall._line1[0] : wall._line1[1];
                    const cap2 = pt.label === 'start' ? wall._line2[0] : wall._line2[1]; // ✅ already adjusted
            
                    context.beginPath();
                    context.moveTo(
                        cap1.x * scaleFactor.current + offsetX.current,
                        cap1.y * scaleFactor.current + offsetY.current
                    );
                    context.lineTo(
                        cap2.x * scaleFactor.current + offsetX.current,
                        cap2.y * scaleFactor.current + offsetY.current
                    );
            
                    context.strokeStyle = 'black';
                    context.setLineDash([]);
                    context.lineWidth = 1.5;
                    context.stroke();
                });
            };                                    

            // Draw existing walls
            walls.forEach((wall, index) => {
                const highlight = highlightWalls.find(h => h.id === wall.id);
                const wallColor = 
                highlight ? highlight.color :
                selectedWallsForRoom.includes(wall.id) ? '#4CAF50' :
                selectedWall === index ? 'red' :
                hoveredWall === index ? '#2196F3' :
                wall.application_type === "partition" ? "#666" : "#333";
            
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    FIXED_GAP,
                    center
                );
                
                // ✅ Check if either endpoint has a 45° joint
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
                
                    const has45 = relevantIntersections.some(inter => 
                        inter.pairs.some(pair => 
                            (pair.wall1.id === wall.id || pair.wall2.id === wall.id) &&
                            pair.joining_method === '45_cut'
                        )
                    );
                
                    if (has45) {
                        // Shorten the appropriate end of line2
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const len = Math.hypot(dx, dy);
                        const ux = len ? dx / len : 0;
                        const uy = len ? dy / len : 0;
                        const adjust = 150 *0.9;
                
                        // Clone to avoid mutating shared reference
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
                
                // ✅ Store adjusted lines for cap rendering
                wall._line1 = line1;
                wall._line2 = line2;
                
                // ✅ Now draw
                drawWallLinePair([line1, line2], wallColor);
                drawWallCaps(context, wall, joints, center);

                // Draw diagonal hatching for partitions
                if (wall.application_type === "partition") {
                    drawPartitionSlashes(line1, line2);
                }   

                //Draw endpoints with different colors based on wall state
                if (isEditingMode)
                {
                    const endpointColor = selectedWall === index ? 'red' : '#2196F3';
                    drawEndpoints(wall.start_x, wall.start_y, endpointColor);
                    drawEndpoints(wall.end_x, wall.end_y, endpointColor);
                }
                
                // Draw dimensions (on the central line)
                drawDimensions(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    selectedWall === index ? 'red' : '#2196F3'
                );

                // Draw intersection points (if any)
                if (isEditingMode && currentMode !== 'define-room') {
                    intersections.forEach((inter) => {
                        drawEndpoints(
                            inter.x,
                            inter.y,
                            '#FF9800', // Orange for intersection points
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
                    center
                );

                drawWallLinePair([line1, line2], '#4CAF50', [5, 5]);

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
        
        function drawDoors(ctx, doors, walls, scale, offsetX, offsetY, hoveredDoorId = null) {
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
              if (door.side === 'interior') 
                {
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
                const lineLen = doorThickness * 1.5;
          
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
             
        drawWalls();
        drawDoors(context, doors, walls, scaleFactor.current, offsetX.current, offsetY.current, hoveredDoorId);
        drawRooms();
        drawRoomPreview();
        
    }, [
        walls, rooms, selectedWall, tempWall, doors,
        selectedWallsForRoom, joints, isEditingMode,
        hoveredWall, hoveredDoorId, highlightWalls,
        selectedRoomPoints
      ]);

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
    
                if (sharedPoints.length > 0 && areCollinearWalls(wallA, wallB)) {
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
    };

    // Add collinearity check helper
    const areCollinearWalls = (wall1, wall2) => {
        const vector1 = { 
            x: wall1.end_x - wall1.start_x,
            y: wall1.end_y - wall1.start_y 
        };
        const vector2 = { 
            x: wall2.end_x - wall2.start_x,
            y: wall2.end_y - wall2.start_y 
        };
        
        // Cross product check
        return Math.abs(vector1.x * vector2.y - vector1.y * vector2.x) < 0.001;
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
                const wall1 = walls.find(w => w.id === inter.wall_1);
                const wall2 = walls.find(w => w.id === inter.wall_2);
        
                const maxThickness = Math.max(wall1?.thickness || 0, wall2?.thickness || 0);
                const dynamicThreshold = (SNAP_THRESHOLD + maxThickness) / scaleFactor.current;
        
                const distance = Math.hypot(inter.x - x, inter.y - y);
                if (distance < dynamicThreshold) {
                    setSelectedIntersection(inter);
                    setJoiningMethod(inter.joining_method || "butt_in");
                    return;
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
                    const isPartition = onWallTypeSelect === "partition";
    
                    if(!isPartition)
                    {
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
            const clickPoint = { x, y };
        
            // Step 1: Check if clicked inside an existing room
            for (const room of rooms) {
                const polygon = room.room_points?.length >= 3 ? room.room_points : null;
                if (polygon && isPointInPolygon(clickPoint, polygon)) {
                    onRoomSelect(room.id);  // ✅ show RoomManager
                    return;
                }
            }
        
            // Step 2: Otherwise, record a new point
            const newPoint = { x, y };
            const updatedPoints = [...selectedRoomPoints, newPoint];
            onUpdateRoomPoints(updatedPoints);
            return;
        }        

        if (currentMode === 'merge-wall') {
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
      
            if (selectedIndex !== null) {
                const clickedWall = walls[selectedIndex];
                const updatedSelection = [...selectedWallsForRoom];
                const wallIndex = updatedSelection.indexOf(clickedWall.id);
        
                if (wallIndex === -1) {
                  if (updatedSelection.length < 2) {
                    updatedSelection.push(clickedWall.id);
                  } else {
                    alert("You can only select up to 2 walls for merging.");
                    return;
                  }
                } else {
                  updatedSelection.splice(wallIndex, 1);
                }
        
                onRoomWallsSelect(updatedSelection);
              }
            }

        if (currentMode === 'add-door') {
            let closestWallIndex = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor.current;
    
            walls.forEach((wall, index) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                if (segmentPoint) {
                    const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestWallIndex = index;
                    }
                }
            });
    
            if (closestWallIndex !== null) {
                onDoorWallSelect(walls[closestWallIndex]);
                return;
            }
        }
          
        if (isEditingMode && currentMode === 'edit-door') {
            console.log(`Click at world coords: (${x}, ${y})`);
            
            // Log info about all doors for debugging
            doors.forEach(door => {
                const wall = walls.find(w => w.id === door.linked_wall || w.id === door.wall_id);
                if (wall) {
                    const doorCenterX = wall.start_x + (wall.end_x - wall.start_x) * door.position_x;
                    const doorCenterY = wall.start_y + (wall.end_y - wall.start_y) * door.position_x;
                    console.log(`Door ${door.id} at (${doorCenterX}, ${doorCenterY}), width: ${door.width}`);
                }
            });
            
            const clickedDoor = detectClickedDoor(
                x, y, doors, walls, scaleFactor.current, offsetX.current, offsetY.current
            );
            
            if (clickedDoor) {
                console.log("✅ Door selected:", clickedDoor.id);
                setSelectedDoorId(clickedDoor.id);
                onDoorSelect(clickedDoor);
            } else {
                console.log("❌ No door selected");
            }
        }       
    };
        
          function detectClickedDoor(x, y, doors, walls, scale, offsetX, offsetY) {
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

          function detectHoveredDoor(x, y, doors, walls, scale, offsetX, offsetY) {
            return detectClickedDoor(x, y, doors, walls, scale, offsetX, offsetY);
          }

    const arePointsEqual = (p1, p2, epsilon = 0.001) => {
        return Math.abs(p1.x - p2.x) < epsilon && 
               Math.abs(p1.y - p2.y) < epsilon;
    };
    
    const calculateDistance = (p1, p2) => {
        return Math.hypot(p2.x - p1.x, p2.y - p1.y);
    };
    
    //Shorten the wall if is butt-in, extend if is 45
    const originalWallEndpoints = new Map();

    const getWallLength = (wall) => {
        const dx = wall.end_x - wall.start_x;
        const dy = wall.end_y - wall.start_y;
        return Math.hypot(dx, dy);
    };
    
    const adjustWallForJointType = async (joint, walls, setWalls, projectId, intersection) => {
        const wall1 = walls.find(w => w.id === joint.wall_1);
        const wall2 = walls.find(w => w.id === joint.wall_2);
        if (!wall1 || !wall2) return;
    
        const updatedWall = { ...wall1 };
        const dx = wall1.end_x - wall1.start_x;
        const dy = wall1.end_y - wall1.start_y;
        const length = Math.hypot(dx, dy);
        const ux = dx / length;
        const uy = dy / length;
    
        const startConnected = (
            (wall1.start_x === wall2.start_x && wall1.start_y === wall2.start_y) ||
            (wall1.start_x === wall2.end_x && wall1.start_y === wall2.end_y)
        );
    
        try {
            // Get all joints at this intersection from the passed data
            const anyIs45 = intersection.pairs.some(p => p.joining_method === '45_cut');
            const allAreButtIn = intersection.pairs.every(p => p.joining_method === 'butt_in');
            const onlyOneJoint = intersection.pairs.length === 1;
    
            const shouldShorten = joint.joining_method === 'butt_in' && (onlyOneJoint || (allAreButtIn && !anyIs45));
    
            if (shouldShorten) {
                const len1 = getWallLength(wall1);
                const len2 = getWallLength(wall2);
                const shorter = onlyOneJoint ? wall1 : (len1 <= len2 ? wall1 : wall2);
                const longer = onlyOneJoint ? wall2 : (len1 > len2 ? wall1 : wall2);
                const delta = onlyOneJoint ? wall2.thickness : longer.thickness / 2;
    
                if (!originalWallEndpoints.has(wall1.id)) {
                    originalWallEndpoints.set(wall1.id, {
                        start_x: wall1.start_x,
                        start_y: wall1.start_y,
                        end_x: wall1.end_x,
                        end_y: wall1.end_y
                    });
                }
    
                if (wall1.id === shorter.id) {
                    if (startConnected) {
                        updatedWall.start_x += ux * delta;
                        updatedWall.start_y += uy * delta;
                    } else {
                        updatedWall.end_x -= ux * delta;
                        updatedWall.end_y -= uy * delta;
                    }
                }
            } else if (joint.joining_method === '45_cut') {
                if (originalWallEndpoints.has(wall1.id)) {
                    const original = originalWallEndpoints.get(wall1.id);
                    updatedWall.start_x = original.start_x;
                    updatedWall.start_y = original.start_y;
                    updatedWall.end_x = original.end_x;
                    updatedWall.end_y = original.end_y;
                    originalWallEndpoints.delete(wall1.id);
                }
            }
    
            const res = await api.put(`/walls/${updatedWall.id}/`, updatedWall);
            setWalls(prev =>
                prev.map(w => (w.id === updatedWall.id ? res.data : w))
            );
        } catch (error) {
            console.error("Failed to update wall after joint change:", error);
        }
    };
    
    const handleMouseMove = (event) => {
        if (!isEditingMode) return;

        if (currentMode === 'define-room') {
            setHoveredPoint(null); // Disable endpoint hover effect
            return;
        }
        
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
        if (currentMode === 'add-wall' || currentMode === 'edit-wall' || currentMode === 'add-door' || currentMode === 'merge-wall') {
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

        // Door Hover Detection
    if (currentMode === 'edit-door') {
        const hoveredDoor = detectHoveredDoor(
            x, y, doors, walls, scaleFactor.current, offsetX.current, offsetY.current
        );
        setHoveredDoorId(hoveredDoor ? hoveredDoor.id : null);
    } else {
        setHoveredDoorId(null);
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
                        setHighlightWalls([
                            { id: pair.wall1.id, color: '#60A5FA' }, // light blue
                            { id: pair.wall2.id, color: '#A855F7' }  // purple
                          ]);
                          
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
                    <div className="w-3 h-3 rounded-full bg-purple-400" />
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

                    <div className="flex justify-end">
                    <button
                        onClick={() => {
                        const updated = [...selectedIntersection.pairs];
                        const temp = updated[index].wall1;
                        updated[index].wall1 = updated[index].wall2;
                        updated[index].wall2 = temp;
                        setSelectedIntersection({ ...selectedIntersection, pairs: updated });
                        }}
                        className="text-sm text-blue-500 hover:underline mt-1"
                    >
                        Flip Wall Order
                    </button>
                    </div>

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
                                await api.post('/intersections/set_joint/', {
                                    project: projectId,
                                    wall_1: pair.wall1.id,
                                    wall_2: pair.wall2.id,
                                    joining_method: pair.joining_method
                                });
                            
                                adjustWallForJointType(
                                    {
                                        wall_1: pair.wall1.id,
                                        wall_2: pair.wall2.id,
                                        joining_method: pair.joining_method
                                    },
                                    walls,
                                    setWalls,
                                    projectId,
                                    selectedIntersection // Pass the entire intersection data
                                );
                            }
                          // Refresh joints
                          const response = await api.get(`/intersections/?projectid=${projectId}`);
                          onJointsUpdate(response.data);
                          alert("Joint types updated!");
                        } catch (error) {
                          alert("Failed to update joints.");
                        }
                      }}
                    >
                      Save Changes
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