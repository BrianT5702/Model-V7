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

function wallSortId(wall) {
    const id = Number(wall?.id);
    return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
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
 * Fixed hues for thin plan strokes. Golden-angle hues at one shared lightness
 * collapse into similar pastels, and a +180 inner face lands on another wall.
 * Each stop is a [hue, saturation, lightness] triple.
 */
const DARK_FACE_STOPS = [
    [355, 100, 62],
    [128, 100, 45],
    [274, 100, 70],
    [48, 100, 50],
    [175, 100, 42],
    [322, 100, 60],
    [28, 100, 52],
    [96, 100, 46],
];

const LIGHT_FACE_STOPS = [
    [355, 85, 40],
    [128, 80, 30],
    [274, 75, 45],
    [45, 100, 32],
    [175, 80, 28],
    [322, 75, 40],
    [18, 95, 38],
    [85, 85, 28],
];

function formatHsl(h, s, l) {
    return `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function faceColor(index, stops) {
    const cycle = Math.floor(index / stops.length);
    const [h, s, l] = stops[index % stops.length];
    return formatHsl(h + cycle * 23, s, l);
}

function partitionVariant(color) {
    const match = String(color).match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
    if (!match) return color;
    const lightness = Math.min(78, Math.max(24, Number(match[3]) + 12));
    const saturation = Math.max(55, Number(match[2]) - 14);
    return formatHsl(Number(match[1]), saturation, lightness);
}

/**
 * One color per wall configuration (thickness and face materials).
 * When the two faces use different materials, the inner line takes the next
 * unused color so it does not match another wall.
 */
export function buildPerWallColorMap(walls, palette) {
    const colorMap = new Map();
    if (!Array.isArray(walls) || walls.length === 0) return colorMap;

    const stops = Number(palette.wallLightness) >= 60 ? DARK_FACE_STOPS : LIGHT_FACE_STOPS;

    const ordered = [...walls].sort((a, b) => {
        const diff = wallSortId(a) - wallSortId(b);
        if (diff !== 0) return diff;
        return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
    });

    const styleByConfig = new Map();
    let faceIndex = 0;
    ordered.forEach((wall) => {
        const key = wallFinishKey(wall);
        if (styleByConfig.has(key)) return;
        const index = styleByConfig.size;
        const hasDiffFaces = configMaterial(wall.inner_face_material) !== configMaterial(wall.outer_face_material);
        const wallColor = faceColor(faceIndex, stops);
        faceIndex += 1;
        const entry = {
            wall: wallColor,
            partition: partitionVariant(wallColor),
            label: `Wall ${index + 1}`,
            finishLabel: wallFinishLabel(wall),
            finishKey: key,
            hasDifferentFaces: hasDiffFaces,
            wallId: wall.id,
        };
        if (hasDiffFaces) {
            const innerColor = faceColor(faceIndex, stops);
            faceIndex += 1;
            entry.innerWall = innerColor;
            entry.innerPartition = partitionVariant(innerColor);
        }
        styleByConfig.set(key, entry);
    });

    ordered.forEach((wall) => {
        const entry = styleByConfig.get(wallFinishKey(wall));
        if (!entry || wall.id == null) return;
        colorMap.set(wall.id, entry);
    });

    return colorMap;
}
