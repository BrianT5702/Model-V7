export function isCoarsePointerDevice() {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: coarse)').matches;
}

export function isMobileProjectLayout() {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 1023px)').matches;
}

export function getTouchCenter(touches) {
    if (!touches || touches.length === 0) {
        return null;
    }
    let x = 0;
    let y = 0;
    for (let i = 0; i < touches.length; i += 1) {
        x += touches[i].clientX;
        y += touches[i].clientY;
    }
    const count = touches.length;
    return { x: x / count, y: y / count };
}

/** Pixels of movement before locking one-finger to page-scroll vs canvas-pan. */
export const ONE_FINGER_GESTURE_THRESHOLD_PX = 8;

/**
 * On phones: vertical swipe scrolls the page; horizontal swipe pans the plan.
 * Returns 'pan' | 'scroll' | null (not decided yet).
 */
export function resolveOneFingerGestureLock(
    start,
    current,
    existingLock,
    threshold = ONE_FINGER_GESTURE_THRESHOLD_PX,
) {
    if (existingLock) {
        return existingLock;
    }
    if (!start || !current) {
        return null;
    }
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    if (Math.hypot(dx, dy) < threshold) {
        return null;
    }
    return Math.abs(dx) > Math.abs(dy) ? 'pan' : 'scroll';
}

/**
 * Apply a vertical touch drag to the nearest scroll parent (finger down → content down).
 */
export function forwardTouchDeltaToScrollParent(deltaY, fromElement) {
    if (!deltaY || !(fromElement instanceof Element)) {
        return false;
    }

    let el = fromElement.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const canScrollY = (
            overflowY === 'auto'
            || overflowY === 'scroll'
            || overflowY === 'overlay'
        ) && el.scrollHeight > el.clientHeight + 1;

        if (canScrollY) {
            const prev = el.scrollTop;
            el.scrollTop -= deltaY;
            if (el.scrollTop !== prev) {
                return true;
            }
        }
        el = el.parentElement;
    }

    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) {
        return false;
    }
    const prev = scroller.scrollTop;
    scroller.scrollTop -= deltaY;
    return scroller.scrollTop !== prev;
}

/**
 * Native non-passive phone touch for plan canvases.
 * React onTouchMove is often passive (preventDefault is ignored), which locks horizontal pan.
 * One-finger vertical → page scroll; one-finger horizontal → onOneFingerPan; two-finger → onTwoFingerPan.
 * Returns cleanup.
 */
export function bindPlanCanvasMobileTouch(canvas, {
    onOneFingerPan,
    onTwoFingerPan,
    shouldHandleOneFinger = () => true,
} = {}) {
    if (!canvas || typeof canvas.addEventListener !== 'function' || !isCoarsePointerDevice()) {
        return () => {};
    }

    let oneFingerStart = null;
    let oneFingerLast = null;
    let oneFingerLock = null;
    let twoFingerLast = null;

    const resetOneFinger = () => {
        oneFingerStart = null;
        oneFingerLast = null;
        oneFingerLock = null;
    };

    const onTouchStart = (event) => {
        if (event.touches.length >= 2) {
            resetOneFinger();
            twoFingerLast = getTouchCenter(event.touches);
            event.preventDefault();
            return;
        }
        if (event.touches.length === 1 && shouldHandleOneFinger()) {
            const touch = event.touches[0];
            oneFingerStart = { x: touch.clientX, y: touch.clientY };
            oneFingerLast = { x: touch.clientX, y: touch.clientY };
            oneFingerLock = null;
            twoFingerLast = null;
        }
    };

    const onTouchMove = (event) => {
        if (event.touches.length >= 2 && twoFingerLast) {
            const center = getTouchCenter(event.touches);
            if (center && typeof onTwoFingerPan === 'function') {
                onTwoFingerPan(center.x - twoFingerLast.x, center.y - twoFingerLast.y);
                twoFingerLast = center;
            }
            event.preventDefault();
            return;
        }

        if (event.touches.length !== 1 || !oneFingerStart || !oneFingerLast) {
            return;
        }
        if (!shouldHandleOneFinger()) {
            return;
        }

        const touch = event.touches[0];
        const current = { x: touch.clientX, y: touch.clientY };
        oneFingerLock = resolveOneFingerGestureLock(oneFingerStart, current, oneFingerLock);
        const deltaX = current.x - oneFingerLast.x;
        const deltaY = current.y - oneFingerLast.y;
        oneFingerLast = current;

        if (oneFingerLock === 'pan') {
            if (typeof onOneFingerPan === 'function') {
                onOneFingerPan(deltaX, deltaY);
            }
            event.preventDefault();
            return;
        }

        if (oneFingerLock === 'scroll') {
            forwardTouchDeltaToScrollParent(deltaY, canvas);
            event.preventDefault();
        }
    };

    const onTouchEnd = (event) => {
        if (event.touches.length >= 2) {
            twoFingerLast = getTouchCenter(event.touches);
            resetOneFinger();
            return;
        }
        if (event.touches.length === 1) {
            twoFingerLast = null;
            const touch = event.touches[0];
            oneFingerStart = { x: touch.clientX, y: touch.clientY };
            oneFingerLast = { x: touch.clientX, y: touch.clientY };
            oneFingerLock = null;
            return;
        }
        twoFingerLast = null;
        resetOneFinger();
    };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    return () => {
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        canvas.removeEventListener('touchcancel', onTouchEnd);
    };
}

/**
 * Apply wheel delta to the nearest vertical scroll parent.
 * Use when a canvas/overlay would otherwise swallow wheel (preventDefault / non-scrollable).
 */
export function forwardWheelToScrollParent(event, { ignoreSelector = '' } = {}) {
    if (!event || event.ctrlKey || event.metaKey) {
        return false;
    }
    const delta = event.deltaY;
    if (!delta) {
        return false;
    }

    const start = event.currentTarget instanceof Element
        ? event.currentTarget
        : (event.target instanceof Element ? event.target : null);
    if (!start) {
        return false;
    }

    if (ignoreSelector) {
        const ignored = event.target instanceof Element
            ? event.target.closest(ignoreSelector)
            : null;
        if (ignored) {
            return false;
        }
    }

    let el = start.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const canScrollY = (
            overflowY === 'auto'
            || overflowY === 'scroll'
            || overflowY === 'overlay'
        ) && el.scrollHeight > el.clientHeight + 1;

        if (canScrollY) {
            const prev = el.scrollTop;
            el.scrollTop += delta;
            if (el.scrollTop !== prev) {
                event.preventDefault();
                return true;
            }
            return false;
        }
        el = el.parentElement;
    }
    return false;
}
