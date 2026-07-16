import React, { useEffect, useRef } from 'react';
import { useTheme } from '../theme/ThemeContext';
import { getPlanCanvasBackground, isPlanCanvasDark } from '../canvas/planCanvasTheme';

const PAD = 40;

/**
 * Draw a whole-model elevation onto a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {object} viewData
 * @param {{ cssWidth?: number, forceLight?: boolean, maxDrawH?: number }} [options]
 */
export function drawWholeModelElevation(canvas, viewData, options = {}) {
    if (!canvas || !viewData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const forceLight = options.forceLight === true;
    const dark = forceLight ? false : isPlanCanvasDark();
    const bg = forceLight ? '#ffffff' : getPlanCanvasBackground();
    const ink = dark ? '#e5e7eb' : '#111827';
    const muted = dark ? '#9ca3af' : '#6b7280';
    const faceFill = dark ? 'rgba(96, 165, 250, 0.22)' : 'rgba(59, 130, 246, 0.18)';
    const faceStroke = dark ? '#93c5fd' : '#1e40af';
    const edgeFill = dark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(100, 116, 139, 0.25)';
    const edgeStroke = dark ? '#64748b' : '#475569';
    const openingFill = dark ? '#0f172a' : '#ffffff';
    const doorStroke = dark ? '#fbbf24' : '#b45309';
    const windowStroke = dark ? '#34d399' : '#047857';
    const ground = dark ? '#94a3b8' : '#374151';

    const faces = Array.isArray(viewData.faces) ? viewData.faces : [];
    const bounds = viewData.bounds || { minU: 0, maxU: 1000, minV: 0, maxV: 3000 };
    const cssW = Math.max(360, options.cssWidth || canvas.clientWidth || 720);

    if (faces.length === 0) {
        const cssH = 140;
        const dpr = forceLight ? 1 : (window.devicePixelRatio || 1);
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
        if (!forceLight) {
            canvas.style.width = `${cssW}px`;
            canvas.style.height = `${cssH}px`;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.fillStyle = muted;
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No walls to project for this view', cssW / 2, cssH / 2);
        return;
    }

    const spanU = Math.max(1, bounds.maxU - bounds.minU);
    const spanV = Math.max(1, bounds.maxV - bounds.minV);
    const drawW = cssW - PAD * 2;
    const maxDrawH = options.maxDrawH || 420;
    const scale = Math.min(drawW / spanU, maxDrawH / spanV);
    const contentW = spanU * scale;
    const contentH = spanV * scale;
    const cssH = Math.ceil(PAD + 36 + contentH + 36);

    const dpr = forceLight ? 1 : (window.devicePixelRatio || 1);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    if (!forceLight) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.fillStyle = ink;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(viewData.title || 'Elevation', PAD, 20);
    ctx.fillStyle = muted;
    ctx.font = '11px sans-serif';
    ctx.fillText(viewData.subtitle || '', PAD, 36);

    const originX = PAD + (drawW - contentW) / 2;
    const originY = PAD + 44;
    const groundY = originY + contentH;

    const toX = (u) => originX + (u - bounds.minU) * scale;
    const toY = (v) => groundY - (v - bounds.minV) * scale;

    ctx.strokeStyle = ground;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(originX - 12, groundY);
    ctx.lineTo(originX + contentW + 12, groundY);
    ctx.stroke();

    faces.forEach((face) => {
        const yTop = toY(Math.max(face.v0, face.v1));
        const yBot = toY(Math.min(face.v0, face.v1));
        const h = Math.max(1, yBot - yTop);

        if (face.isEdge || Math.abs(face.u1 - face.u0) < 1e-6) {
            const x = toX(face.u0);
            ctx.strokeStyle = edgeStroke;
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(x, yTop);
            ctx.lineTo(x, yBot);
            ctx.stroke();
            return;
        }

        const x = toX(Math.min(face.u0, face.u1));
        const w = Math.max(1, Math.abs(face.u1 - face.u0) * scale);

        ctx.fillStyle = face.facesCamera ? faceFill : edgeFill;
        ctx.strokeStyle = face.facesCamera ? faceStroke : edgeStroke;
        ctx.lineWidth = face.facesCamera ? 1.5 : 1;
        ctx.fillRect(x, yTop, w, h);
        ctx.strokeRect(x, yTop, w, h);

        (face.openings || []).forEach((op) => {
            const ox = toX(Math.min(op.u0, op.u1));
            const ow = Math.max(1, Math.abs(op.u1 - op.u0) * scale);
            const oy = toY(Math.max(op.v0, op.v1));
            const oh = Math.max(1, Math.abs(op.v1 - op.v0) * scale);
            ctx.fillStyle = openingFill;
            ctx.fillRect(ox, oy, ow, oh);
            ctx.strokeStyle = op.type === 'door' ? doorStroke : windowStroke;
            ctx.lineWidth = 1.25;
            ctx.strokeRect(ox, oy, ow, oh);
        });
    });

    ctx.strokeStyle = muted;
    ctx.fillStyle = muted;
    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';

    const dimY = groundY + 16;
    ctx.beginPath();
    ctx.moveTo(originX, dimY);
    ctx.lineTo(originX + contentW, dimY);
    ctx.moveTo(originX, dimY - 4);
    ctx.lineTo(originX, dimY + 4);
    ctx.moveTo(originX + contentW, dimY - 4);
    ctx.lineTo(originX + contentW, dimY + 4);
    ctx.stroke();
    ctx.fillText(`${Math.round(spanU)} mm`, originX + contentW / 2, dimY + 12);

    ctx.textAlign = 'right';
    const dimX = originX - 10;
    ctx.beginPath();
    ctx.moveTo(dimX, originY);
    ctx.lineTo(dimX, groundY);
    ctx.moveTo(dimX - 4, originY);
    ctx.lineTo(dimX + 4, originY);
    ctx.moveTo(dimX - 4, groundY);
    ctx.lineTo(dimX + 4, groundY);
    ctx.stroke();
    ctx.save();
    ctx.translate(dimX - 8, originY + contentH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(spanV)} mm`, 0, 0);
    ctx.restore();
}

/** Render elevation to a PNG data URL for PDF export (always light theme). */
export function renderElevationViewToDataURL(viewData, { width = 1600, maxDrawH = 900 } = {}) {
    const canvas = document.createElement('canvas');
    drawWholeModelElevation(canvas, viewData, {
        cssWidth: width,
        maxDrawH,
        forceLight: true,
    });
    return canvas.toDataURL('image/png');
}

function ElevationCanvas({ viewData }) {
    const canvasRef = useRef(null);
    const { resolvedTheme } = useTheme();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const redraw = () => drawWholeModelElevation(canvas, viewData);
        redraw();
        const ro = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => redraw())
            : null;
        if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
        return () => ro?.disconnect();
    }, [viewData, resolvedTheme]);

    return (
        <div className="w-full overflow-x-auto rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900">
            <canvas ref={canvasRef} className="block w-full" />
        </div>
    );
}

/**
 * Whole-model Front View + Side View elevations.
 */
export default function WallElevationViews({ elevations = null }) {
    if (!elevations) return null;

    const { front, side, totals } = elevations;

    return (
        <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">
                Orthographic elevations of the <strong className="font-medium text-gray-800 dark:text-gray-200">whole building model</strong>
                {' '}— all walls projected with correct heights and storey elevations.
                Facing façades show doors/windows; end-on walls appear as edges.
                {totals ? (
                    <span className="ml-1 text-gray-500">({totals.walls} walls)</span>
                ) : null}
            </p>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <ElevationCanvas viewData={front} />
                <ElevationCanvas viewData={side} />
            </div>
        </div>
    );
}
