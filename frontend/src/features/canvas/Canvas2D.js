import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
    translateJoinedWallKeepingLength,
    getWallAngleSnapThresholdDeg,
  snapWallEndToPreferredAngles,
  clearDimensionPlacementMemory,
  nearestPointOnWallFace,
  pointAlongDirection,
  snapToEitherFaceLine,
  bothLineSnapMarks,
  snapMagnetPoint,
  drawnWallFromLine,
  sideOfReferenceLine,
  centerlineForSide,
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
import { collectWallFaceLegend } from './wallPlanColors';
import { side1Normal } from './wallFaceSides';
import { useTheme } from '../theme/ThemeContext';
import { useShare } from '../share/ShareContext';
import { drawDoors } from './utils';
import { detectClickedDoor, detectHoveredDoor, detectDoorTag } from './utils';
import { resolveDoorPlacement, worldToDoorLocal, getDoorTagModelPoint } from './doorPlacement';
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
    onDoorLabelOffset = () => {},
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
    onToggleEditMode = null,
    isPlanFullscreen = false,
    onTogglePlanFullscreen = null,
}) => {

    const canvasRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const { isViewOnlyShare } = useShare();
    const [selectedWall, setSelectedWall] = useState(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tempWall, setTempWall] = useState(null);
    const [hoveredWall, setHoveredWall] = useState(null);
    const [hoveredPoint, setHoveredPoint] = useState(null);
    const [lineSnapMarks, setLineSnapMarks] = useState(null);
    const [showLengthInput, setShowLengthInput] = useState(false);
    const [pendingWallData, setPendingWallData] = useState(null);
    const [typedWallLength, setTypedWallLength] = useState('');
    const typedLengthRef = useRef('');
    const tempWallRef = useRef(null);
    const isDrawingRef = useRef(false);
    const commitTypedWallRef = useRef(async () => {});
    tempWallRef.current = tempWall;
    isDrawingRef.current = isDrawing;
    typedLengthRef.current = typedWallLength;
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
    const [highlightWalls, setHighlightWalls] = useState([]);
    const [selectedJointPair, setSelectedJointPair] = useState(null);
    const [hoveredDoorId, setHoveredDoorId] = useState(null);
    const [hoveredTagId, setHoveredTagId] = useState(null);
    const [tagDragPreview, setTagDragPreview] = useState(null);
    const tagDragRef = useRef(null);
    const suppressTagClickRef = useRef(false);
    const doorsRef = useRef(doors);
    const wallsRef = useRef(walls);
    doorsRef.current = doors;
    wallsRef.current = walls;
    const onDoorLabelOffsetRef = useRef(onDoorLabelOffset);
    onDoorLabelOffsetRef.current = onDoorLabelOffset;
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
    const [showDoorList, setShowDoorList] = useState(false);
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
    // Draw walls, doors, and rooms first. Dimension placement walks every wall
    // against every other label, so it waits one frame after the plan appears.
    const [planDetailsReady, setPlanDetailsReady] = useState(false);
    useEffect(() => {
        if (!walls?.length) return undefined;
        const frame = requestAnimationFrame(() => setPlanDetailsReady(true));
        return () => cancelAnimationFrame(frame);
    }, [walls]);
    const [splitTargetWallId, setSplitTargetWallId] = useState(null);
    const splitDistanceInputRef = useRef(null);
    const [splitPreviewPoint, setSplitPreviewPoint] = useState(null);
    const [splitPreviewFace, setSplitPreviewFace] = useState(null);
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
    // Mirrors the applied canvasSize so the resize observer can compare without stale state
    const appliedCanvasSize = useRef({
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    });
    
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

    const togglePlanFullscreen = () => {
        onTogglePlanFullscreen?.();
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
        // Re-fit changes the pixel layout; drop locked sides so collision runs against the new fit.
        clearDimensionPlacementMemory();
        // Trigger a re-render to recalculate scale
        setForceRefresh(prev => prev + 1);
    };

    // Fresh project / import must not inherit placement sides from the previous plan.
    useEffect(() => {
        clearDimensionPlacementMemory();
    }, [projectId]);

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

    const tagDragListenersRef = useRef(null);
    useEffect(() => () => tagDragListenersRef.current?.(), []);

    const handleCanvasMouseDown = (e) => {
        if (e.button === 0 && !isViewOnlyShare && currentMode !== 'define-room' && currentMode !== 'add-wall' && currentMode !== 'storey-area' && !(planAnnotateMode && planNoteAddMode)) {
            const { x, y } = getPointerModelPosRef.current(e.clientX, e.clientY);
            const tagDoor = detectDoorTag(x, y, doors, walls);
            const wall = tagDoor
                ? walls.find((item) => item.id === tagDoor.linked_wall || item.id === tagDoor.wall_id)
                : null;
            if (tagDoor && wall) {
                const placement = resolveDoorPlacement(wall, tagDoor);
                const center = getDoorTagModelPoint(tagDoor, wall, placement);
                const centerLocal = worldToDoorLocal(center.x, center.y, placement);
                const grab = worldToDoorLocal(x, y, placement);
                tagDragRef.current = {
                    doorId: tagDoor.id,
                    moved: false,
                    grabDx: grab.x - centerLocal.x,
                    grabDy: grab.y - centerLocal.y,
                    offset: centerLocal,
                };
                const onMove = (event) => {
                    const drag = tagDragRef.current;
                    if (!drag) return;
                    const point = getPointerModelPosRef.current(event.clientX, event.clientY);
                    const door = (doorsRef.current || []).find((item) => item.id === drag.doorId);
                    const host = (wallsRef.current || []).find(
                        (item) => item.id === door?.linked_wall || item.id === door?.wall_id
                    );
                    if (!door || !host) return;
                    const local = worldToDoorLocal(point.x, point.y, resolveDoorPlacement(host, door));
                    const next = { x: local.x - drag.grabDx, y: local.y - drag.grabDy };
                    if (!drag.moved && Math.hypot(next.x - drag.offset.x, next.y - drag.offset.y) < 6) {
                        return;
                    }
                    drag.moved = true;
                    drag.offset = next;
                    setTagDragPreview({ doorId: drag.doorId, offset: next });
                };
                const finish = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', finish);
                    tagDragListenersRef.current = null;
                    const drag = tagDragRef.current;
                    tagDragRef.current = null;
                    setTagDragPreview(null);
                    if (drag?.moved) {
                        suppressTagClickRef.current = true;
                        onDoorLabelOffsetRef.current(drag.doorId, {
                            x: Math.round(drag.offset.x),
                            y: Math.round(drag.offset.y),
                        });
                    }
                };
                tagDragListenersRef.current = finish;
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', finish);
                setTagDragPreview({ doorId: tagDoor.id, offset: centerLocal });
                e.preventDefault();
                return;
            }
        }

        if (planAnnotateMode && planNoteAddMode && canAnnotate && !planAnnotationArrowPlacementId && e.button === 0) {
            const { x, y } = getPointerModelPosRef.current(e.clientX, e.clientY);
            startPlanNotePlacement(x, y);
            e.preventDefault();
            return;
        }

        // Right button pans. In fullscreen the middle button pans too, like AutoCAD.
        if (e.button !== 2 && !(isPlanFullscreen && e.button === 1)) {
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

    // Fullscreen: scroll zooms toward the cursor, the way AutoCAD does.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !isPlanFullscreen) return undefined;
        const onWheel = (event) => {
            event.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
            const oldScale = scaleFactor.current;
            if (!(oldScale > 0)) return;
            const zoomIn = event.deltaY < 0;
            const factor = zoomIn ? 1.12 : 1 / 1.12;
            const newScale = Math.min(8, Math.max(0.002, oldScale * factor));
            const modelX = (screenX - offsetX.current) / oldScale;
            const modelY = (screenY - offsetY.current) / oldScale;
            scaleFactor.current = newScale;
            offsetX.current = screenX - modelX * newScale;
            offsetY.current = screenY - modelY * newScale;
            isZoomed.current = true;
            setCurrentScaleFactor(newScale);
            setForceRefresh((tick) => tick + 1);
        };
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', onWheel);
    }, [isPlanFullscreen]);

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
            typedLengthRef.current = '';
            setTypedWallLength('');
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

    function applyTypedLengthToPreview(raw) {
        const tw = tempWallRef.current;
        if (!tw) return;
        const len = parseInt(raw, 10);
        if (!len || len <= 0) {
            setTempWall({ ...tw, typedLength: raw || '' });
            return;
        }
        const end = pointAlongDirection(
            { x: tw.start_x, y: tw.start_y },
            { x: tw.end_x, y: tw.end_y },
            len
        );
        if (!end) return;
        setTempWall({
            ...tw,
            end_x: end.x,
            end_y: end.y,
            typedLength: raw,
        });
    }

    // While a wall is following the cursor: type the sheet length, Enter places it.
    // Escape clears a half-typed number first, then leaves add-wall.
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (currentMode !== 'add-wall') return;
            const tag = event.target && event.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                if (typedLengthRef.current) {
                    typedLengthRef.current = '';
                    setTypedWallLength('');
                    return;
                }
                setTempWall(null);
                setIsDrawing(false);
                setCurrentMode(null);
                return;
            }

            if (!isDrawingRef.current) return;

            if (event.key === 'Enter') {
                event.preventDefault();
                const len = parseInt(typedLengthRef.current, 10);
                const tw = tempWallRef.current;
                if (!tw || !len || len <= 0) return;
                commitTypedWallRef.current(tw, len);
                return;
            }

            if (event.key === 'Backspace') {
                event.preventDefault();
                typedLengthRef.current = typedLengthRef.current.slice(0, -1);
                setTypedWallLength(typedLengthRef.current);
                applyTypedLengthToPreview(typedLengthRef.current);
                return;
            }

            if (/^[0-9]$/.test(event.key)) {
                event.preventDefault();
                if (typedLengthRef.current.length >= 7) return;
                typedLengthRef.current += event.key;
                setTypedWallLength(typedLengthRef.current);
                applyTypedLengthToPreview(typedLengthRef.current);
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
            if (typedLengthRef.current) {
                typedLengthRef.current = '';
                setTypedWallLength('');
            }
            setLineSnapMarks(null);
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
    const MAGNET_PX = 28;
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

        // Check snapping to wall segments (the middle line)
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

        // Faces sit half the thickness off the middle. A room width on the
        // sheet is measured from a face, so the snap has to land there.
        // A face at a corner is half a thickness past the corner. The corner
        // itself wins, or the wall runs 50mm long on a 100mm wall.
        let snappedToFace = false;
        walls.forEach((wall) => {
            const facePoint = nearestPointOnWallFace(x, y, wall);
            if (facePoint && facePoint.dist < minDistance) {
                closestPoint = { x: facePoint.x, y: facePoint.y };
                minDistance = facePoint.dist;
                snappedToFace = true;
            }
        });

        if (snappedToFace) {
            let cornerReach = 1;
            walls.forEach((wall) => {
                const half = (Number(wall.thickness) || 0) / 2;
                if (half + 1 > cornerReach) cornerReach = half + 1;
            });
            let corner = null;
            let cornerDist = cornerReach;
            walls.forEach((wall) => {
                ['start', 'end'].forEach((point) => {
                    const px = wall[`${point}_x`];
                    const py = wall[`${point}_y`];
                    const distance = Math.hypot(px - closestPoint.x, py - closestPoint.y);
                    if (distance <= cornerDist) {
                        corner = { x: px, y: py };
                        cornerDist = distance;
                    }
                });
            });
            if (corner) return corner;
        }

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

    const isNearWallEnd = (wall, point, tolerance = SPLIT_ENDPOINT_TOLERANCE) => {
        if (!point) return false;
        const distStart = Math.hypot(point.x - wall.start_x, point.y - wall.start_y);
        const distEnd = Math.hypot(point.x - wall.end_x, point.y - wall.end_y);
        return distStart < tolerance || distEnd < tolerance;
    };

    const pointAlongWall = (wall, distanceFromStart) => {
        const wallLength = getWallLength(wall);
        if (wallLength <= 0) return null;
        const ratio = distanceFromStart / wallLength;
        return {
            x: wall.start_x + (wall.end_x - wall.start_x) * ratio,
            y: wall.start_y + (wall.end_y - wall.start_y) * ratio
        };
    };

    const splitFaceLines = (wall) => {
        if (!wall) return [];
        const stored = [
            { x: Number(wall.start_x), y: Number(wall.start_y) },
            { x: Number(wall.end_x), y: Number(wall.end_y) },
        ];
        const lines = [stored];
        const thick = Number(wall.thickness) || 0;
        const code = Number(wall.tip_length);
        if (wall.tip_to_tip !== true && (code === -1 || code === -2) && thick > 0) {
            const n = side1Normal(stored[0].x, stored[0].y, stored[1].x, stored[1].y);
            const sign = code === -1 ? 1 : -1;
            lines.push([
                { x: stored[0].x + n.x * thick * sign, y: stored[0].y + n.y * thick * sign },
                { x: stored[1].x + n.x * thick * sign, y: stored[1].y + n.y * thick * sign },
            ]);
            return lines;
        }
        const drawn = [wall._line1, wall._line2].filter((line) => line?.[0] && line?.[1]);
        if (drawn.length === 2) {
            const mid = {
                x: (stored[0].x + stored[1].x) / 2,
                y: (stored[0].y + stored[1].y) / 2,
            };
            let far = null;
            let farDist = 1;
            drawn.forEach((line) => {
                const mx = (Number(line[0].x) + Number(line[1].x)) / 2;
                const my = (Number(line[0].y) + Number(line[1].y)) / 2;
                const dist = Math.hypot(mx - mid.x, my - mid.y);
                if (dist > farDist) {
                    farDist = dist;
                    far = { x: mx - mid.x, y: my - mid.y };
                }
            });
            if (far) {
                lines.push([
                    { x: stored[0].x + far.x, y: stored[0].y + far.y },
                    { x: stored[1].x + far.x, y: stored[1].y + far.y },
                ]);
            }
        }
        return lines;
    };

    const segmentCrossing = (a, b, c, d) => {
        const rx = b.x - a.x;
        const ry = b.y - a.y;
        const sx = d.x - c.x;
        const sy = d.y - c.y;
        const denom = rx * sy - ry * sx;
        if (Math.abs(denom) < 1e-6) return null;
        const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
        const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
        if (t < -0.002 || t > 1.002 || u < -0.002 || u > 1.002) return null;
        const tt = Math.max(0, Math.min(1, t));
        return { x: a.x + tt * rx, y: a.y + tt * ry };
    };

    const snapSplitPoint = (wall, x, y) => {
        const wallLength = getWallLength(wall);
        const scale = Math.max(scaleFactor.current, 1e-6);
        const wallThick = Number(wall.thickness) || 0;
        // Snap is a fixed pixel radius. On a large plan the fit zoom is ~0.006,
        // so 20px is about 3.5m — longer than a 1500mm wall. Both corners then
        // win every click and the split is rejected as "too close to the ends".
        // Cap along-wall magnetism so the middle of a short wall stays reachable.
        const alongCap = Math.max(wallLength * 0.22, SPLIT_ENDPOINT_TOLERANCE + 1);
        const intersectionReach = Math.min((SNAP_THRESHOLD * 2) / scale + wallThick, alongCap);
        const segmentThreshold = (SNAP_THRESHOLD * 1.5) / scale;
        const dx = wall.end_x - wall.start_x;
        const dy = wall.end_y - wall.start_y;
        const lenSq = dx * dx + dy * dy || 1;
        const station = (px, py) => Math.max(0, Math.min(1, ((px - wall.start_x) * dx + (py - wall.start_y) * dy) / lenSq));
        const storedAt = (t) => ({
            x: wall.start_x + dx * t,
            y: wall.start_y + dy * t,
        });
        const lines = splitFaceLines(wall);

        let best = null;
        const consider = (display, maxDistance) => {
            if (!display) return;
            const distance = Math.hypot(display.x - x, display.y - y);
            if (distance > maxDistance) return;
            const stored = storedAt(station(display.x, display.y));
            if (isNearWallEnd(wall, stored)) return;
            if (!best || distance < best.dist) {
                best = {
                    x: stored.x,
                    y: stored.y,
                    faceX: display.x,
                    faceY: display.y,
                    dist: distance,
                };
            }
        };

        // A crossing on either line of this wall, against either line of the other wall.
        walls.forEach((other) => {
            if (!other || other.id === wall.id) return;
            const otherLines = splitFaceLines(other);
            lines.forEach((line) => {
                otherLines.forEach((otherLine) => {
                    consider(
                        segmentCrossing(line[0], line[1], otherLine[0], otherLine[1]),
                        intersectionReach
                    );
                });
            });
        });

        getIntersectionsForWall(wall.id).forEach((pt) => {
            const t = station(pt.x, pt.y);
            lines.forEach((line) => {
                consider({
                    x: line[0].x + (line[1].x - line[0].x) * t,
                    y: line[0].y + (line[1].y - line[0].y) * t,
                }, intersectionReach);
            });
        });

        if (best) return best;

        lines.forEach((line) => {
            const hit = snapToWallSegment(x, y, {
                start_x: line[0].x,
                start_y: line[0].y,
                end_x: line[1].x,
                end_y: line[1].y,
            });
            if (hit) consider(hit, segmentThreshold);
        });

        return best;
    };

    const findClosestWallAtPoint = (x, y) => {
        const selectionThreshold = (SNAP_THRESHOLD * 1.5) / scaleFactor.current;

        if (splitTargetWallId) {
            const targetWall = walls.find((w) => w.id === splitTargetWallId);
            if (!targetWall) return null;

            const snapped = snapSplitPoint(targetWall, x, y);
            if (!snapped) return null;

            const faceX = snapped.faceX ?? snapped.x;
            const faceY = snapped.faceY ?? snapped.y;
            const distance = Math.hypot(faceX - x, faceY - y);
            if (distance > selectionThreshold) return null;

            return { wall: targetWall, point: snapped };
        }

        let bestResult = null;
        let bestPerp = Infinity;
        let bestDistance = Infinity;

        walls.forEach((wall) => {
            const snapped = snapSplitPoint(wall, x, y);
            if (!snapped) return;

            const faceX = snapped.faceX ?? snapped.x;
            const faceY = snapped.faceY ?? snapped.y;
            const distance = Math.hypot(faceX - x, faceY - y);
            const thick = Number(wall.thickness) || 0;
            if (distance > selectionThreshold) return;

            const isPartition = String(wall.application_type || '').toLowerCase() === 'partition';
            const scorePerp = distance + (isPartition ? thick * 0.35 : 0);

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
        setSplitPreviewFace(null);
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
            setSplitPreviewFace(null);
            setSplitHoverDistance(null);
            return;
        }

        const wallLength = getWallLength(targetWall);
        if (distance >= wallLength) {
            setSplitPreviewPoint(null);
            setSplitPreviewFace(null);
            setSplitHoverDistance(null);
            return;
        }

        const previewPoint = pointAlongWall(targetWall, distance);
        if (!previewPoint) {
            setSplitPreviewPoint(null);
            setSplitPreviewFace(null);
            setSplitHoverDistance(null);
            return;
        }

        const roundedPreview = getRoundedPoint(previewPoint);
        setSplitPreviewPoint(roundedPreview);
        setSplitPreviewFace(null);
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

        const splitPoint = pointAlongWall(targetWall, distance);
        if (!splitPoint) {
            setWallSplitError('Selected wall could not be found.');
            setTimeout(() => setWallSplitError(''), 4000);
            return;
        }

        const roundedSplitPoint = getRoundedPoint(splitPoint);

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
        // Don't handle clicks if we were dragging the canvas or a door mark
        if (isDraggingCanvas.current) {
            return;
        }
        if (suppressTagClickRef.current) {
            suppressTagClickRef.current = false;
            return;
        }
        
        const { x, y } = getMousePos(event);
        if (detectDoorTag(x, y, doors, walls)) {
            return;
        }
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
                if (tempWall?.placingSide) {
                    const refStart = { x: tempWall.anchor_x, y: tempWall.anchor_y };
                    const refEnd = { x: tempWall.ref_x, y: tempWall.ref_y };
                    const side = sideOfReferenceLine(refStart, refEnd, { x, y }, tempWall.offsetSide);
                    setIsDrawing(false);
                    const normalizedCoords = normalizeWallCoordinates(refStart, refEnd);
                    const savedStart = normalizedCoords.startPoint;
                    const savedEnd = normalizedCoords.endPoint;
                    const faceNormal = side1Normal(savedStart.x, savedStart.y, savedEnd.x, savedEnd.y);
                    const faceSide = (faceNormal.x * side.x + faceNormal.y * side.y) >= 0 ? -1 : -2;
                    if (isPointInGhostedArea(savedStart) || isPointInGhostedArea(savedEnd)) {
                        if (setWallSplitError) {
                            setWallSplitError('Building over a taller lower-level room — base elevation will sit on top of it.');
                            setTimeout(() => setWallSplitError(''), 4000);
                        }
                    }
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
                        tip_to_tip: false,
                        tip_length: faceSide,
                    };
                    try {
                        if (typeof onNewWall === 'function' && onNewWall.length === 3) {
                            await onNewWall(savedStart, savedEnd, wallProperties);
                        } else if (typeof onNewWall === 'function') {
                            await onNewWall({
                                start_x: savedStart.x,
                                start_y: savedStart.y,
                                end_x: savedEnd.x,
                                end_y: savedEnd.y,
                                ...wallProperties,
                            });
                        }
                    } catch (error) {
                        console.error('Error managing walls:', error);
                        if (isDatabaseConnectionError(error)) showDatabaseError();
                    }
                    setTempWall(null);
                    return;
                }
                if (tempWall && parseInt(typedLengthRef.current, 10) > 0) {
                    commitTypedWallRef.current(tempWall, parseInt(typedLengthRef.current, 10));
                    return;
                }
                if (tempWall) {
                    const anchorPoint = {
                        x: tempWall.anchor_x ?? tempWall.start_x,
                        y: tempWall.anchor_y ?? tempWall.start_y,
                    };
                    const magnet = snapMagnetPoint(x, y, walls, intersections, MAGNET_PX / scaleFactor.current);
                    const drawn = drawnWallFromLine(anchorPoint, { x, y }, {
                        walls,
                        maxDistMm: (SNAP_THRESHOLD * 1.8) / scaleFactor.current,
                        thickness: tempWall.thickness ?? wallThickness,
                        magnetPoint: magnet,
                    });
                    if (Math.hypot(drawn.refEnd.x - drawn.refStart.x, drawn.refEnd.y - drawn.refStart.y) < 1) {
                        return;
                    }
                    const locked = {
                        ...tempWall,
                        placingSide: true,
                        singleLine: false,
                        anchor_x: drawn.refStart.x,
                        anchor_y: drawn.refStart.y,
                        ref_x: drawn.refEnd.x,
                        ref_y: drawn.refEnd.y,
                        start_x: drawn.refStart.x,
                        start_y: drawn.refStart.y,
                        end_x: drawn.refEnd.x,
                        end_y: drawn.refEnd.y,
                        offsetSide: null,
                        thickness: tempWall.thickness ?? wallThickness,
                        typedLength: '',
                    };
                    typedLengthRef.current = '';
                    setTypedWallLength('');
                    tempWallRef.current = locked;
                    setTempWall(locked);
                    return;
                }
            } else {
                // Store original click position (before snapping) for accurate snap detection
                const originalClickPoint = { x, y };
                const magnetStart = snapMagnetPoint(x, y, walls, intersections, MAGNET_PX / scaleFactor.current);
                const faceStart = magnetStart || snapToEitherFaceLine(x, y, walls, (SNAP_THRESHOLD * 1.8) / scaleFactor.current);
                let snappedStart = roundPoint(faceStart ? { x: faceStart.x, y: faceStart.y } : { x, y });
                const hostWall = findHostWallNearPoint(snappedStart, walls, 30);
                setIsDrawing(true);
                setTempWall({
                    start_x: snappedStart.x,
                    start_y: snappedStart.y,
                    end_x: snappedStart.x,
                    end_y: snappedStart.y,
                    originalStart_x: originalClickPoint.x, // Store original for snap detection
                    originalStart_y: originalClickPoint.y,
                    anchor_x: snappedStart.x,
                    anchor_y: snappedStart.y,
                    hostWallId: hostWall?.id ?? null,
                    thickness: wallThickness,
                    singleLine: true,
                    placingSide: false,
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
            const facePoint = Number.isFinite(point.faceX)
                ? { x: Number(point.faceX.toFixed(3)), y: Number(point.faceY.toFixed(3)) }
                : null;

            if (!splitTargetWallId || wall.id !== splitTargetWallId) {
                setSplitTargetWallId(wall.id);
                setSplitPreviewPoint(roundedPoint);
                setSplitPreviewFace(facePoint);
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
        if (!isDraggingCanvas.current && !tagDragRef.current) {
            const pos = getMousePos(event);
            const tagHit = detectDoorTag(pos.x, pos.y, doors, walls);
            const nextTagId = tagHit?.id ?? null;
            setHoveredTagId((current) => (current === nextTagId ? current : nextTagId));
        }

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
                        setSplitPreviewFace(Number.isFinite(snappedPoint.faceX)
                            ? { x: Number(snappedPoint.faceX.toFixed(3)), y: Number(snappedPoint.faceY.toFixed(3)) }
                            : null);
                        setSplitHoverDistance(getDistanceFromWallStart(targetWall, rounded));
                    } else {
                        setSplitPreviewPoint(null);
                        setSplitPreviewFace(null);
                    }
                }
            } else {
                const closest = findClosestWallAtPoint(x, y);
                if (closest) {
                    const rounded = getRoundedPoint(closest.point);
                    setSplitPreviewPoint(rounded);
                    setSplitPreviewFace(Number.isFinite(closest.point.faceX)
                        ? { x: Number(closest.point.faceX.toFixed(3)), y: Number(closest.point.faceY.toFixed(3)) }
                        : null);
                    setSplitHoverDistance(getDistanceFromWallStart(closest.wall, rounded));
                    setHighlightWalls([{ id: closest.wall.id, color: getPlanWallHighlightColor('edit') }]);
                } else {
                    setSplitPreviewPoint(null);
                    setSplitPreviewFace(null);
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

        // Endpoint hover: both lines of a wall, not only the stored middle.
        let closestPoint = null;
        let minDistance = SNAP_THRESHOLD / scaleFactor.current;
        walls.forEach((wall) => {
            const points = [];
            if (wall._line1?.[0] && wall._line1?.[1]) points.push(wall._line1[0], wall._line1[1]);
            if (wall._line2?.[0] && wall._line2?.[1]) points.push(wall._line2[0], wall._line2[1]);
            if (!points.length) {
                points.push(
                    { x: wall.start_x, y: wall.start_y },
                    { x: wall.end_x, y: wall.end_y }
                );
            }
            points.forEach((point) => {
                const distance = Math.hypot(point.x - x, point.y - y);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPoint = point;
                }
            });
        });
        setHoveredPoint(closestPoint);
        let addWallMagnet = null;
        if (currentMode === 'add-wall' && !tempWall?.placingSide) {
            const magnetMm = MAGNET_PX / scaleFactor.current;
            let magnet = snapMagnetPoint(x, y, walls, intersections, magnetMm);
            if (!magnet && isDrawing && tempWall) {
                const held = snapMagnetPoint(tempWall.end_x, tempWall.end_y, walls, intersections, 1.5);
                if (held && Math.hypot(x - held.x, y - held.y) <= magnetMm * 1.45) {
                    magnet = held;
                }
            }
            addWallMagnet = magnet;
            const mark = magnet || bothLineSnapMarks(x, y, walls, (SNAP_THRESHOLD * 1.8) / scaleFactor.current);
            setLineSnapMarks(mark);
            if (mark) setHoveredPoint(mark);
        } else {
            setLineSnapMarks(null);
        }
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
            if (tempWall.placingSide) {
                const refStart = { x: tempWall.anchor_x, y: tempWall.anchor_y };
                const refEnd = { x: tempWall.ref_x, y: tempWall.ref_y };
                const side = sideOfReferenceLine(refStart, refEnd, { x, y }, tempWall.offsetSide);
                setTempWall({
                    ...tempWall,
                    offsetSide: side,
                    singleLine: false,
                });
            } else {
                const anchor = {
                    x: tempWall.anchor_x ?? tempWall.start_x,
                    y: tempWall.anchor_y ?? tempWall.start_y,
                };
                const typedLen = parseInt(typedLengthRef.current, 10);
                const drawn = drawnWallFromLine(anchor, { x, y }, {
                    walls,
                    maxDistMm: (SNAP_THRESHOLD * 1.8) / scaleFactor.current,
                    thickness: 0,
                    typedLength: typedLen > 0 ? typedLen : 0,
                    magnetPoint: addWallMagnet,
                });
                setTempWall({
                    ...tempWall,
                    anchor_x: anchor.x,
                    anchor_y: anchor.y,
                    ref_x: drawn.refEnd.x,
                    ref_y: drawn.refEnd.y,
                    start_x: drawn.refStart.x,
                    start_y: drawn.refStart.y,
                    end_x: drawn.refEnd.x,
                    end_y: drawn.refEnd.y,
                    thickness: tempWall.thickness ?? wallThickness,
                    angleSnapType: drawn.axis,
                    typedLength: typedLengthRef.current,
                    singleLine: true,
                    placingSide: false,
                });
            }
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

    useEffect(() => {
        if (currentMode !== 'split-wall' || !splitTargetWallId) return undefined;
        const input = splitDistanceInputRef.current;
        if (!input) return undefined;
        input.focus();
        input.select();
        return undefined;
    }, [currentMode, splitTargetWallId]);

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

    /**
     * Move the wall end that meets jointPoint out to the 45° long point
     * (one full wall thickness past the joint) or back onto the joint.
     * A joint in the middle of a wall is left alone.
     */
    const tipShiftForJoint = (wall, jointPoint, mode) => {
        const thickness = Number(wall.thickness) || 100;
        const start = { x: Number(wall.start_x), y: Number(wall.start_y) };
        const end = { x: Number(wall.end_x), y: Number(wall.end_y) };
        const dStart = Math.hypot(start.x - jointPoint.x, start.y - jointPoint.y);
        const dEnd = Math.hypot(end.x - jointPoint.x, end.y - jointPoint.y);
        if (Math.min(dStart, dEnd) > thickness + 1.5) return null;
        const atStart = dStart <= dEnd;
        const tip = atStart ? start : end;
        const anchor = atStart ? end : start;
        const vx = tip.x - anchor.x;
        const vy = tip.y - anchor.y;
        const len = Math.hypot(vx, vy);
        if (len < 1) return null;
        const ux = vx / len;
        const uy = vy / len;
        const past = (tip.x - jointPoint.x) * ux + (tip.y - jointPoint.y) * uy;
        if (mode === 'extend') {
            const need = thickness - past;
            if (need <= 1) return null;
            return {
                atStart,
                x: Math.round(tip.x + ux * need),
                y: Math.round(tip.y + uy * need),
            };
        }
        if (past <= 1) return null;
        return {
            atStart,
            x: Math.round(tip.x - ux * past),
            y: Math.round(tip.y - uy * past),
        };
    };

    const saveWallTip = async (wall, tip, walls) => {
        const updated = { ...wall };
        if (tip.atStart) {
            updated.start_x = tip.x;
            updated.start_y = tip.y;
        } else {
            updated.end_x = tip.x;
            updated.end_y = tip.y;
        }
        const res = await api.put(`/walls/${updated.id}/`, updated);
        const idx = walls.findIndex((w) => String(w.id) === String(updated.id));
        if (idx >= 0) walls[idx] = res.data;
        setWalls((prev) => prev.map((w) => (String(w.id) === String(updated.id) ? res.data : w)));
        return res.data;
    };

    const adjustWallForJointType = async (joint, walls, setWalls, projectId, intersection) => {
        let wall1 = walls.find(w => w.id === joint.wall_1);
        let wall2 = walls.find(w => w.id === joint.wall_2);
        if (!wall1 || !wall2) return;

        const jointPoint = intersection && Number.isFinite(Number(intersection.x)) && Number.isFinite(Number(intersection.y))
            ? { x: Number(intersection.x), y: Number(intersection.y) }
            : null;

        if (joint.joining_method === '45_cut') {
            // The saved start/end stay where the walls touch. Moving them out to the
            // 45° tip puts the point outside the drawn corner and outside the site.
            for (const wallId of [joint.wall_1, joint.wall_2]) {
                const wall = walls.find((w) => String(w.id) === String(wallId));
                if (!wall || !originalWallEndpoints.has(wall.id)) continue;
                const original = originalWallEndpoints.get(wall.id);
                originalWallEndpoints.delete(wall.id);
                const restored = {
                    ...wall,
                    start_x: original.start_x,
                    start_y: original.start_y,
                    end_x: original.end_x,
                    end_y: original.end_y,
                };
                const idx = walls.findIndex((w) => String(w.id) === String(wall.id));
                if (idx >= 0) walls[idx] = restored;
                await api.put(`/walls/${restored.id}/`, restored);
                setWalls((prev) => prev.map((w) => (String(w.id) === String(restored.id) ? restored : w)));
            }
            return;
        }

        if (jointPoint && joint.joining_method !== '45_cut') {
            for (const wallId of [joint.wall_1, joint.wall_2]) {
                const wall = walls.find((w) => String(w.id) === String(wallId));
                if (!wall) continue;
                const tip = tipShiftForJoint(wall, jointPoint, 'retract');
                if (tip) await saveWallTip(wall, tip, walls);
            }
            wall1 = walls.find(w => w.id === joint.wall_1);
            wall2 = walls.find(w => w.id === joint.wall_2);
            if (!wall1 || !wall2) return;
        }
    
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
        if (!planDetailsReady) return {};
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
        planDetailsReady,
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

            const prev = appliedCanvasSize.current;
            if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
                return;
            }
            // Only the first real measurement re-fits. Opening or closing a side
            // form used to clear the zoom flag, so the plan snapped back to fit.
            const firstRealMeasure = prev.width < 40 || prev.height < 40;
            if (firstRealMeasure) {
                isZoomed.current = false;
                clearDimensionPlacementMemory();
            } else if (!isZoomed.current && (Math.abs(prev.width - width) > 48 || Math.abs(prev.height - height) > 48)) {
                // Which side of the plan a dimension lands on is decided by pixel collision and
                // then locked for the rest of the session. A decision made against the old box —
                // most often a first paint measured before the stylesheet applied — would stay
                // wrong forever, so drop it and let the new box decide.
                clearDimensionPlacementMemory();
            }
            appliedCanvasSize.current = { width, height };
            setCanvasSize({ width, height });
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
        const paintDimensionVisibility = planDetailsReady
            ? dimensionVisibility
            : { project: false, wall: false, panel: false };
        if (walls.length > 0 && paintDimensionVisibility.project) {
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
            lineSnapMarks,
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
            dimensionVisibility: paintDimensionVisibility,
            showPanelLines: planDetailsReady && showPanelLines, // Panel lines visibility toggle
            initialScale: initialScale.current,
            dimensionValuesSeen,
            rooms,
            doors,
            polygonSelectMode: currentMode === 'define-room' || currentMode === 'storey-area',
            selectedIntersectionKeys: new Set(selectedIntersections.map(getIntersectionKey)),
            legacyWallPlan: project?.legacy_wall_plan !== false,
        });
        const colorMap = wallDrawResult?.thicknessColorMap ?? wallDrawResult;
        const dimensionEdgeExtents = wallDrawResult?.dimensionEdgeExtents ?? null;
        const wallLinesMap = wallDrawResult?.wallLinesMap ?? null;
        // Update legend only when entries change (avoids extra paint after theme redraw)
        if (colorMap instanceof Map) {
            const prev = thicknessColorMapRef.current;
            let changed = prev.size !== colorMap.size;
            if (!changed) {
                for (const [key, colors] of colorMap) {
                    const prevColors = prev.get(key);
                    if (!prevColors || prevColors.wall !== colors.wall || prevColors.partition !== colors.partition || prevColors.innerWall !== colors.innerWall || prevColors.label !== colors.label || prevColors.finishLabel !== colors.finishLabel) {
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
        if (walls.length > 0 && paintDimensionVisibility.project) {
            drawOverallProjectDimensions(
                context,
                walls,
                scaleFactor.current,
                offsetX.current,
                offsetY.current,
                placedLabels,
                allLabels,
                initialScale.current,
                wallLinesMap,
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
        
        const doorsForMarks = tagDragPreview
            ? doors.map((door) => (
                door.id === tagDragPreview.doorId
                    ? { ...door, label_offset: tagDragPreview.offset }
                    : door
            ))
            : doors;
        // Draw doors
        drawDoors(context, doorsForMarks, walls, scaleFactor.current, offsetX.current, offsetY.current, hoveredDoorId);
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
            const marker = splitPreviewFace || splitPreviewPoint;
            const markerX = marker.x * scaleFactor.current + offsetX.current;
            const markerY = marker.y * scaleFactor.current + offsetY.current;
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
                const t = ((splitPreviewPoint.x - previewWall.start_x) * dirX
                    + (splitPreviewPoint.y - previewWall.start_y) * dirY) / wallLength;
                const faces = splitFaceLines(previewWall);
                const facePoint = (line) => ({
                    x: line[0].x + (line[1].x - line[0].x) * t,
                    y: line[0].y + (line[1].y - line[0].y) * t,
                });
                const cutA = facePoint(faces[0]);
                const cutB = faces[1] ? facePoint(faces[1]) : null;
                let cutStart = cutA;
                let cutEnd = cutB;
                if (!cutEnd) {
                    const perpX = -dirY;
                    const perpY = dirX;
                    const cutModelHalf = (28 / scaleFactor.current) / 2;
                    cutStart = {
                        x: splitPreviewPoint.x - perpX * cutModelHalf,
                        y: splitPreviewPoint.y - perpY * cutModelHalf,
                    };
                    cutEnd = {
                        x: splitPreviewPoint.x + perpX * cutModelHalf,
                        y: splitPreviewPoint.y + perpY * cutModelHalf,
                    };
                } else {
                    const span = Math.hypot(cutEnd.x - cutStart.x, cutEnd.y - cutStart.y) || 1;
                    const ux = (cutEnd.x - cutStart.x) / span;
                    const uy = (cutEnd.y - cutStart.y) / span;
                    const extra = 8 / scaleFactor.current;
                    cutStart = { x: cutStart.x - ux * extra, y: cutStart.y - uy * extra };
                    cutEnd = { x: cutEnd.x + ux * extra, y: cutEnd.y + uy * extra };
                }

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
        hoveredWall, hoveredDoorId, highlightWalls, tagDragPreview,
        selectedRoomPoints, project, hoveredPoint, lineSnapMarks,
        wallPanelsMap,
        filteredDimensions,
        forceRefresh,
        dimensionVisibility,
        planDetailsReady,
        showPanelLines,
        currentMode,
        roomSelectionSnapPoints,
        selectedIntersections,
        splitPreviewPoint,
        splitPreviewFace,
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

        // The typed number is the wall length from the start point. It is the
        // figure on the sheet. Thickness draws the second line and is not added.
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

        // One joined end slides the whole wall onto the host's far face.
        // Both ends move by the same amount, so the typed length stays put.
        if (pendingWallData.startPointSnapped !== pendingWallData.endPointSnapped) {
            const joined = useEndAsReference ? roundedEndPoint : roundedStartPoint;
            const siteWidth = Number(project?.width);
            const siteLength = Number(project?.length);
            const shifted = translateJoinedWallKeepingLength(
                roundedStartPoint,
                roundedEndPoint,
                joined,
                walls,
                rooms,
                {
                    minX: 0,
                    minY: 0,
                    maxX: Number.isFinite(siteWidth) ? siteWidth : Infinity,
                    maxY: Number.isFinite(siteLength) ? siteLength : Infinity,
                }
            );
            roundedStartPoint = shifted.start;
            roundedEndPoint = shifted.end;
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
            tip_to_tip: false,
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

    // Enter locks the first line at the typed length. The next click places the second line.
    commitTypedWallRef.current = async (tw, lengthMm) => {
        const length = Math.round(Number(lengthMm));
        if (!tw || tw.placingSide || !(length > 0)) return;
        const start = {
            x: tw.anchor_x ?? tw.start_x,
            y: tw.anchor_y ?? tw.start_y,
        };
        const aim = { x: tw.end_x, y: tw.end_y };
        if (Math.hypot(aim.x - start.x, aim.y - start.y) < 1) return;
        let end = pointAlongDirection(start, aim, length);
        if (!end) return;
        end = { x: Math.round(end.x), y: Math.round(end.y) };
        const roundedStart = { x: Math.round(start.x), y: Math.round(start.y) };
        if (Math.hypot(end.x - roundedStart.x, end.y - roundedStart.y) < 1) return;
        const locked = {
            ...tw,
            placingSide: true,
            singleLine: false,
            anchor_x: roundedStart.x,
            anchor_y: roundedStart.y,
            ref_x: end.x,
            ref_y: end.y,
            start_x: roundedStart.x,
            start_y: roundedStart.y,
            end_x: end.x,
            end_y: end.y,
            offsetSide: null,
            typedLength: '',
            thickness: tw.thickness ?? wallThickness,
        };
        typedLengthRef.current = '';
        setTypedWallLength('');
        setIsDrawing(true);
        tempWallRef.current = locked;
        setTempWall(locked);
    };

    const renderManualSplitPanel = () => {
        if (currentMode !== 'split-wall') {
            return null;
        }
        return (
            <div className="plan-details-card bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 rounded-lg p-5 shadow-sm">
                <h5 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Manual Wall Split</h5>
                {!splitTargetWall ? (
                    <div className="text-sm text-emerald-700 dark:text-emerald-300 space-y-2">
                        <p>Click a wall on the canvas to select it for splitting.</p>
                        <p>Click again on the wall to split at the snapped point, or enter an exact distance below.</p>
                    </div>
                ) : (
                    <>
                        <div className="text-sm text-gray-700 dark:text-gray-200 space-y-1 mb-3">
                            <div className="flex justify-between">
                                <span className="font-medium">Wall ID:</span>
                                <span>#{splitTargetWall.id}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="font-medium">Length:</span>
                                <span>{Math.round(splitTargetWallLength || 0)}</span>
                            </div>
                            {splitHoverDistance !== null && (
                                <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                                    <span className="font-medium">Preview distance:</span>
                                    <span>{Math.round(splitHoverDistance)}</span>
                                </div>
                            )}
                        </div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-2">
                            Distance from start (mm)
                        </label>
                        <input
                            ref={splitDistanceInputRef}
                            type="number"
                            min="1"
                            value={splitDistanceInput}
                            onChange={(e) => updatePreviewFromDistance(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSplitAtDistance();
                                }
                            }}
                            className="w-full px-3 py-2 border border-emerald-200 dark:border-emerald-700 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                            placeholder="Type a distance, then Enter"
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
                                className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all duration-200 text-sm"
                            >
                                Clear Selection
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
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
            <div className={`plan-canvas wall-canvas-container bg-white dark:bg-gray-900 rounded-xl shadow-lg p-4${isPlanFullscreen ? ' wall-plan-fullscreen' : ''}`}>
                {/* Header */}
                <div className="wall-canvas-header mb-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="shrink-0 min-w-0">
                            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                                Wall Plan
                            </h3>
                            <p className="text-xs text-gray-600 dark:text-gray-400 leading-tight">
                                Professional Layout
                            </p>
                        </div>

                        <div className="wall-plan-header-actions order-2 flex flex-wrap items-center gap-1.5 lg:order-3">
                        <button
                            type="button"
                            onClick={() => setShowDoorList((open) => !open)}
                            className={`px-2 py-1 text-xs rounded-md border font-medium shrink-0 ${
                                showDoorList
                                    ? 'border-indigo-600 bg-indigo-600 text-white'
                                    : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-500 dark:text-indigo-200 dark:hover:bg-indigo-950'
                            }`}
                        >
                            {showDoorList ? 'Hide door list' : 'Door list'}
                        </button>
                        <button
                            type="button"
                            onClick={togglePlanFullscreen}
                            className={`px-2 py-1 text-xs rounded-md border font-medium shrink-0 ${
                                isPlanFullscreen
                                    ? 'border-slate-800 bg-slate-800 text-white'
                                    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
                            }`}
                            title={isPlanFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen wall plan'}
                        >
                            {isPlanFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                        </button>
                        {onToggleEditMode && (
                            <button
                                type="button"
                                onClick={onToggleEditMode}
                                className={`px-2 py-1 text-xs rounded-md border font-medium shrink-0 ${
                                    isEditingMode
                                        ? 'border-red-600 bg-red-600 text-white'
                                        : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
                                }`}
                            >
                                {isEditingMode ? 'Exit edit' : 'Edit'}
                            </button>
                        )}
                        {!isDetailsPanelOpen && !isPlanFullscreen && (
                            <button
                                onClick={() => setIsDetailsPanelOpen(true)}
                                className="px-2 py-1 text-xs rounded-md border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors font-medium shrink-0"
                            >
                                Show Plan Details
                            </button>
                        )}
                        </div>

                        <div className="wall-dimension-toggles order-3 lg:order-2 w-full min-w-0 lg:w-auto lg:min-w-[16rem] lg:flex-1 lg:flex lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 px-2.5 py-2 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 text-xs text-gray-700 dark:text-gray-300">
                            <span className="font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center mb-1.5 lg:mb-0 lg:mr-3">
                                <svg className="w-3.5 h-3.5 mr-1 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M5 12h16M8 18h13" />
                                </svg>
                                Dimension Labels
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 lg:contents">
                            <label className="inline-flex items-center gap-1.5 min-w-0 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 shrink-0 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.project}
                                    onChange={() => handleDimensionVisibilityChange('project')}
                                />
                                <span className="leading-tight">Overall project dimensions</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 min-w-0 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 shrink-0 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.wall}
                                    onChange={() => handleDimensionVisibilityChange('wall')}
                                />
                                <span className="leading-tight">Wall dimensions</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 min-w-0 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 shrink-0 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={dimensionVisibility.panel}
                                    onChange={() => handleDimensionVisibilityChange('panel')}
                                />
                                <span className="leading-tight" title="End panel sizes, plus grouped repeats such as 4 × 1150">Side Panel dimensions</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 min-w-0 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 shrink-0 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    checked={showPanelLines}
                                    onChange={onTogglePanelLines}
                                />
                                <span className="leading-tight">Panel division lines</span>
                            </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="wall-plan-body space-y-6">
                    <div className="wall-plan-stage space-y-4">
                        {/* Canvas */}
                        <div className="wall-plan-drawing flex flex-col lg:flex-row gap-4 lg:gap-6 min-w-0 w-full max-w-full">
                            {/* Canvas Container */}
                            <div className="wall-canvas-wrapper flex-1 min-w-0 w-full max-w-full">
                                <div className="plan-canvas-zoom-stack">
                                <div
                                    ref={canvasContainerRef}
                                    className="plan-canvas-viewport border-2 border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden shadow-lg relative w-full max-w-full"
                                    style={isPlanFullscreen
                                        ? { height: '100%', minHeight: 0, flex: '1 1 auto' }
                                        : {
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
                                            tagDragPreview
                                                ? 'cursor-grabbing'
                                                : hoveredTagId
                                                ? 'cursor-grab'
                                                : planAnnotateMode && planNoteAddMode && canAnnotate
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
                                            {!isPlanFullscreen && renderManualSplitPanel()}

                                            {/* Wall Finish Legend */}
                                            {thicknessColorMap && thicknessColorMap.size > 0 && (
                                                <div className="plan-details-card bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                                                    <h5 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center">
                                                        <svg className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                                                        </svg>
                                                        Wall colors
                                                    </h5>
                                                    <div className="space-y-3">
                                                        {collectWallFaceLegend(thicknessColorMap).map((colors) => (
                                                            <div key={colors.finishKey} className="space-y-1">
                                                                <div className="flex items-center">
                                                                    <div className="mr-3 relative" style={{ width: '60px', height: '16px' }} title="Side 1 on top, Side 2 below">
                                                                        <div
                                                                            className="absolute left-0 right-0"
                                                                            style={{
                                                                                top: '4px',
                                                                                height: '2px',
                                                                                backgroundColor: adjustPlanStrokeColor(colors.innerColor || colors.innerWall),
                                                                            }}
                                                                        ></div>
                                                                        <div
                                                                            className="absolute left-0 right-0"
                                                                            style={{
                                                                                top: '10px',
                                                                                height: '2px',
                                                                                backgroundColor: adjustPlanStrokeColor(colors.outerColor || colors.wall),
                                                                            }}
                                                                        ></div>
                                                                    </div>
                                                                    <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">{colors.label}</span>
                                                                </div>
                                                                <div className="text-xs text-gray-600 dark:text-gray-300">
                                                                    {colors.finishLabel}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
                                                        The top line is Side 1 and the bottom line is Side 2. Side 1 sits on the right as the wall runs from its start to its end, not toward the model center. The same finish on a different wall thickness uses a different color.
                                                    </div>
                                                </div>
                                            )}

                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {showDoorList && (
                        <div className="wall-plan-door-list bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Door list</h4>
                                <button
                                    type="button"
                                    onClick={() => setShowDoorList(false)}
                                    className="px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                                >
                                    Close
                                </button>
                            </div>
                            <DoorTable doors={doors} />
                        </div>
                    )}

                    {/* View Material Needed Section — hidden for view-only share links */}
                    {!isViewOnlyShare && (
                    <div className="plan-material-card wall-plan-below dark:bg-gray-800 dark:border-gray-600">
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
                    <div className="plan-material-card wall-plan-below dark:bg-gray-800 dark:border-gray-600">
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
            
            {isPlanFullscreen && currentMode === 'split-wall' && typeof document !== 'undefined' && createPortal(
                <div className="fixed top-16 right-4 z-[10050] w-[min(360px,calc(100vw-2rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto">
                    {renderManualSplitPanel()}
                </div>,
                document.body,
            )}

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
                        onChange={(e) => setBulkJointMethod(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                        <option value="none">None</option>
                        <option value="butt_in">Butt-in</option>
                        <option value="45_cut">45° Cut</option>
                    </select>
                    <button
                        type="button"
                        className="w-full px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        onClick={() => {
                            const method = bulkJointMethod;
                            const next = selectedIntersections.map((inter) => ({
                                ...inter,
                                pairs: (inter.pairs || []).map((pair) => ({
                                    ...pair,
                                    joining_method: method,
                                    deduct_joining_thickness: false,
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
                                deduct_joining_thickness: false,
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
                            const workingWalls = walls.map((w) => ({ ...w }));
                            for (const inter of selectedIntersections) {
                                for (const pair of (inter.pairs || [])) {
                                    await api.post('/intersections/set_joint/', {
                                        project: projectId,
                                        wall_1: pair.wall1.id,
                                        wall_2: pair.wall2.id,
                                        joining_method: pair.joining_method,
                                        deduct_joining_thickness: false,
                                    });
                            
                                    await adjustWallForJointType(
                                        {
                                            wall_1: pair.wall1.id,
                                            wall_2: pair.wall2.id,
                                            joining_method: pair.joining_method,
                                            deduct_joining_thickness: false,
                                        },
                                        workingWalls,
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

            {/* Wall length sits on the right. A centered overlay locks page scroll
                and the plan re-fits, which throws away the current zoom. */}
            {showLengthInput && pendingWallData && typeof document !== 'undefined' && createPortal(
                <div className="opening-side-panel">
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-6 w-full max-h-full overflow-y-auto">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Enter Wall Length</h3>
                        <p className="text-sm text-gray-600 mb-3">
                            This is the length on the drawing, from the point you started.
                            Type it and press Enter while the wall is following the cursor.
                            Wall thickness draws the second line. It is not added to this number.
                        </p>
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
                                        : 'Length (mm):'}
                            </label>
                            <input
                                type="number"
                                id="wallLengthInput"
                                min="1"
                                step="1"
                                defaultValue={Math.round(pendingWallData.currentLength || 0)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
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
                </div>,
                document.body
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