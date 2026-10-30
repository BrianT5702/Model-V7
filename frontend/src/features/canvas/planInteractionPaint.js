import { getPlanCanvasBackground } from './planCanvasTheme';

/**
 * Shift a previously painted plan under the cursor.
 * Pan and zoom reuse this bitmap; the vector plan is rebuilt when the gesture ends.
 */
export function blitPlanSnapshot(targetCanvas, snapshot, view) {
    if (!targetCanvas || !snapshot?.canvas || !view) return;
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return;
    const dpr = snapshot.dpr || 1;
    const snapScale = snapshot.scale || 1;
    const scale = view.scale;
    if (!(snapScale > 0) || !(scale > 0)) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getPlanCanvasBackground();
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

    if (Math.abs(scale - snapScale) < 1e-8) {
        const dx = (view.offsetX - snapshot.offsetX) * dpr;
        const dy = (view.offsetY - snapshot.offsetY) * dpr;
        ctx.drawImage(snapshot.canvas, dx, dy);
    } else {
        const k = scale / snapScale;
        const tx = (view.offsetX - snapshot.offsetX * k) * dpr;
        const ty = (view.offsetY - snapshot.offsetY * k) * dpr;
        ctx.setTransform(k, 0, 0, k, tx, ty);
        ctx.drawImage(snapshot.canvas, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Move room labels and notes with the plan without re-rendering them. */
export function syncPlanHudTransform(hud, base, view) {
    if (!hud || !base || !(base.scale > 0) || !(view?.scale > 0)) return;
    const k = view.scale / base.scale;
    const tx = view.offsetX - base.offsetX * k;
    const ty = view.offsetY - base.offsetY * k;
    if (Math.abs(k - 1) < 1e-6 && Math.abs(tx) < 0.4 && Math.abs(ty) < 0.4) {
        hud.style.transform = '';
        return;
    }
    hud.style.transformOrigin = '0 0';
    hud.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
}
