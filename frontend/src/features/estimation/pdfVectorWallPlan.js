/**
 * Vector wall plan PDF drawing (shared by full export and live preview).
 * Extracted from InstallationTimeEstimator.generatePDF.
 */
import { jsPDF } from 'jspdf';
import PanelCalculator from '../panel/PanelCalculator';
import { doPolygonsOverlap, findIntersectionPointsBetweenWalls, calculatePolygonVisualCenter, isPointInPolygon } from '../canvas/utils';
import { calculateOffsetPoints, calculateActualProjectDimensions, buildWallOffsetOptions, resolve45CutForceShouldFlip } from '../canvas/drawing';
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

function buildWallPanelsMapForFilter(wallsToUse, intersectionsData) {
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
}

export function calculateGhostDataForStorey(activeStoreyId, targetStorey, allStoreys, allWalls, filteredRooms, allProjectRooms) {
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
                        const allNormalizedRooms = Array.isArray(allProjectRooms) ? allProjectRooms : [];
                        
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
}

export function drawVectorWallPlan(
    doc,
    wallsToDraw,
    roomsToDraw,
    doorsToDraw,
    storeyName,
    ghostWallsToDraw,
    ghostAreasToDraw,
    targetStoreyId,
    intersections,
    allWalls,
    planPageOrientation,
    fitToPage,
    /** When false, wall outline lines run continuously through door openings (doors still drawn on top). */
    breakWallLinesAtDoors = true
) {
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
                        const offsetOpts = buildWallOffsetOptions(wall, roomsToDraw) || {};
                        const forcedFlip = resolve45CutForceShouldFlip(wall, intersections, wallsToDraw);
                        if (typeof forcedFlip === 'boolean') {
                            offsetOpts.forceShouldFlip = forcedFlip;
                        }
                        const { line1, line2 } = calculateOffsetPoints(
                            x1, y1, x2, y2, thickness, center, 1, offsetOpts
                        );
                        minX = Math.min(minX, line1[0].x, line1[1].x, line2[0].x, line2[1].x);
                        minY = Math.min(minY, line1[0].y, line1[1].y, line2[0].y, line2[1].y);
                        maxX = Math.max(maxX, line1[0].x, line1[1].x, line2[0].x, line2[1].x);
                        maxY = Math.max(maxY, line1[0].y, line1[1].y, line2[0].y, line2[1].y);
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
                    /** Model mm — aligns with drawing.js `SNAP_THRESHOLD / currentScaleFactor` at typical zoom */
                    const MODEL_SNAP_TOLERANCE_MM = 35;

                    wallsToDraw.forEach((wall) => {
                        const wallThickness = wall.thickness || 100;
                        // Use scale = 1 for model space calculations (we'll transform to PDF space later)
                        const gapPixels = wallThickness; // In model space, gap = thickness
                        const offsetOpts = buildWallOffsetOptions(wall, roomsToDraw) || {};
                        const forcedFlip = resolve45CutForceShouldFlip(wall, intersections, wallsToDraw);
                        if (typeof forcedFlip === 'boolean') {
                            offsetOpts.forceShouldFlip = forcedFlip;
                        }

                        let { line1, line2 } = calculateOffsetPoints(
                            wall.start_x,
                            wall.start_y,
                            wall.end_x,
                            wall.end_y,
                            gapPixels,
                            center,
                            1, // scaleFactor = 1 for model space
                            offsetOpts
                        );
                        wallLinesMap.set(wall.id, { line1, line2, wall });
                    });
                    
                    // Second pass: Extend/shorten lines at intersections (same algorithm as drawing.js drawWalls)
                    intersections.forEach(inter => {
                        const tolerance = MODEL_SNAP_TOLERANCE_MM;

                        const wallsAtIntersection = [];

                        wallsToDraw.forEach(wall => {
                            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
                            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;

                            let isOnBody = false;
                            if (!isAtStart && !isAtEnd) {
                                const dx = wall.end_x - wall.start_x;
                                const dy = wall.end_y - wall.start_y;
                                const wallLength = Math.hypot(dx, dy);

                                if (wallLength > 0) {
                                    const toInterX = inter.x - wall.start_x;
                                    const toInterY = inter.y - wall.start_y;
                                    const wallDirX = dx / wallLength;
                                    const wallDirY = dy / wallLength;
                                    const projectionLength = toInterX * wallDirX + toInterY * wallDirY;
                                    const perpX = toInterX - projectionLength * wallDirX;
                                    const perpY = toInterY - projectionLength * wallDirY;
                                    const perpDistance = Math.hypot(perpX, perpY);
                                    const distanceFromStart = projectionLength;
                                    const distanceFromEnd = wallLength - projectionLength;
                                    const isNearEndpoint = distanceFromStart < tolerance * 2 || distanceFromEnd < tolerance * 2;

                                    if (projectionLength >= -tolerance && projectionLength <= wallLength + tolerance &&
                                        perpDistance < tolerance && !isNearEndpoint) {
                                        isOnBody = true;
                                    }
                                }
                            }

                            if (isAtStart || isAtEnd || isOnBody) {
                                const wallData = wallLinesMap.get(wall.id);
                                if (wallData) {
                                    wallsAtIntersection.push({
                                        wall,
                                        wallData,
                                        isAtStart,
                                        isAtEnd,
                                        isOnBody
                                    });
                                }
                            }
                        });

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

                            const runVhPairPhase = (phase) => {
                            vhPairs.forEach(pairData => {
                                const { verticalWall, horizontalWall, joiningMethod, jointWall1Id } = pairData;

                                const vWall = verticalWall.wall;
                                const hWall = horizontalWall.wall;
                                const vLines = verticalWall.wallData;
                                const hLines = horizontalWall.wallData;

                                let vIsAtStart = verticalWall.isAtStart;
                                if (verticalWall.isOnBody) {
                                    const distToStart = Math.hypot(inter.x - vWall.start_x, inter.y - vWall.start_y);
                                    const distToEnd = Math.hypot(inter.x - vWall.end_x, inter.y - vWall.end_y);
                                    vIsAtStart = distToStart < distToEnd;
                                }

                                let hIsAtStart = horizontalWall.isAtStart;
                                if (horizontalWall.isOnBody) {
                                    const distToStart = Math.hypot(inter.x - hWall.start_x, inter.y - hWall.start_y);
                                    const distToEnd = Math.hypot(inter.x - hWall.end_x, inter.y - hWall.end_y);
                                    hIsAtStart = distToStart < distToEnd;
                                }

                                const hasButtIn = joiningMethod === 'butt_in';

                                const hLine1Y = (hLines.line1[0].y + hLines.line1[1].y) / 2;
                                const hLine2Y = (hLines.line2[0].y + hLines.line2[1].y) / 2;
                                const hUpperLine = hLine1Y < hLine2Y ? hLines.line1 : hLines.line2;
                                const hLowerLine = hLine1Y < hLine2Y ? hLines.line2 : hLines.line1;

                                const vEndpointY = vIsAtStart ? vWall.start_y : vWall.end_y;
                                const vOtherY = vIsAtStart ? vWall.end_y : vWall.start_y;
                                const isTopEnd = vEndpointY < vOtherY;

                                if (hasButtIn) {
                                    const isVerticalWall1 = String(jointWall1Id) === String(vWall.id);
                                    const isHorizontalWall1 = String(jointWall1Id) === String(hWall.id);

                                    if (phase === 'extend') {
                                    if (isHorizontalWall1 && !isVerticalWall1 && !verticalWall.isOnBody) {
                                        const vEndpointYCaseA = vIsAtStart ? vWall.start_y : vWall.end_y;
                                        const vOtherYCaseA = vIsAtStart ? vWall.end_y : vWall.start_y;
                                        const isTopEndCaseA = vEndpointYCaseA < vOtherYCaseA;
                                        let targetY;
                                        if (isTopEndCaseA) {
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
                                    } else if (isVerticalWall1 && !isHorizontalWall1 && !horizontalWall.isOnBody) {
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
                                    }

                                    if (phase === 'shorten') {
                                    if (isVerticalWall1 && !isHorizontalWall1 && !verticalWall.isOnBody) {
                                        const distJointToStart = Math.hypot(inter.x - vWall.start_x, inter.y - vWall.start_y);
                                        const distJointToEnd = Math.hypot(inter.x - vWall.end_x, inter.y - vWall.end_y);
                                        const jointAtVerticalStart = distJointToStart < distJointToEnd;
                                        const jointY = jointAtVerticalStart ? vWall.start_y : vWall.end_y;
                                        const otherVerticalY = jointAtVerticalStart ? vWall.end_y : vWall.start_y;
                                        const horizontalOnTopAtButtIn = otherVerticalY > jointY;

                                        let targetY;
                                        if (horizontalOnTopAtButtIn) {
                                            targetY = hLowerLine[0].y;
                                        } else {
                                            targetY = hUpperLine[0].y;
                                        }
                                        const vLine1Endpoint = jointAtVerticalStart ? vLines.line1[0] : vLines.line1[1];
                                        const vLine2Endpoint = jointAtVerticalStart ? vLines.line2[0] : vLines.line2[1];
                                        vLine1Endpoint.y = targetY;
                                        vLine2Endpoint.y = targetY;
                                    } else if (isHorizontalWall1 && !isVerticalWall1 && !horizontalWall.isOnBody) {
                                        const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                                        const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                                        const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                                        const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                                        const vIntersectionX = inter.x;
                                        const hMidX = (hWall.start_x + hWall.end_x) / 2;
                                        const isVerticalOnLeft = vIntersectionX < hMidX;
                                        const isVerticalOnRight = vIntersectionX > hMidX;
                                        let targetVLine;
                                        if (isVerticalOnLeft) {
                                            targetVLine = vRightmostLine;
                                        } else if (isVerticalOnRight) {
                                            targetVLine = vLeftmostLine;
                                        } else {
                                            targetVLine = vRightmostLine;
                                        }
                                        const targetVStartX = targetVLine[0].x;
                                        const targetVStartY = targetVLine[0].y;
                                        const targetVEndX = targetVLine[1].x;
                                        const targetVEndY = targetVLine[1].y;
                                        const targetVDx = targetVEndX - targetVStartX;
                                        const targetVDy = targetVEndY - targetVStartY;
                                        let targetX;
                                        if (Math.abs(targetVDy) > 0.001) {
                                            const t = (inter.y - targetVStartY) / targetVDy;
                                            targetX = targetVStartX + t * targetVDx;
                                        } else {
                                            targetX = targetVStartX;
                                        }
                                        const hLine1Endpoint = hIsAtStart ? hLines.line1[0] : hLines.line1[1];
                                        const hLine2Endpoint = hIsAtStart ? hLines.line2[0] : hLines.line2[1];
                                        hLine1Endpoint.x = targetX;
                                        hLine2Endpoint.x = targetX;
                                    }
                                    }
                                } else {
                                    if (phase === 'extend') {
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
                                    if (!verticalWall.isOnBody) {
                                        if (vIsAtStart) {
                                            vLines.line1[0].y = targetY;
                                            vLines.line2[0].y = targetY;
                                        } else {
                                            vLines.line1[1].y = targetY;
                                            vLines.line2[1].y = targetY;
                                        }
                                    }
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
                                    if (!horizontalWall.isOnBody) {
                                        if (hIsAtStart) {
                                            hLines.line1[0].x = targetX;
                                            hLines.line2[0].x = targetX;
                                        } else {
                                            hLines.line1[1].x = targetX;
                                            hLines.line2[1].x = targetX;
                                        }
                                    }
                                    }
                                }
                            });
                            };
                            runVhPairPhase('extend');
                            runVhPairPhase('shorten');
                        }
                    });
                    
                    // Generate color map for walls
                    const thicknessColorMap = generateThicknessColorMap(wallsToDraw);
                    
                    // Third pass: Apply 45Â° cuts and draw walls
                    wallsToDraw.forEach((wall) => {
                        // Get pre-calculated lines (already extended to intersections)
                        let { line1, line2 } = wallLinesMap.get(wall.id);
                        
                        // Make copies for modification (45Â° cuts will modify these)
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
                        
                        // Check for 45Â° cuts at EACH END separately
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
                        
                        // Check start end for 45Â° cut
                        let startHas45 = false;
                        let startIsOnLeftSide = false;
                        
                        // Check end end for 45Â° cut
                        let endHas45 = false;
                        let endIsOnLeftSide = false;
                        
                        // Check each intersection to find 45Â° cuts at each endpoint
                        intersections.forEach(inter => {
                            const tolerance = MODEL_SNAP_TOLERANCE_MM;
                            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
                            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;

                            if (isAtStart || isAtEnd) {
                                let has45Cut = false;
                                let joiningWallId = null;

                                if (inter.pairs) {
                                    inter.pairs.forEach(pair => {
                                        const pw1 = typeof pair.wall1 === 'object' ? (pair.wall1?.id ?? pair.wall1) : pair.wall1;
                                        const pw2 = typeof pair.wall2 === 'object' ? (pair.wall2?.id ?? pair.wall2) : pair.wall2;
                                        if (
                                            (String(pw1) === String(wall.id) || String(pw2) === String(wall.id)) &&
                                            pair.joining_method === '45_cut'
                                        ) {
                                            has45Cut = true;
                                            joiningWallId = String(pw1) === String(wall.id) ? pw2 : pw1;
                                        }
                                    });
                                }
                                
                                if (has45Cut && joiningWallId != null) {
                                    const joiningWall = allWalls.find(w => String(w.id) === String(joiningWallId));
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
                        
                        // Apply 45Â° cut shortening at each end independently (match canvas drawing.js)
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
                        
                        // Keep line role aligned with forced 45_cut side for consistent inner/outer coloring.
                        const forcedFlipForWall = resolve45CutForceShouldFlip(wall, intersections, wallsToDraw);
                        if (typeof forcedFlipForWall === 'boolean') {
                            const dx = wall.end_x - wall.start_x;
                            const dy = wall.end_y - wall.start_y;
                            const len = Math.hypot(dx, dy) || 1;
                            const normalX = dy / len;
                            const normalY = -dx / len;
                            const wallMidX = (wall.start_x + wall.end_x) / 2;
                            const wallMidY = (wall.start_y + wall.end_y) / 2;
                            const line2MidX = (line2[0].x + line2[1].x) / 2;
                            const line2MidY = (line2[0].y + line2[1].y) / 2;
                            const line2Dot = normalX * (line2MidX - wallMidX) + normalY * (line2MidY - wallMidY);
                            const line2IsPositiveSide = line2Dot > 0;
                            if (line2IsPositiveSide !== forcedFlipForWall) {
                                const tmp = line1;
                                line1 = line2;
                                line2 = tmp;
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
                        if (wallDoors.length === 0 || !breakWallLinesAtDoors) {
                            // No doors, or user wants continuous lines through openings - draw continuous line
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
                                // Draw mitered cap at 45Â° - EXACT same logic as drawWallCaps
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
                                    
                                    // Draw 45Â° cut lines from cap endpoints along bisector - EXACT same as canvas
                                    // Canvas draws two separate lines (moveTo + lineTo for each)
                                    doc.setDrawColor(0, 0, 0); // Black for 45Â° cut (canvas uses red for debugging, but we use black)
                                    doc.setLineWidth(0.15);
                                    doc.setLineDashPattern([]);
                                    
                                    // Draw 45Â° cut lines from cap endpoints TO intersection point - form closed mitered corner
                                    // The lines should meet at the intersection point (pt.x, pt.y) to form a closed corner
                                    doc.setDrawColor(0, 0, 0); // Black for 45Â° cut
                                    doc.setLineWidth(0.15);
                                    doc.setLineDashPattern([]);
                                    
                                    // Draw line from cap1 endpoint to intersection point
                                    doc.line(transformX(cap1.x), transformY(cap1.y), transformX(pt.x), transformY(pt.y));
                                    
                                    // Draw line from cap2 endpoint to intersection point
                                    doc.line(transformX(cap2.x), transformY(cap2.y), transformX(pt.x), transformY(pt.y));
                                    
                                    console.log(`45Â° cut drawn for wall ${wall.id} at ${pt.label}:`, {
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
                        
                        // Partition hatching — sparse PDF hatch; long walls capped so it never turns into tight stripes
                        if (wall.application_type === "partition") {
                            const minSpacingMm = 240;
                            const maxInteriorSlashes = 5;
                            const slashLength = 60;
                            const dx = line1[1].x - line1[0].x;
                            const dy = line1[1].y - line1[0].y;
                            const wallLength = Math.sqrt(dx * dx + dy * dy);
                            let numSlashes = Math.max(3, Math.floor(wallLength / minSpacingMm));
                            const maxNumSlashes = maxInteriorSlashes + 2;
                            if (numSlashes > maxNumSlashes) numSlashes = maxNumSlashes;
                            const diagX = Math.cos(Math.PI / 4) * slashLength;
                            const diagY = Math.sin(Math.PI / 4) * slashLength;

                            for (let i = 1; i < numSlashes - 1; i++) {
                                const t = i / numSlashes;
                                const midX = (line1[0].x + t * (line1[1].x - line1[0].x) + line2[0].x + t * (line2[1].x - line2[0].x)) / 2;
                                const midY = (line1[0].y + t * (line1[1].y - line1[0].y) + line2[0].y + t * (line2[1].y - line2[0].y)) / 2;
                                const x1 = midX - diagX;
                                const y1 = midY - diagY;
                                const x2 = midX + diagX;
                                const y2 = midY + diagY;

                                doc.setDrawColor(102, 102, 102); // DIMENSION_CONFIG.COLORS.PARTITION '#666'
                                doc.setLineWidth(0.15);
                                doc.setLineDashPattern([]);
                                doc.line(transformX(x1), transformY(y1), transformX(x2), transformY(y2));
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
                            const slashAngle = Math.PI / 4; // 45Â° diagonal
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
                    
                    // ===== DRAW DIMENSIONS (aligned with canvas rules; PDF styling enhanced) =====
                    // Convert px to mm: 1px = 0.264583mm (at 96 DPI) - standard conversion
                    const PX_TO_MM = 0.264583;
                    const formatDimMm = (mm) => `${Math.round(Number(mm))}`;
                    // Extension lines: light dashed; dimension line: solid, slightly heavier
                    const pdfExtDash = [1.2 * PX_TO_MM, 2 * PX_TO_MM];
                    const pdfDimLineW = Math.max(0.35, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * PX_TO_MM * 1.4);
                    const pdfExtLineW = Math.max(0.22, DIMENSION_CONFIG.LINE_WIDTH * PX_TO_MM * 0.9);
                    const pdfTick = 1.3 * PX_TO_MM;
                    /** Perpendicular tick marks at outer ends of dimension line (| style, not chevrons) */
                    const drawPdfHorizontalDimArrows = (x0, x1, y, color) => {
                        doc.setDrawColor(color[0], color[1], color[2]);
                        doc.setLineWidth(pdfDimLineW);
                        doc.setLineDashPattern([]);
                        doc.line(x0, y - pdfTick, x0, y + pdfTick);
                        doc.line(x1, y - pdfTick, x1, y + pdfTick);
                    };
                    const drawPdfVerticalDimArrows = (x, y0, y1, color) => {
                        doc.setDrawColor(color[0], color[1], color[2]);
                        doc.setLineWidth(pdfDimLineW);
                        doc.setLineDashPattern([]);
                        doc.line(x - pdfTick, y0, x + pdfTick, y0);
                        doc.line(x - pdfTick, y1, x + pdfTick, y1);
                    };
                    const drawPdfHorizontalTicks = (xs, y, color) => {
                        if (!xs || xs.length === 0) return;
                        doc.setDrawColor(color[0], color[1], color[2]);
                        doc.setLineWidth(pdfDimLineW);
                        doc.setLineDashPattern([]);
                        xs.forEach((x) => {
                            doc.line(x, y - pdfTick, x, y + pdfTick);
                        });
                    };
                    const drawPdfVerticalTicks = (x, ys, color) => {
                        if (!ys || ys.length === 0) return;
                        doc.setDrawColor(color[0], color[1], color[2]);
                        doc.setLineWidth(pdfDimLineW);
                        doc.setLineDashPattern([]);
                        ys.forEach((y) => {
                            doc.line(x - pdfTick, y, x + pdfTick, y);
                        });
                    };
                    const drawPdfObliqueTicks = (px, py, ux, uy, color) => {
                        const vx = -uy;
                        const vy = ux;
                        doc.setDrawColor(color[0], color[1], color[2]);
                        doc.setLineWidth(pdfDimLineW);
                        doc.setLineDashPattern([]);
                        doc.line(px - vx * pdfTick, py - vy * pdfTick, px + vx * pdfTick, py + vy * pdfTick);
                    };
                    const drawPdfObliqueDimArrows = (x0, y0, x1, y1, ux, uy, color) => {
                        drawPdfObliqueTicks(x0, y0, ux, uy, color);
                        drawPdfObliqueTicks(x1, y1, ux, uy, color);
                    };
                    /** White pad behind dimension text for legibility over geometry */
                    const drawPdfDimTextPadH = (cx, baselineY, text, padMm) => {
                        try {
                            const tw = doc.getTextWidth(text);
                            let th = doc.getFontSize() * 0.45;
                            const d = typeof doc.getTextDimensions === 'function' ? doc.getTextDimensions(text) : null;
                            if (d && typeof d.h === 'number') th = d.h;
                            doc.setFillColor(255, 255, 255);
                            doc.rect(cx - tw / 2 - padMm, baselineY - th - padMm, tw + 2 * padMm, th + 2 * padMm, 'F');
                        } catch (e) {
                            /* ignore */
                        }
                    };
                    const drawPdfDimTextPadV = (leftX, gapCenterY, textWidthPx, padMm) => {
                        try {
                            let fh = doc.getFontSize() * 0.45;
                            if (typeof doc.getTextDimensions === 'function') {
                                try {
                                    const td = doc.getTextDimensions('Ag');
                                    if (td && typeof td.h === 'number') fh = td.h;
                                } catch (e2) {
                                    /* use fh default */
                                }
                            }
                            const boxH = Math.max(textWidthPx, fh) + 2 * padMm;
                            const boxW = fh + 2 * padMm;
                            doc.setFillColor(255, 255, 255);
                            doc.rect(leftX - boxW - 0.5 * PX_TO_MM, gapCenterY - boxH / 2, boxW + 0.5 * PX_TO_MM, boxH, 'F');
                        } catch (e) {
                            /* ignore */
                        }
                    };
                    const drawPdfDimTextPadRotated = (cx, cy, textWidthPx, padMm, textAngleDeg) => {
                        try {
                            const fh = doc.getFontSize() * 0.45;
                            const rad = (textAngleDeg * Math.PI) / 180;
                            const c = Math.abs(Math.cos(rad));
                            const s = Math.abs(Math.sin(rad));
                            const bw = textWidthPx * c + fh * s + 2 * padMm;
                            const bh = textWidthPx * s + fh * c + 2 * padMm;
                            doc.setFillColor(255, 255, 255);
                            doc.rect(cx - bw / 2, cy - bh / 2, bw, bh, 'F');
                        } catch (e) {
                            /* ignore */
                        }
                    };
                    
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
                    
                    // Wall extents in PDF space — dashed extension lines are clipped so they do not run through the interior
                    const modelRectPdf =
                        actualDimensions &&
                        typeof actualDimensions.minX === 'number' &&
                        typeof actualDimensions.maxX === 'number' &&
                        typeof actualDimensions.minY === 'number' &&
                        typeof actualDimensions.maxY === 'number'
                            ? {
                                  left: transformX(actualDimensions.minX),
                                  right: transformX(actualDimensions.maxX),
                                  top: transformY(actualDimensions.minY),
                                  bottom: transformY(actualDimensions.maxY)
                              }
                            : null;
                    
                    /**
                     * Return sub-segments of [p1,p2] whose midpoints lie outside the strict interior of the model AABB
                     * (so dashed extensions stay in the margin outside the plan, not through rooms).
                     */
                    const extensionSegmentsOutsideModelRect = (x1, y1, x2, y2, rect) => {
                        if (!rect) return [{ x1, y1, x2, y2 }];
                        const { left, right, top, bottom } = rect;
                        if (!(left < right && top < bottom)) return [{ x1, y1, x2, y2 }];
                        const insideStrict = (x, y) => x > left && x < right && y > top && y < bottom;
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const ts = [0, 1];
                        const addT = (t) => {
                            if (t > 1e-8 && t < 1 - 1e-8) ts.push(t);
                        };
                        if (Math.abs(dx) > 1e-12) {
                            addT((left - x1) / dx);
                            addT((right - x1) / dx);
                        }
                        if (Math.abs(dy) > 1e-12) {
                            addT((top - y1) / dy);
                            addT((bottom - y1) / dy);
                        }
                        ts.sort((a, b) => a - b);
                        const uniq = [];
                        for (let i = 0; i < ts.length; i++) {
                            if (i === 0 || ts[i] - ts[i - 1] > 1e-7) uniq.push(ts[i]);
                        }
                        const out = [];
                        for (let i = 0; i < uniq.length - 1; i++) {
                            const ta = uniq[i];
                            const tb = uniq[i + 1];
                            const xa = x1 + ta * dx;
                            const ya = y1 + ta * dy;
                            const xb = x1 + tb * dx;
                            const yb = y1 + tb * dy;
                            const mx = (xa + xb) / 2;
                            const my = (ya + yb) / 2;
                            if (!insideStrict(mx, my)) {
                                const len = Math.hypot(xb - xa, yb - ya);
                                if (len > 1e-4) {
                                    out.push({ x1: xa, y1: ya, x2: xb, y2: yb });
                                }
                            }
                        }
                        return out.length > 0 ? out : [];
                    };
                    
                    const drawDashedExtensionLine = (x1, y1, x2, y2) => {
                        const segs = extensionSegmentsOutsideModelRect(x1, y1, x2, y2, modelRectPdf);
                        segs.forEach((s) => doc.line(s.x1, s.y1, s.x2, s.y2));
                    };
                    
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
                            fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
                            
                            doc.setFontSize(fontSize);
                            doc.setFont(undefined, DIMENSION_CONFIG.FONT_WEIGHT);
                            
                            const text = formatDimMm(length);
                            const textWidth = doc.getTextWidth(text);
                            
                            const { maxX: pMaxX, minY: pMinY } = projectModelBounds;
                            
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
                                
                                doc.setLineDashPattern(pdfExtDash);
                                doc.setLineWidth(pdfExtLineW);
                                doc.setDrawColor(projectColor[0], projectColor[1], projectColor[2]);
                                
                                // Extension lines (dashed) — clipped to stay outside the plan interior
                                drawDashedExtensionLine(transformX(startX), transformY(startY), transformX(startX), labelY);
                                drawDashedExtensionLine(transformX(endX), transformY(endY), transformX(endX), labelY);
                                
                                const startXScreen = transformX(startX);
                                const endXScreen = transformX(endX);
                                doc.setLineDashPattern([]);
                                doc.setLineWidth(pdfDimLineW);
                                doc.setDrawColor(projectColor[0], projectColor[1], projectColor[2]);
                                if (startXScreen < textLeft) {
                                    doc.line(startXScreen, labelY, textLeft, labelY);
                                }
                                if (endXScreen > textRight) {
                                    doc.line(textRight, labelY, endXScreen, labelY);
                                }
                                
                                const tickXs = [];
                                if (startXScreen < textLeft) {
                                    tickXs.push(startXScreen, textLeft);
                                }
                                if (endXScreen > textRight) {
                                    tickXs.push(textRight, endXScreen);
                                }
                                drawPdfHorizontalTicks(tickXs, labelY, projectColor);
                                if (tickXs.length > 0) {
                                    drawPdfHorizontalDimArrows(startXScreen, endXScreen, labelY, projectColor);
                                }
                                
                                doc.setTextColor(projectColor[0], projectColor[1], projectColor[2]);
                                drawPdfDimTextPadH(labelX, labelY, text, 2.5 * PX_TO_MM);
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
                                
                                doc.setLineDashPattern(pdfExtDash);
                                doc.setLineWidth(pdfExtLineW);
                                doc.setDrawColor(projectColor[0], projectColor[1], projectColor[2]);
                                
                                drawDashedExtensionLine(transformX(startX), transformY(startY), labelX, transformY(startY));
                                drawDashedExtensionLine(transformX(endX), transformY(endY), labelX, transformY(endY));
                                
                                const startYScreen = transformY(startY);
                                const endYScreen = transformY(endY);
                                doc.setLineDashPattern([]);
                                doc.setLineWidth(pdfDimLineW);
                                doc.setDrawColor(projectColor[0], projectColor[1], projectColor[2]);
                                if (startYScreen < textTop) {
                                    doc.line(labelX, startYScreen, labelX, textTop);
                                }
                                if (endYScreen > textBottom) {
                                    doc.line(labelX, textBottom, labelX, endYScreen);
                                }
                                
                                const tickYs = [];
                                if (startYScreen < textTop) {
                                    tickYs.push(startYScreen, textTop);
                                }
                                if (endYScreen > textBottom) {
                                    tickYs.push(textBottom, endYScreen);
                                }
                                drawPdfVerticalTicks(labelX, tickYs, projectColor);
                                if (tickYs.length > 0) {
                                    drawPdfVerticalDimArrows(labelX, startYScreen, endYScreen, projectColor);
                                }
                                
                                doc.setTextColor(projectColor[0], projectColor[1], projectColor[2]);
                                const textGap = 2 * PX_TO_MM;
                                const textX = labelX - textGap;
                                const gapCenter = (textTop + textBottom) / 2;
                                const textY = gapCenter - (textWidth / 2);
                                drawPdfDimTextPadV(textX, gapCenter, textWidth, 2 * PX_TO_MM);
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
                            fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
                            
                            doc.setFontSize(fontSize);
                            doc.setFont(undefined, DIMENSION_CONFIG.FONT_WEIGHT);
                            
                            const text = formatDimMm(wallLength);
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
                            
                            const adx = Math.abs(dx);
                            const ady = Math.abs(dy);
                            const useObliqueWallDim =
                                adx > 1e-9 &&
                                ady > 1e-9 &&
                                Math.min(adx, ady) / Math.max(adx, ady) >= 0.3;
                            
                            if (useObliqueWallDim) {
                                const Ps = { x: transformX(wall.start_x), y: transformY(wall.start_y) };
                                const Pe = { x: transformX(wall.end_x), y: transformY(wall.end_y) };
                                const wvx = Pe.x - Ps.x;
                                const wvy = Pe.y - Ps.y;
                                const pdfLen = Math.hypot(wvx, wvy);
                                if (pdfLen < 1e-9) return;
                                const ux = wvx / pdfLen;
                                const uy = wvy / pdfLen;
                                const nx = -uy;
                                const ny = ux;
                                
                                const obliqueBounds = (lx, ly, tw) => {
                                    const rad = Math.atan2(uy, ux);
                                    const c = Math.abs(Math.cos(rad));
                                    const s = Math.abs(Math.sin(rad));
                                    const fh = doc.getFontSize() * 0.45;
                                    const bw = tw * c + fh * s + 4 * PX_TO_MM;
                                    const bh = tw * s + fh * c + 4 * PX_TO_MM;
                                    return { x: lx - bw / 2, y: ly - bh / 2, width: bw, height: bh };
                                };
                                
                                const placement = smartPlacement({
                                    calculatePositionSide1: (off) => {
                                        const mx = (Ps.x + Pe.x) / 2;
                                        const my = (Ps.y + Pe.y) / 2;
                                        return { labelX: mx + nx * off, labelY: my + ny * off };
                                    },
                                    calculatePositionSide2: (off) => {
                                        const mx = (Ps.x + Pe.x) / 2;
                                        const my = (Ps.y + Pe.y) / 2;
                                        return { labelX: mx - nx * off, labelY: my - ny * off };
                                    },
                                    calculateBounds: (lx, ly, tw) => obliqueBounds(lx, ly, tw),
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
                                
                                if (wallLinesMap) {
                                    let labelBounds = obliqueBounds(labelX, labelY, textWidth);
                                    let hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                    let wallCheckAttempts = 0;
                                    const maxWallCheckAttempts = 10;
                                    const wallAvoidanceIncrement = 2 * scale * PX_TO_MM;
                                    const sign = placement.side === 'side1' ? 1 : -1;
                                    while (hasWallOverlap && wallCheckAttempts < maxWallCheckAttempts) {
                                        labelX += sign * nx * wallAvoidanceIncrement;
                                        labelY += sign * ny * wallAvoidanceIncrement;
                                        labelBounds = obliqueBounds(labelX, labelY, textWidth);
                                        hasWallOverlap = doesLabelOverlapAnyWallLinePDF(labelBounds, wallLinesMap);
                                        wallCheckAttempts++;
                                    }
                                }
                                
                                const pmx = (Ps.x + Pe.x) / 2;
                                const pmy = (Ps.y + Pe.y) / 2;
                                const dOff = (labelX - pmx) * nx + (labelY - pmy) * ny;
                                const Ps_ = { x: Ps.x + nx * dOff, y: Ps.y + ny * dOff };
                                const Pe_ = { x: Pe.x + nx * dOff, y: Pe.y + ny * dOff };
                                
                                doc.setLineDashPattern(pdfExtDash);
                                doc.setLineWidth(pdfExtLineW);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                drawDashedExtensionLine(Ps.x, Ps.y, Ps_.x, Ps_.y);
                                drawDashedExtensionLine(Pe.x, Pe.y, Pe_.x, Pe_.y);
                                
                                const textPadding = 2 * PX_TO_MM;
                                const halfText = textWidth / 2 + textPadding;
                                const midS = pdfLen / 2;
                                const leftS = midS - halfText;
                                const rightS = midS + halfText;
                                
                                doc.setLineDashPattern([]);
                                doc.setLineWidth(pdfDimLineW);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                
                                const drawSeg = (s0, s1) => {
                                    if (s1 <= s0 + 1e-4) return;
                                    const ax = Ps_.x + ux * s0;
                                    const ay = Ps_.y + uy * s0;
                                    const bx = Ps_.x + ux * s1;
                                    const by = Ps_.y + uy * s1;
                                    doc.line(ax, ay, bx, by);
                                };
                                
                                if (rightS <= leftS) {
                                    doc.line(Ps_.x, Ps_.y, Pe_.x, Pe_.y);
                                } else {
                                    drawSeg(0, Math.max(0, leftS));
                                    drawSeg(Math.min(pdfLen, rightS), pdfLen);
                                }
                                
                                drawPdfObliqueDimArrows(Ps_.x, Ps_.y, Pe_.x, Pe_.y, ux, uy, wallColor);
                                if (rightS > leftS && leftS > 0) {
                                    drawPdfObliqueTicks(Ps_.x + ux * leftS, Ps_.y + uy * leftS, ux, uy, wallColor);
                                }
                                if (rightS > leftS && rightS < pdfLen) {
                                    drawPdfObliqueTicks(Ps_.x + ux * rightS, Ps_.y + uy * rightS, ux, uy, wallColor);
                                }
                                
                                const textAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
                                doc.setTextColor(wallColor[0], wallColor[1], wallColor[2]);
                                drawPdfDimTextPadRotated(labelX, labelY, textWidth, 2 * PX_TO_MM, textAngleDeg);
                                doc.text(text, labelX, labelY, { align: 'center', angle: textAngleDeg });
                                
                                placedLabels.push({
                                    ...obliqueBounds(labelX, labelY, textWidth),
                                    side: placement.side === 'side1' ? 'oblique1' : 'oblique2',
                                    text: text,
                                    angle: textAngleDeg,
                                    type: 'wall'
                                });
                            } else if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
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
                                
                                const textPadding = 2 * PX_TO_MM;
                                
                                doc.setLineDashPattern(pdfExtDash);
                                doc.setLineWidth(pdfExtLineW);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                
                                drawDashedExtensionLine(transformX(wall.start_x), transformY(wall.start_y), transformX(wall.start_x), labelY);
                                drawDashedExtensionLine(transformX(wall.end_x), transformY(wall.end_y), transformX(wall.end_x), labelY);
                                
                                const startXScreen = transformX(wall.start_x);
                                const endXScreen = transformX(wall.end_x);
                                const dimensionLineMidpoint = (startXScreen + endXScreen) / 2;
                                const centeredLabelX = dimensionLineMidpoint;
                                const centeredTextLeft = centeredLabelX - textWidth / 2 - textPadding;
                                const centeredTextRight = centeredLabelX + textWidth / 2 + textPadding;
                                
                                doc.setLineDashPattern([]);
                                doc.setLineWidth(pdfDimLineW);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                if (startXScreen < centeredTextLeft) {
                                    doc.line(startXScreen, labelY, centeredTextLeft, labelY);
                                }
                                if (endXScreen > centeredTextRight) {
                                    doc.line(centeredTextRight, labelY, endXScreen, labelY);
                                }
                                
                                const wallHTickXs = [];
                                if (startXScreen < centeredTextLeft) {
                                    wallHTickXs.push(startXScreen, centeredTextLeft);
                                }
                                if (endXScreen > centeredTextRight) {
                                    wallHTickXs.push(centeredTextRight, endXScreen);
                                }
                                drawPdfHorizontalTicks(wallHTickXs, labelY, wallColor);
                                if (wallHTickXs.length > 0) {
                                    drawPdfHorizontalDimArrows(startXScreen, endXScreen, labelY, wallColor);
                                }
                                
                                doc.setTextColor(wallColor[0], wallColor[1], wallColor[2]);
                                drawPdfDimTextPadH(centeredLabelX, labelY, text, 2 * PX_TO_MM);
                                doc.text(text, centeredLabelX, labelY, { align: 'center' });
                                
                                const labelBounds = calculateHorizontalLabelBounds(centeredLabelX, labelY, textWidth, 2 * PX_TO_MM, 8 * PX_TO_MM);
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
                                
                                const textPadding = 2 * PX_TO_MM;
                                const textTop = labelY - textWidth / 2 - textPadding;
                                const textBottom = labelY + textWidth / 2 + textPadding;
                                
                                doc.setLineDashPattern(pdfExtDash);
                                doc.setLineWidth(pdfExtLineW);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                
                                drawDashedExtensionLine(transformX(wall.start_x), transformY(wall.start_y), labelX, transformY(wall.start_y));
                                drawDashedExtensionLine(transformX(wall.end_x), transformY(wall.end_y), labelX, transformY(wall.end_y));
                                
                                const startYScreen = transformY(wall.start_y);
                                const endYScreen = transformY(wall.end_y);
                                doc.setLineDashPattern([]);
                                doc.setLineWidth(pdfDimLineW);
                                doc.setDrawColor(wallColor[0], wallColor[1], wallColor[2]);
                                if (startYScreen < textTop) {
                                    doc.line(labelX, startYScreen, labelX, textTop);
                                }
                                if (endYScreen > textBottom) {
                                    doc.line(labelX, textBottom, labelX, endYScreen);
                                }
                                
                                const wallVTickYs = [];
                                if (startYScreen < textTop) {
                                    wallVTickYs.push(startYScreen, textTop);
                                }
                                if (endYScreen > textBottom) {
                                    wallVTickYs.push(textBottom, endYScreen);
                                }
                                drawPdfVerticalTicks(labelX, wallVTickYs, wallColor);
                                if (wallVTickYs.length > 0) {
                                    drawPdfVerticalDimArrows(labelX, startYScreen, endYScreen, wallColor);
                                }
                                
                                doc.setTextColor(wallColor[0], wallColor[1], wallColor[2]);
                                const textGap = 2 * PX_TO_MM;
                                const textX = labelX - textGap;
                                const gapCenter = (textTop + textBottom) / 2;
                                const textY = gapCenter - (textWidth / 2);
                                drawPdfDimTextPadV(textX, gapCenter, textWidth, 2 * PX_TO_MM);
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
                    doc.setFontSize(7);
                    doc.setTextColor(90, 90, 90);
                    doc.text('Dimensions in millimetres (mm).', planPageWidth - planMargin, planPageHeight - planMargin - 11, { align: 'right' });
}

/**
 * Merge API intersections (joint types) with geometry from walls (same as PDF export).
 */
export async function fetchMergedWallIntersections(api, projectId, wallsForVector) {
    let intersections = [];
    try {
        const intersectionsResponse = await api.get(`/intersections/?projectid=${projectId}`);
        const apiIntersections = intersectionsResponse.data || [];
        const calculatedIntersections = findIntersectionPointsBetweenWalls(wallsForVector);
        const mergedIntersections = calculatedIntersections.map((inter) => {
            const updatedPairs = inter.pairs.map((pair) => {
                const wall1Id = pair.wall1?.id;
                const wall2Id = pair.wall2?.id;
                const apiInter = apiIntersections.find(
                    (i) =>
                        (i.wall_1 === wall1Id && i.wall_2 === wall2Id) ||
                        (i.wall_1 === wall2Id && i.wall_2 === wall1Id)
                );
                return {
                    ...pair,
                    joining_method: apiInter?.joining_method || 'butt_in'
                };
            });
            const firstPair = updatedPairs[0];
            let wall_1 = firstPair?.wall1?.id;
            let wall_2 = firstPair?.wall2?.id;
            let joining_method = firstPair?.joining_method || 'butt_in';
            if (wall_1 && wall_2) {
                const apiMatch = apiIntersections.find(
                    (i) =>
                        (i.wall_1 === wall_1 && i.wall_2 === wall_2) ||
                        (i.wall_1 === wall_2 && i.wall_2 === wall_1)
                );
                if (apiMatch) {
                    joining_method = apiMatch.joining_method || 'butt_in';
                }
            }
            return {
                ...inter,
                pairs: updatedPairs,
                wall_1,
                wall_2,
                joining_method
            };
        });
        intersections = mergedIntersections;
    } catch (intersectionErr) {
        intersections = findIntersectionPointsBetweenWalls(wallsForVector);
    }
    return intersections;
}

function sortStoreysForWallPdf(storeys) {
    return [...storeys].sort((a, b) => {
        const orderDiff = (a.order ?? 0) - (b.order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        const elevationDiff = (Number(a.elevation_mm) || 0) - (Number(b.elevation_mm) || 0);
        if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
        return (a.id ?? 0) - (b.id ?? 0);
    });
}

/**
 * Same vector wall pages as full PDF export, in a standalone document (for iframe preview).
 * @returns {Promise<Blob|null>}
 */
export async function buildWallPlanPreviewPdfBlob({
    api,
    projectId,
    storeys,
    rooms,
    doors,
    walls,
    planPageOrientation,
    fitToPage
}) {
    if (!api || !projectId || !walls || walls.length === 0) {
        return null;
    }
    const wallsForVector = walls;
    const intersections = await fetchMergedWallIntersections(api, projectId, wallsForVector);
    const orient = planPageOrientation === 'landscape' ? 'landscape' : 'portrait';
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: orient });

    let anyPage = false;

    const defaultStoreyId =
        storeys && storeys.length > 0 ? sortStoreysForWallPdf(storeys)[0]?.id : null;

    if (storeys && storeys.length > 0) {
        for (const storey of storeys) {
            const activeStoreyId = storey.id;
            const matchesActiveStorey = (storeyId) => {
                if (!activeStoreyId) return true;
                if (storeyId === null || storeyId === undefined) {
                    if (defaultStoreyId === null || defaultStoreyId === undefined) return false;
                    return String(defaultStoreyId) === String(activeStoreyId);
                }
                return String(storeyId) === String(activeStoreyId);
            };

            const normalizedWalls = Array.isArray(wallsForVector) ? wallsForVector : [];
            const storeyWalls = normalizedWalls.filter((wall) => matchesActiveStorey(wall.storey));

            const normalizedRooms = Array.isArray(rooms) ? rooms : [];
            const storeyRooms = normalizedRooms.filter((room) => matchesActiveStorey(room.storey));

            const wallStoreyMap = new Map(normalizedWalls.map((wall) => [String(wall.id), wall.storey]));
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

            if (
                storeyWalls.length > 0 ||
                ghostWalls.length > 0 ||
                storeyRooms.length > 0 ||
                ghostAreas.length > 0
            ) {
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
                anyPage = true;
            }
        }
    } else {
        drawVectorWallPlan(
            doc,
            wallsForVector,
            rooms || [],
            doors || [],
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
        anyPage = true;
    }

    if (!anyPage) {
        return null;
    }
    if (typeof doc.getNumberOfPages === 'function' && doc.getNumberOfPages() >= 2) {
        doc.deletePage(1);
    }
    return doc.output('blob');
}
