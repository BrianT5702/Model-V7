const RANGE_PATTERN = /^(-?[\d.]+)\s*(?:-|–|—|\.\.|to)\s*(-?[\d.]+)$/i;

const parseTemperatureNumber = (value) => {
    const number = parseFloat(value);
    if (Number.isNaN(number)) {
        return null;
    }
    return number;
};

export const formatTemperatureValue = (value) => {
    const number = Number(value);
    if (Number.isNaN(number)) {
        return '';
    }
    if (number > 0) {
        return `+${number}°C`;
    }
    return `${number}°C`;
};

export const parseRoomTemperatureInput = (raw) => {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
        return { ok: false, error: 'Temperature is required' };
    }

    if (typeof raw === 'number') {
        return {
            ok: true,
            temperature: raw,
            temperature_min: raw,
            temperature_max: raw,
        };
    }

    let text = String(raw).trim().toLowerCase();
    text = text.replace(/°c/g, '').replace(/\bc\b/g, '').trim();

    const rangeMatch = text.match(RANGE_PATTERN);
    if (rangeMatch) {
        const first = parseTemperatureNumber(rangeMatch[1]);
        const second = parseTemperatureNumber(rangeMatch[2]);
        if (first === null || second === null) {
            return { ok: false, error: 'Enter a valid temperature range, e.g. 2 - 6' };
        }
        const temperature_min = Math.min(first, second);
        const temperature_max = Math.max(first, second);
        return {
            ok: true,
            temperature: temperature_max,
            temperature_min,
            temperature_max,
        };
    }

    const single = parseTemperatureNumber(text);
    if (single === null) {
        return { ok: false, error: 'Enter a valid temperature, e.g. 5 or 2 - 6' };
    }

    return {
        ok: true,
        temperature: single,
        temperature_min: single,
        temperature_max: single,
    };
};

export const formatRoomTemperatureForInput = (room) => {
    if (!room) return '';
    const min = room.temperature_min ?? room.temperature;
    const max = room.temperature_max ?? room.temperature;
    if (min != null && max != null && Number(min) !== Number(max)) {
        return `${min} - ${max}`;
    }
    if (room.temperature !== null && room.temperature !== undefined && room.temperature !== '') {
        return String(room.temperature);
    }
    return '';
};

export const formatRoomTemperatureLabel = (room) => {
    if (!room) return '';

    const min = room.temperature_min ?? room.temperature;
    const max = room.temperature_max ?? room.temperature;

    if (min == null && max == null) {
        return '';
    }

    const minNum = Number(min);
    const maxNum = Number(max);

    if (!Number.isNaN(minNum) && !Number.isNaN(maxNum) && minNum !== maxNum) {
        return `${formatTemperatureValue(minNum)} TO ${formatTemperatureValue(maxNum)}`;
    }

    const single = Number(room.temperature ?? min ?? max);
    if (Number.isNaN(single) || single === 0) {
        return '';
    }

    return formatTemperatureValue(single);
};

export const shouldShowRoomTemperature = (room) => {
    const label = formatRoomTemperatureLabel(room);
    return label !== '';
};
