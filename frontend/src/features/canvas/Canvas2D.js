import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/api';
import PanelCalculationControls from '../panel/PanelCalculationControls';
import PanelCalculator from '../panel/PanelCalculator';
import DoorTable from '../door/DoorTable';
import { calculatePolygonArea, getOrderedPoints, calculateInsetPoints, calculatePolygonVisualCenter, isPointInPolygon, findIntersectionPointsBetweenWalls } from './utils';
import {
  drawGrid,
  drawRooms,
  drawRoomPreview,
  drawWalls,
  drawPartitionSlashes,
  drawEndpoints,
  drawDimensions,
  calculateOffsetPoints,
  drawWallLinePair,
  drawWallCaps
} from './drawing';
import { drawDoors } from './utils';
import { detectClickedDoor, detectHoveredDoor } from './utils';

const Canvas2D = ({ 
    walls = [], 
    setWalls, 
    projectId,
    project,
    joints = [],
    onNewWall, 
    onWallTypeSelect,
    onWallUpdate,
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
    const [showPanelTable, setShowPanelTable] = useState(false);
    const [showMaterialDetails, setShowMaterialDetails] = useState(false);
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [wallMergeError, setWallMergeError] = useState('');

    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const scaleFactor = useRef(1);

    // Utility function to detect database connection errors
    const isDatabaseConnectionError = (error) => {
        return (
            error.code === 'ERR_NETWORK' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.message?.includes('Network Error') ||
            error.message?.includes('Failed to fetch') ||
            error.message?.includes('Connection refused') ||
            error.message?.includes('getaddrinfo ENOTFOUND') ||
            (error.response?.status >= 500 && error.response?.status < 600)
        );
    };

    // Function to show database connection error
    const showDatabaseError = () => {
        setDbConnectionError(true);
        setTimeout(() => setDbConnectionError(false), 5000); // Hide after 5 seconds
    };

    const toggleMaterialDetails = () => {
        setShowMaterialDetails(prev => !prev);
    };

    const SNAP_THRESHOLD = 10;
    const FIXED_GAP = 2.5; // Fixed gap in pixels for double-line walls
    const gridSize = 50;

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
        const insetPoints = calculateInsetPoints(points, ROOM_INSET);

        // Calculate the exact area of the floor
        const area = calculatePolygonArea(insetPoints);

        return { insetPoints, area };
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

    // Use for getting correct mouse position
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

    // Enhanced click handling with endpoint detection
    const handleCanvasClick = async (event) => {
        const { x, y } = getMousePos(event);
        console.log('Canvas clicked! Screen:', event.clientX, event.clientY, 'Model:', x, y, 'currentMode:', currentMode);
        if (!isEditingMode) return;
        const clickPoint = { x, y };
    
        // Intersection selection block (unchanged)
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
    
        // === Add-Wall Mode ===
        if (currentMode === 'add-wall') {
            if (isDrawing) {
                setIsDrawing(false);
                if (tempWall) {
                    const startPoint = snapToClosestPoint(tempWall.start_x, tempWall.start_y);
                    let endPoint = hoveredPoint || snapToClosestPoint(x, y);
                    
                    // Check if wall has minimum length
                    const wallLength = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
                    if (wallLength < 50) { // Minimum 50mm wall length
                        setTempWall(null);
                        return;
                    }
                    
                    // Check for intersections with existing walls
                    const intersections = [];
                    walls.forEach((wall) => {
                        const intersection = findIntersectionPoint(
                            startPoint.x, startPoint.y, endPoint.x, endPoint.y,
                            wall.start_x, wall.start_y, wall.end_x, wall.end_y
                        );
                        if (intersection) {
                            intersections.push({
                                point: intersection,
                                wall: wall
                            });
                        }
                    });
                    
                    // Sort intersections by distance from start point
                    intersections.sort((a, b) => {
                        const distA = Math.hypot(a.point.x - startPoint.x, a.point.y - startPoint.y);
                        const distB = Math.hypot(b.point.x - startPoint.x, b.point.y - startPoint.y);
                        return distA - distB;
                    });
                    
                    // Create wall segments
                    let currentStart = startPoint;
                    const wallSegments = [];
                    
                    for (const intersection of intersections) {
                        // Create wall segment from current start to intersection
                        wallSegments.push({
                            start_x: currentStart.x,
                            start_y: currentStart.y,
                            end_x: intersection.point.x,
                            end_y: intersection.point.y
                        });
                        currentStart = intersection.point;
                    }
                    
                    // Add final segment
                    wallSegments.push({
                        start_x: currentStart.x,
                        start_y: currentStart.y,
                        end_x: endPoint.x,
                        end_y: endPoint.y
                    });
                    
                    // Create walls for each segment
                    for (const segment of wallSegments) {
                        const wallData = {
                            start_x: segment.start_x,
                            start_y: segment.start_y,
                            end_x: segment.end_x,
                            end_y: segment.end_y,
                            application_type: onWallTypeSelect ? onWallTypeSelect() : 'wall',
                            height: project?.height || 1000,
                            thickness: project?.wall_thickness || 200
                        };
                        
                        try {
                            await onNewWall(wallData);
                        } catch (error) {
                            console.error('Failed to create wall:', error);
                            if (isDatabaseConnectionError(error)) {
                                showDatabaseError();
                            }
                        }
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
            return;
        }
        
        // === Edit-Wall Mode ===
        if (currentMode === 'edit-wall') {
            let selectedId = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor.current;
            walls.forEach((wall) => {
                    const segmentPoint = snapToWallSegment(x, y, wall);
                    if (segmentPoint) {
                        const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                        if (distance < minDistance) {
                            minDistance = distance;
                        selectedId = wall.id;
                        }
                    }
                });
            setSelectedWall(selectedId);
            onWallSelect(selectedId);
            return;
        }        

        // === Merge-Wall Mode ===
        if (currentMode === 'merge-wall') {
            let selectedId = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor.current;
            walls.forEach((wall) => {
              const segmentPoint = snapToWallSegment(x, y, wall);
              if (segmentPoint) {
                const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                if (distance < minDistance) {
                  minDistance = distance;
                        selectedId = wall.id;
                }
              }
            });
            if (selectedId !== null) {
                const clickedWall = walls.find(w => w.id === selectedId);
                const updatedSelection = [...selectedWallsForRoom];
                const wallIndex = updatedSelection.indexOf(clickedWall.id);
                if (wallIndex === -1) {
                  if (updatedSelection.length < 2) {
                    updatedSelection.push(clickedWall.id);
                  } else {
                    setWallMergeError("You can only select up to 2 walls for merging.");
                    setTimeout(() => setWallMergeError(''), 5000);
                    return;
                  }
                } else {
                  updatedSelection.splice(wallIndex, 1);
                }
                onRoomWallsSelect(updatedSelection);
              }
            return;
            }

        // === Add-Door Mode ===
        if (currentMode === 'add-door') {
            let closestWallId = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor.current;
            walls.forEach((wall) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                if (segmentPoint) {
                    const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestWallId = wall.id;
                    }
                }
            });
            if (closestWallId !== null) {
                onDoorWallSelect(walls.find(w => w.id === closestWallId));
                return;
            }
        }
          
        // === Define-Room Mode ===
        if (currentMode === 'define-room') {
            // ... (room point selection and polygon validation logic from old code) ...
            // (Copy your old define-room logic here)
        }
    };

    // Helper for wall hover detection
    function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        let param = -1;
        if (len_sq !== 0) param = dot / len_sq;

        let xx, yy;
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
            } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    const handleMouseMove = (event) => {
        if (!isEditingMode) return;
        if (currentMode === 'define-room') {
            setHoveredPoint(null); // Disable endpoint hover effect
            return;
        }
        const { x, y } = getMousePos(event);
        
        // Update tempWall during drawing
        if (isDrawing && tempWall && currentMode === 'add-wall') {
            setTempWall(prev => ({
                ...prev,
                end_x: x,
                end_y: y
            }));
        }
        
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
        // Wall Hover Detection (use wall.id)
        if (['add-wall', 'edit-wall', 'add-door', 'merge-wall'].includes(currentMode)) {
            let minWallDistance = SNAP_THRESHOLD / scaleFactor.current;
            let newHoveredWall = null;
            walls.forEach((wall) => {
                const segmentPoint = snapToWallSegment(x, y, wall);
                if (segmentPoint) {
                    const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
                    if (distance < minWallDistance) {
                        minWallDistance = distance;
                        newHoveredWall = wall.id;
                    }
                }
            });
            setHoveredWall(newHoveredWall);
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        canvas.width = 800;
        canvas.height = 600;

        // === Restore original scale/offset calculation ===
        // Find bounding box of all wall endpoints
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
        // === End scale/offset calculation ===

        context.clearRect(0, 0, canvas.width, canvas.height);
        // Draw grid
        drawGrid(context, canvas.width, canvas.height, gridSize, isDrawing);
        // Draw walls
        drawWalls({
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
            scaleFactor: scaleFactor.current,
            offsetX: offsetX.current,
            offsetY: offsetY.current,
            FIXED_GAP,
            // Use project center only for wall offset direction, not for scale/offset
            center: project ? { x: project.width / 2, y: project.length / 2 } : { x: 0, y: 0 },
            currentScaleFactor,
            SNAP_THRESHOLD,
            drawPartitionSlashes,
            hoveredPoint,
            drawWallLinePair,
            drawWallCaps,
            drawEndpoints,
            drawDimensions
        });
        // Draw doors
        drawDoors(context, doors, walls, scaleFactor.current, offsetX.current, offsetY.current, hoveredDoorId);
        // Draw rooms
        drawRooms(context, rooms, walls, scaleFactor.current, offsetX.current, offsetY.current, calculateRoomArea, calculatePolygonVisualCenter);
        // Draw room preview
        drawRoomPreview(context, selectedRoomPoints, scaleFactor.current, offsetX.current, offsetY.current);
    }, [
        walls, rooms, selectedWall, tempWall, doors,
        selectedWallsForRoom, joints, isEditingMode,
        hoveredWall, hoveredDoorId, highlightWalls,
        selectedRoomPoints, project, hoveredPoint
    ]);

    // Add adjustWallForJointType and dependencies from old code
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
    
        // Calculate distances from intersection point to both ends of wall1
        const distToStart = Math.hypot(
            intersection.x - wall1.start_x,
            intersection.y - wall1.start_y
        );
        const distToEnd = Math.hypot(
            intersection.x - wall1.end_x,
            intersection.y - wall1.end_y
        );
        
        // Determine which end is closer to the intersection point
        const isStartEnd = distToStart < distToEnd;
    
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
                    // Shorten the end that's closer to the intersection point
                    if (isStartEnd) {
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
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
    }
    };
    
    // Sync joints prop to local intersections state
    useEffect(() => {
        // Calculate all geometric intersections between walls
        const allIntersections = findIntersectionPointsBetweenWalls(walls);
        // Merge with saved joints data from backend
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
    }, [walls, joints]);
    
    return (
        <div className="flex flex-col items-center gap-4">
            {/* Database Connection Error Message */}
            {dbConnectionError && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Fail to connect to database. Try again later.</span>
                    </div>
                </div>
            )}
            
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
                          if (isDatabaseConnectionError(error)) {
                            showDatabaseError();
                          } else {
                            alert("Failed to update joints.");
                          }
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
            {/* Existing panel table and controls can be removed or kept as needed */}
            {/* Add PanelCalculationControls below the canvas */}
            <PanelCalculationControls 
                walls={walls} 
                intersections={intersections}
                doors={doors}
                showMaterialDetails={showMaterialDetails}
                toggleMaterialDetails={toggleMaterialDetails}
            />
            
            {/* Add DoorTable component */}
            {showMaterialDetails && <DoorTable doors={doors} />}
            {wallMergeError && (
              <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
                <div className="flex items-center">
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">{wallMergeError}</span>
                </div>
              </div>
            )}
        </div>
    );
};

export default Canvas2D;

// Helper function to check if two line segments intersect
const doSegmentsIntersect = (p1, p2, p3, p4) => {
    const ccw = (A, B, C) => {
        return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    };
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
};

// Function to find intersection point between two line segments
const findIntersectionPoint = (x1, y1, x2, y2, x3, y3, x4, y4) => {
    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denominator) < 1e-10) return null; // Lines are parallel
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;
    
    // Check if intersection is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1)
        };
    }
    
    return null;
};