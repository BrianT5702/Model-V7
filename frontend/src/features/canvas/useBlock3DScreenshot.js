import { useEffect, useState } from 'react';

const BLOCK_MS = 1400;

function isScreenshotKey(event) {
    const key = event.key || '';
    const code = event.code || '';
    if (key === 'PrintScreen' || code === 'PrintScreen') return true;
    // macOS screenshot shortcuts
    if (event.metaKey && event.shiftKey && ['3', '4', '5'].includes(key)) return true;
    // Print dialog can capture the model
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'p') return true;
    return false;
}

/**
 * Guests can look at the 3D model, but common screenshot gestures blank it.
 * A photo of the monitor still works; the browser cannot stop that.
 */
export default function useBlock3DScreenshot(rootRef, enabled) {
    const [blocked, setBlocked] = useState(false);

    useEffect(() => {
        if (!enabled) {
            setBlocked(false);
            return undefined;
        }

        const root = rootRef.current;
        if (!root) return undefined;

        let restoreTimer = null;

        const stage = () => root.querySelector('.three-canvas-stage');

        const hideModel = () => {
            stage()?.classList.add('is-screenshot-blocked');
            setBlocked(true);
            window.clearTimeout(restoreTimer);
        };

        const scheduleRestore = () => {
            window.clearTimeout(restoreTimer);
            const tryRestore = () => {
                if (document.hidden || !document.hasFocus()) {
                    restoreTimer = window.setTimeout(tryRestore, 300);
                    return;
                }
                stage()?.classList.remove('is-screenshot-blocked');
                setBlocked(false);
            };
            restoreTimer = window.setTimeout(tryRestore, BLOCK_MS);
        };

        const onKey = (event) => {
            if (!isScreenshotKey(event)) return;
            event.preventDefault();
            event.stopPropagation();
            hideModel();
            scheduleRestore();
        };

        const onContextMenu = (event) => {
            event.preventDefault();
        };

        const onBlur = () => {
            hideModel();
        };

        const onFocus = () => {
            scheduleRestore();
        };

        const onVisibility = () => {
            if (document.hidden) hideModel();
            else scheduleRestore();
        };

        document.addEventListener('keydown', onKey, true);
        document.addEventListener('keyup', onKey, true);
        root.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        window.addEventListener('beforeprint', hideModel);
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            window.clearTimeout(restoreTimer);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKey, true);
            root.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('beforeprint', hideModel);
            document.removeEventListener('visibilitychange', onVisibility);
            stage()?.classList.remove('is-screenshot-blocked');
            setBlocked(false);
        };
    }, [enabled, rootRef]);

    return blocked;
}
