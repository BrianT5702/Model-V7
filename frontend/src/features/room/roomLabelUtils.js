import { formatRoomHeightLabel } from './roomHeightUtils';
import {
    formatRoomTemperatureLabel,
    shouldShowRoomTemperature,
} from './roomTemperatureUtils';

export const isRoomTemperatureRange = (room) => {
    const min = room?.temperature_min ?? room?.temperature;
    const max = room?.temperature_max ?? room?.temperature;
    return min != null && max != null && Number(min) !== Number(max);
};

/**
 * Build room label lines for canvas / export display.
 * Temperature ranges use three rows: name, temperature, external height.
 * Single temperatures keep the existing compact layout.
 */
export const buildRoomLabelLines = (room) => {
    const name = room?.room_name || 'Unnamed Room';
    const temperature = shouldShowRoomTemperature(room)
        ? formatRoomTemperatureLabel(room)
        : '';
    const height = formatRoomHeightLabel(room);

    if (temperature && isRoomTemperatureRange(room)) {
        return [name, temperature, height];
    }

    const lines = [];
    if (temperature) {
        if (name.length > 15) {
            lines.push(name);
            lines.push(temperature);
        } else {
            lines.push(`${name} ${temperature}`);
        }
    } else {
        lines.push(name);
    }
    lines.push(height);
    return lines;
};

export const buildRoomLabelHtml = (room) => buildRoomLabelLines(room).join('<br/>');
