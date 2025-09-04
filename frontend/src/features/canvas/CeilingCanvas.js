import React, { useEffect, useRef, useState, useMemo } from 'react';
import { calculateOffsetPoints } from './drawing.js';

const CeilingCanvas = ({ 
    // Multi-room props
    rooms = [], 
    walls = [],
    intersections = [],
    ceilingPlans = [], 
    ceilingPanelsMap = {}, 
    onRoomSelect, 
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
    
    // Additional props
    orientationAnalysis = null,
    ceilingThickness = 150,
    
    // Support configuration
    supportType = 'nylon',
    nylonHangerOptions = { includeAccessories: false, includeCable: false },
    aluSuspensionCustomDrawing = false,
    panelsNeedSupport = false
}) => {
    // Determine if we're in multi-room mode or single-room mode
    const isMultiRoomMode = rooms.length > 0;
    
    // Use multi-room data or fall back to single-room data
    const effectiveRooms = isMultiRoomMode ? rooms : (room ? [room] : []);
    const effectiveCeilingPanelsMap = isMultiRoomMode ? ceilingPanelsMap : (room ? { [room.id]: ceilingPanels } : {});
    const effectiveCeilingPlans = isMultiRoomMode ? ceilingPlans : (ceilingPlan ? [ceilingPlan] : []);
    
    const canvasRef = useRef(null);
    const [currentScale, setCurrentScale] = useState(1);
    const [showPanelTable, setShowPanelTable] = useState(false);
    const [isPlacingSupport, setIsPlacingSupport] = useState(false);
    const [customSupports, setCustomSupports] = useState([]);
    const [supportStartPoint, setSupportStartPoint] = useState(null);
    const [supportPreview, setSupportPreview] = useState(null);
    
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
    
    // Canvas state refs
    const scaleFactor = useRef(1);
    const initialScale = useRef(1); // Track the initial scale
    const offsetX = useRef(0);
    const offsetY = useRef(0);
    const isDragging = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const isZoomed = useRef(false); // Track if user has manually zoomed

    // Canvas dimensions - match wall plan for consistent focus
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
            // Try multiple sources for accurate panel count
            if (ceilingPlan && ceilingPlan.total_panels) {
                return ceilingPlan.total_panels;
            }
            if (ceilingPlan && ceilingPlan.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                return ceilingPlan.enhanced_panels.length;
            }
            if (ceilingPlan && ceilingPlan.ceiling_panels && Array.isArray(ceilingPlan.ceiling_panels)) {
                return ceilingPlan.ceiling_panels.length;
            }
            // Fallback to calculating from panels map
            const totalFromMap = Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => sum + (panels ? panels.length : 0), 0);
            if (totalFromMap > 0) {
                return totalFromMap;
            }
            // Last resort: count all panels in the ceilingPanels prop
            return ceilingPanels ? ceilingPanels.length : 0;
        };

        const getFullPanels = () => {
            // Try to get from ceilingPlan first
            if (ceilingPlan && ceilingPlan.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                return ceilingPlan.enhanced_panels.filter(p => !p.is_cut).length;
            }
            // Fallback to panels map
            return Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => 
                sum + (panels ? panels.filter(p => !p.is_cut).length : 0), 0
            );
        };

        const getCutPanels = () => {
            // Try to get from ceilingPlan first
            if (ceilingPlan && ceilingPlan.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                return ceilingPlan.enhanced_panels.filter(p => p.is_cut).length;
            }
            // Fallback to panels map
            return Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) => 
                sum + (panels ? panels.filter(p => p.is_cut).length : 0), 0
            );
        };

        return {
            total: getTotalPanels(),
            full: getFullPanels(),
            cut: getCutPanels()
        };
    }, [ceilingPlan, effectiveCeilingPanelsMap, ceilingPanels]);



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

    }, [effectiveRooms, effectiveCeilingPlans, effectiveCeilingPanelsMap, selectedRoomId, selectedPanelId]);

    // Sync external scale prop with internal zoom
    useEffect(() => {
        if (scale !== undefined && scale !== currentScale) {
            console.log('External scale changed from', currentScale, 'to', scale);
            zoomToCenter(scale);
        }
    }, [scale]);

    // Calculate optimal canvas transformation
    const calculateCanvasTransform = () => {
        if (!effectiveRooms || effectiveRooms.length === 0) {
            scaleFactor.current = 1;
            initialScale.current = 1; // Set initial scale
            offsetX.current = CANVAS_WIDTH / 2;
            offsetY.current = CANVAS_HEIGHT / 2;
            return;
        }

        // Calculate bounds for all rooms combined
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        effectiveRooms.forEach(room => {
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

        // Center all rooms
        const scaledWidth = totalWidth * optimalScale;
        const scaledHeight = totalHeight * optimalScale;
        
        offsetX.current = (CANVAS_WIDTH - scaledWidth) / 2 - minX * optimalScale;
        offsetY.current = (CANVAS_HEIGHT - scaledHeight) / 2 - minY * optimalScale;
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

        // Draw all rooms and their ceiling panels
        if (effectiveRooms && effectiveRooms.length > 0) {
            effectiveRooms.forEach(room => {
                drawRoomOutline(ctx, room);
                drawCeilingPanels(ctx, room);
            });
        }

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

    // Draw room outline
    const drawRoomOutline = (ctx, room) => {
        if (!room.room_points || room.room_points.length < 3) return;

        const isSelected = room.id === selectedRoomId;
        
        // Room outline styling
        if (isSelected) {
            ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'; // Light blue for selected room
            ctx.strokeStyle = '#3b82f6'; // Blue border for selected room
            ctx.lineWidth = 3 * scaleFactor.current;
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

        // Add room name label
        if (room.room_name) {
            const centerX = room.room_points.reduce((sum, p) => sum + p.x, 0) / room.room_points.length;
            const centerY = room.room_points.reduce((sum, p) => sum + p.y, 0) / room.room_points.length;
            
            ctx.fillStyle = isSelected ? '#3b82f6' : '#6b7280';
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
        if (effectiveRooms.length > 0) {
            const allPoints = effectiveRooms.flatMap(room => room.room_points || []);
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
                        console.log(`🔍 Flip calculation: dotToCenter=${dotToCenter.toFixed(2)}, dotToJoin=${dotToJoin.toFixed(2)}, shouldFlip=${shouldFlip}`);
                        
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
                    const minGapInModelUnits = Math.max(100 * 0.3, 30);
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

                // Draw wall caps - EXACT same as wall plan
                if (intersections && intersections.length > 0) {
                    // Removed 45_cut joint drawing from ceiling plan
                }

                // Reset line dash
                ctx.setLineDash([]);
            } catch (error) {
                console.error('Error drawing wall:', error, wall);
                
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
                
                console.log('Drew fallback inner wall face');
            }
        });
    };

    // Draw ceiling panels
    const drawCeilingPanels = (ctx, room) => {
        // Get panels for this room first
        const roomPanels = effectiveCeilingPanelsMap[room.id] || [];
        
        // Calculate local panel bounds for this room
        const localPanelBounds = roomPanels.length > 0 ? {
            minX: Math.min(...roomPanels.map(p => Math.min(p.start_x, p.end_x))),
            maxX: Math.max(...roomPanels.map(p => Math.max(p.start_x, p.end_x))),
            minY: Math.min(...roomPanels.map(p => Math.max(p.start_y, p.end_y))),
            maxY: Math.max(...roomPanels.map(p => Math.max(p.start_y, p.end_y)))
        } : null;

        // Track placed labels to prevent overlaps
        const placedLabels = [];
        // Collect label info for second pass
        const allLabels = [];

        // First pass: draw panels and collect dimension info
        roomPanels.forEach(panel => {
            const isSelected = panel.id === selectedPanelId;
            
            // Panel dimensions
            const x = panel.start_x * scaleFactor.current + offsetX.current;
            const y = panel.start_y * scaleFactor.current + offsetY.current;
            const width = panel.width * scaleFactor.current;
            const height = panel.length * scaleFactor.current;

            // Panel styling - use same color scheme as FloorCanvas
            if (isSelected) {
                ctx.fillStyle = 'rgba(59, 130, 246, 0.8)'; // Bright blue for selected
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 10 * scaleFactor.current; // Increased from 5 to 6 for better visibility
            } else {
                // Use same colors as FloorCanvas: blue for full panels, green for cut panels
                if (panel.is_cut) {
                    ctx.fillStyle = 'rgba(34, 197, 94, 0.5)'; // Green for cut panels (same as FloorCanvas)
                    ctx.strokeStyle = '#22c55e'; // Green border for cut panels
                } else {
                    ctx.fillStyle = 'rgba(59, 130, 246, 0.5)'; // Blue for full panels (same as FloorCanvas)
                    ctx.strokeStyle = '#3b82f6'; // Blue border for full panels
                }
                ctx.lineWidth = 10 * scaleFactor.current; // Increased from 2 to 4 for better visibility
            }

            // Draw panel
            ctx.fillRect(x, y, width, height);
            ctx.strokeRect(x, y, width, height);

            // Draw cut panel indicator with dashed border (same as FloorCanvas)
            if (panel.is_cut) {
                ctx.strokeStyle = '#22c55e'; // Green dashed border for cut panels
                ctx.lineWidth = 10 * scaleFactor.current; // Increased from 2 to 3 for better visibility
                ctx.setLineDash([8 * scaleFactor.current, 4 * scaleFactor.current]);
                ctx.strokeRect(x + 2, y + 2, width - 4, height - 4);
                ctx.setLineDash([]);
            }
            
            // Removed dimension text in the middle of panels

            // Panel ID label for selected panels (keep this for selection feedback)
            if (isSelected) {
                ctx.fillStyle = '#3b82f6';
                ctx.font = `bold ${Math.max(10, 12 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`P${panel.panel_id || panel.id}`, x + width / 2, y + height / 2);
            }
        });

        // Draw enhanced dimensions for ceiling panels
        if (localPanelBounds && roomPanels.length > 0) {
            drawEnhancedCeilingDimensions(ctx, room, roomPanels, modelBounds, placedLabels, allLabels);
        }

        // Draw default supports (nylon hangers only) and custom supports
        if (!aluSuspensionCustomDrawing) {
            // Draw default nylon hanger supports
            drawPanelSupports(ctx, roomPanels, scaleFactor.current, offsetX.current, offsetY.current);
        }
        
        // Draw custom supports if custom drawing is enabled
        if (aluSuspensionCustomDrawing) {
            drawCustomSupports(ctx, customSupports, scaleFactor.current, offsetX.current, offsetY.current);
        }
        
        // Draw support preview line if placing support
        if (supportPreview && isPlacingSupport) {
            drawSupportPreview(ctx, supportPreview, scaleFactor.current, offsetX.current, offsetY.current);
        }
        
        // Only draw mouse position dimensions when placing support
        if (isPlacingSupport && supportPreview && supportPreview.mousePosition && supportPreview.distances) {
            drawMousePositionDimensions(ctx, supportPreview.mousePosition, supportPreview.distances, scaleFactor.current, offsetX.current, offsetY.current);
        }
    };

    // Enhanced ceiling dimension drawing function
    const drawEnhancedCeilingDimensions = (ctx, room, roomPanels, roomModelBounds, placedLabels, allLabels) => {
        
        const roomWidth = Math.abs(Math.max(...room.room_points.map(p => p.x)) - Math.min(...room.room_points.map(p => p.x)));
        const roomHeight = Math.abs(Math.max(...room.room_points.map(p => p.y)) - Math.min(...room.room_points.map(p => p.y)));
        
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
        //     roomHeight: roomHeight
        // });
        
        // Draw room-level dimensions first (most important) - well outside panel area
        // These have highest priority and should be drawn first
        drawRoomDimensions(ctx, room, roomWidth, roomHeight, roomBounds, canvasPanelBounds, placedLabels, allLabels);
        
        // Draw panel-level dimensions - handle any number of panels intelligently
        if (roomPanels.length > 0) {
            // Group panels by their dimension to show grouped dimensions (EXCLUDE cut panels)
            const panelsByDimension = new Map();
            const cutPanels = roomPanels.filter(p => p.is_cut);
            
            // console.log(`🔍 Panel grouping: ${totalPanels} total, ${fullPanels.length} full, ${cutPanels.length} cut`);
            
            roomPanels.forEach(panel => {
                // Skip cut panels - they get individual dimensions later
                if (panel.is_cut) return;
                
                // Use a more precise dimension grouping to handle floating-point precision
                // For horizontal panels: group by LENGTH (e.g., 15000mm) - panels run left-to-right
                // For vertical panels: group by WIDTH (e.g., 1150mm) - panels run up-to-down
                const isHorizontal = panel.width < panel.length;
                const groupingDimension = isHorizontal ? panel.length : panel.width; // Use length for horizontal, width for vertical
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
            
            const isHorizontalOrientation = roomPanels.length > 0 && 
                roomPanels[0].width < roomPanels[0].length;
            
            // Always show grouped dimensions for multiple panels with same dimension (length for horizontal, width for vertical)
            const drawnDimensions = new Set(); // Track drawn dimensions to prevent duplicates
            const drawnPositions = new Set(); // Track drawn positions to prevent overlapping dimensions
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
                    if (!isHorizontalOrientation){
                        // Vertical panels: show "n × width" on the side
                        drawGroupedPanelDimensions(ctx, panels, dimensionValue, modelBounds, canvasPanelBounds, placedLabels, allLabels, true);
                    } else {
                        // Horizontal panels: show "n × length" on top/bottom (length becomes width in horizontal view)
                        drawGroupedPanelDimensions(ctx, panels, dimensionValue, modelBounds, canvasPanelBounds, placedLabels, allLabels, false);
                    }
                } else if (panels.length === 1 && shouldShowIndividual) {
                    // Single panel - show individual dimension (only if not too many panels)
                    const panel = panels[0];
                    
                    // For individual panels, show the panel width (not length)
                    const panelWidth = Math.round(panel.width * 100) / 100;
                    
                    // Only show dimensions for full panels (not cut panels - they're handled separately)
                    if (!panel.is_cut) {
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
                            endX: panel.end_x,
                            startY: panel.start_y,
                            endY: panel.end_y,
                            dimension: panelWidth,
                            type: 'individual_panel',
                            color: '#3b82f6', // Blue for full panels (matches panel color)
                            priority: 3,
                            avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
                            quantity: 0, // Use 0 to show just the dimension without "(1 panel)"
                            panelLabel: `${panelWidth}mm`,
                            drawnPositions: drawnPositions,
                            roomId: room.id // Assign room ID
                        };
                        drawCeilingDimension(ctx, individualDimension, projectBounds, placedLabels, allLabels);
                    }
                }
            });
            
            // Draw cut panel dimensions with RED color
            if (cutPanels.length > 0) {
                //console.log(`🔍 Drawing dimensions for ${cutPanels.length} cut panels with RED color`);
                
                cutPanels.forEach(panel => {
                    // For cut panels, show the correct dimension based on orientation
                    // Horizontal orientation: show panel WIDTH (perpendicular to panel direction)
                    // Vertical orientation: show panel LENGTH (perpendicular to panel direction)
                    const isHorizontal = panel.width < panel.length;
                    const dimensionValue = isHorizontal ? panel.width : panel.length; // Use width for horizontal, length for vertical
                    
                    //console.log(`🔍 Cut panel ${panel.id}: ${dimensionValue}mm (${dimensionType}) - ${isHorizontal ? 'Horizontal' : 'Vertical'} orientation`);
                    
                    // Create unique key for cut panel dimension
                    const cutDimensionKey = `cut_${panel.id}`;
                    const cutValueKey = `${dimensionValue}mm_cut`;
                    
                    // Check for duplicate cut panel dimensions
                    if (drawnDimensions.has(cutDimensionKey) || drawnValues.has(cutValueKey)) return;
                    
                    drawnDimensions.add(cutDimensionKey);
                    drawnValues.add(cutValueKey);
                    
                    let cutPanelDimension;
                    
                   
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
                            avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
                            quantity: 0, // Use 0 to show just the dimension without "(1 panel)"
                            panelLabel: `${dimensionValue}mm (CUT)`,
                            drawnPositions: drawnPositions,
                            roomId: room.id, // Assign room ID
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
                            avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
                            quantity: 0, // Use 0 to show just the dimension without "(1 panel)"
                            panelLabel: `${dimensionValue}mm (CUT)`,
                            drawnPositions: drawnPositions,
                            roomId: room.id, // Assign room ID
                            isHorizontal: false // This dimension line is VERTICAL (same as grouped dimensions for vertical panels)
                        };
                    }
                    
                    // Draw cut panel dimension
                    drawCeilingDimension(ctx, cutPanelDimension, projectBounds, placedLabels, allLabels);
                });
            }
            
            // Generate panel list for ceiling plan (like wall plan)
            const generatePanelList = () => {
                const fullPanels = roomPanels.filter(p => !p.is_cut);
                const cutPanels = roomPanels.filter(p => p.is_cut);
                
                // Group full panels by dimension
                const fullPanelsByDimension = new Map();
                fullPanels.forEach(panel => {
                    const isHorizontal = panel.width < panel.length;
                    const groupingDimension = isHorizontal ? panel.length : panel.width;
                    const dimensionValue = Math.round(groupingDimension * 100) / 100;
                    
                    if (!fullPanelsByDimension.has(dimensionValue)) {
                        fullPanelsByDimension.set(dimensionValue, []);
                    }
                    fullPanelsByDimension.get(dimensionValue).push(panel);
                });
                
                // Create panel list text
                let panelListText = `Ceiling Panels for Room ${room.id}:\n`;
                panelListText += `Total: ${roomPanels.length} panels\n`;
                panelListText += `Full Panels: ${fullPanels.length}\n`;
                panelListText += `Cut Panels: ${cutPanels.length}\n\n`;
                
                // Add grouped full panels
                fullPanelsByDimension.forEach((panels, dimension) => {
                    const isHorizontal = panels[0].width < panels[0].length;
                    const dimensionType = isHorizontal ? 'Length' : 'Width';
                    panelListText += `${panels.length} × ${dimension}mm (${dimensionType})\n`;
                });
                
                // Add individual cut panels
                if (cutPanels.length > 0) {
                    panelListText += `\nCut Panels:\n`;
                    cutPanels.forEach(panel => {
                        const isHorizontal = panel.width < panel.length;
                        const dimensionValue = isHorizontal ? panel.width : panel.length;
                        const dimensionType = isHorizontal ? 'Width' : 'Length';
                        panelListText += `- ${dimensionValue}mm (${dimensionType}) - CUT\n`;
                    });
                }
                
                console.log(`📋 Panel List Generated:\n${panelListText}`);
                return panelListText;
            };
            
            // Generate and log panel list
            generatePanelList();
            
            // For rooms with many panels, show a summary dimension
            if (roomPanels.length > 20) {
                const totalPanels = roomPanels.length;
                const fullPanels = roomPanels.filter(p => !p.is_cut).length;
                const cutPanels = roomPanels.filter(p => p.is_cut).length;
                
                // Show summary below the room
                const summaryDimension = {
                    startX: panelBounds.minX,
                    endX: panelBounds.maxX,
                    startY: panelBounds.maxY,
                    endY: panelBounds.maxY,
                    dimension: `${totalPanels} panels (${fullPanels} full, ${cutPanels} cut)`,
                    type: 'panel_summary',
                    color: '#6b7280', // Gray for summary
                    priority: 4,
                    avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
                    quantity: 0,
                    panelLabel: `${totalPanels} panels (${fullPanels} full, ${cutPanels} cut)`,
                    drawnPositions: new Set(),
                    roomId: room.id // Assign room ID
                };
                drawCeilingDimension(ctx, summaryDimension, projectBounds, placedLabels, allLabels);
            }
        }
    };

    // Draw room-level dimensions
    const drawRoomDimensions = (ctx, room, roomWidth, roomHeight, roomBounds, canvasPanelBounds, placedLabels, allLabels) => {
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
        
        // Room height dimension (vertical) - place to the LEFT of the room, well outside panel area
        const heightDimension = {
            startX: minX, // Use minX to place to the left
            endX: minX,
            startY: minY,
            endY: maxY,
            dimension: roomHeight,
            type: 'room_height',
            color: '#1e40af', // Blue for room dimensions
            priority: 1,
            avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
            drawnPositions: new Set(),
            roomId: room.id // Assign room ID
        };
        
        // Draw room dimensions with optimal positioning
        drawCeilingDimension(ctx, widthDimension, projectBounds, placedLabels, allLabels);
        drawCeilingDimension(ctx, heightDimension, projectBounds, placedLabels, allLabels);
        
    };

    // Draw grouped panel dimensions (for both horizontal and vertical panels)
    const drawGroupedPanelDimensions = (ctx, panels, width, modelBounds, canvasPanelBounds, placedLabels, allLabels, isHorizontal = false) => {
        // For grouped panel dimensions, we want to show the WIDTH dimension
        // This means for horizontal panels, show width dimension vertically (perpendicular to panel direction)
        // For vertical panels, show width dimension horizontally (perpendicular to panel direction)
        
        if (isHorizontal) {
            // Horizontal panels: show LENGTH dimension vertically (perpendicular to panel direction)
            // Find the center of the panel group
            const centerX = (Math.min(...panels.map(p => p.start_x)) + Math.max(...panels.map(p => p.end_x))) / 2;
            const minY = Math.min(...panels.map(p => p.start_y));
            const maxY = Math.max(...panels.map(p => p.end_y));
            
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
                avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: false // This dimension line is vertical (perpendicular to panels)
            };
            
            drawCeilingDimension(ctx, lengthDimension, projectBounds, placedLabels, allLabels);
        } else {
            // Vertical panels: show width dimension horizontally (perpendicular to panel direction)
            // Find the center of the panel group
            const centerY = (Math.min(...panels.map(p => p.start_y)) + Math.max(...panels.map(p => p.end_y))) / 2;
            const minX = Math.min(...panels.map(p => p.start_x));
            const maxX = Math.max(...panels.map(p => p.end_x));
            
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
                avoidArea: projectBounds, // Use project bounds to avoid drawing dimensions inside project area
                quantity: panels.length,
                drawnPositions: new Set(),
                roomId: 'unknown',
                isHorizontal: true // This dimension line is horizontal (perpendicular to panels)
            };
            
            drawCeilingDimension(ctx, widthDimension, projectBounds, placedLabels, allLabels);
        }
    };

    // Generate panel list for ceiling plan
    const generatePanelList = () => {
        //console.log('🔧 generatePanelList called with effectiveCeilingPanelsMap:', effectiveCeilingPanelsMap);
        
        if (!effectiveCeilingPanelsMap || Object.keys(effectiveCeilingPanelsMap).length === 0) {
            console.log('📋 No ceiling panels found for project');
            return [];
        }

        // Collect all panels from all rooms
        const allProjectPanels = [];
        Object.values(effectiveCeilingPanelsMap).forEach(roomPanels => {
            console.log('🔧 Adding room panels:', roomPanels);
            allProjectPanels.push(...roomPanels);
        });
        
        console.log('🔧 Total project panels collected:', allProjectPanels.length);

        // Group panels by dimensions (width, length, thickness)
        const panelsByDimension = new Map();
        allProjectPanels.forEach(panel => {
            // Use panel thickness if available, otherwise use the current ceiling thickness setting
            const panelThickness = panel.thickness || ceilingThickness;
            console.log('🔧 Panel thickness debug:', { 
                panelId: panel.id, 
                thickness: panel.thickness, 
                fallbackThickness: panelThickness,
                hasThickness: panel.hasOwnProperty('thickness'),
                thicknessType: typeof panel.thickness
            });
            
            // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
            const isVertical = panel.width >= panel.length;
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

        console.log('📋 Ceiling Panel List Generated:', panelList);
        return panelList;
    };

    // Helper function to get dimension text
    const getDimensionText = (dimension, length, quantity) => {
        console.log(`🔍 getDimensionText called with:`, {
            type: dimension.type,
            panelLabel: dimension.panelLabel,
            dimension: dimension.dimension,
            length: length,
            quantity: quantity
        });
        
        // For grouped dimensions, show "n × dimension" format
        if ((dimension.type === 'grouped_width' || dimension.type === 'grouped_width_horizontal' || dimension.type === 'grouped_width_vertical' || 
             dimension.type === 'grouped_length_horizontal') && quantity) {
            // Use the dimension.dimension value (which is the actual dimension value)
            return `${quantity} × ${dimension.dimension}mm`;
        } else {
            return dimension.panelLabel || (quantity ? `${dimension.dimension}mm (${quantity} panels)` : `${Math.round(dimension.dimension)}mm`);
        }
    };

    // Helper function to draw dimension lines (extension lines and dimension line)
    const drawDimensionLines = (ctx, startX, startY, endX, endY, labelX, labelY, isHorizontal, scaleFactor, offsetX, offsetY, color) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        
        if (isHorizontal) {
            // Extension lines (vertical) - from panel boundary to dimension line
            ctx.beginPath();
            ctx.setLineDash([5, 5]); // Dashed lines for extensions
            
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
            ctx.lineWidth = 2;
            ctx.moveTo(startX * scaleFactor + offsetX, labelY);
            ctx.lineTo(endX * scaleFactor + offsetX, labelY);
            ctx.stroke();
            
        } else {
            // Extension lines (horizontal) - from panel boundary to dimension line
            ctx.beginPath();
            ctx.setLineDash([5, 5]); // Dashed lines for extensions
            
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
            ctx.lineWidth = 2;
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
        
        // Calculate dimension line properties - use proper angle calculation like wall plan
        const dx = endX - startX;
        const dy = endY - startY;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        
        // Determine if dimension is horizontal or vertical based on angle (like wall plan)
        const isHorizontal = Math.abs(angle) < 45 || Math.abs(angle) > 135;
        
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        
        // Determine optimal label position using wall plan approach - ALWAYS OUTSIDE project area
        let labelX, labelY;
        let baseOffset = 15; // Base distance from project boundary (reduced from 30px)
        let offset = baseOffset;
        let attempts = 0;
        const maxAttempts = 10;
        
        // Find available position to avoid overlaps - use project bounds for initial positioning
        do {
            if (isHorizontal) {
                // Horizontal dimension: place ABOVE or BELOW (perpendicular to dimension direction)
                // Use project bounds to ensure labels start outside project area
                const projectMidY = avoidArea ? (avoidArea.minY + avoidArea.maxY) / 2 : (minY + maxY) / 2;
                const isTopHalf = midY < projectMidY;
                // const side = isTopHalf ? 'top' : 'bottom'; // Unused variable
                
                if (avoidArea) {
                    // Position relative to project boundary
                    labelY = isTopHalf ? 
                        (avoidArea.minY * scaleFactor.current + offsetY.current - offset) : 
                        (avoidArea.maxY * scaleFactor.current + offsetY.current + offset);
                } else {
                    // Fallback to dimension bounds
                    labelY = isTopHalf ? 
                        (minY * scaleFactor.current + offsetY.current - offset) : 
                        (maxY * scaleFactor.current + offsetY.current + offset);
                }
                labelX = midX * scaleFactor.current + offsetX.current;
            } else {
                // Vertical dimension: place to LEFT or RIGHT (perpendicular to dimension direction)
                // For vertical dimensions, use larger offset to ensure labels are well outside project area
                const verticalOffset = Math.max(offset, 30); // Minimum 30px for vertical dimensions (reduced from 50px)
                // Use project bounds to ensure labels start outside project area
                const projectMidX = avoidArea ? (avoidArea.minX + avoidArea.maxX) / 2 : (minX + maxX) / 2;
                const isLeftHalf = midX < projectMidX;
                // const side = isLeftHalf ? 'left' : 'right'; // Unused variable
                
                if (avoidArea) {
                    // Position relative to project boundary
                    labelX = isLeftHalf ? 
                        (avoidArea.minX * scaleFactor.current + offsetX.current - verticalOffset) : 
                        (avoidArea.maxX * scaleFactor.current + offsetX.current + verticalOffset);
                } else {
                    // Fallback to dimension bounds
                    labelX = isLeftHalf ? 
                        (minX * scaleFactor.current + offsetX.current - verticalOffset) : 
                        (maxX * scaleFactor.current + offsetX.current + verticalOffset);
                }
                labelY = midY * scaleFactor.current + offsetY.current;
            }
            
            // Check for overlaps with existing labels
            const text = getDimensionText(dimension, length, quantity);
            const textWidth = ctx.measureText(text).width;
            
            // Create label bounds (accounting for text rotation for vertical dimensions)
            let labelBounds;
            if (isHorizontal) {
                labelBounds = {
                    x: labelX - textWidth / 2 - 4,
                    y: labelY - 8,
                    width: textWidth + 8,
                    height: 16
                };
            } else {
                // For vertical dimensions, swap width/height for rotated text
                labelBounds = {
                    x: labelX - 8,
                    y: labelY - textWidth / 2 - 4,
                    width: 16,
                    height: textWidth + 8
                };
            }
            
            // Check for overlaps with existing labels
            const hasOverlap = placedLabels.some(existing => {
                return !(labelBounds.x + labelBounds.width < existing.x || 
                       existing.x + existing.width < labelBounds.x ||
                       labelBounds.y + labelBounds.height < existing.y ||
                       existing.y + existing.height < labelBounds.y);
            });
            
            if (!hasOverlap) break;
            
            // Increase offset and try again (reduced increment for tighter spacing)
            offset += 15;
            attempts++;
        } while (attempts < maxAttempts);
        
        // console.log(`🎨 Dimension label positioning for ${type}:`, {
        //     dimension: { startX, endX, startY, endY, length },
        //     isHorizontal,
        //     midX, midY,
        //     offset,
        //     scaleFactor: scaleFactor.current,
        //     canvasOffset: { x: offsetX.current, y: offsetY.current },
        //     calculatedPosition: { labelX, labelY }
        // });
        
        // Get final text for drawing
        const text = getDimensionText(dimension, length, quantity);
        const textWidth = ctx.measureText(text).width;
        
        // Simple validation: ensure label is not inside project area
        if (avoidArea) {
            // Convert label position back to model coordinates for comparison
            const labelModelX = (labelX - offsetX.current) / scaleFactor.current;
            const labelModelY = (labelY - offsetY.current) / scaleFactor.current;
            
            // Check if label center is inside the avoid area (project boundaries)
            const isInsideAvoidArea = labelModelX >= avoidArea.minX && 
                                     labelModelX <= avoidArea.maxX && 
                                     labelModelY >= avoidArea.minY && 
                                     labelModelY <= avoidArea.maxY;
            
            if (isInsideAvoidArea) {
                // Force placement further out if inside project area
                offset += 15; // Reduced increment for tighter spacing
                if (isHorizontal) {
                    if (midY < (minY + maxY) / 2) {
                        labelY = (minY * scaleFactor.current + offsetY.current - offset);
                    } else {
                        labelY = (maxY * scaleFactor.current + offsetY.current + offset);
                    }
                } else {
                    // For vertical dimensions, ensure minimum 30px separation from project area
                    if (midX < (minX + maxX) / 2) {
                        labelX = (minX * scaleFactor.current + offsetX.current - Math.max(offset, 30));
                    } else {
                        labelX = (maxX * scaleFactor.current + offsetX.current + Math.max(offset, 30));
                    }
                }
            }
        }
        
        // Final label bounds
        let finalLabelBounds;
        if (isHorizontal) {
            finalLabelBounds = {
                x: labelX - textWidth / 2 - 4,
                y: labelY - 8,
                width: textWidth + 8,
                height: 16
            };
        } else {
            finalLabelBounds = {
                x: labelX - 8,
                y: labelY - textWidth / 2 - 4,
                width: 16,
                height: textWidth + 8
            };
        }
        
        // Draw dimension lines using helper function
        drawDimensionLines(ctx, startX, startY, endX, endY, labelX, labelY, isHorizontal, scaleFactor.current, offsetX.current, offsetY.current, color);
        
        // Draw dimension text with simple background
        ctx.save();
        
        // Draw label background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        
        // Draw label background
        ctx.fillRect(finalLabelBounds.x, finalLabelBounds.y, finalLabelBounds.width, finalLabelBounds.height);
        ctx.strokeRect(finalLabelBounds.x, finalLabelBounds.y, finalLabelBounds.width, finalLabelBounds.height);
        
        // Draw dimension text with proper rotation for vertical dimensions
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.max(12, 14 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        
        if (isHorizontal) {
            // Horizontal text
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, labelX, labelY);
        } else {
            // Vertical text - rotate 90 degrees
            ctx.save();
            ctx.translate(labelX, labelY);
            ctx.rotate(-Math.PI / 2); // Rotate 90 degrees counterclockwise
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 0, 0);
            ctx.restore();
        }
        
        ctx.restore();
        
        // Add to placed labels for collision detection
        placedLabels.push({
            x: finalLabelBounds.x,
            y: finalLabelBounds.y,
            width: finalLabelBounds.width,
            height: finalLabelBounds.height,
            text: text,
            type: type
        });
        
        // Add to all labels for global tracking
        allLabels.push({
            x: finalLabelBounds.x,
            y: finalLabelBounds.y,
            width: finalLabelBounds.width,
            height: finalLabelBounds.height,
            text: text,
            type: type
        });
        
        console.log(`✅ Dimension drawn successfully:`, {
            type,
            priority,
            text,
            position: { x: finalLabelBounds.x, y: finalLabelBounds.y },
            isHorizontal,
            angle: angle.toFixed(1),
            roomId: dimension.roomId || 'unknown'
        });
        
        // Validate final position is within canvas bounds
        const isValidPosition = finalLabelBounds.x >= 0 && 
                               finalLabelBounds.y >= 0 && 
                               finalLabelBounds.x + finalLabelBounds.width <= CANVAS_WIDTH && 
                               finalLabelBounds.y + finalLabelBounds.height <= CANVAS_HEIGHT;
        
        if (!isValidPosition) {
            console.log(`⚠️ Dimension ${type} position invalid, skipping:`, finalLabelBounds);
            return; // Skip drawing this dimension
        }
        
        ctx.restore();
    };

    // Draw title and information
    const drawTitle = (ctx) => {
        const title = 'CEILING PLAN';
        
        // Title
        ctx.font = `bold ${Math.max(20, 28 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#1f2937';
        ctx.fillText(title, CANVAS_WIDTH / 2, 30);
        
        // Scale indicator
        ctx.font = `${Math.max(12, 14 * scaleFactor.current)}px 'Segoe UI', Arial, sans-serif`;
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'left';
        ctx.fillText(`Scale: ${currentScale.toFixed(2)}x`, 20, CANVAS_HEIGHT - 30);
    };

    // Mouse event handlers
    const handleMouseDown = (e) => {
        isDragging.current = true;
        const rect = canvasRef.current.getBoundingClientRect();
        lastMousePos.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const handleMouseMove = (e) => {
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

        // Determine panel orientation from the first available panel
        let isHorizontalOrientation = false;
        for (const roomId in effectiveCeilingPanelsMap) {
            const roomPanels = effectiveCeilingPanelsMap[roomId];
            if (roomPanels && roomPanels.length > 0) {
                isHorizontalOrientation = roomPanels[0].width > roomPanels[0].length;
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
    };

    // Zoom functions
    const handleZoomIn = () => {
        console.log('🔍 Zoom In clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        console.log('Current currentScale state:', currentScale);
        
        const newScale = Math.min(3.0, scaleFactor.current * 1.2);
        console.log('Calculated new scale:', newScale);
        
        zoomToCenter(newScale);
    };

    const handleZoomOut = () => {
        console.log('🔍 Zoom Out clicked!');
        console.log('Current scaleFactor:', scaleFactor.current);
        console.log('Current currentScale state:', currentScale);
        console.log('Initial scale:', initialScale.current);
        
        // Use the initial scale as the minimum instead of hardcoded 0.1
        const newScale = Math.max(initialScale.current, scaleFactor.current * 0.8);
        console.log('Calculated new scale:', newScale);
        
        zoomToCenter(newScale);
    };

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

    // Panel click detection and custom support placement
    const handleCanvasClick = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // If custom support placement is enabled, handle support placement
        if (aluSuspensionCustomDrawing && isPlacingSupport) {
            // Convert canvas coordinates to model coordinates
            let modelX = (clickX - offsetX.current) / scaleFactor.current;
            let modelY = (clickY - offsetY.current) / scaleFactor.current;
            
            // Apply boundary snapping for support placement
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
            
            if (!supportStartPoint) {
                // First click - set start point
                setSupportStartPoint({ x: modelX, y: modelY });
                setSupportPreview({ startX: modelX, startY: modelY, endX: modelX, endY: modelY });
            } else {
                // Second click - finish support line and place supports on intersecting panels
                const intersectingPanels = findIntersectingPanels(
                    supportStartPoint.x, supportStartPoint.y, modelX, modelY
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
                                endX: modelX,
                                endY: modelY
                            },
                            isIntersectionPoint: true
                        });
                    });
                });
                
                setCustomSupports(prev => [...prev, ...newSupports]);
                
                // Reset placement state
                setSupportStartPoint(null);
                setSupportPreview(null);
                setIsPlacingSupport(false);
                
                // Redraw canvas
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                    drawCanvas(ctx);
                }
            }
            return;
        }
        
        // Check if clicked on a panel
        for (let i = 0; i < effectiveRooms.length; i++) {
            const room = effectiveRooms[i];
            const roomPanels = effectiveCeilingPanelsMap[room.id] || [];
            
            for (let j = 0; j < roomPanels.length; j++) {
                const panel = roomPanels[j];
                const x = panel.start_x * scaleFactor.current + offsetX.current;
                const y = panel.start_y * scaleFactor.current + offsetY.current;
                const width = (panel.end_x - panel.start_x) * scaleFactor.current;
                const height = panel.end_y - panel.start_y ? Math.abs(panel.end_y - panel.start_y) * scaleFactor.current : (room ? Math.abs(Math.max(...room.room_points.map(p => p.y)) - Math.min(...room.room_points.map(p => p.y))) * scaleFactor.current : 10000 * scaleFactor.current);
                
                if (clickX >= x && clickX <= x + width && clickY >= y && clickY <= y + height) {
                    onPanelSelect?.(panel.id);
                    onRoomSelect?.(room.id); // Also select the room
                    return;
                }
            }
        }
        
        // Clicked on empty space, deselect
        onPanelSelect?.(null);
    };

    // Support visualization functions
    const drawNylonHanger = (ctx, panel, scaleFactor, offsetX, offsetY) => {
        // Calculate panel center using the same transformation as drawCeilingPanels
        const x = panel.start_x * scaleFactor + offsetX;
        const y = panel.start_y * scaleFactor + offsetY;
        const width = panel.width * scaleFactor;
        const height = panel.length * scaleFactor;
        
        // Calculate center of the transformed panel
        const canvasX = x + width / 2;
        const canvasY = y + height / 2;
        
        // Draw circle for nylon hanger - made much bigger and no fill
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 75 * scaleFactor, 0, 2 * Math.PI);
        ctx.strokeStyle = '#000000'; // Black
        ctx.lineWidth = 30 * scaleFactor; // Much thicker line for better visibility
        ctx.stroke();
        
        // Draw accessories indicator if enabled - adjusted for bigger circle
        if (nylonHangerOptions.includeAccessories) {
            ctx.beginPath();
            ctx.arc(canvasX, canvasY, 45 * scaleFactor, 0, 2 * Math.PI);
            ctx.strokeStyle = '#f59e0b'; // Orange
            ctx.lineWidth = 2 * scaleFactor;
            ctx.setLineDash([5 * scaleFactor, 5 * scaleFactor]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        // Draw cable indicator if enabled - adjusted for bigger circle
        if (nylonHangerOptions.includeCable) {
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
        
        // Draw support line
        const lineLength = 30 * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(canvasX - lineLength / 2, canvasY);
        ctx.lineTo(canvasX + lineLength / 2, canvasY);
        ctx.strokeStyle = '#8b5cf6'; // Purple
        ctx.lineWidth = 3 * scaleFactor;
        ctx.stroke();
        
        // Draw * symbol at panel center
        ctx.fillStyle = '#8b5cf6';
        ctx.font = `bold ${Math.max(12, 14 * scaleFactor)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('*', canvasX, canvasY);
        
        // Draw small squares at start and end
        const squareSize = 6 * scaleFactor;
        ctx.fillStyle = '#8b5cf6';
        
        // Start square
        ctx.fillRect(canvasX - lineLength / 2 - squareSize / 2, canvasY - squareSize / 2, squareSize, squareSize);
        
        // End square
        ctx.fillRect(canvasX + lineLength / 2 - squareSize / 2, canvasY - squareSize / 2, squareSize, squareSize);
    };



    const drawPanelSupports = (ctx, roomPanels, scaleFactor, offsetX, offsetY) => {
        // Determine panel orientation by checking if panels are wider than tall
        // For ceiling panels: if width > length, it's horizontal (panels run left-to-right)
        // If width < length, it's vertical (panels run up-to-down)
        const isHorizontalOrientation = roomPanels.length > 0 && 
            roomPanels[0].width > roomPanels[0].length;
        
        console.log(`🔧 Drawing panel supports:`, {
            supportType,
            totalPanels: roomPanels.length,
            orientation: isHorizontalOrientation ? 'horizontal' : 'vertical',
            firstPanel: roomPanels.length > 0 ? {
                width: roomPanels[0].width,
                length: roomPanels[0].length,
                ratio: roomPanels[0].width / roomPanels[0].length
            } : 'No panels',
            panelsNeedingSupport: roomPanels.filter(p => {
                // For horizontal orientation: check width > 6000mm
                // For vertical orientation: check length > 6000mm
                return isHorizontalOrientation ? p.width > 6000 : p.length > 6000;
            }).length
        });
        
        roomPanels.forEach(panel => {
            // Check if panel needs support based on orientation
            const needsSupport = isHorizontalOrientation ? 
                panel.width > 6000 :  // Horizontal: check width
                panel.length > 6000;  // Vertical: check length
            
            console.log(`🔧 Panel ${panel.id} support check:`, {
                panelId: panel.id,
                width: panel.width,
                length: panel.length,
                orientation: isHorizontalOrientation ? 'horizontal' : 'vertical',
                dimensionChecked: isHorizontalOrientation ? panel.width : panel.length,
                needsSupport: needsSupport,
                supportType
            });
            
            if (needsSupport) {
                console.log(`🔧 Panel ${panel.id} needs support:`, {
                    panelId: panel.id,
                    width: panel.width,
                    length: panel.length,
                    orientation: isHorizontalOrientation ? 'horizontal' : 'vertical',
                    dimensionChecked: isHorizontalOrientation ? panel.width : panel.length,
                    supportType
                });
                
                // Only draw nylon hanger supports by default (no ALU suspension)
                if (supportType === 'nylon') {
                    drawNylonHanger(ctx, panel, scaleFactor, offsetX, offsetY);
                }
                // ALU suspension is only available through custom drawing
            }
        });
    };

    // Draw custom supports placed by user
    const drawCustomSupports = (ctx, supports, scaleFactor, offsetX, offsetY) => {
        supports.forEach(support => {
            if (support.isIntersectionPoint) {
                // Draw * symbol at intersection points
                const x = support.x * scaleFactor + offsetX;
                const y = support.y * scaleFactor + offsetY;
                
                ctx.fillStyle = '#8b5cf6'; // Purple for intersection points
                ctx.font = `bold ${Math.max(16, 18 * scaleFactor)}px Arial`;
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
        const text = `${distance}mm`;
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
                            {effectiveRooms.length > 0 ? effectiveRooms[0]?.room_name || 'Room' : 'Room'} - Professional Layout
                        </p>
                    </div>
                    {ceilingPlan && (
                        <div className="text-right">
                            <div className="text-sm text-gray-500 mb-1">Plan Summary</div>
                            <div className="text-2xl font-bold text-blue-600">
                                {getAccuratePanelCounts.total} Panels
                            </div>
                        </div>
                    )}
                </div>
                

                

            </div>

            <div className="flex gap-8">
                {/* Canvas Container */}
                <div className="ceiling-canvas-wrapper flex-1">
                    <div className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg relative">
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
                            className="ceiling-canvas cursor-grab active:cursor-grabbing block w-full"
                            style={{
                                width: `${CANVAS_WIDTH}px`,
                                height: `${CANVAS_HEIGHT}px`,
                                maxWidth: '100%',
                                maxHeight: '70vh'
                            }}
                            onMouseDown={handleMouseDown}
                            onMouseMove={(e) => {
                                handleMouseMove(e);
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
                        <span className="font-medium">Click panels to select • Drag to pan • Use zoom buttons</span>
                    </div>
                    {aluSuspensionCustomDrawing && (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsPlacingSupport(!isPlacingSupport)}
                                className={`px-3 py-1 text-sm rounded transition-colors ${
                                    isPlacingSupport 
                                        ? 'bg-red-500 text-white hover:bg-red-600' 
                                        : 'bg-blue-500 text-white hover:bg-blue-600'
                                }`}
                            >
                                {isPlacingSupport ? 'Cancel Support' : 'Place Support'}
                            </button>
                            <button
                                onClick={() => {
                                    setCustomSupports([]);
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
                            {customSupports.length > 0 && (
                                <span className="text-sm text-gray-600">
                                    {customSupports.length} custom support{customSupports.length !== 1 ? 's' : ''} placed
                                </span>
                            )}
                        </div>
                    )}
                    </div>
                    

                </div>

                {/* Summary Sidebar */}
                <div className="ceiling-summary-sidebar flex-shrink-0">
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl p-6 min-w-[320px] shadow-lg">
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
                                                {getAccuratePanelCounts.total > 0 ? 
                                                    ((getAccuratePanelCounts.cut / getAccuratePanelCounts.total) * 100).toFixed(1) : '0.0'
                                                }%
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Current Strategy:</span>
                                            <span className="font-bold text-purple-600">Auto</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600">Recommended:</span>
                                            <span className="font-bold text-green-600">all_vertical</span>
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
                                                            // Determine panel orientation
                                                            const isHorizontalOrientation = effectiveRooms.length > 0 && 
                                                                effectiveRooms[0] && effectiveCeilingPanelsMap[effectiveRooms[0].id] && 
                                                                effectiveCeilingPanelsMap[effectiveRooms[0].id].length > 0 &&
                                                                effectiveCeilingPanelsMap[effectiveRooms[0].id][0].width > effectiveCeilingPanelsMap[effectiveRooms[0].id][0].length;
                                                            
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

                                {/* Dimension Legend */}
                                <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
                                    <h5 className="font-semibold text-gray-900 mb-4 flex items-center">
                                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        Dimension Legend
                                    </h5>
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

