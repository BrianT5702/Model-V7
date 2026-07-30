import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../api/api';
import PanelCalculationControls from '../panel/PanelCalculationControls';
import {
    buildProjectWallPanelsMap,
    getWallCalculationFingerprint,
} from '../panel/wallPanelCalculationUtils';
import DoorTable from '../door/DoorTable';
import WallElevationViews from '../panel/WallElevationViews';
import { buildWallElevations } from '../panel/wallElevationUtils';
import {
    calculatePolygonArea,
    findIntersectionPointsBetweenWalls,
    getRoomSelectionSnapPoints,
    calculateLineIntersection,
} from './utils';
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
  compareDimensions,
  findHostWallNearPoint,
  getWallAngleSnapThresholdDeg,
  snapWallEndToPreferredAngles,
} from './drawing';
import InteractiveRoomLabel from './InteractiveRoomLabel';
import InteractivePlanAnnotation from './InteractivePlanAnnotation';
import { isCoarsePointerDevice, bindPlanCanvasMobileTouch, measurePlanCanvasBox } from '../../utils/pointerUtils';
import PlanCanvasZoomControls from './PlanCanvasZoomControls';
import { drawPlanAnnotationArrows, isPointNearPlanAnnotation } from './drawPlanAnnotations';
import {
    buildPlanNoteFromPlacement,
    getPlanNotePlacementRect,
} from './planAnnotationUtils';
import { adjustPlanStrokeColor, getPlanCanvasBackground, getPlanWallHighlightColor } from './planCanvasTheme';
import { useTheme } from '../theme/ThemeContext';
import { useShare } from '../share/ShareContext';
import { drawDoors } from './utils';
import { detectClickedDoor, detectHoveredDoor } from './utils';
import { filterDimensions } from './dimensionFilter.js';
import { planCeilingValueDedupKey } from './DimensionConfig.js';

const Canvas2D = ({ 
    walls = [], 
    setWalls, 
    projectId,
    project,
    joints = [],
    onNewWall, 
    onWallTypeSelect,
    wallThickness = 200,
    deductCornerThickness = false,
    onDeductCornerThicknessChange = null,
    autoSplitOnIntersect = true,
    wallHeight = 2800,
    innerFaceMaterial = 'PPGI',
    innerFaceThickness = 0.5,
    outerFaceMaterial = 'PPGI',
    outerFaceThickness = 0.5,
    isEditingMode, 
    currentMode, 
    setCurrentMode = () => {}, // Add prop to allow exiting modes
    onWallSelect, 
    onWallDelete, 
    selectedWallsForRoom = [], 
    onRoomWallsSelect,
    isMultiWallEditMode = false,
    selectedWallsForEdit = [],
    onWallsForEditSelect = () => {},
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
    wallSplitSuccess = false,
    onRefreshWalls = null, // Callback to refresh walls from all storeys
    allWalls = null, // All walls (unfiltered) for panel calculations across all storeys
    allDoors = null, // All doors (unfiltered) for whole-model elevations
    allRooms = null, // All rooms (unfiltered) for elevation base heights
    // Panel division visibility is controlled by parent (ProjectDetails/useProjectDetails)
    showPanelLines = false,
    onTogglePanelLines = () => {},
    commentWallSelectMode = false,
    selectedWallsForComment = [],
    onCommentWallSelect = () => {},
    commentHighlightWallIds = [],
    canAnnotate = false,
    planAnnotateMode = false,
    planNoteAddMode = false,
    onPlanNoteAddModeChange = () => {},
    planAnnotations = [],
    selectedPlanAnnotationId = null,
    onSelectPlanAnnotation = () => {},
    onCreatePlanAnnotation = async () => null,
    onUpdatePlanAnnotation = async () => {},
    onDeletePlanAnnotation = async () => {},
    planAnnotationArrowPlacementId = null,
    onPlanAnnotationArrowPlacementId = () => {},
    annotationIdRemap = null,
}) => {

    const canvasRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const { isViewOnlyShare } = useShare();
    const [selectedWall, setSelectedWall] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tempWall, setTempWall] = useState(null);
    const [hoveredWall, setHoveredWall] = useState(null);
    const [hoveredPoint, setHoveredPoint] = useState(null);
    const [showLengthInput, setShowLengthInput] = useState(false);
    const [pendingWallData, setPendingWallData] = useState(null);
    const [currentScaleFactor, setCurrentScaleFactor] = useState(1);
    const [intersections, setIntersections] = useState([]);
    // Define-room snap targets: partition butt-ins extended to centerline corners
    const roomSelectionSnapPoints = React.useMemo(
        () => getRoomSelectionSnapPoints(walls, intersections),
        [walls, intersections]
    );
    const [calculatedWallPanelsMap, setCalculatedWallPanelsMap] = useState(null);
    const [calculatedWallPanelsFingerprint, setCalculatedWallPanelsFingerprint] = useState(null);
    const [selectedIntersection, setSelectedIntersection] = useState(null);
    // Multi-select joint intersections (Ctrl/Cmd/Shift+click). Primary panel still
    // mirrors selectedIntersection as the "focused" one when only one is picked.
    const [selectedIntersections, setSelectedIntersections] = useState([]);
    const [bulkJointMethod, setBulkJointMethod] = useState('butt_in');
    const [bulkDeductThickness, setBulkDeductThickness] = useState(false);
    const [highlightWalls, setHighlightWalls] = useState([]);
    const [selectedJointPair, setSelectedJointPair] = useState(null);
    const [hoveredDoorId, setHoveredDoorId] = useState(null);
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
    const [showMaterialNeeded, setShowMaterialNeeded] = useState(false);
    const [showElevations, setShowElevations] = useState(false);
    const [wallElevations, setWallElevations] = useState(null);
    const [isGeneratingElevations, setIsGeneratingElevations] = useState(false);

    const getIntersectionKey = (inter) => {
        if (!inter) return '';
        if (inter.id != null) return `id:${inter.id}`;
        return `${Math.round(Number(inter.x) || 0)},${Math.round(Number(inter.y) || 0)}`;
    };

    const clearJointSelection = () => {
        setSelectedIntersection(null);
        setSelectedIntersections([]);
        setHighlightWalls([]);
        setSelectedJointPair(null);
    };

    const syncFocusedIntersection = (list) => {
        setSelectedIntersections(list);
        setSelectedIntersection(list.length > 0 ? list[list.length - 1] : null);
        if (list.length === 0) {
            setHighlightWalls([]);
            setSelectedJointPair(null);
        }
    };

    const handleGenerateElevations = useCallback(() => {
        if (showElevations && wallElevations) {
            setShowElevations(false);
            return;
        }
        setIsGeneratingElevations(true);
        try {
            const data = buildWallElevations({
                walls,
                allWalls: allWalls || walls,
                doors: allDoors || doors,
                rooms: allRooms || rooms,
            });
            setWallElevations(data);
            setShowElevations(true);
        } finally {
            setIsGeneratingElevations(false);
        }
    }, [showElevations, wallElevations, walls, allWalls, allDoors, allRooms, doors, rooms]);
    
    // Canvas size constants (matching CeilingCanvas)
    const DEFAULT_CANVAS_WIDTH = 1000;
    const DEFAULT_CANVAS_HEIGHT = 650;
    // Mobile-friendly minimum sizes - smaller for phones, larger for tablets/desktop
    const MIN_CANVAS_WIDTH = 320; // Reduced from 480 for better mobile support
    const MIN_CANVAS_HEIGHT = 240; // Reduced from 320 for better mobile support
    const CANVAS_HEIGHT = DEFAULT_CANVAS_HEIGHT; // For styling consistency with CeilingCanvas
    const [canvasSize, setCanvasSize] = useState({
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    });


    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [wallMergeError, setWallMergeError] = useState('');
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [roomLabelPositions, setRoomLabelPositions] = useState([]);
    const [forceRefresh, setForceRefresh] = useState(0);
    const { resolvedTheme } = useTheme();

    const lastRoomDataRef = useRef({ rooms: [], walls: [] });
    // Skip O(n²) intersection rematch when wall geometry + joint methods are unchanged
    // (e.g. material/face edits still replace the walls array).
    const intersectionFingerprintRef = useRef('');
    // When the canvas is resized, we recalc offsetX/offsetY via refs in a layout effect.
    // Room labels depend on those refs, but refs don't trigger rerenders, so we guard
    // a single "force rerender" per canvas-size change to keep overlays aligned.
    const lastOffsetRecalcSizeRef = useRef({ width: -1, height: -1 });
    const thicknessColorMapRef = useRef(new Map());
    const [thicknessColorMap, setThicknessColorMap] = useState(new Map());
    const [dimensionVisibility, setDimensionVisibility] = useState({
        project: true,
        wall: true,
        panel: false
    });
    const [splitTargetWallId, setSplitTargetWallId] = useState(null);
    const [splitPreviewPoint, setSplitPreviewPoint] = useState(null);
    const [splitDistanceInput, setSplitDistanceInput] = useState('');
    const [splitHoverDistance, setSplitHoverDistance] = useState(null);
    const [isProcessingSplit, setIsProcessingSplit] = useState(false);
    const [autoEditPlanAnnotationId, setAutoEditPlanAnnotationId] = useState(null);
    const [isPlacingPlanNote, setIsPlacingPlanNote] = useState(false);
    const [placementPreviewTick, setPlacementPreviewTick] = useState(0);
    const suppressNextPlanNoteClickRef = useRef(false);
    const planNotePlacementRef = useRef(null);
    const getPointerModelPosRef = useRef(() => ({ x: 0, y: 0 }));

    useEffect(() => {
        if (!annotationIdRemap) {
            return;
        }
        setAutoEditPlanAnnotationId((prev) => (
            prev === annotationIdRemap.from ? annotationIdRemap.to : prev
        ));
    }, [annotationIdRemap]);

    const cancelPlanNotePlacement = useCallback(() => {
        planNotePlacementRef.current = null;
        setIsPlacingPlanNote(false);
    }, []);

    const finalizePlanNotePlacement = useCallback((placement) => {
        const box = buildPlanNoteFromPlacement(
            { x: placement.startX, y: placement.startY },
            { x: placement.currentX, y: placement.currentY },
            scaleFactor.current,
        );
        const created = onCreatePlanAnnotation(box);
        if (created?.id) {
            onSelectPlanAnnotation(created.id);
            setAutoEditPlanAnnotationId(created.id);
        }
        suppressNextPlanNoteClickRef.current = true;
        planNotePlacementRef.current = null;
        setIsPlacingPlanNote(false);
        onPlanNoteAddModeChange(false);
    }, [onCreatePlanAnnotation, onSelectPlanAnnotation, onPlanNoteAddModeChange]);

    const startPlanNotePlacement = useCallback((x, y) => {
        planNotePlacementRef.current = { startX: x, startY: y, currentX: x, currentY: y };
        setIsPlacingPlanNote(true);
        setPlacementPreviewTick((tick) => tick + 1);
    }, []);

    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const scaleFactor = useRef(1);
    const initialScale = useRef(1); // Track the initial scale
    const isZoomed = useRef(false); // Track if user has manually zoomed
    
    // Canvas dragging state
    const isDraggingCanvas = useRef(false);
    const suppressNextContextMenu = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const lastTouchPos = useRef({ x: 0, y: 0 });
    const lastTwoFingerCenter = useRef(null);
    const isTouchDragging = useRef(false);
    const touchStartTime = useRef(0);

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
        
        // No minimum zoom out - allow scaling down with a small floor to avoid numerical issues
        const newScale = Math.max(0.005, scaleFactor.current * 0.8);
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
        // Use display dimensions, not scaled dimensions
        const canvasCenterX = canvasSize.width / 2;
        const canvasCenterY = canvasSize.height / 2;
        
        // Calculate the current view center in model coordinates
        const currentViewCenterX = (canvasCenterX - offsetX.current) / scaleFactor.current;
        const currentViewCenterY = (canvasCenterY - offsetY.current) / scaleFactor.current;
        
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

    // Canvas dragging functions
    const handleCanvasMouseDown = (e) => {
        if (planAnnotateMode && planNoteAddMode && canAnnotate && !planAnnotationArrowPlacementId && e.button === 0) {
            const { x, y } = getPointerModelPosRef.current(e.clientX, e.clientY);
            startPlanNotePlacement(x, y);
            e.preventDefault();
            return;
        }

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

    // Touch: React handlers cover annotate + non-phone. Phone pan/scroll uses native
    // non-passive listeners (bindPlanCanvasMobileTouch) because React touchmove is often passive.
    const handleTouchStart = (e) => {
        if (planAnnotateMode && planNoteAddMode && canAnnotate && !planAnnotationArrowPlacementId && e.touches.length === 1) {
            const touch = e.touches[0];
            const { x, y } = getPointerModelPosRef.current(touch.clientX, touch.clientY);
            startPlanNotePlacement(x, y);
            e.preventDefault();
            return;
        }

        if (isCoarsePointerDevice()) {
            // Pan / page-scroll handled by bindPlanCanvasMobileTouch
            return;
        }

        if (e.touches.length === 1) {
            const touch = e.touches[0];
            touchStartTime.current = Date.now();
            lastTouchPos.current = { x: touch.clientX, y: touch.clientY };
            isTouchDragging.current = false;
        }
    };

    const handleTouchMove = (e) => {
        if (planNotePlacementRef.current && e.touches.length === 1) {
            const touch = e.touches[0];
            const { x, y } = getPointerModelPosRef.current(touch.clientX, touch.clientY);
            planNotePlacementRef.current = {
                ...planNotePlacementRef.current,
                currentX: x,
                currentY: y,
            };
            setPlacementPreviewTick((tick) => tick + 1);
            e.preventDefault();
            return;
        }

        if (isCoarsePointerDevice()) {
            return;
        }

        if (e.touches.length === 1 && lastTouchPos.current) {
            const touch = e.touches[0];
            const deltaX = touch.clientX - lastTouchPos.current.x;
            const deltaY = touch.clientY - lastTouchPos.current.y;
            const movementDistance = Math.hypot(deltaX, deltaY);

            if (movementDistance > 5) {
                if (!isTouchDragging.current) {
                    isTouchDragging.current = true;
                    isDraggingCanvas.current = true;
                    isZoomed.current = true;
                    e.preventDefault();
                }

                if (isTouchDragging.current) {
                    offsetX.current += deltaX;
                    offsetY.current += deltaY;
                    lastTouchPos.current = { x: touch.clientX, y: touch.clientY };
                    setForceRefresh((prev) => prev + 1);
                    e.preventDefault();
                }
            }
        } else if (e.touches.length > 1) {
            isTouchDragging.current = false;
            isDraggingCanvas.current = false;
        }
    };

    const handleTouchEnd = (e) => {
        if (planNotePlacementRef.current) {
            const touch = e.changedTouches[0];
            if (touch) {
                const { x, y } = getPointerModelPosRef.current(touch.clientX, touch.clientY);
                finalizePlanNotePlacement({
                    ...planNotePlacementRef.current,
                    currentX: x,
                    currentY: y,
                });
            }
            e.preventDefault();
            return;
        }

        if (isCoarsePointerDevice()) {
            isTouchDragging.current = false;
            isDraggingCanvas.current = false;
            lastTouchPos.current = null;
            return;
        }

        const touchDuration = Date.now() - touchStartTime.current;
        const wasTap = !isTouchDragging.current && touchDuration < 300;

        isTouchDragging.current = false;
        isDraggingCanvas.current = false;
        lastTouchPos.current = null;

        if (!wasTap) {
            e.preventDefault();
        }
    };

    // Phone: native non-passive touch so horizontal pan is not locked by passive React listeners
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        return bindPlanCanvasMobileTouch(canvas, {
            shouldHandleOneFinger: () => !(
                planAnnotateMode && planNoteAddMode && canAnnotate && !planAnnotationArrowPlacementId
            ),
            onOneFingerPan: (dx, dy) => {
                offsetX.current += dx;
                offsetY.current += dy;
                isTouchDragging.current = true;
                isDraggingCanvas.current = true;
                isZoomed.current = true;
                setForceRefresh((prev) => prev + 1);
            },
            onTwoFingerPan: (dx, dy) => {
                offsetX.current += dx;
                offsetY.current += dy;
                isTouchDragging.current = true;
                isDraggingCanvas.current = true;
                isZoomed.current = true;
                setForceRefresh((prev) => prev + 1);
            },
        });
    }, [planAnnotateMode, planNoteAddMode, canAnnotate, planAnnotationArrowPlacementId]);

    // Handle right-click (context menu) for define-room mode and cancel add-wall mode
    const handleCanvasContextMenu = (event) => {
        event.preventDefault();
        // Handle right-click in polygon modes
        if ((currentMode === 'define-room' || currentMode === 'storey-area') && selectedRoomPoints && selectedRoomPoints.length > 0) {
            const points = [...selectedRoomPoints];
            if (points.length > 0) {
                points.pop();
                onUpdateRoomPoints(points);
            }
        }
        // Cancel add-wall mode when right-clicking during drawing
        else if (currentMode === 'add-wall' && isDrawing) {
            setTempWall(null);
            setIsDrawing(false);
            setCurrentMode(null);
        }
    };

    // Add global mouse up and touch end event listeners for canvas dragging
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            isDraggingCanvas.current = false;
        };
        
        const handleGlobalTouchEnd = () => {
            isTouchDragging.current = false;
            isDraggingCanvas.current = false;
            lastTwoFingerCenter.current = null;
        };
        
        document.addEventListener('mouseup', handleGlobalMouseUp);
        document.addEventListener('touchend', handleGlobalTouchEnd);
        document.addEventListener('touchcancel', handleGlobalTouchEnd);
        
        return () => {
            document.removeEventListener('mouseup', handleGlobalMouseUp);
            document.removeEventListener('touchend', handleGlobalTouchEnd);
            document.removeEventListener('touchcancel', handleGlobalTouchEnd);
        };
    }, []);

    // Add ESC key handler to exit add-wall mode
    useEffect(() => {
        const handleKeyDown = (event) => {
            // Exit add-wall mode when ESC is pressed
            if (event.key === 'Escape' && currentMode === 'add-wall') {
                setTempWall(null);
                setIsDrawing(false);
                setCurrentMode(null);
            }
        };
        
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [currentMode, setCurrentMode]);

    // Clean up drawing state when exiting add-wall mode
    useEffect(() => {
        if (currentMode !== 'add-wall') {
            // Clear drawing state when not in add-wall mode
            if (isDrawing || tempWall) {
                setTempWall(null);
                setIsDrawing(false);
            }
        }
    }, [currentMode, isDrawing, tempWall]);

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
    const gridSize = 50;

    //start here about the room area defining
    const calculateRoomArea = useCallback((roomWalls) => {
        if (!roomWalls || roomWalls.length < 3) return null;

        // Calculate ROOM_INSET using a default wall thickness (100mm) for room area calculation
        const DEFAULT_WALL_THICKNESS = 100; // Default wall thickness in mm
        const ROOM_INSET = (DEFAULT_WALL_THICKNESS / 2) + 150;
    
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
    }, []);
    
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

    // Check if a point is in any ghosted area
    const isPointInGhostedArea = (point) => {
        if (!Array.isArray(ghostAreas) || ghostAreas.length === 0) {
            return false;
        }
        for (const ghostArea of ghostAreas) {
            const points = Array.isArray(ghostArea.room_points)
                ? ghostArea.room_points
                : Array.isArray(ghostArea.points)
                    ? ghostArea.points
                    : [];
            if (points.length >= 3) {
                const normalizedPolygon = points.map((pt) => ({
                    x: Number(pt.x) || 0,
                    y: Number(pt.y) || 0,
                }));
                if (isPointInPolygon(point, normalizedPolygon)) {
                    return true;
                }
            }
        }
        return false;
    };

    // Use for getting correct mouse position
    const getPointerModelPos = (clientX, clientY) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const x = (clientX - rect.left - offsetX.current) / scaleFactor.current;
        const y = (clientY - rect.top - offsetY.current) / scaleFactor.current;
        return { x, y };
    };

    getPointerModelPosRef.current = getPointerModelPos;

    const getMousePos = (event) => getPointerModelPos(event.clientX, event.clientY);

    useEffect(() => {
        if (!isPlacingPlanNote) {
            return undefined;
        }

        const handleMove = (event) => {
            if (!planNotePlacementRef.current) {
                return;
            }
            const { x, y } = getPointerModelPosRef.current(event.clientX, event.clientY);
            planNotePlacementRef.current = {
                ...planNotePlacementRef.current,
                currentX: x,
                currentY: y,
            };
            setPlacementPreviewTick((tick) => tick + 1);
        };

        const handleUp = (event) => {
            const current = planNotePlacementRef.current;
            if (!current) {
                return;
            }
            const { x, y } = getPointerModelPosRef.current(event.clientX, event.clientY);
            finalizePlanNotePlacement({ ...current, currentX: x, currentY: y });
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [isPlacingPlanNote, finalizePlanNotePlacement]);

    useEffect(() => {
        if (!planAnnotateMode || !planNoteAddMode) {
            cancelPlanNotePlacement();
        }
    }, [planAnnotateMode, planNoteAddMode, cancelPlanNotePlacement]);

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

        // Check snapping to wall segments
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

    // Check if a point actually snapped (within threshold)
    // Returns true only if the point moved to a different location (snapped to something)
    const didPointSnap = (originalPoint, snappedPoint) => {
        const distance = Math.hypot(
            originalPoint.x - snappedPoint.x,
            originalPoint.y - snappedPoint.y
        );
        const threshold = SNAP_THRESHOLD / scaleFactor.current;
        const epsilon = 0.001; // Minimum distance to consider it actually snapped
        // Point snapped if it moved more than epsilon and is within threshold
        return distance > epsilon && distance < threshold;
    };

    /** True when pt is on a wall endpoint (geometry lock — skip ortho angle snap). */
    const isPointOnWallEndpoint = (pt, tolMm = 0.75) => {
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false;
        for (const wall of walls) {
            if (Math.hypot(pt.x - wall.start_x, pt.y - wall.start_y) <= tolMm) return true;
            if (Math.hypot(pt.x - wall.end_x, pt.y - wall.end_y) <= tolMm) return true;
        }
        return false;
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

    // Helper: snap for define-room. When selectionSnapPoints provided, use those
    // (partition corners extended). Otherwise geometric intersections + endpoints.
    function snapToClosestPointWithIntersections(x, y, intersections, walls, scaleFactor, selectionSnapPoints = null) {
        let closestPoint = { x, y };
        const maxWallThick = (walls || []).reduce(
            (max, wall) => Math.max(max, Number(wall.thickness) || 0),
            0
        );

        if (Array.isArray(selectionSnapPoints) && selectionSnapPoints.length > 0) {
            // Reach extended partition corners from shortened tips (~host thickness away).
            let minDistance = Math.max(SNAP_THRESHOLD * 2 / scaleFactor, maxWallThick + 25);
            selectionSnapPoints.forEach((pt) => {
                const distance = Math.hypot(pt.x - x, pt.y - y);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPoint = { x: pt.x, y: pt.y };
                }
            });
            return closestPoint;
        }

        let minDistance = SNAP_THRESHOLD * 2 / scaleFactor;
        (intersections || []).forEach(inter => {
            const distance = Math.hypot(inter.x - x, inter.y - y);
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = { x: inter.x, y: inter.y };
            }
        });
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
        const intersectionThreshold = (SNAP_THRESHOLD * 2) / scaleFactor.current;
        const endpointThreshold = SNAP_THRESHOLD / scaleFactor.current;
        const segmentThreshold = (SNAP_THRESHOLD * 1.5) / scaleFactor.current;
        const wallThick = Number(wall.thickness) || 0;

        let bestPoint = null;
        let bestDistance = Infinity;

        const considerPoint = (point, maxDistance) => {
            const distance = Math.hypot(point.x - x, point.y - y);
            if (distance <= maxDistance && distance < bestDistance) {
                bestPoint = point;
                bestDistance = distance;
            }
        };

        // Intersections associated with this wall — always project onto the wall
        // segment. Partition butt-in tips are offset from the host centerline and
        // would otherwise block splits ("point must lie on the selected wall").
        getIntersectionsForWall(wall.id).forEach((pt) => {
            const onWall = snapToWallSegment(pt.x, pt.y, wall);
            if (!onWall) return;
            const projDist = Math.hypot(onWall.x - pt.x, onWall.y - pt.y);
            if (projDist > wallThick * 2 + 50) return;
            considerPoint(onWall, intersectionThreshold + wallThick);
        });

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
            if (distance > selectionThreshold + (Number(targetWall.thickness) || 0)) {
                return null;
            }

            return { wall: targetWall, point: snapped };
        }

        let bestResult = null;
        let bestPerp = Infinity;
        let bestDistance = Infinity;

        walls.forEach((wall) => {
            const snapped = snapSplitPoint(wall, x, y);
            if (!snapped) return;

            const distance = Math.hypot(snapped.x - x, snapped.y - y);
            const thick = Number(wall.thickness) || 0;
            if (distance > selectionThreshold + thick) return;

            // Prefer the wall whose body is nearest the click (host over partition tip).
            const onSeg = snapToWallSegment(x, y, wall);
            const perp = onSeg
                ? Math.hypot(onSeg.x - x, onSeg.y - y)
                : distance;
            const isPartition = String(wall.application_type || '').toLowerCase() === 'partition';
            const scorePerp = perp + (isPartition ? thick * 0.35 : 0);

            if (
                scorePerp < bestPerp - 0.5
                || (Math.abs(scorePerp - bestPerp) <= 0.5 && distance < bestDistance)
            ) {
                bestPerp = scorePerp;
                bestDistance = distance;
                bestResult = { wall, point: snapped };
            }
        });

        return bestResult;
    };

    const resetSplitState = useCallback((clearError = false) => {
        setSplitTargetWallId(null);
        setSplitPreviewPoint(null);
        setSplitDistanceInput('');
        setSplitHoverDistance(null);
        setIsProcessingSplit(false);
        setHighlightWalls([]);
        if (clearError) {
            setWallSplitError('');
        }
    }, [setWallSplitError]);

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

        if (commentWallSelectMode) {
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
                const updatedSelection = [...selectedWallsForComment];
                const wallIndex = updatedSelection.indexOf(selectedId);
                if (wallIndex === -1) {
                    updatedSelection.push(selectedId);
                } else {
                    updatedSelection.splice(wallIndex, 1);
                }
                onCommentWallSelect(updatedSelection);
            }
            return;
        }

        if (planAnnotateMode && canAnnotate) {
            if (suppressNextPlanNoteClickRef.current) {
                suppressNextPlanNoteClickRef.current = false;
                return;
            }

            if (planAnnotationArrowPlacementId) {
                onUpdatePlanAnnotation(planAnnotationArrowPlacementId, {
                    arrow_target_x: x,
                    arrow_target_y: y,
                });
                onPlanAnnotationArrowPlacementId(null);
                return;
            }

            const canvasX = x * scaleFactor.current + offsetX.current;
            const canvasY = y * scaleFactor.current + offsetY.current;
            const hitAnnotation = [...planAnnotations].reverse().find((annotation) => (
                isPointNearPlanAnnotation(
                    canvasX,
                    canvasY,
                    annotation,
                    scaleFactor.current,
                    offsetX.current,
                    offsetY.current
                )
            ));

            if (hitAnnotation) {
                onSelectPlanAnnotation(hitAnnotation.id);
                return;
            }

            return;
        }

        if (!isEditingMode) return;
        
        // Deselect room label when clicking on empty space (but not when actively defining a room)
        if (selectedRoomId !== null && !((currentMode === 'define-room' || currentMode === 'storey-area') && selectedRoomPoints && selectedRoomPoints.length > 0)) {
            setSelectedRoomId(null);
        }
    
        // Intersection / joint selection — geometric positions only (butt-in tip),
        // closest wins. Do NOT use extended display points: those sit on the host
        // line and collide with collinear wall endpoint joints (e.g. 8706↔8707).
        if (
            currentMode !== 'add-wall'
            && currentMode !== 'edit-wall'
            && currentMode !== 'define-room'
            && currentMode !== 'storey-area'
            && currentMode !== 'split-wall'
            && currentMode !== 'add-door'
            && currentMode !== 'edit-door'
            && currentMode !== 'merge-wall'
        ) {
            const hitThreshold = (SNAP_THRESHOLD * 2.5) / scaleFactor.current;
            let bestInter = null;
            let bestDistance = Infinity;
            let bestIsPartition = false;

            const interInvolvesPartition = (inter) => {
                const ids = [];
                if (inter.wall_1 != null) ids.push(inter.wall_1);
                if (inter.wall_2 != null) ids.push(inter.wall_2);
                if (Array.isArray(inter.pairs)) {
                    inter.pairs.forEach((pair) => {
                        ids.push(pair.wall1?.id ?? pair.wall1);
                        ids.push(pair.wall2?.id ?? pair.wall2);
                    });
                }
                return ids.some((id) => {
                    const wall = walls.find((w) => String(w.id) === String(id));
                    return wall && String(wall.application_type || '').toLowerCase() === 'partition';
                });
            };

            for (const inter of intersections) {
                if (!Number.isFinite(inter.x) || !Number.isFinite(inter.y)) continue;
                const distance = Math.hypot(inter.x - x, inter.y - y);
                if (distance >= hitThreshold) continue;
                const isPartitionJoint = interInvolvesPartition(inter);
                // Prefer partition butt-in when distances are effectively tied
                // (extended host junction sits on collinear wall splits).
                const better =
                    distance < bestDistance - 0.5
                    || (Math.abs(distance - bestDistance) <= 0.5 && isPartitionJoint && !bestIsPartition);
                if (better) {
                    bestDistance = distance;
                    bestInter = inter;
                    bestIsPartition = isPartitionJoint;
                }
            }

            if (bestInter) {
                const key = getIntersectionKey(bestInter);
                const multiToggle = Boolean(event.ctrlKey || event.metaKey);
                setSelectedIntersections((prev) => {
                    const existsIdx = prev.findIndex((i) => getIntersectionKey(i) === key);
                    let next;
                    if (multiToggle) {
                        // Ctrl/Cmd+click: toggle membership
                        next = existsIdx >= 0
                            ? prev.filter((_, idx) => idx !== existsIdx)
                            : [...prev, bestInter];
                    } else if (prev.length > 0) {
                        // Panel already open: keep adding joints with plain clicks
                        if (existsIdx >= 0) {
                            // Re-clicking a selected joint only refocuses it. Substituting the
                            // freshly derived `bestInter` here would throw away unsaved edits
                            // such as a flipped wall order.
                            next = [
                                ...prev.filter((_, idx) => idx !== existsIdx),
                                prev[existsIdx],
                            ];
                        } else {
                            next = [...prev, bestInter];
                        }
                    } else {
                        next = [bestInter];
                    }
                    setSelectedIntersection(next.length > 0 ? next[next.length - 1] : null);
                    if (next.length === 0) {
                        setHighlightWalls([]);
                        setSelectedJointPair(null);
                    }
                    return next;
                });
                return;
            }
        }
    
        // === Add-Wall Mode ===
        if (currentMode === 'add-wall') {
            // Helper to round coordinates
            const roundPoint = (pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) });
            if (isDrawing) {
                setIsDrawing(false);
                if (tempWall) {
                    // Check if start point snapped (before any angle snapping)
                    // Use original click position if stored, otherwise use current tempWall position
                    const originalStartPoint = tempWall.originalStart_x !== undefined 
                        ? { x: tempWall.originalStart_x, y: tempWall.originalStart_y }
                        : { x: tempWall.start_x, y: tempWall.start_y };
                    let startPoint = snapToClosestPoint(tempWall.start_x, tempWall.start_y);
                    const startPointSnapped = didPointSnap(originalStartPoint, startPoint);
                    console.log('Start point snap check:', { original: originalStartPoint, snapped: startPoint, didSnap: startPointSnapped });
                    
                    // Check if end point snapped (before any angle snapping)
                    const originalEndPoint = { x, y };
                    let endPoint = hoveredPoint || snapToClosestPoint(x, y);
                    const endPointSnapped = hoveredPoint
                        ? true
                        : (didPointSnap(originalEndPoint, endPoint) || isPointOnWallEndpoint(endPoint));

                    // Store original end point before angle snapping for modal
                    const endPointBeforeAngleSnap = { ...endPoint };

                    // World H/V snap, plus perpendicular-to-host when starting from a slant.
                    // Only skip ortho when locked to a wall endpoint — segment snaps still get 90°.
                    const endOnEndpoint = isPointOnWallEndpoint(endPoint) || Boolean(hoveredPoint);
                    const hostWall =
                        (tempWall.hostWallId != null && walls.find((w) => w.id === tempWall.hostWallId)) ||
                        findHostWallNearPoint(startPoint, walls, 30);
                    const wallLengthForSnap = Math.hypot(
                        endPoint.x - startPoint.x,
                        endPoint.y - startPoint.y
                    );
                    const angleThreshold = getWallAngleSnapThresholdDeg(wallLengthForSnap);
                    let angleSnap = { end: endPoint, snapType: null, direction: null };
                    if (!endOnEndpoint) {
                        angleSnap = snapWallEndToPreferredAngles(
                            startPoint,
                            endPoint,
                            hostWall,
                            angleThreshold
                        );
                        endPoint = angleSnap.end;
                    }
                    const isNearVertical = angleSnap.snapType === 'vertical';
                    const isNearHorizontal = angleSnap.snapType === 'horizontal';
                    const isNearPerpendicular = angleSnap.snapType === 'perpendicular';

                    // If the end hit geometry and we locked to world H/V, keep the snap's
                    // join coordinate (X for horizontal, Y for vertical). Ortho must not
                    // stretch past the target — that creates 1–2mm overload stubs.
                    if (endPointSnapped && isNearHorizontal) {
                        endPoint = { x: endPointBeforeAngleSnap.x, y: startPoint.y };
                    } else if (endPointSnapped && isNearVertical) {
                        endPoint = { x: startPoint.x, y: endPointBeforeAngleSnap.y };
                    }

                    // Round both points before saving
                    startPoint = roundPoint(startPoint);
                    endPoint = roundPoint(endPoint);
                    // After rounding, keep near-plumb walls on one X so T-joins don't create 1mm stubs.
                    // Skip when end is locked to an endpoint — a slight slant to a corner must stay.
                    if (!endOnEndpoint) {
                        if (isNearVertical || (Math.abs(endPoint.x - startPoint.x) <= 2 && Math.abs(endPoint.y - startPoint.y) > 2)) {
                            endPoint = { ...endPoint, x: startPoint.x };
                        } else if (isNearHorizontal || (Math.abs(endPoint.y - startPoint.y) <= 2 && Math.abs(endPoint.x - startPoint.x) > 2)) {
                            endPoint = { ...endPoint, y: startPoint.y };
                        }
                    }
                    if (endPointSnapped && isNearHorizontal) {
                        endPoint = { x: Math.round(endPointBeforeAngleSnap.x), y: startPoint.y };
                    } else if (endPointSnapped && isNearVertical) {
                        endPoint = { x: startPoint.x, y: Math.round(endPointBeforeAngleSnap.y) };
                    }

                    // Ghost areas mark taller lower-level rooms. Allow drawing on top of them
                    // (room/wall base elevation is raised when saving).
                    if (isPointInGhostedArea(startPoint) || isPointInGhostedArea(endPoint)) {
                        if (setWallSplitError) {
                            setWallSplitError('Building over a taller lower-level room — base elevation will sit on top of it.');
                            setTimeout(() => setWallSplitError(''), 4000);
                        }
                    }

                    // Check if either point didn't snap - show length input modal
                    console.log('Snap status:', { startPointSnapped, endPointSnapped, shouldShowModal: !startPointSnapped || !endPointSnapped });
                    if (!startPointSnapped || !endPointSnapped) {
                        console.log('Showing length input modal');
                        // Use points before angle snapping for direction calculation
                        const dirStartPoint = startPoint;
                        const dirEndPoint = endPointBeforeAngleSnap;
                        
                        // Prefer snapped direction (world H/V or perpendicular to slant)
                        const currentLength = Math.hypot(
                            angleSnap.end.x - startPoint.x,
                            angleSnap.end.y - startPoint.y
                        ) || Math.hypot(dirEndPoint.x - dirStartPoint.x, dirEndPoint.y - dirStartPoint.y);
                        const direction = angleSnap.direction || (currentLength > 0 ? {
                            x: (angleSnap.end.x - startPoint.x) / currentLength,
                            y: (angleSnap.end.y - startPoint.y) / currentLength
                        } : { x: 1, y: 0 });

                        // Default: typed mm = exact centerline length along the wall.
                        // PDF horizontal/vertical span is opt-in in the modal (avoids 750 → 759).
                        
                        // If start didn't snap but end did, we'll use end as reference point
                        // Otherwise, use start as reference point
                        const referencePoint = (!startPointSnapped && endPointSnapped) ? endPointBeforeAngleSnap : startPoint;
                        const useEndAsReference = !startPointSnapped && endPointSnapped;
                        
                        // Store pending wall data for the modal
                        setPendingWallData({
                            referencePoint,
                            direction,
                            currentLength: currentLength || 1000, // Default to 1000mm if length is 0
                            startPointSnapped,
                            endPointSnapped,
                            useEndAsReference,
                            isNearVertical,
                            isNearHorizontal,
                            isNearPerpendicular,
                            angleSnapType: angleSnap.snapType,
                            axisSpanMode: null,
                            deductCornerThickness: Boolean(deductCornerThickness),
                            angleThreshold
                        });
                        setShowLengthInput(true);
                        setTempWall(null);
                        return;
                    }

                    // Normalize wall coordinates to ensure proper direction
                    const normalizedCoords = normalizeWallCoordinates(startPoint, endPoint);
                    startPoint = normalizedCoords.startPoint;
                    endPoint = normalizedCoords.endPoint;

                    // Use modular handler for wall splitting/adding
                    const wallProperties = {
                        height: wallHeight,
                        thickness: wallThickness,
                        application_type: onWallTypeSelect,
                        inner_face_material: innerFaceMaterial,
                        inner_face_thickness: innerFaceThickness,
                        outer_face_material: outerFaceMaterial,
                        outer_face_thickness: outerFaceThickness,
                        deduct_corner_thickness: Boolean(deductCornerThickness),
                        auto_split: autoSplitOnIntersect !== false,
                    };
                    try {
                        if (typeof onNewWall !== 'function') {
                            // no handler
                        } else if (onNewWall.length === 3) {
                            // Handler expects (startPoint, endPoint, wallProps) e.g. handleAddWallWithSplitting
                            await onNewWall(startPoint, endPoint, wallProperties);
                        } else {
                            // Handler expects single wall object
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
                // Store original click position (before snapping) for accurate snap detection
                const originalClickPoint = { x, y };
                let snappedStart = hoveredPoint || snapToClosestPoint(x, y);
                // Round the start point before showing temp wall
                snappedStart = roundPoint(snappedStart);
                const hostWall = findHostWallNearPoint(snappedStart, walls, 30);
                setIsDrawing(true);
                setTempWall({
                    start_x: snappedStart.x,
                    start_y: snappedStart.y,
                    end_x: snappedStart.x,
                    end_y: snappedStart.y,
                    originalStart_x: originalClickPoint.x, // Store original for snap detection
                    originalStart_y: originalClickPoint.y,
                    hostWallId: hostWall?.id ?? null,
                    thickness: wallThickness, // So preview line width matches selected thickness
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
            
            if (isMultiWallEditMode) {
                // Multi-selection mode: toggle wall in selection
                if (selectedId !== null) {
                    const currentSelection = [...selectedWallsForEdit];
                    const index = currentSelection.findIndex(id => id === selectedId);
                    if (index >= 0) {
                        // Deselect if already selected
                        currentSelection.splice(index, 1);
                    } else {
                        // Add to selection
                        currentSelection.push(selectedId);
                    }
                    onWallsForEditSelect(currentSelection);
                    // Update highlight to show all selected walls
                    setHighlightWalls(currentSelection.map(id => ({ id, color: getPlanWallHighlightColor('selection') })));
                }
            } else {
                // Single selection mode: select one wall and open editor
                setSelectedWall(selectedId);
                onWallSelect(selectedId);
                setHighlightWalls(selectedId ? [{ id: selectedId, color: getPlanWallHighlightColor('selection') }] : []);
            }
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
                  updatedSelection.push(clickedWall.id);
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
                setHighlightWalls([{ id: wall.id, color: getPlanWallHighlightColor('edit') }]);
                setWallSplitError('');
                setIsDetailsPanelOpen(true);
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
            const clickPoint = { x, y };
            // Allow doors over ghost zones (taller rooms below); user may be detailing the upper room.
            if (isPointInGhostedArea(clickPoint)) {
                if (setWallSplitError) {
                    setWallSplitError('This area sits over a taller lower-level room.');
                    setTimeout(() => setWallSplitError(''), 3000);
                }
            }
            
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
            // 2. Snap to room corners (partition butt-ins extended like normal walls)
            const snapped = snapToClosestPointWithIntersections(
                x,
                y,
                intersections,
                walls,
                scaleFactor.current,
                roomSelectionSnapPoints
            );
            
            // Ghost = taller room below. Still allow defining a room on top of it.
            if (isPointInGhostedArea(snapped) && setWallSplitError) {
                setWallSplitError('Over a taller lower-level room — new room base will sit on top of it.');
                setTimeout(() => setWallSplitError(''), 4000);
            }
            
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

        if (!isEditingMode && !commentWallSelectMode && !planAnnotateMode) {
            return;
        }

        const { x, y } = getMousePos(event);

        if (commentWallSelectMode) {
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
            return;
        }

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
                    setHighlightWalls([{ id: closest.wall.id, color: getPlanWallHighlightColor('edit') }]);
                } else {
                    setSplitPreviewPoint(null);
                    setSplitHoverDistance(null);
                    setHighlightWalls([]);
                }
            }
            return;
        }

        if (currentMode === 'define-room' || currentMode === 'storey-area') {
            // Preview the same extended host-junction snap used on click — never
            // the shortened butt-in tip (those are suppressed from roomSelectionSnapPoints).
            const snapped = snapToClosestPointWithIntersections(
                x,
                y,
                intersections,
                walls,
                scaleFactor.current,
                roomSelectionSnapPoints
            );
            const moved = Math.hypot(snapped.x - x, snapped.y - y) > 0.001;
            setHoveredPoint(moved ? snapped : null);
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
            const startPt = { x: tempWall.start_x, y: tempWall.start_y };
            const onEndpoint = isPointOnWallEndpoint(snapped);
            let angleSnapType = null;
            // Endpoint snap wins over ortho; free drag / segment snaps still get 90°.
            if (!onEndpoint) {
                const hostWall =
                    (tempWall.hostWallId != null && walls.find((w) => w.id === tempWall.hostWallId)) ||
                    findHostWallNearPoint(startPt, walls, 30);
                const wallLength = Math.hypot(snapped.x - startPt.x, snapped.y - startPt.y);
                const angleSnap = snapWallEndToPreferredAngles(
                    startPt,
                    snapped,
                    hostWall,
                    getWallAngleSnapThresholdDeg(wallLength)
                );
                snapped = angleSnap.end;
                angleSnapType = angleSnap.snapType;
            }
            setTempWall({
                ...tempWall,
                end_x: snapped.x,
                end_y: snapped.y,
                thickness: tempWall.thickness ?? wallThickness,
                angleSnapType, // 'vertical' | 'horizontal' | 'perpendicular' | null
            });
        }
    };

    useEffect(() => {
        if (currentMode !== 'split-wall') {
            resetSplitState();
        } else {
            setWallSplitError('');
            setIsDetailsPanelOpen(true);
        }
    }, [currentMode, resetSplitState, setWallSplitError]);

    useEffect(() => {
        if (splitTargetWallId && !walls.some(w => w.id === splitTargetWallId)) {
            resetSplitState();
        }
    }, [splitTargetWallId, walls, resetSplitState]);

    useEffect(() => {
        if (wallSplitSuccess) {
            resetSplitState(true);
        }
    }, [wallSplitSuccess, resetSplitState]);

    // Add adjustWallForJointType and dependencies from old code
    const originalWallEndpoints = new Map();

    /** Move stem (wall_1) tip back from host centerline by host thickness. */
    const resolveButtInStemTip = (stem, host, deduct) => {
        const centerHit = calculateLineIntersection(
            { x: stem.start_x, y: stem.start_y },
            { x: stem.end_x, y: stem.end_y },
            { x: host.start_x, y: host.start_y },
            { x: host.end_x, y: host.end_y },
            { extendFirst: true, extendSecond: true }
        );
        if (!centerHit) return null;

        const dStart = Math.hypot(centerHit.x - stem.start_x, centerHit.y - stem.start_y);
        const dEnd = Math.hypot(centerHit.x - stem.end_x, centerHit.y - stem.end_y);
        const atStart = dStart <= dEnd;
        const freePt = atStart
            ? { x: stem.end_x, y: stem.end_y }
            : { x: stem.start_x, y: stem.start_y };

        if (!deduct) {
            return { atStart, point: centerHit };
        }

        const towardFreeX = freePt.x - centerHit.x;
        const towardFreeY = freePt.y - centerHit.y;
        const towardLen = Math.hypot(towardFreeX, towardFreeY);
        if (towardLen < 0.001) {
            return { atStart, point: centerHit };
        }
        const thick = Number(host.thickness) || 0;
        if (thick <= 0) {
            return { atStart, point: centerHit };
        }
        const ux = towardFreeX / towardLen;
        const uy = towardFreeY / towardLen;
        // Full joining-wall thickness, matching partition butt-in inset.
        return {
            atStart,
            point: {
                x: centerHit.x + ux * thick,
                y: centerHit.y + uy * thick,
            },
        };
    };

    const adjustWallForJointType = async (joint, walls, setWalls, projectId, intersection) => {
        const wall1 = walls.find(w => w.id === joint.wall_1);
        const wall2 = walls.find(w => w.id === joint.wall_2);
        if (!wall1 || !wall2) return;
    
        const updatedWall = { ...wall1 };
    
        try {
            // Handle "none" - no wall adjustment needed
            if (joint.joining_method === 'none') {
                return; // Do not adjust walls when joint type is "none"
            }

            if (joint.joining_method === 'butt_in') {
                const deduct = Boolean(joint.deduct_joining_thickness);
                if (!deduct) {
                    return;
                }
                const tip = resolveButtInStemTip(wall1, wall2, true);
                if (tip?.point && Number.isFinite(tip.point.x) && Number.isFinite(tip.point.y)) {
                    const current = tip.atStart
                        ? { x: wall1.start_x, y: wall1.start_y }
                        : { x: wall1.end_x, y: wall1.end_y };
                    const alreadyNear = Math.hypot(
                        tip.point.x - current.x,
                        tip.point.y - current.y
                    ) <= 0.75;
                    if (alreadyNear) {
                        return;
                    }
                    if (!originalWallEndpoints.has(wall1.id)) {
                        originalWallEndpoints.set(wall1.id, {
                            start_x: wall1.start_x,
                            start_y: wall1.start_y,
                            end_x: wall1.end_x,
                            end_y: wall1.end_y,
                        });
                    }
                    if (tip.atStart) {
                        updatedWall.start_x = tip.point.x;
                        updatedWall.start_y = tip.point.y;
                    } else {
                        updatedWall.end_x = tip.point.x;
                        updatedWall.end_y = tip.point.y;
                    }
                } else {
                    return;
                }
            } else if (joint.joining_method === '45_cut') {
                if (originalWallEndpoints.has(wall1.id)) {
                    const original = originalWallEndpoints.get(wall1.id);
                    updatedWall.start_x = original.start_x;
                    updatedWall.start_y = original.start_y;
                    updatedWall.end_x = original.end_x;
                    updatedWall.end_y = original.end_y;
                    originalWallEndpoints.delete(wall1.id);
                } else {
                    return;
                }
            } else {
                return;
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
    
    // Sync joints prop to local intersections state (skip when geometry + joints unchanged)
    useEffect(() => {
        const geometryKey = (walls || [])
            .map((w) => `${w.id}:${w.start_x},${w.start_y},${w.end_x},${w.end_y},${w.thickness ?? ''}`)
            .join('|');
        const jointsKey = (joints || [])
            .map((j) => `${j.wall_1}-${j.wall_2}:${j.joining_method || 'none'}:d${j.deduct_joining_thickness ? 1 : 0}`)
            .join('|');
        const fingerprint = `${geometryKey}::${jointsKey}`;
        if (fingerprint === intersectionFingerprintRef.current) {
            return;
        }
        intersectionFingerprintRef.current = fingerprint;

        console.log('Canvas2D: Recalculating intersections. Wall count:', walls.length);
        const allIntersections = findIntersectionPointsBetweenWalls(walls);
        const mergedIntersections = allIntersections.map(inter => ({
            ...inter,
            pairs: inter.pairs.map(pair => {
                const w1 = pair.wall1.id;
                const w2 = pair.wall2.id;
                const joint = joints.find(j =>
                    (String(j.wall_1) === String(w1) && String(j.wall_2) === String(w2)) ||
                    (String(j.wall_1) === String(w2) && String(j.wall_2) === String(w1))
                );
                return {
                    ...pair,
                    wall1: joint ? { id: joint.wall_1 } : pair.wall1,
                    wall2: joint ? { id: joint.wall_2 } : pair.wall2,
                    joining_method: joint?.joining_method || 'none',
                    deduct_joining_thickness: Boolean(joint?.deduct_joining_thickness),
                };
            })
        }));
        setIntersections(mergedIntersections);
    }, [walls, joints]);

    // Keep multi-selected joints in sync when intersection pairs refresh from the server
    useEffect(() => {
        if (selectedIntersections.length === 0) return;
        const byKey = new Map(
            (intersections || []).map((inter) => [getIntersectionKey(inter), inter])
        );
        const refreshed = selectedIntersections
            .map((sel) => {
                const key = getIntersectionKey(sel);
                const live = byKey.get(key);
                if (!live) return sel;
                // Preserve in-progress joining_method edits from the panel
                const selPairs = sel.pairs || [];
                const livePairs = (live.pairs || []).map((livePair, idx) => {
                    const edited = selPairs[idx];
                    if (!edited) return livePair;
                    return {
                        ...livePair,
                        joining_method: edited.joining_method ?? livePair.joining_method,
                        deduct_joining_thickness: edited.deduct_joining_thickness,
                        wall1: edited.wall1 || livePair.wall1,
                        wall2: edited.wall2 || livePair.wall2,
                    };
                });
                return { ...live, pairs: livePairs };
            })
            .filter(Boolean);
        const changed =
            refreshed.length !== selectedIntersections.length
            || refreshed.some((r, i) => getIntersectionKey(r) !== getIntersectionKey(selectedIntersections[i]));
        if (changed) {
            setSelectedIntersections(refreshed);
            setSelectedIntersection(refreshed.length > 0 ? refreshed[refreshed.length - 1] : null);
        }
    }, [intersections]);

    // Clear stale wall selection when walls change (draw effect already depends on walls)
    useEffect(() => {
        if (selectedWall && !walls.find(w => w.id === selectedWall.id)) {
            console.log('Canvas2D: Selected wall no longer exists, clearing selection');
            setSelectedWall(null);
        }
    }, [walls, selectedWall]);

    // Update highlights for multi-wall edit mode
    useEffect(() => {
        if (currentMode === 'edit-wall' && isMultiWallEditMode) {
            setHighlightWalls(selectedWallsForEdit.map(id => ({ id, color: getPlanWallHighlightColor('selection') })));
        } else if (currentMode === 'edit-wall' && !isMultiWallEditMode && selectedWall) {
            setHighlightWalls([{ id: selectedWall, color: getPlanWallHighlightColor('selection') }]);
        } else if (currentMode !== 'edit-wall') {
            // Clear highlights when exiting edit mode, but never stomp on the joint colours
            // the Configure Joints panel is showing.
            if (
                currentMode !== 'split-wall'
                && currentMode !== 'merge-wall'
                && !commentWallSelectMode
                && selectedIntersections.length === 0
            ) {
                setHighlightWalls([]);
            }
        }
    }, [
        currentMode,
        isMultiWallEditMode,
        selectedWallsForEdit,
        selectedWall,
        commentWallSelectMode,
        selectedIntersections,
    ]);

    // Plan colours for the focused joint are derived from the selection rather than set at
    // each click site. Flipping wall order (or a re-sync from the server) rewrites
    // selectedIntersections, and the old imperative setHighlightWalls calls could not keep up
    // — the canvas kept the previous wall1/wall2 colours.
    useEffect(() => {
        if (selectedIntersections.length === 0) {
            return;
        }
        let pair = null;
        if (selectedJointPair) {
            const sep = selectedJointPair.lastIndexOf(':');
            const interKey = selectedJointPair.slice(0, sep);
            const pairIdx = Number(selectedJointPair.slice(sep + 1));
            const inter = selectedIntersections.find(
                (item) => getIntersectionKey(item) === interKey
            );
            pair = inter?.pairs?.[pairIdx] || null;
        }
        if (!pair) {
            // No pair picked yet: colour the focused joint so selecting a point on the plan
            // already shows which wall is wall1 and which is wall2.
            const focused = selectedIntersections[selectedIntersections.length - 1];
            pair = focused?.pairs?.[0] || null;
        }
        if (!pair || !pair.wall1 || !pair.wall2) {
            return;
        }
        // Joint records carry bare { id } stubs whose ids may not be the same type as
        // wall.id, and drawWalls matches highlights with ===.
        const resolveWallId = (ref) => {
            const raw = ref?.id ?? ref;
            const match = walls.find((w) => String(w.id) === String(raw));
            return match ? match.id : raw;
        };
        setHighlightWalls([
            { id: resolveWallId(pair.wall1), color: getPlanWallHighlightColor('jointWall1') },
            { id: resolveWallId(pair.wall2), color: getPlanWallHighlightColor('jointWall2') },
        ]);
    }, [selectedIntersections, selectedJointPair, walls]);

    // Close joint configure panel in modes where joints must not be selectable
    useEffect(() => {
        if (
            currentMode === 'add-door'
            || currentMode === 'edit-door'
            || currentMode === 'merge-wall'
            || currentMode === 'add-wall'
            || currentMode === 'edit-wall'
            || currentMode === 'split-wall'
            || currentMode === 'define-room'
            || currentMode === 'storey-area'
        ) {
            setSelectedIntersection(null);
            setSelectedIntersections([]);
        }
    }, [currentMode]);

    // Prefer the map from the latest panel calculation (shared leftovers + SP swaps).
    // Fall back to rebuilding from saved optimized order / wall list.
    const wallPanelsMap = React.useMemo(() => {
        const panelWalls = allWalls || walls;
        const fingerprint = getWallCalculationFingerprint(panelWalls, intersections);
        if (
            calculatedWallPanelsMap &&
            calculatedWallPanelsFingerprint === fingerprint
        ) {
            return calculatedWallPanelsMap;
        }
        return buildProjectWallPanelsMap(panelWalls, intersections, project?.panel_optimization);
    }, [
        walls,
        allWalls,
        intersections,
        project?.panel_optimization,
        calculatedWallPanelsMap,
        calculatedWallPanelsFingerprint,
    ]);

    const handleWallPanelsMapCalculated = useCallback((map, fingerprint) => {
        setCalculatedWallPanelsMap(map || null);
        setCalculatedWallPanelsFingerprint(fingerprint || null);
    }, []);

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
    
    // Track available drawing space for responsive canvas sizing (matching CeilingCanvas)
    // When tab is switched back, container may be measured before visible (width 0) - avoid applying that so layout stays correct
    useEffect(() => {
        const container = canvasContainerRef.current;
        if (!container) return;

        const updateCanvasSize = () => {
            // Do not require MIN_CANVAS_WIDTH here — on phones the content area is often
            // < 320px after padding, which previously left the canvas stuck at 1000px wide.
            const measured = measurePlanCanvasBox(container, { minWidth: 1, minHeight: 1 });
            if (!measured) {
                return;
            }
            const { width, height } = measured;

            setCanvasSize((prev) => {
                if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
                    return prev;
                }
                // Large size jumps (rotate / first real measure): re-fit so the plan isn't clipped
                if (Math.abs(prev.width - width) > 48 || Math.abs(prev.height - height) > 48) {
                    isZoomed.current = false;
                }
                return { width, height };
            });
        };

        const measureAfterPaint = () => {
            requestAnimationFrame(() => {
                if (container.isConnected && container.clientWidth >= 40 && container.clientHeight >= 40) {
                    updateCanvasSize();
                }
            });
        };

        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.target === container) {
                        const entryWidth = entry.contentRect?.width ?? container.clientWidth;
                        const entryHeight = entry.contentRect?.height ?? container.clientHeight;
                        if (entryWidth >= 40 && entryHeight >= 40) {
                            updateCanvasSize();
                        } else {
                            measureAfterPaint();
                        }
                    }
                });
            });

            observer.observe(container);
        }

        if (container.clientWidth >= 40 && container.clientHeight >= 40) {
            updateCanvasSize();
        } else {
            measureAfterPaint();
        }

        const handleWindowResize = () => updateCanvasSize();
        window.addEventListener('resize', handleWindowResize);

        return () => {
            if (observer) {
                observer.disconnect();
            }
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        
        // Handle high DPI displays to prevent blurriness
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = canvasSize.width;
        const displayHeight = canvasSize.height;
        
        // Set the internal size to the display size * device pixel ratio
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        
        // Scale the context to match device pixel ratio
        context.scale(dpr, dpr);
        
        // Keep CSS size at 100% of the viewport so a default 1000px buffer cannot
        // expand the layout and get clipped by overflow-x: hidden on phones.
        canvas.style.setProperty('width', '100%', 'important');
        canvas.style.setProperty('height', '100%', 'important');
        canvas.style.setProperty('max-width', '100%', 'important');

        // === Restore original scale/offset calculation ===
        // Find bounding box of all wall endpoints
        const minX = Math.min(...walls.map((wall) => Math.min(wall.start_x, wall.end_x)), 0);
        const maxX = Math.max(...walls.map((wall) => Math.max(wall.start_x, wall.end_x)), 0);
        const minY = Math.min(...walls.map((wall) => Math.min(wall.start_y, wall.end_y)), 0);
        const maxY = Math.max(...walls.map((wall) => Math.max(wall.start_y, wall.end_y)), 0);

        const wallWidth = maxX - minX || 1;
        const wallHeight = maxY - minY || 1;

        const padding = 50;
        // Use display dimensions (already declared above) for calculations
        // Leave a comfortable margin and clamp the initial zoom to avoid
        // over‑zooming very small projects.
        const availableWidth = Math.max(displayWidth - 2 * padding, 1);
        const availableHeight = Math.max(displayHeight - 2 * padding, 1);
        const fitScale = Math.min(availableWidth / wallWidth, availableHeight / wallHeight);
        const sf = Math.min(2.0, fitScale * 0.9); // 90% of fit, max 2x

        // Only set the scale if user hasn't manually zoomed
        if (!isZoomed.current) {
            scaleFactor.current = sf;
        }
        initialScale.current = sf; // Always store the initial scale
        setCurrentScaleFactor(scaleFactor.current);

        // Only reset offset if user hasn't manually dragged the canvas or zoomed
        if (!isDraggingCanvas.current && !isZoomed.current) {
            offsetX.current = (displayWidth - wallWidth * sf) / 2 - minX * sf;
            offsetY.current = (displayHeight - wallHeight * sf) / 2 - minY * sf;

            // Ensure the overlay labels pick up the updated ref offsets.
            // This prevents a mismatch where canvas redraw shifts but HTML overlay stays.
            if (
                lastOffsetRecalcSizeRef.current.width !== canvasSize.width ||
                lastOffsetRecalcSizeRef.current.height !== canvasSize.height
            ) {
                lastOffsetRecalcSizeRef.current = { width: canvasSize.width, height: canvasSize.height };
                setForceRefresh((prev) => prev + 1);
            }
        }
        // === End scale/offset calculation ===

        // Clear and fill using display dimensions (context is already scaled)
        context.clearRect(0, 0, displayWidth, displayHeight);
        context.fillStyle = getPlanCanvasBackground();
        context.fillRect(0, 0, displayWidth, displayHeight);
        // Draw grid using display dimensions
        drawGrid(context, displayWidth, displayHeight, gridSize, isDrawing);
        
        // Initialize label tracking arrays for collision detection
        const placedLabels = [];
        const allLabels = [];
        // Global value-level dedup: each dimension value (mm) appears at most once (match floor/ceiling)
        const dimensionValuesSeen = new Set();
        if (walls.length > 0 && dimensionVisibility.project) {
            const actualDimensions = calculateActualProjectDimensions(walls);
            const wKey = planCeilingValueDedupKey(actualDimensions.width, true);
            const hKey = planCeilingValueDedupKey(actualDimensions.length, false);
            if (wKey) dimensionValuesSeen.add(wKey);
            if (hKey) dimensionValuesSeen.add(hKey);
        }

        const commentHighlights = [
            ...(commentHighlightWallIds || []).map((id) => ({ id, color: getPlanWallHighlightColor('edit') })),
            ...(commentWallSelectMode ? (selectedWallsForComment || []).map((id) => ({ id, color: '#34D399' })) : []),
        ];
        const effectiveHighlightWalls = [...commentHighlights, ...highlightWalls];

        // Draw walls first (and wall/panel dimensions); then project dimensions so they place outermost
        const wallDrawResult = drawWalls({
            context,
            walls,
            highlightWalls: effectiveHighlightWalls,
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
            dimensionVisibility,
            showPanelLines, // Panel lines visibility toggle
            initialScale: initialScale.current,
            dimensionValuesSeen,
            rooms,
            doors,
            polygonSelectMode: currentMode === 'define-room' || currentMode === 'storey-area',
            selectedIntersectionKeys: new Set(selectedIntersections.map(getIntersectionKey)),
        });
        const colorMap = wallDrawResult?.thicknessColorMap ?? wallDrawResult;
        const dimensionEdgeExtents = wallDrawResult?.dimensionEdgeExtents ?? null;
        // Update legend only when entries change (avoids extra paint after theme redraw)
        if (colorMap instanceof Map) {
            const prev = thicknessColorMapRef.current;
            let changed = prev.size !== colorMap.size;
            if (!changed) {
                for (const [key, colors] of colorMap) {
                    const prevColors = prev.get(key);
                    if (!prevColors || prevColors.wall !== colors.wall || prevColors.partition !== colors.partition) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) {
                thicknessColorMapRef.current = colorMap;
                setThicknessColorMap(colorMap);
            }
        }

        // Draw overall project dimensions last so they appear outermost (outside all wall dimensions)
        if (walls.length > 0 && dimensionVisibility.project) {
            drawOverallProjectDimensions(
                context,
                walls,
                scaleFactor.current,
                offsetX.current,
                offsetY.current,
                placedLabels,
                allLabels,
                initialScale.current,
                null,
                dimensionEdgeExtents
            );
        }
        
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
                const topLabel = Number.isFinite(Number(ghostArea.room_top_mm))
                    ? ` · top ${Math.round(Number(ghostArea.room_top_mm))}mm`
                    : '';
                const label = `${areaName}${originLabel}${topLabel}`;
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
                context.lineWidth = Math.max(1, (ghostWall.thickness || 50) * scaleFactor.current * 0.5);
                context.setLineDash([12, 6]);
                context.beginPath();
                context.moveTo(startX, startY);
                context.lineTo(endX, endY);
                context.stroke();
                context.restore();
            });
        }

        // Store transform values on canvas element for capture function
        if (canvasRef.current) {
            canvasRef.current.setAttribute('data-scale-factor', scaleFactor.current.toString());
            canvasRef.current.setAttribute('data-offset-x', offsetX.current.toString());
            canvasRef.current.setAttribute('data-offset-y', offsetY.current.toString());
        }
        
        // Draw doors
        drawDoors(context, doors, walls, scaleFactor.current, offsetX.current, offsetY.current, hoveredDoorId);
        drawPlanAnnotationArrows(
            context,
            planAnnotations,
            scaleFactor.current,
            offsetX.current,
            offsetY.current
        );
        // Draw rooms
        // Draw room preview
        drawRoomPreview(context, selectedRoomPoints, scaleFactor.current, offsetX.current, offsetY.current);

        // Define-room only: show extended partition corners as extra snap targets
        // (edit mode keeps geometric butt-in oranges so joints stay distinct).
        if (
            (currentMode === 'define-room' || currentMode === 'storey-area')
            && Array.isArray(roomSelectionSnapPoints)
        ) {
            roomSelectionSnapPoints.forEach((pt) => {
                drawEndpoints(
                    context,
                    pt.x,
                    pt.y,
                    scaleFactor.current,
                    offsetX.current,
                    offsetY.current,
                    hoveredPoint,
                    '#FF9800',
                    2.25,
                    initialScale.current
                );
            });
        }
        
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
                        `${Math.round(splitHoverDistance)}`,
                        markerX + 10,
                        markerY - 8
                    );
                }
            }

            context.restore();
        }

    // Canvas draw helpers are recreated each render; listed deps drive redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        canvasSize.width,
        canvasSize.height,
        walls, rooms, selectedWall, tempWall, doors,
        selectedWallsForRoom, joints, isEditingMode,
        hoveredWall, hoveredDoorId, highlightWalls,
        selectedRoomPoints, project, hoveredPoint,
        wallPanelsMap,
        filteredDimensions,
        forceRefresh,
        dimensionVisibility,
        showPanelLines,
        currentMode,
        roomSelectionSnapPoints,
        selectedIntersections,
        splitPreviewPoint,
        splitTargetWallId,
        ghostWalls,
        ghostAreas,
        commentWallSelectMode,
        selectedWallsForComment,
        commentHighlightWallIds,
        planAnnotations,
        resolvedTheme,
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
    }, [rooms, walls, currentScaleFactor, forceRefresh, calculateRoomArea]);

    // Handle wall length input confirmation
    const handleLengthConfirm = async () => {
        if (!pendingWallData) return;
        
        const lengthInput = document.getElementById('wallLengthInput');
        const desiredLength = parseFloat(lengthInput?.value);
        
        if (!desiredLength || desiredLength <= 0) {
            if (setWallSplitError) {
                setWallSplitError('Please enter a valid wall length greater than 0.');
                setTimeout(() => setWallSplitError(''), 3000);
            }
            return;
        }

        // Use integer length (mm) so "5000" gives exactly 5000mm with no decimal drift
        const lengthMm = Math.round(desiredLength);
        const roundToInt = (v) => Math.round(v);
        const intPoint = (pt) => ({ x: roundToInt(pt.x), y: roundToInt(pt.y) });

        const {
            referencePoint,
            direction,
            useEndAsReference,
            isNearVertical,
            isNearHorizontal,
            axisSpanMode,
        } = pendingWallData;

        let roundedStartPoint, roundedEndPoint;

        const applyLengthFromStart = (origin, lengthMm) => {
            if (isNearVertical) {
                const sign = direction.y >= 0 ? 1 : -1;
                return { x: origin.x, y: origin.y + sign * lengthMm };
            }
            if (isNearHorizontal) {
                const sign = direction.x >= 0 ? 1 : -1;
                return { x: origin.x + sign * lengthMm, y: origin.y };
            }
            // Optional PDF-style axis span (checkbox): typed value is ΔX or ΔY
            if (axisSpanMode === 'horizontal' && Math.abs(direction.x) > 1e-6) {
                const scale = lengthMm / Math.abs(direction.x);
                return {
                    x: origin.x + direction.x * scale,
                    y: origin.y + direction.y * scale,
                };
            }
            if (axisSpanMode === 'vertical' && Math.abs(direction.y) > 1e-6) {
                const scale = lengthMm / Math.abs(direction.y);
                return {
                    x: origin.x + direction.x * scale,
                    y: origin.y + direction.y * scale,
                };
            }
            // Default: exact centerline length along the wall direction
            return {
                x: origin.x + direction.x * lengthMm,
                y: origin.y + direction.y * lengthMm,
            };
        };

        if (useEndAsReference) {
            // End snapped: keep end exactly, calculate start from length (opposite direction)
            roundedEndPoint = intPoint(referencePoint);
            const forward = applyLengthFromStart(referencePoint, lengthMm);
            const calculatedStart = {
                x: referencePoint.x - (forward.x - referencePoint.x),
                y: referencePoint.y - (forward.y - referencePoint.y),
            };
            roundedStartPoint = intPoint(calculatedStart);
        } else {
            // Start snapped: keep start exactly, calculate end from length
            roundedStartPoint = intPoint(referencePoint);
            roundedEndPoint = intPoint(applyLengthFromStart(referencePoint, lengthMm));
        }

        // After integer rounding, re-fit exact typed length along the segment (slant walls)
        if (!isNearVertical && !isNearHorizontal && !axisSpanMode) {
            const fixExactLength = (fixed, other, towardOther) => {
                const dx = other.x - fixed.x;
                const dy = other.y - fixed.y;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) return other;
                const ux = dx / len;
                const uy = dy / len;
                const target = {
                    x: fixed.x + ux * lengthMm * towardOther,
                    y: fixed.y + uy * lengthMm * towardOther,
                };
                return intPoint(target);
            };
            if (useEndAsReference) {
                roundedStartPoint = fixExactLength(roundedEndPoint, roundedStartPoint, 1);
            } else {
                roundedEndPoint = fixExactLength(roundedStartPoint, roundedEndPoint, 1);
            }
        }

        // Ghost areas are taller rooms below — allow walls; base elev is raised on save.
        if (
            (isPointInGhostedArea(roundedStartPoint) || isPointInGhostedArea(roundedEndPoint))
            && setWallSplitError
        ) {
            setWallSplitError('Building over a taller lower-level room — base elevation will sit on top of it.');
            setTimeout(() => setWallSplitError(''), 4000);
        }

        // Normalize wall coordinates to ensure proper direction
        const normalizedCoords = normalizeWallCoordinates(roundedStartPoint, roundedEndPoint);
        const finalStartPoint = normalizedCoords.startPoint;
        const finalEndPoint = normalizedCoords.endPoint;

        // Use modular handler for wall splitting/adding
        const wallProperties = {
            height: wallHeight,
            thickness: wallThickness,
            application_type: onWallTypeSelect,
            inner_face_material: innerFaceMaterial,
            inner_face_thickness: innerFaceThickness,
            outer_face_material: outerFaceMaterial,
            outer_face_thickness: outerFaceThickness,
            deduct_corner_thickness: Boolean(
                pendingWallData?.deductCornerThickness ?? deductCornerThickness
            ),
            auto_split: autoSplitOnIntersect !== false,
        };

        try {
            if (typeof onNewWall !== 'function') {
                // no handler
            } else if (onNewWall.length === 3) {
                await onNewWall(finalStartPoint, finalEndPoint, wallProperties);
            } else {
                await onNewWall({
                    start_x: finalStartPoint.x,
                    start_y: finalStartPoint.y,
                    end_x: finalEndPoint.x,
                    end_y: finalEndPoint.y,
                    ...wallProperties
                });
            }
        } catch (error) {
            console.error('Error managing walls:', error);
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
        }

        // Close modal and reset state
        setShowLengthInput(false);
        setPendingWallData(null);
    };

    // Handle wall length input cancellation
    const handleLengthCancel = () => {
        setShowLengthInput(false);
        setPendingWallData(null);
    };
    
    return (
        <>
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

            {/* Main Content - Matching Ceiling Plan Structure */}
            <div className="plan-canvas wall-canvas-container bg-white dark:bg-gray-900 rounded-xl shadow-lg p-4">
                {/* Header */}
                <div className="wall-canvas-header mb-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="shrink-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                                Wall Plan
                            </h3>
                            <p className="text-xs text-gray-600 dark:text-gray-400 leading-tight">
                                Professional Layout
                            </p>
                        </div>

                        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0 text-xs text-gray-700 dark:text-gray-300">
                            <span className="font-semibold text-gray-900 dark:text-gray-100 shrink-0 inline-flex items-center">
                                <svg className="w-3.5 h-3.5 mr-1 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M5 12h16M8 18h13" />
                                </svg>
                                Dimension Labels
                            </span>
                            <label className="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.project}
                                    onChange={() => handleDimensionVisibilityChange('project')}
                                />
                                <span>Overall project dimensions</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.wall}
                                    onChange={() => handleDimensionVisibilityChange('wall')}
                                />
                                <span>Wall dimensions</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.panel}
                                    onChange={() => handleDimensionVisibilityChange('panel')}
                                />
                                <span>Side Panel dimensions</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={showPanelLines}
                                    onChange={onTogglePanelLines}
                                />
                                <span>Panel division lines</span>
                            </label>
                        </div>

                        {!isDetailsPanelOpen && (
                            <button
                                onClick={() => setIsDetailsPanelOpen(true)}
                                className="px-2 py-1 text-xs rounded-md border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors font-medium shrink-0 ml-auto"
                            >
                                Show Plan Details
                            </button>
                        )}
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="space-y-4">
                        {/* Canvas */}
                        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 min-w-0 w-full max-w-full">
                            {/* Canvas Container */}
                            <div className="wall-canvas-wrapper flex-1 min-w-0 w-full max-w-full">
                                <div className="plan-canvas-zoom-stack">
                                <div
                                    ref={canvasContainerRef}
                                    className="plan-canvas-viewport border-2 border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden shadow-lg relative w-full max-w-full"
                                    style={{
                                        height: `${CANVAS_HEIGHT}px`,
                                        minHeight: `${MIN_CANVAS_HEIGHT}px`
                                    }}
                                >
                                    <canvas
                                        ref={canvasRef}
                                        data-plan-type="wall"
                                        onClick={handleCanvasClick}
                                        onMouseMove={handleMouseMove}
                                        onMouseDown={handleCanvasMouseDown}
                                        onContextMenu={handleCanvasContextMenu}
                                        onTouchStart={handleTouchStart}
                                        onTouchMove={handleTouchMove}
                                        onTouchEnd={handleTouchEnd}
                                        tabIndex={0}
                                        className={`wall-canvas block w-full h-full max-w-full ${
                                            planAnnotateMode && planNoteAddMode && canAnnotate
                                                ? 'cursor-crosshair'
                                                : 'cursor-grab active:cursor-grabbing'
                                        }`}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            maxWidth: '100%',
                                            touchAction: 'none',
                                        }}
                                    />

                                    {planNotePlacementRef.current && (() => {
                                        void placementPreviewTick;
                                        const previewRect = getPlanNotePlacementRect(
                                            planNotePlacementRef.current,
                                            currentScaleFactor,
                                            offsetX.current,
                                            offsetY.current,
                                        );
                                        if (!previewRect) {
                                            return null;
                                        }
                                        return (
                                            <div
                                                className="absolute pointer-events-none z-[40] rounded-lg border-2 border-dashed border-blue-500 bg-blue-500/10"
                                                style={{
                                                    left: `${previewRect.left}px`,
                                                    top: `${previewRect.top}px`,
                                                    width: `${previewRect.width}px`,
                                                    height: `${previewRect.height}px`,
                                                }}
                                            />
                                        );
                                    })()}
                                    
                                    {/* Interactive Room Labels */}
                                    {roomLabelPositions.map((labelData) => (
                                        <InteractiveRoomLabel
                                            key={labelData.roomId}
                                            room={labelData.room}
                                            position={labelData.position}
                                            scaleFactor={currentScaleFactor}
                                            initialScale={initialScale.current}
                                            offsetX={offsetX.current}
                                            offsetY={offsetY.current}
                                            onUpdateRoom={handleRoomUpdateOptimized}
                                            onPositionChange={handleRoomLabelPositionChange}
                                            isSelected={selectedRoomId === labelData.roomId}
                                            onSelect={handleRoomSelect}
                                            currentMode={currentMode}
                                            selectedRoomPoints={selectedRoomPoints}
                                            canvasWidth={canvasSize.width}
                                            canvasHeight={canvasSize.height}
                                        />
                                    ))}

                                    {planAnnotations.map((annotation) => (
                                        <InteractivePlanAnnotation
                                            key={annotation.clientKey || annotation.id}
                                            annotation={annotation}
                                            scaleFactor={currentScaleFactor}
                                            offsetX={offsetX.current}
                                            offsetY={offsetY.current}
                                            isSelected={selectedPlanAnnotationId === annotation.id}
                                            onSelect={onSelectPlanAnnotation}
                                            onUpdate={onUpdatePlanAnnotation}
                                            onDelete={onDeletePlanAnnotation}
                                            onStartArrowPlacement={onPlanAnnotationArrowPlacementId}
                                            isPlacingArrow={planAnnotationArrowPlacementId === annotation.id}
                                            canEdit={canAnnotate && planAnnotateMode}
                                            canDirectEdit={canAnnotate}
                                            canDrag={canAnnotate}
                                            autoEdit={autoEditPlanAnnotationId === annotation.id}
                                            onAutoEditConsumed={() => setAutoEditPlanAnnotationId(null)}
                                            onInteractionStart={cancelPlanNotePlacement}
                                        />
                                    ))}
                                </div>
                                <PlanCanvasZoomControls
                                    onZoomIn={handleZoomIn}
                                    onZoomOut={handleZoomOut}
                                    onReset={handleResetZoom}
                                />
                                </div>
                                
                                {/* Canvas Controls */}
                                <div className="plan-canvas-meta dark:text-gray-400">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">Scale:</span>
                                        <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-[10px]">
                                            {currentScaleFactor.toFixed(2)}x
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                        {isCoarsePointerDevice()
                                            ? 'Swipe sideways to pan · Up/down to scroll · Two fingers to pan · Zoom buttons to zoom'
                                            : 'Click and drag to navigate · Use zoom buttons'}
                                    </span>
                                </div>
                            </div>

                            {/* Plan Details Sidebar - Matching Ceiling Plan Structure */}
                            {isDetailsPanelOpen && (
                                <div className="wall-summary-sidebar flex-shrink-0 min-w-0 w-full lg:w-auto lg:max-w-64">
                                    <div className="plan-details-panel bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl p-6 w-full max-w-64 shadow-lg">
                                        <h4 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
                                            <svg className="w-6 h-6 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                            </svg>
                                            Plan Details
                                        </h4>
                                        
                                        <div className="space-y-6">
                                            {/* Collapse Button */}
                                            <div className="flex justify-end">
                                                <button
                                                    onClick={() => setIsDetailsPanelOpen(false)}
                                                    className="plan-details-btn px-3 py-1 text-xs sm:text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                >
                                                    Collapse
                                                </button>
                                            </div>

                                                            {/* Manual Wall Split Section */}
                                            {currentMode === 'split-wall' && (
                                                <div className="plan-details-card bg-white border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 shadow-sm">
                                                    <h5 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Manual Wall Split</h5>
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
                                                                    <span>{Math.round(splitTargetWallLength || 0)}</span>
                                                                </div>
                                                                {splitHoverDistance !== null && (
                                                                    <div className="flex justify-between text-emerald-700">
                                                                        <span className="font-medium">Preview distance:</span>
                                                                        <span>{Math.round(splitHoverDistance)}</span>
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

                                            {/* Wall Finish Legend */}
                                            {thicknessColorMap && thicknessColorMap.size > 0 && (
                                                <div className="plan-details-card bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                                                    <h5 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                                                        <svg className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                                                                                backgroundColor: adjustPlanStrokeColor(colors.wall)
                                                                                            }}
                                                                                            title="Outer face"
                                                                                        ></div>
                                                                                        {/* Inner face (bottom line) */}
                                                                                        <div
                                                                                            className="absolute left-0 right-0"
                                                                                            style={{
                                                                                                top: `${bottomY}px`,
                                                                                                height: `${lineHeight}px`,
                                                                                                backgroundColor: adjustPlanStrokeColor(colors.innerWall)
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
                                                                                                backgroundColor: adjustPlanStrokeColor(colors.innerWall)
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
                                                                                                backgroundColor: adjustPlanStrokeColor(colors.innerWall)
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
                                                                                            backgroundColor: adjustPlanStrokeColor(colors.wall)
                                                                                        }}
                                                                                    ></div>
                                                                                    <div
                                                                                        className="absolute left-0 right-0"
                                                                                        style={{
                                                                                            top: `${bottomY}px`,
                                                                                            height: `${lineHeight}px`,
                                                                                            backgroundColor: adjustPlanStrokeColor(colors.partition || colors.wall)
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
                                                                                            backgroundColor: adjustPlanStrokeColor(colors.wall)
                                                                                        }}
                                                                                    ></div>
                                                                                    <div
                                                                                        className="absolute"
                                                                                        style={{
                                                                                            left: capRight,
                                                                                            top: `${topY}px`,
                                                                                            width: `${capWidth}px`,
                                                                                            height: `${(bottomY + lineHeight) - topY}px`,
                                                                                            backgroundColor: adjustPlanStrokeColor(colors.wall)
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

                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* View Material Needed Section — hidden for view-only share links */}
                    {!isViewOnlyShare && (
                    <div className="plan-material-card dark:bg-gray-800 dark:border-gray-600">
                        <div className="plan-material-card-header">
                            <h3 className="plan-material-card-title dark:text-gray-100">View Material Needed</h3>
                            <button
                                onClick={() => setShowMaterialNeeded(!showMaterialNeeded)}
                                className="plan-panel-btn-primary"
                            >
                                {showMaterialNeeded ? 'Hide Material' : 'Show Material'}
                            </button>
                        </div>

                        {showMaterialNeeded && (
                            <div className="space-y-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <PanelCalculationControls 
                                    walls={allWalls || walls} 
                                    intersections={intersections}
                                    doors={doors}
                                    project={project}
                                    updateSharedPanelData={updateSharedPanelData}
                                    onRefreshWalls={onRefreshWalls}
                                    onWallPanelsMapCalculated={handleWallPanelsMapCalculated}
                                />
                                
                                {/* Door Table */}
                                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md p-3 shadow-sm">
                                    <DoorTable doors={doors} />
                                </div>
                            </div>
                        )}
                    </div>
                    )}

                    {/* Front View & Side View elevations */}
                    <div className="plan-material-card dark:bg-gray-800 dark:border-gray-600">
                        <div className="plan-material-card-header">
                            <h3 className="plan-material-card-title dark:text-gray-100">Wall Elevations</h3>
                            <button
                                type="button"
                                onClick={handleGenerateElevations}
                                disabled={isGeneratingElevations || !walls?.length}
                                className="plan-panel-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isGeneratingElevations
                                    ? 'Generating…'
                                    : showElevations
                                        ? 'Hide Elevations'
                                        : 'Generate Elevations'}
                            </button>
                        </div>
                        {showElevations && (
                            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <WallElevationViews elevations={wallElevations} />
                            </div>
                        )}
                        {!showElevations && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                Click Generate to build Front View and Side View of the whole building model (all walls, heights, and openings).
                            </p>
                        )}
                    </div>
                </div>
            </div>
            
            {selectedIntersections.length > 0 && (
            <div className="fixed inset-0 bg-transparent pointer-events-none flex justify-end items-start z-50">
                <div className="configure-joints-panel pointer-events-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4 rounded-lg shadow-lg m-4 max-w-md w-full max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-3">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Configure Joints</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {selectedIntersections.length} joint{selectedIntersections.length === 1 ? '' : 's'} selected
                            {' · '}click more on plan to add · Ctrl+click to remove
                        </p>
                    </div>
                    <button 
                    onClick={clearJointSelection}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                    ×
                    </button>
                </div>

                {selectedIntersections.length > 1 && (
                <div className="mb-4 p-3 rounded-lg border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 space-y-2">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        Apply to all selected joints
                    </div>
                    <select
                        value={bulkJointMethod}
                        onChange={(e) => {
                            const method = e.target.value;
                            setBulkJointMethod(method);
                            if (method !== 'butt_in') setBulkDeductThickness(false);
                        }}
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                        <option value="none">None</option>
                        <option value="butt_in">Butt-in</option>
                        <option value="45_cut">45° Cut</option>
                    </select>
                    {bulkJointMethod === 'butt_in' && (
                    <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                        <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={bulkDeductThickness}
                            onChange={(e) => setBulkDeductThickness(e.target.checked)}
                        />
                        <span>Deduct joining wall thickness</span>
                    </label>
                    )}
                    <button
                        type="button"
                        className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        onClick={() => {
                            const method = bulkJointMethod;
                            const deduct = method === 'butt_in' ? bulkDeductThickness : false;
                            const next = selectedIntersections.map((inter) => ({
                                ...inter,
                                pairs: (inter.pairs || []).map((pair) => ({
                                    ...pair,
                                    joining_method: method,
                                    deduct_joining_thickness: deduct,
                                })),
                            }));
                            syncFocusedIntersection(next);
                        }}
                    >
                        Apply type to all {selectedIntersections.length} joints
                    </button>
                </div>
                )}

                <div className="overflow-y-auto max-h-[70vh] min-h-0 flex-1 space-y-4 scroll-contain-panel">
                    {selectedIntersections.map((inter, interIdx) => (
                    <div
                        key={getIntersectionKey(inter) || interIdx}
                        className={`rounded-lg border p-2 ${
                            selectedIntersection && getIntersectionKey(selectedIntersection) === getIntersectionKey(inter)
                                ? 'border-blue-300 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/20'
                                : 'border-gray-200 dark:border-gray-700'
                        }`}
                    >
                    <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                            Joint {interIdx + 1}
                            {Number.isFinite(inter.x) && Number.isFinite(inter.y)
                                ? ` · (${Math.round(inter.x)}, ${Math.round(inter.y)})`
                                : ''}
                        </span>
                        {selectedIntersections.length > 1 && (
                            <button
                                type="button"
                                className="text-xs text-red-600 hover:underline dark:text-red-400"
                                onClick={() => {
                                    const key = getIntersectionKey(inter);
                                    syncFocusedIntersection(
                                        selectedIntersections.filter((i) => getIntersectionKey(i) !== key)
                                    );
                                }}
                            >
                                Remove
                            </button>
                        )}
                    </div>
                    {(inter.pairs || []).map((pair, index) => (
                    <div
                        key={`${getIntersectionKey(inter)}-${index}`}
                        onClick={() => {
                        setSelectedIntersection(inter);
                        setSelectedJointPair(`${getIntersectionKey(inter)}:${index}`);
                        }}
                        className={`mb-2 p-2 rounded cursor-pointer transition-colors border ${
                        selectedJointPair === `${getIntersectionKey(inter)}:${index}`
                            ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/50 dark:border-blue-600' 
                            : 'border-transparent hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                    >
                    <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                    <div className="w-3 h-3 rounded-full bg-blue-500 dark:bg-cyan-400 shrink-0" />
                    <span className="font-medium">Wall {pair.wall1.id}</span>
                    <div className="mx-2 text-gray-500 dark:text-gray-400">↔</div>
                    <div className="w-3 h-3 rounded-full bg-purple-500 dark:bg-fuchsia-400 shrink-0" />
                    <span className="font-medium">Wall {pair.wall2.id}</span>
                    </div>
                    <select
                    value={pair.joining_method || 'none'}
                    onChange={(e) => {
                        const method = e.target.value;
                        const next = selectedIntersections.map((item, i) => {
                            if (i !== interIdx) return item;
                            const pairs = [...(item.pairs || [])];
                            pairs[index] = {
                                ...pairs[index],
                                joining_method: method,
                                deduct_joining_thickness: method === 'butt_in'
                                    ? Boolean(pairs[index].deduct_joining_thickness)
                                    : false,
                            };
                            return { ...item, pairs };
                        });
                        syncFocusedIntersection(next);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full mt-2 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                    <option value="none">None</option>
                    <option value="butt_in">Butt-in</option>
                    <option value="45_cut">45° Cut</option>
                    </select>

                    {(pair.joining_method || 'none') === 'butt_in' && (
                    <label className="mt-2 flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
                        <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={Boolean(pair.deduct_joining_thickness)}
                            onChange={(e) => {
                                const next = selectedIntersections.map((item, i) => {
                                    if (i !== interIdx) return item;
                                    const pairs = [...(item.pairs || [])];
                                    pairs[index] = {
                                        ...pairs[index],
                                        deduct_joining_thickness: e.target.checked,
                                    };
                                    return { ...item, pairs };
                                });
                                syncFocusedIntersection(next);
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                        <span>
                            Deduct joining wall thickness
                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                                Shortens Wall {pair.wall1.id} by Wall {pair.wall2.id}&apos;s thickness
                            </span>
                        </span>
                    </label>
                    )}

                    <div className="flex justify-end">
                    <button
                        onClick={(e) => {
                        e.stopPropagation();
                        const next = selectedIntersections.map((item, i) => {
                            if (i !== interIdx) return item;
                            const pairs = [...(item.pairs || [])];
                            const temp = pairs[index].wall1;
                            pairs[index] = {
                                ...pairs[index],
                                wall1: pairs[index].wall2,
                                wall2: temp,
                            };
                            return { ...item, pairs };
                        });
                        syncFocusedIntersection(next);
                        // Keep focus on the joint that was flipped; the plan colours follow
                        // selectedIntersections on their own.
                        setSelectedIntersection(next[interIdx]);
                        setSelectedJointPair(`${getIntersectionKey(inter)}:${index}`);
                        }}
                        className="text-sm text-blue-500 hover:underline mt-1 dark:text-blue-400"
                    >
                        Flip Wall Order
                    </button>
                    </div>

                </div>
                ))}
                    </div>
                    ))}
                <div className="flex justify-end gap-2 mt-4">
                <button
                    className="px-4 py-2 bg-gray-300 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
                    onClick={clearJointSelection}
                    >
                    Cancel
                    </button>
                    <button
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    onClick={async () => {
                        try {
                            for (const inter of selectedIntersections) {
                                for (const pair of (inter.pairs || [])) {
                                    await api.post('/intersections/set_joint/', {
                                        project: projectId,
                                        wall_1: pair.wall1.id,
                                        wall_2: pair.wall2.id,
                                        joining_method: pair.joining_method,
                                        deduct_joining_thickness: pair.joining_method === 'butt_in'
                                            ? Boolean(pair.deduct_joining_thickness)
                                            : false,
                                    });
                            
                                    await adjustWallForJointType(
                                        {
                                            wall_1: pair.wall1.id,
                                            wall_2: pair.wall2.id,
                                            joining_method: pair.joining_method,
                                            deduct_joining_thickness: pair.joining_method === 'butt_in'
                                                ? Boolean(pair.deduct_joining_thickness)
                                                : false,
                                        },
                                        walls,
                                        setWalls,
                                        projectId,
                                        inter
                                    );
                                }
                            }
                          // Refresh joints
                          const response = await api.get(`/intersections/?project=${projectId}`);
                          onJointsUpdate(response.data);
                          alert(
                            selectedIntersections.length > 1
                                ? `Updated ${selectedIntersections.length} joints.`
                                : 'Joint types updated!'
                          );
                          
                          clearJointSelection();
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

            {/* Wall Length Input Modal */}
            {showLengthInput && pendingWallData && (
                <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Enter Wall Length</h3>
                        {(() => {
                            const snapType = pendingWallData.angleSnapType;
                            const snapLabel =
                                snapType === 'horizontal' ? 'World horizontal (90°)' :
                                snapType === 'vertical' ? 'World vertical (90°)' :
                                snapType === 'perpendicular' ? 'Perpendicular to slant (⊥)' :
                                snapType === 'parallel' ? 'Along slant (∥)' :
                                'Free angle';
                            const snapColor =
                                snapType === 'horizontal' || snapType === 'vertical' ? '#2196F3' :
                                snapType === 'perpendicular' ? '#FF9800' :
                                snapType === 'parallel' ? '#9C27B0' :
                                '#4CAF50';
                            return (
                                <div
                                    className="mb-3 px-3 py-2 rounded-md text-sm flex items-start gap-2"
                                    style={{ backgroundColor: `${snapColor}22`, border: `1px solid ${snapColor}` }}
                                >
                                    <span
                                        className="inline-block w-3 h-3 rounded-full flex-shrink-0 mt-1"
                                        style={{ backgroundColor: snapColor }}
                                    />
                                    <span className="text-gray-800">
                                        <strong>Snap:</strong> {snapLabel}
                                        <span className="block text-xs text-gray-600 mt-0.5">
                                            Typed value = wall centerline length (exact), unless you enable PDF span below.
                                        </span>
                                    </span>
                                </div>
                            );
                        })()}
                        <p className="text-sm text-gray-600 mb-4">
                            {pendingWallData.startPointSnapped && !pendingWallData.endPointSnapped && 
                                "The end point didn't snap to any existing walls or points. Please specify the desired wall length."}
                            {!pendingWallData.startPointSnapped && pendingWallData.endPointSnapped && 
                                "The start point didn't snap to any existing walls or points. Please specify the desired wall length."}
                            {!pendingWallData.startPointSnapped && !pendingWallData.endPointSnapped && 
                                "Neither point snapped to existing walls or points. Please specify the desired wall length."}
                        </p>
                        {pendingWallData.useEndAsReference && (
                            <p className="text-xs text-blue-600 mb-2 italic">
                                Note: The end point snapped, so the wall will be positioned from the end point backwards.
                            </p>
                        )}
                        {!pendingWallData.isNearVertical && !pendingWallData.isNearHorizontal && (
                            <label className="flex items-start gap-2 mb-3 text-sm text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={Boolean(pendingWallData.axisSpanMode)}
                                    onChange={(e) => {
                                        if (!e.target.checked) {
                                            setPendingWallData({ ...pendingWallData, axisSpanMode: null });
                                            return;
                                        }
                                        const ux = Math.abs(pendingWallData.direction?.x || 0);
                                        const uy = Math.abs(pendingWallData.direction?.y || 0);
                                        setPendingWallData({
                                            ...pendingWallData,
                                            axisSpanMode: ux >= uy ? 'horizontal' : 'vertical',
                                        });
                                    }}
                                />
                                <span>
                                    Typed value is PDF <strong>horizontal/vertical span</strong> (not wall length).
                                    <span className="block text-xs text-gray-500">
                                        Use for dims like the niche “750” on a slight slant — wall length may then show ~759.
                                    </span>
                                </span>
                            </label>
                        )}
                        <label className="flex items-start gap-2 mb-3 text-sm text-gray-700 cursor-pointer">
                            <input
                                type="checkbox"
                                className="mt-1"
                                checked={Boolean(pendingWallData.deductCornerThickness)}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setPendingWallData({
                                        ...pendingWallData,
                                        deductCornerThickness: checked,
                                    });
                                    if (typeof onDeductCornerThicknessChange === 'function') {
                                        onDeductCornerThicknessChange(checked);
                                    }
                                }}
                            />
                            <span>
                                Deduct new wall thickness from host at free corners
                                <span className="block text-xs text-gray-500">
                                    On when the PDF overall already includes this wall’s thickness. Leave off if the PDF excludes thickness.
                                </span>
                            </span>
                        </label>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                {pendingWallData.axisSpanMode === 'horizontal'
                                    ? 'Horizontal span (mm) — as on PDF:'
                                    : pendingWallData.axisSpanMode === 'vertical'
                                        ? 'Vertical span (mm) — as on PDF:'
                                        : 'Wall Length (mm):'}
                            </label>
                            <input
                                type="number"
                                id="wallLengthInput"
                                min="1"
                                step="1"
                                defaultValue={Math.round(pendingWallData.currentLength)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleLengthConfirm();
                                    } else if (e.key === 'Escape') {
                                        handleLengthCancel();
                                    }
                                }}
                            />
                        </div>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={handleLengthCancel}
                                className="px-4 py-2 bg-gray-300 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleLengthConfirm}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </>
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