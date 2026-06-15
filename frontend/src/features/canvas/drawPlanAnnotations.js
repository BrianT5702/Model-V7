import { isPlanCanvasDark } from './planCanvasTheme';

const hasArrowTarget = (annotation) => (
    annotation?.arrow_target_x != null && annotation?.arrow_target_y != null
);

const toCanvasPoint = (x, y, scaleFactor, offsetX, offsetY) => ({
    x: x * scaleFactor + offsetX,
    y: y * scaleFactor + offsetY,
});

export function drawPlanAnnotationArrows(context, annotations, scaleFactor, offsetX, offsetY) {
    if (!Array.isArray(annotations) || annotations.length === 0) {
        return;
    }

    const strokeColor = isPlanCanvasDark() ? '#fbbf24' : '#dc2626';
    const lineWidth = Math.max(1.5, 2 * scaleFactor);

    annotations.forEach((annotation) => {
        if (!hasArrowTarget(annotation)) {
            return;
        }

        const start = toCanvasPoint(
            annotation.position_x,
            annotation.position_y,
            scaleFactor,
            offsetX,
            offsetY
        );
        const end = toCanvasPoint(
            annotation.arrow_target_x,
            annotation.arrow_target_y,
            scaleFactor,
            offsetX,
            offsetY
        );

        context.save();
        context.strokeStyle = strokeColor;
        context.fillStyle = strokeColor;
        context.lineWidth = lineWidth;
        context.setLineDash([]);

        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();

        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLength = Math.max(8, 12 * scaleFactor);
        const headAngle = Math.PI / 7;

        context.beginPath();
        context.moveTo(end.x, end.y);
        context.lineTo(
            end.x - headLength * Math.cos(angle - headAngle),
            end.y - headLength * Math.sin(angle - headAngle)
        );
        context.lineTo(
            end.x - headLength * Math.cos(angle + headAngle),
            end.y - headLength * Math.sin(angle + headAngle)
        );
        context.closePath();
        context.fill();
        context.restore();
    });
}

export function isPointNearPlanAnnotation(canvasX, canvasY, annotation, scaleFactor, offsetX, offsetY, padding = 8) {
    const boxX = annotation.position_x * scaleFactor + offsetX;
    const boxY = annotation.position_y * scaleFactor + offsetY;
    const text = (annotation.text || '').trim() || 'Note';
    const approxWidth = Math.min(220, Math.max(72, text.length * 7 + 24));
    const approxHeight = 44;

    return (
        canvasX >= boxX - padding
        && canvasX <= boxX + approxWidth + padding
        && canvasY >= boxY - padding
        && canvasY <= boxY + approxHeight + padding
    );
}
