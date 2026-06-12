import React from 'react';
import { FaMoon, FaSun } from 'react-icons/fa';
import { useTheme } from '../features/theme/ThemeContext';

const ThemeToggle = ({ className = '' }) => {
    const { isDark, toggleTheme } = useTheme();

    return (
        <button
            type="button"
            onClick={toggleTheme}
            className={`flex items-center justify-center p-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 transition-colors ${className}`.trim()}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            {isDark ? <FaSun className="w-4 h-4" /> : <FaMoon className="w-4 h-4" />}
        </button>
    );
};

export default ThemeToggle;
