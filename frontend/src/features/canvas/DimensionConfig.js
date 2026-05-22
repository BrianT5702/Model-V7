// Shared configuration for dimension placement across floor and ceiling plans
// This ensures consistent spacing and appearance

export const DIMENSION_CONFIG = {
    // Spacing and positioning
    BASE_OFFSET: 5,               // Base distance from model boundary (px) - for large dimensions
    BASE_OFFSET_SMALL: 3,         // Legacy small-dimension fallback (px)
    BASE_OFFSET_NEAR_WALL: 12,    // Minimum screen offset for labels beside a wall (px)
    NEAR_WALL_CLEARANCE_MM: 12,   // Gap past wall face in model mm (keep label close to wall)
    NEAR_WALL_FONT_SCALE: 0.68,    // Smaller text for near-wall / panel dimensions
    NEAR_WALL_LANE_SPACING: 7,     // Row spacing when spreading across top/bottom/left/right
    NEAR_WALL_NUDGE_MM: 30,        // Used only for non-near-wall fallback nudging (mm)
    PROJECT_BASE_OFFSET: 14,      // Minimum distance for project dimensions when no wall dims on edge (px)
    PROJECT_OUTER_GAP_AFTER_WALLS: 8, // Project row sits outside outermost wall row by at least this (px)
    OFFSET_INCREMENT: 6,          // Increment when overlap detected (px)
    PROJECT_OFFSET_INCREMENT: 10, // Increment for project dimensions (px) - more aggressive
    MIN_VERTICAL_OFFSET: 8,       // Minimum offset for vertical dimensions (px)
    MIN_VERTICAL_OFFSET_SMALL: 5, // Minimum offset for small vertical dimensions (px)
    PROJECT_MIN_VERTICAL_OFFSET: 18, // Minimum offset for project vertical dimensions (px)
    MAX_ATTEMPTS: 8,              // Maximum collision resolution attempts
    LANE_SPACING: 4,              // Extra row step for near-wall / panel lane stacking (px)
    WALL_EXTERNAL_LANE_SPACING: 12, // Separate rows for full wall dims on the same edge (px)
    PLAN_GROUPED_LANE_SPACING: 10,  // Ceiling/floor grouped panel dimension rows (px)
    PLAN_INNER_LANE_SPACING: 8,     // Individual / cut panel dimension rows (px)
    PLAN_EXTERIOR_SEP_MM: 10,       // Label must clear project envelope by this (mm)
    SPAN_LANE_GAP_MM: 80,           // Min gap along edge before spans need separate rows
    PLAN_ROOM_MAX_OFFSET: 48,       // Max px from project edge — room tier
    PLAN_GROUPED_MAX_OFFSET: 36,    // Max px from project edge — grouped tier
    PLAN_INNER_MAX_OFFSET: 28,      // Max px from project edge — individual/cut tier
    PDF_PLAN_BASE_OFFSET: 14,       // Minimum exterior offset for plan PDF labels (px)
    PDF_PLAN_OFFSET_INCREMENT: 9,   // PDF collision nudge step (px)
    PDF_PLAN_LABEL_SEPARATION: 6,   // Min gap between PDF plan label boxes (px)
    LABEL_MIN_SEPARATION: 4,      // Minimum gap between dimension text boxes (px)
    PROJECT_MAX_ATTEMPTS: 15,     // Maximum attempts for project dimensions
    SMALL_DIMENSION_THRESHOLD: 0.15, // Dimension is "small" if < 5% of project size
    
    // Appearance - Dimensions
    FONT_SIZE: 200,               // Dimension text scaling multiplier - matches wall plan
    FONT_SIZE_MIN: 12,             // Minimum font size when scaled down
    FONT_FAMILY: "'Segoe UI', Arial, sans-serif",  // Modern font with fallbacks
    FONT_WEIGHT: 'normal',          // Font weight for dimensions
    LINE_WIDTH: 1,              // Extension line width (px)
    DIMENSION_LINE_WIDTH: 1,      // Main dimension line width (px)
    // Legacy fallback; wall plan canvas uses getCanvasExtensionDashPattern(scaleFactor) to match pdfVectorWallPlan
    EXTENSION_DASH: [5, 5],
    BACKGROUND_OPACITY: 1,     // Text background opacity
    LABEL_PADDING_H: 4,           // Horizontal label padding (px) - smaller box width
    LABEL_PADDING_V: 6,           // Vertical label padding (px) - smaller box height
    LABEL_BORDER_WIDTH: 1,        // Label border width (px)
    
    // Appearance - General Drawing
    GRID_LINE_WIDTH: 1,           // Grid line width
    GRID_LINE_WIDTH_ACTIVE: 0.9,  // Grid line width when drawing
    WALL_LINE_WIDTH: 1,           // Wall line width
    WALL_CAP_LINE_WIDTH: 1,     // Wall cap line width
    PARTITION_LINE_WIDTH: 1,    // Partition slash line width
    ROOM_PREVIEW_LINE_WIDTH: 2,   // Room preview line width
    ROOM_PREVIEW_DASH: [3, 5],    // Room preview dash pattern
    ENDPOINT_SIZE: 2,             // Normal endpoint circle size
    ENDPOINT_SIZE_HOVER: 3,       // Hovered endpoint circle size
    
    // Colors for different dimension types
    COLORS: {
        WALL: '#2196F3',          // Blue for wall dimensions (2D/wall plan)
        PANEL: '#FF6B35',         // Orange for panel dimensions (2D/wall plan)
        PROJECT: '#8B5CF6',       // Purple for overall project dimensions
        ROOM: '#1e40af',          // Dark blue for room dimensions (ceiling/floor plan)
        PANEL_GROUP: '#6b7280',   // GREY for panel dimensions - matches legend! (ceiling/floor plan)
        CUT_PANEL: '#dc2626',     // Red for cut panel dimensions (ceiling/floor plan)
        SELECTED: 'red',          // Red for selected elements
        GRID: '#ddd',             // Grid color (inactive)
        GRID_ACTIVE: '#a0a0a0',   // Grid color (active/drawing)
        ROOM_PREVIEW: 'rgba(0, 123, 255, 0.8)',      // Room preview outline
        ROOM_PREVIEW_FILL: 'rgba(0, 123, 255, 0.2)', // Room preview fill
        ENDPOINT: 'blue',         // Endpoint color
        ENDPOINT_HOVER: '#FF5722', // Hovered endpoint color
        PARTITION: '#666'         // Partition slash color
    },
    
    // Priority levels (lower number = higher priority, drawn first)
    PRIORITY: {
        PROJECT: 0,               // Highest - Overall project dimensions
        ROOM: 1,                  // Room dimensions
        WALL: 2,                  // Wall dimensions
        PANEL_GROUP: 3,           // Grouped panel dimensions
        PANEL: 4,                 // Individual panel dimensions
        CUT_PANEL: 5              // Lowest - Cut panel dimensions
    }
};

/** Rounded dimension value for canvas/PDF labels (unit implied by drawing standard). */
export function formatDimensionValue(lengthMm) {
    const n = Math.round(Number(lengthMm));
    return Number.isFinite(n) ? `${n}` : '';
}

/** Thin spaces around × (U+00D7) so grouped counts read clearly on canvas/PDF-style labels */
const GROUPED_DIM_SEP = '\u2009×\u2009';

/**
 * @param {number} quantity
 * @param {number} lengthMm
 * @returns {string} e.g. "12 × 1200" with thin spaces around ×
 */
export function formatGroupedDimensionLabel(quantity, lengthMm) {
    const q = Math.round(Number(quantity));
    const n = Math.round(Number(lengthMm));
    if (!Number.isFinite(n)) return '';
    if (!Number.isFinite(q) || q <= 1) return `${n}`;
    return `${q}${GROUPED_DIM_SEP}${n}`;
}

/**
 * Room / panel / cut dimension caption for ceiling & floor canvas (matches grouped semantics).
 * @param {{ type?: string, isCut?: boolean, quantity?: number }} dimension
 * @param {number} lengthMm
 */
export function formatPlanDimensionLabel(dimension, lengthMm) {
    const len = Math.round(Number(lengthMm));
    if (!Number.isFinite(len)) return '';
    if (dimension?.type === 'cut_panel' || dimension?.isCut) return `${len}`;
    const qty = dimension?.quantity != null ? Number(dimension.quantity) : NaN;
    if (Number.isFinite(qty) && qty > 1) return formatGroupedDimensionLabel(qty, len);
    return `${len}`;
}

/**
 * De-duplication key so room vs grouped vs individual dims with the same mm value can all appear when appropriate.
 * Pass optional `dedupId` (e.g. panel id) on individual/cut dimensions.
 */
/** Fresh lane counters — reset at the start of each canvas redraw. */
export function createDimensionLaneCounters() {
    return {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        _spanLanes: { top: [], bottom: [], left: [], right: [] }
    };
}

function spanIntervalsOverlap(lo, hi, intervals, gapMm) {
    return intervals.some(
        ({ min, max }) => lo < max + gapMm && hi > min - gapMm
    );
}

/** Tracks max screen offset used per edge while drawing wall dimensions. */
export function createDimensionEdgeExtents() {
    return { top: 0, bottom: 0, left: 0, right: 0 };
}

export function recordDimensionEdgeExtent(edgeExtents, edge, offsetPx) {
    if (!edgeExtents || !edge) return;
    edgeExtents[edge] = Math.max(edgeExtents[edge] ?? 0, offsetPx);
}

/** Place project-wide dimensions outside the outermost wall dimension row on that edge. */
export function getProjectDimensionOffsetForEdge(edgeExtents, edge, baseOffset) {
    const wallMax = edgeExtents?.[edge] ?? 0;
    const gap = DIMENSION_CONFIG.PROJECT_OUTER_GAP_AFTER_WALLS;
    return Math.max(baseOffset, wallMax + gap);
}

/** Measure how far labels (wall/panel) already sit outside the building bbox (screen px). */
export function syncEdgeExtentsFromPlacedLabels(
    edgeExtents,
    placedLabels,
    clipBoundsModel,
    scaleFactor,
    offsetX,
    offsetY
) {
    if (!edgeExtents || !clipBoundsModel || !placedLabels?.length) return;
    const { minX, maxX, minY, maxY } = clipBoundsModel;
    const topEdge = minY * scaleFactor + offsetY;
    const bottomEdge = maxY * scaleFactor + offsetY;
    const leftEdge = minX * scaleFactor + offsetX;
    const rightEdge = maxX * scaleFactor + offsetX;

    for (const lb of placedLabels) {
        if (lb.type !== 'wall' && lb.type !== 'panel') continue;
        const l = lb.x;
        const r = lb.x + lb.width;
        const t = lb.y;
        const b = lb.y + lb.height;
        const topOut = topEdge - b;
        if (topOut > 0) edgeExtents.top = Math.max(edgeExtents.top, topOut);
        const bottomOut = t - bottomEdge;
        if (bottomOut > 0) edgeExtents.bottom = Math.max(edgeExtents.bottom, bottomOut);
        const leftOut = leftEdge - r;
        if (leftOut > 0) edgeExtents.left = Math.max(edgeExtents.left, leftOut);
        const rightOut = l - rightEdge;
        if (rightOut > 0) edgeExtents.right = Math.max(edgeExtents.right, rightOut);
    }
}

export function getDimensionEdge(isHorizontal, side) {
    if (isHorizontal) {
        return side === 'side2' ? 'bottom' : 'top';
    }
    return side === 'side2' ? 'right' : 'left';
}

/**
 * Assign a dimension row on a project edge. When spanMin/spanMax are given (model mm along the
 * edge), non-overlapping spans share the same row; only overlapping extension lines get a new row.
 * @param {number} [spanMin] - span start along edge (model X for horizontal, Y for vertical)
 * @param {number} [spanMax] - span end along edge
 * @param {number} [laneSpacing] - px between rows; use WALL_EXTERNAL_LANE_SPACING for full wall dims
 */
export function consumeDimensionLane(
    lanes,
    isHorizontal,
    side,
    baseOffset,
    laneSpacing,
    spanMin = null,
    spanMax = null
) {
    if (!lanes) return baseOffset;
    const edge = getDimensionEdge(isHorizontal, side);
    const spacing = laneSpacing ?? DIMENSION_CONFIG.LANE_SPACING;

    const hasSpan =
        spanMin != null &&
        spanMax != null &&
        Number.isFinite(spanMin) &&
        Number.isFinite(spanMax);

    if (hasSpan) {
        if (!lanes._spanLanes) {
            lanes._spanLanes = { top: [], bottom: [], left: [], right: [] };
        }
        const lo = Math.min(spanMin, spanMax);
        const hi = Math.max(spanMin, spanMax);
        const gap = DIMENSION_CONFIG.SPAN_LANE_GAP_MM;
        const edgeLanes = lanes._spanLanes[edge];
        let laneIndex = 0;
        for (; laneIndex < edgeLanes.length; laneIndex++) {
            if (!spanIntervalsOverlap(lo, hi, edgeLanes[laneIndex], gap)) {
                break;
            }
        }
        if (laneIndex >= edgeLanes.length) {
            edgeLanes.push([]);
        }
        edgeLanes[laneIndex].push({ min: lo, max: hi });
        lanes[edge] = Math.max(lanes[edge] ?? 0, laneIndex + 1);
        return baseOffset + laneIndex * spacing;
    }

    const stackedOffset = baseOffset + (lanes[edge] ?? 0) * spacing;
    lanes[edge] = (lanes[edge] ?? 0) + 1;
    return stackedOffset;
}

/** Stack near-wall labels on a specific plan edge (top | bottom | left | right). */
export function consumeDimensionLaneByEdge(lanes, edge, baseOffset, laneSpacing) {
    if (!lanes || !edge) return baseOffset;
    const spacing = laneSpacing ?? DIMENSION_CONFIG.NEAR_WALL_LANE_SPACING;
    const stackedOffset = baseOffset + (lanes[edge] ?? 0) * spacing;
    lanes[edge] = (lanes[edge] ?? 0) + 1;
    return stackedOffset;
}

/** Lane/base offset for ceiling & floor plan dimensions by priority tier. */
export function getPlanDimensionLaneConfig(priority) {
    const p = priority ?? DIMENSION_CONFIG.PRIORITY.PANEL;
    if (p <= DIMENSION_CONFIG.PRIORITY.ROOM) {
        return {
            baseOffset: 10,
            laneSpacing: DIMENSION_CONFIG.PLAN_GROUPED_LANE_SPACING + 2,
            maxOffset: DIMENSION_CONFIG.PLAN_ROOM_MAX_OFFSET
        };
    }
    if (p <= DIMENSION_CONFIG.PRIORITY.PANEL_GROUP) {
        return {
            baseOffset: 8,
            laneSpacing: DIMENSION_CONFIG.PLAN_GROUPED_LANE_SPACING,
            maxOffset: DIMENSION_CONFIG.PLAN_GROUPED_MAX_OFFSET
        };
    }
    return {
        baseOffset: DIMENSION_CONFIG.BASE_OFFSET_SMALL,
        laneSpacing: DIMENSION_CONFIG.PLAN_INNER_LANE_SPACING,
        maxOffset: DIMENSION_CONFIG.PLAN_INNER_MAX_OFFSET
    };
}

/** side1 = top/left, side2 = bottom/right — nearest project edge to the measured feature. */
export function getPlanExteriorSide(isHorizontal, anchorX, anchorY, planBounds) {
    const { minX, maxX, minY, maxY } = planBounds;
    if (isHorizontal) {
        return anchorY - minY <= maxY - anchorY ? 'side1' : 'side2';
    }
    return anchorX - minX <= maxX - anchorX ? 'side1' : 'side2';
}

export function isLabelOutsidePlanArea(
    labelBounds,
    planBounds,
    scaleFactor,
    offsetX,
    offsetY,
    minSeparationMm = DIMENSION_CONFIG.PLAN_EXTERIOR_SEP_MM
) {
    if (!planBounds || !labelBounds) return true;
    const mm = {
        minX: (labelBounds.x - offsetX) / scaleFactor,
        maxX: (labelBounds.x + labelBounds.width - offsetX) / scaleFactor,
        minY: (labelBounds.y - offsetY) / scaleFactor,
        maxY: (labelBounds.y + labelBounds.height - offsetY) / scaleFactor
    };
    const sep = minSeparationMm;
    return (
        mm.maxX < planBounds.minX - sep ||
        mm.minX > planBounds.maxX + sep ||
        mm.maxY < planBounds.minY - sep ||
        mm.minY > planBounds.maxY + sep
    );
}

/** Label on a project-edge row; span center follows the panel group or dimension line. */
export function computeExteriorPlanLabelCoords(
    isHorizontal,
    side,
    offsetPx,
    planBounds,
    spanMidX,
    spanMidY,
    scaleFactor,
    offsetX,
    offsetY
) {
    const { minX, maxX, minY, maxY } = planBounds;
    const sf = scaleFactor;
    if (isHorizontal) {
        return {
            labelX: spanMidX * sf + offsetX,
            labelY: side === 'side1' ? minY * sf + offsetY - offsetPx : maxY * sf + offsetY + offsetPx
        };
    }
    return {
        labelX: side === 'side1' ? minX * sf + offsetX - offsetPx : maxX * sf + offsetX + offsetPx,
        labelY: spanMidY * sf + offsetY
    };
}

export function planDimensionDedupKey(dimension, lengthMm) {
    const len = Math.round(Number(lengthMm));
    const type = dimension?.type || 'dim';
    const room =
        dimension?.roomId != null && String(dimension.roomId) !== 'unknown'
            ? String(dimension.roomId)
            : 'proj';
    const qty =
        dimension?.quantity != null && Number(dimension.quantity) > 1
            ? Math.round(Number(dimension.quantity))
            : 0;
    const extra = dimension?.dedupId != null ? String(dimension.dedupId) : '';
    return `${type}|${room}|${len}|${qty}|${extra}`;
}

/**
 * Ceiling canvas: at most one dimension label per rounded mm value per axis
 * (horizontal vs vertical) for the entire plan — room, grouped, individual, and cut
 * share the same bucket so "1150" is not drawn twice.
 */
export function planCeilingValueDedupKey(lengthMm, isHorizontal) {
    const len = Math.round(Number(lengthMm));
    if (!Number.isFinite(len)) return null;
    return `${isHorizontal ? 'H' : 'V'}:${len}`;
}

