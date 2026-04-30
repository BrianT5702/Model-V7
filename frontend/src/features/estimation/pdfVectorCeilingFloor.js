/**
 * Vector ceiling/floor plan pages for PDF export (avoids canvas screenshots for large projects).
 * Uses the same mm model space as CeilingCanvas / FloorCanvas.
 */

import { jsPDF } from 'jspdf';
import { DIMENSION_CONFIG, formatPlanDimensionLabel, planDimensionDedupKey } from '../canvas/DimensionConfig';
import { calculateOffsetPoints, buildWallOffsetOptions } from '../canvas/drawing';
import {
    smartPlacement,
    hasLabelOverlap,
    calculateHorizontalLabelBounds,
    calculateVerticalLabelBounds
} from '../canvas/collisionDetection';
import { calculatePolygonVisualCenter, calculateIntersection, isPointInPolygon } from '../canvas/utils';

/** Align with wall-plan PDF snapping for intersection vs wall endpoints (merged / rounded coords). */
const CEILING_FLOOR_INTERSECTION_TOL_MM = 35;

/** Match canvas CSS pixel sizes to PDF mm (96 CSS px ≈ 1in) */
const PX_TO_MM = 25.4 / 96;

function hexToRgb(hex) {
    const h = (hex || '#000000').replace('#', '');
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function matchesActiveStorey(storeyId, activeStoreyId, defaultStoreyId) {
    if (activeStoreyId == null) return true;
    if (storeyId === null || storeyId === undefined) {
        if (defaultStoreyId == null || defaultStoreyId === undefined) return false;
        return String(defaultStoreyId) === String(activeStoreyId);
    }
    return String(storeyId) === String(activeStoreyId);
}

function roomIdsFromZone(zone) {
    const raw = zone?.room_ids;
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => (typeof r === 'object' && r !== null ? r.id : r)).filter((id) => id != null);
}

function mergeBounds(b, x, y) {
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return b;
    return {
        minX: Math.min(b.minX, x),
        minY: Math.min(b.minY, y),
        maxX: Math.max(b.maxX, x),
        maxY: Math.max(b.maxY, y)
    };
}

function initialBounds() {
    return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function boundsValid(b) {
    return b.minX !== Infinity && b.minY !== Infinity && b.maxX > b.minX && b.maxY > b.minY;
}

function wallIdMatch(a, b) {
    return a != null && b != null && String(a) === String(b);
}

function resolveWallRef(ref, storeyWalls) {
    if (ref == null) return null;
    const id = typeof ref === 'object' && ref !== null ? ref.id : ref;
    const fromList = (storeyWalls || []).find((w) => wallIdMatch(w.id, id));
    if (fromList) return fromList;
    if (typeof ref === 'object' && ref !== null && (ref.start_x != null || ref.end_x != null)) return ref;
    return null;
}

function intersectionPointForWallPair(wa, wb) {
    const a1 = { x: num(wa.start_x), y: num(wa.start_y) };
    const a2 = { x: num(wa.end_x), y: num(wa.end_y) };
    const b1 = { x: num(wb.start_x), y: num(wb.start_y) };
    const b2 = { x: num(wb.end_x), y: num(wb.end_y) };
    const EPS = 0.5;
    const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    if (dist(a1, b1) < EPS) return mid(a1, b1);
    if (dist(a1, b2) < EPS) return mid(a1, b2);
    if (dist(a2, b1) < EPS) return mid(a2, b1);
    if (dist(a2, b2) < EPS) return mid(a2, b2);
    return calculateIntersection(a1, a2, b1, b2);
}

/** Endpoint of joining wall farther from the joint — better “side” than midpoint for long walls (CeilingCanvas uses midpoint). */
function joiningWallRefPointAwayFromJoint(joiningWall, ix, iy) {
    const j1x = num(joiningWall.start_x);
    const j1y = num(joiningWall.start_y);
    const j2x = num(joiningWall.end_x);
    const j2y = num(joiningWall.end_y);
    const d1 = Math.hypot(j1x - ix, j1y - iy);
    const d2 = Math.hypot(j2x - ix, j2y - iy);
    const eps = 1e-3;
    if (d1 > d2 + eps) return { x: j1x, y: j1y };
    if (d2 > d1 + eps) return { x: j2x, y: j2y };
    return { x: (j1x + j2x) / 2, y: (j1y + j2y) / 2 };
}

function expandBoundsWalls(wallList, b0 = initialBounds()) {
    let b = { ...b0 };
    (wallList || []).forEach((w) => {
        b = mergeBounds(b, num(w.start_x), num(w.start_y));
        b = mergeBounds(b, num(w.end_x), num(w.end_y));
    });
    return b;
}

/** Double-line walls like FloorCanvas / CeilingCanvas (not a single room outline). */
function drawStoreyWallsOnPdf(doc, transformX, transformY, scale, kind, storeyWalls, storeyRooms, intersections) {
    if (!storeyWalls || storeyWalls.length === 0) return;

    const center = { x: 0, y: 0 };
    const pts = (storeyRooms || []).flatMap((room) => room.room_points || []);
    if (pts.length > 0) {
        center.x = pts.reduce((sum, p) => sum + num(p.x ?? (Array.isArray(p) ? p[0] : null)), 0) / pts.length;
        center.y = pts.reduce((sum, p) => sum + num(p.y ?? (Array.isArray(p) ? p[1] : null)), 0) / pts.length;
    }

    const MODEL_SF = 1;
    storeyWalls.forEach((wall) => {
        try {
            const wallThickness = num(wall.thickness, 100);
            // Use full wall thickness for both floor and ceiling PDF. Half-thickness (ceiling canvas style)
            // collapses to an almost single line at typical PDF scales; full offset matches floor export clarity.
            const gapPixels = wallThickness * MODEL_SF;
            const offsetOpts = buildWallOffsetOptions(wall, storeyRooms);

            let { line1, line2 } = calculateOffsetPoints(
                num(wall.start_x),
                num(wall.start_y),
                num(wall.end_x),
                num(wall.end_y),
                gapPixels,
                center,
                MODEL_SF,
                offsetOpts
            );

            // Match CeilingCanvas: trim outer/inner lines only at corners that have a 45° cut, and trim
            // the correct parallel (line1 vs line2) per side. The old PDF path always shortened line2
            // at both ends whenever any 45_cut touched the wall, which mis-draws many inner faces.
            const wallDx = num(wall.end_x) - num(wall.start_x);
            const wallDy = num(wall.end_y) - num(wall.start_y);
            const wallLen = Math.hypot(wallDx, wallDy);
            const wallDirX = wallLen > 0 ? wallDx / wallLen : 0;
            const wallDirY = wallLen > 0 ? wallDy / wallLen : 0;
            const isVertical = Math.abs(wallDx) < Math.abs(wallDy);

            const line1MidX = (line1[0].x + line1[1].x) / 2;
            const line1MidY = (line1[0].y + line1[1].y) / 2;
            const line2MidX = (line2[0].x + line2[1].x) / 2;
            const line2MidY = (line2[0].y + line2[1].y) / 2;
            let line1IsLeft;
            if (isVertical) {
                line1IsLeft = line1MidX < line2MidX;
            } else if (wallDirX > 0) {
                line1IsLeft = line1MidY < line2MidY;
            } else {
                line1IsLeft = line1MidY > line2MidY;
            }

            let startHas45 = false;
            let startIsOnLeftSide = false;
            let endHas45 = false;
            let endIsOnLeftSide = false;

            if (intersections && intersections.length > 0) {
                const tol = CEILING_FLOOR_INTERSECTION_TOL_MM;
                intersections.forEach((inter) => {
                    const pairList =
                        Array.isArray(inter.pairs) && inter.pairs.length > 0
                            ? inter.pairs
                            : [
                                  {
                                      wall1: inter.wall_1 ?? inter.wall1,
                                      wall2: inter.wall_2 ?? inter.wall2,
                                      joining_method: inter.joining_method
                                  }
                              ];

                    pairList.forEach((pair) => {
                        const jm = pair?.joining_method ?? inter.joining_method ?? 'butt_in';
                        if (jm !== '45_cut') return;

                        const wa = resolveWallRef(pair?.wall1 ?? inter.wall_1 ?? inter.wall1, storeyWalls);
                        const wb = resolveWallRef(pair?.wall2 ?? inter.wall_2 ?? inter.wall2, storeyWalls);
                        if (!wa || !wb) return;
                        if (!wallIdMatch(wa.id, wall.id) && !wallIdMatch(wb.id, wall.id)) return;

                        const joiningWall = wallIdMatch(wa.id, wall.id) ? wb : wa;

                        let ix = num(inter.x);
                        let iy = num(inter.y);
                        if (!Number.isFinite(ix) || !Number.isFinite(iy)) {
                            const pt = intersectionPointForWallPair(wa, wb);
                            if (!pt) return;
                            ix = pt.x;
                            iy = pt.y;
                        }

                        const sx = num(wall.start_x);
                        const sy = num(wall.start_y);
                        const ex = num(wall.end_x);
                        const ey = num(wall.end_y);
                        const dStart = Math.hypot(ix - sx, iy - sy);
                        const dEnd = Math.hypot(ix - ex, iy - ey);
                        let isAtStart = dStart < tol;
                        let isAtEnd = dEnd < tol;
                        if (isAtStart && isAtEnd) {
                            isAtStart = dStart <= dEnd;
                            isAtEnd = dEnd < dStart;
                        }

                        const ref = joiningWallRefPointAwayFromJoint(joiningWall, ix, iy);
                        const joinRefX = ref.x;
                        const joinRefY = ref.y;

                        if (isAtStart) {
                            startHas45 = true;
                            if (isVertical) {
                                startIsOnLeftSide = joinRefX < sx;
                            } else if (wallDirX > 0) {
                                startIsOnLeftSide = joinRefY < sy;
                            } else {
                                startIsOnLeftSide = joinRefY > sy;
                            }
                        } else if (isAtEnd) {
                            endHas45 = true;
                            if (isVertical) {
                                endIsOnLeftSide = joinRefX < ex;
                            } else if (wallDirX > 0) {
                                endIsOnLeftSide = joinRefY < ey;
                            } else {
                                endIsOnLeftSide = joinRefY > ey;
                            }
                        }
                    });
                });
            }

            const finalAdjust = wallThickness * 2;
            line1 = line1.map((p) => ({ ...p }));
            line2 = line2.map((p) => ({ ...p }));

            if (startHas45) {
                if (startIsOnLeftSide) {
                    if (line1IsLeft) {
                        line1[0].x += wallDirX * finalAdjust;
                        line1[0].y += wallDirY * finalAdjust;
                    } else {
                        line2[0].x += wallDirX * finalAdjust;
                        line2[0].y += wallDirY * finalAdjust;
                    }
                } else if (line1IsLeft) {
                    line2[0].x += wallDirX * finalAdjust;
                    line2[0].y += wallDirY * finalAdjust;
                } else {
                    line1[0].x += wallDirX * finalAdjust;
                    line1[0].y += wallDirY * finalAdjust;
                }
            }
            if (endHas45) {
                if (endIsOnLeftSide) {
                    if (line1IsLeft) {
                        line1[1].x -= wallDirX * finalAdjust;
                        line1[1].y -= wallDirY * finalAdjust;
                    } else {
                        line2[1].x -= wallDirX * finalAdjust;
                        line2[1].y -= wallDirY * finalAdjust;
                    }
                } else if (line1IsLeft) {
                    line2[1].x -= wallDirX * finalAdjust;
                    line2[1].y -= wallDirY * finalAdjust;
                } else {
                    line1[1].x -= wallDirX * finalAdjust;
                    line1[1].y -= wallDirY * finalAdjust;
                }
            }

            doc.setLineWidth(0.2);
            doc.setDrawColor(51, 51, 51);
            if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
            doc.line(
                transformX(line1[0].x),
                transformY(line1[0].y),
                transformX(line1[1].x),
                transformY(line1[1].y)
            );

            doc.setDrawColor(107, 114, 128);
            const dash1 = Math.max(0.25, 8 * scale);
            const dash2 = Math.max(0.15, 4 * scale);
            if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([dash1, dash2], 0);
            doc.line(
                transformX(line2[0].x),
                transformY(line2[0].y),
                transformX(line2[1].x),
                transformY(line2[1].y)
            );
            if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
        } catch (_) {
            doc.setDrawColor(31, 41, 55);
            doc.setLineWidth(0.35);
            if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
            doc.line(
                transformX(num(wall.start_x)),
                transformY(num(wall.start_y)),
                transformX(num(wall.end_x)),
                transformY(num(wall.end_y))
            );
        }
    });
}

function expandBoundsRooms(rooms, b0 = initialBounds()) {
    let b = { ...b0 };
    (rooms || []).forEach((room) => {
        (room.room_points || []).forEach((pt) => {
            const x = num(pt.x ?? (Array.isArray(pt) ? pt[0] : null));
            const y = num(pt.y ?? (Array.isArray(pt) ? pt[1] : null));
            b = mergeBounds(b, x, y);
            
        });
    });
    return b;
}

function expandBoundsOutline(outline, b0) {
    let b = { ...b0 };
    (outline || []).forEach((pt) => {
        const x = num(pt.x ?? (Array.isArray(pt) ? pt[0] : null));
        const y = num(pt.y ?? (Array.isArray(pt) ? pt[1] : null));
        b = mergeBounds(b, x, y);
    });
    return b;
}

function expandBoundsPanels(panels, b0) {
    let b = { ...b0 };
    (panels || []).forEach((panel) => {
        const pts = panel.shape_points;
        if (isPanelPolygon(pts)) {
            pts.forEach((pt) => {
                const x = num(pt?.x ?? (Array.isArray(pt) ? pt[0] : null));
                const y = num(pt?.y ?? (Array.isArray(pt) ? pt[1] : null));
                b = mergeBounds(b, x, y);
            });
        } else {
            const sx = num(panel.start_x ?? panel.x);
            const sy = num(panel.start_y ?? panel.y);
            const w = num(panel.width);
            const len = num(panel.length);
            b = mergeBounds(b, sx, sy);
            b = mergeBounds(b, sx + w, sy + len);
        }
    });
    return b;
}

function isPanelPolygon(pts) {
    return Array.isArray(pts) && pts.length > 2;
}

/** Model-space offset (mm) outside room — matches FloorCanvas room width/height (+20 mm) when scale allows */
const DIM_OFFSET_MODEL_MM = 22;
const DIM_WITNESS_GAP_PDF_MM = 4;

const roomDimRgb = hexToRgb(DIMENSION_CONFIG.COLORS.ROOM);

/** Model-mm offset so that layoutScale * offset >= minPdfMm (layoutScale = PDF mm per model mm). */
function modelOffsetForMinPdfGap(layoutScale, minPdfMm) {
    if (!layoutScale || layoutScale <= 0 || !Number.isFinite(minPdfMm)) return DIM_OFFSET_MODEL_MM;
    return Math.max(DIM_OFFSET_MODEL_MM, minPdfMm / layoutScale);
}

function panelBBoxForDims(panel) {
    const pts = panel.shape_points;
    if (isPanelPolygon(pts)) {
        const xs = pts.map((p) => num(p?.x ?? (Array.isArray(p) ? p[0] : null)));
        const ys = pts.map((p) => num(p?.y ?? (Array.isArray(p) ? p[1] : null)));
        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    }
    const sx = num(panel.start_x ?? panel.x);
    const sy = num(panel.start_y ?? panel.y);
    const w = num(panel.width);
    const len = num(panel.length);
    return { minX: sx, maxX: sx + w, minY: sy, maxY: sy + len };
}

const cutPanelDimRgb = hexToRgb(DIMENSION_CONFIG.COLORS.CUT_PANEL);
const panelGroupDimRgb = hexToRgb(DIMENSION_CONFIG.COLORS.PANEL_GROUP);

function normalizeApiArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    return [];
}

function panelRoomId(panel) {
    let rid = panel?.room_id ?? panel?.room ?? panel?.roomId;
    if (rid != null && typeof rid === 'object') rid = rid.id ?? rid.room_id ?? rid;
    const n = Number(rid);
    return Number.isFinite(n) ? n : null;
}

function panelIsCut(panel) {
    return !!(panel?.is_cut_panel || panel?.is_cut);
}

function panelExtentX(p) {
    const sx = num(p.start_x ?? p.x);
    const ex = num(p.end_x);
    const w = num(p.width);
    if (Number.isFinite(ex) && ex > sx) return ex;
    if (w > 0) return sx + w;
    const bb = panelBBoxForDims(p);
    return bb.maxX;
}

function panelExtentY(p) {
    const sy = num(p.start_y ?? p.y);
    const ey = num(p.end_y);
    const len = num(p.length);
    if (Number.isFinite(ey) && ey > sy) return ey;
    if (len > 0) return sy + len;
    const bb = panelBBoxForDims(p);
    return bb.maxY;
}

function roomPlanSizeMm(room) {
    const pts = room?.room_points;
    if (!Array.isArray(pts) || pts.length < 3) return { roomWidth: null, roomLength: null };
    const xs = pts.map((p) => num(p.x ?? p[0]));
    const ys = pts.map((p) => num(p.y ?? p[1]));
    const roomMinX = Math.min(...xs);
    const roomMaxX = Math.max(...xs);
    const roomMinY = Math.min(...ys);
    const roomMaxY = Math.max(...ys);
    return {
        roomWidth: roomMaxX - roomMinX,
        roomLength: roomMaxY - roomMinY
    };
}

function findCeilingPlanForRoom(ceilingPlans, roomId) {
    const norm = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
    return (ceilingPlans || []).find((cp) => {
        const rid = cp.room_id ?? cp.room;
        if (rid != null && typeof rid === 'object') {
            const id = rid.id;
            return id === roomId || id === norm;
        }
        return rid === roomId || rid === norm || String(rid) === String(roomId);
    });
}

function findCeilingPlanForZone(ceilingPlans, zoneId) {
    if (zoneId == null) return null;
    const norm = typeof zoneId === 'string' ? parseInt(zoneId, 10) : zoneId;
    return (ceilingPlans || []).find((cp) => {
        const zid = cp.zone_id ?? cp.zone;
        if (zid != null && typeof zid === 'object') {
            const id = zid.id;
            return id === zoneId || id === norm;
        }
        return zid === zoneId || zid === norm || String(zid) === String(zoneId);
    });
}

function normalizePolygonModelPoints(pts) {
    if (!Array.isArray(pts) || pts.length < 3) return null;
    const out = pts.map((p) => ({ x: num(p.x ?? (Array.isArray(p) ? p[0] : null)), y: num(p.y ?? (Array.isArray(p) ? p[1] : null)) }));
    if (out.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
    return out;
}

function minDistanceToPolygonEdgesModel(x, y, polygon) {
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
        if (dist < minDist) minDist = dist;
    }
    return minDist;
}

/** Same length thresholds as CeilingCanvas.drawPanelSupports */
function panelNeedsNylonSupportModel(panel, ceilingThicknessMm) {
    const bb = panelBBoxForDims(panel);
    const physicalLength = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    const thk = num(panel.thickness, ceilingThicknessMm);
    const threshold = thk <= 100 ? 3000 : 6000;
    return physicalLength > threshold;
}

function panelCenterModelMm(panel) {
    const bb = panelBBoxForDims(panel);
    return { cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2 };
}

function ceilingPlanAllowsAutoNylon(plan) {
    if (!plan) return true;
    const sc = plan.support_config;
    if (sc && sc.enableNylonHangers === false) return false;
    return true;
}

function nylonHangerPdfOptionsFromPlan(plan) {
    const sc = plan?.support_config || {};
    return {
        includeAccessories: !!sc.includeAccessories,
        includeCable: !!sc.includeCable
    };
}

/**
 * Nylon hanger symbol at model point (mx, my), aligned with CeilingCanvas colors.
 * Radius is clamped in PDF mm so it stays readable across scales.
 */
function drawNylonHangerSymbolAtModelMm(doc, mx, my, transformX, transformY, scale, options = {}) {
    const { includeAccessories = false, includeCable = false } = options;
    const px = transformX(mx);
    const py = transformY(my);
    // Small plan marker on paper (mm); scale maps model mm → PDF mm — keep cap low so hangers stay subtle.
    const rPdf = Math.max(0.22, Math.min(1.15, 48 * scale));

    doc.setLineWidth(Math.max(0.06, 0.12 * (rPdf / 0.75)));
    doc.setDrawColor(220, 38, 38);
    doc.setFillColor(252, 165, 165);
    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
    doc.circle(px, py, rPdf, 'FD');

    if (includeAccessories) {
        doc.setDrawColor(245, 158, 11);
        doc.setFillColor(253, 230, 138);
        doc.setLineWidth(Math.max(0.05, 0.08 * (rPdf / 0.75)));
        doc.circle(px, py, rPdf * 0.55, 'FD');
    }
    if (includeCable) {
        doc.setDrawColor(16, 185, 129);
        doc.setLineWidth(Math.max(0.06, 0.1 * (rPdf / 0.75)));
        const drop = rPdf * 0.85;
        doc.line(px, py + rPdf * 0.35, px, py + rPdf * 0.35 + drop);
    }
}

/**
 * Auto nylon hangers on long panels + explicit customSupports type "nylon" (CeilingCanvas parity).
 */
function drawNylonHangersOnCeilingPdf(
    doc,
    panels,
    storeyRooms,
    storeyZones,
    ceilingPlans,
    transformX,
    transformY,
    scale
) {
    if (!panels || panels.length === 0) return;

    const roomPolyById = new Map();
    (storeyRooms || []).forEach((room) => {
        const rid = room.id;
        if (rid == null) return;
        const poly = normalizePolygonModelPoints(room.room_points);
        if (poly) roomPolyById.set(Number(rid), poly);
    });

    const zonePolyById = new Map();
    (storeyZones || []).forEach((z) => {
        if (z?.id == null) return;
        const poly = normalizePolygonModelPoints(z.outline_points);
        if (poly) zonePolyById.set(Number(z.id), poly);
    });

    const planByRoom = new Map();
    const planByZone = new Map();
    (ceilingPlans || []).forEach((cp) => {
        let rid = cp.room_id ?? cp.room;
        if (rid != null && typeof rid === 'object') rid = rid.id;
        if (rid != null && Number.isFinite(Number(rid))) planByRoom.set(Number(rid), cp);
        let zid = cp.zone_id ?? cp.zone;
        if (zid != null && typeof zid === 'object') zid = zid.id;
        if (zid != null && Number.isFinite(Number(zid))) planByZone.set(Number(zid), cp);
    });

    const placedKeys = new Set();
    const markPlaced = (cx, cy) => {
        const k = `${Math.round(cx / 25)}_${Math.round(cy / 25)}`;
        if (placedKeys.has(k)) return false;
        placedKeys.add(k);
        return true;
    };

    const WALL_SUPPORT_THRESHOLD_MM = 200;

    panels.forEach((panel) => {
        let roomId = panel.room_id ?? panel.room;
        if (roomId != null && typeof roomId === 'object') roomId = roomId.id;
        let zoneId = panel.zone_id ?? panel.zone;
        if (zoneId != null && typeof zoneId === 'object') zoneId = zoneId.id;

        let plan = null;
        let boundaryPoly = null;
        if (roomId != null && Number.isFinite(Number(roomId))) {
            plan = planByRoom.get(Number(roomId)) ?? findCeilingPlanForRoom(ceilingPlans, roomId);
            boundaryPoly = roomPolyById.get(Number(roomId)) ?? null;
        } else if (zoneId != null && Number.isFinite(Number(zoneId))) {
            plan = planByZone.get(Number(zoneId)) ?? findCeilingPlanForZone(ceilingPlans, zoneId);
            boundaryPoly = zonePolyById.get(Number(zoneId)) ?? null;
        }

        if (!ceilingPlanAllowsAutoNylon(plan)) return;

        const defaultThk = plan?.ceiling_thickness != null ? num(plan.ceiling_thickness) : 150;
        if (!panelNeedsNylonSupportModel(panel, defaultThk)) return;

        const { cx, cy } = panelCenterModelMm(panel);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

        if (boundaryPoly && boundaryPoly.length >= 3) {
            if (!isPointInPolygon({ x: cx, y: cy }, boundaryPoly)) return;
            if (minDistanceToPolygonEdgesModel(cx, cy, boundaryPoly) <= WALL_SUPPORT_THRESHOLD_MM) return;
        }

        const opts = nylonHangerPdfOptionsFromPlan(plan);
        if (!markPlaced(cx, cy)) return;
        drawNylonHangerSymbolAtModelMm(doc, cx, cy, transformX, transformY, scale, opts);
    });

    const storeyRoomIdSet = new Set((storeyRooms || []).map((r) => Number(r.id)).filter(Number.isFinite));
    const storeyZoneIdSet = new Set((storeyZones || []).map((z) => Number(z.id)).filter(Number.isFinite));

    (ceilingPlans || []).forEach((cp) => {
        let rid = cp.room_id ?? cp.room;
        if (rid != null && typeof rid === 'object') rid = rid.id;
        let zid = cp.zone_id ?? cp.zone;
        if (zid != null && typeof zid === 'object') zid = zid.id;
        const inThisStoreyRoom = rid != null && storeyRoomIdSet.has(Number(rid));
        const inThisStoreyZone = zid != null && storeyZoneIdSet.has(Number(zid));
        if (!inThisStoreyRoom && !inThisStoreyZone) return;

        const custom = cp.support_config?.customSupports;
        if (!Array.isArray(custom) || custom.length === 0) return;
        const opts = nylonHangerPdfOptionsFromPlan(cp);

        custom.forEach((support) => {
            if (!support || support.type !== 'nylon') return;
            let mx;
            let my;
            if (support.x != null && support.y != null) {
                mx = num(support.x);
                my = num(support.y);
            } else {
                const sx = num(support.start_x ?? support.x);
                const sy = num(support.start_y ?? support.y);
                const w = num(support.width);
                const len = num(support.length);
                if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
                mx = sx + w / 2;
                my = sy + len / 2;
            }
            if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
            if (!markPlaced(mx, my)) return;
            drawNylonHangerSymbolAtModelMm(doc, mx, my, transformX, transformY, scale, opts);
        });
    });
}

function pdfCeilingRoomIsHorizontalOrientation(roomId, ceilingPlans, inferPanels) {
    const plan = findCeilingPlanForRoom(ceilingPlans, roomId);
    if (plan?.orientation_strategy) {
        const strategy = String(plan.orientation_strategy).toLowerCase();
        if (strategy === 'horizontal' || strategy === 'all_horizontal') return true;
        if (strategy === 'vertical' || strategy === 'all_vertical') return false;
    }
    if (inferPanels && inferPanels.length > 0) {
        const fp = inferPanels[0];
        return num(fp.width) > num(fp.length);
    }
    return false;
}

function findFloorPlanStrategyForRoom(floorPlans, roomId) {
    const plan = (floorPlans || []).find(
        (fp) => fp.room_id === roomId || String(fp.room_id) === String(roomId)
    );
    return plan?.orientation_strategy || 'auto';
}

function pdfFloorIsHorizontalStrategy(strategy, refPanel) {
    const s = strategy == null ? 'auto' : String(strategy).toLowerCase();
    if (s === 'auto' || s === 'room_optimal' || s === 'best_orientation') {
        return num(refPanel.width) > num(refPanel.length);
    }
    return s.includes('horizontal');
}

/**
 * Grouped plan labels use thin space (U+2009) and × (U+00D7) in DimensionConfig. jsPDF's core
 * Helvetica lacks those code points, so rotated dimension text becomes illegible overlapping glyphs.
 */
function pdfSafePlanDimensionText(dimension, lengthMm) {
    let s = formatPlanDimensionLabel(dimension, lengthMm);
    if (!s) return s;
    s = s.replace(/\u2009×\u2009/g, ' x ');
    s = s.replace(/\u2009/g, ' ');
    s = s.replace(/\u00D7/g, 'x');
    s = s.replace(/×/g, 'x');
    return s;
}

function placePdfDimensionLabel({
    doc,
    text,
    isHorizontal,
    midX,
    midY,
    avoidArea,
    placedLabels,
    preferredSide = 'side1',
    lockedSide = null
}) {
    const textWidth = doc.getTextDimensions(text).w;
    const pH = DIMENSION_CONFIG.LABEL_PADDING_H * PX_TO_MM;
    const pV = DIMENSION_CONFIG.LABEL_PADDING_V * PX_TO_MM;
    const baseOffset = Math.min(DIMENSION_CONFIG.BASE_OFFSET, 10) * PX_TO_MM;
    const offsetIncrement = DIMENSION_CONFIG.OFFSET_INCREMENT * PX_TO_MM;
    const maxAttempts = DIMENSION_CONFIG.MAX_ATTEMPTS;
    const separation = 5 * PX_TO_MM;

    const calculateBounds = (labelX, labelY, width) =>
        isHorizontal
            ? calculateHorizontalLabelBounds(labelX, labelY, width, pH, pV)
            : calculateVerticalLabelBounds(labelX, labelY, width, pH, pV);

    let placement;
    if (isHorizontal) {
        placement = smartPlacement({
            calculatePositionSide1: (offset) => ({ labelX: midX, labelY: avoidArea.minY - offset }),
            calculatePositionSide2: (offset) => ({ labelX: midX, labelY: avoidArea.maxY + offset }),
            calculateBounds,
            textWidth,
            placedLabels,
            baseOffset,
            offsetIncrement,
            maxAttempts,
            preferredSide,
            lockedSide
        });
    } else {
        placement = smartPlacement({
            calculatePositionSide1: (offset) => ({ labelX: avoidArea.minX - offset, labelY: midY }),
            calculatePositionSide2: (offset) => ({ labelX: avoidArea.maxX + offset, labelY: midY }),
            calculateBounds,
            textWidth,
            placedLabels,
            baseOffset,
            offsetIncrement,
            maxAttempts,
            preferredSide,
            lockedSide
        });
    }

    let labelX = placement.labelX;
    let labelY = placement.labelY;
    if (isHorizontal && placement.side === 'side2') {
        labelY = avoidArea.maxY + DIMENSION_CONFIG.BASE_OFFSET_SMALL * PX_TO_MM;
        placement.offset = DIMENSION_CONFIG.BASE_OFFSET_SMALL * PX_TO_MM;
    }
    let bounds = calculateBounds(labelX, labelY, textWidth);

    let validationAttempts = 0;
    let validationOffset =
        isHorizontal && placement.side === 'side2'
            ? DIMENSION_CONFIG.BASE_OFFSET_SMALL * PX_TO_MM
            : (placement.offset || baseOffset);
    while (validationAttempts < maxAttempts) {
        const overlapsOther = hasLabelOverlap(bounds, placedLabels, separation);
        const margin = separation;
        const overlapsAvoid = !(
            bounds.x + bounds.width < avoidArea.minX - margin ||
            bounds.x > avoidArea.maxX + margin ||
            bounds.y + bounds.height < avoidArea.minY - margin ||
            bounds.y > avoidArea.maxY + margin
        );
        if (!overlapsOther && !overlapsAvoid) break;

        const isBottomPlacement = isHorizontal && placement.side === 'side2';
        const increment = isBottomPlacement ? 10 * PX_TO_MM : offsetIncrement;
        validationOffset += increment;
        if (isHorizontal) {
            // Keep direction stable to selected side; never re-enter model area.
            labelY = placement.side === 'side1'
                ? avoidArea.minY - validationOffset
                : avoidArea.maxY + validationOffset;
        } else {
            // Keep direction stable to selected side; never re-enter model area.
            labelX = placement.side === 'side1'
                ? avoidArea.minX - validationOffset
                : avoidArea.maxX + validationOffset;
        }
        bounds = calculateBounds(labelX, labelY, textWidth);
        validationAttempts += 1;
    }

    // Final guard: never allow label to remain inside/overlapping project area.
    const finalOverlapsAvoid = !(
        bounds.x + bounds.width < avoidArea.minX - separation ||
        bounds.x > avoidArea.maxX + separation ||
        bounds.y + bounds.height < avoidArea.minY - separation ||
        bounds.y > avoidArea.maxY + separation
    );
    if (finalOverlapsAvoid) {
        const emergency = baseOffset + (maxAttempts + 2) * offsetIncrement;
        if (isHorizontal) {
            labelY = placement.side === 'side1'
                ? avoidArea.minY - emergency
                : avoidArea.maxY + emergency;
        } else {
            labelX = placement.side === 'side1'
                ? avoidArea.minX - emergency
                : avoidArea.maxX + emergency;
        }
        bounds = calculateBounds(labelX, labelY, textWidth);
    }

    if (hasLabelOverlap(bounds, placedLabels, separation)) {
        const adjustment = 15 * PX_TO_MM;
        if (isHorizontal) {
            const testUp = { ...bounds, y: bounds.y - adjustment };
            const testDown = { ...bounds, y: bounds.y + adjustment };
            if (!hasLabelOverlap(testUp, placedLabels, separation)) {
                labelY -= adjustment;
                bounds = testUp;
            } else if (!hasLabelOverlap(testDown, placedLabels, separation)) {
                labelY += adjustment;
                bounds = testDown;
            }
        } else {
            const testLeft = { ...bounds, x: bounds.x - adjustment };
            const testRight = { ...bounds, x: bounds.x + adjustment };
            if (!hasLabelOverlap(testLeft, placedLabels, separation)) {
                labelX -= adjustment;
                bounds = testLeft;
            } else if (!hasLabelOverlap(testRight, placedLabels, separation)) {
                labelX += adjustment;
                bounds = testRight;
            }
        }
    }

    placedLabels.push(bounds);
    return { labelX, labelY, side: placement.side, bounds };
}

/**
 * @param {{ pdfMinY?: number, offsetY?: number, pageMinModelY?: number, scale?: number, pageBounds?: { minX: number, maxX: number, minY: number, maxY: number }, projectBounds?: { minX: number, maxX: number, minY: number, maxY: number }, geometryBounds?: { minX: number, maxX: number, minY: number, maxY: number } }} layoutHint
 */
function drawPlanDimensions(doc, storeyRooms, panels, transformX, transformY, _scale, layoutHint = {}) {
    const numericDedup = new Set();
    const placedLabels = [];
    const placementMemory = new Map();
    const {
        scale: layoutScale = 0,
        pageBounds: pbIn,
        projectBounds: projIn,
        geometryBounds: geomIn,
        kind: planKind = 'ceiling',
        ceilingPlans = [],
        floorPlans = []
    } = layoutHint;
    const pb = pbIn && boundsValid(pbIn) ? pbIn : null;
    const proj = projIn && boundsValid(projIn) ? projIn : pb;
    if (!pb) return;
    const avoidArea = {
        minX: transformX(proj.minX),
        maxX: transformX(proj.maxX),
        minY: transformY(proj.minY),
        maxY: transformY(proj.maxY)
    };
    const avoidMidX = (avoidArea.minX + avoidArea.maxX) / 2;

    const witnessInset = modelOffsetForMinPdfGap(layoutScale, DIM_WITNESS_GAP_PDF_MM);

    // Match pdfVectorWallPlan.js dimension styling (extension dash, line weights, tick ends, text pad + text).
    const scale = num(_scale, 0);
    const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scale;
    let fontSize = calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN ? DIMENSION_CONFIG.FONT_SIZE_MIN : calculatedFontSize;
    fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', DIMENSION_CONFIG.FONT_WEIGHT === 'bold' ? 'bold' : 'normal');

    const pdfExtDash = [1.2 * PX_TO_MM, 2 * PX_TO_MM];
    const pdfDimLineW = Math.max(0.35, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * PX_TO_MM * 1.4);
    const pdfExtLineW = Math.max(0.22, DIMENSION_CONFIG.LINE_WIDTH * PX_TO_MM * 0.9);
    const pdfTick = 1.3 * PX_TO_MM;

    const roomColor = [roomDimRgb.r, roomDimRgb.g, roomDimRgb.b];
    const cutPanelColor = [cutPanelDimRgb.r, cutPanelDimRgb.g, cutPanelDimRgb.b];
    const panelGroupColor = [panelGroupDimRgb.r, panelGroupDimRgb.g, panelGroupDimRgb.b];

    // Same idea as pdfVectorWallPlan: clip extension dashes to the strict exterior of the drawn plan.
    // Use full geometry (rooms + walls + zones + panels), not projectBounds (room+wall only), or
    // dashes still run through panels/zones outside the room hull.
    let clipModel = null;
    if (geomIn && boundsValid(geomIn)) clipModel = geomIn;
    else if (proj && boundsValid(proj)) clipModel = proj;
    else clipModel = pb;
    const tcx0 = transformX(clipModel.minX);
    const tcx1 = transformX(clipModel.maxX);
    const tcy0 = transformY(clipModel.minY);
    const tcy1 = transformY(clipModel.maxY);
    const modelRectPdf = {
        left: Math.min(tcx0, tcx1),
        right: Math.max(tcx0, tcx1),
        top: Math.min(tcy0, tcy1),
        bottom: Math.max(tcy0, tcy1)
    };
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

    const setPdfDash = (pattern) => {
        if (typeof doc.setLineDashPattern !== 'function') return;
        if (pattern && pattern.length > 0) {
            doc.setLineDashPattern(pattern);
        } else {
            doc.setLineDashPattern([]);
        }
    };

    const drawPdfHorizontalDimArrows = (x0, x1, y, color) => {
        doc.setDrawColor(color[0], color[1], color[2]);
        doc.setLineWidth(pdfDimLineW);
        setPdfDash([]);
        doc.line(x0, y - pdfTick, x0, y + pdfTick);
        doc.line(x1, y - pdfTick, x1, y + pdfTick);
    };
    const drawPdfVerticalDimArrows = (x, y0, y1, color) => {
        doc.setDrawColor(color[0], color[1], color[2]);
        doc.setLineWidth(pdfDimLineW);
        setPdfDash([]);
        doc.line(x - pdfTick, y0, x + pdfTick, y0);
        doc.line(x - pdfTick, y1, x + pdfTick, y1);
    };
    const drawPdfHorizontalTicks = (xs, y, color) => {
        if (!xs || xs.length === 0) return;
        doc.setDrawColor(color[0], color[1], color[2]);
        doc.setLineWidth(pdfDimLineW);
        setPdfDash([]);
        xs.forEach((x) => {
            doc.line(x, y - pdfTick, x, y + pdfTick);
        });
    };
    const drawPdfVerticalTicks = (x, ys, color) => {
        if (!ys || ys.length === 0) return;
        doc.setDrawColor(color[0], color[1], color[2]);
        doc.setLineWidth(pdfDimLineW);
        setPdfDash([]);
        ys.forEach((y) => {
            doc.line(x - pdfTick, y, x + pdfTick, y);
        });
    };
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

    const drawPdfVerticalStripDimension = ({
        text,
        colorRgb,
        minXModel,
        maxXModel,
        minYModel,
        maxYModel,
        dimKey,
        preferredSide
    }) => {
        const xc = transformX((minXModel + maxXModel) / 2);
        const yLo = transformY(minYModel);
        const yHi = transformY(maxYModel);
        const textWidth = doc.getTextWidth(text);
        const textPadding = 2 * PX_TO_MM;
        const placement = placePdfDimensionLabel({
            doc,
            text,
            isHorizontal: false,
            midX: xc,
            midY: (yLo + yHi) / 2,
            avoidArea,
            placedLabels,
            preferredSide: preferredSide ?? (xc > avoidMidX ? 'side2' : 'side1'),
            lockedSide: placementMemory.get(dimKey)
        });
        if (!placementMemory.has(dimKey)) placementMemory.set(dimKey, placement.side);

        const labelX = placement.labelX;
        const labelY = placement.labelY;
        const textTop = labelY - textWidth / 2 - textPadding;
        const textBottom = labelY + textWidth / 2 + textPadding;
        const startYScreen = yLo;
        const endYScreen = yHi;

        setPdfDash(pdfExtDash);
        doc.setLineWidth(pdfExtLineW);
        doc.setDrawColor(colorRgb[0], colorRgb[1], colorRgb[2]);
        drawDashedExtensionLine(xc, yLo, labelX, yLo);
        drawDashedExtensionLine(xc, yHi, labelX, yHi);

        setPdfDash([]);
        doc.setLineWidth(pdfDimLineW);
        doc.setDrawColor(colorRgb[0], colorRgb[1], colorRgb[2]);
        if (startYScreen < textTop) {
            doc.line(labelX, startYScreen, labelX, textTop);
        }
        if (endYScreen > textBottom) {
            doc.line(labelX, textBottom, labelX, endYScreen);
        }

        const vTickYs = [];
        if (startYScreen < textTop) {
            vTickYs.push(startYScreen, textTop);
        }
        if (endYScreen > textBottom) {
            vTickYs.push(textBottom, endYScreen);
        }
        drawPdfVerticalTicks(labelX, vTickYs, colorRgb);
        if (vTickYs.length > 0) {
            drawPdfVerticalDimArrows(labelX, startYScreen, endYScreen, colorRgb);
        }

        doc.setTextColor(colorRgb[0], colorRgb[1], colorRgb[2]);
        const textGap = 2 * PX_TO_MM;
        const textX = labelX - textGap;
        const gapCenter = (textTop + textBottom) / 2;
        const textY = gapCenter - textWidth / 2;
        drawPdfDimTextPadV(textX, gapCenter, textWidth, 2 * PX_TO_MM);
        doc.text(text, textX, textY, {
            align: 'left',
            angle: -90
        });
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
    };

    const drawPdfHorizontalStripDimension = ({
        text,
        colorRgb,
        minXModel,
        maxXModel,
        minYModel,
        maxYModel,
        dimKey,
        preferredSide = 'side1'
    }) => {
        const yc = transformY((minYModel + maxYModel) / 2);
        const xL = transformX(minXModel);
        const xR = transformX(maxXModel);
        const textWidth = doc.getTextWidth(text);
        const textPadding = 2 * PX_TO_MM;
        const placement = placePdfDimensionLabel({
            doc,
            text,
            isHorizontal: true,
            midX: (xL + xR) / 2,
            midY: yc,
            avoidArea,
            placedLabels,
            preferredSide,
            lockedSide: placementMemory.get(dimKey)
        });
        if (!placementMemory.has(dimKey)) placementMemory.set(dimKey, placement.side);

        const labelY = placement.labelY;
        const startXScreen = xL;
        const endXScreen = xR;
        const centeredLabelX = (startXScreen + endXScreen) / 2;
        const centeredTextLeft = centeredLabelX - textWidth / 2 - textPadding;
        const centeredTextRight = centeredLabelX + textWidth / 2 + textPadding;

        setPdfDash(pdfExtDash);
        doc.setLineWidth(pdfExtLineW);
        doc.setDrawColor(colorRgb[0], colorRgb[1], colorRgb[2]);
        drawDashedExtensionLine(xL, yc, xL, labelY);
        drawDashedExtensionLine(xR, yc, xR, labelY);

        setPdfDash([]);
        doc.setLineWidth(pdfDimLineW);
        doc.setDrawColor(colorRgb[0], colorRgb[1], colorRgb[2]);
        if (startXScreen < centeredTextLeft) {
            doc.line(startXScreen, labelY, centeredTextLeft, labelY);
        }
        if (endXScreen > centeredTextRight) {
            doc.line(centeredTextRight, labelY, endXScreen, labelY);
        }

        const hTickXs = [];
        if (startXScreen < centeredTextLeft) {
            hTickXs.push(startXScreen, centeredTextLeft);
        }
        if (endXScreen > centeredTextRight) {
            hTickXs.push(centeredTextRight, endXScreen);
        }
        drawPdfHorizontalTicks(hTickXs, labelY, colorRgb);
        if (hTickXs.length > 0) {
            drawPdfHorizontalDimArrows(startXScreen, endXScreen, labelY, colorRgb);
        }

        doc.setTextColor(colorRgb[0], colorRgb[1], colorRgb[2]);
        drawPdfDimTextPadH(centeredLabelX, labelY, text, 2 * PX_TO_MM);
        doc.text(text, centeredLabelX, labelY, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
    };

    const panelDedupSet = new Set();
    const drawnPanelLevels = new Map();
    const LEVEL_TOLERANCE = 10;
    const DIM_TOL = 1;
    const matchesRoomDim = (panelDim, roomDim) =>
        roomDim != null && Math.abs(panelDim - roomDim) <= DIM_TOL;
    const isPanelLevelDrawn = (dimensionValue, level, isHorizontalLine) => {
        const roundedLevel = Math.round(level / LEVEL_TOLERANCE) * LEVEL_TOLERANCE;
        const roundedValue = Math.round(dimensionValue);
        const key = isHorizontalLine ? `H_${roundedValue}_${roundedLevel}` : `V_${roundedValue}_${roundedLevel}`;
        return drawnPanelLevels.has(key);
    };
    const markPanelLevel = (dimensionValue, level, isHorizontalLine) => {
        const roundedLevel = Math.round(level / LEVEL_TOLERANCE) * LEVEL_TOLERANCE;
        const roundedValue = Math.round(dimensionValue);
        const key = isHorizontalLine ? `H_${roundedValue}_${roundedLevel}` : `V_${roundedValue}_${roundedLevel}`;
        drawnPanelLevels.set(key, true);
    };
    const tryPanelDedup = (dimensionStub, lenMm) => {
        const k = planDimensionDedupKey(dimensionStub, lenMm);
        if (panelDedupSet.has(k)) return false;
        panelDedupSet.add(k);
        return true;
    };

    const panelsByRoomId = new Map();
    (panels || []).forEach((p) => {
        const rid = panelRoomId(p);
        if (rid == null) return;
        if (!panelsByRoomId.has(rid)) panelsByRoomId.set(rid, []);
        panelsByRoomId.get(rid).push(p);
    });

    (storeyRooms || []).forEach((room) => {
        const pts = room.room_points;
        if (!Array.isArray(pts) || pts.length < 3) return;
        const xs = pts.map((p) => num(p.x ?? p[0]));
        const ys = pts.map((p) => num(p.y ?? p[1]));
        const roomMinX = Math.min(...xs);
        const roomMaxX = Math.max(...xs);
        const roomMinY = Math.min(...ys);
        const roomMaxY = Math.max(...ys);
        const roomW = roomMaxX - roomMinX;
        const roomH = roomMaxY - roomMinY;
        if (!(roomW > 1) || !(roomH > 1)) return;

        const widthRounded = Math.round(roomW);
        if (!numericDedup.has(widthRounded)) {
            numericDedup.add(widthRounded);
            const text = String(widthRounded);
            const textWidth = doc.getTextWidth(text);
            const textPadding = 2 * PX_TO_MM;

            const x1 = transformX(roomMinX);
            const x2 = transformX(roomMaxX);
            const yWitness = transformY(roomMaxY + Math.max(20, witnessInset));
            const midX = (x1 + x2) / 2;
            const dimKey = `${roomMinX.toFixed(2)}_${roomMaxX.toFixed(2)}_${roomMaxY.toFixed(2)}_room_width`;
            const placement = placePdfDimensionLabel({
                doc,
                text,
                isHorizontal: true,
                midX,
                midY: yWitness,
                avoidArea,
                placedLabels,
                preferredSide: 'side1',
                lockedSide: placementMemory.get(dimKey)
            });
            if (!placementMemory.has(dimKey)) placementMemory.set(dimKey, placement.side);

            const labelY = placement.labelY;
            const startXScreen = x1;
            const endXScreen = x2;
            const centeredLabelX = (startXScreen + endXScreen) / 2;
            const centeredTextLeft = centeredLabelX - textWidth / 2 - textPadding;
            const centeredTextRight = centeredLabelX + textWidth / 2 + textPadding;

            setPdfDash(pdfExtDash);
            doc.setLineWidth(pdfExtLineW);
            doc.setDrawColor(roomColor[0], roomColor[1], roomColor[2]);
            drawDashedExtensionLine(x1, yWitness, x1, labelY);
            drawDashedExtensionLine(x2, yWitness, x2, labelY);

            setPdfDash([]);
            doc.setLineWidth(pdfDimLineW);
            doc.setDrawColor(roomColor[0], roomColor[1], roomColor[2]);
            if (startXScreen < centeredTextLeft) {
                doc.line(startXScreen, labelY, centeredTextLeft, labelY);
            }
            if (endXScreen > centeredTextRight) {
                doc.line(centeredTextRight, labelY, endXScreen, labelY);
            }

            const hTickXs = [];
            if (startXScreen < centeredTextLeft) {
                hTickXs.push(startXScreen, centeredTextLeft);
            }
            if (endXScreen > centeredTextRight) {
                hTickXs.push(centeredTextRight, endXScreen);
            }
            drawPdfHorizontalTicks(hTickXs, labelY, roomColor);
            if (hTickXs.length > 0) {
                drawPdfHorizontalDimArrows(startXScreen, endXScreen, labelY, roomColor);
            }

            doc.setTextColor(roomColor[0], roomColor[1], roomColor[2]);
            drawPdfDimTextPadH(centeredLabelX, labelY, text, 2 * PX_TO_MM);
            doc.text(text, centeredLabelX, labelY, { align: 'center' });
            doc.setTextColor(0, 0, 0);
        }

        const heightRounded = Math.round(roomH);
        if (!numericDedup.has(heightRounded)) {
            numericDedup.add(heightRounded);
            const text = String(heightRounded);
            const textWidth = doc.getTextWidth(text);
            const textPadding = 2 * PX_TO_MM;

            const y1 = transformY(roomMinY);
            const y2 = transformY(roomMaxY);
            const xWitness = transformX(roomMinX - Math.max(20, witnessInset));
            const midY = (y1 + y2) / 2;
            const dimKey = `${roomMinX.toFixed(2)}_${roomMinY.toFixed(2)}_${roomMaxY.toFixed(2)}_room_height`;
            const placement = placePdfDimensionLabel({
                doc,
                text,
                isHorizontal: false,
                midX: xWitness,
                midY,
                avoidArea,
                placedLabels,
                preferredSide: midY >= 0 && xWitness > avoidMidX ? 'side2' : 'side1',
                lockedSide: placementMemory.get(dimKey)
            });
            if (!placementMemory.has(dimKey)) placementMemory.set(dimKey, placement.side);

            const labelX = placement.labelX;
            const labelY = placement.labelY;
            const textTop = labelY - textWidth / 2 - textPadding;
            const textBottom = labelY + textWidth / 2 + textPadding;
            const startYScreen = y1;
            const endYScreen = y2;

            setPdfDash(pdfExtDash);
            doc.setLineWidth(pdfExtLineW);
            doc.setDrawColor(roomColor[0], roomColor[1], roomColor[2]);
            drawDashedExtensionLine(xWitness, y1, labelX, y1);
            drawDashedExtensionLine(xWitness, y2, labelX, y2);

            setPdfDash([]);
            doc.setLineWidth(pdfDimLineW);
            doc.setDrawColor(roomColor[0], roomColor[1], roomColor[2]);
            if (startYScreen < textTop) {
                doc.line(labelX, startYScreen, labelX, textTop);
            }
            if (endYScreen > textBottom) {
                doc.line(labelX, textBottom, labelX, endYScreen);
            }

            const vTickYs = [];
            if (startYScreen < textTop) {
                vTickYs.push(startYScreen, textTop);
            }
            if (endYScreen > textBottom) {
                vTickYs.push(textBottom, endYScreen);
            }
            drawPdfVerticalTicks(labelX, vTickYs, roomColor);
            if (vTickYs.length > 0) {
                drawPdfVerticalDimArrows(labelX, startYScreen, endYScreen, roomColor);
            }

            doc.setTextColor(roomColor[0], roomColor[1], roomColor[2]);
            const textGap = 2 * PX_TO_MM;
            const textX = labelX - textGap;
            const gapCenter = (textTop + textBottom) / 2;
            const textY = gapCenter - textWidth / 2;
            drawPdfDimTextPadV(textX, gapCenter, textWidth, 2 * PX_TO_MM);
            doc.text(text, textX, textY, {
                align: 'left',
                angle: -90
            });
            doc.setTextColor(0, 0, 0);
        }
    });

    (storeyRooms || []).forEach((room) => {
        const roomId = Number(room.id);
        if (!Number.isFinite(roomId)) return;
        const roomPanels = panelsByRoomId.get(roomId) || [];
        if (roomPanels.length === 0) return;

        if (planKind === 'floor') {
            const isPanelFloor = room.floor_type === 'panel' || room.floor_type === 'Panel';
            if (!isPanelFloor) return;
        }

        const { roomWidth, roomLength } = roomPlanSizeMm(room);
        const fullPanels = roomPanels.filter((p) => !panelIsCut(p));
        if (fullPanels.length === 0) return;

        const shouldShowIndividual = roomPanels.length <= 20;
        const drawnLocal = new Set();

        if (planKind === 'floor') {
            const strategy = findFloorPlanStrategyForRoom(floorPlans, room.id);
            const refPanel = fullPanels[0] || roomPanels[0];
            if (!refPanel) return;
            const isHorizontalStrategy = pdfFloorIsHorizontalStrategy(strategy, refPanel);

            const panelsByDimension = new Map();
            fullPanels.forEach((panel) => {
                const groupingDimension = isHorizontalStrategy ? num(panel.length) : num(panel.width);
                const dimensionValue = Math.round(groupingDimension * 100) / 100;
                if (!(dimensionValue > 0)) return;
                if (!panelsByDimension.has(dimensionValue)) panelsByDimension.set(dimensionValue, []);
                panelsByDimension.get(dimensionValue).push(panel);
            });

            panelsByDimension.forEach((grp, dimensionValue) => {
                if (grp.length > 1) {
                    const dimensionKey = `grouped_${dimensionValue}_${grp.length}_${isHorizontalStrategy ? 'H' : 'V'}_${roomId}`;
                    if (drawnLocal.has(dimensionKey)) return;
                    drawnLocal.add(dimensionKey);

                    const minX = Math.min(...grp.map((p) => num(p.start_x ?? p.x)));
                    const maxX = Math.max(...grp.map(panelExtentX));
                    const minY = Math.min(...grp.map((p) => num(p.start_y ?? p.y)));
                    const maxY = Math.max(...grp.map(panelExtentY));
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;
                    const qty = grp.length;

                    if (isHorizontalStrategy) {
                        if (matchesRoomDim(dimensionValue, roomLength)) return;
                        if (isPanelLevelDrawn(dimensionValue, centerX, false)) return;
                        const typeTag = 'grouped_length_horizontal';
                        const stub = { type: typeTag, quantity: qty, roomId };
                        if (!tryPanelDedup(stub, dimensionValue)) return;
                        const text = pdfSafePlanDimensionText(stub, dimensionValue);
                        drawPdfVerticalStripDimension({
                            text,
                            colorRgb: panelGroupColor,
                            minXModel: minX,
                            maxXModel: maxX,
                            minYModel: minY,
                            maxYModel: maxY,
                            dimKey: `fp_g_v_${roomId}_${dimensionValue}_${qty}`,
                            preferredSide: transformX(centerX) > avoidMidX ? 'side2' : 'side1'
                        });
                        markPanelLevel(dimensionValue, centerX, false);
                    } else {
                        if (matchesRoomDim(dimensionValue, roomWidth)) return;
                        if (isPanelLevelDrawn(dimensionValue, centerY, true)) return;
                        const typeTag = 'grouped_width_vertical';
                        const stub = { type: typeTag, quantity: qty, roomId };
                        if (!tryPanelDedup(stub, dimensionValue)) return;
                        const text = pdfSafePlanDimensionText(stub, dimensionValue);
                        drawPdfHorizontalStripDimension({
                            text,
                            colorRgb: panelGroupColor,
                            minXModel: minX,
                            maxXModel: maxX,
                            minYModel: minY,
                            maxYModel: maxY,
                            dimKey: `fp_g_h_${roomId}_${dimensionValue}_${qty}`
                        });
                        markPanelLevel(dimensionValue, centerY, true);
                    }
                } else if (grp.length === 1 && shouldShowIndividual) {
                    const panel = grp[0];
                    const dimVal = Math.round(dimensionValue * 100) / 100;
                    const shouldShow = isHorizontalStrategy
                        ? !matchesRoomDim(dimVal, roomLength)
                        : !matchesRoomDim(dimVal, roomWidth);
                    const fullDimensionKey = `full_${panel.id}`;
                    if (drawnLocal.has(fullDimensionKey)) return;
                    drawnLocal.add(fullDimensionKey);
                    if (!shouldShow) return;

                    const stub = {
                        type: 'individual_panel',
                        roomId,
                        dedupId: panel.id != null ? String(panel.id) : ''
                    };
                    if (!tryPanelDedup(stub, dimVal)) return;
                    const text = pdfSafePlanDimensionText(stub, dimVal);
                    const minX = num(panel.start_x ?? panel.x);
                    const maxX = panelExtentX(panel);
                    const minY = num(panel.start_y ?? panel.y);
                    const maxY = panelExtentY(panel);
                    const cx = (minX + maxX) / 2;

                    if (isHorizontalStrategy) {
                        drawPdfVerticalStripDimension({
                            text,
                            colorRgb: panelGroupColor,
                            minXModel: minX,
                            maxXModel: maxX,
                            minYModel: minY,
                            maxYModel: maxY,
                            dimKey: `fp_ind_v_${panel.id}_${dimVal}`,
                            preferredSide: transformX(cx) > avoidMidX ? 'side2' : 'side1'
                        });
                    } else {
                        drawPdfHorizontalStripDimension({
                            text,
                            colorRgb: panelGroupColor,
                            minXModel: minX,
                            maxXModel: maxX,
                            minYModel: minY,
                            maxYModel: maxY,
                            dimKey: `fp_ind_h_${panel.id}_${dimVal}`
                        });
                    }
                }
            });
        } else {
            const isHorizontalOrientation = pdfCeilingRoomIsHorizontalOrientation(room.id, ceilingPlans, fullPanels);

            const panelsByDimension = new Map();
            fullPanels.forEach((panel) => {
                const w = num(panel.width);
                const len = num(panel.length);
                if (!(w > 0) || !(len > 0)) return;
                const isHorizontalPanel = w >= len;
                const groupingDimension = isHorizontalPanel ? len : w;
                const dimensionValue = Math.round(groupingDimension * 100) / 100;
                if (!panelsByDimension.has(dimensionValue)) panelsByDimension.set(dimensionValue, []);
                panelsByDimension.get(dimensionValue).push(panel);
            });

            panelsByDimension.forEach((grp, dimensionValue) => {
                if (grp.length > 1) {
                    const dimensionKey = `grouped_${dimensionValue}_${grp.length}_${roomId}`;
                    if (drawnLocal.has(dimensionKey)) return;
                    drawnLocal.add(dimensionKey);

                    const p0w = num(grp[0].width);
                    const p0l = num(grp[0].length);
                    const isVerticalPanel = p0l > p0w;
                    const isHorizontalPanel = p0w >= p0l;

                    const minX = Math.min(...grp.map((p) => num(p.start_x ?? p.x)));
                    const maxX = Math.max(...grp.map(panelExtentX));
                    const minY = Math.min(...grp.map((p) => num(p.start_y ?? p.y)));
                    const maxY = Math.max(...grp.map(panelExtentY));
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;
                    const qty = grp.length;

                    const drawV = (typeTag, val, roomDim) => {
                        if (matchesRoomDim(val, roomDim)) return;
                        if (isPanelLevelDrawn(val, centerX, false)) return;
                        const stub = { type: typeTag, quantity: qty, roomId };
                        if (!tryPanelDedup(stub, val)) return;
                        const text = pdfSafePlanDimensionText(stub, val);
                        drawPdfVerticalStripDimension({
                            text,
                            colorRgb: panelGroupColor,
                            minXModel: minX,
                            maxXModel: maxX,
                            minYModel: minY,
                            maxYModel: maxY,
                            dimKey: `cp_g_v_${roomId}_${val}_${qty}_${typeTag}`,
                            preferredSide: transformX(centerX) > avoidMidX ? 'side2' : 'side1'
                        });
                        markPanelLevel(val, centerX, false);
                    };

                    const drawH = (typeTag, val, roomDim) => {
                        if (matchesRoomDim(val, roomDim)) return;
                        if (isPanelLevelDrawn(val, centerY, true)) return;
                        const stub = { type: typeTag, quantity: qty, roomId };
                        if (!tryPanelDedup(stub, val)) return;
                        const text = pdfSafePlanDimensionText(stub, val);
                        drawPdfHorizontalStripDimension({
                            text,
                            colorRgb: panelGroupColor,
                            minXModel: minX,
                            maxXModel: maxX,
                            minYModel: minY,
                            maxYModel: maxY,
                            dimKey: `cp_g_h_${roomId}_${val}_${qty}_${typeTag}`
                        });
                        markPanelLevel(val, centerY, true);
                    };

                    if (isHorizontalOrientation) {
                        if (isHorizontalPanel) drawV('grouped_length_horizontal', dimensionValue, roomLength);
                        else if (isVerticalPanel) drawH('grouped_width_horizontal', dimensionValue, roomWidth);
                    } else {
                        if (isVerticalPanel) drawH('grouped_width_vertical', dimensionValue, roomWidth);
                        else if (isHorizontalPanel) drawV('grouped_length_vertical', dimensionValue, roomLength);
                    }
                } else if (grp.length === 1 && shouldShowIndividual) {
                    const panel = grp[0];
                    const panelWidth = Math.round(num(panel.width) * 100) / 100;
                    const fullDimensionKey = `full_${panel.id}`;
                    if (drawnLocal.has(fullDimensionKey)) return;
                    drawnLocal.add(fullDimensionKey);
                    if (matchesRoomDim(panelWidth, roomWidth)) return;

                    const stub = {
                        type: 'individual_panel',
                        roomId,
                        dedupId: panel.id != null ? String(panel.id) : ''
                    };
                    if (!tryPanelDedup(stub, panelWidth)) return;
                    const text = pdfSafePlanDimensionText(stub, panelWidth);

                    const minX = num(panel.start_x ?? panel.x);
                    const maxX = panelExtentX(panel);
                    const minY = num(panel.start_y ?? panel.y);
                    const maxY = panelExtentY(panel);

                    drawPdfHorizontalStripDimension({
                        text,
                        colorRgb: panelGroupColor,
                        minXModel: minX,
                        maxXModel: maxX,
                        minYModel: minY,
                        maxYModel: maxY,
                        dimKey: `cp_ind_${panel.id}_${panelWidth}`
                    });
                }
            });
        }
    });

    (panels || []).forEach((panel) => {
        if (!panelIsCut(panel)) return;

        const bb = panelBBoxForDims(panel);
        const w = num(panel.width);
        const len = num(panel.length);
        const bw = bb.maxX - bb.minX;
        const bh = bb.maxY - bb.minY;
        const stripWide = w > 0 && len > 0 ? w > len : bw > bh;

        let tW = w;
        let tLen = len;
        if (!(tW > 0) && bw > 0) tW = bw;
        if (!(tLen > 0) && bh > 0) tLen = bh;
        if (!(tW > 0) || !(tLen > 0)) return;

        const lenMm = Math.round(Math.min(tW, tLen));
        const rid = panelRoomId(panel);
        const cutStub = {
            type: 'cut_panel',
            isCut: true,
            roomId: rid != null ? rid : undefined,
            dedupId: panel.id != null ? String(panel.id) : ''
        };
        if (!tryPanelDedup(cutStub, lenMm)) return;
        const show = pdfSafePlanDimensionText(cutStub, lenMm);

        if (stripWide) {
            drawPdfVerticalStripDimension({
                text: show,
                colorRgb: cutPanelColor,
                minXModel: bb.minX,
                maxXModel: bb.maxX,
                minYModel: bb.minY,
                maxYModel: bb.maxY,
                dimKey: `${bb.minX.toFixed(2)}_${bb.maxX.toFixed(2)}_${bb.minY.toFixed(2)}_${bb.maxY.toFixed(2)}_cut_v`
            });
        } else {
            drawPdfHorizontalStripDimension({
                text: show,
                colorRgb: cutPanelColor,
                minXModel: bb.minX,
                maxXModel: bb.maxX,
                minYModel: bb.minY,
                maxYModel: bb.maxY,
                dimKey: `${bb.minX.toFixed(2)}_${bb.maxX.toFixed(2)}_${bb.minY.toFixed(2)}_${bb.maxY.toFixed(2)}_cut_h`
            });
        }
    });
}


function drawRoomOutlines(doc, storeyRooms, transformX, transformY) {
    doc.setDrawColor(55, 55, 55);
    doc.setLineWidth(0.4);
    storeyRooms.forEach((room) => {
        const pts = room.room_points;
        if (!Array.isArray(pts) || pts.length < 3) return;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const q = pts[(i + 1) % pts.length];
            const x1 = transformX(num(p.x ?? p[0]));
            const y1 = transformY(num(p.y ?? p[1]));
            const x2 = transformX(num(q.x ?? q[0]));
            const y2 = transformY(num(q.y ?? q[1]));
            doc.line(x1, y1, x2, y2);
        }
    });
}

/** Model-space label anchor — matches FloorCanvas / CeilingCanvas (label_position, else visual center). */
function roomLabelPositionModel(room) {
    const pts = room.room_points;
    if (!Array.isArray(pts) || pts.length < 3) return null;

    const lp = room.label_position;
    if (
        lp != null &&
        typeof lp === 'object' &&
        !Array.isArray(lp) &&
        Number.isFinite(Number(lp.x)) &&
        Number.isFinite(Number(lp.y))
    ) {
        return { x: Number(lp.x), y: Number(lp.y) };
    }
    if (Array.isArray(lp) && lp.length >= 2) {
        const lx = Number(lp[0]);
        const ly = Number(lp[1]);
        if (Number.isFinite(lx) && Number.isFinite(ly)) return { x: lx, y: ly };
    }

    const normalized = pts.map((p) => ({
        x: num(p?.x ?? (Array.isArray(p) ? p[0] : null)),
        y: num(p?.y ?? (Array.isArray(p) ? p[1] : null))
    }));
    const visual = calculatePolygonVisualCenter(normalized);
    if (visual) return visual;
    const cx = normalized.reduce((s, p) => s + p.x, 0) / normalized.length;
    const cy = normalized.reduce((s, p) => s + p.y, 0) / normalized.length;
    return { x: cx, y: cy };
}

function roomBBoxModel(room) {
    const pts = room.room_points;
    if (!Array.isArray(pts) || pts.length < 3) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pts.forEach((p) => {
        const x = num(p?.x ?? (Array.isArray(p) ? p[0] : null));
        const y = num(p?.y ?? (Array.isArray(p) ? p[1] : null));
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    });
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
    return { minX, maxX, minY, maxY };
}

/**
 * Room names on the plan (vector PDF). Drawn after dimensions so labels stay readable.
 * `scale` is PDF mm per model mm (same as drawPlanPage local `scale`).
 */
function drawRoomNameLabelsOnPdf(doc, storeyRooms, transformX, transformY, scale) {
    const MIN_W_PDF_MM = 5;
    const MIN_H_PDF_MM = 4;

    doc.setFont('helvetica', 'bold');
    storeyRooms.forEach((room) => {
        const name = (room.room_name != null ? String(room.room_name) : '').trim();
        if (!name) return;

        const bb = roomBBoxModel(room);
        if (!bb) return;
        const wPdf = (bb.maxX - bb.minX) * scale;
        const hPdf = (bb.maxY - bb.minY) * scale;
        const isSlabRoom = room.floor_type === 'slab' || room.floor_type === 'Slab';
        const minH = isSlabRoom ? MIN_H_PDF_MM * 1.1 : MIN_H_PDF_MM;
        if (wPdf < MIN_W_PDF_MM || hPdf < minH) return;

        const pos = roomLabelPositionModel(room);
        if (!pos) return;

        const tx = transformX(pos.x);
        const ty = transformY(pos.y);
        const fontPt = Math.max(8, Math.min(11, Math.min(wPdf, hPdf) * 0.22));
        doc.setFontSize(fontPt);
        doc.setTextColor(107, 114, 128);
        doc.text(name, tx, ty, { align: 'center', baseline: 'middle' });
    });

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
}

/** PDF mm — panels thinner than this on the short side are expanded (centered) for readability */
const MIN_PANEL_SHORT_SIDE_MM = 0.55;
/** When short side / long side in PDF is below this, treat as a narrow strip (same expansion rules) */
const MAX_THIN_ASPECT_SHORT_OVER_LONG = 0.12;
/** Hairline around full panels — thin to limit moiré where many strips meet */
const STROKE_FULL_PANEL_MM = 0.05;
/** Cut panels: dashed outline */
const STROKE_CUT_PANEL_MM = 0.08;

function expandThinRectPdf(left, top, rw, rh) {
    const MIN = MIN_PANEL_SHORT_SIDE_MM;
    if (!(rw > 0) && !(rh > 0)) {
        return { left, top, rw: MIN, rh: MIN, isStrip: true };
    }
    const cx = left + rw / 2;
    const cy = top + rh / 2;
    const long = Math.max(rw, rh);
    const short = Math.min(rw, rh);
    const aspect = long > 0 ? short / long : 1;
    let nl = left;
    let nt = top;
    let nrw = rw;
    let nrh = rh;
    let isStrip = false;

    const needsHelp = short < MIN || aspect < MAX_THIN_ASPECT_SHORT_OVER_LONG;
    if (!needsHelp) {
        return { left: nl, top: nt, rw: nrw, rh: nrh, isStrip: false };
    }
    isStrip = true;
    if (rw < MIN && rh < MIN) {
        nrw = Math.max(rw, MIN);
        nrh = Math.max(rh, MIN);
    } else if (rw <= rh) {
        nrw = Math.max(rw, MIN);
        nrh = rh;
    } else {
        nrh = Math.max(rh, MIN);
        nrw = rw;
    }
    nl = cx - nrw / 2;
    nt = cy - nrh / 2;
    return { left: nl, top: nt, rw: nrw, rh: nrh, isStrip };
}

function bboxPdfPath(pdfPath) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pdfPath.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    });
    const w = maxX - minX;
    const h = maxY - minY;
    return { minX, minY, maxX, maxY, w, h };
}

function isThinPolygonPdfBBox(bbox) {
    if (!bbox || !(bbox.w > 0) || !(bbox.h > 0)) return true;
    const short = Math.min(bbox.w, bbox.h);
    const long = Math.max(bbox.w, bbox.h);
    const aspect = long > 0 ? short / long : 1;
    return short < MIN_PANEL_SHORT_SIDE_MM || aspect < MAX_THIN_ASPECT_SHORT_OVER_LONG;
}

function lightenRgb([r, g, b], amount = 0.35) {
    const a = Math.max(0, Math.min(1, amount));
    return [
        Math.round(r + (255 - r) * a),
        Math.round(g + (255 - g) * a),
        Math.round(b + (255 - b) * a)
    ];
}

function darkenRgb([r, g, b], amount = 0.28) {
    const a = Math.max(0, Math.min(1, amount));
    return [
        Math.round(r * (1 - a)),
        Math.round(g * (1 - a)),
        Math.round(b * (1 - a))
    ];
}

function hslToRgb(h, s, l) {
    // h: 0..360, s/l: 0..1
    const hh = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hh < 60) {
        r1 = c;
        g1 = x;
    } else if (hh < 120) {
        r1 = x;
        g1 = c;
    } else if (hh < 180) {
        g1 = c;
        b1 = x;
    } else if (hh < 240) {
        g1 = x;
        b1 = c;
    } else if (hh < 300) {
        r1 = x;
        b1 = c;
    } else {
        r1 = c;
        b1 = x;
    }
    return [r1 + m, g1 + m, b1 + m].map((v) => Math.round(v * 255));
}

function cssColorToRgba(css) {
    const str = (css || '').trim();
    if (!str) return { r: 0, g: 0, b: 0, a: 1 };

    // #RRGGBB
    if (str[0] === '#') {
        const { r, g, b } = hexToRgb(str);
        return { r, g, b, a: 1 };
    }

    // rgba(r,g,b,a) or rgb(r,g,b)
    if (str.startsWith('rgba(') || str.startsWith('rgb(')) {
        const parts = str
            .replace(/^rgba?\(/, '')
            .replace(/\)$/, '')
            .split(',')
            .map((p) => p.trim());
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
        return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    }

    // hsl(...) / hsla(...)
    if (str.startsWith('hsla(') || str.startsWith('hsl(')) {
        const parts = str
            .replace(/^hsla?\(/, '')
            .replace(/\)$/, '')
            .split(',')
            .map((p) => p.trim());

        const h = parseFloat(parts[0]);
        const sPct = parseFloat(parts[1]); // %
        const lPct = parseFloat(parts[2]); // %
        const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;

        const s = Number.isFinite(sPct) ? sPct / 100 : 0;
        const l = Number.isFinite(lPct) ? lPct / 100 : 0;
        const rgb = hslToRgb(h, s, l);
        return { r: rgb[0], g: rgb[1], b: rgb[2], a: Number.isFinite(a) ? a : 1 };
    }

    // Fallback: attempt hex parsing
    const { r, g, b } = hexToRgb(str);
    return { r, g, b, a: 1 };
}

function cssColorToPdfRgb(css) {
    const { r, g, b, a } = cssColorToRgba(css);
    const alpha = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1;
    if (alpha >= 1) return [r, g, b];
    // Composite against white background (canvas output is typically on white #fff).
    return [
        Math.round(r * alpha + 255 * (1 - alpha)),
        Math.round(g * alpha + 255 * (1 - alpha)),
        Math.round(b * alpha + 255 * (1 - alpha))
    ];
}

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
    return `${coreThk}|INT:${intThk} ${intMat}`;
}

function generateCeilingFinishColorMap(panels) {
    if (!panels || panels.length === 0) return new Map();

    const keys = [...new Set(panels.map(getCeilingPanelFinishKey))];

    if (keys.length === 1) {
        const colorMap = new Map();
        const onlyKey = keys[0];
        colorMap.set(onlyKey, {
            panelFillFull: 'rgba(148, 163, 184, 0.35)',
            panelFillCut: 'rgba(148, 163, 184, 0.7)',
            panelStrokeFull: '#9ca3af',
            panelStrokeCut: '#4b5563'
        });
        return colorMap;
    }

    const colorMap = new Map();
    keys.forEach((key, index) => {
        const panel = panels.find((p) => getCeilingPanelFinishKey(p) === key);
        const hasDiffFaces =
            panel &&
            (panel.inner_face_material || panel.innerFaceMaterial || 'PPGI') !==
                (panel.outer_face_material || panel.outerFaceMaterial || 'PPGI');

        const baseHue = (index * 360) / keys.length;
        const outerHue = baseHue;
        const innerHue = (baseHue + 180) % 360;

        if (hasDiffFaces) {
            colorMap.set(key, {
                panelFillFull: `hsla(${outerHue}, 70%, 65%, 0.45)`,
                panelFillCut: `hsla(${outerHue}, 70%, 40%, 0.8)`,
                panelStrokeFull: `hsl(${outerHue}, 70%, 35%)`,
                panelStrokeCut: `hsl(${outerHue}, 80%, 20%)`,
                innerPanelFillFull: `hsla(${innerHue}, 70%, 65%, 0.45)`,
                innerPanelFillCut: `hsla(${innerHue}, 70%, 40%, 0.8)`,
                innerPanelStrokeFull: `hsl(${innerHue}, 70%, 35%)`,
                innerPanelStrokeCut: `hsl(${innerHue}, 80%, 20%)`
            });
        } else {
            colorMap.set(key, {
                panelFillFull: `hsla(${outerHue}, 70%, 65%, 0.45)`,
                panelFillCut: `hsla(${outerHue}, 70%, 40%, 0.8)`,
                panelStrokeFull: `hsl(${outerHue}, 70%, 35%)`,
                panelStrokeCut: `hsl(${outerHue}, 80%, 20%)`
            });
        }
    });

    return colorMap;
}

function drawZoneOutlines(doc, storeyZones, transformX, transformY) {
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.35);
    const dash = [2, 2];
    storeyZones.forEach((zone) => {
        const outline = zone.outline_points;
        if (!Array.isArray(outline) || outline.length < 3) return;
        if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern(dash, 0);
        for (let i = 0; i < outline.length; i++) {
            const p = outline[i];
            const q = outline[(i + 1) % outline.length];
            const x1 = transformX(num(p.x ?? p[0]));
            const y1 = transformY(num(p.y ?? p[1]));
            const x2 = transformX(num(q.x ?? q[0]));
            const y2 = transformY(num(q.y ?? q[1]));
            doc.line(x1, y1, x2, y2);
        }
        if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
    });
}

function drawPanelsOnPdf(doc, panels, transformX, transformY, kind) {
    const isCeiling = kind === 'ceiling';

    const finishColorMap = isCeiling ? generateCeilingFinishColorMap(panels) : null;

    // Fallback colors for non-ceiling (keep existing behavior)
    const fillCut = !isCeiling ? [240, 210, 160] : null;
    const fillFull = !isCeiling ? [245, 215, 165] : null;
    const strokeCut = !isCeiling ? [180, 80, 8] : null;

    panels.forEach((panel) => {
        const isCut = !!(panel.is_cut_panel || panel.is_cut);
        let fill;
        let stroke;

        if (isCeiling) {
            const finishKey = getCeilingPanelFinishKey(panel);
            const finishColors = finishColorMap?.get(finishKey);
            const fillStr = isCut ? (finishColors?.panelFillCut ?? 'hsla(150, 70%, 40%, 0.8)') : (finishColors?.panelFillFull ?? 'hsla(150, 70%, 65%, 0.45)');
            const strokeStr = isCut ? (finishColors?.panelStrokeCut ?? 'hsl(150, 80%, 20%)') : (finishColors?.panelStrokeFull ?? 'hsl(150, 70%, 35%)');
            fill = cssColorToPdfRgb(fillStr);
            stroke = cssColorToPdfRgb(strokeStr);
        } else {
            fill = isCut ? fillCut : fillFull;
            stroke = isCut ? strokeCut : darkenRgb(fill, 0.3); // keep old behavior for floor
        }

        const shapePoints = panel.shape_points;

        if (isPanelPolygon(shapePoints)) {
            const pdfPath = shapePoints.map((pt) => [
                transformX(num(pt?.x ?? (Array.isArray(pt) ? pt[0] : null))),
                transformY(num(pt?.y ?? (Array.isArray(pt) ? pt[1] : null)))
            ]);
            // jsPDF's `doc.path()` expects a low-level {op, c} command array.
            // For our panels we have plain absolute points, so use `doc.lines(..., closed=true)`
            // to reliably render concave polygons (e.g., L-shaped panels).
            const startX = pdfPath[0][0];
            const startY = pdfPath[0][1];
            const relLines = [];
            for (let i = 1; i < pdfPath.length; i++) {
                relLines.push([pdfPath[i][0] - pdfPath[i - 1][0], pdfPath[i][1] - pdfPath[i - 1][1]]);
            }
            const drawClosedPolyFill = () => {
                doc.lines(relLines, startX, startY, [1, 1], 'F', true);
            };
            const drawClosedPolyStroke = () => {
                doc.lines(relLines, startX, startY, [1, 1], 'S', true);
            };

            const bbox = bboxPdfPath(pdfPath);
            const thin = isThinPolygonPdfBBox(bbox);

            if (thin) {
                const fillLt = isCeiling ? fill : lightenRgb(fill, 0.28);
                doc.setFillColor(fillLt[0], fillLt[1], fillLt[2]);
                drawClosedPolyFill();
                if (isCut) {
                    doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
                    doc.setLineWidth(STROKE_CUT_PANEL_MM);
                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([1.2, 1], 0);
                    drawClosedPolyStroke();
                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
                } else {
                    const edge = isCeiling ? stroke : darkenRgb(fillLt, 0.32);
                    doc.setDrawColor(edge[0], edge[1], edge[2]);
                    doc.setLineWidth(STROKE_FULL_PANEL_MM);
                    drawClosedPolyStroke();
                }
            } else {
                doc.setFillColor(fill[0], fill[1], fill[2]);
                drawClosedPolyFill();
                if (isCut) {
                    doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
                    doc.setLineWidth(STROKE_CUT_PANEL_MM);
                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([1.1, 0.9], 0);
                    drawClosedPolyStroke();
                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
                } else {
                    const edge = isCeiling ? stroke : darkenRgb(fill, 0.3);
                    doc.setDrawColor(edge[0], edge[1], edge[2]);
                    doc.setLineWidth(STROKE_FULL_PANEL_MM);
                    drawClosedPolyStroke();
                }
            }
            return;
        }

        const sx = num(panel.start_x ?? panel.x);
        const sy = num(panel.start_y ?? panel.y);
        const w = num(panel.width);
        const len = num(panel.length);
        const x0 = transformX(sx);
        const y0 = transformY(sy);
        const x1 = transformX(sx + w);
        const y1 = transformY(sy + len);
        let left = Math.min(x0, x1);
        let top = Math.min(y0, y1);
        let rw = Math.abs(x1 - x0);
        let rh = Math.abs(y1 - y0);

        const expanded = expandThinRectPdf(left, top, rw, rh);
        left = expanded.left;
        top = expanded.top;
        rw = expanded.rw;
        rh = expanded.rh;
        const isStrip = expanded.isStrip;

        const useFill = isStrip ? (isCeiling ? fill : lightenRgb(fill, isCut ? 0.18 : 0.22)) : fill;
        doc.setFillColor(useFill[0], useFill[1], useFill[2]);
        doc.rect(left, top, rw, rh, 'F');

        if (!isCut) {
            const edge = darkenRgb(useFill, 0.3);
            const edgeRgb = isCeiling ? stroke : edge;
            doc.setDrawColor(edgeRgb[0], edgeRgb[1], edgeRgb[2]);
            doc.setLineWidth(STROKE_FULL_PANEL_MM);
            doc.rect(left, top, rw, rh, 'S');
        }

        if (isCut && (!shapePoints || shapePoints.length === 0)) {
            const minSide = Math.min(rw, rh);
            doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
            doc.setLineWidth(STROKE_CUT_PANEL_MM);
            if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([1.2, 1], 0);
            if (minSide < 1.0 || isStrip) {
                doc.rect(left, top, rw, rh, 'S');
            } else {
                const inset = Math.min(0.5, rw * 0.035, rh * 0.035);
                doc.rect(
                    left + inset,
                    top + inset,
                    Math.max(0.12, rw - 2 * inset),
                    Math.max(0.12, rh - 2 * inset),
                    'S'
                );
            }
            if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
        }
    });
}

function drawPlanPage(doc, {
    kind,
    storeyLabel,
    storeyRooms,
    panels,
    storeyZones,
    planPageOrientation,
    fitToPage,
    storeyWalls = [],
    wallIntersections = [],
    ceilingPlans = [],
    floorPlans = []
}) {
    let roomBounds = initialBounds();
    roomBounds = expandBoundsRooms(storeyRooms, roomBounds);
    roomBounds = expandBoundsWalls(storeyWalls, roomBounds);

    let b = { ...roomBounds };
    (storeyZones || []).forEach((z) => {
        b = expandBoundsOutline(z.outline_points, b);
    });
    b = expandBoundsPanels(panels, b);

    if (!boundsValid(b)) {
        console.warn(`[pdfVectorCeilingFloor] Skipping ${kind} page — no bounds`);
        return false;
    }

    // Unpadded union of everything drawn (rooms, walls, zones, panels). Used to clip dimension
    // extension dashes — must match visible geometry, not projectBounds (room+wall only).
    const geometryBoundsUnpadded = { ...b };

    const padX = (b.maxX - b.minX) * 0.05;
    const padY = (b.maxY - b.minY) * 0.05;
    b = {
        minX: b.minX - padX,
        minY: b.minY - padY,
        maxX: b.maxX + padX,
        maxY: b.maxY + padY
    };

    const modelW = b.maxX - b.minX;
    const modelH = b.maxY - b.minY;

    doc.addPage('a4', planPageOrientation);
    const planPageWidth = doc.internal.pageSize.width;
    const planPageHeight = doc.internal.pageSize.height;
    const planMargin = fitToPage ? 5 : 20;
    const titleHeight = 14;
    const scaleNoteHeight = 8;
    const planContentWidth = planPageWidth - 2 * planMargin;
    const planContentHeight = planPageHeight - 2 * planMargin - titleHeight - scaleNoteHeight;

    const scaleX = (planContentWidth * 0.82) / modelW;
    const scaleY = (planContentHeight * 0.82) / modelH;
    const scale = Math.min(scaleX, scaleY);
    if (scale <= 0 || !Number.isFinite(scale)) return false;

    const scaledW = modelW * scale;
    const scaledH = modelH * scale;
    const offsetX = planMargin + (planContentWidth - scaledW) / 2;
    const offsetY = planMargin + titleHeight + (planContentHeight - scaledH) / 2;

    const transformX = (x) => offsetX + (x - b.minX) * scale;
    const transformY = (y) => offsetY + (y - b.minY) * scale;

    const title = storeyLabel
        ? `${kind === 'ceiling' ? 'Ceiling' : 'Floor'} Plan - ${storeyLabel}`
        : `${kind === 'ceiling' ? 'Ceiling' : 'Floor'} Plan`;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(title, planPageWidth / 2, planMargin + 6, { align: 'center' });

    drawStoreyWallsOnPdf(doc, transformX, transformY, scale, kind, storeyWalls, storeyRooms, wallIntersections);
    drawPanelsOnPdf(doc, panels, transformX, transformY, kind);
    if (kind === 'ceiling') {
        drawNylonHangersOnCeilingPdf(
            doc,
            panels,
            storeyRooms,
            storeyZones,
            ceilingPlans,
            transformX,
            transformY,
            scale
        );
    }
    if (kind === 'ceiling' && storeyZones && storeyZones.length > 0) {
        drawZoneOutlines(doc, storeyZones, transformX, transformY);
    }
    drawRoomOutlines(doc, storeyRooms, transformX, transformY);
    const pdfMinYForDims = planMargin + titleHeight + 10;
    drawPlanDimensions(doc, storeyRooms, panels, transformX, transformY, scale, {
        pdfMinY: pdfMinYForDims,
        offsetY,
        pageMinModelY: b.minY,
        scale,
        pageBounds: b,
        projectBounds: boundsValid(roomBounds) ? roomBounds : b,
        geometryBounds: geometryBoundsUnpadded,
        kind,
        ceilingPlans,
        floorPlans
    });

    drawRoomNameLabelsOnPdf(doc, storeyRooms, transformX, transformY, scale);

    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(90, 90, 90);
    const scaleRatio = Math.round(1 / scale);
    const scaleText = scaleRatio > 0 && Number.isFinite(scaleRatio) ? `Scale ~ 1:${scaleRatio} (PDF mm)` : '';
    doc.text(scaleText, planPageWidth - planMargin, planPageHeight - planMargin - 2, { align: 'right' });
    doc.setTextColor(0, 0, 0);

    return true;
}

/**
 * Fetch full panel geometry + ceiling zones for vector PDF pages.
 */
export async function fetchProjectPanelLayoutForPdf(api, projectId) {
    if (!api || !projectId) {
        return { ceilingPanels: [], floorPanels: [], zones: [], ceilingPlans: [], floorPlans: [] };
    }
    const pid = parseInt(projectId, 10);
    try {
        const [cp, fp, zr, cpPlans, fpPlans] = await Promise.all([
            api.get(`/ceiling-panels/?project=${pid}`),
            api.get(`/floor-panels/?project=${pid}`),
            api.get(`/ceiling-zones/?project=${pid}`),
            api.get(`/ceiling-plans/?project=${pid}`).catch(() => ({ data: [] })),
            api.get(`/floor-plans/?project=${pid}`).catch(() => ({ data: [] }))
        ]);
        return {
            ceilingPanels: normalizeApiArray(cp.data),
            floorPanels: normalizeApiArray(fp.data),
            zones: normalizeApiArray(zr.data),
            ceilingPlans: normalizeApiArray(cpPlans.data),
            floorPlans: normalizeApiArray(fpPlans.data)
        };
    } catch (e) {
        console.warn('[pdfVectorCeilingFloor] Failed to fetch layout:', e);
        return { ceilingPanels: [], floorPanels: [], zones: [], ceilingPlans: [], floorPlans: [] };
    }
}

/**
 * Mini PDFs using the same vector pipeline as the export, for iframe preview in the UI.
 * jsPDF creates an initial blank page; `drawPlanPage` always `addPage`s, so we drop page 1 after drawing.
 *
 * @returns {{ ceilingBlob: Blob|null, floorBlob: Blob|null }}
 */
export function buildVectorCeilingFloorPreviewBlobs({
    storeys,
    rooms,
    defaultStoreyId,
    ceilingPanels,
    floorPanels,
    zones,
    ceilingPlans = [],
    floorPlans = [],
    planPageOrientation,
    fitToPage,
    walls = [],
    wallIntersections = []
}) {
    const orient = planPageOrientation === 'landscape' ? 'landscape' : 'portrait';
    const ceilingDoc = new jsPDF({ unit: 'mm', format: 'a4', orientation: orient });
    const floorDoc = new jsPDF({ unit: 'mm', format: 'a4', orientation: orient });

    let usedCeiling = false;
    let usedFloor = false;

    const allRooms = rooms || [];
    const allCeiling = ceilingPanels || [];
    const allFloor = floorPanels || [];
    const allZones = zones || [];
    const allWalls = walls || [];
    const allCeilingPlans = ceilingPlans || [];
    const allFloorPlans = floorPlans || [];

    const drawPairForStorey = (activeStoreyId, storeyLabel) => {
        const storeyRooms = activeStoreyId == null
            ? allRooms
            : allRooms.filter((r) => matchesActiveStorey(r.storey, activeStoreyId, defaultStoreyId));
        const storeyWalls =
            activeStoreyId == null
                ? allWalls
                : allWalls.filter((w) => matchesActiveStorey(w.storey, activeStoreyId, defaultStoreyId));

        const roomIdSet = new Set(storeyRooms.map((r) => Number(r.id)));
        const storeyZones = allZones.filter((z) => {
            const ids = roomIdsFromZone(z).map((rid) => Number(rid));
            return ids.some((rid) => Number.isFinite(rid) && roomIdSet.has(rid));
        });
        const zoneIdSet = new Set(storeyZones.map((z) => z.id));

        const cPanels = allCeiling.filter((p) => {
            let rid = p.room_id ?? p.room ?? p.roomId;
            if (rid != null && typeof rid === 'object') {
                rid = rid.id ?? rid.room_id ?? rid;
            }
            const pr = Number(rid);
            if (Number.isFinite(pr) && roomIdSet.has(pr)) return true;

            let zid = p.zone_id ?? p.zone ?? p.zoneId;
            if (zid != null && typeof zid === 'object') {
                zid = zid.id ?? zid.zone_id ?? zid;
            }
            const pz = Number(zid);
            if (Number.isFinite(pz) && zoneIdSet.has(pz)) return true;
            return false;
        });

        const fPanels = allFloor.filter((p) => {
            let rid = p.room_id ?? p.room;
            if (rid != null && typeof rid === 'object') rid = rid.id;
            const rnum = Number(rid);
            return Number.isFinite(rnum) && roomIdSet.has(rnum);
        });

        const hasCeilingOutline = storeyZones.some(
            (z) => Array.isArray(z.outline_points) && z.outline_points.length >= 3
        );
        const shouldCeiling = cPanels.length > 0 || hasCeilingOutline;
        const shouldFloor = fPanels.length > 0;

        if (shouldCeiling) {
            const ok = drawPlanPage(ceilingDoc, {
                kind: 'ceiling',
                storeyLabel,
                storeyRooms,
                panels: cPanels,
                storeyZones,
                planPageOrientation,
                fitToPage,
                storeyWalls,
                wallIntersections,
                ceilingPlans: allCeilingPlans,
                floorPlans: allFloorPlans
            });
            if (ok) usedCeiling = true;
        }

        if (shouldFloor) {
            const ok = drawPlanPage(floorDoc, {
                kind: 'floor',
                storeyLabel,
                storeyRooms,
                panels: fPanels,
                storeyZones: [],
                planPageOrientation,
                fitToPage,
                storeyWalls,
                wallIntersections,
                ceilingPlans: allCeilingPlans,
                floorPlans: allFloorPlans
            });
            if (ok) usedFloor = true;
        }
    };

    if (storeys && storeys.length > 0) {
        const sorted = [...storeys].sort((a, b) => {
            const od = (a.order ?? 0) - (b.order ?? 0);
            if (od !== 0) return od;
            const ed = num(a.elevation_mm) - num(b.elevation_mm);
            if (Math.abs(ed) > 1e-6) return ed;
            return (a.id ?? 0) - (b.id ?? 0);
        });
        sorted.forEach((st) => drawPairForStorey(st.id, st.name || `Storey ${st.id}`));
    } else {
        drawPairForStorey(null, null);
    }

    const stripLeadingBlank = (doc) => {
        if (typeof doc.getNumberOfPages === 'function' && doc.getNumberOfPages() >= 2) {
            doc.deletePage(1);
        }
    };
    stripLeadingBlank(ceilingDoc);
    stripLeadingBlank(floorDoc);

    return {
        ceilingBlob: usedCeiling ? ceilingDoc.output('blob') : null,
        floorBlob: usedFloor ? floorDoc.output('blob') : null
    };
}

/**
 * @returns {{ usedVectorCeiling: boolean, usedVectorFloor: boolean }}
 */
export function appendVectorCeilingAndFloorPlans(doc, {
    storeys,
    rooms,
    defaultStoreyId,
    ceilingPanels,
    floorPanels,
    zones,
    ceilingPlans = [],
    floorPlans = [],
    planPageOrientation,
    fitToPage,
    walls = [],
    wallIntersections = []
}) {
    let usedVectorCeiling = false;
    let usedVectorFloor = false;

    const allRooms = rooms || [];
    const allCeiling = ceilingPanels || [];
    const allFloor = floorPanels || [];
    const allZones = zones || [];
    const allWalls = walls || [];
    const allCeilingPlans = ceilingPlans || [];
    const allFloorPlans = floorPlans || [];

    const drawPairForStorey = (activeStoreyId, storeyLabel) => {
        const storeyRooms = activeStoreyId == null
            ? allRooms
            : allRooms.filter((r) => matchesActiveStorey(r.storey, activeStoreyId, defaultStoreyId));
        const storeyWalls =
            activeStoreyId == null
                ? allWalls
                : allWalls.filter((w) => matchesActiveStorey(w.storey, activeStoreyId, defaultStoreyId));

        const roomIdSet = new Set(storeyRooms.map((r) => Number(r.id)));
        const storeyZones = allZones.filter((z) => {
            const ids = roomIdsFromZone(z).map((rid) => Number(rid));
            return ids.some((rid) => Number.isFinite(rid) && roomIdSet.has(rid));
        });
        const zoneIdSet = new Set(storeyZones.map((z) => z.id));

        const cPanels = allCeiling.filter((p) => {
            let rid = p.room_id ?? p.room ?? p.roomId;
            if (rid != null && typeof rid === 'object') {
                rid = rid.id ?? rid.room_id ?? rid;
            }
            const pr = Number(rid);
            if (Number.isFinite(pr) && roomIdSet.has(pr)) return true;

            let zid = p.zone_id ?? p.zone ?? p.zoneId;
            if (zid != null && typeof zid === 'object') {
                zid = zid.id ?? zid.zone_id ?? zid;
            }
            const pz = Number(zid);
            if (Number.isFinite(pz) && zoneIdSet.has(pz)) return true;
            return false;
        });

        const fPanels = allFloor.filter((p) => {
            let rid = p.room_id ?? p.room;
            if (rid != null && typeof rid === 'object') rid = rid.id;
            const rnum = Number(rid);
            return Number.isFinite(rnum) && roomIdSet.has(rnum);
        });

        const hasCeilingOutline = storeyZones.some(
            (z) => Array.isArray(z.outline_points) && z.outline_points.length >= 3
        );
        const shouldCeiling = cPanels.length > 0 || hasCeilingOutline;
        const shouldFloor = fPanels.length > 0;

        if (shouldCeiling) {
            const ok = drawPlanPage(doc, {
                kind: 'ceiling',
                storeyLabel,
                storeyRooms,
                panels: cPanels,
                storeyZones,
                planPageOrientation,
                fitToPage,
                storeyWalls,
                wallIntersections,
                ceilingPlans: allCeilingPlans,
                floorPlans: allFloorPlans
            });
            if (ok) usedVectorCeiling = true;
        }

        if (shouldFloor) {
            const ok = drawPlanPage(doc, {
                kind: 'floor',
                storeyLabel,
                storeyRooms,
                panels: fPanels,
                storeyZones: [],
                planPageOrientation,
                fitToPage,
                storeyWalls,
                wallIntersections,
                ceilingPlans: allCeilingPlans,
                floorPlans: allFloorPlans
            });
            if (ok) usedVectorFloor = true;
        }
    };

    if (storeys && storeys.length > 0) {
        const sorted = [...storeys].sort((a, b) => {
            const od = (a.order ?? 0) - (b.order ?? 0);
            if (od !== 0) return od;
            const ed = num(a.elevation_mm) - num(b.elevation_mm);
            if (Math.abs(ed) > 1e-6) return ed;
            return (a.id ?? 0) - (b.id ?? 0);
        });
        sorted.forEach((st) => drawPairForStorey(st.id, st.name || `Storey ${st.id}`));
    } else {
        drawPairForStorey(null, null);
    }

    return { usedVectorCeiling, usedVectorFloor };
}
