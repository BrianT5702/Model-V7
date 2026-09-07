/**
 * Shared ceiling/floor plan dimension drawing (canvas placement).
 * Used by CeilingCanvas, FloorCanvas, and PDF export overlay.
 */

import {
    DIMENSION_CONFIG,
    formatPlanDimensionLabel,
    planCeilingValueDedupKey,
    comparePlanDimensionsDrawOrder,
    createDimensionLaneCounters,
    consumeDimensionLane,
    getPlanDimensionLaneConfig,
    getDimensionSpanForLane,
    getDimensionEdge,
    getPlanExteriorFixedColumnX,
    rememberPlanExteriorColumnX,
    applyPlanOuterTierMinOffset,
    recordPlanInnerTierMaxOffset
} from './DimensionConfig';
import {
    computeWallPlanDimensionFontSize,
    resolveWallExteriorPlacementSide,
    placeExteriorWallDimensionAvoidingLabels,
    drawOrthoPlanDimensionGeometryLikeWall,
    insetBoundsToInnerFaces
} from './drawing';
import {
    hasLabelOverlap,
    calculateHorizontalLabelBounds,
    calculateRotatedVerticalDimBounds,
    exteriorVerticalTextCenterX,
    buildVerticalPlanLabelEntry,
    overlapsDimensionText
} from './collisionDetection';

/**
 * Ceiling/floor plan labels: text only (no white background box). Matches on-screen canvas appearance.
 */
export function makePlanDimensionLabelDrawFn(label, scaleFactor, initialScale = 1) {
    return function (context) {
        context.save();
        const color = label.textColor || DIMENSION_CONFIG.COLORS.PANEL_GROUP;
        const fontSize = computeWallPlanDimensionFontSize(scaleFactor, initialScale);
        context.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;

        if (label.angle && Math.abs(label.angle) > 45 && Math.abs(label.angle) < 135) {
            const centerX = label.x + label.width / 2;
            const centerY = label.y + label.height / 2;
            context.translate(centerX, centerY);
            context.rotate(-Math.PI / 2);
            context.fillStyle = color;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label.text, 0, 0);
        } else {
            context.fillStyle = color;
            context.textAlign = 'left';
            context.textBaseline = 'top';
            context.fillText(label.text, label.x + 2, label.y + 2);
        }
        context.restore();
    };
}

export function getPlanDimensionOrientation(dimension) {
    if (dimension.isHorizontal !== undefined) return dimension.isHorizontal;
    const dx = dimension.endX - dimension.startX;
    const dy = dimension.endY - dimension.startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return Math.abs(angle) < 45 || Math.abs(angle) > 135;
}

/**
 * Ceiling plan dimension (matches CeilingCanvas.drawCeilingDimension).
 */
export function drawCeilingPlanDimensionOnContext(
    ctx,
    dimension,
    bounds,
    placedLabels,
    allLabels,
    dimensionLanes,
    state
) {
    const { startX, endX, startY, endY, dimension: length, type, color, priority, avoidArea } = dimension;
    const isHorizontal = getPlanDimensionOrientation(dimension);
    const dedupKey =
        !dimension.skipValueDedup && typeof length === 'number'
            ? planCeilingValueDedupKey(length, isHorizontal)
            : null;
    if (dedupKey && state.dimensionValuesSeen?.has(dedupKey)) return;
    if (dedupKey) state.dimensionValuesSeen?.add(dedupKey);

    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const dimensionKey = `${startX.toFixed(2)}_${startY.toFixed(2)}_${endX.toFixed(2)}_${endY.toFixed(2)}_${type || 'default'}`;

    const fontSize = computeWallPlanDimensionFontSize(state.scaleFactor, state.initialScale);
    const previousFont = ctx.font;
    ctx.font = `${DIMENSION_CONFIG.FONT_WEIGHT} ${fontSize}px ${DIMENSION_CONFIG.FONT_FAMILY}`;
    const text = formatPlanDimensionLabel(dimension, length);
    const textWidth = ctx.measureText(text).width;

    const planBounds = avoidArea || bounds;
    const gb = dimension.groupBounds;
    const spanMidX = gb ? (gb.minX + gb.maxX) / 2 : midX;
    const spanMidY = gb ? (gb.minY + gb.maxY) / 2 : midY;

    const laneCfg = getPlanDimensionLaneConfig(priority);
    const wallLikeSpacing = DIMENSION_CONFIG.WALL_EXTERNAL_LANE_SPACING;
    const { lo: spanLo, hi: spanHi } = getDimensionSpanForLane(dimension, isHorizontal);
    const sf = state.scaleFactor;
    const ox = state.offsetX;
    const oy = state.offsetY;
    const padH = 2;
    const padV = 8;

    // Same as wall plan: nearest project edge only. Never flip a top-edge
    // dimension onto the bottom of the site (or left onto right) when a row is busy.
    const side = planBounds
        ? resolveWallExteriorPlacementSide({
              isHorizontal,
              wallMidX: spanMidX,
              wallMidY: spanMidY,
              modelBounds: planBounds,
              dimensionLanes
          })
        : 'side1';

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

    let labelX;
    let labelY;
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
            fontSize,
            lockRow: true
        });
        if (!placed) {
            ctx.font = previousFont;
            return;
        }
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

    state.placementMemory?.set(dimensionKey, { side });

    const dxLine = endX - startX;
    const dyLine = endY - startY;
    const angleDeg = Math.atan2(dyLine, dxLine) * (180 / Math.PI);
    const startXScreen = startX * sf + ox;
    const endXScreen = endX * sf + ox;
    const startYScreen = startY * sf + oy;
    const endYScreen = endY * sf + oy;
    if (isHorizontal) {
        labelX = (startXScreen + endXScreen) / 2;
    } else {
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

    const cw = state.canvasWidth ?? 1e6;
    const ch = state.canvasHeight ?? 1e6;
    const isValidPosition =
        wallStyleBounds.x >= 0 &&
        wallStyleBounds.y >= 0 &&
        wallStyleBounds.x + wallStyleBounds.width <= cw &&
        wallStyleBounds.y + wallStyleBounds.height <= ch;
    if (!isValidPosition) {
        ctx.font = previousFont;
        return;
    }

    if (
        type?.startsWith('alu_rail_') &&
        hasLabelOverlap(wallStyleBounds, placedLabels, DIMENSION_CONFIG.LABEL_MIN_SEPARATION)
    ) {
        ctx.font = previousFont;
        return;
    }

    const clipBounds = insetBoundsToInnerFaces(bounds, state.walls);
    drawOrthoPlanDimensionGeometryLikeWall(
        ctx,
        { startX, startY, endX, endY, isHorizontal, labelX, labelY, textWidth, color },
        sf,
        ox,
        oy,
        clipBounds
    );

    if (
        isFinite(wallStyleBounds.x) &&
        isFinite(wallStyleBounds.y) &&
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

    if (!overlapsDimensionText(wallStyleBounds, allLabels, DIMENSION_CONFIG.LABEL_MIN_SEPARATION)) {
        if (isHorizontal) {
            allLabels.push({
                x: wallStyleBounds.x,
                y: wallStyleBounds.y,
                width: wallStyleBounds.width,
                height: wallStyleBounds.height,
                cx: labelX,
                cy: labelY,
                side: dimSide,
                text,
                angle: angleDeg,
                type: 'plan',
                textColor: color
            });
        } else {
            allLabels.push(
                buildVerticalPlanLabelEntry(labelX, labelY, textWidth, fontSize, dimSide, text, angleDeg, {
                    type: 'plan',
                    textColor: color
                })
            );
        }
    }
    ctx.font = previousFont;
}

/** Floor plan uses the same exterior placement rules as ceiling (shared with export). */
export function drawFloorPlanDimensionOnContext(ctx, dimension, bounds, placedLabels, allLabels, dimensionLanes, state) {
    return drawCeilingPlanDimensionOnContext(ctx, dimension, bounds, placedLabels, allLabels, dimensionLanes, state);
}

/**
 * Sort and draw collected plan dimensions + label pass (matches ceiling/floor canvas).
 */
export function drawCollectedPlanDimensionsOnContext(ctx, dimensionsToDraw, _kind, state) {
    const placedLabels = [];
    const allLabels = [];
    const dimensionLanes = createDimensionLaneCounters();

    dimensionsToDraw.sort((a, b) =>
        comparePlanDimensionsDrawOrder(a, b, (entry) => getPlanDimensionOrientation(entry.dimension))
    );

    dimensionsToDraw.forEach(({ dimension, bounds }) => {
        drawCeilingPlanDimensionOnContext(ctx, dimension, bounds, placedLabels, allLabels, dimensionLanes, state);
    });

    allLabels.forEach((label) => {
        const drawLabel =
            label.draw ||
            makePlanDimensionLabelDrawFn(label, state.scaleFactor, state.initialScale);
        drawLabel(ctx);
    });
}
