import PanelCalculator from './PanelCalculator';

/** Fingerprint walls + joints so we can detect stale material counts. */
export function getWallCalculationFingerprint(walls = [], intersections = []) {
    const wallPart = (walls || [])
        .map((wall) => [
            wall.id,
            wall.start_x,
            wall.start_y,
            wall.end_x,
            wall.end_y,
            wall.height,
            wall.thickness,
            wall.fill_gap_mode,
            wall.gap_fill_height,
            wall.inner_face_material,
            wall.inner_face_thickness,
            wall.outer_face_material,
            wall.outer_face_thickness,
        ].join(':'))
        .sort()
        .join('|');

    const intersectionPart = (intersections || [])
        .flatMap((inter) => (inter.pairs || []).map((pair) => {
            const w1 = pair.wall1?.id ?? '';
            const w2 = pair.wall2?.id ?? '';
            const ids = [w1, w2].sort().join('-');
            return `${ids}:${pair.joining_method ?? 'butt_in'}@${inter.x},${inter.y}`;
        }))
        .sort()
        .join('|');

    return `${wallPart}::${intersectionPart}`;
}

export function getWallLength(wall) {
    return Math.round(
        Math.sqrt(
            Math.pow(wall.end_x - wall.start_x, 2) +
            Math.pow(wall.end_y - wall.start_y, 2)
        )
    );
}

export function getWallJointTypes(wall, intersections = []) {
    let leftJointType = 'butt_in';
    let rightJointType = 'butt_in';

    const wallIntersections = (intersections || []).filter((inter) =>
        inter.pairs && inter.pairs.some((pair) =>
            pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)
        )
    );

    const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
    const isLeftToRight = wall.end_x > wall.start_x;
    const isBottomToTop = wall.end_y > wall.start_y;

    const leftEndIntersections = [];
    const rightEndIntersections = [];

    wallIntersections.forEach((inter) => {
        if (!inter.pairs) return;
        inter.pairs.forEach((pair) => {
            if (!pair.wall1 || !pair.wall2) return;
            if (pair.wall1.id !== wall.id && pair.wall2.id !== wall.id) return;

            if (isHorizontal) {
                if (isLeftToRight) {
                    if (Math.abs(inter.x - wall.start_x) < 0.5) leftEndIntersections.push(pair.joining_method);
                    else if (Math.abs(inter.x - wall.end_x) < 0.5) rightEndIntersections.push(pair.joining_method);
                } else {
                    if (Math.abs(inter.x - wall.start_x) < 0.5) rightEndIntersections.push(pair.joining_method);
                    else if (Math.abs(inter.x - wall.end_x) < 0.5) leftEndIntersections.push(pair.joining_method);
                }
            } else if (isBottomToTop) {
                if (Math.abs(inter.y - wall.start_y) < 0.5) leftEndIntersections.push(pair.joining_method);
                else if (Math.abs(inter.y - wall.end_y) < 0.5) rightEndIntersections.push(pair.joining_method);
            } else {
                if (Math.abs(inter.y - wall.start_y) < 0.5) rightEndIntersections.push(pair.joining_method);
                else if (Math.abs(inter.y - wall.end_y) < 0.5) leftEndIntersections.push(pair.joining_method);
            }
        });
    });

    leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
    rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';

    return { left: leftJointType, right: rightJointType };
}

export function count45CutEnds(wall, intersections = []) {
    const joints = getWallJointTypes(wall, intersections);
    return (joints.left === '45_cut' ? 1 : 0) + (joints.right === '45_cut' ? 1 : 0);
}

export function hasMixedJoints(wall, intersections = []) {
    const joints = getWallJointTypes(wall, intersections);
    return joints.left !== joints.right;
}

/** Panel-left / panel-right endpoints (same convention as getWallJointTypes). */
export function getWallPanelEndPoints(wall) {
    const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
    const start = { x: wall.start_x, y: wall.start_y };
    const end = { x: wall.end_x, y: wall.end_y };
    if (isHorizontal) {
        return wall.end_x > wall.start_x
            ? { left: start, right: end }
            : { left: end, right: start };
    }
    return wall.end_y > wall.start_y
        ? { left: start, right: end }
        : { left: end, right: start };
}

/**
 * Find the wall this end joins to (prefer a 45_cut partner when several exist).
 */
export function findJoiningWallAtEnd(wall, endPoint, walls = [], intersections = []) {
    const byId = new Map((walls || []).map((w) => [w.id, w]));
    let fallback = null;
    let preferred = null;
    const maxDist = Math.max(200, (Number(wall.thickness) || 0) * 2);

    (intersections || []).forEach((inter) => {
        if (!inter?.pairs) return;
        const dist = Math.hypot(inter.x - endPoint.x, inter.y - endPoint.y);
        if (dist > maxDist) return;

        inter.pairs.forEach((pair) => {
            if (!pair.wall1 || !pair.wall2) return;
            const id1 = pair.wall1.id;
            const id2 = pair.wall2.id;
            if (id1 !== wall.id && id2 !== wall.id) return;
            const otherId = id1 === wall.id ? id2 : id1;
            const other = byId.get(otherId);
            if (!other) return;
            const method = pair.joining_method || 'butt_in';
            if (method === '45_cut') preferred = other;
            else if (!fallback) fallback = other;
        });
    });

    return preferred || fallback;
}

/**
 * Slash for a 45° end from joining-wall side.
 * Plan coords are Y-down (drawing: larger y = visually below / top→bottom).
 * Cross(alongIntoWall, towardJoining) > 0 → '\' else '/'.
 * Both ends joining visually below a L→R wall → left '\', right '/'.
 */
export function getCutSlashForEnd(endPoint, otherEndPoint, joiningWall) {
    if (!joiningWall) return '/';
    const alongX = otherEndPoint.x - endPoint.x;
    const alongY = otherEndPoint.y - endPoint.y;
    const midJ = {
        x: (joiningWall.start_x + joiningWall.end_x) / 2,
        y: (joiningWall.start_y + joiningWall.end_y) / 2,
    };
    const toJx = midJ.x - endPoint.x;
    const toJy = midJ.y - endPoint.y;
    // Y-down plan: positive cross = joining on visual "below" when walking L→R
    const cross = alongX * toJy - alongY * toJx;
    if (Math.abs(cross) < 1e-9) {
        // Degenerate: toJy > 0 = visually below
        return toJy > 0 ? (alongX >= 0 ? '\\' : '/') : (alongX >= 0 ? '/' : '\\');
    }
    return cross > 0 ? '\\' : '/';
}

export function flipCutSlash(slash) {
    if (slash === '/') return '\\';
    if (slash === '\\') return '/';
    return slash;
}

/**
 * Required 45° cut slash at each panel end from joining-wall geometry.
 * Returns { left: '/'|'\\'|null, right: '/'|'\\'|null } (null when end is not 45_cut).
 */
export function getWallEndCutSlashes(wall, walls = [], intersections = []) {
    const joints = getWallJointTypes(wall, intersections);
    const ends = getWallPanelEndPoints(wall);
    const result = { left: null, right: null };

    if (joints.left === '45_cut') {
        const joining = findJoiningWallAtEnd(wall, ends.left, walls, intersections);
        result.left = getCutSlashForEnd(ends.left, ends.right, joining);
    }
    if (joints.right === '45_cut') {
        const joining = findJoiningWallAtEnd(wall, ends.right, walls, intersections);
        result.right = getCutSlashForEnd(ends.right, ends.left, joining);
    }
    return result;
}

/**
 * Left SP → fulls → right SP (matches canvas / PDF plan layout).
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
 * Prefer saved optimized wall order when fingerprint still matches current walls/joints.
 */
export function resolveOrderedWallsForPanels(walls = [], intersections = [], panelOptimization = null) {
    const list = Array.isArray(walls) ? walls : [];
    if (!list.length) return [];

    const saved = panelOptimization;
    if (
        saved &&
        Array.isArray(saved.wallOrder) &&
        saved.wallOrder.length === list.length &&
        saved.fingerprint === getWallCalculationFingerprint(list, intersections)
    ) {
        const byId = new Map(list.map((wall) => [wall.id, wall]));
        const ordered = saved.wallOrder.map((id) => byId.get(id)).filter(Boolean);
        if (ordered.length === list.length) return ordered;
    }
    return list;
}

/**
 * Convert DB-style joints ({ wall_1, wall_2, joining_method }) into intersection pairs
 * used by getWallJointTypes / cut-slash helpers.
 */
export function buildIntersectionsFromJoints(walls = [], joints = []) {
    const byId = new Map((walls || []).map((wall) => [wall.id, wall]));
    const out = [];

    (joints || []).forEach((joint) => {
        const w1 = byId.get(joint.wall_1 ?? joint.wall1?.id);
        const w2 = byId.get(joint.wall_2 ?? joint.wall2?.id);
        if (!w1 || !w2) return;

        let x = Number(joint.x);
        let y = Number(joint.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            const pt = segmentIntersectionPoint(w1, w2);
            if (!pt) return;
            x = pt.x;
            y = pt.y;
        }

        out.push({
            x,
            y,
            pairs: [{
                wall1: w1,
                wall2: w2,
                joining_method: joint.joining_method || 'butt_in',
            }],
        });
    });

    return out;
}

function segmentIntersectionPoint(wallA, wallB) {
    const x1 = wallA.start_x;
    const y1 = wallA.start_y;
    const x2 = wallA.end_x;
    const y2 = wallA.end_y;
    const x3 = wallB.start_x;
    const y3 = wallB.start_y;
    const x4 = wallB.end_x;
    const y4 = wallB.end_y;
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    if (t < -0.01 || t > 1.01 || u < -0.01 || u > 1.01) return null;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/**
 * Run wall panel calculation for an ordered list of walls (shared leftover pool).
 * Also returns wallPanelsMap ordered for plan/3D division lines (SP side + actualWidth).
 */
export function calculateProjectWallPanels(walls = [], intersections = [], wallOrder = null) {
    const orderedWalls = wallOrder || walls;
    const calculator = new PanelCalculator();
    const allPanels = [];
    const wallPanelsMap = {};

    orderedWalls.forEach((wall) => {
        if (!wall || typeof wall.start_x !== 'number' || typeof wall.start_y !== 'number' ||
            typeof wall.end_x !== 'number' || typeof wall.end_y !== 'number') {
            return;
        }
        if (typeof wall.height !== 'number' || typeof wall.thickness !== 'number') {
            return;
        }

        const wallLength = getWallLength(wall);
        const jointType = getWallJointTypes(wall, intersections);
        const cutSlashes = getWallEndCutSlashes(wall, walls, intersections);
        const heightForCalc = (wall.fill_gap_mode && wall.gap_fill_height !== null)
            ? wall.gap_fill_height
            : wall.height;

        const faceInfo = {
            innerFaceMaterial: wall.inner_face_material || null,
            innerFaceThickness: wall.inner_face_thickness || null,
            outerFaceMaterial: wall.outer_face_material || null,
            outerFaceThickness: wall.outer_face_thickness || null,
        };

        const panels = calculator.calculatePanels(
            wallLength,
            wall.thickness,
            jointType,
            heightForCalc,
            faceInfo,
            cutSlashes
        );

        if (!panels || !Array.isArray(panels)) return;

        wallPanelsMap[wall.id] = orderWallPanelsLikeCanvas(panels);

        panels.forEach((panel) => {
            if (!panel || typeof panel.width !== 'number') return;

            let panelType = panel.type;
            if (panelType === 'leftover' && panel.width < 200 && !panel.isLeftover) {
                panelType = 'side';
            }

            allPanels.push({
                ...panel,
                type: panelType,
                length: heightForCalc,
                application: wall.application_type || 'standard',
                wallId: wall.id,
                thickness: wall.thickness,
                wallLength,
                wallStart: `(${Math.round(wall.start_x)}, ${Math.round(wall.start_y)})`,
                wallEnd: `(${Math.round(wall.end_x)}, ${Math.round(wall.end_y)})`,
                inner_face_material: wall.inner_face_material || 'PPGI',
                inner_face_thickness: wall.inner_face_thickness ?? 0.5,
                outer_face_material: wall.outer_face_material || 'PPGI',
                outer_face_thickness: wall.outer_face_thickness ?? 0.5,
            });
        });
    });

    return {
        allPanels,
        calculator,
        analysis: calculator.getPanelAnalysis(),
        score: calculator.getOptimizationScore(),
        wallPanelsMap,
    };
}

/**
 * Wall → ordered panels map using shared leftover pool (+ optional saved optimized order).
 */
export function buildProjectWallPanelsMap(walls = [], intersections = [], panelOptimization = null) {
    const orderedWalls = resolveOrderedWallsForPanels(walls, intersections, panelOptimization);
    const { wallPanelsMap } = calculateProjectWallPanels(walls, intersections, orderedWalls);
    return wallPanelsMap || {};
}

export function groupWallPanelsForDisplay(allPanels = []) {
    const groupedPanels = allPanels.reduce((acc, panel) => {
        const key = `${panel.type}-${panel.width}-${panel.length}-${panel.thickness}-${panel.application}-${panel.inner_face_material}-${panel.inner_face_thickness}-${panel.outer_face_material}-${panel.outer_face_thickness}`;
        if (!acc[key]) {
            acc[key] = {
                width: panel.width,
                length: panel.length,
                thickness: panel.thickness,
                application: panel.application,
                quantity: 0,
                type: panel.type,
                inner_face_material: panel.inner_face_material,
                inner_face_thickness: panel.inner_face_thickness,
                outer_face_material: panel.outer_face_material,
                outer_face_thickness: panel.outer_face_thickness,
                anyWallId: panel.wallId,
            };
        }
        acc[key].quantity += 1;
        return acc;
    }, {});

    return Object.values(groupedPanels);
}
