import React, { useRef, useEffect, useMemo, useState } from 'react';
import { calculateOffsetPoints } from './drawing.js';
import { DIMENSION_CONFIG } from './DimensionConfig.js';
import { hasLabelOverlap, calculateHorizontalLabelBounds, calculateVerticalLabelBounds } from './collisionDetection.js';

const DEFAULT_CANVAS_WIDTH = 1000;
const DEFAULT_CANVAS_HEIGHT = 600;
const CANVAS_ASPECT_RATIO = DEFAULT_CANVAS_HEIGHT / DEFAULT_CANVAS_WIDTH;
const MAX_CANVAS_HEIGHT_RATIO = 0.7;
const MIN_CANVAS_WIDTH = 480;
const MIN_CANVAS_HEIGHT = 320;
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
    projectWastePercentage = null
}) => {
    const canvasRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const [canvasSize, setCanvasSize] = useState({
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT
    });
    const [currentScale, setCurrentScale] = useState(1);
    
    // Canvas state refs - same as CeilingCanvas
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

    // Canvas dimensions - match wall plan proportions for consistency
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

    // Calculate effective floor panels - NO wall thickness deduction needed
    // The backend already generates panels with wall thickness deduction
    const effectiveFloorPanelsMap = useMemo(() => {
        console.log('🔍 effectiveFloorPanelsMap calculation:');
        console.log('  - floorPanelsMap:', floorPanelsMap);
        console.log('  - floorPanels:', floorPanels);
        console.log('  - floorPanels type:', typeof floorPanels);
        console.log('  - floorPanels is array:', Array.isArray(floorPanels));
        
        if (!floorPanelsMap || Object.keys(floorPanelsMap).length === 0) {
            // Fallback: try to create panelsMap from floorPanels array
            if (floorPanels && Array.isArray(floorPanels) && floorPanels.length > 0) {
                console.log('  - Creating fallback panelsMap from floorPanels array');
                console.log('  - First panel sample:', floorPanels[0]);
                console.log('  - All panels:', floorPanels);
                const fallbackMap = {};
                floorPanels.forEach((panel, index) => {
                    console.log(`  - Processing panel ${index}:`, panel);
                    // Handle both room_id (from serializer) and room (from model)
                    let roomId = panel.room_id;
                    if (!roomId && panel.room) {
                        roomId = typeof panel.room === 'object' ? panel.room.id : panel.room;
                    }
                    
                    console.log(`  - Panel ${index} room ID:`, roomId);
                    console.log(`  - Panel ${index} properties:`, {
                        start_x: panel.start_x,
                        start_y: panel.start_y,
                        width: panel.width,
                        length: panel.length,
                        is_cut_panel: panel.is_cut_panel,
                        panel_id: panel.panel_id
                    });
                    
                    if (roomId) {
                        if (!fallbackMap[roomId]) {
                            fallbackMap[roomId] = [];
                        }
                        fallbackMap[roomId].push(panel);
                    } else {
                        console.log('  - ⚠️ Panel has no room ID:', panel);
                    }
                });
                console.log('  - Fallback panelsMap created:', fallbackMap);
                return fallbackMap;
            }
            console.log('  - No floorPanels data available');
            return {};
        }
        
        console.log('  - Using provided floorPanelsMap');
        return floorPanelsMap;
    }, [floorPanelsMap, floorPanels]);

    // Helper function to get accurate panel counts (only for panel floor rooms)
    const getAccuratePanelCounts = () => {
        if (floorPlan?.total_panels !== undefined) {
            return {
                total: floorPlan.total_panels,
                full: floorPlan.full_panels || 0,
                cut: floorPlan.cut_panels || 0
            };
        }
        
        if (floorPanels && Array.isArray(floorPanels)) {
            // Only count panels from rooms with panel floors
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
            
            console.log(`Panel counts: total=${total}, full=${full}, cut=${cut} (from ${panelFloorRooms.length} panel floor rooms)`);
            return { total, full, cut };
        }
        
        return { total: 0, full: 0, cut: 0 };
    };

    // Initialize and draw canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        
        // Set canvas dimensions
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        // Calculate optimal scale and offset for all rooms
        calculateCanvasTransform();

        // Draw everything
        drawCanvas(ctx);

    }, [rooms, walls, intersections, floorPlan, floorPanels, effectiveFloorPanelsMap, CANVAS_WIDTH, CANVAS_HEIGHT]);

    // Sync external scale prop with internal zoom (if needed in the future)
    useEffect(() => {
        // This can be used if we want to sync with external scale changes
        // For now, it's kept for consistency with CeilingCanvas
    }, []);

    // Calculate optimal canvas transformation
    const calculateCanvasTransform = () => {
        if (!rooms || rooms.length === 0) {
            scaleFactor.current = 1;
            initialScale.current = 1; // Set initial scale
            offsetX.current = CANVAS_WIDTH / 2;
            offsetY.current = CANVAS_HEIGHT / 2;
            return;
        }

        // Calculate bounds for all rooms combined
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

        // Calculate optimal scale - use exact same approach as CeilingCanvas
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
        console.log('🎨 Drawing canvas with:', {
            rooms: rooms?.length || 0,
            walls: walls?.length || 0,
            floorPanels: floorPanels?.length || 0,
            effectiveFloorPanelsMap: Object.keys(effectiveFloorPanelsMap).length
        });
        console.log('🔍 effectiveFloorPanelsMap details:', effectiveFloorPanelsMap);
        console.log('🔍 floorPanels details:', floorPanels);
        
        // Clear canvas
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Draw grid
        drawGrid(ctx);

        // Draw walls first (behind everything else)
        if (walls && walls.length > 0) {
            drawWalls(ctx);
        }

        // Draw all rooms and their floor panels
        if (rooms && rooms.length > 0) {
            console.log('🔍 Drawing rooms:', rooms.map(r => ({ id: r.id, name: r.room_name, floor_type: r.floor_type })));
            console.log('🔍 Floor panels data:', floorPanels);
            console.log('🔍 Floor panels map:', floorPanelsMap);
            console.log('🔍 Effective floor panels map:', effectiveFloorPanelsMap);
            rooms.forEach(room => {
                console.log(`🔍 Drawing room ${room.id} (${room.room_name}) with floor type: ${room.floor_type}`);
                drawRoomOutline(ctx, room);
                drawFloorPanels(ctx, room);
            });
            
            // PASS 1: Draw dimensions (lines only) and collect text box info
            const dimensionTextBoxes = drawFloorDimensions(ctx);
            
            // PASS 2: Draw all dimension text BOXES on top (highest layer)
            if (dimensionTextBoxes && dimensionTextBoxes.length > 0) {
                dimensionTextBoxes.forEach(label => {
                    drawDimensionTextBox(ctx, label);
                });
            }
        }

        // Draw title and info
        drawTitle(ctx);
    };

    // Draw professional grid
    const drawGrid = (ctx) => {
        // Use the same professional grid approach as CeilingCanvas
        const gridSize = 50; // Fixed grid size like CeilingCanvas - always visible
        
        // Calculate grid offset to align with room coordinates
        const gridOffsetX = offsetX.current % gridSize;
        const gridOffsetY = offsetY.current % gridSize;
        
        // Draw grid with proper styling - same as CeilingCanvas
        ctx.strokeStyle = '#ddd'; // Same color as CeilingCanvas
        ctx.lineWidth = 1; // Same line width as CeilingCanvas
        
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

    // Draw room outline
    const drawRoomOutline = (ctx, room) => {
        if (!room.room_points || room.room_points.length < 3) return;

        // Room outline styling
        ctx.fillStyle = 'rgba(156, 163, 175, 0.05)'; // Very light gray for rooms
        ctx.strokeStyle = '#9ca3af'; // Gray border for rooms
        ctx.lineWidth = 2 * scaleFactor.current;

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

        // Add room name label (using stored label_position from wall plan if available)
        if (room.room_name) {
            let labelX, labelY;
            
            // Use stored label position from wall plan if available, otherwise calculate center
            if (room.label_position && room.label_position.x !== undefined && room.label_position.y !== undefined) {
                // Use stored position from wall plan (Canvas2D)
                labelX = room.label_position.x;
                labelY = room.label_position.y;
            } else {
                // Fallback: calculate geometric center
                labelX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
                labelY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
            }
            
            // Convert to canvas coordinates
            const canvasX = labelX * scaleFactor.current + offsetX.current;
            const canvasY = labelY * scaleFactor.current + offsetY.current;
            
            ctx.fillStyle = '#6b7280';
            ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(room.room_name, canvasX, canvasY);
        }
    };

    // Draw walls with dashed lines (inner face)
    const drawWalls = (ctx) => {
        console.log('drawWalls called with walls:', walls);
        if (!walls || walls.length === 0) {
            console.log('No walls to draw');
            return;
        }

        // Calculate center for wall offset calculations
        const center = { x: 0, y: 0 };
        if (rooms.length > 0) {
            const allPoints = rooms.flatMap(room => room.room_points || []);
            if (allPoints.length > 0) {
                center.x = allPoints.reduce((sum, p) => sum + p.x, 0) / allPoints.length;
                center.y = allPoints.reduce((sum, p) => sum + p.y, 0) / allPoints.length;
            }
        }

        console.log('Center point for walls:', center);
        
        walls.forEach(wall => {
            console.log('Drawing wall:', wall);
            
            try {
                // Use fixed gap for consistent double-line wall appearance (same as wall plan)
                const FIXED_GAP = 2.5; // Fixed gap in pixels for double-line walls

                // Calculate offset points for double-line wall
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    FIXED_GAP,
                    center,
                    scaleFactor.current
                );

                // Check for 45° joint at endpoints and possibly flip inner wall side
                // const endpoints = [ // Unused variable
                //     { label: 'start', x: wall.start_x, y: wall.start_y },
                //     { label: 'end', x: wall.end_x, y: wall.end_y }
                // ];
                
                                // Check if this wall is involved in any 45° cut intersections
                let has45 = false;
                let joiningWall = null;
                let joiningWallId = null;
                
                // Look through all intersections to find 45° cuts involving this wall
                intersections.forEach(inter => {
                    if ((inter.wall_1 === wall.id || inter.wall_2 === wall.id) && 
                        inter.joining_method === '45_cut') {
                        has45 = true;
                        // Find the joining wall id
                        joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                        console.log(`🔍 45° cut detected! Wall ${wall.id} joins with wall ${joiningWallId} at intersection ${inter.id}`);
                    }
                });
                
                console.log(`🔍 Wall ${wall.id} 45° cut check: has45=${has45}, joiningWallId=${joiningWallId}`);
                
                // If 45_cut, check if joining wall is on same side as model center
                if (has45 && joiningWallId) {
                    console.log(`🔍 Processing 45° cut for wall ${wall.id} with joining wall ${joiningWallId}`);
                    joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        console.log(`🔍 Found joining wall:`, joiningWall);
                        // Calculate normal for this wall
                        const dx = wall.end_x - wall.start_x;
                        const dy = wall.end_y - wall.start_y;
                        const length = Math.hypot(dx, dy);
                        const normalX = dy / length;
                        const normalY = -dx / length;
                        
                        // Midpoint of this wall
                        const midX = (wall.start_x + wall.end_x) / 2;
                        const midY = (wall.start_y + wall.end_y) / 2;
                        
                        // Vector to model center
                        const toCenterX = center.x - midX;
                        const toCenterY = center.y - midY;
                        const dotToCenter = normalX * toCenterX + normalY * toCenterY;
                        
                        // Vector to joining wall midpoint
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        const toJoinX = joinMidX - midX;
                        const toJoinY = joinMidY - midY;
                        const dotToJoin = normalX * toJoinX + normalY * toJoinY;
                        
                        // If dotToCenter and dotToJoin have opposite signs, flip the side for line2
                        const shouldFlip = (dotToCenter > 0 && dotToJoin < 0) || (dotToCenter < 0 && dotToJoin > 0);
                        console.log(`🔍 Flip calculation: dotToCenter=${dotToCenter.toFixed(2)}, dotToCenter=${dotToJoin.toFixed(2)}, shouldFlip=${shouldFlip}`);
                        
                        if (shouldFlip) {
                            console.log(`🔍 FLIPPING inner face for wall ${wall.id}!`);
                            // Recalculate line2 with flipped offset
                            const offsetX = (FIXED_GAP * normalX) / scaleFactor.current;
                            const offsetY = (FIXED_GAP * normalY) / scaleFactor.current;
                            
                            // Flip the offset based on the logic
                            const finalOffsetX = dotToCenter > 0 ? offsetX : -offsetX;
                            const finalOffsetY = dotToCenter > 0 ? offsetY : -offsetY;
                            
                            // Flip the entire inner line by updating both endpoints
                            line2[0] = {
                                x: wall.start_x - finalOffsetX * 2,
                                y: wall.start_y - finalOffsetY * 2
                            };
                            line2[1] = {
                                x: wall.end_x - finalOffsetX * 2,
                                y: wall.end_y - finalOffsetY * 2
                            };
                        }
                    }
                }
                
                // 45° cut shortening logic (simplified - no endpoint-specific logic needed)
                if (has45) {
                    const dx = wall.end_x - wall.start_x;
                    const dy = wall.end_y - wall.start_y;
                    const len = Math.hypot(dx, dy);
                    const ux = len ? dx / len : 0;
                    const uy = len ? dy / len : 0;
                    
                    // Scale-aware gap calculation for 45° cut
                    const targetVisualGap = 4.5;
                    const adjust = targetVisualGap / scaleFactor.current;
                    const minGapInModelUnits = Math.max(100 * 0.3, 30); // Use fixed 100mm as base
                    const finalAdjust = Math.max(adjust, minGapInModelUnits);
                    
                    // Shorten both ends of the wall line for 45° cut
                    line2 = [...line2.map(p => ({ ...p }))];
                    line2[0].x += ux * finalAdjust;
                    line2[0].y += uy * finalAdjust;
                    line2[1].x -= ux * finalAdjust;
                    line2[1].y -= uy * finalAdjust;
                }

                console.log('Wall lines calculated:', { line1, line2 });

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

                // Removed 45_cut joint drawing from floor plan

            } catch (error) {
                console.error('Error drawing wall:', error);
                // Fallback to simple line drawing
                ctx.strokeStyle = '#1f2937';
                ctx.lineWidth = 3 * scaleFactor.current;
                ctx.setLineDash([]);
                
                ctx.beginPath();
                ctx.moveTo(
                    wall.start_x * scaleFactor.current + offsetX.current,
                    wall.start_y * scaleFactor.current + offsetY.current
                );
                ctx.lineTo(
                    wall.end_x * scaleFactor.current + offsetX.current,
                    wall.end_y * scaleFactor.current + offsetY.current
                );
                ctx.stroke();
            }
        });
    };

    // Draw floor panels, slab calculation, or "No floor plan available" message
    const drawFloorPanels = (ctx, room) => {
        console.log(`🔍 drawFloorPanels called for room ${room.id} (${room.room_name})`);
        console.log(`  - Room floor type:`, room.floor_type);
        
        // Check if room has panel floor type
        const isPanelFloor = room.floor_type === 'panel' || room.floor_type === 'Panel';
        // Check if room has slab floor type
        const isSlabFloor = room.floor_type === 'slab' || room.floor_type === 'Slab';
        // Check if room has none floor type (no plan needed)
        const isNoneFloor = room.floor_type === 'none' || room.floor_type === 'None';
        console.log(`  - Room ${room.id} floor type check: '${room.floor_type}' -> isPanelFloor: ${isPanelFloor}, isSlabFloor: ${isSlabFloor}`);
        
        if (isSlabFloor) {
            // For slab rooms, show slab calculation message
            console.log(`  - Room ${room.id} has floor type '${room.floor_type}' - showing slab calculation message`);
            drawSlabCalculationMessage(ctx, room);
            return;
        }
        
        if (!isPanelFloor) {
            // For non-panel rooms
            if (isNoneFloor) {
                // Show a specific "No floor plan needed" message placed like slab text
                console.log(`  - Room ${room.id} has floor type 'None' - showing no plan needed message`);
                drawNoPlanNeededMessage(ctx, room);
            } else {
                // Generic message for other types
                console.log(`  - Room ${room.id} has floor type '${room.floor_type}' - showing no floor plan message`);
                drawNoFloorPlanMessage(ctx, room);
            }
            return;
        }
        
        // For panel rooms, check if panels exist
        const roomPanels = effectiveFloorPanelsMap[room.id] || [];
        // console.log(`  - Room panels found:`, roomPanels);
        // console.log(`  - effectiveFloorPanelsMap keys:`, Object.keys(effectiveFloorPanelsMap));
        // console.log(`  - Looking for room ID:`, room.id);
        // console.log(`  - All room IDs:`, rooms?.map(r => r.id));
        // console.log(`  - All panel room IDs:`, floorPanels?.map(p => p.room_id || p.room));
        
        if (!roomPanels || roomPanels.length === 0) {
            // console.log(`  - No floor panels found for room ${room.id} - showing no floor plan message`);
            // console.log(`  - This might mean: 1) No panels generated, 2) Panel data not loaded, 3) Room ID mismatch`);
            // console.log(`  - Available panels:`, floorPanels);
            drawNoFloorPlanMessage(ctx, room);
            return;
        }

        // console.log(`  - Drawing ${roomPanels.length} panels for room ${room.id}`);
        // console.log(`  - All panels for this room:`, roomPanels);
        
        // Draw all panels for this room
        roomPanels.forEach((panel, index) => {
            // console.log(`  - Panel ${index + 1}:`, panel);
            // console.log(`  - Panel properties:`, {
            //     start_x: panel.start_x,
            //     start_y: panel.start_y,
            //     width: panel.width,
            //     length: panel.length,
            //     is_cut_panel: panel.is_cut_panel,
            //     panel_id: panel.panel_id
            // });
            
            // Check if panel has required properties
            // console.log(`  - Panel ${index + 1} full object:`, JSON.stringify(panel, null, 2));
            if (panel.start_x === null || panel.start_x === undefined || 
                panel.start_y === null || panel.start_y === undefined || 
                panel.width === null || panel.width === undefined || 
                panel.length === null || panel.length === undefined) {
                // console.log(`  - ⚠️ Panel ${index + 1} missing required properties:`, {
                //     start_x: panel.start_x,
                //     start_y: panel.start_y,
                //     width: panel.width,
                //     length: panel.length
                // });
                // console.log(`  - Panel ${index + 1} property types:`, {
                //     start_x: typeof panel.start_x,
                //     start_y: typeof panel.start_y,
                //     width: typeof panel.width,
                //     length: typeof panel.length
                // });
                return;
            }
            
            // Panel fill
            ctx.fillStyle = panel.is_cut_panel ? 'rgba(34, 197, 94, 0.5)' : 'rgba(59, 130, 246, 0.5)';
            
            // Panel border
            ctx.strokeStyle = panel.is_cut_panel ? '#22c55e' : '#3b82f6';
            ctx.lineWidth = 10 * scaleFactor.current; // Increased from 1 to 3 for better visibility
            
            // Calculate panel position and dimensions
            const panelX = panel.start_x * scaleFactor.current + offsetX.current;
            const panelY = panel.start_y * scaleFactor.current + offsetY.current;
            const panelWidth = panel.width * scaleFactor.current;
            const panelLength = panel.length * scaleFactor.current;
            
            // console.log(`  - Panel ${index + 1} position: x=${panelX}, y=${panelY}, w=${panelWidth}, h=${panelLength}`);
            // console.log(`  - Panel ${index + 1} raw coordinates: start_x=${panel.start_x}, start_y=${panel.start_y}, width=${panel.width}, length=${panel.length}`);
            // console.log(`  - Panel ${index + 1} scaled coordinates: scale=${scaleFactor.current}, offsetX=${offsetX.current}, offsetY=${offsetY.current}`);
            
            // Draw panel
            ctx.beginPath();
            ctx.rect(panelX, panelY, panelWidth, panelLength);
            ctx.fill();
            ctx.stroke();
            
            // Panel ID
            // ctx.fillStyle = '#1f2937';
            // ctx.font = `${Math.max(10, 12 * scaleFactor.current)}px Arial`;
            // ctx.textAlign = 'center';
            // ctx.textBaseline = 'middle';
            // const centerX = panelX + (panelWidth / 2);
            // const centerY = panelY + (panelLength / 2);
            // ctx.fillText(panel.panel_id, centerX, centerY);
            
            // console.log(`  - Panel ${index + 1} drawn successfully`);
        });
    };
    
    // Draw "No floor plan available" message for non-panel rooms
    const drawNoFloorPlanMessage = (ctx, room) => {
        // Calculate room center for message placement
        const centerX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
        const centerY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
        
        const messageX = centerX * scaleFactor.current + offsetX.current;
        const messageY = centerY * scaleFactor.current + offsetY.current;
        
        // Draw background rectangle for better readability
        const messageText = 'No floor plan available';
        ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        const textMetrics = ctx.measureText(messageText);
        const textWidth = textMetrics.width;
        const textHeight = 20 * scaleFactor.current;
        
        // Background rectangle
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(
            messageX - textWidth/2 - 10 * scaleFactor.current,
            messageY - textHeight/2 - 5 * scaleFactor.current,
            textWidth + 20 * scaleFactor.current,
            textHeight + 10 * scaleFactor.current
        );
        
        // Border
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1 * scaleFactor.current;
        ctx.strokeRect(
            messageX - textWidth/2 - 10 * scaleFactor.current,
            messageY - textHeight/2 - 5 * scaleFactor.current,
            textWidth + 20 * scaleFactor.current,
            textHeight + 10 * scaleFactor.current
        );
        
        // Text
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(messageText, messageX, messageY);
    };

    // Draw slab calculation message for slab floor rooms
    const drawSlabCalculationMessage = (ctx, room) => {
        // Use stored label position from wall plan if available, otherwise calculate center
        let labelX, labelY;
        
        if (room.label_position && room.label_position.x !== undefined && room.label_position.y !== undefined) {
            // Use stored position from wall plan (Canvas2D) - same as room name
            labelX = room.label_position.x;
            labelY = room.label_position.y;
        } else {
            // Fallback: calculate geometric center
            labelX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
            labelY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
        }
        
        // Position slab message below room name (offset by line height)
        const messageX = labelX * scaleFactor.current + offsetX.current;
        const lineHeight = Math.max(16, 18 * scaleFactor.current); // Line spacing
        const messageY = labelY * scaleFactor.current + offsetY.current + lineHeight;
        
        // Calculate room area
        const roomArea = calculateRoomArea(room);
        
        // Calculate slabs needed (each slab is 1210 x 3000 mm = 3.63 m²)
        const slabArea = 1210 * 3000; // mm²
        const slabsNeeded = Math.ceil(roomArea / slabArea);
        
        // Create message text
        const messageText = `Est. ${slabsNeeded} pieces of slab needed`;
        
        // Use smaller font size (matching room name: 14-16px instead of 18-22px)
        ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        const textMetrics = ctx.measureText(messageText);
        const textWidth = textMetrics.width;
        const textHeight = 16 * scaleFactor.current;
        
        // Background rectangle with consistent padding (8px like dimension labels)
        const paddingH = 8 * scaleFactor.current;
        const paddingV = 6 * scaleFactor.current;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(
            messageX - textWidth/2 - paddingH,
            messageY - textHeight/2 - paddingV,
            textWidth + paddingH * 2,
            textHeight + paddingV * 2
        );
        
        // Border
        ctx.strokeStyle = '#10b981'; // Green border for slab rooms
        ctx.lineWidth = 1 * scaleFactor.current;
        ctx.strokeRect(
            messageX - textWidth/2 - paddingH,
            messageY - textHeight/2 - paddingV,
            textWidth + paddingH * 2,
            textHeight + paddingV * 2
        );
        
        // Text
        ctx.fillStyle = '#10b981'; // Green text for slab rooms
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(messageText, messageX, messageY);
    };

    // Draw "No floor plan needed" message for rooms with floor_type None
    const drawNoPlanNeededMessage = (ctx, room) => {
        // Use stored label position from wall plan if available, otherwise calculate center
        let labelX, labelY;
        
        if (room.label_position && room.label_position.x !== undefined && room.label_position.y !== undefined) {
            // Use stored position from wall plan (Canvas2D) - same as room name
            labelX = room.label_position.x;
            labelY = room.label_position.y;
        } else {
            // Fallback: calculate geometric center
            labelX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
            labelY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
        }
        
        // Position message below room name (offset by line height), same as slab text
        const messageX = labelX * scaleFactor.current + offsetX.current;
        const lineHeight = Math.max(16, 18 * scaleFactor.current); // Line spacing
        const messageY = labelY * scaleFactor.current + offsetY.current + lineHeight;
        
        const messageText = 'No floor plan needed';
        
        // Use similar styling as slab message
        ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        const textMetrics = ctx.measureText(messageText);
        const textWidth = textMetrics.width;
        const textHeight = 16 * scaleFactor.current;
        
        const paddingH = 8 * scaleFactor.current;
        const paddingV = 6 * scaleFactor.current;
        
        // Background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(
            messageX - textWidth/2 - paddingH,
            messageY - textHeight/2 - paddingV,
            textWidth + paddingH * 2,
            textHeight + paddingV * 2
        );
        
        // Border and text color: use a neutral gray to distinguish from slab (green)
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 1 * scaleFactor.current;
        ctx.strokeRect(
            messageX - textWidth/2 - paddingH,
            messageY - textHeight/2 - paddingV,
            textWidth + paddingH * 2,
            textHeight + paddingV * 2
        );
        
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(messageText, messageX, messageY);
    };

    // Draw title and info
    const drawTitle = (ctx) => {
        ctx.fillStyle = '#374151';
        ctx.font = `bold ${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Floor Plan', 20, 20);
        
        // Draw scale info
        ctx.font = `${Math.max(14, 200 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.fillText(`Scale: ${scaleFactor.current.toFixed(2)}x`, 20, 50);
    };

    // Helper function to calculate room area using shoelace formula
    const calculateRoomArea = (room) => {
        if (!room.room_points || room.room_points.length < 3) return 0;
        
        // Use shoelace formula to calculate polygon area
        let area = 0;
        const points = room.room_points;
        
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        
        // Return absolute value and divide by 2 (shoelace formula)
        return Math.abs(area) / 2;
    };

    // Draw floor dimensions (cut panels and room dimensions only)
    const drawFloorDimensions = (ctx) => {
        if (!modelBounds) return;

        const placedLabels = [];
        const allLabels = []; // Will store labels for PASS 2 (text boxes)
        const drawnDimensions = new Set(); // Track drawn dimensions to avoid duplicates
        const globalDimensionTracker = new Map(); // Track dimensions globally across all rooms

        // PASS 1: Draw dimension LINES and collect text box info
        // Draw room dimensions (project room dimensions)
        if (rooms && rooms.length > 0) {
            rooms.forEach(room => {
                if (!room.room_points || room.room_points.length < 3) return;

                // Calculate room bounds
                const xCoords = room.room_points.map(p => p.x);
                const yCoords = room.room_points.map(p => p.y);
                const roomMinX = Math.min(...xCoords);
                const roomMaxX = Math.max(...xCoords);
                const roomMinY = Math.min(...yCoords);
                const roomMaxY = Math.max(...yCoords);

                const roomWidth = roomMaxX - roomMinX;
                const roomHeight = roomMaxY - roomMinY;

                // Room width dimension (horizontal) - place BELOW the room
                const widthDimension = {
                    startX: roomMinX,
                    endX: roomMaxX,
                    startY: roomMaxY + 20, // Offset below room for better visibility
                    endY: roomMaxY + 20,
                    dimension: roomWidth,
                    type: 'room_width',
                    color: '#1e40af', // Blue for room dimensions
                    priority: 1,
                    avoidArea: projectBounds,
                    drawnPositions: new Set(),
                    roomId: room.id,
                    isHorizontal: true // Force horizontal dimension line
                };

                // Room height dimension (vertical) - place to the LEFT of the room
                const heightDimension = {
                    startX: roomMinX - 20, // Offset left of room for better visibility
                    endX: roomMinX - 20,
                    startY: roomMinY,
                    endY: roomMaxY,
                    dimension: roomHeight,
                    type: 'room_height',
                    color: '#1e40af', // Blue for room dimensions
                    priority: 1,
                    avoidArea: projectBounds,
                    drawnPositions: new Set(),
                    roomId: room.id,
                    isHorizontal: false // Force vertical dimension line
                };

                // Check if these dimensions are already drawn globally
                const widthGlobalKey = `room_width_${Math.round(roomWidth)}`;
                const heightGlobalKey = `room_height_${Math.round(roomHeight)}`;
                
                if (!globalDimensionTracker.has(widthGlobalKey)) {
                    drawRoomDimensions(ctx, widthDimension, projectBounds, placedLabels, allLabels);
                    globalDimensionTracker.set(widthGlobalKey, true);
                }
                
                if (!globalDimensionTracker.has(heightGlobalKey)) {
                    drawRoomDimensions(ctx, heightDimension, projectBounds, placedLabels, allLabels);
                    globalDimensionTracker.set(heightGlobalKey, true);
                }
            });
        }

        // Draw cut panel dimensions only (no grouped panel dimensions)
        if (rooms && rooms.length > 0) {
            rooms.forEach(room => {
                const roomPanels = effectiveFloorPanelsMap[room.id] || [];
                if (roomPanels.length === 0) return;

                // Only show dimensions for panel floors
                const isPanelFloor = room.floor_type === 'panel' || room.floor_type === 'Panel';
                if (!isPanelFloor) return;

                drawPanelDimensions(ctx, room, roomPanels, placedLabels, allLabels, drawnDimensions, globalDimensionTracker);
            });
        }
        
        // Return allLabels for PASS 2 (drawing text boxes on top)
        return allLabels;
    };

    // PASS 2: Draw dimension text box (called after all lines are drawn)
    const drawDimensionTextBox = (ctx, label) => {
        if (!label) return;
        
        ctx.save();
        
        const { x, y, width, height, text, color, labelX, labelY, isHorizontal } = label;
        
        // Draw background
        ctx.fillStyle = `rgba(255, 255, 255, ${DIMENSION_CONFIG.BACKGROUND_OPACITY})`;
        ctx.fillRect(x, y, width, height);
        
        // Draw border
        ctx.strokeStyle = color;
        ctx.lineWidth = DIMENSION_CONFIG.LABEL_BORDER_WIDTH;
        ctx.strokeRect(x, y, width, height);
        
        // Draw text
        ctx.fillStyle = color;
        const fontSize = Math.max(DIMENSION_CONFIG.FONT_SIZE_MIN, DIMENSION_CONFIG.FONT_SIZE * scaleFactor.current);
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

    // PASS 1: Draw dimension LINES (helper function) - text boxes drawn later
    const drawRoomDimensions = (ctx, dimension, bounds, placedLabels, allLabels) => {
        const { startX, endX, startY, endY, dimension: length, color, avoidArea } = dimension;
        const { minX, maxX, minY, maxY } = bounds || modelBounds || {};
        
        if (!bounds && !modelBounds) return;

        // Use explicit isHorizontal property if provided, otherwise calculate from coordinates
        let isHorizontal;
        if (dimension.isHorizontal !== undefined) {
            isHorizontal = dimension.isHorizontal;
        } else {
            // Calculate dimension line properties
            const dx = endX - startX;
            const dy = endY - startY;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            
            // Determine if dimension is horizontal or vertical
            isHorizontal = Math.abs(angle) < 45 || Math.abs(angle) > 135;
        }
        
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        
        // Determine optimal label position
        let labelX, labelY;
        let baseOffset = DIMENSION_CONFIG.BASE_OFFSET; // Use config for consistency
        let offset = baseOffset;
        let attempts = 0;
        const maxAttempts = DIMENSION_CONFIG.MAX_ATTEMPTS;
        
        // Initialize text and labelBounds variables
        let text;
        if (dimension.type === 'cut_panel' || dimension.isCut) {
            // Cut panel dimension label should match ceiling plan format: "320mm (CUT)"
            text = `${Math.round(length)}mm (CUT)`;
        } else if (dimension.quantity && dimension.quantity > 1) {
            // Grouped panel dimension: show "n × A" format
            text = `${dimension.quantity} × ${Math.round(length)}mm`;
        } else {
            // Regular dimension: show just the value
            text = `${Math.round(length)}mm`;
        }
        let textWidth = ctx.measureText(text).width;
        let labelBounds;
        
        do {
            if (isHorizontal) {
                // Horizontal dimension: place ABOVE or BELOW
                const projectMidY = avoidArea ? (avoidArea.minY + avoidArea.maxY) / 2 : (minY + maxY) / 2;
                const isTopHalf = midY < projectMidY;
                
                if (avoidArea) {
                    labelY = isTopHalf ? 
                        (avoidArea.minY * scaleFactor.current + offsetY.current - offset) : 
                        (avoidArea.maxY * scaleFactor.current + offsetY.current + offset);
                } else {
                    labelY = isTopHalf ? 
                        (minY * scaleFactor.current + offsetY.current - offset) : 
                        (maxY * scaleFactor.current + offsetY.current + offset);
                }
                labelX = midX * scaleFactor.current + offsetX.current;
            } else {
                // Vertical dimension: place to LEFT or RIGHT
                const verticalOffset = Math.max(offset, DIMENSION_CONFIG.MIN_VERTICAL_OFFSET); // Use config for consistency
                const projectMidX = avoidArea ? (avoidArea.minX + avoidArea.maxX) / 2 : (minX + maxX) / 2;
                const isLeftHalf = midX < projectMidX;
                
                if (avoidArea) {
                    labelX = isLeftHalf ? 
                        (avoidArea.minX * scaleFactor.current + offsetX.current - verticalOffset) : 
                        (avoidArea.maxX * scaleFactor.current + offsetX.current + verticalOffset);
                } else {
                    labelX = isLeftHalf ? 
                        (minX * scaleFactor.current + offsetX.current - verticalOffset) : 
                        (maxX * scaleFactor.current + offsetX.current + verticalOffset);
                }
                labelY = midY * scaleFactor.current + offsetY.current;
            }
            
            // Update text width and label bounds for this iteration
            textWidth = ctx.measureText(text).width;
            
            // Calculate label bounds using shared utility
            labelBounds = isHorizontal 
                ? calculateHorizontalLabelBounds(labelX, labelY, textWidth, 4, 8)
                : calculateVerticalLabelBounds(labelX, labelY, textWidth, 4, 8);
            
            // Check for overlaps using shared utility
            const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
            
            if (!hasOverlap) break;
            
            offset += DIMENSION_CONFIG.OFFSET_INCREMENT;
            attempts++;
        } while (attempts < maxAttempts);
        
        // Draw dimension lines
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = DIMENSION_CONFIG.LINE_WIDTH;
        
        if (isHorizontal) {
            // Extension lines (vertical)
            ctx.beginPath();
            ctx.setLineDash(DIMENSION_CONFIG.EXTENSION_DASH);
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(startX * scaleFactor.current + offsetX.current, labelY);
            ctx.moveTo(endX * scaleFactor.current + offsetX.current, endY * scaleFactor.current + offsetY.current);
            ctx.lineTo(endX * scaleFactor.current + offsetX.current, labelY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Main dimension line (horizontal)
            ctx.beginPath();
            ctx.lineWidth = DIMENSION_CONFIG.DIMENSION_LINE_WIDTH;
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, labelY);
            ctx.lineTo(endX * scaleFactor.current + offsetX.current, labelY);
            ctx.stroke();
        } else {
            // Extension lines (horizontal)
            ctx.beginPath();
            ctx.setLineDash(DIMENSION_CONFIG.EXTENSION_DASH);
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, startY * scaleFactor.current + offsetY.current);
            ctx.moveTo(endX * scaleFactor.current + offsetX.current, endY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, endY * scaleFactor.current + offsetY.current);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Main dimension line (vertical)
            ctx.beginPath();
            ctx.lineWidth = DIMENSION_CONFIG.DIMENSION_LINE_WIDTH;
            ctx.moveTo(labelX, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, endY * scaleFactor.current + offsetY.current);
            ctx.stroke();
        }
        
        // Store text box info for PASS 2 (draw text boxes AFTER all dimension lines)
        allLabels.push({
            x: labelBounds.x,
            y: labelBounds.y,
            width: labelBounds.width,
            height: labelBounds.height,
            text: text,
            color: color,
            labelX: labelX,
            labelY: labelY,
            isHorizontal: isHorizontal
        });
        
        // Add to placed labels for collision detection
        placedLabels.push(labelBounds);
        
        ctx.restore();
    };

    // Draw panel dimensions (grouped and cut panel dimensions) - exactly like ceiling plan
    const drawPanelDimensions = (ctx, room, roomPanels, placedLabels, allLabels, drawnDimensions, globalDimensionTracker) => {
        if (roomPanels.length === 0) return;

        // Group panels by dimensions (exactly like ceiling plan)
        // IMPORTANT: Only group FULL panels, exclude cut panels from grouping
        const panelsByDimension = new Map();
        const fullPanels = roomPanels.filter(panel => !panel.is_cut_panel);
        const cutPanels = roomPanels.filter(panel => panel.is_cut_panel);
        
        fullPanels.forEach(panel => {
            const isHorizontal = panel.width < panel.length;
            const groupingDimension = isHorizontal ? panel.length : panel.width;
            const dimensionValue = Math.round(groupingDimension * 100) / 100;
            
            if (!panelsByDimension.has(dimensionValue)) {
                panelsByDimension.set(dimensionValue, []);
            }
            panelsByDimension.get(dimensionValue).push(panel);
        });

        // For rooms with many panels, only show grouped dimensions to avoid clutter
        const shouldShowIndividual = roomPanels.length <= 20; // Same limit as ceiling plan
        
        const isHorizontalOrientation = roomPanels.length > 0 && 
            roomPanels[0].width < roomPanels[0].length;
        
        // Always show grouped dimensions for multiple panels with same dimension (length for horizontal, width for vertical)
        const drawnValues = new Set(); // Track dimension values to prevent duplicate measurements
        
        panelsByDimension.forEach((panels, dimensionValue) => {
            if (panels.length > 1) {
                // Multiple panels with same dimension - show grouped dimension
                
                // Create a unique key for this dimension to prevent duplicates
                const dimensionKey = `grouped_${dimensionValue}_${panels.length}`;
                const valueKey = `${dimensionValue}mm_${panels.length}`;
                
                // Check for duplicate values and positions
                if (drawnDimensions.has(dimensionKey) || drawnValues.has(valueKey)) return;
                
                drawnDimensions.add(dimensionKey);
                drawnValues.add(valueKey);
                
                // For horizontal panels, show length dimension (which becomes width in horizontal view)
                // For vertical panels, show width dimension (which stays as width in vertical view)
                if (!isHorizontalOrientation) {
                    // Vertical panels: show "n × width" on the side
                    drawGroupedPanelDimensions(ctx, panels, dimensionValue, placedLabels, allLabels, true, globalDimensionTracker);
                } else {
                    // Horizontal panels: show "n × length" on top/bottom (length becomes width in horizontal view)
                    drawGroupedPanelDimensions(ctx, panels, dimensionValue, placedLabels, allLabels, false, globalDimensionTracker);
                }
            } else if (panels.length === 1 && shouldShowIndividual) {
                // Single panel - show individual dimension (only if not too many panels)
                const panel = panels[0];
                
                // For individual panels, show the panel width (not length)
                const panelWidth = Math.round(panel.width * 100) / 100;
                
                // Only show dimensions for full panels (not cut panels - they're handled separately)
                if (!panel.is_cut_panel) {
                    // Create unique key for full panel dimension
                    const fullDimensionKey = `full_${panel.id}`;
                    const fullValueKey = `${panelWidth}mm_full`;
                    
                    // Check for duplicate full panel dimensions
                    if (drawnDimensions.has(fullDimensionKey) || drawnValues.has(fullValueKey)) return;
                    
                    drawnDimensions.add(fullDimensionKey);
                    drawnValues.add(fullValueKey);
                    
                    // Full panel: show normal individual dimension
                    const                         individualDimension = {
                            startX: panel.start_x,
                            endX: panel.start_x + panel.width,
                            startY: panel.start_y,
                            endY: panel.start_y + panel.length,
                            dimension: panelWidth,
                            type: 'individual_panel',
                            color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                        priority: 3,
                        avoidArea: projectBounds,
                        drawnPositions: new Set(),
                        roomId: room.id,
                        isHorizontal: false // Individual panel dimensions are always perpendicular to panel direction
                    };
                    
                    drawRoomDimensions(ctx, individualDimension, projectBounds, placedLabels, allLabels);
                }
            }
        });

        // Draw cut panel dimensions with RED color (exactly like ceiling plan)
        // cutPanels is already defined above from the filtering
        if (cutPanels.length > 0) {
            cutPanels.forEach(panel => {
                // For cut panels, show the correct dimension based on orientation
                // Horizontal orientation: show panel WIDTH (perpendicular to panel direction)
                // Vertical orientation: show panel LENGTH (perpendicular to panel direction)
                const isHorizontal = panel.width < panel.length;
                const dimensionValue = isHorizontal ? panel.width : panel.length; // Use width for horizontal, length for vertical
                
                // Create unique key for cut panel dimension
                const cutDimensionKey = `cut_${panel.id}`;
                const cutValueKey = `${dimensionValue}mm_cut`;
                
                // Check for duplicate cut panel dimensions
                if (drawnDimensions.has(cutDimensionKey) || drawnValues.has(cutValueKey)) return;
                
                drawnDimensions.add(cutDimensionKey);
                drawnValues.add(cutValueKey);
                
                // Cut panel: show individual dimension with RED color
                // Use same placement logic as grouped dimensions (n × A)
                let cutPanelDimension;
                
                // Use EXACT same placement logic as grouped dimensions (n × A)
                // The key insight: isHorizontal parameter in grouped dimensions refers to the DIMENSION LINE orientation
                // - isHorizontal = true → VERTICAL dimension line (for vertical panels)
                // - isHorizontal = false → HORIZONTAL dimension line (for horizontal panels)
                if (isHorizontal) {
                    // Horizontal panel: should create HORIZONTAL dimension line (same as grouped dimensions)
                    // Same as grouped dimensions: horizontal line spanning minX to maxX, at centerY
                    const minX = panel.start_x;
                    const maxX = panel.start_x + panel.width;
                    const centerY = panel.start_y + (panel.length / 2); // Center vertically
                    
                    cutPanelDimension = {
                        startX: minX,
                        endX: maxX,
                        startY: centerY,
                        endY: centerY,
                        dimension: dimensionValue, // This is panel.width for horizontal panels
                        type: 'cut_panel',
                        color: '#dc2626', // RED for cut panels
                        priority: 4, // Lower priority than full panels
                        avoidArea: projectBounds,
                        drawnPositions: new Set(),
                        roomId: room.id,
                        isHorizontal: true, // This dimension line is HORIZONTAL (same as grouped dimensions for horizontal panels)
                        isCut: true
                    };
                } else {
                    // Vertical panel: should create VERTICAL dimension line (same as grouped dimensions)
                    // Same as grouped dimensions: vertical line at centerX, spanning minY to maxY
                    const centerX = panel.start_x + (panel.width / 2); // Center horizontally
                    const minY = panel.start_y;
                    const maxY = panel.start_y + panel.length;
                    
                    cutPanelDimension = {
                        startX: centerX,
                        endX: centerX,
                        startY: minY,
                        endY: maxY,
                        dimension: dimensionValue, // This is panel.length for vertical panels
                        type: 'cut_panel',
                        color: '#dc2626', // RED for cut panels
                        priority: 4, // Lower priority than full panels
                        avoidArea: projectBounds,
                        drawnPositions: new Set(),
                        roomId: room.id,
                        isHorizontal: false, // This dimension line is VERTICAL (same as grouped dimensions for vertical panels)
                        isCut: true
                    };
                }
                
                // Draw cut panel dimension
                drawRoomDimensions(ctx, cutPanelDimension, projectBounds, placedLabels, allLabels);
            });
        }
    };

    // Draw grouped panel dimensions (for both horizontal and vertical panels) - exactly like ceiling plan
    const drawGroupedPanelDimensions = (ctx, panels, width, placedLabels, allLabels, isHorizontal = false, globalDimensionTracker) => {
        // For grouped panel dimensions, we want to show BOTH WIDTH and LENGTH dimensions
        // This means for horizontal panels, show both width (horizontally) and length (vertically)
        // For vertical panels, show both width (horizontally) and length (vertically)
        
        if (isHorizontal) {
            // Horizontal panels: show BOTH dimensions
            // Find the center and bounds of the panel group
            const centerX = (Math.min(...panels.map(p => p.start_x)) + Math.max(...panels.map(p => p.start_x + p.width))) / 2;
            const centerY = (Math.min(...panels.map(p => p.start_y)) + Math.max(...panels.map(p => p.start_y + p.length))) / 2;
            const minX = Math.min(...panels.map(p => p.start_x));
            const maxX = Math.max(...panels.map(p => p.start_x + p.width));
            const minY = Math.min(...panels.map(p => p.start_y));
            const maxY = Math.max(...panels.map(p => p.start_y + p.length));
            
            // 1. Panel LENGTH dimension (vertical) - shows how tall each panel is
            const panelLength = panels[0].length;
            const lengthDimension = {
                startX: centerX,
                endX: centerX,
                startY: minY,
                endY: maxY,
                dimension: panelLength,
                type: 'grouped_length_horizontal',
                color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                priority: 2,
                avoidArea: projectBounds,
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: false // This dimension line is vertical
            };
            
            // 2. Panel WIDTH dimension (horizontal) - shows how wide each panel is
            const panelWidth = panels[0].width;
            const widthDimension = {
                startX: minX,
                endX: maxX,
                startY: centerY,
                endY: centerY,
                dimension: panelWidth,
                type: 'grouped_width_horizontal',
                color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                priority: 2,
                avoidArea: projectBounds,
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: true // This dimension line is horizontal
            };
            
            // Draw both dimensions
            drawRoomDimensions(ctx, lengthDimension, projectBounds, placedLabels, allLabels);
            drawRoomDimensions(ctx, widthDimension, projectBounds, placedLabels, allLabels);
        } else {
            // Vertical panels: show BOTH dimensions
            // Find the center and bounds of the panel group
            const centerX = (Math.min(...panels.map(p => p.start_x)) + Math.max(...panels.map(p => p.start_x + p.width))) / 2;
            const centerY = (Math.min(...panels.map(p => p.start_y)) + Math.max(...panels.map(p => p.start_y + p.length))) / 2;
            const minX = Math.min(...panels.map(p => p.start_x));
            const maxX = Math.max(...panels.map(p => p.start_x + p.width));
            const minY = Math.min(...panels.map(p => p.start_y));
            const maxY = Math.max(...panels.map(p => p.start_y + p.length));
            
            // 1. Panel WIDTH dimension (horizontal) - shows how wide each panel is
            const actualPanelWidth = panels[0].width;
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
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: true // This dimension line is horizontal
            };
            
            // 2. Panel LENGTH dimension (vertical) - shows how long each panel is
            const panelLength = panels[0].length;
            const lengthDimension = {
                startX: centerX,
                endX: centerX,
                startY: minY,
                endY: maxY,
                dimension: panelLength,
                type: 'grouped_length_vertical',
                color: DIMENSION_CONFIG.COLORS.PANEL_GROUP, // Grey for panel dimensions
                priority: 2,
                avoidArea: projectBounds,
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: false // This dimension line is vertical
            };
            
            // Draw both dimensions
            drawRoomDimensions(ctx, widthDimension, projectBounds, placedLabels, allLabels);
            drawRoomDimensions(ctx, lengthDimension, projectBounds, placedLabels, allLabels);
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

    // Zoom in function
    const handleZoomIn = () => {
        console.log('🔍 Zoom In clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        
        const newScale = Math.min(3.0, scaleFactor.current * 1.2);
        console.log('Calculated new scale:', newScale);
        
        zoomToCenter(newScale);
    };

    // Zoom out function
    const handleZoomOut = () => {
        console.log('🔍 Zoom Out clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        console.log('Current initial scale:', initialScale.current);
        
        // Use the initial scale as the minimum instead of hardcoded 0.1
        const newScale = Math.max(initialScale.current, scaleFactor.current * 0.8);
        console.log('Calculated new scale:', newScale);
        
        zoomToCenter(newScale);
    };

    // Reset zoom function
    const handleResetZoom = () => {
        console.log('Reset Zoom clicked, resetting zoom flag');
        isZoomed.current = false; // Reset zoom flag so calculateCanvasTransform can set optimal scale
        calculateCanvasTransform();
        // Redraw after transform calculation
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            drawCanvas(ctx);
        }
    };

    // Mouse wheel zoom - DISABLED
    const handleWheel = (e) => {
        e.preventDefault();
        // Zoom disabled - use buttons only
    };

    // Mouse drag pan
    const handleMouseDown = (e) => {
        // Start canvas dragging by default
        isDraggingCanvas.current = true;
        lastCanvasMousePos.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    };

    const handleMouseMove = (e) => {
        // Handle canvas dragging
        if (isDraggingCanvas.current) {
            const deltaX = e.clientX - lastCanvasMousePos.current.x;
            const deltaY = e.clientY - lastCanvasMousePos.current.y;
            
            offsetX.current += deltaX;
            offsetY.current += deltaY;
            
            lastCanvasMousePos.current = { x: e.clientX, y: e.clientY };
            
            // Redraw canvas
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                drawCanvas(ctx);
            }
            return;
        }
        
        // Handle other dragging (existing functionality)
        if (!isDragging.current) return;
        
        const deltaX = e.clientX - lastMousePos.current.x;
        const deltaY = e.clientY - lastMousePos.current.y;
        
        offsetX.current += deltaX;
        offsetY.current += deltaY;
        
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        
        // Redraw
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

    // Panel click detection
    const handleCanvasClick = (e) => {
        // Don't handle clicks if we were dragging the canvas
        if (isDraggingCanvas.current) {
            return;
        }
        
        const rect = canvasRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Check if clicked on a panel
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
                    // Panel clicked - you can add panel selection logic here
                    console.log('Panel clicked:', panel);
                    return;
                }
            }
        }
    };

    const panelCounts = getAccuratePanelCounts();

    // Generate panel list for floor plan (like ceiling plan)
    const generatePanelList = () => {
        const panelList = [];
        
        // Process each room's panels
        Object.entries(effectiveFloorPanelsMap).forEach(([roomId, roomPanels]) => {
            if (!roomPanels || roomPanels.length === 0) return;
            
            // Group panels by dimensions
            const panelsByDimension = new Map();
            roomPanels.forEach(panel => {
                const isHorizontal = panel.width < panel.length;
                const groupingDimension = isHorizontal ? panel.length : panel.width;
                const dimensionValue = Math.round(groupingDimension * 100) / 100;
                
                if (!panelsByDimension.has(dimensionValue)) {
                    panelsByDimension.set(dimensionValue, []);
                }
                panelsByDimension.get(dimensionValue).push(panel);
            });
            
            // Create panel list entries
            panelsByDimension.forEach((panels, dimension) => {
                const fullPanels = panels.filter(p => !p.is_cut_panel);
                const cutPanels = panels.filter(p => p.is_cut_panel);
                
                // Get the room for this panel to access floor_thickness
                const room = rooms.find(r => r.id === parseInt(roomId));
                const floorThickness = room?.floor_thickness || 20; // Default to 20mm if not specified
                
                if (fullPanels.length > 0) {
                    const panel = fullPanels[0];
                    const isVertical = panel.width >= panel.length;
                    
                    // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
                    let displayWidth = panel.width;
                    let displayLength = panel.length;
                    
                    if (isVertical) {
                        // Swap values for vertical orientation
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
                    
                    // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
                    let displayWidth = panel.width;
                    let displayLength = panel.length;
                    
                    if (isVertical) {
                        // Swap values for vertical orientation
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

    // State for panel table visibility
    const [showPanelTable, setShowPanelTable] = useState(false);

    // Calculate panel floor area from actual panel data (not dependent on floorPlan)
    const calculatePanelFloorArea = () => {
        let totalArea = 0;
        
        // Calculate area from all panel floor rooms
        Object.entries(effectiveFloorPanelsMap).forEach(([roomId, roomPanels]) => {
            if (roomPanels && roomPanels.length > 0) {
                roomPanels.forEach(panel => {
                    // Calculate area in mm², then convert to m²
                    const panelArea = panel.width * panel.length;
                    totalArea += panelArea;
                });
            }
        });
        
        // Convert from mm² to m²
        return totalArea / 1000000;
    };

    return (
        <div className="floor-canvas-container">
            {/* Canvas Container with Right Side Summary */}
            <div className="flex gap-6">
                {/* Main Canvas */}
                <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg flex-1">
                    <div
                        ref={canvasContainerRef}
                        className="relative"
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
                    
                    {/* Canvas Controls */}
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

                {/* Right Side Floor Plan Summary */}
                <div className="w-80 bg-white border-2 border-gray-200 rounded-xl shadow-lg p-6 h-fit">
                    <div className="flex items-center mb-4">
                        <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <h3 className="text-lg font-semibold text-gray-900">Floor Plan</h3>
                    </div>
                    
                    <div className="space-y-4">
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
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-sm text-gray-600">Waste %</div>
                                <div className="text-xl font-semibold text-red-600">
                                    {(() => {
                                        console.log('🔍 [FLOOR UI] Displaying project-wide waste percentage...');
                                        console.log('🔍 [FLOOR UI] projectWastePercentage (prop):', projectWastePercentage);
                                        console.log('🔍 [FLOOR UI] floorPlan:', floorPlan);
                                        console.log('🔍 [FLOOR UI] floorPlan.summary:', floorPlan?.summary);
                                        
                                        // 1) Prefer the latest project-wide waste provided by manager (from POST or initial load)
                                        if (projectWastePercentage !== undefined && projectWastePercentage !== null) {
                                            console.log('✅ [FLOOR UI] Using projectWastePercentage prop:', projectWastePercentage);
                                            return `${Number(projectWastePercentage).toFixed(1)}%`;
                                        }
                                        
                                        // 2) Fallback to value embedded in the plan summary
                                        if (floorPlan?.summary?.project_waste_percentage !== undefined && floorPlan?.summary?.project_waste_percentage !== null) {
                                            console.log('✅ [FLOOR UI] Using floorPlan.summary.project_waste_percentage:', floorPlan.summary.project_waste_percentage);
                                            return `${floorPlan.summary.project_waste_percentage.toFixed(1)}%`;
                                        }
                                        
                                        // 3) Legacy fallback to individual room waste percentage
                                        if (floorPlan?.waste_percentage !== undefined && floorPlan?.waste_percentage !== null) {
                                            console.log('⚠️ [FLOOR UI] Fallback to floorPlan.waste_percentage:', floorPlan.waste_percentage);
                                            return `${floorPlan.waste_percentage.toFixed(1)}%`;
                                        }
                                        
                                        console.log('❌ [FLOOR UI] No valid waste data found, returning 0%');
                                        return '0%';
                                    })()}
                                </div>
                            </div>
                        </div>
                        
                        <div>
                            <div className="text-sm text-gray-600">Recommended</div>
                            <div className="text-lg font-semibold text-green-600">
                                {(() => {
                                    // Get recommended strategy from system analysis (NOT current selection)
                                    // Priority: Use the system's recommendation, never use strategy_used
                                    const recommended = floorPlan?.summary?.recommended_strategy || 
                                                      floorPlan?.recommended_strategy || 
                                                      orientationAnalysis?.recommended_strategy || 
                                                      'auto';
                                    
                                    console.log('🎯 [UI] Floor Plan System Recommended Strategy:', recommended);
                                    console.log('🎯 [UI] Floor Plan Currently Selected Strategy:', floorPlan?.strategy_used);
                                    
                                    // Format strategy name for display
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
                        
                            <div className="pt-4 border-t border-gray-200">
                             <div className="text-sm text-gray-600">Panel Floor Area</div>
                             <div className="text-lg font-semibold text-gray-900">
                                 {(() => {
                                     // Calculate area from actual panel data (more reliable than floorPlan.total_area)
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
                         
                         <div className="pt-4 border-t border-gray-200">
                             <div className="text-sm text-gray-600">Slab Floor Summary</div>
                             <div className="text-lg font-semibold text-green-600">
                                 {(() => {
                                     const slabRooms = rooms?.filter(room => 
                                         room.floor_type === 'slab' || room.floor_type === 'Slab'
                                     ) || [];
                                     
                                     if (slabRooms.length === 0) return 'No slab floors';
                                     
                                     // Calculate total slabs needed for all slab rooms
                                     let totalSlabs = 0;
                                     let totalArea = 0;
                                     
                                     slabRooms.forEach(room => {
                                         const roomArea = calculateRoomArea(room);
                                         const slabArea = 1210 * 3000; // mm²
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
                        
                        {/* Dimension Legend - Moved to right sidebar */}
                        <div className="mt-6 pt-4 border-t border-gray-200">
                            <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
                                <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Dimension Legend
                            </h4>
                                                         <div className="space-y-3 text-sm">
                                 <div className="flex items-center">
                                     <div className="w-4 h-4 bg-blue-600 rounded mr-3"></div>
                                     <span className="text-gray-700">Room Dimensions</span>
                                 </div>
                                 <div className="flex items-center">
                                     <div className="w-4 h-4 bg-gray-600 rounded mr-3"></div>
                                     <span className="text-gray-700">Panel Dimensions</span>
                                 </div>
                                 <div className="flex items-center">
                                     <div className="w-4 h-4 bg-red-600 rounded mr-3"></div>
                                     <span className="text-gray-700">Cut Panel Dimensions</span>
                                 </div>
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

            {/* Panel Table Section */}
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
                        {/* Floor Panels Table */}
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

                        {/* Slab Floors Table */}
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
                                                const slabArea = 1210 * 3000; // mm²
                                                const slabsNeeded = Math.ceil(roomArea / slabArea);
                                                
                                                return (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                                            {room.room_name || `Room ${room.id}`}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {(roomArea / 1000000).toFixed(2)}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            1210 × 3000
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
