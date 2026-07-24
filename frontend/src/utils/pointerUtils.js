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
