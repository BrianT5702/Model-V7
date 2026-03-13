import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../api/api';
import PanelCalculator from '../panel/PanelCalculator';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doPolygonsOverlap, findIntersectionPointsBetweenWalls, calculatePolygonVisualCenter, isPointInPolygon } from '../canvas/utils';
import { calculateOffsetPoints, calculateActualProjectDimensions } from '../canvas/drawing';
import { DIMENSION_CONFIG } from '../canvas/DimensionConfig';
import { 
    smartPlacement, 
    calculateHorizontalLabelBounds, 
    calculateVerticalLabelBounds, 
    hasLabelOverlap 
} from '../canvas/collisionDetection';
import { filterDimensions, shouldShowWallDimension } from '../canvas/dimensionFilter';

// Copy color mapping functions from drawing.js
function getWallFinishKey(wall) {
    const intMat = wall.inner_face_material || 'PPGI';
    const intThk = wall.inner_face_thickness != null ? wall.inner_face_thickness : 0.5;
    const extMat = wall.outer_face_material || 'PPGI';
    const extThk = wall.outer_face_thickness != null ? wall.outer_face_thickness : 0.5;
    const coreThk = wall.thickness;
    return `${coreThk}|INT:${intThk} ${intMat}|EXT:${extThk} ${extMat}`;
}

function generateThicknessColorMap(walls) {
    if (!walls || walls.length === 0) return new Map();
    const keys = [...new Set(walls.map(getWallFinishKey))];
    const colorMap = new Map();
    
    if (keys.length === 1) {
        const onlyKey = keys[0];
        const wall = walls.find(w => getWallFinishKey(w) === onlyKey);
        const hasDiffFaces = wall && 
            (wall.inner_face_material || 'PPGI') !== (wall.outer_face_material || 'PPGI');
        
        if (hasDiffFaces) {
            const innerHue = 200;
            const outerHue = 0;
            colorMap.set(onlyKey, {
                wall: `hsl(${outerHue}, 70%, 35%)`,
                partition: `hsl(${outerHue}, 60%, 50%)`,
                innerWall: `hsl(${innerHue}, 70%, 35%)`,
                innerPartition: `hsl(${innerHue}, 60%, 50%)`,
                hasDifferentFaces: true
            });
        } else {
            colorMap.set(onlyKey, { wall: '#333', partition: '#666', hasDifferentFaces: false });
        }
        return colorMap;
    }
    
    keys.forEach((key, index) => {
        const wall = walls.find(w => getWallFinishKey(w) === key);
        const hasDiffFaces = wall && 
            (wall.inner_face_material || 'PPGI') !== (wall.outer_face_material || 'PPGI');
        
        if (hasDiffFaces) {
            const hueOuter = (index * 360) / keys.length;
            const hueInner = ((index * 360) / keys.length + 180) % 360;
            colorMap.set(key, {
                wall: `hsl(${hueOuter}, 70%, 35%)`,
                partition: `hsl(${hueOuter}, 60%, 50%)`,
                innerWall: `hsl(${hueInner}, 70%, 35%)`,
                innerPartition: `hsl(${hueInner}, 60%, 50%)`,
                hasDifferentFaces: true
            });
        } else {
            const hue = (index * 360) / keys.length;
            colorMap.set(key, {
                wall: `hsl(${hue}, 70%, 35%)`,
                partition: `hsl(${hue}, 60%, 50%)`,
                hasDifferentFaces: false
            });
        }
    });
    
    return colorMap;
}

// Convert HSL to RGB for jsPDF
function hslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function parseHslColor(hslString) {
    if (!hslString || typeof hslString !== 'string') {
        return [0, 0, 0];
    }
    const match = hslString.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return [0, 0, 0];
    const h = parseInt(match[1], 10);
    const s = parseInt(match[2], 10);
    const l = parseInt(match[3], 10);
    
    // Validate parsed values
    if (isNaN(h) || isNaN(s) || isNaN(l) || !isFinite(h) || !isFinite(s) || !isFinite(l)) {
        return [0, 0, 0];
    }
    
    const rgb = hslToRgb(h, s, l);
    
    // Validate RGB result
    if (!rgb || rgb.length !== 3 || rgb.some(v => isNaN(v) || !isFinite(v))) {
        return [0, 0, 0];
    }
    
    return rgb;
}

const InstallationTimeEstimator = ({ 
    projectId, 
    sharedPanelData = null, 
    updateSharedPanelData = null, 
    updateCanvasImage = null, 
    setCurrentView = null,
    isCapturingImages = false,
    setIsCapturingImages = null,
    captureSuccess = false,
    setCaptureSuccess = null,
    activeStoreyId = null,
    setActiveStoreyId = null,
    allWalls = [],
    roomsFromParent = null,
    wallsFromParent = null,
    doorsFromParent = null,
    storeysFromParent = null,
    projectDataFromParent = null
}) => {
    const [projectData, setProjectData] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [storeys, setStoreys] = useState([]);
    const [ceilingPlans, setCeilingPlans] = useState([]);
    const [floorPlans, setFloorPlans] = useState([]);
    const [walls, setWalls] = useState([]);
    const [doors, setDoors] = useState([]);
    
    // User input fields for installation rates
    const [panelsPerDay, setPanelsPerDay] = useState(20);
    const [doorsPerDay, setDoorsPerDay] = useState(2);
    const [slabsPerDay, setSlabsPerDay] = useState(10);

    // Slab dimensions (mm) - synced with Floor Plan tab via localStorage
    const [slabWidth, setSlabWidth] = useState(1210);
    const [slabLength, setSlabLength] = useState(3000);

    // Loading states
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // Export states
    const [showExportPreview, setShowExportPreview] = useState(false);
    const [exportData, setExportData] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    
    // Canvas image states for export
    const [planImages, setPlanImages] = useState({
        wallPlan: null, // Single image (legacy) or array of {storeyId, storeyName, imageData}
        wallPlansByStorey: [], // Array of {storeyId, storeyName, imageData} for floor-by-floor wall plans
        ceilingPlan: null,
        floorPlan: null
    });
    
    // Expand/collapse states for panel tables in preview
    const [expandedTables, setExpandedTables] = useState({
        wallPanels: false,
        ceilingPanels: false,
        floorPanels: false,
        rooms: false,
        slabs: false,
        doors: false
    });
    
    // PDF export settings
    const [planRotation, setPlanRotation] = useState(0); // Rotation angle in degrees (0, 90, 180, 270)
    const [planPageOrientation, setPlanPageOrientation] = useState('portrait'); // 'portrait' or 'landscape' for plan pages
    const [singlePlanPerPage, setSinglePlanPerPage] = useState(true); // Each plan takes a full page
    const [fitToPage, setFitToPage] = useState(false); // Fit plan to fill entire page without boundary
    
    const toggleTableExpansion = (tableName) => {
        setExpandedTables(prev => ({
            ...prev,
            [tableName]: !prev[tableName]
        }));
    };

    // Load slab dimensions from localStorage (same as Floor Plan tab) on mount and when projectId changes
    useEffect(() => {
        if (!projectId) return;
        try {
            const raw = localStorage.getItem(`floor_plan_slab_${projectId}`);
            if (raw) {
                const { width, length } = JSON.parse(raw);
                if (typeof width === 'number' && width > 0) setSlabWidth(width);
                if (typeof length === 'number' && length > 0) setSlabLength(length);
            }
        } catch (_) { /* ignore */ }
    }, [projectId]);

    // Log shared panel data when it changes
    useEffect(() => {
        if (sharedPanelData) {
            console.log('InstallationTimeEstimator received shared panel data:', sharedPanelData);
        }
    }, [sharedPanelData]);

    // Sync project/rooms/walls/doors/storeys from parent when provided so summary matches rest of app
    useEffect(() => {
        if (Array.isArray(roomsFromParent)) setRooms(roomsFromParent);
    }, [roomsFromParent]);
    useEffect(() => {
        if (Array.isArray(wallsFromParent)) setWalls(wallsFromParent);
    }, [wallsFromParent]);
    useEffect(() => {
        if (Array.isArray(doorsFromParent)) setDoors(doorsFromParent);
    }, [doorsFromParent]);
    useEffect(() => {
        if (Array.isArray(storeysFromParent)) setStoreys(storeysFromParent);
    }, [storeysFromParent]);
    useEffect(() => {
        if (projectDataFromParent && typeof projectDataFromParent === 'object') setProjectData(projectDataFromParent);
    }, [projectDataFromParent]);

    // Set plan export defaults from project dimensions: width > length → landscape; else portrait. Always fit to page, one per page.
    useEffect(() => {
        const proj = projectData;
        const w = proj?.width;
        const l = proj?.length;
        if (typeof w === 'number' && typeof l === 'number') {
            setPlanPageOrientation(w > l ? 'landscape' : 'portrait');
            setFitToPage(true);
            setSinglePlanPerPage(true);
        }
        // Intentionally depend only on width/length so we don't reset when other project fields change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectData?.width, projectData?.length]);

    // Fetch all project data
    useEffect(() => {
        const fetchProjectData = async () => {
            try {
                setIsLoading(true);
                setError(null);

                // Fetch project details
                const projectResponse = await api.get(`/projects/${projectId}/`);
                setProjectData(projectResponse.data);

                // Fetch storeys
                const storeysResponse = await api.get(`/storeys/?project=${projectId}`);
                setStoreys(storeysResponse.data);

                // Fetch rooms
                const roomsResponse = await api.get(`/rooms/?project=${projectId}`);
                setRooms(roomsResponse.data);

                // Fetch ceiling plans for all rooms
                const ceilingPlansPromises = roomsResponse.data.map(room => 
                    api.get(`/ceiling-plans/?room=${room.id}`)
                );
                const ceilingResponses = await Promise.all(ceilingPlansPromises);
                const allCeilingPlans = ceilingResponses.flatMap(response => response.data);
                setCeilingPlans(allCeilingPlans);

                // Fetch floor plans for all rooms
                const floorPlansPromises = roomsResponse.data.map(room => 
                    api.get(`/floor-plans/?room=${room.id}`)
                );
                const floorResponses = await Promise.all(floorPlansPromises);
                const allFloorPlans = floorResponses.flatMap(response => response.data);
                setFloorPlans(allFloorPlans);

                // Fetch walls for panel calculation
                try {
                    const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
                    setWalls(wallsResponse.data);
                } catch (wallErr) {
                    console.log('Walls not available');
                    setWalls([]);
                }

                // Fetch doors from project data
                try {
                    const doorsResponse = await api.get(`/doors/?project=${projectId}`);
                    setDoors(doorsResponse.data);
                } catch (doorErr) {
                    console.log('Doors not available');
                    setDoors([]);
                }

                // Auto-fetch existing panel data if available
                await autoFetchExistingPanelData(projectId, roomsResponse.data);

            } catch (err) {
                console.error('Error fetching project data:', err);
                setError('Failed to load project data. Please try again.');
            } finally {
                setIsLoading(false);
            }
        };

        if (projectId) {
            fetchProjectData();
        }
    }, [projectId]);

    // Auto-fetch existing panel data from all tabs
    const autoFetchExistingPanelData = async (projectId, rooms) => {
        if (!updateSharedPanelData) return;
        
        try {
            // 1. Auto-fetch existing wall panel data
            await autoFetchWallPanelData(projectId);
            
            // 2. Auto-fetch existing ceiling panel data
            await autoFetchCeilingPanelData(projectId, rooms);
            
            // 3. Auto-fetch existing floor panel data
            await autoFetchFloorPanelData(projectId, rooms);
            
            console.log('✅ Auto-fetch completed');
        } catch (error) {
            console.error('Error auto-fetching panel data:', error);
        }
    };

    // Manual refresh function to reload all project data
    const handleManualRefresh = async () => {
        try {
            setIsLoading(true);
            setError(null);
            console.log('🔄 Manual refresh triggered...');

            // Fetch project details
            const projectResponse = await api.get(`/projects/${projectId}/`);
            setProjectData(projectResponse.data);

            // Fetch storeys
            const storeysResponse = await api.get(`/storeys/?project=${projectId}`);
            setStoreys(storeysResponse.data);

            // Fetch rooms
            const roomsResponse = await api.get(`/rooms/?project=${projectId}`);
            setRooms(roomsResponse.data);

            // Fetch ceiling plans for all rooms
            const ceilingPlansPromises = roomsResponse.data.map(room => 
                api.get(`/ceiling-plans/?room=${room.id}`)
            );
            const ceilingResponses = await Promise.all(ceilingPlansPromises);
            const allCeilingPlans = ceilingResponses.flatMap(response => response.data);
            setCeilingPlans(allCeilingPlans);

            // Fetch floor plans for all rooms
            const floorPlansPromises = roomsResponse.data.map(room => 
                api.get(`/floor-plans/?room=${room.id}`)
            );
            const floorResponses = await Promise.all(floorPlansPromises);
            const allFloorPlans = floorResponses.flatMap(response => response.data);
            setFloorPlans(allFloorPlans);

            // Fetch walls for panel calculation
            try {
                const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
                setWalls(wallsResponse.data);
                console.log(`✅ Refreshed walls: ${wallsResponse.data.length} walls loaded`);
            } catch (wallErr) {
                console.log('Walls not available');
                setWalls([]);
            }

            // Fetch doors from project data
            try {
                const doorsResponse = await api.get(`/doors/?project=${projectId}`);
                setDoors(doorsResponse.data);
                console.log(`✅ Refreshed doors: ${doorsResponse.data.length} doors loaded`);
            } catch (doorErr) {
                console.log('Doors not available');
                setDoors([]);
            }

            // Re-read slab dimensions from localStorage (synced with Floor Plan tab)
            try {
                const raw = projectId ? localStorage.getItem(`floor_plan_slab_${projectId}`) : null;
                if (raw) {
                    const { width, length } = JSON.parse(raw);
                    if (typeof width === 'number' && width > 0) setSlabWidth(width);
                    if (typeof length === 'number' && length > 0) setSlabLength(length);
                }
            } catch (_) { /* ignore */ }

            // Auto-fetch existing panel data if available
            await autoFetchExistingPanelData(projectId, roomsResponse.data);

            console.log('✅ Manual refresh completed successfully');
            
        } catch (err) {
            console.error('Error refreshing project data:', err);
            setError('Failed to refresh project data. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Capture canvas images by temporarily switching tabs
    const captureAllCanvasImages = async (currentViewSetter) => {
        console.log('🖼️ Starting automatic canvas capture...');
        const originalView = 'installation-estimator';
        const capturedImages = {
            wall: false,
            ceiling: false,
            floor: false
        };
        
        // Store original activeStoreyId to restore later
        const originalActiveStoreyId = activeStoreyId;
        
        try {
            // Helper function to remove grid lines from canvas image
            // planType: 'wall' | 'ceiling' | 'floor'
            // - floor uses #fafafa background to match FloorCanvas
            // - ceiling uses higher tolerance and looser alpha guard (similar to floor) to strip anti-aliased grid
            const removeGridFromCanvas = (sourceCanvas, planType = 'wall') => {
                console.log(`🎨 Removing grid lines from canvas (plan: ${planType})...`);
                
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = sourceCanvas.width;
                tempCanvas.height = sourceCanvas.height;
                const tempCtx = tempCanvas.getContext('2d');
                
                const isFloor = planType === 'floor';
                const isCeiling = planType === 'ceiling';
                // FloorCanvas uses #fafafa; others (including ceiling) can safely use white-ish backgrounds
                const bgR = isFloor ? 250 : 255;
                const bgG = isFloor ? 250 : 255;
                const bgB = isFloor ? 250 : 255;
                tempCtx.fillStyle = isFloor ? '#fafafa' : '#FFFFFF';
                tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                
                tempCtx.drawImage(sourceCanvas, 0, 0);
                
                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;
                
                // Grid: #ddd = rgb(221, 221, 221) - FloorCanvas and Canvas2D/CeilingCanvas use same
                const gridR = 221, gridG = 221, gridB = 221;
                const tolerance = isFloor ? 40 : 20; // Floor still uses relaxed match on #ddd; ceiling handled by light-grey rule below
                
                let pixelsChanged = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];
                    
                    // Base grid match on configured color (used mainly for wall/floor)
                    let isGridColor =
                        Math.abs(r - gridR) <= tolerance &&
                        Math.abs(g - gridG) <= tolerance &&
                        Math.abs(b - gridB) <= tolerance;
                    
                    // For CEILING specifically, treat any very light grey as grid (background is #fafafa).
                    // This aggressively strips the dashed grid without touching darker elements (walls, panels, text).
                    if (isCeiling) {
                        if (r >= 220 && g >= 220 && b >= 220 && (r < 255 || g < 255 || b < 255)) {
                            isGridColor = true;
                        }
                    } else if (!isGridColor && isFloor) {
                        // Floor fallback: also treat very light greys as grid
                        if (r >= 220 && g >= 220 && b >= 220 && (r < 255 || g < 255 || b < 255)) {
                            isGridColor = true;
                        }
                    }
                    
                    // For floor and ceiling plans, also strip semi-transparent grid pixels (no alpha check);
                    // for wall plans, keep the original \"visible pixel\" alpha guard.
                    if (isGridColor && (isFloor || isCeiling || a > 200)) {
                        data[i] = bgR;
                        data[i + 1] = bgG;
                        data[i + 2] = bgB;
                        pixelsChanged++;
                    }
                }
                
                console.log(`✅ Removed ${pixelsChanged / 4} grid pixels (${planType})`);
                tempCtx.putImageData(imageData, 0, 0);
                return tempCanvas;
            };
            
            // Helper function to check if point is in polygon (ray casting algorithm)
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
            
            // Helper function to calculate room center if no label_position
            const calculateRoomCenter = (room) => {
                if (!room.room_points || room.room_points.length < 3) {
                    return null;
                }
                const sumX = room.room_points.reduce((sum, p) => sum + (Number(p.x) || 0), 0);
                const sumY = room.room_points.reduce((sum, p) => sum + (Number(p.y) || 0), 0);
                return {
                    x: sumX / room.room_points.length,
                    y: sumY / room.room_points.length
                };
            };
            
            // Helper function to check if room can contain label
            const canRoomContainLabel = (room, scaleFactor) => {
                if (!room.room_points || room.room_points.length < 3) {
                    return true; // No boundary, assume it can contain
                }
                const normalizedPolygon = room.room_points.map(pt => ({
                    x: Number(pt.x) || 0,
                    y: Number(pt.y) || 0
                }));
                const minX = Math.min(...normalizedPolygon.map(p => p.x));
                const maxX = Math.max(...normalizedPolygon.map(p => p.x));
                const minY = Math.min(...normalizedPolygon.map(p => p.y));
                const maxY = Math.max(...normalizedPolygon.map(p => p.y));
                const roomWidth = maxX - minX;
                const roomHeight = maxY - minY;
                const baseLabelWidth = 140;
                const baseLabelHeight = 50;
                const labelWidth = baseLabelWidth / scaleFactor;
                const labelHeight = baseLabelHeight / scaleFactor;
                const margin = 20 / scaleFactor;
                return roomWidth >= labelWidth + margin && roomHeight >= labelHeight + margin;
            };
            
            // Helper function to draw room labels on canvas
            const drawRoomLabelsOnCanvas = (ctx, rooms, scaleFactor, offsetX, offsetY) => {
                if (!rooms || rooms.length === 0) {
                    console.log('⚠️ No rooms to draw labels for');
                    return;
                }
                
                // Include all rooms from all storeys for PDF/summary export
                // No longer filtering to only ground floor - show all floors
                const allRooms = rooms;
                
                if (allRooms.length === 0) {
                    console.log('⚠️ No rooms to draw labels for');
                    return;
                }
                
                console.log(`🎨 Drawing labels for ${allRooms.length} rooms from all storeys, scaleFactor=${scaleFactor}, offsetX=${offsetX}, offsetY=${offsetY}`);
                
                let labelsDrawn = 0;
                allRooms.forEach((room) => {
                    // Get label position - ALWAYS prioritize stored user position
                    let labelPos = null;
                    let usingStoredPosition = false;
                    
                    if (room.label_position != null &&
                        typeof room.label_position.x === 'number' && !isNaN(room.label_position.x) &&
                        typeof room.label_position.y === 'number' && !isNaN(room.label_position.y)) {
                        labelPos = { x: room.label_position.x, y: room.label_position.y };
                        usingStoredPosition = true;
                    } else if (Array.isArray(room.label_position) && room.label_position.length >= 2) {
                        const lx = Number(room.label_position[0]);
                        const ly = Number(room.label_position[1]);
                        if (!isNaN(lx) && !isNaN(ly)) {
                            labelPos = { x: lx, y: ly };
                            usingStoredPosition = true;
                        }
                    }
                    if (!labelPos && room.room_points && room.room_points.length >= 3) {
                        const normalizedPolygon = room.room_points.map(pt => ({
                            x: Number(pt.x) || (Array.isArray(pt) ? Number(pt[0]) : 0),
                            y: Number(pt.y) || (Array.isArray(pt) ? Number(pt[1]) : 0)
                        }));
                        const visual = calculatePolygonVisualCenter(normalizedPolygon);
                        if (visual) labelPos = visual;
                    }
                    if (!labelPos) {
                        labelPos = calculateRoomCenter(room);
                    }
                    if (!labelPos) {
                        console.log(`⚠️ Room ${room.id} (${room.room_name}) has no label_position and no room_points, skipping`);
                        return;
                    }
                    
                    // Calculate canvas position using the EXACT same formula as InteractiveRoomLabel
                    // InteractiveRoomLabel uses: canvasX = currentPosition.x * scaleFactor + offsetX
                    const canvasX = labelPos.x * scaleFactor + offsetX;
                    const canvasY = labelPos.y * scaleFactor + offsetY;
                    
                    console.log(`📍 Drawing label for room ${room.id} (${room.room_name}):`, {
                        usingStoredPosition,
                        modelPosition: { x: labelPos.x.toFixed(2), y: labelPos.y.toFixed(2) },
                        transform: { scaleFactor: scaleFactor.toFixed(4), offsetX: offsetX.toFixed(2), offsetY: offsetY.toFixed(2) },
                        canvasPosition: { x: canvasX.toFixed(2), y: canvasY.toFixed(2) }
                    });
                    
                    // Prepare text content (same format as InteractiveRoomLabel)
                    const name = room.room_name || 'Unnamed Room';
                    // Don't show temperature if it's 0°C
                    const tempValue = Number(room.temperature);
                    const temperature = (room.temperature !== undefined && room.temperature !== null && tempValue !== 0)
                        ? `${tempValue > 0 ? '+' : ''}${tempValue}°C`
                        : '';
                    const height = room.height ? `EXT. HT. ${room.height}mm` : 'EXT. HT. No height';
                    
                    // Format text lines
                    let lines = [];
                    if (temperature) {
                        if (name.length > 15) {
                            lines.push(name);
                            lines.push(temperature);
                        } else {
                            lines.push(`${name} ${temperature}`);
                        }
                    } else {
                        lines.push(name);
                    }
                    lines.push(height);
                    
                    // Draw text on canvas with better styling
                    ctx.save();
                    
                    // Set font size based on scale factor (similar to InteractiveRoomLabel)
                    const baseFontSize = 8;
                    const fontSize = Math.max(baseFontSize, baseFontSize * scaleFactor);
                    ctx.font = `${fontSize}px Arial`;
                    ctx.fillStyle = '#000000';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    // Calculate text dimensions
                    const lineHeight = fontSize + 2;
                    const totalHeight = lines.length * lineHeight;
                    const startY = canvasY - (totalHeight / 2) + (lineHeight / 2);
                    
                    // Draw each line
                    lines.forEach((line, index) => {
                        ctx.fillText(line, canvasX, startY + (index * lineHeight));
                    });
                    
                    ctx.restore();
                    
                    // Draw arrow if label is outside room and room is too small
                    if (room.room_points && room.room_points.length >= 3) {
                        const normalizedPolygon = room.room_points.map(pt => ({
                            x: Number(pt.x) || 0,
                            y: Number(pt.y) || 0
                        }));
                        
                        const isLabelOutsideRoom = !isPointInPolygon(labelPos, normalizedPolygon);
                        const roomCanContain = canRoomContainLabel(room, scaleFactor);
                        const shouldShowArrow = isLabelOutsideRoom && !roomCanContain;
                        
                        if (shouldShowArrow) {
                            // Calculate room center
                            const roomCenterX = normalizedPolygon.reduce((sum, p) => sum + p.x, 0) / normalizedPolygon.length;
                            const roomCenterY = normalizedPolygon.reduce((sum, p) => sum + p.y, 0) / normalizedPolygon.length;
                            
                            // Calculate direction from label to room center
                            const dx = roomCenterX - labelPos.x;
                            const dy = roomCenterY - labelPos.y;
                            const absDx = Math.abs(dx);
                            const absDy = Math.abs(dy);
                            
                            // Estimate label dimensions (approximate)
                            const estimatedLabelWidth = 120;
                            const estimatedLabelHeight = 50;
                            
                            // Determine starting point on label edge
                            let startX, startY;
                            let isHorizontalEdge = false;
                            
                            if (absDx > absDy) {
                                // Horizontal direction
                                isHorizontalEdge = true;
                                if (dx > 0) {
                                    startX = canvasX + estimatedLabelWidth / 2;
                                    startY = canvasY;
                                } else {
                                    startX = canvasX - estimatedLabelWidth / 2;
                                    startY = canvasY;
                                }
                            } else {
                                // Vertical direction
                                if (dy > 0) {
                                    startX = canvasX;
                                    startY = canvasY + estimatedLabelHeight / 2;
                                } else {
                                    startX = canvasX;
                                    startY = canvasY - estimatedLabelHeight / 2;
                                }
                            }
                            
                            // End point at room center (in canvas coordinates)
                            const endX = roomCenterX * scaleFactor + offsetX;
                            const endY = roomCenterY * scaleFactor + offsetY;
                            
                            // Create L-shaped path
                            let midX, midY;
                            if (isHorizontalEdge) {
                                midX = endX;
                                midY = startY;
                            } else {
                                midX = startX;
                                midY = endY;
                            }
                            
                            // Draw arrow (L-shaped path with arrowhead)
                            ctx.save();
                            ctx.strokeStyle = '#ff0000';
                            ctx.lineWidth = Math.max(1.2 * Math.sqrt(scaleFactor), 1);
                            ctx.lineCap = 'round';
                            ctx.lineJoin = 'round';
                            
                            // Draw first segment (horizontal or vertical)
                            ctx.beginPath();
                            ctx.moveTo(startX, startY);
                            ctx.lineTo(midX, midY);
                            ctx.stroke();
                            
                            // Draw second segment to room center
                            ctx.beginPath();
                            ctx.moveTo(midX, midY);
                            ctx.lineTo(endX, endY);
                            ctx.stroke();
                            
                            // Draw arrowhead
                            const angle = Math.atan2(endY - midY, endX - midX);
                            const arrowLength = 8;
                            ctx.beginPath();
                            ctx.moveTo(endX, endY);
                            ctx.lineTo(
                                endX - arrowLength * Math.cos(angle - Math.PI / 6),
                                endY - arrowLength * Math.sin(angle - Math.PI / 6)
                            );
                            ctx.moveTo(endX, endY);
                            ctx.lineTo(
                                endX - arrowLength * Math.cos(angle + Math.PI / 6),
                                endY - arrowLength * Math.sin(angle + Math.PI / 6)
                            );
                            ctx.stroke();
                            
                            ctx.restore();
                        }
                    }
                    
                    labelsDrawn++;
                });
                
                console.log(`✅ Drew ${labelsDrawn} room labels on canvas`);
            };
            
            // Helper function to capture after tab switch
            const captureFromTab = async (viewName, planType) => {
                console.log(`📸 Switching to ${viewName} to capture ${planType} plan...`);
                currentViewSetter(viewName);
                
                // Wait for canvas to render; ceiling and floor need extra time to mount and paint
                const initialWaitMs = (planType === 'floor' || planType === 'ceiling') ? 1200 : 800;
                const maxAttempts = 3;
                const retryWaitMs = 800;
                
                let canvas = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    const waitMs = attempt === 1 ? initialWaitMs : retryWaitMs;
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    canvas = document.querySelector(`canvas[data-plan-type="${planType}"]`);
                    if (canvas) break;
                    if (attempt < maxAttempts) {
                        console.warn(`⚠️ ${planType} plan canvas not found (attempt ${attempt}/${maxAttempts}), retrying in ${retryWaitMs}ms...`);
                    }
                }
                
                if (!canvas) {
                    console.warn(`❌ ${planType} plan canvas not found after ${maxAttempts} attempts – ${planType} plan may be missing in PDF. Ensure "${viewName}" view has finished loading.`);
                }
                
                if (canvas) {
                    try {
                        // Remove grid lines before capturing (pass planType so floor gets #fafafa replacement)
                        let cleanCanvas = removeGridFromCanvas(canvas, planType);
                        
                        // For wall plan, draw room labels on the canvas
                        if (planType === 'wall' && rooms && rooms.length > 0) {
                            console.log(`🔍 Attempting to draw room labels for ${rooms.length} rooms`);
                            
                            // Get transform values from canvas data attributes (set by Canvas2D)
                            // These MUST match the values used by InteractiveRoomLabel for correct positioning
                            const scaleFactorAttr = canvas.getAttribute('data-scale-factor');
                            const offsetXAttr = canvas.getAttribute('data-offset-x');
                            const offsetYAttr = canvas.getAttribute('data-offset-y');
                            
                            const scaleFactor = scaleFactorAttr ? parseFloat(scaleFactorAttr) : 1;
                            const offsetX = offsetXAttr ? parseFloat(offsetXAttr) : 0;
                            const offsetY = offsetYAttr ? parseFloat(offsetYAttr) : 0;
                            
                            // Validate transform values
                            if (isNaN(scaleFactor) || isNaN(offsetX) || isNaN(offsetY)) {
                                console.warn(`⚠️ Invalid transform values from canvas: scaleFactor=${scaleFactorAttr}, offsetX=${offsetXAttr}, offsetY=${offsetYAttr}`);
                            }
                            
                            console.log(`📐 Canvas transform values (from data attributes):`, {
                                scaleFactor: scaleFactor.toFixed(4),
                                offsetX: offsetX.toFixed(2),
                                offsetY: offsetY.toFixed(2),
                                raw: { scaleFactorAttr, offsetXAttr, offsetYAttr }
                            });
                            
                            // Create a new canvas with room labels drawn
                            const labeledCanvas = document.createElement('canvas');
                            labeledCanvas.width = canvas.width;
                            labeledCanvas.height = canvas.height;
                            const labeledCtx = labeledCanvas.getContext('2d');
                            
                            // Copy the clean canvas
                            labeledCtx.drawImage(cleanCanvas, 0, 0);
                            
                            // Draw room labels using the actual transform values
                            drawRoomLabelsOnCanvas(labeledCtx, rooms, scaleFactor, offsetX, offsetY);
                            
                            cleanCanvas = labeledCanvas;
                        }
                        
                        const imageData = cleanCanvas.toDataURL('image/png', 0.9);
                        
                        // Store via updateCanvasImage function
                        if (updateCanvasImage) {
                            updateCanvasImage(planType, imageData);
                        }
                        console.log(`✅ Captured ${planType} plan image (without grid${planType === 'wall' ? ', with room labels' : ''})`);
                        capturedImages[planType] = true;
                        return imageData;
                    } catch (err) {
                        console.warn(`Failed to capture ${planType} plan:`, err);
                    }
                }
                return null;
            };
            
            // For wall plan capture, capture each storey separately
            const wallPlansByStorey = [];
            
            if (setActiveStoreyId && storeys && storeys.length > 0) {
                console.log(`📐 Capturing wall plans for ${storeys.length} storeys separately...`);
                
                // Capture each storey's wall plan
                for (const storey of storeys) {
                    console.log(`📸 Capturing wall plan for storey: ${storey.name} (ID: ${storey.id})`);
                    
                    // Set active storey to this storey
                    setActiveStoreyId(storey.id);
                    // Wait for canvas to update
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Switch to wall-plan tab
                    currentViewSetter('wall-plan');
                    await new Promise(resolve => setTimeout(resolve, 800));
                    
                    // Capture the canvas for this storey
                    const canvas = document.querySelector(`canvas[data-plan-type="wall"]`);
                    if (canvas) {
                        try {
                            // Remove grid lines
                            let cleanCanvas = removeGridFromCanvas(canvas);
                            
                            // Get rooms for this storey
                            const storeyRooms = rooms.filter(room => 
                                room.storey && String(room.storey) === String(storey.id)
                            );
                            
                            // Draw room labels if there are rooms
                            if (storeyRooms.length > 0) {
                                const scaleFactorAttr = canvas.getAttribute('data-scale-factor');
                                const offsetXAttr = canvas.getAttribute('data-offset-x');
                                const offsetYAttr = canvas.getAttribute('data-offset-y');
                                
                                const scaleFactor = scaleFactorAttr ? parseFloat(scaleFactorAttr) : 1;
                                const offsetX = offsetXAttr ? parseFloat(offsetXAttr) : 0;
                                const offsetY = offsetYAttr ? parseFloat(offsetYAttr) : 0;
                                
                                const labeledCanvas = document.createElement('canvas');
                                labeledCanvas.width = canvas.width;
                                labeledCanvas.height = canvas.height;
                                const labeledCtx = labeledCanvas.getContext('2d');
                                
                                labeledCtx.drawImage(cleanCanvas, 0, 0);
                                drawRoomLabelsOnCanvas(labeledCtx, storeyRooms, scaleFactor, offsetX, offsetY);
                                
                                cleanCanvas = labeledCanvas;
                            }
                            
                            const imageData = cleanCanvas.toDataURL('image/png', 0.9);
                            wallPlansByStorey.push({
                                storeyId: storey.id,
                                storeyName: storey.name,
                                imageData: imageData
                            });
                            
                            console.log(`✅ Captured wall plan for ${storey.name}`);
                        } catch (err) {
                            console.warn(`Failed to capture wall plan for ${storey.name}:`, err);
                        }
                    }
                }
                
                // Store all wall plans by storey
                if (updateCanvasImage) {
                    updateCanvasImage('wallPlansByStorey', wallPlansByStorey);
                }
                
                console.log(`✅ Captured ${wallPlansByStorey.length} wall plans (one per storey)`);
            }
            
            // Capture ceiling plan
            await captureFromTab('ceiling-plan', 'ceiling');
            
            // Capture floor plan
            await captureFromTab('floor-plan', 'floor');
            
            // Restore original activeStoreyId after capture
            if (setActiveStoreyId && originalActiveStoreyId !== null && originalActiveStoreyId !== undefined) {
                console.log('↩️ Restoring original active storey:', originalActiveStoreyId);
                setActiveStoreyId(originalActiveStoreyId);
            }
            
            // Return to original view
            console.log('↩️ Returning to summary tab...');
            currentViewSetter(originalView);
            
            console.log('🎉 Canvas capture complete!', capturedImages);
            // Add wallPlansByStorey to capturedImages for return
            if (wallPlansByStorey.length > 0) {
                capturedImages.wallPlansByStorey = wallPlansByStorey;
            }
            return capturedImages;
            
        } catch (error) {
            console.error('Error during automatic canvas capture:', error);
            // Restore original activeStoreyId even if error occurs
            if (setActiveStoreyId && originalActiveStoreyId !== null && originalActiveStoreyId !== undefined) {
                setActiveStoreyId(originalActiveStoreyId);
            }
            // Make sure we return to original view even if error occurs
            currentViewSetter(originalView);
            return capturedImages;
        }
    };

    // Manual trigger for auto-fetch (for refresh scenarios)
    const triggerAutoFetch = async () => {
        if (!projectId || !updateSharedPanelData) return;
        
        try {
            setIsLoading(true);
            console.log('🔄 Manual auto-fetch triggered...');
            
            // Fetch fresh project data and trigger auto-fetch
            const projectResponse = await api.get(`/projects/${projectId}/`);
            setProjectData(projectResponse.data);

            const roomsResponse = await api.get(`/rooms/?project=${projectId}`);
            const rooms = roomsResponse.data;
            setRooms(rooms);

            // Fetch ceiling plans for all rooms
            const ceilingPlansPromises = rooms.map(room => 
                api.get(`/ceiling-plans/?room=${room.id}`)
            );
            const ceilingResponses = await Promise.all(ceilingPlansPromises);
            const allCeilingPlans = ceilingResponses.flatMap(response => response.data);
            setCeilingPlans(allCeilingPlans);

            // Fetch floor plans for all rooms
            const floorPlansPromises = rooms.map(room => 
                api.get(`/floor-plans/?room=${room.id}`)
            );
            const floorResponses = await Promise.all(floorPlansPromises);
            const allFloorPlans = floorResponses.flatMap(response => response.data);
            setFloorPlans(allFloorPlans);

            // Fetch walls for panel calculation
            try {
                const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
                setWalls(wallsResponse.data);
            } catch (wallErr) {
                console.log('Walls not available');
                setWalls([]);
            }

            // Fetch doors from project data
            try {
                const doorsResponse = await api.get(`/doors/?project=${projectId}`);
                setDoors(doorsResponse.data);
            } catch (doorErr) {
                console.log('Doors not available');
                setDoors([]);
            }

            // Re-read slab dimensions from localStorage (synced with Floor Plan tab)
            try {
                const raw = projectId ? localStorage.getItem(`floor_plan_slab_${projectId}`) : null;
                if (raw) {
                    const { width, length } = JSON.parse(raw);
                    if (typeof width === 'number' && width > 0) setSlabWidth(width);
                    if (typeof length === 'number' && length > 0) setSlabLength(length);
                }
            } catch (_) { /* ignore */ }

            // Now trigger auto-fetch with fresh data
            await autoFetchExistingPanelData(projectId, rooms);
            
            // Also capture canvas images automatically
            if (setCurrentView && setIsCapturingImages && setCaptureSuccess) {
                console.log('🖼️ Auto-capturing canvas images...');
                setIsCapturingImages(true);
                setCaptureSuccess(false);
                try {
                    await captureAllCanvasImages(setCurrentView);
                    setCaptureSuccess(true);
                    // Show success for 2 seconds then hide modal
                    setTimeout(() => {
                        setIsCapturingImages(false);
                        setCaptureSuccess(false);
                    }, 2000);
                } catch (error) {
                    console.error('Error capturing images:', error);
                    setIsCapturingImages(false);
                    setCaptureSuccess(false);
                }
            }
            
            console.log('✅ Manual auto-fetch completed');
        } catch (error) {
            console.error('Error in manual auto-fetch:', error);
            setError('Failed to auto-fetch data. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-fetch existing wall panel data
    const autoFetchWallPanelData = async (projectId) => {
        try {
            // Check if walls exist and calculate panels
            if (walls.length > 0) {
                console.log('🏗️ Auto-calculating wall panels from existing walls...');
                
                // Fetch intersections data needed for proper panel calculation
                let intersections = [];
                try {
                    const intersectionsResponse = await api.get(`/intersections/?projectid=${projectId}`);
                    intersections = intersectionsResponse.data || [];
                } catch (intersectionErr) {
                    console.log('Intersections not available, using default joint types');
                }
                
                // Use proper PanelCalculator to get actual panel data
                const wallPanelData = await calculateActualWallPanels(walls, intersections);
                
                if (wallPanelData && wallPanelData.length > 0) {
                    console.log('📊 Wall panel calculation results:', {
                        totalWalls: walls.length,
                        totalPanels: wallPanelData.reduce((sum, panel) => sum + panel.quantity, 0),
                        panelTypes: wallPanelData.map(p => ({ width: p.width, length: p.length, quantity: p.quantity, type: p.type }))
                    });
                    
                    // Share the auto-fetched wall panel data
                    updateSharedPanelData('wall-plan', wallPanelData, {
                        totalPanels: wallPanelData.reduce((sum, panel) => sum + panel.quantity, 0),
                        autoFetched: true
                    });
                    
                    console.log('✅ Wall panels auto-fetched:', wallPanelData);
                } else {
                    console.log('⚠️ No wall panels calculated from', walls.length, 'walls');
                }
            }
        } catch (error) {
            console.error('Error auto-fetching wall panel data:', error);
        }
    };

    // Auto-fetch existing ceiling panel data
    const autoFetchCeilingPanelData = async (projectId, rooms) => {
        try {
            // Check if ceiling plans exist
            if (ceilingPlans.length > 0) {
                console.log('🔝 Auto-fetching ceiling panel data from existing plans...');
                
                // Get ceiling panels for all rooms
                const ceilingPanelsPromises = rooms.map(room => 
                    api.get(`/ceiling-panels/?room=${room.id}`)
                );
                
                const ceilingPanelsResponses = await Promise.all(ceilingPanelsPromises);
                const allCeilingPanels = ceilingPanelsResponses.flatMap(response => response.data);
                
                if (allCeilingPanels.length > 0) {
                    // Process ceiling panels similar to CeilingManager
                    const processedPanels = processCeilingPanelsForSharing(allCeilingPanels);
                    
                    // Share the auto-fetched ceiling panel data
                    updateSharedPanelData('ceiling-plan', processedPanels, {
                        supportType: 'nylon', // Default values
                        includeAccessories: false,
                        includeCable: false,
                        aluSuspensionCustomDrawing: false,
                        panelsNeedSupport: processedPanels.some(panel => panel.length > 6000),
                        autoFetched: true
                    });
                    
                    console.log('✅ Ceiling panels auto-fetched:', processedPanels);
                }
            }
        } catch (error) {
            console.error('Error auto-fetching ceiling panel data:', error);
        }
    };

    // Calculate actual wall panels using proper PanelCalculator logic (mirrors PanelCalculationControls)
    const calculateActualWallPanels = async (walls, intersections) => {
        if (!walls || walls.length === 0) return [];
        
        try {
            const calculator = new PanelCalculator();
            const allPanels = [];

            walls.forEach(wall => {
                // Validate wall object structure
                if (!wall || typeof wall.start_x !== 'number' || typeof wall.start_y !== 'number' || 
                    typeof wall.end_x !== 'number' || typeof wall.end_y !== 'number') {
                    console.warn('Invalid wall data structure:', wall);
                    return;
                }
                
                const wallLength = Math.sqrt(
                    Math.pow(wall.end_x - wall.start_x, 2) + 
                    Math.pow(wall.end_y - wall.start_y, 2)
                );

                // Find all intersections for this wall
                const wallIntersections = intersections.filter(inter => 
                    inter.pairs && inter.pairs.some(pair => 
                        pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)
                    )
                );

                // Determine joint types for both ends
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
                    if (!inter.pairs) return;
                    inter.pairs.forEach(pair => {
                        if (pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)) {
                            // For horizontal walls
                            if (isHorizontal) {
                                if (isLeftToRight) {
                                    // Wall goes left to right
                                    if (inter.x === wall.start_x) {
                                        leftEndIntersections.push(pair.joining_method);
                                    } else if (inter.x === wall.end_x) {
                                        rightEndIntersections.push(pair.joining_method);
                                    }
                                } else {
                                    // Wall goes right to left
                                    if (inter.x === wall.start_x) {
                                        rightEndIntersections.push(pair.joining_method);
                                    } else if (inter.x === wall.end_x) {
                                        leftEndIntersections.push(pair.joining_method);
                                    }
                                }
                            }
                            // For vertical walls
                            if (isBottomToTop) {
                                // Wall goes bottom to top
                                if (inter.y === wall.start_y) {
                                    leftEndIntersections.push(pair.joining_method);
                                } else if (inter.y === wall.end_y) {
                                    rightEndIntersections.push(pair.joining_method);
                                }
                            } else {
                                // Wall goes top to bottom
                                if (inter.y === wall.start_y) {
                                    rightEndIntersections.push(pair.joining_method);
                                } else if (inter.y === wall.end_y) {
                                    leftEndIntersections.push(pair.joining_method);
                                }
                            }
                        }
                    });
                });

                // Set joint types, prioritizing 45_cut
                leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
                rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';

                // Validate wall height and thickness
                if (typeof wall.height !== 'number' || typeof wall.thickness !== 'number') {
                    console.warn('Invalid wall height or thickness:', { height: wall.height, thickness: wall.thickness });
                    return;
                }
                
                // Prepare face information for panel calculation
                const faceInfo = {
                    innerFaceMaterial: wall.inner_face_material || null,
                    innerFaceThickness: wall.inner_face_thickness || null,
                    outerFaceMaterial: wall.outer_face_material || null,
                    outerFaceThickness: wall.outer_face_thickness || null
                };
                
                const panels = calculator.calculatePanels(
                    wallLength,
                    wall.thickness,
                    { left: leftJointType, right: rightJointType },
                    wall.height,
                    faceInfo
                );

                // Validate panels array
                if (!panels || !Array.isArray(panels)) {
                    console.warn('No panels returned for wall:', wall.id);
                    return;
                }
                
                // Add wall-specific information to each panel
                panels.forEach(panel => {
                    if (!panel || typeof panel.width !== 'number') {
                        console.warn('Invalid panel data:', panel);
                        return;
                    }
                    
                    let panelType = panel.type;
                    if (panelType === 'leftover' && panel.width < 200 && !panel.isLeftover) {
                        panelType = 'side';
                    }
                    allPanels.push({
                        ...panel,
                        type: panelType,
                        length: wall.height,
                        application: wall.application_type || 'standard',
                        wallId: wall.id,
                        wallLength: wallLength,
                        wallStart: `(${Math.round(wall.start_x)}, ${Math.round(wall.start_y)})`,
                        wallEnd: `(${Math.round(wall.end_x)}, ${Math.round(wall.end_y)})`,
                        thickness: wall.thickness,
                        inner_face_material: wall.inner_face_material || 'PPGI',
                        inner_face_thickness: wall.inner_face_thickness ?? 0.5,
                        outer_face_material: wall.outer_face_material || 'PPGI',
                        outer_face_thickness: wall.outer_face_thickness ?? 0.5
                    });
                });
            });

            // Group panels by dimensions, application, panel thickness, and surface types
            const groupedPanelsForSharing = allPanels.reduce((acc, panel) => {
                const key = `${panel.width}-${panel.length}-${panel.thickness || 'NA'}-${panel.application}-${panel.inner_face_material || 'PPGI'}-${panel.inner_face_thickness ?? 0.5}-${panel.outer_face_material || 'PPGI'}-${panel.outer_face_thickness ?? 0.5}`;
                if (!acc[key]) {
                    acc[key] = {
                        width: panel.width,
                        length: panel.length,
                        thickness: panel.thickness,
                        application: panel.application,
                        quantity: 0,
                        type: panel.type,
                        inner_face_material: panel.inner_face_material || 'PPGI',
                        inner_face_thickness: panel.inner_face_thickness ?? 0.5,
                        outer_face_material: panel.outer_face_material || 'PPGI',
                        outer_face_thickness: panel.outer_face_thickness ?? 0.5,
                        anyWallId: panel.wallId
                    };
                }
                acc[key].quantity += 1;
                return acc;
            }, {});

            return Object.values(groupedPanelsForSharing);
            
        } catch (error) {
            console.error('Error calculating actual wall panels:', error);
            return [];
        }
    };

    // Build wallPanelsMap for dimension filtering (matches Canvas2D + dimensionFilter logic)
    const buildWallPanelsMapForFilter = (wallsToUse, intersectionsData) => {
        if (!wallsToUse?.length) return {};
        const map = {};
        const calculator = new PanelCalculator();
        wallsToUse.forEach(wall => {
            if (!wall || typeof wall.start_x !== 'number' || typeof wall.end_x !== 'number') return;
            const wallLength = Math.sqrt(
                Math.pow(wall.end_x - wall.start_x, 2) + Math.pow(wall.end_y - wall.start_y, 2)
            );
            const wallIntersections = (intersectionsData || []).filter(inter =>
                inter.pairs && inter.pairs.some(pair =>
                    pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)
                )
            );
            let leftJointType = 'butt_in';
            let rightJointType = 'butt_in';
            const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
            const isLeftToRight = wall.end_x > wall.start_x;
            const isBottomToTop = wall.end_y > wall.start_y;
            const leftEndIntersections = [];
            const rightEndIntersections = [];
            wallIntersections.forEach(inter => {
                if (!inter.pairs) return;
                inter.pairs.forEach(pair => {
                    if (pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)) {
                        if (isHorizontal) {
                            if (isLeftToRight) {
                                if (inter.x === wall.start_x) leftEndIntersections.push(pair.joining_method);
                                else if (inter.x === wall.end_x) rightEndIntersections.push(pair.joining_method);
                            } else {
                                if (inter.x === wall.start_x) rightEndIntersections.push(pair.joining_method);
                                else if (inter.x === wall.end_x) leftEndIntersections.push(pair.joining_method);
                            }
                        }
                        if (!isHorizontal) {
                            if (isBottomToTop) {
                                if (inter.y === wall.start_y) leftEndIntersections.push(pair.joining_method);
                                else if (inter.y === wall.end_y) rightEndIntersections.push(pair.joining_method);
                            } else {
                                if (inter.y === wall.start_y) rightEndIntersections.push(pair.joining_method);
                                else if (inter.y === wall.end_y) leftEndIntersections.push(pair.joining_method);
                            }
                        }
                    }
                });
            });
            leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
            rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
            const faceInfo = {
                innerFaceMaterial: wall.inner_face_material || null,
                innerFaceThickness: wall.inner_face_thickness || null,
                outerFaceMaterial: wall.outer_face_material || null,
                outerFaceThickness: wall.outer_face_thickness || null
            };
            const heightForCalc = (wall.fill_gap_mode && wall.gap_fill_height != null) ? wall.gap_fill_height : wall.height;
            let panels = [];
            try {
                panels = calculator.calculatePanels(
                    wallLength,
                    wall.thickness,
                    { left: leftJointType, right: rightJointType },
                    heightForCalc,
                    faceInfo
                ) || [];
            } catch (_) { /* ignore */ }
            if (Array.isArray(panels) && panels.length > 0) {
                map[wall.id] = panels;
            }
        });
        return map;
    };

    // Auto-fetch existing floor panel data
    const autoFetchFloorPanelData = async (projectId, rooms) => {
        try {
            // Check if floor plans exist
            if (floorPlans.length > 0) {
                console.log('🏠 Auto-fetching floor panel data from existing plans...');
                
                // Get floor panels for all rooms
                const floorPanelsPromises = rooms.map(room => 
                    api.get(`/floor-panels/?room=${room.id}`)
                );
                
                const floorPanelsResponses = await Promise.all(floorPanelsPromises);
                const allFloorPanels = floorPanelsResponses.flatMap(response => response.data);
                
                if (allFloorPanels.length > 0) {
                    // Process floor panels similar to FloorManager
                    const processedPanels = processFloorPanelsForSharing(allFloorPanels, rooms);
                    
                    // Share the auto-fetched floor panel data
                    updateSharedPanelData('floor-plan', processedPanels, {
                        autoFetched: true
                    });
                    
                    console.log('✅ Floor panels auto-fetched:', processedPanels);
                }
            }
        } catch (error) {
            console.error('Error auto-fetching floor panel data:', error);
        }
    };

    // Helper function to process ceiling panels for sharing (similar to CeilingManager)
    const processCeilingPanelsForSharing = (panels) => {
        if (!panels || panels.length === 0) return [];
        
        // Group panels by dimensions (width, length, thickness) and face finishes
        const panelsByDimension = new Map();
        panels.forEach(panel => {
            // Use panel thickness if available, otherwise use default
            const panelThickness = panel.thickness || 150; // Default ceiling thickness
            
            // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
            const isVertical = panel.width >= panel.length;
            let displayWidth = panel.width;
            let displayLength = panel.length;
            
            if (isVertical) {
                // Swap values for vertical orientation
                displayWidth = panel.length;
                displayLength = panel.width;
            }

            // Face information (fallback to defaults if not present)
            const intMat = panel.inner_face_material ?? 'PPGI';
            const intThk = panel.inner_face_thickness ?? 0.5;
            const extMat = panel.outer_face_material ?? 'PPGI';
            const extThk = panel.outer_face_thickness ?? 0.5;
            
            const key = `${displayWidth}_${displayLength}_${panelThickness}_${intMat}_${intThk}_${extMat}_${extThk}`;
            if (!panelsByDimension.has(key)) {
                panelsByDimension.set(key, {
                    width: displayWidth,
                    length: displayLength,
                    thickness: panelThickness,
                    quantity: 0,
                    inner_face_material: intMat,
                    inner_face_thickness: intThk,
                    outer_face_material: extMat,
                    outer_face_thickness: extThk
                });
            }
            panelsByDimension.get(key).quantity++;
        });

        // Convert to array and sort by quantity (descending)
        const panelList = Array.from(panelsByDimension.values())
            .sort((a, b) => b.quantity - a.quantity);

        return panelList;
    };

    // Helper function to process floor panels for sharing (similar to FloorManager)
    const processFloorPanelsForSharing = (panels, rooms) => {
        if (!panels || panels.length === 0) return [];
        
        const panelList = [];
        
        // Group panels by room
        const panelsByRoom = {};
        panels.forEach(panel => {
            const roomId = panel.room_id || panel.room;
            if (!panelsByRoom[roomId]) {
                panelsByRoom[roomId] = [];
            }
            panelsByRoom[roomId].push(panel);
        });
        
        // Process each room's panels
        Object.entries(panelsByRoom).forEach(([roomId, roomPanels]) => {
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

    // Calculate room area using shoelace formula
    const calculateRoomArea = (roomPoints) => {
        if (roomPoints.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < roomPoints.length; i++) {
            const j = (i + 1) % roomPoints.length;
            area += roomPoints[i].x * roomPoints[j].y;
            area -= roomPoints[j].x * roomPoints[i].y;
        }
        return Math.abs(area) / 2;
    };

    // Calculate wall panels using PanelCalculator
    const calculateWallPanels = (walls) => {
        if (!walls || walls.length === 0) return 0;
        
        const calculator = new PanelCalculator();
        let totalPanels = 0;
        
        walls.forEach(wall => {
            if (wall.start_x !== undefined && wall.start_y !== undefined && 
                wall.end_x !== undefined && wall.end_y !== undefined &&
                wall.height && wall.thickness) {
                
                const wallLength = Math.sqrt(
                    Math.pow(wall.end_x - wall.start_x, 2) + 
                    Math.pow(wall.end_y - wall.start_y, 2)
                );
                
                // Use gap_fill_height for calculations if gap-fill mode is enabled
                const heightForCalc = (wall.fill_gap_mode && wall.gap_fill_height !== null) 
                    ? wall.gap_fill_height 
                    : wall.height;
                
                // Prepare face information for panel calculation
                const faceInfo = {
                    innerFaceMaterial: wall.inner_face_material || null,
                    innerFaceThickness: wall.inner_face_thickness || null,
                    outerFaceMaterial: wall.outer_face_material || null,
                    outerFaceThickness: wall.outer_face_thickness || null
                };
                
                // Calculate panels for this wall (assuming butt_in joints for simplicity)
                const panels = calculator.calculatePanels(wallLength, wall.thickness, { left: 'butt_in', right: 'butt_in' }, heightForCalc, faceInfo);
                totalPanels += panels.length;
            }
        });
        
        return totalPanels;
    };

    // Calculate total quantities: prefer shared panel data (from Wall/Ceiling/Floor plans) when available so counts match what the user sees on those tabs
    const totalQuantities = useMemo(() => {
        // Ceiling: use shared data sum when available, else ceiling plans API
        const ceilingPanels = (sharedPanelData?.ceilingPanels?.length > 0)
            ? sharedPanelData.ceilingPanels.reduce((total, p) => total + (p.quantity ?? 1), 0)
            : (rooms.length > 0 ? ceilingPlans.reduce((total, plan) => total + (plan.total_panels || 0), 0) : 0);

        // Floor: use shared data sum when available, else floor plans API
        const floorPanels = (sharedPanelData?.floorPanels?.length > 0)
            ? sharedPanelData.floorPanels.reduce((total, p) => total + (p.quantity ?? 1), 0)
            : (rooms.length > 0 ? floorPlans.reduce((total, plan) => total + (plan.total_panels || 0), 0) : 0);

        // Wall: use shared data sum when available (matches Wall Plan "Full Panels" + cut total), else fallback to recalc
        const wallPanelsCount = (sharedPanelData?.wallPanels?.length > 0)
            ? sharedPanelData.wallPanels.reduce((total, p) => total + (p.quantity ?? 1), 0)
            : calculateWallPanels(walls);

        const totalDoors = doors.length;

        const slabAreaMm2 = slabWidth * slabLength;
        const totalSlabs = rooms.length > 0 ? rooms.reduce((total, room) => {
            if (room.room_points && room.room_points.length > 0 && 
                (room.floor_type === 'slab' || room.floor_type === 'Slab')) {
                const roomArea = calculateRoomArea(room.room_points);
                const slabsNeeded = slabAreaMm2 > 0 ? Math.ceil(roomArea / slabAreaMm2) : 0;
                return total + slabsNeeded;
            }
            return total;
        }, 0) : 0;

        return {
            panels: ceilingPanels + floorPanels + wallPanelsCount,
            doors: totalDoors,
            slabs: totalSlabs,
            ceilingPanels,
            floorPanels,
            wallPanelsCount
        };
    }, [rooms, ceilingPlans, floorPlans, walls, doors, sharedPanelData, slabWidth, slabLength]);

    // Calculate installation time estimates
    const installationEstimates = useMemo(() => {
        if (!totalQuantities.panels && !totalQuantities.doors && !totalQuantities.slabs) {
            return { days: 0, weeks: 0, months: 0 };
        }

        const panelDays = Math.ceil(totalQuantities.panels / panelsPerDay);
        const doorDays = Math.ceil(totalQuantities.doors / doorsPerDay);
        const slabDays = Math.ceil(totalQuantities.slabs / slabsPerDay);

        // Total days needed (sequential work - all tasks added together)
        const totalDays = panelDays + doorDays + slabDays;
        
        // Add some buffer for coordination and unexpected issues
        const daysWithBuffer = Math.ceil(totalDays * 1.2);

        // Calculate weeks and months with proper thresholds
        const weeks = daysWithBuffer >= 5 ? Math.ceil(daysWithBuffer / 5) : 0;
        const months = daysWithBuffer >= 22 ? Math.ceil(daysWithBuffer / 22) : 0;

        return {
            days: daysWithBuffer,
            weeks: weeks, // 0 if less than 5 days, otherwise calculated
            months: months // 0 if less than 22 days, otherwise calculated
        };
    }, [totalQuantities, panelsPerDay, doorsPerDay, slabsPerDay]);

    // Calculate panel area by thickness
    const panelAreaByThickness = useMemo(() => {
        const areaByThickness = {};
        
        // Process ceiling panels
        if (sharedPanelData?.ceilingPanels && sharedPanelData.ceilingPanels.length > 0) {
            sharedPanelData.ceilingPanels.forEach(panel => {
                const thickness = panel.thickness || 150; // Default ceiling thickness
                const area = (panel.width || 0) * (panel.length || 0) * (panel.quantity || 1);
                if (!areaByThickness[thickness]) {
                    areaByThickness[thickness] = { area: 0, count: 0, types: { ceiling: 0, floor: 0, wall: 0 } };
                }
                areaByThickness[thickness].area += area;
                areaByThickness[thickness].count += panel.quantity || 1;
                areaByThickness[thickness].types.ceiling += panel.quantity || 1;
            });
        }
        
        // Process floor panels
        if (sharedPanelData?.floorPanels && sharedPanelData.floorPanels.length > 0) {
            sharedPanelData.floorPanels.forEach(panel => {
                const thickness = panel.thickness || 20; // Default floor thickness
                const area = (panel.width || 0) * (panel.length || 0) * (panel.quantity || 1);
                if (!areaByThickness[thickness]) {
                    areaByThickness[thickness] = { area: 0, count: 0, types: { ceiling: 0, floor: 0, wall: 0 } };
                }
                areaByThickness[thickness].area += area;
                areaByThickness[thickness].count += panel.quantity || 1;
                areaByThickness[thickness].types.floor += panel.quantity || 1;
            });
        }
        
        // Process wall panels
        if (sharedPanelData?.wallPanels && sharedPanelData.wallPanels.length > 0) {
            sharedPanelData.wallPanels.forEach(panel => {
                // For wall panels, we need to get thickness from the wall data
                // Look up the wall thickness from walls array
                const wall = walls.find(w => w.id === panel.wallId);
                const thickness = wall?.thickness || 150; // Default wall thickness
                const area = (panel.width || 0) * (panel.length || 0) * (panel.quantity || 1);
                if (!areaByThickness[thickness]) {
                    areaByThickness[thickness] = { area: 0, count: 0, types: { ceiling: 0, floor: 0, wall: 0 } };
                }
                areaByThickness[thickness].area += area;
                areaByThickness[thickness].count += panel.quantity || 1;
                areaByThickness[thickness].types.wall += panel.quantity || 1;
            });
        }
        
        // Convert to array and sort by thickness
        const thicknessGroups = Object.entries(areaByThickness)
            .map(([thickness, data]) => ({
                thickness: parseFloat(thickness),
                area: data.area,
                count: data.count,
                types: data.types
            }))
            .sort((a, b) => a.thickness - b.thickness);
        
        return thicknessGroups;
    }, [sharedPanelData, walls]);

    // Handle input changes
    const handleInputChange = (field, value) => {
        const numValue = Math.max(1, parseInt(value) || 1);
        switch (field) {
            case 'panels':
                setPanelsPerDay(numValue);
                break;
            case 'doors':
                setDoorsPerDay(numValue);
                break;
            case 'slabs':
                setSlabsPerDay(numValue);
                break;
            default:
                break;
        }
    };

    // Get canvas images from shared data (captured when users visited those tabs)
    const getCanvasImagesFromSharedData = () => {
        console.log('🖼️ Retrieving canvas images from shared data...');
        console.log('🔍 Full sharedPanelData:', sharedPanelData);
        
        const images = {
            wallPlan: sharedPanelData?.wallPlanImage || null,
            wallPlansByStorey: sharedPanelData?.wallPlansByStorey || [],
            ceilingPlan: sharedPanelData?.ceilingPlanImage || null,
            floorPlan: sharedPanelData?.floorPlanImage || null
        };
        
        // Log what we found with more detail
        console.log('🖼️ Retrieved images:', {
            wallPlan: images.wallPlan ? `Found (${images.wallPlan.substring(0, 50)}...)` : 'Not found',
            wallPlansByStorey: images.wallPlansByStorey.length > 0 ? `Found ${images.wallPlansByStorey.length} storey plans` : 'Not found',
            ceilingPlan: images.ceilingPlan ? `Found (${images.ceilingPlan.substring(0, 50)}...)` : 'Not found',
            floorPlan: images.floorPlan ? `Found (${images.floorPlan.substring(0, 50)}...)` : 'Not found'
        });
        
        if (images.wallPlan || images.wallPlansByStorey.length > 0) {
            console.log(`✅ Wall plan image(s) found: ${images.wallPlansByStorey.length} storey-specific plans`);
        } else {
            console.warn('⚠️ Wall plan image not found - visit Wall Plan tab first');
        }
        
        if (images.ceilingPlan) console.log('✅ Ceiling plan image found in shared data');
        else console.warn('⚠️ Ceiling plan image not found - visit Ceiling Plan tab first');
        
        if (images.floorPlan) console.log('✅ Floor plan image found in shared data');
        else console.warn('⚠️ Floor plan image not found - visit Floor Plan tab first');
        
        setPlanImages(images);
        return images;
    };

    // Prepare export data
    const prepareExportData = async () => {
        console.log('Shared panel data:', sharedPanelData);
        console.log('Wall panels:', sharedPanelData?.wallPanels);
        console.log('Ceiling panels:', sharedPanelData?.ceilingPanels);
        console.log('Floor panels:', sharedPanelData?.floorPanels);
        
        // Check if we have panel data, if not, try to auto-fetch first
        if (!sharedPanelData?.wallPanels && !sharedPanelData?.ceilingPanels && !sharedPanelData?.floorPanels) {
            console.log('⚠️ No panel data available, attempting auto-fetch...');
            
            try {
                // Show loading state
                setIsLoading(true);
                
                // Trigger auto-fetch
                await triggerAutoFetch();
                
                // Wait a moment for the data to be processed
                await new Promise(resolve => setTimeout(resolve, 500));
                
                console.log('✅ Auto-fetch completed, now preparing export data...');
            } catch (error) {
                console.error('Auto-fetch failed:', error);
                // Continue with export even if auto-fetch fails
            } finally {
                setIsLoading(false);
            }
        }
        
        // Get canvas images from shared data
        const capturedImages = getCanvasImagesFromSharedData();
        
        // Enrich wall panels with thickness and surface types from walls data (fallbacks when missing)
        const enrichedWallPanels = (sharedPanelData?.wallPanels || []).map(panel => {
            const wall = walls.find(w => String(w.id) === String(panel.wallId || panel.anyWallId));
            const thickness = wall?.thickness || panel.thickness || 150; // Default wall thickness
            const inner_face_material = panel.inner_face_material ?? wall?.inner_face_material ?? 'PPGI';
            const inner_face_thickness = panel.inner_face_thickness ?? wall?.inner_face_thickness ?? 0.5;
            const outer_face_material = panel.outer_face_material ?? wall?.outer_face_material ?? 'PPGI';
            const outer_face_thickness = panel.outer_face_thickness ?? wall?.outer_face_thickness ?? 0.5;
            return {
                ...panel,
                thickness,
                inner_face_material,
                inner_face_thickness,
                outer_face_material,
                outer_face_thickness
            };
        });
        
        const data = {
            projectInfo: {
                name: projectData?.name || 'Unknown Project',
                dimensions: projectData ? `${Math.round(projectData.width / 1000)} × ${Math.round(projectData.length / 1000)} × ${Math.round(projectData.height / 1000)} m` : 'N/A',
                rooms: rooms.length,
                walls: walls.length,
                doors: doors.length
            },
            rooms: rooms, // Include full room data for the preview
            wallPanels: enrichedWallPanels,
            ceilingPanels: sharedPanelData?.ceilingPanels || [],
            floorPanels: sharedPanelData?.floorPanels || [],
            wallPanelAnalysis: sharedPanelData?.wallPanelAnalysis || null,
            doors: doors,
            slabs: rooms.filter(room => room.floor_type === 'slab' || room.floor_type === 'Slab'),
            installationEstimates: installationEstimates,
            supportAccessories: {
                type: sharedPanelData?.supportType || 'nylon',
                includeAccessories: sharedPanelData?.includeAccessories || false,
                includeCable: sharedPanelData?.includeCable || false,
                customDrawing: sharedPanelData?.aluSuspensionCustomDrawing || false,
                // Use the panelsNeedSupport from shared data
                isNeeded: sharedPanelData?.panelsNeedSupport || false
            },
            exportDate: new Date().toLocaleString(),
            // Add captured canvas images
            planImages: {
                ...capturedImages,
                wallPlansByStorey: capturedImages.wallPlansByStorey || []
            }
        };
        
        // Debug logging for support accessories
        console.log('🔍 Support Accessories Debug Info:');
        console.log('  - sharedPanelData:', sharedPanelData);
        console.log('  - supportType:', sharedPanelData?.supportType);
        console.log('  - includeAccessories:', sharedPanelData?.includeAccessories);
        console.log('  - includeCable:', sharedPanelData?.includeCable);
        console.log('  - aluSuspensionCustomDrawing:', sharedPanelData?.aluSuspensionCustomDrawing);
        console.log('  - panelsNeedSupport:', sharedPanelData?.panelsNeedSupport);
        console.log('  - Final supportAccessories:', data.supportAccessories);
        
        setExportData(data);
        setShowExportPreview(true);
        
        // Reset expansion states when opening preview
        setExpandedTables({
            wallPanels: false,
            ceilingPanels: false,
            floorPanels: false,
            rooms: false,
            slabs: false,
            doors: false
        });
    };

    // Generate PDF export
    const generatePDF = async () => {
        if (!exportData) return;
        
        setIsExporting(true);
        try {
            // Create new PDF document - always start with portrait for main content
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });
            
            // Set initial position
            let yPos = 20;
            const pageWidth = doc.internal.pageSize.width;
            const margin = 20;
            const contentWidth = pageWidth - (2 * margin);
            
            // Helper function to add text with proper positioning
            const addText = (text, fontSize = 12, isBold = false, alignment = 'left') => {
                doc.setFontSize(fontSize);
                if (isBold) doc.setFont(undefined, 'bold');
                else doc.setFont(undefined, 'normal');
                
                let xPos = margin;
                if (alignment === 'center') {
                    xPos = pageWidth / 2;
                    doc.text(text, xPos, yPos, { align: 'center' });
                } else {
                    doc.text(text, xPos, yPos);
                }
                yPos += fontSize * 0.6; // Slightly increased spacing
            };
            
            // Helper function to add section header with background (compact)
            const addSectionHeader = (text, color = [66, 139, 202], bgColor = [239, 246, 255]) => {
                // Check for new page first
                if (yPos > 230) {
                    doc.addPage();
                    yPos = 20;
                }
                
                yPos += 6;
                
                // Add light colored background box
                doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                doc.roundedRect(margin - 2, yPos - 8, contentWidth + 4, 14, 2, 2, 'F');
                
                // Add colored header text (slightly darker than bgColor)
                doc.setTextColor(color[0] - 100, color[1] - 50, color[2] - 50); // Darker shade
                doc.setFontSize(12); // More compact
                doc.setFont(undefined, 'bold');
                doc.text(text, margin + 4, yPos);
                
                // Reset text color to black
                doc.setTextColor(0, 0, 0);
                yPos += 10;
            };
            
            // Helper function to check if we need a new page
            const checkNewPage = () => {
                if (yPos > 250) {
                    doc.addPage();
                    yPos = 20;
                }
            };
            
            // Project Overview - Simple text layout like preview (no table)
            addText('Project Overview', 11, true); // Simple header, no background
            yPos += 8;
            
            // Store starting position for both columns
            const startY = yPos;
            const leftColumnX = margin;
            const rightColumnX = margin + (pageWidth - 2 * margin) * 0.5; // Start at 50% for better balance
            const lineHeight = 6; // Consistent line spacing
            
            doc.setFontSize(10);
            
            // Left column - Project info
            doc.text(`Project: ${exportData.projectInfo.name}`, leftColumnX, startY);
            doc.text(`Rooms: ${exportData.projectInfo.rooms}`, leftColumnX, startY + lineHeight);
            doc.text(`Doors: ${exportData.projectInfo.doors}`, leftColumnX, startY + (lineHeight * 2));
            
            // Right column - Dimensions and walls
            doc.text(`Dimensions: ${exportData.projectInfo.dimensions}`, rightColumnX, startY);
            doc.text(`Walls: ${exportData.projectInfo.walls}`, rightColumnX, startY + lineHeight);
            
            yPos = startY + (lineHeight * 3) + 8; // Space after the two-column layout
            checkNewPage();
            
            // Material Quantities Summary
            // Gray theme like preview
            addSectionHeader('Material Quantities Summary', [55, 65, 81], [249, 250, 251]); // gray-700, bg-gray-50
            
            const totalWallPanels = exportData.wallPanels.reduce((sum, p) => sum + (p.quantity || 1), 0);
            const totalCeilingPanels = exportData.ceilingPanels.reduce((sum, p) => sum + (p.quantity || 1), 0);
            const totalFloorPanels = exportData.floorPanels.reduce((sum, p) => sum + (p.quantity || 1), 0);
            const totalPanels = totalWallPanels + totalCeilingPanels + totalFloorPanels;
            const slabAreaPdf = slabWidth * slabLength;
            const totalSlabs = exportData.slabs.reduce((sum, room) => {
                if (room.room_points && room.room_points.length > 0 && slabAreaPdf > 0) {
                    return sum + Math.ceil(calculateRoomArea(room.room_points) / slabAreaPdf);
                }
                return sum;
            }, 0);
            
            const summaryData = [
                ['Total Panels', totalPanels.toString(), `${totalWallPanels} wall + ${totalCeilingPanels} ceiling + ${totalFloorPanels} floor`],
                ['Total Doors', exportData.doors.length.toString(), 'From project data'],
                ['Total Slabs', totalSlabs.toString(), `For rooms with slab floors (${slabWidth}×${slabLength}mm)`]
            ];
            
            autoTable(doc, {
                startY: yPos,
                head: [['Category', 'Quantity', 'Details']],
                body: summaryData,
                theme: 'striped',
                styles: { fontSize: 9, cellPadding: 2 }, // smaller rows
                headStyles: { fillColor: [107, 114, 128], fontStyle: 'bold', fontSize: 10 },
                alternateRowStyles: { fillColor: [249, 250, 251] },
                margin: { left: margin, right: margin }
            });
            
            yPos = doc.lastAutoTable.finalY + 10;
            checkNewPage();
            
            // Room Details
            if (exportData.rooms && exportData.rooms.length > 0) {
                // Gray theme like preview
                addSectionHeader('Room Details', [55, 65, 81], [249, 250, 251]); // gray-700, bg-gray-50
                addText(`Total: ${exportData.rooms.length} rooms`, 11, false); // Larger total text
                yPos += 3;
                
                const roomData = exportData.rooms.map(room => [
                    room.room_name || 'Unnamed Room',
                    room.floor_type || 'N/A',
                    room.floor_thickness || 'N/A',
                    room.height || 'N/A',
                    room.room_points && room.room_points.length > 0 
                        ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                        : 'N/A'
                ]);
                
                             autoTable(doc, {
                 startY: yPos,
                 head: [['Room Name', 'Floor Type', 'Floor Thickness (mm)', 'Height (mm)', 'Area (m²)']],
                 body: roomData,
                 theme: 'striped',
                 styles: { fontSize: 8, cellPadding: 2 }, // smaller
                 headStyles: { fillColor: [107, 114, 128], fontStyle: 'bold', fontSize: 9 },
                 alternateRowStyles: { fillColor: [249, 250, 251] },
                 margin: { left: margin, right: margin }
             });
                
                yPos = doc.lastAutoTable.finalY + 10;
                checkNewPage();
            }

            // Installation Time Estimates (keep on first page with overview/rooms when possible)
            // Indigo theme like preview
            addSectionHeader('Installation Time Estimates', [79, 70, 229], [238, 242, 255]); // indigo-600, bg-indigo-50
            
            const installationData = [
                ['Working Days', 'Working Weeks', 'Working Months'],
                [
                    exportData.installationEstimates.days.toString(),
                    exportData.installationEstimates.weeks.toString(),
                    exportData.installationEstimates.months.toString()
                ]
            ];
            
                         autoTable(doc, {
                startY: yPos,
                head: [['Working Days', 'Working Weeks', 'Working Months']],
                body: [installationData[1]],
                theme: 'grid',
                styles: { fontSize: 10, fontStyle: 'bold', cellPadding: 3, halign: 'center' },
                headStyles: { fillColor: [79, 70, 229], fontStyle: 'bold', fontSize: 10, halign: 'center' },
                margin: { left: margin, right: margin }
            });
            
            yPos = doc.lastAutoTable.finalY + 10;
            checkNewPage();

            // Force a new page for detailed panel/support tables
            doc.addPage();
            yPos = 20;
            
            // Wall Panels
            if (exportData.wallPanels && exportData.wallPanels.length > 0) {
                // Blue theme like preview
                addSectionHeader('Wall Panels', [59, 130, 246], [239, 246, 255]); // blue-600, bg-blue-50
                addText(`Total: ${exportData.wallPanels.reduce((sum, p) => sum + (p.quantity || 1), 0)} panels`, 11, false);
                yPos += 3;
                
                const wallPanelData = exportData.wallPanels.map((panel, index) => {
                    const intMat = panel.inner_face_material ?? 'PPGI';
                    const intThk = panel.inner_face_thickness ?? 0.5;
                    const extMat = panel.outer_face_material ?? 'PPGI';
                    const extThk = panel.outer_face_thickness ?? 0.5;
                    const finishing = (intMat === extMat && intThk === extThk)
                        ? `Both Side ${extThk}mm ${extMat}`
                        : `Ext: ${extThk}mm ${extMat}; Int: ${intThk}mm ${intMat}`;
                    return [
                        (index + 1).toString(),
                        `${panel.width}mm`,
                        `${panel.length}mm`,
                        panel.quantity ? panel.quantity.toString() : '1',
                        panel.type || 'N/A',
                        panel.application || 'N/A',
                        `${panel.thickness || 'N/A'}mm`,
                        finishing
                    ];
                });
                
                                 autoTable(doc, {
                    startY: yPos,
                    head: [['No.', 'Width (mm)', 'Length (mm)', 'Qty', 'Type', 'Application', 'Thk (mm)', 'Finishing']],
                    body: wallPanelData,
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: [59, 130, 246], fontStyle: 'bold', fontSize: 9 },
                    alternateRowStyles: { fillColor: [239, 246, 255] },
                    margin: { left: margin, right: margin },
                    columnStyles: {
                        4: { cellWidth: 16 },   // Type column narrower
                        0: { cellWidth: 10 }    // No. column tight
                    }
                });
                
                yPos = doc.lastAutoTable.finalY + 10;
                checkNewPage();
            }
            
            // Ceiling Panels
            if (exportData.ceilingPanels && exportData.ceilingPanels.length > 0) {
                // Green theme like preview
                addSectionHeader('Ceiling Panels', [22, 163, 74], [240, 253, 244]); // green-600, bg-green-50
                addText(`Total: ${exportData.ceilingPanels.reduce((sum, p) => sum + (p.quantity || 1), 0)} panels`, 11, false);
                yPos += 3;
                
                const ceilingPanelData = exportData.ceilingPanels.map(panel => {
                    const intMat = panel.inner_face_material ?? 'PPGI';
                    const intThk = panel.inner_face_thickness ?? 0.5;
                    const extMat = panel.outer_face_material ?? 'PPGI';
                    const extThk = panel.outer_face_thickness ?? 0.5;
                    const same = intMat === extMat && intThk === extThk;
                    const finishing = same
                        ? `Both ${extThk}mm ${extMat}`
                        : `INT ${intThk}mm ${intMat} / EXT ${extThk}mm ${extMat}`;
                    return [
                        `${panel.width || 'N/A'}mm`,
                        `${panel.length || 'N/A'}mm`,
                        `${panel.thickness || 'N/A'}mm`,
                        panel.quantity ? panel.quantity.toString() : '1',
                        finishing
                    ];
                });
                
                                 autoTable(doc, {
                    startY: yPos,
                    head: [['Width', 'Length', 'Thk', 'Qty', 'Face']],
                    body: ceilingPanelData,
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: [22, 163, 74], fontStyle: 'bold', fontSize: 9 },
                    alternateRowStyles: { fillColor: [240, 253, 244] },
                    margin: { left: margin, right: margin },
                    columnStyles: {
                        3: { cellWidth: 10 }, // Qty tight
                        4: { cellWidth: 40 }  // Face description
                    }
                });
                
                yPos = doc.lastAutoTable.finalY + 10;
                checkNewPage();
            }
            
            // Floor Panels
            if (exportData.floorPanels && exportData.floorPanels.length > 0) {
                // Purple theme like preview
                addSectionHeader('Floor Panels', [147, 51, 234], [250, 245, 255]); // purple-600, bg-purple-50
                addText(`Total: ${exportData.floorPanels.reduce((sum, p) => sum + (p.quantity || 1), 0)} panels`, 11, false);
                yPos += 3;
                
                const floorPanelData = exportData.floorPanels.map(panel => [
                    `${panel.width || 'N/A'}mm`,
                    `${panel.length || 'N/A'}mm`,
                    `${panel.thickness || 'N/A'}mm`,
                    panel.quantity ? panel.quantity.toString() : '1',
                    panel.type || 'N/A'
                ]);
                
                                 autoTable(doc, {
                    startY: yPos,
                    head: [['Width', 'Length', 'Thk', 'Qty', 'Type']],
                    body: floorPanelData,
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: [147, 51, 234], fontStyle: 'bold', fontSize: 9 },
                    alternateRowStyles: { fillColor: [250, 245, 255] },
                    margin: { left: margin, right: margin },
                    columnStyles: {
                        3: { cellWidth: 14 }, // Qty
                        4: { cellWidth: 16 }  // Type narrower
                    }
                });
                
                yPos = doc.lastAutoTable.finalY + 10;
                checkNewPage();
            }
            
            // Slab Floors
            if (exportData.slabs && exportData.slabs.length > 0) {
                // Yellow theme like preview
                addSectionHeader('Slab Floors', [234, 179, 8], [254, 252, 232]); // yellow-600, bg-yellow-50
                const slabArea = slabWidth * slabLength;
                const totalSlabs = exportData.slabs.reduce((sum, room) => {
                    if (room.room_points && room.room_points.length > 0 && slabArea > 0) {
                        return sum + Math.ceil(calculateRoomArea(room.room_points) / slabArea);
                    }
                    return sum;
                }, 0);
                addText(`Total: ${totalSlabs} slabs needed`, 11, false);
                yPos += 3;
                
                const slabData = exportData.slabs.map(room => [
                    room.room_name || 'Unnamed Room',
                    room.room_points && room.room_points.length > 0 
                        ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                        : 'N/A',
                    `${slabWidth} × ${slabLength}mm`,
                    room.room_points && room.room_points.length > 0
                        ? Math.ceil(calculateRoomArea(room.room_points) / (slabWidth * slabLength)).toString()
                        : 'N/A'
                ]);
                
                                 autoTable(doc, {
                    startY: yPos,
                    head: [['Room Name', 'Area (m²)', 'Slab Size', 'Slabs']],
                    body: slabData,
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: [234, 179, 8], fontStyle: 'bold', fontSize: 9 },
                    alternateRowStyles: { fillColor: [254, 252, 232] },
                    margin: { left: margin, right: margin }
                });
                
                yPos = doc.lastAutoTable.finalY + 10;
                checkNewPage();
            }
            
            // Doors
            if (exportData.doors && exportData.doors.length > 0) {
                // Indigo theme like preview
                addSectionHeader('Doors', [79, 70, 229], [238, 242, 255]); // indigo-600, bg-indigo-50
                addText(`Total: ${exportData.doors.length} doors`, 11, false);
                yPos += 3;
                
                const doorData = exportData.doors.map(door => [
                    door.door_type || 'N/A',
                    `${door.width || 'N/A'}mm`,
                    `${door.height || 'N/A'}mm`,
                    `${door.thickness || 'N/A'}mm`
                ]);
                
                                 autoTable(doc, {
                    startY: yPos,
                    head: [['Type', 'Width', 'Height', 'Thk']],
                    body: doorData,
                    theme: 'striped',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: [79, 70, 229], fontStyle: 'bold', fontSize: 9 },
                    alternateRowStyles: { fillColor: [238, 242, 255] },
                    margin: { left: margin, right: margin },
                    columnStyles: {
                        0: { cellWidth: 30 }
                    }
                });
                
                yPos = doc.lastAutoTable.finalY + 10;
                checkNewPage();
            }
            
            // Support Accessories
            // Orange theme like preview
            addSectionHeader('Support Accessories', [234, 88, 12], [255, 247, 237]); // orange-600, bg-orange-50
            
            if (exportData.supportAccessories.isNeeded) {
                const supportData = [
                    ['Support Type', exportData.supportAccessories.type === 'nylon' ? 'Nylon Hanger' : 'Alu Suspension'],
                    ['Include Accessories', exportData.supportAccessories.includeAccessories ? 'Yes' : 'No'],
                    ['Include Cable', exportData.supportAccessories.includeCable ? 'Yes' : 'No']
                ];
                
                                 autoTable(doc, {
                    startY: yPos,
                    head: [['Property', 'Value']],
                    body: supportData,
                    theme: 'striped',
                    styles: { fontSize: 9, cellPadding: 2 },
                    headStyles: { fillColor: [234, 88, 12], fontStyle: 'bold', fontSize: 10 },
                    alternateRowStyles: { fillColor: [255, 247, 237] },
                    margin: { left: margin, right: margin }
                });
                
                yPos = doc.lastAutoTable.finalY + 10;
            } else {
                addText('Not needed in this project - All ceiling panels are under 6000mm length', 10);
                yPos += 5;
            }
            
            checkNewPage();
            
            // Add Vector-Based Wall Plan (AutoCAD-style, sharp at any zoom)
            // Use allWalls if available (more complete), otherwise use walls state
            const wallsForVector = (allWalls && allWalls.length > 0) ? allWalls : walls;
            if (wallsForVector && wallsForVector.length > 0) {
                // Helper function to draw vector wall plan
                const drawVectorWallPlan = (doc, wallsToDraw, roomsToDraw, doorsToDraw, storeyName = null, ghostWallsToDraw = [], ghostAreasToDraw = [], targetStoreyId = null, intersections = [], allWalls = []) => {
                    // Add new page for vector plan
                    doc.addPage('a4', planPageOrientation);
                    const planPageWidth = doc.internal.pageSize.width;
                    const planPageHeight = doc.internal.pageSize.height;
                    const planMargin = fitToPage ? 5 : 20;
                    const titleHeight = 15; // Space for title at top
                    const scaleNoteHeight = 10; // Space for scale note at bottom
                    const planContentWidth = planPageWidth - (2 * planMargin);
                    const planContentHeight = planPageHeight - (2 * planMargin) - titleHeight - scaleNoteHeight;
                    
                    // Calculate center point of all rooms (for wall offset calculation)
                    let centerX = 0, centerY = 0, centerCount = 0;
                    roomsToDraw.forEach(room => {
                        if (room.room_points && Array.isArray(room.room_points) && room.room_points.length > 0) {
                            room.room_points.forEach(point => {
                                const x = point.x || (Array.isArray(point) ? point[0] : 0);
                                const y = point.y || (Array.isArray(point) ? point[1] : 0);
                                centerX += x;
                                centerY += y;
                                centerCount++;
                            });
                        }
                    });
                    if (centerCount > 0) {
                        centerX /= centerCount;
                        centerY /= centerCount;
                    } else {
                        // Fallback: use center of walls
                        let sumX = 0, sumY = 0, wallCount = 0;
                        wallsToDraw.forEach(wall => {
                            sumX += (wall.start_x || 0) + (wall.end_x || 0);
                            sumY += (wall.start_y || 0) + (wall.end_y || 0);
                            wallCount += 2;
                        });
                        if (wallCount > 0) {
                            centerX = sumX / wallCount;
                            centerY = sumY / wallCount;
                        }
                    }
                    const center = { x: centerX, y: centerY };
                    
                    // Calculate bounding box of all geometry (account for wall thickness)
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    
                    // From walls - account for double lines (wall thickness)
                    wallsToDraw.forEach(wall => {
                        const x1 = wall.start_x || 0;
                        const y1 = wall.start_y || 0;
                        const x2 = wall.end_x || 0;
                        const y2 = wall.end_y || 0;
                        const thickness = wall.thickness || 200;
                        
                        // Calculate offset points (same logic as calculateOffsetPoints)
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const length = Math.sqrt(dx * dx + dy * dy);
                        if (length > 0) {
                            const normalX = dy / length;
                            const normalY = -dx / length;
                            const midX = (x1 + x2) / 2;
                            const midY = (y1 + y2) / 2;
                            const dirToCenterX = center.x - midX;
                            const dirToCenterY = center.y - midY;
                            const dotProduct = normalX * dirToCenterX + normalY * dirToCenterY;
                            const shouldFlip = dotProduct > 0;
                            const offsetDist = thickness / 2; // Half thickness
                            const offsetX = shouldFlip ? -normalX * offsetDist : normalX * offsetDist;
                            const offsetY = shouldFlip ? -normalY * offsetDist : normalY * offsetDist;
                            
                            // Calculate both lines
                            const line1X1 = x1;
                            const line1Y1 = y1;
                            const line1X2 = x2;
                            const line1Y2 = y2;
                            
                            const line2X1 = x1 - offsetX * 2;
                            const line2Y1 = y1 - offsetY * 2;
                            const line2X2 = x2 - offsetX * 2;
                            const line2Y2 = y2 - offsetY * 2;
                            
                            // Include both lines in bounding box
                            minX = Math.min(minX, line1X1, line1X2, line2X1, line2X2);
                            minY = Math.min(minY, line1Y1, line1Y2, line2Y1, line2Y2);
                            maxX = Math.max(maxX, line1X1, line1X2, line2X1, line2X2);
                            maxY = Math.max(maxY, line1Y1, line1Y2, line2Y1, line2Y2);
                        } else {
                            // Fallback for zero-length walls
                            minX = Math.min(minX, x1, x2);
                            minY = Math.min(minY, y1, y2);
                            maxX = Math.max(maxX, x1, x2);
                            maxY = Math.max(maxY, y1, y2);
                        }
                    });
                    
                    // From room points
                    roomsToDraw.forEach(room => {
                        if (room.room_points && Array.isArray(room.room_points)) {
                            room.room_points.forEach(point => {
                                const x = point.x || (Array.isArray(point) ? point[0] : 0);
                                const y = point.y || (Array.isArray(point) ? point[1] : 0);
                                minX = Math.min(minX, x);
                                minY = Math.min(minY, y);
                                maxX = Math.max(maxX, x);
                                maxY = Math.max(maxY, y);
                            });
                        }
                        // Also account for label position and arrow
                        if (room.label_position) {
                            const labelX = room.label_position.x || (Array.isArray(room.label_position) ? room.label_position[0] : null);
                            const labelY = room.label_position.y || (Array.isArray(room.label_position) ? room.label_position[1] : null);
                            if (labelX !== null && labelY !== null) {
                                minX = Math.min(minX, labelX);
                                minY = Math.min(minY, labelY);
                                maxX = Math.max(maxX, labelX);
                                maxY = Math.max(maxY, labelY);
                            }
                        }
                    });
                    
                    // From doors (if they have position data)
                    doorsToDraw.forEach(door => {
                        if (door.position_x !== undefined && door.position_y !== undefined) {
                            minX = Math.min(minX, door.position_x);
                            minY = Math.min(minY, door.position_y);
                            maxX = Math.max(maxX, door.position_x);
                            maxY = Math.max(maxY, door.position_y);
                        }
                    });
                    
                    // From ghost walls (dashed walls from lower storeys)
                    ghostWallsToDraw.forEach(ghostWall => {
                        if (ghostWall.start_x !== undefined && ghostWall.start_y !== undefined &&
                            ghostWall.end_x !== undefined && ghostWall.end_y !== undefined) {
                            minX = Math.min(minX, ghostWall.start_x, ghostWall.end_x);
                            minY = Math.min(minY, ghostWall.start_y, ghostWall.end_y);
                            maxX = Math.max(maxX, ghostWall.start_x, ghostWall.end_x);
                            maxY = Math.max(maxY, ghostWall.start_y, ghostWall.end_y);
                        }
                    });
                    
                    // From ghost areas (dashed areas from lower storeys)
                    ghostAreasToDraw.forEach(ghostArea => {
                        const points = Array.isArray(ghostArea.room_points)
                            ? ghostArea.room_points
                            : Array.isArray(ghostArea.points)
                                ? ghostArea.points
                                : [];
                        points.forEach(point => {
                            const x = point.x || (Array.isArray(point) ? point[0] : 0);
                            const y = point.y || (Array.isArray(point) ? point[1] : 0);
                            minX = Math.min(minX, x);
                            minY = Math.min(minY, y);
                            maxX = Math.max(maxX, x);
                            maxY = Math.max(maxY, y);
                        });
                    });
                    
                    // If no geometry found, skip
                    if (minX === Infinity || minY === Infinity) {
                        console.warn('No geometry found for vector plan');
                        return;
                    }
                    
                    // Add padding to bounding box (account for labels and arrows extending beyond)
                    const paddingX = (maxX - minX) * 0.05; // 5% padding
                    const paddingY = (maxY - minY) * 0.05; // 5% padding
                    minX -= paddingX; // Expand bounding box outward
                    minY -= paddingY;
                    maxX += paddingX;
                    maxY += paddingY;
                    
                    // Calculate model dimensions
                    const modelWidth = maxX - minX;
                    const modelHeight = maxY - minY;
                    
                    // Ensure we have valid dimensions
                    if (modelWidth <= 0 || modelHeight <= 0 || !isFinite(modelWidth) || !isFinite(modelHeight)) {
                        console.warn('Invalid model dimensions for vector plan');
                        return;
                    }
                    
                    // Calculate scale to fit content area (use 80% for a more generous margin)
                    const scaleX = (planContentWidth * 0.80) / modelWidth;
                    const scaleY = (planContentHeight * 0.80) / modelHeight;
                    const scale = Math.min(scaleX, scaleY);
                    
                    // Ensure scale is valid and reasonable
                    if (scale <= 0 || !isFinite(scale)) {
                        console.warn('Invalid scale calculated:', scale);
                        return;
                    }
                    
                    // Calculate offset to center the plan (account for title space)
                    const scaledWidth = modelWidth * scale;
                    const scaledHeight = modelHeight * scale;
                    const offsetX = planMargin + (planContentWidth - scaledWidth) / 2;
                    const offsetY = planMargin + titleHeight + (planContentHeight - scaledHeight) / 2;
                    
                    // Transform function: model coordinates to PDF coordinates
                    const transformX = (x) => offsetX + (x - minX) * scale;
                    const transformY = (y) => offsetY + (y - minY) * scale;
                    
                    // Draw room polygons first (as background) - ONLY current storey rooms
                    // Note: Room labels are only drawn for current storey rooms (not ghost areas)
                    // Ghost areas are drawn separately with their own labels
                    // roomsToDraw is already filtered to only include rooms from the current storey
                    // So we can draw all rooms in roomsToDraw without additional filtering
                    roomsToDraw.forEach(room => {
                        if (room.room_points && Array.isArray(room.room_points) && room.room_points.length >= 3) {
                            const points = room.room_points.map(point => {
                                const x = point.x || (Array.isArray(point) ? point[0] : 0);
                                const y = point.y || (Array.isArray(point) ? point[1] : 0);
                                return { x: transformX(x), y: transformY(y) };
                            });
                            
                            // Draw room outline (closed polygon with lines)
                            doc.setDrawColor(200, 200, 200);
                            doc.setLineWidth(0.1);
                            
                            // Draw polygon outline by connecting points
                            for (let i = 0; i < points.length; i++) {
                                const current = points[i];
                                const next = points[(i + 1) % points.length];
                                doc.line(current.x, current.y, next.x, next.y);
                            }
                            
                            // Note: jsPDF doesn't have direct polygon fill, so we draw outline only
                            // The outline is sufficient for vector clarity - walls will be drawn on top
                            
                            // Draw room label with arrow ONLY for current storey rooms (not ghost areas here)
                            // Use same placement logic as wall plan canvas: getRoomLabelPositions + InteractiveRoomLabel
                            const normalizedPolygon = room.room_points.map(pt => ({
                                x: Number(pt.x) || (Array.isArray(pt) ? Number(pt[0]) : 0),
                                y: Number(pt.y) || (Array.isArray(pt) ? Number(pt[1]) : 0)
                            }));
                            const roomCenterX = normalizedPolygon.reduce((sum, p) => sum + p.x, 0) / normalizedPolygon.length;
                            const roomCenterY = normalizedPolygon.reduce((sum, p) => sum + p.y, 0) / normalizedPolygon.length;
                            
                            // Resolve label position: stored label_position if valid, else visual center (match getRoomLabelPositions)
                            let labelX, labelY;
                            if (room.label_position != null &&
                                typeof room.label_position.x === 'number' && !isNaN(room.label_position.x) &&
                                typeof room.label_position.y === 'number' && !isNaN(room.label_position.y)) {
                                labelX = room.label_position.x;
                                labelY = room.label_position.y;
                            } else if (Array.isArray(room.label_position) && room.label_position.length >= 2) {
                                const lx = Number(room.label_position[0]);
                                const ly = Number(room.label_position[1]);
                                if (!isNaN(lx) && !isNaN(ly)) {
                                    labelX = lx;
                                    labelY = ly;
                                } else {
                                    const visual = calculatePolygonVisualCenter(normalizedPolygon);
                                    labelX = visual ? visual.x : roomCenterX;
                                    labelY = visual ? visual.y : roomCenterY;
                                }
                            } else {
                                const visual = calculatePolygonVisualCenter(normalizedPolygon);
                                labelX = visual ? visual.x : roomCenterX;
                                labelY = visual ? visual.y : roomCenterY;
                            }
                            
                            if (room.room_points && room.room_points.length >= 3 && labelX != null && labelY != null) {
                                const labelPos = { x: labelX, y: labelY };
                                const isLabelOutsideRoom = !isPointInPolygon(labelPos, normalizedPolygon);
                                
                                // Draw L-shaped arrow only when label is outside room (match InteractiveRoomLabel: shouldShowArrow)
                                if (isLabelOutsideRoom) {
                                    // Calculate direction from label to room center (arrow points to centroid)
                                    const dx = roomCenterX - labelX;
                                    const dy = roomCenterY - labelY;
                                    const absDx = Math.abs(dx);
                                    const absDy = Math.abs(dy);
                                    
                                    if (absDx > 0 || absDy > 0) {
                                        // Draw L-shaped arrow (matching wall plan view exactly)
                                        const labelPdfX = transformX(labelX);
                                        const labelPdfY = transformY(labelY);
                                        const centerPdfX = transformX(roomCenterX);
                                        const centerPdfY = transformY(roomCenterY);
                                        
                                        // Approximate label size in PDF space (for arrow start offset)
                                        const labelSize = 30 * scale; // Approximate label size
                                        const startOffset = labelSize / 2;
                                        
                                        let startX, startY, midX, midY, endX, endY;
                                        
                                        // Determine L-shape direction (matching InteractiveRoomLabel logic)
                                        if (absDx > absDy) {
                                            // Horizontal direction - extend horizontally first, then vertical
                                            if (dx > 0) {
                                                // Room is to the right, start from right edge
                                                startX = labelPdfX + startOffset;
                                                startY = labelPdfY;
                                            } else {
                                                // Room is to the left, start from left edge
                                                startX = labelPdfX - startOffset;
                                                startY = labelPdfY;
                                            }
                                            midX = centerPdfX; // Extend horizontally to room center X
                                            midY = startY; // Keep same Y
                                            endX = centerPdfX;
                                            endY = centerPdfY; // Then go vertical to room center Y
                                        } else {
                                            // Vertical direction - extend vertically first, then horizontal
                                            if (dy > 0) {
                                                // Room is below, start from bottom edge
                                                startX = labelPdfX;
                                                startY = labelPdfY + startOffset;
                                            } else {
                                                // Room is above, start from top edge
                                                startX = labelPdfX;
                                                startY = labelPdfY - startOffset;
                                            }
                                            midX = startX; // Keep same X
                                            midY = centerPdfY; // Extend vertically to room center Y
                                            endX = centerPdfX; // Then go horizontal to room center X
                                            endY = centerPdfY;
                                        }
                                        
                                        // Draw L-shaped arrow (red, matching canvas)
                                        doc.setDrawColor(255, 0, 0); // Red arrow like in canvas
                                        doc.setLineWidth(0.3);
                                        
                                        // First segment (horizontal or vertical)
                                        doc.line(startX, startY, midX, midY);
                                        
                                        // Second segment to room center
                                        doc.line(midX, midY, endX, endY);
                                        
                                        // Draw arrowhead at room center
                                        const arrowLength = 2; // 2mm arrowhead in PDF space
                                        const angle = Math.atan2(endY - midY, endX - midX);
                                        const arrowX1 = endX - arrowLength * Math.cos(angle - Math.PI / 6);
                                        const arrowY1 = endY - arrowLength * Math.sin(angle - Math.PI / 6);
                                        const arrowX2 = endX - arrowLength * Math.cos(angle + Math.PI / 6);
                                        const arrowY2 = endY - arrowLength * Math.sin(angle + Math.PI / 6);
                                        
                                        doc.line(endX, endY, arrowX1, arrowY1);
                                        doc.line(endX, endY, arrowX2, arrowY2);
                                    }
                                }
                                
                                // Draw room label text (always when we have a valid position)
                                doc.setFontSize(8);
                                doc.setTextColor(100, 100, 100);
                                doc.text(room.room_name || 'Room', transformX(labelX), transformY(labelY), { align: 'center' });
                                doc.setTextColor(0, 0, 0);
                            }
                        }
                    });
                    
                    // Draw ghost areas first (behind everything, matching canvas)
                    ghostAreasToDraw.forEach(ghostArea => {
                        const points = Array.isArray(ghostArea.room_points)
                            ? ghostArea.room_points
                            : Array.isArray(ghostArea.points)
                                ? ghostArea.points
                                : [];
                        
                        if (points.length >= 3) {
                            // Draw ghost area polygon (dashed outline, light fill)
                            const transformedPoints = points.map(point => {
                                const x = point.x || (Array.isArray(point) ? point[0] : 0);
                                const y = point.y || (Array.isArray(point) ? point[1] : 0);
                                return { x: transformX(x), y: transformY(y) };
                            });
                            
                            // Draw ghost area polygon (dashed outline, matching canvas)
                            doc.setDrawColor(96, 165, 250); // #60A5FA (blue-400)
                            doc.setLineWidth(0.2);
                            
                            // jsPDF uses setLineDash for dashed lines
                            const dashPattern = [10 * scale, 6 * scale];
                            doc.setLineDashPattern(dashPattern);
                            
                            // Draw polygon outline (closed path)
                            for (let i = 0; i < transformedPoints.length; i++) {
                                const current = transformedPoints[i];
                                const next = transformedPoints[(i + 1) % transformedPoints.length];
                                doc.line(current.x, current.y, next.x, next.y);
                            }
                            // Close the path
                            const first = transformedPoints[0];
                            const last = transformedPoints[transformedPoints.length - 1];
                            doc.line(last.x, last.y, first.x, first.y);
                            
                            // Reset line dash
                            doc.setLineDashPattern([]);
                            
                            // Draw ghost area label at centroid
                            const centroidX = transformedPoints.reduce((sum, p) => sum + p.x, 0) / transformedPoints.length;
                            const centroidY = transformedPoints.reduce((sum, p) => sum + p.y, 0) / transformedPoints.length;
                            
                            doc.setFontSize(8);
                            doc.setTextColor(29, 78, 216); // #1D4ED8 (blue-800)
                            const areaName = ghostArea.room_name || 'Area';
                            const originLabel = ghostArea.source_storey_name
                                ? ` (${ghostArea.source_storey_name})`
                                : ' (Below)';
                            doc.text(`${areaName}${originLabel}`, centroidX, centroidY, { align: 'center' });
                        }
                    });
                    
                    // Draw ghost walls (dashed lines from lower storeys, matching canvas)
                    ghostWallsToDraw.forEach(ghostWall => {
                        if (ghostWall.start_x !== undefined && ghostWall.start_y !== undefined &&
                            ghostWall.end_x !== undefined && ghostWall.end_y !== undefined) {
                            doc.setDrawColor(148, 163, 184); // #94A3B8 (slate-400)
                            doc.setLineWidth(0.2);
                            const dashPattern = [12 * scale, 6 * scale];
                            doc.setLineDashPattern(dashPattern);
                            doc.line(
                                transformX(ghostWall.start_x),
                                transformY(ghostWall.start_y),
                                transformX(ghostWall.end_x),
                                transformY(ghostWall.end_y)
                            );
                            doc.setLineDashPattern([]); // Reset
                        }
                    });
                    
                    // Draw walls using EXACT same logic as canvas (drawWalls from drawing.js)
                    // First pass: Calculate all wall lines and store them
                    const wallLinesMap = new Map(); // Store line1 and line2 for each wall
                    const SNAP_THRESHOLD = 10; // Same as canvas
                    
                    wallsToDraw.forEach((wall) => {
                        const wallThickness = wall.thickness || 100;
                        // Use scale = 1 for model space calculations (we'll transform to PDF space later)
                        const gapPixels = wallThickness; // In model space, gap = thickness
                        
                        let { line1, line2 } = calculateOffsetPoints(
                            wall.start_x,
                            wall.start_y,
                            wall.end_x,
                            wall.end_y,
                            gapPixels,
                            center,
                            1 // scaleFactor = 1 for model space
                        );
                        wallLinesMap.set(wall.id, { line1, line2, wall });
                    });
                    
                    // Second pass: Extend lines to intersections (before 45° cuts)
                    intersections.forEach(inter => {
                        const tolerance = SNAP_THRESHOLD; // In model space
                        
                        // Find all walls that meet at this intersection
                        const wallsAtIntersection = [];
                        
                        wallsToDraw.forEach(wall => {
                            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
                            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
                            
                            if (isAtStart || isAtEnd) {
                                const wallData = wallLinesMap.get(wall.id);
                                if (wallData) {
                                    wallsAtIntersection.push({
                                        wall,
                                        wallData,
                                        isAtStart,
                                        isAtEnd
                                    });
                                }
                            }
                        });
                        
                        // Process all vertical-horizontal pairs at this intersection (match canvas vhPairs)
                        if (wallsAtIntersection.length >= 2) {
                            const vhPairs = [];
                            for (let i = 0; i < wallsAtIntersection.length; i++) {
                                for (let j = i + 1; j < wallsAtIntersection.length; j++) {
                                    const wall1Data = wallsAtIntersection[i];
                                    const wall2Data = wallsAtIntersection[j];
                                    const wall1 = wall1Data.wall;
                                    const wall2 = wall2Data.wall;
                                    const wall1Dx = wall1.end_x - wall1.start_x;
                                    const wall1Dy = wall1.end_y - wall1.start_y;
                                    const wall2Dx = wall2.end_x - wall2.start_x;
                                    const wall2Dy = wall2.end_y - wall2.start_y;
                                    const wall1IsVertical = Math.abs(wall1Dx) < Math.abs(wall1Dy);
                                    const wall2IsVertical = Math.abs(wall2Dx) < Math.abs(wall2Dy);
                                    if (wall1IsVertical !== wall2IsVertical) {
                                        const verticalWall = wall1IsVertical ? wall1Data : wall2Data;
                                        const horizontalWall = wall1IsVertical ? wall2Data : wall1Data;
                                        let joiningMethod = null;
                                        let jointWall1Id = null;
                                        let jointWall2Id = null;
                                        if (inter.pairs && Array.isArray(inter.pairs)) {
                                            inter.pairs.forEach(pair => {
                                                const pairWall1Id = typeof pair.wall1 === 'object' ? (pair.wall1?.id ?? pair.wall1) : pair.wall1;
                                                const pairWall2Id = typeof pair.wall2 === 'object' ? (pair.wall2?.id ?? pair.wall2) : pair.wall2;
                                                const vWallIdStr = String(verticalWall.wall.id);
                                                const hWallIdStr = String(horizontalWall.wall.id);
                                                const pairWall1IdStr = String(pairWall1Id);
                                                const pairWall2IdStr = String(pairWall2Id);
                                                const matchesVertical = (pairWall1IdStr === vWallIdStr || pairWall2IdStr === vWallIdStr);
                                                const matchesHorizontal = (pairWall1IdStr === hWallIdStr || pairWall2IdStr === hWallIdStr);
                                                if (matchesVertical && matchesHorizontal) {
                                                    joiningMethod = pair.joining_method || 'none';
                                                    jointWall1Id = pairWall1Id;
                                                    jointWall2Id = pairWall2Id;
                                                }
                                            });
                                        }
                                        if (!joiningMethod) joiningMethod = 'none';
                                        vhPairs.push({ verticalWall, horizontalWall, joiningMethod, jointWall1Id, jointWall2Id });
                                    }
                                }
                            }
                            vhPairs.forEach(pairData => {
                                const { verticalWall, horizontalWall, joiningMethod, jointWall1Id, jointWall2Id } = pairData;
                                const vWall = verticalWall.wall;
                                const hWall = horizontalWall.wall;
                                const vLines = verticalWall.wallData;
                                const hLines = horizontalWall.wallData;
                                
                                // Only extend for butt_in joints (wall2 extends, wall1 does not)
                                const hasButtIn = joiningMethod === 'butt_in';
                                const isVerticalWall2 = hasButtIn && String(jointWall2Id) === String(vWall.id);
                                const isHorizontalWall2 = hasButtIn && String(jointWall2Id) === String(hWall.id);
                                
                                // Determine which end of vertical wall is at intersection
                                const vIsAtStart = verticalWall.isAtStart;
                                
                                // Determine which end of horizontal wall is at intersection
                                const hIsAtStart = horizontalWall.isAtStart;
                                
                                // For vertical wall: extend to upper/lower line of horizontal (only if butt_in and vertical is wall2)
                                if (isVerticalWall2) {
                                    const hLine1Y = (hLines.line1[0].y + hLines.line1[1].y) / 2;
                                    const hLine2Y = (hLines.line2[0].y + hLines.line2[1].y) / 2;
                                    const hUpperLine = hLine1Y < hLine2Y ? hLines.line1 : hLines.line2;
                                    const hLowerLine = hLine1Y < hLine2Y ? hLines.line2 : hLines.line1;
                                    
                                    const vEndpointY = vIsAtStart ? vWall.start_y : vWall.end_y;
                                    const vOtherY = vIsAtStart ? vWall.end_y : vWall.start_y;
                                    const isTopEnd = vEndpointY < vOtherY;
                                    
                                    let targetY;
                                    if (isTopEnd) {
                                        const hUpperStartX = hUpperLine[0].x;
                                        const hUpperStartY = hUpperLine[0].y;
                                        const hUpperEndX = hUpperLine[1].x;
                                        const hUpperEndY = hUpperLine[1].y;
                                        const hUpperDx = hUpperEndX - hUpperStartX;
                                        const hUpperDy = hUpperEndY - hUpperStartY;
                                        if (Math.abs(hUpperDx) > 0.001) {
                                            const t = (inter.x - hUpperStartX) / hUpperDx;
                                            targetY = hUpperStartY + t * hUpperDy;
                                        } else {
                                            targetY = hUpperStartY;
                                        }
                                    } else {
                                        const hLowerStartX = hLowerLine[0].x;
                                        const hLowerStartY = hLowerLine[0].y;
                                        const hLowerEndX = hLowerLine[1].x;
                                        const hLowerEndY = hLowerLine[1].y;
                                        const hLowerDx = hLowerEndX - hLowerStartX;
                                        const hLowerDy = hLowerEndY - hLowerStartY;
                                        if (Math.abs(hLowerDx) > 0.001) {
                                            const t = (inter.x - hLowerStartX) / hLowerDx;
                                            targetY = hLowerStartY + t * hLowerDy;
                                        } else {
                                            targetY = hLowerStartY;
                                        }
                                    }
                                    
                                    if (vIsAtStart) {
                                        vLines.line1[0].y = targetY;
                                        vLines.line2[0].y = targetY;
                                    } else {
                                        vLines.line1[1].y = targetY;
                                        vLines.line2[1].y = targetY;
                                    }
                                }
                                
                                // For horizontal wall: extend to leftmost/rightmost line of vertical (only if butt_in and horizontal is wall2)
                                if (isHorizontalWall2) {
                                    const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                                    const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                                    const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                                    const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                                    
                                    const hMidX = (hWall.start_x + hWall.end_x) / 2;
                                    const vIntersectionX = inter.x;
                                    const isHorizontalOnLeft = hMidX < vIntersectionX;
                                    
                                    let targetX;
                                    if (isHorizontalOnLeft) {
                                        const vRightStartX = vRightmostLine[0].x;
                                        const vRightStartY = vRightmostLine[0].y;
                                        const vRightEndX = vRightmostLine[1].x;
                                        const vRightEndY = vRightmostLine[1].y;
                                        const vRightDx = vRightEndX - vRightStartX;
                                        const vRightDy = vRightEndY - vRightStartY;
                                        if (Math.abs(vRightDy) > 0.001) {
                                            const t = (inter.y - vRightStartY) / vRightDy;
                                            targetX = vRightStartX + t * vRightDx;
                                        } else {
                                            targetX = vRightStartX;
                                        }
                                    } else {
                                        const vLeftStartX = vLeftmostLine[0].x;
                                        const vLeftStartY = vLeftmostLine[0].y;
                                        const vLeftEndX = vLeftmostLine[1].x;
                                        const vLeftEndY = vLeftmostLine[1].y;
                                        const vLeftDx = vLeftEndX - vLeftStartX;
                                        const vLeftDy = vLeftEndY - vLeftStartY;
                                        if (Math.abs(vLeftDy) > 0.001) {
                                            const t = (inter.y - vLeftStartY) / vLeftDy;
                                            targetX = vLeftStartX + t * vLeftDx;
                                        } else {
                                            targetX = vLeftStartX;
                                        }
                                    }
                                    
                                    if (hIsAtStart) {
                                        hLines.line1[0].x = targetX;
                                        hLines.line2[0].x = targetX;
                                    } else {
                                        hLines.line1[1].x = targetX;
                                        hLines.line2[1].x = targetX;
                                    }
                                }
                            });
                        }
                    });
                    
                    // Generate color map for walls
                    const thicknessColorMap = generateThicknessColorMap(wallsToDraw);
                    
                    // Third pass: Apply 45° cuts and draw walls
                    wallsToDraw.forEach((wall) => {
                        // Get pre-calculated lines (already extended to intersections)
                        let { line1, line2 } = wallLinesMap.get(wall.id);
                        
                        // Make copies for modification (45° cuts will modify these)
                        line1 = [...line1.map(p => ({ ...p }))];
                        line2 = [...line2.map(p => ({ ...p }))];
                        
                        // Get wall colors
                        const comboKey = getWallFinishKey(wall);
                        const thicknessColors = thicknessColorMap.get(comboKey) || { wall: '#333', partition: '#666', hasDifferentFaces: false };
                        const hasDiffFaces = thicknessColors.hasDifferentFaces;
                        const intMat = wall.inner_face_material || 'PPGI';
                        const extMat = wall.outer_face_material || 'PPGI';
                        const actuallyHasDiffFaces = hasDiffFaces && (intMat !== extMat);
                        const baseColor = wall.application_type === "partition" ? thicknessColors.partition : thicknessColors.wall;
                        const baseInnerColor = actuallyHasDiffFaces 
                            ? (wall.application_type === "partition" ? thicknessColors.innerPartition : thicknessColors.innerWall)
                            : null;
                        
                        // Convert color strings to RGB arrays
                        const getRgbFromColor = (colorStr) => {
                            if (!colorStr || typeof colorStr !== 'string') {
                                return [0, 0, 0]; // Default black
                            }
                            if (colorStr.startsWith('hsl')) {
                                const rgb = parseHslColor(colorStr);
                                // Validate RGB values
                                if (rgb && rgb.length === 3 && rgb.every(v => !isNaN(v) && isFinite(v))) {
                                    return rgb;
                                }
                                return [0, 0, 0];
                            } else if (colorStr.startsWith('#')) {
                                const hex = colorStr.slice(1);
                                if (hex.length >= 6) {
                                    const r = parseInt(hex.slice(0, 2), 16);
                                    const g = parseInt(hex.slice(2, 4), 16);
                                    const b = parseInt(hex.slice(4, 6), 16);
                                    // Validate parsed values
                                    if (!isNaN(r) && !isNaN(g) && !isNaN(b) && isFinite(r) && isFinite(g) && isFinite(b)) {
                                        return [r, g, b];
                                    }
                                }
                                return [0, 0, 0];
                            }
                            return [0, 0, 0];
                        };
                        
                        // Ensure baseColor is valid
                        const safeBaseColor = baseColor || '#333';
                        const wallColorRgb = getRgbFromColor(safeBaseColor);
                        const innerColorRgb = baseInnerColor ? getRgbFromColor(baseInnerColor) : null;
                        
                        // Final validation - ensure all RGB values are valid numbers in range 0-255
                        if (!wallColorRgb || wallColorRgb.length !== 3 || 
                            wallColorRgb.some(v => isNaN(v) || !isFinite(v))) {
                            console.warn('Invalid wallColorRgb for wall', wall.id, 'baseColor:', baseColor, 'wallColorRgb:', wallColorRgb);
                            wallColorRgb[0] = 0;
                            wallColorRgb[1] = 0;
                            wallColorRgb[2] = 0;
                        } else {
                            // Clamp RGB values to valid range
                            wallColorRgb[0] = Math.max(0, Math.min(255, Math.round(wallColorRgb[0])));
                            wallColorRgb[1] = Math.max(0, Math.min(255, Math.round(wallColorRgb[1])));
                            wallColorRgb[2] = Math.max(0, Math.min(255, Math.round(wallColorRgb[2])));
                        }
                        
                        // Validate innerColorRgb if present
                        if (innerColorRgb && (!innerColorRgb || innerColorRgb.length !== 3 || 
                            innerColorRgb.some(v => isNaN(v) || !isFinite(v)))) {
                            console.warn('Invalid innerColorRgb for wall', wall.id);
                            innerColorRgb[0] = 107;
                            innerColorRgb[1] = 114;
                            innerColorRgb[2] = 128;
                        } else if (innerColorRgb) {
                            // Clamp RGB values to valid range
                            innerColorRgb[0] = Math.max(0, Math.min(255, Math.round(innerColorRgb[0])));
                            innerColorRgb[1] = Math.max(0, Math.min(255, Math.round(innerColorRgb[1])));
                            innerColorRgb[2] = Math.max(0, Math.min(255, Math.round(innerColorRgb[2])));
                        }
                        
                        // Check for 45° cuts at EACH END separately
                        const wallDx = wall.end_x - wall.start_x;
                        const wallDy = wall.end_y - wall.start_y;
                        const wallLength = Math.hypot(wallDx, wallDy);
                        const wallDirX = wallLength > 0 ? wallDx / wallLength : 0;
                        const wallDirY = wallLength > 0 ? wallDy / wallLength : 0;
                        
                        const isVertical = Math.abs(wallDx) < Math.abs(wallDy);
                        
                        // Compare line positions at midpoint
                        const line1MidX = (line1[0].x + line1[1].x) / 2;
                        const line1MidY = (line1[0].y + line1[1].y) / 2;
                        const line2MidX = (line2[0].x + line2[1].x) / 2;
                        const line2MidY = (line2[0].y + line2[1].y) / 2;
                        
                        // Determine which line is on left vs right
                        let line1IsLeft;
                        if (isVertical) {
                            line1IsLeft = line1MidX < line2MidX;
                        } else {
                            if (wallDirX > 0) {
                                line1IsLeft = line1MidY < line2MidY;
                            } else {
                                line1IsLeft = line1MidY > line2MidY;
                            }
                        }
                        
                        // Check start end for 45° cut
                        let startHas45 = false;
                        let startIsOnLeftSide = false;
                        
                        // Check end end for 45° cut
                        let endHas45 = false;
                        let endIsOnLeftSide = false;
                        
                        // Check each intersection to find 45° cuts at each endpoint
                        intersections.forEach(inter => {
                            const tolerance = SNAP_THRESHOLD;
                            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
                            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
                            
                            if (isAtStart || isAtEnd) {
                                let has45Cut = false;
                                let joiningWallId = null;
                                
                                if (inter.pairs) {
                                    inter.pairs.forEach(pair => {
                                        if ((pair.wall1?.id === wall.id || pair.wall2?.id === wall.id) && pair.joining_method === '45_cut') {
                                            has45Cut = true;
                                            joiningWallId = pair.wall1?.id === wall.id ? pair.wall2?.id : pair.wall1?.id;
                                        }
                                    });
                                }
                                
                                if (has45Cut && joiningWallId) {
                                    const joiningWall = allWalls.find(w => w.id === joiningWallId);
                                    if (joiningWall) {
                                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                                        
                                        if (isAtStart) {
                                            startHas45 = true;
                                            if (isVertical) {
                                                startIsOnLeftSide = joinMidX < wall.start_x;
                                            } else {
                                                if (wallDirX > 0) {
                                                    startIsOnLeftSide = joinMidY < wall.start_y;
                                                } else {
                                                    startIsOnLeftSide = joinMidY > wall.start_y;
                                                }
                                            }
                                        } else if (isAtEnd) {
                                            endHas45 = true;
                                            if (isVertical) {
                                                endIsOnLeftSide = joinMidX < wall.end_x;
                                            } else {
                                                if (wallDirX > 0) {
                                                    endIsOnLeftSide = joinMidY < wall.end_y;
                                                } else {
                                                    endIsOnLeftSide = joinMidY > wall.end_y;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        });
                        
                        // Apply 45° cut shortening at each end independently (match canvas drawing.js)
                        const wallThickness = wall.thickness || 100;
                        const finalAdjust = wallThickness; // Shorten by wall thickness to match visual gap
                        
                        // Shorten at START end
                        if (startHas45) {
                            if (startIsOnLeftSide) {
                                if (line1IsLeft) {
                                    line1[0].x += wallDirX * finalAdjust;
                                    line1[0].y += wallDirY * finalAdjust;
                                } else {
                                    line2[0].x += wallDirX * finalAdjust;
                                    line2[0].y += wallDirY * finalAdjust;
                                }
                            } else {
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
                            if (endIsOnLeftSide) {
                                if (line1IsLeft) {
                                    line1[1].x -= wallDirX * finalAdjust;
                                    line1[1].y -= wallDirY * finalAdjust;
                                } else {
                                    line2[1].x -= wallDirX * finalAdjust;
                                    line2[1].y -= wallDirY * finalAdjust;
                                }
                            } else {
                                if (line1IsLeft) {
                                    line2[1].x -= wallDirX * finalAdjust;
                                    line2[1].y -= wallDirY * finalAdjust;
                                } else {
                                    line1[1].x -= wallDirX * finalAdjust;
                                    line1[1].y -= wallDirY * finalAdjust;
                                }
                            }
                        }
                        
                        // Store lines for wall caps
                        wall._line1 = line1;
                        wall._line2 = line2;
                        
                        // Check for doors on this wall to break the line
                        const wallDoors = doorsToDraw.filter(d => 
                            (d.linked_wall === wall.id || d.wall_id === wall.id)
                        );
                        
                        // Draw wall line pair (outer solid, inner dashed)
                        // Break lines at door locations
                        if (wallDoors.length === 0) {
                            // No doors - draw continuous line
                            // Outer face (line1) - solid line
                            // Ensure wallColorRgb is valid
                            const safeWallColor = wallColorRgb && wallColorRgb.length === 3 
                                ? wallColorRgb 
                                : [0, 0, 0];
                            doc.setDrawColor(safeWallColor[0], safeWallColor[1], safeWallColor[2]);
                            doc.setLineWidth(0.15);
                            doc.setLineDashPattern([]); // Solid line for outer face
                            doc.line(transformX(line1[0].x), transformY(line1[0].y), transformX(line1[1].x), transformY(line1[1].y));
                            
                            // Inner face (line2) - dashed line
                            // Use inner color if different from outer, otherwise use same color as outer (matching canvas logic)
                            const innerColorToUse = (innerColorRgb && 
                                (innerColorRgb[0] !== safeWallColor[0] || 
                                 innerColorRgb[1] !== safeWallColor[1] || 
                                 innerColorRgb[2] !== safeWallColor[2]))
                                ? innerColorRgb 
                                : safeWallColor; // Use same color as outer if inner color is same or not provided
                            doc.setDrawColor(innerColorToUse[0], innerColorToUse[1], innerColorToUse[2]);
                            doc.setLineWidth(0.15);
                            const dashPattern = [8 * scale, 4 * scale]; // Scaled dash pattern
                            doc.setLineDashPattern(dashPattern);
                            doc.line(transformX(line2[0].x), transformY(line2[0].y), transformX(line2[1].x), transformY(line2[1].y));
                            doc.setLineDashPattern([]); // Reset
                        } else {
                            // Has doors - break lines at door locations
                            const wallDx = wall.end_x - wall.start_x;
                            const wallDy = wall.end_y - wall.start_y;
                            const wallLength = Math.hypot(wallDx, wallDy);
                            const wallDirX = wallLength > 0 ? wallDx / wallLength : 0;
                            const wallDirY = wallLength > 0 ? wallDy / wallLength : 0;
                            
                            // Calculate door cutout positions along the wall
                            const doorCutouts = wallDoors.map(door => {
                                const slashLength = (door.door_type === 'swing') ? door.width : door.width * 0.85;
                                const halfSlashRatio = (slashLength / wallLength) / 2;
                                const gap = 200;
                                const gapRatio = gap / wallLength;
                                const clampedPosition = Math.min(
                                    Math.max(door.position_x, halfSlashRatio + gapRatio),
                                    1 - halfSlashRatio - gapRatio
                                );
                                const doorCenterX = wall.start_x + wallDx * clampedPosition;
                                const doorCenterY = wall.start_y + wallDy * clampedPosition;
                                const slashHalf = slashLength / 2;
                                
                                // Calculate cutout start/end points along wall line
                                const cutoutStartX = doorCenterX - wallDirX * slashHalf;
                                const cutoutStartY = doorCenterY - wallDirY * slashHalf;
                                const cutoutEndX = doorCenterX + wallDirX * slashHalf;
                                const cutoutEndY = doorCenterY + wallDirY * slashHalf;
                                
                                // Project onto line1 and line2 to get break points
                                const line1Start = { x: line1[0].x, y: line1[0].y };
                                const line1End = { x: line1[1].x, y: line1[1].y };
                                const line2Start = { x: line2[0].x, y: line2[0].y };
                                const line2End = { x: line2[1].x, y: line2[1].y };
                                
                                // Project cutout points onto line1
                                const t1Start = ((cutoutStartX - line1Start.x) * (line1End.x - line1Start.x) + 
                                                (cutoutStartY - line1Start.y) * (line1End.y - line1Start.y)) / 
                                               ((line1End.x - line1Start.x) ** 2 + (line1End.y - line1Start.y) ** 2);
                                const t1End = ((cutoutEndX - line1Start.x) * (line1End.x - line1Start.x) + 
                                              (cutoutEndY - line1Start.y) * (line1End.y - line1Start.y)) / 
                                             ((line1End.x - line1Start.x) ** 2 + (line1End.y - line1Start.y) ** 2);
                                
                                const break1Start = {
                                    x: line1Start.x + t1Start * (line1End.x - line1Start.x),
                                    y: line1Start.y + t1Start * (line1End.y - line1Start.y)
                                };
                                const break1End = {
                                    x: line1Start.x + t1End * (line1End.x - line1Start.x),
                                    y: line1Start.y + t1End * (line1End.y - line1Start.y)
                                };
                                
                                // Project onto line2
                                const t2Start = ((cutoutStartX - line2Start.x) * (line2End.x - line2Start.x) + 
                                                (cutoutStartY - line2Start.y) * (line2End.y - line2Start.y)) / 
                                               ((line2End.x - line2Start.x) ** 2 + (line2End.y - line2Start.y) ** 2);
                                const t2End = ((cutoutEndX - line2Start.x) * (line2End.x - line2Start.x) + 
                                              (cutoutEndY - line2Start.y) * (line2End.y - line2Start.y)) / 
                                             ((line2End.x - line2Start.x) ** 2 + (line2End.y - line2Start.y) ** 2);
                                
                                const break2Start = {
                                    x: line2Start.x + t2Start * (line2End.x - line2Start.x),
                                    y: line2Start.y + t2Start * (line2End.y - line2Start.y)
                                };
                                const break2End = {
                                    x: line2Start.x + t2End * (line2End.x - line2Start.x),
                                    y: line2Start.y + t2End * (line2End.y - line2Start.y)
                                };
                                
                                return {
                                    break1Start, break1End,
                                    break2Start, break2End,
                                    t1Start, t1End, t2Start, t2End
                                };
                            }).sort((a, b) => a.t1Start - b.t1Start); // Sort by position along wall
                            
                            // Draw line segments, breaking at door cutouts
                            const drawBrokenLine = (lineStart, lineEnd, color, isDashed) => {
                                let currentT = 0;
                                
                                for (const cutout of doorCutouts) {
                                    const segmentStartT = currentT;
                                    const segmentEndT = Math.min(cutout.t1Start, 1);
                                    
                                    if (segmentEndT > segmentStartT) {
                                        const segStart = {
                                            x: lineStart.x + segmentStartT * (lineEnd.x - lineStart.x),
                                            y: lineStart.y + segmentStartT * (lineEnd.y - lineStart.y)
                                        };
                                        const segEnd = {
                                            x: lineStart.x + segmentEndT * (lineEnd.x - lineStart.x),
                                            y: lineStart.y + segmentEndT * (lineEnd.y - lineStart.y)
                                        };
                                        
                                        doc.setDrawColor(color[0], color[1], color[2]);
                                        doc.setLineWidth(0.15);
                                        if (isDashed) {
                                            const dashPattern = [8 * scale, 4 * scale];
                                            doc.setLineDashPattern(dashPattern);
                                        } else {
                                            doc.setLineDashPattern([]);
                                        }
                                        doc.line(transformX(segStart.x), transformY(segStart.y), transformX(segEnd.x), transformY(segEnd.y));
                                    }
                                    
                                    currentT = Math.max(cutout.t1End, currentT);
                                }
                                
                                // Draw final segment after last door
                                if (currentT < 1) {
                                    const segStart = {
                                        x: lineStart.x + currentT * (lineEnd.x - lineStart.x),
                                        y: lineStart.y + currentT * (lineEnd.y - lineStart.y)
                                    };
                                    
                                    doc.setDrawColor(color[0], color[1], color[2]);
                                    doc.setLineWidth(0.15);
                                    if (isDashed) {
                                        const dashPattern = [8 * scale, 4 * scale];
                                        doc.setLineDashPattern(dashPattern);
                                    } else {
                                        doc.setLineDashPattern([]);
                                    }
                                    doc.line(transformX(segStart.x), transformY(segStart.y), transformX(lineEnd.x), transformY(lineEnd.y));
                                }
                            };
                            
                            // Draw broken outer face (line1)
                            const safeWallColor = wallColorRgb && wallColorRgb.length === 3 
                                ? wallColorRgb 
                                : [0, 0, 0];
                            drawBrokenLine(line1[0], line1[1], safeWallColor, false);
                            
                            // Draw broken inner face (line2) - need to recalculate for line2
                            const drawBrokenLine2 = (lineStart, lineEnd, color, isDashed) => {
                                let currentT = 0;
                                
                                for (const cutout of doorCutouts) {
                                    const segmentStartT = currentT;
                                    const segmentEndT = Math.min(cutout.t2Start, 1);
                                    
                                    if (segmentEndT > segmentStartT) {
                                        const segStart = {
                                            x: lineStart.x + segmentStartT * (lineEnd.x - lineStart.x),
                                            y: lineStart.y + segmentStartT * (lineEnd.y - lineStart.y)
                                        };
                                        const segEnd = {
                                            x: lineStart.x + segmentEndT * (lineEnd.x - lineStart.x),
                                            y: lineStart.y + segmentEndT * (lineEnd.y - lineStart.y)
                                        };
                                        
                                        doc.setDrawColor(color[0], color[1], color[2]);
                                        doc.setLineWidth(0.15);
                                        if (isDashed) {
                                            const dashPattern = [8 * scale, 4 * scale];
                                            doc.setLineDashPattern(dashPattern);
                                        } else {
                                            doc.setLineDashPattern([]);
                                        }
                                        doc.line(transformX(segStart.x), transformY(segStart.y), transformX(segEnd.x), transformY(segEnd.y));
                                    }
                                    
                                    currentT = Math.max(cutout.t2End, currentT);
                                }
                                
                                // Draw final segment after last door
                                if (currentT < 1) {
                                    const segStart = {
                                        x: lineStart.x + currentT * (lineEnd.x - lineStart.x),
                                        y: lineStart.y + currentT * (lineEnd.y - lineStart.y)
                                    };
                                    
                                    doc.setDrawColor(color[0], color[1], color[2]);
                                    doc.setLineWidth(0.15);
                                    if (isDashed) {
                                        const dashPattern = [8 * scale, 4 * scale];
                                        doc.setLineDashPattern(dashPattern);
                                    } else {
                                        doc.setLineDashPattern([]);
                                    }
                                    doc.line(transformX(segStart.x), transformY(segStart.y), transformX(lineEnd.x), transformY(lineEnd.y));
                                }
                            };
                            
                            // Draw broken inner face (line2) with correct color
                            // Use inner color if different from outer, otherwise use same color as outer (matching canvas logic)
                            const innerColorToUse = (innerColorRgb && innerColorRgb.length === 3 &&
                                (innerColorRgb[0] !== safeWallColor[0] || 
                                 innerColorRgb[1] !== safeWallColor[1] || 
                                 innerColorRgb[2] !== safeWallColor[2]))
                                ? innerColorRgb 
                                : safeWallColor; // Use same color as outer if inner color is same or not provided
                            drawBrokenLine2(line2[0], line2[1], innerColorToUse, true);
                            doc.setLineDashPattern([]); // Reset
                        }
                        
                        // Draw wall caps (joints) - ALWAYS draw caps at endpoints
                        const endpoints = [
                            { label: 'start', x: wall.start_x, y: wall.start_y },
                            { label: 'end', x: wall.end_x, y: wall.end_y }
                        ];
                        
                        endpoints.forEach((pt) => {
                            const cap1 = pt.label === 'start' ? wall._line1[0] : wall._line1[1];
                            const cap2 = pt.label === 'start' ? wall._line2[0] : wall._line2[1];
                            
                            // Find intersection at this endpoint - EXACT same logic as drawWallCaps
                            // First, find ALL intersections involving this wall (by wall ID)
                            const allWallIntersections = intersections.filter(inter => 
                                inter.wall_1 === wall.id || inter.wall_2 === wall.id
                            );
                            
                            // Then, find which one is at this specific endpoint
                            const tolerance = 50; // 50mm tolerance for endpoint matching
                            const relevantIntersections = allWallIntersections.filter(inter => {
                                const isAtPoint = Math.hypot(inter.x - pt.x, inter.y - pt.y) < tolerance;
                                if (isAtPoint) {
                                    console.log(`Found intersection at wall ${wall.id} endpoint ${pt.label}:`, {
                                        joining_method: inter.joining_method,
                                        wall_1: inter.wall_1,
                                        wall_2: inter.wall_2,
                                        distance: Math.hypot(inter.x - pt.x, inter.y - pt.y)
                                    });
                                }
                                return isAtPoint;
                            });
                            
                            let joiningMethod = 'butt_in'; // Default to butt_in
                            let isPrimaryWall = true;
                            let joiningWall = null;
                            
                            // Use the first intersection found at this endpoint (EXACT same logic as drawWallCaps)
                            if (relevantIntersections.length > 0) {
                                const inter = relevantIntersections[0]; // Use first match
                                if (inter.wall_1 === wall.id || inter.wall_2 === wall.id) {
                                    joiningMethod = inter.joining_method || 'butt_in';
                                    const joiningWallId = inter.wall_2 === wall.id ? inter.wall_1 : inter.wall_2;
                                    if (inter.wall_2 === wall.id) {
                                        isPrimaryWall = false;
                                    }
                                    // Find the actual wall object
                                    joiningWall = allWalls.find(w => w.id === joiningWallId);
                                    console.log(`Wall ${wall.id} endpoint ${pt.label}: joiningMethod=${joiningMethod}, joiningWallId=${joiningWallId}, found=${!!joiningWall}`);
                                }
                            }
                            
                            // Skip if 45_cut and not primary wall (to avoid duplicates)
                            if (joiningMethod === '45_cut' && !isPrimaryWall) {
                                return;
                            }
                            
                            if (joiningMethod === '45_cut' && joiningWall) {
                                // Draw mitered cap at 45° - EXACT same logic as drawWallCaps
                                const wallVec = pt.label === 'start'
                                    ? { x: wall.end_x - wall.start_x, y: wall.end_y - wall.start_y }
                                    : { x: wall.start_x - wall.end_x, y: wall.start_y - wall.end_y };
                                
                                // Check which endpoint of joining wall is at intersection
                                let joinVec = null;
                                if (Math.abs(joiningWall.start_x - pt.x) < 1e-3 && Math.abs(joiningWall.start_y - pt.y) < 1e-3) {
                                    joinVec = { x: joiningWall.end_x - joiningWall.start_x, y: joiningWall.end_y - joiningWall.start_y };
                                } else {
                                    joinVec = { x: joiningWall.start_x - joiningWall.end_x, y: joiningWall.start_y - joiningWall.end_y };
                                }
                                
                                if (joinVec) {
                                    const norm = v => {
                                        const len = Math.hypot(v.x, v.y);
                                        return len ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
                                    };
                                    const v1 = norm(wallVec);
                                    const v2 = norm(joinVec);
                                    
                                    // Calculate bisector (average of the two direction vectors)
                                    const bisector = norm({ x: v1.x + v2.x, y: v1.y + v2.y });
                                    const capLength = wall.thickness * 1.5;
                                    
                                    // Draw 45° cut lines from cap endpoints along bisector - EXACT same as canvas
                                    // Canvas draws two separate lines (moveTo + lineTo for each)
                                    doc.setDrawColor(0, 0, 0); // Black for 45° cut (canvas uses red for debugging, but we use black)
                                    doc.setLineWidth(0.15);
                                    doc.setLineDashPattern([]);
                                    
                                    // Draw 45° cut lines from cap endpoints TO intersection point - form closed mitered corner
                                    // The lines should meet at the intersection point (pt.x, pt.y) to form a closed corner
                                    doc.setDrawColor(0, 0, 0); // Black for 45° cut
                                    doc.setLineWidth(0.15);
                                    doc.setLineDashPattern([]);
                                    
                                    // Draw line from cap1 endpoint to intersection point
                                    doc.line(transformX(cap1.x), transformY(cap1.y), transformX(pt.x), transformY(pt.y));
                                    
                                    // Draw line from cap2 endpoint to intersection point
                                    doc.line(transformX(cap2.x), transformY(cap2.y), transformX(pt.x), transformY(pt.y));
                                    
                                    console.log(`45° cut drawn for wall ${wall.id} at ${pt.label}:`, {
                                        wallVec: v1,
                                        joinVec: v2,
                                        bisector: bisector,
                                        capLength: capLength
                                    });
                                } else {
                                    console.log(`No joinVec for wall ${wall.id} at ${pt.label}, joiningWall:`, joiningWall);
                                }
                            } else {
                                // Default: perpendicular cap (butt_in) - ALWAYS draw this
                                doc.setDrawColor(0, 0, 0);
                                doc.setLineWidth(0.15);
                                doc.setLineDashPattern([]);
                                doc.line(transformX(cap1.x), transformY(cap1.y), transformX(cap2.x), transformY(cap2.y));
                            }
                        });
                        
                        // Draw partition slashes if partition
                        if (wall.application_type === "partition") {
                            const spacing = 15;
                            const slashLength = 60;
                            const dx = line1[1].x - line1[0].x;
                            const dy = line1[1].y - line1[0].y;
                            const wallLength = Math.sqrt(dx * dx + dy * dy);
                            const numSlashes = Math.floor(wallLength / spacing);
                            
                            for (let i = 1; i < numSlashes - 1; i++) {
                                const t = i / numSlashes;
                                const midX = (line1[0].x + t * (line1[1].x - line1[0].x) + line2[0].x + t * (line2[1].x - line2[0].x)) / 2;
                                const midY = (line1[0].y + t * (line1[1].y - line1[0].y) + line2[0].y + t * (line2[1].y - line2[0].y)) / 2;
                                const diagX = Math.cos(Math.PI / 4) * slashLength;
                                const diagY = Math.sin(Math.PI / 4) * slashLength;
                                
                                doc.setDrawColor(100, 100, 100);
                                doc.setLineWidth(0.1);
                                doc.setLineDashPattern([]);
                                doc.line(
                                    transformX(midX - diagX / 2), transformY(midY - diagY / 2),
                                    transformX(midX + diagX / 2), transformY(midY + diagY / 2)
                                );
                            }
                        }
                    });
                    
                    // Draw doors using EXACT same logic as canvas (drawDoors from utils.js)
                    doorsToDraw.forEach((door) => {
                        const wall = wallsToDraw.find(w => w.id === door.linked_wall || w.id === door.wall_id);
                        if (!wall) return;

                        const x1 = wall.start_x;
                        const y1 = wall.start_y;
                        const x2 = wall.end_x;
                        const y2 = wall.end_y;

                        const wallLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
                        const slashLength = (door.door_type === 'swing') ? door.width : door.width * 0.85;
                        const halfSlashRatio = (slashLength / wallLength) / 2;

                        const gap = 200;
                        const gapRatio = gap / wallLength;

                        const clampedPosition = Math.min(
                            Math.max(door.position_x, halfSlashRatio + gapRatio),
                            1 - halfSlashRatio - gapRatio
                        );

                        const doorCenterX = x1 + (x2 - x1) * clampedPosition;
                        const doorCenterY = y1 + (y2 - y1) * clampedPosition;

                        let angle = Math.atan2(y2 - y1, x2 - x1);
                        const doorWidth = door.width;
                        const doorThickness = 150;

                        const doorColor = [255, 165, 0]; // Orange
                        const strokeColor = [0, 0, 0];
                        const lineWidth = 0.2;

                        // Helper to transform local door coordinates to PDF coordinates
                        // Replicates ctx.save(), ctx.translate(), ctx.rotate() behavior
                        const transformDoorPoint = (localX, localY, doorAngle = angle, doorSide = door.side) => {
                            let localAngle = doorAngle;
                            if (doorSide === 'interior') {
                                localAngle += Math.PI;
                            }
                            const cosA = Math.cos(localAngle);
                            const sinA = Math.sin(localAngle);
                            const worldX = doorCenterX + (localX * cosA - localY * sinA);
                            const worldY = doorCenterY + (localX * sinA + localY * cosA);
                            return { x: transformX(worldX), y: transformY(worldY) };
                        };

                        // === Slashed Wall Section ===
                        // Draw diagonal slashes to indicate door opening in wall
                        const slashHalf = slashLength / 2;
                        const slashStart = { x: -slashHalf, y: 0 };
                        const slashEnd = { x: slashHalf, y: 0 };
                        const numSlashes = Math.max(3, Math.floor((doorWidth * scale) / 8)); // More slashes, thicker
                        
                        doc.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
                        doc.setLineWidth(lineWidth * 1.5); // Make slashes thicker so they're visible

                        for (let i = 0; i < numSlashes; i++) {
                            const t = i / (numSlashes - 1);
                            const px = slashStart.x + (slashEnd.x - slashStart.x) * t;
                            const py = 0;
                            const slashAngle = Math.PI / 4; // 45° diagonal
                            const lineLen = doorThickness * 0.8; // Longer slashes

                            // Calculate in local door space (before rotation)
                            const localX1 = (px - Math.cos(slashAngle) * lineLen / 2);
                            const localY1 = (py - Math.sin(slashAngle) * lineLen / 2);
                            const localX2 = (px + Math.cos(slashAngle) * lineLen / 2);
                            const localY2 = (py + Math.sin(slashAngle) * lineLen / 2);
                            
                            // Transform to PDF coordinates
                            const p1 = transformDoorPoint(localX1, localY1);
                            const p2 = transformDoorPoint(localX2, localY2);
                            doc.line(p1.x, p1.y, p2.x, p2.y);
                        }
                        
                        // Reset line width
                        doc.setLineWidth(lineWidth);

                        // === SWING DOOR DRAWING ===
                        if (door.door_type === 'swing') {
                            const radius = doorWidth / (door.configuration === 'double_sided' ? 2 : 1);
                            const thickness = doorThickness;
                            
                            const drawSwingPanel = (hingeOffset, direction) => {
                                const isRight = direction === 'right';
                                const arcStart = isRight ? Math.PI : 0;
                                const arcEnd = isRight ? Math.PI * 1.5 : -Math.PI * 0.5;
                                const anticlockwise = !isRight;
                                
                                // Draw arc - EXACT same as canvas: ctx.arc(0, 0, radius * scale, arcStart, arcEnd, anticlockwise)
                                // In local door space, after translate(hingeOffset * scale, 0) and rotate(angle)
                                const numSegments = 30; // More segments for smoother arc
                                const arcPoints = [];
                                for (let i = 0; i <= numSegments; i++) {
                                    const t = i / numSegments;
                                    let localAngle;
                                    if (anticlockwise) {
                                        // Counter-clockwise: go backwards
                                        localAngle = arcStart + (arcEnd - arcStart) * (1 - t);
                                        if (arcEnd < arcStart) {
                                            localAngle = arcStart - (arcStart - arcEnd) * t;
                                        }
                                    } else {
                                        // Clockwise: go forwards
                                        localAngle = arcStart + (arcEnd - arcStart) * t;
                                    }
                                    const localX = hingeOffset + radius * Math.cos(localAngle);
                                    const localY = radius * Math.sin(localAngle);
                                    arcPoints.push(transformDoorPoint(localX, localY));
                                }
                                
                                // Draw arc segments
                                doc.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
                                doc.setLineWidth(lineWidth);
                                for (let i = 0; i < arcPoints.length - 1; i++) {
                                    doc.line(arcPoints[i].x, arcPoints[i].y, arcPoints[i + 1].x, arcPoints[i + 1].y);
                                }
                                
                                // Draw door panel rectangle at arc end - EXACT same as canvas
                                // Canvas sequence (in local door space after translate to door center and rotate by wall angle):
                                // 1. ctx.translate(hingeOffset * scale, 0) - hinge is now at origin
                                // 2. ctx.arc(0, 0, radius * scale, arcStart, arcEnd, anticlockwise) - draw arc
                                // 3. arcEndX = Math.cos(arcEnd) * radius * scale (relative to hinge/origin)
                                // 4. arcEndY = Math.sin(arcEnd) * radius * scale (relative to hinge/origin)
                                // 5. ctx.translate(arcEndX, arcEndY) - move to arc end
                                // 6. ctx.rotate(Math.atan2(arcEndY, arcEndX)) - rotate by angle from origin to arc end
                                // 7. ctx.fillRect(-radius * scale, -thickness * scale / 2, radius * scale, thickness * scale)
                                
                                // Calculate arc end position relative to hinge (in local door space after first translate)
                                const arcEndX = Math.cos(arcEnd) * radius;
                                const arcEndY = Math.sin(arcEnd) * radius;
                                
                                // Panel angle: Math.atan2(arcEndY, arcEndX) - angle from hinge (origin) to arc end
                                const panelAngle = Math.atan2(arcEndY, arcEndX);
                                
                                // Arc end position in local door space (hingeOffset + arcEndX, arcEndY)
                                const arcEndLocalX = hingeOffset + arcEndX;
                                const arcEndLocalY = arcEndY;
                                
                                const rectWidth = radius;
                                const rectHeight = thickness;
                                
                                // Calculate rectangle corners - EXACT same as canvas fillRect
                                // Canvas: fillRect(-radius * scale, -thickness * scale / 2, radius * scale, thickness * scale)
                                // This rectangle is drawn AFTER translate(arcEndX, arcEndY) and rotate(panelAngle)
                                // So corners are: (-radius, -thickness/2), (0, -thickness/2), (0, thickness/2), (-radius, thickness/2)
                                const corners = [
                                    { x: -rectWidth, y: -rectHeight / 2 },
                                    { x: 0, y: -rectHeight / 2 },
                                    { x: 0, y: rectHeight / 2 },
                                    { x: -rectWidth, y: rectHeight / 2 }
                                ].map(corner => {
                                    // First rotate by panel angle (around origin, before translate to arc end)
                                    const cosPanel = Math.cos(panelAngle);
                                    const sinPanel = Math.sin(panelAngle);
                                    const rotatedX = corner.x * cosPanel - corner.y * sinPanel;
                                    const rotatedY = corner.x * sinPanel + corner.y * cosPanel;
                                    // Then translate to arc end position in local door space
                                    const localX = arcEndLocalX + rotatedX;
                                    const localY = arcEndLocalY + rotatedY;
                                    // Finally transform to PDF coordinates (includes door center translation and wall angle rotation)
                                    return transformDoorPoint(localX, localY);
                                });
                                
                                // Draw and fill rectangle - EXACT same as canvas
                                doc.setFillColor(doorColor[0], doorColor[1], doorColor[2]);
                                doc.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
                                doc.setLineWidth(lineWidth);
                                
                                // Draw rectangle outline
                                for (let i = 0; i < corners.length; i++) {
                                    const next = corners[(i + 1) % corners.length];
                                    doc.line(corners[i].x, corners[i].y, next.x, next.y);
                                }
                                
                                // Fill rectangle (draw filled polygon by drawing lines close together)
                                const fillSteps = 8; // More steps for better fill
                                for (let i = 0; i < fillSteps; i++) {
                                    const t = i / fillSteps;
                                    const x1 = corners[0].x + (corners[1].x - corners[0].x) * t;
                                    const y1 = corners[0].y + (corners[1].y - corners[0].y) * t;
                                    const x2 = corners[3].x + (corners[2].x - corners[3].x) * t;
                                    const y2 = corners[3].y + (corners[2].y - corners[3].y) * t;
                                    doc.line(x1, y1, x2, y2);
                                }
                            };

                            if (door.configuration === 'single_sided') {
                                const hingeOffset = door.swing_direction === 'right' ? slashHalf : -slashHalf;
                                drawSwingPanel(hingeOffset, door.swing_direction);
                            } else if (door.configuration === 'double_sided') {
                                drawSwingPanel(-slashHalf, 'left');
                                drawSwingPanel(slashHalf, 'right');
                            }
                        }

                        // === SLIDE DOOR DRAWING ===
                        if (door.door_type === 'slide') {
                            const halfLength = (doorWidth) * 1.1;
                            const thickness = doorThickness * 0.8;

                            const drawSlidePanel = (offsetX, direction) => {
                                // In local door space: panel is at (offsetX, thickness)
                                const panelLocalX = offsetX;
                                const panelLocalY = thickness;
                                
                                // Calculate rectangle corners in local space
                                const corners = [
                                    { x: -halfLength / 2, y: -thickness / 2 },
                                    { x: halfLength / 2, y: -thickness / 2 },
                                    { x: halfLength / 2, y: thickness / 2 },
                                    { x: -halfLength / 2, y: thickness / 2 }
                                ].map(corner => transformDoorPoint(
                                    panelLocalX + corner.x,
                                    panelLocalY + corner.y
                                ));
                                
                                doc.setFillColor(doorColor[0], doorColor[1], doorColor[2]);
                                doc.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
                                doc.setLineWidth(lineWidth);
                                
                                // Draw rectangle outline
                                for (let i = 0; i < corners.length; i++) {
                                    const next = corners[(i + 1) % corners.length];
                                    doc.line(corners[i].x, corners[i].y, next.x, next.y);
                                }
                                
                                // Fill rectangle
                                const fillSteps = 5;
                                for (let i = 0; i < fillSteps; i++) {
                                    const t = i / fillSteps;
                                    const x1 = corners[0].x + (corners[1].x - corners[0].x) * t;
                                    const y1 = corners[0].y + (corners[1].y - corners[0].y) * t;
                                    const x2 = corners[3].x + (corners[2].x - corners[3].x) * t;
                                    const y2 = corners[3].y + (corners[2].y - corners[3].y) * t;
                                    doc.line(x1, y1, x2, y2);
                                }

                                // Draw arrow - in local space: arrow is at y = thickness * 2
                                const arrowLocalY = thickness * 2;
                                const arrowHeadSize = 4;
                                const arrowDir = direction === 'right' ? 1 : -1;
                                const arrowStartLocalX = -halfLength / 2;
                                const arrowEndLocalX = halfLength / 2;
                                
                                const arrowStart = transformDoorPoint(arrowStartLocalX, arrowLocalY);
                                const arrowEnd = transformDoorPoint(arrowEndLocalX, arrowLocalY);

                                doc.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
                                doc.setLineWidth(lineWidth);
                                doc.line(arrowStart.x, arrowStart.y, arrowEnd.x, arrowEnd.y);
                                
                                if (arrowDir === 1) {
                                    const arrowHead1 = transformDoorPoint(arrowEndLocalX - arrowHeadSize, arrowLocalY - arrowHeadSize);
                                    const arrowHead2 = transformDoorPoint(arrowEndLocalX - arrowHeadSize, arrowLocalY + arrowHeadSize);
                                    doc.line(arrowEnd.x, arrowEnd.y, arrowHead1.x, arrowHead1.y);
                                    doc.line(arrowEnd.x, arrowEnd.y, arrowHead2.x, arrowHead2.y);
                                } else {
                                    const arrowHead1 = transformDoorPoint(arrowStartLocalX + arrowHeadSize, arrowLocalY - arrowHeadSize);
                                    const arrowHead2 = transformDoorPoint(arrowStartLocalX + arrowHeadSize, arrowLocalY + arrowHeadSize);
                                    doc.line(arrowStart.x, arrowStart.y, arrowHead1.x, arrowHead1.y);
                                    doc.line(arrowStart.x, arrowStart.y, arrowHead2.x, arrowHead2.y);
                                }
                            };

                            if (door.configuration === 'single_sided') {
                                drawSlidePanel(0, door.slide_direction);
                            } else if (door.configuration === 'double_sided') {
                                drawSlidePanel(-slashHalf / 2, 'left');
                                drawSlidePanel(slashHalf / 2, 'right');
                            }
                        }
                    });
                    
                    // ===== DRAW DIMENSIONS - EXACT SAME LOGIC AS WALL PLAN CANVAS =====
                    // Convert px to mm: 1px = 0.264583mm (at 96 DPI) - standard conversion
                    const PX_TO_MM = 0.264583;
                    
                    // Calculate model bounds - EXACT same as canvas (drawing.js line 1317-1325)
                    const actualDimensions = calculateActualProjectDimensions(wallsToDraw);
                    let wallModelBounds = null; // For wall dimensions - NO padding
                    let projectModelBounds = null; // For project dimensions - WITH padding
                    if (wallsToDraw.length > 0) {
                        const { minX, maxX, minY, maxY } = actualDimensions;
                        
                        // Wall dimensions use actual dimensions WITHOUT padding (matching canvas line 1320-1325)
                        wallModelBounds = {
                            minX: minX,
                            maxX: maxX,
                            minY: minY,
                            maxY: maxY
                        };
                        
                        // Project dimensions use actual dimensions WITH padding (matching canvas line 352-357)
                        projectModelBounds = {
                            minX: minX - 100,
                            maxX: maxX + 100,
                            minY: minY - 100,
                            maxY: maxY + 100
                        };
                    }
                    
                    // Calculate filteredDimensions for dimension filtering (matching Canvas2D: wallPanelsMap + filterDimensions)
                    const wallPanelsMapForFilter = buildWallPanelsMapForFilter(wallsToDraw, intersections);
                    const filteredDimensions = filterDimensions(wallsToDraw, intersections, wallPanelsMapForFilter);
                    
                    // Value-level dedup: each dimension value (mm) at most once (match canvas dimensionValuesSeen)
                    const dimensionValuesSeen = new Set();
                    if (actualDimensions && (actualDimensions.width != null || actualDimensions.length != null)) {
                        if (typeof actualDimensions.width === 'number') dimensionValuesSeen.add(Math.round(actualDimensions.width));
                        if (typeof actualDimensions.length === 'number') dimensionValuesSeen.add(Math.round(actualDimensions.length));
                    }
                    
                    // Track placed labels for collision detection - SHARED between project and wall dimensions
                    const placedLabels = [];
                    
                    // Helper function to check if TEXT label overlaps with wall lines in PDF space
                    // This only checks if wall lines overlap the TEXT, not if dimension lines overlap walls
                    // Dimension lines are allowed to overlap wall lines
                    const doesLabelOverlapAnyWallLinePDF = (labelBounds, wallLinesMap) => {
                        if (!wallLinesMap || wallLinesMap.size === 0) return false;
                        
                        const rectLeft = labelBounds.x;
                        const rectRight = labelBounds.x + labelBounds.width;
                        const rectTop = labelBounds.y;
                        const rectBottom = labelBounds.y + labelBounds.height;
                        
                        for (const [, wallData] of wallLinesMap) {
                            const { line1, line2 } = wallData;
                            
                            const checkLineOverlap = (line) => {
                                if (!line || line.length < 2) return false;
                                
                                // Transform line points to PDF coordinates
                                const lineStartX = transformX(line[0].x);
                                const lineStartY = transformY(line[0].y);
                                const lineEndX = transformX(line[1].x);
                                const lineEndY = transformY(line[1].y);
                                
                                const lineMinX = Math.min(lineStartX, lineEndX);
                                const lineMaxX = Math.max(lineStartX, lineEndX);
                                const lineMinY = Math.min(lineStartY, lineEndY);
                                const lineMaxY = Math.max(lineStartY, lineEndY);
                                
                                // Quick rejection test
                                if (lineMaxX < rectLeft || lineMinX > rectRight || lineMaxY < rectTop || lineMinY > rectBottom) {
                                    return false;
                                }
                                
                                // Check if any point of the line is inside the rectangle
                                if ((lineStartX >= rectLeft && lineStartX <= rectRight && lineStartY >= rectTop && lineStartY <= rectBottom) ||
                                    (lineEndX >= rectLeft && lineEndX <= rectRight && lineEndY >= rectTop && lineEndY <= rectBottom)) {
                                    return true;
                                }
                                
                                // Check line-rectangle edge intersections
                                // Check intersection with top edge
                                if (lineMinY <= rectTop && lineMaxY >= rectTop) {
                                    const t = (rectTop - lineStartY) / (lineEndY - lineStartY);
                                    if (t >= 0 && t <= 1) {
                                        const intersectX = lineStartX + t * (lineEndX - lineStartX);
                                        if (intersectX >= rectLeft && intersectX <= rectRight) {
                                            return true;
                                        }
                                    }
                                }
                                
                                // Check intersection with bottom edge
                                if (lineMinY <= rectBottom && lineMaxY >= rectBottom) {
                                    const t = (rectBottom - lineStartY) / (lineEndY - lineStartY);
                                    if (t >= 0 && t <= 1) {
                                        const intersectX = lineStartX + t * (lineEndX - lineStartX);
                                        if (intersectX >= rectLeft && intersectX <= rectRight) {
                                            return true;
                                        }
                                    }
                                }
                                
                                // Check intersection with left edge
                                if (lineMinX <= rectLeft && lineMaxX >= rectLeft) {
                                    const t = (rectLeft - lineStartX) / (lineEndX - lineStartX);
                                    if (t >= 0 && t <= 1) {
                                        const intersectY = lineStartY + t * (lineEndY - lineStartY);
                                        if (intersectY >= rectTop && intersectY <= rectBottom) {
                                            return true;
                                        }
                                    }
                                }
                                
                                // Check intersection with right edge
                                if (lineMinX <= rectRight && lineMaxX >= rectRight) {
                                    const t = (rectRight - lineStartX) / (lineEndX - lineStartX);
                                    if (t >= 0 && t <= 1) {
                                        const intersectY = lineStartY + t * (lineEndY - lineStartY);
                                        if (intersectY >= rectTop && intersectY <= rectBottom) {
                                            return true;
                                        }
                                    }
                                }
                                
                                return false;
                            };
                            
                            if ((line1 && checkLineOverlap(line1)) || (line2 && checkLineOverlap(line2))) {
                                return true;
                            }
                        }
                        
                        return false;
                    };
                    
                    // Draw overall project dimensions (matching drawOverallProjectDimensions from drawing.js)
                    if (wallsToDraw.length > 0 && projectModelBounds) {
                        const { minX, maxX, minY, maxY } = actualDimensions;
                        
                        // Project dimension color: Purple (#8B5CF6) = RGB(139, 92, 246)
                        const projectColor = [139, 92, 246];
                        
                        // Draw overall width dimension (top) - horizontal
                        const drawProjectDimensionPDF = (startX, startY, endX, endY, orientation) => {
                            const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
                            if (length === 0) return;
                            
                            const wallMidX = (startX + endX) / 2;
                            const wallMidY = (startY + endY) / 2;
                            
                            // Font size calculation - EXACT same as canvas
                            const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scale;
                            let fontSize = calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN 
                                ? DIMENSION_CONFIG.FONT_SIZE_MIN 
                                : calculatedFontSize;
                            fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN);
                            
                            doc.setFontSize(fontSize);
                            doc.setFont(undefined, DIMENSION_CONFIG.FONT_WEIGHT);
                            
                            const text = `${Math.round(length)}`;
                            const textWidth = doc.getTextWidth(text);
                            
                            const { minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY } = projectModelBounds;
                            
                            if (orientation === 'horizontal') {
                                // Horizontal dimension - ALWAYS place on top (most upper/outermost)
                                const baseOffset = DIMENSION_CONFIG.PROJECT_BASE_OFFSET * PX_TO_MM;
                                
                                let labelY, labelX;
                                let offset = baseOffset;
                                let attempts = 0;
                                const maxAttempts = DIMENSION_CONFIG.PROJECT_MAX_ATTEMPTS;
                                
                                do {
                                    // Always place on top (most upper) - use minY
                                    labelY = transformY(pMinY) - offset;
                                    labelX = transformX(wallMidX);
                                    
                                    // Collision detection: Only check TEXT collisions, not line collisions
                                    // 1. Check text-to-text collisions (prevent text overlapping other text)
                                    const labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 4 * PX_TO_MM, 10 * PX_TO_MM);
                                    const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
                                    
                                    // 2. Check wall-line-to-text collisions (prevent wall lines from overlapping the text)
                                    // Note: Dimension lines CAN overlap wall lines - we only check if wall lines overlap the text
                                    const hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                    
                                    if (!hasOverlap && !hasWallOverlap) break;
                                    
                                    // Use smaller increment if only wall overlap, otherwise use normal increment
                                    const wallAvoidanceIncrementPx = hasWallOverlap && !hasOverlap ? 3 * scale : DIMENSION_CONFIG.PROJECT_OFFSET_INCREMENT * PX_TO_MM;
                                    offset += wallAvoidanceIncrementPx;
                                    attempts++;
                                } while (attempts < maxAttempts);
                                
                                // Draw dimension lines with gap for text
                                const textPadding = 4 * PX_TO_MM;
                                const textLeft = labelX - textWidth / 2 - textPadding;
                                const textRight = labelX + textWidth / 2 + textPadding;
                                
                                // Extension lines (dotted) - use larger dots for visibility
                                const dotSize = Math.max(0.3, 0.3 * scale); // Minimum 0.3mm dot size
                                const dotGap = Math.max(1.0, 1.0 * scale); // Gap between dots
                                const dotPattern = [dotSize, dotGap]; // Dotted pattern
                                doc.setLineDashPattern(dotPattern);
                                doc.setLineWidth(DIMENSION_CONFIG.LINE_WIDTH * PX_TO_MM);
                                doc.setDrawColor(projectColor[0], projectColor[1], projectColor[2]);
                                
                                // Extension line from start
                                doc.line(transformX(startX), transformY(startY), transformX(startX), labelY);
                                // Extension line from end
                                doc.line(transformX(endX), transformY(endY), transformX(endX), labelY);
                                
                                // Dimension line connecting the two extension lines (with gap for text) - also dotted
                                const startXScreen = transformX(startX);
                                const endXScreen = transformX(endX);
                                if (startXScreen < textLeft) {
                                    doc.line(startXScreen, labelY, textLeft, labelY);
                                }
                                if (endXScreen > textRight) {
                                    doc.line(textRight, labelY, endXScreen, labelY);
                                }
                                
                                doc.setLineDashPattern([]);
                                
                                // Draw text
                                doc.setTextColor(projectColor[0], projectColor[1], projectColor[2]);
                                doc.text(text, labelX, labelY, { align: 'center' });
                                
                                // Add to placed labels
                                placedLabels.push({
                                    x: labelX - textWidth / 2 - 4 * PX_TO_MM,
                                    y: labelY - 10 * PX_TO_MM,
                                    width: textWidth + 8 * PX_TO_MM,
                                    height: 20 * PX_TO_MM,
                                    side: 'top', // Always top for horizontal project dimensions
                                    text: text,
                                    angle: 0,
                                    type: 'project'
                                });
                                
                            } else {
                                // Vertical dimension - ALWAYS place on right (most right/outermost)
                                const baseOffset = Math.max(
                                    DIMENSION_CONFIG.PROJECT_BASE_OFFSET * PX_TO_MM,
                                    DIMENSION_CONFIG.PROJECT_MIN_VERTICAL_OFFSET * PX_TO_MM
                                );
                                
                                let labelX, labelY;
                                let offset = baseOffset;
                                let attempts = 0;
                                const maxAttempts = DIMENSION_CONFIG.PROJECT_MAX_ATTEMPTS;
                                
                                do {
                                    // Always place on right (most right) - use maxX
                                    labelX = transformX(pMaxX) + offset;
                                    labelY = transformY(wallMidY);
                                    
                                    // Collision detection: Only check TEXT collisions, not line collisions
                                    // 1. Check text-to-text collisions (prevent text overlapping other text)
                                    const labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 4 * PX_TO_MM, 10 * PX_TO_MM);
                                    const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
                                    
                                    // 2. Check wall-line-to-text collisions (prevent wall lines from overlapping the text)
                                    // Note: Dimension lines CAN overlap wall lines - we only check if wall lines overlap the text
                                    const hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                    
                                    if (!hasOverlap && !hasWallOverlap) break;
                                    
                                    // Use smaller increment if only wall overlap, otherwise use normal increment
                                    const wallAvoidanceIncrementPx = hasWallOverlap && !hasOverlap ? 3 * scale : DIMENSION_CONFIG.PROJECT_OFFSET_INCREMENT * PX_TO_MM;
                                    offset += wallAvoidanceIncrementPx;
                                    attempts++;
                                } while (attempts < maxAttempts);
                                
                                // Draw dimension lines with gap for text
                                const textPadding = 4 * PX_TO_MM;
                                const textTop = labelY - textWidth / 2 - textPadding;
                                const textBottom = labelY + textWidth / 2 + textPadding;
                                
                                // Extension lines (dotted) - use larger dots for visibility
                                const dotSize = Math.max(0.3, 0.3 * scale); // Minimum 0.3mm dot size
                                const dotGap = Math.max(1.0, 1.0 * scale); // Gap between dots
                                const dotPattern = [dotSize, dotGap]; // Dotted pattern
                                doc.setLineDashPattern(dotPattern);
                                doc.setLineWidth(DIMENSION_CONFIG.LINE_WIDTH * PX_TO_MM);
                                doc.setDrawColor(projectColor[0], projectColor[1], projectColor[2]);
                                
                                // Extension line from start
                                doc.line(transformX(startX), transformY(startY), labelX, transformY(startY));
                                // Extension line from end
                                doc.line(transformX(endX), transformY(endY), labelX, transformY(endY));
                                
                                // Dimension line connecting the two extension lines (with gap for text) - also dotted
                                const startYScreen = transformY(startY);
                                const endYScreen = transformY(endY);
                                if (startYScreen < textTop) {
                                    doc.line(labelX, startYScreen, labelX, textTop);
                                }
                                if (endYScreen > textBottom) {
                                    doc.line(labelX, textBottom, labelX, endYScreen);
                                }
                                
                                doc.setLineDashPattern([]);
                                
                                // Draw vertical dimension text with rotation
                                // Position text CENTERED in the gap (textTop to textBottom)
                                doc.setTextColor(projectColor[0], projectColor[1], projectColor[2]);
                                // Position text to the left of the dimension line with small gap
                                const textGap = 2 * PX_TO_MM; // Gap between dimension line and text
                                const textX = labelX - textGap; // To the left of the line
                                // Position text Y at the center of the gap (centered vertically in the gap)
                                // Account for jsPDF rotation: with align: 'left' and angle: -90, text rotates around the point
                                // Adjust Y to center the rotated text in the gap
                                const gapCenter = (textTop + textBottom) / 2; // Center of the gap
                                // With align: 'left' and -90° rotation, adjust Y to center the text
                                const textY = gapCenter - (textWidth / 2); // Adjust for rotation alignment
                                doc.text(text, textX, textY, { 
                                    align: 'left',
                                    angle: -90
                                });
                                
                                // Add to placed labels
                                placedLabels.push({
                                    x: labelX - 10 * PX_TO_MM,
                                    y: labelY - textWidth / 2 - 4 * PX_TO_MM,
                                    width: 20 * PX_TO_MM,
                                    height: textWidth + 8 * PX_TO_MM,
                                    side: 'right', // Always right for vertical project dimensions
                                    text: text,
                                    angle: 90,
                                    type: 'project'
                                });
                            }
                            
                            doc.setTextColor(0, 0, 0);
                        };
                        
                        // Draw overall width dimension (top) - horizontal
                        drawProjectDimensionPDF(minX, minY, maxX, minY, 'horizontal');
                        
                        // Draw overall length dimension (right side) - vertical
                        drawProjectDimensionPDF(maxX, minY, maxX, maxY, 'vertical');
                    }
                    
                    // Draw individual wall dimensions (matching canvas drawDimensions logic EXACTLY)
                    if (wallsToDraw.length > 0 && wallModelBounds) {
                        // Wall dimension color: Blue (#2196F3) = RGB(33, 150, 243)
                        const wallColor = [33, 150, 243];
                        
                        // Draw dimension for each wall
                        wallsToDraw.forEach(wall => {
                            // Check if this wall should show dimensions (matching canvas line 1761)
                            if (!shouldShowWallDimension(wall, intersections, filteredDimensions.wallDimensions, wallsToDraw)) {
                                return; // Skip this wall - duplicate dimension
                            }
                            
                            const wallLength = Math.sqrt(
                                Math.pow(wall.end_x - wall.start_x, 2) + 
                                Math.pow(wall.end_y - wall.start_y, 2)
                            );
                            
                            if (wallLength === 0) return;
                            
                            // Value-level dedup: skip if this dimension value already shown (match canvas dimensionValuesSeen)
                            const roundedLength = Math.round(wallLength);
                            if (dimensionValuesSeen.has(roundedLength)) return;
                            dimensionValuesSeen.add(roundedLength);
                            
                            const wallMidX = (wall.start_x + wall.end_x) / 2;
                            const wallMidY = (wall.start_y + wall.end_y) / 2;
                            
                            // Font size calculation - EXACT same as canvas
                            const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scale;
                            let fontSize = calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN 
                                ? DIMENSION_CONFIG.FONT_SIZE_MIN 
                                : calculatedFontSize;
                            fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN);
                            
                            doc.setFontSize(fontSize);
                            doc.setFont(undefined, DIMENSION_CONFIG.FONT_WEIGHT);
                            
                            const text = `${Math.round(wallLength)}`;
                            const textWidth = doc.getTextWidth(text);
                            
                            const dx = wall.end_x - wall.start_x;
                            const dy = wall.end_y - wall.start_y;
                            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                            
                            const { minX, maxX, minY, maxY } = wallModelBounds;
                            
                            // Determine if dimension is "small" relative to project size
                            const projectWidth = (maxX - minX) || 1;
                            const projectHeight = (maxY - minY) || 1;
                            const projectSize = Math.max(projectWidth, projectHeight);
                            const isSmallDimension = wallLength < (projectSize * DIMENSION_CONFIG.SMALL_DIMENSION_THRESHOLD);
                            
                            // Use smaller offset for small dimensions (closer to wall), larger for big dimensions
                            // For PDF: reduce small dimension offset to place them closer to the wall
                            const baseOffsetPixels = isSmallDimension ? 
                                (DIMENSION_CONFIG.BASE_OFFSET_SMALL * 0.5) : // Reduce to 50% for closer placement
                                DIMENSION_CONFIG.BASE_OFFSET;
                            const baseOffset = baseOffsetPixels * PX_TO_MM;
                            const offsetIncrement = DIMENSION_CONFIG.OFFSET_INCREMENT * PX_TO_MM;
                            
                            if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
                                // Horizontal wall - smart placement
                                const placement = smartPlacement({
                                    calculatePositionSide1: (offset) => {
                                        if (isSmallDimension) {
                                            return {
                                                labelX: transformX(wallMidX),
                                                labelY: transformY(wallMidY) - offset
                                            };
                                        } else {
                                            return {
                                                labelX: transformX(wallMidX),
                                                labelY: transformY(minY) - offset
                                            };
                                        }
                                    },
                                    calculatePositionSide2: (offset) => {
                                        if (isSmallDimension) {
                                            return {
                                                labelX: transformX(wallMidX),
                                                labelY: transformY(wallMidY) + offset
                                            };
                                        } else {
                                            return {
                                                labelX: transformX(wallMidX),
                                                labelY: transformY(maxY) + offset
                                            };
                                        }
                                    },
                                    calculateBounds: (labelX, labelY, textWidth) => {
                                        return calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                    },
                                    textWidth: textWidth,
                                    placedLabels: placedLabels,
                                    baseOffset: baseOffset,
                                    offsetIncrement: offsetIncrement,
                                    maxAttempts: DIMENSION_CONFIG.MAX_ATTEMPTS,
                                    preferredSide: 'side1',
                                    lockedSide: null
                                });
                                
                                let labelX = placement.labelX;
                                let labelY = placement.labelY;
                                
                                // Additional check: ensure TEXT doesn't overlap with wall lines
                                // Note: Dimension lines CAN overlap wall lines - we only check if wall lines overlap the text
                                if (wallLinesMap) {
                                    let labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                    let hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                    let wallCheckAttempts = 0;
                                    const maxWallCheckAttempts = 10;
                                    const wallAvoidanceIncrement = 200 * scale; // Scale-aware increment
                                    
                                    while (hasWallOverlap && wallCheckAttempts < maxWallCheckAttempts) {
                                        // Increase offset gradually to move label away from wall
                                        if (placement.side === 'side1') {
                                            // Top side - move up
                                            labelY = labelY - wallAvoidanceIncrement;
                                        } else {
                                            // Bottom side - move down
                                            labelY = labelY + wallAvoidanceIncrement;
                                        }
                                        labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                        hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                        wallCheckAttempts++;
                                    }
                                }
                                
                                // Draw standard architectural dimensioning lines with gap for text
                                const textPadding = 2 * PX_TO_MM;
                                const textLeft = labelX - textWidth / 2 - textPadding;
                                const textRight = labelX + textWidth / 2 + textPadding;
                                
                                // Extension lines (dotted) - use larger dots for visibility
                                const dotSize = Math.max(0.3, 0.3 * scale); // Minimum 0.3mm dot size
                                const dotGap = Math.max(1.0, 1.0 * scale); // Gap between dots
                                const dotPattern = [dotSize, dotGap]; // Dotted pattern
                                doc.setLineDashPattern(dotPattern);
                                doc.setLineWidth(DIMENSION_CONFIG.LINE_WIDTH * PX_TO_MM);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                
                                // Extension line from start of wall
                                doc.line(transformX(wall.start_x), transformY(wall.start_y), transformX(wall.start_x), labelY);
                                // Extension line from end of wall
                                doc.line(transformX(wall.end_x), transformY(wall.end_y), transformX(wall.end_x), labelY);
                                
                                // Dimension line connecting the two extension lines (with gap for text) - also dotted
                                const startXScreen = transformX(wall.start_x);
                                const endXScreen = transformX(wall.end_x);
                                
                                // Ensure text is centered on the dimension line
                                const dimensionLineMidpoint = (startXScreen + endXScreen) / 2;
                                const centeredLabelX = dimensionLineMidpoint;
                                const centeredTextLeft = centeredLabelX - textWidth / 2 - textPadding;
                                const centeredTextRight = centeredLabelX + textWidth / 2 + textPadding;
                                
                                if (startXScreen < centeredTextLeft) {
                                    doc.line(startXScreen, labelY, centeredTextLeft, labelY);
                                }
                                if (endXScreen > centeredTextRight) {
                                    doc.line(centeredTextRight, labelY, endXScreen, labelY);
                                }
                                
                                doc.setLineDashPattern([]);
                                
                                // Draw text centered on dimension line
                                doc.setTextColor(wallColor[0], wallColor[1], wallColor[2]);
                                doc.text(text, centeredLabelX, labelY, { align: 'center' });
                                
                                // Add to placed labels
                                const labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                placedLabels.push({
                                    x: labelBounds.x,
                                    y: labelBounds.y,
                                    width: labelBounds.width,
                                    height: labelBounds.height,
                                    side: placement.side === 'side1' ? 'top' : 'bottom',
                                    text: text,
                                    angle: angle,
                                    type: 'wall'
                                });
                                
                            } else {
                                // Vertical wall - smart placement
                                // For PDF: reduce small dimension offset to place them closer to the wall
                                const minVerticalOffsetPixels = isSmallDimension ? 
                                    (DIMENSION_CONFIG.MIN_VERTICAL_OFFSET_SMALL * 0.5) : // Reduce to 50% for closer placement
                                    DIMENSION_CONFIG.MIN_VERTICAL_OFFSET;
                                const minVerticalOffset = minVerticalOffsetPixels * PX_TO_MM;
                                const baseVerticalOffset = Math.max(baseOffset, minVerticalOffset) * (isSmallDimension ? 1.0 : 1.5); // Less multiplier for small dimensions
                                
                                const placement = smartPlacement({
                                    calculatePositionSide1: (offset) => {
                                        if (isSmallDimension) {
                                            return {
                                                labelX: transformX(wallMidX) - offset,
                                                labelY: transformY(wallMidY)
                                            };
                                        } else {
                                            return {
                                                labelX: transformX(minX) - offset,
                                                labelY: transformY(wallMidY)
                                            };
                                        }
                                    },
                                    calculatePositionSide2: (offset) => {
                                        if (isSmallDimension) {
                                            return {
                                                labelX: transformX(wallMidX) + offset,
                                                labelY: transformY(wallMidY)
                                            };
                                        } else {
                                            return {
                                                labelX: transformX(maxX) + offset,
                                                labelY: transformY(wallMidY)
                                            };
                                        }
                                    },
                                    calculateBounds: (labelX, labelY, textWidth) => {
                                        return calculateVerticalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                    },
                                    textWidth: textWidth,
                                    placedLabels: placedLabels,
                                    baseOffset: baseVerticalOffset,
                                    offsetIncrement: offsetIncrement,
                                    maxAttempts: DIMENSION_CONFIG.MAX_ATTEMPTS,
                                    preferredSide: 'side2',
                                    lockedSide: null
                                });
                                
                                let labelX = placement.labelX;
                                let labelY = placement.labelY;
                                
                                // Additional check: ensure TEXT doesn't overlap with wall lines
                                // Note: Dimension lines CAN overlap wall lines - we only check if wall lines overlap the text
                                if (wallLinesMap) {
                                    let labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                    let hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                    let wallCheckAttempts = 0;
                                    const maxWallCheckAttempts = 10;
                                    const wallAvoidanceIncrement = 2 * scale; // Scale-aware increment
                                    
                                    while (hasWallOverlap && wallCheckAttempts < maxWallCheckAttempts) {
                                        // Increase offset gradually to move label away from wall
                                        if (placement.side === 'side1') {
                                            // Left side - move left
                                            labelX = labelX - wallAvoidanceIncrement;
                                        } else {
                                            // Right side - move right
                                            labelX = labelX + wallAvoidanceIncrement;
                                        }
                                        labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                        hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                        wallCheckAttempts++;
                                    }
                                }
                                
                                // Draw standard architectural dimensioning lines with gap for text
                                const textPadding = 2 * PX_TO_MM;
                                const textTop = labelY - textWidth / 2 - textPadding;
                                const textBottom = labelY + textWidth / 2 + textPadding;
                                
                                // Extension lines (dotted) - use larger dots for visibility
                                const dotSize = Math.max(0.3, 0.3 * scale); // Minimum 0.3mm dot size
                                const dotGap = Math.max(1.0, 1.0 * scale); // Gap between dots
                                const dotPattern = [dotSize, dotGap]; // Dotted pattern
                                doc.setLineDashPattern(dotPattern);
                                doc.setLineWidth(DIMENSION_CONFIG.LINE_WIDTH * PX_TO_MM);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                
                                // Extension line from start of wall
                                doc.line(transformX(wall.start_x), transformY(wall.start_y), labelX, transformY(wall.start_y));
                                // Extension line from end of wall
                                doc.line(transformX(wall.end_x), transformY(wall.end_y), labelX, transformY(wall.end_y));
                                
                                // Dimension line connecting the two extension lines (with gap for text) - also dotted
                                const startYScreen = transformY(wall.start_y);
                                const endYScreen = transformY(wall.end_y);
                                if (startYScreen < textTop) {
                                    doc.line(labelX, startYScreen, labelX, textTop);
                                }
                                if (endYScreen > textBottom) {
                                    doc.line(labelX, textBottom, labelX, endYScreen);
                                }
                                
                                doc.setLineDashPattern([]);
                                
                                // Draw vertical dimension text with rotation
                                // Position text CENTERED in the gap (matching project dimension)
                                doc.setTextColor(wallColor[0], wallColor[1], wallColor[2]);
                                // Position text to the left of the dimension line with small gap
                                const textGap = 2 * PX_TO_MM; // Gap between dimension line and text
                                const textX = labelX - textGap; // To the left of the line
                                // Position text Y at the center of the gap (centered vertically in the gap)
                                // Account for jsPDF rotation: with align: 'left' and angle: -90, text rotates around the point
                                // Adjust Y to center the rotated text in the gap (same as project dimension)
                                const gapCenter = (textTop + textBottom) / 2; // Center of the gap
                                // With align: 'left' and -90° rotation, adjust Y to center the text
                                const textY = gapCenter - (textWidth / 2); // Adjust for rotation alignment
                                doc.text(text, textX, textY, { 
                                    align: 'left',
                                    angle: -90
                                });
                                
                                // Add to placed labels
                                const labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
                                placedLabels.push({
                                    x: labelBounds.x,
                                    y: labelBounds.y,
                                    width: labelBounds.width,
                                    height: labelBounds.height,
                                    side: placement.side === 'side1' ? 'left' : 'right',
                                    text: text,
                                    angle: angle,
                                    type: 'wall'
                                });
                            }
                            
                            // Reset text color
                            doc.setTextColor(0, 0, 0);
                        });
                    }
                    // ===== END DIMENSION DRAWING =====
                    
                    // Add title at top (before drawing geometry)
                    doc.setFontSize(12);
                    doc.setFont(undefined, 'bold');
                    doc.setTextColor(0, 0, 0);
                    const title = storeyName ? `Wall Plan - ${storeyName}` : 'Wall Plan';
                    doc.text(title, planPageWidth / 2, planMargin + 8, { align: 'center' });
                    
                    // Add scale note at bottom
                    doc.setFontSize(8);
                    doc.setFont(undefined, 'normal');
                    doc.setTextColor(100, 100, 100);
                    // Scale: model units (mm) to PDF units (mm)
                    // If scale is 0.001, that means 1mm model = 0.001mm PDF, so 1:1000
                    // Scale ratio = model units per PDF unit = 1/scale
                    const scaleRatio = scale > 0 ? Math.round(1 / scale) : 0;
                    const scaleText = scaleRatio > 0 ? `Scale: 1:${scaleRatio}` : 'Scale: N/A';
                    doc.text(scaleText, planPageWidth - planMargin, planPageHeight - planMargin - 5, { align: 'right' });
                };
                
                // Helper function to calculate ghost walls and areas for a storey
                // EXACTLY matching useProjectDetails.js logic
                const calculateGhostDataForStorey = (activeStoreyId, targetStorey, allStoreys, allWalls, filteredRooms) => {
                    if (!activeStoreyId || !targetStorey) {
                        return { ghostWalls: [], ghostAreas: [] };
                    }
                    
                    const targetElevation = typeof targetStorey.elevation_mm === 'number'
                        ? targetStorey.elevation_mm
                        : Number(targetStorey.elevation_mm) || 0;
                    const defaultHeight = typeof targetStorey.default_room_height_mm === 'number'
                        ? targetStorey.default_room_height_mm
                        : Number(targetStorey.default_room_height_mm) || 0;
                    
                    // Calculate ghost walls - EXACT same logic as useProjectDetails
                    const ghostMap = new Map();
                    const normalizedWalls = Array.isArray(allWalls) ? allWalls : [];
                    const normalizedRooms = Array.isArray(filteredRooms) ? filteredRooms : [];
                    
                    normalizedRooms.forEach((room) => {
                        const roomWalls = Array.isArray(room.walls) ? room.walls : [];
                        const roomHeight = room.height !== undefined && room.height !== null
                            ? Number(room.height) || 0
                            : defaultHeight;
                        const requiredTop = targetElevation + roomHeight;
                        
                        roomWalls.forEach((wallId) => {
                            const wall = normalizedWalls.find((w) => String(w.id) === String(wallId));
                            if (!wall) {
                                return;
                            }
                            
                            if (String(wall.storey) === String(activeStoreyId)) {
                                return;
                            }
                            
                            const sharedCount = Array.isArray(wall.rooms) ? wall.rooms.length : 0;
                            if (sharedCount <= 1) {
                                return;
                            }
                            
                            const wallStorey = allStoreys.find(storey => String(storey.id) === String(wall.storey)) || null;
                            const wallBaseElevation = wallStorey && wallStorey.elevation_mm !== undefined
                                ? Number(wallStorey.elevation_mm) || 0
                                : 0;
                            const wallHeight = wall.height !== undefined && wall.height !== null
                                ? Number(wall.height) || 0
                                : 0;
                            const wallTop = wallBaseElevation + wallHeight;
                            
                            if (wallTop + 1e-3 < requiredTop) {
                                return;
                            }
                            
                            if (ghostMap.has(wall.id)) {
                                return;
                            }
                            
                            ghostMap.set(wall.id, {
                                id: `ghost-${wall.id}-${activeStoreyId}`,
                                originalWallId: wall.id,
                                storey: wall.storey,
                                start_x: wall.start_x,
                                start_y: wall.start_y,
                                end_x: wall.end_x,
                                end_y: wall.end_y,
                                thickness: wall.thickness,
                                height: wall.height,
                            });
                        });
                    });
                    
                    const ghostWalls = Array.from(ghostMap.values());
                    
                    // Calculate ghost areas - EXACT same logic as useProjectDetails
                    const sortedStoreys = [...allStoreys].sort((a, b) => {
                        const orderDiff = (a.order ?? 0) - (b.order ?? 0);
                        if (orderDiff !== 0) return orderDiff;
                        const elevationDiff = (Number(a.elevation_mm) || 0) - (Number(b.elevation_mm) || 0);
                        if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
                        return (a.id ?? 0) - (b.id ?? 0);
                    });
                    
                    const activeIndex = sortedStoreys.findIndex(
                        (storey) => String(storey.id) === String(activeStoreyId)
                    );
                    
                    let ghostAreas = [];
                    if (activeIndex > 0) {
                        // Check if there are walls on the current storey (even if no rooms)
                        const hasWallsOnCurrentStorey = normalizedWalls.some(
                            (wall) => String(wall.storey) === String(activeStoreyId)
                        );
                        
                        // Build a list of active rooms with their polygons and base elevations
                        const activeRooms = [];
                        normalizedRooms.forEach((room) => {
                            if (!Array.isArray(room.room_points) || room.room_points.length < 3) {
                                return;
                            }
                            const normalizedPoints = room.room_points.map((point) => ({
                                x: Number(point.x) || 0,
                                y: Number(point.y) || 0,
                            }));
                            
                            // Get base elevation - use explicit value if set, otherwise use storey elevation
                            let roomBaseElevation = targetElevation;
                            if (room.base_elevation_mm !== undefined && room.base_elevation_mm !== null) {
                                const parsed = Number(room.base_elevation_mm);
                                if (!isNaN(parsed)) {
                                    roomBaseElevation = parsed;
                                }
                            }
                            
                            activeRooms.push({
                                points: normalizedPoints,
                                baseElevation: roomBaseElevation,
                                signature: JSON.stringify(normalizedPoints.map(p => [p.x, p.y]))
                            });
                        });
                        
                        // Build a set of active room signatures for quick exact match lookup
                        const activeRoomSignatures = new Set(activeRooms.map(r => r.signature));
                        const occupiedSignatures = new Set(activeRoomSignatures);
                        const descendingStoreys = sortedStoreys.slice(0, activeIndex).reverse();
                        const allNormalizedRooms = Array.isArray(rooms) ? rooms : [];
                        
                        descendingStoreys.forEach((storey) => {
                            const storeyRooms = allNormalizedRooms.filter(
                                (room) => String(room.storey) === String(storey.id)
                            );
                            
                            storeyRooms.forEach((room) => {
                                if (!Array.isArray(room.room_points) || room.room_points.length < 3) {
                                    return;
                                }
                                
                                const normalizedPoints = room.room_points.map((point) => ({
                                    x: Number(point.x) || 0,
                                    y: Number(point.y) || 0,
                                }));
                                const signature = JSON.stringify(normalizedPoints.map(p => [p.x, p.y]));
                                
                                // Skip if exact signature match (same location)
                                if (occupiedSignatures.has(signature)) {
                                    return;
                                }
                                
                                const baseElevation =
                                    room.base_elevation_mm !== undefined && room.base_elevation_mm !== null
                                        ? Number(room.base_elevation_mm) || 0
                                        : Number(storey.elevation_mm) || 0;
                                const roomHeight =
                                    room.height !== undefined && room.height !== null
                                        ? Number(room.height) || 0
                                        : Number(storey.default_room_height_mm) || 0;
                                const roomTop = baseElevation + roomHeight;
                                
                                // If the lower room doesn't extend above the current storey elevation, don't show ghost
                                if (roomTop + 1e-3 < targetElevation) {
                                    return;
                                }
                                
                                // If there are walls on the current storey but no rooms, treat the storey elevation as the floor
                                if (hasWallsOnCurrentStorey && activeRooms.length === 0) {
                                    if (roomTop <= targetElevation + 1e-3) {
                                        return;
                                    }
                                }
                                
                                // Check if there's an active room that overlaps with this lower room
                                // and has a base elevation that's at or above the lower room's top
                                let shouldHideGhost = false;
                                for (const activeRoom of activeRooms) {
                                    // Check if polygons overlap - use EXACT same function as canvas
                                    if (doPolygonsOverlap(normalizedPoints, activeRoom.points)) {
                                        // If the active room's base is at or above the lower room's top, don't show ghost
                                        // This means the active room's floor is at or above the lower room's ceiling
                                        if (activeRoom.baseElevation >= roomTop - 1e-3) {
                                            shouldHideGhost = true;
                                            break;
                                        }
                                    }
                                }
                                
                                if (shouldHideGhost) {
                                    return;
                                }
                                
                                occupiedSignatures.add(signature);
                                ghostAreas.push({
                                    id: `ghost-area-${room.id}-${activeStoreyId}`,
                                    sourceRoomId: room.id,
                                    room_name: room.room_name,
                                    room_points: room.room_points,
                                    storey: room.storey,
                                    source_storey_name: storey.name,
                                });
                            });
                        });
                    }
                    
                    return { ghostWalls, ghostAreas };
                };
                
                // Helper function to calculate ghost walls and areas for a storey (matching useProjectDetails logic)
                
                // Fetch intersections data for proper wall drawing (joints, 45° cuts, etc.)
                let intersections = [];
                try {
                    const intersectionsResponse = await api.get(`/intersections/?projectid=${projectId}`);
                    const apiIntersections = intersectionsResponse.data || [];
                    console.log('API Intersections fetched:', apiIntersections.length, apiIntersections);
                    
                    // Calculate geometric intersections
                    const calculatedIntersections = findIntersectionPointsBetweenWalls(wallsForVector);
                    console.log('Calculated intersections:', calculatedIntersections.length);
                    
                    // Merge API intersections (with joint info) with calculated intersections (with geometry)
                    // API intersections only have wall_1, wall_2, joining_method (no x, y coordinates)
                    // Match by wall IDs only, like Canvas2D does
                    const mergedIntersections = calculatedIntersections.map(inter => {
                        // For each pair in this intersection, find matching API intersection by wall IDs
                        const updatedPairs = inter.pairs.map(pair => {
                            const wall1Id = pair.wall1?.id;
                            const wall2Id = pair.wall2?.id;
                            
                            // Find matching API intersection by wall IDs only (check both orders)
                            // API intersections don't have x, y, so match by wall IDs only
                            const apiInter = apiIntersections.find(i => 
                                (i.wall_1 === wall1Id && i.wall_2 === wall2Id) ||
                                (i.wall_1 === wall2Id && i.wall_2 === wall1Id)
                            );
                            
                            if (apiInter) {
                                console.log(`Found API intersection for walls ${wall1Id}-${wall2Id}:`, apiInter.joining_method);
                            }
                            
                            return {
                                ...pair,
                                joining_method: apiInter?.joining_method || 'butt_in'
                            };
                        });
                        
                        // Set wall_1, wall_2, joining_method from the first pair
                        const firstPair = updatedPairs[0];
                        let wall_1 = firstPair?.wall1?.id;
                        let wall_2 = firstPair?.wall2?.id;
                        let joining_method = firstPair?.joining_method || 'butt_in';
                        
                        // Also try to find API intersection match by wall IDs for this pair
                        if (wall_1 && wall_2) {
                            const apiMatch = apiIntersections.find(i => 
                                (i.wall_1 === wall_1 && i.wall_2 === wall_2) ||
                                (i.wall_1 === wall_2 && i.wall_2 === wall_1)
                            );
                            if (apiMatch) {
                                joining_method = apiMatch.joining_method || 'butt_in';
                                console.log(`API match for intersection: walls ${wall_1}-${wall_2}, method: ${joining_method}`);
                            }
                        }
                        
                        return {
                            ...inter,
                            pairs: updatedPairs,
                            // Add direct wall_1, wall_2, joining_method for backward compatibility (used by drawWallCaps)
                            wall_1: wall_1,
                            wall_2: wall_2,
                            joining_method: joining_method
                        };
                    });
                    
                    intersections = mergedIntersections;
                    console.log('Merged intersections with joint data:', intersections.length, 'intersections found');
                    console.log('Sample intersection:', intersections[0]);
                } catch (intersectionErr) {
                    console.log('Intersections not available, calculating from walls:', intersectionErr);
                    intersections = findIntersectionPointsBetweenWalls(wallsForVector);
                }
                
                // Get default storey ID (first storey or lowest elevation)
                const defaultStoreyId = storeys && storeys.length > 0
                    ? storeys.sort((a, b) => {
                        const orderDiff = (a.order ?? 0) - (b.order ?? 0);
                        if (orderDiff !== 0) return orderDiff;
                        const elevationDiff = (Number(a.elevation_mm) || 0) - (Number(b.elevation_mm) || 0);
                        if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
                        return (a.id ?? 0) - (b.id ?? 0);
                    })[0]?.id
                    : null;
                
                // Draw vector plan for each storey if we have storey data
                // Use EXACT same logic as canvas (useProjectDetails.js)
                if (storeys && storeys.length > 0) {
                    for (const storey of storeys) {
                        const activeStoreyId = storey.id; // Simulate activeStoreyId for this storey
                        
                        // Use EXACT same matchesActiveStorey logic as canvas
                        const matchesActiveStorey = (storeyId) => {
                            if (!activeStoreyId) {
                                return true;
                            }
                            if (storeyId === null || storeyId === undefined) {
                                if (defaultStoreyId === null || defaultStoreyId === undefined) {
                                    return false;
                                }
                                return String(defaultStoreyId) === String(activeStoreyId);
                            }
                            return String(storeyId) === String(activeStoreyId);
                        };
                        
                        // Filter walls - EXACT same as canvas filteredWalls
                        const normalizedWalls = Array.isArray(wallsForVector) ? wallsForVector : [];
                        const storeyWalls = normalizedWalls.filter((wall) => matchesActiveStorey(wall.storey));
                        
                        // Filter rooms - EXACT same as canvas filteredRooms
                        const normalizedRooms = Array.isArray(rooms) ? rooms : [];
                        const storeyRooms = normalizedRooms.filter((room) => matchesActiveStorey(room.storey));
                        
                        // Filter doors - EXACT same as canvas filteredDoors
                        const wallStoreyMap = new Map(
                            normalizedWalls.map((wall) => [String(wall.id), wall.storey])
                        );
                        const normalizedDoors = Array.isArray(doors) ? doors : [];
                        const storeyDoors = normalizedDoors.filter((door) => {
                            const directStorey = door.storey ?? door.storey_id;
                            if (directStorey !== null && directStorey !== undefined) {
                                return matchesActiveStorey(directStorey);
                            }
                            const linkedWallId = door.linked_wall || door.wall || door.wall_id;
                            if (!linkedWallId) {
                                return matchesActiveStorey(null);
                            }
                            const wallStorey = wallStoreyMap.get(String(linkedWallId));
                            return matchesActiveStorey(wallStorey);
                        });
                        
                        // Calculate ghost walls and areas - EXACT same logic as canvas
                        const { ghostWalls, ghostAreas } = calculateGhostDataForStorey(
                            activeStoreyId, 
                            storey, 
                            storeys, 
                            normalizedWalls, 
                            storeyRooms
                        );
                        
                        // Draw if we have any walls (regular or ghost) or rooms or ghost areas
                        if (storeyWalls.length > 0 || ghostWalls.length > 0 || storeyRooms.length > 0 || ghostAreas.length > 0) {
                            drawVectorWallPlan(doc, storeyWalls, storeyRooms, storeyDoors, storey.name, ghostWalls, ghostAreas, storey.id, intersections, wallsForVector);
                        }
                    }
                } else {
                    // Draw single vector plan for all walls (no storey filtering, no ghost data)
                    drawVectorWallPlan(doc, wallsForVector, rooms, doors, null, [], [], null, intersections, wallsForVector);
                }
            }
            
            // Add Plan Images Section at the end
            // Note: Only plan images use the orientation and single plan per page settings
            if (exportData.planImages) {
                // Helper function to add a plan image with proper sizing
                const addPlanImage = async (imageData, planName) => {
                    if (!imageData) return;
                    
                    try {
                        // Get image dimensions to maintain aspect ratio
                        const img = new Image();
                        await new Promise((resolve, reject) => {
                            img.onload = resolve;
                            img.onerror = reject;
                            img.src = imageData;
                        });
                        
                        const imageAspectRatio = img.width / img.height;
                        
                        if (singlePlanPerPage) {
                            // Each plan takes a full page with selected orientation
                            // Note: jsPDF addPage signature is addPage(format, orientation)
                            doc.addPage('a4', planPageOrientation);
                            
                            // Recalculate page dimensions after adding the new page
                            const planPageWidth = doc.internal.pageSize.width;
                            const planPageHeight = doc.internal.pageSize.height;
                            const planMargin = 20;
                            // If fitToPage, use minimal margins (5mm), otherwise use standard margins (20mm)
                            const effectiveMargin = fitToPage ? 5 : planMargin;
                            const planContentWidth = planPageWidth - (2 * effectiveMargin);
                            const availableHeight = planPageHeight - (2 * effectiveMargin) - (fitToPage ? 0 : 30);
                            
                            console.log(`📄 Added ${planPageOrientation} page - Width: ${planPageWidth}mm, Height: ${planPageHeight}mm`);
                            
                            // Calculate image dimensions that fit within the page
                            // Account for rotation - rotated images need more space
                            const rad = planRotation * Math.PI / 180;
                            const cos = Math.abs(Math.cos(rad));
                            const sin = Math.abs(Math.sin(rad));
                            
                            // Calculate maximum image size that fits when rotated
                            // When rotated, the bounding box is larger than the original image
                            // If fitToPage is enabled, use the entire page dimensions (100%)
                            let maxWidth, maxHeight;
                            if (fitToPage) {
                                // Use the entire page dimensions (100% - no margin at all)
                                // Note: planPageWidth and planPageHeight are already correct for the selected orientation
                                maxWidth = planPageWidth;
                                maxHeight = planPageHeight;
                                console.log(`📏 fitToPage: Using full page dimensions - maxWidth=${maxWidth.toFixed(2)}mm, maxHeight=${maxHeight.toFixed(2)}mm for ${planPageOrientation} orientation`);
                            } else {
                                // Use content area with margins
                                maxWidth = planContentWidth * 0.9;
                                maxHeight = availableHeight * 0.85;
                            }
                            
                            // Calculate initial image dimensions based on aspect ratio
                            // Start with a reasonable base size, then scale to fit page
                            let imageWidth, imageHeight;
                            
                            // Use the original image aspect ratio to calculate base dimensions
                            // We'll scale these up to fill the page
                            const baseSize = 100; // Arbitrary base size, will be scaled
                            if (imageAspectRatio >= 1) {
                                // Image is wider than tall
                                imageWidth = baseSize;
                                imageHeight = baseSize / imageAspectRatio;
                            } else {
                                // Image is taller than wide
                                imageHeight = baseSize;
                                imageWidth = baseSize * imageAspectRatio;
                            }
                            
                            // Calculate bounding box size after rotation
                            let boundingWidth = imageWidth * cos + imageHeight * sin;
                            let boundingHeight = imageWidth * sin + imageHeight * cos;
                            
                            // Scale the image to fill the page
                            if (fitToPage) {
                                // Calculate scale factors for both dimensions
                                const scaleX = maxWidth / boundingWidth;
                                const scaleY = maxHeight / boundingHeight;
                                
                                // Use the LARGER scale to fill the page (will overflow one dimension, which we'll center)
                                // This ensures the image fills the entire page
                                const scale = Math.max(scaleX, scaleY);
                                
                                // Apply scale to image dimensions
                                imageWidth *= scale;
                                imageHeight *= scale;
                                
                                // Recalculate bounding box after scaling
                                boundingWidth = imageWidth * cos + imageHeight * sin;
                                boundingHeight = imageWidth * sin + imageHeight * cos;
                                
                                console.log(`📐 fitToPage: scale=${scale.toFixed(3)}, imageWidth=${imageWidth.toFixed(2)}mm, imageHeight=${imageHeight.toFixed(2)}mm, boundingWidth=${boundingWidth.toFixed(2)}mm, boundingHeight=${boundingHeight.toFixed(2)}mm`);
                            } else {
                                // Not fitToPage - scale down if needed with margin
                                if (boundingWidth > maxWidth || boundingHeight > maxHeight) {
                                    // Scale down to fit exactly
                                    const scaleX = maxWidth / boundingWidth;
                                    const scaleY = maxHeight / boundingHeight;
                                    const scale = Math.min(scaleX, scaleY) * 0.95; // 95% margin
                                    imageWidth *= scale;
                                    imageHeight *= scale;
                                    
                                    // Recalculate bounding box after scaling
                                    boundingWidth = imageWidth * cos + imageHeight * sin;
                                    boundingHeight = imageWidth * sin + imageHeight * cos;
                                }
                            }
                            
                            // Center the image (accounting for rotation bounding box)
                            // Use the already calculated bounding box dimensions
                            const finalBoundingWidth = boundingWidth;
                            const finalBoundingHeight = boundingHeight;
                            
                            // Position the image on the page - always center it
                            let imageLeftMargin, imageTopMargin;
                            if (fitToPage) {
                                // Center the scaled image on the full page
                                imageLeftMargin = (planPageWidth - finalBoundingWidth) / 2;
                                imageTopMargin = (planPageHeight - finalBoundingHeight) / 2;
                            } else {
                                // Center in content area with margins
                                imageLeftMargin = effectiveMargin + (planContentWidth - finalBoundingWidth) / 2;
                                imageTopMargin = effectiveMargin + (availableHeight - finalBoundingHeight) / 2;
                            }
                            yPos = imageTopMargin;
                            
                            // Debug logging for fitToPage
                            if (fitToPage) {
                                console.log(`🔍 FitToPage Debug:`, {
                                    pageWidth: planPageWidth,
                                    pageHeight: planPageHeight,
                                    maxWidth,
                                    maxHeight,
                                    imageWidth,
                                    imageHeight,
                                    boundingWidth: finalBoundingWidth,
                                    boundingHeight: finalBoundingHeight,
                                    imageLeftMargin,
                                    imageTopMargin,
                                    rotation: planRotation
                                });
                            }
                            
                            // Only add boundary box and label if fitToPage is false
                            if (!fitToPage) {
                                // Add white box background for image (use bounding box size)
                                doc.setFillColor(255, 255, 255);
                                doc.roundedRect(imageLeftMargin, yPos - 10, finalBoundingWidth, finalBoundingHeight + 12, 3, 3, 'F');
                                
                                // Add border around image
                                doc.setDrawColor(191, 219, 254); // blue-200
                                doc.setLineWidth(0.5);
                                doc.roundedRect(imageLeftMargin, yPos - 10, finalBoundingWidth, finalBoundingHeight + 12, 3, 3, 'S');
                                
                                // Add image label
                                doc.setFontSize(10);
                                doc.setFont(undefined, 'bold');
                                doc.setTextColor(55, 65, 81); // gray-800
                                doc.text(planName, imageLeftMargin + 3, yPos - 4);
                                
                                // Reset
                                doc.setTextColor(0, 0, 0);
                            }
                            
                            // Rotate and add image
                            if (planRotation !== 0) {
                                // Create a canvas to rotate the image
                                // Calculate proper scale factor from image pixels to PDF mm
                                // We want the image to fill finalBoundingWidth x finalBoundingHeight in PDF
                                const targetWidthMM = finalBoundingWidth;
                                const targetHeightMM = finalBoundingHeight;
                                
                                // Calculate scale: how many mm per pixel
                                const scaleFactorMMperPx = imageWidth / img.width;
                                
                                // Canvas should be large enough to hold the rotated image
                                // Use the image's natural pixel dimensions scaled appropriately
                                const canvasScale = 2; // Higher resolution for better quality
                                const canvasWidthPx = Math.ceil(targetWidthMM / scaleFactorMMperPx * canvasScale);
                                const canvasHeightPx = Math.ceil(targetHeightMM / scaleFactorMMperPx * canvasScale);
                                
                                // Calculate image size in pixels to fill the canvas when rotated
                                const imageDisplayWidthPx = Math.ceil(imageWidth / scaleFactorMMperPx * canvasScale);
                                const imageDisplayHeightPx = Math.ceil(imageHeight / scaleFactorMMperPx * canvasScale);
                                
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d');
                                canvas.width = canvasWidthPx;
                                canvas.height = canvasHeightPx;
                                
                                // Set white background (only if not fitToPage)
                                if (!fitToPage) {
                                    ctx.fillStyle = 'white';
                                    ctx.fillRect(0, 0, canvasWidthPx, canvasHeightPx);
                                }
                                
                                // Translate to center, rotate, then draw image
                                ctx.translate(canvasWidthPx / 2, canvasHeightPx / 2);
                                ctx.rotate(rad);
                                ctx.drawImage(img, -imageDisplayWidthPx / 2, -imageDisplayHeightPx / 2, imageDisplayWidthPx, imageDisplayHeightPx);
                                
                                // Convert canvas to image data
                                const rotatedImageData = canvas.toDataURL('image/png');
                                doc.addImage(rotatedImageData, 'PNG', imageLeftMargin, yPos, finalBoundingWidth, finalBoundingHeight);
                            } else {
                                // No rotation - use full dimensions when fitToPage, otherwise center
                                if (fitToPage) {
                                    // Fill the entire page - use calculated imageWidth and imageHeight
                                    // These should already fill one dimension completely
                                    doc.addImage(imageData, 'PNG', imageLeftMargin, yPos, imageWidth, imageHeight);
                                } else {
                                    // Center the image within the bounding box
                                    const offsetX = (finalBoundingWidth - imageWidth) / 2;
                                    const offsetY = (finalBoundingHeight - imageHeight) / 2;
                                    doc.addImage(imageData, 'PNG', imageLeftMargin + offsetX, yPos + offsetY, imageWidth, imageHeight);
                                }
                            }
                            console.log(`✅ ${planName} added to PDF (rotated ${planRotation}°, full page)`);
                        } else {
                            // Compact mode - add to current page (portrait)
                            checkNewPage();
                            
                            // Adjust aspect ratio if rotated (90 or 270 degrees swaps width/height)
                            const effectiveAspectRatio = (planRotation === 90 || planRotation === 270) 
                                ? 1 / imageAspectRatio 
                                : imageAspectRatio;
                            
                            // Compact size for multiple plans per page
                            let finalImageWidth = contentWidth * 1; // 75% of page width
                            let finalImageHeight = finalImageWidth / effectiveAspectRatio; // Maintain aspect ratio
                            
                            // Limit height for compact mode
                            if (finalImageHeight > 70) {
                                finalImageHeight = 70;
                                finalImageWidth = 70 * effectiveAspectRatio;
                            }
                            
                            const imageLeftMargin = margin + (contentWidth - finalImageWidth) / 2;
                            
                            // Add white box background for image
                            doc.setFillColor(255, 255, 255);
                            doc.roundedRect(imageLeftMargin, yPos, finalImageWidth, finalImageHeight + 12, 3, 3, 'F');
                            
                            // Add border around image
                            doc.setDrawColor(191, 219, 254); // blue-200
                            doc.setLineWidth(0.5);
                            doc.roundedRect(imageLeftMargin, yPos, finalImageWidth, finalImageHeight + 12, 3, 3, 'S');
                            
                            // Add image label inside the box
                            doc.setFontSize(10);
                            doc.setFont(undefined, 'bold');
                            doc.setTextColor(55, 65, 81); // gray-800
                            doc.text(planName, imageLeftMargin + 3, yPos + 6);
                            
                            // Reset
                            doc.setTextColor(0, 0, 0);
                            yPos += 10;
                            
                            // Rotate and add image
                            if (planRotation !== 0) {
                                // Create a canvas to rotate the image
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d');
                                
                                // Calculate canvas size to accommodate rotation
                                const rad = planRotation * Math.PI / 180;
                                const cos = Math.abs(Math.cos(rad));
                                const sin = Math.abs(Math.sin(rad));
                                const canvasWidth = (finalImageWidth - 4) * cos + (finalImageHeight - 8) * sin;
                                const canvasHeight = (finalImageWidth - 4) * sin + (finalImageHeight - 8) * cos;
                                
                                canvas.width = canvasWidth;
                                canvas.height = canvasHeight;
                                
                                // Translate to center, rotate, then draw image
                                ctx.translate(canvasWidth / 2, canvasHeight / 2);
                                ctx.rotate(rad);
                                ctx.drawImage(img, -(finalImageWidth - 4) / 2, -(finalImageHeight - 8) / 2, finalImageWidth - 4, finalImageHeight - 8);
                                
                                // Convert canvas to image data
                                const rotatedImageData = canvas.toDataURL('image/png');
                                doc.addImage(rotatedImageData, 'PNG', imageLeftMargin + 2, yPos, canvasWidth, canvasHeight);
                            } else {
                                doc.addImage(imageData, 'PNG', imageLeftMargin + 2, yPos, finalImageWidth - 4, finalImageHeight - 8);
                            }
                            yPos += finalImageHeight + 6;
                            console.log(`✅ ${planName} added to PDF (rotated ${planRotation}°, compact mode)`);
                        }
                    } catch (err) {
                        console.warn(`Failed to add ${planName} to PDF:`, err);
                        addText(`${planName}: (Unable to capture image)`, 10);
                        yPos += 10;
                    }
                };
                
                // Add ONLY ceiling and floor plans (remove captured 2D wall plan images; keep vector-drawn wall plan pages)
                // Wall plan images (screenshots from Canvas2D) are intentionally NOT added here anymore
                // so that the PDF shows only the vector wall plan drawn directly with jsPDF.
                
                // Add ceiling and floor plans
                await addPlanImage(exportData.planImages.ceilingPlan, 'Ceiling Plan');
                await addPlanImage(exportData.planImages.floorPlan, 'Floor Plan');
                
                if (!singlePlanPerPage) {
                    checkNewPage();
                }
            }
            
            // Generate and download the PDF
            // Format: "Project Name Project Summary.pdf" with proper capitalization
            const formatProjectName = (name) => {
                return name
                    .split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');
            };
            const filename = `${formatProjectName(exportData.projectInfo.name)} Project Summary.pdf`;
            doc.save(filename);
            
            // Show success message
            alert('PDF generated and downloaded successfully!');
            
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Error generating PDF. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                    <div className="space-y-3">
                        <div className="h-4 bg-gray-200 rounded w-full"></div>
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="text-center text-red-600">
                    <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <p className="text-lg font-semibold">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            {/* Header with Refresh and Export Buttons */}
            <div className="mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-2xl font-bold text-gray-900">
                        Project Summary & Installation Time Estimator
                    </h3>
                    
                    {/* Export Button */}
                    <button
                        onClick={prepareExportData}
                        disabled={isLoading || isCapturingImages}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 font-medium shadow-lg flex items-center disabled:opacity-50"
                    >
                        {isCapturingImages ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                                Capturing Images...
                            </>
                        ) : isLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                                Auto-Fetching Data...
                            </>
                        ) : (
                            <>
                                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Export Project Report
                            </>
                        )}
                    </button>
                </div>
                
                <p className="text-gray-600 mb-2">
                    Comprehensive project overview with installation time calculations
                </p>
                <p className="text-sm text-blue-600">
                    💡 Added new levels or walls? Use the green "Refresh Data" button below to update panel counts
                </p>
            </div>

            {/* Auto-Fetch Status and Controls */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <h4 className="font-medium text-blue-800">Materials & Data Management</h4>
                            <p className="text-sm text-blue-700 mt-1">
                                {sharedPanelData && (sharedPanelData.wallPanels || sharedPanelData.ceilingPanels || sharedPanelData.floorPanels) 
                                    ? '✅ Project data is loaded and ready for export'
                                    : '⏳ No project data found - click "Refresh Data" or "Fetch Data & Images"'
                                }
                            </p>
                            <p className="text-xs text-blue-600 mt-1">
                                🔄 Added new levels/walls? Click <strong>Refresh Data</strong> to reload all levels
                            </p>
                            {(!sharedPanelData?.wallPlanImage || !sharedPanelData?.ceilingPlanImage || !sharedPanelData?.floorPlanImage) && (
                                <p className="text-xs text-orange-700 mt-2 flex items-center">
                                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-1.964-1.333-2.732 0L3.732 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    💡 Tip: Click "Auto-Fetch Data & Images" button to automatically capture plan images for the PDF, or visit each tab manually
                                </p>
                            )}
                        </div>
                    </div>
                    
                    {/* Refresh and Auto-Fetch Buttons */}
                    <div className="flex gap-2">
                        {/* Refresh Data Button */}
                        <button
                            onClick={handleManualRefresh}
                            disabled={isLoading || isCapturingImages}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center font-medium"
                            title="Refresh all data from all levels/storeys"
                        >
                            {isLoading ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Refreshing...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Refresh Data
                                </>
                            )}
                        </button>

                        {/* Auto-Fetch Button */}
                        <button
                            onClick={() => triggerAutoFetch()}
                            disabled={isLoading || isCapturingImages}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center"
                        >
                            {isCapturingImages ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Capturing Images...
                                </>
                            ) : isLoading ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Loading Data...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Fetch Data & Images
                                </>
                            )}
                        </button>
                    </div>
                </div>
                
                {/* Data Status Indicators */}
                <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                        <span className={`w-2 h-2 rounded-full mr-2 ${sharedPanelData?.wallPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Wall Plan</span>
                    </div>
                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                        <span className={`w-2 h-2 rounded-full mr-2 ${sharedPanelData?.ceilingPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Ceiling Plan</span>
                    </div>
                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                        <span className={`w-2 h-2 rounded-full mr-2 ${sharedPanelData?.floorPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Floor Plan</span>
                    </div>
                </div>
            </div>

            {/* Project Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{rooms.length}</div>
                        <div className="text-sm text-blue-700">Rooms</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{walls.length}</div>
                        <div className="text-sm text-green-700">Walls</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{doors.length}</div>
                        <div className="text-sm text-purple-700">Doors</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">
                            {projectData ? `${Math.round(projectData.width / 1000)} × ${Math.round(projectData.length / 1000)}` : 'N/A'}
                        </div>
                        <div className="text-sm text-orange-700">Dimensions (m)</div>
                    </div>
                </div>
            </div>

            {/* Installation Rate Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-5">
                    <h4 className="font-semibold text-blue-800 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        Panels per Day
                    </h4>
                    <div className="flex items-center">
                        <input
                            type="number"
                            min="1"
                            value={panelsPerDay}
                            onChange={(e) => handleInputChange('panels', e.target.value)}
                            className="w-20 px-3 py-2 border border-blue-300 rounded-lg text-center font-bold text-blue-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <span className="ml-2 text-blue-700 font-medium">panels/day</span>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-5">
                    <h4 className="font-semibold text-green-800 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m5-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                        Doors per Day
                    </h4>
                    <div className="flex items-center">
                        <input
                            type="number"
                            min="1"
                            value={doorsPerDay}
                            onChange={(e) => handleInputChange('doors', e.target.value)}
                            className="w-20 px-3 py-2 border border-green-300 rounded-lg text-center font-bold text-green-900 focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                        <span className="ml-2 text-green-700 font-medium">doors/day</span>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-5">
                    <h4 className="font-semibold text-purple-800 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        Slabs per Day
                    </h4>
                    <div className="flex items-center">
                        <input
                            type="number"
                            min="1"
                            value={slabsPerDay}
                            onChange={(e) => handleInputChange('slabs', e.target.value)}
                            className="w-20 px-3 py-2 border border-purple-300 rounded-lg text-center font-bold text-purple-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                        <span className="ml-2 text-purple-700 font-medium">slabs/day</span>
                    </div>
                </div>
            </div>

            {/* Material Quantities Summary */}
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
                <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Project Material Quantities
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-3xl font-bold text-blue-600">{totalQuantities.panels}</div>
                            <div className="text-sm text-gray-600">Total Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                {totalQuantities.ceilingPanels > 0 && `${totalQuantities.ceilingPanels} ceiling`}
                                {totalQuantities.floorPanels > 0 && totalQuantities.ceilingPanels > 0 && ' + '}
                                {totalQuantities.floorPanels > 0 && `${totalQuantities.floorPanels} floor`}
                                {totalQuantities.wallPanelsCount > 0 && (totalQuantities.ceilingPanels > 0 || totalQuantities.floorPanels > 0) && ' + '}
                                {totalQuantities.wallPanelsCount > 0 && `${totalQuantities.wallPanelsCount} wall`}
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-3xl font-bold text-green-600">{totalQuantities.doors}</div>
                            <div className="text-sm text-gray-600">Total Doors</div>
                            <div className="text-xs text-gray-500 mt-1">From project data</div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-3xl font-bold text-purple-600">{totalQuantities.slabs}</div>
                            <div className="text-sm text-gray-600">Total Slabs</div>
                            <div className="text-xs text-gray-500 mt-1">From rooms with slab floors ({slabWidth}×{slabLength}mm)</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Detailed Panel Breakdown */}
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
                <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Panel Breakdown
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600">
                                {totalQuantities.ceilingPanels}
                            </div>
                            <div className="text-sm text-gray-600">Ceiling Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                {ceilingPlans.length > 0 ? `${ceilingPlans.length} plans` : 'No plans'}
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-green-600">
                                {totalQuantities.floorPanels}
                            </div>
                            <div className="text-sm text-gray-600">Floor Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                {floorPlans.length > 0 ? `${floorPlans.length} plans` : 'No plans'}
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-purple-600">
                                {totalQuantities.wallPanelsCount}
                            </div>
                            <div className="text-sm text-gray-600">Wall Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                {walls.length > 0 ? `${walls.length} walls` : 'No walls'}
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-indigo-600">
                                {totalQuantities.panels}
                            </div>
                            <div className="text-sm text-gray-600">Total Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                Combined count
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Panel Area by Thickness */}
            {panelAreaByThickness.length > 0 && (
                <div className="bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-200 rounded-lg p-6 mb-8">
                    <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        Panel Area by Thickness
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-300 bg-white rounded-lg overflow-hidden">
                            <thead className="bg-teal-100">
                                <tr>
                                    <th className="px-4 py-3 border border-gray-300 text-left text-sm font-semibold text-gray-800">
                                        Thickness (mm)
                                    </th>
                                    <th className="px-4 py-3 border border-gray-300 text-left text-sm font-semibold text-gray-800">
                                        Total Area (m²)
                                    </th>
                                    <th className="px-4 py-3 border border-gray-300 text-left text-sm font-semibold text-gray-800">
                                        Panel Count
                                    </th>
                                    <th className="px-4 py-3 border border-gray-300 text-left text-sm font-semibold text-gray-800">
                                        Breakdown
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {panelAreaByThickness.map((group, index) => (
                                    <tr key={group.thickness} className={index % 2 === 0 ? 'bg-white' : 'bg-teal-50'}>
                                        <td className="px-4 py-3 border border-gray-300 text-sm text-gray-900 font-medium">
                                            {group.thickness}mm
                                        </td>
                                        <td className="px-4 py-3 border border-gray-300 text-sm text-gray-900">
                                            {(group.area / 1000000).toFixed(2)} m²
                                        </td>
                                        <td className="px-4 py-3 border border-gray-300 text-sm text-gray-900">
                                            {group.count} panels
                                        </td>
                                        <td className="px-4 py-3 border border-gray-300 text-sm text-gray-600">
                                            {group.types.wall > 0 && (
                                                <span className="inline-block mr-2 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                                                    {group.types.wall} wall
                                                </span>
                                            )}
                                            {group.types.ceiling > 0 && (
                                                <span className="inline-block mr-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                                    {group.types.ceiling} ceiling
                                                </span>
                                            )}
                                            {group.types.floor > 0 && (
                                                <span className="inline-block mr-2 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                                                    {group.types.floor} floor
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-teal-100 font-semibold">
                                    <td className="px-4 py-3 border border-gray-300 text-sm text-gray-900">
                                        Total
                                    </td>
                                    <td className="px-4 py-3 border border-gray-300 text-sm text-gray-900">
                                        {(panelAreaByThickness.reduce((sum, g) => sum + g.area, 0) / 1000000).toFixed(2)} m²
                                    </td>
                                    <td className="px-4 py-3 border border-gray-300 text-sm text-gray-900">
                                        {panelAreaByThickness.reduce((sum, g) => sum + g.count, 0)} panels
                                    </td>
                                    <td className="px-4 py-3 border border-gray-300 text-sm text-gray-600">
                                        Total area across all thicknesses
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Installation Time Estimates */}
            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-6">
                <h4 className="font-semibold text-indigo-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Estimated Installation Time
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-indigo-200 text-center">
                        <div className="text-3xl font-bold text-indigo-600">{installationEstimates.days}</div>
                        <div className="text-sm text-gray-600">Working Days</div>
                        <div className="text-xs text-gray-500 mt-1">Including 20% buffer</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-indigo-200 text-center">
                        <div className="text-3xl font-bold text-indigo-600">{installationEstimates.weeks}</div>
                        <div className="text-sm text-gray-600">Working Weeks</div>
                        <div className="text-xs text-gray-500 mt-1">5 days per week</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-indigo-200 text-center">
                        <div className="text-3xl font-bold text-indigo-600">{installationEstimates.months}</div>
                        <div className="text-sm text-gray-600">Working Months</div>
                        <div className="text-xs text-gray-500 mt-1">22 days per month</div>
                    </div>
                </div>
                
                <div className="mt-4 p-3 bg-indigo-100 rounded-lg">
                    <p className="text-sm text-indigo-800">
                        <strong>Note:</strong> This estimate assumes sequential work (panels, doors, and slabs installed one after another) and includes a 20% buffer for coordination and unexpected issues. 
                        Actual installation time may vary based on site conditions, crew size, and other factors.
                    </p>
                </div>
            </div>

            {/* Room Details */}
            {rooms.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-6 mt-8">
                    <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                        </svg>
                        Room Details
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-300">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Room Name
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Floor Type
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Floor Thickness
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Height
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Area
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {rooms.map((room, index) => (
                                    <tr key={room.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                            {room.room_name}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_type || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_thickness || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.height ? `${room.height}mm` : 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.room_points && room.room_points.length > 0 
                                                ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                                                : 'N/A'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Export Preview Modal */}
            {showExportPreview && exportData && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-200">
                            <div className="flex justify-between items-center">
                                <h3 className="text-2xl font-bold text-gray-900">Export Preview</h3>
                                <button
                                    onClick={() => setShowExportPreview(false)}
                                    className="text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <p className="text-gray-600 mt-2">Preview of what will be exported to PDF</p>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Expand/Collapse All Button */}
                            <div className="flex justify-end mb-4">
                                <button
                                    onClick={() => {
                                        const allExpanded = Object.values(expandedTables).every(v => v);
                                        setExpandedTables({
                                            wallPanels: !allExpanded,
                                            ceilingPanels: !allExpanded,
                                            floorPanels: !allExpanded,
                                            rooms: !allExpanded,
                                            slabs: !allExpanded,
                                            doors: !allExpanded
                                        });
                                    }}
                                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm flex items-center"
                                >
                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                    </svg>
                                    {Object.values(expandedTables).every(v => v) ? 'Collapse All' : 'Expand All'}
                                </button>
                            </div>
                        
                            {/* Project Overview */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-semibold text-gray-800 mb-3">Project Overview</h4>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div><span className="font-medium">Project:</span> {exportData.projectInfo.name}</div>
                                    <div><span className="font-medium">Dimensions:</span> {exportData.projectInfo.dimensions}</div>
                                    <div><span className="font-medium">Rooms:</span> {exportData.projectInfo.rooms}</div>
                                    <div><span className="font-medium">Walls:</span> {exportData.projectInfo.walls}</div>
                                    <div><span className="font-medium">Doors:</span> {exportData.projectInfo.doors}</div>
                                </div>
                            </div>

                            {/* Room Details */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-semibold text-gray-800 mb-3">Room Details ({exportData.rooms?.length || 0})</h4>
                                {exportData.rooms && exportData.rooms.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Name
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Floor Type
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Floor Thickness (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Height (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Area (m²)
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {(expandedTables.rooms ? exportData.rooms : exportData.rooms.slice(0, 5)).map((room, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_name || 'Unnamed Room'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                                room.floor_type === 'slab' || room.floor_type === 'Slab'
                                                                    ? 'bg-yellow-100 text-yellow-800'
                                                    : 'bg-blue-100 text-blue-800'
                                            }`}>
                                                {room.floor_type || 'N/A'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_thickness || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.height || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.room_points && room.room_points.length > 0 
                                                ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                                                : 'N/A'}
                                        </td>
                                    </tr>
                                ))}
                                {exportData.rooms.length > 5 && (
                                    <tr 
                                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                                        onClick={() => toggleTableExpansion('rooms')}
                                    >
                                        <td colSpan="5" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
                                            {expandedTables.rooms ? (
                                                <>
                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                                    </svg>
                                                    Show less
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                    ... and {exportData.rooms.length - 5} more rooms (click to show all)
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center py-4 text-gray-500">
                        No room data available
                    </div>
                )}
            </div>

                            {/* Wall Panels */}
                            <div className="bg-blue-50 rounded-lg p-4">
                                <h4 className="font-semibold text-blue-800 mb-3">
                                    Wall Panels ({exportData.wallPanels.length})
                                </h4>
                                {exportData.wallPanels.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        No.
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Width (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Length (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Quantity
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Type
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Application
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Panel Thickness (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Finishing
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {(expandedTables.wallPanels ? exportData.wallPanels : exportData.wallPanels.slice(0, 5)).map((panel, index) => {
                                                    const intMat = panel.inner_face_material ?? 'PPGI';
                                                    const intThk = panel.inner_face_thickness ?? 0.5;
                                                    const extMat = panel.outer_face_material ?? 'PPGI';
                                                    const extThk = panel.outer_face_thickness ?? 0.5;
                                                    const finishing = (intMat === extMat && intThk === extThk)
                                                        ? `Both Side ${extThk}mm ${extMat}`
                                                        : `Ext: ${extThk}mm ${extMat}; Int: ${intThk}mm ${intMat}`;
                                                    return (
                                                        <tr key={index} className="hover:bg-gray-50">
                                                            <td className="px-4 py-2 border border-gray-300 text-center">{index + 1}</td>
                                                            <td className="px-4 py-2 border border-gray-300 text-center">{panel.width}</td>
                                                            <td className="px-4 py-2 border border-gray-300 text-center">{panel.length}</td>
                                                            <td className="px-4 py-2 border border-gray-300 text-center">{panel.quantity || 1}</td>
                                                            <td className="px-4 py-2 border border-gray-300 text-center">{panel.type || 'N/A'}</td>
                                                            <td className="px-4 py-2 border border-gray-300 text-center">{panel.application || 'N/A'}</td>
                                                            <td className="px-4 py-2 border border-gray-300 text-center">{panel.thickness || 'N/A'}</td>
                                                            <td className="px-4 py-2 border border-gray-300 text-left text-sm">{finishing}</td>
                                                        </tr>
                                                    );
                                                })}
                                                {exportData.wallPanels.length > 5 && (
                                                    <tr 
                                                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                                                        onClick={() => toggleTableExpansion('wallPanels')}
                                                    >
                                                        <td colSpan="8" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
                                                            {expandedTables.wallPanels ? (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                                                    </svg>
                                                                    Show less
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                    ... and {exportData.wallPanels.length - 5} more panels (click to show all)
                                                                </>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        No wall panels found. Calculate wall panels first.
                                    </div>
                                )}
                            </div>

                            {/* Ceiling Panels */}
                            <div className="bg-green-50 rounded-lg p-4">
                                <h4 className="font-semibold text-green-800 mb-3">
                                    Ceiling Panels ({exportData.ceilingPanels.length})
                                </h4>
                                {exportData.ceilingPanels.length > 0 ? (
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
                                                        Face Material
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {(expandedTables.ceilingPanels ? exportData.ceilingPanels : exportData.ceilingPanels.slice(0, 5)).map((panel, index) => {
                                                    const intMat = panel.inner_face_material ?? 'PPGI';
                                                    const intThk = panel.inner_face_thickness ?? 0.5;
                                                    const extMat = panel.outer_face_material ?? 'PPGI';
                                                    const extThk = panel.outer_face_thickness ?? 0.5;
                                                    const same = intMat === extMat && intThk === extThk;
                                                    const finishing = same
                                                        ? `Both Side ${extThk}mm ${extMat}`
                                                        : `INT: ${intThk}mm ${intMat} / EXT: ${extThk}mm ${extMat}`;
                                                    return (
                                                        <tr key={index} className="hover:bg-gray-50">
                                                            <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                                {panel.width || 'N/A'}
                                                            </td>
                                                            <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                                {panel.length || 'N/A'}
                                                            </td>
                                                            <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                                {panel.thickness || 'N/A'}
                                                            </td>
                                                            <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                                                {panel.quantity || 1}
                                                            </td>
                                                            <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 whitespace-nowrap">
                                                                {finishing}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                                {exportData.ceilingPanels.length > 5 && (
                                                    <tr 
                                                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                                                        onClick={() => toggleTableExpansion('ceilingPanels')}
                                                    >
                                                        <td colSpan="4" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
                                                            {expandedTables.ceilingPanels ? (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                                                    </svg>
                                                                    Show less
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                    ... and {exportData.ceilingPanels.length - 5} more panels (click to show all)
                                                                </>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        No ceiling panels found. Generate a ceiling plan first.
                                    </div>
                                )}
                            </div>

                            {/* Floor Panels */}
                            <div className="bg-purple-50 rounded-lg p-4">
                                <h4 className="font-semibold text-purple-800 mb-3">
                                    Floor Panels ({exportData.floorPanels.length})
                                </h4>
                                {exportData.floorPanels.length > 0 ? (
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
                                                {(expandedTables.floorPanels ? exportData.floorPanels : exportData.floorPanels.slice(0, 5)).map((panel, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.width || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.length || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.thickness || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                                            {panel.quantity || 1}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-center text-gray-900">
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                                panel.type === 'Full' 
                                                                    ? 'bg-green-100 text-green-800' 
                                                                    : 'bg-red-100 text-red-800'
                                                            }`}>
                                                                {panel.type || 'N/A'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {exportData.floorPanels.length > 5 && (
                                                    <tr 
                                                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                                                        onClick={() => toggleTableExpansion('floorPanels')}
                                                    >
                                                        <td colSpan="5" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
                                                            {expandedTables.floorPanels ? (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                                                    </svg>
                                                                    Show less
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                    ... and {exportData.floorPanels.length - 5} more panels (click to show all)
                                                                </>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        No floor panels found. Generate a floor plan first.
                                    </div>
                                )}
                            </div>

                            {/* Slab Panels */}
                            {exportData.slabs.length > 0 && (
                                <div className="bg-yellow-50 rounded-lg p-4">
                                    <h4 className="font-semibold text-yellow-800 mb-3">Slab Floors ({exportData.slabs.length})</h4>
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
                                                {(expandedTables.slabs ? exportData.slabs : exportData.slabs.slice(0, 5)).map((room, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_name}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_points && room.room_points.length > 0 
                                                                ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                                                                : 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {slabWidth} × {slabLength}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_points && room.room_points.length > 0 
                                                                ? Math.ceil(calculateRoomArea(room.room_points) / (slabWidth * slabLength))
                                                                : 'N/A'}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {exportData.slabs.length > 5 && (
                                                    <tr 
                                                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                                                        onClick={() => toggleTableExpansion('slabs')}
                                                    >
                                                        <td colSpan="4" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
                                                            {expandedTables.slabs ? (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                                                    </svg>
                                                                    Show less
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                    ... and {exportData.slabs.length - 5} more rooms (click to show all)
                                                                </>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Doors List */}
                            {exportData.doors.length > 0 && (
                                <div className="bg-indigo-50 rounded-lg p-4">
                                    <h4 className="font-semibold text-indigo-800 mb-3">
                                        Doors ({exportData.doors.length})
                                    </h4>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Door Type
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Width (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Height (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Thickness (mm)
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {(expandedTables.doors ? exportData.doors : exportData.doors.slice(0, 5)).map((door, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.door_type || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.width || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.height || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.thickness || 'N/A'}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {exportData.doors.length > 5 && (
                                                    <tr 
                                                        className="hover:bg-blue-50 cursor-pointer transition-colors"
                                                        onClick={() => toggleTableExpansion('doors')}
                                                    >
                                                        <td colSpan="4" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
                                                            {expandedTables.doors ? (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                                                    </svg>
                                                                    Show less
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                    ... and {exportData.doors.length - 5} more doors (click to show all)
                                                                </>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                                        {/* Support Accessories */}
            <div className="bg-orange-50 rounded-lg p-4">
                <h4 className="font-semibold text-orange-800 mb-3">Support Accessories</h4>
                {exportData.supportAccessories.isNeeded ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-300">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Property
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Value
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-900">
                                        Support Type
                                    </td>
                                    <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                                            exportData.supportAccessories.type === 'nylon' 
                                                ? 'bg-blue-100 text-blue-800' 
                                                : 'bg-green-100 text-green-800'
                                        }`}>
                                            {exportData.supportAccessories.type === 'nylon' ? 'Nylon Hanger' : 'Alu Suspension'}
                                        </span>
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-900">
                                        Include Accessories
                                    </td>
                                    <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                        <span className={`px-4 py-1 rounded text-xs font-medium ${
                                            exportData.supportAccessories.includeAccessories 
                                                ? 'bg-green-100 text-green-800' 
                                                : 'bg-red-100 text-red-800'
                                        }`}>
                                            {exportData.supportAccessories.includeAccessories ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-900">
                                        Include Cable
                                    </td>
                                    <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                        <span className={`px-4 py-1 rounded text-xs font-medium ${
                                            exportData.supportAccessories.includeCable 
                                                ? 'bg-green-100 text-green-800' 
                                                : 'bg-red-100 text-red-800'
                                        }`}>
                                            {exportData.supportAccessories.includeCable ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center py-6">
                        <div className="text-lg font-medium text-orange-700 mb-2">Not needed in this project</div>
                        <div className="text-sm text-orange-600">All ceiling panels are under 6000mm length</div>
                        <div className="mt-3 p-3 bg-orange-100 rounded-lg">
                            <div className="text-xs text-orange-800">
                                <strong>Note:</strong> Support accessories are only required when ceiling panels exceed 6000mm in length. 
                                For shorter panels, standard installation methods are sufficient.
                            </div>
                        </div>
                    </div>
                )}
            </div>

                            {/* Installation Estimates */}
                            <div className="bg-indigo-50 rounded-lg p-4">
                                <h4 className="font-semibold text-indigo-800 mb-3">Installation Time Estimates</h4>
                                <div className="grid grid-cols-3 gap-4 text-center">
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200">
                                        <div className="text-2xl font-bold text-indigo-600">{exportData.installationEstimates.days}</div>
                                        <div className="text-sm text-gray-600">Working Days</div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200">
                                        <div className="text-2xl font-bold text-indigo-600">{exportData.installationEstimates.weeks}</div>
                                        <div className="text-sm text-gray-600">Working Weeks</div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200">
                                        <div className="text-2xl font-bold text-indigo-600">{exportData.installationEstimates.months}</div>
                                        <div className="text-sm text-gray-600">Working Months</div>
                                    </div>
                                </div>
                            </div>

                            {/* Auto-Fetch Status - Moved to end */}
                            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                                <h4 className="font-semibold text-green-800 mb-3">🔄 Auto-Fetch Status</h4>
                                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                                        <span className={`w-3 h-3 rounded-full mr-2 ${sharedPanelData?.wallPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                        <span>Wall Plan</span>
                                    </div>
                                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                                        <span className={`w-3 h-3 rounded-full mr-2 ${sharedPanelData?.ceilingPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                        <span>Ceiling Plan</span>
                                    </div>
                                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                                        <span className={`w-3 h-3 rounded-full mr-2 ${sharedPanelData?.floorPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                        <span>Floor Plan</span>
                                    </div>
                                </div>
                                
                                <div className="text-sm text-green-700 mb-3">
                                    {sharedPanelData?.wallPanels || sharedPanelData?.ceilingPanels || sharedPanelData?.floorPanels ? 
                                        '✅ Data auto-fetched from existing plans' : 
                                        '⏳ No existing plans found - manual generation required'
                                    }
                                </div>
                                
                                <div className="text-xs text-green-600">
                                    <p className="font-medium mb-1">If tables are empty, make sure to:</p>
                                    <ul className="list-disc list-inside space-y-1">
                                        <li>Calculate wall panels in the Wall Plan tab</li>
                                        <li>Generate ceiling plan in the Ceiling Plan tab</li>
                                        <li>Generate floor plan in the Floor Plan tab</li>
                                    </ul>
                                </div>
                            </div>

                            {/* Plan Images Preview - Moved to end */}
                            {exportData.planImages && (exportData.planImages.wallPlan || exportData.planImages.ceilingPlan || exportData.planImages.floorPlan) && (
                                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="font-semibold text-blue-800">📸 Captured Plan Views</h4>
                                    </div>
                                    <p className="text-sm text-blue-700 mb-4">These plan views will be included at the end of the PDF export:</p>
                                    
                                    <div className={`space-y-4 ${singlePlanPerPage ? '' : 'grid grid-cols-1 gap-4'}`}>
                                        {/* Wall Plan Preview */}
                                        {exportData.planImages.wallPlan && (
                                            <div className={`bg-white rounded-lg p-3 border border-blue-200 ${singlePlanPerPage ? 'w-full' : ''}`}>
                                                <h5 className="font-medium text-gray-800 mb-2 flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                    Wall Plan (2D View)
                                                </h5>
                                                <div 
                                                    className="rounded border border-gray-300 overflow-hidden"
                                                    style={{
                                                        maxHeight: singlePlanPerPage ? '400px' : '200px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        backgroundColor: '#f9fafb'
                                                    }}
                                                >
                                                    <img 
                                                        src={exportData.planImages.wallPlan} 
                                                        alt="Wall Plan" 
                                                        className={`rounded ${singlePlanPerPage ? 'max-h-full max-w-full' : 'max-h-[200px] w-auto'}`}
                                                        style={{ 
                                                            objectFit: 'contain',
                                                            transform: `rotate(${planRotation}deg)`
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Ceiling Plan Preview */}
                                        {exportData.planImages.ceilingPlan && (
                                            <div className={`bg-white rounded-lg p-3 border border-blue-200 ${singlePlanPerPage ? 'w-full' : ''}`}>
                                                <h5 className="font-medium text-gray-800 mb-2 flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                    </svg>
                                                    Ceiling Plan
                                                </h5>
                                                <div 
                                                    className="rounded border border-gray-300 overflow-hidden"
                                                    style={{
                                                        maxHeight: singlePlanPerPage ? '400px' : '200px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        backgroundColor: '#f9fafb'
                                                    }}
                                                >
                                                    <img 
                                                        src={exportData.planImages.ceilingPlan} 
                                                        alt="Ceiling Plan" 
                                                        className={`rounded ${singlePlanPerPage ? 'max-h-full max-w-full' : 'max-h-[200px] w-auto'}`}
                                                        style={{ 
                                                            objectFit: 'contain',
                                                            transform: `rotate(${planRotation}deg)`
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Floor Plan Preview */}
                                        {exportData.planImages.floorPlan && (
                                            <div className={`bg-white rounded-lg p-3 border border-blue-200 ${singlePlanPerPage ? 'w-full' : ''}`}>
                                                <h5 className="font-medium text-gray-800 mb-2 flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                    </svg>
                                                    Floor Plan
                                                </h5>
                                                <div 
                                                    className="rounded border border-gray-300 overflow-hidden"
                                                    style={{
                                                        maxHeight: singlePlanPerPage ? '400px' : '200px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        backgroundColor: '#f9fafb'
                                                    }}
                                                >
                                                    <img 
                                                        src={exportData.planImages.floorPlan} 
                                                        alt="Floor Plan" 
                                                        className={`rounded ${singlePlanPerPage ? 'max-h-full max-w-full' : 'max-h-[200px] w-auto'}`}
                                                        style={{ 
                                                            objectFit: 'contain',
                                                            transform: `rotate(${planRotation}deg)`
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {!exportData.planImages.wallPlan && !exportData.planImages.ceilingPlan && !exportData.planImages.floorPlan && (
                                        <div className="text-center py-4 text-gray-500">
                                            <p className="text-sm">⚠️ No plan views were captured. Make sure you have generated plans before exporting.</p>
                                        </div>
                                    )}
                                    
                                    {/* Plan Images Export Settings - Moved here */}
                                    <div className="mt-4 p-4 bg-white rounded-lg border border-blue-200">
                                        <h5 className="font-semibold text-gray-800 mb-3 flex items-center text-sm">
                                            <svg className="w-4 h-4 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                                            </svg>
                                            Plan Export Settings
                                        </h5>
                                        <p className="text-xs text-gray-600 mb-3">These settings only affect the plan images above, not the rest of the PDF content.</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {/* Fit to Page Toggle */}
                                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                <div>
                                                    <label className="text-sm font-medium text-gray-700">Fit to Page</label>
                                                    <p className="text-xs text-gray-500 mt-1">Remove boundary, fill page</p>
                                                </div>
                                                <button
                                                    onClick={() => setFitToPage(!fitToPage)}
                                                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center ${
                                                        fitToPage
                                                            ? 'bg-orange-600 text-white'
                                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                    }`}
                                                >
                                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        {fitToPage ? (
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                                        ) : (
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                                                        )}
                                                    </svg>
                                                    {fitToPage ? 'Fit' : 'Bordered'}
                                                </button>
                                            </div>
                                            
                                            {/* Page Orientation Toggle */}
                                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                <div>
                                                    <label className="text-sm font-medium text-gray-700">Page Orientation</label>
                                                    <p className="text-xs text-gray-500 mt-1">Portrait or landscape</p>
                                                </div>
                                                <button
                                                    onClick={() => setPlanPageOrientation(planPageOrientation === 'portrait' ? 'landscape' : 'portrait')}
                                                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center ${
                                                        planPageOrientation === 'landscape'
                                                            ? 'bg-purple-600 text-white'
                                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                    }`}
                                                >
                                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        {planPageOrientation === 'portrait' ? (
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                                        ) : (
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                        )}
                                                    </svg>
                                                    {planPageOrientation === 'portrait' ? 'Portrait' : 'Landscape'}
                                                </button>
                                            </div>
                                            
                                            {/* Single Plan Per Page Toggle */}
                                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                <div>
                                                    <label className="text-sm font-medium text-gray-700">Plan Layout</label>
                                                    <p className="text-xs text-gray-500 mt-1">One plan per page (full size) or compact</p>
                                                </div>
                                                <button
                                                    onClick={() => setSinglePlanPerPage(!singlePlanPerPage)}
                                                    className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center ${
                                                        singlePlanPerPage
                                                            ? 'bg-green-600 text-white'
                                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                    }`}
                                                >
                                                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        {singlePlanPerPage ? (
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                                        ) : (
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                                                        )}
                                                    </svg>
                                                    {singlePlanPerPage ? 'One per Page' : 'Compact'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-gray-200 bg-gray-50">
                            
                            <div className="flex justify-between items-center">
                                <p className="text-sm text-gray-600">
                                    This preview shows the data that will be exported. Plan images (without grids) will be included at the end of the PDF.
                                </p>
                                <div className="flex space-x-3">
                                    <button
                                        onClick={() => setShowExportPreview(false)}
                                        className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={generatePDF}
                                        disabled={isExporting || isCapturingImages}
                                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center"
                                    >
                                        {isCapturingImages ? (
                                            <>
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Capturing Images...
                                            </>
                                        ) : isExporting ? (
                                            <>
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Generating PDF...
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                                Generate & Download PDF
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InstallationTimeEstimator;