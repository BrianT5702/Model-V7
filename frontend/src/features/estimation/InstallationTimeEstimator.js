import React, { useState, useEffect, useMemo, useRef } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../api/api';
import PanelCalculator from '../panel/PanelCalculator';
import { getPanelFinishingLabel, sortMaterialPanels } from '../panel/wallPlanPanelUtils';
import { sortDoorsForMaterialList } from '../door/doorSortUtils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { calculatePolygonVisualCenter } from '../canvas/utils';
import {
    fetchProjectPanelLayoutForPdf,
    appendVectorCeilingAndFloorPlans,
    buildVectorCeilingFloorPreviewBlobs
} from './pdfVectorCeilingFloor';
import { buildRoomLabelLines } from '../room/roomLabelUtils';
import { sortRoomsByLevelThenName } from '../room/roomSortUtils';
import { buildWallElevations } from '../panel/wallElevationUtils';
import { renderElevationViewToDataURL } from '../panel/WallElevationViews';
import {
    drawVectorWallPlan,
    calculateGhostDataForStorey,
    fetchMergedWallIntersections,
    buildWallPlanPreviewPdfBlob
} from './pdfVectorWallPlan';

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
    const [planRotation] = useState(0); // Rotation angle in degrees (0, 90, 180, 270); setter unused — UI rotation disabled
    const [planPageOrientation, setPlanPageOrientation] = useState('portrait'); // 'portrait' or 'landscape' for plan pages
    const [singlePlanPerPage, setSinglePlanPerPage] = useState(true); // Each plan takes a full page
    const [fitToPage, setFitToPage] = useState(false); // Fit plan to fill entire page without boundary
    const [includeFrontElevation, setIncludeFrontElevation] = useState(false);
    const [includeSideElevation, setIncludeSideElevation] = useState(false);

    /** Embedded PDF viewer: fit page width so the plan is readable in the preview box (not tiny "whole page" fit). */
    const planPdfPreviewHash = 'toolbar=0&navpanes=0&scrollbar=0&view=FitH';
    const planPdfPreviewBoxStyle = {
        width: '100%',
        aspectRatio: planPageOrientation === 'landscape' ? '297 / 210' : '210 / 297',
        maxHeight: singlePlanPerPage ? 'min(72vh, 760px)' : 'min(40vh, 360px)',
        minHeight: singlePlanPerPage ? 360 : 220,
        backgroundColor: '#f9fafb'
    };

    /** Ceiling/floor iframe previews: same jsPDF vector pipeline as PDF export (object URLs). */
    const [vectorPlanPreview, setVectorPlanPreview] = useState({
        wallUrl: null,
        ceilingUrl: null,
        floorUrl: null,
        loading: false
    });
    const vectorPreviewUrlsRef = useRef({ wall: null, ceiling: null, floor: null });

    const defaultStoreyIdForVectorPreview = useMemo(() => {
        if (!storeys || storeys.length === 0) return null;
        const sorted = [...storeys].sort((a, b) => {
            const orderDiff = (a.order ?? 0) - (b.order ?? 0);
            if (orderDiff !== 0) return orderDiff;
            const elevationDiff = (Number(a.elevation_mm) || 0) - (Number(b.elevation_mm) || 0);
            if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
            return (a.id ?? 0) - (b.id ?? 0);
        });
        return sorted[0]?.id ?? null;
    }, [storeys]);

    useEffect(() => {
        if (!showExportPreview || !projectId) {
            if (vectorPreviewUrlsRef.current.wall) URL.revokeObjectURL(vectorPreviewUrlsRef.current.wall);
            if (vectorPreviewUrlsRef.current.ceiling) URL.revokeObjectURL(vectorPreviewUrlsRef.current.ceiling);
            if (vectorPreviewUrlsRef.current.floor) URL.revokeObjectURL(vectorPreviewUrlsRef.current.floor);
            vectorPreviewUrlsRef.current = { wall: null, ceiling: null, floor: null };
            setVectorPlanPreview({ wallUrl: null, ceilingUrl: null, floorUrl: null, loading: false });
            return;
        }

        let cancelled = false;
        setVectorPlanPreview((p) => ({ ...p, loading: true }));

        (async () => {
            try {
                const wallsForVector = allWalls && allWalls.length > 0 ? allWalls : walls;
                const [layout, wallBlob] = await Promise.all([
                    fetchProjectPanelLayoutForPdf(api, projectId),
                    buildWallPlanPreviewPdfBlob({
                        api,
                        projectId,
                        storeys,
                        rooms,
                        doors,
                        walls: wallsForVector,
                        planPageOrientation,
                        fitToPage
                    })
                ]);
                if (cancelled) return;
                const ceilingFloorIntersections = await fetchMergedWallIntersections(
                    api,
                    projectId,
                    wallsForVector
                );
                if (cancelled) return;
                const { ceilingBlob, floorBlob } = buildVectorCeilingFloorPreviewBlobs({
                    storeys,
                    rooms,
                    defaultStoreyId: defaultStoreyIdForVectorPreview,
                    ceilingPanels: layout.ceilingPanels,
                    floorPanels: layout.floorPanels,
                    zones: layout.zones,
                    ceilingPlans: layout.ceilingPlans,
                    floorPlans: layout.floorPlans,
                    planPageOrientation,
                    fitToPage,
                    walls: wallsForVector,
                    wallIntersections: ceilingFloorIntersections,
                    slabWidth,
                    slabLength
                });
                if (cancelled) return;

                const nextWall = wallBlob ? URL.createObjectURL(wallBlob) : null;
                const nextCeiling = ceilingBlob ? URL.createObjectURL(ceilingBlob) : null;
                const nextFloor = floorBlob ? URL.createObjectURL(floorBlob) : null;

                if (vectorPreviewUrlsRef.current.wall) URL.revokeObjectURL(vectorPreviewUrlsRef.current.wall);
                if (vectorPreviewUrlsRef.current.ceiling) URL.revokeObjectURL(vectorPreviewUrlsRef.current.ceiling);
                if (vectorPreviewUrlsRef.current.floor) URL.revokeObjectURL(vectorPreviewUrlsRef.current.floor);
                vectorPreviewUrlsRef.current = { wall: nextWall, ceiling: nextCeiling, floor: nextFloor };

                setVectorPlanPreview({
                    wallUrl: nextWall,
                    ceilingUrl: nextCeiling,
                    floorUrl: nextFloor,
                    loading: false
                });
            } catch (e) {
                if (!cancelled) {
                    console.warn('[Export preview] Vector plan preview failed:', e);
                    if (vectorPreviewUrlsRef.current.wall) URL.revokeObjectURL(vectorPreviewUrlsRef.current.wall);
                    if (vectorPreviewUrlsRef.current.ceiling) URL.revokeObjectURL(vectorPreviewUrlsRef.current.ceiling);
                    if (vectorPreviewUrlsRef.current.floor) URL.revokeObjectURL(vectorPreviewUrlsRef.current.floor);
                    vectorPreviewUrlsRef.current = { wall: null, ceiling: null, floor: null };
                    setVectorPlanPreview({ wallUrl: null, ceilingUrl: null, floorUrl: null, loading: false });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        showExportPreview,
        projectId,
        storeys,
        rooms,
        doors,
        walls,
        allWalls,
        planPageOrientation,
        fitToPage,
        defaultStoreyIdForVectorPreview,
        slabWidth,
        slabLength
    ]);
    
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

    const hasParentCoreData = Boolean(projectDataFromParent?.id);

    // Fetch project data (reuse parent state when opened from ProjectDetails)
    useEffect(() => {
        const fetchProjectData = async () => {
            try {
                setIsLoading(true);
                setError(null);

                let roomsList = [];

                if (hasParentCoreData) {
                    setProjectData(projectDataFromParent);
                    setStoreys(storeysFromParent || projectDataFromParent.storeys || []);
                    setRooms(roomsFromParent || []);
                    setWalls(wallsFromParent || []);
                    setDoors(doorsFromParent || []);
                    roomsList = roomsFromParent || [];
                } else {
                    const [
                        projectResponse,
                        storeysResponse,
                        roomsResponse,
                        wallsResponse,
                        doorsResponse,
                    ] = await Promise.all([
                        api.get(`/projects/${projectId}/`),
                        api.get(`/storeys/?project=${projectId}`),
                        api.get(`/rooms/?project=${projectId}`),
                        api.get(`/projects/${projectId}/walls/`),
                        api.get(`/doors/?project=${projectId}`),
                    ]);
                    setProjectData(projectResponse.data);
                    setStoreys(storeysResponse.data);
                    setRooms(roomsResponse.data);
                    setWalls(wallsResponse.data);
                    setDoors(doorsResponse.data);
                    roomsList = roomsResponse.data;
                }

                const [ceilingPlansResponse, floorPlansResponse] = await Promise.all([
                    api.get(`/ceiling-plans/?project=${projectId}`),
                    api.get(`/floor-plans/?project=${projectId}`),
                ]);
                setCeilingPlans(ceilingPlansResponse.data);
                setFloorPlans(floorPlansResponse.data);

                await autoFetchExistingPanelData(projectId, roomsList);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, hasParentCoreData]);

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

            const [
                projectResponse,
                storeysResponse,
                roomsResponse,
                ceilingPlansResponse,
                floorPlansResponse,
                wallsResponse,
                doorsResponse,
            ] = await Promise.all([
                api.get(`/projects/${projectId}/`),
                api.get(`/storeys/?project=${projectId}`),
                api.get(`/rooms/?project=${projectId}`),
                api.get(`/ceiling-plans/?project=${projectId}`),
                api.get(`/floor-plans/?project=${projectId}`),
                api.get(`/projects/${projectId}/walls/`),
                api.get(`/doors/?project=${projectId}`),
            ]);
            setProjectData(projectResponse.data);
            setStoreys(storeysResponse.data);
            setRooms(roomsResponse.data);
            setCeilingPlans(ceilingPlansResponse.data);
            setFloorPlans(floorPlansResponse.data);
            setWalls(wallsResponse.data);
            setDoors(doorsResponse.data);
            console.log(`✅ Refreshed walls: ${wallsResponse.data.length} walls loaded`);
            console.log(`✅ Refreshed doors: ${doorsResponse.data.length} doors loaded`);

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
                    
                    const lines = buildRoomLabelLines(room);
                    
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
            
            const [
                projectResponse,
                roomsResponse,
                ceilingPlansResponse,
                floorPlansResponse,
                wallsResponse,
                doorsResponse,
            ] = await Promise.all([
                api.get(`/projects/${projectId}/`),
                api.get(`/rooms/?project=${projectId}`),
                api.get(`/ceiling-plans/?project=${projectId}`),
                api.get(`/floor-plans/?project=${projectId}`),
                api.get(`/projects/${projectId}/walls/`),
                api.get(`/doors/?project=${projectId}`),
            ]);
            setProjectData(projectResponse.data);
            const rooms = roomsResponse.data;
            setRooms(rooms);
            setCeilingPlans(ceilingPlansResponse.data);
            setFloorPlans(floorPlansResponse.data);
            setWalls(wallsResponse.data);
            setDoors(doorsResponse.data);

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
                    const intersectionsResponse = await api.get(`/intersections/?project=${projectId}`);
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
                
                const ceilingPanelsResponse = await api.get(`/ceiling-panels/?project=${projectId}`);
                const allCeilingPanels = ceilingPanelsResponse.data;
                
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

            // Group panels by type, dimensions, application, panel thickness, and surface types
            const groupedPanelsForSharing = allPanels.reduce((acc, panel) => {
                const key = `${panel.type}-${panel.width}-${panel.length}-${panel.thickness || 'NA'}-${panel.application}-${panel.inner_face_material || 'PPGI'}-${panel.inner_face_thickness ?? 0.5}-${panel.outer_face_material || 'PPGI'}-${panel.outer_face_thickness ?? 0.5}`;
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

            return sortMaterialPanels(Object.values(groupedPanelsForSharing));
            
        } catch (error) {
            console.error('Error calculating actual wall panels:', error);
            return [];
        }
    };

    // Auto-fetch existing floor panel data
    const autoFetchFloorPanelData = async (projectId, rooms) => {
        try {
            // Check if floor plans exist
            if (floorPlans.length > 0) {
                console.log('🏠 Auto-fetching floor panel data from existing plans...');
                
                const floorPanelsResponse = await api.get(`/floor-panels/?project=${projectId}`);
                const allFloorPanels = floorPanelsResponse.data;
                
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

        // Convert to array and sort like wall plan material list
        return sortMaterialPanels(Array.from(panelsByDimension.values()));
    };

    // Helper function to process floor panels for sharing (similar to FloorManager)
    const processFloorPanelsForSharing = (panels, rooms) => {
        if (!panels || panels.length === 0) return [];

        const roomById = new Map((rooms || []).map((room) => [String(room.id), room]));
        const panelsByKey = new Map();

        panels.forEach(panel => {
            if (!panel) return;
            const roomId = panel.room_id || panel.room;
            const room = roomById.get(String(typeof roomId === 'object' ? roomId?.id : roomId));
            const floorThickness = room?.floor_thickness || 20;
            const isCut = !!(panel.is_cut_panel || panel.is_cut);
            const panelType = isCut ? 'Cut' : 'Full';
            const isVertical = panel.width >= panel.length;
            let displayWidth = panel.width;
            let displayLength = panel.length;
            if (isVertical) {
                displayWidth = panel.length;
                displayLength = panel.width;
            }

            const key = `${displayWidth}_${displayLength}_${floorThickness}_${panelType}`;
            if (!panelsByKey.has(key)) {
                panelsByKey.set(key, {
                    width: displayWidth,
                    length: displayLength,
                    thickness: floorThickness,
                    quantity: 0,
                    type: panelType
                });
            }
            panelsByKey.get(key).quantity += 1;
        });

        return sortMaterialPanels(Array.from(panelsByKey.values()));
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
        const enrichedWallPanels = sortMaterialPanels((sharedPanelData?.wallPanels || []).map(panel => {
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
        }));
        
        const sortedRooms = sortRoomsByLevelThenName(rooms, storeys);

        const data = {
            projectInfo: {
                name: projectData?.name || 'Unknown Project',
                dimensions: projectData ? `${Math.round(projectData.width / 1000)} × ${Math.round(projectData.length / 1000)} × ${Math.round(projectData.height / 1000)} m` : 'N/A',
                rooms: rooms.length,
                walls: walls.length,
                doors: doors.length
            },
            rooms: sortedRooms,
            wallPanels: enrichedWallPanels,
            ceilingPanels: sortMaterialPanels(sharedPanelData?.ceilingPanels || []),
            floorPanels: sortMaterialPanels(sharedPanelData?.floorPanels || []),
            wallPanelAnalysis: sharedPanelData?.wallPanelAnalysis || null,
            doors: sortDoorsForMaterialList(doors),
            slabs: sortedRooms.filter(room => room.floor_type === 'slab' || room.floor_type === 'Slab'),
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
            // Create PDF using the export orientation for the whole document
            const doc = new jsPDF({
                orientation: planPageOrientation === 'landscape' ? 'landscape' : 'portrait',
                unit: 'mm',
                format: 'a4'
            });
            
            let usedVectorCeiling = false;
            let usedVectorFloor = false;
            
            // Set initial position
            let yPos = 20;
            const isLandscapeLayout = planPageOrientation === 'landscape';
            const pageWidth = typeof doc.internal.pageSize.getWidth === 'function'
                ? doc.internal.pageSize.getWidth()
                : doc.internal.pageSize.width;
            const margin = isLandscapeLayout ? 12 : 20;
            const contentWidth = pageWidth - (2 * margin);
            const getPageBreakY = () => {
                const h = typeof doc.internal.pageSize.getHeight === 'function'
                    ? doc.internal.pageSize.getHeight()
                    : doc.internal.pageSize.height;
                // Tighter bottom margin in landscape so columns can fill the page
                return h - (isLandscapeLayout ? 10 : 25);
            };
            let pageBreakY = getPageBreakY();

            const addDocPage = () => {
                doc.addPage('a4', planPageOrientation === 'landscape' ? 'landscape' : 'portrait');
                yPos = 20;
                pageBreakY = getPageBreakY();
            };
            
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
                if (yPos > pageBreakY - 20) {
                    addDocPage();
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
                if (yPos > pageBreakY) {
                    addDocPage();
                }
            };

            const colGap = isLandscapeLayout ? 6 : 8;
            const dualColWidth = isLandscapeLayout ? (contentWidth - colGap) / 2 : contentWidth;
            const dualLeftX = margin;
            const dualRightX = margin + dualColWidth + colGap;
            const dualCols = { leftY: yPos, rightY: yPos };

            const syncDualYFromPage = () => {
                dualCols.leftY = yPos;
                dualCols.rightY = yPos;
            };

            // Always fill left column top→bottom, then right, then next page (left again).
            const pickDualColumn = (minNeededMm) => {
                pageBreakY = getPageBreakY();
                if (dualCols.leftY + minNeededMm <= pageBreakY) {
                    return {
                        side: 'left',
                        x: dualLeftX,
                        y: dualCols.leftY,
                        width: dualColWidth
                    };
                }
                if (dualCols.rightY + minNeededMm <= pageBreakY) {
                    return {
                        side: 'right',
                        x: dualRightX,
                        y: dualCols.rightY,
                        width: dualColWidth
                    };
                }
                addDocPage();
                dualCols.leftY = 20;
                dualCols.rightY = 20;
                return { side: 'left', x: dualLeftX, y: 20, width: dualColWidth };
            };

            const SECTION_GAP_MM = 8; // space after a finished section before the next banner

            const setDualColumnY = (side, nextY) => {
                if (side === 'left') dualCols.leftY = nextY;
                else dualCols.rightY = nextY;
                yPos = Math.max(dualCols.leftY, dualCols.rightY);
            };

            // Banner grows downward from startY (no upward overhang — that caused section overlap)
            const drawColumnSectionHeader = (title, color, bgColor, x, width, startY) => {
                const bannerH = 10;
                doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
                doc.roundedRect(x - 1, startY, width + 2, bannerH, 1.5, 1.5, 'F');
                doc.setTextColor(
                    Math.max(0, color[0] - 100),
                    Math.max(0, color[1] - 50),
                    Math.max(0, color[2] - 50)
                );
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.text(title, x + 2, startY + 7);
                doc.setTextColor(0, 0, 0);
                return startY + bannerH + 2;
            };

            /** Landscape: pack tables left→bottom, then right→bottom, then next page. */
            const drawPackedTableSection = (section) => {
                const {
                    title,
                    color = [66, 139, 202],
                    bgColor = [239, 246, 255],
                    subtitle = null,
                    head,
                    body,
                    columnStyles = {},
                    headFill,
                    altFill,
                    fontSize = 8,
                    theme = 'striped'
                } = section;
                if (!body || body.length === 0) return;

                const tableHeadH = 7;
                // Aggressive initial guess — real row height is learned after the first chunk
                let measuredRowH = Math.max(3.4, fontSize * 0.28 + 2.0);
                const minRemainToContinue = 18; // mm — keep filling column if more space than this

                const subtitleHeightFor = (width) => {
                    if (!subtitle) return 0;
                    doc.setFontSize(9);
                    return doc.splitTextToSize(subtitle, width).length * 4.0 + 1;
                };

                let rowIndex = 0;
                let firstChunk = true;
                let lastSide = null;
                let forceSide = null; // keep filling this column until it's truly full

                while (rowIndex < body.length) {
                    pageBreakY = getPageBreakY();
                    const includeSubtitle = firstChunk && Boolean(subtitle);

                    let slot;
                    if (forceSide === 'left' || forceSide === 'right') {
                        slot = {
                            side: forceSide,
                            x: forceSide === 'left' ? dualLeftX : dualRightX,
                            y: forceSide === 'left' ? dualCols.leftY : dualCols.rightY,
                            width: dualColWidth
                        };
                        // If forced side somehow has no room, clear force and pick normally
                        if (slot.y + tableHeadH + measuredRowH + 2 > pageBreakY) {
                            if (forceSide === 'left') dualCols.leftY = pageBreakY + 1;
                            else dualCols.rightY = pageBreakY + 1;
                            forceSide = null;
                            lastSide = null;
                            continue;
                        }
                    } else {
                        const bannerPad = firstChunk ? 13 + subtitleHeightFor(dualColWidth) : 0;
                        slot = pickDualColumn(tableHeadH + measuredRowH + 2 + bannerPad);
                    }

                    const showBanner =
                        firstChunk ||
                        slot.side !== lastSide ||
                        slot.y <= 22;

                    const bannerSpace = showBanner
                        ? 12 + (includeSubtitle ? subtitleHeightFor(slot.width) : 0)
                        : 0;

                    const availForRows = pageBreakY - slot.y - bannerSpace - tableHeadH - 2;
                    let maxRows = Math.floor(availForRows / measuredRowH);

                    if (maxRows < 1) {
                        if (slot.side === 'left') dualCols.leftY = pageBreakY + 1;
                        else dualCols.rightY = pageBreakY + 1;
                        forceSide = null;
                        lastSide = null;
                        continue;
                    }

                    maxRows = Math.min(maxRows, body.length - rowIndex);
                    const chunk = body.slice(rowIndex, rowIndex + maxRows);
                    if (chunk.length === 0) break;

                    let y = slot.y;
                    if (showBanner) {
                        const label = firstChunk ? title : `${title} (cont.)`;
                        y = drawColumnSectionHeader(label, color, bgColor, slot.x, slot.width, y);
                        if (includeSubtitle) {
                            doc.setFontSize(9);
                            doc.setFont(undefined, 'normal');
                            const subLines = doc.splitTextToSize(subtitle, slot.width);
                            doc.text(subLines, slot.x, y);
                            y += subLines.length * 4.0 + 1;
                        }
                    }

                    const tableStartY = y;
                    const pagesBefore = doc.internal.getNumberOfPages();
                    autoTable(doc, {
                        startY: y,
                        head: [head],
                        body: chunk,
                        theme,
                        styles: {
                            fontSize,
                            cellPadding: 1.0,
                            overflow: 'ellipsize'
                        },
                        headStyles: {
                            fillColor: headFill || color,
                            fontStyle: 'bold',
                            fontSize: Math.min(fontSize + 1, 9),
                            overflow: 'ellipsize'
                        },
                        alternateRowStyles: altFill ? { fillColor: altFill } : undefined,
                        margin: { left: slot.x, right: pageWidth - slot.x - slot.width },
                        tableWidth: slot.width,
                        columnStyles,
                        // Manual chunking owns pagination — never jump mid-chunk
                        pageBreak: 'avoid'
                    });

                    if (doc.internal.getNumberOfPages() > pagesBefore) {
                        // Chunk still didn't fit — cursors belong on the new page
                        pageBreakY = getPageBreakY();
                        dualCols.leftY = 20;
                        dualCols.rightY = 20;
                        lastSide = null;
                    }

                    const finalY = doc.lastAutoTable.finalY;
                    const drawnRows = chunk.length;
                    const bodyH = Math.max(0, finalY - tableStartY - tableHeadH);
                    if (drawnRows > 0 && bodyH > 0) {
                        measuredRowH = Math.max(3.2, bodyH / drawnRows);
                    }

                    rowIndex += drawnRows;
                    firstChunk = false;
                    lastSide = slot.side;

                    const remain = pageBreakY - finalY;
                    if (rowIndex < body.length && remain > minRemainToContinue) {
                        // Column still has usable space — stay here (fixes large empty bottoms)
                        forceSide = slot.side;
                        setDualColumnY(slot.side, finalY + 2);
                    } else if (rowIndex < body.length) {
                        // Column is full enough — move left→right→next page
                        forceSide = null;
                        if (slot.side === 'left') dualCols.leftY = pageBreakY + 1;
                        else dualCols.rightY = pageBreakY + 1;
                        lastSide = null;
                    } else {
                        // Section finished mid-column — leave cursor for the next section
                        forceSide = null;
                        setDualColumnY(slot.side, finalY + SECTION_GAP_MM);
                    }
                }
            };

            const drawFullWidthTableSection = (section) => {
                const {
                    title,
                    color = [66, 139, 202],
                    bgColor = [239, 246, 255],
                    subtitle = null,
                    head,
                    body,
                    columnStyles = {},
                    headFill,
                    altFill,
                    fontSize = 8,
                    theme = 'striped',
                    headHalign
                } = section;
                if (!body || body.length === 0) return;
                addSectionHeader(title, color, bgColor);
                if (subtitle) {
                    addText(subtitle, 11, false);
                    yPos += 3;
                }
                autoTable(doc, {
                    startY: yPos,
                    head: [head],
                    body,
                    theme,
                    styles: {
                        fontSize,
                        cellPadding: theme === 'grid' ? 3 : 2,
                        fontStyle: theme === 'grid' ? 'bold' : 'normal',
                        halign: headHalign || 'left'
                    },
                    headStyles: {
                        fillColor: headFill || color,
                        fontStyle: 'bold',
                        fontSize: fontSize + 1,
                        halign: headHalign || 'left'
                    },
                    alternateRowStyles: altFill ? { fillColor: altFill } : undefined,
                    margin: { left: margin, right: margin },
                    columnStyles
                });
                yPos = doc.lastAutoTable.finalY + 10;
                checkNewPage();
            };

            const drawTableSection = (section) => {
                if (isLandscapeLayout) drawPackedTableSection(section);
                else drawFullWidthTableSection(section);
            };
            
            // Project Overview - Simple text layout like preview (no table)
            addText('Project Overview', 11, true); // Simple header, no background
            yPos += 8;
            
            // Store starting position for both columns
            const startY = yPos;
            const leftColumnX = margin;
            const rightColumnX = isLandscapeLayout
                ? dualRightX
                : margin + contentWidth * 0.5;
            const lineHeight = 6; // Consistent line spacing
            
            doc.setFontSize(10);
            
            // Project name on its own full-width row so long names don't overlap dimensions
            const projectLines = doc.splitTextToSize(
                `Project: ${exportData.projectInfo.name}`,
                contentWidth
            );
            doc.text(projectLines, leftColumnX, startY);
            const columnStartY = startY + (projectLines.length * lineHeight);
            
            // Left column - Rooms and doors
            doc.text(`Rooms: ${exportData.projectInfo.rooms}`, leftColumnX, columnStartY);
            doc.text(`Doors: ${exportData.projectInfo.doors}`, leftColumnX, columnStartY + lineHeight);
            
            // Right column - Dimensions and walls
            doc.text(`Dimensions: ${exportData.projectInfo.dimensions}`, rightColumnX, columnStartY);
            doc.text(`Walls: ${exportData.projectInfo.walls}`, rightColumnX, columnStartY + lineHeight);
            
            yPos = columnStartY + (lineHeight * 2) + 8; // Space after the two-column layout
            if (isLandscapeLayout) syncDualYFromPage();
            checkNewPage();
            
            // Material Quantities Summary
            const totalWallPanels = exportData.wallPanels.reduce((sum, p) => sum + (p.quantity || 1), 0);
            const totalCeilingPanels = exportData.ceilingPanels.reduce((sum, p) => sum + (p.quantity || 1), 0);
            const totalFloorPanels = exportData.floorPanels.reduce((sum, p) => sum + (p.quantity || 1), 0);
            const totalPanels = totalWallPanels + totalCeilingPanels + totalFloorPanels;
            const slabAreaPdf = slabWidth * slabLength;
            const totalSlabsSummary = exportData.slabs.reduce((sum, room) => {
                if (room.room_points && room.room_points.length > 0 && slabAreaPdf > 0) {
                    return sum + Math.ceil(calculateRoomArea(room.room_points) / slabAreaPdf);
                }
                return sum;
            }, 0);
            
            drawTableSection({
                title: 'Material Quantities Summary',
                color: [55, 65, 81],
                bgColor: [249, 250, 251],
                headFill: [107, 114, 128],
                altFill: [249, 250, 251],
                fontSize: 9,
                head: ['Category', 'Quantity', 'Details'],
                body: [
                    ['Total Panels', totalPanels.toString(), `${totalWallPanels} wall + ${totalCeilingPanels} ceiling + ${totalFloorPanels} floor`],
                    ['Total Doors', exportData.doors.length.toString(), 'From project data'],
                    ['Total Slabs', totalSlabsSummary.toString(), `For rooms with slab floors (${slabWidth}×${slabLength}mm)`]
                ]
            });
            
            // Room Details
            if (exportData.rooms && exportData.rooms.length > 0) {
                drawTableSection({
                    title: 'Room Details',
                    color: [55, 65, 81],
                    bgColor: [249, 250, 251],
                    headFill: [107, 114, 128],
                    altFill: [249, 250, 251],
                    subtitle: `Total: ${exportData.rooms.length} rooms`,
                    fontSize: 8,
                    head: ['Level', 'Room Name', 'Floor Type', 'Floor Thickness (mm)', 'Height (mm)', 'Area (m²)'],
                    body: exportData.rooms.map(room => [
                        room.storey_name || 'Unassigned',
                        room.room_name || 'Unnamed Room',
                        room.floor_type || 'N/A',
                        room.floor_thickness || 'N/A',
                        room.height || 'N/A',
                        room.room_points && room.room_points.length > 0 
                            ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                            : 'N/A'
                    ])
                });
            }

            // Installation Time Estimates
            drawTableSection({
                title: 'Installation Time Estimates',
                color: [79, 70, 229],
                bgColor: [238, 242, 255],
                headFill: [79, 70, 229],
                fontSize: 10,
                theme: 'grid',
                headHalign: 'center',
                head: ['Working Days', 'Working Weeks', 'Working Months'],
                body: [[
                    exportData.installationEstimates.days.toString(),
                    exportData.installationEstimates.weeks.toString(),
                    exportData.installationEstimates.months.toString()
                ]]
            });

            // Force a new page for detailed panel/support tables
            addDocPage();
            if (isLandscapeLayout) {
                dualCols.leftY = 20;
                dualCols.rightY = 20;
            }
            
            // Wall Panels
            if (exportData.wallPanels && exportData.wallPanels.length > 0) {
                drawTableSection({
                    title: 'Wall Panels',
                    color: [59, 130, 246],
                    bgColor: [239, 246, 255],
                    headFill: [59, 130, 246],
                    altFill: [239, 246, 255],
                    subtitle: `Total: ${exportData.wallPanels.reduce((sum, p) => sum + (p.quantity || 1), 0)} panels`,
                    fontSize: 7,
                    head: ['No.', 'Width (mm)', 'Length (mm)', 'Qty', 'Type', 'Application', 'Thk (mm)', 'Finishing'],
                    body: exportData.wallPanels.map((panel, index) => {
                        const finishing = getPanelFinishingLabel(panel);
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
                    }),
                    columnStyles: {
                        4: { cellWidth: isLandscapeLayout ? 14 : 16 },
                        0: { cellWidth: 9 }
                    }
                });
            }
            
            // Ceiling Panels
            if (exportData.ceilingPanels && exportData.ceilingPanels.length > 0) {
                drawTableSection({
                    title: 'Ceiling Panels',
                    color: [22, 163, 74],
                    bgColor: [240, 253, 244],
                    headFill: [22, 163, 74],
                    altFill: [240, 253, 244],
                    subtitle: `Total: ${exportData.ceilingPanels.reduce((sum, p) => sum + (p.quantity || 1), 0)} panels`,
                    fontSize: 7,
                    head: ['Width', 'Length', 'Thk', 'Qty', 'Face'],
                    body: exportData.ceilingPanels.map(panel => {
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
                    }),
                    columnStyles: {
                        3: { cellWidth: 10 },
                        4: { cellWidth: isLandscapeLayout ? 36 : 40 }
                    }
                });
            }
            
            // Floor Panels
            if (exportData.floorPanels && exportData.floorPanels.length > 0) {
                drawTableSection({
                    title: 'Floor Panels',
                    color: [147, 51, 234],
                    bgColor: [250, 245, 255],
                    headFill: [147, 51, 234],
                    altFill: [250, 245, 255],
                    subtitle: `Total: ${exportData.floorPanels.reduce((sum, p) => sum + (p.quantity || 1), 0)} panels`,
                    fontSize: 8,
                    head: ['Width', 'Length', 'Thk', 'Qty', 'Type'],
                    body: exportData.floorPanels.map(panel => [
                        `${panel.width || 'N/A'}mm`,
                        `${panel.length || 'N/A'}mm`,
                        `${panel.thickness || 'N/A'}mm`,
                        panel.quantity ? panel.quantity.toString() : '1',
                        panel.type || 'N/A'
                    ]),
                    columnStyles: {
                        3: { cellWidth: 14 },
                        4: { cellWidth: 16 }
                    }
                });
            }
            
            // Slab Floors
            if (exportData.slabs && exportData.slabs.length > 0) {
                const slabArea = slabWidth * slabLength;
                const totalSlabs = exportData.slabs.reduce((sum, room) => {
                    if (room.room_points && room.room_points.length > 0 && slabArea > 0) {
                        return sum + Math.ceil(calculateRoomArea(room.room_points) / slabArea);
                    }
                    return sum;
                }, 0);
                drawTableSection({
                    title: 'Slab Floors',
                    color: [234, 179, 8],
                    bgColor: [254, 252, 232],
                    headFill: [234, 179, 8],
                    altFill: [254, 252, 232],
                    subtitle: `Total: ${totalSlabs} slabs needed`,
                    fontSize: 8,
                    head: ['Room Name', 'Area (m²)', 'Slab Size', 'Slabs'],
                    body: exportData.slabs.map(room => [
                        room.room_name || 'Unnamed Room',
                        room.room_points && room.room_points.length > 0 
                            ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                            : 'N/A',
                        `${slabWidth} × ${slabLength}mm`,
                        room.room_points && room.room_points.length > 0
                            ? Math.ceil(calculateRoomArea(room.room_points) / (slabWidth * slabLength)).toString()
                            : 'N/A'
                    ])
                });
            }
            
            // Doors
            if (exportData.doors && exportData.doors.length > 0) {
                drawTableSection({
                    title: 'Doors',
                    color: [79, 70, 229],
                    bgColor: [238, 242, 255],
                    headFill: [79, 70, 229],
                    altFill: [238, 242, 255],
                    subtitle: `Total: ${exportData.doors.length} doors`,
                    fontSize: 8,
                    head: ['Type', 'Width', 'Height', 'Thk'],
                    body: exportData.doors.map(door => [
                        door.door_type || 'N/A',
                        `${door.width || 'N/A'}mm`,
                        `${door.height || 'N/A'}mm`,
                        `${door.thickness || 'N/A'}mm`
                    ]),
                    columnStyles: {
                        0: { cellWidth: isLandscapeLayout ? 28 : 30 }
                    }
                });
            }
            
            // Support Accessories — omit section when not needed
            if (exportData.supportAccessories.isNeeded) {
                drawTableSection({
                    title: 'Support Accessories',
                    color: [234, 88, 12],
                    bgColor: [255, 247, 237],
                    headFill: [234, 88, 12],
                    altFill: [255, 247, 237],
                    fontSize: 9,
                    head: ['Property', 'Value'],
                    body: [
                        ['Support Type', exportData.supportAccessories.type === 'nylon' ? 'Nylon Hanger' : 'Alu Suspension'],
                        ['Include Accessories', exportData.supportAccessories.includeAccessories ? 'Yes' : 'No'],
                        ['Include Cable', exportData.supportAccessories.includeCable ? 'Yes' : 'No']
                    ]
                });
            }
            
            checkNewPage();
            
            // Add Vector-Based Wall Plan (AutoCAD-style, sharp at any zoom)
            // Use allWalls if available (more complete), otherwise use walls state
            const wallsForVector = (allWalls && allWalls.length > 0) ? allWalls : walls;
            let wallIntersectionsForPlans = [];
            if (wallsForVector && wallsForVector.length > 0) {
                const intersections = await fetchMergedWallIntersections(api, projectId, wallsForVector);
                wallIntersectionsForPlans = intersections;

                const defaultStoreyId = storeys && storeys.length > 0
                    ? storeys.sort((a, b) => {
                        const orderDiff = (a.order ?? 0) - (b.order ?? 0);
                        if (orderDiff !== 0) return orderDiff;
                        const elevationDiff = (Number(a.elevation_mm) || 0) - (Number(b.elevation_mm) || 0);
                        if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
                        return (a.id ?? 0) - (b.id ?? 0);
                    })[0]?.id
                    : null;

                if (storeys && storeys.length > 0) {
                    for (const storey of storeys) {
                        const activeStoreyId = storey.id;

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

                        const normalizedWalls = Array.isArray(wallsForVector) ? wallsForVector : [];
                        const storeyWalls = normalizedWalls.filter((wall) => matchesActiveStorey(wall.storey));

                        const normalizedRooms = Array.isArray(rooms) ? rooms : [];
                        const storeyRooms = normalizedRooms.filter((room) => matchesActiveStorey(room.storey));

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

                        const { ghostWalls, ghostAreas } = calculateGhostDataForStorey(
                            activeStoreyId,
                            storey,
                            storeys,
                            normalizedWalls,
                            storeyRooms,
                            normalizedRooms
                        );

                        if (storeyWalls.length > 0 || ghostWalls.length > 0 || storeyRooms.length > 0 || ghostAreas.length > 0) {
                            drawVectorWallPlan(
                                doc,
                                storeyWalls,
                                storeyRooms,
                                storeyDoors,
                                storey.name,
                                ghostWalls,
                                ghostAreas,
                                storey.id,
                                intersections,
                                wallsForVector,
                                planPageOrientation,
                                fitToPage,
                                false
                            );
                        }
                    }
                } else {
                    drawVectorWallPlan(
                        doc,
                        wallsForVector,
                        rooms,
                        doors,
                        null,
                        [],
                        [],
                        null,
                        intersections,
                        wallsForVector,
                        planPageOrientation,
                        fitToPage,
                        false
                    );
                }
            }

            // Vector ceiling & floor plans from API geometry (scalable; avoids canvas screenshot limits on large projects)
            if (projectId) {
                try {
                    const layout = await fetchProjectPanelLayoutForPdf(api, projectId);
                    const defaultStoreyIdForPdf =
                        storeys && storeys.length > 0
                            ? [...storeys].sort((a, b) => {
                                const orderDiff = (a.order ?? 0) - (b.order ?? 0);
                                if (orderDiff !== 0) return orderDiff;
                                const elevationDiff = (Number(a.elevation_mm) || 0) - (Number(b.elevation_mm) || 0);
                                if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
                                return (a.id ?? 0) - (b.id ?? 0);
                            })[0]?.id
                            : null;
                    const flags = appendVectorCeilingAndFloorPlans(doc, {
                        storeys,
                        rooms,
                        defaultStoreyId: defaultStoreyIdForPdf,
                        ceilingPanels: layout.ceilingPanels,
                        floorPanels: layout.floorPanels,
                        zones: layout.zones,
                        ceilingPlans: layout.ceilingPlans,
                        floorPlans: layout.floorPlans,
                        planPageOrientation,
                        fitToPage,
                        walls: wallsForVector,
                        wallIntersections: wallIntersectionsForPlans,
                        slabWidth,
                        slabLength
                    });
                    usedVectorCeiling = flags.usedVectorCeiling;
                    usedVectorFloor = flags.usedVectorFloor;
                    if (usedVectorCeiling || usedVectorFloor) {
                        console.log('[PDF] Vector plan pages from API geometry:', {
                            ceiling: usedVectorCeiling,
                            floor: usedVectorFloor
                        });
                    }
                } catch (layoutErr) {
                    console.warn('Vector ceiling/floor PDF pages skipped:', layoutErr);
                }
            }
            
            // Add Plan Images Section at the end
            // Raster fallback plans follow the same whole-document orientation
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
                
                // Raster fallback for ceiling/floor only when vector pages were not produced (no layout in API)
                // Wall plan images remain omitted; wall geometry is vector-drawn above.
                if (!usedVectorCeiling) {
                    await addPlanImage(exportData.planImages.ceilingPlan, 'Ceiling Plan');
                }
                if (!usedVectorFloor) {
                    await addPlanImage(exportData.planImages.floorPlan, 'Floor Plan');
                }
                
                if (!singlePlanPerPage) {
                    checkNewPage();
                }
            }

            // Optional whole-model elevations (user toggles in export preview)
            if (includeFrontElevation || includeSideElevation) {
                const wallsForElev = (allWalls && allWalls.length > 0) ? allWalls : walls;
                const elevations = buildWallElevations({
                    walls: wallsForElev,
                    allWalls: wallsForElev,
                    doors,
                    rooms,
                });

                const addElevationPage = (viewData, label) => {
                    if (!viewData || !viewData.faces || viewData.faces.length === 0) {
                        console.warn(`[PDF] Skipping ${label}: no faces to draw`);
                        return;
                    }
                    const dataUrl = renderElevationViewToDataURL(viewData, { width: 1800, maxDrawH: 1000 });
                    doc.addPage('a4', planPageOrientation);
                    const pageW = doc.internal.pageSize.getWidth();
                    const pageH = doc.internal.pageSize.getHeight();
                    const margin = fitToPage ? 8 : 16;
                    const maxW = pageW - margin * 2;
                    const maxH = pageH - margin * 2 - (fitToPage ? 0 : 14);

                    // Probe natural image size via temporary Image is async; use canvas aspect from data URL by decoding proportions from known draw
                    // jsPDF can take width/height; measure via Image sync isn't available — use proportional fit with getImageProperties
                    const props = doc.getImageProperties(dataUrl);
                    const imgAspect = props.width / props.height;
                    let drawW = maxW;
                    let drawH = drawW / imgAspect;
                    if (drawH > maxH) {
                        drawH = maxH;
                        drawW = drawH * imgAspect;
                    }
                    const x = (pageW - drawW) / 2;
                    const y = fitToPage ? (pageH - drawH) / 2 : margin + 12;
                    if (!fitToPage) {
                        doc.setFontSize(14);
                        doc.setTextColor(30, 64, 175);
                        doc.setFont('helvetica', 'bold');
                        doc.text(label, margin, margin + 6);
                    }
                    doc.addImage(dataUrl, 'PNG', x, y, drawW, drawH);
                };

                if (includeFrontElevation) {
                    addElevationPage(elevations.front, 'Front Elevation');
                }
                if (includeSideElevation) {
                    addElevationPage(elevations.side, 'Side Elevation');
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
            <div className="summary-tab bg-white dark:bg-gray-900 rounded-xl shadow-lg transition-colors">
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
            <div className="summary-tab bg-white dark:bg-gray-900 rounded-xl shadow-lg transition-colors">
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
        <div className="summary-tab bg-white dark:bg-gray-900 rounded-xl shadow-lg transition-colors">
            {/* Header with Refresh and Export Buttons */}
            <div className="summary-tab-header">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-2">
                    <div className="min-w-0">
                        <h3 className="summary-tab-title">
                            Project Summary & Installation Time Estimator
                        </h3>
                        <p className="summary-tab-subtitle">
                            Comprehensive project overview with installation time calculations
                        </p>
                        <p className="summary-tab-hint">
                            Added new levels or walls? Use Refresh Data below to update panel counts.
                        </p>
                    </div>
                    
                    {/* Export Button */}
                    <button
                        onClick={prepareExportData}
                        disabled={isLoading || isCapturingImages}
                        className="summary-tab-btn-primary"
                    >
                        {isCapturingImages ? (
                            <>
                                <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                                Capturing Images...
                            </>
                        ) : isLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                                Auto-Fetching Data...
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Export Project Report
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Auto-Fetch Status and Controls */}
            <div className="summary-tab-section bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
                    <div className="flex items-start gap-1.5 min-w-0">
                        <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="min-w-0">
                            <h4 className="text-xs font-semibold text-blue-800 dark:text-blue-200">Materials & Data Management</h4>
                            <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-0.5 leading-snug">
                                {sharedPanelData && (sharedPanelData.wallPanels || sharedPanelData.ceilingPanels || sharedPanelData.floorPanels) 
                                    ? 'Project data is loaded and ready for export'
                                    : 'No project data found — click Refresh Data or Fetch Data & Images'
                                }
                            </p>
                            {(!sharedPanelData?.wallPlanImage || !sharedPanelData?.ceilingPlanImage || !sharedPanelData?.floorPlanImage) && (
                                <p className="text-[10px] text-orange-700 dark:text-orange-300 mt-1 leading-snug">
                                    Tip: Use Fetch Data & Images to capture plan images for the PDF
                                </p>
                            )}
                        </div>
                    </div>
                    
                    {/* Refresh and Auto-Fetch Buttons */}
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                        <button
                            onClick={handleManualRefresh}
                            disabled={isLoading || isCapturingImages}
                            className="summary-tab-btn-success"
                            title="Refresh all data from all levels/storeys"
                        >
                            {isLoading ? (
                                <>
                                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                                    Refreshing...
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Refresh Data
                                </>
                            )}
                        </button>

                        <button
                            onClick={() => triggerAutoFetch()}
                            disabled={isLoading || isCapturingImages}
                            className="summary-tab-btn-info"
                        >
                            {isCapturingImages ? (
                                <>
                                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                                    Capturing...
                                </>
                            ) : isLoading ? (
                                <>
                                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                                    Loading...
                                </>
                            ) : (
                                <>
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Fetch Data & Images
                                </>
                            )}
                        </button>
                    </div>
                </div>
                
                {/* Data Status Indicators */}
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
                    <div className="summary-tab-status-pill">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sharedPanelData?.wallPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Wall Plan</span>
                    </div>
                    <div className="summary-tab-status-pill">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sharedPanelData?.ceilingPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Ceiling Plan</span>
                    </div>
                    <div className="summary-tab-status-pill">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sharedPanelData?.floorPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Floor Plan</span>
                    </div>
                </div>
            </div>

            {/* Project Overview */}
            <div className="summary-tab-stat-grid grid-cols-2 lg:grid-cols-4">
                <div className="summary-tab-stat-card bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 border-blue-200 dark:border-blue-800">
                    <div className="summary-tab-stat-value text-blue-600">{rooms.length}</div>
                    <div className="summary-tab-stat-label text-blue-700 dark:text-blue-300">Rooms</div>
                </div>
                <div className="summary-tab-stat-card bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/30 border-green-200 dark:border-green-800">
                    <div className="summary-tab-stat-value text-green-600">{walls.length}</div>
                    <div className="summary-tab-stat-label text-green-700 dark:text-green-300">Walls</div>
                </div>
                <div className="summary-tab-stat-card bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/30 border-purple-200 dark:border-purple-800">
                    <div className="summary-tab-stat-value text-purple-600">{doors.length}</div>
                    <div className="summary-tab-stat-label text-purple-700 dark:text-purple-300">Doors</div>
                </div>
                <div className="summary-tab-stat-card bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/30 border-orange-200 dark:border-orange-800">
                    <div className="summary-tab-stat-value text-orange-600">
                        {projectData ? `${Math.round(projectData.width / 1000)} × ${Math.round(projectData.length / 1000)}` : 'N/A'}
                    </div>
                    <div className="summary-tab-stat-label text-orange-700 dark:text-orange-300">Dimensions (m)</div>
                </div>
            </div>

            {/* Installation Rate Inputs */}
            <div className="summary-tab-stat-grid grid-cols-1 md:grid-cols-3">
                <div className="summary-tab-section bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 border border-blue-200 dark:border-blue-800 mb-0">
                    <h4 className="summary-tab-section-title text-blue-800 dark:text-blue-200">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        Panels per Day
                    </h4>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            min="1"
                            value={panelsPerDay}
                            onChange={(e) => handleInputChange('panels', e.target.value)}
                            className="summary-tab-input border-blue-300 text-blue-900 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:border-blue-700 dark:text-blue-100"
                        />
                        <span className="text-[11px] text-blue-700 dark:text-blue-300 font-medium">panels/day</span>
                    </div>
                </div>

                <div className="summary-tab-section bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/30 border border-green-200 dark:border-green-800 mb-0">
                    <h4 className="summary-tab-section-title text-green-800 dark:text-green-200">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m5-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                        Doors per Day
                    </h4>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            min="1"
                            value={doorsPerDay}
                            onChange={(e) => handleInputChange('doors', e.target.value)}
                            className="summary-tab-input border-green-300 text-green-900 focus:ring-green-500 focus:border-green-500 dark:bg-gray-800 dark:border-green-700 dark:text-green-100"
                        />
                        <span className="text-[11px] text-green-700 dark:text-green-300 font-medium">doors/day</span>
                    </div>
                </div>

                <div className="summary-tab-section bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/30 border border-purple-200 dark:border-purple-800 mb-0">
                    <h4 className="summary-tab-section-title text-purple-800 dark:text-purple-200">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        Slabs per Day
                    </h4>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            min="1"
                            value={slabsPerDay}
                            onChange={(e) => handleInputChange('slabs', e.target.value)}
                            className="summary-tab-input border-purple-300 text-purple-900 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-800 dark:border-purple-700 dark:text-purple-100"
                        />
                        <span className="text-[11px] text-purple-700 dark:text-purple-300 font-medium">slabs/day</span>
                    </div>
                </div>
            </div>

            {/* Material Quantities Summary */}
            <div className="summary-tab-section bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                <h4 className="summary-tab-section-title text-gray-800 dark:text-gray-200">
                    <svg className="text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Project Material Quantities
                </h4>
                <div className="summary-tab-stat-grid grid-cols-1 md:grid-cols-3 mb-0">
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <div className="summary-tab-stat-value text-blue-600">{totalQuantities.panels}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Total Panels</div>
                        <div className="summary-tab-stat-meta">
                            {totalQuantities.ceilingPanels > 0 && `${totalQuantities.ceilingPanels} ceiling`}
                            {totalQuantities.floorPanels > 0 && totalQuantities.ceilingPanels > 0 && ' + '}
                            {totalQuantities.floorPanels > 0 && `${totalQuantities.floorPanels} floor`}
                            {totalQuantities.wallPanelsCount > 0 && (totalQuantities.ceilingPanels > 0 || totalQuantities.floorPanels > 0) && ' + '}
                            {totalQuantities.wallPanelsCount > 0 && `${totalQuantities.wallPanelsCount} wall`}
                        </div>
                    </div>
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <div className="summary-tab-stat-value text-green-600">{totalQuantities.doors}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Total Doors</div>
                        <div className="summary-tab-stat-meta">From project data</div>
                    </div>
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <div className="summary-tab-stat-value text-purple-600">{totalQuantities.slabs}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Total Slabs</div>
                        <div className="summary-tab-stat-meta">Slab floors ({slabWidth}×{slabLength}mm)</div>
                    </div>
                </div>
            </div>

            {/* Detailed Panel Breakdown */}
            <div className="summary-tab-section bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                <h4 className="summary-tab-section-title text-gray-800 dark:text-gray-200">
                    <svg className="text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Panel Breakdown
                </h4>
                <div className="summary-tab-stat-grid grid-cols-2 md:grid-cols-4 mb-0">
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <div className="summary-tab-stat-value text-blue-600">{totalQuantities.ceilingPanels}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Ceiling Panels</div>
                        <div className="summary-tab-stat-meta">{ceilingPlans.length > 0 ? `${ceilingPlans.length} plans` : 'No plans'}</div>
                    </div>
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <div className="summary-tab-stat-value text-green-600">{totalQuantities.floorPanels}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Floor Panels</div>
                        <div className="summary-tab-stat-meta">{floorPlans.length > 0 ? `${floorPlans.length} plans` : 'No plans'}</div>
                    </div>
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <div className="summary-tab-stat-value text-purple-600">{totalQuantities.wallPanelsCount}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Wall Panels</div>
                        <div className="summary-tab-stat-meta">{walls.length > 0 ? `${walls.length} walls` : 'No walls'}</div>
                    </div>
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <div className="summary-tab-stat-value text-indigo-600">{totalQuantities.panels}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Total Panels</div>
                        <div className="summary-tab-stat-meta">Combined count</div>
                    </div>
                </div>
            </div>

            {/* Panel Area by Thickness */}
            {panelAreaByThickness.length > 0 && (
                <div className="summary-tab-section bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-950/40 dark:to-cyan-950/30 border border-teal-200 dark:border-teal-800">
                    <h4 className="summary-tab-section-title text-gray-800 dark:text-gray-200">
                        <svg className="text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        Panel Area by Thickness
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="summary-tab-table min-w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 rounded-md overflow-hidden">
                            <thead className="bg-teal-100 dark:bg-teal-900/50">
                                <tr>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-semibold text-gray-800 dark:text-gray-200">
                                        Thickness (mm)
                                    </th>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-semibold text-gray-800 dark:text-gray-200">
                                        Total Area (m²)
                                    </th>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-semibold text-gray-800 dark:text-gray-200">
                                        Panel Count
                                    </th>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-semibold text-gray-800 dark:text-gray-200">
                                        Breakdown
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-900">
                                {panelAreaByThickness.map((group, index) => (
                                    <tr key={group.thickness} className={index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-teal-50 dark:bg-teal-950/20'}>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 font-medium">
                                            {group.thickness}mm
                                        </td>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                            {(group.area / 1000000).toFixed(2)} m²
                                        </td>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                            {group.count} panels
                                        </td>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
                                            {group.types.wall > 0 && (
                                                <span className="inline-block mr-1 px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-[10px]">
                                                    {group.types.wall} wall
                                                </span>
                                            )}
                                            {group.types.ceiling > 0 && (
                                                <span className="inline-block mr-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-[10px]">
                                                    {group.types.ceiling} ceiling
                                                </span>
                                            )}
                                            {group.types.floor > 0 && (
                                                <span className="inline-block mr-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-[10px]">
                                                    {group.types.floor} floor
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-teal-100 dark:bg-teal-900/50 font-semibold">
                                    <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                        Total
                                    </td>
                                    <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                        {(panelAreaByThickness.reduce((sum, g) => sum + g.area, 0) / 1000000).toFixed(2)} m²
                                    </td>
                                    <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                        {panelAreaByThickness.reduce((sum, g) => sum + g.count, 0)} panels
                                    </td>
                                    <td className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
                                        Total area across all thicknesses
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Installation Time Estimates */}
            <div className="summary-tab-section bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/40 dark:to-blue-950/30 border border-indigo-200 dark:border-indigo-800">
                <h4 className="summary-tab-section-title text-indigo-800 dark:text-indigo-200">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Estimated Installation Time
                </h4>
                <div className="summary-tab-stat-grid grid-cols-1 md:grid-cols-3 mb-0">
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-indigo-200 dark:border-indigo-800">
                        <div className="summary-tab-stat-value text-indigo-600">{installationEstimates.days}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Working Days</div>
                        <div className="summary-tab-stat-meta">Including 20% buffer</div>
                    </div>
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-indigo-200 dark:border-indigo-800">
                        <div className="summary-tab-stat-value text-indigo-600">{installationEstimates.weeks}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Working Weeks</div>
                        <div className="summary-tab-stat-meta">5 days per week</div>
                    </div>
                    <div className="summary-tab-stat-card bg-white dark:bg-gray-900 border-indigo-200 dark:border-indigo-800">
                        <div className="summary-tab-stat-value text-indigo-600">{installationEstimates.months}</div>
                        <div className="summary-tab-stat-label text-gray-600 dark:text-gray-400">Working Months</div>
                        <div className="summary-tab-stat-meta">22 days per month</div>
                    </div>
                </div>
                
                <div className="mt-2 px-2 py-1.5 bg-indigo-100 dark:bg-indigo-900/40 rounded-md">
                    <p className="text-[11px] text-indigo-800 dark:text-indigo-200 leading-snug">
                        <strong>Note:</strong> Assumes sequential work with a 20% buffer. Actual time may vary by site conditions and crew size.
                    </p>
                </div>
            </div>

            {/* Room Details */}
            {rooms.length > 0 && (
                <div className="summary-tab-section bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 mt-3">
                    <h4 className="summary-tab-section-title text-gray-800 dark:text-gray-200">
                        <svg className="text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                        </svg>
                        Room Details
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="summary-tab-table min-w-full border border-gray-300 dark:border-gray-600">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-medium text-gray-700 dark:text-gray-300">
                                        Room Name
                                    </th>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-medium text-gray-700 dark:text-gray-300">
                                        Floor Type
                                    </th>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-medium text-gray-700 dark:text-gray-300">
                                        Floor Thickness
                                    </th>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-medium text-gray-700 dark:text-gray-300">
                                        Height
                                    </th>
                                    <th className="border border-gray-300 dark:border-gray-600 text-left font-medium text-gray-700 dark:text-gray-300">
                                        Area
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-900">
                                {rooms.map((room, index) => (
                                    <tr key={room.id} className={index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 font-medium">
                                            {room.room_name}
                                        </td>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                            {room.floor_type || 'N/A'}
                                        </td>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                            {room.floor_thickness || 'N/A'}
                                        </td>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                                            {room.height ? `${room.height}mm` : 'N/A'}
                                        </td>
                                        <td className="border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
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
                <ModalOverlay className="bg-black bg-opacity-50 flex justify-center items-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto modal-scroll-panel">
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
                                    <div className="col-span-2 break-words">
                                        <span className="font-medium">Project:</span> {exportData.projectInfo.name}
                                    </div>
                                    <div><span className="font-medium">Rooms:</span> {exportData.projectInfo.rooms}</div>
                                    <div><span className="font-medium">Dimensions:</span> {exportData.projectInfo.dimensions}</div>
                                    <div><span className="font-medium">Doors:</span> {exportData.projectInfo.doors}</div>
                                    <div><span className="font-medium">Walls:</span> {exportData.projectInfo.walls}</div>
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
                                                        Level
                                                    </th>
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
                                                    <tr key={room.id ?? index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.storey_name || 'Unassigned'}
                                                        </td>
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
                                        <td colSpan="6" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
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
                                                    const finishing = getPanelFinishingLabel(panel);
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
                            {exportData.ceilingPanels.length > 0 && (
                            <div className="bg-green-50 rounded-lg p-4">
                                <h4 className="font-semibold text-green-800 mb-3">
                                    Ceiling Panels ({exportData.ceilingPanels.length})
                                </h4>
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
                                                        <td colSpan="5" className="px-4 py-2 border border-gray-300 text-center text-blue-600 font-medium">
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
                            </div>
                            )}

                            {/* Floor Panels */}
                            {exportData.floorPanels.length > 0 && (
                            <div className="bg-purple-50 rounded-lg p-4">
                                <h4 className="font-semibold text-purple-800 mb-3">
                                    Floor Panels ({exportData.floorPanels.length})
                                </h4>
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
                            </div>
                            )}

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
            {exportData.supportAccessories.isNeeded && (
            <div className="bg-orange-50 rounded-lg p-4">
                <h4 className="font-semibold text-orange-800 mb-3">Support Accessories</h4>
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
            </div>
            )}

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
                            {exportData.planImages && (
                                exportData.planImages.wallPlan ||
                                exportData.planImages.ceilingPlan ||
                                exportData.planImages.floorPlan ||
                                vectorPlanPreview.wallUrl ||
                                vectorPlanPreview.ceilingUrl ||
                                vectorPlanPreview.floorUrl ||
                                vectorPlanPreview.loading
                            ) && (
                                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="font-semibold text-blue-800">📸 Plan views (export)</h4>
                                    </div>
                                    {vectorPlanPreview.loading && (
                                        <p className="text-xs text-blue-700 mb-2">Generating vector previews to match PDF ceiling/floor pages…</p>
                                    )}
                                    <p className="text-sm text-blue-700 mb-4">
                                        Wall, ceiling, and floor previews use the same vector PDF pipeline as the full export when available; otherwise the captured tab image is shown.
                                    </p>
                                    
                                    <div className={`space-y-4 ${singlePlanPerPage ? '' : 'grid grid-cols-1 gap-4'}`}>
                                        {/* Wall Plan Preview — vector PDF iframe matches export; fallback to captured image */}
                                        {(vectorPlanPreview.wallUrl || exportData.planImages.wallPlan) && (
                                            <div className={`bg-white rounded-lg p-3 border border-blue-200 ${singlePlanPerPage ? 'w-full' : ''}`}>
                                                <h5 className="font-medium text-gray-800 mb-2 flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                    Wall Plan (2D View)
                                                    {vectorPlanPreview.wallUrl && (
                                                        <span className="ml-2 text-xs font-normal text-green-700">(PDF preview)</span>
                                                    )}
                                                </h5>
                                                <div
                                                    className="rounded border border-gray-300 overflow-hidden"
                                                    style={planPdfPreviewBoxStyle}
                                                >
                                                    {vectorPlanPreview.wallUrl ? (
                                                        <iframe
                                                            title="Wall plan PDF preview"
                                                            src={`${vectorPlanPreview.wallUrl}#${planPdfPreviewHash}`}
                                                            className="w-full h-full block border-0 bg-white"
                                                        />
                                                    ) : (
                                                        <img 
                                                            src={exportData.planImages.wallPlan} 
                                                            alt="Wall Plan" 
                                                            className={`rounded ${singlePlanPerPage ? 'max-h-full max-w-full' : 'max-h-[200px] w-auto'}`}
                                                            style={{ 
                                                                objectFit: 'contain',
                                                                transform: `rotate(${planRotation}deg)`
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Ceiling Plan Preview — vector PDF iframe matches export; fallback to captured image */}
                                        {(vectorPlanPreview.ceilingUrl || exportData.planImages.ceilingPlan) && (
                                            <div className={`bg-white rounded-lg p-3 border border-blue-200 ${singlePlanPerPage ? 'w-full' : ''}`}>
                                                <h5 className="font-medium text-gray-800 mb-2 flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                                    </svg>
                                                    Ceiling Plan
                                                    {vectorPlanPreview.ceilingUrl && (
                                                        <span className="ml-2 text-xs font-normal text-green-700">(PDF preview)</span>
                                                    )}
                                                </h5>
                                                <div
                                                    className="rounded border border-gray-300 overflow-hidden"
                                                    style={planPdfPreviewBoxStyle}
                                                >
                                                    {vectorPlanPreview.ceilingUrl ? (
                                                        <iframe
                                                            title="Ceiling plan PDF preview"
                                                            src={`${vectorPlanPreview.ceilingUrl}#${planPdfPreviewHash}`}
                                                            className="w-full h-full block border-0 bg-white"
                                                        />
                                                    ) : (
                                                        <img 
                                                            src={exportData.planImages.ceilingPlan} 
                                                            alt="Ceiling Plan" 
                                                            className={`rounded ${singlePlanPerPage ? 'max-h-full max-w-full' : 'max-h-[200px] w-auto'}`}
                                                            style={{ 
                                                                objectFit: 'contain',
                                                                transform: `rotate(${planRotation}deg)`
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Floor Plan Preview — vector PDF iframe matches export; fallback to captured image */}
                                        {(vectorPlanPreview.floorUrl || exportData.planImages.floorPlan) && (
                                            <div className={`bg-white rounded-lg p-3 border border-blue-200 ${singlePlanPerPage ? 'w-full' : ''}`}>
                                                <h5 className="font-medium text-gray-800 mb-2 flex items-center">
                                                    <svg className="w-4 h-4 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                                    </svg>
                                                    Floor Plan
                                                    {vectorPlanPreview.floorUrl && (
                                                        <span className="ml-2 text-xs font-normal text-green-700">(PDF preview)</span>
                                                    )}
                                                </h5>
                                                <div
                                                    className="rounded border border-gray-300 overflow-hidden"
                                                    style={planPdfPreviewBoxStyle}
                                                >
                                                    {vectorPlanPreview.floorUrl ? (
                                                        <iframe
                                                            title="Floor plan PDF preview"
                                                            src={`${vectorPlanPreview.floorUrl}#${planPdfPreviewHash}`}
                                                            className="w-full h-full block border-0 bg-white"
                                                        />
                                                    ) : (
                                                        <img 
                                                            src={exportData.planImages.floorPlan} 
                                                            alt="Floor Plan" 
                                                            className={`rounded ${singlePlanPerPage ? 'max-h-full max-w-full' : 'max-h-[200px] w-auto'}`}
                                                            style={{ 
                                                                objectFit: 'contain',
                                                                transform: `rotate(${planRotation}deg)`
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {!exportData.planImages.wallPlan &&
                                        !exportData.planImages.ceilingPlan &&
                                        !exportData.planImages.floorPlan &&
                                        !vectorPlanPreview.wallUrl &&
                                        !vectorPlanPreview.ceilingUrl &&
                                        !vectorPlanPreview.floorUrl &&
                                        !vectorPlanPreview.loading && (
                                        <div className="text-center py-4 text-gray-500">
                                            <p className="text-sm">No plan previews available. Capture wall/ceiling/floor tab views or ensure wall geometry and panel data exist for vector previews.</p>
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
                                        <p className="text-xs text-gray-600 mb-3">These settings affect captured tab images (fallback) and vector wall/ceiling/floor layout in the previews and in the PDF plan pages.</p>
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
                                                    <p className="text-xs text-gray-500 mt-1">Whole PDF — landscape uses two columns</p>
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

                                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                <div>
                                                    <label className="text-sm font-medium text-gray-700">Front Elevation</label>
                                                    <p className="text-xs text-gray-500 mt-1">Whole-model front view in PDF</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setIncludeFrontElevation(!includeFrontElevation)}
                                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                                        includeFrontElevation
                                                            ? 'bg-blue-600 text-white'
                                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                    }`}
                                                >
                                                    {includeFrontElevation ? 'Included' : 'Not included'}
                                                </button>
                                            </div>

                                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                                <div>
                                                    <label className="text-sm font-medium text-gray-700">Side Elevation</label>
                                                    <p className="text-xs text-gray-500 mt-1">Whole-model side view in PDF</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setIncludeSideElevation(!includeSideElevation)}
                                                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                                        includeSideElevation
                                                            ? 'bg-blue-600 text-white'
                                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                    }`}
                                                >
                                                    {includeSideElevation ? 'Included' : 'Not included'}
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
                                    {(includeFrontElevation || includeSideElevation) && (
                                        <span className="block mt-1 text-blue-700">
                                            Elevations:{' '}
                                            {[includeFrontElevation && 'Front', includeSideElevation && 'Side'].filter(Boolean).join(' + ')}
                                            {' '}will be appended.
                                        </span>
                                    )}
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
                </ModalOverlay>
            )}
        </div>
    );
};

export default InstallationTimeEstimator;