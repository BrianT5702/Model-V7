    // Drawing functions extracted from Canvas2D.js

// Import dimension filtering helper
import { shouldShowWallDimension, shouldShowPanelDimension, filterDimensions } from './dimensionFilter.js';
// Import dimension configuration
import {
    DIMENSION_CONFIG,
    createDimensionLaneCounters,
    createDimensionEdgeExtents,
    consumeDimensionLane,
    recordDimensionEdgeExtent,
    getProjectDimensionOffsetForEdge,
    syncEdgeExtentsFromPlacedLabels,
    formatDimensionValue,
    planCeilingValueDedupKey,
    applyNearWallFontSize,
    nearWallLabelSeparationPx,
    getPlanExteriorSide,
    getDimensionEdge
} from './DimensionConfig.js';
import {
    adjustPlanStrokeColor,
    getPlanCanvasGridColor,
    getPlanDefaultWallColors,
    getPlanLabelBackground,
    getPlanWallHslLightness,
    getPlanWallHslSaturation,
    isPlanCanvasDark,
} from './planCanvasTheme';
// Import collision detection utilities
import {
    hasLabelOverlap,
    calculateHorizontalLabelBounds,
    calculateVerticalLabelBounds,
    calculateRotatedVerticalDimBounds,
    calculateNearWallHorizontalDimBounds,
    smartPlacement,
    isLabelPlacementClean,
    overlapsDimensionText,
    checkBoxOverlap,
    tryPlaceExteriorDimensionLabel,
    exteriorVerticalLabelBounds
} from './collisionDetection.js';
import { isPointInPolygon, isPartitionWall, calculateLineIntersection } from './utils.js';
import { buildDoorLabelObstacles } from './doorPlacement.js';

/** Axis-aligned if nearly horizontal or vertical (model mm). */
const WALL_AXIS_ALIGN_TOL_MM = 1;

export function isAxisAlignedWall(wall, tolMm = WALL_AXIS_ALIGN_TOL_MM) {
    if (!wall) return true;
    const dx = Math.abs(Number(wall.end_x) - Number(wall.start_x));
    const dy = Math.abs(Number(wall.end_y) - Number(wall.start_y));
    return dx <= tolMm || dy <= tolMm;
}

/** Dynamic angle threshold (degrees) used while drawing walls. */
export function getWallAngleSnapThresholdDeg(wallLengthMm) {
    if (wallLengthMm < 500) return 10;
    if (wallLengthMm < 2000) return 5;
    return 2;
}

function _projectPointToWallSegment(x, y, wall) {
    const wx = wall.end_x - wall.start_x;
    const wy = wall.end_y - wall.start_y;
    const lenSq = wx * wx + wy * wy;
    if (lenSq < 1e-9) return { x: wall.start_x, y: wall.start_y, dist: Math.hypot(x - wall.start_x, y - wall.start_y) };
    const t = Math.max(0, Math.min(1, ((x - wall.start_x) * wx + (y - wall.start_y) * wy) / lenSq));
    const px = wall.start_x + t * wx;
    const py = wall.start_y + t * wy;
    return { x: px, y: py, dist: Math.hypot(x - px, y - py) };
}

/**
 * Closest existing wall to a point (endpoint or body). When tied, prefer a slanted wall.
 */
export function findHostWallNearPoint(point, walls, maxDistMm = 25) {
    if (!point || !walls?.length) return null;
    let best = null;
    let bestDist = maxDistMm;
    for (const wall of walls) {
        const proj = _projectPointToWallSegment(point.x, point.y, wall);
        if (proj.dist < bestDist - 0.5) {
            best = wall;
            bestDist = proj.dist;
        } else if (Math.abs(proj.dist - bestDist) <= 0.5 && best) {
            if (isAxisAlignedWall(best) && !isAxisAlignedWall(wall)) {
                best = wall;
                bestDist = proj.dist;
            }
        }
    }
    return best;
}

function _normalizeAngleDiffRad(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
}

/**
 * Snap a drawn wall end to world H/V, and (when starting from a real slant host) also to
 * directions parallel or perpendicular to that host. Keeps length; picks nearest candidate.
 *
 * World H/V uses a tight ~2° threshold so intentional shallow "horizontal slants"
 * (e.g. niche back ~3°) are not flattened to true horizontal. ∥ / ⊥ to a slant host
 * keep the wider dynamic threshold.
 *
 * @returns {{ end: {x,y}, snapType: 'vertical'|'horizontal'|'perpendicular'|'parallel'|null, direction: {x,y} }}
 */
export function snapWallEndToPreferredAngles(start, end, hostWall = null, angleThresholdDeg = null) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
        return { end: { ...end }, snapType: null, direction: { x: 1, y: 0 } };
    }

    const slantThreshDeg = angleThresholdDeg ?? getWallAngleSnapThresholdDeg(len);
    const axisThreshDeg = Math.min(2, slantThreshDeg);
    const slantThreshRad = (slantThreshDeg * Math.PI) / 180;
    const axisThreshRad = (axisThreshDeg * Math.PI) / 180;
    const currentAngle = Math.atan2(dy, dx);

    const candidates = [
        { type: 'horizontal', angle: 0, maxErr: axisThreshRad },
        { type: 'horizontal', angle: Math.PI, maxErr: axisThreshRad },
        { type: 'vertical', angle: Math.PI / 2, maxErr: axisThreshRad },
        { type: 'vertical', angle: -Math.PI / 2, maxErr: axisThreshRad },
    ];

    // Only treat as a slant host when it is clearly off-axis (not a 1° wobble).
    const SLANT_HOST_MIN_DEG = 2.5;
    if (hostWall) {
        const hx = Number(hostWall.end_x) - Number(hostWall.start_x);
        const hy = Number(hostWall.end_y) - Number(hostWall.start_y);
        const hLen = Math.hypot(hx, hy);
        if (hLen > 1e-6) {
            const hostAngle = Math.atan2(hy, hx);
            const hostOffAxis = Math.min(
                _normalizeAngleDiffRad(hostAngle, 0),
                _normalizeAngleDiffRad(hostAngle, Math.PI),
                _normalizeAngleDiffRad(hostAngle, Math.PI / 2),
                _normalizeAngleDiffRad(hostAngle, -Math.PI / 2)
            );
            if (hostOffAxis >= (SLANT_HOST_MIN_DEG * Math.PI) / 180) {
                candidates.push({ type: 'parallel', angle: hostAngle, maxErr: slantThreshRad });
                candidates.push({ type: 'parallel', angle: hostAngle + Math.PI, maxErr: slantThreshRad });
                candidates.push({ type: 'perpendicular', angle: hostAngle + Math.PI / 2, maxErr: slantThreshRad });
                candidates.push({ type: 'perpendicular', angle: hostAngle - Math.PI / 2, maxErr: slantThreshRad });
            }
        }
    }

    let best = null;
    for (const c of candidates) {
        const err = _normalizeAngleDiffRad(currentAngle, c.angle);
        if (err <= c.maxErr && (!best || err < best.err)) {
            best = { ...c, err };
        }
    }

    if (!best) {
        // Free angle — keep the drawn slant (including shallow "horizontal slants")
        return {
            end: { x: end.x, y: end.y },
            snapType: null,
            direction: { x: dx / len, y: dy / len },
        };
    }

    let ux = Math.cos(best.angle);
    let uy = Math.sin(best.angle);
    if (ux * dx + uy * dy < 0) {
        ux = -ux;
        uy = -uy;
    }

    // World H/V: lock the free axis to the drag/snap coordinate (CAD ortho),
    // do NOT preserve hypotenuse length. Length-preserve turns a tiny Y (or X)
    // error at zoomed-out scale into a few-mm overshoot past the target wall,
    // which then splits off a 1–2mm stub.
    if (best.type === 'horizontal') {
        const signedDx = end.x - start.x;
        ux = Math.abs(signedDx) > 1e-6 ? (signedDx >= 0 ? 1 : -1) : (ux >= 0 ? 1 : -1);
        uy = 0;
        return {
            end: { x: end.x, y: start.y },
            snapType: 'horizontal',
            direction: { x: ux, y: 0 },
        };
    }
    if (best.type === 'vertical') {
        const signedDy = end.y - start.y;
        uy = Math.abs(signedDy) > 1e-6 ? (signedDy >= 0 ? 1 : -1) : (uy >= 0 ? 1 : -1);
        ux = 0;
        return {
            end: { x: start.x, y: end.y },
            snapType: 'vertical',
            direction: { x: 0, y: uy },
        };
    }

    // ∥ / ⊥ to slant: keep drawn length along the snapped direction
    return {
        end: { x: start.x + ux * len, y: start.y + uy * len },
        snapType: best.type,
        direction: { x: ux, y: uy },
    };
}

function setWallFaceEndpoint(line, atStart, point) {
    if (!line || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const idx = atStart ? 0 : 1;
    line[idx].x = point.x;
    line[idx].y = point.y;
}

function markWallMiteredEnd(wall, atStart) {
    if (!wall) return;
    if (atStart) wall._miteredStart = true;
    else wall._miteredEnd = true;
}

/**
 * Butt-in on slant / non-ortho hosts: trim the stem (wall_1) face ends to the
 * near face of the host so a 90° V into a slant does not draw through the host.
 * Ortho V–H butt-in stays on the specialized path.
 *
 * Uses fresh ±half-thickness faces from the stem centerline (not the possibly
 * already-edited drawn faces) so left/right identity cannot flip into an hourglass X.
 */
export function applyAngledButtInAtIntersection(wallsAtIntersection, inter) {
    if (!inter || !Array.isArray(wallsAtIntersection) || wallsAtIntersection.length < 2) return;

    const resolvePair = (wallA, wallB) => {
        let joiningMethod = 'none';
        let wall1Id = null;
        let wall2Id = null;
        if (inter.pairs && Array.isArray(inter.pairs)) {
            inter.pairs.forEach((pair) => {
                const pairWall1Id = typeof pair.wall1 === 'object' ? (pair.wall1?.id ?? pair.wall1) : pair.wall1;
                const pairWall2Id = typeof pair.wall2 === 'object' ? (pair.wall2?.id ?? pair.wall2) : pair.wall2;
                const aStr = String(wallA.id);
                const bStr = String(wallB.id);
                const p1 = String(pairWall1Id);
                const p2 = String(pairWall2Id);
                if ((p1 === aStr && p2 === bStr) || (p1 === bStr && p2 === aStr)) {
                    joiningMethod = pair.joining_method || 'none';
                    wall1Id = pairWall1Id;
                    wall2Id = pairWall2Id;
                }
            });
        }
        return { joiningMethod, wall1Id, wall2Id };
    };

    const endAtJoint = (entry) => {
        if (entry.isOnBody) {
            const w = entry.wall;
            const dStart = Math.hypot(inter.x - w.start_x, inter.y - w.start_y);
            const dEnd = Math.hypot(inter.x - w.end_x, inter.y - w.end_y);
            return dStart <= dEnd;
        }
        return !!entry.isAtStart;
    };

    const cleanStemFaces = (stem) => {
        const dx = stem.end_x - stem.start_x;
        const dy = stem.end_y - stem.start_y;
        const len = Math.hypot(dx, dy);
        if (len < 0.001) return null;
        const half = (Number(stem.thickness) || 0) / 2;
        if (half <= 0) return null;
        const nx = -dy / len;
        const ny = dx / len;
        return {
            faceA: [
                { x: stem.start_x + nx * half, y: stem.start_y + ny * half },
                { x: stem.end_x + nx * half, y: stem.end_y + ny * half },
            ],
            faceB: [
                { x: stem.start_x - nx * half, y: stem.start_y - ny * half },
                { x: stem.end_x - nx * half, y: stem.end_y - ny * half },
            ],
        };
    };

    for (let i = 0; i < wallsAtIntersection.length; i++) {
        for (let j = i + 1; j < wallsAtIntersection.length; j++) {
            const aEntry = wallsAtIntersection[i];
            const bEntry = wallsAtIntersection[j];
            const wallA = aEntry.wall;
            const wallB = bEntry.wall;
            const aAxis = isAxisAlignedWall(wallA);
            const bAxis = isAxisAlignedWall(wallB);
            const aDx = wallA.end_x - wallA.start_x;
            const aDy = wallA.end_y - wallA.start_y;
            const bDx = wallB.end_x - wallB.start_x;
            const bDy = wallB.end_y - wallB.start_y;
            const aIsVertical = Math.abs(aDx) < Math.abs(aDy);
            const bIsVertical = Math.abs(bDx) < Math.abs(bDy);

            // True ortho V–H is handled by the specialized butt-in path.
            if (aAxis && bAxis && aIsVertical !== bIsVertical) continue;

            const { joiningMethod, wall1Id } = resolvePair(wallA, wallB);
            if (joiningMethod !== 'butt_in') continue;

            const linesA = aEntry.wallData;
            const linesB = bEntry.wallData;
            if (!linesA?.line1 || !linesA?.line2 || !linesB?.line1 || !linesB?.line2) continue;

            // Stem = wall_1 (shortened). Host = wall_2.
            let stemEntry = null;
            let hostEntry = null;
            if (wall1Id != null && String(wall1Id) === String(wallA.id)) {
                stemEntry = aEntry;
                hostEntry = bEntry;
            } else if (wall1Id != null && String(wall1Id) === String(wallB.id)) {
                stemEntry = bEntry;
                hostEntry = aEntry;
            } else if (aEntry.isOnBody && !bEntry.isOnBody) {
                hostEntry = aEntry;
                stemEntry = bEntry;
            } else if (bEntry.isOnBody && !aEntry.isOnBody) {
                hostEntry = bEntry;
                stemEntry = aEntry;
            } else {
                continue;
            }

            if (stemEntry.isOnBody && !stemEntry.isAtStart && !stemEntry.isAtEnd) continue;

            const stem = stemEntry.wall;
            const stemLines = stemEntry.wallData;
            const hostLines = hostEntry.wallData;
            const atStart = endAtJoint(stemEntry);
            const jointIdx = atStart ? 0 : 1;
            const freeIdx = atStart ? 1 : 0;

            const freePt = atStart
                ? { x: stem.end_x, y: stem.end_y }
                : { x: stem.start_x, y: stem.start_y };
            const jointPt = { x: inter.x, y: inter.y };

            // Ray from free end through the joint (into / past the host)
            const stemRay = [
                freePt,
                {
                    x: jointPt.x + (jointPt.x - freePt.x),
                    y: jointPt.y + (jointPt.y - freePt.y),
                },
            ];

            const hitFace = (face) => calculateLineIntersection(
                stemRay[0], stemRay[1], face[0], face[1],
                { extendFirst: true, extendSecond: true }
            );

            const h1 = hitFace(hostLines.line1);
            const h2 = hitFace(hostLines.line2);
            const distFromFree = (p) => (p ? Math.hypot(p.x - freePt.x, p.y - freePt.y) : Infinity);

            let nearFace = null;
            let nearHit = null;
            if (h1 && h2) {
                if (distFromFree(h1) <= distFromFree(h2)) {
                    nearFace = hostLines.line1;
                    nearHit = h1;
                } else {
                    nearFace = hostLines.line2;
                    nearHit = h2;
                }
            } else if (h1) {
                nearFace = hostLines.line1;
                nearHit = h1;
            } else if (h2) {
                nearFace = hostLines.line2;
                nearHit = h2;
            }
            if (!nearFace || !nearHit) continue;

            const maxReach = Math.hypot(stem.end_x - stem.start_x, stem.end_y - stem.start_y)
                + (Number(hostEntry.wall.thickness) || 100) * 2
                + 50;
            if (distFromFree(nearHit) > maxReach) continue;

            const clean = cleanStemFaces(stem);
            if (!clean) continue;

            const hitA = calculateLineIntersection(
                clean.faceA[0], clean.faceA[1], nearFace[0], nearFace[1],
                { extendFirst: true, extendSecond: true }
            );
            const hitB = calculateLineIntersection(
                clean.faceB[0], clean.faceB[1], nearFace[0], nearFace[1],
                { extendFirst: true, extendSecond: true }
            );
            if (!hitA || !hitB) continue;

            // Map clean hits onto drawn faces using the free end (stable left/right).
            const free1 = stemLines.line1[freeIdx];
            const free2 = stemLines.line2[freeIdx];
            const freeA = clean.faceA[freeIdx];
            const freeB = clean.faceB[freeIdx];
            const d1A = Math.hypot(free1.x - freeA.x, free1.y - freeA.y);
            const d1B = Math.hypot(free1.x - freeB.x, free1.y - freeB.y);
            const d2A = Math.hypot(free2.x - freeA.x, free2.y - freeA.y);
            const d2B = Math.hypot(free2.x - freeB.x, free2.y - freeB.y);

            let joint1;
            let joint2;
            if (d1A + d2B <= d1B + d2A) {
                joint1 = hitA;
                joint2 = hitB;
            } else {
                joint1 = hitB;
                joint2 = hitA;
            }

            setWallFaceEndpoint(stemLines.line1, atStart, joint1);
            setWallFaceEndpoint(stemLines.line2, atStart, joint2);

            // Guard: if joint ends flipped relative to free ends, swap to avoid hourglass X.
            const j1 = stemLines.line1[jointIdx];
            const j2 = stemLines.line2[jointIdx];
            const freeSepX = free1.x - free2.x;
            const freeSepY = free1.y - free2.y;
            const jointSepX = j1.x - j2.x;
            const jointSepY = j1.y - j2.y;
            if (freeSepX * jointSepX + freeSepY * jointSepY < 0) {
                setWallFaceEndpoint(stemLines.line1, atStart, joint2);
                setWallFaceEndpoint(stemLines.line2, atStart, joint1);
            }

            markWallMiteredEnd(stem, atStart);
        }
    }
}

/**
 * True miter for non-ortho / slanted wall pairs: intersect offset faces and
 * snap both walls' face endpoints (x and y) to those corners.
 * Ortho V–H pairs stay on the existing specialized path.
 *
 * Uses each wall's drawn faces (line1/line2) plus the reflection of line2 across
 * the centerline, then picks the face-intersection pair whose separation best
 * matches a true thickness miter — avoids crossed pink “X” corners on slants.
 */
export function applyAngledWallMitersAtIntersection(wallsAtIntersection, inter) {
    if (!inter || !Array.isArray(wallsAtIntersection) || wallsAtIntersection.length < 2) return;

    const resolveJoiningMethod = (wallA, wallB) => {
        let joiningMethod = 'none';
        if (inter.pairs && Array.isArray(inter.pairs)) {
            inter.pairs.forEach((pair) => {
                const pairWall1Id = typeof pair.wall1 === 'object' ? (pair.wall1?.id ?? pair.wall1) : pair.wall1;
                const pairWall2Id = typeof pair.wall2 === 'object' ? (pair.wall2?.id ?? pair.wall2) : pair.wall2;
                const aStr = String(wallA.id);
                const bStr = String(wallB.id);
                const p1 = String(pairWall1Id);
                const p2 = String(pairWall2Id);
                if ((p1 === aStr && p2 === bStr) || (p1 === bStr && p2 === aStr)) {
                    joiningMethod = pair.joining_method || 'none';
                }
            });
        }
        return joiningMethod;
    };

    const endAtJoint = (entry) => {
        if (entry.isOnBody) {
            const w = entry.wall;
            const dStart = Math.hypot(inter.x - w.start_x, inter.y - w.start_y);
            const dEnd = Math.hypot(inter.x - w.end_x, inter.y - w.end_y);
            return dStart <= dEnd;
        }
        return !!entry.isAtStart;
    };

    const reflectFaceAcrossCenterline = (wall, face) => {
        const dx = Number(wall.end_x) - Number(wall.start_x);
        const dy = Number(wall.end_y) - Number(wall.start_y);
        const len = Math.hypot(dx, dy);
        if (len < 1e-6 || !face?.[0] || !face?.[1]) return null;
        const ux = dx / len;
        const uy = dy / len;
        const reflectPoint = (p) => {
            const wx = p.x - Number(wall.start_x);
            const wy = p.y - Number(wall.start_y);
            const along = wx * ux + wy * uy;
            const cx = Number(wall.start_x) + ux * along;
            const cy = Number(wall.start_y) + uy * along;
            return { x: 2 * cx - p.x, y: 2 * cy - p.y };
        };
        return [reflectPoint(face[0]), reflectPoint(face[1])];
    };

    const facesForWall = (wall, lines) => {
        const faces = [];
        if (lines?.line1) faces.push({ line: lines.line1, kind: 'line1' });
        if (lines?.line2) faces.push({ line: lines.line2, kind: 'line2' });
        const reflected = reflectFaceAcrossCenterline(wall, lines?.line2);
        if (reflected) faces.push({ line: reflected, kind: 'reflect2' });
        return faces;
    };

    for (let i = 0; i < wallsAtIntersection.length; i++) {
        for (let j = i + 1; j < wallsAtIntersection.length; j++) {
            const aEntry = wallsAtIntersection[i];
            const bEntry = wallsAtIntersection[j];
            const wallA = aEntry.wall;
            const wallB = bEntry.wall;
            const aAxis = isAxisAlignedWall(wallA);
            const bAxis = isAxisAlignedWall(wallB);
            const aDx = wallA.end_x - wallA.start_x;
            const aDy = wallA.end_y - wallA.start_y;
            const bDx = wallB.end_x - wallB.start_x;
            const bDy = wallB.end_y - wallB.start_y;
            const aIsVertical = Math.abs(aDx) < Math.abs(aDy);
            const bIsVertical = Math.abs(bDx) < Math.abs(bDy);

            // Keep classic V–H path for true axis-aligned orthogonal corners.
            if (aAxis && bAxis && aIsVertical !== bIsVertical) continue;

            const joiningMethod = resolveJoiningMethod(wallA, wallB);
            // Only true 45° corners get face miters. butt_in uses applyAngledButtIn;
            // 'none' must keep square ends (do not miter).
            if (joiningMethod !== '45_cut') continue;

            const linesA = aEntry.wallData;
            const linesB = bEntry.wallData;
            if (!linesA?.line1 || !linesA?.line2 || !linesB?.line1 || !linesB?.line2) continue;

            // Don't reshape mid-body T hits — only endpoint miters.
            if (aEntry.isOnBody || bEntry.isOnBody) continue;

            const atStartA = endAtJoint(aEntry);
            const atStartB = endAtJoint(bEntry);

            const tA = Math.max(1, Number(wallA.thickness) || 100);
            const tB = Math.max(1, Number(wallB.thickness) || 100);
            const tAvg = (tA + tB) / 2;
            const maxDist = tAvg * 4 + 80;

            const aLen = Math.hypot(aDx, aDy) || 1;
            const bLen = Math.hypot(bDx, bDy) || 1;
            const aUx = aDx / aLen;
            const aUy = aDy / aLen;
            const bUx = bDx / bLen;
            const bUy = bDy / bLen;
            // Directions pointing away from the joint along each wall
            const aAway = atStartA ? { x: aUx, y: aUy } : { x: -aUx, y: -aUy };
            const bAway = atStartB ? { x: bUx, y: bUy } : { x: -bUx, y: -bUy };
            const cosAng = Math.max(-1, Math.min(1, aAway.x * bAway.x + aAway.y * bAway.y));
            const meetAng = Math.acos(cosAng); // 0 = continuation, π = fold back
            const half = meetAng / 2;
            const sinHalf = Math.sin(half);
            // Expected inner↔outer corner separation for equal-thickness miter
            const expectedSep = sinHalf > 0.08 ? tAvg / sinHalf : tAvg * Math.SQRT2;

            const nearJoint = (p) =>
                p
                && Number.isFinite(p.x)
                && Number.isFinite(p.y)
                && Math.hypot(p.x - inter.x, p.y - inter.y) <= maxDist;

            const facesA = facesForWall(wallA, linesA);
            const facesB = facesForWall(wallB, linesB);
            const hitPairs = [];
            for (const fa of facesA) {
                for (const fb of facesB) {
                    const hit = calculateLineIntersection(
                        fa.line[0], fa.line[1], fb.line[0], fb.line[1],
                        { extendFirst: true, extendSecond: true }
                    );
                    if (nearJoint(hit)) {
                        hitPairs.push({ hit, kindA: fa.kind, kindB: fb.kind });
                    }
                }
            }
            if (hitPairs.length < 2) continue;

            // Prefer two hits that look like the inner + outer miter corners.
            let best = null;
            for (let p = 0; p < hitPairs.length; p++) {
                for (let q = p + 1; q < hitPairs.length; q++) {
                    const h1 = hitPairs[p].hit;
                    const h2 = hitPairs[q].hit;
                    const sep = Math.hypot(h1.x - h2.x, h1.y - h2.y);
                    if (sep < tAvg * 0.25 || sep > tAvg * 4.5) continue;
                    const midDist = Math.hypot(
                        (h1.x + h2.x) / 2 - inter.x,
                        (h1.y + h2.y) / 2 - inter.y
                    );
                    const sepErr = Math.abs(sep - expectedSep);
                    const score = sepErr + midDist * 0.35;
                    if (!best || score < best.score) {
                        best = { h1, h2, score, sep };
                    }
                }
            }
            if (!best) {
                // Fallback: classic same-role pairing (line1↔line1, line2↔line2)
                const i11 = calculateLineIntersection(
                    linesA.line1[0], linesA.line1[1], linesB.line1[0], linesB.line1[1],
                    { extendFirst: true, extendSecond: true }
                );
                const i22 = calculateLineIntersection(
                    linesA.line2[0], linesA.line2[1], linesB.line2[0], linesB.line2[1],
                    { extendFirst: true, extendSecond: true }
                );
                const i12 = calculateLineIntersection(
                    linesA.line1[0], linesA.line1[1], linesB.line2[0], linesB.line2[1],
                    { extendFirst: true, extendSecond: true }
                );
                const i21 = calculateLineIntersection(
                    linesA.line2[0], linesA.line2[1], linesB.line1[0], linesB.line1[1],
                    { extendFirst: true, extendSecond: true }
                );
                if (nearJoint(i11) && nearJoint(i22)) {
                    best = { h1: i11, h2: i22, score: 0, sep: Math.hypot(i11.x - i22.x, i11.y - i22.y) };
                } else if (nearJoint(i12) && nearJoint(i21)) {
                    best = { h1: i12, h2: i21, score: 0, sep: Math.hypot(i12.x - i21.x, i12.y - i21.y) };
                } else {
                    continue;
                }
            }

            // Assign corners to each wall's drawn faces by proximity at that end
            const cornerPts = [best.h1, best.h2];
            const assignWallFaces = (lines, atStart) => {
                const idx = atStart ? 0 : 1;
                const p1 = lines.line1[idx];
                const p2 = lines.line2[idx];
                // Match current face ends to nearest corners (stable 1–1)
                const d00 = Math.hypot(p1.x - cornerPts[0].x, p1.y - cornerPts[0].y);
                const d01 = Math.hypot(p1.x - cornerPts[1].x, p1.y - cornerPts[1].y);
                const d10 = Math.hypot(p2.x - cornerPts[0].x, p2.y - cornerPts[0].y);
                const d11 = Math.hypot(p2.x - cornerPts[1].x, p2.y - cornerPts[1].y);
                if (d00 + d11 <= d01 + d10) {
                    setWallFaceEndpoint(lines.line1, atStart, cornerPts[0]);
                    setWallFaceEndpoint(lines.line2, atStart, cornerPts[1]);
                } else {
                    setWallFaceEndpoint(lines.line1, atStart, cornerPts[1]);
                    setWallFaceEndpoint(lines.line2, atStart, cornerPts[0]);
                }
            };

            assignWallFaces(linesA, atStartA);
            assignWallFaces(linesB, atStartB);

            markWallMiteredEnd(wallA, atStartA);
            markWallMiteredEnd(wallB, atStartB);
        }
    }
}

// Store placement decisions for dimensions to prevent position changes on zoom
// Module-level Map that persists across renders
const dimensionPlacementMemory = new Map();

export function clearDimensionPlacementMemory() {
    dimensionPlacementMemory.clear();
}

/** Same geometry as pdfVectorWallPlan: extension segments outside strict interior of model AABB (screen px) */
function extensionSegmentsOutsideModelRect(x1, y1, x2, y2, rect) {
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
            if (len > 1e-4) out.push({ x1: xa, y1: ya, x2: xb, y2: yb });
        }
    }
    return out.length > 0 ? out : [];
}

function modelBoundsToScreenRect(modelBounds, scaleFactor, offsetX, offsetY) {
    if (!modelBounds) return null;
    return {
        left: modelBounds.minX * scaleFactor + offsetX,
        right: modelBounds.maxX * scaleFactor + offsetX,
        top: modelBounds.minY * scaleFactor + offsetY,
        bottom: modelBounds.maxY * scaleFactor + offsetY
    };
}

/**
 * Dash pattern aligned with pdfVectorWallPlan: pdfExtDash = [1.2 * PX_TO_MM, 2 * PX_TO_MM] (jsPDF mm).
 * Canvas uses CSS px; scale lightly with zoom so dashes stay readable.
 */
function getCanvasExtensionDashPattern(scaleFactor) {
    const ref = Math.max(0.01, scaleFactor);
    const zoom = Math.max(0.5, Math.min(ref * 0.04, 4));
    return [Math.max(2, 1.2 * zoom), Math.max(2, 2 * zoom)];
}

/** Matches pdfVectorWallPlan: pdfExtLineW ≈ LINE_WIDTH * PX_TO_MM * 0.9 — lighter than solid dimension line */
function getCanvasExtensionLineWidth() {
    return Math.max(0.5, DIMENSION_CONFIG.LINE_WIDTH * 0.9);
}

function formatDimMmCanvas(lengthMm) {
    return formatDimensionValue(lengthMm);
}

/** Perpendicular tick marks at outer ends of dimension line (| style — match PDF) */
function canvasHorizontalDimArrows(context, x0, x1, y, color, tickPx) {
    context.save();
    context.setLineDash([]);
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    context.beginPath();
    context.moveTo(x0, y - tickPx);
    context.lineTo(x0, y + tickPx);
    context.moveTo(x1, y - tickPx);
    context.lineTo(x1, y + tickPx);
    context.stroke();
    context.restore();
}

function canvasVerticalDimArrows(context, x, y0, y1, color, tickPx) {
    context.save();
    context.setLineDash([]);
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    context.beginPath();
    context.moveTo(x - tickPx, y0);
    context.lineTo(x + tickPx, y0);
    context.moveTo(x - tickPx, y1);
    context.lineTo(x + tickPx, y1);
    context.stroke();
    context.restore();
}

function canvasObliqueDimArrows(context, x0, y0, x1, y1, ux, uy, color, tickPx) {
    canvasObliqueTicks(context, x0, y0, ux, uy, color, tickPx);
    canvasObliqueTicks(context, x1, y1, ux, uy, color, tickPx);
}

function canvasObliqueTicks(context, px, py, ux, uy, color, tickPx) {
    const vx = -uy;
    const vy = ux;
    context.save();
    context.setLineDash([]);
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    context.beginPath();
    context.moveTo(px - vx * tickPx, py - vy * tickPx);
    context.lineTo(px + vx * tickPx, py + vy * tickPx);
    context.stroke();
    context.restore();
}

function pointToSegmentDistanceMm(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq < 1e-12) return Math.hypot(apx, apy);
    let t = (apx * abx + apy * aby) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/** sin(5°) — a dimension's host wall must run within this of the segment's direction. */
const SEGMENT_HOST_PARALLEL_SIN_TOL = 0.0872;

function findWallDataForSegment(wallLinesMap, startX, startY, endX, endY, tolerance = 15) {
    if (!wallLinesMap) return null;
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const segLen = Math.hypot(endX - startX, endY - startY) || 1;
    const segUx = (endX - startX) / segLen;
    const segUy = (endY - startY) / segLen;
    for (const [, data] of wallLinesMap) {
        const w = data?.wall;
        if (!w) continue;
        // The host supplies the direction the label is offset in, so it has to run the same
        // way as the segment. A wall merely crossing the segment — a partition ending on its
        // midpoint, say — would otherwise offset the label along the dimension's own length
        // and push it past the wall it measures.
        const wLen = Math.hypot(w.end_x - w.start_x, w.end_y - w.start_y) || 1;
        const cross = Math.abs(
            segUx * ((w.end_y - w.start_y) / wLen) - segUy * ((w.end_x - w.start_x) / wLen)
        );
        if (cross > SEGMENT_HOST_PARALLEL_SIN_TOL) continue;
        const d0 = Math.hypot(w.start_x - startX, w.start_y - startY);
        const d1 = Math.hypot(w.end_x - endX, w.end_y - endY);
        if (d0 <= tolerance && d1 <= tolerance) return data;
        const d0r = Math.hypot(w.end_x - startX, w.end_y - startY);
        const d1r = Math.hypot(w.start_x - endX, w.start_y - endY);
        if (d0r <= tolerance && d1r <= tolerance) return data;
        const onWall =
            pointToSegmentDistanceMm(startX, startY, w.start_x, w.start_y, w.end_x, w.end_y) <= tolerance &&
            pointToSegmentDistanceMm(endX, endY, w.start_x, w.start_y, w.end_x, w.end_y) <= tolerance;
        const onSeg =
            pointToSegmentDistanceMm(w.start_x, w.start_y, startX, startY, endX, endY) <= tolerance &&
            pointToSegmentDistanceMm(w.end_x, w.end_y, startX, startY, endX, endY) <= tolerance;
        if (onWall || onSeg) return data;
        if (pointToSegmentDistanceMm(midX, midY, w.start_x, w.start_y, w.end_x, w.end_y) <= tolerance * 2) {
            return data;
        }
    }
    return null;
}

/** Unit normal pointing away from room interior (model space). */
function getExteriorNormalUnit(wall, rooms, modelBounds) {
    const dx = wall.end_x - wall.start_x;
    const dy = wall.end_y - wall.start_y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const midX = (wall.start_x + wall.end_x) / 2;
    const midY = (wall.start_y + wall.end_y) / 2;

    let interiorPositive = null;
    if (rooms && rooms.length > 0) {
        const flip = resolveInteriorShouldFlipFromPolygonProbes(wall, rooms, midX, midY, nx, ny);
        if (flip === true) interiorPositive = true;
        else if (flip === false) interiorPositive = false;
        else {
            const samples = getWallOffsetScoringSamples(wall, rooms);
            let wPlus = 0;
            let wMinus = 0;
            for (const s of samples) {
                const dot = nx * (s.x - midX) + ny * (s.y - midY);
                if (dot > 0) wPlus += s.w;
                else wMinus += s.w;
            }
            if (wPlus > wMinus) interiorPositive = true;
            else if (wMinus > wPlus) interiorPositive = false;
        }
    }
    if (interiorPositive === null && modelBounds) {
        const cx = (modelBounds.minX + modelBounds.maxX) / 2;
        const cy = (modelBounds.minY + modelBounds.maxY) / 2;
        interiorPositive = nx * (cx - midX) + ny * (cy - midY) > 0;
    }
    if (interiorPositive === null) interiorPositive = false;

    const sign = interiorPositive ? -1 : 1;
    return { nx: sign * nx, ny: sign * ny };
}

function computeNearWallLabelOffsetPx(wall, scaleFactor, fontSize, textWidth = 40, rotatedVerticalText = false) {
    const thicknessMm = wall?.thickness || 100;
    const fromWallMm = thicknessMm / 2 + DIMENSION_CONFIG.NEAR_WALL_CLEARANCE_MM;
    const wallFacePx = fromWallMm * scaleFactor;
    const perpHalf = rotatedVerticalText
        ? textWidth * 0.5 + 4
        : Math.max(fontSize * 0.45, 8) + 4;
    return Math.max(
        DIMENSION_CONFIG.BASE_OFFSET_NEAR_WALL,
        wallFacePx + perpHalf + 2
    );
}

function findWallLineDataForWall(wallLinesMap, wall) {
    if (!wallLinesMap || !wall) return null;
    for (const [, data] of wallLinesMap) {
        if (data?.wall?.id === wall.id) return data;
    }
    return findWallDataForSegment(
        wallLinesMap,
        wall.start_x,
        wall.start_y,
        wall.end_x,
        wall.end_y,
        5
    );
}

function isPointInsideWallCorridor(px, py, wallData, scaleFactor, offsetX, offsetY, extraPadPx = 0) {
    if (!wallData?.line1 || !wallData?.line2) return false;
    const c = getWallCorridorScreenBounds(
        wallData.line1,
        wallData.line2,
        scaleFactor,
        offsetX,
        offsetY,
        extraPadPx
    );
    return (
        px >= c.x &&
        px <= c.x + c.width &&
        py >= c.y &&
        py <= c.y + c.height
    );
}

/**
 * Near-wall labels: stay close to the wall. Hide only when the label center sits on the
 * host wall slab or overlaps another label — do not scan every wall (that required extreme zoom).
 */
function oppositePlanEdge(edge) {
    if (edge === 'top') return 'bottom';
    if (edge === 'bottom') return 'top';
    if (edge === 'left') return 'right';
    if (edge === 'right') return 'left';
    return 'top';
}

/** Wall/ceiling/floor plan dimension font size (sqrt zoom scaling, clamped min–max px). */
export function computeWallPlanDimensionFontSize(scaleFactor, initialScale = 1) {
    const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor;
    let fontSize;
    let sqrtScaledFontSize = 0;
    if (initialScale > 0 && scaleFactor > initialScale) {
        const zoomRatio = scaleFactor / initialScale;
        sqrtScaledFontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
    }
    if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
        fontSize = sqrtScaledFontSize > 0 ? sqrtScaledFontSize : DIMENSION_CONFIG.FONT_SIZE_MIN;
    } else {
        fontSize = Math.max(calculatedFontSize, sqrtScaledFontSize || DIMENSION_CONFIG.FONT_SIZE_MIN);
    }
    fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN, 10);
    return Math.min(fontSize, DIMENSION_CONFIG.FONT_SIZE_MAX);
}

/** One placement side per plan edge so chained wall dims (10250 + 7940) share the same column. */
export function resolveWallExteriorPlacementSide({
    isHorizontal,
    wallMidX,
    wallMidY,
    modelBounds,
    dimensionLanes
}) {
    // Always the nearest AABB edge. Picking the opposite side when the preferred
    // row is busy parks a top-edge wall on the bottom of the whole site (and the
    // same for left/right), with extension lines that no longer meet the wall.
    const planSide = getPlanExteriorSide(isHorizontal, wallMidX, wallMidY, modelBounds);
    const edge = getDimensionEdge(isHorizontal, planSide);
    if (dimensionLanes) {
        if (!dimensionLanes._edgePlacementSide) {
            dimensionLanes._edgePlacementSide = {};
        }
        dimensionLanes._edgePlacementSide[edge] = planSide;
    }
    return planSide;
}

/** Perpendicular to wall only (exterior + interior) — never offset along the wall axis. */
/**
 * TEMPORARY diagnostic. A dimension's text belongs between its own extension lines; anything
 * else reads as measuring a different wall. Reports offenders once per value per draw.
 */
const reportedOutsideSpan = new Set();
function reportDimensionOutsideSpan({
    text,
    axis,
    isNearWallDimension,
    side,
    labelCenterPx,
    spanLoPx,
    spanHiPx,
    textExtentPx
}) {
    if (!Number.isFinite(labelCenterPx) || !Number.isFinite(spanLoPx) || !Number.isFinite(spanHiPx)) return;
    const overhang = labelCenterPx < spanLoPx
        ? spanLoPx - labelCenterPx
        : labelCenterPx > spanHiPx
            ? labelCenterPx - spanHiPx
            : 0;
    const spanCenter = (spanLoPx + spanHiPx) / 2;
    const offCenter = labelCenterPx - spanCenter;
    if (overhang <= 2 && Math.abs(offCenter) <= Math.max(6, (spanHiPx - spanLoPx) * 0.25)) return;
    const key = `${text}|${axis}`;
    if (reportedOutsideSpan.has(key)) return;
    reportedOutsideSpan.add(key);
    console.warn('[dim placement]', text, {
        axis,
        nearWall: isNearWallDimension,
        side,
        spanPx: [Math.round(spanLoPx), Math.round(spanHiPx)],
        spanLenPx: Math.round(spanHiPx - spanLoPx),
        labelPx: Math.round(labelCenterPx),
        offCenterPx: Math.round(offCenter),
        overhangPx: Math.round(overhang),
        textExtentPx: Math.round(textExtentPx)
    });
}

/** TEMPORARY diagnostic: report a label drawn on top of one already placed. */
function reportDimensionOverlap({ text, axis, isNearWallDimension, side, bounds, placedLabels }) {
    if (!bounds || !Array.isArray(placedLabels)) return;
    const hit = placedLabels.find((existing) => checkBoxOverlap(bounds, existing, 0));
    if (!hit) return;
    const key = `overlap|${text}|${axis}`;
    if (reportedOutsideSpan.has(key)) return;
    reportedOutsideSpan.add(key);
    console.warn('[dim overlap]', text, {
        axis,
        nearWall: isNearWallDimension,
        side,
        box: [Math.round(bounds.x), Math.round(bounds.y), Math.round(bounds.width), Math.round(bounds.height)],
        hitText: hit.text ?? '(no text)',
        hitType: hit.type ?? '(no type)',
        hitBox: [Math.round(hit.x), Math.round(hit.y), Math.round(hit.width), Math.round(hit.height)]
    });
}

export function clearDimensionPlacementDebug() {
    reportedOutsideSpan.clear();
}

function buildNearWallPlacementCandidates(wall, rooms, modelBounds) {
    const ext = getExteriorNormalUnit(wall, rooms, modelBounds);
    const edge = exteriorSideName(ext.nx, ext.ny);
    return [
        { nx: ext.nx, ny: ext.ny, edge },
        { nx: -ext.nx, ny: -ext.ny, edge: oppositePlanEdge(edge) }
    ];
}

/** Chained dims on the same side share perpendicular offset (off), not absolute screen X/Y. */
function applyNearWallSharedOffset(
    dimensionLanes,
    near,
    sharedKey,
    anchorXModel,
    anchorYModel,
    scaleFactor,
    offsetX,
    offsetY,
    calculateBounds,
    textWidth
) {
    if (!near) return null;
    const nx = near.ext?.nx ?? 0;
    const ny = near.ext?.ny ?? 0;
    const edgeKey = `${near.side || 'top'}:${sharedKey || 'unscoped'}`;
    let off = near.off;
    if (dimensionLanes) {
        if (!dimensionLanes._nearWallShared) dimensionLanes._nearWallShared = {};
        const shared = dimensionLanes._nearWallShared[edgeKey];
        if (shared) {
            off = shared.off;
        } else {
            dimensionLanes._nearWallShared[edgeKey] = { nx, ny, off };
        }
    }
    const labelX = anchorXModel * scaleFactor + offsetX + nx * off;
    const labelY = anchorYModel * scaleFactor + offsetY + ny * off;
    return {
        ...near,
        labelX,
        labelY,
        off,
        bounds: calculateBounds(labelX, labelY, textWidth)
    };
}

function placeNearWallWallDimension({
    wallForNear,
    wallMidX,
    wallMidY,
    isHorizontal,
    modelBounds,
    dimensionLanes,
    scaleFactor,
    offsetX,
    offsetY,
    fontSize,
    textWidth,
    placedLabels,
    wallLinesMap,
    rooms,
    initialScale,
    rotatedVerticalText,
    calculateBounds,
    spanLo: _spanLo,
    spanHi: _spanHi,
}) {
    // Walls lying on one straight line form a single dimension run. Identify the run by the
    // line it sits on, so chained lengths share a side and an offset while walls on other
    // lines stay independent.
    const runCoordModel = isHorizontal ? wallMidY : wallMidX;
    const runKey = Number.isFinite(runCoordModel)
        ? `${isHorizontal ? 'h' : 'v'}:${Math.round(runCoordModel / DIMENSION_CONFIG.NEAR_WALL_RUN_TOLERANCE_MM)}`
        : 'unscoped';
    const preferredSide = dimensionLanes?._nearWallRunSides?.[runKey] ?? null;

    // No along-wall sliding: if the mid-wall near position (with small outward steps) is
    // blocked, return null so the caller hides the dimension instead of relocating it.
    const near = tryPlaceNearWallLabel({
        wall: wallForNear,
        anchorXModel: wallMidX,
        anchorYModel: wallMidY,
        scaleFactor,
        offsetX,
        offsetY,
        fontSize,
        calculateBounds,
        textWidth,
        placedLabels,
        wallLinesMap,
        modelBounds,
        rooms,
        dimensionLanes,
        initialScale,
        rotatedVerticalText,
        preferredSide
    });
    if (!near) return null;

    const anchorXModel = wallMidX;
    const anchorYModel = wallMidY;

    const hostWallData = findWallLineDataForWall(wallLinesMap, wallForNear);
    // Share the offset across the run so chained lengths line up, but no wider than that:
    // sharing across a whole plan edge let one collision push every label into a distant row.
    const sharedKey = runKey;
    const laneSpacing = DIMENSION_CONFIG.NEAR_WALL_LANE_SPACING;
    const maxSteps = Math.max(
        DIMENSION_CONFIG.NEAR_WALL_MAX_PLACEMENT_STEPS,
        8
    );

    const tryOffset = (off) => {
        const nx = near.ext?.nx ?? 0;
        const ny = near.ext?.ny ?? 0;
        const labelX = anchorXModel * scaleFactor + offsetX + nx * off;
        const labelY = anchorYModel * scaleFactor + offsetY + ny * off;
        const bounds = calculateBounds(labelX, labelY, textWidth);
        if (
            !isLabelAcceptableForNearWallPlacement(
                labelX,
                labelY,
                bounds,
                placedLabels,
                hostWallData,
                scaleFactor,
                offsetX,
                offsetY,
                initialScale,
                wallLinesMap
            )
        ) {
            return null;
        }
        return {
            ...near,
            labelX,
            labelY,
            off,
            bounds,
        };
    };

    // Prefer a shared edge offset (aligned chains), but never accept a colliding snap.
    let positioned = applyNearWallSharedOffset(
        dimensionLanes,
        near,
        sharedKey,
        anchorXModel,
        anchorYModel,
        scaleFactor,
        offsetX,
        offsetY,
        calculateBounds,
        textWidth
    );
    if (
        positioned
        && !isLabelAcceptableForNearWallPlacement(
            positioned.labelX,
            positioned.labelY,
            positioned.bounds,
            placedLabels,
            hostWallData,
            scaleFactor,
            offsetX,
            offsetY,
            initialScale,
            wallLinesMap
        )
    ) {
        positioned = null;
    }

    if (!positioned) {
        const startOff = near.off ?? 0;
        for (let step = 0; step < maxSteps; step++) {
            const candidate = tryOffset(startOff + step * laneSpacing);
            if (candidate) {
                positioned = candidate;
                break;
            }
        }
    }

    if (!positioned) return null;

    // Keep later labels on this edge at least this far out (collision-aware).
    if (dimensionLanes) {
        if (!dimensionLanes._nearWallRunSides) dimensionLanes._nearWallRunSides = {};
        const runSide = positioned.side || near.side;
        if (runSide && !dimensionLanes._nearWallRunSides[runKey]) {
            dimensionLanes._nearWallRunSides[runKey] = runSide;
        }
        if (!dimensionLanes._nearWallShared) dimensionLanes._nearWallShared = {};
        const edgeKey = `${positioned.side || near.side || 'top'}:${sharedKey}`;
        const shared = dimensionLanes._nearWallShared[edgeKey];
        if (!shared || (positioned.off ?? 0) > (shared.off ?? 0)) {
            dimensionLanes._nearWallShared[edgeKey] = {
                nx: positioned.ext?.nx ?? near.ext?.nx ?? 0,
                ny: positioned.ext?.ny ?? near.ext?.ny ?? 0,
                off: positioned.off,
            };
        }
    }

    return positioned;
}

function isLabelAcceptableForNearWallPlacement(
    labelX,
    labelY,
    labelBounds,
    placedLabels,
    hostWallData,
    scaleFactor,
    offsetX,
    offsetY,
    initialScale = 1,
    wallLinesMap = null
) {
    const sep = nearWallLabelSeparationPx(scaleFactor, initialScale);
    if (hasLabelOverlap(labelBounds, placedLabels, sep)) {
        return false;
    }
    if (wallLinesMap && doesNearWallLabelOverlapAnyWall(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY)) {
        return false;
    }
    if (!hostWallData) {
        return true;
    }
    if (isPointInsideWallCorridor(labelX, labelY, hostWallData, scaleFactor, offsetX, offsetY, 0)) {
        return false;
    }
    if (doesLabelOverlapWallCorridor(labelBounds, hostWallData, scaleFactor, offsetX, offsetY, 0)) {
        return false;
    }
    return true;
}

function doesNearWallLabelOverlapAnyWall(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY) {
    if (!(wallLinesMap instanceof Map) || wallLinesMap.size === 0) return false;
    for (const [, wallData] of wallLinesMap) {
        if (doesLabelOverlapWallCorridor(labelBounds, wallData, scaleFactor, offsetX, offsetY, 2)) {
            return true;
        }
    }
    return false;
}

/**
 * Near-wall label: smaller text, stay close to wall, try top/bottom/left/right by lane load.
 * Returns null if no side is clear (do not push far outward).
 */
function tryPlaceNearWallLabel({
    wall,
    anchorXModel,
    anchorYModel,
    scaleFactor,
    offsetX,
    offsetY,
    fontSize,
    calculateBounds,
    textWidth,
    placedLabels,
    wallLinesMap,
    modelBounds,
    rooms,
    dimensionLanes = null,
    initialScale = 1,
    rotatedVerticalText = false,
    preferredSide = null
}) {
    if (!wall) return null;
    const hostWallData = findWallLineDataForWall(wallLinesMap, wall);
    const baseOff = computeNearWallLabelOffsetPx(
        wall,
        scaleFactor,
        fontSize,
        textWidth,
        rotatedVerticalText
    );
    const laneSpacing = DIMENSION_CONFIG.NEAR_WALL_LANE_SPACING;
    const candidates = buildNearWallPlacementCandidates(wall, rooms, modelBounds);
    const ext = getExteriorNormalUnit(wall, rooms, modelBounds);
    const extEdge = exteriorSideName(ext.nx, ext.ny);
    const sorted = [...candidates].sort((a, b) => {
        // The exterior normal is guessed per wall, so two walls forming one straight run can
        // disagree and send their labels to opposite faces of the same run. Once a run has a
        // side, later dimensions on it follow, which keeps a chain readable as one row.
        if (a.edge === preferredSide && b.edge !== preferredSide) return -1;
        if (b.edge === preferredSide && a.edge !== preferredSide) return 1;
        if (a.edge === extEdge && b.edge !== extEdge) return -1;
        if (b.edge === extEdge && a.edge !== extEdge) return 1;
        const la = dimensionLanes?.[a.edge] ?? 0;
        const lb = dimensionLanes?.[b.edge] ?? 0;
        return la - lb;
    });

    const maxSteps = DIMENSION_CONFIG.NEAR_WALL_MAX_PLACEMENT_STEPS;
    // Stay at the wall midpoint — never slide along the run. If no clear near-wall slot
    // exists after a few outward steps, the caller hides the dimension.
    for (let step = 0; step < maxSteps; step++) {
        const off = baseOff + step * laneSpacing;
        for (const cand of sorted) {
            const labelX = anchorXModel * scaleFactor + offsetX + cand.nx * off;
            const labelY = anchorYModel * scaleFactor + offsetY + cand.ny * off;
            const bounds = calculateBounds(labelX, labelY, textWidth);
            if (
                isLabelAcceptableForNearWallPlacement(
                    labelX,
                    labelY,
                    bounds,
                    placedLabels,
                    hostWallData,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    initialScale,
                    wallLinesMap
                )
            ) {
                if (dimensionLanes && cand.edge) {
                    dimensionLanes[cand.edge] = (dimensionLanes[cand.edge] ?? 0) + 1;
                }
                return {
                    labelX,
                    labelY,
                    bounds,
                    ext: { nx: cand.nx, ny: cand.ny },
                    side: cand.edge,
                    off
                };
            }
        }
    }
    return null;
}

/** Screen px from building envelope to outer edge of an exterior wall/panel label. */
function measureExteriorLabelOutsetPx(
    edge,
    labelX,
    labelY,
    labelBounds,
    modelBounds,
    scaleFactor,
    offsetX,
    offsetY
) {
    if (!modelBounds) return 0;
    const { minX, maxX, minY, maxY } = modelBounds;
    const topEdge = minY * scaleFactor + offsetY;
    const bottomEdge = maxY * scaleFactor + offsetY;
    const leftEdge = minX * scaleFactor + offsetX;
    const rightEdge = maxX * scaleFactor + offsetX;
    const t = labelBounds?.y ?? labelY;
    const b = (labelBounds?.y ?? labelY) + (labelBounds?.height ?? 0);
    const l = labelBounds?.x ?? labelX;
    const r = (labelBounds?.x ?? labelX) + (labelBounds?.width ?? 0);
    if (edge === 'top') return Math.max(0, topEdge - t);
    if (edge === 'bottom') return Math.max(0, b - bottomEdge);
    if (edge === 'left') return Math.max(0, leftEdge - l);
    if (edge === 'right') return Math.max(0, r - rightEdge);
    return 0;
}

function labelBoundsToModelBounds(labelBounds, scaleFactor, offsetX, offsetY) {
    return {
        minX: (labelBounds.x - offsetX) / scaleFactor,
        maxX: (labelBounds.x + labelBounds.width - offsetX) / scaleFactor,
        minY: (labelBounds.y - offsetY) / scaleFactor,
        maxY: (labelBounds.y + labelBounds.height - offsetY) / scaleFactor
    };
}

/** Full wall-length dimensions must sit outside the project envelope (not in the interior). */
function isLabelOutsideModelBounds(labelBounds, modelBounds, scaleFactor, offsetX, offsetY, minSeparationMm = 15) {
    if (!modelBounds) return true;
    const mm = labelBoundsToModelBounds(labelBounds, scaleFactor, offsetX, offsetY);
    const sep = minSeparationMm;
    return (
        mm.maxX < modelBounds.minX - sep ||
        mm.minX > modelBounds.maxX + sep ||
        mm.maxY < modelBounds.minY - sep ||
        mm.minY > modelBounds.maxY + sep
    );
}

/**
 * @param {boolean} isNearWall - true for short/near-wall dims (may sit inside project area, outside wall slab only)
 */
function isLabelAcceptableForWallDimension(
    labelBounds,
    placedLabels,
    wallLinesMap,
    modelBounds,
    scaleFactor,
    offsetX,
    offsetY,
    isNearWall,
    initialScale = 1,
) {
    if (isNearWall) {
        const sep = nearWallLabelSeparationPx(scaleFactor, initialScale);
        if (hasLabelOverlap(labelBounds, placedLabels, sep)) {
            return false;
        }
        if (wallLinesMap && doesNearWallLabelOverlapAnyWall(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY)) {
            return false;
        }
    } else if (!isLabelPlacementClean(labelBounds, placedLabels, DIMENSION_CONFIG.LABEL_MIN_SEPARATION)) {
        return false;
    }
    if (!isNearWall && !isLabelOutsideModelBounds(labelBounds, modelBounds, scaleFactor, offsetX, offsetY)) {
        return false;
    }
    if (!isNearWall && wallLinesMap && doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY)) {
        return false;
    }
    return true;
}

/** Default exterior row position when sliding finds no gap — still draw the dimension. */
function fallbackExteriorWallDimensionPosition({
    isHorizontal,
    side,
    rowOffsetPx,
    anchorX,
    anchorY,
    bounds,
    scaleFactor,
    offsetX,
    offsetY,
    textWidth,
    paddingH = 2,
    paddingV = 8
}) {
    const sf = scaleFactor;
    const ox = offsetX;
    const oy = offsetY;
    const { minX, maxX, minY, maxY } = bounds;
    if (isHorizontal) {
        const labelY =
            side === 'side1' ? minY * sf + oy - rowOffsetPx : maxY * sf + oy + rowOffsetPx;
        const labelX = anchorX * sf + ox;
        const labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, paddingH, paddingV);
        return { labelX, labelY, labelBounds, offset: rowOffsetPx, side };
    }
    const labelX =
        side === 'side1' ? minX * sf + ox - rowOffsetPx : maxX * sf + ox + rowOffsetPx;
    const labelY = anchorY * sf + oy;
    const labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, paddingH, paddingV);
    return { labelX, labelY, labelBounds, offset: rowOffsetPx, side };
}

/**
 * Exterior plan dim: span lanes group chain segments on one row.
 * Keep the number on the midpoint of its own span. When lockRow is true
 * (wall chain dims), never bump to another row or slide along the line.
 */
export function placeExteriorWallDimensionAvoidingLabels({
    isHorizontal,
    side,
    rowOffsetPx,
    spanLo,
    spanHi,
    anchorX,
    anchorY,
    bounds,
    scaleFactor,
    offsetX,
    offsetY,
    textWidth,
    placedLabels,
    paddingH = 2,
    paddingV = 8,
    fixedLabelX = null,
    fontSize = null,
    lockRow = false
}) {
    const sep = DIMENSION_CONFIG.LABEL_MIN_SEPARATION;
    const rowStep = DIMENSION_CONFIG.WALL_EXTERNAL_LANE_SPACING;
    const maxBumps = lockRow ? 0 : DIMENSION_CONFIG.MAX_ATTEMPTS;
    let rowOffset = rowOffsetPx;
    const columnLocked = !isHorizontal && fixedLabelX != null && Number.isFinite(fixedLabelX);

    const boundsFor = (lx, ly) =>
        isHorizontal
            ? calculateHorizontalLabelBounds(lx, ly, textWidth, paddingH, paddingV)
            : exteriorVerticalLabelBounds(lx, ly, textWidth, fontSize, paddingH, paddingV);

    const tryOnce = (rowOff, yBiasPx = 0) => {
        let placed = tryPlaceExteriorDimensionLabel({
            isHorizontal,
            side,
            rowOffsetPx: rowOff,
            spanLo,
            spanHi,
            anchorX,
            anchorY,
            bounds,
            scaleFactor,
            offsetX,
            offsetY,
            textWidth,
            paddingH,
            paddingV,
            placedLabels,
            fixedLabelX: columnLocked ? fixedLabelX : null,
            fontSize,
            yBiasPx,
            lockAlongSpan: lockRow
        });
        if (!placed) {
            placed = fallbackExteriorWallDimensionPosition({
                isHorizontal,
                side,
                rowOffsetPx: rowOff,
                anchorX,
                anchorY,
                bounds,
                scaleFactor,
                offsetX,
                offsetY,
                textWidth,
                paddingH,
                paddingV
            });
            if (columnLocked && placed) {
                placed = { ...placed, labelX: fixedLabelX };
            }
        }
        if (!placed) {
            return { placed: null, labelBounds: null };
        }
        const labelBounds = boundsFor(placed.labelX, placed.labelY);
        return { placed, labelBounds };
    };

    for (let bump = 0; bump <= maxBumps; bump++) {
        if (columnLocked && !lockRow) {
            const yTry = [0];
            for (let s = rowStep; s <= rowStep * maxBumps; s += rowStep) {
                yTry.push(s, -s);
            }
            for (const yBiasPx of yTry) {
                const { placed, labelBounds } = tryOnce(rowOffset, yBiasPx);
                if (placed && labelBounds && isLabelPlacementClean(labelBounds, placedLabels, sep)) {
                    return { ...placed, rowOffset, labelBounds };
                }
            }
        } else {
            const { placed, labelBounds } = tryOnce(rowOffset, 0);
            if (placed && labelBounds && isLabelPlacementClean(labelBounds, placedLabels, sep)) {
                return { ...placed, rowOffset, labelBounds };
            }
        }
        if (lockRow) break;
        rowOffset += rowStep;
    }

    // Chained exterior dims stay on their span midpoint even if a door marker is
    // nearby. Do not stack a second number on top of one already drawn.
    if (lockRow) {
        const { placed, labelBounds } = tryOnce(rowOffsetPx, 0);
        if (placed && labelBounds && !overlapsDimensionText(labelBounds, placedLabels, sep)) {
            return { ...placed, rowOffset: rowOffsetPx, labelBounds };
        }
        return null;
    }

    // Every candidate row collided. Placing one anyway stacks this text on a neighbouring
    // dimension or a door marker, which is worse than the number being absent.
    if (DIMENSION_CONFIG.HIDE_OVERLAPPING_EXTERIOR_DIMS) {
        return null;
    }
    // Same-row fallback: keep chain level even if text is a bit tight
    const { placed, labelBounds } = tryOnce(rowOffsetPx, 0);
    if (!placed) {
        return null;
    }
    return { ...placed, rowOffset: rowOffsetPx, labelBounds };
}

function exteriorSideName(nx, ny) {
    if (Math.abs(ny) >= Math.abs(nx)) {
        return ny < 0 ? 'top' : 'bottom';
    }
    return nx < 0 ? 'left' : 'right';
}

/** Screen-space AABB covering the full wall thickness (both offset lines), not just centerlines. */
function getWallCorridorScreenBounds(line1, line2, scaleFactor, offsetX, offsetY, extraPadPx = 10) {
    const pts = [line1[0], line1[1], line2[0], line2[1]].map((p) => ({
        x: p.x * scaleFactor + offsetX,
        y: p.y * scaleFactor + offsetY
    }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
        x: minX - extraPadPx,
        y: minY - extraPadPx,
        width: maxX - minX + extraPadPx * 2,
        height: maxY - minY + extraPadPx * 2
    };
}

function doesLabelOverlapWallCorridor(labelBounds, wallData, scaleFactor, offsetX, offsetY, extraPadPx = 10) {
    if (!wallData?.line1 || !wallData?.line2) return false;
    const corridor = getWallCorridorScreenBounds(
        wallData.line1,
        wallData.line2,
        scaleFactor,
        offsetX,
        offsetY,
        extraPadPx
    );
    return checkBoxOverlap(labelBounds, corridor, 4);
}

// Check if label bounds overlap any wall thickness corridor
function doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY) {
    if (!(wallLinesMap instanceof Map) || wallLinesMap.size === 0) return false;

    for (const [, wallData] of wallLinesMap) {
        if (doesLabelOverlapWallCorridor(labelBounds, wallData, scaleFactor, offsetX, offsetY, 10)) {
            return true;
        }
    }

    return false;
}

// Utility function to normalize wall coordinates
// Ensures horizontal walls are created from left to right
// and vertical walls are created from top to bottom
export function normalizeWallCoordinates(startPoint, endPoint) {
    const roundPoint = (point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y)
    });
    const start = roundPoint(startPoint);
    const end = roundPoint(endPoint);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    
    // Determine if wall is horizontal or vertical
    const isHorizontal = Math.abs(dy) < Math.abs(dx);
    
    if (isHorizontal) {
        // For horizontal walls, ensure start_x < end_x (left to right)
        if (start.x > end.x) {
            return {
                startPoint: { x: end.x, y: end.y },
                endPoint: { x: start.x, y: start.y }
            };
        }
    } else {
        // For vertical walls, ensure start_y < end_y (top to bottom)
        if (start.y > end.y) {
            return {
                startPoint: { x: end.x, y: end.y },
                endPoint: { x: start.x, y: start.y }
            };
        }
    }
    
    // No change needed
    return {
        startPoint: { x: start.x, y: start.y },
        endPoint: { x: end.x, y: end.y }
    };
}

// Test function to verify normalization logic
export function testNormalization() {
    console.log('Testing wall coordinate normalization...');
    
    // Test horizontal wall (should be left to right)
    const horizontalTest1 = normalizeWallCoordinates({ x: 100, y: 50 }, { x: 50, y: 50 });
    console.log('Horizontal wall (right to left):', horizontalTest1);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 100, y: 50}
    
    const horizontalTest2 = normalizeWallCoordinates({ x: 50, y: 50 }, { x: 100, y: 50 });
    console.log('Horizontal wall (left to right):', horizontalTest2);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 100, y: 50}
    
    // Test vertical wall (should be top to bottom)
    const verticalTest1 = normalizeWallCoordinates({ x: 50, y: 100 }, { x: 50, y: 50 });
    console.log('Vertical wall (bottom to top):', verticalTest1);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 50, y: 100}
    
    const verticalTest2 = normalizeWallCoordinates({ x: 50, y: 50 }, { x: 50, y: 100 });
    console.log('Vertical wall (top to bottom):', verticalTest2);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 50, y: 100}
    
    // Test diagonal wall (should not change)
    const diagonalTest = normalizeWallCoordinates({ x: 50, y: 50 }, { x: 100, y: 100 });
    console.log('Diagonal wall:', diagonalTest);
    // Should return: startPoint: {x: 50, y: 50}, endPoint: {x: 100, y: 100}
}

// Draw the grid on the canvas
export function drawGrid(context, canvasWidth, canvasHeight, gridSize, isDrawing) {
    context.strokeStyle = getPlanCanvasGridColor(isDrawing);
    context.lineWidth = isDrawing ? DIMENSION_CONFIG.GRID_LINE_WIDTH_ACTIVE : DIMENSION_CONFIG.GRID_LINE_WIDTH;
    for (let x = 0; x <= canvasWidth; x += gridSize) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvasHeight);
        context.stroke();
    }
    for (let y = 0; y <= canvasHeight; y += gridSize) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvasWidth, y);
        context.stroke();
    }
}

// Get room label positions for interactive labels
export function getRoomLabelPositions(rooms, walls, scaleFactor, offsetX, offsetY, calculateRoomArea, calculatePolygonVisualCenter) {
    const labelPositions = [];
    
    rooms.forEach(room => {
        const roomWalls = room.walls.map(wallId => 
            walls.find(w => w.id === wallId)
        ).filter(Boolean);
        const areaPoints = (room.room_points && room.room_points.length >= 3)
            ? { insetPoints: room.room_points }
            : calculateRoomArea(roomWalls);
        if (!areaPoints || !areaPoints.insetPoints || areaPoints.insetPoints.length < 3) return;
        
        // Use stored label position if available, otherwise calculate center
        let position;
        if (room.label_position && room.label_position.x !== undefined && room.label_position.y !== undefined) {
            position = room.label_position;
        } else {
            const center = calculatePolygonVisualCenter(areaPoints.insetPoints);
            if (center) {
                position = center;
            } else {
                return; // Skip if no position can be determined
            }
        }
        
        labelPositions.push({
            roomId: room.id,
            position: position,
            room: room
        });
    });
    
    return labelPositions;
}

// Draw the preview of a room being defined
export function drawRoomPreview(context, selectedRoomPoints, scaleFactor, offsetX, offsetY) {
    if (selectedRoomPoints.length < 2) return;
    selectedRoomPoints.forEach(pt => {
        context.beginPath();
        context.arc(
            pt.x * scaleFactor + offsetX,
            pt.y * scaleFactor + offsetY,
            4, 0, 2 * Math.PI
        );
        context.fillStyle = '#007bff';
        context.fill();
    });  
    context.beginPath();
    context.moveTo(
        selectedRoomPoints[0].x * scaleFactor + offsetX,
        selectedRoomPoints[0].y * scaleFactor + offsetY
    );
    for (let i = 1; i < selectedRoomPoints.length; i++) {
        context.lineTo(
            selectedRoomPoints[i].x * scaleFactor + offsetX,
            selectedRoomPoints[i].y * scaleFactor + offsetY
        );
    }          
    context.strokeStyle = DIMENSION_CONFIG.COLORS.ROOM_PREVIEW;
    context.lineWidth = DIMENSION_CONFIG.ROOM_PREVIEW_LINE_WIDTH;
    context.setLineDash(DIMENSION_CONFIG.ROOM_PREVIEW_DASH);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = DIMENSION_CONFIG.COLORS.ROOM_PREVIEW_FILL;
    context.fill();
}

// Draw wall endpoints. When initialScale is provided, size tracks canvas zoom
// (bigger when zoomed in, smaller when zoomed out), clamped to a readable range.
export function drawEndpoints(context, x, y, scaleFactor, offsetX, offsetY, hoveredPoint, color = null, size = null, initialScale = null) {
    // Use config defaults if not provided
    if (color === null) {
        color = DIMENSION_CONFIG.COLORS.ENDPOINT;
    }
    if (size === null) {
        size = DIMENSION_CONFIG.ENDPOINT_SIZE;
    }

    if (initialScale != null && initialScale > 0) {
        size *= scaleFactor / initialScale;
    }
    // Keep dots usable when zoomed out, and not overpowering when zoomed in
    size = Math.max(1.5, Math.min(8, size));

    if (hoveredPoint && hoveredPoint.x === x && hoveredPoint.y === y) {
        color = DIMENSION_CONFIG.COLORS.ENDPOINT_HOVER;
        size = Math.min(10, size * 1.35);
    }
    context.beginPath();
    context.arc(
        x * scaleFactor + offsetX,
        y * scaleFactor + offsetY,
        size,
        0,
        2 * Math.PI
    );
    context.fillStyle = color;
    context.fill();
}

function collectWallFacePoints(wall, wallData = null, includeThicknessFallback = false) {
    // Only use drawn faces when asked. wall._line1 is attached during canvas draw and
    // must not leak into "does the layout exceed the declared site" checks.
    const line1 = wallData?.line1 || (includeThicknessFallback ? wall?._line1 : null);
    const line2 = wallData?.line2 || (includeThicknessFallback ? wall?._line2 : null);
    const pts = [];
    if (line1) pts.push(...line1);
    if (line2) pts.push(...line2);
    if (pts.length > 0) return pts;
    if (!wall) return pts;
    if (includeThicknessFallback) {
        const thickness = Number(wall.thickness);
        const half = Number.isFinite(thickness) && thickness > 0 ? thickness / 2 : 0;
        const dx = (wall.end_x || 0) - (wall.start_x || 0);
        const dy = (wall.end_y || 0) - (wall.start_y || 0);
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * half;
        const ny = (dx / len) * half;
        pts.push(
            { x: (wall.start_x || 0) + nx, y: (wall.start_y || 0) + ny },
            { x: (wall.end_x || 0) + nx, y: (wall.end_y || 0) + ny },
            { x: (wall.start_x || 0) - nx, y: (wall.start_y || 0) - ny },
            { x: (wall.end_x || 0) - nx, y: (wall.end_y || 0) - ny }
        );
        return pts;
    }
    pts.push(
        { x: wall.start_x, y: wall.start_y },
        { x: wall.end_x, y: wall.end_y }
    );
    return pts;
}

function accumulatePointsBounds(pts, bounds) {
    for (const p of pts) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        bounds.minX = Math.min(bounds.minX, p.x);
        bounds.maxX = Math.max(bounds.maxX, p.x);
        bounds.minY = Math.min(bounds.minY, p.y);
        bounds.maxY = Math.max(bounds.maxY, p.y);
    }
}

/** AABB of room/centerline inset by half wall thickness (true inner faces). */
export function insetBoundsToInnerFaces(bounds, walls) {
    if (!bounds) return bounds;
    let maxT = 0;
    (walls || []).forEach((wall) => {
        const t = Number(wall.thickness);
        if (Number.isFinite(t) && t > maxT) maxT = t;
    });
    const half = (maxT > 0 ? maxT : 100) / 2;
    if (bounds.maxX - bounds.minX <= half * 2 + 1 || bounds.maxY - bounds.minY <= half * 2 + 1) {
        return { ...bounds };
    }
    return {
        minX: bounds.minX + half,
        maxX: bounds.maxX - half,
        minY: bounds.minY + half,
        maxY: bounds.maxY - half
    };
}
export function expandBoundsToWallFaces(bounds, walls, wallLinesMap = null) {
    if (!bounds) return bounds;
    const next = {
        minX: bounds.minX,
        maxX: bounds.maxX,
        minY: bounds.minY,
        maxY: bounds.maxY
    };
    if (!walls?.length) return next;
    walls.forEach((wall) => {
        const data = wallLinesMap?.get?.(wall.id) || null;
        accumulatePointsBounds(collectWallFacePoints(wall, data, true), next);
    });
    return next;
}

function expandEndpointToJoiningFaces(x, y, isHorizontal, towardMax, wallLinesMap) {
    if (!wallLinesMap) return isHorizontal ? x : y;
    const locTol = 250;
    let extreme = towardMax ? -Infinity : Infinity;
    let found = false;
    for (const [, data] of wallLinesMap) {
        const w = data?.wall;
        const pts = [];
        if (data?.line1) pts.push(...data.line1);
        if (data?.line2) pts.push(...data.line2);
        if (!pts.length && w) {
            pts.push({ x: w.start_x, y: w.start_y }, { x: w.end_x, y: w.end_y });
        }
        if (!pts.length) continue;

        const wallNear = w
            ? pointToSegmentDistanceMm(x, y, w.start_x, w.start_y, w.end_x, w.end_y) <= locTol
            : pts.some((p) => Math.hypot(p.x - x, p.y - y) <= locTol);
        if (!wallNear) continue;

        const wdx = w ? w.end_x - w.start_x : pts[1].x - pts[0].x;
        const wdy = w ? w.end_y - w.start_y : pts[1].y - pts[0].y;
        const wallIsHoriz = Math.abs(wdy) <= Math.abs(wdx);
        const isPerpendicular = isHorizontal ? !wallIsHoriz : wallIsHoriz;

        for (const p of pts) {
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            if (!isPerpendicular && Math.hypot(p.x - x, p.y - y) > locTol) continue;
            const along = isHorizontal ? p.x : p.y;
            extreme = towardMax ? Math.max(extreme, along) : Math.min(extreme, along);
            found = true;
        }
    }
    if (!found) return isHorizontal ? x : y;
    return extreme;
}

/**
 * Stretch a wall dimension so ticks sit on the drawn faces (outer corners),
 * not the centerline which visually stops in the middle of the wall.
 */
function expandDimensionSegmentToWallFaces(startX, startY, endX, endY, wallData, modelBounds = null, wallLinesMap = null) {
    const line1 = wallData?.line1;
    const line2 = wallData?.line2;
    let result = { startX, startY, endX, endY };
    if (line1 && line2) {
        const pts = [...line1, ...line2];
        const dx = endX - startX;
        const dy = endY - startY;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (ady <= WALL_AXIS_ALIGN_TOL_MM) {
            const xs = pts.map((p) => p.x);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            result = endX >= startX
                ? { startX: minX, startY, endX: maxX, endY }
                : { startX: maxX, startY, endX: minX, endY };
        } else if (adx <= WALL_AXIS_ALIGN_TOL_MM) {
            const ys = pts.map((p) => p.y);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            result = endY >= startY
                ? { startX, startY: minY, endX, endY: maxY }
                : { startX, startY: maxY, endX, endY: minY };
        } else {
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            let minT = Infinity;
            let maxT = -Infinity;
            let minPt = { x: startX, y: startY };
            let maxPt = { x: endX, y: endY };
            pts.forEach((p) => {
                const t = (p.x - startX) * ux + (p.y - startY) * uy;
                if (t < minT) {
                    minT = t;
                    minPt = p;
                }
                if (t > maxT) {
                    maxT = t;
                    maxPt = p;
                }
            });
            result = { startX: minPt.x, startY: minPt.y, endX: maxPt.x, endY: maxPt.y };
        }
    }

    const dx = result.endX - result.startX;
    const dy = result.endY - result.startY;
    if (Math.abs(dy) <= WALL_AXIS_ALIGN_TOL_MM) {
        result.startX = expandEndpointToJoiningFaces(
            result.startX,
            result.startY,
            true,
            result.startX > result.endX,
            wallLinesMap
        );
        result.endX = expandEndpointToJoiningFaces(
            result.endX,
            result.endY,
            true,
            result.endX > result.startX,
            wallLinesMap
        );
    } else if (Math.abs(dx) <= WALL_AXIS_ALIGN_TOL_MM) {
        result.startY = expandEndpointToJoiningFaces(
            result.startX,
            result.startY,
            false,
            result.startY > result.endY,
            wallLinesMap
        );
        result.endY = expandEndpointToJoiningFaces(
            result.endX,
            result.endY,
            false,
            result.endY > result.startY,
            wallLinesMap
        );
    }

    if (modelBounds) {
        const thickness = Number(wallData?.wall?.thickness) || 100;
        const tol = Math.max(thickness * 1.25, 80);
        const rdx = result.endX - result.startX;
        const rdy = result.endY - result.startY;
        if (Math.abs(rdy) <= WALL_AXIS_ALIGN_TOL_MM) {
            const startIsLo = result.startX <= result.endX;
            let lo = Math.min(result.startX, result.endX);
            let hi = Math.max(result.startX, result.endX);
            if (lo - modelBounds.minX <= tol) lo = modelBounds.minX;
            if (modelBounds.maxX - hi <= tol) hi = modelBounds.maxX;
            result = startIsLo
                ? { ...result, startX: lo, endX: hi }
                : { ...result, startX: hi, endX: lo };
        } else if (Math.abs(rdx) <= WALL_AXIS_ALIGN_TOL_MM) {
            const startIsLo = result.startY <= result.endY;
            let lo = Math.min(result.startY, result.endY);
            let hi = Math.max(result.startY, result.endY);
            if (lo - modelBounds.minY <= tol) lo = modelBounds.minY;
            if (modelBounds.maxY - hi <= tol) hi = modelBounds.maxY;
            result = startIsLo
                ? { ...result, startY: lo, endY: hi }
                : { ...result, startY: hi, endY: lo };
        }
    }
    return result;
}

// Calculate actual project dimensions from wall start/end (the drawn outer).
// Thickness is only for rendering; do not pass wallLinesMap here or the site
// envelope grows by half a wall on each side.
export function calculateActualProjectDimensions(walls, _wallLinesMap = null) {
    if (!walls || walls.length === 0) {
        return { width: 0, length: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    walls.forEach((wall) => {
        accumulatePointsBounds(collectWallFacePoints(wall, null, false), bounds);
    });

    if (!Number.isFinite(bounds.minX)) {
        return { width: 0, length: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    return {
        width: bounds.maxX - bounds.minX,
        length: bounds.maxY - bounds.minY,
        minX: bounds.minX,
        maxX: bounds.maxX,
        minY: bounds.minY,
        maxY: bounds.maxY
    };
}

// Compare actual dimensions with declared project dimensions
export function compareDimensions(actualDimensions, declaredProject) {
    if (!declaredProject || !actualDimensions) {
        return { exceeds: false, warnings: [] };
    }
    
    const warnings = [];
    let exceeds = false;
    
    // Check if actual width exceeds declared width
    if (actualDimensions.width > declaredProject.width) {
        warnings.push(`Actual width (${Math.round(actualDimensions.width)}mm) exceeds declared width (${declaredProject.width}mm)`);
        exceeds = true;
    }
    
    // Check if actual length exceeds declared length
    if (actualDimensions.length > declaredProject.length) {
        warnings.push(`Actual length (${Math.round(actualDimensions.length)}mm) exceeds declared length (${declaredProject.length}mm)`);
        exceeds = true;
    }
    
    return { exceeds, warnings };
}

// Draw overall project dimensions (actual dimensions from wall boundaries)
export function drawOverallProjectDimensions(
    context,
    walls,
    scaleFactor,
    offsetX,
    offsetY,
    placedLabels = [],
    allLabels = [],
    initialScale = 1,
    wallLinesMap = null,
    dimensionEdgeExtents = null
) {
    if (!walls || walls.length === 0) return;
    
    // Wall start/end is the drawn outer. Do not add thickness on top or the
    // overall size (and the site-exceeded warning) will look larger than the layout.
    const actualDimensions = calculateActualProjectDimensions(walls);
    const { minX, maxX, minY, maxY } = actualDimensions;

    // Same bounds as wall dimensions so offsets are comparable (screen px from building edge)
    const placementBounds = { minX, maxX, minY, maxY };
    const clipBoundsModel = insetBoundsToInnerFaces(actualDimensions, walls);

    const mergedEdgeExtents = createDimensionEdgeExtents();
    if (dimensionEdgeExtents) {
        mergedEdgeExtents.top = dimensionEdgeExtents.top ?? 0;
        mergedEdgeExtents.bottom = dimensionEdgeExtents.bottom ?? 0;
        mergedEdgeExtents.left = dimensionEdgeExtents.left ?? 0;
        mergedEdgeExtents.right = dimensionEdgeExtents.right ?? 0;
    }
    syncEdgeExtentsFromPlacedLabels(
        mergedEdgeExtents,
        placedLabels,
        clipBoundsModel,
        scaleFactor,
        offsetX,
        offsetY
    );

    const PROJECT_BASE_OFFSET = DIMENSION_CONFIG.PROJECT_BASE_OFFSET;
    
    // Draw overall width dimension (top) with enhanced collision detection
    drawProjectDimension(
        context,
        minX, minY, // start point
        maxX, minY, // end point (horizontal line)
        scaleFactor, offsetX, offsetY,
        DIMENSION_CONFIG.COLORS.PROJECT,
        placementBounds, placedLabels, allLabels, PROJECT_BASE_OFFSET, 'horizontal',
        initialScale, wallLinesMap,
        clipBoundsModel,
        mergedEdgeExtents,
        actualDimensions.width
    );
    
    // Draw overall length dimension (right side) with enhanced collision detection
    drawProjectDimension(
        context,
        maxX, minY, // start point
        maxX, maxY, // end point (vertical line)
        scaleFactor, offsetX, offsetY,
        DIMENSION_CONFIG.COLORS.PROJECT,
        placementBounds, placedLabels, allLabels, PROJECT_BASE_OFFSET, 'vertical',
        initialScale, wallLinesMap,
        clipBoundsModel,
        mergedEdgeExtents,
        actualDimensions.length
    );
}

// Enhanced function to draw project dimensions (aligned with pdfVectorWallPlan: clip extensions, dashed/solid, mm label)
function drawProjectDimension(
    context,
    startX,
    startY,
    endX,
    endY,
    scaleFactor,
    offsetX,
    offsetY,
    color,
    modelBounds,
    placedLabels,
    allLabels,
    baseOffset,
    orientation,
    initialScale = 1,
    wallLinesMap = null,
    clipBoundsModel = null,
    dimensionEdgeExtents = null,
    labelLength = null
) {
    const length = (typeof labelLength === 'number' && labelLength > 0)
        ? labelLength
        : Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));

    if (length === 0) return;

    const wallMidX = (startX + endX) / 2;
    const wallMidY = (startY + endY) / 2;

    context.save();
    context.fillStyle = color;
    const fontSize = computeWallPlanDimensionFontSize(scaleFactor, initialScale);
    context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
    const text = formatDimMmCanvas(length);
    const textWidth = context.measureText(text).width;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    const {maxX, minY} = modelBounds;
    const rectScreen = clipBoundsModel ? modelBoundsToScreenRect(clipBoundsModel, scaleFactor, offsetX, offsetY) : null;
    const extDash = getCanvasExtensionDashPattern(scaleFactor);
    const dimLineW = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    const extLineW = getCanvasExtensionLineWidth();
    const tickPx = 4;

    if (orientation === 'horizontal') {
        const side = 'top';
        let labelY;
        let labelX;
        let offset = getProjectDimensionOffsetForEdge(
            dimensionEdgeExtents,
            'top',
            baseOffset,
            scaleFactor,
            initialScale
        );
        let attempts = 0;
        const maxAttempts = DIMENSION_CONFIG.PROJECT_MAX_ATTEMPTS;

        do {
            labelY = minY * scaleFactor + offsetY - offset;
            labelX = wallMidX * scaleFactor + offsetX;

            const labelBounds = calculateHorizontalLabelBounds(labelX, labelY, textWidth, 4, 10);
            const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
            const hasWallOverlap = wallLinesMap
                ? doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY)
                : false;

            if (!hasOverlap && !hasWallOverlap) break;

            const wallAvoidanceIncrementPx =
                hasWallOverlap && !hasOverlap ? 3 * scaleFactor : DIMENSION_CONFIG.PROJECT_OFFSET_INCREMENT;
            offset += wallAvoidanceIncrementPx;
            attempts++;
        } while (attempts < maxAttempts);

        const minProjectOffset = getProjectDimensionOffsetForEdge(
            dimensionEdgeExtents,
            'top',
            baseOffset,
            scaleFactor,
            initialScale
        );
        offset = Math.max(offset, minProjectOffset);
        labelY = minY * scaleFactor + offsetY - offset;
        labelX = wallMidX * scaleFactor + offsetX;

        const textPadding = 4;
        const startXScreen = startX * scaleFactor + offsetX;
        const endXScreen = endX * scaleFactor + offsetX;
        const originY = (clipBoundsModel?.minY ?? startY) * scaleFactor + offsetY;

        context.strokeStyle = color;
        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, startXScreen, originY, startXScreen, labelY, rectScreen);
        canvasDrawExtensionDashed(context, endXScreen, originY, endXScreen, labelY, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        strokeHorizontalDimLineAtY(context, labelY, startXScreen, endXScreen, labelX, textWidth, textPadding);
        canvasHorizontalDimArrows(context, startXScreen, endXScreen, labelY, color, tickPx);

        context.fillStyle = getPlanLabelBackground();
        context.fillRect(labelX - textWidth / 2 - 3, labelY - fontSize * 0.35 - 2, textWidth + 6, fontSize * 0.75 + 4);
        context.fillStyle = color;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, labelX, labelY);

        placedLabels.push({
            x: labelX - textWidth / 2 - 4,
            y: labelY - 10,
            width: textWidth + 8,
            height: 20,
            side: side,
            text: text,
            angle: angle,
            type: 'project'
        });
    } else {
        const side = 'right';
        let labelX;
        let labelY;
        let offset = Math.max(
            getProjectDimensionOffsetForEdge(
                dimensionEdgeExtents,
                'right',
                baseOffset,
                scaleFactor,
                initialScale
            ),
            DIMENSION_CONFIG.PROJECT_MIN_VERTICAL_OFFSET
        );
        let attempts = 0;
        const maxAttempts = DIMENSION_CONFIG.PROJECT_MAX_ATTEMPTS;

        do {
            labelX = maxX * scaleFactor + offsetX + offset;
            labelY = wallMidY * scaleFactor + offsetY;

            const labelBounds = calculateVerticalLabelBounds(labelX, labelY, textWidth, 4, 10);
            const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
            const hasWallOverlap = wallLinesMap
                ? doesLabelOverlapAnyWallLine(labelBounds, wallLinesMap, scaleFactor, offsetX, offsetY)
                : false;

            if (!hasOverlap && !hasWallOverlap) break;

            const wallAvoidanceIncrementPx =
                hasWallOverlap && !hasOverlap ? 3 * scaleFactor : DIMENSION_CONFIG.PROJECT_OFFSET_INCREMENT;
            offset += wallAvoidanceIncrementPx;
            attempts++;
        } while (attempts < maxAttempts);

        const minProjectOffset = getProjectDimensionOffsetForEdge(
            dimensionEdgeExtents,
            'right',
            baseOffset,
            scaleFactor,
            initialScale
        );
        offset = Math.max(offset, minProjectOffset, DIMENSION_CONFIG.PROJECT_MIN_VERTICAL_OFFSET);
        labelX = maxX * scaleFactor + offsetX + offset;
        labelY = wallMidY * scaleFactor + offsetY;

        const textPadding = 4;
        const originX = (clipBoundsModel?.maxX ?? startX) * scaleFactor + offsetX;
        const yStart = startY * scaleFactor + offsetY;
        const yEnd = endY * scaleFactor + offsetY;

        context.strokeStyle = color;
        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, originX, yStart, labelX, yStart, rectScreen);
        canvasDrawExtensionDashed(context, originX, yEnd, labelX, yEnd, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        strokeVerticalDimLineAtX(context, labelX, yStart, yEnd, labelY, textWidth, textPadding);
        canvasVerticalDimArrows(context, labelX, yStart, yEnd, color, tickPx);

        context.save();
        context.translate(labelX - 4, labelY);
        context.rotate(-Math.PI / 2);
        const tw = textWidth;
        const th = fontSize * 0.75;
        context.fillStyle = getPlanLabelBackground();
        context.fillRect(-tw / 2 - 3, -th / 2 - 2, tw + 6, th + 4);
        context.fillStyle = color;
        context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 0, 0);
        context.restore();

        placedLabels.push({
            x: labelX - 10,
            y: labelY - textWidth / 2 - 4,
            width: 20,
            height: textWidth + 8,
            side: side,
            text: text,
            angle: angle,
            type: 'project'
        });
    }

    context.restore();
}

/**
 * Draw dashed extensions (clip outside model interior). One stroke per segment so dash phase
 * matches pdfVectorWallPlan (each doc.line() is independent).
 */
function canvasDrawExtensionDashed(context, x1, y1, x2, y2, rectScreen) {
    const segs = extensionSegmentsOutsideModelRect(x1, y1, x2, y2, rectScreen);
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        context.lineDashOffset = 0;
        context.beginPath();
        context.moveTo(s.x1, s.y1);
        context.lineTo(s.x2, s.y2);
        context.stroke();
    }
}

function strokeHorizontalDimLineAtY(context, y, wallStartX, wallEndX, labelCenterX, textWidth, textPadding) {
    const lo = Math.min(wallStartX, wallEndX);
    const hi = Math.max(wallStartX, wallEndX);
    const textLeft = labelCenterX - textWidth / 2 - textPadding;
    const textRight = labelCenterX + textWidth / 2 + textPadding;
    const gapLo = Math.max(lo, textLeft);
    const gapHi = Math.min(hi, textRight);
    let drew = false;
    context.beginPath();
    if (gapLo > lo + 0.5) {
        context.moveTo(lo, y);
        context.lineTo(gapLo, y);
        drew = true;
    }
    if (hi > gapHi + 0.5) {
        context.moveTo(gapHi, y);
        context.lineTo(hi, y);
        drew = true;
    }
    if (!drew) {
        context.moveTo(lo, y);
        context.lineTo(hi, y);
    }
    context.stroke();
}

function strokeVerticalDimLineAtX(context, x, wallStartY, wallEndY, labelCenterY, textWidth, textPadding) {
    const lo = Math.min(wallStartY, wallEndY);
    const hi = Math.max(wallStartY, wallEndY);
    const textTop = labelCenterY - textWidth / 2 - textPadding;
    const textBottom = labelCenterY + textWidth / 2 + textPadding;
    const gapLo = Math.max(lo, textTop);
    const gapHi = Math.min(hi, textBottom);
    let drew = false;
    context.beginPath();
    if (gapLo > lo + 0.5) {
        context.moveTo(x, lo);
        context.lineTo(x, gapLo);
        drew = true;
    }
    if (hi > gapHi + 0.5) {
        context.moveTo(x, gapHi);
        context.lineTo(x, hi);
        drew = true;
    }
    if (!drew) {
        context.moveTo(x, lo);
        context.lineTo(x, hi);
    }
    context.stroke();
}

/**
 * Orthogonal plan dimensions (ceiling/floor canvas): same geometry as wall plan —
 * clipped dashed extensions, solid dimension line with text gap, tick marks at ends.
 * `labelX` / `labelY` are canvas pixels; `clipModelBounds` is model-space AABB (same as drawDimensions).
 */
export function drawOrthoPlanDimensionGeometryLikeWall(
    context,
    { startX, startY, endX, endY, isHorizontal, labelX, labelY, textWidth, color },
    scaleFactor,
    offsetX,
    offsetY,
    clipModelBounds
) {
    const clip = clipModelBounds;
    const rectScreen = modelBoundsToScreenRect(clip, scaleFactor, offsetX, offsetY);
    const extDash = getCanvasExtensionDashPattern(scaleFactor);
    const extLineW = getCanvasExtensionLineWidth();
    const dimLineW = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
    const tickPx = 4;
    const textPadding = 2;

    const strokeColor = adjustPlanStrokeColor(color);

    // Attach extensions at the building/room edge on the label's side (wall ends /
    // corners), not at centerX/centerY which visually stops in the middle of the wall.
    let attachX = startX;
    let attachY = startY;
    let spanStartX = startX;
    let spanEndX = endX;
    let spanStartY = startY;
    let spanEndY = endY;
    if (clip) {
        const edgeTol = 250;
        if (isHorizontal) {
            const midY = ((clip.minY + clip.maxY) / 2) * scaleFactor + offsetY;
            attachY = labelY < midY ? clip.minY : clip.maxY;
            const lo = Math.min(startX, endX);
            const hi = Math.max(startX, endX);
            if (lo - clip.minX <= edgeTol && clip.maxX - hi <= edgeTol) {
                spanStartX = startX <= endX ? clip.minX : clip.maxX;
                spanEndX = startX <= endX ? clip.maxX : clip.minX;
            }
        } else {
            const midX = ((clip.minX + clip.maxX) / 2) * scaleFactor + offsetX;
            attachX = labelX < midX ? clip.minX : clip.maxX;
            const lo = Math.min(startY, endY);
            const hi = Math.max(startY, endY);
            if (lo - clip.minY <= edgeTol && clip.maxY - hi <= edgeTol) {
                spanStartY = startY <= endY ? clip.minY : clip.maxY;
                spanEndY = startY <= endY ? clip.maxY : clip.minY;
            }
        }
    }

    context.save();
    context.strokeStyle = strokeColor;

    if (isHorizontal) {
        const startXScreen = spanStartX * scaleFactor + offsetX;
        const endXScreen = spanEndX * scaleFactor + offsetX;
        const attachYScreen = attachY * scaleFactor + offsetY;

        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, startXScreen, attachYScreen, startXScreen, labelY, rectScreen);
        canvasDrawExtensionDashed(context, endXScreen, attachYScreen, endXScreen, labelY, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        strokeHorizontalDimLineAtY(context, labelY, startXScreen, endXScreen, labelX, textWidth, textPadding);
        canvasHorizontalDimArrows(context, startXScreen, endXScreen, labelY, strokeColor, tickPx);
    } else {
        const startYScreen = spanStartY * scaleFactor + offsetY;
        const endYScreen = spanEndY * scaleFactor + offsetY;
        const attachXScreen = attachX * scaleFactor + offsetX;

        context.lineWidth = extLineW;
        context.setLineDash(extDash);
        canvasDrawExtensionDashed(context, attachXScreen, startYScreen, labelX, startYScreen, rectScreen);
        canvasDrawExtensionDashed(context, attachXScreen, endYScreen, labelX, endYScreen, rectScreen);

        context.setLineDash([]);
        context.lineWidth = dimLineW;
        strokeVerticalDimLineAtX(context, labelX, startYScreen, endYScreen, labelY, textWidth, textPadding);
        canvasVerticalDimArrows(context, labelX, startYScreen, endYScreen, strokeColor, tickPx);
    }
    context.restore();
}

// Draw wall dimensions
export function drawDimensions(
    context,
    startX,
    startY,
    endX,
    endY,
    scaleFactor,
    offsetX,
    offsetY,
    color = 'blue',
    modelBounds = null,
    placedLabels = [],
    allLabels = [],
    collectOnly = false,
    initialScale = 1,
    wallLinesMap = null,
    dimensionValuesSeen = null,
    dimensionLanes = null,
    rooms = [],
    dimensionEdgeExtents = null
) {
    const length = Math.sqrt(
        Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    );

    const dxLen = endX - startX;
    const dyLen = endY - startY;
    const angleLen = Math.atan2(dyLen, dxLen) * (180 / Math.PI);
    const isHorizLen = Math.abs(angleLen) < 45 || Math.abs(angleLen) > 135;

    // Per-axis value dedup (H and V may share the same mm)
    if (dimensionValuesSeen && typeof length === 'number') {
        const dedupKey = planCeilingValueDedupKey(length, isHorizLen);
        if (dedupKey && dimensionValuesSeen.has(dedupKey)) return;
        if (dedupKey) dimensionValuesSeen.add(dedupKey);
    }

    let midX = 0;
    let midY = 0;

    // Calculate wall midpoint
    const wallMidX = (startX + endX) / 2;
    const wallMidY = (startY + endY) / 2;
    
    context.save();
    context.fillStyle = color;
    const standardWallFontSize = computeWallPlanDimensionFontSize(scaleFactor, initialScale);
    let fontSize = standardWallFontSize;
    if (modelBounds) {
        const projectSize = Math.max(
            (modelBounds.maxX - modelBounds.minX) || 1,
            (modelBounds.maxY - modelBounds.minY) || 1
        );
        if (length < projectSize * DIMENSION_CONFIG.SMALL_DIMENSION_THRESHOLD) {
            fontSize = applyNearWallFontSize(standardWallFontSize);
        }
    }
    context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
    const text = formatDimMmCanvas(length);
    const textWidth = context.measureText(text).width;
    const dx = endX - startX;
    const dy = endY - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // If modelBounds is provided, use external dimensioning
    if (modelBounds) {
        const { minX, maxX, minY, maxY } = modelBounds;
        const clipBounds = modelBounds.clip || modelBounds;
        const rectScreen = modelBoundsToScreenRect(clipBounds, scaleFactor, offsetX, offsetY);
        const extDash = getCanvasExtensionDashPattern(scaleFactor);
        const dimLineW = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
        const extLineW = getCanvasExtensionLineWidth();
        const tickPx = 4;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        // Any non-axis-aligned wall gets a parallel (oblique) dimension — including
        // shallow slants that used to be forced onto H/V rows (wrong span + unclear labels).
        const useObliqueWallDim =
            adx > WALL_AXIS_ALIGN_TOL_MM && ady > WALL_AXIS_ALIGN_TOL_MM;
        
        // Create unique key for this dimension to remember placement decision
        const dimensionKey = `${startX.toFixed(2)}_${startY.toFixed(2)}_${endX.toFixed(2)}_${endY.toFixed(2)}_wall`;
        
        // Check if we have a stored placement decision for this dimension
        const storedPlacement = dimensionPlacementMemory.get(dimensionKey);
        const lockedSide = storedPlacement ? storedPlacement.side : null;
        
        // Exterior-edge walls share the outer dimension frame. Interior walls (including
        // long partitions to a slant) sit beside their own wall so each length is readable
        // and clearly tied to that segment — never dumped onto one exterior column.
        const projectWidth = (maxX - minX) || 1;
        const projectHeight = (maxY - minY) || 1;
        const projectSize = Math.max(projectWidth, projectHeight);
        const wallData = findWallDataForSegment(wallLinesMap, startX, startY, endX, endY);
        const faceSpan = expandDimensionSegmentToWallFaces(
            startX,
            startY,
            endX,
            endY,
            wallData,
            modelBounds,
            wallLinesMap
        );
        const dimStartX = faceSpan.startX;
        const dimStartY = faceSpan.startY;
        const dimEndX = faceSpan.endX;
        const dimEndY = faceSpan.endY;
        const segmentWall = wallData?.wall ?? null;
        const hostForNear = segmentWall || wallData?.wall || null;
        const isHorizSegment = Math.abs(angle) < 45 || Math.abs(angle) > 135;
        const wallThickness = Number(segmentWall?.thickness) || 100;
        // Allow for centerline vs outer-face inset (about half thickness)
        const exteriorEdgeTol = Math.max(
            DIMENSION_CONFIG.SPAN_ENDPOINT_TOUCH_TOL_MM,
            wallThickness * 0.75
        );
        const midSegX = (startX + endX) / 2;
        const midSegY = (startY + endY) / 2;
        const onExteriorEdge = isHorizSegment
            ? (
                Math.min(Math.abs(midSegY - minY), Math.abs(midSegY - maxY)) <= exteriorEdgeTol
            )
            : (
                Math.min(Math.abs(midSegX - minX), Math.abs(midSegX - maxX)) <= exteriorEdgeTol
            );

        let isNearWallDimension = !onExteriorEdge && !!hostForNear;
        let wallLaneSpacing = isNearWallDimension
            ? DIMENSION_CONFIG.LANE_SPACING
            : DIMENSION_CONFIG.WALL_EXTERNAL_LANE_SPACING;
        const wallDimRotatedVertical =
            !useObliqueWallDim &&
            !(Math.abs(angle) < 45 || Math.abs(angle) > 135);
        let baseOffset = isNearWallDimension
            ? (hostForNear
                ? computeNearWallLabelOffsetPx(
                      hostForNear,
                      scaleFactor,
                      fontSize,
                      textWidth,
                      wallDimRotatedVertical
                  )
                : DIMENSION_CONFIG.BASE_OFFSET_NEAR_WALL)
            : DIMENSION_CONFIG.BASE_OFFSET;

        const Ps = { x: dimStartX * scaleFactor + offsetX, y: dimStartY * scaleFactor + offsetY };
        const Pe = { x: dimEndX * scaleFactor + offsetX, y: dimEndY * scaleFactor + offsetY };
        const wvx = Pe.x - Ps.x;
        const wvy = Pe.y - Ps.y;
        const pdfLenOblique = Math.hypot(wvx, wvy);

        if (useObliqueWallDim && pdfLenOblique >= 1e-6) {
            const ux = wvx / pdfLenOblique;
            const uy = wvy / pdfLenOblique;
            const nx = -uy;
            const ny = ux;

            const obliqueBounds = (lx, ly, tw) => {
                const rad = Math.atan2(uy, ux);
                const c = Math.abs(Math.cos(rad));
                const s = Math.abs(Math.sin(rad));
                const fh = fontSize * 0.45;
                const bw = tw * c + fh * s + 4;
                const bh = tw * s + fh * c + 4;
                return { x: lx - bw / 2, y: ly - bh / 2, width: bw, height: bh };
            };

            let labelX;
            let labelY;
            let placement;
            let obliqueBase = 0;

            if (isNearWallDimension) {
                const wallForNear = hostForNear;
                const near = tryPlaceNearWallLabel({
                    wall: wallForNear,
                    anchorXModel: wallMidX,
                    anchorYModel: wallMidY,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    fontSize,
                    calculateBounds: (lx, ly, tw) => obliqueBounds(lx, ly, tw),
                    textWidth,
                    placedLabels,
                    wallLinesMap,
                    modelBounds,
                    rooms,
                    dimensionLanes,
                    initialScale,
                    rotatedVerticalText: false
                });
                if (near) {
                    labelX = near.labelX;
                    labelY = near.labelY;
                    placement = { side: 'side1' };
                } else if (DIMENSION_CONFIG.HIDE_CROWDED_NEAR_WALL_DIMS) {
                    context.restore();
                    return;
                } else {
                    isNearWallDimension = false;
                    wallLaneSpacing = DIMENSION_CONFIG.WALL_EXTERNAL_LANE_SPACING;
                    baseOffset = DIMENSION_CONFIG.BASE_OFFSET;
                }
            }
            if (!placement) {
                obliqueBase = consumeDimensionLane(
                    dimensionLanes,
                    false,
                    lockedSide || 'side1',
                    baseOffset,
                    wallLaneSpacing
                );
                placement = smartPlacement({
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
                    baseOffset: obliqueBase,
                    offsetIncrement: DIMENSION_CONFIG.OFFSET_INCREMENT,
                    maxAttempts: DIMENSION_CONFIG.MAX_ATTEMPTS,
                    preferredSide: 'side1',
                    lockedSide: null
                });
                if (!placement) {
                    context.restore();
                    return;
                }
                labelX = placement.labelX;
                labelY = placement.labelY;
                if (wallLinesMap) {
                    let labelBounds = obliqueBounds(labelX, labelY, textWidth);
                    let hasWallOverlap = doesLabelOverlapAnyWallLine(
                        labelBounds,
                        wallLinesMap,
                        scaleFactor,
                        offsetX,
                        offsetY
                    );
                    let wallCheckAttempts = 0;
                    const maxWallCheckAttempts = 10;
                    const wallAvoidanceIncrement = 2 * scaleFactor;
                    const sign = placement.side === 'side1' ? 1 : -1;
                    while (hasWallOverlap && wallCheckAttempts < maxWallCheckAttempts) {
                        labelX += sign * nx * wallAvoidanceIncrement;
                        labelY += sign * ny * wallAvoidanceIncrement;
                        labelBounds = obliqueBounds(labelX, labelY, textWidth);
                        hasWallOverlap = doesLabelOverlapAnyWallLine(
                            labelBounds,
                            wallLinesMap,
                            scaleFactor,
                            offsetX,
                            offsetY
                        );
                        wallCheckAttempts++;
                    }
                }
            }

            const pmx = (Ps.x + Pe.x) / 2;
            const pmy = (Ps.y + Pe.y) / 2;
            const dOff = (labelX - pmx) * nx + (labelY - pmy) * ny;
            const Ps_ = { x: Ps.x + nx * dOff, y: Ps.y + ny * dOff };
            const Pe_ = { x: Pe.x + nx * dOff, y: Pe.y + ny * dOff };

            const obliquePreviewBounds = obliqueBounds(labelX, labelY, textWidth);
            if (
                isNearWallDimension &&
                !isLabelAcceptableForWallDimension(
                    obliquePreviewBounds,
                    placedLabels,
                    wallLinesMap,
                    modelBounds,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    true,
                    initialScale,
                    labelX,
                    labelY,
                    textWidth
                )
            ) {
                context.restore();
                return;
            }

            if (!isNearWallDimension && dimensionEdgeExtents) {
                const obliqueEdge = placement.side === 'side1' ? 'left' : 'right';
                recordDimensionEdgeExtent(dimensionEdgeExtents, obliqueEdge, obliqueBase);
            }

            context.strokeStyle = color;
            context.lineWidth = extLineW;
            context.setLineDash(extDash);
            canvasDrawExtensionDashed(context, Ps.x, Ps.y, Ps_.x, Ps_.y, rectScreen);
            canvasDrawExtensionDashed(context, Pe.x, Pe.y, Pe_.x, Pe_.y, rectScreen);

            const textPadding = 2;
            const halfText = textWidth / 2 + textPadding;
            const midS = pdfLenOblique / 2;
            const leftS = midS - halfText;
            const rightS = midS + halfText;

            context.setLineDash([]);
            context.lineWidth = dimLineW;
            context.strokeStyle = color;
            context.beginPath();
            if (rightS <= leftS) {
                context.moveTo(Ps_.x, Ps_.y);
                context.lineTo(Pe_.x, Pe_.y);
            } else {
                const drawSeg = (s0, s1) => {
                    if (s1 <= s0 + 1e-4) return;
                    context.moveTo(Ps_.x + ux * s0, Ps_.y + uy * s0);
                    context.lineTo(Ps_.x + ux * s1, Ps_.y + uy * s1);
                };
                drawSeg(0, Math.max(0, leftS));
                drawSeg(Math.min(pdfLenOblique, rightS), pdfLenOblique);
            }
            context.stroke();

            canvasObliqueDimArrows(context, Ps_.x, Ps_.y, Pe_.x, Pe_.y, ux, uy, color, tickPx);
            if (rightS > leftS && leftS > 0) {
                canvasObliqueTicks(context, Ps_.x + ux * leftS, Ps_.y + uy * leftS, ux, uy, color, tickPx);
            }
            if (rightS > leftS && rightS < pdfLenOblique) {
                canvasObliqueTicks(context, Ps_.x + ux * rightS, Ps_.y + uy * rightS, ux, uy, color, tickPx);
            }

            const textAngleDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
            if (!storedPlacement) {
                dimensionPlacementMemory.set(dimensionKey, { side: placement.side });
            }
            const lb = obliquePreviewBounds;
            const obliqueLabel = {
                x: lb.x,
                y: lb.y,
                width: lb.width,
                height: lb.height,
                side: placement.side === 'side1' ? 'oblique1' : 'oblique2',
                text: text,
                angle: angle,
                type: 'wall',
                obliqueAngle: textAngleDeg
            };
            placedLabels.push(obliqueLabel);
            if (collectOnly) {
                allLabels.push({ ...obliqueLabel });
            }
        } else if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
            let labelX;
            let labelY;
            let side;
            let nearPlaced = false;

            if (isNearWallDimension) {
                const wallForNear = hostForNear;
                const spanLo = Math.min(startX, endX);
                const spanHi = Math.max(startX, endX);
                const trialOffset = Math.max(baseOffset, DIMENSION_CONFIG.MIN_VERTICAL_OFFSET);
                const side1Bounds = calculateHorizontalLabelBounds(
                    wallMidX * scaleFactor + offsetX,
                    minY * scaleFactor + offsetY - trialOffset,
                    textWidth,
                    2,
                    8
                );
                const side2Bounds = calculateHorizontalLabelBounds(
                    wallMidX * scaleFactor + offsetX,
                    maxY * scaleFactor + offsetY + trialOffset,
                    textWidth,
                    2,
                    8
                );
                const near = placeNearWallWallDimension({
                    wallForNear,
                    wallMidX,
                    wallMidY,
                    isHorizontal: true,
                    modelBounds,
                    dimensionLanes,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    fontSize,
                    textWidth,
                    placedLabels,
                    wallLinesMap,
                    rooms,
                    initialScale,
                    rotatedVerticalText: false,
                    calculateBounds: (lx, ly, tw) =>
                        calculateNearWallHorizontalDimBounds(lx, ly, tw, fontSize),
                    side1Bounds,
                    side2Bounds,
                    baseOffset,
                    wallLaneSpacing,
                    spanLo,
                    spanHi
                });
                if (near) {
                    labelX = near.labelX;
                    labelY = near.labelY;
                    side = near.side;
                    nearPlaced = true;
                    if (!storedPlacement) {
                        dimensionPlacementMemory.set(dimensionKey, {
                            side: near.side === 'bottom' || near.side === 'right' ? 'side2' : 'side1'
                        });
                    }
                } else if (DIMENSION_CONFIG.HIDE_CROWDED_NEAR_WALL_DIMS) {
                    context.restore();
                    return;
                } else {
                    isNearWallDimension = false;
                    wallLaneSpacing = DIMENSION_CONFIG.WALL_EXTERNAL_LANE_SPACING;
                    baseOffset = DIMENSION_CONFIG.BASE_OFFSET;
                }
            }
            if (!nearPlaced) {
                const spanLo = Math.min(dimStartX, dimEndX);
                const spanHi = Math.max(dimStartX, dimEndX);
                const spanMidX = (dimStartX + dimEndX) / 2;
                const trialOffset = Math.max(baseOffset, DIMENSION_CONFIG.MIN_VERTICAL_OFFSET);
                const side1Bounds = calculateHorizontalLabelBounds(
                    spanMidX * scaleFactor + offsetX,
                    minY * scaleFactor + offsetY - trialOffset,
                    textWidth,
                    2,
                    8
                );
                const side2Bounds = calculateHorizontalLabelBounds(
                    spanMidX * scaleFactor + offsetX,
                    maxY * scaleFactor + offsetY + trialOffset,
                    textWidth,
                    2,
                    8
                );
                const placementSide = resolveWallExteriorPlacementSide({
                    isHorizontal: true,
                    wallMidX,
                    wallMidY,
                    modelBounds,
                    dimensionLanes,
                    side1Bounds,
                    side2Bounds,
                    placedLabels
                });
                const rowOffset = consumeDimensionLane(
                    dimensionLanes,
                    true,
                    placementSide,
                    baseOffset,
                    wallLaneSpacing,
                    spanLo,
                    spanHi
                );
                const placed = placeExteriorWallDimensionAvoidingLabels({
                    isHorizontal: true,
                    side: placementSide,
                    rowOffsetPx: rowOffset,
                    spanLo,
                    spanHi,
                    anchorX: spanMidX,
                    anchorY: wallMidY,
                    bounds: modelBounds,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    textWidth,
                    placedLabels,
                    // Keep chained exterior top/bottom rows level; allow bump when this is a fallback
                    lockRow: onExteriorEdge
                });
                if (!placed) {
                    context.restore();
                    return;
                }
                labelX = placed.labelX;
                labelY = placed.labelY;
                const hEdge = getDimensionEdge(true, placementSide);
                if (!storedPlacement) {
                    dimensionPlacementMemory.set(dimensionKey, { side: placementSide });
                }
                side = placementSide === 'side1' ? 'top' : 'bottom';
                if (dimensionEdgeExtents) {
                    const hOutPx = measureExteriorLabelOutsetPx(
                        hEdge,
                        labelX,
                        labelY,
                        calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8),
                        modelBounds,
                        scaleFactor,
                        offsetX,
                        offsetY
                    );
                    recordDimensionEdgeExtent(
                        dimensionEdgeExtents,
                        hEdge,
                        Math.max(placed.rowOffset, hOutPx)
                    );
                }
            }

            if (onExteriorEdge) {
                labelX = ((dimStartX + dimEndX) / 2) * scaleFactor + offsetX;
            }

            const hPreviewBounds = isNearWallDimension
                ? calculateNearWallHorizontalDimBounds(labelX, labelY, textWidth, fontSize)
                : calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8);
            if (
                isNearWallDimension &&
                !isLabelAcceptableForWallDimension(
                    hPreviewBounds,
                    placedLabels,
                    wallLinesMap,
                    modelBounds,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    true,
                    initialScale,
                    labelX,
                    labelY,
                    textWidth
                )
            ) {
                context.restore();
                return;
            }

            const textPadding = 2;
            const startXScreen = dimStartX * scaleFactor + offsetX;
            const endXScreen = dimEndX * scaleFactor + offsetX;
            const clipMidYScreen = ((clipBounds.minY + clipBounds.maxY) / 2) * scaleFactor + offsetY;
            const originY = (labelY < clipMidYScreen ? clipBounds.minY : clipBounds.maxY) * scaleFactor + offsetY;

            context.strokeStyle = color;
            context.lineWidth = extLineW;
            context.setLineDash(extDash);
            canvasDrawExtensionDashed(context, startXScreen, originY, startXScreen, labelY, rectScreen);
            canvasDrawExtensionDashed(context, endXScreen, originY, endXScreen, labelY, rectScreen);

            context.setLineDash([]);
            context.lineWidth = dimLineW;
            strokeHorizontalDimLineAtY(context, labelY, startXScreen, endXScreen, labelX, textWidth, textPadding);
            canvasHorizontalDimArrows(context, startXScreen, endXScreen, labelY, color, tickPx);

            if (DIMENSION_CONFIG.DEBUG_DIMENSION_PLACEMENT) {
                reportDimensionOutsideSpan({
                    text,
                    axis: 'horizontal',
                    isNearWallDimension,
                    side,
                    labelCenterPx: labelX,
                    spanLoPx: Math.min(startX, endX) * scaleFactor + offsetX,
                    spanHiPx: Math.max(startX, endX) * scaleFactor + offsetX,
                    textExtentPx: textWidth
                });
            }
            const hBounds = isNearWallDimension
                ? calculateNearWallHorizontalDimBounds(labelX, labelY, textWidth, fontSize)
                : calculateHorizontalLabelBounds(labelX, labelY, textWidth, 2, 8);
            const hLabel = {
                x: hBounds.x,
                y: hBounds.y,
                width: hBounds.width,
                height: hBounds.height,
                cx: labelX,
                cy: labelY,
                side: side,
                text: text,
                angle: angle,
                type: 'wall'
            };
            if (DIMENSION_CONFIG.DEBUG_DIMENSION_PLACEMENT) {
                reportDimensionOverlap({
                    text,
                    axis: 'horizontal',
                    isNearWallDimension,
                    side,
                    bounds: hBounds,
                    placedLabels
                });
            }
            placedLabels.push(hLabel);
            if (collectOnly && !overlapsDimensionText(hBounds, allLabels, DIMENSION_CONFIG.LABEL_MIN_SEPARATION)) {
                allLabels.push({ ...hLabel });
            }
        } else {
            let labelX;
            let labelY;
            let side;
            let nearPlaced = false;

            if (isNearWallDimension) {
                const wallForNear = hostForNear;
                const spanLo = Math.min(startY, endY);
                const spanHi = Math.max(startY, endY);
                const minVerticalOffset = DIMENSION_CONFIG.MIN_VERTICAL_OFFSET;
                const trialOffset = Math.max(baseOffset, minVerticalOffset);
                const side1Bounds = calculateVerticalLabelBounds(
                    minX * scaleFactor + offsetX - trialOffset,
                    wallMidY * scaleFactor + offsetY,
                    textWidth,
                    2,
                    8
                );
                const side2Bounds = calculateVerticalLabelBounds(
                    maxX * scaleFactor + offsetX + trialOffset,
                    wallMidY * scaleFactor + offsetY,
                    textWidth,
                    2,
                    8
                );
                const near = placeNearWallWallDimension({
                    wallForNear,
                    wallMidX,
                    wallMidY,
                    isHorizontal: false,
                    modelBounds,
                    dimensionLanes,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    fontSize,
                    textWidth,
                    placedLabels,
                    wallLinesMap,
                    rooms,
                    initialScale,
                    rotatedVerticalText: true,
                    calculateBounds: (lx, ly, tw) =>
                        calculateRotatedVerticalDimBounds(lx, ly, tw, fontSize),
                    side1Bounds,
                    side2Bounds,
                    baseOffset,
                    wallLaneSpacing,
                    spanLo,
                    spanHi
                });
                if (near) {
                    labelX = near.labelX;
                    labelY = near.labelY;
                    side = near.side;
                    nearPlaced = true;
                    if (!storedPlacement) {
                        dimensionPlacementMemory.set(dimensionKey, {
                            side: near.side === 'bottom' || near.side === 'right' ? 'side2' : 'side1'
                        });
                    }
                } else if (DIMENSION_CONFIG.HIDE_CROWDED_NEAR_WALL_DIMS) {
                    context.restore();
                    return;
                } else {
                    isNearWallDimension = false;
                    wallLaneSpacing = DIMENSION_CONFIG.WALL_EXTERNAL_LANE_SPACING;
                    baseOffset = DIMENSION_CONFIG.BASE_OFFSET;
                }
            }
            if (!nearPlaced) {
                const spanLo = Math.min(dimStartY, dimEndY);
                const spanHi = Math.max(dimStartY, dimEndY);
                const spanMidY = (dimStartY + dimEndY) / 2;
                const minVerticalOffset = DIMENSION_CONFIG.MIN_VERTICAL_OFFSET;
                const trialOffset = Math.max(baseOffset, minVerticalOffset);
                const side1Bounds = calculateVerticalLabelBounds(
                    minX * scaleFactor + offsetX - trialOffset,
                    spanMidY * scaleFactor + offsetY,
                    textWidth,
                    2,
                    8
                );
                const side2Bounds = calculateVerticalLabelBounds(
                    maxX * scaleFactor + offsetX + trialOffset,
                    spanMidY * scaleFactor + offsetY,
                    textWidth,
                    2,
                    8
                );
                const placementSide = resolveWallExteriorPlacementSide({
                    isHorizontal: false,
                    wallMidX,
                    wallMidY,
                    modelBounds,
                    dimensionLanes,
                    side1Bounds,
                    side2Bounds,
                    placedLabels
                });
                const rowOffset = consumeDimensionLane(
                    dimensionLanes,
                    false,
                    placementSide,
                    baseOffset,
                    wallLaneSpacing,
                    spanLo,
                    spanHi
                );
                const vEdge = getDimensionEdge(false, placementSide);
                // Only lock one shared column for true exterior-edge walls. Interior
                // fallbacks must be free to stack outward so labels stay readable.
                const fixedColumnX = onExteriorEdge
                    ? (dimensionLanes?._wallExteriorLabelX?.[vEdge] ?? null)
                    : null;
                const placed = placeExteriorWallDimensionAvoidingLabels({
                    isHorizontal: false,
                    side: placementSide,
                    rowOffsetPx: rowOffset,
                    spanLo,
                    spanHi,
                    anchorX: wallMidX,
                    anchorY: spanMidY,
                    bounds: modelBounds,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    textWidth,
                    placedLabels,
                    fixedLabelX: fixedColumnX,
                    fontSize,
                    lockRow: onExteriorEdge
                });
                if (!placed) {
                    context.restore();
                    return;
                }
                labelX = placed.labelX;
                labelY = placed.labelY;
                if (dimensionLanes && onExteriorEdge) {
                    if (!dimensionLanes._wallExteriorLabelX) {
                        dimensionLanes._wallExteriorLabelX = {};
                    }
                    if (fixedColumnX == null) {
                        dimensionLanes._wallExteriorLabelX[vEdge] = labelX;
                    }
                }
                if (!storedPlacement) {
                    dimensionPlacementMemory.set(dimensionKey, { side: placementSide });
                }
                side = placementSide === 'side1' ? 'left' : 'right';
                if (dimensionEdgeExtents) {
                    const vOutPx = measureExteriorLabelOutsetPx(
                        vEdge,
                        labelX,
                        labelY,
                        exteriorVerticalLabelBounds(labelX, labelY, textWidth, fontSize, 2, 8),
                        modelBounds,
                        scaleFactor,
                        offsetX,
                        offsetY
                    );
                    recordDimensionEdgeExtent(
                        dimensionEdgeExtents,
                        vEdge,
                        Math.max(placed.rowOffset, vOutPx)
                    );
                }
            }

            labelY = ((dimStartY + dimEndY) / 2) * scaleFactor + offsetY;

            const vPreviewBounds = isNearWallDimension
                ? calculateRotatedVerticalDimBounds(labelX, labelY, textWidth, fontSize)
                : exteriorVerticalLabelBounds(labelX, labelY, textWidth, fontSize, 2, 8);
            if (
                isNearWallDimension &&
                !isLabelAcceptableForWallDimension(
                    vPreviewBounds,
                    placedLabels,
                    wallLinesMap,
                    modelBounds,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    true,
                    initialScale,
                    labelX,
                    labelY,
                    textWidth
                )
            ) {
                context.restore();
                return;
            }

            const textPadding = 2;
            const startYScreen = dimStartY * scaleFactor + offsetY;
            const endYScreen = dimEndY * scaleFactor + offsetY;
            const clipMidXScreen = ((clipBounds.minX + clipBounds.maxX) / 2) * scaleFactor + offsetX;
            const originX = (labelX < clipMidXScreen ? clipBounds.minX : clipBounds.maxX) * scaleFactor + offsetX;

            context.strokeStyle = color;
            context.lineWidth = extLineW;
            context.setLineDash(extDash);
            canvasDrawExtensionDashed(context, originX, startYScreen, labelX, startYScreen, rectScreen);
            canvasDrawExtensionDashed(context, originX, endYScreen, labelX, endYScreen, rectScreen);

            context.setLineDash([]);
            context.lineWidth = dimLineW;
            strokeVerticalDimLineAtX(context, labelX, startYScreen, endYScreen, labelY, textWidth, textPadding);
            canvasVerticalDimArrows(context, labelX, startYScreen, endYScreen, color, tickPx);

            if (DIMENSION_CONFIG.DEBUG_DIMENSION_PLACEMENT) {
                reportDimensionOutsideSpan({
                    text,
                    axis: 'vertical',
                    isNearWallDimension,
                    side,
                    labelCenterPx: labelY,
                    spanLoPx: Math.min(startY, endY) * scaleFactor + offsetY,
                    spanHiPx: Math.max(startY, endY) * scaleFactor + offsetY,
                    textExtentPx: textWidth
                });
            }
            const vBounds = isNearWallDimension
                ? calculateRotatedVerticalDimBounds(labelX, labelY, textWidth, fontSize)
                : exteriorVerticalLabelBounds(labelX, labelY, textWidth, fontSize, 2, 8);
            const vLabel = {
                x: vBounds.x,
                y: vBounds.y,
                width: vBounds.width,
                height: vBounds.height,
                cx: labelX,
                cy: labelY,
                side: side,
                text: text,
                angle: angle,
                type: 'wall'
            };
            if (DIMENSION_CONFIG.DEBUG_DIMENSION_PLACEMENT) {
                reportDimensionOverlap({
                    text,
                    axis: 'vertical',
                    isNearWallDimension,
                    side,
                    bounds: vBounds,
                    placedLabels
                });
            }
            placedLabels.push(vLabel);
            if (collectOnly && !overlapsDimensionText(vBounds, allLabels, DIMENSION_CONFIG.LABEL_MIN_SEPARATION)) {
                allLabels.push({ ...vLabel });
            }
        }
    } else {
        // Original internal dimensioning (fallback)
        if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
            // Horizontal wall (original simple style)
            midX = ((startX + endX) / 2) * scaleFactor + offsetX;
            midY = ((startY + endY) / 2) * scaleFactor + offsetY - 15;
            context.fillStyle = color;
            context.fillText(text, midX - textWidth / 2, midY + 4);
        } else {
            // Vertical wall (original simple style)
            midX = ((startX + endX) / 2) * scaleFactor + offsetX + 15;
            midY = ((startY + endY) / 2) * scaleFactor + offsetY;
            context.translate(midX, midY);
            context.rotate(-Math.PI / 2);
            context.fillStyle = color;
            context.fillText(text, -textWidth / 2, 4);
            context.restore();
        }
    }
    context.restore();
}

function normalizeRoomPointModel(p) {
    if (p == null) return null;
    if (Array.isArray(p)) {
        const x = Number(p[0]);
        const y = Number(p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

/** Shoelace centroid and absolute area (model mm²). Used to weight “inner” side toward real rooms. */
export function getRoomPolygonCentroidAndArea(roomPoints) {
    const pts = (roomPoints || []).map(normalizeRoomPointModel).filter(Boolean);
    const n = pts.length;
    if (n < 3) return { centroid: null, area: 0 };
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        twiceArea += cross;
        cx += (pts[i].x + pts[j].x) * cross;
        cy += (pts[i].y + pts[j].y) * cross;
    }
    const absArea = Math.abs(twiceArea) / 2;
    if (absArea < 1e-6) return { centroid: null, area: 0 };
    cx /= 3 * twiceArea;
    cy /= 3 * twiceArea;
    return { centroid: { x: cx, y: cy }, area: absArea };
}

function pointToSegmentDistSq(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq < 1e-12) return apx * apx + apy * apy;
    let t = (apx * abx + apy * aby) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * abx;
    const qy = ay + t * aby;
    const dx = px - qx;
    const dy = py - qy;
    return dx * dx + dy * dy;
}

function roomPolygonTouchesWallMm(room, wall, tolMm) {
    const ax = wall.start_x;
    const ay = wall.start_y;
    const bx = wall.end_x;
    const by = wall.end_y;
    if (ax == null || ay == null || bx == null || by == null) return false;
    const tolSq = tolMm * tolMm;
    const pts = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
    for (let i = 0; i < pts.length; i++) {
        if (pointToSegmentDistSq(pts[i].x, pts[i].y, ax, ay, bx, by) <= tolSq) {
            return true;
        }
    }
    return false;
}

/** When vertices are offset from the wall polyline, room centroid may still lie near the segment. */
function roomCentroidNearWallSegmentMm(room, wall, maxPerpMm) {
    const ax = wall.start_x;
    const ay = wall.start_y;
    const bx = wall.end_x;
    const by = wall.end_y;
    if (ax == null || ay == null || bx == null || by == null) return false;
    let { centroid: c } = getRoomPolygonCentroidAndArea(room.room_points);
    if (!c) {
        const raw = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
        if (raw.length === 0) return false;
        c = {
            x: raw.reduce((s, p) => s + p.x, 0) / raw.length,
            y: raw.reduce((s, p) => s + p.y, 0) / raw.length,
        };
    }
    const maxSq = maxPerpMm * maxPerpMm;
    return pointToSegmentDistSq(c.x, c.y, ax, ay, bx, by) <= maxSq;
}

function normalizeRoomPolygonPoints(roomPoints) {
    return (roomPoints || []).map(normalizeRoomPointModel).filter(Boolean);
}

/**
 * Rooms associated with this wall (M2M, vertex proximity, or centroid strip), in model space.
 * @param {{ adjacencyToleranceMm?: number }} [options]
 */
export function getRoomsLinkedToWall(wall, rooms, options) {
    const adjacencyToleranceMm =
        options && Number.isFinite(options.adjacencyToleranceMm)
            ? options.adjacencyToleranceMm
            : 40;

    if (!wall || !Array.isArray(rooms) || rooms.length === 0) return [];

    const wallId = String(wall.id);
    const linkedIds = new Set();

    if (Array.isArray(wall.rooms)) {
        wall.rooms.forEach((r) => {
            if (r == null) return;
            linkedIds.add(String(typeof r === 'object' ? r.id : r));
        });
    }

    for (const room of rooms) {
        if (!room || room.id == null) continue;
        const rw = room.walls;
        if (!Array.isArray(rw)) continue;
        if (rw.some((w) => String(typeof w === 'object' && w !== null ? w.id : w) === wallId)) {
            linkedIds.add(String(room.id));
        }
    }

    if (linkedIds.size === 0) {
        for (const room of rooms) {
            if (!room || room.id == null) continue;
            if (roomPolygonTouchesWallMm(room, wall, adjacencyToleranceMm)) {
                linkedIds.add(String(room.id));
            }
        }
    }
    if (linkedIds.size === 0) {
        const stripMm = Math.min(450, Math.max(180, (wall.thickness || 200) * 2.2));
        for (const room of rooms) {
            if (!room || room.id == null) continue;
            if (roomCentroidNearWallSegmentMm(room, wall, stripMm)) {
                linkedIds.add(String(room.id));
            }
        }
    }

    return rooms.filter((room) => room && room.id != null && linkedIds.has(String(room.id)));
}

/**
 * Pick inner offset using point-in-polygon on **linked** room outlines (fixes L-shaped rooms where
 * the global centroid lies on the wrong side of one edge, e.g. wall 7611).
 * @returns {boolean|null} `shouldFlip` for calculateOffsetPoints, or null if ambiguous / no data.
 */
function resolveInteriorShouldFlipFromPolygonProbes(wall, rooms, midX, midY, normalX, normalY) {
    const linked = getRoomsLinkedToWall(wall, rooms);
    const polys = linked
        .map((r) => normalizeRoomPolygonPoints(r.room_points))
        .filter((p) => p.length >= 3);
    if (!polys.length) return null;

    const probeDist = Math.min(80, Math.max(35, ((wall.thickness || 100) + 10) / 2));
    const pointInsideAny = (x, y) => polys.some((poly) => isPointInPolygon({ x, y }, poly));

    const insideMinusN = pointInsideAny(
        midX - probeDist * normalX,
        midY - probeDist * normalY
    );
    const insidePlusN = pointInsideAny(
        midX + probeDist * normalX,
        midY + probeDist * normalY
    );

    if (insideMinusN && !insidePlusN) return false;
    if (!insideMinusN && insidePlusN) return true;
    return null;
}

/**
 * Samples { x, y, w } for walls tied to rooms.
 * - Always unions `wall.rooms` with `room.walls` (previously an incomplete `wall.rooms` skipped `room.walls`).
 * - If still none, treats rooms whose boundary lies within `adjacencyToleranceMm` of the wall segment as adjacent (PDF/canvas often lack M2M).
 * - Weights by area × proximity to wall mid so a small pocket beats a large far room on the other side.
 *
 * @param {{ adjacencyToleranceMm?: number }} [options]
 */
export function getWallOffsetScoringSamples(wall, rooms, options) {
    if (!wall || !Array.isArray(rooms) || rooms.length === 0) return [];

    const linked = getRoomsLinkedToWall(wall, rooms, options);

    const wmidX = ((wall.start_x || 0) + (wall.end_x || 0)) / 2;
    const wmidY = ((wall.start_y || 0) + (wall.end_y || 0)) / 2;

    const samples = [];
    for (const room of linked) {
        let { centroid, area } = getRoomPolygonCentroidAndArea(room.room_points);
        if (!centroid) {
            const raw = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
            if (raw.length > 0) {
                centroid = {
                    x: raw.reduce((s, p) => s + p.x, 0) / raw.length,
                    y: raw.reduce((s, p) => s + p.y, 0) / raw.length,
                };
                area = 1;
            }
        }
        if (centroid) {
            const baseA = area > 1e-6 ? area : 1;
            const dist = Math.hypot(centroid.x - wmidX, centroid.y - wmidY);
            const proximity = 1 / ((dist + 150) * (dist + 150));
            samples.push({ x: centroid.x, y: centroid.y, w: baseA * proximity });
        }
    }
    return samples;
}

/** Nearest room centroid to the wall segment (local “interior” hint when M2M data is missing). */
function getNearestRoomCentroidToWallSegment(wall, rooms) {
    if (!wall || !Array.isArray(rooms) || rooms.length === 0) return null;
    const ax = wall.start_x ?? 0;
    const ay = wall.start_y ?? 0;
    const bx = wall.end_x ?? 0;
    const by = wall.end_y ?? 0;
    let best = null;
    let bestD = Infinity;
    for (const room of rooms) {
        if (!room) continue;
        let { centroid: c } = getRoomPolygonCentroidAndArea(room.room_points);
        if (!c) {
            const raw = (room.room_points || []).map(normalizeRoomPointModel).filter(Boolean);
            if (raw.length === 0) continue;
            c = {
                x: raw.reduce((s, p) => s + p.x, 0) / raw.length,
                y: raw.reduce((s, p) => s + p.y, 0) / raw.length,
            };
        }
        const dSq = pointToSegmentDistSq(c.x, c.y, ax, ay, bx, by);
        if (dSq < bestD) {
            bestD = dSq;
            best = c;
        }
    }
    return best;
}

/**
 * Options for `calculateOffsetPoints`: prefer room-weighted scoring, else nearest-room reference,
 * else undefined (caller uses plain `center` in calculateOffsetPoints).
 *
 * Partitions / multi-room walls skip room-mass scoring so defining a second room cannot
 * flip the thickness side (which looks like the partition "moved").
 */
export function buildWallOffsetOptions(wall, rooms) {
    if (!wall) return undefined;
    const roomsList = Array.isArray(rooms) ? rooms : [];
    const base = { wall, rooms: roomsList };
    const isPartition = String(wall.application_type || '').toLowerCase() === 'partition';
    const linked = getRoomsLinkedToWall(wall, roomsList);
    const sharedOrPartition = isPartition || linked.length >= 2;

    if (sharedOrPartition) {
        // Stable reference: do not use area-weighted samples (they change when rooms are added).
        if (linked.length > 0) {
            // Prefer the lowest room id so the flip stays stable as more rooms link.
            const stable = [...linked].sort((a, b) => Number(a.id) - Number(b.id))[0];
            const c = getRoomPolygonCentroidAndArea(stable.room_points);
            if (c && c.centroid) {
                base.innerReferencePoint = c.centroid;
                return base;
            }
        }
        const nearest = getNearestRoomCentroidToWallSegment(wall, roomsList);
        if (nearest) {
            base.innerReferencePoint = nearest;
        }
        return base;
    }

    const scoringSamples = getWallOffsetScoringSamples(wall, roomsList);
    if (scoringSamples.length > 0) {
        base.scoringSamples = scoringSamples;
        return base;
    }
    const nearest = getNearestRoomCentroidToWallSegment(wall, roomsList);
    if (nearest) {
        base.innerReferencePoint = nearest;
    }
    return base;
}

/**
 * For shared walls, prefer the side indicated by connected 45_cut joints.
 * Returns `true|false` for shouldFlip, or null if no usable 45_cut context.
 */
export function resolve45CutForceShouldFlip(wall, intersections, allWalls) {
    if (!wall || !Array.isArray(intersections) || intersections.length === 0 || !Array.isArray(allWalls)) {
        return null;
    }
    let joinVecX = 0;
    let joinVecY = 0;
    let joinCount = 0;
    for (const inter of intersections) {
        const pairs = Array.isArray(inter.pairs)
            ? inter.pairs
            : [{ wall1: { id: inter.wall_1 }, wall2: { id: inter.wall_2 }, joining_method: inter.joining_method }];
        for (const pair of pairs) {
            if (!pair || pair.joining_method !== '45_cut') continue;
            const wall1Id = pair.wall1 && pair.wall1.id != null ? pair.wall1.id : inter.wall_1;
            const wall2Id = pair.wall2 && pair.wall2.id != null ? pair.wall2.id : inter.wall_2;
            if (wall1Id !== wall.id && wall2Id !== wall.id) continue;
            const otherWallId = wall1Id === wall.id ? wall2Id : wall1Id;
            const otherWall = allWalls.find((w) => w.id === otherWallId);
            if (!otherWall) continue;
            const wallMidX = (wall.start_x + wall.end_x) / 2;
            const wallMidY = (wall.start_y + wall.end_y) / 2;
            const otherMidX = (otherWall.start_x + otherWall.end_x) / 2;
            const otherMidY = (otherWall.start_y + otherWall.end_y) / 2;
            joinVecX += otherMidX - wallMidX;
            joinVecY += otherMidY - wallMidY;
            joinCount += 1;
        }
    }
    if (joinCount === 0) return null;
    const dx = wall.end_x - wall.start_x;
    const dy = wall.end_y - wall.start_y;
    const len = Math.hypot(dx, dy) || 1;
    const normalX = dy / len;
    const normalY = -dx / len;
    const joinDot = normalX * (joinVecX / joinCount) + normalY * (joinVecY / joinCount);
    return joinDot > 0;
}

/** Area-weighted centroid of rooms touching the wall; falls back to `center` if unknown. */
export function getWallOffsetFallbackReference(wall, rooms, center) {
    const samples = getWallOffsetScoringSamples(wall, rooms);
    if (!samples.length) {
        const n = getNearestRoomCentroidToWallSegment(wall, rooms);
        return n || center;
    }
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (const s of samples) {
        const w = s.w > 0 ? s.w : 1;
        sw += w;
        sx += s.x * w;
        sy += s.y * w;
    }
    if (sw <= 0) return center;
    return { x: sx / sw, y: sy / sw };
}

/**
 * @param {object} [offsetOptions]
 * @param {object} [offsetOptions.wall] — with `offsetOptions.rooms` enables polygon interior probe (overrides centroid heuristics when unambiguous)
 * @param {object[]} [offsetOptions.rooms]
 * @param {{ x: number, y: number, w?: number }[]} [offsetOptions.scoringSamples] — prefer flip that puts more weighted room mass on the inner half-plane
 * @param {{ x: number, y: number }} [offsetOptions.innerReferencePoint] — tie-break / fallback instead of `center`
 * @param {boolean} [offsetOptions.forceShouldFlip] — hard override for side selection (used by FloorCanvas 45_cut priority)
 */
export function calculateOffsetPoints(x1, y1, x2, y2, gapPixels, center, scaleFactor, offsetOptions) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
        return {
            line1: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            line2: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
        };
    }
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const offsetX = (gapPixels * normalX) / scaleFactor;
    const offsetY = (gapPixels * normalY) / scaleFactor;

    const scoringSamples =
        offsetOptions && Array.isArray(offsetOptions.scoringSamples) && offsetOptions.scoringSamples.length > 0
            ? offsetOptions.scoringSamples
            : null;

    const scoreFlip = (shouldFlip) => {
        const finalOffsetX = shouldFlip ? -offsetX : offsetX;
        const finalOffsetY = shouldFlip ? -offsetY : offsetY;
        const ix = -finalOffsetX;
        const iy = -finalOffsetY;
        const ilen = Math.hypot(ix, iy) || 1;
        const inx = ix / ilen;
        const iny = iy / ilen;
        let weightSum = 0;
        let count = 0;
        for (const sample of scoringSamples) {
            const wx = sample.x - midX;
            const wy = sample.y - midY;
            const weight = sample.w != null && sample.w > 0 ? sample.w : 1;
            if (wx * inx + wy * iny > 0) {
                weightSum += weight;
                count += 1;
            }
        }
        return { weightSum, count };
    };

    let shouldFlip;
    const forcedFlip =
        offsetOptions && typeof offsetOptions.forceShouldFlip === 'boolean'
            ? offsetOptions.forceShouldFlip
            : null;
    const skipPolygonProbe = Boolean(offsetOptions && offsetOptions.skipPolygonProbe);
    const polygonResolved =
        !skipPolygonProbe &&
        offsetOptions &&
        offsetOptions.wall &&
        Array.isArray(offsetOptions.rooms) &&
        offsetOptions.rooms.length > 0
            ? resolveInteriorShouldFlipFromPolygonProbes(
                  offsetOptions.wall,
                  offsetOptions.rooms,
                  midX,
                  midY,
                  normalX,
                  normalY
              )
            : null;

    if (forcedFlip !== null) {
        shouldFlip = forcedFlip;
    } else if (polygonResolved !== null) {
        shouldFlip = polygonResolved;
    } else if (scoringSamples) {
        const aFalse = scoreFlip(false);
        const aTrue = scoreFlip(true);
        if (aTrue.weightSum > aFalse.weightSum) shouldFlip = true;
        else if (aFalse.weightSum > aTrue.weightSum) shouldFlip = false;
        else if (aTrue.count !== aFalse.count) shouldFlip = aTrue.count > aFalse.count;
        else {
            let ref = offsetOptions && offsetOptions.innerReferencePoint;
            if (!ref) {
                let sw = 0;
                let sx = 0;
                let sy = 0;
                for (const sample of scoringSamples) {
                    const wt = sample.w != null && sample.w > 0 ? sample.w : 1;
                    sw += wt;
                    sx += sample.x * wt;
                    sy += sample.y * wt;
                }
                if (sw > 0) ref = { x: sx / sw, y: sy / sw };
            }
            ref = ref || center;
            const dotProduct = normalX * (ref.x - midX) + normalY * (ref.y - midY);
            shouldFlip = dotProduct > 0;
        }
    } else {
        const ref = (offsetOptions && offsetOptions.innerReferencePoint) || center;
        const dotProduct = normalX * (ref.x - midX) + normalY * (ref.y - midY);
        shouldFlip = dotProduct > 0;
    }

    const finalOffsetX = shouldFlip ? -offsetX : offsetX;
    const finalOffsetY = shouldFlip ? -offsetY : offsetY;
    // Both faces at ± half thickness from centerline (gapPixels = full thickness in px).
    // line2 is the inward/inner face; line1 is the opposite (outer) face.
    // One-sided centerline+offset made slant 45_cut miters look like crossed pink X's.
    const halfX = finalOffsetX / 2;
    const halfY = finalOffsetY / 2;
    return {
        line1: [
            { x: x1 + halfX, y: y1 + halfY },
            { x: x2 + halfX, y: y2 + halfY },
        ],
        line2: [
            { x: x1 - halfX, y: y1 - halfY },
            { x: x2 - halfX, y: y2 - halfY },
        ],
    };
}

/**
 * Gap-fill wall indicator: soft fill + dashed border + center icon.
 */
export function drawGapFillIndicator(context, line1, line2, scaleFactor, offsetX, offsetY, options = {}) {
    if (!line1?.[0] || !line1?.[1] || !line2?.[0] || !line2?.[1]) return;

    const accent = options.accent ?? '#8B5CF6';
    const fillColor = options.fillColor ?? 'rgba(139, 92, 246, 0.14)';

    const toCanvas = (point) => ({
        x: point.x * scaleFactor + offsetX,
        y: point.y * scaleFactor + offsetY,
    });

    const corners = [
        toCanvas(line1[0]),
        toCanvas(line1[1]),
        toCanvas(line2[1]),
        toCanvas(line2[0]),
    ];

    const traceWallPolygon = (ctx) => {
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i += 1) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
    };

    context.save();

    traceWallPolygon(context);
    context.fillStyle = fillColor;
    context.fill();

    traceWallPolygon(context);
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.setLineDash([7, 5]);
    context.lineJoin = 'round';
    context.stroke();

    const centerX = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
    const centerY = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
    const wallDx = corners[1].x - corners[0].x;
    const wallDy = corners[1].y - corners[0].y;
    const wallLen = Math.hypot(wallDx, wallDy);
    const thickDx = corners[2].x - corners[1].x;
    const thickDy = corners[2].y - corners[1].y;
    const thicknessPx = Math.hypot(thickDx, thickDy);

    if (wallLen >= 22) {
        const perpX = -wallDy / wallLen;
        const perpY = wallDx / wallLen;
        const alongX = wallDx / wallLen;
        const alongY = wallDy / wallLen;
        const barHalf = Math.min(22, Math.max(12, wallLen * 0.22));
        const halfThick = thicknessPx / 2;
        const gap = Math.max(5, halfThick * 0.78);

        context.setLineDash([]);
        context.strokeStyle = accent;
        context.lineCap = 'round';

        const drawBar = (offset) => {
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(centerX + perpX * offset - alongX * barHalf, centerY + perpY * offset - alongY * barHalf);
            context.lineTo(centerX + perpX * offset + alongX * barHalf, centerY + perpY * offset + alongY * barHalf);
            context.stroke();
        };

        drawBar(-gap);
        drawBar(gap);

        const arrowLen = Math.max(4, gap * 0.88);
        const tip = 4;
        context.lineWidth = 1.35;
        const ax = perpX;
        const ay = perpY;
        const bx = alongX;
        const by = alongY;

        context.beginPath();
        context.moveTo(centerX - ax * arrowLen, centerY - ay * arrowLen);
        context.lineTo(centerX + ax * arrowLen, centerY + ay * arrowLen);
        context.stroke();

        context.beginPath();
        context.moveTo(centerX - ax * arrowLen, centerY - ay * arrowLen);
        context.lineTo(centerX - ax * arrowLen + bx * tip, centerY - ay * arrowLen + by * tip);
        context.lineTo(centerX - ax * arrowLen - bx * tip, centerY - ay * arrowLen - by * tip);
        context.moveTo(centerX + ax * arrowLen, centerY + ay * arrowLen);
        context.lineTo(centerX + ax * arrowLen + bx * tip, centerY + ay * arrowLen + by * tip);
        context.lineTo(centerX + ax * arrowLen - bx * tip, centerY + ay * arrowLen - by * tip);
        context.stroke();
    }

    context.restore();
}

/** @deprecated Use drawGapFillIndicator */
export const drawGapFillCloudOutline = drawGapFillIndicator;

// Draw a pair of wall lines
export function drawWallLinePair(context, lines, scaleFactor, offsetX, offsetY, color, dashPattern = [], innerColor = null, lineWidth = DIMENSION_CONFIG.WALL_LINE_WIDTH) {
    const outerStroke = adjustPlanStrokeColor(color);
    const innerStroke = innerColor ? adjustPlanStrokeColor(innerColor) : null;
    // If innerColor is provided and different from color, draw each line with different color
    // line1 (outer face) uses color, line2 (inner face) uses innerColor
    if (innerStroke && innerStroke !== outerStroke && lines.length >= 2) {
        // Draw outer face (line1) with outer color
        context.strokeStyle = outerStroke;
        context.lineWidth = lineWidth;
        context.setLineDash(dashPattern);
        context.beginPath();
        context.moveTo(
            lines[0][0].x * scaleFactor + offsetX,
            lines[0][0].y * scaleFactor + offsetY
        );
        context.lineTo(
            lines[0][1].x * scaleFactor + offsetX,
            lines[0][1].y * scaleFactor + offsetY
        );
        context.stroke();
        
        // Draw inner face (line2) with inner color
        context.strokeStyle = innerStroke;
        context.beginPath();
        context.moveTo(
            lines[1][0].x * scaleFactor + offsetX,
            lines[1][0].y * scaleFactor + offsetY
        );
        context.lineTo(
            lines[1][1].x * scaleFactor + offsetX,
            lines[1][1].y * scaleFactor + offsetY
        );
        context.stroke();
    } else {
        // Same material on both faces - use single color
        context.strokeStyle = outerStroke;
        context.lineWidth = lineWidth;
        context.setLineDash(dashPattern);
        lines.forEach(line => {
            context.beginPath();
            context.moveTo(
                line[0].x * scaleFactor + offsetX,
                line[0].y * scaleFactor + offsetY
            );
            context.lineTo(
                line[1].x * scaleFactor + offsetX,
                line[1].y * scaleFactor + offsetY
            );
            context.stroke();
        });
    }
    context.setLineDash([]); // Reset dash
}

// Draw wall caps for double-line walls
export function drawWallCaps(context, wall, joints, center, intersections, SNAP_THRESHOLD, currentScaleFactor, offsetX, offsetY, scaleFactor) {
    if (!wall._line1 || !wall._line2) return;
    const endpoints = [
        { label: 'start', x: wall.start_x, y: wall.start_y },
        { label: 'end', x: wall.end_x, y: wall.end_y }
    ];
    endpoints.forEach((pt) => {
        const cap1 = pt.label === 'start' ? wall._line1[0] : wall._line1[1];
        const cap2 = pt.label === 'start' ? wall._line2[0] : wall._line2[1];
        // Face miters already place endpoints; connecting them draws the end/miter edge.
        context.beginPath();
        context.moveTo(
            cap1.x * scaleFactor + offsetX,
            cap1.y * scaleFactor + offsetY
        );
        context.lineTo(
            cap2.x * scaleFactor + offsetX,
            cap2.y * scaleFactor + offsetY
        );
        context.strokeStyle = adjustPlanStrokeColor('black');
        context.setLineDash([]);
        context.lineWidth = DIMENSION_CONFIG.WALL_CAP_LINE_WIDTH;
        context.stroke();
    });
}

// Build a unique key for wall finish + thickness combination
function getWallFinishKey(wall) {
    const intMat = wall.inner_face_material || 'PPGI';
    const intThk = wall.inner_face_thickness != null ? wall.inner_face_thickness : 0.5;
    const extMat = wall.outer_face_material || 'PPGI';
    const extThk = wall.outer_face_thickness != null ? wall.outer_face_thickness : 0.5;
    const coreThk = wall.thickness;
    return `${coreThk}|INT:${intThk} ${intMat}|EXT:${extThk} ${extMat}`;
}

// Generate distinct colors for combinations of (thickness + inner/outer finishes)
function generateThicknessColorMap(walls) {
    if (!walls || walls.length === 0) return new Map();

    // Collect unique combination keys (full wall specs)
    const keys = [...new Set(walls.map(getWallFinishKey))];
    
    
    // If only one combination, use default grayscale
    if (keys.length === 1) {
        const colorMap = new Map();
        const onlyKey = keys[0];
        const wall = walls.find(w => getWallFinishKey(w) === onlyKey);
        const hasDiffFaces = wall && 
            (wall.inner_face_material || 'PPGI') !== (wall.outer_face_material || 'PPGI');
        
        if (hasDiffFaces) {
            // Generate colors for inner and outer separately
            const innerHue = 200; // Blue-ish for inner
            const outerHue = 0; // Red-ish for outer
            colorMap.set(onlyKey, {
                wall: `hsl(${outerHue}, ${getPlanWallHslSaturation('wall')}%, ${getPlanWallHslLightness('wall')}%)`,
                partition: `hsl(${outerHue}, ${getPlanWallHslSaturation('partition')}%, ${getPlanWallHslLightness('partition')}%)`,
                innerWall: `hsl(${innerHue}, ${getPlanWallHslSaturation('wall')}%, ${getPlanWallHslLightness('wall')}%)`,
                innerPartition: `hsl(${innerHue}, ${getPlanWallHslSaturation('partition')}%, ${getPlanWallHslLightness('partition')}%)`,
                label: onlyKey,
                hasDifferentFaces: true
            });
        } else {
            const defaults = getPlanDefaultWallColors();
            colorMap.set(onlyKey, { ...defaults, label: onlyKey });
        }
        return colorMap;
    }

    // Assign distinct hues for each combination
    const colorMap = new Map();
    keys.forEach((key, index) => {
        const wall = walls.find(w => getWallFinishKey(w) === key);
        const hasDiffFaces = wall && 
            (wall.inner_face_material || 'PPGI') !== (wall.outer_face_material || 'PPGI');
        
        if (hasDiffFaces) {
            // Different materials - assign separate colors for inner and outer
            const hueOuter = (index * 360) / keys.length;
            const hueInner = ((index * 360) / keys.length + 180) % 360; // Opposite side of color wheel
            
            const wallColor = `hsl(${hueOuter}, ${getPlanWallHslSaturation('wall')}%, ${getPlanWallHslLightness('wall')}%)`;
            const partitionColor = `hsl(${hueOuter}, ${getPlanWallHslSaturation('partition')}%, ${getPlanWallHslLightness('partition')}%)`;
            const innerWallColor = `hsl(${hueInner}, ${getPlanWallHslSaturation('wall')}%, ${getPlanWallHslLightness('wall')}%)`;
            const innerPartitionColor = `hsl(${hueInner}, ${getPlanWallHslSaturation('partition')}%, ${getPlanWallHslLightness('partition')}%)`;
            
            const parts = key.split('|');
            const label = `${parts[0]}mm | ${parts[1].replace('INT:', 'Int: ')} | ${parts[2].replace('EXT:', 'Ext: ')}`;
            
            colorMap.set(key, {
                wall: wallColor,
                partition: partitionColor,
                innerWall: innerWallColor,
                innerPartition: innerPartitionColor,
                label,
                hasDifferentFaces: true
            });
        } else {
            // Same material on both faces
            const hue = (index * 360) / keys.length;
            const wallColor = `hsl(${hue}, ${getPlanWallHslSaturation('wall')}%, ${getPlanWallHslLightness('wall')}%)`;
            const partitionColor = `hsl(${hue}, ${getPlanWallHslSaturation('partition')}%, ${getPlanWallHslLightness('partition')}%)`;
            const parts = key.split('|');
            const label = `${parts[0]}mm | ${parts[1].replace('INT:', 'Int: ')} | ${parts[2].replace('EXT:', 'Ext: ')}`;
            colorMap.set(key, { wall: wallColor, partition: partitionColor, label, hasDifferentFaces: false });
        }
    });

    return colorMap;
}

/**
 * Wall + panel dimension labels/lines using the same rules as the 2D wall plan canvas.
 * Used by drawWalls and PDF export (offscreen canvas composite).
 */
export function drawWallPlanDimensionsLayer({
    context,
    walls,
    intersections,
    rooms = [],
    wallPanelsMap = {},
    wallLinesMap,
    scaleFactor,
    offsetX,
    offsetY,
    center,
    initialScale = scaleFactor,
    currentScaleFactor = scaleFactor,
    SNAP_THRESHOLD = 20,
    filteredDimensions = null,
    dimensionVisibility = {},
    showPanelLines = true,
    selectedWall = null,
    tempWall = null,
    placedLabels = [],
    allLabels = [],
    dimensionValuesSeen = null,
    includeProjectDimensions = false,
    doors = [],
    doorLabelObstacles = null,
}) {
    if (!context || !walls?.length || !wallLinesMap?.size) {
        return { dimensionEdgeExtents: createDimensionEdgeExtents(), placedLabels, allLabels };
    }

    const doorObstacles =
        doorLabelObstacles ??
        buildDoorLabelObstacles(doors, walls, scaleFactor, offsetX, offsetY, wallLinesMap);
    if (doorObstacles.length > 0) {
        placedLabels.push(...doorObstacles);
    }

    const showWallDimensions = dimensionVisibility?.wall !== false;
    const showPanelDimensions = dimensionVisibility?.panel !== false;
    const showProjectDimensions = dimensionVisibility?.project !== false;

    const actualDimensions = calculateActualProjectDimensions(walls);
    const modelBounds = {
        minX: actualDimensions.minX,
        maxX: actualDimensions.maxX,
        minY: actualDimensions.minY,
        maxY: actualDimensions.maxY,
        clip: insetBoundsToInnerFaces(actualDimensions, walls)
    };

    const fd = filteredDimensions ?? filterDimensions(walls, intersections, wallPanelsMap);
    const allPanelLabels = [];
    const wallDimensionSpecs = [];
    const dimensionLanes = createDimensionLaneCounters();
    const dimensionEdgeExtents = createDimensionEdgeExtents();

    const valuesSeen = dimensionValuesSeen ?? new Set();
    if (!dimensionValuesSeen && (showProjectDimensions || includeProjectDimensions)) {
        const wKey = planCeilingValueDedupKey(actualDimensions.width, true);
        const hKey = planCeilingValueDedupKey(actualDimensions.length, false);
        if (wKey) valuesSeen.add(wKey);
        if (hKey) valuesSeen.add(hKey);
    }

    walls.forEach((wall) => {
        const wallData = wallLinesMap.get(wall.id);
        if (wallData) {
            wall._line1 = wallData.line1;
            wall._line2 = wallData.line2;
        }

        // Draw panel division lines first (no side-panel labels yet).
        // Wall dimensions must place before panel labels, otherwise panel near-wall
        // lanes fill placedLabels/dimensionLanes and wall dims get skipped.
        if (showPanelLines && wallPanelsMap) {
            const panels = wallPanelsMap[wall.id];
            if (panels?.length > 0) {
                const wallThickness = wall.thickness || 100;
                const gapPixels = wallThickness * scaleFactor;
                drawPanelDivisions(
                    context,
                    wall,
                    panels,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    undefined,
                    gapPixels,
                    modelBounds,
                    placedLabels,
                    allPanelLabels,
                    true,
                    fd,
                    false, // labels later
                    initialScale,
                    rooms,
                    wallLinesMap,
                    dimensionLanes,
                    true
                );
            }
        }

        if (showWallDimensions && (!fd || shouldShowWallDimension(wall, intersections, fd.wallDimensions, walls))) {
            const length = Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y);
            wallDimensionSpecs.push({
                startX: wall.start_x,
                startY: wall.start_y,
                endX: wall.end_x,
                endY: wall.end_y,
                color: selectedWall === wall.id ? 'red' : '#2196F3',
                modelBounds,
                wallLinesMap,
                length,
                rooms,
            });
        }
    });

    if (tempWall && showWallDimensions) {
        const length = Math.hypot(tempWall.end_x - tempWall.start_x, tempWall.end_y - tempWall.start_y);
        wallDimensionSpecs.push({
            startX: tempWall.start_x,
            startY: tempWall.start_y,
            endX: tempWall.end_x,
            endY: tempWall.end_y,
            color: '#4CAF50',
            modelBounds,
            wallLinesMap: null,
            length,
        });
    }

    wallDimensionSpecs.sort((a, b) => {
        const aHoriz = Math.abs(a.endX - a.startX) >= Math.abs(a.endY - a.startY);
        const bHoriz = Math.abs(b.endX - b.startX) >= Math.abs(b.endY - b.startY);
        if (aHoriz && bHoriz) {
            const aLo = Math.min(a.startX, a.endX);
            const bLo = Math.min(b.startX, b.endX);
            if (aLo !== bLo) return aLo - bLo;
            return a.length - b.length;
        }
        if (!aHoriz && !bHoriz) {
            const aLo = Math.min(a.startY, a.endY);
            const bLo = Math.min(b.startY, b.endY);
            if (aLo !== bLo) return aLo - bLo;
            return a.length - b.length;
        }
        return a.length - b.length;
    });

    wallDimensionSpecs.forEach((spec) => {
        drawDimensions(
            context,
            spec.startX,
            spec.startY,
            spec.endX,
            spec.endY,
            scaleFactor,
            offsetX,
            offsetY,
            spec.color,
            spec.modelBounds,
            placedLabels,
            allLabels,
            true,
            initialScale,
            spec.wallLinesMap,
            valuesSeen,
            dimensionLanes,
            spec.rooms,
            dimensionEdgeExtents
        );
    });

    // Side-panel dimension labels after wall dims so both can coexist.
    // Use the same dimensionLanes + placedLabels so panel text respects wall-dim collisions.
    if (showPanelDimensions && wallPanelsMap) {
        walls.forEach((wall) => {
            const panels = wallPanelsMap[wall.id];
            if (!panels?.length) return;
            if (!wall._line1 || !wall._line2) {
                const wallData = wallLinesMap.get(wall.id);
                if (wallData) {
                    wall._line1 = wallData.line1;
                    wall._line2 = wallData.line2;
                }
            }
            const wallThickness = wall.thickness || 100;
            const gapPixels = wallThickness * scaleFactor;
            drawPanelDivisions(
                context,
                wall,
                panels,
                scaleFactor,
                offsetX,
                offsetY,
                undefined,
                gapPixels,
                modelBounds,
                placedLabels,
                allPanelLabels,
                true,
                fd,
                true,
                initialScale,
                rooms,
                wallLinesMap,
                dimensionLanes,
                false // lines already drawn above when showPanelLines
            );
        });
    }

    const allCombinedLabels = [...allLabels, ...allPanelLabels];
    const paintedBoxes = [];
    allCombinedLabels.forEach((label) => {
        const box = { x: label.x, y: label.y, width: label.width, height: label.height };
        if (paintedBoxes.some((existing) => checkBoxOverlap(box, existing, DIMENSION_CONFIG.LABEL_MIN_SEPARATION))) {
            return;
        }
        paintedBoxes.push(box);
        const draw = makeLabelDrawFn(label, scaleFactor, initialScale);
        draw(context);
    });

    if (includeProjectDimensions && showProjectDimensions) {
        drawOverallProjectDimensions(
            context,
            walls,
            scaleFactor,
            offsetX,
            offsetY,
            placedLabels,
            allLabels,
            initialScale,
            wallLinesMap,
            dimensionEdgeExtents
        );
    }

    return { dimensionEdgeExtents, placedLabels, allLabels };
}

// Draw all walls on the canvas
export function drawWalls({
    context,
    walls,
    highlightWalls,
    selectedWallsForRoom,
    selectedWall,
    hoveredWall,
    isEditingMode,
    joints,
    intersections,
    tempWall,
    snapToClosestPoint,
    scaleFactor,
    offsetX,
    offsetY,
    center,
    currentScaleFactor,
    SNAP_THRESHOLD,
    drawPartitionSlashes,
    hoveredPoint,
    drawWallLinePair,
    drawWallCaps,
    drawEndpoints,
    drawDimensions,
    wallPanelsMap, // <-- added
    drawPanelDivisions, // <-- added
    filteredDimensions, // <-- added for dimension filtering
    placedLabels = [], // <-- added for shared collision detection
    allLabels = [], // <-- added for shared collision detection
    dimensionVisibility = {},
    showPanelLines = false, // <-- added for panel lines visibility toggle
    initialScale = 1, // <-- added for proper zoom scaling from minimum
    dimensionValuesSeen = null, // <-- shared Set: skip drawing if value already shown (match floor/ceiling dedup)
    rooms = [], // room list for inner-face offset (wall.rooms / room.walls)
    doors = [],
    // Define-room / storey-area: hide shortened partition tips; caller draws extended snaps.
    polygonSelectMode = false,
    selectedIntersectionKeys = null,
}) {
    if (!Array.isArray(walls) || !walls) return;
    
    // Generate color map based on (thickness + inner/outer finishes)
    const thicknessColorMap = generateThicknessColorMap(walls);
    
    // First pass: Calculate all wall lines and store them
    const wallLinesMap = new Map(); // Store line1 and line2 for each wall

    walls.forEach((wall) => {
        // Reset per-draw miter flags from angled joint pass
        wall._miteredStart = false;
        wall._miteredEnd = false;
        // Calculate gap in pixels based on wall thickness
        // Gap should represent half the wall thickness on each side
        // Convert thickness (mm) to pixels: thickness * scaleFactor / 2
        const wallThickness = wall.thickness; // Default to 100mm if not set
        const gapPixels = (wallThickness * scaleFactor);
        const offsetOpts = buildWallOffsetOptions(wall, rooms) || {};
        const forcedFlip = resolve45CutForceShouldFlip(wall, intersections, walls);
        if (typeof forcedFlip === 'boolean') {
            offsetOpts.forceShouldFlip = forcedFlip;
        }
        // Shared/partition walls: skip polygon probe (both sides "inside" → unstable null,
        // then scoring can flip when a second room is defined).
        const isPartition = String(wall.application_type || '').toLowerCase() === 'partition';
        const linkedRooms = getRoomsLinkedToWall(wall, rooms);
        if (isPartition || linkedRooms.length >= 2) {
            offsetOpts.skipPolygonProbe = true;
        }

        let { line1, line2 } = calculateOffsetPoints(
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            gapPixels,
            center,
            scaleFactor,
            offsetOpts
        );
        wallLinesMap.set(wall.id, { line1, line2, wall });
    });
    
    // Second pass: Extend lines to intersections (before 45° cuts)
    // This ensures perfect alignment at intersections
    intersections.forEach(inter => {
        const tolerance = DIMENSION_CONFIG.WALL_JOINT_TOLERANCE_MM;
        
        // Find all walls that meet at this intersection
        const wallsAtIntersection = [];
        
        walls.forEach(wall => {
            // Partition ends are stored inset by host thickness (~150mm), so they sit
            // outside the normal joint tolerance of the host corner. Widen end matching
            // so 45° / butt-in extension can still reach the host face.
            // Same for butt-in "deduct joining thickness" tips (inset by one host thickness).
            const wallThk = Number(wall.thickness) || 0;
            const endTol = isPartitionWall(wall)
                ? Math.max(tolerance, wallThk * 2 + 1)
                : Math.max(tolerance, wallThk + 1);
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < endTol;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < endTol;
            
            // Check if intersection point lies on the wall body (not just at endpoints)
            // Only mark as isOnBody if it's clearly in the middle, not near endpoints
            let isOnBody = false;
            if (!isAtStart && !isAtEnd) {
                const dx = wall.end_x - wall.start_x;
                const dy = wall.end_y - wall.start_y;
                const wallLength = Math.hypot(dx, dy);
                
                if (wallLength > 0) {
                    // Vector from wall start to intersection point
                    const toInterX = inter.x - wall.start_x;
                    const toInterY = inter.y - wall.start_y;
                    
                    // Project intersection point onto wall direction
                    const wallDirX = dx / wallLength;
                    const wallDirY = dy / wallLength;
                    const projectionLength = toInterX * wallDirX + toInterY * wallDirY;
                    
                    // Perpendicular distance from intersection to wall line
                    const perpX = toInterX - projectionLength * wallDirX;
                    const perpY = toInterY - projectionLength * wallDirY;
                    const perpDistance = Math.hypot(perpX, perpY);
                    
                    // Check if point is on the wall segment and within tolerance
                    // Also check that it's not too close to endpoints (account for floating point precision)
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
        
        // Process intersections with 2 or more walls
        if (wallsAtIntersection.length >= 2) {
            // Find all vertical-horizontal pairs at this intersection
            const vhPairs = [];
            
            for (let i = 0; i < wallsAtIntersection.length; i++) {
                for (let j = i + 1; j < wallsAtIntersection.length; j++) {
                    const wall1Data = wallsAtIntersection[i];
                    const wall2Data = wallsAtIntersection[j];
                    const wall1 = wall1Data.wall;
                    const wall2 = wall2Data.wall;
                    
                    // Determine if one is vertical and one is horizontal
                    const wall1Dx = wall1.end_x - wall1.start_x;
                    const wall1Dy = wall1.end_y - wall1.start_y;
                    const wall2Dx = wall2.end_x - wall2.start_x;
                    const wall2Dy = wall2.end_y - wall2.start_y;
                    
                    const wall1IsVertical = Math.abs(wall1Dx) < Math.abs(wall1Dy);
                    const wall2IsVertical = Math.abs(wall2Dx) < Math.abs(wall2Dy);
                    const wall1Axis = isAxisAlignedWall(wall1);
                    const wall2Axis = isAxisAlignedWall(wall2);
                    
                    // Ortho V–H only when both walls are truly axis-aligned.
                    // Slanted walls use applyAngledWallMitersAtIntersection instead.
                    if (wall1Axis && wall2Axis && wall1IsVertical !== wall2IsVertical) {
                        const verticalWall = wall1IsVertical ? wall1Data : wall2Data;
                        const horizontalWall = wall1IsVertical ? wall2Data : wall1Data;
                        
                        // Find joint type for this pair
                        let joiningMethod = null;
                        let jointWall1Id = null;
                        let jointWall2Id = null;
                        
                        if (inter.pairs && Array.isArray(inter.pairs)) {
                            inter.pairs.forEach(pair => {
                                // Handle both object format { id: ... } and direct ID format
                                const pairWall1Id = typeof pair.wall1 === 'object' ? (pair.wall1?.id ?? pair.wall1) : pair.wall1;
                                const pairWall2Id = typeof pair.wall2 === 'object' ? (pair.wall2?.id ?? pair.wall2) : pair.wall2;
                                
                                // Convert to strings for comparison to handle number/string mismatches
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
                        
                        // If no joint method found, default to 'none' (extension only, no shortening)
                        if (!joiningMethod) {
                            joiningMethod = 'none';
                        }
                        
                        // Always process intersections (for extension), but only shorten for butt_in
                        vhPairs.push({
                            verticalWall,
                            horizontalWall,
                            joiningMethod,
                            jointWall1Id,
                            jointWall2Id
                        });
                    }
                }
            }

            // Two passes over all V–H pairs: extends first, then shortens (butt-in). Avoids dropping
            // valid pairs at 3-wall T-junctions while keeping extend-before-shorten order globally.
            const runVhPairPhase = (phase) => {
            vhPairs.forEach(pairData => {
                const { verticalWall, horizontalWall, joiningMethod, jointWall1Id} = pairData;
                
                const vWall = verticalWall.wall;
                const hWall = horizontalWall.wall;
                const vLines = verticalWall.wallData;
                const hLines = horizontalWall.wallData;
                
                // Determine which end of vertical wall is at intersection
                // If intersection is on body, determine which endpoint is closer
                let vIsAtStart = verticalWall.isAtStart;
                if (verticalWall.isOnBody) {
                    const distToStart = Math.hypot(inter.x - vWall.start_x, inter.y - vWall.start_y);
                    const distToEnd = Math.hypot(inter.x - vWall.end_x, inter.y - vWall.end_y);
                    vIsAtStart = distToStart < distToEnd;
                }
                
                // Determine which end of horizontal wall is at intersection
                // If intersection is on body, determine which endpoint is closer
                let hIsAtStart = horizontalWall.isAtStart;
                if (horizontalWall.isOnBody) {
                    const distToStart = Math.hypot(inter.x - hWall.start_x, inter.y - hWall.start_y);
                    const distToEnd = Math.hypot(inter.x - hWall.end_x, inter.y - hWall.end_y);
                    hIsAtStart = distToStart < distToEnd;
                }
                
                const hasButtIn = joiningMethod === 'butt_in';
                
                // For vertical wall: extend to upper/lower line of horizontal
                // Determine which line of horizontal is upper and which is lower
                const hLine1Y = (hLines.line1[0].y + hLines.line1[1].y) / 2;
                const hLine2Y = (hLines.line2[0].y + hLines.line2[1].y) / 2;
                const hUpperLine = hLine1Y < hLine2Y ? hLines.line1 : hLines.line2;
                const hLowerLine = hLine1Y < hLine2Y ? hLines.line2 : hLines.line1;
                
                // Determine which end of vertical is joining (top or bottom)
                // Top = smaller Y, Bottom = larger Y
                const vEndpointY = vIsAtStart ? vWall.start_y : vWall.end_y;
                const vOtherY = vIsAtStart ? vWall.end_y : vWall.start_y;
                const isTopEnd = vEndpointY < vOtherY;
                
                if (hasButtIn) {
                    // BUTT-IN JOINT: First extend host (wall2), then shorten stem (wall1) to the
                    // near face of the host — not through to the far face.
                    //
                    // Always respect joint wall_1 (stem) / wall_2 (host) so Flip Wall Order works.
                    // Only fall back to geometry when labels do not identify a clear V/H stem.
                    const isVerticalWall1Label = String(jointWall1Id) === String(vWall.id);
                    const isHorizontalWall1Label = String(jointWall1Id) === String(hWall.id);

                    const wallsColinearHorizontal = (a, b) => {
                        const aDx = a.end_x - a.start_x;
                        const aDy = a.end_y - a.start_y;
                        const bDx = b.end_x - b.start_x;
                        const bDy = b.end_y - b.start_y;
                        const aLen = Math.hypot(aDx, aDy);
                        const bLen = Math.hypot(bDx, bDy);
                        if (aLen < 0.001 || bLen < 0.001) return false;
                        const cross = Math.abs(aDx * bDy - aDy * bDx) / (aLen * bLen);
                        if (cross > 0.08) return false;
                        const nx = -aDy / aLen;
                        const ny = aDx / aLen;
                        const midX = (b.start_x + b.end_x) / 2;
                        const midY = (b.start_y + b.end_y) / 2;
                        const perp = Math.abs((midX - a.start_x) * nx + (midY - a.start_y) * ny);
                        return perp < Math.max(1, ((Number(a.thickness) || 0) + (Number(b.thickness) || 0)) * 0.35);
                    };

                    const hHasColinearPartner = wallsAtIntersection.some((other) => (
                        other.wall.id !== hWall.id
                        && Math.abs(other.wall.end_x - other.wall.start_x) >= Math.abs(other.wall.end_y - other.wall.start_y)
                        && wallsColinearHorizontal(hWall, other.wall)
                    ));
                    const vHasColinearPartner = wallsAtIntersection.some((other) => (
                        other.wall.id !== vWall.id
                        && Math.abs(other.wall.end_x - other.wall.start_x) < Math.abs(other.wall.end_y - other.wall.start_y)
                        && wallsColinearHorizontal(vWall, other.wall)
                    ));

                    // Stem = wall_1 (shortened). Host = wall_2 (may extend).
                    let shortenVertical = isVerticalWall1Label && !isHorizontalWall1Label;
                    let shortenHorizontal = isHorizontalWall1Label && !isVerticalWall1Label;
                    if (!shortenVertical && !shortenHorizontal) {
                        // Labels missing/ambiguous — use T-junction geometry.
                        if (horizontalWall.isOnBody && !verticalWall.isOnBody) {
                            shortenVertical = true;
                            shortenHorizontal = false;
                        } else if (verticalWall.isOnBody && !horizontalWall.isOnBody) {
                            shortenVertical = false;
                            shortenHorizontal = true;
                        } else if (hHasColinearPartner && !verticalWall.isOnBody && !vHasColinearPartner) {
                            shortenVertical = true;
                            shortenHorizontal = false;
                        } else if (vHasColinearPartner && !horizontalWall.isOnBody && !hHasColinearPartner) {
                            shortenVertical = false;
                            shortenHorizontal = true;
                        }
                    }

                    const isVerticalWall1 = shortenVertical;
                    const isHorizontalWall1 = shortenHorizontal;

                    if (phase === 'extend') {
                    // First, extend wall2 (the one that should remain extended)
                    // Case A: Vertical is wall2 (host), Horizontal is wall1 (stem)
                    // Only extend host if the intersection is at an actual endpoint of the host.
                    // If host is intersected in the middle (isOnBody), skip extension (full length).
                    if (isHorizontalWall1 && !isVerticalWall1 && !verticalWall.isOnBody) {
                        // Extend vertical wall (wall2) to horizontal wall's line
                        const vEndpointYCaseA = vIsAtStart ? vWall.start_y : vWall.end_y;
                        const vOtherYCaseA = vIsAtStart ? vWall.end_y : vWall.start_y;
                        const isTopEndCaseA = vEndpointYCaseA < vOtherYCaseA;
                        let targetY;
                        if (isTopEndCaseA) {
                            // Top end -> extend to upper line
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
                            // Bottom end -> extend to lower line
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
                        
                        // Extend vertical wall (wall2) lines to horizontal wall's line
                        if (vIsAtStart) {
                            vLines.line1[0].y = targetY;
                            vLines.line2[0].y = targetY;
                        } else {
                            vLines.line1[1].y = targetY;
                            vLines.line2[1].y = targetY;
                        }
                    }
                    // Case B: Horizontal is wall2, Vertical is wall1
                    // Only extend wall2 if the intersection is at an actual endpoint of wall2
                    // If wall2 is intersected in the middle (isOnBody), skip extension (it should remain full length)
                    else if (isVerticalWall1 && !isHorizontalWall1 && !horizontalWall.isOnBody && !vHasColinearPartner && !hHasColinearPartner) {
                        // Extend horizontal wall (wall2) to vertical wall's line
                        const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                        const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                        const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                        const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                        
                        const hMidX = (hWall.start_x + hWall.end_x) / 2;
                        const vIntersectionX = inter.x;
                        const isHorizontalOnLeft = hMidX < vIntersectionX;
                        
                        let targetX;
                        if (isHorizontalOnLeft) {
                            // Horizontal on LEFT of vertical -> extend to RIGHTMOST line (opposite side)
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
                            // Horizontal on RIGHT of vertical -> extend to LEFTMOST line (opposite side)
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
                        
                        // Extend horizontal wall (wall2) lines to vertical wall's line
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
                    // Now shorten wall1 to connect to wall2
                    // Only shorten wall1 if the intersection is at an actual endpoint of wall1
                    // If wall1 is intersected in the middle (isOnBody), skip shortening (it should remain full length)
                    //
                    // Always snap stem faces to the host near face — including when the stem
                    // centerline was already inset by joining thickness (deduct / partition).
                    // Skipping that case left a thickness-sized gap between tip and host.

                    // Case 1: Vertical is stem (wall1), Horizontal is host (wall2)
                    // At T-junctions always allow shortening the stem even if isOnBody flags disagree.
                    if (isVerticalWall1 && !isHorizontalWall1 && !verticalWall.isOnBody) {
                        // Use geometry at the intersection (nearest endpoint) so stem direction — and thus
                        // which horizontal edge is the near face — is not flipped when wall1/2 flags disagree.
                        const distJointToStart = Math.hypot(inter.x - vWall.start_x, inter.y - vWall.start_y);
                        const distJointToEnd = Math.hypot(inter.x - vWall.end_x, inter.y - vWall.end_y);
                        const jointAtVerticalStart = distJointToStart < distJointToEnd;
                        const jointY = jointAtVerticalStart ? vWall.start_y : vWall.end_y;
                        const otherVerticalY = jointAtVerticalStart ? vWall.end_y : vWall.start_y;
                        const horizontalOnTopAtButtIn = otherVerticalY > jointY;

                        // Near face of host: stop at the face the stem approaches, not the far face.
                        // If horizontal is above the stem → connect to bottom (lower) line
                        // If horizontal is below the stem → connect to top (upper) line
                        let targetLine;
                        let targetY;
                        
                        if (horizontalOnTopAtButtIn) {
                            targetLine = hLowerLine;
                        } else {
                            targetLine = hUpperLine;
                        }
                        
                        // Get Y from target line (horizontal wall, so Y is constant)
                        targetY = targetLine[0].y;
                        
                        // Shorten/extend vertical wall (stem) faces to near face
                        const vLine1Endpoint = jointAtVerticalStart ? vLines.line1[0] : vLines.line1[1];
                        const vLine2Endpoint = jointAtVerticalStart ? vLines.line2[0] : vLines.line2[1];
                        
                        vLine1Endpoint.y = targetY;
                        vLine2Endpoint.y = targetY;
                        
                        // Keep X coordinates unchanged to maintain wall thickness
                    }
                    // Case 2: Horizontal is stem (wall1), Vertical is host (wall2)
                    // Only shorten wall1 if the intersection is at an actual endpoint of wall1
                    // If wall1 is intersected in the middle (isOnBody), skip shortening (it should remain full length)
                    else if (isHorizontalWall1 && !isVerticalWall1 && !horizontalWall.isOnBody) {
                        // Determine which line of vertical (wall2) to connect to
                        const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                        const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                        const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                        const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                        
                        // Determine which side of the horizontal wall the vertical wall (wall2) is on
                        // Compare vertical wall's X position with horizontal wall's midpoint X
                        // Since vertical wall's X is approximately constant, use intersection X (where they meet)
                        const vIntersectionX = inter.x;
                        const hMidX = (hWall.start_x + hWall.end_x) / 2;
                        const isVerticalOnLeft = vIntersectionX < hMidX; // Vertical wall2 is on left side of horizontal
                        const isVerticalOnRight = vIntersectionX > hMidX; // Vertical wall2 is on right side of horizontal
                        
                        // Near face of vertical host relative to horizontal stem approach
                        let targetVLine;
                        
                        if (isVerticalOnLeft) {
                            // Vertical is on LEFT of horizontal, horizontal wall1 should connect to RIGHT line of vertical wall2
                            targetVLine = vRightmostLine;
                        } else if (isVerticalOnRight) {
                            // Vertical is on RIGHT of horizontal, horizontal wall1 should connect to LEFT line of vertical wall2
                            targetVLine = vLeftmostLine;
                        } else {
                            // Default to right line if ambiguous (vertical aligns with horizontal center)
                            targetVLine = vRightmostLine;
                        }
                        
                        // Get X from target vertical line at intersection Y
                        // For butt-in joint: wall1 should connect to wall2's inner face
                        // The targetVLine (vLeftmostLine or vRightmostLine) is already the inner face of wall2
                        // So we just connect to that line directly - no additional shortening needed
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
                        
                        // Shorten horizontal wall (wall1) visually
                        // This creates the visual effect of the wall being shortened to connect to wall2
                        // For horizontal walls, we only modify X coordinate, keeping Y coordinates to maintain horizontal orientation
                        // Ensure both lines are modified by directly accessing the arrays
                        const hLine1Endpoint = hIsAtStart ? hLines.line1[0] : hLines.line1[1];
                        const hLine2Endpoint = hIsAtStart ? hLines.line2[0] : hLines.line2[1];
                        
                        hLine1Endpoint.x = targetX;
                        hLine2Endpoint.x = targetX;
                        
                        // Keep Y coordinates unchanged to maintain wall thickness
                    }
                    }
                } else {
                    if (phase === 'extend') {
                    // NOT butt-in: Extend walls normally (existing logic)
                    // Calculate intersection point on horizontal line
                    // Project intersection point onto horizontal line to get exact Y coordinate
                    // Get Y coordinate from the appropriate horizontal line at intersection X
                    let targetY;
                    if (isTopEnd) {
                        // Top end -> extend to upper line
                        // Get Y from upper line at intersection X
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
                            targetY = hUpperStartY; // Vertical line, use start Y
                        }
                    } else {
                        // Bottom end -> extend to lower line
                        // Get Y from lower line at intersection X
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
                            targetY = hLowerStartY; // Vertical line, use start Y
                        }
                    }
                    
                    // Extend vertical wall lines to horizontal wall's line
                    // Only extend if intersection is at an endpoint (not in the middle)
                    if (!verticalWall.isOnBody) {
                        if (vIsAtStart) {
                            vLines.line1[0].y = targetY;
                            vLines.line2[0].y = targetY;
                        } else {
                            vLines.line1[1].y = targetY;
                            vLines.line2[1].y = targetY;
                        }
                    }
                    
                    // For horizontal wall: extend to leftmost/rightmost line of vertical
                    // Determine which line of vertical is leftmost and which is rightmost
                    const vLine1X = (vLines.line1[0].x + vLines.line1[1].x) / 2;
                    const vLine2X = (vLines.line2[0].x + vLines.line2[1].x) / 2;
                    const vLeftmostLine = vLine1X < vLine2X ? vLines.line1 : vLines.line2;
                    const vRightmostLine = vLine1X < vLine2X ? vLines.line2 : vLines.line1;
                    
                    // Determine which SIDE of the vertical wall the horizontal wall is on
                    // Compare horizontal wall midpoint X with vertical wall X at intersection
                    const hMidX = (hWall.start_x + hWall.end_x) / 2;
                    const vIntersectionX = inter.x;
                    const isHorizontalOnLeft = hMidX < vIntersectionX;
                    
                    // Calculate intersection point on vertical line
                    // Project intersection point onto vertical line to get exact X coordinate
                    let targetX;
                    if (isHorizontalOnLeft) {
                        // Horizontal on LEFT of vertical -> extend to RIGHTMOST line (opposite side)
                        // Get X from rightmost line at intersection Y
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
                            targetX = vRightStartX; // Horizontal line, use start X
                        }
                    } else {
                        // Horizontal on RIGHT of vertical -> extend to LEFTMOST line (opposite side)
                        // Get X from leftmost line at intersection Y
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
                            targetX = vLeftStartX; // Horizontal line, use start X
                        }
                    }
                    
                    // Extend horizontal wall lines to vertical wall's line
                    // Only extend if intersection is at an endpoint (not in the middle)
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

            // Slanted / non-ortho corners: true face-line miters
            applyAngledWallMitersAtIntersection(wallsAtIntersection, inter);
            // Slant / non-ortho butt-in: trim stem faces to host near face
            applyAngledButtInAtIntersection(wallsAtIntersection, inter);
        }
    });
    
    // Third pass: Apply 45° cuts and draw walls
    walls.forEach((wall, index) => {
        const highlight = highlightWalls.find(h => h.id === wall.id);
        
        // Get color for this wall's combination
        const comboKey = getWallFinishKey(wall);
        const thicknessColors = thicknessColorMap.get(comboKey) || getPlanDefaultWallColors();
        const hasDiffFaces = thicknessColors.hasDifferentFaces;
        
        // Check if inner and outer materials are actually different
        const intMat = wall.inner_face_material || 'PPGI';
        const extMat = wall.outer_face_material || 'PPGI';
        const actuallyHasDiffFaces = hasDiffFaces && (intMat !== extMat);
        
        const baseColor = wall.application_type === "partition" ? thicknessColors.partition : thicknessColors.wall;
        const baseInnerColor = actuallyHasDiffFaces 
            ? (wall.application_type === "partition" ? thicknessColors.innerPartition : thicknessColors.innerWall)
            : null;
        
        const wallColor =
            highlight ? highlight.color :
            selectedWallsForRoom.includes(wall.id) ? '#4CAF50' :
            selectedWall === wall.id ? 'red' :
            hoveredWall === wall.id ? '#2196F3' :
            baseColor;
        
        // Inner color (only used if materials differ)
        const innerColor = actuallyHasDiffFaces && !highlight && 
            !selectedWallsForRoom.includes(wall.id) && 
            selectedWall !== wall.id && 
            hoveredWall !== wall.id
            ? baseInnerColor
            : null;
        // Get pre-calculated lines (already extended to intersections)
        let { line1, line2 } = wallLinesMap.get(wall.id);
        
        // Make copies for modification (45° cuts will modify these)
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Check for 45° cuts at EACH END separately
        // We need to determine which line (left or right) to shorten at each end
        const wallDx = wall.end_x - wall.start_x;
        const wallDy = wall.end_y - wall.start_y;
        const wallLength = Math.hypot(wallDx, wallDy);
        const wallDirX = wallLength > 0 ? wallDx / wallLength : 0;
        const wallDirY = wallLength > 0 ? wallDy / wallLength : 0;
        
        // Determine which line is left and which is right by comparing positions
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
            const tolerance = DIMENSION_CONFIG.WALL_JOINT_TOLERANCE_MM;
            const endTol = wall.application_type && String(wall.application_type).toLowerCase() === 'partition'
                ? Math.max(tolerance, (Number(wall.thickness) || 0) * 2 + 1)
                : tolerance;
            const isAtStart = Math.hypot(inter.x - wall.start_x, inter.y - wall.start_y) < endTol;
            const isAtEnd = Math.hypot(inter.x - wall.end_x, inter.y - wall.end_y) < endTol;
            
            if (isAtStart || isAtEnd) {
                // Check if this intersection has a 45_cut
                let has45Cut = false;
                let joiningWallId = null;
                
                if (inter.pairs) {
                    inter.pairs.forEach(pair => {
                        if ((pair.wall1.id === wall.id || pair.wall2.id === wall.id) && pair.joining_method === '45_cut') {
                            has45Cut = true;
                            joiningWallId = pair.wall1.id === wall.id ? pair.wall2.id : pair.wall1.id;
                        }
                    });
                }
                
                if (has45Cut && joiningWallId) {
                    const joiningWall = walls.find(w => w.id === joiningWallId);
                    if (joiningWall) {
                        const joinMidX = (joiningWall.start_x + joiningWall.end_x) / 2;
                        const joinMidY = (joiningWall.start_y + joiningWall.end_y) / 2;
                        
                        if (isAtStart) {
                            startHas45 = true;
                            // Determine which side (left or right) the joining wall is on
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
                            // Determine which side (left or right) the joining wall is on
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
        
        // Apply 45° cut shortening at each end independently
        // Shorten by wall thickness to match the visual gap
        // ONLY for true axis-aligned walls — slant corners use applyAngledWallMitersAtIntersection.
        // The one-face ortho shorten creates crossed pink “X” artifacts on slant 45_cut joints.
        const wallThickness = wall.thickness || 100; // Default to 100mm if not set
        const finalAdjust = wallThickness; // Shorten by wall thickness
        const allowOrtho45Shorten = isAxisAlignedWall(wall);

        // Make copies of lines for modification
        line1 = [...line1.map(p => ({ ...p }))];
        line2 = [...line2.map(p => ({ ...p }))];
        
        // Shorten at START end (skip when angled face-miter already placed the corner)
        if (allowOrtho45Shorten && startHas45 && !wall._miteredStart) {
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
        if (allowOrtho45Shorten && endHas45 && !wall._miteredEnd) {
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

        // Final role enforcement: ensure line2 (inner) is on forced 45_cut side.
        const forcedFlip = resolve45CutForceShouldFlip(wall, intersections, walls);
        if (typeof forcedFlip === 'boolean') {
            const len = Math.hypot(wallDx, wallDy) || 1;
            const normalX = wallDy / len;
            const normalY = -wallDx / len;
            const wallMidX = (wall.start_x + wall.end_x) / 2;
            const wallMidY = (wall.start_y + wall.end_y) / 2;
            const line2MidXNow = (line2[0].x + line2[1].x) / 2;
            const line2MidYNow = (line2[0].y + line2[1].y) / 2;
            const line2Dot = normalX * (line2MidXNow - wallMidX) + normalY * (line2MidYNow - wallMidY);
            const line2IsPositiveSide = line2Dot > 0;
            if (line2IsPositiveSide !== forcedFlip) {
                const tmp = line1;
                line1 = line2;
                line2 = tmp;
            }
        }
        wall._line1 = line1;
        wall._line2 = line2;
        const highlightLineWidth = highlight
            ? Math.max(2.5, DIMENSION_CONFIG.WALL_LINE_WIDTH * 2.5)
            : DIMENSION_CONFIG.WALL_LINE_WIDTH;
        drawWallLinePair(context, [line1, line2], scaleFactor, offsetX, offsetY, wallColor, [], innerColor, highlightLineWidth);
        drawWallCaps(context, wall, joints, center, intersections, SNAP_THRESHOLD, currentScaleFactor, offsetX, offsetY, scaleFactor);
        if (wall.application_type === "partition") {
            drawPartitionSlashes(context, line1, line2, scaleFactor, offsetX, offsetY);
        }
        if (isEditingMode) {
            const endpointColor = selectedWall === wall.id ? 'red' : '#2196F3';
            // Define-room / storey-area: only orange room-selection snaps are shown
            // (extended host junctions). Hide blue tips so deducted butt-ins don't
            // appear as two selectable dots on the same corner.
            if (!polygonSelectMode) {
                drawEndpoints(context, wall.start_x, wall.start_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor, 2, initialScale);
                drawEndpoints(context, wall.end_x, wall.end_y, scaleFactor, offsetX, offsetY, hoveredPoint, endpointColor, 2, initialScale);
            }
        }
    });

    // Orange joint / intersection points at geometric positions (butt-in tip, not extended)
    // Define-room: skip these so only extended snap points are shown.
    if (isEditingMode && !polygonSelectMode && Array.isArray(intersections)) {
        const selectedKeys = selectedIntersectionKeys instanceof Set
            ? selectedIntersectionKeys
            : new Set(selectedIntersectionKeys || []);
        intersections.forEach((inter) => {
            const key = inter?.id != null
                ? `id:${inter.id}`
                : `${Math.round(Number(inter.x) || 0)},${Math.round(Number(inter.y) || 0)}`;
            const isSelected = selectedKeys.has(key);
            drawEndpoints(
                context,
                inter.x,
                inter.y,
                scaleFactor,
                offsetX,
                offsetY,
                hoveredPoint,
                isSelected ? '#22C55E' : '#FF9800',
                isSelected ? 3.5 : 2.25,
                initialScale
            );
        });
    }

    // Gap-fill indicators on top of wall geometry
    walls.forEach((wall) => {
        if (!wall.fill_gap_mode) return;
        const line1 = wall._line1;
        const line2 = wall._line2;
        if (!line1 || !line2) return;
        drawGapFillIndicator(context, line1, line2, scaleFactor, offsetX, offsetY);
    });

    // Draw temporary wall while adding wall (skip label collection for temp wall)
    if (tempWall) {
        // Calculate gap in pixels based on wall thickness for temp wall
        const tempWallThickness = tempWall.thickness || 100; // Default to 100mm if not set
        const tempGapPixels = (tempWallThickness * scaleFactor) / 2;
        const tempOffsetOpts = buildWallOffsetOptions(tempWall, rooms);

        const { line1, line2 } = calculateOffsetPoints(
            tempWall.start_x,
            tempWall.start_y,
            tempWall.end_x,
            tempWall.end_y,
            tempGapPixels,
            center,
            scaleFactor,
            tempOffsetOpts
        );
        // Preview color by angle snap:
        // blue = world 90°, orange = ⊥ to slant, purple = ∥ along slant, green = free
        const snapType = tempWall.angleSnapType;
        const previewColor =
            snapType === 'horizontal' || snapType === 'vertical' ? '#2196F3' :
            snapType === 'perpendicular' ? '#FF9800' :
            snapType === 'parallel' ? '#9C27B0' :
            '#4CAF50';
        drawWallLinePair(context, [line1, line2], scaleFactor, offsetX, offsetY, previewColor, [5, 5]);
        drawEndpoints(context, tempWall.start_x, tempWall.start_y, scaleFactor, offsetX, offsetY, hoveredPoint, previewColor, 2, initialScale);
        drawEndpoints(context, tempWall.end_x, tempWall.end_y, scaleFactor, offsetX, offsetY, hoveredPoint, previewColor, 2, initialScale);

        // Snap mode tag near the free end
        if (snapType) {
            const tag =
                snapType === 'horizontal' ? '90° H' :
                snapType === 'vertical' ? '90° V' :
                snapType === 'perpendicular' ? '⊥ to slant' :
                snapType === 'parallel' ? '∥ along slant' :
                '';
            if (tag) {
                const tx = tempWall.end_x * scaleFactor + offsetX + 10;
                const ty = tempWall.end_y * scaleFactor + offsetY - 10;
                context.save();
                context.font = 'bold 11px Segoe UI, Arial, sans-serif';
                const tw = context.measureText(tag).width;
                context.fillStyle = 'rgba(255,255,255,0.92)';
                context.fillRect(tx - 4, ty - 12, tw + 8, 16);
                context.strokeStyle = previewColor;
                context.lineWidth = 1;
                context.strokeRect(tx - 4, ty - 12, tw + 8, 16);
                context.fillStyle = previewColor;
                context.fillText(tag, tx, ty);
                context.restore();
            }
        }

        const snapPoint = snapToClosestPoint(tempWall.end_x, tempWall.end_y);
        if (snapPoint.x !== tempWall.end_x || snapPoint.y !== tempWall.end_y) {
            context.beginPath();
            context.moveTo(
                tempWall.end_x * scaleFactor + offsetX,
                tempWall.end_y * scaleFactor + offsetY
            );
            context.lineTo(
                snapPoint.x * scaleFactor + offsetX,
                snapPoint.y * scaleFactor + offsetY
            );
            context.strokeStyle = previewColor;
            context.globalAlpha = 0.45;
            context.lineWidth = 1;
            context.setLineDash([3, 3]);
            context.stroke();
            context.setLineDash([]);
            context.globalAlpha = 1;
            drawEndpoints(context, snapPoint.x, snapPoint.y, scaleFactor, offsetX, offsetY, hoveredPoint, previewColor, 2.25, initialScale);
        }
    }
    const { dimensionEdgeExtents } = drawWallPlanDimensionsLayer({
        context,
        walls,
        intersections,
        rooms,
        wallPanelsMap,
        wallLinesMap,
        scaleFactor,
        offsetX,
        offsetY,
        center,
        initialScale,
        currentScaleFactor,
        SNAP_THRESHOLD,
        filteredDimensions,
        dimensionVisibility,
        showPanelLines,
        selectedWall,
        tempWall,
        placedLabels,
        allLabels,
        dimensionValuesSeen,
        includeProjectDimensions: false,
        doors,
    });

    return { thicknessColorMap, dimensionEdgeExtents };
}

// Draw diagonal hatching for partitions
export function drawPartitionSlashes(context, line1, line2, scaleFactor, offsetX, offsetY) {
    const spacing = 15;
    const slashLength = 60;
    const dx = line1[1].x - line1[0].x;
    const dy = line1[1].y - line1[0].y;
    const wallLength = Math.sqrt(dx * dx + dy * dy);
    const numSlashes = Math.floor(wallLength * scaleFactor / spacing);
    for (let i = 1; i < numSlashes - 1; i++) {
        const t = i / numSlashes;
        const midX = (line1[0].x + t * (line1[1].x - line1[0].x) + line2[0].x + t * (line2[1].x - line2[0].x)) / 2;
        const midY = (line1[0].y + t * (line1[1].y - line1[0].y) + line2[0].y + t * (line2[1].y - line2[0].y)) / 2;
        const diagX = Math.cos(Math.PI / 4) * slashLength;
        const diagY = Math.sin(Math.PI / 4) * slashLength;
        const x1 = midX - diagX;
        const y1 = midY - diagY;
        const x2 = midX + diagX;
        const y2 = midY + diagY;
        context.beginPath();
        context.moveTo(x1 * scaleFactor + offsetX, y1 * scaleFactor + offsetY);
        context.lineTo(x2 * scaleFactor + offsetX, y2 * scaleFactor + offsetY);
        context.strokeStyle = adjustPlanStrokeColor(DIMENSION_CONFIG.COLORS.PARTITION);
        context.lineWidth = DIMENSION_CONFIG.PARTITION_LINE_WIDTH;
        context.stroke();
    }
} 

// Draw panel division lines along a wall
export function drawPanelDivisions(
    context,
    wall,
    panels,
    scaleFactor,
    offsetX,
    offsetY,
    color = isPlanCanvasDark() ? '#e5e7eb' : '#333',
    FIXED_GAP = 2.5,
    modelBounds = null,
    placedLabels = [],
    allPanelLabels = [],
    collectOnly = false,
    filteredDimensions = null,
    showPanelDimensions = true,
    initialScale = 1,
    rooms = [],
    wallLinesMap = null,
    dimensionLanes = null,
    showPanelLines = true
) {
    if (!panels || panels.length === 0 || !wall._line1 || !wall._line2) return;
    const line1Raw = wall._line1;
    const line2Raw = wall._line2;
    // Panel array is ordered panel-left → panel-right; walk the wall lines the same way
    // even when the wall is stored right→left or bottom→top.
    const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
    const panelLeftAtLineStart = isHorizontal
        ? wall.end_x >= wall.start_x
        : wall.end_y >= wall.start_y;
    const line1 = panelLeftAtLineStart ? line1Raw : [line1Raw[1], line1Raw[0]];
    const line2 = panelLeftAtLineStart ? line2Raw : [line2Raw[1], line2Raw[0]];
    const wallLength = Math.sqrt(Math.pow(line1[1].x - line1[0].x, 2) + Math.pow(line1[1].y - line1[0].y, 2));
    if (wallLength === 0) return;

    const getPanelDrawWidth = (panel) => {
        const actual = Number(panel?.actualWidth);
        if (Number.isFinite(actual) && actual > 0) return actual;
        return Number(panel?.width) || 0;
    };
    const is1130OptimizedPanel = (panel) => {
        const opt = panel?.optimizationType;
        if (opt === 'LEFT_OPTIMIZED' || opt === 'RIGHT_OPTIMIZED') return true;
        return Math.round(getPanelDrawWidth(panel)) === 1130;
    };
    
    let accumulated = 0;
    
    // Draw panel division lines (independent of side-panel dimension labels)
    if (showPanelLines) {
    for (let i = 0; i < panels.length - 1; i++) {
        accumulated += getPanelDrawWidth(panels[i]);
        const t = accumulated / wallLength;
        // Center point along the wall (centerline)
        const cx = line1[0].x + (line1[1].x - line1[0].x) * t;
        const cy = line1[0].y + (line1[1].y - line1[0].y) * t;
        const c2x = line2[0].x + (line2[1].x - line2[0].x) * t;
        const c2y = line2[0].y + (line2[1].y - line2[0].y) * t;
        // Midpoint between the two wall lines at t
        const mx = (cx + c2x) / 2;
        const my = (cy + c2y) / 2;
        // Direction vector along the wall
        const dx = (line1[1].x - line1[0].x) / wallLength;
        const dy = (line1[1].y - line1[0].y) / wallLength;
        // Perpendicular vector
        const perpX = -dy;
        const perpY = dx;
        // Half the gap between the wall lines at this t
        const halfGap = Math.sqrt(Math.pow(cx - c2x, 2) + Math.pow(cy - c2y, 2)) / 2;
        // Endpoints of the perpendicular division line
        const x1 = mx + perpX * halfGap;
        const y1 = my + perpY * halfGap;
        const x2 = mx - perpX * halfGap;
        const y2 = my - perpY * halfGap;
        context.save();
        context.beginPath();
        context.moveTo(x1 * scaleFactor + offsetX, y1 * scaleFactor + offsetY);
        context.lineTo(x2 * scaleFactor + offsetX, y2 * scaleFactor + offsetY);
        context.strokeStyle = adjustPlanStrokeColor(color);
        context.lineWidth = 2;
        context.stroke();
        context.restore();
    }
    
    // Draw special markers for 1130mm panels (20mm optimization)
    accumulated = 0;
    for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const panelWidth = getPanelDrawWidth(panel);
        
        // Highlight both left- and right-end 1130 optimizations
        if (is1130OptimizedPanel(panel)) {
            const panelStart = accumulated;
            const panelEnd = accumulated + panelWidth;
            const tStart = panelStart / wallLength;
            const tEnd = panelEnd / wallLength;
            
            // Calculate panel boundaries
            const cxStart = line1[0].x + (line1[1].x - line1[0].x) * tStart;
            const cyStart = line1[0].y + (line1[1].y - line1[0].y) * tStart;
            const c2xStart = line2[0].x + (line2[1].x - line2[0].x) * tStart;
            const c2yStart = line2[0].y + (line2[1].y - line2[0].y) * tStart;
            const mxStart = (cxStart + c2xStart) / 2;
            const myStart = (cyStart + c2yStart) / 2;
            
            const cxEnd = line1[0].x + (line1[1].x - line1[0].x) * tEnd;
            const cyEnd = line1[0].y + (line1[1].y - line1[0].y) * tEnd;
            const c2xEnd = line2[0].x + (line2[1].x - line2[0].x) * tEnd;
            const c2yEnd = line2[0].y + (line2[1].y - line2[0].y) * tEnd;
            const mxEnd = (cxEnd + c2xEnd) / 2;
            const myEnd = (cyEnd + c2yEnd) / 2;
            
            // Draw red diagonal slashes for 1130mm panels
            context.save();
            context.strokeStyle = '#FF0000';
            context.lineWidth = 2;
            
            // Calculate diagonal slash pattern
            const slashSpacing = 20; // Spacing between slashes
            const slashLength = 15;
            
            // Direction vector along the panel
            const dx = mxEnd - mxStart;
            const dy = myEnd - myStart;
            const panelLength = Math.sqrt(dx * dx + dy * dy);
            
            if (panelLength > 0) {
                const numSlashes = Math.floor(panelLength / slashSpacing);
                
                for (let k = 0; k < numSlashes; k++) {
                    const t = (k + 0.5) / numSlashes; // Center the slashes
                    const slashX = mxStart + t * dx;
                    const slashY = myStart + t * dy;
                    
                    // Calculate perpendicular direction for slashes
                    const perpX = -dy / panelLength;
                    const perpY = dx / panelLength;
                    
                    // Draw diagonal slash
                    context.beginPath();
                    context.moveTo(
                        (slashX - perpX * slashLength/2) * scaleFactor + offsetX,
                        (slashY - perpY * slashLength/2) * scaleFactor + offsetY
                    );
                    context.lineTo(
                        (slashX + perpX * slashLength/2) * scaleFactor + offsetX,
                        (slashY + perpY * slashLength/2) * scaleFactor + offsetY
                    );
                    context.stroke();
                }
            }
            
            context.restore();
        }
        
        accumulated += panelWidth;
    }
    } // end showPanelLines
    
    if (!showPanelDimensions) {
        return;
    }

    // Draw side panel length labels (original - only first and last)
    accumulated = 0;
    for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const panelWidth = getPanelDrawWidth(panel);
        
        // Show labels for side panels (first and last panels)
        // Skip 1130 optimized panels — red slash highlight is enough
        // No dedup filtering — side panel dimensions should appear on every wall
        if ((i === 0 || i === panels.length - 1) &&
            !is1130OptimizedPanel(panel)) {
            
            let displayWidth = panelWidth;
            let specialSymbol = '';
            let specialColor = '#FF6B35'; // Default panel color
            
            const labelText = `${Math.round(displayWidth)}`;
            const fullLabelText = specialSymbol ? `${labelText} ${specialSymbol}` : labelText;

            // Start and end t values for the panel
            const tStart = accumulated / wallLength;
            const tEnd = (accumulated + panelWidth) / wallLength;

            // Start and end points along the wall centerline
            const cxStart = line1[0].x + (line1[1].x - line1[0].x) * tStart;
            const cyStart = line1[0].y + (line1[1].y - line1[0].y) * tStart;
            const c2xStart = line2[0].x + (line2[1].x - line2[0].x) * tStart;
            const c2yStart = line2[0].y + (line2[1].y - line2[0].y) * tStart;
            const mxStart = (cxStart + c2xStart) / 2;
            const myStart = (cyStart + c2yStart) / 2;

            const cxEnd = line1[0].x + (line1[1].x - line1[0].x) * tEnd;
            const cyEnd = line1[0].y + (line1[1].y - line1[0].y) * tEnd;
            const c2xEnd = line2[0].x + (line2[1].x - line2[0].x) * tEnd;
            const c2yEnd = line2[0].y + (line2[1].y - line2[0].y) * tEnd;
            const mxEnd = (cxEnd + c2xEnd) / 2;
            const myEnd = (cyEnd + c2yEnd) / 2;

            // Calculate direction and angle
            const dx = mxEnd - mxStart;
            const dy = myEnd - myStart;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);

            // Panel midpoint
            const panelMidX = (mxStart + mxEnd) / 2;
            const panelMidY = (myStart + myEnd) / 2;

            // Use the passed modelBounds or fallback to wall bounds
            const bounds = modelBounds || {
                minX: Math.min(wall.start_x, wall.end_x),
                maxX: Math.max(wall.start_x, wall.end_x),
                minY: Math.min(wall.start_y, wall.end_y),
                maxY: Math.max(wall.start_y, wall.end_y)
            };
            const text = fullLabelText;
            
            // IMPORTANT: Set font BEFORE measuring text width!
            const standardPanelFontSize = computeWallPlanDimensionFontSize(scaleFactor, initialScale);
            let fontSize = standardPanelFontSize;
            fontSize = applyNearWallFontSize(standardPanelFontSize);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            const textWidth = context.measureText(text).width;

            if (Math.abs(angle) < 45 || Math.abs(angle) > 135) {
                const spanLo = Math.min(mxStart, mxEnd);
                const spanHi = Math.max(mxStart, mxEnd);
                const baseOff = computeNearWallLabelOffsetPx(wall, scaleFactor, fontSize, textWidth, false);
                const trialOffset = Math.max(baseOff, DIMENSION_CONFIG.MIN_VERTICAL_OFFSET);
                const side1Bounds = calculateHorizontalLabelBounds(
                    panelMidX * scaleFactor + offsetX,
                    myStart * scaleFactor + offsetY - trialOffset,
                    textWidth,
                    2,
                    8
                );
                const side2Bounds = calculateHorizontalLabelBounds(
                    panelMidX * scaleFactor + offsetX,
                    myStart * scaleFactor + offsetY + trialOffset,
                    textWidth,
                    2,
                    8
                );
                const near = placeNearWallWallDimension({
                    wallForNear: wall,
                    wallMidX: panelMidX,
                    wallMidY: panelMidY,
                    isHorizontal: true,
                    modelBounds: bounds,
                    dimensionLanes,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    fontSize,
                    textWidth,
                    placedLabels,
                    wallLinesMap,
                    rooms,
                    initialScale,
                    rotatedVerticalText: false,
                    calculateBounds: (lx, ly, tw) =>
                        calculateNearWallHorizontalDimBounds(lx, ly, tw, fontSize),
                    side1Bounds,
                    side2Bounds,
                    baseOffset: baseOff,
                    wallLaneSpacing: DIMENSION_CONFIG.NEAR_WALL_LANE_SPACING,
                    spanLo,
                    spanHi
                });
                if (!near) {
                    accumulated += panelWidth;
                    continue;
                }
                const labelX = near.labelX;
                const labelY = near.labelY;
                const side = near.side;
                const finalLabelBounds = near.bounds;
                
                const textPadding = 2;
                const textLeft = labelX - textWidth / 2 - textPadding;
                const textRight = labelX + textWidth / 2 + textPadding;
                const rectScreenPanel = modelBoundsToScreenRect(bounds, scaleFactor, offsetX, offsetY);
                const extDashPanel = getCanvasExtensionDashPattern(scaleFactor);
                const extLineWPanel = getCanvasExtensionLineWidth();
                const dimLineWPanel = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
                const startXScreen = mxStart * scaleFactor + offsetX;
                const endXScreen = mxEnd * scaleFactor + offsetX;
                const yStartP = myStart * scaleFactor + offsetY;
                const yEndP = myEnd * scaleFactor + offsetY;
                context.strokeStyle = specialColor;
                context.lineWidth = extLineWPanel;
                context.setLineDash(extDashPanel);
                canvasDrawExtensionDashed(context, startXScreen, yStartP, startXScreen, labelY, rectScreenPanel);
                canvasDrawExtensionDashed(context, endXScreen, yEndP, endXScreen, labelY, rectScreenPanel);
                context.setLineDash([]);
                context.lineWidth = dimLineWPanel;
                context.beginPath();
                if (startXScreen < textLeft) {
                    context.moveTo(startXScreen, labelY);
                    context.lineTo(textLeft, labelY);
                }
                if (endXScreen > textRight) {
                    context.moveTo(textRight, labelY);
                    context.lineTo(endXScreen, labelY);
                }
                context.stroke();
                
                // Add to placed labels for future collision detection (use calculated bounds)
                placedLabels.push({
                    x: finalLabelBounds.x,
                    y: finalLabelBounds.y,
                    width: finalLabelBounds.width,
                    height: finalLabelBounds.height,
                    side: side,
                    text: text,
                    angle: angle,
                    type: 'panel'
                });
                 
                 // Collect for second pass if needed (use same bounds for consistency)
                 if (collectOnly) {
                     allPanelLabels.push({
                         x: finalLabelBounds.x,
                         y: finalLabelBounds.y,
                         width: finalLabelBounds.width,
                         height: finalLabelBounds.height,
                         side: side,
                         text: text,
                         angle: angle,
                         type: 'panel'
                     });
                 }
            } else {
                const spanLo = Math.min(myStart, myEnd);
                const spanHi = Math.max(myStart, myEnd);
                const baseOff = computeNearWallLabelOffsetPx(wall, scaleFactor, fontSize, textWidth, true);
                const trialOffset = Math.max(baseOff, DIMENSION_CONFIG.MIN_VERTICAL_OFFSET);
                const side1Bounds = calculateVerticalLabelBounds(
                    mxStart * scaleFactor + offsetX - trialOffset,
                    panelMidY * scaleFactor + offsetY,
                    textWidth,
                    2,
                    8
                );
                const side2Bounds = calculateVerticalLabelBounds(
                    mxStart * scaleFactor + offsetX + trialOffset,
                    panelMidY * scaleFactor + offsetY,
                    textWidth,
                    2,
                    8
                );
                const near = placeNearWallWallDimension({
                    wallForNear: wall,
                    wallMidX: panelMidX,
                    wallMidY: panelMidY,
                    isHorizontal: false,
                    modelBounds: bounds,
                    dimensionLanes,
                    scaleFactor,
                    offsetX,
                    offsetY,
                    fontSize,
                    textWidth,
                    placedLabels,
                    wallLinesMap,
                    rooms,
                    initialScale,
                    rotatedVerticalText: true,
                    calculateBounds: (lx, ly, tw) =>
                        calculateRotatedVerticalDimBounds(lx, ly, tw, fontSize),
                    side1Bounds,
                    side2Bounds,
                    baseOffset: baseOff,
                    wallLaneSpacing: DIMENSION_CONFIG.NEAR_WALL_LANE_SPACING,
                    spanLo,
                    spanHi
                });
                if (!near) {
                    accumulated += panelWidth;
                    continue;
                }
                const labelX = near.labelX;
                const labelY = near.labelY;
                const side = near.side;
                const finalLabelBounds = near.bounds;

                const textPadding = 2;
                const textTop = labelY - textWidth / 2 - textPadding;
                const textBottom = labelY + textWidth / 2 + textPadding;
                const rectScreenPanelV = modelBoundsToScreenRect(bounds, scaleFactor, offsetX, offsetY);
                const extDashPanelV = getCanvasExtensionDashPattern(scaleFactor);
                const extLineWPanelV = getCanvasExtensionLineWidth();
                const dimLineWPanelV = Math.max(1.2, DIMENSION_CONFIG.DIMENSION_LINE_WIDTH * 1.4);
                const xStartP = mxStart * scaleFactor + offsetX;
                const xEndP = mxEnd * scaleFactor + offsetX;
                const startYScreen = myStart * scaleFactor + offsetY;
                const endYScreen = myEnd * scaleFactor + offsetY;
                context.strokeStyle = specialColor;
                context.lineWidth = extLineWPanelV;
                context.setLineDash(extDashPanelV);
                canvasDrawExtensionDashed(context, xStartP, startYScreen, labelX, startYScreen, rectScreenPanelV);
                canvasDrawExtensionDashed(context, xEndP, endYScreen, labelX, endYScreen, rectScreenPanelV);
                context.setLineDash([]);
                context.lineWidth = dimLineWPanelV;
                context.beginPath();
                if (startYScreen < textTop) {
                    context.moveTo(labelX, startYScreen);
                    context.lineTo(labelX, textTop);
                }
                if (endYScreen > textBottom) {
                    context.moveTo(labelX, textBottom);
                    context.lineTo(labelX, endYScreen);
                }
                context.stroke();
                
                // Add to placed labels for future collision detection (use calculated bounds)
                placedLabels.push({
                    x: finalLabelBounds.x,
                    y: finalLabelBounds.y,
                    width: finalLabelBounds.width,
                    height: finalLabelBounds.height,
                    side: side,
                    text: text,
                    angle: angle,
                    type: 'panel'
                });
                 
                 // Collect for second pass if needed (use same bounds for consistency)
                 if (collectOnly) {
                     allPanelLabels.push({
                         x: finalLabelBounds.x,
                         y: finalLabelBounds.y,
                         width: finalLabelBounds.width,
                         height: finalLabelBounds.height,
                         side: side,
                         text: text,
                         angle: angle,
                         type: 'panel'
                     });
                 }
            }
        }
        
        accumulated += panelWidth;
    }
} 

// Helper to create label draw function (original simple style)
export function makeLabelDrawFn(label, scaleFactor, initialScale = 1) {
    return function(context) {
        context.save();
        const centerX = Number.isFinite(label.cx) ? label.cx : label.x + label.width / 2;
        const centerY = Number.isFinite(label.cy) ? label.cy : label.y + label.height / 2;
        if (label.type === 'wall' && label.obliqueAngle != null && !Number.isNaN(label.obliqueAngle)) {
            const fontSize = computeWallPlanDimensionFontSize(scaleFactor, initialScale);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            context.translate(centerX, centerY);
            context.rotate((label.obliqueAngle * Math.PI) / 180);
            const tw = context.measureText(label.text).width;
            const th = fontSize * 0.75;
            context.fillStyle = getPlanLabelBackground();
            context.fillRect(-tw / 2 - 2, -th / 2 - 1, tw + 4, th + 2);
            context.fillStyle = adjustPlanStrokeColor('#2196F3');
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label.text, 0, 0);
            context.restore();
            return;
        }
        if (label.angle && Math.abs(label.angle) > 45 && Math.abs(label.angle) < 135) {
            // Vertical (rotated) — axis-aligned vertical walls only (oblique handled above)
            context.translate(centerX, centerY);
            context.rotate(-Math.PI / 2);
            const defaultVerticalColor = label.type === 'panel' ? '#FF6B35' : '#2196F3';
            const fontSize = computeWallPlanDimensionFontSize(scaleFactor, initialScale);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            const twV = context.measureText(label.text).width;
            const thV = fontSize * 0.75;
            context.fillStyle = getPlanLabelBackground();
            context.fillRect(-twV / 2 - 2, -thV / 2 - 1, twV + 4, thV + 2);
            context.fillStyle = adjustPlanStrokeColor(
                label.textColor != null ? label.textColor : defaultVerticalColor
            );
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label.text, 0, 0);
        } else {
            // Horizontal
            const defaultHorizontalColor = label.type === 'panel' ? '#FF6B35' : '#2196F3';
            const horizontalTextColor = adjustPlanStrokeColor(
                label.textColor != null ? label.textColor : defaultHorizontalColor
            );
            const fontSize2 = computeWallPlanDimensionFontSize(scaleFactor, initialScale);
            context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize2}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
            const twH = context.measureText(label.text).width;
            const thH = fontSize2 * 0.75;
            if (label.type === 'wall' || label.textColor != null) {
                context.fillStyle = getPlanLabelBackground();
                context.fillRect(label.x, label.y, twH + 4, thH + 2);
            }
            context.fillStyle = horizontalTextColor;
            context.textAlign = 'left';
            context.textBaseline = 'top';
            context.fillText(label.text, label.x + 2, label.y + 2);
        }
        context.restore();
    };
} 