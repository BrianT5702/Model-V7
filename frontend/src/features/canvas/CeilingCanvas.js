import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { calculateOffsetPoints } from './drawing.js';
import { calculatePolygonVisualCenter } from './utils.js';
import { DIMENSION_CONFIG } from './DimensionConfig.js';
import { hasLabelOverlap, calculateHorizontalLabelBounds, calculateVerticalLabelBounds, smartPlacement } from './collisionDetection.js';

const DEFAULT_CANVAS_WIDTH = 1000;
const DEFAULT_CANVAS_HEIGHT = 650;
const CANVAS_ASPECT_RATIO = DEFAULT_CANVAS_HEIGHT / DEFAULT_CANVAS_WIDTH;
const MAX_CANVAS_HEIGHT_RATIO = 0.7;
// Mobile-friendly minimum sizes - smaller for phones, larger for tablets/desktop
const MIN_CANVAS_WIDTH = 320; // Reduced from 480 for better mobile support
const MIN_CANVAS_HEIGHT = 240; // Reduced from 320 for better mobile support
const PADDING = 50;

const CeilingCanvas = ({ 
    // Multi-room props
    rooms = [], 
    walls = [],
    intersections = [],
    ceilingPlans = [], 
    ceilingPanelsMap = {}, 
    zones = [],
    onRoomSelect,
    onRoomDeselect,
    onPanelSelect,
    selectedRoomId = null, 
    selectedPanelId = null,
    scale = 1.0,
    
    // Single-room props (for backward compatibility)
    room = null,
    ceilingPlan = null,
    ceilingPanels = [],
    
    // Project data for boundary calculations
    projectData = null,
    // Latest project-wide waste % from POST (immediate UI updates after room edits)
    projectWastePercentage = null,
    
    // Additional props
    orientationAnalysis = null,
    ceilingThickness = 150,
    
    // Support configuration
    supportType = 'nylon',
    enableNylonHangers = true, // Enable automatic nylon hanger supports
    enableAluSuspension = false, // Enable alu suspension custom drawing
    nylonHangerOptions = { includeAccessories: false, includeCable: false },
    aluSuspensionCustomDrawing = false,
    panelsNeedSupport = false,
    customSupports = undefined, // Custom supports from parent (for persistence)
    onCustomSupportsChange = null, // Callback to update custom supports in parent
    
    // Room selection props
    showAllRooms = true,
    
    // Shared panel data update function
    updateSharedPanelData = null,
    selectedPanelIds = [],
    // Dimension visibility (checkbox filter)
    dimensionVisibility = { room: true, panel: true, cutPanel: false }
}) => {
    // Determine if we're in multi-room mode or single-room mode - memoize to prevent recalculation
    const isMultiRoomMode = useMemo(() => rooms.length > 0, [rooms.length]);
    
    // Use multi-room data or fall back to single-room data - memoize to prevent re-renders
    const effectiveRooms = useMemo(() => {
        return isMultiRoomMode ? rooms : (room ? [room] : []);
    }, [isMultiRoomMode, rooms, room]);
    
    const effectiveCeilingPanelsMap = useMemo(() => {
        return isMultiRoomMode ? ceilingPanelsMap : (room ? { [room.id]: ceilingPanels } : {});
    }, [isMultiRoomMode, ceilingPanelsMap, room, ceilingPanels]);
    
    const effectiveCeilingPlans = useMemo(() => {
        const plans = isMultiRoomMode ? ceilingPlans : (ceilingPlan ? [ceilingPlan] : []);
        // Debug: Log available ceiling plans
        if (plans.length === 0) {
            console.warn('⚠️ [CeilingCanvas] No ceiling plans available. isMultiRoomMode:', isMultiRoomMode, 
                'ceilingPlans:', ceilingPlans?.length || 0, 'ceilingPlan:', ceilingPlan?.id || 'null');
        } else {
            console.log(`✅ [CeilingCanvas] Found ${plans.length} ceiling plan(s):`, 
                plans.map(cp => ({ id: cp.id, room: cp.room, room_id: cp.room_id, orientation: cp.orientation_strategy })));
        }
        return plans;
    }, [isMultiRoomMode, ceilingPlans, ceilingPlan]);

    const getPanelIdentifier = useCallback((panel) => {
        if (!panel) return null;
        const rawId = panel.id ?? panel.panel_id ?? panel.panelId ?? panel.uuid ?? null;
        return rawId === null || rawId === undefined ? null : rawId.toString();
    }, []);

    const normalizedSelectedPanelId = useMemo(() => {
        if (selectedPanelId === null || selectedPanelId === undefined) return null;
        return selectedPanelId.toString();
    }, [selectedPanelId]);

    const selectedPanelIdsList = useMemo(() => {
        if (!Array.isArray(selectedPanelIds)) return [];
        return selectedPanelIds
            .map(id => (id === null || id === undefined ? null : id.toString()))
            .filter(Boolean);
    }, [selectedPanelIds]);

    const canvasRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const [canvasSize, setCanvasSize] = useState({
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    });
    const [currentScale, setCurrentScale] = useState(1);
    const [showPanelTable, setShowPanelTable] = useState(false);
    const [isPlacingSupport, setIsPlacingSupport] = useState(false);
    // Use customSupports from props if provided, otherwise use local state as fallback
    const [localCustomSupports, setLocalCustomSupports] = useState([]);
    const effectiveCustomSupports = customSupports !== undefined && Array.isArray(customSupports) ? customSupports : localCustomSupports;
    // Function to update custom supports - use callback if provided, otherwise use local state setter
    const updateCustomSupports = useCallback((newSupports) => {
        if (onCustomSupportsChange) {
            onCustomSupportsChange(newSupports);
        } else {
            setLocalCustomSupports(newSupports);
        }
    }, [onCustomSupportsChange]);
    const [supportStartPoint, setSupportStartPoint] = useState(null);
    const [supportPreview, setSupportPreview] = useState(null);
    const [hoveredRoomId, setHoveredRoomId] = useState(null);

    // [NEW] Local state for checkboxes (copying logic from FloorCanvas)
    const [visibilityState, setVisibilityState] = useState(dimensionVisibility);

    // [NEW] Sync state if parent props change
    useEffect(() => {
        setVisibilityState(dimensionVisibility);
    }, [dimensionVisibility]);

    // Track available drawing space for responsive canvas sizing
    useEffect(() => {
        const container = canvasContainerRef.current;
        if (!container) return;

        const updateCanvasSize = (rawWidth) => {
            const width = Math.max(rawWidth, MIN_CANVAS_WIDTH);
            const maxHeight = typeof window !== 'undefined' ? window.innerHeight * MAX_CANVAS_HEIGHT_RATIO : DEFAULT_CANVAS_HEIGHT;
            const calculatedHeight = width * CANVAS_ASPECT_RATIO;
            const preferredHeight = Math.max(calculatedHeight, MIN_CANVAS_HEIGHT);
            const constrainedHeight = Math.min(preferredHeight, maxHeight);
            const height = Math.max(constrainedHeight, MIN_CANVAS_HEIGHT);

            setCanvasSize((prev) => {
                if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
                    return prev;
                }
                return {
                    width,
                    height
                };
            });
        };

        let observer = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.target === container) {
                        const entryWidth = entry.contentRect?.width ?? container.clientWidth;
                        updateCanvasSize(entryWidth);
                    }
                });
            });

            observer.observe(container);
        }

        updateCanvasSize(container.clientWidth);

        const handleWindowResize = () => updateCanvasSize(container.clientWidth);
        window.addEventListener('resize', handleWindowResize);

        return () => {
            if (observer) {
                observer.disconnect();
            }
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);
    
    // Initialize mouse position tracking
    useEffect(() => {
        if (projectData) {
            setSupportPreview(prev => ({
                ...prev,
                mousePosition: { x: 0, y: 0 },
                distances: calculateDistancesToEdges(0, 0)
            }));
        }
    }, [projectData]);
    
    // Set proper cursor when placing support mode changes
    useEffect(() => {
        if (canvasRef.current) {
            if (isPlacingSupport) {
                canvasRef.current.style.cursor = 'crosshair';
            } else {
                canvasRef.current.style.cursor = 'grab';
            }
        }
    }, [isPlacingSupport]);
    
    // Canvas state refs
    const scaleFactor = useRef(1);
    const initialScale = useRef(1); // Track the initial scale
    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const isDragging = useRef(false); // For support placement
    const lastMousePos = useRef({ x: 0, y: 0 });
    const isZoomed = useRef(false); // Track if user has manually zoomed
    
    // Store placement decisions for dimensions to prevent position changes on zoom
    const dimensionPlacementMemory = useRef(new Map());
    
    // Canvas dragging state (separate from support dragging)
    const isDraggingCanvas = useRef(false);
    const lastCanvasMousePos = useRef({ x: 0, y: 0 });
    const hasUserPositionedView = useRef(false); // Track if user has manually positioned the view

    // Canvas dimensions are derived from container size for responsiveness
    const CANVAS_WIDTH = Math.round(canvasSize.width);
    const CANVAS_HEIGHT = Math.round(canvasSize.height);

    // Calculate project bounds for dimension positioning (project boundary)
    const projectBounds = useMemo(() => {
        if (projectData) {
            return {
                minX: 0,
                maxX: projectData.width,
                minY: 0,
                maxY: projectData.length
            };
        }
        return null;
    }, [projectData]);

    // Calculate model bounds for dimension positioning (all rooms)
    const modelBounds = useMemo(() => {
        if (!effectiveRooms || effectiveRooms.length === 0) return null;
        
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        effectiveRooms.forEach(room => {
            if (room.room_points && room.room_points.length > 0) {
                const roomMinX = Math.min(...room.room_points.map(p => p.x));
                const roomMaxX = Math.max(...room.room_points.map(p => p.x));
                const roomMinY = Math.min(...room.room_points.map(p => p.y));
                const roomMaxY = Math.max(...room.room_points.map(p => p.y));
                
                minX = Math.min(minX, roomMinX);
                maxX = Math.max(maxX, roomMaxX);
                minY = Math.min(minY, roomMinY);
                maxY = Math.max(maxY, roomMaxY);
            }
        });
        
        return { minX, maxX, minY, maxY };
    }, [effectiveRooms]);

    // Helper function to get accurate panel counts from multiple sources
    const getAccuratePanelCounts = useMemo(() => {
        const getTotalPanels = () => {
            if (ceilingPlan && ceilingPlan.total_panels) {
                return ceilingPlan.total_panels;
            }
            if (ceilingPlan && ceilingPlan.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                return ceilingPlan.enhanced_panels.length;
            }
            if (ceilingPlan && ceilingPlan.ceiling_panels && Array.isArray(ceilingPlan.ceiling_panels)) {
                return ceilingPlan.ceiling_panels.length;
            }
            const totalFromMap = Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => sum + (panels ? panels.length : 0), 0);
            if (totalFromMap > 0) {
                return totalFromMap;
            }
            return ceilingPanels ? ceilingPanels.length : 0;
        };

        const getFullPanels = () => {
            if (ceilingPlan && ceilingPlan.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                return ceilingPlan.enhanced_panels.filter(p => !p.is_cut).length;
            }
            return Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => 
                sum + (panels ? panels.filter(p => !p.is_cut).length : 0), 0
            );
        };

        const getCutPanels = () => {
            if (ceilingPlan && ceilingPlan.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                return ceilingPlan.enhanced_panels.filter(p => p.is_cut).length;
            }
            return Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => 
                sum + (panels ? panels.filter(p => p.is_cut).length : 0), 0
            );
        };

        const zoneTotals = zones.reduce((acc, zone) => {
            const zonePanels = zone?.ceiling_panels || [];
            if (!Array.isArray(zonePanels)) return acc;
            zonePanels.forEach(panel => {
                if (!panel) return;
                acc.total += 1;
                if (panel.is_cut || panel.is_cut_panel) {
                    acc.cut += 1;
                } else {
                    acc.full += 1;
                }
            });
            return acc;
        }, { total: 0, full: 0, cut: 0 });

        return {
            total: getTotalPanels() + zoneTotals.total,
            full: getFullPanels() + zoneTotals.full,
            cut: getCutPanels() + zoneTotals.cut
        };
    }, [ceilingPlan, effectiveCeilingPanelsMap, ceilingPanels, zones]);



    // Initialize and draw canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');

        // Handle high DPI displays to prevent blurriness (match Floor/Wall plan pattern)
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = CANVAS_WIDTH;
        const displayHeight = CANVAS_HEIGHT;

        // Set the internal size to the display size * device pixel ratio
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;

        // Scale the context to match device pixel ratio
        context.scale(dpr, dpr);

        // Set the CSS size to the display size
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';

        // Calculate optimal scale and offset for all rooms
        // Only recalculate if user hasn't manually positioned the view
        if (!hasUserPositionedView.current) {
            calculateCanvasTransform();
        }

        // Draw everything
        drawCanvas(context);

    }, [effectiveRooms, effectiveCeilingPlans, effectiveCeilingPanelsMap, zones, selectedRoomId, selectedPanelId, selectedPanelIdsList, CANVAS_WIDTH, CANVAS_HEIGHT, visibilityState]);

    // Sync external scale prop with internal zoom
    useEffect(() => {
        if (scale !== undefined && scale !== currentScale) {
            console.log('External scale changed from', currentScale, 'to', scale);
            zoomToCenter(scale);
        }
    }, [scale]);

    // Calculate optimal canvas transformation
    const calculateCanvasTransform = () => {
        if ((!effectiveRooms || effectiveRooms.length === 0) && (!zonesAsRooms || zonesAsRooms.length === 0)) {
            scaleFactor.current = 1;
            initialScale.current = 1; // Set initial scale
            offsetX.current = CANVAS_WIDTH / 2;
            offsetY.current = CANVAS_HEIGHT / 2;
            return;
        }

        // Calculate bounds for all rooms combined
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        const roomsForBounds = effectiveRooms.length > 0 ? effectiveRooms : zonesAsRooms;
        roomsForBounds.forEach(room => {
            if (room.room_points && room.room_points.length > 0) {
                const xCoords = room.room_points.map(p => p.x);
                const yCoords = room.room_points.map(p => p.y);
                
                const roomMinX = Math.min(...xCoords);
                const roomMaxX = Math.max(...xCoords);
                const roomMinY = Math.min(...yCoords);
                const roomMaxY = Math.max(...yCoords);
                
                minX = Math.min(minX, roomMinX);
                maxX = Math.max(maxX, roomMaxX);
                minY = Math.min(minY, roomMinY);
                maxY = Math.max(maxY, roomMaxY);
            }
        });

        const totalWidth = maxX - minX || 1;
        const totalHeight = maxY - minY || 1;

        // Calculate optimal scale - use exact same approach as wall plan
        const scaleX = (CANVAS_WIDTH - 4 * PADDING) / totalWidth;
        const scaleY = (CANVAS_HEIGHT - 4 * PADDING) / totalHeight;
        const optimalScale = Math.min(scaleX, scaleY, 2.0); // Cap at 2x zoom

        // Only set the scale if user hasn't manually zoomed
        if (!isZoomed.current) {
        scaleFactor.current = optimalScale;
        setCurrentScale(optimalScale);
        }
        initialScale.current = optimalScale; // Always store the initial scale

        // Only reset offset if user hasn't manually dragged the canvas
        if (!isDraggingCanvas.current) {
            // Center all rooms
            const scaledWidth = totalWidth * optimalScale;
            const scaledHeight = totalHeight * optimalScale;
            
            offsetX.current = (CANVAS_WIDTH - scaledWidth) / 2 - minX * optimalScale;
            offsetY.current = (CANVAS_HEIGHT - scaledHeight) / 2 - minY * optimalScale;
        }
    };

    // Main drawing function
    const drawCanvas = (ctx) => {
        // Clear canvas
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Draw grid
        drawGrid(ctx);

        // Draw walls first (behind everything else)
        if (walls && walls.length > 0) {
            drawWalls(ctx);
        }

        // Global collision detection - shared across all rooms to prevent overlaps
        const globalPlacedLabels = [];
        const globalAllLabels = [];
        
        // PASS 1: Draw all rooms and their ceiling panels (includes dimension LINES only)
        // Draw room outlines first (room names will be added to collision detection)
        if (effectiveRooms && effectiveRooms.length > 0) {
            effectiveRooms.forEach(room => {
                drawRoomOutline(ctx, room, globalPlacedLabels);
            });
        }
        
        // Then draw panels and dimensions (which will check against room names)
        if (effectiveRooms && effectiveRooms.length > 0) {
            effectiveRooms.forEach(room => {
                drawCeilingPanels(ctx, room, globalPlacedLabels, globalAllLabels);
            });
        }

        // Draw merged ceiling zones after individual rooms for overlay
        drawZones(ctx, globalPlacedLabels, globalAllLabels);
        
        // PASS 2: Draw all dimension text BOXES on top (highest layer)
        globalAllLabels.forEach(label => {
            drawDimensionTextBox(ctx, label);
        });

        // Draw title and info
        drawTitle(ctx);
    };

    // Draw professional grid
    const drawGrid = (ctx) => {
        // Use the same professional grid approach as Canvas2D
        const gridSize = 50; // Fixed grid size like wall plan - always visible
        
        // Calculate grid offset to align with room coordinates
        const gridOffsetX = offsetX.current % gridSize;
        const gridOffsetY = offsetY.current % gridSize;
        
        // Draw grid with proper styling - same as wall plan
        ctx.strokeStyle = '#ddd'; // Same color as wall plan
        ctx.lineWidth = 1; // Same line width as wall plan
        
        // Draw vertical lines - fixed spacing regardless of scale
        for (let x = -gridOffsetX; x <= CANVAS_WIDTH; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, CANVAS_HEIGHT);
            ctx.stroke();
        }
        
        // Draw horizontal lines - fixed spacing regardless of scale
        for (let y = -gridOffsetY; y <= CANVAS_HEIGHT; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(CANVAS_WIDTH, y);
            ctx.stroke();
        }
    };

    // Check if room name position conflicts with all text elements (panels, dimensions, other room names)
    const checkNameTextCollision = (labelX, labelY, labelWidth, labelHeight, padding, roomId, placedLabels) => {
        // Calculate room name label bounds in canvas coordinates
        // labelX and labelY are in model coordinates, convert to canvas
        const canvasX = labelX * scaleFactor.current + offsetX.current;
        const canvasY = labelY * scaleFactor.current + offsetY.current;
        
        const labelBounds = {
            x: canvasX - labelWidth / 2 - padding,
            y: canvasY - labelHeight / 2 - padding,
            width: labelWidth + padding * 2,
            height: labelHeight + padding * 2
        };
        
        // Check collision with all placed labels (dimensions, other room names, etc.)
        // Use minimum separation of 5px for better spacing
        if (hasLabelOverlap(labelBounds, placedLabels, 5)) {
            return true; // Collision detected
        }
        
        // Also check if position conflicts with ceiling panels (physical collision)
        const roomPanels = effectiveCeilingPanelsMap[roomId] || [];
        const labelRadius = 50; // Approximate radius around label to avoid
        
        for (const panel of roomPanels) {
            // Check if label position is within panel bounds (with buffer)
            const panelLeft = panel.start_x - labelRadius;
            const panelRight = Math.max(panel.start_x, panel.end_x) + labelRadius;
            const panelTop = Math.min(panel.start_y, panel.end_y) - labelRadius;
            const panelBottom = Math.max(panel.start_y, panel.end_y) + labelRadius;
            
            if (labelX >= panelLeft && labelX <= panelRight && 
                labelY >= panelTop && labelY <= panelBottom) {
                return true; // Collision detected with panel
            }
        }
        
        return false; // No collision
    };

    // Find optimal position for room name to avoid all text collisions (dimensions, other room names, panels)
    // Uses pre-calculated label dimensions to ensure exact match with drawn bounds
    const findOptimalNamePositionWithDimensions = (room, baseX, baseY, labelWidth, labelHeight, padding, placedLabels) => {
        if (!room.room_name) return { x: baseX, y: baseY };
        
        // Try positions in a spiral pattern around the base position
        const offsets = [
            { x: 0, y: 0 },      // Original position
            { x: 0, y: -100 },    // Up
            { x: 100, y: 0 },     // Right
            { x: 0, y: 100 },     // Down
            { x: -100, y: 0 },    // Left
            { x: 50, y: -50 },    // Up-right
            { x: 50, y: 50 },     // Down-right
            { x: -50, y: 50 },    // Down-left
            { x: -50, y: -50 },   // Up-left
            { x: 0, y: -200 },    // Further up
            { x: 200, y: 0 },     // Further right
            { x: 0, y: 200 },     // Further down
            { x: -200, y: 0 },    // Further left
        ];
        
        for (const offset of offsets) {
            const testX = baseX + offset.x;
            const testY = baseY + offset.y;
            
            // Check if this position is still within room bounds
            if (isPointInPolygon(testX, testY, room.room_points)) {
                if (!checkNameTextCollision(testX, testY, labelWidth, labelHeight, padding, room.id, placedLabels)) {
                    return { x: testX, y: testY }; // Found good position
                }
            }
        }
        
        // If no collision-free position found, return original
        return { x: baseX, y: baseY };
    };

    // Draw room outline
    const drawRoomOutline = (ctx, room, placedLabels = []) => {
        if (!room.room_points || room.room_points.length < 3) return;

        const isSelected = room.id === selectedRoomId;
        const isHovered = room.id === hoveredRoomId;
        const isZoneSelectionActive = typeof selectedRoomId === 'string' && selectedRoomId.startsWith('zone-');
        const isZoneRoom = typeof room.id === 'string' && room.id.startsWith('zone-');
        const isRoomMode = !showAllRooms && selectedRoomId;

        if (isZoneSelectionActive && !isZoneRoom) {
            return;
        }
        
        // Room outline styling
        if (isSelected) {
            ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'; // More visible blue for selected room
            ctx.strokeStyle = '#1d4ed8'; // Darker blue border for selected room
            ctx.lineWidth = 6 * scaleFactor.current; // Thicker border for better visibility
        } else if (isZoneSelectionActive) {
            ctx.fillStyle = 'rgba(156, 163, 175, 0.05)'; // Dimmed when zone is selected
            ctx.strokeStyle = '#d1d5db';
            ctx.lineWidth = 1 * scaleFactor.current;
        } else if (isHovered) {
            ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'; // Light blue for hovered room
            ctx.strokeStyle = '#3b82f6'; // Blue border for hovered room
            ctx.lineWidth = 4 * scaleFactor.current; // Thicker border for hover
        } else if (isRoomMode) {
            // When in single room mode, dim unselected rooms
            ctx.fillStyle = 'rgba(156, 163, 175, 0.02)'; // Very light gray for unselected rooms
            ctx.strokeStyle = '#d1d5db'; // Light gray border for unselected rooms
            ctx.lineWidth = 1 * scaleFactor.current;
        } else {
            ctx.fillStyle = 'rgba(156, 163, 175, 0.05)'; // Very light gray for unselected rooms
            ctx.strokeStyle = '#9ca3af'; // Gray border for unselected rooms
            ctx.lineWidth = 2 * scaleFactor.current;
        }

        // Draw room outline
        ctx.beginPath();
        const firstPoint = room.room_points[0];
        ctx.moveTo(
            firstPoint.x * scaleFactor.current + offsetX.current, 
            firstPoint.y * scaleFactor.current + offsetY.current
        );

        for (let i = 1; i < room.room_points.length; i++) {
            const point = room.room_points[i];
            ctx.lineTo(
                point.x * scaleFactor.current + offsetX.current, 
                point.y * scaleFactor.current + offsetY.current
            );
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Add room name label (with collision detection against all text elements)
        if (room.room_name) {
            const labelText = room.room_name;
            
            // Calculate label dimensions FIRST based on state (before finding position)
            // This ensures collision detection uses exact same bounds as what will be drawn
            let labelWidth, labelHeight, padding, textColor, bgColor, bgOpacity;
            
            if (isSelected) {
                ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
                labelWidth = ctx.measureText(labelText).width;
                labelHeight = Math.max(16, 18 * scaleFactor.current);
                padding = 8;
                textColor = '#ffffff';
                bgColor = 'rgba(59, 130, 246, 0.9)';
            } else if (isHovered) {
                ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
                labelWidth = ctx.measureText(labelText).width;
                labelHeight = Math.max(14, 16 * scaleFactor.current);
                padding = 4;
                textColor = '#3b82f6';
                bgColor = 'rgba(59, 130, 246, 0.2)';
            } else if (isRoomMode) {
                ctx.font = `normal ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
                labelWidth = ctx.measureText(labelText).width;
                labelHeight = Math.max(14, 16 * scaleFactor.current);
                padding = 4;
                textColor = '#9ca3af';
                bgColor = null; // No background
            } else {
                ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
                labelWidth = ctx.measureText(labelText).width;
                labelHeight = Math.max(14, 16 * scaleFactor.current);
                padding = 4;
                textColor = '#6b7280';
                bgColor = null; // No background
            }
            
            // Use stored label position if available, otherwise calculate smart center
            let baseX, baseY;
            if (room.label_position && room.label_position.x !== undefined && room.label_position.y !== undefined) {
                // Use stored position from Canvas2D
                baseX = room.label_position.x;
                baseY = room.label_position.y;
            } else {
                // Calculate smart visual center for better placement
                const smartCenter = calculatePolygonVisualCenter(room.room_points);
                if (smartCenter) {
                    baseX = smartCenter.x;
                    baseY = smartCenter.y;
                } else {
                    // Fallback to geometric center
                    baseX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
                    baseY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
                }
            }
            
            // Find optimal position using EXACT label dimensions calculated above
            const optimalPosition = findOptimalNamePositionWithDimensions(room, baseX, baseY, labelWidth, labelHeight, padding, placedLabels || []);
            const labelX = optimalPosition.x;
            const labelY = optimalPosition.y;
            
            // Draw background if needed
            if (bgColor) {
                ctx.fillStyle = bgColor;
                ctx.fillRect(
                    labelX * scaleFactor.current + offsetX.current - labelWidth/2 - padding,
                    labelY * scaleFactor.current + offsetY.current - labelHeight/2 - padding,
                    labelWidth + padding * 2,
                    labelHeight + padding * 2
                );
            }
            
            // Draw text
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, labelX * scaleFactor.current + offsetX.current, labelY * scaleFactor.current + offsetY.current);
            
            // Add room name to collision detection system so dimensions and other text avoid it
            // Use EXACT same bounds calculation as what was drawn (matching the fillRect call above)
            if (placedLabels) {
                // Calculate bounds exactly as drawn (matching the fillRect coordinates if bgColor exists, or text bounds if not)
                const canvasX = labelX * scaleFactor.current + offsetX.current;
                const canvasY = labelY * scaleFactor.current + offsetY.current;
                
                // Use the exact same calculation as the fillRect/drawing code
                const roomNameBounds = {
                    x: canvasX - labelWidth / 2 - padding,
                    y: canvasY - labelHeight / 2 - padding,
                    width: labelWidth + padding * 2,
                    height: labelHeight + padding * 2,
                    text: labelText,
                    type: 'room_name'
                };
                
                // Verify bounds are valid (not NaN or invalid)
                if (isFinite(roomNameBounds.x) && isFinite(roomNameBounds.y) && 
                    isFinite(roomNameBounds.width) && isFinite(roomNameBounds.height) &&
                    roomNameBounds.width > 0 && roomNameBounds.height > 0) {
                    placedLabels.push(roomNameBounds);
                }
            }
        }
    };

    // Draw walls with dashed lines (inner face)
    const drawWalls = (ctx) => {
        if (!walls || walls.length === 0) {
            console.log('No walls to draw');
            return;
        }

        // Calculate center for wall offset calculations
        const center = { x: 0, y: 0 };
        if (effectiveRooms.length > 0) {
            const allPoints = effectiveRooms.flatMap(room => room.room_points || []);
            if (allPoints.length > 0) {
                center.x = allPoints.reduce((sum, p) => sum + p.x, 0) / allPoints.length;
                center.y = allPoints.reduce((sum, p) => sum + p.y, 0) / allPoints.length;
            }
        }
        
        walls.forEach(wall => {
            
            try {
                // Calculate gap in pixels based on wall thickness
                // Gap should represent half the wall thickness on each side
                // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
                const wallThickness = wall.thickness || 100; // Default to 100mm if not set
                const gapPixels = (wallThickness * scaleFactor.current) / 2;

                // Calculate offset points for double-line wall
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    gapPixels,
                    center,
                    scaleFactor.current
                );
                
                // Check for 45° cuts at EACH END separately
                // We need to determine which line (left or right) to shorten at each end
                const wallDx = wall.end_x - wall.start_x;
                const wallDy = wall.end_y - wall.start_y;
                const wallLength = Math.hypot(wallDx, wallDy);
                const wallDirX = wallLength > 0 ? wallDx / wallLength : 0;
                const wallDirY = wallLength > 0 ? wallDy / wallLength : 0;
                
                // Determine which line is left and which is right by comparing positions
                // For vertical walls: left = smaller X, right = larger X
                // For horizontal walls: need to consider wall direction
                const isVertical = Math.abs(wallDx) < Math.abs(wallDy);
                
                // Compare line positions at midpoint
                const line1MidX = (line1[0].x + line1[1].x) / 2;
                const line1MidY = (line1[0].y + line1[1].y) / 2;
                const line2MidX = (line2[0].x + line2[1].x) / 2;
                const line2MidY = (line2[0].y + line2[1].y) / 2;
                
                // Determine which line is on left vs right
                let line1IsLeft;
                if (isVertical) {
                    // For vertical walls, left = smaller X
                    line1IsLeft = line1MidX < line2MidX;
                } else {
                    // For horizontal walls, determine left based on wall direction
                    // When facing the wall direction, left is 90° counterclockwise
                    // For wall going left-to-right (wallDirX > 0): left = smaller Y
                    // For wall going right-to-left (wallDirX < 0): left = larger Y
                    if (wallDirX > 0) {
                        line1IsLeft = line1MidY < line2MidY;
                    } else {
                        line1IsLeft = line1MidY > line2MidY;
                    }
                }
                
                // Check start end for 45° cut
                let startHas45 = false;
                let startIsOnLeftSide = false; // true if joining wall is on left side
                
                // Check end end for 45° cut
                let endHas45 = false;
                let endIsOnLeftSide = false;
                
                // Check each intersection to find 45° cuts at each endpoint
                intersections.forEach(inter => {
                    if (inter.joining_method === '45_cut' && (inter.wall_1 === wall.id || inter.wall_2 === wall.id)) {
                        const joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                        const joiningWall = walls.find(w => w.id === joiningWallId);
                        
                        if (joiningWall) {
                            // Check if this intersection is at start or end
                            const tolerance = 1; // 1mm tolerance
                            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
                            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
                            
                            if (isAtStart) {
                                startHas45 = true;
                                
                                // Determine which side (left or right) the joining wall is on
                                const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                                const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                                
                                // Determine which side (left or right) the joining wall is on
                                // Use direct coordinate comparison instead of cross product for clarity
                                if (isVertical) {
                                    // For vertical wall, left = smaller X
                                    startIsOnLeftSide = joinMidX < wall.start_x;
                                } else {
                                    // For horizontal wall, need to check based on wall direction
                                    if (wallDirX > 0) {
                                        // Wall goes left to right, left = smaller Y
                                        startIsOnLeftSide = joinMidY < wall.start_y;
                                    } else {
                                        // Wall goes right to left, left = larger Y
                                        startIsOnLeftSide = joinMidY > wall.start_y;
                                    }
                                }
                                
                            } else if (isAtEnd) {
                                endHas45 = true;
                                
                                // Determine which side (left or right) the joining wall is on
                                const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                                const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                                
                                // Determine which side (left or right) the joining wall is on
                                if (isVertical) {
                                    // For vertical wall, left = smaller X
                                    endIsOnLeftSide = joinMidX < wall.end_x;
                                } else {
                                    // For horizontal wall, need to check based on wall direction
                                    if (wallDirX > 0) {
                                        // Wall goes left to right, left = smaller Y
                                        endIsOnLeftSide = joinMidY < wall.end_y;
                                    } else {
                                        // Wall goes right to left, left = larger Y
                                        endIsOnLeftSide = joinMidY > wall.end_y;
                                    }
                                }
                            }
                        }
                    }
                });
                
                // Apply 45° cut shortening at each end independently
                // Shorten by the full gap distance (2 * wall thickness) to match the visual gap
                // The gap between line1 and line2 is 2 * wallThickness (each offset by wallThickness from center)
                // wallThickness is already declared above, reuse it
                const finalAdjust = wallThickness * 2; // Shorten by full gap to create seamless edge
                
                // Make copies of lines for modification
                line1 = [...line1.map(p => ({ ...p }))];
                line2 = [...line2.map(p => ({ ...p }))];
                
                // Shorten at START end
                if (startHas45) {
                    // If joining wall is on LEFT side, shorten the LEFT line
                    // If joining wall is on RIGHT side, shorten the RIGHT line
                    if (startIsOnLeftSide) {
                        // Shorten left line at start
                        if (line1IsLeft) {
                            line1[0].x += wallDirX * finalAdjust;
                            line1[0].y += wallDirY * finalAdjust;
                        } else {
                            line2[0].x += wallDirX * finalAdjust;
                            line2[0].y += wallDirY * finalAdjust;
                        }
                    } else {
                        // Shorten right line at start
                        if (line1IsLeft) {
                            line2[0].x += wallDirX * finalAdjust;
                            line2[0].y += wallDirY * finalAdjust;
                        } else {
                            line1[0].x += wallDirX * finalAdjust;
                            line1[0].y += wallDirY * finalAdjust;
                        }
                    }
                }
                
                // Shorten at END end
                if (endHas45) {
                    // If joining wall is on LEFT side, shorten the LEFT line
                    // If joining wall is on RIGHT side, shorten the RIGHT line
                    if (endIsOnLeftSide) {
                        // Shorten left line at end
                        if (line1IsLeft) {
                            line1[1].x -= wallDirX * finalAdjust;
                            line1[1].y -= wallDirY * finalAdjust;
                        } else {
                            line2[1].x -= wallDirX * finalAdjust;
                            line2[1].y -= wallDirY * finalAdjust;
                        }
                    } else {
                        // Shorten right line at end
                        if (line1IsLeft) {
                            line2[1].x -= wallDirX * finalAdjust;
                            line2[1].y -= wallDirY * finalAdjust;
                        } else {
                            line1[1].x -= wallDirX * finalAdjust;
                            line1[1].y -= wallDirY * finalAdjust;
                        }
                    }
                }

                // Store the calculated lines for wall caps
                wall._line1 = line1;
                wall._line2 = line2;

                // Draw the double-line wall with different styles for outer and inner lines
                // Draw outer face (line1) - solid line
                ctx.strokeStyle = '#333333'; // Dark gray for outer face
                ctx.lineWidth = 2;
                ctx.setLineDash([]); // Solid line for outer face
                
                ctx.beginPath();
                ctx.moveTo(
                    line1[0].x * scaleFactor.current + offsetX.current,
                    line1[0].y * scaleFactor.current + offsetY.current
                );
                ctx.lineTo(
                    line1[1].x * scaleFactor.current + offsetX.current,
                    line1[1].y * scaleFactor.current + offsetY.current
                );
                ctx.stroke();

                // Draw inner face (line2) - dashed line
                ctx.strokeStyle = '#6b7280'; // Gray color for inner face
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); // Fixed dash pattern for inner face

                ctx.beginPath();
                ctx.moveTo(
                    line2[0].x * scaleFactor.current + offsetX.current,
                    line2[0].y * scaleFactor.current + offsetY.current
                );
                ctx.lineTo(
                    line2[1].x * scaleFactor.current + offsetX.current,
                    line2[1].y * scaleFactor.current + offsetY.current
                );
                ctx.stroke();
                
                // Reset line dash
                ctx.setLineDash([]);

                // Draw wall caps - EXACT same as wall plan
                if (intersections && intersections.length > 0) {
                    // Removed 45_cut joint drawing from ceiling plan
                }

                // Reset line dash
                ctx.setLineDash([]);
            } catch (error) {
                
                // Fallback: draw simple wall line (inner face approximation)
                ctx.strokeStyle = '#6b7280';
                ctx.lineWidth = 2; // Fixed line width like wall plan
                ctx.setLineDash([8, 4]); // Fixed dash pattern
                
                // Calculate a simple inner offset for fallback
                const dx = wall.end_x - wall.start_x;
                const dy = wall.end_y - wall.start_y;
                const length = Math.sqrt(dx * dx + dy * dy);
                if (length > 0) {
                    const normalX = dy / length;
                    const normalY = -dx / length;
                    const offset = 100; // 100mm inner offset
                    
                    const innerStartX = wall.start_x + normalX * offset;
                    const innerStartY = wall.start_y + normalY * offset;
                    const innerEndX = wall.end_x + normalX * offset;
                    const innerEndY = wall.end_y + normalY * offset;
                    
                    ctx.beginPath();
                    ctx.moveTo(
                        innerStartX * scaleFactor.current + offsetX.current,
                        innerStartY * scaleFactor.current + offsetY.current
                    );
                    ctx.lineTo(
                        innerEndX * scaleFactor.current + offsetX.current,
                        innerEndY * scaleFactor.current + offsetY.current
                    );
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            }
        });
    };

    // Helper to shrink a polygon by a specific offset (in mm)
    // This creates the "Gap Mask" so panels don't touch the walls visually
    const drawCeilingPanels = (ctx, room, placedLabels = [], allLabels = []) => {
        const roomPanels = effectiveCeilingPanelsMap[room.id] || [];
        const isZoneSelectionActive = typeof selectedRoomId === 'string' && selectedRoomId.startsWith('zone-');
        const isZoneRoom = typeof room.id === 'string' && room.id.startsWith('zone-');
        if (isZoneSelectionActive && !isZoneRoom) return;

        // Calculate bounds (Standard logic)
        const localPanelBounds = roomPanels.length > 0 ? {
            minX: Math.min(...roomPanels.map(p => Math.min(p.start_x, p.end_x))),
            maxX: Math.max(...roomPanels.map(p => Math.max(p.start_x, p.end_x))),
            minY: Math.min(...roomPanels.map(p => Math.max(p.start_y, p.end_y))),
            maxY: Math.max(...roomPanels.map(p => Math.max(p.start_y, p.end_y)))
        } : null;

        const isRoomSelected = room.id === selectedRoomId;
        const isRoomMode = (!showAllRooms && selectedRoomId) || isZoneSelectionActive;
        const shouldDimPanels = isRoomMode && !isRoomSelected && !isZoneRoom;

        // --- DRAW PANELS ---
        roomPanels.forEach(panel => {
            const panelIdentifier = getPanelIdentifier(panel);
            const selectionIndex = panelIdentifier ? selectedPanelIdsList.indexOf(panelIdentifier) : -1;
            const isMultiSelectSelected = selectionIndex !== -1;
            const isPrimarySelected = normalizedSelectedPanelId && panelIdentifier === normalizedSelectedPanelId;
            const isSelected = isMultiSelectSelected || isPrimarySelected;
            
            const isCutPanel = panel.is_cut || panel.is_cut_panel;

            // --- STYLING ---
            if (isSelected) {
                const fillColors = ['rgba(37, 99, 235, 0.75)', 'rgba(249, 115, 22, 0.65)'];
                const borderColors = ['#1d4ed8', '#c2410c'];
                const highlightIndex = selectionIndex !== -1 ? selectionIndex : 0;
                ctx.fillStyle = fillColors[highlightIndex] ?? 'rgba(37, 99, 235, 0.75)';
                ctx.strokeStyle = borderColors[highlightIndex] ?? '#1d4ed8';
                ctx.lineWidth = 14 * scaleFactor.current;
            } else {
                if (isCutPanel) {
                    ctx.fillStyle = shouldDimPanels ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.5)';
                    ctx.strokeStyle = shouldDimPanels ? '#9ca3af' : '#22c55e';
                } else {
                    ctx.fillStyle = shouldDimPanels ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.5)';
                    ctx.strokeStyle = shouldDimPanels ? '#9ca3af' : '#3b82f6';
                }
                ctx.lineWidth = shouldDimPanels ? 5 * scaleFactor.current : (isRoomSelected ? 12 * scaleFactor.current : 10 * scaleFactor.current);
            }

            // === DRAWING LOGIC ===
            ctx.beginPath();

            // 1. CHECK FOR EXACT SHAPE (L-SHAPED PANEL)
            // This is the fix: If shape_points exist, draw the custom polygon
            if (panel.shape_points && Array.isArray(panel.shape_points) && panel.shape_points.length > 2) {
                const p0 = panel.shape_points[0];
                ctx.moveTo(
                    p0.x * scaleFactor.current + offsetX.current,
                    p0.y * scaleFactor.current + offsetY.current
                );
                for (let i = 1; i < panel.shape_points.length; i++) {
                    const p = panel.shape_points[i];
                    ctx.lineTo(
                        p.x * scaleFactor.current + offsetX.current,
                        p.y * scaleFactor.current + offsetY.current
                    );
                }
                ctx.closePath();
            } 
            // 2. FALLBACK TO RECTANGLE (STANDARD PANEL)
            else {
                const startX = panel.start_x ?? panel.x ?? 0;
                const startY = panel.start_y ?? panel.y ?? 0;
                const width = (panel.width) * scaleFactor.current;
                const height = (panel.length) * scaleFactor.current;
                
                const x = startX * scaleFactor.current + offsetX.current;
                const y = startY * scaleFactor.current + offsetY.current;
                
                ctx.rect(x, y, width, height);
            }

            ctx.fill();
            ctx.stroke();

            // --- CUT INDICATOR (Only for Standard Rectangles) ---
            // We skip this for L-shapes because the shape itself indicates the cut
            if (isCutPanel && (!panel.shape_points || panel.shape_points.length === 0)) {
                const startX = panel.start_x ?? panel.x ?? 0;
                const startY = panel.start_y ?? panel.y ?? 0;
                const width = (panel.width) * scaleFactor.current;
                const height = (panel.length) * scaleFactor.current;
                const x = startX * scaleFactor.current + offsetX.current;
                const y = startY * scaleFactor.current + offsetY.current;

                ctx.strokeStyle = '#22c55e';
                ctx.lineWidth = 10 * scaleFactor.current;
                ctx.setLineDash([8 * scaleFactor.current, 4 * scaleFactor.current]);
                ctx.strokeRect(x + 2, y + 2, width - 4, height - 4);
                ctx.setLineDash([]);
            }

            // --- SELECTION BADGE ---
            if (isSelected) {
                const startX = panel.start_x ?? panel.x ?? 0;
                const startY = panel.start_y ?? panel.y ?? 0;
                const width = (panel.width) * scaleFactor.current;
                const height = (panel.length) * scaleFactor.current;
                const x = startX * scaleFactor.current + offsetX.current;
                const y = startY * scaleFactor.current + offsetY.current;
                
                const highlightIndex = selectionIndex !== -1 ? selectionIndex : 0;
                const badgeColors = ['rgba(37, 99, 235, 0.9)', 'rgba(234, 88, 12, 0.9)'];
                const badgeColor = badgeColors[highlightIndex] ?? 'rgba(37, 99, 235, 0.9)';
                const textColor = '#ffffff';
                const panelLabel = panel.panel_id ?? panel.id ?? panelIdentifier ?? '';
                const displayText = `P${panelLabel}`;

                ctx.save();
                ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const textWidth = ctx.measureText(displayText).width;
                const textHeight = Math.max(16, 18 * scaleFactor.current);
                const padding = 10 * scaleFactor.current;
                const centerX = x + width / 2;
                const centerY = y + height / 2;

                ctx.fillStyle = badgeColor;
                ctx.fillRect(centerX - textWidth / 2 - padding, centerY - textHeight / 2 - padding, textWidth + padding * 2, textHeight + padding * 2);
                ctx.fillStyle = textColor;
                ctx.fillText(displayText, centerX, centerY);
                ctx.restore();
            }
        });

        // --- Supports & Dimensions ---
        if (localPanelBounds && roomPanels.length > 0) {
            drawEnhancedCeilingDimensions(ctx, room, roomPanels, modelBounds, placedLabels, allLabels);
        }
        if (enableNylonHangers) {
            drawPanelSupports(ctx, roomPanels, scaleFactor.current, offsetX.current, offsetY.current, room.id);
        }
        if (enableAluSuspension && effectiveCustomSupports.length > 0) {
            drawCustomSupports(ctx, effectiveCustomSupports, scaleFactor.current, offsetX.current, offsetY.current);
        }
        if (supportPreview && isPlacingSupport) {
            drawSupportPreview(ctx, supportPreview, scaleFactor.current, offsetX.current, offsetY.current);
        }
        if (isPlacingSupport && supportPreview && supportPreview.mousePosition && supportPreview.distances) {
            drawMousePositionDimensions(ctx, supportPreview.mousePosition, supportPreview.distances, scaleFactor.current, offsetX.current, offsetY.current);
        }
    };

    const drawZoneOutline = (ctx, zone) => {
        if (!zone) return;

        const outlinePoints = Array.isArray(zone.outline_points) && zone.outline_points.length >= 3
            ? zone.outline_points
            : (Array.isArray(zone.outlinePoints) && zone.outlinePoints.length >= 3 ? zone.outlinePoints : null);

        if (!outlinePoints) return;

        const zoneId = `zone-${zone.id}`;
        const isSelected = selectedRoomId === zoneId;
        const isHovered = hoveredRoomId === zoneId;

        ctx.save();
        ctx.beginPath();
        outlinePoints.forEach((point, index) => {
            const canvasX = point.x * scaleFactor.current + offsetX.current;
            const canvasY = point.y * scaleFactor.current + offsetY.current;
            if (index === 0) {
                ctx.moveTo(canvasX, canvasY);
            } else {
                ctx.lineTo(canvasX, canvasY);
            }
        });
        ctx.closePath();

        if (isSelected) {
            ctx.fillStyle = 'rgba(234, 88, 12, 0.25)';
            ctx.fill();
            ctx.strokeStyle = '#c2410c';
            ctx.lineWidth = 14 * scaleFactor.current;
            ctx.setLineDash([12 * scaleFactor.current, 6 * scaleFactor.current]);
        } else if (isHovered) {
            ctx.fillStyle = 'rgba(249, 115, 22, 0.15)';
            ctx.fill();
            ctx.strokeStyle = '#fb923c';
            ctx.lineWidth = 12 * scaleFactor.current;
            ctx.setLineDash([12 * scaleFactor.current, 6 * scaleFactor.current]);
        } else {
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 10 * scaleFactor.current;
            ctx.setLineDash([14 * scaleFactor.current, 6 * scaleFactor.current]);
        }

        ctx.stroke();
        ctx.restore();
    };

    const drawZones = (ctx, placedLabels, allLabels) => {
        if (!zones || zones.length === 0) return;
        zones.forEach(zone => {
            const zoneRoom = zonesAsRooms.find(room => room.zone_id === zone.id);
            if (zoneRoom) {
                drawCeilingPanels(ctx, zoneRoom, placedLabels, allLabels);
            }
            drawZoneOutline(ctx, zone);
        });
    };

    // Helper function to get room orientation from ceiling plan
    // Orientation is always available from the ceiling plan
    const getRoomOrientation = useCallback((roomId) => {
        // Normalize roomId to handle both string and number
        const normalizedRoomId = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
        
        // First, try to find in effectiveCeilingPlans
        let ceilingPlan = effectiveCeilingPlans.find(cp => {
            // Check if room is a number that matches
            if (cp.room && (cp.room === roomId || cp.room === normalizedRoomId)) return true;
            // Check if room_id matches
            if (cp.room_id && (cp.room_id === roomId || cp.room_id === normalizedRoomId)) return true;
            // Check if room is an object with an id property
            if (cp.room && typeof cp.room === 'object' && (cp.room.id === roomId || cp.room.id === normalizedRoomId)) return true;
            // Check if room is a string that matches when converted
            if (cp.room && String(cp.room) === String(roomId)) return true;
            return false;
        });
        
        // If not found in effectiveCeilingPlans, try to get from room's ceiling_plan relationship
        if (!ceilingPlan) {
            const room = effectiveRooms.find(r => (r.id === roomId || r.id === normalizedRoomId));
            if (room && room.ceiling_plan) {
                ceilingPlan = room.ceiling_plan;
                console.log(`🔍 [Orientation] Room ${roomId}: Found ceiling plan via room.ceiling_plan relationship`);
            }
        }
        
        if (ceilingPlan) {
            console.log(`🔍 [Orientation] Room ${roomId}: Found ceiling plan ${ceilingPlan.id}, orientation_strategy: "${ceilingPlan.orientation_strategy}"`);
            
            if (ceilingPlan.orientation_strategy) {
                const strategy = ceilingPlan.orientation_strategy.toLowerCase();
                // Backend stores values like 'all_horizontal', 'all_vertical', 'horizontal', 'vertical', 'auto', etc.
                // Check for both 'horizontal'/'all_horizontal' and 'vertical'/'all_vertical'
                if (strategy === 'horizontal' || strategy === 'all_horizontal') {
                    console.log(`✅ [Orientation] Room ${roomId}: Detected HORIZONTAL orientation`);
                    return true;
                }
                if (strategy === 'vertical' || strategy === 'all_vertical') {
                    console.log(`✅ [Orientation] Room ${roomId}: Detected VERTICAL orientation`);
                    return false;
                }
                console.log(`⚠️ [Orientation] Room ${roomId}: Unknown strategy "${strategy}", defaulting to VERTICAL`);
            } else {
                console.log(`⚠️ [Orientation] Room ${roomId}: No orientation_strategy found, defaulting to VERTICAL`);
            }
        } else {
            // Last resort: try to infer from panel dimensions
            const roomPanels = effectiveCeilingPanelsMap[roomId] || effectiveCeilingPanelsMap[normalizedRoomId] || [];
            if (roomPanels.length > 0) {
                const firstPanel = roomPanels[0];
                // For horizontal: width (X-axis span) > length (Y-axis, 1150mm)
                // For vertical: width (X-axis, 1150mm) < length (Y-axis span)
                const isHorizontal = firstPanel.width > firstPanel.length;
                console.log(`🔍 [Orientation] Room ${roomId}: Inferred from panel dimensions (width: ${firstPanel.width}, length: ${firstPanel.length}) - ${isHorizontal ? 'HORIZONTAL' : 'VERTICAL'}`);
                return isHorizontal;
            }
            console.log(`❌ [Orientation] Room ${roomId}: No ceiling plan found. Available plans:`, 
                effectiveCeilingPlans.map(cp => ({ id: cp.id, room: cp.room, room_id: cp.room_id }))
            );
        }
        // If orientation not found, return false (vertical) as default
        return false;
    }, [effectiveCeilingPlans, effectiveRooms, effectiveCeilingPanelsMap]);

    // Enhanced ceiling dimension drawing function
    const drawEnhancedCeilingDimensions = (ctx, room, roomPanels, roomModelBounds, placedLabels, allLabels) => {
        
        const roomWidth = Math.abs(Math.max(...room.room_points.map(p => p.x)) - Math.min(...room.room_points.map(p => p.x)));
        const roomLength = Math.abs(Math.max(...room.room_points.map(p => p.y)) - Math.min(...room.room_points.map(p => p.y)));
        
        // Calculate panel area bounds to avoid placing dimensions inside
        const panelBounds = {
            minX: Math.min(...roomPanels.map(p => p.start_x)),
            maxX: Math.max(...roomPanels.map(p => p.end_x)),
            minY: Math.min(...roomPanels.map(p => p.start_y)),
            maxY: Math.max(...roomPanels.map(p => p.end_y))
        };
        
        // Calculate individual room bounds for proper dimension positioning
        const roomBounds = {
            minX: Math.min(...room.room_points.map(p => p.x)),
            maxX: Math.max(...room.room_points.map(p => p.x)),
            minY: Math.min(...room.room_points.map(p => p.y)),
            maxY: Math.max(...room.room_points.map(p => p.y))
        };
        
        // Convert panel bounds to canvas coordinates for proper collision detection
        const canvasPanelBounds = {
            minX: panelBounds.minX * scaleFactor.current + offsetX.current,
            maxX: panelBounds.maxX * scaleFactor.current + offsetX.current,
            minY: panelBounds.minY * scaleFactor.current + offsetY.current,
            maxY: panelBounds.maxY * scaleFactor.current + offsetY.current
        };
        
        // console.log(`🔍 Panel bounds conversion:`, {
        //     model: panelBounds,
        //     canvas: canvasPanelBounds,
        //     scale: scaleFactor.current,
        //     offset: { x: offsetX.current, y: offsetY.current }
        // });
        
        // console.log(`🏠 Room bounds:`, {
        //     room: room.id,
        //     roomBounds: roomBounds,
        //     roomWidth: roomWidth,
        //     roomLength: roomLength
        // });
        
        // Draw room-level dimensions first (most important)
        // [UPDATED] Use visibilityState
        if (visibilityState.room !== false) {
            drawRoomDimensions(ctx, room, roomWidth, roomLength, roomBounds, canvasPanelBounds, placedLabels, allLabels);
        }

        // Draw panel-level dimensions
        // [UPDATED] Use visibilityState
        if (roomPanels.length > 0 && visibilityState.panel !== false) {
            // Group panels by their dimension to show grouped dimensions (EXCLUDE cut panels)
            const panelsByDimension = new Map();
            const cutPanels = roomPanels.filter(p => p.is_cut);
            
            // console.log(`🔍 Panel grouping: ${totalPanels} total, ${fullPanels.length} full, ${cutPanels.length} cut`);
            
            roomPanels.forEach(panel => {
                // Skip cut panels - they get individual dimensions later
                if (panel.is_cut) return;
                
                // Determine panel orientation based on actual dimensions:
                // - If width > length: horizontal panel
                // - If length > width: vertical panel
                const isHorizontalPanel = panel.width > panel.length;
                const isVerticalPanel = panel.length > panel.width;
                
                // Group by the appropriate dimension based on panel orientation:
                // - Horizontal panel (width > length): group by LENGTH
                // - Vertical panel (length > width): group by WIDTH
                const groupingDimension = isHorizontalPanel ? panel.length : panel.width;
                const dimensionValue = Math.round(groupingDimension * 100) / 100;
                
                if (!panelsByDimension.has(dimensionValue)) {
                    panelsByDimension.set(dimensionValue, []);
                }
                panelsByDimension.get(dimensionValue).push(panel);
            });
            
            // console.log(`🔍 Grouping results:`, Array.from(panelsByDimension.entries()).map(([dim, panels]) => 
            //     `${dim}mm: ${panels.length} panels (${panels.map(p => p.is_cut ? 'CUT' : 'FULL').join(', ')})`
            // ));
            
            // For rooms with many panels, only show grouped dimensions to avoid clutter
            const shouldShowIndividual = roomPanels.length <= 20; // Increased limit
            
            // Get orientation from ceiling plan, not from comparing dimensions
            const isHorizontalOrientation = getRoomOrientation(room.id);
            
            // Always show grouped dimensions for multiple panels with same width (width builds up the project for both orientations)
            const drawnDimensions = new Set(); // Track drawn dimensions to prevent duplicates
            const drawnPositions = new Set(); // Track drawn positions to prevent overlapping dimensions
            const drawnValuesByLevel = new Map(); // Track dimension values by level/position to prevent duplicates at same level
            // Key format: "orientation_value_level" where level is the coordinate (X for vertical lines, Y for horizontal lines)
            
            panelsByDimension.forEach((panels, dimensionValue) => {
                if (panels.length > 1) {
                    // Multiple panels with same dimension - show grouped dimension
                    
                    // Create a unique key for this dimension group to prevent exact duplicates
                    // (same dimension value, same panel count, same room)
                    const dimensionKey = `grouped_${dimensionValue}_${panels.length}_${room.id}`;
                    
                    // Check for duplicate dimension keys (same dimension value and panel count in same room)
                    if (drawnDimensions.has(dimensionKey)) {
                        console.log(`🔍 [Dimension Filter] Skipping duplicate dimension group: ${dimensionValue}mm with ${panels.length} panels in room ${room.id}`);
                        return;
                    }
                    
                    drawnDimensions.add(dimensionKey);
                    
                    // dimensionValue is now the grouped dimension based on panel orientation:
                    // - For horizontal panels (width > length): dimensionValue = panel.length
                    // - For vertical panels (length > width): dimensionValue = panel.width
                    if (!isHorizontalOrientation){
                        // Vertical room orientation: pass panels for grouped dimension drawing
                        drawGroupedPanelDimensions(ctx, panels, dimensionValue, modelBounds, canvasPanelBounds, placedLabels, allLabels, false, roomWidth, roomLength, drawnValuesByLevel);
                    } else {
                        // Horizontal room orientation: pass panels for grouped dimension drawing
                        drawGroupedPanelDimensions(ctx, panels, dimensionValue, modelBounds, canvasPanelBounds, placedLabels, allLabels, true, roomWidth, roomLength, drawnValuesByLevel);
                    }
                } else if (panels.length === 1 && shouldShowIndividual) {
                    // Single panel - show individual dimension (only if not too many panels)
                    const panel = panels[0];
                    
                    // For individual panels, determine which dimension to show and check if it matches room
                    const panelWidth = Math.round(panel.width * 100) / 100;
                    
                    // Filter: Don't show dimension if it matches room dimension
                    const DIMENSION_TOLERANCE = 1;
                    const shouldShowWidth = !(roomWidth !== null && Math.abs(panelWidth - roomWidth) <= DIMENSION_TOLERANCE);
                    
                    // Only show dimensions for full panels (not cut panels - they're handled separately)
                    if (!panel.is_cut) {
                        // Create unique key for full panel dimension (by panel ID only)
                        const fullDimensionKey = `full_${panel.id}`;
                        
                        // Check for duplicate full panel dimensions (by panel ID only)
                        // Note: Individual panels are NOT filtered by level to ensure at least one is always shown
                        // Level-based filtering only applies to grouped dimensions
                        if (drawnDimensions.has(fullDimensionKey)) return;
                        
                        drawnDimensions.add(fullDimensionKey);
                        
                        // Only show dimension if it doesn't match room dimension
                        // For horizontal panels: check width against roomWidth
                        // For vertical panels: check width against roomWidth (width is horizontal)
                        if (shouldShowWidth) {
                            // Full panel: show normal individual dimension
                            const individualDimension = {
                                startX: panel.start_x,
                                endX: panel.end_x,
                                startY: panel.start_y,
                                endY: panel.end_y,
                                dimension: panelWidth,
                                type: 'individual_panel',
                                color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                                priority: 3,
                                avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
                                quantity: 0, // Use 0 to show just the dimension without "(1 panel)"
                                panelLabel: `${panelWidth}`,
                                drawnPositions: drawnPositions,
                                roomId: room.id // Assign room ID
                            };
                            drawCeilingDimension(ctx, individualDimension, projectBounds, placedLabels, allLabels);
                        }
                    }
                }
            });
            
            // Draw cut panel dimensions with RED color (only if cut panel visibility is enabled)
            if (cutPanels.length > 0 && visibilityState.cutPanel !== false) {
                cutPanels.forEach(panel => {
                    // Determine Orientation strictly from Geometry
                    // If Width > Length, panels are running Horizontally (strips L-R)
                    // If Width < Length, panels are running Vertically (strips Top-Bottom)
                    const isHorizontal = panel.width > panel.length;
                    
                    // MATCHING FLOOR PLAN LOGIC:
                    // Horizontal Plan: Measure the Y-axis (Length) -> Draw Vertical Line
                    // Vertical Plan: Measure the X-axis (Width) -> Draw Horizontal Line
                    const dimensionValue = isHorizontal ? panel.length : panel.width;
                    
                    // Create unique key for cut panel dimension
                    const cutDimensionKey = `cut_${panel.id}`;
                    
                    if (drawnDimensions.has(cutDimensionKey)) return;
                    
                    drawnDimensions.add(cutDimensionKey);
                    
                    let cutPanelDimension;
                    
                    if (isHorizontal) {
                        // Horizontal Plan -> Draw Vertical Dimension Line (Measuring Length/Y-axis)
                        const centerX = panel.start_x + (panel.width / 2); 
                        const minY = panel.start_y;
                        const maxY = panel.start_y + panel.length;

                        cutPanelDimension = {
                            startX: centerX,
                            endX: centerX,
                            startY: minY,
                            endY: maxY,
                            dimension: dimensionValue, 
                            type: 'cut_panel',
                            color: '#dc2626',
                            priority: 4,
                            avoidArea: projectBounds,
                            quantity: 0,
                            panelLabel: `${Math.round(dimensionValue)}`,
                            drawnPositions: drawnPositions,
                            roomId: room.id,
                            isHorizontal: false, // Vertical Line
                            isCut: true
                        };
                    } else {
                        // Vertical Plan -> Draw Horizontal Dimension Line (Measuring Width/X-axis)
                        const minX = panel.start_x;
                        const maxX = panel.start_x + panel.width;
                        const centerY = panel.start_y + (panel.length / 2); 
                        
                        cutPanelDimension = {
                            startX: minX,
                            endX: maxX,
                            startY: centerY,
                            endY: centerY,
                            dimension: dimensionValue, 
                            type: 'cut_panel',
                            color: '#dc2626',
                            priority: 4,
                            avoidArea: projectBounds,
                            quantity: 0,
                            panelLabel: `${Math.round(dimensionValue)}`, 
                            drawnPositions: drawnPositions,
                            roomId: room.id,
                            isHorizontal: true, // Horizontal Line
                            isCut: true
                        };
                    }
                    
                    drawCeilingDimension(ctx, cutPanelDimension, projectBounds, placedLabels, allLabels);
                });
            }
            
            // Generate panel list for ceiling plan (like wall plan)
            const generatePanelList = () => {
                const fullPanels = roomPanels.filter(p => !p.is_cut);
                const cutPanels = roomPanels.filter(p => p.is_cut);
                
                // Get orientation from ceiling plan (once, used for both full and cut panels)
                const roomOrientation = getRoomOrientation(room.id);
                
                // Group full panels by dimension based on panel orientation:
                // - Horizontal panel (width > length): group by length
                // - Vertical panel (length > width): group by width
                const fullPanelsByDimension = new Map();
                fullPanels.forEach(panel => {
                    // Determine panel orientation
                    const isHorizontalPanel = panel.width > panel.length;
                    const groupingDimension = isHorizontalPanel ? panel.length : panel.width;
                    const dimensionValue = Math.round(groupingDimension * 100) / 100;
                    const dimensionType = isHorizontalPanel ? 'Length' : 'Width';
                    
                    // Use a composite key that includes dimension type to avoid collisions
                    const key = `${dimensionValue}_${dimensionType}`;
                    if (!fullPanelsByDimension.has(key)) {
                        fullPanelsByDimension.set(key, {
                            dimension: dimensionValue,
                            dimensionType: dimensionType,
                            panels: []
                        });
                    }
                    fullPanelsByDimension.get(key).panels.push(panel);
                });
                
                // Create panel list text
                let panelListText = `Ceiling Panels for Room ${room.id}:\n`;
                panelListText += `Total: ${roomPanels.length} panels\n`;
                panelListText += `Full Panels: ${fullPanels.length}\n`;
                panelListText += `Cut Panels: ${cutPanels.length}\n\n`;
                
                // Add grouped full panels
                fullPanelsByDimension.forEach((group) => {
                    panelListText += `${group.panels.length} × ${group.dimension}mm (${group.dimensionType})\n`;
                });
                
                // Add individual cut panels
                if (cutPanels.length > 0) {
                    panelListText += `\nCut Panels:\n`;
                    cutPanels.forEach(panel => {
                        // For cut panels, show the dimension perpendicular to panel direction
                        const dimensionValue = roomOrientation ? panel.width : panel.length;
                        const dimensionType = roomOrientation ? 'Width' : 'Length';
                        panelListText += `- ${dimensionValue}mm (${dimensionType}) - CUT\n`;
                    });
                }
                
                console.log(`📋 Panel List Generated:\n${panelListText}`);
                return panelListText;
            };
            
            // Generate and log panel list
            generatePanelList();
            
            // Panel count summary removed per user preference
        }
    };

    // Draw room-level dimensions
    const drawRoomDimensions = (ctx, room, roomWidth, roomLength, roomBounds, canvasPanelBounds, placedLabels, allLabels) => {
        const { minX, maxX, minY, maxY } = roomBounds;
        
        // Room width dimension (horizontal) - place BELOW the room, well outside panel area
        const widthDimension = {
            startX: minX,
            endX: maxX,
            startY: maxY, // Use maxY to place below the room
            endY: maxY,
            dimension: roomWidth,
            type: 'room_width',
            color: '#1e40af', // Blue for room dimensions
            priority: 1,
            avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
            drawnPositions: new Set(),
            roomId: room.id // Assign room ID
        };
        
        // Room length dimension (vertical) - place to the LEFT of the room, well outside panel area
        const lengthDimension = {
            startX: minX, // Use minX to place to the left
            endX: minX,
            startY: minY,
            endY: maxY,
            dimension: roomLength,
            type: 'room_length',
            color: '#1e40af', // Blue for room dimensions
            priority: 1,
            avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
            drawnPositions: new Set(),
            roomId: room.id // Assign room ID
        };
        
        // Draw room dimensions with optimal positioning
        drawCeilingDimension(ctx, widthDimension, projectBounds, placedLabels, allLabels);
        drawCeilingDimension(ctx, lengthDimension, projectBounds, placedLabels, allLabels);
        
    };

    // Draw grouped panel dimensions (for both horizontal and vertical panels)
    // Filter: Don't show panel dimensions that match room dimensions (similar to wall plan filtering)
    // Also filter duplicates at the same level (same position)
    const drawGroupedPanelDimensions = (ctx, panels, width, modelBounds, canvasPanelBounds, placedLabels, allLabels, isHorizontal = false, roomWidth = null, roomLength = null, drawnDimensionsByLevel = null) => {
        // Tolerance for comparing dimensions (1mm tolerance for floating point precision)
        const DIMENSION_TOLERANCE = 1;
        const LEVEL_TOLERANCE = 10; // 10mm tolerance for level matching
        
        // Helper function to check if panel dimension matches room dimension
        const matchesRoomDimension = (panelDim, roomDim) => {
            if (roomDim === null || roomDim === undefined) return false;
            return Math.abs(panelDim - roomDim) <= DIMENSION_TOLERANCE;
        };
        
        // Helper function to check if dimension already drawn at this level
        // Returns true if already drawn, false if can draw
        // Only filters duplicates at the SAME level with the SAME value
        const isDimensionDrawnAtLevel = (dimensionValue, level, isHorizontalLine) => {
            if (!drawnDimensionsByLevel) return false; // If no tracking map, allow drawing
            
            // Round level to nearest 10mm for tolerance matching (allows small variations)
            const roundedLevel = Math.round(level / LEVEL_TOLERANCE) * LEVEL_TOLERANCE;
            // Round dimension value to nearest mm for matching
            const roundedValue = Math.round(dimensionValue);
            const key = isHorizontalLine ? `H_${roundedValue}_${roundedLevel}` : `V_${roundedValue}_${roundedLevel}`;
            
            if (drawnDimensionsByLevel.has(key)) {
                console.log(`🔍 [Dimension Filter] Duplicate dimension at same level: ${dimensionValue}mm at level ${roundedLevel} (${isHorizontalLine ? 'horizontal' : 'vertical'})`);
                return true; // Already drawn at this level, skip
            }
            
            // Mark as drawn AFTER checking (will be set when we actually draw)
            return false; // Not drawn yet at this level, can draw
        };
        
        // Helper function to mark dimension as drawn at this level
        const markDimensionDrawnAtLevel = (dimensionValue, level, isHorizontalLine) => {
            if (!drawnDimensionsByLevel) return;
            
            const roundedLevel = Math.round(level / LEVEL_TOLERANCE) * LEVEL_TOLERANCE;
            const roundedValue = Math.round(dimensionValue);
            const key = isHorizontalLine ? `H_${roundedValue}_${roundedLevel}` : `V_${roundedValue}_${roundedLevel}`;
            drawnDimensionsByLevel.set(key, true);
        };
        
        // Determine panel orientation based on actual dimensions:
        // - If length > width: vertical orientation (only show width grouping)
        // - If width > length: horizontal orientation (only show length grouping)
        const panelWidth = panels[0].width;
        const panelLength = panels[0].length;
        const isVerticalPanel = panelLength > panelWidth; // Vertical: length > width
        const isHorizontalPanel = panelWidth > panelLength; // Horizontal: width > length
        
        // Find the center and bounds of the panel group
        const centerX = (Math.min(...panels.map(p => p.start_x)) + Math.max(...panels.map(p => p.end_x))) / 2;
        const centerY = (Math.min(...panels.map(p => p.start_y)) + Math.max(...panels.map(p => p.end_y))) / 2;
        const minX = Math.min(...panels.map(p => p.start_x));
        const maxX = Math.max(...panels.map(p => p.end_x));
        const minY = Math.min(...panels.map(p => p.start_y));
        const maxY = Math.max(...panels.map(p => p.end_y));
        
        if (isHorizontal) {
            // Room orientation is horizontal
            // IMPORTANT: Backend stores for horizontal orientation:
            // - panel.width = X-axis span (horizontal dimension) - this is actually the panel LENGTH
            // - panel.length = Y-axis span (vertical stacking dimension, 1150mm) - this is actually the panel WIDTH
            
            // Only show grouping dimension based on panel orientation:
            // - If horizontal panel (width > length): only show length grouping (panel.width in backend terms)
            // - If vertical panel (length > width): only show width grouping (panel.length in backend terms)
            
            if (isHorizontalPanel) {
                // Horizontal panel (width > length): only show LENGTH grouping
                // For horizontal panels, we group by panel.length (the smaller dimension, spans vertically)
                // Use the passed dimensionValue which is already the grouped dimension (panel.length)
                const panelLengthValue = width; // Use the grouped dimension value passed to this function
                // Length spans vertically, so draw a VERTICAL dimension line
                if (!matchesRoomDimension(panelLengthValue, roomLength) && !isDimensionDrawnAtLevel(panelLengthValue, centerX, false)) {
                    const lengthDimension = {
                        startX: centerX,
                        endX: centerX,
                        startY: minY,
                        endY: maxY,
                        dimension: panelLengthValue,
                        type: 'grouped_length_horizontal',
                        color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                        priority: 2,
                        avoidArea: projectBounds,
                        quantity: panels.length, // Match FloorCanvas: show quantity for grouped dimensions
                        drawnPositions: new Set(),
                        roomId: 'unknown',
                        isHorizontal: false // This dimension line is vertical (Y-axis) - measuring length
                    };
                    drawCeilingDimension(ctx, lengthDimension, projectBounds, placedLabels, allLabels);
                    // Mark as drawn AFTER drawing
                    markDimensionDrawnAtLevel(panelLengthValue, centerX, false);
                }
            } else if (isVerticalPanel) {
                // Vertical panel (length > width): only show WIDTH grouping
                // For vertical panels, we group by panel.width (the smaller dimension, spans horizontally)
                // Use the passed dimensionValue which is already the grouped dimension (panel.width)
                const panelWidthValue = width; // Use the grouped dimension value passed to this function
                // Width spans horizontally, so draw a HORIZONTAL dimension line
                if (!matchesRoomDimension(panelWidthValue, roomWidth) && !isDimensionDrawnAtLevel(panelWidthValue, centerY, true)) {
                    const widthDimension = {
                        startX: minX,
                        endX: maxX,
                        startY: centerY,
                        endY: centerY,
                        dimension: panelWidthValue,
                        type: 'grouped_width_horizontal',
                        color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                        priority: 2,
                        avoidArea: projectBounds,
                        quantity: panels.length, // Width dimensions show quantity (n × width)
                        drawnPositions: new Set(),
                        roomId: 'unknown',
                        isHorizontal: true // This dimension line is horizontal (X-axis) - measuring width
                    };
                    drawCeilingDimension(ctx, widthDimension, projectBounds, placedLabels, allLabels);
                    // Mark as drawn AFTER drawing
                    markDimensionDrawnAtLevel(panelWidthValue, centerY, true);
                }
            }
        } else {
            // Room orientation is vertical
            // IMPORTANT: For vertical orientation:
            // - panel.width (1150mm) is on X-axis (horizontal stacking dimension) - THIS IS THE GROUPING DIMENSION
            // - panel.length is on Y-axis (vertical dimension) - THIS IS THE SPAN DIMENSION
            
            // Only show grouping dimension based on panel orientation:
            // - If vertical panel (length > width): only show width grouping (panel.width)
            // - If horizontal panel (width > length): only show length grouping (panel.length)
            
            if (isVerticalPanel) {
                // Vertical panel (length > width): only show WIDTH grouping
                // For vertical panels, we group by panel.width (the smaller dimension)
                // Use the passed dimensionValue which is already the grouped dimension (panel.width)
                const actualPanelWidth = width; // Use the grouped dimension value passed to this function
                if (!matchesRoomDimension(actualPanelWidth, roomWidth) && !isDimensionDrawnAtLevel(actualPanelWidth, centerY, true)) {
                    const widthDimension = {
                        startX: minX,
                        endX: maxX,
                        startY: centerY,
                        endY: centerY,
                        dimension: actualPanelWidth,
                        type: 'grouped_width_vertical',
                        color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                        priority: 2,
                        avoidArea: projectBounds,
                        quantity: panels.length, // Width dimensions show quantity (n × width)
                        drawnPositions: new Set(),
                        roomId: 'unknown',
                        isHorizontal: true // This dimension line is horizontal (X-axis) - GROUPING DIMENSION
                    };
                    console.log(`  → Drawing GROUPING dimension (panel.width=${actualPanelWidth}mm) as HORIZONTAL line (X-axis) with quantity ${panels.length}`);
                    drawCeilingDimension(ctx, widthDimension, projectBounds, placedLabels, allLabels);
                    // Mark as drawn AFTER drawing
                    markDimensionDrawnAtLevel(actualPanelWidth, centerY, true);
                }
            } else if (isHorizontalPanel) {
                // Horizontal panel (width > length): only show LENGTH grouping
                // For horizontal panels, we group by panel.length (the smaller dimension)
                // Use the passed dimensionValue which is already the grouped dimension (panel.length)
                const actualPanelLength = width; // Use the grouped dimension value passed to this function
                if (!matchesRoomDimension(actualPanelLength, roomLength) && !isDimensionDrawnAtLevel(actualPanelLength, centerX, false)) {
                    const lengthDimension = {
                        startX: centerX,
                        endX: centerX,
                        startY: minY,
                        endY: maxY,
                        dimension: actualPanelLength,
                        type: 'grouped_length_vertical',
                        color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                        priority: 2,
                        avoidArea: projectBounds,
                        quantity: panels.length, // Match FloorCanvas: show quantity for grouped dimensions
                        drawnPositions: new Set(),
                        roomId: 'unknown',
                        isHorizontal: false // This dimension line is vertical (Y-axis) - SPAN DIMENSION
                    };
                    console.log(`  → Drawing GROUPING dimension (panel.length=${actualPanelLength}mm) as VERTICAL line (Y-axis) with quantity ${panels.length}`);
                    drawCeilingDimension(ctx, lengthDimension, projectBounds, placedLabels, allLabels);
                    // Mark as drawn AFTER drawing
                    markDimensionDrawnAtLevel(actualPanelLength, centerX, false);
                }
            }
        }
    };

    // Generate panel list for ceiling plan
    const generatePanelList = () => {
        //console.log('🔧 generatePanelList called with effectiveCeilingPanelsMap:', effectiveCeilingPanelsMap);
        
        if (!effectiveCeilingPanelsMap || Object.keys(effectiveCeilingPanelsMap).length === 0) {
            // console.log('📋 No ceiling panels found for project');
            return [];
        }

        // Collect all panels from all rooms with room context
        const allProjectPanels = [];
        Object.entries(effectiveCeilingPanelsMap).forEach(([roomId, roomPanels]) => {
            // console.log('🔧 Adding room panels:', roomPanels);
            roomPanels.forEach(panel => {
                allProjectPanels.push({ ...panel, _roomId: parseInt(roomId) });
            });
        });
        
        // console.log('🔧 Total project panels collected:', allProjectPanels.length);

        // Group panels by dimensions (width, length, thickness)
        const panelsByDimension = new Map();
        allProjectPanels.forEach(panel => {
            // Use panel thickness if available, otherwise use the current ceiling thickness setting
            const panelThickness = panel.thickness || ceilingThickness;
            // console.log('🔧 Panel thickness debug:', { 
            //     panelId: panel.id, 
            //     thickness: panel.thickness, 
            //     fallbackThickness: panelThickness,
            //     hasThickness: panel.hasOwnProperty('thickness'),
            //     thicknessType: typeof panel.thickness
            // });
            
            // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
            // Get orientation from ceiling plan using the room ID stored with the panel
            const isVertical = panel._roomId ? !getRoomOrientation(panel._roomId) : false;
            let displayWidth = panel.width;
            let displayLength = panel.length;
            
            if (isVertical) {
                // Swap values for vertical orientation
                displayWidth = panel.length;
                displayLength = panel.width;
            }
            
            const key = `${displayWidth}_${displayLength}_${panelThickness}`;
            if (!panelsByDimension.has(key)) {
                panelsByDimension.set(key, {
                    width: displayWidth,
                    length: displayLength,
                    thickness: panelThickness,
                    quantity: 0,
                    panels: []
                });
            }
            panelsByDimension.get(key).quantity++;
            panelsByDimension.get(key).panels.push(panel);
        });

        // Convert to array and sort by quantity (descending)
        const panelList = Array.from(panelsByDimension.values())
            .sort((a, b) => b.quantity - a.quantity);

        // console.log('📋 Ceiling Panel List Generated:', panelList);
        return panelList;
    };

    // Helper function to get dimension text (matches FloorCanvas formatting)
    const getDimensionText = (dimension, length, quantity) => {
        // Match FloorCanvas.js text formatting logic exactly (lines 900-908)
        if (dimension.type === 'cut_panel' || dimension.isCut) {
            // [CHANGED] Removed the (CUT) text to keep it clean (matching FloorCanvas)
            return `${Math.round(length)}`;
        } else {
            // Use dimension.quantity if available, otherwise use quantity parameter
            const qty = dimension.quantity || quantity;
            if (qty && qty > 1) {
                return `${qty} × ${Math.round(length)}`;
            } else {
                return `${Math.round(length)}`;
            }
        }
    };

    // PASS 2: Draw dimension text box (called after all lines are drawn)
    const drawDimensionTextBox = (ctx, label) => {
        ctx.save();
        
        const { x, y, width, height, text, color, labelX, labelY, isHorizontal } = label;
        
        // Draw background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(x, y, width, height);
        
        // Draw border (matching FloorCanvas)
        ctx.strokeStyle = color;
        ctx.lineWidth = DIMENSION_CONFIG.LABEL_BORDER_WIDTH;
        ctx.strokeRect(x, y, width, height);
        
        // Draw text
        ctx.fillStyle = color;
        // Calculate font size: if calculated value is below minimum, use minimum; when zooming, scale from minimum
        const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor.current;
        let fontSize;
        
        // Calculate square root scaled font size if user has zoomed in
        let sqrtScaledFontSize = 0;
        if (initialScale.current > 0 && scaleFactor.current > initialScale.current) {
            // User has zoomed in - scale from minimum using square root to reduce aggressiveness
            // This means 2x zoom only results in ~1.41x text size, not 2x
            const zoomRatio = scaleFactor.current / initialScale.current;
            sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
        }
        
        // Use the maximum of calculated and square root scaled to prevent discontinuity
        // This ensures smooth transition when crossing the minimum threshold
        if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
            // Below minimum threshold - use square root scaling if zoomed, otherwise minimum
            fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
        } else {
            // Above minimum threshold - use max of calculated and square root scaled
            // This prevents sudden drop when crossing the threshold
            fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
        }
        
        // CRITICAL: Final safety check - ensure fontSize is NEVER below minimum (8px)
        // This handles any edge cases or timing issues
        fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN);
        ctx.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
        
        if (isHorizontal) {
            // Horizontal text
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, labelX, labelY);
        } else {
            // Vertical text - rotate 90 degrees
            ctx.save();
            ctx.translate(labelX, labelY);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 0, 0);
            ctx.restore();
        }
        
        ctx.restore();
    };

    // Helper function to draw dimension lines (extension lines and dimension line)
    const drawDimensionLines = (ctx, startX, startY, endX, endY, labelX, labelY, isHorizontal, scaleFactor, offsetX, offsetY, color) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = DIMENSION_CONFIG.LINE_WIDTH;
        
        if (isHorizontal) {
            // Extension lines (vertical) - from panel boundary to dimension line
            ctx.beginPath();
            ctx.setLineDash(DIMENSION_CONFIG.EXTENSION_DASH); // Dashed lines for extensions
            
            // Extension line from start point
            ctx.moveTo(startX * scaleFactor + offsetX, startY * scaleFactor + offsetY);
            ctx.lineTo(startX * scaleFactor + offsetX, labelY);
            
            // Extension line from end point
            ctx.moveTo(endX * scaleFactor + offsetX, endY * scaleFactor + offsetY);
            ctx.lineTo(endX * scaleFactor + offsetX, labelY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Main dimension line (horizontal)
            ctx.beginPath();
            ctx.lineWidth = DIMENSION_CONFIG.DIMENSION_LINE_WIDTH;
            ctx.moveTo(startX * scaleFactor + offsetX, labelY);
            ctx.lineTo(endX * scaleFactor + offsetX, labelY);
            ctx.stroke();
            
        } else {
            // Extension lines (horizontal) - from panel boundary to dimension line
            ctx.beginPath();
            ctx.setLineDash(DIMENSION_CONFIG.EXTENSION_DASH); // Dashed lines for extensions
            
            // Extension line from start point
            ctx.moveTo(startX * scaleFactor + offsetX, startY * scaleFactor + offsetY);
            ctx.lineTo(labelX, startY * scaleFactor + offsetY);
            
            // Extension line from end point
            ctx.moveTo(endX * scaleFactor + offsetX, endY * scaleFactor + offsetY);
            ctx.lineTo(labelX, endY * scaleFactor + offsetY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Main dimension line (vertical)
            ctx.beginPath();
            ctx.lineWidth = DIMENSION_CONFIG.DIMENSION_LINE_WIDTH;
            ctx.moveTo(labelX, startY * scaleFactor + offsetY);
            ctx.lineTo(labelX, endY * scaleFactor + offsetY);
            ctx.stroke();
        }
        
        ctx.restore();
    };

    // Main ceiling dimension drawing function
    const drawCeilingDimension = (ctx, dimension, bounds, placedLabels, allLabels) => {
        const { startX, endX, startY, endY, dimension: length, type, color, priority, avoidArea, quantity } = dimension;
        const { minX, maxX, minY, maxY } = bounds;
        
        // Determine if dimension is horizontal or vertical (matching FloorCanvas)
        let isHorizontal;
        if (dimension.isHorizontal !== undefined) {
            isHorizontal = dimension.isHorizontal;
        } else {
            // Calculate from angle if not explicitly set
            const dx = endX - startX;
            const dy = endY - startY;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            isHorizontal = Math.abs(angle) < 45 || Math.abs(angle) > 135;
        }
        
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        
        // Create unique key for this dimension to remember placement decision
        const dimensionKey = `${startX.toFixed(2)}_${startY.toFixed(2)}_${endX.toFixed(2)}_${endY.toFixed(2)}_${type || 'default'}`;
        
        // Check if we have a stored placement decision for this dimension
        const storedPlacement = dimensionPlacementMemory.current.get(dimensionKey);
        const lockedSide = storedPlacement ? storedPlacement.side : null;
        
        // Determine optimal label position with smart placement
        let labelX, labelY;
        
        // For ceiling plan, always place dimensions externally (no near-wall placement)
        // Use smaller offset for bottom dimensions to place them closer
        let baseOffset = DIMENSION_CONFIG.BASE_OFFSET;
        // Check if this is a horizontal dimension that will likely be placed at bottom
        // We'll adjust this after placement is determined
        const maxAttempts = DIMENSION_CONFIG.MAX_ATTEMPTS;
        
        // Find available position to avoid overlaps - use project bounds for initial positioning
        // Calculate font size: if calculated value is below minimum, use minimum; when zooming, scale from minimum
        const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor.current;
        let fontSize;
        
        // Calculate square root scaled font size if user has zoomed in
        let sqrtScaledFontSize = 0;
        if (initialScale.current > 0 && scaleFactor.current > initialScale.current) {
            // User has zoomed in - scale from minimum using square root to reduce aggressiveness
            // This means 2x zoom only results in ~1.41x text size, not 2x
            const zoomRatio = scaleFactor.current / initialScale.current;
            sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
        }
        
        // Use the maximum of calculated and square root scaled to prevent discontinuity
        // This ensures smooth transition when crossing the minimum threshold
        if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
            // Below minimum threshold - use square root scaling if zoomed, otherwise minimum
            fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
        } else {
            // Above minimum threshold - use max of calculated and square root scaled
            // This prevents sudden drop when crossing the threshold
            fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
        }
        
        // CRITICAL: Final safety check - ensure fontSize is NEVER below minimum (8px)
        // This handles any edge cases or timing issues
        fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN);
        const dimensionFont = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
        const previousFont = ctx.font;
        ctx.font = dimensionFont;

        // Get text width first for smart placement
        const text = getDimensionText(dimension, length, quantity);
        const textWidth = ctx.measureText(text).width;
        
        // Smart placement: evaluate both sides and choose the best (or use locked side if stored)
        let placement;
        
        if (isHorizontal) {
            // Horizontal dimension: smart placement - try both top and bottom from outer bounds
            placement = smartPlacement({
                calculatePositionSide1: (offset) => {
                    // Side 1: Top (above) — always from project/avoid-area boundary
                    return {
                        labelX: midX * scaleFactor.current + offsetX.current,
                        labelY: (avoidArea ? avoidArea.minY : minY) * scaleFactor.current + offsetY.current - offset
                    };
                },
                calculatePositionSide2: (offset) => {
                    // Side 2: Bottom (below) — always from project/avoid-area boundary
                    return {
                        labelX: midX * scaleFactor.current + offsetX.current,
                        labelY: (avoidArea ? avoidArea.maxY : maxY) * scaleFactor.current + offsetY.current + offset
                    };
                },
                calculateBounds: (labelX, labelY, textWidth) => calculateHorizontalLabelBounds(labelX, labelY, textWidth, 8, 12),
                textWidth: textWidth,
                placedLabels: placedLabels,
                baseOffset: baseOffset,
                offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                maxAttempts: maxAttempts,
                preferredSide: 'side1', // Prefer top for horizontal dimensions
                lockedSide: lockedSide // Use stored side if available
            });
            
            // Adjust bottom placement to be closer - use much smaller offset for bottom dimensions
            if (placement.side === 'side2') {
                // For bottom dimensions, use a much smaller base offset (5px instead of 15px)
                // Recalculate position with smaller offset
                const bottomOffset = DIMENSION_CONFIG.BASE_OFFSET_SMALL; // 5px instead of 15px
                placement.labelY = (avoidArea ? avoidArea.maxY : maxY) * scaleFactor.current + offsetY.current + bottomOffset;
                placement.offset = bottomOffset; // Update offset for validation
            }
        } else {
            // Vertical dimension: smart placement - try both left and right from outer bounds
            const minVerticalOffset = DIMENSION_CONFIG.MIN_VERTICAL_OFFSET;
            const baseVerticalOffset = Math.max(baseOffset, minVerticalOffset);
            
            placement = smartPlacement({
                calculatePositionSide1: (offset) => {
                    // Side 1: Left — always from project/avoid-area boundary
                    return {
                        labelX: (avoidArea ? avoidArea.minX : minX) * scaleFactor.current + offsetX.current - offset,
                        labelY: midY * scaleFactor.current + offsetY.current
                    };
                },
                calculatePositionSide2: (offset) => {
                    // Side 2: Right — always from project/avoid-area boundary
                    return {
                        labelX: (avoidArea ? avoidArea.maxX : maxX) * scaleFactor.current + offsetX.current + offset,
                        labelY: midY * scaleFactor.current + offsetY.current
                    };
                },
                calculateBounds: (labelX, labelY, textWidth) => calculateVerticalLabelBounds(labelX, labelY, textWidth, 8, 12),
                textWidth: textWidth,
                placedLabels: placedLabels,
                baseOffset: baseVerticalOffset,
                offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                maxAttempts: maxAttempts,
                preferredSide: 'side2', // Prefer right for vertical dimensions
                lockedSide: lockedSide // Use stored side if available
            });
        }
        
        // Store the placement decision for future renders (to prevent position changes on zoom)
        if (!storedPlacement) {
            dimensionPlacementMemory.current.set(dimensionKey, { side: placement.side });
        }
        
        labelX = placement.labelX;
        labelY = placement.labelY;
        
        // console.log(`🎨 Dimension label positioning for ${type}:`, {
        //     dimension: { startX, endX, startY, endY, length },
        //     isHorizontal,
        //     midX, midY,
        //     offset,
        //     scaleFactor: scaleFactor.current,
        //     canvasOffset: { x: offsetX.current, y: offsetY.current },
        //     calculatedPosition: { labelX, labelY }
        // });
        
        // Enhanced validation: ensure entire label bounds are outside project area
        // (text and textWidth already declared above for smart placement)
        if (avoidArea) {
            let labelBounds;
            let labelModelBounds;
            let overlapsAvoidArea = true;
            let validationAttempts = 0;
            const maxValidationAttempts = 10;
            const minSeparation = 5; // Minimum separation in pixels
            // Track offset starting from placement offset, incrementing by fixed amount (like wall plan)
            // Use smaller initial offset for bottom dimensions
            const isBottomDimension = isHorizontal && placement.side === 'side2';
            let validationOffset = isBottomDimension ? DIMENSION_CONFIG.BASE_OFFSET_SMALL : (placement.offset || baseOffset);
            
            while (overlapsAvoidArea && validationAttempts < maxValidationAttempts) {
                // Calculate label bounds in canvas coordinates
                // Increased padding to ensure text fits within bounds
                if (isHorizontal) {
                    labelBounds = {
                        x: labelX - textWidth / 2 - 8,
                        y: labelY - 12,
                        width: textWidth + 16,
                        height: 24
                    };
                } else {
                    labelBounds = {
                        x: labelX - 12,
                        y: labelY - textWidth / 2 - 8,
                        width: 24,
                        height: textWidth + 16
                    };
                }
                
                // Convert label bounds to model coordinates for comparison
                labelModelBounds = {
                    minX: (labelBounds.x - offsetX.current) / scaleFactor.current,
                    maxX: (labelBounds.x + labelBounds.width - offsetX.current) / scaleFactor.current,
                    minY: (labelBounds.y - offsetY.current) / scaleFactor.current,
                    maxY: (labelBounds.y + labelBounds.height - offsetY.current) / scaleFactor.current
                };
                
                // Check if label bounds overlap with avoid area (with minimum separation)
                const separation = minSeparation / scaleFactor.current;
                const overlapsProjectArea = !(
                    labelModelBounds.maxX < avoidArea.minX - separation ||
                    labelModelBounds.minX > avoidArea.maxX + separation ||
                    labelModelBounds.maxY < avoidArea.minY - separation ||
                    labelModelBounds.minY > avoidArea.maxY + separation
                );
                
                // ALSO check collision with other placed labels (room names, other dimensions)
                // This is critical for bottom dimensions which often overlap with each other
                const overlapsOtherLabels = hasLabelOverlap(labelBounds, placedLabels, 5);
                
                overlapsAvoidArea = overlapsProjectArea || overlapsOtherLabels;
                
                if (overlapsAvoidArea) {
                    // Force placement further out if overlapping project area or other labels
                    // Use smaller increment for bottom dimensions to prevent excessive spacing
                    const isBottomPlacement = isHorizontal && placement.side === 'side2';
                    const increment = isBottomPlacement ? 10 : DIMENSION_CONFIG.OFFSET_INCREMENT; // Smaller increment for bottom (10px vs 20px)
                    validationOffset += increment;
                    
                    if (isHorizontal) {
                        const projectMidY = (avoidArea.minY + avoidArea.maxY) / 2;
                        const isTopHalf = midY < projectMidY;
                        
                        // Move using fixed increment (consistent with wall plan and floor plan)
                        if (isTopHalf) {
                            labelY = avoidArea.minY * scaleFactor.current + offsetY.current - validationOffset;
                        } else {
                            labelY = avoidArea.maxY * scaleFactor.current + offsetY.current + validationOffset;
                        }
                    } else {
                        const projectMidX = (avoidArea.minX + avoidArea.maxX) / 2;
                        const isLeftHalf = midX < projectMidX;
                        
                        // Move using fixed increment (consistent with wall plan and floor plan)
                        if (isLeftHalf) {
                            labelX = avoidArea.minX * scaleFactor.current + offsetX.current - validationOffset;
                        } else {
                            labelX = avoidArea.maxX * scaleFactor.current + offsetX.current + validationOffset;
                        }
                    }
                    validationAttempts++;
                }
            }
        }
        
        // Final label bounds
        // Increased padding to ensure text fits within bounds
        let finalLabelBounds;
        if (isHorizontal) {
            finalLabelBounds = {
                x: labelX - textWidth / 2 - 8,
                y: labelY - 12,
                width: textWidth + 16,
                height: 24
            };
        } else {
            finalLabelBounds = {
                x: labelX - 12,
                y: labelY - textWidth / 2 - 8,
                width: 24,
                height: textWidth + 16
            };
        }
        
        // Final collision check: ensure dimension doesn't overlap with any existing text (room names, other dimensions)
        // This is a safety check in case smartPlacement didn't catch everything
        if (hasLabelOverlap(finalLabelBounds, placedLabels, 5)) {
            // If there's still a collision, try to adjust position slightly
            // This handles edge cases where bounds calculation might have slight differences
            const adjustment = 15; // pixels to move away from collision
            if (isHorizontal) {
                // Try moving up or down
                const testBounds1 = { ...finalLabelBounds, y: finalLabelBounds.y - adjustment };
                const testBounds2 = { ...finalLabelBounds, y: finalLabelBounds.y + adjustment };
                if (!hasLabelOverlap(testBounds1, placedLabels, 5)) {
                    finalLabelBounds = testBounds1;
                    labelY -= adjustment;
                } else if (!hasLabelOverlap(testBounds2, placedLabels, 5)) {
                    finalLabelBounds = testBounds2;
                    labelY += adjustment;
                }
            } else {
                // Try moving left or right
                const testBounds1 = { ...finalLabelBounds, x: finalLabelBounds.x - adjustment };
                const testBounds2 = { ...finalLabelBounds, x: finalLabelBounds.x + adjustment };
                if (!hasLabelOverlap(testBounds1, placedLabels, 5)) {
                    finalLabelBounds = testBounds1;
                    labelX -= adjustment;
                } else if (!hasLabelOverlap(testBounds2, placedLabels, 5)) {
                    finalLabelBounds = testBounds2;
                    labelX += adjustment;
                }
            }
        }
        
        // PASS 1: Draw dimension lines FIRST (bottom layer)
        drawDimensionLines(ctx, startX, startY, endX, endY, labelX, labelY, isHorizontal, scaleFactor.current, offsetX.current, offsetY.current, color);
        
        // Add to placed labels for collision detection
        // Verify bounds are valid before adding
        if (isFinite(finalLabelBounds.x) && isFinite(finalLabelBounds.y) && 
            isFinite(finalLabelBounds.width) && isFinite(finalLabelBounds.height) &&
            finalLabelBounds.width > 0 && finalLabelBounds.height > 0) {
            placedLabels.push({
                x: finalLabelBounds.x,
                y: finalLabelBounds.y,
                width: finalLabelBounds.width,
                height: finalLabelBounds.height,
                text: text,
                type: type
            });
        }
        
        // Add to all labels for global tracking AND deferred text drawing (PASS 2)
        allLabels.push({
            x: finalLabelBounds.x,
            y: finalLabelBounds.y,
            width: finalLabelBounds.width,
            height: finalLabelBounds.height,
            text: text,
            type: type,
            color: color,
            labelX: labelX,
            labelY: labelY,
            isHorizontal: isHorizontal
        });

        ctx.font = previousFont;
        
        // console.log(`✅ Dimension drawn successfully:`, {
        //     type,
        //     priority,
        //     text,
        //     position: { x: finalLabelBounds.x, y: finalLabelBounds.y },
        //     isHorizontal,
        //     angle: angle.toFixed(1),
        //     roomId: dimension.roomId || 'unknown'
        // });
        
        // Validate final position is within canvas bounds
        const isValidPosition = finalLabelBounds.x >= 0 && 
                               finalLabelBounds.y >= 0 && 
                               finalLabelBounds.x + finalLabelBounds.width <= CANVAS_WIDTH && 
                               finalLabelBounds.y + finalLabelBounds.height <= CANVAS_HEIGHT;
        
        if (!isValidPosition) {
            // console.log(`⚠️ Dimension ${type} position invalid, skipping:`, finalLabelBounds);
            return; // Skip drawing this dimension
        }
        
        ctx.restore();
    };

    // Draw title and information
    const drawTitle = (ctx) => {
        // Match floor plan style: left-aligned at top
        ctx.fillStyle = '#374151';
        ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Ceiling Plan', 20, 20);
        
        // Draw scale info (matching floor plan position)
        ctx.font = `${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.fillText(`Scale: ${currentScale.toFixed(2)}x`, 20, 50);
    };

    // Mouse event handlers
    const handleMouseDown = (e) => {
        // Check if we should start canvas dragging (when not placing supports)
        if (!isPlacingSupport) {
            isDraggingCanvas.current = true;
            hasUserPositionedView.current = true; // Mark that user has positioned the view
            lastCanvasMousePos.current = { x: e.clientX, y: e.clientY };
            e.preventDefault();
            return;
        }
        
        // Otherwise, handle support dragging (existing functionality)
        isDragging.current = true;
        const rect = canvasRef.current.getBoundingClientRect();
        lastMousePos.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    // Handle mouse move for hover detection
    const handleMouseMoveHover = (e) => {
        // Disable room hover when aluminum suspension custom drawing is enabled
        if (aluSuspensionCustomDrawing) {
            return;
        }
        
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Convert to model coordinates
        const modelX = (mouseX - offsetX.current) / scaleFactor.current;
        const modelY = (mouseY - offsetY.current) / scaleFactor.current;
        
        // Zones have priority for hover detection
        let hoveredZone = null;
        if (zonesAsRooms && zonesAsRooms.length > 0) {
            for (const zoneRoom of zonesAsRooms) {
                if (zoneRoom.room_points && zoneRoom.room_points.length >= 3) {
                    if (isPointInPolygon(modelX, modelY, zoneRoom.room_points)) {
                        hoveredZone = zoneRoom;
                        break;
                    }
                }
            }
        }

        // Rooms are only considered when no zone is hovered
        let hoveredRoom = null;
        if (!hoveredZone) {
            for (const room of effectiveRooms) {
                if (room.room_points && room.room_points.length >= 3) {
                    if (isPointInPolygon(modelX, modelY, room.room_points)) {
                        hoveredRoom = room;
                        break;
                    }
                }
            }
        }
        
        const newHoverId = hoveredZone ? hoveredZone.id : (hoveredRoom ? hoveredRoom.id : null);
        const hadHover = Boolean(hoveredRoomId);

        if (newHoverId !== hoveredRoomId) {
            if (newHoverId) {
                setHoveredRoomId(newHoverId);
                canvasRef.current.style.cursor = 'pointer';
            } else {
                setHoveredRoomId(null);
                canvasRef.current.style.cursor = aluSuspensionCustomDrawing ? 'crosshair' : 'grab';
            }

            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                drawCanvas(ctx);
            }
        } else if (!newHoverId && hadHover) {
            setHoveredRoomId(null);
            canvasRef.current.style.cursor = aluSuspensionCustomDrawing ? 'crosshair' : 'grab';
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                drawCanvas(ctx);
            }
        }
    };

    // Check if point is inside polygon (for room hover detection)
    const isPointInPolygon = (x, y, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if (((polygon[i].y > y) !== (polygon[j].y > y)) &&
                (x < (polygon[j].x - polygon[i].x) * (y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                inside = !inside;
            }
        }
        return inside;
    };

    const handleMouseMove = (e) => {
        // Handle canvas dragging first
        if (isDraggingCanvas.current) {
            const deltaX = e.clientX - lastCanvasMousePos.current.x;
            const deltaY = e.clientY - lastCanvasMousePos.current.y;
            
            offsetX.current += deltaX;
            offsetY.current += deltaY;
            
            lastCanvasMousePos.current = { x: e.clientX, y: e.clientY };
            
            // Redraw canvas
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                drawCanvas(ctx);
            }
            return;
        }
        
        // Handle support dragging (existing functionality)
        if (!isDragging.current) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        const deltaX = currentX - lastMousePos.current.x;
        const deltaY = currentY - lastMousePos.current.y;
        
        offsetX.current += deltaX;
        offsetY.current += deltaY;
        
        lastMousePos.current = { x: currentX, y: currentY };
        
        // Redraw
        const ctx = canvasRef.current.getContext('2d');
        drawCanvas(ctx);
    };

    // Handle mouse move for support preview with 90-degree snapping
    const handleMouseMoveSupport = (e) => {
        if (!isPlacingSupport || !supportStartPoint) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        // Convert to model coordinates
        let modelX = (currentX - offsetX.current) / scaleFactor.current;
        let modelY = (currentY - offsetY.current) / scaleFactor.current;
        
        // Apply 90-degree snapping
        const snappedCoords = snapTo90Degrees(supportStartPoint.x, supportStartPoint.y, modelX, modelY);
        
        setSupportPreview({
            startX: supportStartPoint.x,
            startY: supportStartPoint.y,
            endX: snappedCoords.x,
            endY: snappedCoords.y,
            originalEndX: modelX,
            originalEndY: modelY,
            isSnapped: snappedCoords.isSnapped
        });
        
        // Calculate distances to project edges
        if (projectData) {
            const distances = calculateDistancesToEdges(snappedCoords.x, snappedCoords.y);
            setSupportPreview(prev => ({
                ...prev,
                distances: distances
            }));
        }
        
        // Redraw to show preview
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            drawCanvas(ctx);
        }
    };

    // Snap coordinates to 90-degree angles (horizontal/vertical)
    const snapTo90Degrees = (startX, startY, endX, endY) => {
        const deltaX = Math.abs(endX - startX);
        const deltaY = Math.abs(endY - startY);
        
        // Snap threshold: if one direction is much smaller than the other, snap to that direction
        const snapThreshold = 0.3; // 30% threshold for snapping
        
        if (deltaX < deltaY * snapThreshold) {
            // Snap to vertical line (same X coordinate)
            return {
                x: startX,
                y: endY,
                isSnapped: 'vertical'
            };
        } else if (deltaY < deltaX * snapThreshold) {
            // Snap to horizontal line (same Y coordinate)
            return {
                x: endX,
                y: startY,
                isSnapped: 'horizontal'
            };
        } else {
            // No snapping - free line
            return {
                x: endX,
                y: endY,
                isSnapped: false
            };
        }
    };

    // Handle mouse move for dimension display (only when placing support)
    const handleMouseMoveDimensions = (e) => {
        // Only calculate dimensions when placing support
        if (!isPlacingSupport) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        // Convert to model coordinates
        let modelX = (currentX - offsetX.current) / scaleFactor.current;
        let modelY = (currentY - offsetY.current) / scaleFactor.current;
        
        // Apply boundary snapping to keep mouse within project bounds
        if (projectData) {
            const snapThreshold = 100; // 100mm threshold for snapping
            
            // Snap to left edge
            if (modelX < snapThreshold) {
                modelX = 0;
            }
            // Snap to right edge
            if (modelX > projectData.width - snapThreshold) {
                modelX = projectData.width;
            }
            // Snap to top edge
            if (modelY < snapThreshold) {
                modelY = 0;
            }
            // Snap to bottom edge
            if (modelY > projectData.length - snapThreshold) {
                modelY = projectData.length;
            }
        }
        
        // Calculate distances to project edges
        if (projectData) {
            const distances = calculateDistancesToEdges(modelX, modelY);
            setSupportPreview(prev => ({
                ...prev,
                mousePosition: { x: modelX, y: modelY },
                distances: distances
            }));
        }
        
        // Redraw to show dimensions
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            drawCanvas(ctx);
        }
    };

    // Calculate distances from point to project edges
    const calculateDistancesToEdges = (x, y) => {
        if (!projectData) return null;
        
        const distances = {
            left: x - 0, // Distance to left edge (x = 0)
            right: projectData.width - x, // Distance to right edge
            top: y - 0, // Distance to top edge (y = 0)
            bottom: projectData.length - y // Distance to bottom edge
        };
        
        return distances;
    };

    // Calculate if panels need support based on current panel data
    const calculatePanelsNeedSupport = useMemo(() => {
        if (!effectiveCeilingPanelsMap || Object.keys(effectiveCeilingPanelsMap).length === 0) {
            return false;
        }

        // Determine panel orientation from ceiling plan (use first room's orientation)
        let isHorizontalOrientation = false;
        for (const roomId in effectiveCeilingPanelsMap) {
            const roomPanels = effectiveCeilingPanelsMap[roomId];
            if (roomPanels && roomPanels.length > 0) {
                isHorizontalOrientation = getRoomOrientation(parseInt(roomId));
                break;
            }
        }

        // Check if any panels need support
        for (const roomId in effectiveCeilingPanelsMap) {
            const roomPanels = effectiveCeilingPanelsMap[roomId];
            if (roomPanels) {
                for (const panel of roomPanels) {
                    const needsSupport = isHorizontalOrientation ? 
                        panel.width > 6000 :  // Horizontal: check width
                        panel.length > 6000;  // Vertical: check length
                    
                    if (needsSupport) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }, [effectiveCeilingPanelsMap]);

    const handleMouseUp = () => {
        isDragging.current = false;
        isDraggingCanvas.current = false;
    };

    // Canvas dragging functions
    const handleCanvasMouseDown = (e) => {
        // Only start dragging if not placing supports
        if (isPlacingSupport) return;
        
        isDraggingCanvas.current = true;
        lastCanvasMousePos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    };

    const handleCanvasMouseUp = () => {
        isDraggingCanvas.current = false;
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

    // Zoom functions
    const handleZoomIn = () => {
        console.log('🔍 Zoom In clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        console.log('Current currentScale state:', currentScale);
        
        const newScale = Math.min(3.0, scaleFactor.current * 1.2);
        console.log('Calculated new scale:', newScale);
        
        zoomAtCurrentView(newScale);
    };

    const handleZoomOut = () => {
        console.log('🔍 Zoom Out clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        console.log('Current currentScale state:', currentScale);
        console.log('Initial scale:', initialScale.current);
        
        // Use the initial scale as the minimum instead of hardcoded 0.1
        const newScale = Math.max(initialScale.current, scaleFactor.current * 0.8);
        console.log('Calculated new scale:', newScale);
        
        zoomAtCurrentView(newScale);
    };

    const handleResetZoom = () => {
        console.log('Reset Zoom clicked, resetting zoom flag');
        isZoomed.current = false; // Reset zoom flag so calculateCanvasTransform can set optimal scale
        hasUserPositionedView.current = false; // Reset user positioning flag
        calculateCanvasTransform();
        // Redraw after transform calculation
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
        drawCanvas(ctx);
        }
    };

    // Zoom to center of canvas
    const zoomToCenter = (newScale) => {
        
        const canvasCenterX = CANVAS_WIDTH / 2;
        const canvasCenterY = CANVAS_HEIGHT / 2;
        
        const scaleRatio = newScale / scaleFactor.current;
        
        offsetX.current = canvasCenterX - (canvasCenterX - offsetX.current) * scaleRatio;
        offsetY.current = canvasCenterY - (canvasCenterY - offsetY.current) * scaleRatio;
        
        // Update the scale factor FIRST
        scaleFactor.current = newScale;
        // Mark that user has manually zoomed
        isZoomed.current = true;
        
        // Update the state
        setCurrentScale(newScale);
        
        // Redraw
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            console.log('Got canvas context, clearing and redrawing...');
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            drawCanvas(ctx);
        } else {
            //console.error('❌ Could not get canvas context!');
        }
    };

    // Zoom at current view position (keeps the point under mouse stationary)
    const zoomAtCurrentView = (newScale) => {
        // Calculate the current view center in model coordinates
        const viewCenterX = CANVAS_WIDTH / 2;
        const viewCenterY = CANVAS_HEIGHT / 2;
        
        // Convert view center to model coordinates
        const modelCenterX = (viewCenterX - offsetX.current) / scaleFactor.current;
        const modelCenterY = (viewCenterY - offsetY.current) / scaleFactor.current;
        
        // Calculate scale ratio
        const scaleRatio = newScale / scaleFactor.current;
        
        // Calculate new offset to keep the model center point stationary
        offsetX.current = viewCenterX - modelCenterX * newScale;
        offsetY.current = viewCenterY - modelCenterY * newScale;
        
        // Update the scale factor FIRST
        scaleFactor.current = newScale;
        isZoomed.current = true; // Mark as manually zoomed
        hasUserPositionedView.current = true; // Mark that user has positioned the view
        
        // Update state to trigger re-render
        setCurrentScale(newScale);
        
        // Redraw canvas
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            console.log('Got canvas context, clearing and redrawing...');
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            drawCanvas(ctx);
        } else {
            //console.error('❌ Could not get canvas context!');
        }
    };

    // Panel click detection and custom support placement
    const handleCanvasClick = (e) => {
        // Don't handle clicks if we were dragging the canvas
        if (isDraggingCanvas.current) {
            return;
        }
        
        const rect = canvasRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Convert to model coordinates
        const modelX = (clickX - offsetX.current) / scaleFactor.current;
        const modelY = (clickY - offsetY.current) / scaleFactor.current;
        
        // Check if clicked on a merged ceiling zone first
        let clickedZone = null;
        if (zonesAsRooms && zonesAsRooms.length > 0) {
            for (const zoneRoom of zonesAsRooms) {
                if (zoneRoom.room_points && zoneRoom.room_points.length >= 3) {
                    if (isPointInPolygon(modelX, modelY, zoneRoom.room_points)) {
                        clickedZone = zoneRoom;
                        break;
                    }
                }
            }
        }

        // Check if clicked on a room (only if no zone was clicked)
        let clickedRoom = null;
        if (!clickedZone) {
            for (const room of effectiveRooms) {
                if (room.room_points && room.room_points.length >= 3) {
                    if (isPointInPolygon(modelX, modelY, room.room_points)) {
                        clickedRoom = room;
                        break;
                    }
                }
            }
        }

        // Check if clicked directly on a panel (for priority logic)
        let clickedPanel = null;
        let clickedPanelRoom = null;
        let clickedPanelZone = null;
        if (!(enableAluSuspension && isPlacingSupport)) {
            // Check panels in regular rooms
            for (let i = 0; i < effectiveRooms.length; i++) {
                const room = effectiveRooms[i];
                const roomPanels = effectiveCeilingPanelsMap[room.id] || [];
                
                for (let j = 0; j < roomPanels.length; j++) {
                    const panel = roomPanels[j];
                    const panelIdentifier = getPanelIdentifier(panel);
                    const startX = panel.start_x ?? panel.x ?? 0;
                    const startY = panel.start_y ?? panel.y ?? 0;
                    const endX = panel.end_x ?? (panel.width !== undefined ? startX + panel.width : panel.x_end ?? startX);
                    const endY = panel.end_y ?? (panel.length !== undefined ? startY + panel.length : panel.y_end ?? startY);
                    const panelWidthRaw = panel.width ?? Math.abs(endX - startX);
                    const panelLengthRaw = panel.length ?? Math.abs(endY - startY);
                    const x = startX * scaleFactor.current + offsetX.current;
                    const y = startY * scaleFactor.current + offsetY.current;
                    const width = panelWidthRaw * scaleFactor.current;
                    const height = panelLengthRaw * scaleFactor.current;
                    
                    if (panelIdentifier && clickX >= x && clickX <= x + width && clickY >= y && clickY <= y + height) {
                        clickedPanel = panelIdentifier;
                        clickedPanelRoom = room;
                        break;
                    }
                }
                if (clickedPanel) break;
            }
    
            // Check panels in zones
            if (!clickedPanel && zonesAsRooms && zonesAsRooms.length > 0) {
                for (const zoneRoom of zonesAsRooms) {
                    const zonePanels = effectiveCeilingPanelsMap[zoneRoom.id] || zoneRoom.ceiling_panels || [];
                    
                    for (const panel of zonePanels) {
                        const panelIdentifier = getPanelIdentifier(panel);
                        const startX = panel.start_x ?? panel.x ?? 0;
                        const startY = panel.start_y ?? panel.y ?? 0;
                        const endX = panel.end_x ?? (panel.width !== undefined ? startX + panel.width : panel.x_end ?? startX);
                        const endY = panel.end_y ?? (panel.length !== undefined ? startY + panel.length : panel.y_end ?? startY);
                        const panelWidthRaw = panel.width ?? Math.abs(endX - startX);
                        const panelLengthRaw = panel.length ?? Math.abs(endY - startY);
                        const x = startX * scaleFactor.current + offsetX.current;
                        const y = startY * scaleFactor.current + offsetY.current;
                        const width = panelWidthRaw * scaleFactor.current;
                        const height = panelLengthRaw * scaleFactor.current;
                        
                        if (panelIdentifier && clickX >= x && clickX <= x + width && clickY >= y && clickY <= y + (height || (panelLengthRaw || 0) * scaleFactor.current)) {
                            clickedPanel = panelIdentifier;
                            clickedPanelZone = zoneRoom;
                            break;
                        }
                    }
                    if (clickedPanel) break;
                }
            }
        }

        // If aluminum suspension custom drawing is enabled, disable room selection entirely
        if (aluSuspensionCustomDrawing) {
            // Room selection is disabled when aluminum suspension drawing is active
            // Only handle support placement logic below
        } else {
            // Check if a room/zone is currently selected
            const isRoomSelected = selectedRoomId !== null && selectedRoomId !== undefined;
            const selectedRoomIdStr = selectedRoomId ? selectedRoomId.toString() : null;
            const isZoneSelected = selectedRoomIdStr && selectedRoomIdStr.startsWith('zone-');
            
            // Determine which room/zone the clicked panel belongs to
            const clickedPanelBelongsToRoomId = clickedPanelRoom ? clickedPanelRoom.id.toString() : null;
            const clickedPanelBelongsToZoneId = clickedPanelZone ? clickedPanelZone.id.toString() : null;
            const clickedPanelBelongsToZoneIdFormatted = clickedPanelZone ? `zone-${clickedPanelZone.id}` : null;
            
            // Check if clicked panel is in the currently selected room/zone
            // Handle both numeric ID and "zone-{id}" format for comparison
            const isPanelInSelectedRoom = isRoomSelected && clickedPanel && (
                // Panel in a zone and zone is selected (check both formats)
                (clickedPanelBelongsToZoneIdFormatted && (
                    clickedPanelBelongsToZoneIdFormatted === selectedRoomIdStr ||
                    clickedPanelBelongsToZoneId === selectedRoomIdStr
                )) ||
                // Panel in a room and room is selected
                (clickedPanelBelongsToRoomId && clickedPanelBelongsToRoomId === selectedRoomIdStr)
            );
            
            // PRIORITY 1: If a room is already selected AND user clicks on a panel in that room, select the panel
            if (isRoomSelected && isPanelInSelectedRoom && clickedPanel) {
                onPanelSelect?.(clickedPanel);
                return;
            }
            
            // PRIORITY 2: If NO room is selected, clicking in a room/zone selects the room (even if clicking on panel)
            if (!isRoomSelected) {
                // If clicked on a zone, select the zone (even if also clicked on a panel)
                if (clickedZone && onRoomSelect) {
                    onPanelSelect?.(null);
                    onRoomSelect(clickedZone.id);
                    return;
                }

                // If clicked on a room, select it (even if also clicked on a panel)
                if (clickedRoom && onRoomSelect) {
                    onPanelSelect?.(null);
                    onRoomSelect(clickedRoom.id);
                    return;
                }
            } else {
                // PRIORITY 3: If a room IS selected, allow selecting a different room/zone
                // If clicked on a different zone, select that zone
                if (clickedZone && onRoomSelect) {
                    const clickedZoneId = clickedZone.id.toString();
                    const clickedZoneIdFormatted = `zone-${clickedZone.id}`;
                    // Check if it's a different zone (handle both ID formats)
                    const isDifferentZone = clickedZoneId !== selectedRoomIdStr && 
                                           clickedZoneIdFormatted !== selectedRoomIdStr &&
                                           (!isZoneSelected || clickedZoneId !== selectedRoomIdStr.replace('zone-', ''));
                    if (isDifferentZone) {
                        onPanelSelect?.(null);
                        onRoomSelect(clickedZone.id);
                        return;
                    }
                }

                // If clicked on a different room, select that room
                if (clickedRoom && onRoomSelect) {
                    const clickedRoomId = clickedRoom.id.toString();
                    if (clickedRoomId !== selectedRoomIdStr) {
                        onPanelSelect?.(null);
                        onRoomSelect(clickedRoom.id);
                        return;
                    }
                }
            }
            
            // PRIORITY 4: If clicked on empty space (not on a room/zone/panel) and not placing support, deselect room
            if (!clickedRoom && !clickedZone && !clickedPanel && !isPlacingSupport && onRoomDeselect) {
                onRoomDeselect();
                return;
            }
            
            // If clicked on panel but not in selected room, deselect panel (room selection takes priority)
            if (clickedPanel && !isPanelInSelectedRoom) {
                onPanelSelect?.(null);
            }
        }
        
        // If custom support placement mode is active, handle support placement
        if (enableAluSuspension && isPlacingSupport) {
            
            // Apply boundary snapping for support placement
            let snappedModelX = modelX;
            let snappedModelY = modelY;
            if (projectData) {
                const snapThreshold = 100; // 100mm threshold for snapping
                
                // Snap to left edge
                if (snappedModelX < snapThreshold) {
                    snappedModelX = 0;
                }
                // Snap to right edge
                if (snappedModelX > projectData.width - snapThreshold) {
                    snappedModelX = projectData.width;
                }
                // Snap to top edge
                if (snappedModelY < snapThreshold) {
                    snappedModelY = 0;
                }
                // Snap to bottom edge
                if (snappedModelY > projectData.length - snapThreshold) {
                    snappedModelY = projectData.length;
                }
            }
            
            if (!supportStartPoint) {
                // First click - set start point
                setSupportStartPoint({ x: snappedModelX, y: snappedModelY });
                setSupportPreview({ startX: snappedModelX, startY: snappedModelY, endX: snappedModelX, endY: snappedModelY });
            } else {
                // Second click - finish support line and place supports on intersecting panels
                // Apply 90-degree snapping to ensure straight lines
                const snappedCoords = snapTo90Degrees(supportStartPoint.x, supportStartPoint.y, snappedModelX, snappedModelY);
                const finalEndX = snappedCoords.x;
                const finalEndY = snappedCoords.y;
                
                const intersectingPanels = findIntersectingPanels(
                    supportStartPoint.x, supportStartPoint.y, finalEndX, finalEndY
                );
                
                // Create supports at each intersection point along the line
                const newSupports = [];
                
                intersectingPanels.forEach(panel => {
                    panel.intersections.forEach(intersection => {
                        newSupports.push({
                            id: Date.now() + Math.random(), // Unique ID
                            start_x: intersection.x,
                            start_y: intersection.y,
                            width: 50, // Small support size
                            length: 50,
                            type: supportType,
                            x: intersection.x,
                            y: intersection.y,
                            supportLine: {
                                startX: supportStartPoint.x,
                                startY: supportStartPoint.y,
                                endX: finalEndX,
                                endY: finalEndY,
                                isSnapped: snappedCoords.isSnapped
                            },
                            isIntersectionPoint: true
                        });
                    });
                });
                
                updateCustomSupports([...effectiveCustomSupports, ...newSupports]);
                
                // Reset placement state - auto-disable drawing mode after placing support
                setSupportStartPoint(null);
                setSupportPreview(null);
                setIsPlacingSupport(false);
                // Note: aluSuspensionCustomDrawing stays enabled so supports remain visible, but drawing mode is off
                
                // Redraw canvas
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                    drawCanvas(ctx);
                }
            }
            return;
        }
        // Clicked on empty space, deselect
        onPanelSelect?.(null);
    };

    // Support visualization functions
    const drawNylonHanger = (ctx, panel, scaleFactor, offsetX, offsetY) => {
        // Calculate panel center using the same transformation as drawCeilingPanels
        const startX = panel.start_x ?? panel.x ?? 0;
        const startY = panel.start_y ?? panel.y ?? 0;
        
        const x = startX * scaleFactor + offsetX;
        const y = startY * scaleFactor + offsetY;
        const width = (panel.width ?? 0) * scaleFactor;
        const height = (panel.length ?? 0) * scaleFactor;
        
        // Calculate center of the transformed panel
        const canvasX = x + width / 2;
        const canvasY = y + height / 2;
        
        // 1. Draw Main Circle (Hanger)
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 75 * scaleFactor, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ef4444'; // Changed to Red for better visibility (optional)
        ctx.lineWidth = 30 * scaleFactor; 
        ctx.stroke();
        
        // 2. Draw Accessories (If enabled) - NOW SOLID LINE
        if (nylonHangerOptions && nylonHangerOptions.includeAccessories) {
            ctx.beginPath();
            ctx.arc(canvasX, canvasY, 45 * scaleFactor, 0, 2 * Math.PI);
            ctx.strokeStyle = '#f59e0b'; // Orange
            ctx.lineWidth = 2 * scaleFactor;
            // Removed ctx.setLineDash to make it solid
            ctx.stroke();
        }
        
        // 3. Draw Cable (If enabled)
        if (nylonHangerOptions && nylonHangerOptions.includeCable) {
            ctx.beginPath();
            ctx.moveTo(canvasX, canvasY + 35 * scaleFactor);
            ctx.lineTo(canvasX, canvasY + 60 * scaleFactor);
            ctx.strokeStyle = '#10b981'; // Green
            ctx.lineWidth = 3 * scaleFactor;
            ctx.stroke();
        }
    };

    const drawAluSuspension = (ctx, panel, scaleFactor, offsetX, offsetY) => {
        // Calculate panel center using the same transformation as drawCeilingPanels
        const x = panel.start_x * scaleFactor + offsetX;
        const y = panel.start_y * scaleFactor + offsetY;
        const width = panel.width * scaleFactor;
        const height = panel.length * scaleFactor;
        
        // Calculate center of the transformed panel
        const canvasX = x + width / 2;
        const canvasY = y + height / 2;
        
        // Draw support line - made bigger
        const lineLength = 50 * scaleFactor; // Increased from 30 to 50
        ctx.beginPath();
        ctx.moveTo(canvasX - lineLength / 2, canvasY);
        ctx.lineTo(canvasX + lineLength / 2, canvasY);
        ctx.strokeStyle = '#8b5cf6'; // Purple
        ctx.lineWidth = 5 * scaleFactor; // Increased from 3 to 5
        ctx.stroke();
        
        // Draw * symbol at panel center - made bigger
        ctx.fillStyle = '#8b5cf6';
        ctx.font = `bold ${Math.max(16, 30 * scaleFactor)}px Arial`; // Increased from 14 to 20
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('*', canvasX, canvasY);
        
        // Draw squares at start and end - made bigger
        const squareSize = 25 * scaleFactor; // Increased from 6 to 10
        ctx.fillStyle = '#8b5cf6';
        
        // Start square
        ctx.fillRect(canvasX - lineLength / 2 - squareSize / 2, canvasY - squareSize / 2, squareSize, squareSize);
        
        // End square
        ctx.fillRect(canvasX + lineLength / 2 - squareSize / 2, canvasY - squareSize / 2, squareSize, squareSize);
    };



    const drawPanelSupports = (ctx, roomPanels, scaleFactor, offsetX, offsetY, roomId) => {
        // Robust Support Logic:
        // We don't care about the room orientation flag.
        // We simply check if the PANEL is long enough to need support.
        
        console.log(`🔧 Drawing panel supports for room ${roomId}: ${roomPanels.length} panels`);
        
        roomPanels.forEach(panel => {
            // Determine the physical long dimension
            // Some panels might have width > length (Horizontal), some length > width (Vertical)
            const physicalLength = Math.max(panel.width, panel.length);
            
            // Threshold for support (e.g. 6000mm)
            const NEEDS_SUPPORT_THRESHOLD = 6000;
            const needsSupport = physicalLength > NEEDS_SUPPORT_THRESHOLD;
            
            if (needsSupport) {
                // Determine orientation for drawing the line
                // If width is the long side, the panel is horizontal -> Draw vertical support lines? 
                // Wait, support usually runs perpendicular to the long span, or parallel?
                // Standard: Support hangs the long span.
                // Nylon Hanger usually runs ALONG the center of the long span.
                
                // Let's pass the orientation derived from dimensions to the drawer
                const isHorizontalShape = panel.width > panel.length;
                
                if (enableNylonHangers) {
                    drawNylonHanger(ctx, panel, scaleFactor, offsetX, offsetY, isHorizontalShape);
                }
            }
        });
    };

    // Draw custom supports placed by user
    const drawCustomSupports = (ctx, supports, scaleFactor, offsetX, offsetY) => {
        supports.forEach(support => {
            if (support.isIntersectionPoint) {
                // Draw * symbol at intersection points - clear and visible
                const x = support.x * scaleFactor + offsetX;
                const y = support.y * scaleFactor + offsetY;
                
                // Draw * symbol - bigger and bolder for better visibility
                ctx.fillStyle = '#7c3aed'; // Darker purple for better visibility
                ctx.font = `bold ${Math.max(18, 24 * scaleFactor)}px Arial`; // Increased size from 12-16 to 18-24
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('*', x, y);
            } else {
                // Draw regular supports
                if (support.type === 'alu') {
                    drawAluSuspension(ctx, support, scaleFactor, offsetX, offsetY);
                } else if (support.type === 'nylon') {
                    drawNylonHanger(ctx, support, scaleFactor, offsetX, offsetY);
                }
            }
        });
    };

    // Find panels that intersect with a line segment and get intersection points
    const findIntersectingPanels = (startX, startY, endX, endY) => {
        const intersectingPanels = [];
        
        Object.values(effectiveCeilingPanelsMap).forEach(roomPanels => {
            roomPanels.forEach(panel => {
                // Check if panel intersects with the support line
                if (lineIntersectsRectangle(startX, startY, endX, endY, 
                    panel.start_x, panel.start_y, 
                    panel.end_x, panel.end_y)) {
                    
                    // Get intersection points with panel edges
                    const intersections = getLinePanelIntersections(startX, startY, endX, endY, panel);
                    
                    intersectingPanels.push({
                        ...panel,
                        intersections: intersections
                    });
                }
            });
        });
        
        return intersectingPanels;
    };

    // Get intersection points of a line with panel edges
    const getLinePanelIntersections = (lineStartX, lineStartY, lineEndX, lineEndY, panel) => {
        const intersections = [];
        
        // Panel boundaries
        const panelLeft = panel.start_x;
        const panelRight = panel.end_x;
        const panelTop = panel.start_y;
        const panelBottom = panel.end_y;
        
        // Panel edges as line segments
        const edges = [
            { x1: panelLeft, y1: panelTop, x2: panelRight, y2: panelTop },     // Top edge
            { x1: panelRight, y1: panelTop, x2: panelRight, y2: panelBottom }, // Right edge
            { x1: panelRight, y1: panelBottom, x2: panelLeft, y2: panelBottom }, // Bottom edge
            { x1: panelLeft, y1: panelBottom, x2: panelLeft, y2: panelTop }    // Left edge
        ];
        
        edges.forEach(edge => {
            const intersection = getLineIntersection(
                lineStartX, lineStartY, lineEndX, lineEndY,
                edge.x1, edge.y1, edge.x2, edge.y2
            );
            
            if (intersection) {
                intersections.push({
                    x: intersection.x,
                    y: intersection.y,
                    edge: edge
                });
            }
        });
        
        return intersections;
    };

    // Get intersection point of two line segments
    const getLineIntersection = (x1, y1, x2, y2, x3, y3, x4, y4) => {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (Math.abs(denom) < 0.001) return null; // Lines are parallel or very close
        
        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
        
        if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
            return {
                x: x1 + ua * (x2 - x1),
                y: y1 + ua * (y2 - y1)
            };
        }
        
        return null;
    };

    // Check if a line intersects with a rectangle
    const lineIntersectsRectangle = (x1, y1, x2, y2, rectX1, rectY1, rectX2, rectY2) => {
        // Ensure rectX1 < rectX2 and rectY1 < rectY2
        const minX = Math.min(rectX1, rectX2);
        const maxX = Math.max(rectX1, rectX2);
        const minY = Math.min(rectY1, rectY2);
        const maxY = Math.max(rectY1, rectY2);
        
        // Check if line segment intersects with rectangle
        // Using line-rectangle intersection algorithm
        const left = minX;
        const right = maxX;
        const top = minY;
        const bottom = maxY;
        
        // Check if any of the line endpoints are inside the rectangle
        if (x1 >= left && x1 <= right && y1 >= top && y1 <= bottom) return true;
        if (x2 >= left && x2 <= right && y2 >= top && y2 <= bottom) return true;
        
        // Check if line intersects with any of the rectangle edges
        const edges = [
            { x1: left, y1: top, x2: right, y2: top },     // Top edge
            { x1: right, y1: top, x2: right, y2: bottom }, // Right edge
            { x1: right, y1: bottom, x2: left, y2: bottom }, // Bottom edge
            { x1: left, y1: bottom, x2: left, y2: top }    // Left edge
        ];
        
        for (const edge of edges) {
            if (linesIntersect(x1, y1, x2, y2, edge.x1, edge.y1, edge.x2, edge.y2)) {
                return true;
            }
        }
        
        return false;
    };

    // Check if two line segments intersect
    const linesIntersect = (x1, y1, x2, y2, x3, y3, x4, y4) => {
        const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
        if (denom === 0) return false; // Lines are parallel
        
        const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
        const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
        
        return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
    };

    // Draw support preview line
    const drawSupportPreview = (ctx, preview, scaleFactor, offsetX, offsetY) => {
        const startX = preview.startX * scaleFactor + offsetX;
        const startY = preview.startY * scaleFactor + offsetY;
        const endX = preview.endX * scaleFactor + offsetX;
        const endY = preview.endY * scaleFactor + offsetY;
        
        // Draw preview line
        ctx.strokeStyle = '#f59e0b'; // Orange color for preview
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]); // Dashed line for preview
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        
        // Reset line dash
        ctx.setLineDash([]);
        
        // Draw start point marker
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(startX, startY, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        // Draw end point marker
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(endX, endY, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        // Show snapping indicator if line is snapped
        if (preview.isSnapped) {
            ctx.fillStyle = '#10b981'; // Green for snapped lines
            ctx.font = `bold ${Math.max(12, 14 * scaleFactor)}px 'Segoe UI', Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;
            
            // Add background for better readability
            const text = preview.isSnapped === 'horizontal' ? 'H' : 'V';
            const textWidth = ctx.measureText(text).width;
            const padding = 4;
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(midX - textWidth/2 - padding, midY - 8 - padding, textWidth + padding*2, 16 + padding*2);
            
            ctx.fillStyle = '#10b981';
            ctx.fillText(text, midX, midY);
        }
        
        // Draw dimensions to project edges if available
        if (preview.distances) {
            const mouseX = endX;
            const mouseY = endY;
            
            // Draw distance to left edge
            if (preview.distances.left > 0) {
                drawDistanceDimension(ctx, 0, mouseY, mouseX, mouseY, 
                    Math.round(preview.distances.left), 'left', scaleFactor, offsetX, offsetY);
            }
            
            // Draw distance to right edge
            if (preview.distances.right > 0) {
                const rightEdgeX = projectData.width * scaleFactor + offsetX;
                drawDistanceDimension(ctx, mouseX, mouseY, rightEdgeX, mouseY, 
                    Math.round(preview.distances.right), 'right', scaleFactor, offsetX, offsetY);
            }
            
            // Draw distance to top edge
            if (preview.distances.top > 0) {
                drawDistanceDimension(ctx, mouseX, 0, mouseX, mouseY, 
                    Math.round(preview.distances.top), 'top', scaleFactor, offsetX, offsetY);
            }
            
            // Draw distance to bottom edge
            if (preview.distances.bottom > 0) {
                const bottomEdgeY = projectData.length * scaleFactor + offsetY;
                drawDistanceDimension(ctx, mouseX, mouseY, mouseX, bottomEdgeY, 
                    Math.round(preview.distances.bottom), 'bottom', scaleFactor, offsetX, offsetY);
            }
        }
    };

    // Draw distance dimension line
    const drawDistanceDimension = (ctx, x1, y1, x2, y2, distance, edge, scaleFactor, offsetX, offsetY) => {
        const canvasX1 = x1 * scaleFactor + offsetX;
        const canvasY1 = y1 * scaleFactor + offsetY;
        const canvasX2 = x2 * scaleFactor + offsetX;
        const canvasY2 = y2 * scaleFactor + offsetY;
        
        // Draw dimension line
        ctx.strokeStyle = '#10b981'; // Green for distance dimensions
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        
        ctx.beginPath();
        ctx.moveTo(canvasX1, canvasY1);
        ctx.lineTo(canvasX2, canvasY2);
        ctx.stroke();
        
        ctx.setLineDash([]);
        
        // Draw distance label
        const midX = (canvasX1 + canvasX2) / 2;
        const midY = (canvasY1 + canvasY2) / 2;
        
        ctx.fillStyle = '#10b981';
        ctx.font = `bold ${Math.max(10, 12 * scaleFactor)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Add background for better readability
        const text = `${distance}`;
        const textWidth = ctx.measureText(text).width;
        const padding = 4;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(midX - textWidth/2 - padding, midY - 8 - padding, textWidth + padding*2, 16 + padding*2);
        
        ctx.fillStyle = '#10b981';
        ctx.fillText(text, midX, midY);
    };

    // Draw mouse position dimensions (always visible)
    const drawMousePositionDimensions = (ctx, mousePos, distances, scaleFactor, offsetX, offsetY) => {
        const mouseX = mousePos.x * scaleFactor + offsetX;
        const mouseY = mousePos.y * scaleFactor + offsetY;
        
        // Draw distance to left edge
        if (distances.left > 0) {
            drawDistanceDimension(ctx, 0, mousePos.y, mousePos.x, mousePos.y, 
                Math.round(distances.left), 'left', scaleFactor, offsetX, offsetY);
        }
        
        // Draw distance to right edge
        if (distances.right > 0) {
            const rightEdgeX = projectData.width;
            drawDistanceDimension(ctx, mousePos.x, mousePos.y, rightEdgeX, mousePos.y, 
                Math.round(distances.right), 'right', scaleFactor, offsetX, offsetY);
        }
        
        // Draw distance to top edge
        if (distances.top > 0) {
            drawDistanceDimension(ctx, mousePos.x, 0, mousePos.x, mousePos.y, 
                Math.round(distances.top), 'top', scaleFactor, offsetX, offsetY);
        }
        
        // Draw distance to bottom edge
        if (distances.bottom > 0) {
            const bottomEdgeY = projectData.length;
            drawDistanceDimension(ctx, mousePos.x, mousePos.y, mousePos.x, bottomEdgeY, 
                Math.round(distances.bottom), 'bottom', scaleFactor, offsetX, offsetY);
        }
        
        // Draw mouse position indicator
        ctx.fillStyle = '#ef4444'; // Red dot for mouse position
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 4, 0, 2 * Math.PI);
        ctx.fill();
    };

    const zonesAsRooms = useMemo(() => {
        if (!zones || zones.length === 0) return [];
        const clone = zones.map(zone => zone);
        clone.sort((a, b) => (a.id || 0) - (b.id || 0));
        return clone
            .map(zone => {
                const outlinePoints = Array.isArray(zone.outline_points) && zone.outline_points.length >= 3
                    ? zone.outline_points
                    : (Array.isArray(zone.outlinePoints) && zone.outlinePoints.length >= 3 ? zone.outlinePoints : null);

                return {
                    zone,
                    outlinePoints
                };
            })
            .filter(entry => entry.outlinePoints)
            .map(entry => {
                const { zone, outlinePoints } = entry;
                const roomName = zone.room_ids && zone.room_ids.length
                    ? `Zone ${zone.id} (${zone.room_ids.length} rooms)`
                    : `Zone ${zone.id}`;
                return {
                    id: `zone-${zone.id}`,
                    zone_id: zone.id,
                    room_name: roomName,
                    room_points: outlinePoints,
                    ceiling_panels: zone.ceiling_panels || []
                };
            });
    }, [zones]);

    return (
        <div className="ceiling-canvas-container bg-white rounded-xl shadow-lg p-6">
            {/* Header */}
            <div className="ceiling-canvas-header mb-6">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-2">
                            Ceiling Plan
                        </h3>
                        <p className="text-gray-600 text-lg">
                            {showAllRooms ? 
                                `All Rooms (${effectiveRooms.length}) - Professional Layout` :
                                `${effectiveRooms.length > 0 ? effectiveRooms[0]?.room_name || 'Room' : 'Room'} - Professional Layout`
                            }
                        </p>
                    </div>
                    {ceilingPlan && (
                        <div className="text-right">
                            <div className="text-sm text-gray-500 mb-1">Plan Summary</div>
                            <div className="text-2xl font-bold text-blue-600">
                                {showAllRooms ? 
                                    `${getAccuratePanelCounts.total} Panels` :
                                    `${Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => sum + (panels ? panels.length : 0), 0)} Panels`
                                }
                            </div>
                        </div>
                    )}
                </div>
                

                

            </div>

            <div className="flex gap-6 min-w-0 w-full max-w-full">
                {/* Canvas Container */}
                <div className="ceiling-canvas-wrapper flex-1 min-w-0">
                    <div
                        ref={canvasContainerRef}
                        className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg relative"
                        style={{
                            height: `${CANVAS_HEIGHT}px`,
                            minHeight: `${MIN_CANVAS_HEIGHT}px`
                        }}
                    >
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

                        <canvas
                            ref={canvasRef}
                            data-plan-type="ceiling"
                            className={`ceiling-canvas block w-full ${
                                !isPlacingSupport ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
                            }`}
                            style={{
                                width: '100%',
                                height: '100%'
                            }}
                            onMouseDown={handleMouseDown}
                            onMouseMove={(e) => {
                                handleMouseMove(e);
                                handleMouseMoveHover(e);
                                handleMouseMoveSupport(e);
                                handleMouseMoveDimensions(e);
                            }}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onClick={handleCanvasClick}
                        />
                    </div>
                    
                    {/* Canvas Controls */}
                    <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                                            <div className="flex items-center gap-4">
                        <span className="font-medium">Scale:</span>
                        <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                            {currentScale.toFixed(2)}x
                        </span>
                    </div>
                    <div className="text-center">
                        <span className="font-medium">Click room to select, then click panel • Drag to pan • Use zoom buttons</span>
                    </div>
                    {enableAluSuspension && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => {
                                    setIsPlacingSupport(!isPlacingSupport);
                                    // Reset if canceling
                                    if (isPlacingSupport) {
                                        setSupportStartPoint(null);
                                        setSupportPreview(null);
                                    }
                                }}
                                className={`px-3 py-1 text-sm rounded transition-colors ${
                                    isPlacingSupport 
                                        ? 'bg-red-500 text-white hover:bg-red-600' 
                                        : 'bg-blue-500 text-white hover:bg-blue-600'
                                }`}
                            >
                                {isPlacingSupport ? 'Cancel Drawing' : 'Draw Support Line'}
                            </button>
                            <button
                                onClick={() => {
                                    updateCustomSupports([]);
                                    const ctx = canvasRef.current.getContext('2d');
                                    if (ctx) drawCanvas(ctx);
                                }}
                                className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                                title="Clear all custom supports"
                            >
                                Clear Supports
                            </button>
                            {isPlacingSupport && (
                                <span className="text-sm text-blue-600 font-medium">
                                    {!supportStartPoint 
                                        ? `Click to start {supportType} support line` 
                                        : `Click to finish {supportType} support line`
                                    }
                                </span>
                            )}
                            {effectiveCustomSupports.length > 0 && (
                                <span className="text-sm text-gray-600">
                                    {effectiveCustomSupports.length} custom support{effectiveCustomSupports.length !== 1 ? 's' : ''} placed
                                </span>
                            )}
                        </div>
                    )}
                    </div>
                    

                </div>

                {/* Summary Sidebar */}
                <div className="ceiling-summary-sidebar flex-shrink min-w-0 max-w-64">
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl p-6 w-full max-w-64 shadow-lg">
                        <h4 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
                            <svg className="w-6 h-6 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            Plan Details
                        </h4>
                        
                        {ceilingPlan && (
                            <div className="space-y-6">
                                {/* Ceiling Plan Dashboard */}
                                <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                                    <h5 className="font-semibold text-gray-900 mb-4 flex items-center">
                                        <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                        </svg>
                                        Ceiling Plan
                                    </h5>
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Total Panels:</span>
                                            <span className="font-bold text-gray-900">{getAccuratePanelCounts.total}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Full Panels:</span>
                                            <span className="font-bold text-green-600">
                                                {getAccuratePanelCounts.full}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Cut Panels:</span>
                                            <span className="font-bold text-orange-600">
                                                {getAccuratePanelCounts.cut}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Rooms:</span>
                                            <span className="font-bold text-blue-600">{effectiveRooms.length}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Waste %:</span>
                                            <span className="font-bold text-red-600">
                                                {(() => {
                                                    console.log('🔍 [UI] Displaying project-wide waste percentage...');
                                                    console.log('🔍 [UI] projectWastePercentage (prop):', projectWastePercentage);
                                                    console.log('🔍 [UI] ceilingPlan:', ceilingPlan);
                                                    
                                                    // 1) Prefer the latest project-wide waste provided by manager (from POST)
                                                    if (projectWastePercentage !== undefined && projectWastePercentage !== null) {
                                                        return Number(projectWastePercentage).toFixed(1);
                                                    }
                                                    
                                                    // 2) Fallback to value embedded in the plan object if present
                                                    if (ceilingPlan?.summary?.project_waste_percentage !== undefined && ceilingPlan?.summary?.project_waste_percentage !== null) {
                                                        return ceilingPlan.summary.project_waste_percentage.toFixed(1);
                                                    }
                                                    
                                                    // 3) Legacy fallback for older responses
                                                    if (ceilingPlan?.waste_percentage !== undefined && ceilingPlan?.waste_percentage !== null) {
                                                        return ceilingPlan.waste_percentage.toFixed(1);
                                                    }
                                                    
                                                    return '0.0';
                                                })()}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Recommended:</span>
                                            <span className="font-bold text-green-600">
                                                {(() => {
                                                    // Get recommended strategy from system analysis (NOT current selection)
                                                    // Priority: Use the system's recommendation, never use strategy_used
                                                    const recommended = ceilingPlan?.summary?.recommended_strategy || 
                                                                      ceilingPlan?.orientation_analysis?.recommended_strategy ||
                                                                      ceilingPlan?.recommended_strategy ||
                                                                      'auto';
                                                    
                                                    console.log('🎯 [UI] System Recommended Strategy:', recommended);
                                                    console.log('🎯 [UI] Currently Selected Strategy:', ceilingPlan?.strategy_used);
                                                    
                                                    // Format strategy name for display
                                                    const formatStrategy = (strategy) => {
                                                        if (!strategy) return 'Auto';
                                                        
                                                        const strategyMap = {
                                                            'all_horizontal': 'Horizontal',
                                                            'all_vertical': 'Vertical',
                                                            'room_optimal': 'Room Optimal',
                                                            'project_merged': 'Project Merged',
                                                            'auto': 'Auto'
                                                        };
                                                        
                                                        return strategyMap[strategy] || strategy
                                                            .split('_')
                                                            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                                            .join(' ');
                                                    };
                                                    
                                                    return formatStrategy(recommended);
                                                })()}
                                            </span>
                                        </div>
                                        {calculatePanelsNeedSupport ? (
                                            <>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-gray-600">Support Type:</span>
                                                    <span className="font-bold text-indigo-600 capitalize">{supportType}</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-gray-600">Panels Needing Support:</span>
                                                    <span className="font-bold text-amber-600">
                                                        {(() => {
                                                            // Get orientation from ceiling plan (orientation is always available)
                                                            const isHorizontalOrientation = effectiveRooms.length > 0 && 
                                                                effectiveRooms[0] ? getRoomOrientation(effectiveRooms[0].id) : false;
                                                            
                                                            if (ceilingPlan && ceilingPlan.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                                                                return ceilingPlan.enhanced_panels.filter(p => 
                                                                    isHorizontalOrientation ? p.width > 6000 : p.length > 6000
                                                                ).length;
                                                            }
                                                            return Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => 
                                                                sum + (panels ? panels.filter(p => 
                                                                    isHorizontalOrientation ? p.width > 6000 : p.length > 6000
                                                                ).length : 0), 0
                                                            );
                                                        })()}
                                                    </span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-600">Support Status:</span>
                                                <span className="font-bold text-green-600">Not Required</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Canvas Information */}
                                <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                                    <h5 className="font-semibold text-gray-900 mb-4 flex items-center">
                                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                        Canvas Information
                                    </h5>
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-600">Current Scale:</span>
                                            <span className="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                                {currentScale.toFixed(2)}x
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-500 text-center bg-gray-50 p-3 rounded">
                                            💡 <strong>Tip:</strong> Use the zoom buttons on the canvas to adjust view
                                        </div>
                                    </div>
                                </div>

                                {/* Dimension Legend & Filter (Updated to match FloorCanvas) */}
                                <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                                    <h5 className="font-semibold text-gray-900 mb-4 flex items-center">
                                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        Dimension Legend
                                    </h5>
                                    
                                    <div className="space-y-3 text-sm">
                                        {/* Room Dimensions - Toggleable */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center">
                                                <div className="w-4 h-4 bg-blue-600 rounded mr-3"></div>
                                                <span className="text-gray-700">Room Dimensions</span>
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={visibilityState.room !== false}
                                                onChange={(e) => setVisibilityState(prev => ({ ...prev, room: e.target.checked }))}
                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                                title="Toggle Room Dimensions"
                                            />
                                        </div>

                                        {/* Panel Dimensions - Toggleable */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center">
                                                <div className="w-4 h-4 bg-gray-600 rounded mr-3"></div>
                                                <span className="text-gray-700">Panel Dimensions</span>
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={visibilityState.panel !== false}
                                                onChange={(e) => setVisibilityState(prev => ({ ...prev, panel: e.target.checked }))}
                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                                title="Toggle Panel Dimensions"
                                            />
                                        </div>

                                        {/* Cut Dimensions - Toggleable */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center">
                                                <div className="w-4 h-4 bg-red-600 rounded mr-3"></div>
                                                <span className="text-gray-700">Cut Dimensions</span>
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={visibilityState.cutPanel !== false} 
                                                onChange={(e) => setVisibilityState(prev => ({ ...prev, cutPanel: e.target.checked }))}
                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                                title="Toggle Cut Panel Dimensions"
                                            />
                                        </div>
                                        
                                        {/* Divider */}
                                        <div className="border-t border-gray-100 my-2"></div>

                                        {/* Static Legend Items */}
                                        <div className="flex items-center">
                                            <div className="w-4 h-4 bg-gray-800 rounded mr-3"></div>
                                            <span className="text-gray-700">Walls (Outer Face)</span>
                                        </div>
                                        <div className="flex items-center">
                                            <div className="w-4 h-4 border-2 border-gray-600 border-dashed mr-3"></div>
                                            <span className="text-gray-700">Walls (Inner Face)</span>
                                        </div>
                                        
                                        {calculatePanelsNeedSupport && (
                                            <>
                                                {supportType === 'nylon' && (
                                                    <div className="flex items-center">
                                                        <div className="w-4 h-4 bg-blue-500 rounded mr-3"></div>
                                                        <span className="text-gray-700">Nylon Hanger Support</span>
                                                    </div>
                                                )}
                                                {supportType === 'alu' && (
                                                    <div className="flex items-center">
                                                        <div className="w-4 h-4 bg-purple-500 rounded mr-3"></div>
                                                        <span className="text-gray-700">Alu Suspension Support</span>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Panel Table Section */}
            <div className="mt-6 p-4 bg-white rounded-lg shadow-md border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">Ceiling Panel List</h3>
                    <button
                        onClick={() => setShowPanelTable(!showPanelTable)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                        {showPanelTable ? 'Hide Panel Table' : 'Show Panel Table'}
                    </button>
                </div>

                {showPanelTable && (
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-300">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Panel Width (mm)
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Panel Length (mm)
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Thickness (mm)
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Quantity
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {generatePanelList().map((panel, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {panel.width}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {panel.length}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {panel.thickness}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                            {panel.quantity}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        
                        {generatePanelList().length === 0 && (
                            <div className="text-center py-8 text-gray-500">
                                No ceiling panels found. Generate a ceiling plan first.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CeilingCanvas;