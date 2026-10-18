// Shared "which face of this wall is the interior" rule.
//
// The 2D plan resolves this per wall in drawWalls: 45_cut joints force the side, otherwise a
// room-polygon probe decides, with partitions/multi-room walls falling back to room-mass
// scoring. The 3D builder used to assume the interior was simply "toward the model center",
// so doors on partitions, concave plans, and mitred step runs were mounted and swung on the
// opposite face from the plan symbol.
//
// Rather than restate those heuristics (they drift), this asks `calculateOffsetPoints` for
// the same line1/line2 the plan draws and reports which side line2 — the inner face —
// landed on.

import {
    calculateOffsetPoints,
    buildWallOffsetOptions,
    resolve45CutForceShouldFlip,
    getRoomsLinkedToWall,
} from './drawing.js';

/**
 * Unit normal in model space (mm) pointing at the wall's interior face (`line2` in the plan).
 *
 * @param {object} wall — needs start_x/start_y/end_x/end_y, thickness, application_type
 * @param {object[]} rooms — project rooms (room_points / walls)
 * @param {{x: number, y: number}|null} centerModel — plan center in model mm, used only when
 *   no room context resolves the side (the legacy 3D behaviour)
 * @param {{intersections?: object[], allWalls?: object[]}} [jointContext] — enables the
 *   45_cut override that takes priority in the plan
 * @returns {{x: number, y: number}|null} null when the wall is degenerate
 */
export function getWallInteriorNormalModel(wall, rooms, centerModel = null, jointContext = null) {
    if (!wall) return null;

    const startX = Number(wall.start_x) || 0;
    const startY = Number(wall.start_y) || 0;
    const endX = Number(wall.end_x) || 0;
    const endY = Number(wall.end_y) || 0;
    const dx = endX - startX;
    const dy = endY - startY;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return null;

    // Same normal convention as calculateOffsetPoints.
    const normalX = dy / length;
    const normalY = -dx / length;
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;

    const roomList = Array.isArray(rooms) ? rooms : [];
    const offsetOpts = buildWallOffsetOptions(wall, roomList) || {};

    // 45_cut joints win over every room heuristic, matching drawWalls' forced flip and its
    // later "final role enforcement" pass.
    const forcedFlip = resolve45CutForceShouldFlip(
        wall,
        jointContext?.intersections || [],
        jointContext?.allWalls || []
    );
    if (typeof forcedFlip === 'boolean') {
        offsetOpts.forceShouldFlip = forcedFlip;
    }

    // Shared/partition walls: both sides probe as "inside", so the plan skips the probe and
    // leans on room-mass scoring instead.
    const isPartition = String(wall.application_type || '').toLowerCase() === 'partition';
    if (isPartition || getRoomsLinkedToWall(wall, roomList).length >= 2) {
        offsetOpts.skipPolygonProbe = true;
    }

    // Only the direction matters here, so work in model units (scaleFactor = 1).
    const { line2 } = calculateOffsetPoints(
        startX,
        startY,
        endX,
        endY,
        Number(wall.thickness) || 100,
        centerModel || { x: midX + normalX, y: midY + normalY },
        1,
        offsetOpts
    );
    if (!line2?.[0] || !line2?.[1]) return { x: normalX, y: normalY };

    const line2MidX = (line2[0].x + line2[1].x) / 2;
    const line2MidY = (line2[0].y + line2[1].y) / 2;
    const dot = normalX * (line2MidX - midX) + normalY * (line2MidY - midY);
    return dot > 0 ? { x: normalX, y: normalY } : { x: -normalX, y: -normalY };
}

/**
 * Cut L opens toward the ceiling. The wall solid's +Z points at the model
 * center, which is the wrong face on a shared wall whose room is on the
 * other side. True means the rebate stays on +Z (the original cut).
 */
export function cutLRebateFacesPositiveZ(interiorNormal, thicknessNormal) {
    if (!interiorNormal || !thicknessNormal) return true;
    return interiorNormal.x * thicknessNormal.x + interiorNormal.y * thicknessNormal.y >= 0;
}

/**
 * Unit normal of the 3D wall solid's +Z, in plan mm. That is the perpendicular
 * of the wall line that points at the model center — the side the thickness
 * is extruded toward. `centerModel` is {x, y} in the same mm space as the wall.
 */
export function thicknessNormalTowardModelCenter(wall, centerModel) {
    if (!wall) return null;
    const x0 = Number(wall.start_x) || 0;
    const y0 = Number(wall.start_y) || 0;
    const x1 = Number(wall.end_x) || 0;
    const y1 = Number(wall.end_y) || 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    let nx = -dy / len;
    let ny = dx / len;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const cx = Number.isFinite(centerModel?.x) ? centerModel.x : mx + nx;
    const cy = Number.isFinite(centerModel?.y) ? centerModel.y : my + ny;
    if (nx * (cx - mx) + ny * (cy - my) < 0) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}
