// Shared configuration for dimension placement across floor and ceiling plans
// This ensures consistent spacing and appearance

export const DIMENSION_CONFIG = {
    // Spacing and positioning
    BASE_OFFSET: 5,               // Base distance from model boundary (px) - for large dimensions
    BASE_OFFSET_SMALL: 3,         // Legacy small-dimension fallback (px)
    BASE_OFFSET_NEAR_WALL: 6,     // Fallback minimum screen offset beside a wall (px)
    NEAR_WALL_CLEARANCE_MM: 6,    // Gap past wall face in model mm (keep label close to wall)
    NEAR_WALL_FONT_DELTA_PX: 1,    // Near-wall labels: 1px smaller than standard wall dim text
    NEAR_WALL_FONT_SCALE: 0.68,    // Legacy panel path fallback
    NEAR_WALL_LANE_SPACING: 4,     // Extra step only when exterior/interior side is blocked (px)
    NEAR_WALL_LOCAL_LABEL_RADIUS_PX: 90, // Legacy — near-wall overlap uses full placedLabels now
    NEAR_WALL_MAX_PLACEMENT_STEPS: 4,
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
    SPAN_LANE_GAP_MM: 80,           // Min gap between separated spans before a new row (touching ends share a row)
    SPAN_ENDPOINT_TOUCH_TOL_MM: 2, // End-to-end chain tolerance (model mm)
    PLAN_EXTERIOR_ROW_BASE: 10,    // Unified exterior row offset (px) — same for all tiers on one lane
    PLAN_EXTERIOR_ROW_SPACING: 10, // Row step between span lanes (px)
    PLAN_ROOM_EXTERIOR_BOOST: 10,  // Extra px so room/wall dims sit outside grouped panel rows on the same edge
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
    FONT_SIZE_MAX: 18,             // Maximum font size — prevents huge labels on small/zoomed-in projects
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
/** Near-wall dimension text: one pixel smaller than the standard dimension font at this zoom. */
export function applyNearWallFontSize(standardFontSize) {
    const n = Number(standardFontSize);
    if (!Number.isFinite(n)) return DIMENSION_CONFIG.FONT_SIZE_MIN;
    return Math.max(
        DIMENSION_CONFIG.FONT_SIZE_MIN,
        n - DIMENSION_CONFIG.NEAR_WALL_FONT_DELTA_PX
    );
}

/**
 * Looser label gap when zoomed out (smaller on screen); full separation when zoomed in.
 */
export function nearWallLabelSeparationPx(scaleFactor, initialScale) {
    const sf = Number(scaleFactor);
    const is0 = Number(initialScale);
    if (!Number.isFinite(sf) || !Number.isFinite(is0) || is0 <= 0) {
        return DIMENSION_CONFIG.LABEL_MIN_SEPARATION;
    }
    const zoomRatio = Math.min(1.25, Math.max(0.15, sf / is0));
    // Slightly looser when zoomed out, but always enforce a visible gap so overlaps hide
    return Math.max(2, DIMENSION_CONFIG.LABEL_MIN_SEPARATION * zoomRatio * 0.75);
}

/** Screen radius for near-wall overlap checks — scales with zoom. */
export function nearWallLocalLabelRadiusPx(scaleFactor, initialScale, textWidth = 40) {
    const sf = Number(scaleFactor);
    const is0 = Number(initialScale);
    const tw = Number(textWidth) || 40;
    const base = DIMENSION_CONFIG.NEAR_WALL_LOCAL_LABEL_RADIUS_PX;
    if (!Number.isFinite(sf) || !Number.isFinite(is0) || is0 <= 0) {
        return Math.max(base, tw * 2.5);
    }
    const zoomRatio = Math.min(1.25, Math.max(0.15, sf / is0));
    return Math.max(40, Math.min(200, base * zoomRatio * 0.75 + tw * 1.2));
}

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

/** Span along edge for lane assignment (line extent first, not full groupBounds). */
export function getDimensionSpanForLane(dimension, isHorizontal) {
    const tol = DIMENSION_CONFIG.SPAN_ENDPOINT_TOUCH_TOL_MM;
    if (isHorizontal) {
        const lo = Math.min(dimension.startX, dimension.endX);
        const hi = Math.max(dimension.startX, dimension.endX);
        if (hi - lo > tol) return { lo, hi };
    } else {
        const lo = Math.min(dimension.startY, dimension.endY);
        const hi = Math.max(dimension.startY, dimension.endY);
        if (hi - lo > tol) return { lo, hi };
    }
    return getDimensionSpanAlongEdge(dimension, isHorizontal);
}

/** Model-mm span along a horizontal or vertical exterior edge. */
export function getDimensionSpanAlongEdge(dimension, isHorizontal) {
    const gb = dimension?.groupBounds;
    if (isHorizontal) {
        if (gb) return { lo: gb.minX, hi: gb.maxX };
        return {
            lo: Math.min(dimension.startX, dimension.endX),
            hi: Math.max(dimension.startX, dimension.endX)
        };
    }
    if (gb) return { lo: gb.minY, hi: gb.maxY };
    return {
        lo: Math.min(dimension.startY, dimension.endY),
        hi: Math.max(dimension.startY, dimension.endY)
    };
}

/**
 * True when two spans cannot share a row: interior overlap, not chain touch or identical ends.
 */
function spansConflictForLane(lo, hi, min, max, gapMm) {
    const aLo = Math.min(lo, hi);
    const aHi = Math.max(lo, hi);
    const bMin = Math.min(min, max);
    const bMax = Math.max(min, max);
    const tol = DIMENSION_CONFIG.SPAN_ENDPOINT_TOUCH_TOL_MM;

    // Chain: one end meets the other's start (e.g. 10900 + 14900 + 26900)
    if (Math.abs(aLo - bMax) <= tol || Math.abs(aHi - bMin) <= tol) {
        return false;
    }
    // Same start and end
    if (Math.abs(aLo - bMin) <= tol && Math.abs(aHi - bMax) <= tol) {
        return false;
    }
    // Clearly separated along the edge
    if (aHi <= bMin - gapMm || aLo >= bMax + gapMm) {
        return false;
    }
    // Overlapping extension lines
    return aLo < bMax - tol && aHi > bMin + tol;
}

function spanIntervalsOverlap(lo, hi, intervals, gapMm) {
    return intervals.some(({ min, max }) => spansConflictForLane(lo, hi, min, max, gapMm));
}

/** Sort plan dims: outer priority tiers first, then left-to-right / bottom-to-top along edge. */
export function comparePlanDimensionsDrawOrder(entryA, entryB, getIsHorizontal) {
    const pa = entryA.dimension.priority ?? 99;
    const pb = entryB.dimension.priority ?? 99;
    if (pa !== pb) return pb - pa;
    const horizA = getIsHorizontal(entryA.dimension);
    const horizB = getIsHorizontal(entryB.dimension);
    if (horizA === horizB) {
        const spanA = getDimensionSpanAlongEdge(entryA.dimension, horizA);
        const spanB = getDimensionSpanAlongEdge(entryB.dimension, horizB);
        if (spanA.lo !== spanB.lo) return spanA.lo - spanB.lo;
        if (spanA.hi !== spanB.hi) return spanA.hi - spanB.hi;
    }
    return (entryA.dimension.dimension ?? 0) - (entryB.dimension.dimension ?? 0);
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
export function getProjectDimensionOffsetForEdge(
    edgeExtents,
    edge,
    baseOffset,
    scaleFactor = 1,
    initialScale = 1
) {
    const wallMax = edgeExtents?.[edge] ?? 0;
    let gap = DIMENSION_CONFIG.PROJECT_OUTER_GAP_AFTER_WALLS;
    if (
        Number.isFinite(scaleFactor) &&
        Number.isFinite(initialScale) &&
        initialScale > 0 &&
        scaleFactor > initialScale
    ) {
        const z = Math.min(2.5, scaleFactor / initialScale);
        gap = Math.max(gap, Math.round(gap * (0.65 + 0.35 * z)));
    }
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
        // Use full label box extent (not inner edge) so project row clears taller text when zoomed in
        const topOut = topEdge - t;
        if (topOut > 0) edgeExtents.top = Math.max(edgeExtents.top, topOut);
        const bottomOut = b - bottomEdge;
        if (bottomOut > 0) edgeExtents.bottom = Math.max(edgeExtents.bottom, bottomOut);
        const leftOut = leftEdge - l;
        if (leftOut > 0) edgeExtents.left = Math.max(edgeExtents.left, leftOut);
        const rightOut = r - rightEdge;
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
 * edge), non-overlapping spans and chain segments (shared start/end) share the same row.
 * @param {number} [spanMin] - span start along edge (model X for horizontal, Y for vertical)
 * @param {number} [spanMax] - span end along edge
 * @param {number} [laneSpacing] - px between rows; use WALL_EXTERNAL_LANE_SPACING for full wall dims
 * @param {number|null} [priority] - when ROOM (or higher tier), adds PLAN_ROOM_EXTERIOR_BOOST
 */
export function consumeDimensionLane(
    lanes,
    isHorizontal,
    side,
    baseOffset,
    laneSpacing,
    spanMin = null,
    spanMax = null,
    priority = null
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
        lanes._lastLaneIndex = laneIndex;
        lanes._lastEdge = edge;
        const rowBase = DIMENSION_CONFIG.PLAN_EXTERIOR_ROW_BASE;
        const rowSpacing = DIMENSION_CONFIG.PLAN_EXTERIOR_ROW_SPACING;
        let offset = rowBase + laneIndex * rowSpacing;
        if (priority != null && priority <= DIMENSION_CONFIG.PRIORITY.ROOM) {
            offset += DIMENSION_CONFIG.PLAN_ROOM_EXTERIOR_BOOST;
        }
        return offset;
    }

    let stackedOffset = baseOffset + (lanes[edge] ?? 0) * spacing;
    lanes[edge] = (lanes[edge] ?? 0) + 1;
    if (priority != null && priority <= DIMENSION_CONFIG.PRIORITY.ROOM) {
        stackedOffset += DIMENSION_CONFIG.PLAN_ROOM_EXTERIOR_BOOST;
    }
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

/** inner = grouped/panel rows; outer = room/project envelope (separate vertical columns). */
export function getPlanExteriorColumnStorageKey(vEdge, priority) {
    if (!vEdge) return null;
    const tier =
        priority != null && priority <= DIMENSION_CONFIG.PRIORITY.ROOM ? 'outer' : 'inner';
    return `${vEdge}:${tier}`;
}

export function getPlanExteriorFixedColumnX(dimensionLanes, vEdge, priority) {
    const key = getPlanExteriorColumnStorageKey(vEdge, priority);
    if (!key || !dimensionLanes?._wallExteriorLabelX) return null;
    const x = dimensionLanes._wallExteriorLabelX[key];
    return x != null && Number.isFinite(x) ? x : null;
}

export function rememberPlanExteriorColumnX(dimensionLanes, vEdge, priority, labelX) {
    const key = getPlanExteriorColumnStorageKey(vEdge, priority);
    if (!key || !Number.isFinite(labelX) || !dimensionLanes) return;
    if (!dimensionLanes._wallExteriorLabelX) {
        dimensionLanes._wallExteriorLabelX = {};
    }
    if (dimensionLanes._wallExteriorLabelX[key] == null) {
        dimensionLanes._wallExteriorLabelX[key] = labelX;
    }
}

/** Room-tier dims stay at least one row outside the innermost panel column on this edge. */
export function applyPlanOuterTierMinOffset(dimensionLanes, vEdge, priority, offsetPx) {
    if (priority == null || priority > DIMENSION_CONFIG.PRIORITY.ROOM || !vEdge) {
        return offsetPx;
    }
    const innerMax = dimensionLanes?._planInnerMaxOffsetPx?.[`${vEdge}:inner`];
    if (innerMax != null && Number.isFinite(innerMax)) {
        return Math.max(offsetPx, innerMax + DIMENSION_CONFIG.PLAN_EXTERIOR_ROW_SPACING);
    }
    return offsetPx;
}

export function recordPlanInnerTierMaxOffset(dimensionLanes, vEdge, priority, offsetPx) {
    if (priority != null && priority <= DIMENSION_CONFIG.PRIORITY.ROOM || !vEdge || !dimensionLanes) {
        return;
    }
    if (!dimensionLanes._planInnerMaxOffsetPx) {
        dimensionLanes._planInnerMaxOffsetPx = {};
    }
    const key = `${vEdge}:inner`;
    dimensionLanes._planInnerMaxOffsetPx[key] = Math.max(
        dimensionLanes._planInnerMaxOffsetPx[key] ?? 0,
        offsetPx
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

