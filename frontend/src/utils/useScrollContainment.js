import { useEffect } from 'react';

/**
 * Keeps wheel scrolling inside a scrollable panel so the page/body does not
 * scroll instead (or in addition) while the pointer is over the panel.
 */
export default function useScrollContainment(ref, enabled = true) {
    useEffect(() => {
        if (!enabled) return undefined;

        const el = ref.current;
        if (!el) return undefined;

        const onWheel = (e) => {
            const { scrollTop, scrollHeight, clientHeight } = el;
            if (scrollHeight <= clientHeight + 1) return;

            // Always keep this gesture on the panel — do not let the page scroll.
            e.preventDefault();
            e.stopPropagation();

            const maxScroll = scrollHeight - clientHeight;
            const next = Math.min(maxScroll, Math.max(0, scrollTop + e.deltaY));
            if (next !== scrollTop) {
                el.scrollTop = next;
            }
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [ref, enabled]);
}
