import PanelCalculator from './PanelCalculator';

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
 * Panel order for dimension labels (first/last) — same as Canvas2D wallPanelsMap useMemo.
 */
export function orderWallPanelsLikeCanvas(panels) {
    if (!Array.isArray(panels) || panels.length === 0) return panels;

    const leftSide = panels.find((p) => p.type === 'side' && p.position === 'left');
    const rightSide = panels.find((p) => p.type === 'side' && p.position === 'right');
    const fullPanels = panels.filter((p) => p.type === 'full');
    const otherSides = panels.filter(
        (p) => p.type === 'side' && p.position !== 'left' && p.position !== 'right'
    );

    let orderedPanels = [];
    if (leftSide) orderedPanels.push(leftSide);
    if (otherSides.length > 0 && !leftSide) orderedPanels.push(otherSides[0]);
    orderedPanels = orderedPanels.concat(fullPanels);
    if (rightSide) orderedPanels.push(rightSide);
    if (otherSides.length > 1 || (otherSides.length === 1 && leftSide)) {
        orderedPanels.push(otherSides[otherSides.length - 1]);
    }
    if (orderedPanels.length === 0) orderedPanels = panels;
    return orderedPanels;
}

/**
 * Build wall → panels map matching the wall plan canvas (PanelCalculator + order + joints).
 */
export function buildWallPanelsMapForWallPlan(walls, intersections) {
    if (!walls?.length) return {};

    const map = {};
    const calculator = new PanelCalculator();

    walls.forEach((wall) => {
        if (!wall || typeof wall.start_x !== 'number' || typeof wall.end_x !== 'number') return;

        const wallLength = Math.round(Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y));
        const jointTypes = getWallJointTypes(wall, intersections);
        const heightForCalc =
            wall.fill_gap_mode && wall.gap_fill_height != null ? wall.gap_fill_height : wall.height;
        const faceInfo = {
            innerFaceMaterial: wall.inner_face_material || null,
            innerFaceThickness: wall.inner_face_thickness || null,
            outerFaceMaterial: wall.outer_face_material || null,
            outerFaceThickness: wall.outer_face_thickness || null,
        };

        let panels = [];
        try {
            panels =
                calculator.calculatePanels(
                    wallLength,
                    wall.thickness,
                    jointTypes,
                    heightForCalc,
                    faceInfo
                ) || [];
        } catch (_) {
            panels = [];
        }

        if (panels.length > 0) {
            map[wall.id] = orderWallPanelsLikeCanvas(panels);
        }
    });

    return map;
}
