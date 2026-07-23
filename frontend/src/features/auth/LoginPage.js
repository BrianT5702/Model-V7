import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaCube, FaSignInAlt } from 'react-icons/fa';
import { useAuth } from './AuthContext';
import { useShare } from '../share/ShareContext';
import ThemeToggle from '../../components/ThemeToggle';

const LoginPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { login, authError, setAuthError, isAuthenticated } = useAuth();
    const { isEditShare, share } = useShare();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const shareReturnPath = share?.token ? `/share/${share.token}` : null;
    const redirectTo = location.state?.from?.pathname
        || (isEditShare && shareReturnPath)
        || '/';

    useEffect(() => {
        if (isAuthenticated) {
            navigate(redirectTo, { replace: true });
        }
    }, [isAuthenticated, navigate, redirectTo]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setAuthError('');
        setIsSubmitting(true);

        const result = await login(username.trim(), password);

        setIsSubmitting(false);

        if (result.success) {
            navigate(redirectTo, { replace: true });
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-slate-900 flex items-center justify-center px-4 py-10 transition-colors relative">
            <div className="absolute top-4 right-4">
                <ThemeToggle />
            </div>
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 mb-4">
                        <FaCube className="w-8 h-8" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">System V7.0</h1>
                    <p className="text-gray-600 dark:text-gray-400 mt-2">
                        {isEditShare
                            ? 'Sign in with an editor account to edit the shared project.'
                            : 'Sign in to create projects and make edits. Guests can still browse and view.'}
                    </p>
                </div>

                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-6 sm:p-8">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-6">Sign in</h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="username" className="form-label">
                                Username
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="form-control mt-1"
                                autoComplete="username"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="form-label">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="form-control mt-1"
                                autoComplete="current-password"
                                required
                            />
                        </div>

                        {authError && (
                            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                                {authError}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full flex items-center justify-center px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-60"
                        >
                            <FaSignInAlt className="mr-2" />
                            {isSubmitting ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>

                    <p className="mt-6 text-sm text-gray-600 dark:text-gray-400 text-center">
                        Need an account? Contact your administrator to have one created.
                    </p>

                    {isEditShare && shareReturnPath ? (
                        <div className="mt-4 text-center">
                            <Link
                                to={shareReturnPath}
                                className="text-sm text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
                            >
                                Back to shared project (view only)
                            </Link>
                        </div>
                    ) : (
                        <div className="mt-4 text-center">
                            <Link to="/" className="text-sm text-gray-600 hover:text-blue-600 transition-colors">
                                Continue as guest (view only)
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
