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
