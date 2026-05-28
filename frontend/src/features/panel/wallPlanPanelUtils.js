import PanelCalculator from './PanelCalculator';

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

        const wallLength = Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y);
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
