import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FaSignInAlt, FaSignOutAlt, FaUser, FaUsersCog } from 'react-icons/fa';
import { useAuth } from '../features/auth/AuthContext';
import { useShare } from '../features/share/ShareContext';
import { ROLE_BADGE_CLASSES, ROLE_LABELS } from '../features/auth/authUtils';
import AdminAccountsModal from './AdminAccountsModal';
import ThemeToggle from './ThemeToggle';

const AuthStatusBar = () => {
    const { isAuthenticated, isAdmin, role, user, logout, isLoading } = useAuth();
    const { isShareSession, isEditShare, isViewOnlyShare, share } = useShare();
    const location = useLocation();
    const [showAccountsModal, setShowAccountsModal] = useState(false);

    if (isLoading) {
        return null;
    }

    const roleBadgeClass = ROLE_BADGE_CLASSES[role] || 'text-gray-700 bg-gray-50 border-gray-200';
    const roleLabel = ROLE_LABELS[role] || role;
    const shareLoginState = share?.token
        ? { from: { pathname: `/share/${share.token}` } }
        : { from: location };

    // View-only share: no login, no registration/Accounts.
    if (isViewOnlyShare) {
        return (
            <div className="flex items-center gap-1.5 sm:gap-2">
                <ThemeToggle />
                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-200 dark:bg-amber-950/50 dark:border-amber-800 rounded-md px-1.5 py-0.5">
                    View-only link
                </span>
            </div>
        );
    }

    // Editable share: login allowed, registration/Accounts never shown.
    if (isEditShare) {
        return (
            <div className="flex items-center gap-1.5 sm:gap-2">
                <ThemeToggle />
                <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 dark:text-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-800 rounded-md px-1.5 py-0.5">
                    Editable link
                </span>
                {isAuthenticated ? (
                    <>
                        <div className="hidden sm:flex items-center text-xs text-gray-600 dark:text-gray-300">
                            <FaUser className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                            <span>{user?.username}</span>
                            {role && (
                                <span className={`ml-1.5 text-[10px] border rounded px-1 py-0.5 ${roleBadgeClass}`}>
                                    {roleLabel}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={logout}
                            className="flex items-center px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
                        >
                            <FaSignOutAlt className="w-3.5 h-3.5 sm:mr-1.5" />
                            <span className="hidden sm:inline">Logout</span>
                        </button>
                    </>
                ) : (
                    <Link
                        to="/login"
                        state={shareLoginState}
                        className="flex items-center px-2 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                        <FaSignInAlt className="w-3.5 h-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline">Login to edit</span>
                    </Link>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            {isAuthenticated ? (
                <>
                    <div className="hidden sm:flex items-center text-xs text-gray-600 dark:text-gray-300">
                        <FaUser className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                        <span>{user?.username}</span>
                        {role && (
                            <span className={`ml-1.5 text-[10px] border rounded px-1 py-0.5 ${roleBadgeClass}`}>
                                {roleLabel}
                            </span>
                        )}
                    </div>
                    {isAdmin && !isShareSession && (
                        <button
                            type="button"
                            onClick={() => setShowAccountsModal(true)}
                            className="flex items-center px-2 py-1.5 rounded-md text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:text-indigo-100 dark:hover:bg-indigo-950 transition-colors"
                        >
                            <FaUsersCog className="w-3.5 h-3.5 sm:mr-1.5" />
                            <span className="hidden sm:inline">Accounts</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={logout}
                        className="flex items-center px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
                    >
                        <FaSignOutAlt className="w-3.5 h-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline">Logout</span>
                    </button>
                </>
            ) : (
                <>
                    <span className="hidden md:inline text-[10px] text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-200 dark:bg-amber-950/50 dark:border-amber-800 rounded-md px-1.5 py-0.5">
                        View only
                    </span>
                    <Link
                        to="/login"
                        className="flex items-center px-2 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                        <FaSignInAlt className="w-3.5 h-3.5 sm:mr-1.5" />
                        <span className="hidden sm:inline">Login</span>
                    </Link>
                </>
            )}

            {showAccountsModal && (
                <AdminAccountsModal onClose={() => setShowAccountsModal(false)} />
            )}
        </div>
    );
};

export default AuthStatusBar;
