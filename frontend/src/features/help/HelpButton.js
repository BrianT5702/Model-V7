import React, { useState } from 'react';
import { FaQuestionCircle } from 'react-icons/fa';
import UserManualModal from './UserManualModal';

const HelpButton = () => {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
                title="User manual"
                aria-label="Open user manual"
            >
                <FaQuestionCircle className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Help</span>
            </button>
            {open && <UserManualModal onClose={() => setOpen(false)} />}
        </>
    );
};

export default HelpButton;
