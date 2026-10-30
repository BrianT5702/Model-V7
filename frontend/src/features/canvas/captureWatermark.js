/**
 * Diagonal confidentiality mark burned into 3D screenshots and recordings.
 */

const COMPANY_LINE = 'Under Properties of United Cold System (M) SDN.BHD';

export function formatCaptureDay(date) {
    return new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(date);
}

export function captureWatermarkLines(date = new Date()) {
    return [
        COMPANY_LINE,
        `DATE: ${formatCaptureDay(date)}`,
        'CONFIDENTIALITY',
    ];
}

function measureBlock(ctx, lines, fontSize) {
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    let maxWidth = 0;
    lines.forEach((line) => {
        maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
    });
    const lineHeight = fontSize * 1.35;
    const stroke = Math.max(1, fontSize * 0.04);
    return {
        width: maxWidth + stroke,
        height: lineHeight * lines.length + stroke,
        lineHeight,
        stroke,
    };
}

/** Largest size whose rotated block stays inside the frame, including the offset company line. */
function fontThatFits(ctx, lines, width, height, angle) {
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
        const block = measureBlock(ctx, lines, mid);
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

export function drawCaptureWatermark(ctx, width, height, date = new Date()) {
    const lines = captureWatermarkLines(date);
    const angle = -Math.atan2(height, width);

    ctx.save();
    const fontSize = fontThatFits(ctx, lines, width, height, angle);
    const { lineHeight, stroke } = measureBlock(ctx, lines, fontSize);
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';

    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);

    const blockTop = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
        const y = blockTop + index * lineHeight;
        ctx.strokeText(line, 0, y);
        ctx.fillText(line, 0, y);
    });
    ctx.restore();
}
