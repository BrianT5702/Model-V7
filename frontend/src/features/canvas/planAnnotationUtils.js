export const PLAN_NOTE_DEFAULT_SCREEN_WIDTH = 220;
export const PLAN_NOTE_DEFAULT_SCREEN_HEIGHT = 120;
export const PLAN_NOTE_MIN_SCREEN_SIZE = 48;
export const PLAN_NOTE_PLACEMENT_DRAG_THRESHOLD_PX = 5;

export function getDefaultPlanNoteBoxSizeMm(scaleFactor) {
    const safeScale = Math.max(scaleFactor, 0.001);
    return {
        box_width_mm: PLAN_NOTE_DEFAULT_SCREEN_WIDTH / safeScale,
        box_height_mm: PLAN_NOTE_DEFAULT_SCREEN_HEIGHT / safeScale,
    };
}

export function getPlanNoteBoxSizeMm(annotation, scaleFactor) {
    const defaults = getDefaultPlanNoteBoxSizeMm(scaleFactor);
    return {
        box_width_mm: annotation?.box_width_mm ?? defaults.box_width_mm,
        box_height_mm: annotation?.box_height_mm ?? defaults.box_height_mm,
    };
}

export function getPlanNoteBoxSizePx(annotation, scaleFactor) {
    const { box_width_mm, box_height_mm } = getPlanNoteBoxSizeMm(annotation, scaleFactor);
    return {
        width: box_width_mm * scaleFactor,
        height: box_height_mm * scaleFactor,
    };
}

export function buildPlanNoteFromPlacement(start, end, scaleFactor) {
    const dragPx = Math.hypot(
        (end.x - start.x) * scaleFactor,
        (end.y - start.y) * scaleFactor,
    );
    const defaults = getDefaultPlanNoteBoxSizeMm(scaleFactor);
    const safeScale = Math.max(scaleFactor, 0.001);
    const minWidthMm = PLAN_NOTE_MIN_SCREEN_SIZE / safeScale;
    const minHeightMm = PLAN_NOTE_MIN_SCREEN_SIZE / safeScale;

    if (dragPx < PLAN_NOTE_PLACEMENT_DRAG_THRESHOLD_PX) {
        return {
            position_x: start.x,
            position_y: start.y,
            box_width_mm: defaults.box_width_mm,
            box_height_mm: defaults.box_height_mm,
        };
    }

    return {
        position_x: Math.min(start.x, end.x),
        position_y: Math.min(start.y, end.y),
        box_width_mm: Math.max(minWidthMm, Math.abs(end.x - start.x)),
        box_height_mm: Math.max(minHeightMm, Math.abs(end.y - start.y)),
    };
}

export function getPlanNotePlacementRect(placement, scaleFactor, offsetX, offsetY) {
    if (!placement) {
        return null;
    }

    const box = buildPlanNoteFromPlacement(
        { x: placement.startX, y: placement.startY },
        { x: placement.currentX, y: placement.currentY },
        scaleFactor,
    );

    return {
        left: box.position_x * scaleFactor + offsetX,
        top: box.position_y * scaleFactor + offsetY,
        width: box.box_width_mm * scaleFactor,
        height: box.box_height_mm * scaleFactor,
    };
}
