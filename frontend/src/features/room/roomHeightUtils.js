const RANGE_PATTERN = /^([\d.]+)\s*(?:-|–|—|\.\.|to)\s*([\d.]+)$/i;

const toMillimetres = (value) => {
    const number = parseFloat(value);
    if (Number.isNaN(number) || number <= 0) {
        return null;
    }
    // Values <= 50 are treated as metres (e.g. 5 - 10 → 5000-10000 mm).
    return number <= 50 ? number * 1000 : number;
};

export const parseRoomHeightInput = (raw) => {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
        return { ok: false, error: 'Room height is required' };
    }

    if (typeof raw === 'number') {
        if (raw <= 0) {
            return { ok: false, error: 'Room height must be greater than 0' };
        }
        return {
            ok: true,
            height: raw,
            height_min: raw,
            height_max: raw,
        };
    }

    let text = String(raw).trim().toLowerCase();
    text = text.replace(/\bmm\b/g, '').replace(/\bm\b/g, '').trim();

    const rangeMatch = text.match(RANGE_PATTERN);
    if (rangeMatch) {
        const first = toMillimetres(rangeMatch[1]);
        const second = toMillimetres(rangeMatch[2]);
        if (first === null || second === null) {
            return { ok: false, error: 'Enter a valid height range, e.g. 5000-6000 or 5-10 (m)' };
        }
        const height_min = Math.min(first, second);
        const height_max = Math.max(first, second);
        return { ok: true, height: height_max, height_min, height_max };
    }

    const single = toMillimetres(text);
    if (single === null) {
        return { ok: false, error: 'Enter a valid height, e.g. 3000 or 5000-6000' };
    }

    return {
        ok: true,
        height: single,
        height_min: single,
        height_max: single,
    };
};

export const formatRoomHeightForInput = (room) => {
    if (!room) return '';
    const min = room.height_min ?? room.height;
    const max = room.height_max ?? room.height;
    if (min != null && max != null && min !== max) {
        return `${min} - ${max}`;
    }
    if (room.height != null && room.height !== '') {
        return String(room.height);
    }
    return '';
};

export const formatRoomHeightLabel = (room) => {
    if (!room) return 'EXT. HT. No height';
    const min = room.height_min ?? room.height;
    const max = room.height_max ?? room.height;
    if (min != null && max != null && min !== max) {
        return `EXT. HT. ${min}-${max}mm`;
    }
    if (room.height != null && room.height !== '') {
        return `EXT. HT. ${room.height}mm`;
    }
    return 'EXT. HT. No height';
};

export const isRoomHeightRange = (room) => {
    const min = room?.height_min ?? room?.height;
    const max = room?.height_max ?? room?.height;
    return min != null && max != null && min !== max;
};
