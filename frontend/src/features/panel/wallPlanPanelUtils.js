import {
    buildProjectWallPanelsMap,
    orderWallPanelsLikeCanvas,
} from './wallPanelCalculationUtils';

export { orderWallPanelsLikeCanvas };

/**
 * Display label for panel face finishing (matches material tables / PDF export).
 */
export function getPanelFinishingLabel(panel) {
    const intMat = panel?.inner_face_material ?? 'PPGI';
    const intThk = panel?.inner_face_thickness ?? 0.5;
    const extMat = panel?.outer_face_material ?? 'PPGI';
    const extThk = panel?.outer_face_thickness ?? 0.5;
    if (intMat === extMat && intThk === extThk) {
        return `Both Side ${extThk}mm ${extMat}`;
    }
    return `Ext: ${extThk}mm ${extMat}; Int: ${intThk}mm ${intMat}`;
}

const PANEL_TYPE_SORT_ORDER = {
    full: 0,
    side: 1,
    cut: 1,
    leftover: 2,
};

/**
 * Sort material panel rows so finishing and type stay grouped (no mixed full/side blocks).
 * Order: finishing → type (full, side/cut, leftover) → application → thickness →
 * width (desc) → length (desc when width matches).
 * Same logic for wall / ceiling / floor export lists.
 */
export function sortMaterialPanels(panels) {
    if (!Array.isArray(panels) || panels.length <= 1) {
        return panels || [];
    }

    return [...panels].sort((a, b) => {
        const finishA = getPanelFinishingLabel(a);
        const finishB = getPanelFinishingLabel(b);
        if (finishA !== finishB) {
            return finishA.localeCompare(finishB, undefined, { sensitivity: 'base' });
        }

        const typeA = PANEL_TYPE_SORT_ORDER[String(a?.type || '').toLowerCase()] ?? 50;
        const typeB = PANEL_TYPE_SORT_ORDER[String(b?.type || '').toLowerCase()] ?? 50;
        if (typeA !== typeB) {
            return typeA - typeB;
        }

        const appA = String(a?.application || '');
        const appB = String(b?.application || '');
        if (appA !== appB) {
            return appA.localeCompare(appB, undefined, { sensitivity: 'base' });
        }

        const thkA = Number(a?.thickness) || 0;
        const thkB = Number(b?.thickness) || 0;
        if (thkA !== thkB) {
            return thkB - thkA; // thicker first
        }

        const widthA = Number(a?.width) || 0;
        const widthB = Number(b?.width) || 0;
        if (widthA !== widthB) {
            return widthB - widthA; // wider first
        }

        const lenA = Number(a?.length) || 0;
        const lenB = Number(b?.length) || 0;
        return lenB - lenA; // same width → longer first
    });
}

/**
 * Joint types at wall ends — same rules as Canvas2D getWallJointTypes.
 */
export function getWallJointTypes(wall, intersections) {
    const wallIntersections = (intersections || []).filter(
        (inter) =>
            inter.pairs &&
            inter.pairs.some(
                (pair) =>
                    pair.wall1 &&
                    pair.wall2 &&
                    (pair.wall1.id === wall.id || pair.wall2.id === wall.id)
            )
    );

    const leftEndIntersections = [];
    const rightEndIntersections = [];
    const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
    const isLeftToRight = wall.end_x > wall.start_x;
    const isBottomToTop = wall.end_y > wall.start_y;

    wallIntersections.forEach((inter) => {
        inter.pairs.forEach((pair) => {
            if (pair.wall1.id === wall.id || pair.wall2.id === wall.id) {
                if (isHorizontal) {
                    if (isLeftToRight) {
                        if (inter.x === wall.start_x) leftEndIntersections.push(pair.joining_method);
                        else if (inter.x === wall.end_x) rightEndIntersections.push(pair.joining_method);
                    } else {
                        if (inter.x === wall.start_x) rightEndIntersections.push(pair.joining_method);
                        else if (inter.x === wall.end_x) leftEndIntersections.push(pair.joining_method);
                    }
                }
                if (isBottomToTop) {
                    if (inter.y === wall.start_y) leftEndIntersections.push(pair.joining_method);
                    else if (inter.y === wall.end_y) rightEndIntersections.push(pair.joining_method);
                } else {
                    if (inter.y === wall.start_y) rightEndIntersections.push(pair.joining_method);
                    else if (inter.y === wall.end_y) rightEndIntersections.push(pair.joining_method);
                }
            }
        });
    });

    const leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
    const rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
    return { left: leftJointType, right: rightJointType };
}

/**
 * Build wall → panels map matching the wall plan canvas (shared leftover pool + saved order).
 */
export function buildWallPanelsMapForWallPlan(walls, intersections, panelOptimization = null) {
    return buildProjectWallPanelsMap(walls, intersections, panelOptimization);
}
