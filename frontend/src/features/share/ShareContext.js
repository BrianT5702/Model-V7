import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setActiveShareToken, clearActiveShareToken } from '../../api/api';

const SHARE_STORAGE_KEY = 'up_active_share';

const ShareContext = createContext(null);

const readStoredShare = () => {
    try {
        const raw = sessionStorage.getItem(SHARE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.token || !parsed?.projectId || !parsed?.mode) return null;
        return {
            token: String(parsed.token),
            projectId: String(parsed.projectId),
            mode: parsed.mode === 'edit' ? 'edit' : 'view',
            projectName: parsed.projectName || '',
        };
    } catch {
        return null;
    }
};

const writeStoredShare = (share) => {
    if (!share) {
        sessionStorage.removeItem(SHARE_STORAGE_KEY);
        return;
    }
    sessionStorage.setItem(SHARE_STORAGE_KEY, JSON.stringify(share));
};

export const ShareProvider = ({ children }) => {
    const [share, setShare] = useState(() => readStoredShare());
    const [isResolving, setIsResolving] = useState(false);
    const [resolveError, setResolveError] = useState('');

    useEffect(() => {
        if (share?.token) {
            setActiveShareToken(share.token);
        } else {
            clearActiveShareToken();
        }
    }, [share?.token]);

    const clearShare = useCallback(() => {
        setShare(null);
        writeStoredShare(null);
        clearActiveShareToken();
        setResolveError('');
    }, []);

    const activateShare = useCallback((payload) => {
        const next = {
            token: String(payload.token),
            projectId: String(payload.project_id ?? payload.projectId),
            mode: payload.mode === 'edit' ? 'edit' : 'view',
            projectName: payload.project_name || payload.projectName || '',
        };
        setShare(next);
        writeStoredShare(next);
        setActiveShareToken(next.token);
        setResolveError('');
        return next;
    }, []);

    const resolveShareToken = useCallback(async (token) => {
        const trimmed = String(token || '').trim();
        if (!trimmed) {
            setResolveError('Missing share token.');
            return null;
        }

        setIsResolving(true);
        setResolveError('');
        try {
            const response = await api.get(`share/${encodeURIComponent(trimmed)}/`);
            return activateShare(response.data);
        } catch (error) {
            clearShare();
            const message = error.response?.data?.error || 'This share link is invalid or has been revoked.';
            setResolveError(message);
            return null;
        } finally {
            setIsResolving(false);
        }
    }, [activateShare, clearShare]);

    const isShareSession = Boolean(share?.token);
    const isViewOnlyShare = isShareSession && share.mode === 'view';
    const isEditShare = isShareSession && share.mode === 'edit';

    const value = useMemo(() => ({
        share,
        isShareSession,
        isViewOnlyShare,
        isEditShare,
        isResolving,
        resolveError,
        resolveShareToken,
        activateShare,
        clearShare,
    }), [
        share,
        isShareSession,
        isViewOnlyShare,
        isEditShare,
        isResolving,
        resolveError,
        resolveShareToken,
        activateShare,
        clearShare,
    ]);

    return (
        <ShareContext.Provider value={value}>
            {children}
        </ShareContext.Provider>
    );
};

export const useShare = () => {
    const context = useContext(ShareContext);
    if (!context) {
        throw new Error('useShare must be used within a ShareProvider');
    }
    return context;
};

export default ShareContext;
