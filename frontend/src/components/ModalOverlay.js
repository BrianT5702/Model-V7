import React from 'react';
import { useLockBodyScroll } from '../utils/useLockBodyScroll';

/**
 * Full-screen modal backdrop. Locks page scroll and keeps wheel events on the
 * backdrop from reaching the document.
 */
const ModalOverlay = ({ children, className = '', onWheel, ...rest }) => {
    useLockBodyScroll(true);

    const handleWheel = (e) => {
        if (e.target === e.currentTarget) {
            e.preventDefault();
        }
        onWheel?.(e);
    };

    return (
        <div
            className={`modal-overlay fixed inset-0 ${className}`.trim()}
            onWheel={handleWheel}
            {...rest}
        >
            {children}
        </div>
    );
};

export default ModalOverlay;
