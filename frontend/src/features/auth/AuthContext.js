import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../../api/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [authError, setAuthError] = useState('');

    const refreshAuth = useCallback(async () => {
        try {
            const response = await api.get('auth/me/');
            const { authenticated, user: nextUser } = response.data;
            setIsAuthenticated(Boolean(authenticated));
            setUser(nextUser || null);
            return Boolean(authenticated);
        } catch (error) {
            setIsAuthenticated(false);
            setUser(null);
            return false;
        }
    }, []);

    useEffect(() => {
        let isMounted = true;

        const bootstrap = async () => {
            try {
                await api.get('/csrf-token/');
            } catch (error) {
                console.warn('Failed to prefetch CSRF token:', error);
            }

            if (isMounted) {
                await refreshAuth();
                setIsLoading(false);
            }
        };

        bootstrap();

        return () => {
            isMounted = false;
        };
    }, [refreshAuth]);

    const login = useCallback(async (username, password) => {
        setAuthError('');
        try {
            await api.get('/csrf-token/');
            const response = await api.post('auth/login/', { username, password });
            setIsAuthenticated(true);
            setUser(response.data.user);
            return { success: true };
        } catch (error) {
            const message = error.response?.data?.error || 'Login failed. Please try again.';
            setAuthError(message);
            return { success: false, error: message };
        }
    }, []);

    const registerUser = useCallback(async (username, password) => {
        try {
            await api.get('/csrf-token/');
            const response = await api.post('auth/register/', { username, password });
            return {
                success: true,
                message: response.data.message || 'Account created successfully.',
                user: response.data.user,
            };
        } catch (error) {
            const detail = error.response?.data?.detail;
            const message = error.response?.data?.error
                || (Array.isArray(detail) ? detail.join(' ') : detail)
                || 'Failed to create account. Please try again.';
            return { success: false, error: message };
        }
    }, []);

    const logout = useCallback(async () => {
        setAuthError('');
        try {
            await api.post('auth/logout/');
        } catch (error) {
            console.warn('Logout request failed:', error);
        } finally {
            setIsAuthenticated(false);
            setUser(null);
        }
    }, []);

    const isAdmin = Boolean(user?.is_staff);

    const value = useMemo(() => ({
        user,
        isAuthenticated,
        isAdmin,
        isLoading,
        authError,
        setAuthError,
        login,
        registerUser,
        logout,
        refreshAuth,
        canEdit: isAuthenticated,
    }), [user, isAuthenticated, isAdmin, isLoading, authError, login, registerUser, logout, refreshAuth]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export default AuthContext;
