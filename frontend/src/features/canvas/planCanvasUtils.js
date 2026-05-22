/** Fit/bounds helpers for Floor plan — constants aligned with CeilingCanvas. */

export const PLAN_CANVAS_DEFAULT_WIDTH = 1000;
export const PLAN_CANVAS_DEFAULT_HEIGHT = 720;
export const PLAN_CANVAS_ASPECT_RATIO = PLAN_CANVAS_DEFAULT_HEIGHT / PLAN_CANVAS_DEFAULT_WIDTH;
export const PLAN_CANVAS_MIN_WIDTH = 320;
export const PLAN_CANVAS_MIN_HEIGHT = 280;
export const PLAN_CANVAS_PADDING = 50;
export const PLAN_CANVAS_MAX_SCALE = 2.0;
/** Same 90% tight-fit factor as Canvas2D wall plan initial zoom. */
export const PLAN_INITIAL_FIT_FACTOR = 0.9;

/** Matches CeilingCanvas MAX_CANVAS_HEIGHT_RATIO (0.82). */
export function getPlanCanvasMaxHeightRatio() {
    return 0.82;
}

function isValidExtent(bounds) {
    return (
        bounds &&
        Number.isFinite(bounds.minX) &&
        Number.isFinite(bounds.maxX) &&
        Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxY) &&
        bounds.minX !== Infinity &&
        bounds.maxY !== -Infinity
    );
}

function mergeExtents(a, b) {
    if (!isValidExtent(a)) return b;
    if (!isValidExtent(b)) return a;
    return {
        minX: Math.min(a.minX, b.minX),
        maxX: Math.max(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY),
        maxY: Math.max(a.maxY, b.maxY)
    };
}

function extentsFromPoints(points) {
    if (!points || points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys)
    };
}

export function collectExtentsFromRooms(rooms) {
    if (!rooms || rooms.length === 0) return null;
    let merged = null;
    rooms.forEach((room) => {
        if (room?.room_points?.length > 0) {
            merged = mergeExtents(merged, extentsFromPoints(room.room_points));
        }
    });
    return merged;
}

/** Same bounds logic as CeilingCanvas projectBounds (rooms only, no zones). */
export function computePlanBoundsFromGeometry(rooms, projectData) {
    const hasRooms = rooms && rooms.length > 0;

    if (hasRooms) {
        const fromRooms = collectExtentsFromRooms(rooms);
        if (isValidExtent(fromRooms)) {
            return fromRooms;
        }
        if (projectData) {
            return {
                minX: 0,
                maxX: projectData.width,
                minY: 0,
                maxY: projectData.length
            };
        }
        return null;
    }

    if (projectData) {
        return {
            minX: 0,
            maxX: projectData.width,
            minY: 0,
            maxY: projectData.length
        };
    }

    return null;
}

export function computePlanFitTransform(
    canvasWidth,
    canvasHeight,
    bounds,
    {
        padding = PLAN_CANVAS_PADDING,
        maxScale = PLAN_CANVAS_MAX_SCALE
    } = {}
) {
    if (!isValidExtent(bounds)) {
        return {
            scale: 1,
            offsetX: canvasWidth / 2,
            offsetY: canvasHeight / 2
        };
    }

    const { minX, maxX, minY, maxY } = bounds;
    const totalWidth = maxX - minX || 1;
    const totalHeight = maxY - minY || 1;
    // Match wall plan (Canvas2D): 2× padding per axis, 90% of fit, capped at maxScale
    const availableWidth = Math.max(canvasWidth - 2 * padding, 1);
    const availableHeight = Math.max(canvasHeight - 2 * padding, 1);
    const fitScale = Math.min(availableWidth / totalWidth, availableHeight / totalHeight);
    const scale = Math.min(maxScale, fitScale * PLAN_INITIAL_FIT_FACTOR);
    const scaledWidth = totalWidth * scale;
    const scaledHeight = totalHeight * scale;
    const offsetX = (canvasWidth - scaledWidth) / 2 - minX * scale;
    const offsetY = (canvasHeight - scaledHeight) / 2 - minY * scale;

    return { scale, offsetX, offsetY };
}
