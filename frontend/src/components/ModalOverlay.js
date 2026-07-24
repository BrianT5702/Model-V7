import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from '../utils/useLockBodyScroll';

function findScrollableModalPanel(start, root) {
    let el = start instanceof Element ? start : null;
    while (el && el !== root) {
        if (
            el.classList?.contains('modal-scroll-panel')
            || el.classList?.contains('scroll-contain-panel')
            || el.hasAttribute?.('data-modal-scroll')
        ) {
            return el;
        }
        el = el.parentElement;
    }
    return null;
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
                    const atTop = scrollTop <= 0;
                    const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
                    if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
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
