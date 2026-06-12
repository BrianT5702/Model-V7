import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../../api/api';
import { canCommentFromUser, canEditFromUser, isAdminFromUser } from './authUtils';

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

    const registerUser = useCallback(async (username, password, role = 'drafter') => {
        try {
            await api.get('/csrf-token/');
            const response = await api.post('auth/register/', { username, password, role });
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

    const listUsers = useCallback(async () => {
        try {
            const response = await api.get('auth/users/');
            return { success: true, users: response.data.users || [] };
        } catch (error) {
            const message = error.response?.data?.error || 'Failed to load accounts.';
            return { success: false, error: message, users: [] };
        }
    }, []);

    const updateUser = useCallback(async (userId, payload) => {
        try {
            await api.get('/csrf-token/');
            const response = await api.patch(`auth/users/${userId}/`, payload);
            return {
                success: true,
                message: response.data.message || 'Account updated.',
                user: response.data.user,
            };
        } catch (error) {
            const message = error.response?.data?.error || 'Failed to update account.';
            return { success: false, error: message };
        }
    }, []);

    const deleteUser = useCallback(async (userId) => {
        try {
            await api.get('/csrf-token/');
            const response = await api.delete(`auth/users/${userId}/`);
            return {
                success: true,
                message: response.data.message || 'Account removed.',
            };
        } catch (error) {
            const message = error.response?.data?.error || 'Failed to remove account.';
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

    const isAdmin = isAdminFromUser(user);
    const canEdit = canEditFromUser(user);
    const canComment = canCommentFromUser(user);
    const role = user?.role ?? null;

    const value = useMemo(() => ({
        user,
        role,
        isAuthenticated,
        isAdmin,
        canEdit,
        canComment,
        isLoading,
        authError,
        setAuthError,
        login,
        registerUser,
        listUsers,
        updateUser,
        deleteUser,
        logout,
        refreshAuth,
    }), [user, role, isAuthenticated, isAdmin, canEdit, canComment, isLoading, authError, login, registerUser, listUsers, updateUser, deleteUser, logout, refreshAuth]);

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
