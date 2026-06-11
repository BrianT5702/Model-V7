import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaSignInAlt, FaSignOutAlt, FaUser, FaUsersCog } from 'react-icons/fa';
import { useAuth } from '../features/auth/AuthContext';
import { ROLE_BADGE_CLASSES, ROLE_LABELS } from '../features/auth/authUtils';
import AdminAccountsModal from './AdminAccountsModal';

const AuthStatusBar = () => {
    const { isAuthenticated, isAdmin, role, user, logout, isLoading } = useAuth();
    const [showAccountsModal, setShowAccountsModal] = useState(false);

    if (isLoading) {
        return null;
    }

    const roleBadgeClass = ROLE_BADGE_CLASSES[role] || 'text-gray-700 bg-gray-50 border-gray-200';
    const roleLabel = ROLE_LABELS[role] || role;

    return (
        <div className="flex items-center gap-2 sm:gap-3">
            {isAuthenticated ? (
                <>
                    <div className="hidden sm:flex items-center text-sm text-gray-600">
                        <FaUser className="w-4 h-4 mr-2 text-blue-500" />
                        <span>{user?.username}</span>
                        {role && (
                            <span className={`ml-2 text-xs border rounded px-1.5 py-0.5 ${roleBadgeClass}`}>
                                {roleLabel}
                            </span>
                        )}
                    </div>
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={() => setShowAccountsModal(true)}
                            className="flex items-center px-3 py-2 rounded-lg text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 transition-colors"
                        >
                            <FaUsersCog className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">Accounts</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={logout}
                        className="flex items-center px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                    >
                        <FaSignOutAlt className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">Logout</span>
                    </button>
                </>
            ) : (
                <>
                    <span className="hidden md:inline text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        View only
                    </span>
                    <Link
                        to="/login"
                        className="flex items-center px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                        <FaSignInAlt className="w-4 h-4 sm:mr-2" />
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
