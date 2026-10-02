/** Covering width of one factory panel, in mm. */
export const MAX_WALL_PANEL_WIDTH = 1150;

/** A wall this short is a single panel with both ends shop-cut. */
export const MAX_BOTH_ENDS_CUT_WIDTH = 1110;

export function sidePanelLimits(wallHeight) {
    const tall = Number(wallHeight) >= 5000;
    return {
        minPanelWidth: tall ? 500 : 300,
        splitThreshold: tall ? 1000 : 600,
    };
}

/**
 * Panel-left / panel-right for a wall start or end.
 * Same direction rule as getWallPanelEndPoints.
 */
export function wallEndToPanelSide(wall, end) {
    const startX = Number(wall?.start_x) || 0;
    const startY = Number(wall?.start_y) || 0;
    const endX = Number(wall?.end_x) || 0;
    const endY = Number(wall?.end_y) || 0;
    const isHorizontal = Math.abs(endY - startY) < Math.abs(endX - startX);
    const startIsLeft = isHorizontal ? endX > startX : endY > startY;
    const wantStart = end !== 'end';
    if (wantStart) return startIsLeft ? 'left' : 'right';
    return startIsLeft ? 'right' : 'left';
}

/**
 * One drafter-set end length. The rest of the wall is filled with 1150 mm
 * panels, and whatever is left goes on the other end.
 * Returns { ok: false, error } when that other end cannot be a valid panel.
 */
export function planCustomSidePanels(wallLength, wallHeight, panelSide, lengthMm) {
    const wall = Math.round(Number(wallLength));
    const length = Math.round(Number(lengthMm));
    const side = panelSide === 'right' ? 'right' : 'left';
    const { minPanelWidth } = sidePanelLimits(wallHeight);

    if (!Number.isFinite(wall) || wall <= 0) {
        return { ok: false, error: 'Wall length is not available.' };
    }
    if (!Number.isFinite(length) || length <= 0) {
        return { ok: false, error: 'Enter a side panel length greater than 0.' };
    }
    if (wall <= MAX_BOTH_ENDS_CUT_WIDTH) {
        return {
            ok: false,
            error: `This wall is ${wall} mm, so it is a single panel. Clear the side length to keep that.`,
        };
    }
    if (length < minPanelWidth) {
        return { ok: false, error: `Side panel must be at least ${minPanelWidth} mm.` };
    }
    if (length > MAX_WALL_PANEL_WIDTH) {
        return { ok: false, error: `Side panel cannot be longer than ${MAX_WALL_PANEL_WIDTH} mm.` };
    }
    if (length >= wall) {
        return { ok: false, error: 'Side panel must be shorter than the wall.' };
    }

    const rest = wall - length;
    const fullCount = Math.floor(rest / MAX_WALL_PANEL_WIDTH);
    const other = rest - fullCount * MAX_WALL_PANEL_WIDTH;

    if (other > 0 && other < minPanelWidth) {
        const afterFulls = fullCount > 0
            ? `After ${fullCount} full panel${fullCount === 1 ? '' : 's'} of ${MAX_WALL_PANEL_WIDTH} mm, the other end would be ${other} mm`
            : `The other end would be ${other} mm`;
        return {
            ok: false,
            error: `${afterFulls}, below the ${minPanelWidth} mm minimum. Use a length that leaves at least ${minPanelWidth} mm on the other end, or that fills the rest of the wall with exact ${MAX_WALL_PANEL_WIDTH} mm panels.`,
        };
    }

    return {
        ok: true,
        fullCount,
        leftLength: side === 'left' ? length : other,
        rightLength: side === 'right' ? length : other,
        specifiedSide: side,
        specifiedLength: length,
        otherLength: other,
        otherSide: side === 'left' ? 'right' : 'left',
        minPanelWidth,
    };
}

export function planCustomSidePanelsForWall(wall) {
    if (!wall || wall.side_panel_length == null || wall.side_panel_length === '') return null;
    const wallLength = Math.round(Math.hypot(
        Number(wall.end_x) - Number(wall.start_x),
        Number(wall.end_y) - Number(wall.start_y)
    ));
    return planCustomSidePanels(
        wallLength,
        wall.height,
        wallEndToPanelSide(wall, wall.side_panel_end || 'start'),
        wall.side_panel_length
    );
}

/** Start/end sentence for a successful custom plan. */
export function describeSidePanelPlan(wall, plan) {
    if (!plan?.ok) return '';
    const startIsLeft = wallEndToPanelSide(wall, 'start') === 'left';
    const startLength = startIsLeft ? plan.leftLength : plan.rightLength;
    const endLength = startIsLeft ? plan.rightLength : plan.leftLength;
    const endText = (label, length) => (
        length > 0 ? `${label} ${length} mm` : `${label} is a full panel`
    );
    const fullLabel = plan.fullCount === 1 ? 'full panel' : 'full panels';
    return `${endText('Start', startLength)} · ${endText('End', endLength)} · ${plan.fullCount} ${fullLabel} at ${MAX_WALL_PANEL_WIDTH} mm`;
}
