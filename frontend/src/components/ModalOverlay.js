import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from '../utils/useLockBodyScroll';

function findScrollableModalPanel(start, root) {
    let el = start instanceof Element ? start : null;
    let deepestMarked = null;
    let deepestScrollable = null;

    while (el && el !== root) {
        const marked =
            el.classList?.contains('modal-scroll-panel')
            || el.classList?.contains('scroll-contain-panel')
            || el.hasAttribute?.('data-modal-scroll');

        // Walking upward: first marked hit is the innermost nested panel.
        if (marked && !deepestMarked) {
            deepestMarked = el;
        }

        const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
        const overflowY = style?.overflowY || '';
        const canOverflow =
            overflowY === 'auto'
            || overflowY === 'scroll'
            || overflowY === 'overlay';
        if (
            canOverflow
            && el.scrollHeight > el.clientHeight + 1
            && !deepestScrollable
        ) {
            deepestScrollable = el;
        }

        el = el.parentElement;
    }

    // Prefer the nested list/panel that can actually scroll (e.g. max-h-56 list
    // inside a modal-scroll-panel that itself does not need to scroll).
    if (deepestScrollable) {
        return deepestScrollable;
    }
    return deepestMarked;
}

/**
 * Full-screen modal backdrop.
 * Rendered in a portal on document.body so wheel events are not stolen by
 * scrollable ancestors (e.g. canvas-panel-scroll on desktop project view).
 */
const ModalOverlay = ({ children, className = '', onWheel, ...rest }) => {
    useLockBodyScroll(true);
    const overlayRef = useRef(null);

    useEffect(() => {
        const el = overlayRef.current;
        if (!el) {
            return undefined;
        }

        const onWheelCapture = (event) => {
            onWheel?.(event);

            const panel = findScrollableModalPanel(event.target, el);
            if (panel) {
                const { scrollTop, scrollHeight, clientHeight } = panel;
                const canScroll = scrollHeight > clientHeight + 1;
                const delta = event.deltaY;

                if (!canScroll) {
                    event.preventDefault();
                } else {
                    // Manually scroll the nested panel. Capture-phase stopPropagation
                    // otherwise leaves some browsers with nowhere to apply the default.
                    const maxScroll = scrollHeight - clientHeight;
                    const next = Math.min(maxScroll, Math.max(0, scrollTop + delta));
                    if (next !== scrollTop) {
                        panel.scrollTop = next;
                        event.preventDefault();
                    } else {
                        // At edge of this panel — block so the page behind does not move.
                        event.preventDefault();
                    }
                }
                // Always stop so desktop layout scrollers behind the modal never move.
                event.stopPropagation();
                return;
            }

            // Backdrop / non-scrollable chrome: block page scroll entirely.
            event.preventDefault();
            event.stopPropagation();
        };

        el.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });
        return () => {
            el.removeEventListener('wheel', onWheelCapture, { capture: true });
        };
    }, [onWheel]);

    if (typeof document === 'undefined') {
        return null;
    }

    return createPortal(
        <div
            ref={overlayRef}
            className={`modal-overlay fixed inset-0 ${className}`.trim()}
            {...rest}
        >
            {children}
        </div>,
        document.body,
    );
};

export default ModalOverlay;
