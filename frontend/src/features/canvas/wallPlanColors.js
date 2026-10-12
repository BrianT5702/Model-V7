function finishPart(thickness, material) {
    const thk = thickness != null ? thickness : 0.5;
    return `${thk} ${material || 'PPGI'}`;
}

export function wallFinishLabel(wall) {
    const core = wall?.thickness ?? '';
    const side1 = finishPart(wall?.inner_face_thickness, wall?.inner_face_material);
    const side2 = finishPart(wall?.outer_face_thickness, wall?.outer_face_material);
    return `${core}mm · Side 1 ${side1} · Side 2 ${side2}`;
}

function configNumber(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(fallback);
    return String(Math.round(n * 1000) / 1000);
}

function configMaterial(value) {
    return String(value || 'PPGI').trim().toUpperCase();
}

/** Thickness plus both face materials. Matching walls share this key. */
export function wallFinishKey(wall) {
    return [
        configNumber(wall?.thickness, ''),
        configMaterial(wall?.inner_face_material),
        configNumber(wall?.inner_face_thickness, 0.5),
        configMaterial(wall?.outer_face_material),
        configNumber(wall?.outer_face_thickness, 0.5),
    ].join('|');
}

/**
 * Stroke colors for material + wall thickness. Neighbors in this list are far apart,
 * because 100 mm and 150 mm of the same material are assigned one after another.
 * Blues near the dimension lines are left out.
 */
const DARK_FACE_STOPS = [
    [4, 100, 58],
    [150, 100, 42],
    [48, 100, 52],
    [280, 100, 68],
    [175, 100, 44],
    [330, 100, 58],
    [25, 100, 52],
    [255, 85, 70],
];

const LIGHT_FACE_STOPS = [
    [4, 85, 40],
    [150, 85, 28],
    [48, 95, 32],
    [280, 70, 42],
    [175, 80, 28],
    [330, 75, 38],
    [25, 90, 36],
    [255, 70, 42],
];

const MATERIAL_ORDER = ['PPGI', 'S/STEEL', 'PVC'];

function wallSortId(wall) {
    const id = Number(wall?.id);
    return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
}

/** Wall thickness plus face sheet. 150 mm and 100 mm of the same finish stay different colors. */
function sheetFaceKey(wallThickness, sheetThickness, material) {
    return [
        configNumber(wallThickness, ''),
        configMaterial(material),
        configNumber(sheetThickness, 0.5),
    ].join('|');
}

function compareFaceKeys(a, b) {
    const [wallA, matA, sheetA] = String(a).split('|');
    const [wallB, matB, sheetB] = String(b).split('|');
    const ia = MATERIAL_ORDER.indexOf(matA);
    const ib = MATERIAL_ORDER.indexOf(matB);
    const materialOrder = (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    if (materialOrder !== 0) return materialOrder;
    if (matA !== matB) return matA.localeCompare(matB);
    const sheetOrder = Number(sheetA) - Number(sheetB);
    if (sheetOrder !== 0) return sheetOrder;
    return Number(wallA) - Number(wallB);
}

function paletteColor(index, darkCanvas) {
    const stops = darkCanvas ? DARK_FACE_STOPS : LIGHT_FACE_STOPS;
    const cycle = Math.floor(index / stops.length);
    const [h, s, l] = stops[index % stops.length];
    const hue = Math.round((h + cycle * 17) % 360);
    return `hsl(${hue}, ${s}%, ${l}%)`;
}

/**
 * Each face line is colored by wall thickness plus that side's sheet.
 * 150 mm 0.6 PPGI is not the same color as 100 mm 0.6 PPGI.
 */
export function buildPerWallColorMap(walls, palette) {
    const colorMap = new Map();
    if (!Array.isArray(walls) || walls.length === 0) return colorMap;

    const darkCanvas = Number(palette?.wallLightness) >= 60;
    const usable = walls.filter((wall) => wall?.id != null);
    const keys = new Set();
    usable.forEach((wall) => {
        keys.add(sheetFaceKey(wall.thickness, wall.inner_face_thickness, wall.inner_face_material));
        keys.add(sheetFaceKey(wall.thickness, wall.outer_face_thickness, wall.outer_face_material));
    });

    const colorByKey = new Map();
    [...keys].sort(compareFaceKeys).forEach((key, index) => {
        colorByKey.set(key, paletteColor(index, darkCanvas));
    });

    const ordered = [...usable].sort((a, b) => {
        const diff = wallSortId(a) - wallSortId(b);
        if (diff !== 0) return diff;
        return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
    });

    const styleByConfig = new Map();
    ordered.forEach((wall) => {
        const finishKey = wallFinishKey(wall);
        if (styleByConfig.has(finishKey)) return;
        const innerKey = sheetFaceKey(wall.thickness, wall.inner_face_thickness, wall.inner_face_material);
        const outerKey = sheetFaceKey(wall.thickness, wall.outer_face_thickness, wall.outer_face_material);
        const innerColor = colorByKey.get(innerKey);
        const outerColor = colorByKey.get(outerKey);
        styleByConfig.set(finishKey, {
            label: `Wall ${styleByConfig.size + 1}`,
            finishLabel: wallFinishLabel(wall),
            finishKey,
            innerColor,
            outerColor,
            hasDifferentFaces: innerKey !== outerKey,
        });
    });

    ordered.forEach((wall) => {
        const style = styleByConfig.get(wallFinishKey(wall));
        if (!style) return;
        colorMap.set(wall.id, {
            wall: style.outerColor,
            partition: style.outerColor,
            innerWall: style.innerColor,
            innerPartition: style.innerColor,
            hasDifferentFaces: style.hasDifferentFaces,
            innerColor: style.innerColor,
            outerColor: style.outerColor,
            label: style.label,
            finishLabel: style.finishLabel,
            finishKey: style.finishKey,
            wallId: wall.id,
        });
    });

    return colorMap;
}

/** One legend row per wall build, with the inner and outer face colors. */
export function collectWallFaceLegend(colorMap) {
    const found = new Map();
    if (!colorMap) return [];
    for (const colors of colorMap.values()) {
        if (!colors?.finishKey || found.has(colors.finishKey)) continue;
        found.set(colors.finishKey, colors);
    }
    return [...found.values()].sort((a, b) => {
        const na = Number(String(a.label).replace(/\D/g, '')) || 0;
        const nb = Number(String(b.label).replace(/\D/g, '')) || 0;
        return na - nb;
    });
}
