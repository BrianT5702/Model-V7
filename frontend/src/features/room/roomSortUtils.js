/**
 * Sort rooms by level (storey order / elevation), then room name.
 * Used by export preview and floor/ceiling material room lists.
 */
export function sortRoomsByLevelThenName(roomsList, storeysList) {
    if (!Array.isArray(roomsList) || roomsList.length === 0) {
        return [];
    }

    const storeyById = new Map(
        (storeysList || []).map((storey) => [String(storey.id), storey])
    );

    const getStoreyMeta = (room) => {
        const storeyId = room?.storey ?? room?.storey_id;
        const storey = storeyById.get(String(storeyId));
        if (!storey) {
            return {
                order: Number.MAX_SAFE_INTEGER,
                elevation: Number.MAX_SAFE_INTEGER,
                id: Number.MAX_SAFE_INTEGER,
                name: 'Unassigned',
            };
        }
        return {
            order: storey.order ?? 0,
            elevation: Number(storey.elevation_mm) || 0,
            id: storey.id ?? 0,
            name: storey.name || `Level ${storey.id}`,
        };
    };

    const withLevel = roomsList.map((room) => ({
        ...room,
        storey_name: getStoreyMeta(room).name,
    }));

    if (withLevel.length <= 1) {
        return withLevel;
    }

    return withLevel.sort((a, b) => {
        const sa = getStoreyMeta(a);
        const sb = getStoreyMeta(b);
        if (sa.order !== sb.order) return sa.order - sb.order;
        if (Math.abs(sa.elevation - sb.elevation) > 1e-6) return sa.elevation - sb.elevation;
        if (sa.id !== sb.id) return sa.id - sb.id;
        const nameA = (a.room_name || '').trim();
        const nameB = (b.room_name || '').trim();
        return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
    });
}
