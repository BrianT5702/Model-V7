import { useEffect } from 'react';

/**
 * Stops wheel scroll from chaining to the page when a scrollable panel
 * is already at its top or bottom edge.
 */
export default function useScrollContainment(ref, enabled = true) {
    useEffect(() => {
        if (!enabled) return undefined;

        const el = ref.current;
        if (!el) return undefined;

        const onWheel = (e) => {
            const { scrollTop, scrollHeight, clientHeight } = el;
            if (scrollHeight <= clientHeight) return;

            const delta = e.deltaY;
            const atTop = scrollTop <= 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

            if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
                e.preventDefault();
            }
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [ref, enabled]);
}
