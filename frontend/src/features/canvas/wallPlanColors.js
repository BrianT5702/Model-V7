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

/**
 * One hue per wall, stable by wall id, so neighboring walls stay easy to tell apart.
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

    ordered.forEach((wall, index) => {
        const hue = Math.round((index * 137.508) % 360);
        const hasDiffFaces = (wall.inner_face_material || 'PPGI') !== (wall.outer_face_material || 'PPGI');
        const hueInner = (hue + 180) % 360;
        const entry = {
            wall: `hsl(${hue}, ${satW}%, ${litW}%)`,
            partition: `hsl(${hue}, ${satP}%, ${litP}%)`,
            label: `Wall ${index + 1}`,
            finishLabel: wallFinishLabel(wall),
            hasDifferentFaces: hasDiffFaces,
            wallId: wall.id,
        };
        if (hasDiffFaces) {
            entry.innerWall = `hsl(${hueInner}, ${satW}%, ${litW}%)`;
            entry.innerPartition = `hsl(${hueInner}, ${satP}%, ${litP}%)`;
        }
        if (wall.id != null) {
            colorMap.set(wall.id, entry);
        }
    });

    return colorMap;
}
