import { useEffect } from 'react';

let lockCount = 0;
let savedScrollY = 0;

function applyBodyScrollLock() {
    savedScrollY = window.scrollY;
    const { style } = document.body;
    style.position = 'fixed';
    style.top = `-${savedScrollY}px`;
    style.left = '0';
    style.right = '0';
    style.width = '100%';
    style.overflow = 'hidden';
}

function releaseBodyScrollLock() {
    const { style } = document.body;
    style.position = '';
    style.top = '';
    style.left = '';
    style.right = '';
    style.width = '';
    style.overflow = '';
    window.scrollTo(0, savedScrollY);
}

/**
 * Prevents the page behind a modal from scrolling while the modal is open.
 * Supports nested modals via an internal ref count.
 */
export function useLockBodyScroll(isLocked) {
    useEffect(() => {
        if (!isLocked) return undefined;

        lockCount += 1;
        if (lockCount === 1) {
            applyBodyScrollLock();
        }

        return () => {
            lockCount = Math.max(0, lockCount - 1);
            if (lockCount === 0) {
                releaseBodyScrollLock();
            }
        };
    }, [isLocked]);
}
