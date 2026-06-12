import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { syncPlanCanvasTheme } from '../canvas/planCanvasTheme';

const STORAGE_KEY = 'model-v6-theme';

const ThemeContext = createContext(null);

function getSystemTheme() {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference) {
    if (preference === 'system') return getSystemTheme();
    return preference === 'dark' ? 'dark' : 'light';
}

function applyResolvedTheme(resolved) {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
}

export function ThemeProvider({ children }) {
    const [preference, setPreference] = useState(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored === 'light' || stored === 'dark' || stored === 'system') {
                return stored;
            }
        } catch {
            // ignore
        }
        return 'system';
    });

    const resolvedTheme = resolveTheme(preference);
    const isDarkResolved = resolvedTheme === 'dark';

    // Keep DOM + canvas theme snapshot in sync before children paint/draw
    if (typeof document !== 'undefined') {
        applyResolvedTheme(resolvedTheme);
    }
    syncPlanCanvasTheme(isDarkResolved);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, preference);
        } catch {
            // ignore
        }
    }, [preference]);

    useEffect(() => {
        if (preference !== 'system') return undefined;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            const next = media.matches ? 'dark' : 'light';
            applyResolvedTheme(next);
            syncPlanCanvasTheme(next === 'dark');
        };
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, [preference]);

    const toggleTheme = useCallback(() => {
        setPreference((prev) => {
            const current = resolveTheme(prev);
            const next = current === 'dark' ? 'light' : 'dark';
            applyResolvedTheme(next);
            syncPlanCanvasTheme(next === 'dark');
            return next;
        });
    }, []);

    const value = useMemo(
        () => ({
            preference,
            resolvedTheme,
            setPreference,
            toggleTheme,
            isDark: resolvedTheme === 'dark',
        }),
        [preference, resolvedTheme, toggleTheme]
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return context;
}
