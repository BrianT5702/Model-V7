import React, { useRef, useEffect, useMemo, useState } from 'react';
import { calculateOffsetPoints } from './drawing.js';

const FloorCanvas = ({ 
    rooms, 
    walls, 
    intersections, 
    floorPlan, 
    floorPanels, 
    projectData, 
    floorPanelsMap,
    orientationAnalysis 
}) => {
    const canvasRef = useRef(null);
    const [currentScale, setCurrentScale] = useState(1);
    
    // Canvas state refs - same as CeilingCanvas
    const scaleFactor = useRef(1);
    const initialScale = useRef(1); // Track the initial scale
    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const isDragging = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const isZoomed = useRef(false); // Track if user has manually zoomed

    // Canvas dimensions - match CeilingCanvas for consistency
    const CANVAS_WIDTH = 800;
    const CANVAS_HEIGHT = 600;
    const PADDING = 50;

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

    }, [rooms, walls, intersections, floorPlan, floorPanels, effectiveFloorPanelsMap]);

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

        // Center all rooms
        const scaledWidth = totalWidth * optimalScale;
        const scaledHeight = totalHeight * optimalScale;
        
        offsetX.current = (CANVAS_WIDTH - scaledWidth) / 2 - minX * optimalScale;
        offsetY.current = (CANVAS_HEIGHT - scaledHeight) / 2 - minY * optimalScale;
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
            
            // Draw dimensions for walls and rooms
            drawFloorDimensions(ctx);
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

        // Add room name label
        if (room.room_name) {
            const centerX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
            const centerY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
            
            ctx.fillStyle = '#6b7280';
            ctx.font = `bold ${Math.max(14, 16 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(room.room_name, centerX * scaleFactor.current + offsetX.current, centerY * scaleFactor.current + offsetY.current);
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

        // Create empty joints array (not used in floor plan but required by drawWallCaps)
        // const joints = []; // Unused variable
        
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
        console.log(`  - Room ${room.id} floor type check: '${room.floor_type}' -> isPanelFloor: ${isPanelFloor}, isSlabFloor: ${isSlabFloor}`);
        
        if (isSlabFloor) {
            // For slab rooms, show slab calculation message
            console.log(`  - Room ${room.id} has floor type '${room.floor_type}' - showing slab calculation message`);
            drawSlabCalculationMessage(ctx, room);
            return;
        }
        
        if (!isPanelFloor) {
            // For non-panel rooms, show "No floor plan available" message
            console.log(`  - Room ${room.id} has floor type '${room.floor_type}' - showing no floor plan message`);
            drawNoFloorPlanMessage(ctx, room);
            return;
        }
        
        // For panel rooms, check if panels exist
        const roomPanels = effectiveFloorPanelsMap[room.id] || [];
        console.log(`  - Room panels found:`, roomPanels);
        console.log(`  - effectiveFloorPanelsMap keys:`, Object.keys(effectiveFloorPanelsMap));
        console.log(`  - Looking for room ID:`, room.id);
        console.log(`  - All room IDs:`, rooms?.map(r => r.id));
        console.log(`  - All panel room IDs:`, floorPanels?.map(p => p.room_id || p.room));
        
        if (!roomPanels || roomPanels.length === 0) {
            console.log(`  - No floor panels found for room ${room.id} - showing no floor plan message`);
            console.log(`  - This might mean: 1) No panels generated, 2) Panel data not loaded, 3) Room ID mismatch`);
            console.log(`  - Available panels:`, floorPanels);
            drawNoFloorPlanMessage(ctx, room);
            return;
        }

        console.log(`  - Drawing ${roomPanels.length} panels for room ${room.id}`);
        console.log(`  - All panels for this room:`, roomPanels);
        
        // Draw all panels for this room
        roomPanels.forEach((panel, index) => {
            console.log(`  - Panel ${index + 1}:`, panel);
            console.log(`  - Panel properties:`, {
                start_x: panel.start_x,
                start_y: panel.start_y,
                width: panel.width,
                length: panel.length,
                is_cut_panel: panel.is_cut_panel,
                panel_id: panel.panel_id
            });
            
            // Check if panel has required properties
            console.log(`  - Panel ${index + 1} full object:`, JSON.stringify(panel, null, 2));
            if (panel.start_x === null || panel.start_x === undefined || 
                panel.start_y === null || panel.start_y === undefined || 
                panel.width === null || panel.width === undefined || 
                panel.length === null || panel.length === undefined) {
                console.log(`  - ⚠️ Panel ${index + 1} missing required properties:`, {
                    start_x: panel.start_x,
                    start_y: panel.start_y,
                    width: panel.width,
                    length: panel.length
                });
                console.log(`  - Panel ${index + 1} property types:`, {
                    start_x: typeof panel.start_x,
                    start_y: typeof panel.start_y,
                    width: typeof panel.width,
                    length: typeof panel.length
                });
                return;
            }
            
            // Panel fill
            ctx.fillStyle = panel.is_cut_panel ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)';
            
            // Panel border
            ctx.strokeStyle = panel.is_cut_panel ? '#22c55e' : '#3b82f6';
            ctx.lineWidth = 1 * scaleFactor.current;
            
            // Calculate panel position and dimensions
            const panelX = panel.start_x * scaleFactor.current + offsetX.current;
            const panelY = panel.start_y * scaleFactor.current + offsetY.current;
            const panelWidth = panel.width * scaleFactor.current;
            const panelLength = panel.length * scaleFactor.current;
            
            console.log(`  - Panel ${index + 1} position: x=${panelX}, y=${panelY}, w=${panelWidth}, h=${panelLength}`);
            console.log(`  - Panel ${index + 1} raw coordinates: start_x=${panel.start_x}, start_y=${panel.start_y}, width=${panel.width}, length=${panel.length}`);
            console.log(`  - Panel ${index + 1} scaled coordinates: scale=${scaleFactor.current}, offsetX=${offsetX.current}, offsetY=${offsetY.current}`);
            
            // Check if panel is within canvas bounds
            const isVisible = panelX >= -panelWidth && panelX <= CANVAS_WIDTH && 
                             panelY >= -panelLength && panelY <= CANVAS_HEIGHT;
            console.log(`  - Panel ${index + 1} visible: ${isVisible} (canvas: ${CANVAS_WIDTH}x${CANVAS_HEIGHT})`);
            
            // Draw panel
            ctx.beginPath();
            ctx.rect(panelX, panelY, panelWidth, panelLength);
            ctx.fill();
            ctx.stroke();
            
            // Panel ID
            ctx.fillStyle = '#1f2937';
            ctx.font = `${Math.max(10, 12 * scaleFactor.current)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const centerX = panelX + (panelWidth / 2);
            const centerY = panelY + (panelLength / 2);
            ctx.fillText(panel.panel_id, centerX, centerY);
            
            console.log(`  - Panel ${index + 1} drawn successfully`);
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
        ctx.font = `bold ${Math.max(12, 14 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
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
        
        console.log(`  - Drew "No floor plan available" message for room ${room.id}`);
    };

    // Draw slab calculation message for slab floor rooms
    const drawSlabCalculationMessage = (ctx, room) => {
        // Calculate room center for message placement
        const centerX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
        const centerY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
        
        const messageX = centerX * scaleFactor.current + offsetX.current;
        const messageY = centerY * scaleFactor.current + offsetY.current;
        
        // Calculate room area
        const roomArea = calculateRoomArea(room);
        
        // Calculate slabs needed (each slab is 1210 x 3000 mm = 3.63 m²)
        const slabArea = 1210 * 3000; // mm²
        const slabsNeeded = Math.ceil(roomArea / slabArea);
        
        // Create message text
        const messageText = `Est. ${slabsNeeded} pieces of slab needed`;
        
        ctx.font = `bold ${Math.max(18, 22 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
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
        ctx.strokeStyle = '#10b981'; // Green border for slab rooms
        ctx.lineWidth = 1 * scaleFactor.current;
        ctx.strokeRect(
            messageX - textWidth/2 - 10 * scaleFactor.current,
            messageY - textHeight/2 - 5 * scaleFactor.current,
            textWidth + 20 * scaleFactor.current,
            textHeight + 10 * scaleFactor.current
        );
        
        // Text
        ctx.fillStyle = '#10b981'; // Green text for slab rooms
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(messageText, messageX, messageY);
        
        console.log(`  - Drew slab calculation message for room ${room.id}: ${slabsNeeded} slabs needed for ${(roomArea/1000000).toFixed(2)} m²`);
    };

    // Draw title and info
    const drawTitle = (ctx) => {
        ctx.fillStyle = '#374151';
        ctx.font = `bold ${Math.max(16, 20 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Floor Plan', 20, 20);
        
        // Draw scale info
        ctx.font = `${Math.max(12, 14 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.fillText(`Scale: ${scaleFactor.current.toFixed(2)}x`, 20, 50);
    };

    // Helper function to create unique dimension keys
    const createDimensionKey = (type, roomId, dimension, orientation = '') => {
        return `${type}_${roomId}_${Math.round(dimension)}_${orientation}`;
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
    
    // Helper function to check for spatial duplicates (dimensions very close to each other)
    const isSpatialDuplicate = (newDimension, existingDimensions) => {
        const tolerance = 5; // 5mm tolerance for considering dimensions as duplicates
        
        for (const existing of existingDimensions) {
            // Check if dimensions are similar in value
            if (Math.abs(newDimension.dimension - existing.dimension) < tolerance) {
                // Check if dimensions are in similar positions
                const newMidX = (newDimension.startX + newDimension.endX) / 2;
                const newMidY = (newDimension.startY + newDimension.endY) / 2;
                const existingMidX = (existing.startX + existing.endX) / 2;
                const existingMidY = (existing.startY + existing.endY) / 2;
                
                const distance = Math.sqrt(
                    Math.pow(newMidX - existingMidX, 2) + 
                    Math.pow(newMidY - existingMidY, 2)
                );
                
                if (distance < tolerance * 2) { // 10mm tolerance for position
                    return true; // This is a spatial duplicate
                }
            }
        }
        return false;
    };

    // Draw floor dimensions (cut panels and room dimensions only)
    const drawFloorDimensions = (ctx) => {
        if (!modelBounds) return;

        const placedLabels = [];
        const allLabels = [];
        const drawnDimensions = new Set(); // Track drawn dimensions to avoid duplicates
        const globalDimensionTracker = new Map(); // Track dimensions globally across all rooms

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

                // Create unique keys for room dimensions
                const widthKey = createDimensionKey('room_width', room.id, roomWidth);
                const heightKey = createDimensionKey('room_height', room.id, roomHeight);
                
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
    };

    // Draw room dimensions (helper function)
    const drawRoomDimensions = (ctx, dimension, bounds, placedLabels, allLabels) => {
        const { startX, endX, startY, endY, dimension: length, type, color, priority, avoidArea } = dimension;
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
        let baseOffset = 25; // Increased base offset for better visibility
        let offset = baseOffset;
        let attempts = 0;
        const maxAttempts = 10;
        
        // Initialize text and labelBounds variables
        let text;
        if (dimension.quantity && dimension.quantity > 1) {
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
                const verticalOffset = Math.max(offset, 40); // Increased minimum vertical offset
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
            
            if (isHorizontal) {
                labelBounds = {
                    x: labelX - textWidth / 2 - 4,
                    y: labelY - 8,
                    width: textWidth + 8,
                    height: 16
                };
            } else {
                labelBounds = {
                    x: labelX - 8,
                    y: labelY - textWidth / 2 - 4,
                    width: 16,
                    height: textWidth + 8
                };
            }
            
            const hasOverlap = placedLabels.some(existing => {
                return !(labelBounds.x + labelBounds.width < existing.x || 
                       existing.x + existing.width < labelBounds.x ||
                       labelBounds.y + labelBounds.height < existing.y ||
                       existing.y + existing.height < labelBounds.y);
            });
            
            if (!hasOverlap) break;
            
            offset += 15;
            attempts++;
        } while (attempts < maxAttempts);
        
        // Draw dimension lines
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        
        if (isHorizontal) {
            // Extension lines (vertical)
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(startX * scaleFactor.current + offsetX.current, labelY);
            ctx.moveTo(endX * scaleFactor.current + offsetX.current, endY * scaleFactor.current + offsetY.current);
            ctx.lineTo(endX * scaleFactor.current + offsetX.current, labelY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Main dimension line (horizontal)
            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, labelY);
            ctx.lineTo(endX * scaleFactor.current + offsetX.current, labelY);
            ctx.stroke();
        } else {
            // Extension lines (horizontal)
            ctx.beginPath();
            ctx.setLineDash([5, 5]);
            ctx.moveTo(startX * scaleFactor.current + offsetX.current, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, startY * scaleFactor.current + offsetY.current);
            ctx.moveTo(endX * scaleFactor.current + offsetX.current, endY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, endY * scaleFactor.current + offsetY.current);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Main dimension line (vertical)
            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.moveTo(labelX, startY * scaleFactor.current + offsetY.current);
            ctx.lineTo(labelX, endY * scaleFactor.current + offsetY.current);
            ctx.stroke();
        }
        
        // Draw dimension text with proper rotation for vertical dimensions
        ctx.fillStyle = color;
        ctx.font = 'bold 15px Arial';
        
        if (isHorizontal) {
            // Horizontal text
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, labelX, labelY);
        } else {
            // Vertical text - rotate 90 degrees (like ceiling plan)
            ctx.save();
            ctx.translate(labelX, labelY);
            ctx.rotate(-Math.PI / 2); // Rotate 90 degrees counterclockwise
            
            // Draw white background for vertical text (like ceiling plan)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fillRect(-textWidth / 2 - 2, -8, textWidth + 4, 16);
            
            // Draw the text
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 0, 0);
            ctx.restore();
        }
        
        // Add to placed labels
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
        
        // Determine panel orientation by checking if panels are wider than tall
        // For horizontal panels: width < length (e.g., 1150mm < 15000mm) - panels run left-to-right
        // For vertical panels: width < length (e.g., 1150mm < 10000mm) - panels run up-to-down
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
                    const individualDimension = {
                        startX: panel.start_x,
                        endX: panel.start_x + panel.width,
                        startY: panel.start_y,
                        endY: panel.start_y + panel.length,
                        dimension: panelWidth,
                        type: 'individual_panel',
                        color: '#3b82f6', // Blue for full panels (matches panel color)
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
                        isHorizontal: true // This dimension line is HORIZONTAL (same as grouped dimensions for horizontal panels)
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
                        isHorizontal: false // This dimension line is VERTICAL (same as grouped dimensions for vertical panels)
                    };
                }
                
                // Draw cut panel dimension
                drawRoomDimensions(ctx, cutPanelDimension, projectBounds, placedLabels, allLabels);
            });
        }
    };

    // Draw grouped panel dimensions (for both horizontal and vertical panels) - exactly like ceiling plan
    const drawGroupedPanelDimensions = (ctx, panels, width, placedLabels, allLabels, isHorizontal = false, globalDimensionTracker) => {
        // For grouped panel dimensions, we want to show the WIDTH dimension
        // This means for horizontal panels, show width dimension vertically (perpendicular to panel direction)
        // For vertical panels, show width dimension horizontally (perpendicular to panel direction)
        
        if (isHorizontal) {
            // Horizontal panels: show LENGTH dimension vertically (perpendicular to panel direction)
            // Find the center of the panel group
            const centerX = (Math.min(...panels.map(p => p.start_x)) + Math.max(...panels.map(p => p.start_x + p.width))) / 2;
            const minY = Math.min(...panels.map(p => p.start_y));
            const maxY = Math.max(...panels.map(p => p.start_y + p.length));
            
            // Create vertical dimension line (perpendicular to horizontal panels)
            // For horizontal panels, we want to show the PANEL LENGTH, not panel width
            const panelLength = panels[0].length; // Use panel length for horizontal panels
            const lengthDimension = {
                startX: centerX,
                endX: centerX,
                startY: minY,
                endY: maxY,
                dimension: panelLength, // Use panel length instead of width
                type: 'grouped_length_horizontal',
                color: '#3b82f6', // Blue for full panels (matches panel color)
                priority: 2,
                avoidArea: projectBounds,
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: false // This dimension line is vertical (perpendicular to panels)
            };
            
            drawRoomDimensions(ctx, lengthDimension, projectBounds, placedLabels, allLabels);
        } else {
            // Vertical panels: show width dimension horizontally (perpendicular to panel direction)
            // Find the center of the panel group
            const centerY = (Math.min(...panels.map(p => p.start_y)) + Math.max(...panels.map(p => p.start_y + p.length))) / 2;
            const minX = Math.min(...panels.map(p => p.start_x));
            const maxX = Math.max(...panels.map(p => p.start_x + p.width));
            
            // For vertical panels, use the actual panel width (not the grouping dimension)
            const actualPanelWidth = panels[0].width; // Use actual panel width (e.g., 1150mm)
            
            // Create horizontal dimension line (perpendicular to vertical panels)
            const widthDimension = {
                startX: minX,
                endX: maxX,
                startY: centerY,
                endY: centerY,
                dimension: actualPanelWidth, // Use actual panel width instead of grouping dimension
                type: 'grouped_width_vertical',
                color: '#3b82f6', // Blue for full panels (matches panel color)
                priority: 2,
                avoidArea: projectBounds,
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: true // This dimension line is horizontal (perpendicular to panels)
            };
            
            drawRoomDimensions(ctx, widthDimension, projectBounds, placedLabels, allLabels);
        }
    };

    // Draw cut panel dimension (helper function)
    const drawCutPanelDimension = (ctx, dimension, placedLabels, allLabels) => {
        const { startX, endX, startY, endY, dimension: length, type, color, priority, avoidArea } = dimension;
        
        // Use the same dimension drawing logic as room dimensions
        drawRoomDimensions(ctx, dimension, projectBounds, placedLabels, allLabels);
    };

    // Zoom to center of canvas
    const zoomToCenter = (newScale) => {
        console.log('🎯 zoomToCenter called with newScale:', newScale);
        console.log('Canvas ref exists:', !!canvasRef.current);
        console.log('BEFORE update - scaleFactor.current:', scaleFactor.current);
        
        const canvasCenterX = CANVAS_WIDTH / 2;
        const canvasCenterY = CANVAS_HEIGHT / 2;
        
        const scaleRatio = newScale / scaleFactor.current;
        console.log('Scale ratio:', scaleRatio);
        
        offsetX.current = canvasCenterX - (canvasCenterX - offsetX.current) * scaleRatio;
        offsetY.current = canvasCenterY - (canvasCenterY - offsetY.current) * scaleRatio;
        
        console.log('New offsets:', { x: offsetX.current, y: offsetY.current });
        
        // Update the scale factor FIRST
        scaleFactor.current = newScale;
        console.log('AFTER update - scaleFactor.current:', scaleFactor.current);
        
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
            console.log('Canvas redrawn!');
        } else {
            console.error('❌ Could not get canvas context!');
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
        isDragging.current = true;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e) => {
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
    };

    // Panel click detection
    const handleCanvasClick = (e) => {
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
        
        // Clicked on empty space
        console.log('Clicked on empty space');
    };

    // Reset zoom (kept for backward compatibility)
    const resetZoom = () => {
        handleResetZoom();
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
            {/* Plan Summary Header */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-6">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600">{panelCounts.total}</div>
                            <div className="text-sm text-gray-600">Total Panels</div>
                        </div>
                        <div className="text-center">
                            <div className="text-xl font-semibold text-green-600">{panelCounts.full}</div>
                            <div className="text-sm text-gray-600">Full Panels</div>
                        </div>
                        <div className="text-center">
                            <div className="text-xl font-semibold text-orange-600">{panelCounts.cut}</div>
                            <div className="text-sm text-gray-600">Cut Panels</div>
                        </div>
                        <div className="text-center">
                            <div className="text-xl font-semibold text-purple-600">
                                {floorPlan?.waste_percentage ? `${floorPlan.waste_percentage.toFixed(1)}%` : '0%'}
                            </div>
                            <div className="text-sm text-gray-600">Waste</div>
                        </div>
                    </div>
                    
                    <div className="text-right">
                        <div className="text-sm text-gray-600">Panel Floor Area (excl. walls)</div>
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
                </div>
            </div>

            {/* Canvas Container with Right Side Summary */}
            <div className="flex gap-6">
                {/* Main Canvas */}
                <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg relative flex-1">
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
                        className="floor-canvas cursor-grab active:cursor-grabbing block w-full"
                        style={{
                            width: `${CANVAS_WIDTH}px`,
                            height: `${CANVAS_HEIGHT}px`,
                            maxWidth: '100%',
                            maxHeight: '70vh'
                        }}
                        onWheel={handleWheel}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onClick={handleCanvasClick}
                    />
                    
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
                                    {floorPlan?.waste_percentage ? `${floorPlan.waste_percentage.toFixed(1)}%` : '0%'}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-600">Current Strategy</div>
                                <div className="text-lg font-semibold text-purple-600">
                                    {floorPlan?.orientation_strategy || 'Auto'}
                                </div>
                            </div>
                        </div>
                        
                        {floorPlan?.orientation_strategy && floorPlan.orientation_strategy !== 'auto' && (
                            <div>
                                <div className="text-sm text-gray-600">Recommended</div>
                                <div className="text-lg font-semibold text-green-600">
                                    {orientationAnalysis?.recommended_strategy || 'Auto'}
                                </div>
                            </div>
                        )}
                        
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
