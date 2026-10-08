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
 * One hue per wall configuration (thickness and face materials).
 * When the two faces use different materials, the inner line uses the opposite hue.
 */
export function buildPerWallColorMap(walls, palette) {
    const colorMap = new Map();
    if (!Array.isArray(walls) || walls.length === 0) return colorMap;

    const satW = palette.wallSaturation;
    const litW = palette.wallLightness;
    const satP = palette.partitionSaturation;
    const litP = palette.partitionLightness;

    const ordered = [...walls].sort((a, b) => {
        const diff = wallSortId(a) - wallSortId(b);
        if (diff !== 0) return diff;
        return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
    });

    const styleByConfig = new Map();
    ordered.forEach((wall) => {
        const key = wallFinishKey(wall);
        if (styleByConfig.has(key)) return;
        const index = styleByConfig.size;
        const hue = Math.round((index * 137.508) % 360);
        const hasDiffFaces = configMaterial(wall.inner_face_material) !== configMaterial(wall.outer_face_material);
        const hueInner = (hue + 180) % 360;
        const entry = {
            wall: `hsl(${hue}, ${satW}%, ${litW}%)`,
            partition: `hsl(${hue}, ${satP}%, ${litP}%)`,
            label: `Wall ${index + 1}`,
            finishLabel: wallFinishLabel(wall),
            finishKey: key,
            hasDifferentFaces: hasDiffFaces,
            wallId: wall.id,
        };
        if (hasDiffFaces) {
            entry.innerWall = `hsl(${hueInner}, ${satW}%, ${litW}%)`;
            entry.innerPartition = `hsl(${hueInner}, ${satP}%, ${litP}%)`;
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
