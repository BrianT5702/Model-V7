/** Theme helpers for wall / ceiling / floor plan canvases */



/** Selection / hover accents — already readable on dark canvas; keep hue intact. */

const BRIGHT_STROKE_COLORS = new Set([

    'red',

    '#ff0000',

    '#f44336',

    '#2196f3',

    '#4caf50',

    '#ff5722',

    '#f59e0b',

    '#10b981',

    '#22c55e',

    '#3b82f6',

    '#ef4444',

    '#dc2626',

    '#ff9800',

    '#1d4ed8',

]);



/** Minimum relative luminance for wall strokes on the dark plan canvas (~#1f2937). */

const DARK_CANVAS_MIN_STROKE_LUMINANCE = 0.42;



/** Updated synchronously from ThemeProvider so canvas draws match React theme immediately. */

let planThemeIsDark = false;



export function syncPlanCanvasTheme(isDark) {

    planThemeIsDark = Boolean(isDark);

}



export function isPlanCanvasDark() {

    return planThemeIsDark;

}



export function getPlanCanvasBackground() {

    return isPlanCanvasDark() ? '#1f2937' : '#fafafa';

}



export function getPlanCanvasGridColor(isActive = false) {

    if (isPlanCanvasDark()) {

        return isActive ? '#6b7280' : '#374151';

    }

    return isActive ? '#a0a0a0' : '#dddddd';

}



export function getPlanLabelBackground() {

    return isPlanCanvasDark() ? '#374151' : '#ffffff';

}

/** Fixed HUD (title / scale) in the plan canvas corner. */
export function getPlanHudColors() {
    return isPlanCanvasDark()
        ? { background: 'rgba(31, 41, 55, 0.92)', text: '#e5e7eb' }
        : { background: 'rgba(255, 255, 255, 0.88)', text: '#374151' };
}

/** Dimension lines + label text on plan canvases. */
export function getPlanDimensionStrokeColor(color) {
    return adjustPlanStrokeColor(color);
}

function ceilingPanelFillLightness(isCut) {
    if (!isPlanCanvasDark()) return isCut ? 40 : 65;
    return isCut ? 52 : 60;
}

function ceilingPanelStrokeLightness(isCut) {
    if (!isPlanCanvasDark()) return isCut ? 20 : 35;
    return isCut ? 68 : 76;
}

/** Ceiling panel fill/stroke colours keyed by finish hue. */
export function buildCeilingPanelFinishColors(hue, isCut = false) {
    const fillLight = ceilingPanelFillLightness(isCut);
    const strokeLight = ceilingPanelStrokeLightness(isCut);
    const fillAlpha = isPlanCanvasDark() ? (isCut ? 0.5 : 0.38) : (isCut ? 0.8 : 0.45);
    return {
        fill: `hsla(${hue}, ${isPlanCanvasDark() ? 55 : 70}%, ${fillLight}%, ${fillAlpha})`,
        stroke: `hsl(${hue}, ${isPlanCanvasDark() ? 60 : 70}%, ${strokeLight}%)`,
    };
}

export function getCeilingNeutralPanelColors() {
    if (!isPlanCanvasDark()) {
        return {
            panelFillFull: 'rgba(148, 163, 184, 0.35)',
            panelFillCut: 'rgba(148, 163, 184, 0.7)',
            panelStrokeFull: '#9ca3af',
            panelStrokeCut: '#4b5563',
        };
    }
    return {
        panelFillFull: 'rgba(186, 196, 214, 0.32)',
        panelFillCut: 'rgba(148, 163, 184, 0.55)',
        panelStrokeFull: '#d1d5db',
        panelStrokeCut: '#9ca3af',
    };
}



export function getPlanWallOuterStroke() {

    return isPlanCanvasDark() ? '#e5e7eb' : '#333333';

}



export function getPlanWallInnerStroke() {

    return isPlanCanvasDark() ? '#b8bcc4' : '#6b7280';

}



export function getPlanDefaultWallColors() {

    return isPlanCanvasDark()

        ? { wall: '#e5e7eb', partition: '#b8bcc4', hasDifferentFaces: false }

        : { wall: '#333333', partition: '#666666', hasDifferentFaces: false };

}



export function getPlanWallHslLightness(wallRole = 'wall') {

    if (!isPlanCanvasDark()) {

        return wallRole === 'partition' ? 50 : 35;

    }

    return wallRole === 'partition' ? 68 : 76;

}



export function getPlanWallHslSaturation(wallRole = 'wall') {

    if (!isPlanCanvasDark()) {

        return wallRole === 'partition' ? 60 : 70;

    }

    return wallRole === 'partition' ? 55 : 72;

}



function relativeLuminance(r, g, b) {

    const channel = (v) => {

        const n = v / 255;

        return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;

    };

    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

}



function rgbToHsl(r, g, b) {

    const rn = r / 255;

    const gn = g / 255;

    const bn = b / 255;

    const max = Math.max(rn, gn, bn);

    const min = Math.min(rn, gn, bn);

    const delta = max - min;

    let h = 0;

    let s = 0;

    const l = (max + min) / 2;



    if (delta !== 0) {

        s = delta / (1 - Math.abs(2 * l - 1));

        switch (max) {

            case rn:

                h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;

                break;

            case gn:

                h = ((bn - rn) / delta + 2) * 60;

                break;

            default:

                h = ((rn - gn) / delta + 4) * 60;

                break;

        }

    }



    return { h, s: s * 100, l: l * 100 };

}



function hslToRgb(h, s, l) {

    const sn = s / 100;

    const ln = l / 100;

    const c = (1 - Math.abs(2 * ln - 1)) * sn;

    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));

    const m = ln - c / 2;

    let r1 = 0;

    let g1 = 0;

    let b1 = 0;



    if (h < 60) [r1, g1, b1] = [c, x, 0];

    else if (h < 120) [r1, g1, b1] = [x, c, 0];

    else if (h < 180) [r1, g1, b1] = [0, c, x];

    else if (h < 240) [r1, g1, b1] = [0, x, c];

    else if (h < 300) [r1, g1, b1] = [x, 0, c];

    else [r1, g1, b1] = [c, 0, x];



    return {

        r: Math.round((r1 + m) * 255),

        g: Math.round((g1 + m) * 255),

        b: Math.round((b1 + m) * 255),

    };

}



function parseColorToHsl(color) {

    const raw = String(color).trim();

    const key = raw.toLowerCase();



    const hslMatch = key.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);

    if (hslMatch) {

        return {

            h: parseFloat(hslMatch[1]),

            s: parseFloat(hslMatch[2]),

            l: parseFloat(hslMatch[3]),

        };

    }



    const rgbMatch = key.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);

    if (rgbMatch) {

        return rgbToHsl(

            parseFloat(rgbMatch[1]),

            parseFloat(rgbMatch[2]),

            parseFloat(rgbMatch[3])

        );

    }



    const hexMatch = key.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

    if (hexMatch) {

        let hex = hexMatch[1];

        if (hex.length === 3) {

            hex = hex.split('').map((c) => c + c).join('');

        }

        return rgbToHsl(

            parseInt(hex.slice(0, 2), 16),

            parseInt(hex.slice(2, 4), 16),

            parseInt(hex.slice(4, 6), 16)

        );

    }



    if (key === 'black') return { h: 0, s: 0, l: 0 };

    if (key === 'white') return { h: 0, s: 0, l: 100 };



    return null;

}



function boostHslForDarkCanvas(hsl) {

    let { h, s, l } = hsl;

    s = Math.max(s, 38);

    l = Math.max(l, 66);



    let rgb = hslToRgb(h, s, l);

    let lum = relativeLuminance(rgb.r, rgb.g, rgb.b);

    let guard = 0;



    while (lum < DARK_CANVAS_MIN_STROKE_LUMINANCE && l < 88 && guard < 24) {

        l = Math.min(88, l + 4);

        s = Math.min(85, s + 2);

        rgb = hslToRgb(h, s, l);

        lum = relativeLuminance(rgb.r, rgb.g, rgb.b);

        guard += 1;

    }



    return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;

}



/**

 * Lighten dark wall/partition strokes so they stay readable on the dark plan canvas.

 * Works for hex, rgb, hsl, and named grays — used by drawWallLinePair, caps, partitions.

 */

export function adjustPlanStrokeColor(color) {

    if (!color || !isPlanCanvasDark()) return color;



    const key = String(color).toLowerCase().trim();

    if (BRIGHT_STROKE_COLORS.has(key)) return color;



    const hsl = parseColorToHsl(color);

    if (!hsl) return color;



    return boostHslForDarkCanvas(hsl);

}


