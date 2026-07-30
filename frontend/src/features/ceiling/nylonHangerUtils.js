/**
 * Nylon hanger auto-placement for ceiling panels.
 *
 * Rule: for each full interval of the support threshold along the panel's
 * critical (longer) span, place one hanger at the midpoint of that interval.
 * Example (6000mm threshold): 6000 → 3000; 12000 → 3000 & 9000; 9000 → 3000.
 */

export function getNylonSupportThresholdMm(panelThicknessMm, fallbackThicknessMm = 150) {
    const thk = Number(panelThicknessMm ?? fallbackThicknessMm) || 0;
    return thk <= 100 ? 3000 : 6000;
}

export function getPanelCriticalSpanMm(panel) {
    const width = Number(panel?.width ?? 0);
    const length = Number(panel?.length ?? 0);
    return Math.max(width, length);
}

/** True when the panel is long enough to need at least one nylon hanger. */
export function panelNeedsNylonSupport(panel, ceilingThicknessMm = 150) {
    if (!panel) return false;
    const span = getPanelCriticalSpanMm(panel);
    const threshold = getNylonSupportThresholdMm(panel.thickness, ceilingThicknessMm);
    return span >= threshold;
}

/**
 * Auto hanger offsets on a panel (model mm).
 * offset_length = along panel.length (Y); offset_width = along panel.width (X).
 * null offset_width means “center of width” (caller resolves to width/2).
 */
export function getAutoNylonHangerOffsets(panel, ceilingThicknessMm = 150) {
    if (!panel) return [];
    const width = Number(panel.width ?? 0);
    const length = Number(panel.length ?? 0);
    if (!(width > 0) || !(length > 0)) return [];

    const span = Math.max(width, length);
    const interval = getNylonSupportThresholdMm(panel.thickness, ceilingThicknessMm);
    const count = Math.floor(span / interval);
    if (count < 1) return [];

    const mids = [];
    for (let i = 0; i < count; i += 1) {
        mids.push(i * interval + interval / 2);
    }

    // Space along the longer plan axis; center on the shorter axis.
    if (width > length) {
        return mids.map((offsetWidth) => ({
            offsetLength: length / 2,
            offsetWidth
        }));
    }
    return mids.map((offsetLength) => ({
        offsetLength,
        offsetWidth: null
    }));
}
