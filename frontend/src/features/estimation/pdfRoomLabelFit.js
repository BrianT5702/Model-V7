/**
 * Shared room-label sizing for vector PDF plans (wall / ceiling / floor).
 * Matches InteractiveRoomLabel: fit-to-page zoom ratio 1, shrink with room footprint,
 * then shrink/wrap so long names do not spill past walls.
 */

export function computePdfRoomLabelMetrics(room, scalePdfMmPerModelMm) {
    const BASE_FONT_SIZE = 8;
    const BASE_MAX_WIDTH = 120;
    const PX_PER_PDF_MM = 96 / 25.4;
    const points = Array.isArray(room?.room_points) ? room.room_points : [];
    let roomModelW = 0;
    let roomModelH = 0;
    if (points.length >= 3) {
        const xs = points.map((pt) => Number(pt.x) || (Array.isArray(pt) ? Number(pt[0]) : 0) || 0);
        const ys = points.map((pt) => Number(pt.y) || (Array.isArray(pt) ? Number(pt[1]) : 0) || 0);
        roomModelW = Math.max(...xs) - Math.min(...xs);
        roomModelH = Math.max(...ys) - Math.min(...ys);
    }
    const equivScaleFactor = Math.max(scalePdfMmPerModelMm * PX_PER_PDF_MM, 1e-9);
    const roomScreenWidth = roomModelW * equivScaleFactor;
    const roomFitRatio =
        roomModelW > 0
            ? Math.min(1, Math.max(0.22, roomScreenWidth / BASE_MAX_WIDTH))
            : 0.5;
    const labelScale = roomFitRatio;
    const fontPt = Math.max(BASE_FONT_SIZE * labelScale, 2.4);
    const roomPdfW = roomModelW * scalePdfMmPerModelMm;
    const roomPdfH = roomModelH * scalePdfMmPerModelMm;

    const labelWidthModel = 140 / equivScaleFactor;
    const labelHeightModel = 50 / equivScaleFactor;
    const marginModel = 20 / equivScaleFactor;
    const canContain =
        roomModelW >= labelWidthModel + marginModel &&
        roomModelH >= labelHeightModel + marginModel;

    return { fontPt, labelScale, canContain, equivScaleFactor, roomPdfW, roomPdfH };
}

/**
 * Shrink + wrap room name so it stays inside the room footprint on the PDF page.
 * Outside labels use a modest max width (like the canvas label box) instead of the room.
 */
export function fitPdfRoomLabelText(doc, roomName, room, scalePdfMmPerModelMm, isOutside = false) {
    const metrics = computePdfRoomLabelMetrics(room, scalePdfMmPerModelMm);
    let fontPt = metrics.fontPt;
    const MIN_PT = 2.0;
    const maxWidthMm = isOutside
        ? Math.max(10, 22 * metrics.labelScale)
        : Math.max(metrics.roomPdfW * 0.86, 2.2);
    const maxHeightMm = isOutside
        ? 40
        : Math.max(metrics.roomPdfH * 0.9, 2.5);

    const name = String(roomName || 'Room');
    let lines = [name];
    for (let i = 0; i < 48; i++) {
        doc.setFontSize(fontPt);
        lines = doc.splitTextToSize(name, maxWidthMm);
        if (!Array.isArray(lines) || lines.length === 0) lines = [name];
        const widest = Math.max(...lines.map((line) => doc.getTextWidth(line)));
        const lineGapMm = Math.max(fontPt * 0.32, 1.1);
        const blockH = lines.length * lineGapMm;
        if (widest <= maxWidthMm + 0.05 && blockH <= maxHeightMm) break;
        if (fontPt <= MIN_PT) break;
        fontPt = Math.max(MIN_PT, fontPt - 0.15);
    }

    doc.setFontSize(fontPt);
    const lineGapMm = Math.max(fontPt * 0.32, 1.1);
    const textBlockWidthMm = Math.max(...lines.map((line) => doc.getTextWidth(line)));
    return {
        ...metrics,
        fontPt,
        lines,
        lineGapMm,
        textBlockWidthMm,
    };
}
