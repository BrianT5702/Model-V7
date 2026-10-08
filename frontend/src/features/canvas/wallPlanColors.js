function finishPart(thickness, material) {
    const thk = thickness != null ? thickness : 0.5;
    return `${thk} ${material || 'PPGI'}`;
}

export function wallFinishLabel(wall) {
    const core = wall?.thickness ?? '';
    const interior = finishPart(wall?.inner_face_thickness, wall?.inner_face_material);
    const exterior = finishPart(wall?.outer_face_thickness, wall?.outer_face_material);
    return `${core}mm · Int ${interior} · Ext ${exterior}`;
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

const MATERIAL_LABELS = {
    PPGI: 'PPGI',
    'S/STEEL': 'S/Steel',
    PVC: 'PVC',
};

const MATERIAL_ORDER = ['PPGI', 'S/STEEL', 'PVC'];

function materialLabel(material) {
    return MATERIAL_LABELS[material] || material;
}

function wallThicknessMm(wall) {
    return configNumber(wall?.thickness, '');
}

function faceKey(thickness, material) {
    return `${material}|${thickness}`;
}

function faceLegendLabel(material, thickness) {
    const name = materialLabel(material);
    return thickness === '' ? name : `${name} · ${thickness}mm`;
}

function compareFaceKeys(a, b) {
    const [matA, thkA] = String(a).split('|');
    const [matB, thkB] = String(b).split('|');
    const ia = MATERIAL_ORDER.indexOf(matA);
    const ib = MATERIAL_ORDER.indexOf(matB);
    const materialOrder = (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    if (materialOrder !== 0) return materialOrder;
    if (matA !== matB) return matA.localeCompare(matB);
    return Number(thkA) - Number(thkB);
}

function paletteColor(index, darkCanvas) {
    const stops = darkCanvas ? DARK_FACE_STOPS : LIGHT_FACE_STOPS;
    const cycle = Math.floor(index / stops.length);
    const [h, s, l] = stops[index % stops.length];
    const hue = Math.round((h + cycle * 17) % 360);
    return `hsl(${hue}, ${s}%, ${l}%)`;
}

/**
 * Face lines use material plus wall thickness.
 * Stainless steel of one thickness is the same color on every wall.
 * A different wall thickness gets a different color.
 * Sheet gauge (0.5 vs 0.6) does not change the color.
 * The outer line uses the outside material; the inner line uses the inside material.
 */
export function buildPerWallColorMap(walls, palette) {
    const colorMap = new Map();
    if (!Array.isArray(walls) || walls.length === 0) return colorMap;

    const darkCanvas = Number(palette?.wallLightness) >= 60;
    const usable = walls.filter((wall) => wall?.id != null);
    const keys = new Set();
    usable.forEach((wall) => {
        const thickness = wallThicknessMm(wall);
        keys.add(faceKey(thickness, configMaterial(wall.outer_face_material)));
        keys.add(faceKey(thickness, configMaterial(wall.inner_face_material)));
    });

    const colorByKey = new Map();
    [...keys].sort(compareFaceKeys).forEach((key, index) => {
        colorByKey.set(key, paletteColor(index, darkCanvas));
    });

    usable.forEach((wall) => {
        const thickness = wallThicknessMm(wall);
        const outer = configMaterial(wall.outer_face_material);
        const inner = configMaterial(wall.inner_face_material);
        const outerKey = faceKey(thickness, outer);
        const innerKey = faceKey(thickness, inner);
        const hasDiffFaces = outer !== inner;
        const outerColor = colorByKey.get(outerKey);
        const innerColor = colorByKey.get(innerKey);
        const outerLegend = faceLegendLabel(outer, thickness);
        const innerLegend = faceLegendLabel(inner, thickness);
        colorMap.set(wall.id, {
            wall: outerColor,
            partition: outerColor,
            innerWall: innerColor,
            innerPartition: innerColor,
            hasDifferentFaces: hasDiffFaces,
            outerMaterial: outer,
            innerMaterial: inner,
            outerKey,
            innerKey,
            outerLegend,
            innerLegend,
            label: outerLegend,
            finishLabel: hasDiffFaces ? `${outerLegend} outside · ${innerLegend} inside` : outerLegend,
            finishKey: hasDiffFaces ? `${outerKey}|${innerKey}` : outerKey,
            wallId: wall.id,
        });
    });

    return colorMap;
}

/** Material and thickness combinations on the plan, each with its face color. */
export function collectFaceMaterialLegend(colorMap) {
    const found = new Map();
    if (!colorMap) return [];
    for (const colors of colorMap.values()) {
        if (colors?.outerKey) found.set(colors.outerKey, { label: colors.outerLegend, color: colors.wall });
        if (colors?.innerKey) found.set(colors.innerKey, { label: colors.innerLegend, color: colors.innerWall || colors.wall });
    }
    return [...found.entries()]
        .sort((a, b) => compareFaceKeys(a[0], b[0]))
        .map(([key, item]) => ({
            key,
            label: item.label,
            color: item.color,
        }));
}
