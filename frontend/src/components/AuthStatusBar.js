import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FaSignInAlt, FaSignOutAlt, FaUser, FaUserPlus } from 'react-icons/fa';
import { useAuth } from '../features/auth/AuthContext';
import AdminCreateUserPanel from './AdminCreateUserPanel';

const AuthStatusBar = () => {
    const { isAuthenticated, isAdmin, user, logout, isLoading } = useAuth();
    const [showCreateUser, setShowCreateUser] = useState(false);

    if (isLoading) {
        return null;
    }

    return (
        <div className="flex items-center gap-2 sm:gap-3">
            {isAuthenticated ? (
                <>
                    <div className="hidden sm:flex items-center text-sm text-gray-600">
                        <FaUser className="w-4 h-4 mr-2 text-blue-500" />
                        <span>{user?.username}</span>
                        {isAdmin && (
                            <span className="ml-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                                Admin
                            </span>
                        )}
                    </div>
                    {isAdmin && (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setShowCreateUser((open) => !open)}
                                className="flex items-center px-3 py-2 rounded-lg text-sm font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 transition-colors"
                            >
                                <FaUserPlus className="w-4 h-4 sm:mr-2" />
                                <span className="hidden sm:inline">Create user</span>
                            </button>
                            {showCreateUser && (
                                <AdminCreateUserPanel onClose={() => setShowCreateUser(false)} />
                            )}
                        </div>
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
        </div>
    );
};

export default AuthStatusBar;
