/**
 * Diagonal company name burned into 3D screenshots and recordings.
 */

const COMPANY_LINE = 'Under Properties of United Cold System (M) SDN.BHD';

function measureLine(ctx, fontSize) {
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    const stroke = Math.max(1, fontSize * 0.04);
    return {
        width: ctx.measureText(COMPANY_LINE).width + stroke,
        height: fontSize * 1.35 + stroke,
        stroke,
    };
}

/** Largest size whose rotated line stays fully inside the frame. */
function fontThatFits(ctx, width, height, angle) {
    const pad = Math.max(16, Math.round(Math.min(width, height) * 0.035));
    const limitW = width - pad * 2;
    const limitH = height - pad * 2;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    let low = 12;
    let high = Math.max(12, Math.round(Math.min(width, height) * 0.12));
    let best = 12;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const block = measureLine(ctx, mid);
        const boxW = block.width * cos + block.height * sin;
        const boxH = block.width * sin + block.height * cos;
        if (boxW <= limitW && boxH <= limitH) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return best;
}

export function drawCaptureWatermark(ctx, width, height) {
    const angle = -Math.atan2(height, width);

    ctx.save();
    const fontSize = fontThatFits(ctx, width, height, angle);
    const { stroke } = measureLine(ctx, fontSize);
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';

    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);
    ctx.strokeText(COMPANY_LINE, 0, 0);
    ctx.fillText(COMPANY_LINE, 0, 0);
    ctx.restore();
}
