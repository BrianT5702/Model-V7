import React, { useRef, useEffect, useMemo, useState } from 'react';
import { calculateOffsetPoints } from './drawing.js';
import { DIMENSION_CONFIG } from './DimensionConfig.js';
import { hasLabelOverlap, calculateHorizontalLabelBounds, calculateVerticalLabelBounds, smartPlacement } from './collisionDetection.js';

const DEFAULT_CANVAS_WIDTH = 1000;
const DEFAULT_CANVAS_HEIGHT = 650;
const CANVAS_ASPECT_RATIO = DEFAULT_CANVAS_HEIGHT / DEFAULT_CANVAS_WIDTH;
// Increase canvas height ratio on mobile for better visibility
const MAX_CANVAS_HEIGHT_RATIO = typeof window !== 'undefined' && window.innerWidth < 640 ? 0.85 : 0.7;
// Mobile-friendly minimum sizes - smaller for phones, larger for tablets/desktop
const MIN_CANVAS_WIDTH = 320; 
const MIN_CANVAS_HEIGHT = 240; 
const PADDING = 50;

const FloorCanvas = ({ 
    rooms, 
    walls, 
    intersections, 
    floorPlan, 
    floorPanels, 
    projectData, 
    floorPanelsMap,
    orientationAnalysis,
    projectWastePercentage = null,
    // [UPDATED] Default prop includes cutPanel
    dimensionVisibility = { room: true, panel: true, cutPanel: false },
    // Slab size (mm) for slab floor estimation - default 1210 x 3000
    slabWidth = 1210,
    slabLength = 3000,
    onSlabWidthChange = null,
    onSlabLengthChange = null
}) => {
    const canvasRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const [canvasSize, setCanvasSize] = useState({
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    });
    const [currentScale, setCurrentScale] = useState(1);
    
    // [NEW] Local state for checkboxes
    const [visibilityState, setVisibilityState] = useState({
        room: true,
        panel: true,
        cutPanel: false, // <--- EXPLICITLY FALSE INITIALLY
        ...dimensionVisibility
    });

    // [NEW] Sync with props if they change
    useEffect(() => {
        setVisibilityState(prev => ({
            ...prev,
            ...dimensionVisibility
        }));
    }, [dimensionVisibility]);
    
    // Canvas state refs
    const scaleFactor = useRef(1);
    const initialScale = useRef(1); // Track the initial scale
    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const isDragging = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const isZoomed = useRef(false); // Track if user has manually zoomed
    
    // Canvas dragging state (separate from other dragging)
    const isDraggingCanvas = useRef(false);
    const lastCanvasMousePos = useRef({ x: 0, y: 0 });
    
    // Store placement decisions for dimensions to prevent position changes on zoom
    const dimensionPlacementMemory = useRef(new Map());
    // Track which dimension VALUES (in mm) have already been drawn in this floor plan (match ceiling behavior)
    const dimensionValuesSeen = useRef(new Set());

    // Create a Lookup Map for Room Strategies to "know" orientation
    const roomStrategies = useMemo(() => {
        const map = {};
        if (floorPlan?.floor_plans) {
            floorPlan.floor_plans.forEach(plan => {
                map[plan.room_id] = plan.orientation_strategy;
            });
        }
        return map;
    }, [floorPlan]);

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
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', handleWindowResize);
        }

        return () => {
            if (observer) {
                observer.disconnect();
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', handleWindowResize);
            }
        };
    }, []);

    // Canvas dimensions
    const CANVAS_WIDTH = Math.round(canvasSize.width);
    const CANVAS_HEIGHT = Math.round(canvasSize.height);

    // Calculate project bounds for dimension positioning
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

    // Calculate model bounds for dimension positioning
    const modelBounds = useMemo(() => {
        if (!rooms || rooms.length === 0) return null;
        
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        rooms.forEach(room => {
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
    }, [rooms]);

    // Calculate effective floor panels
    const effectiveFloorPanelsMap = useMemo(() => {
        if (!floorPanelsMap || Object.keys(floorPanelsMap).length === 0) {
            if (floorPanels && Array.isArray(floorPanels) && floorPanels.length > 0) {
                const fallbackMap = {};
                floorPanels.forEach((panel, index) => {
                    let roomId = panel.room_id;
                    if (!roomId && panel.room) {
                        roomId = typeof panel.room === 'object' ? panel.room.id : panel.room;
                    }
                    
                    if (roomId) {
                        if (!fallbackMap[roomId]) {
                            fallbackMap[roomId] = [];
                        }
                        fallbackMap[roomId].push(panel);
                    }
                });
                return fallbackMap;
            }
            return {};
        }
        return floorPanelsMap;
    }, [floorPanelsMap, floorPanels]);

    // Clear dimension placement when floor plan data changes so labels re-evaluate (match ceiling)
    useEffect(() => {
        dimensionPlacementMemory.current.clear();
    }, [effectiveFloorPanelsMap, projectBounds]);

    // Helper function to get accurate panel counts
    const getAccuratePanelCounts = () => {
        if (floorPlan?.total_panels !== undefined) {
            return {
                total: floorPlan.total_panels,
                full: floorPlan.full_panels || 0,
                cut: floorPlan.cut_panels || 0
            };
        }
        
        if (floorPanels && Array.isArray(floorPanels)) {
            const panelFloorRooms = rooms?.filter(room => 
                room.floor_type === 'panel' || room.floor_type === 'Panel'
            ) || [];
            
            const panelFloorRoomIds = panelFloorRooms.map(room => room.id);
            const relevantPanels = floorPanels.filter(panel => 
                panelFloorRoomIds.includes(panel.room_id || panel.room)
            );
            
            const total = relevantPanels.length;
            const full = relevantPanels.filter(p => !p.is_cut_panel).length;
            const cut = relevantPanels.filter(p => p.is_cut_panel).length;
            
            return { total, full, cut };
        }
        
        return { total: 0, full: 0, cut: 0 };
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = CANVAS_WIDTH;
        const displayHeight = CANVAS_HEIGHT;
        
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        
        ctx.scale(dpr, dpr);
        
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';

        calculateCanvasTransform();
        drawCanvas(ctx);

    // [UPDATED] Added visibilityState to dependencies so it redraws when you click checkboxes
    }, [rooms, walls, intersections, floorPlan, floorPanels, effectiveFloorPanelsMap, CANVAS_WIDTH, CANVAS_HEIGHT, visibilityState]);

    // Calculate optimal canvas transformation
    const calculateCanvasTransform = () => {
        if (!rooms || rooms.length === 0) {
            scaleFactor.current = 1;
            initialScale.current = 1;
            offsetX.current = CANVAS_WIDTH / 2;
            offsetY.current = CANVAS_HEIGHT / 2;
            return;
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        rooms.forEach(room => {
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

        const scaleX = (CANVAS_WIDTH - 4 * PADDING) / totalWidth;
        const scaleY = (CANVAS_HEIGHT - 4 * PADDING) / totalHeight;
        const optimalScale = Math.min(scaleX, scaleY, 2.0);

        if (!isZoomed.current) {
            scaleFactor.current = optimalScale;
            setCurrentScale(optimalScale);
        }
        initialScale.current = optimalScale;

        if (!isDraggingCanvas.current) {
            const scaledWidth = totalWidth * optimalScale;
            const scaledHeight = totalHeight * optimalScale;
            
            offsetX.current = (CANVAS_WIDTH - scaledWidth) / 2 - minX * optimalScale;
            offsetY.current = (CANVAS_HEIGHT - scaledHeight) / 2 - minY * optimalScale;
        }
    };

    // Main drawing function
    const drawCanvas = (ctx) => {
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        drawGrid(ctx);

        if (walls && walls.length > 0) {
            drawWalls(ctx);
        }

        if (rooms && rooms.length > 0) {
            rooms.forEach(room => {
                drawRoomOutline(ctx, room);
                
                // --- FIX STARTS HERE ---
                // 1. Get the panels for this specific room
                const roomPanels = effectiveFloorPanelsMap[room.id] || [];
                
                // 2. Pass the panels to the function
                drawFloorPanels(ctx, room, roomPanels);
                // --- FIX ENDS HERE ---
            });
            
            // PASS 1: Draw dimensions (lines only) and collect text box info
            const dimensionTextBoxes = drawFloorDimensions(ctx);
            
            // PASS 2: Draw all dimension text BOXES on top
            if (dimensionTextBoxes && dimensionTextBoxes.length > 0) {
                dimensionTextBoxes.forEach(label => {
                    drawDimensionTextBox(ctx, label);
                });
            }
        }

        drawTitle(ctx);
    };

    // Draw professional grid
    const drawGrid = (ctx) => {
        const gridSize = 50; 
        
        const gridOffsetX = offsetX.current % gridSize;
        const gridOffsetY = offsetY.current % gridSize;
        
        ctx.strokeStyle = '#ddd'; 
        ctx.lineWidth = 1; 
        
        for (let x = -gridOffsetX; x <= CANVAS_WIDTH; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, CANVAS_HEIGHT);
            ctx.stroke();
        }
        
        for (let y = -gridOffsetY; y <= CANVAS_HEIGHT; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(CANVAS_WIDTH, y);
            ctx.stroke();
        }
    };

    // Draw room outline
    const drawRoomOutline = (ctx, room) => {
        if (!room.room_points || room.room_points.length < 3) return;

        ctx.fillStyle = 'rgba(156, 163, 175, 0.05)';
        ctx.strokeStyle = '#9ca3af'; 
        ctx.lineWidth = 2 * scaleFactor.current;

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

        if (room.room_name) {
            // Always place label at the middle of the room (ignore user label_position)
            const labelX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
            const labelY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;

            const canvasX = labelX * scaleFactor.current + offsetX.current;
            const canvasY = labelY * scaleFactor.current + offsetY.current;

            // Room AABB in canvas space
            const roomCanvasMinX = Math.min(...room.room_points.map(p => p.x * scaleFactor.current + offsetX.current));
            const roomCanvasMaxX = Math.max(...room.room_points.map(p => p.x * scaleFactor.current + offsetX.current));
            const roomCanvasMinY = Math.min(...room.room_points.map(p => p.y * scaleFactor.current + offsetY.current));
            const roomCanvasMaxY = Math.max(...room.room_points.map(p => p.y * scaleFactor.current + offsetY.current));
            const roomCanvasWidth = roomCanvasMaxX - roomCanvasMinX;
            const roomCanvasHeight = roomCanvasMaxY - roomCanvasMinY;

            const isSlabRoom = room.floor_type === 'slab' || room.floor_type === 'Slab';

            // Only hide labels when the room is truly tiny in the current view.
            // These thresholds are fixed pixel sizes so zooming in will eventually reveal the text.
            const MIN_LABEL_WIDTH = 60;
            const MIN_LABEL_HEIGHT = isSlabRoom ? 40 : 24;
            if (roomCanvasWidth < MIN_LABEL_WIDTH || roomCanvasHeight < MIN_LABEL_HEIGHT) {
                return;
            }

            const roomNameFontSize = Math.max(14, 200 * scaleFactor.current);
            const slabFontSize = Math.max(12, 160 * scaleFactor.current);
            const lineOffset = 15;

            ctx.fillStyle = '#6b7280';
            ctx.font = `bold ${roomNameFontSize}px 'Segoe UI', Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(room.room_name, canvasX, canvasY);

            // If this room uses slab floor, show slabs needed under the room name
            if (isSlabRoom) {
                const roomAreaMm2 = calculateRoomArea(room);
                const slabAreaMm2 = slabWidth * slabLength;
                if (roomAreaMm2 > 0 && slabAreaMm2 > 0) {
                    const slabsNeeded = Math.ceil(roomAreaMm2 / slabAreaMm2);
                    const slabText = `${slabsNeeded} slab${slabsNeeded === 1 ? '' : 's'} needed`;
                    ctx.font = `${Math.max(12, slabFontSize)}px 'Segoe UI', Arial, sans-serif`;
                    ctx.fillText(slabText, canvasX, canvasY + lineOffset);
                }
            }
        }
    };

    // Draw walls with dashed lines (inner face)
    const drawWalls = (ctx) => {
        if (!walls || walls.length === 0) return;

        const center = { x: 0, y: 0 };
        if (rooms.length > 0) {
            const allPoints = rooms.flatMap(room => room.room_points || []);
            if (allPoints.length > 0) {
                center.x = allPoints.reduce((sum, p) => sum + p.x, 0) / allPoints.length;
                center.y = allPoints.reduce((sum, p) => sum + p.y, 0) / allPoints.length;
            }
        }
        
        walls.forEach(wall => {
            try {
                // Use actual wall thickness (mm) and scale it fully to pixels
                const wallThickness = wall.thickness ?? projectData?.wall_thickness ?? 100;
                const gapPixels = wallThickness * scaleFactor.current;

                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x, wall.start_y, wall.end_x, wall.end_y,
                    gapPixels, center, scaleFactor.current
                );

                let has45 = false;
                let joiningWallId = null;
                
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && inter.joining_method === '45_cut') {
                        has45 = true;
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                    }
                });
                
                if (has45 && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - (wall.start_y + wall.end_y) / 2;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - (wall.start_y + wall.end_y) / 2;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        
                        if (shouldFlip) {
                            const offsetX = (gapPixels * normalX) / scaleFactor.current;
                            const offsetY = (gapPixels * normalY) / scaleFactor.current;
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            line2[0] = { x: wall.start_x - finalOffsetX, y: wall.start_y - finalOffsetY };
                            line2[1] = { x: wall.end_x - finalOffsetX, y: wall.end_y - finalOffsetY };
                        }
                    }
                }
                
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    const finalAdjust = wallThickness * 2; 
                    
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }

                wall._line1 = line1;
                wall._line2 = line2;

                ctx.strokeStyle = '#333333'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([]); 
                
                ctx.beginPath();
                ctx.moveTo(line1[0].x * scaleFactor.current + offsetX.current, line1[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line1[1].x * scaleFactor.current + offsetX.current, line1[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();

                ctx.strokeStyle = '#6b7280'; 
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 4]); 

                ctx.beginPath();
                ctx.moveTo(line2[0].x * scaleFactor.current + offsetX.current, line2[0].y * scaleFactor.current + offsetY.current);
                ctx.lineTo(line2[1].x * scaleFactor.current + offsetX.current, line2[1].y * scaleFactor.current + offsetY.current);
                ctx.stroke();
                
                ctx.setLineDash([]);

            } catch (error) {
                ctx.strokeStyle = '#1f2937';
                ctx.lineWidth = 3 * scaleFactor.current;
                ctx.setLineDash([]);
                
                ctx.beginPath();
                ctx.moveTo(wall.start_x * scaleFactor.current + offsetX.current, wall.start_y * scaleFactor.current + offsetY.current);
                ctx.lineTo(wall.end_x * scaleFactor.current + offsetX.current, wall.end_y * scaleFactor.current + offsetY.current);
                ctx.stroke();
            }
        });
    };

    // Draw floor panels with winding-aware clipping mask
    const drawFloorPanels = (ctx, room, panels) => {
        if (!panels || panels.length === 0 || !room.room_points || room.room_points.length < 3) return;

        const wallThickness = projectData?.wall_thickness || 150;
        ctx.save(); 

        /* Floor clipping logic disabled; panels now draw without inner clipping mask.
        // ============================================================
        // 1. DETECT WINDING ORDER (Clockwise vs Counter-Clockwise)
        // This prevents the "expand vs shrink" issue.
        // ============================================================
        const pts = room.room_points;
        let windingSum = 0;
        for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % pts.length];
            windingSum += (p2.x - p1.x) * (p2.y + p1.y);
        }
        // In Canvas (Y-down), sum > 0 is Clockwise. 
        // We want the offset to always point INWARD.
        const directionSign = windingSum > 0 ? -1 : 1;

        // ============================================================
        // 2. GENERATE ROBUST PARALLEL INNER CLIPPING PATH
        // ============================================================
        ctx.beginPath();
        const n = pts.length;
        const offsetInner = [];

        for (let i = 0; i < n; i++) {
            const p1 = pts[(i + n - 1) % n];
            const p2 = pts[i];
            const p3 = pts[(i + 1) % n];

            // Edge 1 Vector (p1 -> p2)
            const dx1 = p2.x - p1.x;
            const dy1 = p2.y - p1.y;
            const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
            const n1x = -dy1 / len1; // Perpendicular Normal
            const n1y = dx1 / len1;

            // Edge 2 Vector (p2 -> p3)
            const dx2 = p3.x - p2.x;
            const dy2 = p3.y - p2.y;
            const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
            const n2x = -dy2 / len2; // Perpendicular Normal
            const n2y = dx2 / len2;

            // Bisector direction
            let bx = n1x + n2x;
            let by = n1y + n2y;
            let bMag = Math.sqrt(bx * bx + by * by);

            if (bMag < 0.0001) {
                bx = n1x;
                by = n1y;
            } else {
                bx /= bMag;
                by /= bMag;
            }

            // Miter Length calculation to keep inner corner sharp
            const cosAngle = n1x * n2x + n1y * n2y;
            const miterLen = wallThickness / Math.sqrt((1 + cosAngle) / 2);

            // Apply Winding-Aware Offset
            const finalX = (p2.x + bx * miterLen * directionSign) * scaleFactor.current + offsetX.current;
            const finalY = (p2.y + by * miterLen * directionSign) * scaleFactor.current + offsetY.current;

            offsetInner.push({ x: finalX, y: finalY });
        }

        ctx.moveTo(offsetInner[0].x, offsetInner[0].y);
        for (let i = 1; i < offsetInner.length; i++) {
            ctx.lineTo(offsetInner[i].x, offsetInner[i].y);
        }
        ctx.closePath();
        // ctx.clip(); // Floor plan clipping disabled
        */

        // ============================================================
        // 3. DRAW PANELS (supporting L-shapes via shape_points)
        // ============================================================
        panels.forEach(panel => {
            const isCut = panel.is_cut_panel || panel.is_cut;
            ctx.fillStyle = isCut ? 'rgba(34, 197, 94, 0.4)' : 'rgba(59, 130, 246, 0.4)';
            ctx.strokeStyle = isCut ? '#22c55e' : '#3b82f6';
            ctx.lineWidth = 1;

            ctx.beginPath();

            const shapePoints = panel.shape_points;
            if (Array.isArray(shapePoints) && shapePoints.length > 2) {
                // Exact polygon (e.g. L-shaped floor panel)
                const p0 = shapePoints[0];
                ctx.moveTo(
                    p0.x * scaleFactor.current + offsetX.current,
                    p0.y * scaleFactor.current + offsetY.current
                );
                for (let i = 1; i < shapePoints.length; i++) {
                    const p = shapePoints[i];
                    ctx.lineTo(
                        p.x * scaleFactor.current + offsetX.current,
                        p.y * scaleFactor.current + offsetY.current
                    );
                }
                ctx.closePath();
            } else {
                // Fallback to rectangle
                const startX = panel.start_x ?? panel.x ?? 0;
                const startY = panel.start_y ?? panel.y ?? 0;
                const width = panel.width * scaleFactor.current;
                const height = panel.length * scaleFactor.current;
                const x = startX * scaleFactor.current + offsetX.current;
                const y = startY * scaleFactor.current + offsetY.current;
                ctx.rect(x, y, width, height);
            }

            ctx.fill();
            ctx.stroke();
        });

        ctx.restore();
    };

    // Draw title and info
    const drawTitle = (ctx) => {
        ctx.fillStyle = '#374151';
        ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Floor Plan', 20, 20);
        
        ctx.font = `${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.fillText(`Scale: ${scaleFactor.current.toFixed(2)}x`, 20, 50);
    };

    // Helper function to calculate room area
    const calculateRoomArea = (room) => {
        if (!room.room_points || room.room_points.length < 3) return 0;
        
        let area = 0;
        const points = room.room_points;
        
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        
        return Math.abs(area) / 2;
    };

    // [UPDATED] Draw floor dimensions with visibility checks
    const drawFloorDimensions = (ctx) => {
        if (!modelBounds) return;

        // Clear global dimension-value tracker each redraw (match ceiling: one label per unique size)
        if (dimensionValuesSeen.current) {
            dimensionValuesSeen.current.clear();
        }

        const placedLabels = [];
        const allLabels = [];
        const drawnDimensions = new Set();
        const globalDimensionTracker = new Map();

        // Collect all dimensions so we can sort by value: smaller inner, larger outer when overlapping
        const dimensionsToDraw = [];

        // 1. Collect Room Dimensions (Width/Height)
        if (rooms && rooms.length > 0) {
            rooms.forEach(room => {
                if (!room.room_points || room.room_points.length < 3) return;

                const xCoords = room.room_points.map(p => p.x);
                const yCoords = room.room_points.map(p => p.y);
                const roomMinX = Math.min(...xCoords);
                const roomMaxX = Math.max(...xCoords);
                const roomMinY = Math.min(...yCoords);
                const roomMaxY = Math.max(...yCoords);

                const roomWidth = roomMaxX - roomMinX;
                const roomHeight = roomMaxY - roomMinY;

                const widthDimension = {
                    startX: roomMinX,
                    endX: roomMaxX,
                    startY: roomMaxY + 20,
                    endY: roomMaxY + 20,
                    dimension: roomWidth,
                    type: 'room_width',
                    color: '#1e40af',
                    priority: 1,
                    avoidArea: projectBounds,
                    drawnPositions: new Set(),
                    roomId: room.id,
                    isHorizontal: true
                };

                const heightDimension = {
                    startX: roomMinX - 20,
                    endX: roomMinX - 20,
                    startY: roomMinY,
                    endY: roomMaxY,
                    dimension: roomHeight,
                    type: 'room_height',
                    color: '#1e40af',
                    priority: 1,
                    avoidArea: projectBounds,
                    drawnPositions: new Set(),
                    roomId: room.id,
                    isHorizontal: false
                };

                const widthGlobalKey = `room_width_${Math.round(roomWidth)}`;
                const heightGlobalKey = `room_height_${Math.round(roomHeight)}`;

                if (!globalDimensionTracker.has(widthGlobalKey) && (visibilityState.room !== false)) {
                    dimensionsToDraw.push({ dimension: widthDimension, bounds: projectBounds });
                    globalDimensionTracker.set(widthGlobalKey, true);
                }
                if (!globalDimensionTracker.has(heightGlobalKey) && (visibilityState.room !== false)) {
                    dimensionsToDraw.push({ dimension: heightDimension, bounds: projectBounds });
                    globalDimensionTracker.set(heightGlobalKey, true);
                }
            });
        }

        // 2. Collect Panel Dimensions
        if (rooms && rooms.length > 0) {
            rooms.forEach(room => {
                const roomPanels = effectiveFloorPanelsMap[room.id] || [];
                if (roomPanels.length === 0) return;
                const isPanelFloor = room.floor_type === 'panel' || room.floor_type === 'Panel';
                if (!isPanelFloor) return;
                const strategy = roomStrategies[room.id] || 'auto';
                drawPanelDimensions(ctx, room, roomPanels, placedLabels, allLabels, drawnDimensions, globalDimensionTracker, strategy, dimensionsToDraw);
            });
        }

        // Sort by dimension value ascending: draw smaller first (inner), larger later (outer when overlap)
        dimensionsToDraw.sort((a, b) => (a.dimension.dimension ?? 0) - (b.dimension.dimension ?? 0));

        // 3. Draw in order so larger values get pushed outer when overlapping
        dimensionsToDraw.forEach(({ dimension, bounds }) => {
            drawRoomDimensions(ctx, dimension, bounds, placedLabels, allLabels);
        });

        return allLabels;
    };

    // [UPDATED] Draw Panel Dimensions with specific Cut Panel filter
    // When dimensionCollector is provided, dimensions are pushed to it instead of drawn (caller sorts and draws so larger value is outer)
    const drawPanelDimensions = (ctx, room, roomPanels, placedLabels, allLabels, drawnDimensions, globalDimensionTracker, strategy, dimensionCollector = null) => {
        if (roomPanels.length === 0) return;

        // Room dimensions for "don't show if matches room" filter (match ceiling)
        const roomWidth = room.room_points && room.room_points.length >= 3
            ? Math.abs(Math.max(...room.room_points.map(p => p.x)) - Math.min(...room.room_points.map(p => p.x)))
            : null;
        const roomHeight = room.room_points && room.room_points.length >= 3
            ? Math.abs(Math.max(...room.room_points.map(p => p.y)) - Math.min(...room.room_points.map(p => p.y)))
            : null;

        const fullPanels = roomPanels.filter(panel => !panel.is_cut_panel);
        const cutPanels = roomPanels.filter(panel => panel.is_cut_panel);

        let isHorizontalStrategy;
        if (strategy === 'auto' || strategy === 'room_optimal' || strategy === 'best_orientation') {
            const refPanel = fullPanels.length > 0 ? fullPanels[0] : roomPanels[0];
            isHorizontalStrategy = refPanel.width > refPanel.length;
        } else {
            isHorizontalStrategy = strategy.includes('horizontal');
        }
        
        const panelsByDimension = new Map();
        
        fullPanels.forEach(panel => {
            let groupingDimension;
            if (isHorizontalStrategy) {
                groupingDimension = panel.length;
            } else {
                groupingDimension = panel.width;
            }
            const dimensionValue = Math.round(groupingDimension * 100) / 100;
            
            if (!panelsByDimension.has(dimensionValue)) {
                panelsByDimension.set(dimensionValue, []);
            }
            panelsByDimension.get(dimensionValue).push(panel);
        });

        const shouldShowIndividual = roomPanels.length <= 20;
        const drawnValues = new Set();

        panelsByDimension.forEach((panels, dimensionValue) => {
            if (panels.length > 1) {
                const orientationSuffix = isHorizontalStrategy ? 'H' : 'V';
                const dimensionKey = `grouped_${dimensionValue}_${panels.length}_${orientationSuffix}`;
                const valueKey = `${dimensionValue}mm_${panels.length}_${orientationSuffix}`;
                
                if (drawnDimensions.has(dimensionKey) || drawnValues.has(valueKey)) return;
                
                drawnDimensions.add(dimensionKey);
                drawnValues.add(valueKey);
                
                if (visibilityState.panel !== false) {
                    drawGroupedPanelDimensions(ctx, panels, dimensionValue, placedLabels, allLabels, isHorizontalStrategy, globalDimensionTracker, dimensionCollector);
                }

            } else if (panels.length === 1 && shouldShowIndividual) {
                const panel = panels[0];
                const dimVal = Math.round(dimensionValue * 100) / 100;
                
                // Filter: don't show dimension if it matches room dimension (match ceiling)
                const DIMENSION_TOLERANCE = 1;
                const shouldShow = isHorizontalStrategy
                    ? !(roomHeight != null && Math.abs(dimVal - roomHeight) <= DIMENSION_TOLERANCE)
                    : !(roomWidth != null && Math.abs(dimVal - roomWidth) <= DIMENSION_TOLERANCE);

                const fullDimensionKey = `full_${panel.id}`;
                const fullValueKey = `${dimVal}mm_full`;
                
                if (drawnDimensions.has(fullDimensionKey) || drawnValues.has(fullValueKey)) return;
                
                drawnDimensions.add(fullDimensionKey);
                drawnValues.add(fullValueKey);
                
                if (!shouldShow) return;

                let individualDimension;
                
                if (isHorizontalStrategy) {
                    const centerX = panel.start_x + (panel.width / 2);
                    individualDimension = {
                        startX: centerX,
                        endX: centerX,
                        startY: panel.start_y,
                        endY: panel.start_y + panel.length,
                        dimension: dimVal,
                        type: 'individual_panel',
                        color: DIMENSION_CONFIG.COLORS.PANEL_GROUP,
                        priority: 3,
                        avoidArea: projectBounds,
                        drawnPositions: new Set(),
                        roomId: room.id,
                        isHorizontal: false 
                    };
                } else {
                    const centerY = panel.start_y + (panel.length / 2);
                    individualDimension = {
                        startX: panel.start_x,
                        endX: panel.start_x + panel.width,
                        startY: centerY,
                        endY: centerY,
                        dimension: dimVal,
                        type: 'individual_panel',
                        color: DIMENSION_CONFIG.COLORS.PANEL_GROUP,
                        priority: 3,
                        avoidArea: projectBounds,
                        drawnPositions: new Set(),
                        roomId: room.id,
                        isHorizontal: true 
                    };
                }
                
                if (visibilityState.panel !== false) {
                    if (dimensionCollector) {
                        dimensionCollector.push({ dimension: individualDimension, bounds: projectBounds });
                    } else {
                        drawRoomDimensions(ctx, individualDimension, projectBounds, placedLabels, allLabels);
                    }
                }
            }
        });

        // 3. DRAW CUT PANELS
        if (cutPanels.length > 0) {
            cutPanels.forEach(panel => {
                let dimensionValue;
                let isDimensionLineHorizontal; 

                if (isHorizontalStrategy) {
                    dimensionValue = panel.length;
                    isDimensionLineHorizontal = false; 
                } else {
                    dimensionValue = panel.width;
                    isDimensionLineHorizontal = true; 
                }
                
                const cutDimensionKey = `cut_${panel.id}`;
                const cutValueKey = `${dimensionValue}mm_cut`;
                
                if (drawnDimensions.has(cutDimensionKey) || drawnValues.has(cutValueKey)) return;
                
                drawnDimensions.add(cutDimensionKey);
                drawnValues.add(cutValueKey);
                
                let cutPanelDimension;
                
                if (isDimensionLineHorizontal) {
                    const centerY = panel.start_y + (panel.length / 2);
                    cutPanelDimension = {
                        startX: panel.start_x,
                        endX: panel.start_x + panel.width,
                        startY: centerY,
                        endY: centerY,
                        dimension: dimensionValue,
                        type: 'cut_panel',
                        color: '#dc2626',
                        priority: 4,
                        avoidArea: projectBounds,
                        drawnPositions: new Set(),
                        roomId: room.id,
                        isHorizontal: true,
                        isCut: true
                    };
                } else {
                    const centerX = panel.start_x + (panel.width / 2);
                    cutPanelDimension = {
                        startX: centerX,
                        endX: centerX,
                        startY: panel.start_y,
                        endY: panel.start_y + panel.length,
                        dimension: dimensionValue,
                        type: 'cut_panel',
                        color: '#dc2626',
                        priority: 4,
                        avoidArea: projectBounds,
                        drawnPositions: new Set(),
                        roomId: room.id,
                        isHorizontal: false,
                        isCut: true
                    };
                }
                
                if (visibilityState.cutPanel !== false) {
                    if (dimensionCollector) {
                        dimensionCollector.push({ dimension: cutPanelDimension, bounds: projectBounds });
                    } else {
                        drawRoomDimensions(ctx, cutPanelDimension, projectBounds, placedLabels, allLabels);
                    }
                }
            });
        }
    };

    // PASS 2: Draw dimension text box
    const drawDimensionTextBox = (ctx, label) => {
        if (!label) return;
        
        ctx.save();
        
        const { x, y, width, height, text, color, labelX, labelY, isHorizontal } = label;
        
        // Draw background
        // Match CeilingCanvas style (0.95 opacity)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(x, y, width, height);
        
        // Draw border
        ctx.strokeStyle = color;
        ctx.lineWidth = DIMENSION_CONFIG.LABEL_BORDER_WIDTH;
        ctx.strokeRect(x, y, width, height);
        
        // Draw text
        ctx.fillStyle = color;
        const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor.current;
        let fontSize;
        
        let sqrtScaledFontSize = 0;
        if (initialScale.current > 0 && scaleFactor.current > initialScale.current) {
            const zoomRatio = scaleFactor.current / initialScale.current;
            sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
        }
        
        if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
            fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
        } else {
            fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
        }
        
        fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN);
        ctx.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
        
        if (isHorizontal) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, labelX, labelY);
        } else {
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

    // PASS 1: Draw dimension LINES
    const drawRoomDimensions = (ctx, dimension, bounds, placedLabels, allLabels) => {
        const { startX, endX, startY, endY, dimension: length, color, avoidArea } = dimension;
        const { minX, maxX, minY, maxY } = bounds || modelBounds || {};
        
        if (!bounds && !modelBounds) return;

        // Global numeric de-duplication: ensure each dimension value (in mm) appears at most once (match ceiling)
        const globalDimensionValues = dimensionValuesSeen.current;
        if (globalDimensionValues && typeof length === 'number') {
            const roundedLength = Math.round(length);
            if (globalDimensionValues.has(roundedLength)) {
                return;
            }
            globalDimensionValues.add(roundedLength);
        }

        let isHorizontal;
        if (dimension.isHorizontal !== undefined) {
            isHorizontal = dimension.isHorizontal;
        } else {
            const dx = endX - startX;
            const dy = endY - startY;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            isHorizontal = Math.abs(angle) < 45 || Math.abs(angle) > 135;
        }
        
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        
        const dimensionKey = `${startX.toFixed(2)}_${startY.toFixed(2)}_${endX.toFixed(2)}_${endY.toFixed(2)}_${dimension.type || 'default'}`;
        const storedPlacement = dimensionPlacementMemory.current.get(dimensionKey);
        const lockedSide = storedPlacement ? storedPlacement.side : null;
        
        let labelX, labelY;
        // Match ceiling: smaller base offset so labels stay close to model
        let baseOffset = Math.min(DIMENSION_CONFIG.BASE_OFFSET, 10);
        const maxAttempts = DIMENSION_CONFIG.MAX_ATTEMPTS;
        
        let text;
        if (dimension.type === 'cut_panel' || dimension.isCut) {
            // [CHANGED] Removed the (CUT) text to keep it clean
            text = `${Math.round(length)}`;
        } else if (dimension.quantity && dimension.quantity > 1) {
            text = `${dimension.quantity} × ${Math.round(length)}`;
        } else {
            text = `${Math.round(length)}`;
        }
        let textWidth = ctx.measureText(text).width;
        
        let placement;
        
        if (isHorizontal) {
            placement = smartPlacement({
                calculatePositionSide1: (offset) => {
                    return {
                        labelX: midX * scaleFactor.current + offsetX.current,
                        labelY: (avoidArea ? avoidArea.minY : minY) * scaleFactor.current + offsetY.current - offset
                    };
                },
                calculatePositionSide2: (offset) => {
                    return {
                        labelX: midX * scaleFactor.current + offsetX.current,
                        labelY: (avoidArea ? avoidArea.maxY : maxY) * scaleFactor.current + offsetY.current + offset
                    };
                },
                calculateBounds: (labelX, labelY, textWidth) => calculateHorizontalLabelBounds(labelX, labelY, textWidth, DIMENSION_CONFIG.LABEL_PADDING_H, DIMENSION_CONFIG.LABEL_PADDING_V),
                textWidth: textWidth,
                placedLabels: placedLabels,
                baseOffset: baseOffset,
                offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                maxAttempts: maxAttempts,
                preferredSide: 'side1',
                lockedSide: lockedSide
            });
            // Match ceiling: adjust bottom placement to be closer (smaller offset)
            if (placement.side === 'side2') {
                const bottomOffset = DIMENSION_CONFIG.BASE_OFFSET_SMALL;
                placement.labelY = (avoidArea ? avoidArea.maxY : maxY) * scaleFactor.current + offsetY.current + bottomOffset;
                placement.offset = bottomOffset;
            }
        } else {
            // Match ceiling: prefer left (side1), same base offset (no MIN_VERTICAL_OFFSET)
            const baseVerticalOffset = baseOffset;
            placement = smartPlacement({
                calculatePositionSide1: (offset) => {
                    return {
                        labelX: (avoidArea ? avoidArea.minX : minX) * scaleFactor.current + offsetX.current - offset,
                        labelY: midY * scaleFactor.current + offsetY.current
                    };
                },
                calculatePositionSide2: (offset) => {
                    return {
                        labelX: (avoidArea ? avoidArea.maxX : maxX) * scaleFactor.current + offsetX.current + offset,
                        labelY: midY * scaleFactor.current + offsetY.current
                    };
                },
                calculateBounds: (labelX, labelY, textWidth) => calculateVerticalLabelBounds(labelX, labelY, textWidth, DIMENSION_CONFIG.LABEL_PADDING_H, DIMENSION_CONFIG.LABEL_PADDING_V),
                textWidth: textWidth,
                placedLabels: placedLabels,
                baseOffset: baseVerticalOffset,
                offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                maxAttempts: maxAttempts,
                preferredSide: 'side1',
                lockedSide: lockedSide
            });
        }
        
        if (!storedPlacement) {
            dimensionPlacementMemory.current.set(dimensionKey, { side: placement.side });
        }
        
        labelX = placement.labelX;
        labelY = placement.labelY;
        
        // Match ceiling: ensure label bounds are outside project area and don't overlap other labels
        if (avoidArea) {
            let labelBounds;
            let overlapsAvoidArea = true;
            let validationAttempts = 0;
            const maxValidationAttempts = 10;
            const minSeparation = 5;
            const isBottomDimension = isHorizontal && placement.side === 'side2';
            let validationOffset = isBottomDimension ? DIMENSION_CONFIG.BASE_OFFSET_SMALL : (placement.offset || baseOffset);
            
            while (overlapsAvoidArea && validationAttempts < maxValidationAttempts) {
                const pH = DIMENSION_CONFIG.LABEL_PADDING_H;
                const pV = DIMENSION_CONFIG.LABEL_PADDING_V;
                if (isHorizontal) {
                    labelBounds = {
                        x: labelX - textWidth / 2 - pH,
                        y: labelY - pV,
                        width: textWidth + pH * 2,
                        height: pV * 2
                    };
                } else {
                    labelBounds = {
                        x: labelX - pV,
                        y: labelY - textWidth / 2 - pH,
                        width: pV * 2,
                        height: textWidth + pH * 2
                    };
                }
                const labelModelBounds = {
                    minX: (labelBounds.x - offsetX.current) / scaleFactor.current,
                    maxX: (labelBounds.x + labelBounds.width - offsetX.current) / scaleFactor.current,
                    minY: (labelBounds.y - offsetY.current) / scaleFactor.current,
                    maxY: (labelBounds.y + labelBounds.height - offsetY.current) / scaleFactor.current
                };
                const separation = minSeparation / scaleFactor.current;
                const overlapsProjectArea = !(
                    labelModelBounds.maxX < avoidArea.minX - separation ||
                    labelModelBounds.minX > avoidArea.maxX + separation ||
                    labelModelBounds.maxY < avoidArea.minY - separation ||
                    labelModelBounds.minY > avoidArea.maxY + separation
                );
                const overlapsOtherLabels = hasLabelOverlap(labelBounds, placedLabels, 5);
                overlapsAvoidArea = overlapsProjectArea || overlapsOtherLabels;
                
                if (overlapsAvoidArea) {
                    const isBottomPlacement = isHorizontal && placement.side === 'side2';
                    const increment = isBottomPlacement ? 10 : DIMENSION_CONFIG.OFFSET_INCREMENT;
                    validationOffset += increment;
                    if (isHorizontal) {
                        const projectMidY = (avoidArea.minY + avoidArea.maxY) / 2;
                        const isTopHalf = midY < projectMidY;
                        if (isTopHalf) {
                            labelY = avoidArea.minY * scaleFactor.current + offsetY.current - validationOffset;
                        } else {
                            labelY = avoidArea.maxY * scaleFactor.current + offsetY.current + validationOffset;
                        }
                    } else {
                        const projectMidX = (avoidArea.minX + avoidArea.maxX) / 2;
                        const isLeftHalf = midX < projectMidX;
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
        
        // Final label bounds (match ceiling padding)
        let finalLabelBounds;
        const pH = DIMENSION_CONFIG.LABEL_PADDING_H;
        const pV = DIMENSION_CONFIG.LABEL_PADDING_V;
        if (isHorizontal) {
            finalLabelBounds = {
                x: labelX - textWidth / 2 - pH,
                y: labelY - pV,
                width: textWidth + pH * 2,
                height: pV * 2
            };
        } else {
            finalLabelBounds = {
                x: labelX - pV,
                y: labelY - textWidth / 2 - pH,
                width: pV * 2,
                height: textWidth + pH * 2
            };
        }
        
        // Match ceiling: final collision check with adjustment
        if (hasLabelOverlap(finalLabelBounds, placedLabels, 5)) {
            const adjustment = 15;
            if (isHorizontal) {
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
        
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = DIMENSION_CONFIG.LINE_WIDTH;
        
        if (isHorizontal) {
            ctx.beginPath();
            ctx.setLineDash(DIMENSION_CONFIG.EXTENSION_DASH);
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(startX * scaleFactor.current + offsetX.current, labelY);
            ctx.moveTo(endX * scaleFactor.current + offsetX.current, endY * scaleFactor.current + offsetY.current);
            ctx.lineTo(endX * scaleFactor.current + offsetX.current, labelY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.beginPath();
            ctx.lineWidth = DIMENSION_CONFIG.DIMENSION_LINE_WIDTH;
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, labelY);
            ctx.lineTo(endX * scaleFactor.current + offsetX.current, labelY);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.setLineDash(DIMENSION_CONFIG.EXTENSION_DASH);
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, startY * scaleFactor.current + offsetY.current);
            ctx.moveTo(endX * scaleFactor.current + offsetX.current, endY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, endY * scaleFactor.current + offsetY.current);
            ctx.stroke();
            ctx.setLineDash([]);
            
            ctx.beginPath();
            ctx.lineWidth = DIMENSION_CONFIG.DIMENSION_LINE_WIDTH;
            ctx.moveTo(labelX, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, endY * scaleFactor.current + offsetY.current);
            ctx.stroke();
        }
        
        if (isFinite(finalLabelBounds.x) && isFinite(finalLabelBounds.y) &&
            isFinite(finalLabelBounds.width) && isFinite(finalLabelBounds.height) &&
            finalLabelBounds.width > 0 && finalLabelBounds.height > 0) {
            placedLabels.push({
                x: finalLabelBounds.x,
                y: finalLabelBounds.y,
                width: finalLabelBounds.width,
                height: finalLabelBounds.height,
                text: text,
                type: dimension.type || 'default'
            });
        }
        
        allLabels.push({
            x: finalLabelBounds.x,
            y: finalLabelBounds.y,
            width: finalLabelBounds.width,
            height: finalLabelBounds.height,
            text: text,
            color: color,
            labelX: labelX,
            labelY: labelY,
            isHorizontal: isHorizontal
        });
        
        ctx.restore();
    };
    
    // Draw Grouped Dimensions (optional dimensionCollector: when set, push to it instead of drawing)
    const drawGroupedPanelDimensions = (ctx, panels, dimensionValue, placedLabels, allLabels, isHorizontalStrategy, globalDimensionTracker, dimensionCollector = null) => {
        const centerX = (Math.min(...panels.map(p => p.start_x)) + Math.max(...panels.map(p => p.start_x + p.width))) / 2;
        const centerY = (Math.min(...panels.map(p => p.start_y)) + Math.max(...panels.map(p => p.start_y + p.length))) / 2;

        const minX = Math.min(...panels.map(p => p.start_x));
        const maxX = Math.max(...panels.map(p => p.start_x + p.width));
        const minY = Math.min(...panels.map(p => p.start_y));
        const maxY = Math.max(...panels.map(p => p.start_y + p.length));

        const pushOrDraw = (dim) => {
            if (dimensionCollector) {
                dimensionCollector.push({ dimension: dim, bounds: projectBounds });
            } else {
                drawRoomDimensions(ctx, dim, projectBounds, placedLabels, allLabels);
            }
        };

        if (isHorizontalStrategy) {
            const lengthDimension = {
                startX: centerX,
                endX: centerX,
                startY: minY,
                endY: maxY,
                dimension: dimensionValue,
                type: 'grouped_length_horizontal',
                color: DIMENSION_CONFIG.COLORS.PANEL_GROUP,
                priority: 2,
                avoidArea: projectBounds,
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: false
            };
            if (visibilityState.panel !== false) {
                pushOrDraw(lengthDimension);
            }
        } else {
            const widthDimension = {
                startX: minX,
                endX: maxX,
                startY: centerY,
                endY: centerY,
                dimension: dimensionValue,
                type: 'grouped_width_vertical',
                color: DIMENSION_CONFIG.COLORS.PANEL_GROUP,
                priority: 2,
                avoidArea: projectBounds,
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: true
            };
            if (visibilityState.panel !== false) {
                pushOrDraw(widthDimension);
            }
        }
    };

    // Zoom to center of canvas
    const zoomToCenter = (newScale) => {
        const canvasCenterX = CANVAS_WIDTH / 2;
        const canvasCenterY = CANVAS_HEIGHT / 2;
        const scaleRatio = newScale / scaleFactor.current;
        
        offsetX.current = canvasCenterX - (canvasCenterX - offsetX.current) * scaleRatio;
        offsetY.current = canvasCenterY - (canvasCenterY - offsetY.current) * scaleRatio;
        
        scaleFactor.current = newScale;
        isZoomed.current = true;
        setCurrentScale(newScale);
        
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            drawCanvas(ctx);
        }
    };

    const handleZoomIn = () => {
        const newScale = Math.min(3.0, scaleFactor.current * 1.2);
        zoomToCenter(newScale);
    };

    const handleZoomOut = () => {
        const newScale = Math.max(initialScale.current, scaleFactor.current * 0.8);
        zoomToCenter(newScale);
    };

    const handleResetZoom = () => {
        isZoomed.current = false; 
        calculateCanvasTransform();
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            drawCanvas(ctx);
        }
    };

    const handleWheel = (e) => {
        e.preventDefault();
    };

    const handleMouseDown = (e) => {
        isDraggingCanvas.current = true;
        lastCanvasMousePos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    };

    const handleMouseMove = (e) => {
        if (isDraggingCanvas.current) {
            const deltaX = e.clientX - lastCanvasMousePos.current.x;
            const deltaY = e.clientY - lastCanvasMousePos.current.y;
            
            offsetX.current += deltaX;
            offsetY.current += deltaY;
            
            lastCanvasMousePos.current = { x: e.clientX, y: e.clientY };
            
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                drawCanvas(ctx);
            }
            return;
        }
        
        if (!isDragging.current) return;
        
        const deltaX = e.clientX - lastMousePos.current.x;
        const deltaY = e.clientY - lastMousePos.current.y;
        
        offsetX.current += deltaX;
        offsetY.current += deltaY;
        
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            drawCanvas(ctx);
        }
    };

    const handleMouseUp = () => {
        isDragging.current = false;
        isDraggingCanvas.current = false;
    };

    useEffect(() => {
        const handleGlobalMouseUp = () => {
            isDraggingCanvas.current = false;
        };
        
        document.addEventListener('mouseup', handleGlobalMouseUp);
        return () => {
            document.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, []);

    const handleCanvasClick = (e) => {
        if (isDraggingCanvas.current) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            const roomPanels = effectiveFloorPanelsMap[room.id] || [];
            
            for (let j = 0; j < roomPanels.length; j++) {
                const panel = roomPanels[j];
                const x = panel.start_x * scaleFactor.current + offsetX.current;
                const y = panel.start_y * scaleFactor.current + offsetY.current;
                const width = panel.width * scaleFactor.current;
                const height = panel.length * scaleFactor.current;
                
                if (clickX >= x && clickX <= x + width && clickY >= y && clickY <= y + height) {
                    console.log('Panel clicked:', panel);
                    return;
                }
            }
        }
    };

    const panelCounts = getAccuratePanelCounts();

    const generatePanelList = () => {
        const panelList = [];
        
        Object.entries(effectiveFloorPanelsMap).forEach(([roomId, roomPanels]) => {
            if (!roomPanels || roomPanels.length === 0) return;
            
            // Group panels by dimensions
            const panelsByDimension = new Map();
            roomPanels.forEach(panel => {
                // For table, we can group purely by geometry
                const isHorizontal = panel.width < panel.length;
                const groupingDimension = isHorizontal ? panel.length : panel.width;
                const dimensionValue = Math.round(groupingDimension * 100) / 100;
                
                if (!panelsByDimension.has(dimensionValue)) {
                    panelsByDimension.set(dimensionValue, []);
                }
                panelsByDimension.get(dimensionValue).push(panel);
            });
            
            panelsByDimension.forEach((panels, dimension) => {
                const fullPanels = panels.filter(p => !p.is_cut_panel);
                const cutPanels = panels.filter(p => p.is_cut_panel);
                
                const room = rooms.find(r => r.id === parseInt(roomId));
                const floorThickness = room?.floor_thickness || 20; 
                
                if (fullPanels.length > 0) {
                    const panel = fullPanels[0];
                    const isVertical = panel.width >= panel.length;
                    
                    let displayWidth = panel.width;
                    let displayLength = panel.length;
                    
                    if (isVertical) {
                        displayWidth = panel.length;
                        displayLength = panel.width;
                    }
                    
                    panelList.push({
                        width: displayWidth,
                        length: displayLength,
                        thickness: floorThickness,
                        quantity: fullPanels.length,
                        type: 'Full'
                    });
                }
                
                if (cutPanels.length > 0) {
                    const panel = cutPanels[0];
                    const isVertical = panel.width >= panel.length;
                    
                    let displayWidth = panel.width;
                    let displayLength = panel.length;
                    
                    if (isVertical) {
                        displayWidth = panel.length;
                        displayLength = panel.width;
                    }
                    
                    panelList.push({
                        width: displayWidth,
                        length: displayLength,
                        thickness: floorThickness,
                        quantity: cutPanels.length,
                        type: 'Cut'
                    });
                }
            });
        });
        
        return panelList;
    };

    const [showPanelTable, setShowPanelTable] = useState(false);
    const [isPlanDetailsOpen, setIsPlanDetailsOpen] = useState(true);

    const calculatePanelFloorArea = () => {
        let totalArea = 0;
        Object.entries(effectiveFloorPanelsMap).forEach(([roomId, roomPanels]) => {
            if (roomPanels && roomPanels.length > 0) {
                roomPanels.forEach(panel => {
                    const panelArea = panel.width * panel.length;
                    totalArea += panelArea;
                });
            }
        });
        return totalArea / 1000000;
    };

    return (
        <div className="floor-canvas-container bg-white rounded-xl shadow-lg p-4 sm:p-6 w-full max-w-full min-w-0">
            {/* Header - same line as Wall/Ceiling: title left, Show Plan Details right when collapsed */}
            <div className="floor-canvas-header mb-4 sm:mb-6 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 min-w-0">
                    <div className="min-w-0">
                        <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1 sm:mb-2 truncate">
                            Floor Plan
                        </h3>
                        <p className="text-gray-600 text-base sm:text-lg truncate">
                            Professional Layout
                        </p>
                    </div>
                    {!isPlanDetailsOpen ? (
                        <button
                            onClick={() => setIsPlanDetailsOpen(true)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors font-medium shrink-0"
                        >
                            Show Plan Details
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 min-w-0 w-full">
                {/* Main Canvas Area */}
                <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg flex-1 min-w-0">
                    <div
                        ref={canvasContainerRef}
                        className="relative"
                        style={{
                            height: `${CANVAS_HEIGHT}px`,
                            minHeight: `${MIN_CANVAS_HEIGHT}px`
                        }}
                    >
                        {/* Zoom Controls */}
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
                                className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 hover:border-green-400 transition-all duration-200 flex items-center justify-center group"
                                title="Zoom Out"
                            >
                                <svg className="w-5 h-5 text-gray-600 group-hover:text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM18 10H10" />
                                </svg>
                            </button>
                            
                            <button
                                onClick={handleResetZoom}
                                className="w-10 h-10 bg-white border border-gray-300 rounded-lg shadow-lg hover:bg-gray-50 hover:border-purple-400 transition-all duration-200 flex items-center justify-center group"
                                title="Reset Zoom"
                            >
                                <svg className="w-5 h-5 text-gray-600 group-hover:text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                        </div>

                        <canvas
                            ref={canvasRef}
                            data-plan-type="floor"
                            className="floor-canvas cursor-grab active:cursor-grabbing block w-full"
                            style={{
                                width: '100%',
                                height: '100%'
                            }}
                            onWheel={handleWheel}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onClick={handleCanvasClick}
                        />
                    </div>
                    
                    <div className="mt-4 flex items-center justify-between text-sm text-gray-600 p-3 bg-gray-50 border-t border-gray-200">
                        <div className="flex items-center gap-4">
                            <span className="font-medium">Scale:</span>
                            <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                                {currentScale.toFixed(2)}x
                            </span>
                        </div>
                        <div className="text-center">
                            <span className="font-medium">Click panels to select • Drag to pan • Use zoom buttons</span>
                        </div>
                    </div>
                </div>

                {/* Plan Details Sidebar - collapsible like Wall/Ceiling Plan */}
                {isPlanDetailsOpen && (
                <div className="floor-summary-sidebar flex-shrink-0 w-full lg:w-64 lg:max-w-64 min-w-0">
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl p-6 w-full max-w-64 shadow-lg overflow-hidden">
                        <h4 className="text-xl font-bold text-gray-900 mb-6 flex items-center shrink-0">
                            <svg className="w-6 h-6 mr-2 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            <span className="truncate">Plan Details</span>
                        </h4>
                        <div className="flex justify-end mb-4">
                            <button
                                onClick={() => setIsPlanDetailsOpen(false)}
                                className="px-3 py-1 text-xs sm:text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                            >
                                Collapse
                            </button>
                        </div>

                    <div className="space-y-4">
                        {/* Stats Grid 1 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-sm text-gray-600">Total Panels</div>
                                <div className="text-2xl font-bold text-gray-900">{panelCounts.total}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-600">Rooms</div>
                                <div className="text-xl font-semibold text-blue-600">{rooms?.filter(r => r.floor_type === 'panel' || r.floor_type === 'Panel').length || 0}</div>
                            </div>
                        </div>
                        
                        {/* Stats Grid 2 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-sm text-gray-600">Full Panels</div>
                                <div className="text-xl font-semibold text-green-600">{panelCounts.full}</div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-600">Cut Panels</div>
                                <div className="text-xl font-semibold text-red-600">{panelCounts.cut}</div>
                            </div>
                        </div>
                        
                        {/* Stats Grid 3 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-sm text-gray-600">Waste %</div>
                                <div className="text-xl font-semibold text-red-600">
                                    {(() => {
                                        if (projectWastePercentage !== undefined && projectWastePercentage !== null) {
                                            return `${Number(projectWastePercentage).toFixed(1)}%`;
                                        }
                                        if (floorPlan?.summary?.project_waste_percentage !== undefined && floorPlan?.summary?.project_waste_percentage !== null) {
                                            return `${floorPlan.summary.project_waste_percentage.toFixed(1)}%`;
                                        }
                                        if (floorPlan?.waste_percentage !== undefined && floorPlan?.waste_percentage !== null) {
                                            return `${floorPlan.waste_percentage.toFixed(1)}%`;
                                        }
                                        return '0%';
                                    })()}
                                </div>
                            </div>
                        </div>
                        
                        {/* Recommended Strategy */}
                        <div>
                            <div className="text-sm text-gray-600">Recommended</div>
                            <div className="text-lg font-semibold text-green-600">
                                {(() => {
                                    const recommended = floorPlan?.summary?.recommended_strategy || 
                                                      floorPlan?.recommended_strategy || 
                                                      orientationAnalysis?.recommended_strategy || 
                                                      'auto';
                                    
                                    const formatStrategy = (strategy) => {
                                        if (!strategy) return 'Auto';
                                        const strategyMap = {
                                            'all_horizontal': 'Horizontal',
                                            'all_vertical': 'Vertical',
                                            'room_optimal': 'Room Optimal',
                                            'best_orientation': 'Best',
                                            'auto': 'Auto'
                                        };
                                        return strategyMap[strategy] || strategy
                                            .split('_')
                                            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                            .join(' ');
                                    };
                                    
                                    return formatStrategy(recommended);
                                })()}
                            </div>
                        </div>
                        
                        {/* Panel Floor Area */}
                        <div className="pt-4 border-t border-gray-200">
                            <div className="text-sm text-gray-600">Panel Floor Area</div>
                            <div className="text-lg font-semibold text-gray-900">
                                {(() => {
                                    const calculatedArea = calculatePanelFloorArea();
                                    if (calculatedArea === 0) return '0.00 m²';
                                    return `${calculatedArea.toFixed(2)} m²`;
                                })()}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {(() => {
                                    const panelRooms = rooms?.filter(room => 
                                        room.floor_type === 'panel' || room.floor_type === 'Panel'
                                    ) || [];
                                    const totalRooms = rooms?.length || 0;
                                    return `${panelRooms.length} of ${totalRooms} rooms have panel floors`;
                                })()}
                            </div>
                        </div>
                        
                        {/* Slab size (mm) - user can set for slab floor estimation; memorized per project */}
                        <div className="pt-4 border-t border-gray-200">
                            <div className="text-sm text-gray-600 mb-2">Slab size (mm)</div>
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-1.5">
                                    <label className="text-xs text-gray-500">Width</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={slabWidth}
                                        onChange={(e) => onSlabWidthChange?.(e.target.value)}
                                        className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                        placeholder="1210"
                                    />
                                </div>
                                <span className="text-gray-400">×</span>
                                <div className="flex items-center gap-1.5">
                                    <label className="text-xs text-gray-500">Length</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={slabLength}
                                        onChange={(e) => onSlabLengthChange?.(e.target.value)}
                                        className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                        placeholder="3000"
                                    />
                                </div>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">Default 1210 × 3000. Used for slab count.</div>
                        </div>
                        
                        {/* Slab Floor Summary */}
                        <div className="pt-4 border-t border-gray-200">
                            <div className="text-sm text-gray-600">Slab Floor Summary</div>
                            <div className="text-lg font-semibold text-green-600">
                                {(() => {
                                    const slabRooms = rooms?.filter(room => 
                                        room.floor_type === 'slab' || room.floor_type === 'Slab'
                                    ) || [];
                                    
                                    if (slabRooms.length === 0) return 'No slab floors';
                                    
                                    let totalSlabs = 0;
                                    let totalArea = 0;
                                    
                                    slabRooms.forEach(room => {
                                        const roomArea = calculateRoomArea(room);
                                        const slabArea = slabWidth * slabLength;
                                        const slabsNeeded = Math.ceil(roomArea / slabArea);
                                        totalSlabs += slabsNeeded;
                                        totalArea += roomArea;
                                    });
                                    
                                    return `${totalSlabs} slabs needed`;
                                })()}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {(() => {
                                    const slabRooms = rooms?.filter(room => 
                                        room.floor_type === 'slab' || room.floor_type === 'Slab'
                                    ) || [];
                                    const totalRooms = rooms?.length || 0;
                                    if (slabRooms.length === 0) return 'No rooms with slab floors';
                                    return `${slabRooms.length} of ${totalRooms} rooms have slab floors`;
                                })()}
                            </div>
                        </div>
                        
                        {/* ------------------------------------------------------- */}
                        {/* COMBINED Dimension Legend & Filter                      */}
                        {/* ------------------------------------------------------- */}
                        <div className="mt-6 pt-4 border-t border-gray-200">
                            <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
                                <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Dimension Legend
                            </h4>
                            
                            <div className="space-y-3 text-sm">
                                {/* Room Dimensions - Toggleable Legend Item */}
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

                                {/* Panel Dimensions - Toggleable Legend Item */}
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

                                {/* Cut Dimensions - Toggleable Legend Item */}
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
                                    <div className="w-4 h-4 bg-green-500 rounded mr-3"></div>
                                    <span className="text-gray-700">Slab Floor Calculations</span>
                                </div>
                                <div className="flex items-center">
                                    <div className="w-4 h-4 bg-gray-800 rounded mr-3"></div>
                                    <span className="text-gray-700">Walls (Outer Face)</span>
                                </div>
                                <div className="flex items-center">
                                    <div className="w-4 h-4 border-2 border-gray-600 border-dashed mr-3"></div>
                                    <span className="text-gray-700">Walls (Inner Face)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
                )}

            </div>

            {/* Panel List Table */}
            <div className="mt-6 p-4 bg-white rounded-lg shadow-md border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">Floor Panel List</h3>
                    <button
                        onClick={() => setShowPanelTable(!showPanelTable)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                        {showPanelTable ? 'Hide Panel Table' : 'Show Panel Table'}
                    </button>
                </div>

                {showPanelTable && (
                    <div className="space-y-6">
                        <div>
                            <h4 className="text-md font-semibold text-gray-700 mb-3">Panel Floors</h4>
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
                                            <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                Type
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
                                                <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                        panel.type === 'Full' 
                                                            ? 'bg-green-100 text-green-800' 
                                                            : 'bg-red-100 text-red-800'
                                                    }`}>
                                                        {panel.type}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                
                                {generatePanelList().length === 0 && (
                                    <div className="text-center py-8 text-gray-500">
                                        No floor panels found. Generate a floor plan first.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <h4 className="text-md font-semibold text-gray-700 mb-3">Slab Floors</h4>
                            <div className="overflow-x-auto">
                                <table className="min-w-full border border-gray-300">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                Room Name
                                            </th>
                                            <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                Room Area (m²)
                                            </th>
                                            <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                Slab Size (mm)
                                            </th>
                                            <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                Number of Slabs Needed
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white">
                                        {(() => {
                                            const slabRooms = rooms?.filter(room => 
                                                room.floor_type === 'slab' || room.floor_type === 'Slab'
                                            ) || [];
                                            
                                            if (slabRooms.length === 0) {
                                                return (
                                                    <tr>
                                                        <td colSpan="4" className="px-4 py-8 text-center text-gray-500 border border-gray-300">
                                                            No rooms with slab floors found.
                                                        </td>
                                                    </tr>
                                                );
                                            }
                                            
                                            return slabRooms.map((room, index) => {
                                                const roomArea = calculateRoomArea(room);
                                                const slabArea = slabWidth * slabLength;
                                                const slabsNeeded = Math.ceil(roomArea / slabArea);
                                                
                                                return (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                                            {room.room_name || `Room ${room.id}`}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {Math.round(roomArea / 1000000)}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {slabWidth} × {slabLength}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-bold text-green-600">
                                                            {slabsNeeded}
                                                        </td>
                                                    </tr>
                                                );
                                            });
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FloorCanvas;