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
  getRoomLabelPositions,
  drawOverallProjectDimensions,
  calculateActualProjectDimensions,
  compareDimensions
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
    ghostWalls = [],
    ghostAreas = [],
    onDoorWallSelect,
    onDoorSelect = () => {},
    selectedRoomPoints = [],
    onUpdateRoomPoints = () => {},
    onRoomSelect,
    onRoomUpdate,
    onRoomLabelPositionUpdate,
    updateSharedPanelData = null, // Add this prop for sharing panel data
    onManualWallSplit = null,
    wallSplitError = '',
    setWallSplitError = () => {},
    wallSplitSuccess = false
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
    const [dimensionVisibility, setDimensionVisibility] = useState({
        project: true,
        wall: true,
        panel: true
    });
    const [splitTargetWallId, setSplitTargetWallId] = useState(null);
    const [splitPreviewPoint, setSplitPreviewPoint] = useState(null);
    const [splitDistanceInput, setSplitDistanceInput] = useState('');
    const [splitHoverDistance, setSplitHoverDistance] = useState(null);
    const [isProcessingSplit, setIsProcessingSplit] = useState(false);

    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const scaleFactor = useRef(1);
    const initialScale = useRef(1); // Track the initial scale
    const isZoomed = useRef(false); // Track if user has manually zoomed
    
    // Canvas dragging state
    const isDraggingCanvas = useRef(false);
    const suppressNextContextMenu = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });

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

    const handleDimensionVisibilityChange = (type) => {
        setDimensionVisibility((prev) => ({
            ...prev,
            [type]: !prev[type]
        }));
    };

    // Zoom functions
    const handleZoomIn = () => {
        console.log('🔍 Zoom In clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        console.log('Current currentScaleFactor state:', currentScaleFactor);
        
        const newScale = Math.min(3.0, scaleFactor.current * 1.2);
        console.log('Calculated new scale:', newScale);
        
        zoomAtCurrentView(newScale);
    };

    const handleZoomOut = () => {
        console.log('🔍 Zoom Out clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        console.log('Current currentScaleFactor state:', currentScaleFactor);
        console.log('Initial scale:', initialScale.current);
        
        // Use the initial scale as the minimum instead of hardcoded 0.1
        const newScale = Math.max(initialScale.current, scaleFactor.current * 0.8);
        console.log('Calculated new scale:', newScale);
        
        zoomAtCurrentView(newScale);
    };

    const handleResetZoom = () => {
        console.log('Reset Zoom clicked, resetting zoom flag');
        isZoomed.current = false; // Reset zoom flag so scale calculation can set optimal scale
        // Trigger a re-render to recalculate scale
        setForceRefresh(prev => prev + 1);
    };

    // Zoom at current view position (better UX)
    const zoomAtCurrentView = (newScale) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        // Get the current view center (where the user is currently looking)
        const canvasCenterX = canvas.width / 2;
        const canvasCenterY = canvas.height / 2;
        
        // Calculate the current view center in model coordinates
        const currentViewCenterX = (canvasCenterX - offsetX.current) / scaleFactor.current;
        const currentViewCenterY = (canvasCenterY - offsetY.current) / scaleFactor.current;
        
        const scaleRatio = newScale / scaleFactor.current;
        
        // Keep the same point in model coordinates at the same screen position
        offsetX.current = canvasCenterX - currentViewCenterX * newScale;
        offsetY.current = canvasCenterY - currentViewCenterY * newScale;
        
        // Update the scale factor FIRST
        scaleFactor.current = newScale;
        // Mark that user has manually zoomed
        isZoomed.current = true;
        
        // Update the state
        setCurrentScaleFactor(newScale);
        
        // Redraw
        const ctx = canvas.getContext('2d');
        if (ctx) {
            console.log('Got canvas context, clearing and redrawing...');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Trigger a re-render
            setForceRefresh(prev => prev + 1);
        }
    };

    // Zoom to center of canvas
    const zoomToCenter = (newScale) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const canvasCenterX = canvas.width / 2;
        const canvasCenterY = canvas.height / 2;
        
        const scaleRatio = newScale / scaleFactor.current;
        
        offsetX.current = canvasCenterX - (canvasCenterX - offsetX.current) * scaleRatio;
        offsetY.current = canvasCenterY - (canvasCenterY - offsetY.current) * scaleRatio;
        
        // Update the scale factor FIRST
        scaleFactor.current = newScale;
        // Mark that user has manually zoomed
        isZoomed.current = true;
        
        // Update the state
        setCurrentScaleFactor(newScale);
        
        // Redraw
        const ctx = canvas.getContext('2d');
        if (ctx) {
            console.log('Got canvas context, clearing and redrawing...');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Trigger a re-render
            setForceRefresh(prev => prev + 1);
        }
    };

    // Canvas dragging functions
    const handleCanvasMouseDown = (e) => {
        // Only initiate dragging with the right mouse button
        if (e.button !== 2) {
            return;
        }

        suppressNextContextMenu.current = false;
        isDraggingCanvas.current = true;
        isZoomed.current = true; // Mark that user has positioned the view
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    };

    const handleCanvasMouseUp = () => {
        isDraggingCanvas.current = false;
    };

    // Handle right-click (context menu) for define-room mode
    const handleCanvasContextMenu = (event) => {
        event.preventDefault();
        // Only handle right-click in polygon modes
        if ((currentMode === 'define-room' || currentMode === 'storey-area') && selectedRoomPoints && selectedRoomPoints.length > 0) {
            const points = [...selectedRoomPoints];
            if (points.length > 0) {
                points.pop();
                onUpdateRoomPoints(points);
            }
        }
    };

    // Add global mouse up event listener for canvas dragging
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            isDraggingCanvas.current = false;
        };
        
        document.addEventListener('mouseup', handleGlobalMouseUp);
        return () => {
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, []);

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

    const SPLIT_ENDPOINT_TOLERANCE = 1;
    const SPLIT_DISTANCE_TOLERANCE = 0.5;

    const getWallLength = (wall) => Math.hypot(
        wall.end_x - wall.start_x,
        wall.end_y - wall.start_y
    );

    const getDistanceFromWallStart = (wall, point) => Math.hypot(
        point.x - wall.start_x,
        point.y - wall.start_y
    );

    const getIntersectionsForWall = (wallId) => {
        const candidatePoints = [];
        intersections.forEach((inter) => {
            const involved =
                inter.wall_1 === wallId ||
                inter.wall_2 === wallId ||
                (Array.isArray(inter.pairs) &&
                    inter.pairs.some(
                        (pair) =>
                            pair?.wall1?.id === wallId || pair?.wall2?.id === wallId
                    ));
            if (involved) {
                candidatePoints.push({ x: inter.x, y: inter.y });
            }
        });
        return candidatePoints;
    };

    const snapSplitPoint = (wall, x, y) => {
        const intersectionThreshold = (SNAP_THRESHOLD * 3) / scaleFactor.current;
        const endpointThreshold = SNAP_THRESHOLD / scaleFactor.current;
        const segmentThreshold = (SNAP_THRESHOLD * 1.5) / scaleFactor.current;

        let bestPoint = null;
        let bestDistance = Infinity;

        const considerPoint = (point, maxDistance) => {
            const distance = Math.hypot(point.x - x, point.y - y);
            if (distance <= maxDistance && distance < bestDistance) {
                bestPoint = point;
                bestDistance = distance;
            }
        };

        // Intersections associated with this wall
        getIntersectionsForWall(wall.id).forEach((pt) =>
            considerPoint(pt, intersectionThreshold)
        );

        // Endpoints
        considerPoint({ x: wall.start_x, y: wall.start_y }, endpointThreshold);
        considerPoint({ x: wall.end_x, y: wall.end_y }, endpointThreshold);

        if (bestPoint) {
            return bestPoint;
        }

        // Segment projection
        const segmentPoint = snapToWallSegment(x, y, wall);
        if (!segmentPoint) {
            return null;
        }

        const segmentDistance = Math.hypot(segmentPoint.x - x, segmentPoint.y - y);
        if (segmentDistance <= segmentThreshold) {
            return segmentPoint;
        }

        return null;
    };

    const findClosestWallAtPoint = (x, y) => {
        const selectionThreshold = (SNAP_THRESHOLD * 1.5) / scaleFactor.current;

        if (splitTargetWallId) {
            const targetWall = walls.find((w) => w.id === splitTargetWallId);
            if (!targetWall) return null;

            const snapped = snapSplitPoint(targetWall, x, y);
            if (!snapped) return null;

            const distance = Math.hypot(snapped.x - x, snapped.y - y);
            if (distance > selectionThreshold) {
                return null;
            }

            return { wall: targetWall, point: snapped };
        }

        let bestResult = null;
        let bestDistance = Infinity;

        walls.forEach((wall) => {
            const snapped = snapSplitPoint(wall, x, y);
            if (!snapped) return;

            const distance = Math.hypot(snapped.x - x, snapped.y - y);
            if (distance < bestDistance && distance <= selectionThreshold) {
                bestDistance = distance;
                bestResult = { wall, point: snapped };
            }
        });

        return bestResult;
    };

    const resetSplitState = (clearError = false) => {
        setSplitTargetWallId(null);
        setSplitPreviewPoint(null);
        setSplitDistanceInput('');
        setSplitHoverDistance(null);
        setIsProcessingSplit(false);
        setHighlightWalls([]);
        if (clearError) {
            setWallSplitError('');
        }
    };

    const isValidSplitPoint = (wall, point) => {
        const wallLength = getWallLength(wall);
        if (wallLength <= SPLIT_DISTANCE_TOLERANCE) {
            return false;
        }

        const distStart = getDistanceFromWallStart(wall, point);
        const distEnd = Math.hypot(point.x - wall.end_x, point.y - wall.end_y);

        if (distStart < SPLIT_ENDPOINT_TOLERANCE || distEnd < SPLIT_ENDPOINT_TOLERANCE) {
            return false;
        }

        return Math.abs(distStart + distEnd - wallLength) <= SPLIT_DISTANCE_TOLERANCE;
    };

    const getRoundedPoint = (point) => ({
        x: Number(point.x.toFixed(3)),
        y: Number(point.y.toFixed(3))
    });

    const updatePreviewFromDistance = (value) => {
        setSplitDistanceInput(value);
        if (!splitTargetWallId) {
            return;
        }

        const targetWall = walls.find(w => w.id === splitTargetWallId);
        if (!targetWall) {
            return;
        }

        const distance = parseFloat(value);
        if (Number.isNaN(distance) || distance <= 0) {
            setSplitPreviewPoint(null);
            setSplitHoverDistance(null);
            return;
        }

        const wallLength = getWallLength(targetWall);
        if (distance >= wallLength) {
            setSplitPreviewPoint(null);
            setSplitHoverDistance(null);
            return;
        }

        const ratio = distance / wallLength;
        const previewPoint = {
            x: targetWall.start_x + (targetWall.end_x - targetWall.start_x) * ratio,
            y: targetWall.start_y + (targetWall.end_y - targetWall.start_y) * ratio
        };

        const snappedPoint = snapSplitPoint(targetWall, previewPoint.x, previewPoint.y);
        const effectivePoint = snappedPoint || {
            x: Math.round(previewPoint.x),
            y: Math.round(previewPoint.y)
        };
        const roundedPreview = getRoundedPoint(effectivePoint);
        setSplitPreviewPoint(roundedPreview);
        setSplitHoverDistance(getDistanceFromWallStart(targetWall, roundedPreview));
    };

    const handleSplitAtDistance = async () => {
        if (!splitTargetWallId) {
            setWallSplitError('Select a wall to split first.');
            setTimeout(() => setWallSplitError(''), 4000);
            return;
        }

        const targetWall = walls.find(w => w.id === splitTargetWallId);
        if (!targetWall) {
            setWallSplitError('Selected wall could not be found.');
            setTimeout(() => setWallSplitError(''), 4000);
            return;
        }

        const distance = parseFloat(splitDistanceInput);
        if (Number.isNaN(distance) || distance <= 0) {
            setWallSplitError('Enter a valid split distance greater than zero.');
            setTimeout(() => setWallSplitError(''), 4000);
            return;
        }

        const wallLength = getWallLength(targetWall);
        if (distance >= wallLength - SPLIT_ENDPOINT_TOLERANCE) {
            setWallSplitError('Split distance must be smaller than the wall length.');
            setTimeout(() => setWallSplitError(''), 4000);
            return;
        }

        const ratio = distance / wallLength;
        const splitPoint = {
            x: targetWall.start_x + (targetWall.end_x - targetWall.start_x) * ratio,
            y: targetWall.start_y + (targetWall.end_y - targetWall.start_y) * ratio
        };

        const snappedPoint = snapSplitPoint(targetWall, splitPoint.x, splitPoint.y);
        const effectivePoint = snappedPoint || {
            x: Math.round(splitPoint.x),
            y: Math.round(splitPoint.y)
        };
        const roundedSplitPoint = getRoundedPoint(effectivePoint);

        if (!isValidSplitPoint(targetWall, roundedSplitPoint)) {
            setWallSplitError('Split point must lie on the wall and away from its ends.');
            setTimeout(() => setWallSplitError(''), 4000);
            return;
        }

        if (typeof onManualWallSplit !== 'function' || isProcessingSplit) {
            return;
        }

        setSplitPreviewPoint(roundedSplitPoint);
        setSplitHoverDistance(getDistanceFromWallStart(targetWall, roundedSplitPoint));
        setIsProcessingSplit(true);
        try {
            await onManualWallSplit(targetWall.id, roundedSplitPoint);
            resetSplitState(true);
        } catch (error) {
            console.error('Manual wall split (distance) failed:', error);
        } finally {
            setIsProcessingSplit(false);
        }
    };

    // Enhanced click handling with endpoint detection
    const handleCanvasClick = async (event) => {
        // Don't handle clicks if we were dragging the canvas
        if (isDraggingCanvas.current) {
            return;
        }
        
        const { x, y } = getMousePos(event);
        console.log('Canvas clicked! Screen:', event.clientX, event.clientY, 'Model:', x, y, 'currentMode:', currentMode);
        if (!isEditingMode) return;
        
        // Deselect room label when clicking on empty space (but not when actively defining a room)
        if (selectedRoomId !== null && !((currentMode === 'define-room' || currentMode === 'storey-area') && selectedRoomPoints && selectedRoomPoints.length > 0)) {
            setSelectedRoomId(null);
        }
    
        // Intersection selection block (unchanged)
        if (currentMode !== 'add-wall' && currentMode !== 'edit-wall' && currentMode !== 'define-room' && currentMode !== 'storey-area' && currentMode !== 'split-wall') {
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

        // === Split-Wall Mode ===
        if (currentMode === 'split-wall') {
            const closest = findClosestWallAtPoint(x, y);

            if (!closest) {
                setWallSplitError('Click directly on a wall to select it for splitting.');
                setTimeout(() => setWallSplitError(''), 3000);
                return;
            }

            const { wall, point } = closest;
            const roundedPoint = getRoundedPoint(point);

            if (!splitTargetWallId || wall.id !== splitTargetWallId) {
                setSplitTargetWallId(wall.id);
                setSplitPreviewPoint(roundedPoint);
                setSplitDistanceInput('');
                setSplitHoverDistance(getDistanceFromWallStart(wall, roundedPoint));
                setHighlightWalls([{ id: wall.id, color: '#F97316' }]);
                setWallSplitError('');
                return;
            }

            if (!isValidSplitPoint(wall, roundedPoint)) {
                setWallSplitError('Split point must be on the wall and away from its ends.');
                setTimeout(() => setWallSplitError(''), 4000);
                return;
            }

            if (typeof onManualWallSplit !== 'function' || isProcessingSplit) {
                return;
            }

            setIsProcessingSplit(true);
            setSplitPreviewPoint(roundedPoint);
            try {
                await onManualWallSplit(wall.id, roundedPoint);
                resetSplitState(true);
            } catch (error) {
                console.error('Manual wall split failed:', error);
            } finally {
                setIsProcessingSplit(false);
            }
            return;
        }

        // === Add-Door Mode ===
        if (currentMode === 'add-door') {
            let closestWallId = null;
            let minDistance = SNAP_THRESHOLD / scaleFactor.current;
            walls.forEach((wall) => {
                // Skip walls with fill gap mode enabled
                if (wall.fill_gap_mode) {
                    return;
                }
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
          
        // === Define-Room / Storey-Area Mode ===
        const isPolygonMode = currentMode === 'define-room' || currentMode === 'storey-area';
        if (isPolygonMode) {
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
            }
            // 2. Snap to intersections, wall segments, endpoints
            const snapped = snapToClosestPointWithIntersections(x, y, intersections, walls, scaleFactor.current);
            let points = [...selectedRoomPoints];
            // 3. If clicking near the first point and ≥3 points, close polygon
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
        // Handle canvas dragging regardless of editing mode (right mouse button only)
        if (isDraggingCanvas.current) {
            const deltaX = event.clientX - lastMousePos.current.x;
            const deltaY = event.clientY - lastMousePos.current.y;

            offsetX.current += deltaX;
            offsetY.current += deltaY;

            lastMousePos.current = { x: event.clientX, y: event.clientY };

            suppressNextContextMenu.current = true;
            // Trigger a re-render
            setForceRefresh(prev => prev + 1);
            return;
        }

        if (!isEditingMode) {
            return;
        }

        const { x, y } = getMousePos(event);

        if (currentMode === 'split-wall') {
            if (splitTargetWallId) {
                const targetWall = walls.find((w) => w.id === splitTargetWallId);
                if (targetWall) {
                    const snappedPoint = snapSplitPoint(targetWall, x, y);
                    if (snappedPoint) {
                        const rounded = getRoundedPoint(snappedPoint);
                        setSplitPreviewPoint(rounded);
                        setSplitHoverDistance(getDistanceFromWallStart(targetWall, rounded));
                    } else {
                        setSplitPreviewPoint(null);
                    }
                }
            } else {
                const closest = findClosestWallAtPoint(x, y);
                if (closest) {
                    const rounded = getRoundedPoint(closest.point);
                    setSplitPreviewPoint(rounded);
                    setSplitHoverDistance(getDistanceFromWallStart(closest.wall, rounded));
                    setHighlightWalls([{ id: closest.wall.id, color: '#F97316' }]);
                } else {
                    setSplitPreviewPoint(null);
                    setSplitHoverDistance(null);
                    setHighlightWalls([]);
                }
            }
            return;
        }

        if (currentMode === 'define-room' || currentMode === 'storey-area') {
            setHoveredPoint(null); // Disable endpoint hover effect
            return;
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
        if ([
            'add-wall', 'edit-wall', 'add-door', 'merge-wall'
        ].includes(currentMode)) {
            let minWallDistance = SNAP_THRESHOLD / scaleFactor.current;
            let newHoveredWall = null;
            walls.forEach((wall) => {
                // Skip walls with fill gap mode enabled when in add-door mode
                if (currentMode === 'add-door' && wall.fill_gap_mode) {
                    return;
                }
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

    useEffect(() => {
        if (currentMode !== 'split-wall') {
            resetSplitState();
        } else {
            setWallSplitError('');
        }
    }, [currentMode]);

    useEffect(() => {
        if (splitTargetWallId && !walls.some(w => w.id === splitTargetWallId)) {
            resetSplitState();
        }
    }, [splitTargetWallId, walls]);

    useEffect(() => {
        if (wallSplitSuccess) {
            resetSplitState(true);
        }
    }, [wallSplitSuccess]);

    // Add adjustWallForJointType and dependencies from old code
    const originalWallEndpoints = new Map();

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
            // Use gap_fill_height for calculations if gap-fill mode is enabled
            const heightForCalc = (wall.fill_gap_mode && wall.gap_fill_height !== null) 
                ? wall.gap_fill_height 
                : wall.height;
            let panels = calculator.calculatePanels(
                wallLength,
                wall.thickness,
                jointTypes,
                heightForCalc
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

    // Calculate actual project dimensions from wall boundaries
    const actualProjectDimensions = React.useMemo(() => {
        return calculateActualProjectDimensions(walls);
    }, [walls]);

    // Compare actual vs declared dimensions
    const dimensionComparison = React.useMemo(() => {
        return compareDimensions(actualProjectDimensions, project);
    }, [actualProjectDimensions, project]);
    const splitTargetWall = splitTargetWallId ? walls.find(w => w.id === splitTargetWallId) : null;
    const splitTargetWallLength = splitTargetWall ? getWallLength(splitTargetWall) : null;

    // Auto-update project dimensions when actual exceeds declared
    useEffect(() => {
        const updateProjectDimensions = async () => {
            if (!project || !dimensionComparison.exceeds || !actualProjectDimensions) return;
            
            // Only update width and length (height stays the same)
            const newWidth = Math.max(project.width, actualProjectDimensions.width);
            const newLength = Math.max(project.length, actualProjectDimensions.length);
            
            // Only update if there's an actual change needed
            if (newWidth > project.width || newLength > project.length) {
                try {
                    console.log('🔄 Auto-updating project dimensions due to wall exceedance');
                    console.log(`📐 Old: ${project.width}×${project.length}mm → New: ${newWidth}×${newLength}mm`);
                    
                    await api.put(`/projects/${projectId}/`, {
                        ...project,
                        width: newWidth,
                        length: newLength,
                        height: project.height
                    });
                    
                    console.log('✅ Project dimensions updated successfully');
                } catch (error) {
                    console.error('❌ Failed to update project dimensions:', error);
                }
            }
        };
        
        updateProjectDimensions();
    }, [dimensionComparison.exceeds, actualProjectDimensions, project, projectId]);
    
    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        canvas.width = 1000;
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

        // Only set the scale if user hasn't manually zoomed
        if (!isZoomed.current) {
            scaleFactor.current = sf;
        }
        initialScale.current = sf; // Always store the initial scale
        setCurrentScaleFactor(scaleFactor.current);

        // Only reset offset if user hasn't manually dragged the canvas or zoomed
        if (!isDraggingCanvas.current && !isZoomed.current) {
            offsetX.current = (canvas.width - wallWidth * sf) / 2 - minX * sf;
            offsetY.current = (canvas.height - wallHeight * sf) / 2 - minY * sf;
        }
        // === End scale/offset calculation ===

        context.clearRect(0, 0, canvas.width, canvas.height);
        // Draw grid
        drawGrid(context, canvas.width, canvas.height, gridSize, isDrawing);
        
        // Initialize label tracking arrays for collision detection
        const placedLabels = [];
        const allLabels = [];
        
        // Draw overall project dimensions first (highest priority)
        if (walls.length > 0 && dimensionVisibility.project) {
            drawOverallProjectDimensions(
                context,
                walls,
                scaleFactor.current,
                offsetX.current,
                offsetY.current,
                placedLabels, // Share the arrays for collision detection
                allLabels
            );
        }
        
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
            filteredDimensions,
            placedLabels, // Share collision detection arrays
            allLabels,
            dimensionVisibility
        });
        // Store thickness color map for the legend
        setThicknessColorMap(colorMap);
        
        if (Array.isArray(ghostAreas) && ghostAreas.length > 0) {
            ghostAreas.forEach((ghostArea) => {
                const points = Array.isArray(ghostArea.room_points)
                    ? ghostArea.room_points
                    : Array.isArray(ghostArea.points)
                        ? ghostArea.points
                        : [];

                if (points.length < 3) {
                    return;
                }

                const transformedPoints = points.map((point) => ({
                    x: (Number(point.x) || 0) * scaleFactor.current + offsetX.current,
                    y: (Number(point.y) || 0) * scaleFactor.current + offsetY.current,
                }));

                context.save();
                context.beginPath();
                transformedPoints.forEach((point, index) => {
                    if (index === 0) {
                        context.moveTo(point.x, point.y);
                    } else {
                        context.lineTo(point.x, point.y);
                    }
                });
                context.closePath();

                context.globalAlpha = 0.15;
                context.fillStyle = '#BFDBFE';
                context.fill();

                context.globalAlpha = 0.8;
                context.strokeStyle = '#60A5FA';
                context.setLineDash([10, 6]);
                context.lineWidth = Math.max(1, 2 * scaleFactor.current);
                context.stroke();
                context.restore();

                const centroid = transformedPoints.reduce(
                    (acc, point) => {
                        acc.x += point.x;
                        acc.y += point.y;
                        return acc;
                    },
                    { x: 0, y: 0 }
                );
                centroid.x /= transformedPoints.length;
                centroid.y /= transformedPoints.length;

                context.save();
                context.globalAlpha = 0.85;
                context.fillStyle = '#1D4ED8';
                context.font = `${Math.max(12, 160 * scaleFactor.current)}px Arial`;
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                const areaName = ghostArea.room_name || 'Area';
                const originLabel = ghostArea.source_storey_name
                    ? ` (${ghostArea.source_storey_name})`
                    : ' (Below)';
                const label = `${areaName}${originLabel}`;
                context.fillText(label, centroid.x, centroid.y);
                context.restore();
            });
        }

        if (Array.isArray(ghostWalls) && ghostWalls.length > 0) {
            ghostWalls.forEach((ghostWall) => {
                if (
                    ghostWall.start_x === undefined || ghostWall.start_y === undefined ||
                    ghostWall.end_x === undefined || ghostWall.end_y === undefined
                ) {
                    return;
                }

                const startX = ghostWall.start_x * scaleFactor.current + offsetX.current;
                const startY = ghostWall.start_y * scaleFactor.current + offsetY.current;
                const endX = ghostWall.end_x * scaleFactor.current + offsetX.current;
                const endY = ghostWall.end_y * scaleFactor.current + offsetY.current;

                context.save();
                context.strokeStyle = '#94A3B8';
                context.globalAlpha = 0.7;
                context.lineWidth = Math.max(1, (ghostWall.thickness || FIXED_GAP / 2) * scaleFactor.current * 0.5);
                context.setLineDash([12, 6]);
                context.beginPath();
                context.moveTo(startX, startY);
                context.lineTo(endX, endY);
                context.stroke();
                context.restore();
            });
        }

        // Draw doors
        drawDoors(context, doors, walls, scaleFactor.current, offsetX.current, offsetY.current, hoveredDoorId);
        // Draw rooms
        // Draw room preview
        drawRoomPreview(context, selectedRoomPoints, scaleFactor.current, offsetX.current, offsetY.current);
        
        const previewWall =
            splitTargetWall ||
            (highlightWalls.length === 1
                ? walls.find((w) => w.id === highlightWalls[0].id)
                : null);

        if (currentMode === 'split-wall' && splitPreviewPoint) {
            const markerX = splitPreviewPoint.x * scaleFactor.current + offsetX.current;
            const markerY = splitPreviewPoint.y * scaleFactor.current + offsetY.current;
            context.save();
            context.fillStyle = '#F97316';
            context.strokeStyle = '#F97316';
            context.lineWidth = 2;
            context.beginPath();
            context.arc(markerX, markerY, 6, 0, Math.PI * 2);
            context.fill();
            context.stroke();

            if (previewWall && getWallLength(previewWall) > 0) {
                const wallLength = getWallLength(previewWall);
                const dirX = (previewWall.end_x - previewWall.start_x) / wallLength;
                const dirY = (previewWall.end_y - previewWall.start_y) / wallLength;
                const perpX = -dirY;
                const perpY = dirX;
                const cutScreenLength = 28;
                const cutModelHalf = (cutScreenLength / scaleFactor.current) / 2;

                const cutStart = {
                    x: splitPreviewPoint.x - perpX * cutModelHalf,
                    y: splitPreviewPoint.y - perpY * cutModelHalf
                };
                const cutEnd = {
                    x: splitPreviewPoint.x + perpX * cutModelHalf,
                    y: splitPreviewPoint.y + perpY * cutModelHalf
                };

                context.beginPath();
                context.moveTo(
                    cutStart.x * scaleFactor.current + offsetX.current,
                    cutStart.y * scaleFactor.current + offsetY.current
                );
                context.lineTo(
                    cutEnd.x * scaleFactor.current + offsetX.current,
                    cutEnd.y * scaleFactor.current + offsetY.current
                );
                context.stroke();

                if (splitHoverDistance !== null) {
                    context.fillStyle = '#1E293B';
                    context.font = `${Math.max(12, 180 * scaleFactor.current)}px Arial`;
                    context.textAlign = 'left';
                    context.textBaseline = 'bottom';
                    context.fillText(
                        `${Math.round(splitHoverDistance)} mm`,
                        markerX + 10,
                        markerY - 8
                    );
                }
            }

            context.restore();
        }

    }, [
        walls, rooms, selectedWall, tempWall, doors,
        selectedWallsForRoom, joints, isEditingMode,
        hoveredWall, hoveredDoorId, highlightWalls,
        selectedRoomPoints, project, hoveredPoint,
        wallPanelsMap, // Add wallPanelsMap to dependencies
        filteredDimensions, // Add filteredDimensions to dependencies
        forceRefresh, // Add forceRefresh to dependencies to force re-renders
        dimensionVisibility,
        currentMode,
        splitPreviewPoint,
        splitTargetWallId,
        ghostWalls,
        ghostAreas
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

            {/* Dimension Warning Message */}
            {dimensionComparison.exceeds && (
                <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-50 bg-orange-100 border border-orange-400 text-orange-700 px-4 py-3 rounded shadow-lg max-w-md">
                    <div className="flex items-start">
                        <svg className="w-5 h-5 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div>
                            <div className="font-medium mb-1">Project Dimensions Exceeded</div>
                            <div className="text-sm">
                                {dimensionComparison.warnings.map((warning, index) => (
                                    <div key={index}>{warning}</div>
                                ))}
                            </div>
                            <div className="text-xs mt-2 text-orange-600">
                                💡 Purple dimensions show actual project size
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="flex gap-6 items-start">
                {/* Canvas Container */}
                <div className="relative">
                    <canvas
                        ref={canvasRef}
                        data-plan-type="wall"
                        onClick={handleCanvasClick}
                        onMouseMove={handleMouseMove}
                        onMouseDown={handleCanvasMouseDown}
                        onContextMenu={handleCanvasContextMenu}
                        
                        tabIndex={0}
                        className={`border border-gray-300 bg-gray-50 cursor-grab active:cursor-grabbing`}
                    />
                    
                    {/* Zoom Controls Overlay */}
                    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                        <button
                            onClick={handleZoomIn}
                            className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 hover:border-blue-400 transition-all duration-200 flex items-center justify-center group"
                            title="Zoom In"
                        >
                            <svg className="w-5 h-5 text-gray-600 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                            </svg>
                        </button>
                        
                        <button
                            onClick={handleZoomOut}
                            className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 hover:border-blue-400 transition-all duration-200 flex items-center justify-center group"
                            title="Zoom Out"
                        >
                            <svg className="w-5 h-5 text-gray-600 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM18 10H10" />
                            </svg>
                        </button>
                        
                        <button
                            onClick={handleResetZoom}
                            className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 hover:border-green-400 transition-all duration-200 flex items-center justify-center group"
                            title="Reset Zoom"
                        >
                            <svg className="w-5 h-5 text-gray-600 group-hover:text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>
                    
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

                <div className="flex-shrink-0 w-64 space-y-4 sticky top-4">
                    {currentMode === 'split-wall' && (
                        <div className="bg-white border border-emerald-200 rounded-lg p-5 shadow-sm">
                            <h5 className="font-semibold text-gray-900 mb-3">Manual Wall Split</h5>
                            {!splitTargetWall ? (
                                <div className="text-sm text-emerald-700 space-y-2">
                                    <p>Click a wall on the canvas to select it for splitting.</p>
                                    <p>Click again on the wall to split at the snapped point, or enter an exact distance below.</p>
                                </div>
                            ) : (
                                <>
                                    <div className="text-sm text-gray-700 space-y-1 mb-3">
                                        <div className="flex justify-between">
                                            <span className="font-medium">Wall ID:</span>
                                            <span>#{splitTargetWall.id}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium">Length:</span>
                                            <span>{Math.round(splitTargetWallLength || 0)} mm</span>
                                        </div>
                                        {splitHoverDistance !== null && (
                                            <div className="flex justify-between text-emerald-700">
                                                <span className="font-medium">Preview distance:</span>
                                                <span>{Math.round(splitHoverDistance)} mm</span>
                                            </div>
                                        )}
                                    </div>
                                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                                        Distance from start (mm)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={splitDistanceInput}
                                        onChange={(e) => updatePreviewFromDistance(e.target.value)}
                                        className="w-full px-3 py-2 border border-emerald-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                        placeholder="e.g. 1200"
                                    />
                                    <div className="mt-3 flex flex-col gap-2">
                                        <button
                                            onClick={handleSplitAtDistance}
                                            disabled={isProcessingSplit}
                                            className={`w-full px-4 py-2 rounded-lg text-white font-semibold transition-all duration-200 ${
                                                isProcessingSplit
                                                    ? 'bg-emerald-300 cursor-wait'
                                                    : 'bg-emerald-500 hover:bg-emerald-600'
                                            }`}
                                        >
                                            {isProcessingSplit ? 'Splitting...' : 'Split at Distance'}
                                        </button>
                                        <button
                                            onClick={() => resetSplitState(true)}
                                            disabled={isProcessingSplit}
                                            className="w-full px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-all duration-200 text-sm"
                                        >
                                            Clear Selection
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {thicknessColorMap && thicknessColorMap.size > 0 && (
                        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                            <h5 className="font-semibold text-gray-900 mb-4 flex items-center">
                                <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                </svg>
                                Wall Finish Legend
                            </h5>
                            <div className="space-y-3">
                                {Array.from(thicknessColorMap.entries()).map(([key, colors]) => (
                                    <div key={key} className="space-y-1">
                                        <div className="flex items-center">
                                            {/* Mini wall representation - two close lines with end caps */}
                                            <div className="mr-3 relative" style={{ width: '60px', height: '16px' }}>
                                                {/* Geometry constants for layout */}
                                                {(() => {
                                                    const lineHeight = 2; // px
                                                    const gap = 4; // px between the two lines (closer)
                                                    const topY = 4; // px from top
                                                    const bottomY = topY + gap + lineHeight; // maintain small gap
                                                    const capWidth = 1; // px
                                                    const capLeft = 0;
                                                    const capRight = 'calc(100% - 1px)';

                                                    if (colors.hasDifferentFaces) {
                                                        return (
                                                            <>
                                                                {/* Outer face (top line) */}
                                                                <div
                                                                    className="absolute left-0 right-0"
                                                                    style={{
                                                                        top: `${topY}px`,
                                                                        height: `${lineHeight}px`,
                                                                        backgroundColor: colors.wall
                                                                    }}
                                                                    title="Outer face"
                                                                ></div>
                                                                {/* Inner face (bottom line) */}
                                                                <div
                                                                    className="absolute left-0 right-0"
                                                                    style={{
                                                                        top: `${bottomY}px`,
                                                                        height: `${lineHeight}px`,
                                                                        backgroundColor: colors.innerWall
                                                                    }}
                                                                    title="Inner face"
                                                                ></div>
                                                                {/* End caps - left */}
                                                                <div
                                                                    className="absolute"
                                                                    style={{
                                                                        left: `${capLeft}px`,
                                                                        top: `${topY}px`,
                                                                        width: `${capWidth}px`,
                                                                        height: `${(bottomY + lineHeight) - topY}px`,
                                                                        backgroundColor: colors.innerWall
                                                                    }}
                                                                ></div>
                                                                {/* End caps - right */}
                                                                <div
                                                                    className="absolute"
                                                                    style={{
                                                                        left: capRight,
                                                                        top: `${topY}px`,
                                                                        width: `${capWidth}px`,
                                                                        height: `${(bottomY + lineHeight) - topY}px`,
                                                                        backgroundColor: colors.innerWall
                                                                    }}
                                                                ></div>
                                                            </>
                                                        );
                                                    }

                                                    // Same material on both faces: draw two close lines with same color
                                                    return (
                                                        <>
                                                            <div
                                                                className="absolute left-0 right-0"
                                                                style={{
                                                                    top: `${topY}px`,
                                                                    height: `${lineHeight}px`,
                                                                    backgroundColor: colors.wall
                                                                }}
                                                            ></div>
                                                            <div
                                                                className="absolute left-0 right-0"
                                                                style={{
                                                                    top: `${bottomY}px`,
                                                                    height: `${lineHeight}px`,
                                                                    backgroundColor: colors.wall
                                                                }}
                                                            ></div>
                                                            {/* Caps */}
                                                            <div
                                                                className="absolute"
                                                                style={{
                                                                    left: `${capLeft}px`,
                                                                    top: `${topY}px`,
                                                                    width: `${capWidth}px`,
                                                                    height: `${(bottomY + lineHeight) - topY}px`,
                                                                    backgroundColor: colors.wall
                                                                }}
                                                            ></div>
                                                            <div
                                                                className="absolute"
                                                                style={{
                                                                    left: capRight,
                                                                    top: `${topY}px`,
                                                                    width: `${capWidth}px`,
                                                                    height: `${(bottomY + lineHeight) - topY}px`,
                                                                    backgroundColor: colors.wall
                                                                }}
                                                            ></div>
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                            <span className="text-sm text-gray-700 font-medium">{colors.label}</span>
                                        </div>
                                        {(() => {
                                            // Parse combo key: `${core}|INT:${intThk} ${intMat}|EXT:${extThk} ${extMat}`
                                            const parts = String(key).split('|');
                                            const core = parts[0];
                                            const intPart = (parts[1] || '').replace('INT:', '').trim();
                                            const extPart = (parts[2] || '').replace('EXT:', '').trim();
                                            return (
                                                <div className="ml-0 pl-0 text-xs text-gray-600">
                                                    <div><span className="font-medium">Panel Thickness:</span> {core}mm</div>
                                                    <div><span className="font-medium">Finishing:</span> Ext: {extPart} | Int: {intPart}</div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
                                💡 <strong>Tip:</strong> Different colors represent unique combinations of core thickness and inner/outer finishes. When materials differ, walls show two lines (top=outer, bottom=inner).
                            </div>
                        </div>
                    )}

                    <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                        <h5 className="font-semibold text-gray-900 mb-4 flex items-center">
                            <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M5 12h16M8 18h13" />
                            </svg>
                            Dimension Labels
                        </h5>
                        <div className="space-y-3 text-sm text-gray-700">
                            <label className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.project}
                                    onChange={() => handleDimensionVisibilityChange('project')}
                                />
                                <span>Overall project dimensions</span>
                            </label>
                            <label className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.wall}
                                    onChange={() => handleDimensionVisibilityChange('wall')}
                                />
                                <span>Wall dimensions</span>
                            </label>
                            <label className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.panel}
                                    onChange={() => handleDimensionVisibilityChange('panel')}
                                />
                                <span>Side Panel dimensions</span>
                            </label>
                        </div>
                    </div>
                </div>
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
                intersections={intersections}
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