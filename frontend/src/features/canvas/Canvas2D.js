import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/api';
import PanelCalculationControls from '../panel/PanelCalculationControls';
import DoorTable from '../door/DoorTable';
import { calculatePolygonArea, findIntersectionPointsBetweenWalls } from './utils';
import {
  drawGrid,
  drawRoomPreview,
  drawWalls,
  drawPartitionSlashes,
  drawEndpoints,
  drawDimensions,
  drawWallLinePair,
  drawWallCaps,
  drawPanelDivisions,
  normalizeWallCoordinates,
  getRoomLabelPositions
} from './drawing';
import InteractiveRoomLabel from './InteractiveRoomLabel';
import { drawDoors } from './utils';
import { detectClickedDoor, detectHoveredDoor } from './utils';
import { filterDimensions } from './dimensionFilter.js';

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
    onRoomSelect,
    onRoomUpdate,
    onRoomLabelPositionUpdate,
    updateSharedPanelData = null // Add this prop for sharing panel data
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
    const [highlightWalls, setHighlightWalls] = useState([]);
    const [selectedJointPair, setSelectedJointPair] = useState(null);
    const [hoveredDoorId, setHoveredDoorId] = useState(null);
    const [showMaterialDetails, setShowMaterialDetails] = useState(false);


    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [wallMergeError, setWallMergeError] = useState('');
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [roomLabelPositions, setRoomLabelPositions] = useState([]);
    const [forceRefresh, setForceRefresh] = useState(0);
    const lastRoomDataRef = useRef({ rooms: [], walls: [] });
    const [thicknessColorMap, setThicknessColorMap] = useState(new Map());

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



    // Handle room label position changes (optimized to avoid unnecessary re-renders)
    const handleRoomLabelPositionChange = (roomId, newPosition) => {
        setRoomLabelPositions(prev => 
            prev.map(label => 
                label.roomId === roomId 
                    ? { ...label, position: newPosition }
                    : label
            )
        );
    };

    // Optimized room update that doesn't trigger unnecessary re-calculations
    const handleRoomUpdateOptimized = async (roomId, updates) => {
        try {
            // If this is just a label position update, use the specialized function
            if (updates.label_position && Object.keys(updates).length === 1) {
                console.log('Sending label position update:', updates);
                
                if (onRoomLabelPositionUpdate) {
                    await onRoomLabelPositionUpdate(roomId, updates.label_position);
                    console.log('Label position updated successfully');
                } else {
                    // Fallback to direct API call with full room data
                    const currentRoom = rooms.find(room => room.id === roomId);
                    if (!currentRoom) {
                        console.error('Room not found:', roomId);
                        return;
                    }
                    
                    const fullRoomData = { ...currentRoom, ...updates };
                    const response = await api.put(`/rooms/${roomId}/`, fullRoomData);
                    if (response.status === 200) {
                        console.log('Label position updated successfully');
                    }
                }
            } else {
                // For other updates, use the parent's room update function
                const currentRoom = rooms.find(room => room.id === roomId);
                if (!currentRoom) {
                    console.error('Room not found:', roomId);
                    return;
                }
                
                const updatedRoomData = { ...currentRoom, ...updates };
                if (onRoomUpdate) {
                    await onRoomUpdate(updatedRoomData);
                } else {
                    const response = await api.put(`/rooms/${roomId}/`, updates);
                    if (response.status === 200) {
                        console.log('Room updated successfully:', response.data);
                    }
                }
            }
        } catch (error) {
            console.error('Error updating room:', error);
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
        }
    };

    // Handle room selection
    const handleRoomSelect = (roomId) => {
        setSelectedRoomId(roomId);
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

    // Helper: snap to intersections, then wall segments, then endpoints, then raw click
    function snapToClosestPointWithIntersections(x, y, intersections, walls, scaleFactor) {
        let closestPoint = { x, y };
        // Make intersection snapping more sensitive (3x normal threshold)
        let intersectionThreshold = SNAP_THRESHOLD * 3 / scaleFactor;
        let minDistance = intersectionThreshold;
        // 1. Intersections (high sensitivity)
        intersections.forEach(inter => {
            const distance = Math.hypot(inter.x - x, inter.y - y);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = { x: inter.x, y: inter.y };
            }
        });
        // 2. Wall segments (disabled in define-room mode)
        // walls.forEach(wall => {
        //     const segmentPoint = snapToWallSegment(x, y, wall);
        //     if (segmentPoint) {
        //         const distance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
        //         if (distance < segmentThreshold && distance < minDistance) {
        //             minDistance = distance;
        //             closestPoint = segmentPoint;
        //         }
        //     }
        // });
        // 3. Endpoints (normal threshold)
        let segmentThreshold = SNAP_THRESHOLD / scaleFactor;
        walls.forEach(wall => {
            ['start', 'end'].forEach(point => {
                const px = wall[`${point}_x`];
                const py = wall[`${point}_y`];
                const distance = Math.hypot(px - x, py - y);
                if (distance < segmentThreshold && distance < minDistance) {
                    minDistance = distance;
                    closestPoint = { x: px, y: py };
                }
            });
        });
        return closestPoint;
    }

    // Enhanced click handling with endpoint detection
    const handleCanvasClick = async (event) => {
        const { x, y } = getMousePos(event);
        console.log('Canvas clicked! Screen:', event.clientX, event.clientY, 'Model:', x, y, 'currentMode:', currentMode);
        if (!isEditingMode) return;
        
        // Deselect room label when clicking on empty space (but not when actively defining a room)
        if (selectedRoomId !== null && !(currentMode === 'define-room' && selectedRoomPoints && selectedRoomPoints.length > 0)) {
            setSelectedRoomId(null);
        }
    
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
                    // setJoiningMethod(inter.joining_method || "butt_in"); // Unused variable
                    return;
                }
            }
        }
    
        // === Add-Wall Mode ===
        if (currentMode === 'add-wall') {
            // Helper to round coordinates
            const roundPoint = (pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) });
            if (isDrawing) {
                setIsDrawing(false);
                if (tempWall) {
                    let startPoint = snapToClosestPoint(tempWall.start_x, tempWall.start_y);
                    let endPoint = hoveredPoint || snapToClosestPoint(x, y);

                    // --- Snap to 90/180 degrees ---
                    let dx = endPoint.x - startPoint.x;
                    let dy = endPoint.y - startPoint.y;
                    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                    if (Math.abs(angle - 90) <= 2 || Math.abs(angle + 90) <= 2) {
                        endPoint.x = startPoint.x; // Snap vertically
                    } else if (Math.abs(angle) <= 2 || Math.abs(angle - 180) <= 2) {
                        endPoint.y = startPoint.y; // Snap horizontally
                    }

                    // Round both points before saving
                    startPoint = roundPoint(startPoint);
                    endPoint = roundPoint(endPoint);

                    // Normalize wall coordinates to ensure proper direction
                    const normalizedCoords = normalizeWallCoordinates(startPoint, endPoint);
                    startPoint = normalizedCoords.startPoint;
                    endPoint = normalizedCoords.endPoint;

                    // Use modular handler for wall splitting/adding
                    const wallProperties = walls.length > 0 ? {
                        height: walls[0].height,
                        thickness: walls[0].thickness,
                        application_type: onWallTypeSelect
                    } : { height: 2800, thickness: 200, application_type: onWallTypeSelect };
                    try {
                        if (typeof onNewWall === 'function' && onNewWall.name === 'handleAddWallWithSplitting') {
                            await onNewWall(startPoint, endPoint, wallProperties);
                        } else if (typeof onNewWall === 'function' && onNewWall.length === 3) {
                            await onNewWall(startPoint, endPoint, wallProperties);
                        } else {
                            // fallback: just add a single wall
                            await onNewWall({
                                start_x: startPoint.x,
                                start_y: startPoint.y,
                                end_x: endPoint.x,
                                end_y: endPoint.y,
                                ...wallProperties
                            });
                        }
                        // Refresh wall list from parent state
                        if (typeof setWalls === 'function') {
                            // Optionally, you can call refreshWalls in parent and pass down new walls
                        }
                    } catch (error) {
                        console.error('Error managing walls:', error);
                        if (isDatabaseConnectionError(error)) {
                            showDatabaseError();
                        }
                    }
                    setTempWall(null);
                }
            } else {
                let snappedStart = hoveredPoint || snapToClosestPoint(x, y);
                // Round the start point before showing temp wall
                snappedStart = roundPoint(snappedStart);
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
            // 1. Check if clicked inside an existing room polygon
            const clickPoint = { x, y };
            for (const room of rooms) {
                const polygon = room.room_points?.length >= 3 ? room.room_points : null;
                if (polygon && isPointInPolygon(clickPoint, polygon)) {
                    // Only disable room selection if actively defining a room (has polygon points)
                    if (selectedRoomPoints && selectedRoomPoints.length > 0) {
                        // Don't select room when actively defining a room
                        return;
                    } else {
                        // Allow room selection when not actively defining a room
                        if (typeof onRoomSelect === 'function') onRoomSelect(room.id);
                        return;
                    }
                }
            }
            // 2. Snap to intersections, wall segments, endpoints
            const snapped = snapToClosestPointWithIntersections(x, y, intersections, walls, scaleFactor.current);
            let points = [...selectedRoomPoints];
            // 3. If right-click, remove last point
            if (event.type === 'contextmenu' || event.button === 2) {
                if (points.length > 0) {
                    points.pop();
                    onUpdateRoomPoints(points);
                }
                return;
            }
            // 4. If clicking near the first point and ≥3 points, close polygon
            if (points.length >= 3) {
                const first = points[0];
                const distToFirst = Math.hypot(snapped.x - first.x, snapped.y - first.y);
                if (distToFirst < SNAP_THRESHOLD / scaleFactor.current) {
                    points.push({ ...first });
                    onUpdateRoomPoints(points);
                    return;
                }
            }
            // 5. Prevent duplicate points
            if (points.some(pt => Math.abs(pt.x - snapped.x) < 0.001 && Math.abs(pt.y - snapped.y) < 0.001)) {
                return;
            }
            // 6. Prevent self-intersection
            if (points.length >= 2) {
                const newSegment = [points[points.length - 1], snapped];
                for (let i = 0; i < points.length - 2; i++) {
                    const existingSegment = [points[i], points[i + 1]];
                    if (doSegmentsIntersect(newSegment[0], newSegment[1], existingSegment[0], existingSegment[1])) {
                        return;
                    }
                }
            }
            // 7. Add new point
            points.push(snapped);
            onUpdateRoomPoints(points);
            return;
        }

        // === Edit-Door Mode ===
        if (currentMode === 'edit-door') {
            // Use detectClickedDoor to select a door
            const clickedDoor = detectClickedDoor(
                x, y, doors, walls, scaleFactor.current, offsetX.current, offsetY.current
            );
            if (clickedDoor) {
                // setSelectedDoorId(clickedDoor.id); // Unused variable
                onDoorSelect(clickedDoor);
            } else {
                // setSelectedDoorId(null); // Unused variable
            }
            return;
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
        // Wall Hover Detection (use wall.id)
        if ([
            'add-wall', 'edit-wall', 'add-door', 'merge-wall'
        ].includes(currentMode)) {
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
        // Door Hover Detection (edit-door mode)
        if (currentMode === 'edit-door') {
            const hoveredDoor = detectHoveredDoor(
                x, y, doors, walls, scaleFactor.current, offsetX.current, offsetY.current
            );
            setHoveredDoorId(hoveredDoor ? hoveredDoor.id : null);
        } else {
            setHoveredDoorId(null);
        }
        // --- Update tempWall while drawing (snapping logic) ---
        if (isDrawing && tempWall && currentMode === 'add-wall') {
            let snapped = snapToClosestPoint(x, y);
            // Snap to 90/180 degrees
            let dx = snapped.x - tempWall.start_x;
            let dy = snapped.y - tempWall.start_y;
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            if (Math.abs(angle - 90) <= 2 || Math.abs(angle + 90) <= 2) {
                snapped.x = tempWall.start_x;
            } else if (Math.abs(angle) <= 2 || Math.abs(angle - 180) <= 2) {
                snapped.y = tempWall.start_y;
            }
            setTempWall({
                ...tempWall,
                end_x: snapped.x,
                end_y: snapped.y,
            });
        }
    };

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
        console.log('Canvas2D: Walls changed, recalculating intersections. Wall count:', walls.length);
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

    // Force canvas re-render when walls change
    useEffect(() => {
        console.log('Canvas2D: Walls prop changed, triggering canvas redraw. Wall count:', walls.length);
        // Force a canvas redraw by incrementing the refresh counter
        setForceRefresh(prev => prev + 1);
        
        // Clear any invalid wall selections (walls that no longer exist)
        if (selectedWall && !walls.find(w => w.id === selectedWall.id)) {
            console.log('Canvas2D: Selected wall no longer exists, clearing selection');
            setSelectedWall(null);
        }
    }, [walls, selectedWall]);

    // Helper to get joint types for a wall
    const getWallJointTypes = (wall, intersections) => {
        // Find all intersections for this wall
        const wallIntersections = intersections.filter(inter => 
            inter.pairs && inter.pairs.some(pair => 
                pair.wall1.id === wall.id || pair.wall2.id === wall.id
            )
        );
        let leftJointType = 'butt_in';
        let rightJointType = 'butt_in';
        // Determine wall orientation and which end is left/right
        const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
        const isLeftToRight = wall.end_x > wall.start_x;
        const isBottomToTop = wall.end_y > wall.start_y;
        // Track all intersections for each end
        const leftEndIntersections = [];
        const rightEndIntersections = [];
        wallIntersections.forEach(inter => {
            inter.pairs.forEach(pair => {
                if (pair.wall1.id === wall.id || pair.wall2.id === wall.id) {
                    if (isHorizontal) {
                        if (isLeftToRight) {
                            if (inter.x === wall.start_x) {
                                leftEndIntersections.push(pair.joining_method);
                            } else if (inter.x === wall.end_x) {
                                rightEndIntersections.push(pair.joining_method);
                            }
                        } else {
                            if (inter.x === wall.start_x) {
                                rightEndIntersections.push(pair.joining_method);
                            } else if (inter.x === wall.end_x) {
                                leftEndIntersections.push(pair.joining_method);
                            }
                        }
                    }
                    if (isBottomToTop) {
                        if (inter.y === wall.start_y) {
                            leftEndIntersections.push(pair.joining_method);
                        } else if (inter.y === wall.end_y) {
                            rightEndIntersections.push(pair.joining_method);
                        }
                    } else {
                        if (inter.y === wall.start_y) {
                            rightEndIntersections.push(pair.joining_method);
                        } else if (inter.y === wall.end_y) {
                            leftEndIntersections.push(pair.joining_method);
                        }
                    }
                }
            });
        });
        leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
        rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
        return { left: leftJointType, right: rightJointType };
    };

    // Calculate panels for each wall
    const wallPanelsMap = React.useMemo(() => {
        const PanelCalculator = require('../panel/PanelCalculator').default || require('../panel/PanelCalculator');
        const map = {};
        walls.forEach(wall => {
            const jointTypes = getWallJointTypes(wall, intersections);
            const calculator = new PanelCalculator();
            const wallLength = Math.sqrt(
                Math.pow(wall.end_x - wall.start_x, 2) + 
                Math.pow(wall.end_y - wall.start_y, 2)
            );
            let panels = calculator.calculatePanels(
                wallLength,
                wall.thickness,
                jointTypes
            );
            // Reorder: left side panel (if any), then full panels, then right side panel (if any)
            const leftSide = panels.find(p => p.type === 'side' && p.position === 'left');
            const rightSide = panels.find(p => p.type === 'side' && p.position === 'right');
            const fullPanels = panels.filter(p => p.type === 'full');
            // If there are leftover/cut panels that are not left/right, treat them as side panels (fallback)
            const otherSides = panels.filter(p => p.type === 'side' && p.position !== 'left' && p.position !== 'right');
            let orderedPanels = [];
            if (leftSide) orderedPanels.push(leftSide);
            if (otherSides.length > 0 && !leftSide) orderedPanels.push(otherSides[0]);
            orderedPanels = orderedPanels.concat(fullPanels);
            if (rightSide) orderedPanels.push(rightSide);
            if (otherSides.length > 1 || (otherSides.length === 1 && leftSide)) orderedPanels.push(otherSides[otherSides.length - 1]);
            // If no side panels, just use the original order
            if (orderedPanels.length === 0) orderedPanels = panels;
            map[wall.id] = orderedPanels;
        });
        return map;
    }, [walls, intersections]);

    // Filter dimensions to show only unique ones
    const filteredDimensions = React.useMemo(() => {
        return filterDimensions(walls, intersections, wallPanelsMap);
    }, [walls, intersections, wallPanelsMap]);
    
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
        // Draw walls and get thickness color map
        const colorMap = drawWalls({
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
            center: project ? { x: project.width / 2, y: project.length / 2 } : { x: 0, y: 0 },
            currentScaleFactor,
            SNAP_THRESHOLD,
            drawPartitionSlashes,
            hoveredPoint,
            drawWallLinePair,
            drawWallCaps,
            drawEndpoints,
            drawDimensions,
            // Add these:
            wallPanelsMap,
            drawPanelDivisions,
            filteredDimensions
        });
        // Store thickness color map for the legend
        setThicknessColorMap(colorMap);
        // Draw doors
        drawDoors(context, doors, walls, scaleFactor.current, offsetX.current, offsetY.current, hoveredDoorId);
        // Draw rooms
        // Draw room preview
        drawRoomPreview(context, selectedRoomPoints, scaleFactor.current, offsetX.current, offsetY.current);
        
    }, [
        walls, rooms, selectedWall, tempWall, doors,
        selectedWallsForRoom, joints, isEditingMode,
        hoveredWall, hoveredDoorId, highlightWalls,
        selectedRoomPoints, project, hoveredPoint,
        wallPanelsMap, // Add wallPanelsMap to dependencies
        filteredDimensions, // Add filteredDimensions to dependencies
        forceRefresh // Add forceRefresh to dependencies to force re-renders
        // Removed roomLabelPositions from dependencies to prevent infinite loop
    ]);

    // Separate useEffect for room label positions to avoid triggering panel calculations
    useEffect(() => {
        // Check if rooms or walls have actually changed (not just label_position updates)
        const roomsChanged = rooms.length !== lastRoomDataRef.current.rooms.length ||
            rooms.some((room, index) => {
                const lastRoom = lastRoomDataRef.current.rooms[index];
                return !lastRoom || 
                       room.id !== lastRoom.id ||
                       room.room_name !== lastRoom.room_name ||
                       room.height !== lastRoom.height ||
                       room.remarks !== lastRoom.remarks ||
                       JSON.stringify(room.walls) !== JSON.stringify(lastRoom.walls);
                       // Note: We intentionally ignore label_position changes here
            });
        
        const wallsChanged = walls.length !== lastRoomDataRef.current.walls.length ||
            walls.some((wall, index) => {
                const lastWall = lastRoomDataRef.current.walls[index];
                return !lastWall || 
                       wall.id !== lastWall.id ||
                       wall.start_x !== lastWall.start_x ||
                       wall.start_y !== lastWall.start_y ||
                       wall.end_x !== lastWall.end_x ||
                       wall.end_y !== lastWall.end_y;
            });
        
        // Only recalculate if rooms or walls have actually changed
        if (roomsChanged || wallsChanged) {
            const newLabelPositions = getRoomLabelPositions(
                rooms, 
                walls, 
                scaleFactor.current, 
                offsetX.current, 
                offsetY.current, 
                calculateRoomArea, 
                calculatePolygonVisualCenter
            );
            setRoomLabelPositions(newLabelPositions);
            
            // Update the ref with current data
            lastRoomDataRef.current = {
                rooms: rooms.map(room => ({ ...room })),
                walls: walls.map(wall => ({ ...wall }))
            };
        }
    }, [
        rooms, walls, scaleFactor.current, offsetX.current, offsetY.current
        // Only depend on the actual data that affects label positions
    ]);
    
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
            
            <div className="flex gap-6 items-start">
                {/* Canvas Container */}
                <div className="relative">
                    <canvas
                        ref={canvasRef}
                        onClick={handleCanvasClick}
                        onMouseMove={handleMouseMove}
                        
                        tabIndex={0}
                        className="border border-gray-300 bg-gray-50"
                    />
                    
                    {/* Interactive Room Labels */}
                    {roomLabelPositions.map((labelData) => (
                        <InteractiveRoomLabel
                            key={labelData.roomId}
                            room={labelData.room}
                            position={labelData.position}
                            scaleFactor={scaleFactor.current}
                            offsetX={offsetX.current}
                            offsetY={offsetY.current}
                            onUpdateRoom={handleRoomUpdateOptimized}
                            onPositionChange={handleRoomLabelPositionChange}
                            isSelected={selectedRoomId === labelData.roomId}
                            onSelect={handleRoomSelect}
                            currentMode={currentMode}
                            selectedRoomPoints={selectedRoomPoints}
                        />
                    ))}
                </div>

                {/* Sidebar with Legend */}
                {thicknessColorMap && thicknessColorMap.size > 1 && (
                    <div className="flex-shrink-0 w-72">
                        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm sticky top-4">
                            <h5 className="font-semibold text-gray-900 mb-4 flex items-center">
                                <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                </svg>
                                Wall Thickness Legend
                            </h5>
                            <div className="space-y-3">
                                {Array.from(thicknessColorMap.entries()).map(([thickness, colors]) => (
                                    <div key={thickness} className="flex items-center">
                                        <div 
                                            className="w-8 h-4 rounded mr-3 border border-gray-300" 
                                            style={{ backgroundColor: colors.wall }}
                                        ></div>
                                        <span className="text-sm text-gray-700 font-medium">{colors.label}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
                                💡 <strong>Tip:</strong> Different colors represent different wall thicknesses for easy identification
                            </div>
                        </div>
                    </div>
                )}
            </div>
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

            {/* Panel Calculation Controls */}
            <PanelCalculationControls 
                walls={walls} 
                intersections={joints}
                doors={doors}
                showMaterialDetails={showMaterialDetails}
                toggleMaterialDetails={toggleMaterialDetails}
                canvasRef={canvasRef}
                rooms={rooms}
                project={project}
                updateSharedPanelData={updateSharedPanelData} // Pass the prop
            />
            
            {/* Door Table */}
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