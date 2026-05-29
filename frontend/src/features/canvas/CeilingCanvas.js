import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
    calculateOffsetPoints,
    drawOrthoPlanDimensionGeometryLikeWall,
    makeLabelDrawFn,
    buildWallOffsetOptions,
    computeWallPlanDimensionFontSize,
    placeExteriorWallDimensionAvoidingLabels,
    resolveWallExteriorPlacementSide
} from './drawing.js';
import { calculatePolygonVisualCenter } from './utils.js';
import { computePlanFitTransform } from './planCanvasUtils.js';
import {
    DIMENSION_CONFIG,
    formatPlanDimensionLabel,
    planCeilingValueDedupKey,
    createDimensionLaneCounters,
    consumeDimensionLane,
    getDimensionSpanForLane,
    comparePlanDimensionsDrawOrder,
    getPlanDimensionLaneConfig,
    getPlanExteriorSide,
    getDimensionEdge,
    isLabelOutsidePlanArea,
    computeExteriorPlanLabelCoords,
    getPlanExteriorFixedColumnX,
    rememberPlanExteriorColumnX,
    applyPlanOuterTierMinOffset,
    recordPlanInnerTierMaxOffset
} from './DimensionConfig.js';
import {
    hasLabelOverlap,
    calculateHorizontalLabelBounds,
    calculateVerticalLabelBounds,
    calculateRotatedVerticalDimBounds,
    exteriorVerticalTextCenterX,
    buildVerticalPlanLabelEntry
} from './collisionDetection.js';

// Build a stable identity key for ceiling panels based on thickness + inner/outer finishes
function getCeilingPanelFinishKey(panel) {
    if (!panel) return 'unknown';
    const coreThk = panel.thickness ?? panel.ceiling_thickness ?? 0;
    const intMat = panel.inner_face_material || panel.innerFaceMaterial || 'PPGI';
    const intThk =
        panel.inner_face_thickness != null
            ? panel.inner_face_thickness
            : panel.innerFaceThickness != null
                ? panel.innerFaceThickness
                : 0.5;
    // For ceiling visual identity we group by core thickness + INNER face only,
    // so rooms that share the same inner material/thickness get the same colour
    return `${coreThk}|INT:${intThk} ${intMat}`;
}

// Generate distinct colours for combinations of (thickness + inner/outer finishes)
function generateCeilingFinishColorMap(panels) {
    if (!panels || panels.length === 0) return new Map();

    const keys = [...new Set(panels.map(getCeilingPanelFinishKey))];

    // If only one combination, keep a neutral style with depth for cut vs full
    if (keys.length === 1) {
        const colorMap = new Map();
        const onlyKey = keys[0];
        colorMap.set(onlyKey, {
            panelFillFull: 'rgba(148, 163, 184, 0.35)', // lighter
            panelFillCut: 'rgba(148, 163, 184, 0.7)',   // darker
            panelStrokeFull: '#9ca3af',
            panelStrokeCut: '#4b5563',
            label: onlyKey,
            hasDifferentFaces: false
        });
        return colorMap;
    }

    const colorMap = new Map();
    keys.forEach((key, index) => {
        const panel = panels.find(p => getCeilingPanelFinishKey(p) === key);
        const hasDiffFaces =
            panel &&
            (panel.inner_face_material || panel.innerFaceMaterial || 'PPGI') !==
                (panel.outer_face_material || panel.outerFaceMaterial || 'PPGI');

        const baseHue = (index * 360) / keys.length;
        const outerHue = baseHue;
        const innerHue = (baseHue + 180) % 360;

        if (hasDiffFaces) {
            colorMap.set(key, {
                // Full vs cut use same hue, different depth
                panelFillFull: `hsla(${outerHue}, 70%, 65%, 0.45)`,
                panelFillCut: `hsla(${outerHue}, 70%, 40%, 0.8)`,
                panelStrokeFull: `hsl(${outerHue}, 70%, 35%)`,
                panelStrokeCut: `hsl(${outerHue}, 80%, 20%)`,
                innerPanelFillFull: `hsla(${innerHue}, 70%, 65%, 0.45)`,
                innerPanelFillCut: `hsla(${innerHue}, 70%, 40%, 0.8)`,
                innerPanelStrokeFull: `hsl(${innerHue}, 70%, 35%)`,
                innerPanelStrokeCut: `hsl(${innerHue}, 80%, 20%)`,
                label: key,
                hasDifferentFaces: true
            });
        } else {
            colorMap.set(key, {
                panelFillFull: `hsla(${outerHue}, 70%, 65%, 0.45)`,
                panelFillCut: `hsla(${outerHue}, 70%, 40%, 0.8)`,
                panelStrokeFull: `hsl(${outerHue}, 70%, 35%)`,
                panelStrokeCut: `hsl(${outerHue}, 80%, 20%)`,
                label: key,
                hasDifferentFaces: false
            });
        }
    });

    return colorMap;
}

function getPanelShapePoints(panel) {
    if (!panel) return [];
    const raw = panel.shape_points ?? panel.shape_data ?? panel.shapeData ?? null;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

const DEFAULT_CANVAS_WIDTH = 1000;
const DEFAULT_CANVAS_HEIGHT = 720;
const CANVAS_ASPECT_RATIO = DEFAULT_CANVAS_HEIGHT / DEFAULT_CANVAS_WIDTH;
const MAX_CANVAS_HEIGHT_RATIO = 0.82; // More vertical space so ceiling plan content isn't cut off
// Mobile-friendly minimum sizes
const MIN_CANVAS_WIDTH = 320;
const MIN_CANVAS_HEIGHT = 280;
const PADDING = 50;
/** Hangers along each drawn alu rail, in mm. */
const ALU_RAIL_HANGER_SPACING_MM = 500;
/** Rails sketched along walls often sit just outside panel AABBs; still treat as over the ceiling grid. */
const ALU_RAIL_PANEL_PROXIMITY_MM = 220;

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
    onEnableNylonHangersChange = null,
    onEnableAluSuspensionChange = null,
    onNylonHangerOptionsChange = null,
    onSupportOptionsUserChange = null,
    
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

    // Flattened list of all panels for colour mapping (similar to wall thickness colour map)
    const allCeilingPanels = useMemo(() => {
        if (!effectiveCeilingPanelsMap) return [];
        return Object.values(effectiveCeilingPanelsMap)
            .filter(Array.isArray)
            .flat()
            .filter(Boolean);
    }, [effectiveCeilingPanelsMap]);

    /** Full project panels for alu placement — map is filtered by selected room / view but rails use global coords. */
    const allCeilingPanelsForAluPlacement = useMemo(() => {
        if (isMultiRoomMode && Array.isArray(ceilingPanels) && ceilingPanels.length > 0) {
            return ceilingPanels.filter(Boolean);
        }
        return allCeilingPanels;
    }, [isMultiRoomMode, ceilingPanels, allCeilingPanels]);

    // Some datasets keep geometry in meters, others in millimeters.
    // We infer a mm->model divisor so spacing/tolerance behave consistently.
    const modelUnitsPerMm = useMemo(() => {
        const sampleDims = [];
        if (projectData?.width) sampleDims.push(Number(projectData.width));
        if (projectData?.length) sampleDims.push(Number(projectData.length));
        for (const p of allCeilingPanelsForAluPlacement.slice(0, 30)) {
            if (p?.width) sampleDims.push(Number(p.width));
            if (p?.length) sampleDims.push(Number(p.length));
        }
        const positive = sampleDims.filter(v => Number.isFinite(v) && v > 0);
        if (positive.length === 0) return 1;
        const median = positive.sort((a, b) => a - b)[Math.floor(positive.length / 2)];
        return median < 50 ? 1000 : 1;
    }, [allCeilingPanelsForAluPlacement, projectData]);

    const ceilingFinishColorMap = useMemo(
        () => generateCeilingFinishColorMap(allCeilingPanels),
        [allCeilingPanels]
    );

    const getPanelAxisBounds = useCallback((panel) => {
        const startX = panel.start_x ?? panel.x ?? 0;
        const startY = panel.start_y ?? panel.y ?? 0;
        const endX = panel.end_x ?? (panel.width !== undefined ? startX + panel.width : panel.x_end ?? startX);
        const endY = panel.end_y ?? (panel.length !== undefined ? startY + panel.length : panel.y_end ?? startY);
        return {
            left: Math.min(startX, endX),
            right: Math.max(startX, endX),
            top: Math.min(startY, endY),
            bottom: Math.max(startY, endY)
        };
    }, []);

    const buildAluHangersAlongRail = useCallback((sx, sy, ex, ey, supportLinePayload, supportTypeForRecord, placementKeyFn, placementKeysSet) => {
        const newSupports = [];
        const dx = ex - sx;
        const dy = ey - sy;
        const L = Math.hypot(dx, dy);
        if (L < 1) return newSupports;

        const ux = dx / L;
        const uy = dy / L;
        const spacing = ALU_RAIL_HANGER_SPACING_MM / modelUnitsPerMm;
        const proximity = ALU_RAIL_PANEL_PROXIMITY_MM / modelUnitsPerMm;

        const pointEligibleForHanger = (mx, my) => {
            for (const panel of allCeilingPanelsForAluPlacement) {
                const b = getPanelAxisBounds(panel);
                const cx = Math.min(Math.max(mx, b.left), b.right);
                const cy = Math.min(Math.max(my, b.top), b.bottom);
                const dist = Math.hypot(mx - cx, my - cy);
                if (dist <= proximity) return true;
            }
            return false;
        };
        // Compatibility alias for any stale references during hot reload.
        const pointInsideAnyPanel = pointEligibleForHanger;

        const addIf = (px, py) => {
            if (!pointInsideAnyPanel(px, py)) return;
            const pk = placementKeyFn(px, py);
            if (placementKeysSet.has(pk)) return;
            placementKeysSet.add(pk);
            newSupports.push({
                id: Date.now() + Math.random(),
                start_x: px,
                start_y: py,
                width: 50,
                length: 50,
                type: supportTypeForRecord,
                x: px,
                y: py,
                supportLine: supportLinePayload,
                isIntersectionPoint: true
            });
        };

        const scanStep = Math.max(40 / modelUnitsPerMm, spacing / 10);
        let lastPlacedT = null;
        let t = 0;
        while (t <= L + 0.001) {
            const tt = Math.min(t, L);
            const px = sx + ux * tt;
            const py = sy + uy * tt;
            const inside = pointInsideAnyPanel(px, py);
            if (inside && (lastPlacedT === null || tt - lastPlacedT >= spacing)) {
                addIf(px, py);
                lastPlacedT = tt;
            }
            t += scanStep;
        }

        // Tail fill: if end point is inside panel and the trailing gap is large enough, add one more.
        const endX = sx + ux * L;
        const endY = sy + uy * L;
        if (pointInsideAnyPanel(endX, endY) && (lastPlacedT === null || L - lastPlacedT >= spacing * 0.45)) {
            addIf(endX, endY);
        }

        return newSupports;
    }, [allCeilingPanelsForAluPlacement, getPanelAxisBounds, modelUnitsPerMm]);

    const aluSupportLineKey = useCallback((sx, sy, ex, ey) => {
        const q = (v) => Math.round(v / 2) * 2;
        const s1 = `${q(sx)},${q(sy)}|${q(ex)},${q(ey)}`;
        const s2 = `${q(ex)},${q(ey)}|${q(sx)},${q(sy)}`;
        return s1 < s2 ? s1 : s2;
    }, []);

    const getRailOrientation = useCallback((sl) => {
        const dx = Math.abs(sl.endX - sl.startX);
        const dy = Math.abs(sl.endY - sl.startY);
        if (dy < dx * 0.3) return 'horizontal';
        if (dx < dy * 0.3) return 'vertical';
        return 'free';
    }, []);

    const modelToDisplayMm = useCallback(
        (v) => Math.round(Math.max(0, v) * modelUnitsPerMm),
        [modelUnitsPerMm]
    );
    const displayMmToModel = useCallback((mm) => mm / modelUnitsPerMm, [modelUnitsPerMm]);

    const listUniqueRails = useCallback((supports) => {
        const map = new Map();
        (supports || []).forEach((s) => {
            const sl = s.supportLine;
            if (!sl) return;
            const key = aluSupportLineKey(sl.startX, sl.startY, sl.endX, sl.endY);
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    startX: sl.startX,
                    startY: sl.startY,
                    endX: sl.endX,
                    endY: sl.endY,
                    stopWallY: sl.stopWallY,
                    startWallY: sl.startWallY
                });
            }
        });
        return Array.from(map.values());
    }, [aluSupportLineKey]);

    /** Nearest horizontal wall centerline (alu rails snap here). */
    const findNearestHorizontalWallCenterline = useCallback((px, py) => {
        if (!Array.isArray(walls) || walls.length === 0) return null;

        const AXIS_THRESH = 0.35;
        const wallSearchMax = 500 / modelUnitsPerMm;
        let best = null;

        const projectPointToSegment = (pX, pY, ax, ay, bx, by) => {
            const vx = bx - ax;
            const vy = by - ay;
            const segLenSq = vx * vx + vy * vy;
            if (segLenSq < 1e-9) return null;
            const tRaw = ((pX - ax) * vx + (pY - ay) * vy) / segLenSq;
            const t = Math.max(0, Math.min(1, tRaw));
            return { x: ax + vx * t, y: ay + vy * t };
        };

        walls.forEach((wall) => {
            const x1 = wall.start_x ?? wall.x1 ?? wall.x_start;
            const y1 = wall.start_y ?? wall.y1 ?? wall.y_start;
            const x2 = wall.end_x ?? wall.x2 ?? wall.x_end;
            const y2 = wall.end_y ?? wall.y2 ?? wall.y_end;
            if (![x1, y1, x2, y2].every(Number.isFinite)) return;

            const dx = x2 - x1;
            const dy = y2 - y1;
            if (Math.abs(dy) > Math.abs(dx) * AXIS_THRESH) return;

            const p = projectPointToSegment(px, py, x1, y1, x2, y2);
            if (!p) return;
            const perp = Math.abs(py - p.y);
            if (perp > wallSearchMax) return;
            if (!best || perp < best.perp) {
                best = { perp, wallY: p.y };
            }
        });

        if (!best) return null;
        return {
            wallY: best.wallY,
            offset: best.perp
        };
    }, [walls, modelUnitsPerMm]);

    /** Distances from a point to nearest wall centerlines (fallback: project bounds only if no wall nearby). */
    const getWallFaceDistances = useCallback((px, py) => {
        const fallback = {
            left: px,
            right: projectData ? projectData.width - px : 0,
            top: py,
            bottom: projectData ? projectData.length - py : 0,
            leftAnchor: { x: 0, y: py },
            rightAnchor: { x: projectData?.width ?? px, y: py },
            topAnchor: { x: px, y: 0 },
            bottomAnchor: { x: px, y: projectData?.length ?? py }
        };
        if (!projectData || !Array.isArray(walls) || walls.length === 0) {
            return fallback;
        }

        const AXIS_THRESH = 0.35;
        const wallSearchMax = 500 / modelUnitsPerMm; // same order as snap — must find stop/start wall
        let bestLeft = null;
        let bestRight = null;
        let bestTop = null;
        let bestBottom = null;
        let nearestHoriz = null;
        let nearestVert = null;

        const projectPointToSegment = (pX, pY, ax, ay, bx, by) => {
            const vx = bx - ax;
            const vy = by - ay;
            const segLenSq = vx * vx + vy * vy;
            if (segLenSq < 1e-9) return null;
            const tRaw = ((pX - ax) * vx + (pY - ay) * vy) / segLenSq;
            const t = Math.max(0, Math.min(1, tRaw));
            return { x: ax + vx * t, y: ay + vy * t };
        };

        walls.forEach((wall) => {
            const x1 = wall.start_x ?? wall.x1 ?? wall.x_start;
            const y1 = wall.start_y ?? wall.y1 ?? wall.y_start;
            const x2 = wall.end_x ?? wall.x2 ?? wall.x_end;
            const y2 = wall.end_y ?? wall.y2 ?? wall.y_end;
            if (![x1, y1, x2, y2].every(Number.isFinite)) return;

            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) return;

            const isHorizontal = Math.abs(dy) <= Math.abs(dx) * AXIS_THRESH;
            const isVertical = Math.abs(dx) <= Math.abs(dy) * AXIS_THRESH;
            const p = projectPointToSegment(px, py, x1, y1, x2, y2) || {
                x: (x1 + x2) / 2,
                y: (y1 + y2) / 2
            };

            if (isHorizontal) {
                const perp = Math.abs(py - p.y);
                if (perp <= wallSearchMax && (!nearestHoriz || perp < nearestHoriz.perp)) {
                    nearestHoriz = { perp, x: p.x, y: p.y };
                }
                if (p.y < py) {
                    const d = py - p.y;
                    if (!bestTop || d < bestTop.dist) {
                        bestTop = { dist: d, x: p.x, y: p.y };
                    }
                }
                if (p.y > py) {
                    const d = p.y - py;
                    if (!bestBottom || d < bestBottom.dist) {
                        bestBottom = { dist: d, x: p.x, y: p.y };
                    }
                }
            }
            if (isVertical) {
                const perp = Math.abs(px - p.x);
                if (perp <= wallSearchMax && (!nearestVert || perp < nearestVert.perp)) {
                    nearestVert = { perp, x: p.x, y: p.y };
                }
                if (p.x < px) {
                    const d = px - p.x;
                    if (!bestLeft || d < bestLeft.dist) {
                        bestLeft = { dist: d, x: p.x, y: p.y };
                    }
                }
                if (p.x > px) {
                    const d = p.x - px;
                    if (!bestRight || d < bestRight.dist) {
                        bestRight = { dist: d, x: p.x, y: p.y };
                    }
                }
            }
        });

        // Rails snap to wall centerline — measure perpendicular distance to that line, not project edge
        if (nearestHoriz) {
            const wy = nearestHoriz.y;
            const onWall = nearestHoriz.perp < 2 / modelUnitsPerMm;
            const topCandidate = { dist: Math.max(0, py - wy), x: px, y: wy };
            const bottomCandidate = { dist: Math.max(0, wy - py), x: px, y: wy };
            if (onWall) {
                bestTop = { dist: 0, x: px, y: wy };
                bestBottom = { dist: 0, x: px, y: wy };
            } else {
                if (!bestTop || topCandidate.dist < bestTop.dist) bestTop = topCandidate;
                if (!bestBottom || bottomCandidate.dist < bestBottom.dist) bestBottom = bottomCandidate;
            }
        }
        if (nearestVert) {
            const vx = nearestVert.x;
            const onWall = nearestVert.perp < 2 / modelUnitsPerMm;
            const leftCandidate = { dist: Math.max(0, px - vx), x: vx, y: py };
            const rightCandidate = { dist: Math.max(0, vx - px), x: vx, y: py };
            if (onWall) {
                bestLeft = { dist: 0, x: vx, y: py };
                bestRight = { dist: 0, x: vx, y: py };
            } else {
                if (!bestLeft || leftCandidate.dist < bestLeft.dist) bestLeft = leftCandidate;
                if (!bestRight || rightCandidate.dist < bestRight.dist) bestRight = rightCandidate;
            }
        }

        const clampDist = (v) => Math.max(0, v);
        const hasWall =
            nearestHoriz != null ||
            nearestVert != null ||
            bestLeft != null ||
            bestRight != null ||
            bestTop != null ||
            bestBottom != null;

        const pick = (best, fbDist, fbAnchor) =>
            best
                ? { dist: clampDist(best.dist), anchor: { x: best.x, y: best.y } }
                : { dist: clampDist(fbDist), anchor: fbAnchor };

        const leftP = pick(bestLeft, fallback.left, fallback.leftAnchor);
        const rightP = pick(bestRight, fallback.right, fallback.rightAnchor);
        const topP = pick(bestTop, fallback.top, fallback.topAnchor);
        const bottomP = pick(bestBottom, fallback.bottom, fallback.bottomAnchor);

        return {
            left: leftP.dist,
            right: rightP.dist,
            top: topP.dist,
            bottom: bottomP.dist,
            leftAnchor: leftP.anchor,
            rightAnchor: rightP.anchor,
            topAnchor: topP.anchor,
            bottomAnchor: bottomP.anchor,
            hasWall
        };
    }, [walls, projectData, modelUnitsPerMm]);

    const getRailEditMetrics = useCallback((sl) => {
        if (!sl || !projectData) return null;
        const orient = getRailOrientation(sl);
        const length = Math.hypot(sl.endX - sl.startX, sl.endY - sl.startY);
        const startD = getWallFaceDistances(sl.startX, sl.startY);
        const endD = getWallFaceDistances(sl.endX, sl.endY);

        const clampMm = (v) => Math.max(0, v);
        const base = {
            orient,
            length: clampMm(length),
            left: clampMm(startD.left),
            right: clampMm(endD.right),
            top: clampMm(startD.top),
            leftAnchor: { x: startD.leftAnchor.x, y: sl.startY },
            rightAnchor: endD.rightAnchor,
            topAnchor: { x: sl.startX, y: startD.topAnchor.y }
        };

        if (orient === 'vertical') {
            const stopWall =
                sl.stopWallY != null && Number.isFinite(sl.stopWallY)
                    ? { wallY: sl.stopWallY, offset: Math.abs(sl.endY - sl.stopWallY) }
                    : findNearestHorizontalWallCenterline(sl.endX, sl.endY);
            const stopWallY = stopWall?.wallY ?? endD.bottomAnchor.y;
            const stopOffset = stopWall ? stopWall.offset : endD.bottom;
            return {
                ...base,
                bottom: clampMm(stopOffset),
                bottomAnchor: { x: sl.endX, y: stopWallY },
                stopWallY
            };
        }

        return {
            ...base,
            bottom: clampMm(endD.bottom),
            bottomAnchor: endD.bottomAnchor,
            stopWallY: null
        };
    }, [projectData, getRailOrientation, getWallFaceDistances, findNearestHorizontalWallCenterline]);

    const pointToSegmentDistance = useCallback((px, py, x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-9) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }, []);
    
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
    const [showMaterialsTable, setShowMaterialsTable] = useState(false);
    const [isPlacingSupport, setIsPlacingSupport] = useState(false);
    // Use customSupports from props if provided, otherwise use local state as fallback
    const [localCustomSupports, setLocalCustomSupports] = useState([]);
    const effectiveCustomSupports = customSupports !== undefined && Array.isArray(customSupports) ? customSupports : localCustomSupports;
    // Function to update custom supports - use callback if provided, otherwise use local state setter
    const updateCustomSupports = useCallback((newSupportsOrUpdater) => {
        if (onCustomSupportsChange) {
            onCustomSupportsChange(newSupportsOrUpdater);
        } else {
            setLocalCustomSupports(newSupportsOrUpdater);
        }
    }, [onCustomSupportsChange]);

    const findRailKeyAtPoint = useCallback((modelX, modelY, thresholdModel) => {
        const rails = listUniqueRails(effectiveCustomSupports);
        let bestKey = null;
        let bestDist = thresholdModel;
        rails.forEach((rail) => {
            const d = pointToSegmentDistance(
                modelX,
                modelY,
                rail.startX,
                rail.startY,
                rail.endX,
                rail.endY
            );
            if (d < bestDist) {
                bestDist = d;
                bestKey = rail.key;
            }
        });
        return bestKey;
    }, [effectiveCustomSupports, listUniqueRails, pointToSegmentDistance]);

    const replaceRailGeometry = useCallback((railKey, startX, startY, endX, endY, railMeta = {}) => {
        const existingRail = listUniqueRails(effectiveCustomSupports).find((r) => r.key === railKey);
        const kept = effectiveCustomSupports.filter((s) => {
            const sl = s.supportLine;
            if (!sl) return true;
            return aluSupportLineKey(sl.startX, sl.startY, sl.endX, sl.endY) !== railKey;
        });
        const placementKeys = new Set();
        const quantizeStep = 5 / modelUnitsPerMm;
        const placementKey = (x, y) =>
            `${Math.round(x / quantizeStep) * quantizeStep},${Math.round(y / quantizeStep) * quantizeStep}`;
        kept.forEach((s) => {
            if (s.x != null && s.y != null) placementKeys.add(placementKey(s.x, s.y));
        });
        const orient = getRailOrientation({ startX, startY, endX, endY });
        const stopFromDetect = findNearestHorizontalWallCenterline(endX, endY);
        const supportLinePayload = {
            startX,
            startY,
            endX,
            endY,
            isSnapped: orient === 'horizontal' ? 'horizontal' : orient === 'vertical' ? 'vertical' : false,
            stopWallY:
                railMeta.stopWallY ??
                existingRail?.stopWallY ??
                stopFromDetect?.wallY ??
                undefined,
            startWallY: railMeta.startWallY ?? existingRail?.startWallY ?? undefined
        };
        const newHangers = buildAluHangersAlongRail(
            startX,
            startY,
            endX,
            endY,
            supportLinePayload,
            supportType,
            placementKey,
            placementKeys
        );
        updateCustomSupports([...kept, ...newHangers]);
        return aluSupportLineKey(startX, startY, endX, endY);
    }, [
        effectiveCustomSupports,
        aluSupportLineKey,
        modelUnitsPerMm,
        getRailOrientation,
        buildAluHangersAlongRail,
        supportType,
        updateCustomSupports,
        listUniqueRails,
        findNearestHorizontalWallCenterline
    ]);

    const applyRailFieldEdit = useCallback((railKey, field, mmValue) => {
        const rails = listUniqueRails(effectiveCustomSupports);
        const rail = rails.find((r) => r.key === railKey);
        if (!rail || !projectData || !Number.isFinite(mmValue) || mmValue < 0) return null;

        let { startX, startY, endX, endY } = rail;
        const orient = getRailOrientation(rail);
        const len = Math.hypot(endX - startX, endY - startY);
        const v = displayMmToModel(mmValue);
        const metrics = getRailEditMetrics(rail);
        if (!metrics) return null;

        switch (field) {
            case 'length':
                if (orient === 'horizontal') {
                    const sign = endX >= startX ? 1 : -1;
                    endX = startX + sign * v;
                    endY = startY;
                } else if (orient === 'vertical') {
                    const sign = endY >= startY ? 1 : -1;
                    endY = startY + sign * v;
                    endX = startX;
                } else if (len > 1e-6) {
                    endX = startX + ((endX - startX) / len) * v;
                    endY = startY + ((endY - startY) / len) * v;
                }
                break;
            case 'left':
                if (orient === 'horizontal') {
                    const sign = endX >= startX ? 1 : -1;
                    startX = metrics.leftAnchor.x + v;
                    endX = startX + sign * len;
                } else {
                    startX = metrics.leftAnchor.x + v;
                    endX = startX;
                }
                break;
            case 'right':
                if (orient === 'horizontal') {
                    const sign = endX >= startX ? 1 : -1;
                    endX = metrics.rightAnchor.x - v;
                    startX = endX - sign * len;
                }
                break;
            case 'top':
                if (orient === 'horizontal') {
                    startY = metrics.topAnchor.y + v;
                    endY = startY;
                } else {
                    const sign = endY >= startY ? 1 : -1;
                    startY = metrics.topAnchor.y + v;
                    endY = startY + sign * len;
                }
                break;
            case 'bottom':
                if (orient === 'vertical') {
                    const sign = endY >= startY ? 1 : -1;
                    const wallY = metrics.stopWallY ?? metrics.bottomAnchor.y;
                    // Offset measured inward from the stop wall (locked at draw time)
                    endY = wallY >= endY ? wallY - v : wallY + v;
                    startY = endY - sign * len;
                } else if (orient === 'horizontal') {
                    startY = metrics.bottomAnchor.y - v;
                    endY = startY;
                }
                break;
            default:
                return null;
        }

        return replaceRailGeometry(railKey, startX, startY, endX, endY, {
            stopWallY: metrics.stopWallY ?? undefined
        });
    }, [
        effectiveCustomSupports,
        listUniqueRails,
        projectData,
        getRailOrientation,
        getRailEditMetrics,
        displayMmToModel,
        replaceRailGeometry
    ]);

    const deleteRailByKey = useCallback((railKey) => {
        const next = effectiveCustomSupports.filter((s) => {
            const sl = s.supportLine;
            if (!sl) return true;
            return aluSupportLineKey(sl.startX, sl.startY, sl.endX, sl.endY) !== railKey;
        });
        updateCustomSupports(next);
    }, [effectiveCustomSupports, aluSupportLineKey, updateCustomSupports]);

    const [selectedRailKey, setSelectedRailKey] = useState(null);
    const [railEditDraft, setRailEditDraft] = useState(null);
    const [supportStartPoint, setSupportStartPoint] = useState(null);
    const [supportPreview, setSupportPreview] = useState(null);
    /** Sync ref so drawCanvas can exit preview immediately after finishing a rail (React state updates are async). */
    const supportDrawModeRef = useRef({
        placing: false,
        mode: null, // 'alu' | 'nylon'
        startPoint: null,
        preview: null,
        nylonPreview: null
    });
    const [supportPlacementMode, setSupportPlacementMode] = useState(null);
    const [selectedNylonKey, setSelectedNylonKey] = useState(null);
    const [nylonEditDraft, setNylonEditDraft] = useState(null);
    /** Line key captured when a hanger is selected — stays fixed while editing so apply-to-line still matches siblings after blur. */
    const [nylonEditFrozenLineKey, setNylonEditFrozenLineKey] = useState(null);
    const [nylonAddTarget, setNylonAddTarget] = useState(null);
    const [nylonAddDraft, setNylonAddDraft] = useState({ offsetLength: '', offsetWidth: '' });
    const [nylonFormError, setNylonFormError] = useState(null);
    const [hoveredRoomId, setHoveredRoomId] = useState(null);

    // [NEW] Local state for checkboxes (copying logic from FloorCanvas)
    const [visibilityState, setVisibilityState] = useState(dimensionVisibility);
    const [isSupportSidebarOpen, setIsSupportSidebarOpen] = useState(true);
    const [isPlanDetailsOpen, setIsPlanDetailsOpen] = useState(false);

    // [NEW] Sync state if parent props change
    useEffect(() => {
        setVisibilityState(dimensionVisibility);
    }, [dimensionVisibility]);

    // Track available drawing space for responsive canvas sizing
    // Canvas size from container width + aspect ratio; max height from viewport so canvas stays a good size (not squeezed)
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
    // Track which dimension VALUES (in mm) have already been drawn in this ceiling plan
    // This keeps the view clean by avoiding duplicate numeric dimensions like multiple "1150" labels.
    const dimensionValuesSeen = useRef(new Set());
    const dimensionKeysScheduled = useRef(new Set());
    
    // Canvas dragging state (separate from support dragging)
    const isDraggingCanvas = useRef(false);
    const lastCanvasMousePos = useRef({ x: 0, y: 0 });
    const hasUserPositionedView = useRef(false); // Track if user has manually positioned the view

    // Canvas dimensions are derived from container size for responsiveness
    const CANVAS_WIDTH = Math.round(canvasSize.width);
    const CANVAS_HEIGHT = Math.round(canvasSize.height);

    // Calculate project bounds for dimension positioning (project boundary)
    // IMPORTANT: Use both projectData and actual room geometry so that if
    // the user draws rooms/walls with negative coordinates (e.g. starting
    // above/left of the origin), the external dimension "frame" follows
    // the real extents instead of forcing 0..width/length and creating
    // large empty gaps.
    const projectBounds = useMemo(() => {
        const hasRooms = effectiveRooms && effectiveRooms.length > 0;

        // If we have rooms, use their actual extents ONLY (including negative coords)
        // so external dimensions hug the true model envelope and don't stick to
        // the 0..projectData.width/length frame.
        if (hasRooms) {
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

            // If for some reason no valid points were found, fall back to projectData
            if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
                if (!projectData) return null;
                return {
                    minX: 0,
                    maxX: projectData.width,
                    minY: 0,
                    maxY: projectData.length
                };
            }

            return { minX, maxX, minY, maxY };
        }

        // If no rooms yet, fall back to project dimensions (0..width/length)
        if (projectData) {
            return {
                minX: 0,
                maxX: projectData.width,
                minY: 0,
                maxY: projectData.length
            };
        }

        return null;
    }, [projectData, effectiveRooms]);

    // Clear dimension placement when ceiling plan data changes so labels re-evaluate (e.g. prefer left)
    useEffect(() => {
        dimensionPlacementMemory.current.clear();
    }, [effectiveCeilingPanelsMap, projectBounds]);

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

    }, [
        effectiveRooms,
        effectiveCeilingPlans,
        effectiveCeilingPanelsMap,
        zones,
        selectedRoomId,
        selectedPanelId,
        selectedPanelIdsList,
        CANVAS_WIDTH,
        CANVAS_HEIGHT,
        visibilityState,
        isPlacingSupport,
        supportPreview,
        supportStartPoint,
        effectiveCustomSupports,
        selectedRailKey,
        selectedNylonKey
    ]);

    useEffect(() => {
        if (!selectedRailKey) {
            setRailEditDraft(null);
            return;
        }
        const rail = listUniqueRails(effectiveCustomSupports).find((r) => r.key === selectedRailKey);
        if (!rail) {
            setSelectedRailKey(null);
            return;
        }
        const metrics = getRailEditMetrics(rail);
        if (!metrics) return;
        setRailEditDraft({
            length: modelToDisplayMm(metrics.length),
            left: modelToDisplayMm(metrics.left),
            right: modelToDisplayMm(metrics.right),
            top: modelToDisplayMm(metrics.top),
            bottom: modelToDisplayMm(metrics.bottom),
            orient: metrics.orient
        });
    }, [selectedRailKey, effectiveCustomSupports, listUniqueRails, getRailEditMetrics, modelToDisplayMm]);

    useEffect(() => {
        if (!selectedRailKey || isPlacingSupport) return undefined;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                setSelectedRailKey(null);
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                deleteRailByKey(selectedRailKey);
                setSelectedRailKey(null);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedRailKey, isPlacingSupport, deleteRailByKey]);

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

        const fit = computePlanFitTransform(
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
            { minX, maxX, minY, maxY },
            { padding: PADDING }
        );

        if (!isZoomed.current) {
            scaleFactor.current = fit.scale;
            setCurrentScale(fit.scale);
        }
        initialScale.current = fit.scale;

        if (!isDraggingCanvas.current) {
            offsetX.current = fit.offsetX;
            offsetY.current = fit.offsetY;
        }
    };

    // Main drawing function
    const drawCanvas = (ctx) => {
        // Clear canvas
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Each redraw should recompute dimension labels from scratch
        // Clear the global dimension-value tracker so we only draw one label per unique size
        if (dimensionValuesSeen.current) {
            dimensionValuesSeen.current.clear();
        }
        dimensionKeysScheduled.current.clear();

        // Draw grid
        drawGrid(ctx);

        // Draw walls first (behind everything else)
        if (walls && walls.length > 0) {
            drawWalls(ctx);
        }

        // Global collision detection - shared across all rooms to prevent overlaps
        const globalPlacedLabels = [];
        const globalAllLabels = [];
        // Collect all dimensions so we can sort by value: smaller inner, larger outer when overlapping
        const dimensionsToDraw = [];

        // PASS 1: Draw all rooms and their ceiling panels (includes dimension LINES only)
        // Draw room outlines first (room names will be added to collision detection)
        if (effectiveRooms && effectiveRooms.length > 0) {
            effectiveRooms.forEach(room => {
                drawRoomOutline(ctx, room, globalPlacedLabels);
            });
        }

        // Then draw panels and collect dimensions (or draw dimensions if not collecting)
        if (effectiveRooms && effectiveRooms.length > 0) {
            effectiveRooms.forEach(room => {
                drawCeilingPanels(ctx, room, globalPlacedLabels, globalAllLabels, dimensionsToDraw);
            });
        }

        const dimensionLanes = createDimensionLaneCounters();

        // Inner panel dims first; room dims last (outermost row), like wall plan project dims
        if (dimensionsToDraw.length > 0) {
            dimensionsToDraw.sort((a, b) =>
                comparePlanDimensionsDrawOrder(a, b, (dim) => {
                    if (dim.isHorizontal !== undefined) return dim.isHorizontal;
                    const dx = dim.endX - dim.startX;
                    const dy = dim.endY - dim.startY;
                    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                    return Math.abs(angle) < 45 || Math.abs(angle) > 135;
                })
            );
            dimensionsToDraw.forEach(({ dimension, bounds }) => {
                drawCeilingDimension(ctx, dimension, bounds, globalPlacedLabels, globalAllLabels, dimensionLanes);
            });
        }

        // Draw merged ceiling zones after individual rooms for overlay
        drawZones(ctx, globalPlacedLabels, globalAllLabels);

        // Custom supports + placement preview — once globally (not per room, avoids stacked/over-thick symbols)
        if (effectiveCustomSupports.length > 0) {
            drawCustomSupports(
                ctx,
                effectiveCustomSupports,
                scaleFactor.current,
                offsetX.current,
                offsetY.current,
                selectedRailKey,
                selectedNylonKey
            );
        }
        const supportDraw = supportDrawModeRef.current;
        const preview = supportDraw.preview;
        if (supportDraw.placing && preview) {
            if (
                supportDraw.startPoint != null &&
                preview.startX != null &&
                preview.startY != null &&
                preview.endX != null &&
                preview.endY != null
            ) {
                drawSupportPreview(ctx, preview, scaleFactor.current, offsetX.current, offsetY.current);
            }
            if (preview.mousePosition && preview.distances) {
                drawMousePositionDimensions(
                    ctx,
                    preview.mousePosition,
                    preview.distances,
                    scaleFactor.current,
                    offsetX.current,
                    offsetY.current
                );
            }
        }
        
        // PASS 2: Draw all dimension text BOXES on top (highest layer)
        globalAllLabels.forEach((label) => {
            const drawFn = label.draw || makeLabelDrawFn(label, scaleFactor.current, initialScale.current);
            drawFn(ctx);
        });

        // Draw title and info
        drawTitle(ctx);
    };

    const clearSupportDrawingMode = (redraw = true) => {
        supportDrawModeRef.current = {
            placing: false,
            mode: null,
            startPoint: null,
            preview: null,
            nylonPreview: null
        };
        setSupportPlacementMode(null);
        setIsPlacingSupport(false);
        setSupportStartPoint(null);
        setSupportPreview(null);
        setNylonAddTarget(null);
        setNylonAddDraft({ offsetLength: '', offsetWidth: '' });
        if (redraw && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) drawCanvas(ctx);
        }
    };

    const beginSupportDrawingMode = () => {
        setSelectedRailKey(null);
        setSelectedNylonKey(null);
        supportDrawModeRef.current = {
            placing: true,
            mode: 'alu',
            startPoint: null,
            preview: null,
            nylonPreview: null
        };
        setSupportPlacementMode('alu');
        setIsPlacingSupport(true);
        setSupportStartPoint(null);
        setSupportPreview(null);
    };

    const getPanelKey = useCallback((panel) => {
        if (!panel) return '';
        const raw = panel.id ?? panel.panel_id ?? panel.panelId ?? null;
        return raw == null ? '' : String(raw);
    }, []);

    const partitionCustomSupports = useCallback((supports) => {
        const list = Array.isArray(supports) ? supports : [];
        const metaEntry = list.find((s) => s?.type === '_nylonMeta') || {
            type: '_nylonMeta',
            suppressedAutoPanelKeys: []
        };
        const nylon = list.filter((s) => s?.type === 'nylon');
        const rest = list.filter((s) => s?.type !== 'nylon' && s?.type !== '_nylonMeta');
        return { meta: metaEntry, nylon, rest };
    }, []);

    const autoNylonSlotKey = useCallback((roomId, panelId) => `${roomId}:${panelId}`, []);

    const nylonHangerKey = useCallback((support) => {
        if (!support) return '';
        if (support.nylonKey) return String(support.nylonKey);
        const pid = support.panel_id ?? '';
        const ol = Math.round(Number(support.offset_length ?? support.y ?? 0));
        const ow = Math.round(Number(support.offset_width ?? support.x ?? 0));
        const tag = support.isAuto && !support.isManual ? 'a' : 'm';
        return `nylon-${support.room_id ?? ''}-${pid}-${ol}-${ow}-${tag}-${support.id ?? ''}`;
    }, []);

    const ensureStableNylonKey = useCallback((support) => {
        if (!support) return support;
        if (support.nylonKey) return support;
        const pid = support.panel_id ?? '';
        const rid = support.room_id ?? '';
        const ol = Math.round(Number(support.offset_length ?? 0));
        const ow = Math.round(Number(support.offset_width ?? 0));
        const x = Math.round(Number(support.x ?? 0));
        const y = Math.round(Number(support.y ?? 0));
        const tag = support.isAuto && !support.isManual ? 'auto' : 'manual';
        return {
            ...support,
            nylonKey: `nylon-${rid}-${pid}-${ol}-${ow}-${tag}-${x}-${y}`
        };
    }, []);

    const resolveNylonSupportByKey = useCallback(
        (key, nylonList) => {
            if (!key || !Array.isArray(nylonList)) return null;
            return (
                nylonList.find(
                    (s) =>
                        (s.nylonKey && String(s.nylonKey) === String(key)) || nylonHangerKey(s) === key
                ) || null
            );
        },
        [nylonHangerKey]
    );

    const getNylonPositionOnPanel = useCallback((panel, offsetLengthMm, offsetWidthMm) => {
        if (!panel) return null;
        const startX = Number(panel.start_x ?? panel.x ?? 0);
        const startY = Number(panel.start_y ?? panel.y ?? 0);
        const width = Number(panel.width ?? 0);
        const length = Number(panel.length ?? 0);
        if (!Number.isFinite(width) || !Number.isFinite(length) || width <= 0 || length <= 0) {
            return null;
        }
        const offLen = Number(offsetLengthMm);
        const offWid =
            offsetWidthMm === '' || offsetWidthMm == null || Number.isNaN(Number(offsetWidthMm))
                ? width / 2
                : Number(offsetWidthMm);
        if (!Number.isFinite(offLen) || offLen < 0 || offLen > length) return null;
        if (!Number.isFinite(offWid) || offWid < 0 || offWid > width) return null;
        return {
            x: startX + offWid,
            y: startY + offLen,
            offset_length: offLen,
            offset_width: offWid,
            panel_width: width,
            panel_length: length
        };
    }, []);

    const panelNeedsNylonSupport = useCallback(
        (panel) => {
            if (!panel) return false;
            const physicalLength = Math.max(Number(panel.width ?? 0), Number(panel.length ?? 0));
            const panelThickness = panel.thickness || ceilingThickness;
            const threshold = panelThickness <= 100 ? 3000 : 6000;
            return physicalLength > threshold;
        },
        [ceilingThickness]
    );

    const findPanelById = useCallback(
        (panelId, roomId) => {
            const pid = String(panelId ?? '');
            if (!pid) return null;
            const match = (p) => {
                const rid = p.room_id ?? p.room;
                if (Number(rid) !== Number(roomId)) return false;
                const ids = [getPanelKey(p), p.panel_id, p.id, p.panelId, p.uuid]
                    .filter((v) => v != null && v !== '')
                    .map(String);
                return ids.includes(pid);
            };
            return allCeilingPanelsForAluPlacement.find(match) || allCeilingPanels.find(match) || null;
        },
        [allCeilingPanelsForAluPlacement, allCeilingPanels, getPanelKey]
    );

    /** Hangers on one "line" share the same length offset; width matches or both centered on panel. */
    const getNylonHangerLineKey = useCallback(
        (support) => {
            if (!support) return '';
            if (support.hangerLineId) return `line:${support.hangerLineId}`;
            if (support.type !== 'nylon') return '';
            const roomId = support.room_id ?? '';
            const ol = Math.round(Number(support.offset_length ?? 0));
            const panel = findPanelById(support.panel_id, support.room_id);
            const w = Number(panel?.width ?? 0);
            const ow = Number(support.offset_width ?? 0);
            const isCenter = w > 0 && Math.abs(ow - w / 2) < 2;
            const widthTag = isCenter ? 'center' : String(Math.round(ow));
            return `${roomId}:${ol}:${widthTag}`;
        },
        [findPanelById]
    );

    const findPanelAtModelPoint = useCallback(
        (modelX, modelY) => {
            for (let i = allCeilingPanelsForAluPlacement.length - 1; i >= 0; i -= 1) {
                const panel = allCeilingPanelsForAluPlacement[i];
                const b = getPanelAxisBounds(panel);
                if (modelX >= b.left && modelX <= b.right && modelY >= b.top && modelY <= b.bottom) {
                    return panel;
                }
            }
            return null;
        },
        [allCeilingPanelsForAluPlacement, getPanelAxisBounds]
    );

    const buildNylonEntryForPanel = useCallback(
        (room, panel, offsetLengthMm, offsetWidthMm, isAuto = false, hangerLineId = null) => {
            const pos = getNylonPositionOnPanel(
                panel,
                offsetLengthMm,
                offsetWidthMm === '' ? null : offsetWidthMm
            );
            if (!pos || !room) return null;
            const panelId = panel.id ?? panel.panel_id ?? null;
            const entry = {
                type: 'nylon',
                nylonKey: `nylon-${room.id}-${panelId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                isAuto: Boolean(isAuto),
                isManual: !isAuto,
                room_id: room.id,
                panel_id: panelId,
                x: pos.x,
                y: pos.y,
                offset_length: pos.offset_length,
                offset_width: pos.offset_width
            };
            if (hangerLineId) entry.hangerLineId = hangerLineId;
            return entry;
        },
        [getNylonPositionOnPanel]
    );

    const listNylonHangers = useCallback(
        () =>
            partitionCustomSupports(effectiveCustomSupports).nylon.map((s) => {
                const withKey = ensureStableNylonKey(s);
                return {
                    ...withKey,
                    key: nylonHangerKey(withKey)
                };
            }),
        [effectiveCustomSupports, partitionCustomSupports, nylonHangerKey, ensureStableNylonKey]
    );

    /** Pick radius in canvas pixels — matches drawn symbol (~75 * scale). */
    const nylonHangerPickRadiusCanvas = useCallback(
        () => Math.max(14, 75 * scaleFactor.current + 6),
        []
    );

    const findNylonKeyAtCanvasPoint = useCallback(
        (canvasX, canvasY, pickRadiusCanvasPx) => {
            const sf = scaleFactor.current;
            const ox = offsetX.current;
            const oy = offsetY.current;
            let bestKey = null;
            let bestDist = pickRadiusCanvasPx;
            listNylonHangers().forEach((h) => {
                if (h.x == null || h.y == null) return;
                const hx = h.x * sf + ox;
                const hy = h.y * sf + oy;
                const d = Math.hypot(canvasX - hx, canvasY - hy);
                if (d < bestDist) {
                    bestDist = d;
                    bestKey = h.key;
                }
            });
            return bestKey;
        },
        [listNylonHangers]
    );

    const getCanvasPointFromEvent = useCallback(
        (e) => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            const rect = canvas.getBoundingClientRect();
            const displayX = e.clientX - rect.left;
            const displayY = e.clientY - rect.top;
            const canvasX = rect.width > 0 ? displayX * (CANVAS_WIDTH / rect.width) : displayX;
            const canvasY = rect.height > 0 ? displayY * (CANVAS_HEIGHT / rect.height) : displayY;
            const modelX = (canvasX - offsetX.current) / scaleFactor.current;
            const modelY = (canvasY - offsetY.current) / scaleFactor.current;
            return { canvasX, canvasY, modelX, modelY };
        },
        [CANVAS_WIDTH, CANVAS_HEIGHT]
    );

    const mergeSupportsWithNylon = useCallback(
        (rest, nylonEntries, meta) => [...rest, ...nylonEntries, meta],
        []
    );

    const autoNylonSyncSignatureRef = useRef('');

    useEffect(() => {
        const { meta, nylon, rest } = partitionCustomSupports(effectiveCustomSupports);
        const suppressed = new Set(meta.suppressedAutoPanelKeys || []);
        const manualNylon = nylon.filter((s) => !(s.isAuto && !s.isManual));
        const autoBySlot = new Map();
        nylon
            .filter((s) => s.isAuto && !s.isManual)
            .forEach((s) => {
                autoBySlot.set(autoNylonSlotKey(s.room_id, s.panel_id), ensureStableNylonKey(s));
            });

        const nextAuto = [];
        if (enableNylonHangers) {
            allCeilingPanelsForAluPlacement.forEach((panel) => {
                const roomId = panel.room_id ?? panel.room;
                const panelId = getPanelKey(panel);
                if (roomId == null || !panelId) return;
                const room = effectiveRooms.find((r) => Number(r.id) === Number(roomId));
                if (!room || room.exclude_from_ceiling) return;
                if (!panelNeedsNylonSupport(panel)) return;
                const slot = autoNylonSlotKey(roomId, panelId);
                if (suppressed.has(slot)) return;
                if (autoBySlot.has(slot)) {
                    nextAuto.push(autoBySlot.get(slot));
                } else {
                    const entry = buildNylonEntryForPanel(room, panel, panel.length / 2, null, true);
                    if (entry) nextAuto.push(entry);
                }
            });
        }

        const currentAuto = nylon.filter((s) => s.isAuto && !s.isManual);
        const desiredAutoSig = nextAuto
            .map(
                (s) =>
                    `${s.room_id}:${s.panel_id}:${Math.round(s.offset_length ?? 0)}:${Math.round(s.offset_width ?? 0)}:${s.nylonKey || ''}`
            )
            .sort()
            .join('|');
        const currentAutoSig = currentAuto
            .map(
                (s) =>
                    `${s.room_id}:${s.panel_id}:${Math.round(s.offset_length ?? 0)}:${Math.round(s.offset_width ?? 0)}:${s.nylonKey || ''}`
            )
            .sort()
            .join('|');
        const manualSig = manualNylon.map((s) => nylonHangerKey(ensureStableNylonKey(s))).sort().join('|');
        const desiredSig = `${enableNylonHangers}:${desiredAutoSig}:${manualSig}`;
        if (desiredSig === autoNylonSyncSignatureRef.current) return;
        if (desiredAutoSig === currentAutoSig) {
            autoNylonSyncSignatureRef.current = desiredSig;
            return;
        }

        autoNylonSyncSignatureRef.current = desiredSig;
        updateCustomSupports(mergeSupportsWithNylon(
            rest,
            [...manualNylon.map(ensureStableNylonKey), ...nextAuto.map(ensureStableNylonKey)],
            meta
        ));
    }, [
        enableNylonHangers,
        allCeilingPanelsForAluPlacement,
        effectiveRooms,
        effectiveCustomSupports,
        partitionCustomSupports,
        autoNylonSlotKey,
        getPanelKey,
        panelNeedsNylonSupport,
        buildNylonEntryForPanel,
        ensureStableNylonKey,
        mergeSupportsWithNylon,
        updateCustomSupports
    ]);

    useEffect(() => {
        if (!selectedNylonKey) {
            setNylonEditFrozenLineKey(null);
            return;
        }
        const { nylon } = partitionCustomSupports(effectiveCustomSupports);
        const hanger = resolveNylonSupportByKey(selectedNylonKey, nylon);
        if (hanger) {
            setNylonEditFrozenLineKey(getNylonHangerLineKey(hanger));
        }
        // Freeze line membership when selection changes only (not when offsets update on blur).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedNylonKey]);

    useEffect(() => {
        if (!selectedNylonKey) {
            setNylonEditDraft(null);
            return;
        }
        const hanger = listNylonHangers().find((h) => h.key === selectedNylonKey);
        if (!hanger) {
            setSelectedNylonKey(null);
            return;
        }
        const panel = findPanelById(hanger.panel_id, hanger.room_id);
        const width = Number(panel?.width ?? hanger.offset_width ?? 0);
        const isCenterWidth =
            hanger.offset_width != null && width > 0 && Math.abs(hanger.offset_width - width / 2) < 1;
        setNylonEditDraft({
            offsetLength: hanger.offset_length != null ? String(Math.round(hanger.offset_length)) : '',
            offsetWidth: isCenterWidth ? '' : String(Math.round(hanger.offset_width ?? 0)),
            isAuto: Boolean(hanger.isAuto && !hanger.isManual),
            roomId: hanger.room_id,
            panelId: hanger.panel_id
        });
    }, [selectedNylonKey, listNylonHangers, findPanelById]);

    const updateNylonPlacement = useCallback(
        (nylonKey, offsetLengthRaw, offsetWidthRaw, scope = 'single', frozenLineKey = null) => {
            const offLen = Number(offsetLengthRaw);
            if (!Number.isFinite(offLen) || offLen < 0) return false;
            const widthRaw = offsetWidthRaw === '' ? null : offsetWidthRaw;

            let updatedCount = 0;
            let skippedCount = 0;
            let hangerRoomId = null;

            updateCustomSupports((prev) => {
                const { meta, nylon, rest } = partitionCustomSupports(prev);
                const stableNylon = nylon.map(ensureStableNylonKey);
                const hanger = resolveNylonSupportByKey(nylonKey, stableNylon);
                if (!hanger) return prev;
                hangerRoomId = hanger.room_id;

                let targets = [hanger];
                if (scope === 'room') {
                    targets = stableNylon.filter((s) => Number(s.room_id) === Number(hanger.room_id));
                } else if (scope === 'line') {
                    const lineKey = frozenLineKey || getNylonHangerLineKey(hanger);
                    targets = stableNylon.filter((s) => getNylonHangerLineKey(s) === lineKey);
                }

                const lineId =
                    scope === 'line'
                        ? hanger.hangerLineId ||
                          targets.find((t) => t.hangerLineId)?.hangerLineId ||
                          `hl-${hanger.room_id}-${Date.now()}`
                        : null;

                let updated = [...stableNylon];
                let changed = false;
                targets.forEach((target) => {
                    const room = effectiveRooms.find((r) => Number(r.id) === Number(target.room_id));
                    const panel = findPanelById(target.panel_id, target.room_id);
                    if (!room || !panel) {
                        skippedCount += 1;
                        return;
                    }
                    const isAutoEntry = Boolean(target.isAuto && !target.isManual);
                    const entry = buildNylonEntryForPanel(
                        room,
                        panel,
                        offLen,
                        widthRaw,
                        isAutoEntry
                    );
                    if (!entry) {
                        skippedCount += 1;
                        return;
                    }
                    const targetKey = target.nylonKey || nylonHangerKey(target);
                    entry.nylonKey = targetKey;
                    entry.isAuto = isAutoEntry;
                    entry.isManual = !isAutoEntry;
                    if (lineId) entry.hangerLineId = lineId;
                    const idx = updated.findIndex((s) => (s.nylonKey || nylonHangerKey(s)) === targetKey);
                    if (idx < 0) {
                        skippedCount += 1;
                        return;
                    }
                    updated = [...updated];
                    updated[idx] = entry;
                    changed = true;
                    updatedCount += 1;
                });

                if (!changed) return prev;
                return mergeSupportsWithNylon(rest, updated, meta);
            });

            if (updatedCount === 0) {
                setNylonFormError(
                    'Could not update hangers. Check that the offset fits each panel on this line.'
                );
                return false;
            }
            if (skippedCount > 0) {
                setNylonFormError(
                    `Updated ${updatedCount} hanger${updatedCount !== 1 ? 's' : ''}; ${skippedCount} skipped (offset out of range or panel not found).`
                );
            } else {
                setNylonFormError(null);
            }
            if (scope === 'line' && updatedCount > 0 && hangerRoomId != null) {
                const widthTag =
                    widthRaw == null || widthRaw === ''
                        ? 'center'
                        : String(Math.round(Number(widthRaw)));
                setNylonEditFrozenLineKey(`${hangerRoomId}:${Math.round(offLen)}:${widthTag}`);
            }
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx) drawCanvas(ctx);
            return true;
        },
        [
            partitionCustomSupports,
            effectiveRooms,
            findPanelById,
            getNylonHangerLineKey,
            buildNylonEntryForPanel,
            nylonHangerKey,
            mergeSupportsWithNylon,
            updateCustomSupports,
            ensureStableNylonKey,
            resolveNylonSupportByKey
        ]
    );

    const deleteNylonByKey = useCallback(
        (nylonKey) => {
            const hanger = listNylonHangers().find((h) => h.key === nylonKey);
            if (!hanger) return;
            const { meta, nylon, rest } = partitionCustomSupports(effectiveCustomSupports);
            let nextMeta = meta;
            if (hanger.isAuto && !hanger.isManual) {
                const slot = autoNylonSlotKey(hanger.room_id, hanger.panel_id);
                nextMeta = {
                    ...meta,
                    suppressedAutoPanelKeys: [...new Set([...(meta.suppressedAutoPanelKeys || []), slot])]
                };
            }
            const nextNylon = nylon.filter((s) => {
                const sKey = s.nylonKey || nylonHangerKey(s);
                return sKey !== nylonKey;
            });
            updateCustomSupports(mergeSupportsWithNylon(rest, nextNylon, nextMeta));
            setSelectedNylonKey(null);
            setNylonFormError(null);
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx) drawCanvas(ctx);
        },
        [
            listNylonHangers,
            partitionCustomSupports,
            effectiveCustomSupports,
            autoNylonSlotKey,
            nylonHangerKey,
            mergeSupportsWithNylon,
            updateCustomSupports
        ]
    );

    const getQualifyingPanelsInRoom = useCallback(
        (roomId) =>
            allCeilingPanelsForAluPlacement.filter((p) => {
                const rid = p.room_id ?? p.room;
                return Number(rid) === Number(roomId) && panelNeedsNylonSupport(p);
            }),
        [allCeilingPanelsForAluPlacement, panelNeedsNylonSupport]
    );

    const commitNylonAddFromForm = useCallback(
        (applyToRoom = false) => {
            if (!nylonAddTarget) return false;
            const offLen = Number(nylonAddDraft.offsetLength);
            if (!Number.isFinite(offLen) || offLen < 0) {
                setNylonFormError('Enter placement on panel length (mm from start).');
                return false;
            }
            const room = effectiveRooms.find((r) => Number(r.id) === Number(nylonAddTarget.roomId));
            if (!room || room.exclude_from_ceiling) {
                setNylonFormError('Room not available for nylon placement.');
                return false;
            }
            const panels = applyToRoom
                ? getQualifyingPanelsInRoom(nylonAddTarget.roomId)
                : [findPanelById(nylonAddTarget.panelId, nylonAddTarget.roomId)].filter(Boolean);
            if (panels.length === 0) {
                setNylonFormError(
                    applyToRoom
                        ? 'No qualifying panels in this room for nylon support.'
                        : 'Panel not found.'
                );
                return false;
            }
            const widthRaw = nylonAddDraft.offsetWidth === '' ? null : nylonAddDraft.offsetWidth;
            const hangerLineId = applyToRoom ? `hl-${room.id}-${Date.now()}` : null;
            const newEntries = [];
            panels.forEach((panel) => {
                const entry = buildNylonEntryForPanel(
                    room,
                    panel,
                    offLen,
                    widthRaw,
                    false,
                    hangerLineId
                );
                if (entry) newEntries.push(entry);
            });
            if (newEntries.length === 0) {
                setNylonFormError('Placement does not fit the panel(s). Check length and width.');
                return false;
            }
            updateCustomSupports((prev) => {
                const { meta, nylon, rest } = partitionCustomSupports(prev);
                return mergeSupportsWithNylon(rest, [...nylon, ...newEntries], meta);
            });
            setNylonAddTarget(null);
            setNylonAddDraft({ offsetLength: '', offsetWidth: '' });
            setNylonFormError(null);
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx) drawCanvas(ctx);
            return true;
        },
        [
            nylonAddTarget,
            nylonAddDraft,
            effectiveRooms,
            getQualifyingPanelsInRoom,
            findPanelById,
            buildNylonEntryForPanel,
            partitionCustomSupports,
            mergeSupportsWithNylon,
            updateCustomSupports
        ]
    );

    const beginNylonAddMode = () => {
        setSelectedRailKey(null);
        setSelectedNylonKey(null);
        setNylonEditDraft(null);
        setNylonAddTarget(null);
        setNylonAddDraft({ offsetLength: '', offsetWidth: '' });
        setNylonFormError(null);
        supportDrawModeRef.current = {
            placing: true,
            mode: 'nylon-add',
            startPoint: null,
            preview: null,
            nylonPreview: null
        };
        setSupportPlacementMode('nylon-add');
        setIsPlacingSupport(true);
        setSupportStartPoint(null);
        setSupportPreview(null);
        setIsSupportSidebarOpen(true);
    };

    const isNylonAddModeActive = () =>
        supportDrawModeRef.current.placing && supportDrawModeRef.current.mode === 'nylon-add';

    const cancelNylonAddFlow = (redraw = true) => {
        setNylonAddTarget(null);
        setNylonAddDraft({ offsetLength: '', offsetWidth: '' });
        setNylonFormError(null);
        clearSupportDrawingMode(redraw);
    };

    const closeSupportSidebar = () => {
        setIsSupportSidebarOpen(false);
        setSelectedNylonKey(null);
        setSelectedRailKey(null);
        setNylonEditFrozenLineKey(null);
        setNylonAddTarget(null);
        setNylonAddDraft({ offsetLength: '', offsetWidth: '' });
        setNylonFormError(null);
        if (isPlacingSupport) {
            clearSupportDrawingMode(false);
        }
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) drawCanvas(ctx);
    };

    const commitNylonEditField = () => {
        if (!selectedNylonKey || !nylonEditDraft) return;
        updateNylonPlacement(
            selectedNylonKey,
            nylonEditDraft.offsetLength,
            nylonEditDraft.offsetWidth,
            'single'
        );
    };

    useEffect(() => {
        if (!selectedNylonKey || isPlacingSupport) return undefined;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                setSelectedNylonKey(null);
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                deleteNylonByKey(selectedNylonKey);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedNylonKey, isPlacingSupport, deleteNylonByKey]);

    const commitRailEditField = (field) => {
        if (!selectedRailKey || !railEditDraft) return;
        const raw = railEditDraft[field];
        const mmValue = typeof raw === 'number' ? raw : parseFloat(raw);
        if (!Number.isFinite(mmValue) || mmValue < 0) return;
        const newKey = applyRailFieldEdit(selectedRailKey, field, mmValue);
        if (newKey) setSelectedRailKey(newKey);
    };

    /** Keep ref + state in sync so drawCanvas sees live preview while placing supports. */
    const syncSupportPreview = (preview) => {
        supportDrawModeRef.current.preview = preview;
        setSupportPreview(preview);
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
                const offsetOpts = buildWallOffsetOptions(wall, effectiveRooms);

                // Calculate offset points for double-line wall
                let { line1, line2 } = calculateOffsetPoints(
                    wall.start_x,
                    wall.start_y,
                    wall.end_x,
                    wall.end_y,
                    gapPixels,
                    center,
                    scaleFactor.current,
                    offsetOpts
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
                
                const getCutLHorizontalExtension = (targetWall) => {
                    if (!targetWall) return null;
                    if (targetWall.ceiling_cut_l_horizontal_extension !== null && targetWall.ceiling_cut_l_horizontal_extension !== undefined) {
                        return Number(targetWall.ceiling_cut_l_horizontal_extension);
                    }
                    const targetThickness = Number(targetWall.thickness || wallThickness);
                    if (targetThickness >= 200) return 125.0;
                    if (targetThickness >= 150) return 100.0;
                    if (targetThickness >= 125) return 75.0;
                    if (targetThickness >= 100) return 75.0;
                    if (targetThickness >= 75) return 50.0;
                    return 50.0;
                };

                const resolveJointShortening = (currentWall, joiningWall, is45CutByIntersection) => {
                    const uses45Cut =
                        is45CutByIntersection ||
                        currentWall?.ceiling_joint_type === 'cut_45' ||
                        joiningWall?.ceiling_joint_type === 'cut_45';
                    if (uses45Cut) {
                        return wallThickness * 2;
                    }

                    const cutLWalls = [currentWall, joiningWall].filter(w => w?.ceiling_joint_type === 'cut_l');
                    if (cutLWalls.length === 0) return 0;

                    const cutLAdjustments = cutLWalls.map((cutLWall) => {
                        const horizontalExtension = Number(getCutLHorizontalExtension(cutLWall));
                        if (!Number.isFinite(horizontalExtension)) return 0;
                        return Math.max(0, horizontalExtension);
                    });
                    return Math.max(0, ...cutLAdjustments);
                };

                // Check start end for corner shortening (45° cut / Cut L)
                let startHasTrim = false;
                let startIsOnLeftSide = false; // true if joining wall is on left side
                let startTrimAdjust = 0;
                
                // Check end end for corner shortening (45° cut / Cut L)
                let endHasTrim = false;
                let endIsOnLeftSide = false;
                let endTrimAdjust = 0;
                
                // Check each intersection to find corner shortening at each endpoint
                intersections.forEach(inter => {
                    if (inter.wall_1 === wall.id || inter.wall_2 === wall.id) {
                        const joiningWallId = inter.wall_1 === wall.id ? inter.wall_2 : inter.wall_1;
                        const joiningWall = walls.find(w => w.id === joiningWallId);
                        const is45CutByIntersection = inter.joining_method === '45_cut';
                        const trimAdjust = resolveJointShortening(wall, joiningWall, is45CutByIntersection);
                        const shouldApplyShortening = trimAdjust > 0;
                        
                        if (joiningWall && shouldApplyShortening) {
                            // Check if this intersection is at start or end
                            const tolerance = 1; // 1mm tolerance
                            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < tolerance;
                            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < tolerance;
                            
                            if (isAtStart) {
                                startHasTrim = true;
                                startTrimAdjust = Math.max(startTrimAdjust, trimAdjust);
                                
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
                                endHasTrim = true;
                                endTrimAdjust = Math.max(endTrimAdjust, trimAdjust);
                                
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
                
                // Make copies of lines for modification
                line1 = [...line1.map(p => ({ ...p }))];
                line2 = [...line2.map(p => ({ ...p }))];
                
                // Shorten at START end
                if (startHasTrim && startTrimAdjust > 0) {
                    // If joining wall is on LEFT side, shorten the LEFT line
                    // If joining wall is on RIGHT side, shorten the RIGHT line
                    if (startIsOnLeftSide) {
                        // Shorten left line at start
                        if (line1IsLeft) {
                            line1[0].x += wallDirX * startTrimAdjust;
                            line1[0].y += wallDirY * startTrimAdjust;
                        } else {
                            line2[0].x += wallDirX * startTrimAdjust;
                            line2[0].y += wallDirY * startTrimAdjust;
                        }
                    } else {
                        // Shorten right line at start
                        if (line1IsLeft) {
                            line2[0].x += wallDirX * startTrimAdjust;
                            line2[0].y += wallDirY * startTrimAdjust;
                        } else {
                            line1[0].x += wallDirX * startTrimAdjust;
                            line1[0].y += wallDirY * startTrimAdjust;
                        }
                    }
                }
                
                // Shorten at END end
                if (endHasTrim && endTrimAdjust > 0) {
                    // If joining wall is on LEFT side, shorten the LEFT line
                    // If joining wall is on RIGHT side, shorten the RIGHT line
                    if (endIsOnLeftSide) {
                        // Shorten left line at end
                        if (line1IsLeft) {
                            line1[1].x -= wallDirX * endTrimAdjust;
                            line1[1].y -= wallDirY * endTrimAdjust;
                        } else {
                            line2[1].x -= wallDirX * endTrimAdjust;
                            line2[1].y -= wallDirY * endTrimAdjust;
                        }
                    } else {
                        // Shorten right line at end
                        if (line1IsLeft) {
                            line2[1].x -= wallDirX * endTrimAdjust;
                            line2[1].y -= wallDirY * endTrimAdjust;
                        } else {
                            line1[1].x -= wallDirX * endTrimAdjust;
                            line1[1].y -= wallDirY * endTrimAdjust;
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
    const drawCeilingPanels = (ctx, room, placedLabels = [], allLabels = [], dimensionCollector = null) => {
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
                // Preserve strong selection colours so picks remain obvious
                const fillColors = ['rgba(37, 99, 235, 0.75)', 'rgba(249, 115, 22, 0.65)'];
                const borderColors = ['#1d4ed8', '#c2410c'];
                const highlightIndex = selectionIndex !== -1 ? selectionIndex : 0;
                ctx.fillStyle = fillColors[highlightIndex] ?? 'rgba(37, 99, 235, 0.75)';
                ctx.strokeStyle = borderColors[highlightIndex] ?? '#1d4ed8';
                ctx.lineWidth = 14 * scaleFactor.current;
            } else {
                // Derive colours from ceiling panel build-up (thickness + finishes), like wall plan
                const finishKey = getCeilingPanelFinishKey(panel);
                const finishColors = ceilingFinishColorMap.get(finishKey);

                // Same hue, different depth for full vs cut panels
                const baseFill = isCutPanel
                    ? (finishColors?.panelFillCut ?? 'rgba(34, 197, 94, 0.7)')
                    : (finishColors?.panelFillFull ?? 'rgba(34, 197, 94, 0.35)');
                const baseStroke = isCutPanel
                    ? (finishColors?.panelStrokeCut ?? '#15803d')
                    : (finishColors?.panelStrokeFull ?? '#22c55e');

                if (shouldDimPanels) {
                    // Dim alpha but keep hue when room is not active
                    ctx.fillStyle = baseFill.replace(/rgba?\(([^)]+)\)/, (match, inner) => {
                        const parts = inner.split(',').map(p => p.trim());
                        if (parts.length === 4) {
                            parts[3] = '0.1';
                            return `rgba(${parts.join(', ')})`;
                        }
                        // If no alpha channel, fall back to a light gray
                        return 'rgba(156, 163, 175, 0.1)';
                    });
                    ctx.strokeStyle = '#9ca3af';
                } else {
                    ctx.fillStyle = baseFill;
                    ctx.strokeStyle = baseStroke;
                }

                ctx.lineWidth = shouldDimPanels
                    ? 5 * scaleFactor.current
                    : (isRoomSelected ? 12 * scaleFactor.current : 10 * scaleFactor.current);
            }

            // === DRAWING LOGIC ===
            ctx.beginPath();

            const panelShapePoints = getPanelShapePoints(panel);

            // 1. CHECK FOR EXACT SHAPE (L-SHAPED PANEL)
            // This is the fix: If shape_points exist, draw the custom polygon
            if (panelShapePoints.length > 2) {
                const p0 = panelShapePoints[0];
                ctx.moveTo(
                    p0.x * scaleFactor.current + offsetX.current,
                    p0.y * scaleFactor.current + offsetY.current
                );
                for (let i = 1; i < panelShapePoints.length; i++) {
                    const p = panelShapePoints[i];
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
            if (isCutPanel && panelShapePoints.length === 0) {
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
            drawEnhancedCeilingDimensions(ctx, room, roomPanels, modelBounds, placedLabels, allLabels, dimensionCollector);
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

    // Enhanced ceiling dimension drawing function (optional dimensionCollector: when set, collect for sort-then-draw so larger value is outer)
    const drawEnhancedCeilingDimensions = (ctx, room, roomPanels, roomModelBounds, placedLabels, allLabels, dimensionCollector = null) => {
        
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
        
        // Draw room-level dimensions first (most important) or collect when dimensionCollector provided
        if (visibilityState.room !== false) {
            if (dimensionCollector) {
                drawRoomDimensions(ctx, room, roomWidth, roomLength, roomBounds, canvasPanelBounds, placedLabels, allLabels, dimensionCollector);
            } else {
                drawRoomDimensions(ctx, room, roomWidth, roomLength, roomBounds, canvasPanelBounds, placedLabels, allLabels);
            }
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
                    if (!isHorizontalOrientation) {
                        drawGroupedPanelDimensions(ctx, panels, dimensionValue, modelBounds, canvasPanelBounds, placedLabels, allLabels, false, roomWidth, roomLength, drawnValuesByLevel, dimensionCollector, room.id);
                    } else {
                        drawGroupedPanelDimensions(ctx, panels, dimensionValue, modelBounds, canvasPanelBounds, placedLabels, allLabels, true, roomWidth, roomLength, drawnValuesByLevel, dimensionCollector, room.id);
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
                            const individualDimension = {
                                startX: panel.start_x,
                                endX: panel.end_x,
                                startY: panel.start_y,
                                endY: panel.end_y,
                                dimension: panelWidth,
                                type: 'individual_panel',
                                color: DIMENSION_CONFIG.COLORS.PANEL_GROUP,
                                priority: 3,
                                avoidArea: projectBounds,
                                quantity: 0,
                                panelLabel: `${panelWidth}`,
                                drawnPositions: drawnPositions,
                                roomId: room.id,
                                dedupId: panel.id != null ? String(panel.id) : ''
                            };
                            scheduleCeilingDimension(
                                individualDimension,
                                projectBounds,
                                dimensionCollector,
                                ctx,
                                placedLabels,
                                allLabels
                            );
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
                            isCut: true,
                            dedupId: panel.id != null ? String(panel.id) : ''
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
                            isCut: true,
                            dedupId: panel.id != null ? String(panel.id) : ''
                        };
                    }
                    
                    scheduleCeilingDimension(
                        cutPanelDimension,
                        projectBounds,
                        dimensionCollector,
                        ctx,
                        placedLabels,
                        allLabels
                    );
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

    // Draw room-level dimensions (optional dimensionCollector: when set, push to collector instead of drawing)
    const drawRoomDimensions = (ctx, room, roomWidth, roomLength, roomBounds, canvasPanelBounds, placedLabels, allLabels, dimensionCollector = null) => {
        const { minX, maxX, minY, maxY } = roomBounds;

        const widthDimension = {
            startX: minX,
            endX: maxX,
            startY: maxY,
            endY: maxY,
            dimension: roomWidth,
            type: 'room_width',
            color: '#1e40af',
            priority: DIMENSION_CONFIG.PRIORITY.ROOM,
            avoidArea: projectBounds,
            drawnPositions: new Set(),
            roomId: room.id
        };

        const lengthDimension = {
            startX: minX,
            endX: minX,
            startY: minY,
            endY: maxY,
            dimension: roomLength,
            type: 'room_length',
            color: '#1e40af',
            priority: DIMENSION_CONFIG.PRIORITY.ROOM,
            avoidArea: projectBounds,
            drawnPositions: new Set(),
            roomId: room.id
        };

        if (dimensionCollector) {
            scheduleCeilingDimension(widthDimension, projectBounds, dimensionCollector, ctx, placedLabels, allLabels);
            scheduleCeilingDimension(lengthDimension, projectBounds, dimensionCollector, ctx, placedLabels, allLabels);
            return;
        }
        scheduleCeilingDimension(widthDimension, projectBounds, null, ctx, placedLabels, allLabels);
        scheduleCeilingDimension(lengthDimension, projectBounds, null, ctx, placedLabels, allLabels);
    };

    // Draw grouped panel dimensions (optional dimensionCollector: when set, push instead of draw)
    const drawGroupedPanelDimensions = (ctx, panels, width, modelBounds, canvasPanelBounds, placedLabels, allLabels, isHorizontal = false, roomWidth = null, roomLength = null, drawnDimensionsByLevel = null, dimensionCollector = null, roomId = null) => {
        const effectiveRoomId =
            roomId != null ? roomId : (panels[0]?.room_id != null ? panels[0].room_id : 'unknown');
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
                        roomId: effectiveRoomId,
                        isHorizontal: false,
                        groupBounds: { minX, maxX, minY, maxY }
                    };
                    if (scheduleCeilingDimension(lengthDimension, projectBounds, dimensionCollector, ctx, placedLabels, allLabels)) {
                        markDimensionDrawnAtLevel(panelLengthValue, centerX, false);
                    }
                }
            } else if (isVerticalPanel) {
                const panelWidthValue = width;
                if (!matchesRoomDimension(panelWidthValue, roomWidth) && !isDimensionDrawnAtLevel(panelWidthValue, centerY, true)) {
                    const widthDimension = {
                        startX: minX,
                        endX: maxX,
                        startY: centerY,
                        endY: centerY,
                        dimension: panelWidthValue,
                        type: 'grouped_width_horizontal',
                        color: DIMENSION_CONFIG.COLORS.PANEL_GROUP,
                        priority: 2,
                        avoidArea: projectBounds,
                        quantity: panels.length,
                        drawnPositions: new Set(),
                        roomId: effectiveRoomId,
                        isHorizontal: true,
                        groupBounds: { minX, maxX, minY, maxY }
                    };
                    if (scheduleCeilingDimension(widthDimension, projectBounds, dimensionCollector, ctx, placedLabels, allLabels)) {
                        markDimensionDrawnAtLevel(panelWidthValue, centerY, true);
                    }
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
                        roomId: effectiveRoomId,
                        isHorizontal: true,
                        groupBounds: { minX, maxX, minY, maxY }
                    };
                    if (scheduleCeilingDimension(widthDimension, projectBounds, dimensionCollector, ctx, placedLabels, allLabels)) {
                        markDimensionDrawnAtLevel(actualPanelWidth, centerY, true);
                    }
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
                        roomId: effectiveRoomId,
                        isHorizontal: false,
                        groupBounds: { minX, maxX, minY, maxY }
                    };
                    if (scheduleCeilingDimension(lengthDimension, projectBounds, dimensionCollector, ctx, placedLabels, allLabels)) {
                        markDimensionDrawnAtLevel(actualPanelLength, centerX, false);
                    }
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

        // Group panels by dimensions (width, length, thickness) and face finishes
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

            // Face finishes for grouping
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
                    panels: [],
                    inner_face_material: intMat,
                    inner_face_thickness: intThk,
                    outer_face_material: extMat,
                    outer_face_thickness: extThk
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

    const generateMaterialsSummary = useCallback(() => {
        const nylonHangers = listNylonHangers();

        const rails = listUniqueRails(effectiveCustomSupports);
        const aluRails = rails.map((rail, index) => {
            const sl = {
                startX: rail.startX,
                startY: rail.startY,
                endX: rail.endX,
                endY: rail.endY,
                stopWallY: rail.stopWallY,
                startWallY: rail.startWallY
            };
            const metrics = getRailEditMetrics(sl);
            const lengthMm = metrics
                ? modelToDisplayMm(metrics.length)
                : modelToDisplayMm(Math.hypot(rail.endX - rail.startX, rail.endY - rail.startY));
            const hangerCount = effectiveCustomSupports.filter((s) => {
                if (!s.isIntersectionPoint || !s.supportLine) return false;
                const rsl = s.supportLine;
                return aluSupportLineKey(rsl.startX, rsl.startY, rsl.endX, rsl.endY) === rail.key;
            }).length;
            return {
                index: index + 1,
                lengthMm: Math.round(lengthMm),
                hangerCount,
                orientation: metrics?.orient ?? getRailOrientation(sl)
            };
        });

        const totalAluHangers = aluRails.reduce((sum, r) => sum + r.hangerCount, 0);
        const totalRailLengthMm = aluRails.reduce((sum, r) => sum + r.lengthMm, 0);

        return {
            nylon: {
                enabled: enableNylonHangers,
                total: nylonHangers.length,
                includeCable: Boolean(nylonHangerOptions?.includeCable),
                includeAccessories: Boolean(nylonHangerOptions?.includeAccessories)
            },
            alu: {
                enabled: enableAluSuspension,
                railCount: aluRails.length,
                totalHangers: totalAluHangers,
                totalRailLengthMm,
                rails: aluRails
            }
        };
    }, [
        listNylonHangers,
        listUniqueRails,
        effectiveCustomSupports,
        getRailEditMetrics,
        modelToDisplayMm,
        aluSupportLineKey,
        getRailOrientation,
        enableNylonHangers,
        enableAluSuspension,
        nylonHangerOptions
    ]);

    const getDimensionText = (dimension, length) => formatPlanDimensionLabel(dimension, length);

    const getCeilingDimensionOrientation = (dimension) => {
        if (dimension.isHorizontal !== undefined) {
            return dimension.isHorizontal;
        }
        const dx = dimension.endX - dimension.startX;
        const dy = dimension.endY - dimension.startY;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return Math.abs(angle) < 45 || Math.abs(angle) > 135;
    };

    const scheduleCeilingDimension = (
        dimension,
        bounds,
        dimensionCollector,
        ctx,
        placedLabels,
        allLabels,
        dimensionLanes = null
    ) => {
        if (typeof dimension.dimension !== 'number') return false;
        const key = planCeilingValueDedupKey(
            dimension.dimension,
            getCeilingDimensionOrientation(dimension)
        );
        if (key && dimensionKeysScheduled.current.has(key)) return false;
        if (key) dimensionKeysScheduled.current.add(key);
        if (dimensionCollector) {
            dimensionCollector.push({ dimension, bounds });
        } else if (ctx) {
            drawCeilingDimension(ctx, dimension, bounds, placedLabels, allLabels, dimensionLanes);
        }
        return true;
    };

    const drawCeilingDimension = (ctx, dimension, bounds, placedLabels, allLabels, dimensionLanes = null) => {
        const { startX, endX, startY, endY, dimension: length, type, color, priority, avoidArea } = dimension;

        const isHorizontal = getCeilingDimensionOrientation(dimension);

        const dedupKey =
            typeof length === 'number' ? planCeilingValueDedupKey(length, isHorizontal) : null;
        const globalDimensionValues = dimensionValuesSeen.current;
        if (dedupKey && globalDimensionValues?.has(dedupKey)) return;
        
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        
        // Create unique key for this dimension to remember placement decision
        const dimensionKey = `${startX.toFixed(2)}_${startY.toFixed(2)}_${endX.toFixed(2)}_${endY.toFixed(2)}_${type || 'default'}`;
        
        // Check if we have a stored placement decision for this dimension
        const storedPlacement = dimensionPlacementMemory.current.get(dimensionKey);
        const lockedSide = storedPlacement ? storedPlacement.side : null;
        
        let labelX;
        let labelY;

        const fontSize = computeWallPlanDimensionFontSize(
            scaleFactor.current,
            initialScale.current
        );
        const dimensionFont = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
        const previousFont = ctx.font;
        ctx.font = dimensionFont;

        const text = getDimensionText(dimension, length);
        const textWidth = ctx.measureText(text).width;

        const planBounds = avoidArea || bounds;
        const gb = dimension.groupBounds;
        const spanMidX = gb ? (gb.minX + gb.maxX) / 2 : midX;
        const spanMidY = gb ? (gb.minY + gb.maxY) / 2 : midY;
        const anchorX = gb ? spanMidX : midX;
        const anchorY = gb ? spanMidY : midY;

        const laneCfg = getPlanDimensionLaneConfig(priority);
        const wallLikeSpacing = DIMENSION_CONFIG.WALL_EXTERNAL_LANE_SPACING;
        const preferredSide =
            !isHorizontal && planBounds && anchorX > (planBounds.minX + planBounds.maxX) / 2
                ? 'side2'
                : null;
        const preferredExteriorSide =
            lockedSide ||
            preferredSide ||
            (planBounds ? getPlanExteriorSide(isHorizontal, anchorX, anchorY, planBounds) : 'side1');

        const { lo: spanLo, hi: spanHi } = getDimensionSpanForLane(dimension, isHorizontal);

        const sf = scaleFactor.current;
        const ox = offsetX.current;
        const oy = offsetY.current;
        const padH = 2;
        const padV = 8;

        let side = lockedSide || preferredExteriorSide;
        if (planBounds) {
            const trialOffset = laneCfg.baseOffset;
            const side1Coords = computeExteriorPlanLabelCoords(
                isHorizontal,
                'side1',
                trialOffset,
                planBounds,
                spanMidX,
                spanMidY,
                sf,
                ox,
                oy
            );
            const side2Coords = computeExteriorPlanLabelCoords(
                isHorizontal,
                'side2',
                trialOffset,
                planBounds,
                spanMidX,
                spanMidY,
                sf,
                ox,
                oy
            );
            const side1Bounds = isHorizontal
                ? calculateHorizontalLabelBounds(side1Coords.labelX, side1Coords.labelY, textWidth, padH, padV)
                : calculateVerticalLabelBounds(side1Coords.labelX, side1Coords.labelY, textWidth, padH, padV);
            const side2Bounds = isHorizontal
                ? calculateHorizontalLabelBounds(side2Coords.labelX, side2Coords.labelY, textWidth, padH, padV)
                : calculateVerticalLabelBounds(side2Coords.labelX, side2Coords.labelY, textWidth, padH, padV);
            side =
                lockedSide ||
                resolveWallExteriorPlacementSide({
                    isHorizontal,
                    wallMidX: spanMidX,
                    wallMidY: spanMidY,
                    modelBounds: planBounds,
                    dimensionLanes,
                    side1Bounds,
                    side2Bounds,
                    placedLabels
                });
        }

        let offsetPx = consumeDimensionLane(
            dimensionLanes,
            isHorizontal,
            side,
            laneCfg.baseOffset,
            wallLikeSpacing,
            spanLo,
            spanHi,
            priority
        );
        const vEdge = !isHorizontal ? getDimensionEdge(false, side) : null;
        offsetPx = applyPlanOuterTierMinOffset(dimensionLanes, vEdge, priority, offsetPx);
        offsetPx = Math.min(offsetPx, laneCfg.maxOffset);

        if (planBounds) {
            const fixedColumnX = getPlanExteriorFixedColumnX(dimensionLanes, vEdge, priority);
            const placed = placeExteriorWallDimensionAvoidingLabels({
                isHorizontal,
                side,
                rowOffsetPx: offsetPx,
                spanLo,
                spanHi,
                anchorX: spanMidX,
                anchorY: spanMidY,
                bounds: planBounds,
                scaleFactor: sf,
                offsetX: ox,
                offsetY: oy,
                textWidth,
                placedLabels,
                paddingH: padH,
                paddingV: padV,
                fixedLabelX: fixedColumnX,
                fontSize
            });
            labelX = placed.labelX;
            labelY = placed.labelY;
            offsetPx = placed.rowOffset;

            if (!isHorizontal && dimensionLanes) {
                rememberPlanExteriorColumnX(dimensionLanes, vEdge, priority, labelX);
                recordPlanInnerTierMaxOffset(dimensionLanes, vEdge, priority, offsetPx);
            }
        } else {
            labelX = spanMidX * sf + ox;
            labelY = spanMidY * sf + oy;
        }

        if (!storedPlacement) {
            dimensionPlacementMemory.current.set(dimensionKey, { side });
        }

        const dxLine = endX - startX;
        const dyLine = endY - startY;
        const angleDeg = Math.atan2(dyLine, dxLine) * (180 / Math.PI);
        const startYScreen = startY * sf + oy;
        const endYScreen = endY * sf + oy;
        if (!isHorizontal) {
            labelY = (startYScreen + endYScreen) / 2;
        }

        const dimSide = isHorizontal
            ? side === 'side1'
                ? 'top'
                : 'bottom'
            : side === 'side1'
                ? 'left'
                : 'right';

        const wallStyleBounds = isHorizontal
            ? calculateHorizontalLabelBounds(labelX, labelY, textWidth, padH, padV)
            : calculateRotatedVerticalDimBounds(
                  exteriorVerticalTextCenterX(labelX, fontSize, dimSide),
                  labelY,
                  textWidth,
                  fontSize,
                  2
              );

        const isValidPosition =
            wallStyleBounds.x >= 0 &&
            wallStyleBounds.y >= 0 &&
            wallStyleBounds.x + wallStyleBounds.width <= CANVAS_WIDTH &&
            wallStyleBounds.y + wallStyleBounds.height <= CANVAS_HEIGHT;

        if (!isValidPosition) {
            ctx.font = previousFont;
            return;
        }

        drawOrthoPlanDimensionGeometryLikeWall(
            ctx,
            {
                startX,
                startY,
                endX,
                endY,
                isHorizontal,
                labelX,
                labelY,
                textWidth,
                color
            },
            sf,
            ox,
            oy,
            bounds
        );

        if (
            isFinite(wallStyleBounds.x) &&
            isFinite(wallStyleBounds.y) &&
            isFinite(wallStyleBounds.width) &&
            isFinite(wallStyleBounds.height) &&
            wallStyleBounds.width > 0 &&
            wallStyleBounds.height > 0
        ) {
            placedLabels.push({
                x: wallStyleBounds.x,
                y: wallStyleBounds.y,
                width: wallStyleBounds.width,
                height: wallStyleBounds.height,
                text,
                type
            });
        }

        if (isHorizontal) {
            allLabels.push({
                x: wallStyleBounds.x,
                y: wallStyleBounds.y,
                width: wallStyleBounds.width,
                height: wallStyleBounds.height,
                side: dimSide,
                text,
                angle: angleDeg,
                type: 'wall',
                textColor: color
            });
        } else {
            allLabels.push(
                buildVerticalPlanLabelEntry(labelX, labelY, textWidth, fontSize, dimSide, text, angleDeg, {
                    type: 'wall',
                    textColor: color
                })
            );
        }

        if (dedupKey) globalDimensionValues?.add(dedupKey);
        ctx.font = previousFont;
    };

    // Draw title and scale HUD (fixed screen px — not tied to plan zoom scaleFactor)
    const drawTitle = (ctx) => {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.fillRect(12, 12, 148, 44);
        ctx.fillStyle = '#374151';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = `bold 14px 'Segoe UI', Arial, sans-serif`;
        ctx.fillText('Ceiling Plan', 20, 20);
        ctx.font = `12px 'Segoe UI', Arial, sans-serif`;
        ctx.fillText(`Scale: ${currentScale.toFixed(2)}x`, 20, 40);
        ctx.restore();
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
        
        // Placing support: clicks only (onClick), not drag-to-pan
        e.preventDefault();
    };

    // Handle mouse move for hover detection
    const handleMouseMoveHover = (e) => {
        // Only disable room hover while actively drawing a support rail (not when supports are merely visible)
        if (isPlacingSupport) {
            return;
        }
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        // Mouse position in displayed (CSS) pixels
        const displayMouseX = e.clientX - rect.left;
        const displayMouseY = e.clientY - rect.top;
        // Convert to canvas logical coordinates (canvas may be stretched: width/height 100%)
        const mouseX = (rect.width > 0) ? displayMouseX * (CANVAS_WIDTH / rect.width) : displayMouseX;
        const mouseY = (rect.height > 0) ? displayMouseY * (CANVAS_HEIGHT / rect.height) : displayMouseY;
        
        // Convert to model coordinates. Drawing uses: canvasY = point.y * scale + offsetY.
        const modelX = (mouseX - offsetX.current) / scaleFactor.current;
        const modelY = (mouseY - offsetY.current) / scaleFactor.current;
        // Use Y-flipped coordinate for hit test: room_points may use Y-up so cursor and polygon Y don't match otherwise
        const modelYForHitTest = (offsetY.current - mouseY) / scaleFactor.current;
        
        // Use Y-flipped point for hit test in case room_points use Y-up convention (fixes wrong-room highlight)
        const testY = modelYForHitTest;

        // Hover: check zones first (drawn on top), then rooms in forward order
        let hoveredZone = null;
        if (zonesAsRooms && zonesAsRooms.length > 0) {
            for (const zoneRoom of zonesAsRooms) {
                if (zoneRoom.room_points && zoneRoom.room_points.length >= 3) {
                    if (isPointInPolygon(modelX, testY, zoneRoom.room_points)) {
                        hoveredZone = zoneRoom;
                        break;
                    }
                }
            }
        }

        // Rooms: first polygon that contains the point (forward order)
        let hoveredRoom = null;
        if (!hoveredZone) {
            for (const room of effectiveRooms) {
                if (room.room_points && room.room_points.length >= 3) {
                    if (isPointInPolygon(modelX, testY, room.room_points)) {
                        hoveredRoom = room;
                        break;
                    }
                }
            }
        }
        
        const newHoverId = hoveredZone ? hoveredZone.id : (hoveredRoom ? hoveredRoom.id : null);
        const hadHover = Boolean(hoveredRoomId);

        if (enableAluSuspension && !isPlacingSupport && effectiveCustomSupports.length > 0) {
            const hoverRail = findRailKeyAtPoint(modelX, modelY, 14 / scaleFactor.current);
            if (hoverRail) {
                canvas.style.cursor = 'pointer';
                return;
            }
        }
        if (!isPlacingSupport && listNylonHangers().length > 0) {
            const hoverNylon = findNylonKeyAtCanvasPoint(
                mouseX,
                mouseY,
                nylonHangerPickRadiusCanvas()
            );
            if (hoverNylon) {
                canvas.style.cursor = 'pointer';
                return;
            }
        }

        if (newHoverId !== hoveredRoomId) {
            if (newHoverId) {
                setHoveredRoomId(newHoverId);
                canvasRef.current.style.cursor = 'pointer';
            } else {
                setHoveredRoomId(null);
                canvasRef.current.style.cursor = isPlacingSupport ? 'crosshair' : 'grab';
            }

            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                drawCanvas(ctx);
            }
        } else if (!newHoverId && hadHover) {
            setHoveredRoomId(null);
            canvasRef.current.style.cursor = isPlacingSupport ? 'crosshair' : 'grab';
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
                drawCanvas(ctx);
            }
        }
    };

    // Check if point is inside polygon (for room hover detection and support checks)
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

    // Minimum distance from a point to the edges of a polygon (in model units, mm)
    const getMinDistanceToPolygonEdges = (x, y, polygon) => {
        if (!polygon || polygon.length < 2) return Infinity;
        
        let minDist = Infinity;
        for (let i = 0; i < polygon.length; i++) {
            const j = (i + 1) % polygon.length;
            const x1 = polygon[i].x;
            const y1 = polygon[i].y;
            const x2 = polygon[j].x;
            const y2 = polygon[j].y;
            
            const dx = x2 - x1;
            const dy = y2 - y1;
            const lengthSq = dx * dx + dy * dy;
            let t = 0;
            if (lengthSq > 0) {
                t = ((x - x1) * dx + (y - y1) * dy) / lengthSq;
                t = Math.max(0, Math.min(1, t));
            }
            
            const projX = x1 + t * dx;
            const projY = y1 + t * dy;
            const dist = Math.hypot(x - projX, y - projY);
            if (dist < minDist) {
                minDist = dist;
            }
        }
        return minDist;
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
        if (supportDrawModeRef.current.mode !== 'alu' || !supportDrawModeRef.current.startPoint) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        // Convert to model coordinates
        let modelX = (currentX - offsetX.current) / scaleFactor.current;
        let modelY = (currentY - offsetY.current) / scaleFactor.current;

        const startPt = supportDrawModeRef.current.startPoint;
        const snappedCoords = finalizeAluRailEnd(startPt.x, startPt.y, modelX, modelY);
        
        const nextPreview = {
            startX: startPt.x,
            startY: startPt.y,
            endX: snappedCoords.x,
            endY: snappedCoords.y,
            originalEndX: modelX,
            originalEndY: modelY,
            isSnapped: snappedCoords.isSnapped,
            mousePosition: { x: modelX, y: modelY }
        };

        if (projectData) {
            nextPreview.distances = calculateDistancesToEdges(snappedCoords.x, snappedCoords.y);
        }

        syncSupportPreview(nextPreview);

        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            drawCanvas(ctx);
        }
    };

    // Snap rail end to horizontal or vertical (90°). Alu rails always use forceOrtho.
    const snapTo90Degrees = (startX, startY, endX, endY, forceOrtho = false) => {
        const deltaX = Math.abs(endX - startX);
        const deltaY = Math.abs(endY - startY);

        if (forceOrtho || deltaX === deltaY) {
            if (deltaX >= deltaY) {
                return { x: endX, y: startY, isSnapped: 'horizontal' };
            }
            return { x: startX, y: endY, isSnapped: 'vertical' };
        }

        const snapThreshold = 0.3;
        if (deltaX < deltaY * snapThreshold) {
            return { x: startX, y: endY, isSnapped: 'vertical' };
        }
        if (deltaY < deltaX * snapThreshold) {
            return { x: endX, y: startY, isSnapped: 'horizontal' };
        }
        return { x: endX, y: endY, isSnapped: false };
    };

    /** Ortho lock (H/V) then snap the free end to the nearest wall centerline. */
    const finalizeAluRailEnd = (startX, startY, endX, endY) => {
        const ortho = snapTo90Degrees(startX, startY, endX, endY, true);
        if (ortho.isSnapped === 'vertical') {
            const wallSnap = snapPointToNearestWall(startX, ortho.y);
            return {
                x: startX,
                y: wallSnap ? wallSnap.y : ortho.y,
                isSnapped: 'vertical'
            };
        }
        if (ortho.isSnapped === 'horizontal') {
            const wallSnap = snapPointToNearestWall(ortho.x, startY);
            return {
                x: wallSnap ? wallSnap.x : ortho.x,
                y: startY,
                isSnapped: 'horizontal'
            };
        }
        const wallSnap = snapPointToNearestWall(ortho.x, ortho.y);
        if (wallSnap) {
            return { x: wallSnap.x, y: wallSnap.y, isSnapped: ortho.isSnapped };
        }
        return ortho;
    };

    // Handle mouse move for dimension display (only when placing alu support)
    const handleMouseMoveDimensions = (e) => {
        if (!supportDrawModeRef.current.placing || supportDrawModeRef.current.mode !== 'alu') return;

        const rect = canvasRef.current.getBoundingClientRect();
        const displayMouseX = e.clientX - rect.left;
        const displayMouseY = e.clientY - rect.top;
        const currentX = (rect.width > 0) ? displayMouseX * (CANVAS_WIDTH / rect.width) : displayMouseX;
        const currentY = (rect.height > 0) ? displayMouseY * (CANVAS_HEIGHT / rect.height) : displayMouseY;

        let modelX = (currentX - offsetX.current) / scaleFactor.current;
        let modelY = (currentY - offsetY.current) / scaleFactor.current;

        if (projectData) {
            const snapThreshold = 100 / modelUnitsPerMm; // 100mm threshold for snapping
            
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

        const wallSnapForDims = snapPointToNearestWall(modelX, modelY);
        if (wallSnapForDims) {
            modelX = wallSnapForDims.x;
            modelY = wallSnapForDims.y;
        }
        
        if (projectData) {
            const distances = calculateDistancesToEdges(modelX, modelY);
            const nextPreview = {
                ...(supportDrawModeRef.current.preview ?? {}),
                mousePosition: { x: modelX, y: modelY },
                distances
            };
            syncSupportPreview(nextPreview);
        }

        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            drawCanvas(ctx);
        }
    };

    // Distances to nearest wall faces (fallback: project bounds) — used while drawing
    const calculateDistancesToEdges = useCallback((x, y) => {
        if (!projectData) return null;
        const d = getWallFaceDistances(x, y);
        return {
            left: d.left,
            right: d.right,
            top: d.top,
            bottom: d.bottom,
            leftAnchor: d.leftAnchor,
            rightAnchor: d.rightAnchor,
            topAnchor: d.topAnchor,
            bottomAnchor: d.bottomAnchor
        };
    }, [projectData, getWallFaceDistances]);

    // Snap alu support points to the nearest wall centerline (middle of wall thickness).
    const snapPointToNearestWall = useCallback((x, y) => {
        if (!Array.isArray(walls) || walls.length === 0) return null;

        const snapThreshold = 350 / modelUnitsPerMm;
        let best = null;

        const projectPointToSegment = (px, py, ax, ay, bx, by) => {
            const vx = bx - ax;
            const vy = by - ay;
            const segLenSq = vx * vx + vy * vy;
            if (segLenSq < 1e-9) return null;
            const tRaw = ((px - ax) * vx + (py - ay) * vy) / segLenSq;
            const t = Math.max(0, Math.min(1, tRaw));
            return { x: ax + vx * t, y: ay + vy * t };
        };

        walls.forEach((wall) => {
            const x1 = wall.start_x ?? wall.x1 ?? wall.x_start;
            const y1 = wall.start_y ?? wall.y1 ?? wall.y_start;
            const x2 = wall.end_x ?? wall.x2 ?? wall.x_end;
            const y2 = wall.end_y ?? wall.y2 ?? wall.y_end;
            if (![x1, y1, x2, y2].every(Number.isFinite)) return;

            const p = projectPointToSegment(x, y, x1, y1, x2, y2);
            if (!p) return;

            const dist = Math.hypot(p.x - x, p.y - y);
            if (dist <= snapThreshold && (!best || dist < best.dist)) {
                best = { x: p.x, y: p.y, dist };
            }
        });

        return best ? { x: best.x, y: best.y } : null;
    }, [walls, modelUnitsPerMm]);

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
        
        const pt = getCanvasPointFromEvent(e);
        if (!pt) return;
        const { canvasX, canvasY, modelX, modelY } = pt;

        const hitThreshold = 14 / scaleFactor.current;
        const nylonPickR = nylonHangerPickRadiusCanvas();

        if (isNylonAddModeActive()) {
            const panel = findPanelAtModelPoint(modelX, modelY);
            if (panel) {
                const roomId = panel.room_id ?? panel.room;
                setNylonAddTarget({
                    roomId,
                    panelId: getPanelKey(panel)
                });
                setNylonAddDraft({ offsetLength: '', offsetWidth: '' });
                setNylonFormError(null);
                setIsSupportSidebarOpen(true);
                supportDrawModeRef.current = {
                    placing: false,
                    mode: null,
                    startPoint: null,
                    preview: null,
                    nylonPreview: null
                };
                setSupportPlacementMode(null);
                setIsPlacingSupport(false);
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) drawCanvas(ctx);
            }
            return;
        }

        if (isPlacingSupport && supportPlacementMode === 'nylon-add') {
            return;
        }

        if (!isPlacingSupport && listNylonHangers().length > 0) {
            const nylonKey = findNylonKeyAtCanvasPoint(canvasX, canvasY, nylonPickR);
            if (nylonKey) {
                setSelectedNylonKey(nylonKey);
                setSelectedRailKey(null);
                setNylonAddTarget(null);
                setIsSupportSidebarOpen(true);
                onPanelSelect?.(null);
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) drawCanvas(ctx);
                return;
            }
            if (selectedNylonKey) {
                setSelectedNylonKey(null);
            }
        }

        if (enableAluSuspension && !isPlacingSupport && effectiveCustomSupports.length > 0) {
            const railKey = findRailKeyAtPoint(modelX, modelY, hitThreshold);
            if (railKey) {
                setSelectedRailKey(railKey);
                setSelectedNylonKey(null);
                setIsSupportSidebarOpen(true);
                onPanelSelect?.(null);
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) drawCanvas(ctx);
                return;
            }
            if (selectedRailKey) {
                setSelectedRailKey(null);
            }
        }
        
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
        if (!isPlacingSupport) {
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
                    
                    if (panelIdentifier && canvasX >= x && canvasX <= x + width && canvasY >= y && canvasY <= y + height) {
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
                        
                        if (panelIdentifier && canvasX >= x && canvasX <= x + width && canvasY >= y && canvasY <= y + (height || (panelLengthRaw || 0) * scaleFactor.current)) {
                            clickedPanel = panelIdentifier;
                            clickedPanelZone = zoneRoom;
                            break;
                        }
                    }
                    if (clickedPanel) break;
                }
            }
        }

        // While placing supports, defer room/panel selection to placement handler
        if (!isPlacingSupport) {
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
        
        // If custom alu support placement mode is active, handle rail placement
        if (enableAluSuspension && isPlacingSupport && supportPlacementMode === 'alu') {
            
            // Apply boundary snapping for support placement
            let snappedModelX = modelX;
            let snappedModelY = modelY;
            if (projectData) {
                const snapThreshold = 100 / modelUnitsPerMm; // 100mm threshold for snapping
                
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

            const wallSnap = snapPointToNearestWall(snappedModelX, snappedModelY);
            if (wallSnap) {
                snappedModelX = wallSnap.x;
                snappedModelY = wallSnap.y;
            }
            
            const railStart = supportDrawModeRef.current.startPoint ?? supportStartPoint;
            if (!railStart) {
                const start = { x: snappedModelX, y: snappedModelY };
                const preview = {
                    startX: snappedModelX,
                    startY: snappedModelY,
                    endX: snappedModelX,
                    endY: snappedModelY
                };
                supportDrawModeRef.current.startPoint = start;
                syncSupportPreview(preview);
                setSupportStartPoint(start);
                const ctx = canvasRef.current?.getContext('2d');
                if (ctx) drawCanvas(ctx);
            } else {
                const snappedCoords = finalizeAluRailEnd(
                    railStart.x,
                    railStart.y,
                    snappedModelX,
                    snappedModelY
                );
                const finalEndX = snappedCoords.x;
                const finalEndY = snappedCoords.y;

                const placementKeys = new Set();
                const quantizeStep = 5 / modelUnitsPerMm;
                const placementKey = (x, y) =>
                    `${Math.round(x / quantizeStep) * quantizeStep},${Math.round(y / quantizeStep) * quantizeStep}`;
                const stopWall = findNearestHorizontalWallCenterline(finalEndX, finalEndY);
                const startWall = findNearestHorizontalWallCenterline(railStart.x, railStart.y);
                const supportLinePayload = {
                    startX: railStart.x,
                    startY: railStart.y,
                    endX: finalEndX,
                    endY: finalEndY,
                    isSnapped: snappedCoords.isSnapped,
                    stopWallY: stopWall?.wallY,
                    startWallY: startWall?.wallY
                };

                const newSupports = buildAluHangersAlongRail(
                    railStart.x,
                    railStart.y,
                    finalEndX,
                    finalEndY,
                    supportLinePayload,
                    supportType,
                    placementKey,
                    placementKeys
                );

                updateCustomSupports([...effectiveCustomSupports, ...newSupports]);
                setSelectedRailKey(aluSupportLineKey(railStart.x, railStart.y, finalEndX, finalEndY));
                clearSupportDrawingMode(true);
            }
            return;
        }
        // Clicked on empty space, deselect
        onPanelSelect?.(null);
    };

    const drawNylonHangerAtModelPoint = (ctx, modelX, modelY, scaleFactor, offsetX, offsetY, options = {}) => {
        const { preview = false, selected = false } = options;
        const canvasX = modelX * scaleFactor + offsetX;
        const canvasY = modelY * scaleFactor + offsetY;
        const mainR = Math.max(2, 75 * scaleFactor);
        const lineW = Math.max(0.8, preview ? 20 * scaleFactor : 30 * scaleFactor);

        ctx.save();
        if (selected) {
            ctx.beginPath();
            ctx.arc(canvasX, canvasY, mainR + Math.max(4, 10 * scaleFactor), 0, 2 * Math.PI);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = Math.max(1.2, 3 * scaleFactor);
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, mainR, 0, 2 * Math.PI);
        ctx.strokeStyle = preview ? 'rgba(239, 68, 68, 0.55)' : selected ? '#dc2626' : '#ef4444';
        ctx.lineWidth = lineW;
        if (preview) ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (nylonHangerOptions?.includeAccessories) {
            ctx.beginPath();
            ctx.arc(canvasX, canvasY, Math.max(1.2, 45 * scaleFactor), 0, 2 * Math.PI);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = Math.max(0.6, 2 * scaleFactor);
            ctx.stroke();
        }
        if (nylonHangerOptions?.includeCable) {
            ctx.beginPath();
            ctx.moveTo(canvasX, canvasY + 35 * scaleFactor);
            ctx.lineTo(canvasX, canvasY + 60 * scaleFactor);
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = Math.max(0.8, 3 * scaleFactor);
            ctx.stroke();
        }
        ctx.restore();
    };

    /** Alu hanger marker only (rail is drawn separately). */
    const drawAluHangerAtCenter = (ctx, cxModel, cyModel, angleRad, scaleFactor, offsetX, offsetY) => {
        const canvasX = cxModel * scaleFactor + offsetX;
        const canvasY = cyModel * scaleFactor + offsetY;
        const clipHalf = Math.max(4, 7 * scaleFactor);
        const sin = Math.sin(angleRad);
        const px = -sin;
        const py = Math.cos(angleRad);

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.strokeStyle = '#6d28d9';
        ctx.lineWidth = Math.max(1.1, 1.5 * scaleFactor);
        ctx.beginPath();
        ctx.moveTo(canvasX - px * clipHalf, canvasY - py * clipHalf);
        ctx.lineTo(canvasX + px * clipHalf, canvasY + py * clipHalf);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#5b21b6';
        ctx.lineWidth = Math.max(0.8, 1.1 * scaleFactor);
        const cr = Math.max(1.8, 2.6 * scaleFactor);
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, cr, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    };

    const drawAluSuspension = (ctx, panel, scaleFactor, offsetX, offsetY) => {
        const sx = panel.start_x ?? panel.x ?? 0;
        const sy = panel.start_y ?? panel.y ?? 0;
        const w = panel.width ?? 0;
        const len = panel.length ?? 0;
        const cx = sx + w / 2;
        const cy = sy + len / 2;
        const angle = w >= len ? 0 : Math.PI / 2;
        drawAluHangerAtCenter(ctx, cx, cy, angle, scaleFactor, offsetX, offsetY);
    };

    const drawSelectedRailDimensions = (ctx, sl, scaleFactor, offsetX, offsetY) => {
        if (!projectData || !sl) return;
        const metrics = getRailEditMetrics(sl);
        if (!metrics) return;

        const mm = (modelDist) => modelToDisplayMm(modelDist);
        const minShow = 1 / modelUnitsPerMm; // hide dims under ~1mm

        const drawDim = (ax, ay, bx, by, modelDist) => {
            if (modelDist < minShow) return;
            drawDistanceDimension(
                ctx, ax, ay, bx, by, mm(modelDist),
                'selected', scaleFactor, offsetX, offsetY, '#d97706'
            );
        };

        // Rail length — label offset beside the line (not on top of hangers)
        const midX = (sl.startX + sl.endX) / 2;
        const midY = (sl.startY + sl.endY) / 2;
        const lenOffset = 80 / modelUnitsPerMm;
        if (metrics.orient === 'vertical') {
            drawDim(midX + lenOffset, sl.startY, midX + lenOffset, sl.endY, metrics.length);
        } else if (metrics.orient === 'horizontal') {
            drawDim(sl.startX, midY + lenOffset, sl.endX, midY + lenOffset, metrics.length);
        } else {
            drawDim(sl.startX, sl.startY, sl.endX, sl.endY, metrics.length);
        }

        if (metrics.orient === 'horizontal') {
            drawDim(metrics.leftAnchor.x, sl.startY, sl.startX, sl.startY, metrics.left);
            drawDim(sl.endX, sl.endY, metrics.rightAnchor.x, sl.endY, metrics.right);
            drawDim(sl.startX, metrics.topAnchor.y, sl.startX, sl.startY, metrics.top);
        } else if (metrics.orient === 'vertical') {
            drawDim(metrics.leftAnchor.x, sl.startY, sl.startX, sl.startY, metrics.left);
            drawDim(sl.startX, metrics.topAnchor.y, sl.startX, sl.startY, metrics.top);
            const stopY = metrics.stopWallY ?? metrics.bottomAnchor.y;
            drawDim(sl.endX, sl.endY, sl.endX, stopY, metrics.bottom);
        }

        const cStartX = sl.startX * scaleFactor + offsetX;
        const cStartY = sl.startY * scaleFactor + offsetY;
        const cEndX = sl.endX * scaleFactor + offsetX;
        const cEndY = sl.endY * scaleFactor + offsetY;
        ctx.save();
        ctx.fillStyle = '#f59e0b';
        [cStartX, cEndX].forEach((cx, i) => {
            const cy = i === 0 ? cStartY : cEndY;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(6, 8 * scaleFactor), 0, 2 * Math.PI);
            ctx.fill();
        });
        ctx.restore();
    };

    const drawCustomSupports = (ctx, supports, scaleFactor, offsetX, offsetY, selectedRailKeyArg = null, selectedNylonKeyArg = null) => {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const drawnRails = new Set();
        supports.forEach(support => {
            const sl = support.supportLine;
            if (!sl) return;
            const key = aluSupportLineKey(sl.startX, sl.startY, sl.endX, sl.endY);
            if (drawnRails.has(key)) return;
            drawnRails.add(key);
            const isSelected = selectedRailKeyArg && key === selectedRailKeyArg;
            const x1 = sl.startX * scaleFactor + offsetX;
            const y1 = sl.startY * scaleFactor + offsetY;
            const x2 = sl.endX * scaleFactor + offsetX;
            const y2 = sl.endY * scaleFactor + offsetY;
            ctx.strokeStyle = isSelected ? 'rgba(245, 158, 11, 0.35)' : 'rgba(91, 33, 182, 0.2)';
            ctx.lineWidth = Math.max(isSelected ? 2.4 : 1.8, (isSelected ? 4 : 3) * scaleFactor);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.strokeStyle = isSelected ? '#d97706' : '#5b21b6';
            ctx.lineWidth = Math.max(1, (isSelected ? 2 : 1.4) * scaleFactor);
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            if (isSelected) {
                drawSelectedRailDimensions(ctx, sl, scaleFactor, offsetX, offsetY);
            }
        });

        supports.forEach(support => {
            if (support.isIntersectionPoint) {
                if (support.x == null || support.y == null) return;
                let angle = 0;
                if (support.supportLine) {
                    const sl = support.supportLine;
                    angle = Math.atan2(sl.endY - sl.startY, sl.endX - sl.startX);
                }
                drawAluHangerAtCenter(ctx, support.x, support.y, angle, scaleFactor, offsetX, offsetY);
            } else if (support.type === 'alu') {
                drawAluSuspension(ctx, support, scaleFactor, offsetX, offsetY);
            } else if (support.type === 'nylon') {
                const hangerKey = nylonHangerKey(support);
                const isNylonSelected = selectedNylonKeyArg && hangerKey === selectedNylonKeyArg;
                if (support.x != null && support.y != null) {
                    drawNylonHangerAtModelPoint(
                        ctx,
                        support.x,
                        support.y,
                        scaleFactor,
                        offsetX,
                        offsetY,
                        { selected: isNylonSelected }
                    );
                }
            }
        });
        ctx.restore();
    };

    const drawSupportPreview = (ctx, preview, scaleFactor, offsetX, offsetY) => {
        const sf = scaleFactor;
        const cStartX = preview.startX * sf + offsetX;
        const cStartY = preview.startY * sf + offsetY;
        const cEndX = preview.endX * sf + offsetX;
        const cEndY = preview.endY * sf + offsetY;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(91, 33, 182, 0.55)';
        ctx.lineWidth = Math.max(1, 1.3 * sf);
        ctx.setLineDash([Math.max(8, 12 * sf), Math.max(4, 7 * sf)]);
        ctx.beginPath();
        ctx.moveTo(cStartX, cStartY);
        ctx.lineTo(cEndX, cEndY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#5b21b6';
        ctx.beginPath();
        ctx.arc(cStartX, cStartY, Math.max(5, 7 * sf), 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#a78bfa';
        ctx.beginPath();
        ctx.arc(cEndX, cEndY, Math.max(4, 6 * sf), 0, 2 * Math.PI);
        ctx.fill();

        if (preview.isSnapped === 'horizontal' || preview.isSnapped === 'vertical') {
            ctx.font = `bold ${Math.max(12, 14 * sf)}px 'Segoe UI', Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const midX = (cStartX + cEndX) / 2;
            const midY = (cStartY + cEndY) / 2;
            const text = preview.isSnapped === 'horizontal' ? 'H' : 'V';
            const textWidth = ctx.measureText(text).width;
            const padding = 4;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fillRect(midX - textWidth / 2 - padding, midY - 8 - padding, textWidth + padding * 2, 16 + padding * 2);
            ctx.fillStyle = '#10b981';
            ctx.fillText(text, midX, midY);
        }

        if (preview.distances && projectData) {
            const mx = preview.endX;
            const my = preview.endY;
            const d = preview.distances;
            const toMm = (val) => Math.round(val * modelUnitsPerMm);
            if (d.left > 0 && d.leftAnchor) {
                drawDistanceDimension(ctx, d.leftAnchor.x, d.leftAnchor.y, mx, my,
                    toMm(d.left), 'left', scaleFactor, offsetX, offsetY);
            }
            if (d.right > 0 && d.rightAnchor) {
                drawDistanceDimension(ctx, mx, my, d.rightAnchor.x, d.rightAnchor.y,
                    toMm(d.right), 'right', scaleFactor, offsetX, offsetY);
            }
            if (d.top > 0 && d.topAnchor) {
                drawDistanceDimension(ctx, d.topAnchor.x, d.topAnchor.y, mx, my,
                    toMm(d.top), 'top', scaleFactor, offsetX, offsetY);
            }
            if (d.bottom > 0 && d.bottomAnchor) {
                drawDistanceDimension(ctx, mx, my, d.bottomAnchor.x, d.bottomAnchor.y,
                    toMm(d.bottom), 'bottom', scaleFactor, offsetX, offsetY);
            }
        }
        ctx.restore();
    };

    // Draw distance dimension line
    const drawDistanceDimension = (ctx, x1, y1, x2, y2, distance, edge, scaleFactor, offsetX, offsetY, color = '#10b981') => {
        const canvasX1 = x1 * scaleFactor + offsetX;
        const canvasY1 = y1 * scaleFactor + offsetY;
        const canvasX2 = x2 * scaleFactor + offsetX;
        const canvasY2 = y2 * scaleFactor + offsetY;
        
        // Draw dimension line
        ctx.strokeStyle = color;
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
        
        ctx.font = `bold ${Math.max(10, 12 * scaleFactor)}px 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Add background for better readability
        const text = `${distance}`;
        const textWidth = ctx.measureText(text).width;
        const padding = 4;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(midX - textWidth/2 - padding, midY - 8 - padding, textWidth + padding*2, 16 + padding*2);
        
        ctx.fillStyle = color;
        ctx.fillText(text, midX, midY);
    };

    // Draw mouse position dimensions (always visible)
    const drawMousePositionDimensions = (ctx, mousePos, distances, scaleFactor, offsetX, offsetY) => {
        const mouseX = mousePos.x * scaleFactor + offsetX;
        const mouseY = mousePos.y * scaleFactor + offsetY;
        
        const toMm = (val) => Math.round(val * modelUnitsPerMm);
        if (distances.left > 0 && distances.leftAnchor) {
            drawDistanceDimension(ctx, distances.leftAnchor.x, distances.leftAnchor.y, mousePos.x, mousePos.y,
                toMm(distances.left), 'left', scaleFactor, offsetX, offsetY);
        }
        if (distances.right > 0 && distances.rightAnchor) {
            drawDistanceDimension(ctx, mousePos.x, mousePos.y, distances.rightAnchor.x, distances.rightAnchor.y,
                toMm(distances.right), 'right', scaleFactor, offsetX, offsetY);
        }
        if (distances.top > 0 && distances.topAnchor) {
            drawDistanceDimension(ctx, distances.topAnchor.x, distances.topAnchor.y, mousePos.x, mousePos.y,
                toMm(distances.top), 'top', scaleFactor, offsetX, offsetY);
        }
        if (distances.bottom > 0 && distances.bottomAnchor) {
            drawDistanceDimension(ctx, mousePos.x, mousePos.y, distances.bottomAnchor.x, distances.bottomAnchor.y,
                toMm(distances.bottom), 'bottom', scaleFactor, offsetX, offsetY);
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

    const railEditFields = useMemo(() => {
        if (!railEditDraft) return [];
        return [
            { field: 'length', label: 'Rail length' },
            { field: 'left', label: 'From start wall (left)' },
            ...(railEditDraft.orient === 'horizontal'
                ? [
                    { field: 'right', label: 'From stop wall (right)' },
                    { field: 'top', label: 'From top wall' }
                ]
                : railEditDraft.orient === 'vertical'
                    ? [
                        { field: 'top', label: 'From start wall (top)' },
                        { field: 'bottom', label: 'From stop wall (bottom)' }
                    ]
                    : [
                        { field: 'right', label: 'From stop wall (right)' },
                        { field: 'top', label: 'From start wall (top)' },
                        { field: 'bottom', label: 'From stop wall (bottom)' }
                    ])
        ];
    }, [railEditDraft]);

    const renderNylonEditPanel = (wrapperClassName = '') => {
        if (!selectedNylonKey || !nylonEditDraft || isPlacingSupport) return null;
        const panel = findPanelById(nylonEditDraft.panelId, nylonEditDraft.roomId);
        const panelLength = panel ? Math.round(Number(panel.length ?? 0)) : null;
        const panelWidth = panel ? Math.round(Number(panel.width ?? 0)) : null;
        const selectedHanger = listNylonHangers().find((h) => h.key === selectedNylonKey);
        const lineKeyForUi =
            nylonEditFrozenLineKey ||
            (selectedHanger ? getNylonHangerLineKey(selectedHanger) : '');
        const lineHangers = lineKeyForUi
            ? listNylonHangers().filter((h) => getNylonHangerLineKey(h) === lineKeyForUi)
            : [];
        const lineHangerCount = lineHangers.length;
        const roomHangerCount = listNylonHangers().filter(
            (h) => Number(h.room_id) === Number(nylonEditDraft.roomId)
        ).length;
        const lineOffsetLabel = (() => {
            if (lineKeyForUi.startsWith('line:')) return 'same batch line';
            const parts = lineKeyForUi.split(':');
            if (parts.length >= 2 && parts[1]) return `length ${parts[1]} mm`;
            if (selectedHanger?.offset_length != null) {
                return `length ${Math.round(selectedHanger.offset_length)} mm`;
            }
            return '';
        })();
        const lineWidthLabel = (() => {
            if (lineKeyForUi.startsWith('line:')) return '';
            const parts = lineKeyForUi.split(':');
            if (parts.length >= 3) {
                if (parts[2] === 'center') return ', width center';
                return `, width ${parts[2]} mm`;
            }
            if (!selectedHanger || selectedHanger.offset_width == null) return '';
            const wPanel = findPanelById(selectedHanger.panel_id, selectedHanger.room_id);
            const w = Number(wPanel?.width ?? 0);
            const ow = Number(selectedHanger.offset_width);
            if (w > 0 && Math.abs(ow - w / 2) < 2) return ', width center';
            return `, width ${Math.round(ow)} mm`;
        })();

        return (
            <div className={`text-left ${wrapperClassName}`}>
                <div className="mb-3">
                    <h4 className="text-sm font-semibold text-red-900">Edit nylon hanger</h4>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                        {nylonEditDraft.isAuto ? 'Auto hanger' : 'Added hanger'} on panel
                        {nylonEditDraft.panelId != null ? ` #${nylonEditDraft.panelId}` : ''}. Same hanger line = same
                        length offset and same width position across panels ({lineOffsetLabel}
                        {lineWidthLabel}).
                    </p>
                </div>
                <div className="space-y-2">
                    <label className="block text-left">
                        <span className="block text-[11px] text-gray-600">
                            On panel length (mm from start)
                            {panelLength != null ? ` — max ${panelLength}` : ''}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                            <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full min-w-0 border border-gray-300 rounded-md px-2 py-1 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-300"
                                value={nylonEditDraft.offsetLength}
                                onChange={(e) =>
                                    setNylonEditDraft((prev) =>
                                        prev ? { ...prev, offsetLength: e.target.value } : prev
                                    )
                                }
                                onBlur={() => commitNylonEditField('offsetLength')}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                            />
                            <span className="text-[11px] text-gray-400 shrink-0">mm</span>
                        </span>
                    </label>
                    <label className="block text-left">
                        <span className="block text-[11px] text-gray-600">
                            On panel width (mm from start)
                            {panelWidth != null ? ` — blank = center (${Math.round(panelWidth / 2)} mm)` : ''}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                            <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full min-w-0 border border-gray-300 rounded-md px-2 py-1 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-300"
                                value={nylonEditDraft.offsetWidth}
                                onChange={(e) =>
                                    setNylonEditDraft((prev) =>
                                        prev ? { ...prev, offsetWidth: e.target.value } : prev
                                    )
                                }
                                onBlur={() => commitNylonEditField('offsetWidth')}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                                placeholder="Center if empty"
                            />
                            <span className="text-[11px] text-gray-400 shrink-0">mm</span>
                        </span>
                    </label>
                </div>
                {nylonFormError ? (
                    <p className="text-xs text-red-600 mt-2">{nylonFormError}</p>
                ) : null}
                <div className="mt-3 flex flex-col gap-2">
                    {lineHangerCount > 1 ? (
                        <button
                            type="button"
                            className="w-full px-2 py-1.5 text-sm rounded-lg bg-red-100 text-red-900 border border-red-200 hover:bg-red-200"
                            onClick={() => {
                                updateNylonPlacement(
                                    selectedNylonKey,
                                    nylonEditDraft.offsetLength,
                                    nylonEditDraft.offsetWidth,
                                    'line',
                                    nylonEditFrozenLineKey
                                );
                            }}
                        >
                            Apply offset to all on same hanger line ({lineHangerCount} hangers)
                        </button>
                    ) : null}
                    {roomHangerCount > 1 ? (
                        <button
                            type="button"
                            className="w-full px-2 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
                            onClick={() => {
                                updateNylonPlacement(
                                    selectedNylonKey,
                                    nylonEditDraft.offsetLength,
                                    nylonEditDraft.offsetWidth,
                                    'room'
                                );
                            }}
                        >
                            Apply offset to all in room ({roomHangerCount} hangers)
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="w-full px-2 py-1.5 text-sm rounded-lg bg-gray-700 text-white hover:bg-gray-800"
                        onClick={() => setSelectedNylonKey(null)}
                    >
                        Done
                    </button>
                    <button
                        type="button"
                        className="w-full px-2 py-1.5 text-sm rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        onClick={() => deleteNylonByKey(selectedNylonKey)}
                    >
                        Delete hanger
                    </button>
                </div>
            </div>
        );
    };

    const renderNylonAddPanel = (wrapperClassName = '') => {
        if (!nylonAddTarget) return null;
        const room = effectiveRooms.find((r) => Number(r.id) === Number(nylonAddTarget.roomId));
        const panel = findPanelById(nylonAddTarget.panelId, nylonAddTarget.roomId);
        const panelLength = panel ? Math.round(Number(panel.length ?? 0)) : null;
        const panelWidth = panel ? Math.round(Number(panel.width ?? 0)) : null;
        const qualCount = getQualifyingPanelsInRoom(nylonAddTarget.roomId).length;

        return (
            <div className={`text-left ${wrapperClassName}`}>
                <div className="mb-3">
                    <h4 className="text-sm font-semibold text-red-900">Add nylon hanger</h4>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                        {room?.room_name ?? 'Room'} — panel
                        {nylonAddTarget.panelId != null ? ` #${nylonAddTarget.panelId}` : ''}. Enter placement (mm from panel start), then add.
                    </p>
                </div>
                <div className="space-y-2">
                    <label className="block text-left">
                        <span className="block text-[11px] text-gray-600">
                            On panel length (mm from start)
                            {panelLength != null ? ` — max ${panelLength}` : ''}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                            <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full min-w-0 border border-gray-300 rounded-md px-2 py-1 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-300"
                                value={nylonAddDraft.offsetLength}
                                onChange={(e) => {
                                    setNylonFormError(null);
                                    setNylonAddDraft((prev) => ({ ...prev, offsetLength: e.target.value }));
                                }}
                                placeholder={panelLength != null ? `e.g. ${Math.round(panelLength / 2)}` : 'mm'}
                                autoFocus
                            />
                            <span className="text-[11px] text-gray-400 shrink-0">mm</span>
                        </span>
                    </label>
                    <label className="block text-left">
                        <span className="block text-[11px] text-gray-600">
                            On panel width (mm from start)
                            {panelWidth != null ? ` — blank = center (${Math.round(panelWidth / 2)} mm)` : ''}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                            <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full min-w-0 border border-gray-300 rounded-md px-2 py-1 text-sm focus:border-red-400 focus:ring-1 focus:ring-red-300"
                                value={nylonAddDraft.offsetWidth}
                                onChange={(e) => {
                                    setNylonFormError(null);
                                    setNylonAddDraft((prev) => ({ ...prev, offsetWidth: e.target.value }));
                                }}
                                placeholder="Center if empty"
                            />
                            <span className="text-[11px] text-gray-400 shrink-0">mm</span>
                        </span>
                    </label>
                </div>
                {nylonFormError ? (
                    <p className="text-xs text-red-600 mt-2">{nylonFormError}</p>
                ) : null}
                <div className="mt-3 flex flex-col gap-2">
                    <button
                        type="button"
                        disabled={nylonAddDraft.offsetLength === ''}
                        className="w-full px-2 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => commitNylonAddFromForm(false)}
                    >
                        Add on this panel
                    </button>
                    {qualCount > 1 ? (
                        <button
                            type="button"
                            disabled={nylonAddDraft.offsetLength === ''}
                            className="w-full px-2 py-1.5 text-sm rounded-lg bg-red-100 text-red-800 border border-red-200 hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => commitNylonAddFromForm(true)}
                        >
                            Add to all {qualCount} qualifying panels in room
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                        onClick={() => cancelNylonAddFlow(true)}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        );
    };

    const renderSupportControlsSection = (wrapperClassName = '') => {
        const nylonCount = listNylonHangers().length;
        const railCount = new Set(
            effectiveCustomSupports
                .filter((s) => s.supportLine)
                .map((s) =>
                    aluSupportLineKey(
                        s.supportLine.startX,
                        s.supportLine.startY,
                        s.supportLine.endX,
                        s.supportLine.endY
                    )
                )
        ).size;
        const aluHangerCount = effectiveCustomSupports.filter((s) => s.isIntersectionPoint).length;
        const canEditSupportOptions = Boolean(onEnableNylonHangersChange && onEnableAluSuspensionChange);

        return (
            <div className={`text-left ${wrapperClassName}`}>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Support systems</h4>
                {!panelsNeedSupport ? (
                    <p className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-2">
                        No extra support needed — all panels are under 6000&nbsp;mm in their critical dimension.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {canEditSupportOptions ? (
                            <div className="space-y-2 text-[11px]">
                                <label className="flex items-start gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={enableNylonHangers}
                                        onChange={(e) => {
                                            onSupportOptionsUserChange?.();
                                            onEnableNylonHangersChange(e.target.checked);
                                        }}
                                        className="mt-0.5 w-3.5 h-3.5 text-red-600 border-gray-300 rounded"
                                    />
                                    <span className="text-gray-800">Auto nylon on long panels</span>
                                </label>
                                {onNylonHangerOptionsChange ? (
                                    <div className="pl-5 space-y-1.5 border-l-2 border-red-100">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(nylonHangerOptions?.includeAccessories)}
                                                onChange={(e) => {
                                                    onSupportOptionsUserChange?.();
                                                    onNylonHangerOptionsChange((prev) => ({
                                                        ...prev,
                                                        includeAccessories: e.target.checked
                                                    }));
                                                }}
                                                className="w-3.5 h-3.5"
                                            />
                                            <span>Include accessories</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(nylonHangerOptions?.includeCable)}
                                                onChange={(e) => {
                                                    onSupportOptionsUserChange?.();
                                                    onNylonHangerOptionsChange((prev) => ({
                                                        ...prev,
                                                        includeCable: e.target.checked
                                                    }));
                                                }}
                                                className="w-3.5 h-3.5"
                                            />
                                            <span>Include cable</span>
                                        </label>
                                    </div>
                                ) : null}
                                <label className="flex items-start gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={enableAluSuspension}
                                        onChange={(e) => {
                                            onSupportOptionsUserChange?.();
                                            onEnableAluSuspensionChange(e.target.checked);
                                        }}
                                        className="mt-0.5 w-3.5 h-3.5 text-purple-600 border-gray-300 rounded"
                                    />
                                    <span className="text-gray-800">Alu suspension (draw rails on canvas)</span>
                                </label>
                            </div>
                        ) : null}

                        <p className="text-[11px] text-gray-600 bg-white/90 border border-gray-200 rounded px-2 py-1.5">
                            {nylonCount > 0 && `${nylonCount} nylon`}
                            {nylonCount > 0 && railCount > 0 && ' · '}
                            {railCount > 0 && `${railCount} rail${railCount !== 1 ? 's' : ''}`}
                            {railCount > 0 && aluHangerCount > 0 && ` (${aluHangerCount} alu hangers)`}
                            {nylonCount === 0 && railCount === 0 && 'No supports placed yet.'}
                        </p>

                        <div className="flex flex-col gap-1.5">
                            <button
                                type="button"
                                onClick={() => {
                                    if (isPlacingSupport && supportPlacementMode === 'nylon-add') {
                                        cancelNylonAddFlow(true);
                                    } else if (nylonAddTarget) {
                                        cancelNylonAddFlow(true);
                                    } else {
                                        beginNylonAddMode();
                                    }
                                }}
                                className={`w-full px-2 py-1.5 text-sm rounded-lg transition-colors ${
                                    isPlacingSupport && supportPlacementMode === 'nylon-add'
                                        ? 'bg-gray-600 text-white hover:bg-gray-700'
                                        : 'bg-red-600 text-white hover:bg-red-700'
                                }`}
                            >
                                {isPlacingSupport && supportPlacementMode === 'nylon-add'
                                    ? 'Cancel add nylon'
                                    : 'Add nylon hanger (manual)'}
                            </button>
                            {enableAluSuspension ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isPlacingSupport && supportPlacementMode === 'alu') {
                                                clearSupportDrawingMode(true);
                                            } else {
                                                clearSupportDrawingMode(false);
                                                beginSupportDrawingMode();
                                            }
                                        }}
                                        className={`w-full px-2 py-1.5 text-sm rounded-lg transition-colors ${
                                            isPlacingSupport && supportPlacementMode === 'alu'
                                                ? 'bg-red-500 text-white hover:bg-red-600'
                                                : 'bg-purple-600 text-white hover:bg-purple-700'
                                        }`}
                                    >
                                        {isPlacingSupport && supportPlacementMode === 'alu'
                                            ? 'Cancel draw rail'
                                            : 'Draw support line'}
                                    </button>
                                    <p className="text-[10px] text-gray-500 leading-snug px-0.5">
                                        Click rail start, then end (snaps H/V). Click a purple rail to edit length.
                                    </p>
                                </>
                            ) : null}
                            {effectiveCustomSupports.length > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        updateCustomSupports([]);
                                        setSelectedRailKey(null);
                                        setSelectedNylonKey(null);
                                        autoNylonSyncSignatureRef.current = '';
                                        const ctx = canvasRef.current?.getContext('2d');
                                        if (ctx) drawCanvas(ctx);
                                    }}
                                    className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                                >
                                    Clear all supports
                                </button>
                            ) : null}
                        </div>
                        <p className="text-[10px] text-gray-500 leading-snug">
                            Auto nylon is optional. Manual add works with auto off. Click a red hanger to
                            edit; use the button above to place more.
                        </p>
                    </div>
                )}
            </div>
        );
    };

    const renderRailEditPanel = (wrapperClassName = '') => {
        if (!enableAluSuspension || !selectedRailKey || !railEditDraft || isPlacingSupport) {
            return null;
        }
        return (
            <div className={`text-left ${wrapperClassName}`}>
                <div className="mb-3">
                    <h4 className="text-sm font-semibold text-amber-900">Edit suspension rail</h4>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                        Edit mm values, then Enter or click away to apply.
                    </p>
                </div>
                <div className="space-y-2">
                    {railEditFields.map(({ field, label }) => (
                        <label key={field} className="block text-left">
                            <span className="block text-[11px] text-gray-600">{label}</span>
                            <span className="mt-0.5 flex items-center gap-1.5">
                                <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    className="w-full min-w-0 border border-gray-300 rounded-md px-2 py-1 text-left text-sm text-gray-900 focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
                                    value={railEditDraft[field] ?? ''}
                                    onChange={(e) =>
                                        setRailEditDraft((prev) =>
                                            prev ? { ...prev, [field]: e.target.value } : prev
                                        )
                                    }
                                    onBlur={() => commitRailEditField(field)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.currentTarget.blur();
                                    }}
                                />
                                <span className="text-[11px] text-gray-400 shrink-0">mm</span>
                            </span>
                        </label>
                    ))}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                    <button
                        type="button"
                        className="w-full px-2 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                        onClick={() => setSelectedRailKey(null)}
                    >
                        Done
                    </button>
                    <button
                        type="button"
                        className="w-full px-2 py-1.5 text-sm rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        onClick={() => {
                            deleteRailByKey(selectedRailKey);
                            setSelectedRailKey(null);
                        }}
                    >
                        Delete rail
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div
            className={`ceiling-canvas-container bg-white rounded-xl shadow-lg w-full max-w-full min-w-0 ${
                isSupportSidebarOpen || isPlanDetailsOpen
                    ? 'p-4 sm:p-5 lg:p-5'
                    : 'p-4 sm:p-6'
            }`}
        >
            {/* Header */}
            <div className="ceiling-canvas-header mb-4 sm:mb-6 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 min-w-0">
                    <div className="min-w-0">
                        <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1 sm:mb-2 truncate">
                            Ceiling Plan
                        </h3>
                        <p className="text-gray-600 text-base sm:text-lg truncate">
                            {showAllRooms ? 
                                `All Rooms (${effectiveRooms.length}) - Professional Layout` :
                                `${effectiveRooms.length > 0 ? effectiveRooms[0]?.room_name || 'Room' : 'Room'} - Professional Layout`
                            }
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {!isSupportSidebarOpen ? (
                            <button
                                type="button"
                                onClick={() => setIsSupportSidebarOpen(true)}
                                className="px-3 py-1.5 text-sm rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50 transition-colors font-medium"
                            >
                                Show Support Tools
                            </button>
                        ) : null}
                        {!isPlanDetailsOpen ? (
                            <button
                                type="button"
                                onClick={() => setIsPlanDetailsOpen(true)}
                                className="px-3 py-1.5 text-sm rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                            >
                                Show Plan Details
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Support tools (left) | Canvas | Plan details (right) */}
            <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 min-w-0 w-full items-stretch">
                {isSupportSidebarOpen ? (
                    <div className="ceiling-support-sidebar flex-shrink-0 w-full lg:w-[14.5rem] min-w-0 order-2 lg:order-1">
                        <div className="bg-gradient-to-br from-orange-50/80 to-gray-50 border border-orange-200/80 rounded-xl p-3 sm:p-4 shadow-lg text-left lg:sticky lg:top-2 lg:max-h-[min(720px,calc(100vh-10rem))] lg:overflow-y-auto">
                            <div className="flex flex-col gap-2 mb-3">
                                <h4 className="text-base font-bold text-gray-900">Support Tools</h4>
                                <button
                                    type="button"
                                    onClick={closeSupportSidebar}
                                    className="self-start px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-white transition-colors"
                                >
                                    Collapse
                                </button>
                            </div>
                            {renderSupportControlsSection('mb-4')}
                            {renderRailEditPanel('mb-4 pb-4 border-b border-amber-200 rounded-lg bg-amber-50/70 px-2.5 py-2.5')}
                            {renderNylonAddPanel('mb-4 pb-4 border-b border-red-200 rounded-lg bg-red-50/50 px-2.5 py-2.5')}
                            {renderNylonEditPanel('mb-0 pb-0')}
                        </div>
                    </div>
                ) : null}

                {/* Canvas Container */}
                <div className="ceiling-canvas-wrapper flex-1 min-w-0 w-full lg:min-w-[280px] order-1 lg:order-2">
                    <div
                        ref={canvasContainerRef}
                        className="bg-white border-2 border-gray-200 rounded-xl overflow-hidden shadow-lg relative"
                        style={{
                            height: `${CANVAS_HEIGHT}px`,
                            minHeight: `${MIN_CANVAS_HEIGHT}px`
                        }}
                    >
                        {/* Zoom Controls Overlay */}
                        <div className="absolute top-4 right-4 flex flex-col gap-2 z-50">
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
                                isPlacingSupport
                                    ? 'cursor-crosshair'
                                    : selectedRailKey || selectedNylonKey
                                        ? 'cursor-default'
                                        : 'cursor-grab active:cursor-grabbing'
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
                            onContextMenu={(e) => e.preventDefault()}
                        />
                        {enableAluSuspension && effectiveCustomSupports.length > 0 && (
                            <div className="absolute bottom-3 left-3 z-10 pointer-events-none rounded-lg bg-white/95 border border-purple-200 px-2.5 py-2 shadow-sm text-[11px] text-gray-700 space-y-1.5 max-w-[200px]">
                                <div className="font-semibold text-purple-900">Alu suspension</div>
                                <div className="flex items-center gap-2">
                                    <span className="inline-block w-9 h-1 rounded-full bg-purple-800 shrink-0" />
                                    <span>Rail</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="inline-block w-9 h-1 rounded-full bg-amber-500 shrink-0" />
                                    <span>Selected rail</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex w-4 h-4 rounded-full border-2 border-purple-700 bg-white shrink-0" />
                                    <span>Hanger on panel</span>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* Canvas Controls - wrap on small screens */}
                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-2 sm:gap-4">
                            <span className="font-medium">Scale:</span>
                            <span className="font-mono bg-gray-100 px-2 py-1 rounded tabular-nums">
                                {currentScale.toFixed(2)}x
                            </span>
                        </div>
                        <p className="sm:text-center text-gray-600 order-last sm:order-none">
                            <span className="font-medium">
                                {listNylonHangers().length > 0 && !isPlacingSupport
                                    ? 'Click a red nylon hanger to edit • '
                                    : ''}
                                {isPlacingSupport && supportPlacementMode === 'nylon-add'
                                    ? 'Step 1: click a ceiling panel • '
                                    : ''}
                                {nylonAddTarget
                                    ? 'Step 2: enter placement in Support Tools, then Add • '
                                    : ''}
                                {enableAluSuspension && !isPlacingSupport
                                    ? 'Click a purple rail to select and edit dimensions • '
                                    : ''}
                                Click room to select, then click panel • Drag to pan • Use zoom buttons
                            </span>
                        </p>
                    </div>
                    

                </div>

                {/* Plan details — stats, dimensions, legend */}
                {isPlanDetailsOpen ? (
                <div className="ceiling-summary-sidebar flex-shrink-0 w-full lg:w-[14.5rem] min-w-0 order-3">
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-xl p-3 sm:p-4 w-full shadow-lg text-left lg:sticky lg:top-2 lg:max-h-[min(720px,calc(100vh-10rem))] lg:overflow-y-auto">
                        <div className="flex flex-col items-stretch gap-2 mb-4">
                            <h4 className="text-base font-bold text-gray-900 flex items-center shrink-0">
                                <svg className="w-5 h-5 mr-2 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                <span className="truncate">Plan Details</span>
                            </h4>
                            <button
                                type="button"
                                onClick={() => setIsPlanDetailsOpen(false)}
                                className="self-start px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                            >
                                Collapse
                            </button>
                        </div>

                        {ceilingPlan ? (
                            <div className="space-y-4 text-left">
                                {/* Stats - no inner box, same style as Floor Plan */}
                                <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                                    <div className="text-left">
                                        <div className="text-sm text-gray-600">Total Panels</div>
                                        <div className="text-2xl font-bold text-gray-900 tabular-nums">{getAccuratePanelCounts.total}</div>
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm text-gray-600">Rooms</div>
                                        <div className="text-xl font-semibold text-blue-600 tabular-nums">{effectiveRooms.length}</div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                                    <div className="text-left">
                                        <div className="text-sm text-gray-600">Full Panels</div>
                                        <div className="text-xl font-semibold text-green-600 tabular-nums">{getAccuratePanelCounts.full}</div>
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm text-gray-600">Cut Panels</div>
                                        <div className="text-xl font-semibold text-orange-600 tabular-nums">{getAccuratePanelCounts.cut}</div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                                    <div className="text-left">
                                        <div className="text-sm text-gray-600">Waste %</div>
                                        <div className="text-xl font-semibold text-red-600 tabular-nums">
                                            {(() => {
                                                if (projectWastePercentage !== undefined && projectWastePercentage !== null) {
                                                    return `${Number(projectWastePercentage).toFixed(1)}%`;
                                                }
                                                if (ceilingPlan?.summary?.project_waste_percentage !== undefined && ceilingPlan?.summary?.project_waste_percentage !== null) {
                                                    return `${Number(ceilingPlan.summary.project_waste_percentage).toFixed(1)}%`;
                                                }
                                                if (ceilingPlan?.summary?.actual_waste_percentage !== undefined && ceilingPlan?.summary?.actual_waste_percentage !== null) {
                                                    return `${Number(ceilingPlan.summary.actual_waste_percentage).toFixed(1)}%`;
                                                }
                                                if (ceilingPlan?.summary?.total_waste_percentage !== undefined && ceilingPlan?.summary?.total_waste_percentage !== null) {
                                                    return `${Number(ceilingPlan.summary.total_waste_percentage).toFixed(1)}%`;
                                                }
                                                if (ceilingPlan?.waste_percentage !== undefined && ceilingPlan?.waste_percentage !== null) {
                                                    return `${Number(ceilingPlan.waste_percentage).toFixed(1)}%`;
                                                }
                                                if (ceilingPlans?.length > 0) {
                                                    const total = ceilingPlans.reduce((s, p) => s + (p.waste_percentage ?? 0), 0);
                                                    return `${(total / ceilingPlans.length).toFixed(1)}%`;
                                                }
                                                const zonePlans = ceilingPlan?.zone_plans || [];
                                                if (zonePlans.length > 0) {
                                                    const total = zonePlans.reduce((s, z) => s + (z.waste_percentage || 0), 0);
                                                    return `${(total / zonePlans.length).toFixed(1)}%`;
                                                }
                                                return '0.0%';
                                            })()}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-left">
                                    <div className="text-sm text-gray-600">Orientation</div>
                                    <div className="text-lg font-semibold text-green-600">
                                        {(() => {
                                            const strategy = ceilingPlan?.orientation_strategy ||
                                                             ceilingPlan?.strategy_used ||
                                                             ceilingPlan?.summary?.recommended_strategy ||
                                                             ceilingPlan?.orientation_analysis?.recommended_strategy ||
                                                             ceilingPlan?.recommended_strategy ||
                                                             'auto';
                                            const formatStrategy = (s) => {
                                                if (!s) return 'Auto';
                                                const map = { 'all_horizontal': 'Horizontal', 'all_vertical': 'Vertical', 'room_optimal': 'Room Optimal', 'project_merged': 'Project Merged', 'auto': 'Auto' };
                                                return map[s] || String(s).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                                            };
                                            return formatStrategy(strategy);
                                        })()}
                                    </div>
                                </div>
                                {calculatePanelsNeedSupport ? (
                                    <>
                                        <div className="text-left">
                                            <div className="text-sm text-gray-600">Support Status</div>
                                            <div className="text-lg font-semibold text-amber-600">Needed</div>
                                        </div>
                                        <div className="text-left">
                                            <div className="text-sm text-gray-600">Support Type</div>
                                            <div className="text-lg font-semibold text-indigo-600">
                                                {[
                                                    (enableNylonHangers || listNylonHangers().length > 0) && 'Nylon',
                                                    enableAluSuspension && 'Alu'
                                                ]
                                                    .filter(Boolean)
                                                    .join(' + ') || supportType}
                                            </div>
                                        </div>
                                        <div className="text-left">
                                            <div className="text-sm text-gray-600">Panels Needing Support</div>
                                            <div className="text-lg font-semibold text-amber-600 tabular-nums">
                                                {(() => {
                                                    const isHorizontalOrientation = effectiveRooms.length > 0 && effectiveRooms[0] ? getRoomOrientation(effectiveRooms[0].id) : false;
                                                    if (ceilingPlan?.enhanced_panels && Array.isArray(ceilingPlan.enhanced_panels)) {
                                                        return ceilingPlan.enhanced_panels.filter(p => isHorizontalOrientation ? p.width > 6000 : p.length > 6000).length;
                                                    }
                                                    return Object.values(effectiveCeilingPanelsMap).reduce((sum, panels) =>
                                                        sum + (panels ? panels.filter(p => isHorizontalOrientation ? p.width > 6000 : p.length > 6000).length : 0), 0);
                                                })()}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-left">
                                        <div className="text-sm text-gray-600">Support Status</div>
                                        <div className="text-lg font-semibold text-green-600">Not Needed</div>
                                    </div>
                                )}

                                {/* Dimension Legend - no inner box, border-t section like Floor Plan */}
                                <div className="pt-4 border-t border-gray-200 text-left">
                                    <h4 className="font-semibold text-gray-900 mb-4 flex items-center">
                                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        Dimension Legend
                                    </h4>
                                    <div className="space-y-3 text-sm">
                                        {/* Overall outline (plan footprint) — not wall-by-wall; per room when multiple rooms */}
                                        <div className="flex items-center justify-between gap-3 min-w-0">
                                            <div className="flex items-center min-w-0">
                                                <div className="w-4 h-4 bg-blue-600 rounded mr-3 shrink-0"></div>
                                                <span className="text-gray-700 truncate">Overall outline</span>
                                            </div>
                                            <input 
                                                type="checkbox" 
                                                checked={visibilityState.room !== false}
                                                onChange={(e) => setVisibilityState(prev => ({ ...prev, room: e.target.checked }))}
                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                                title="Each room’s total width and depth on the plan (plan-view size). Not the whole project if you have several rooms."
                                            />
                                        </div>

                                        {/* Panel Dimensions - Toggleable */}
                                        <div className="flex items-center justify-between gap-3 min-w-0">
                                            <div className="flex items-center min-w-0">
                                                <div className="w-4 h-4 bg-gray-600 rounded mr-3 shrink-0"></div>
                                                <span className="text-gray-700 truncate">Panel Dimensions</span>
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
                                        <div className="flex items-center justify-between gap-3 min-w-0">
                                            <div className="flex items-center min-w-0">
                                                <div className="w-4 h-4 bg-red-600 rounded mr-3 shrink-0"></div>
                                                <span className="text-gray-700 truncate">Cut Dimensions</span>
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

                                {/* Ceiling Panel Finish Legend (similar concept to Wall Finish Legend) */}
                                {ceilingFinishColorMap && ceilingFinishColorMap.size > 0 && (
                                    <div className="mt-4 pt-4 border-t border-gray-200">
                                        <h4 className="font-semibold text-gray-900 mb-3 flex items-center">
                                            <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h10M4 14h16M4 18h10" />
                                            </svg>
                                            Ceiling Panel Finish Legend
                                        </h4>
                                        <div className="space-y-2 text-xs sm:text-sm">
                                            {Array.from(ceilingFinishColorMap.entries()).map(([key, colors]) => {
                                                const parts = key.split('|');
                                                const core = parts[0] || '';
                                                const int = parts[1]?.replace('INT:', 'Int ') || '';
                                                const label = `${core}mm • ${int}`;
                                                return (
                                                    <div key={key} className="flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            {/* Full vs cut swatch: same hue, different depth */}
                                                            <div className="flex overflow-hidden rounded border border-gray-300">
                                                                <div
                                                                    className="w-4 h-4"
                                                                    style={{ backgroundColor: colors.panelFillFull }}
                                                                    title="Full panel"
                                                                ></div>
                                                                <div
                                                                    className="w-4 h-4"
                                                                    style={{ backgroundColor: colors.panelFillCut }}
                                                                    title="Cut panel"
                                                                ></div>
                                                            </div>
                                                            <span className="text-gray-700 leading-snug break-words max-w-xs sm:max-w-sm">
                                                                {label}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">Generate a ceiling plan to see panel stats and legends.</p>
                        )}
                    </div>
                </div>
                ) : null}

            </div>

            {/* Materials Table Section */}
            <div className="mt-6 p-4 bg-white rounded-lg shadow-md border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">Ceiling Materials</h3>
                    <button
                        onClick={() => setShowMaterialsTable(!showMaterialsTable)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                        {showMaterialsTable ? 'Hide Materials Table' : 'Show Materials Table'}
                    </button>
                </div>

                {showMaterialsTable && (() => {
                    const materials = generateMaterialsSummary();
                    const panelList = generatePanelList();
                    return (
                        <div className="space-y-8">
                            {/* Nylon hangers */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 mb-2">Nylon hangers</h4>
                                {materials.nylon.enabled || materials.nylon.total > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                                            <span className="text-gray-600">Total hangers</span>
                                            <p className="font-semibold text-red-900">{materials.nylon.total}</p>
                                        </div>
                                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                            <span className="text-gray-600">Cable</span>
                                            <p className="font-medium text-gray-900">
                                                {materials.nylon.includeCable ? 'Yes' : 'No'}
                                            </p>
                                        </div>
                                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                            <span className="text-gray-600">Accessories</span>
                                            <p className="font-medium text-gray-900">
                                                {materials.nylon.includeAccessories ? 'Yes' : 'No'}
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">
                                        Auto nylon is off and no manual hangers on the plan.
                                    </p>
                                )}
                            </div>

                            {/* Alu suspension */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 mb-2">Alu suspension</h4>
                                {materials.alu.enabled ? (
                                    materials.alu.railCount > 0 ? (
                                        <div className="space-y-3">
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                                <div className="bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                                                    <span className="text-gray-600">Rails</span>
                                                    <p className="font-semibold text-purple-900">
                                                        {materials.alu.railCount}
                                                    </p>
                                                </div>
                                                <div className="bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                                                    <span className="text-gray-600">Total rail length</span>
                                                    <p className="font-semibold text-purple-900">
                                                        {materials.alu.totalRailLengthMm.toLocaleString()} mm
                                                    </p>
                                                </div>
                                                <div className="bg-purple-50 border border-purple-100 rounded-lg px-3 py-2">
                                                    <span className="text-gray-600">Total hangers</span>
                                                    <p className="font-semibold text-purple-900">
                                                        {materials.alu.totalHangers}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full border border-gray-300 text-sm">
                                                    <thead className="bg-gray-50">
                                                        <tr>
                                                            <th className="px-3 py-2 border border-gray-300 text-left font-medium text-gray-700">
                                                                Rail
                                                            </th>
                                                            <th className="px-3 py-2 border border-gray-300 text-left font-medium text-gray-700">
                                                                Length (mm)
                                                            </th>
                                                            <th className="px-3 py-2 border border-gray-300 text-left font-medium text-gray-700">
                                                                Hangers
                                                            </th>
                                                            <th className="px-3 py-2 border border-gray-300 text-left font-medium text-gray-700">
                                                                Orientation
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {materials.alu.rails.map((rail) => (
                                                            <tr key={rail.index} className="hover:bg-gray-50">
                                                                <td className="px-3 py-2 border border-gray-300 text-gray-900">
                                                                    {rail.index}
                                                                </td>
                                                                <td className="px-3 py-2 border border-gray-300 text-gray-900">
                                                                    {rail.lengthMm.toLocaleString()}
                                                                </td>
                                                                <td className="px-3 py-2 border border-gray-300 font-medium text-gray-900">
                                                                    {rail.hangerCount}
                                                                </td>
                                                                <td className="px-3 py-2 border border-gray-300 text-gray-700 capitalize">
                                                                    {rail.orientation}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-500">
                                            Alu suspension enabled — no rails drawn yet.
                                        </p>
                                    )
                                ) : (
                                    <p className="text-sm text-gray-500">Alu suspension is disabled.</p>
                                )}
                            </div>

                            {/* Ceiling panels */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 mb-2">Ceiling panels</h4>
                                {panelList.length > 0 ? (
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
                                                {panelList.map((panel, index) => {
                                                    const intMat = panel.inner_face_material ?? 'PPGI';
                                                    const intThk = panel.inner_face_thickness ?? 0.5;
                                                    const extMat = panel.outer_face_material ?? 'PPGI';
                                                    const extThk = panel.outer_face_thickness ?? 0.5;
                                                    const same = intMat === extMat && intThk === extThk;
                                                    const finishing = same
                                                        ? `Both ${extThk}mm ${extMat}`
                                                        : `INT ${intThk}mm ${intMat} / EXT ${extThk}mm ${extMat}`;
                                                    return (
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
                                                            <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 whitespace-nowrap">
                                                                {finishing}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        No ceiling panels found. Generate a ceiling plan first.
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default CeilingCanvas;