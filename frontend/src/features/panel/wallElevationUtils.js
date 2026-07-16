/**
 * Whole-model orthographic elevations from the building geometry.
 *
 * Front View — looking along plan Y (horizontal axis = world X, vertical = elevation Z)
 * Side View  — looking along plan X (horizontal axis = world Y, vertical = elevation Z)
 *
 * All walls are projected as vertical massing faces and depth-sorted so nearer
 * façades sit in front (true whole-model elevation, not per-wall strips).
 */

function wallHeightMm(wall) {
    if (wall.fill_gap_mode && wall.gap_fill_height != null) {
        return Number(wall.gap_fill_height) || 0;
    }
    return Number(wall.height) || 0;
}

function resolveWallBaseElevationMm(wall, rooms = []) {
    if (wall.fill_gap_mode && wall.gap_base_position != null) {
        return Number(wall.gap_base_position) || 0;
    }
    if (wall.base_elevation_manual) {
        return Number(wall.base_elevation_mm) || 0;
    }

    const wallRoomIds = new Set(
        (Array.isArray(wall.rooms) ? wall.rooms : [])
            .map((r) => (typeof r === 'object' ? r?.id : r))
            .filter((id) => id != null)
            .map(String)
    );

    const bases = [];
    (rooms || []).forEach((room) => {
        const roomWalls = Array.isArray(room.walls) ? room.walls : [];
        const linked =
            wallRoomIds.has(String(room.id)) ||
            roomWalls.some((wid) => String(wid) === String(wall.id));
        if (linked && room.base_elevation_mm != null) {
            bases.push(Number(room.base_elevation_mm) || 0);
        }
    });

    if (bases.length > 0) return Math.min(...bases);
    return Number(wall.base_elevation_mm) || 0;
}

function doorWallId(door) {
    if (!door) return null;
    if (door.wall != null && typeof door.wall === 'object') return door.wall.id;
    return door.wall ?? door.wall_id ?? null;
}

function wallFacesView(wall, view) {
    const dx = Math.abs((Number(wall.end_x) || 0) - (Number(wall.start_x) || 0));
    const dy = Math.abs((Number(wall.end_y) || 0) - (Number(wall.start_y) || 0));
    // Front view looks along Y → walls running along X show true length
    if (view === 'front') return dx >= dy;
    // Side view looks along X → walls running along Y show true length
    return dy > dx;
}

/**
 * Build one projected wall face for a given view.
 */
function buildProjectedFace(wall, rooms, doors, view) {
    const x0 = Number(wall.start_x) || 0;
    const y0 = Number(wall.start_y) || 0;
    const x1 = Number(wall.end_x) || 0;
    const y1 = Number(wall.end_y) || 0;
    const z0 = resolveWallBaseElevationMm(wall, rooms);
    const z1 = z0 + wallHeightMm(wall);
    if (z1 - z0 < 1) return null;

    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const facesCamera = wallFacesView(wall, view);

    let u0;
    let u1;
    let depth;
    let isEdge = false;
    if (view === 'front') {
        u0 = Math.min(x0, x1);
        u1 = Math.max(x0, x1);
        depth = midY;
        // End-on walls: keep true U (no fake thickness) so overall width matches the plan
        if (u1 - u0 < 1) {
            u0 = midX;
            u1 = midX;
            isEdge = true;
        }
    } else {
        u0 = Math.min(y0, y1);
        u1 = Math.max(y0, y1);
        depth = midX;
        if (u1 - u0 < 1) {
            u0 = midY;
            u1 = midY;
            isEdge = true;
        }
    }

    const lengthAlong = Math.hypot(x1 - x0, y1 - y0) || 1;
    const openings = [];

    if (facesCamera) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        let flip = false;
        if (view === 'front' && dx < 0) flip = true;
        if (view === 'side' && dy < 0) flip = true;
        const alongT = (t) => (flip ? 1 - t : t);

        const wallDoors = (doors || []).filter((d) => String(doorWallId(d)) === String(wall.id));
        wallDoors.forEach((door) => {
            const doorW = Number(door.width) || 0;
            const doorH = Number(door.height) || 0;
            const t = alongT(Number(door.position_x) || 0.5);
            // Map door center along wall into projected U (world X or Y span)
            const along = t * lengthAlong;
            const worldX = x0 + (dx / lengthAlong) * along;
            const worldY = y0 + (dy / lengthAlong) * along;
            const centerU = view === 'front' ? worldX : worldY;
            openings.push({
                type: 'door',
                id: door.id,
                u0: centerU - doorW / 2,
                u1: centerU + doorW / 2,
                v0: z0,
                v1: z0 + doorH,
            });
        });

        const windows = Array.isArray(wall.windows) ? wall.windows : [];
        windows.forEach((win, wi) => {
            const winW = Number(win.width) || 0;
            const winH = Number(win.height) || 0;
            const t = alongT(Number(win.position_x) || 0.5);
            const along = t * lengthAlong;
            const worldX = x0 + (dx / lengthAlong) * along;
            const worldY = y0 + (dy / lengthAlong) * along;
            const centerU = view === 'front' ? worldX : worldY;
            const centerV = z0 + (Number(win.position_y) || 0.5) * (z1 - z0);
            openings.push({
                type: 'window',
                id: win.id ?? `w-${wall.id}-${wi}`,
                u0: centerU - winW / 2,
                u1: centerU + winW / 2,
                v0: centerV - winH / 2,
                v1: centerV + winH / 2,
            });
        });
    }

    return {
        wallId: wall.id,
        view,
        u0,
        u1,
        v0: z0,
        v1: z1,
        depth,
        facesCamera,
        isEdge,
        openings,
    };
}

function boundsOfFaces(faces) {
    if (!faces.length) {
        return { minU: 0, maxU: 1000, minV: 0, maxV: 3000 };
    }
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    faces.forEach((f) => {
        minU = Math.min(minU, f.u0, f.u1);
        maxU = Math.max(maxU, f.u0, f.u1);
        minV = Math.min(minV, f.v0, f.v1);
        maxV = Math.max(maxV, f.v0, f.v1);
    });
    if (!Number.isFinite(minU)) {
        return { minU: 0, maxU: 1000, minV: 0, maxV: 3000 };
    }
    return { minU, maxU, minV, maxV };
}

/**
 * Build whole-model Front + Side elevation data.
 * Prefer allWalls / all rooms / all doors so the full building is shown.
 */
export function buildWallElevations({
    walls = [],
    allWalls = null,
    doors = [],
    rooms = [],
} = {}) {
    const sourceWalls = (allWalls && allWalls.length > 0) ? allWalls : walls;

    const frontFaces = [];
    const sideFaces = [];

    sourceWalls.forEach((wall) => {
        if (!wall || wall.start_x == null || wall.end_x == null) return;
        const front = buildProjectedFace(wall, rooms, doors, 'front');
        const side = buildProjectedFace(wall, rooms, doors, 'side');
        if (front) frontFaces.push(front);
        if (side) sideFaces.push(side);
    });

    // Far → near: front looks from low Y (south), so larger depth drawn first
    frontFaces.sort((a, b) => b.depth - a.depth || a.wallId - b.wallId);
    // Side looks from low X (west), so larger depth drawn first
    sideFaces.sort((a, b) => b.depth - a.depth || a.wallId - b.wallId);

    return {
        generatedAt: Date.now(),
        front: {
            title: 'Front View',
            subtitle: 'Whole model · looking along plan Y (width = X)',
            faces: frontFaces,
            bounds: boundsOfFaces(frontFaces),
        },
        side: {
            title: 'Side View',
            subtitle: 'Whole model · looking along plan X (depth = Y)',
            faces: sideFaces,
            bounds: boundsOfFaces(sideFaces),
        },
        totals: {
            walls: sourceWalls.length,
            frontFaces: frontFaces.length,
            sideFaces: sideFaces.length,
        },
    };
}
