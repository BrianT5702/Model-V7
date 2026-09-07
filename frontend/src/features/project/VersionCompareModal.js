import React, { useEffect, useMemo, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import api from '../../api/api';
import ModalOverlay from '../../components/ModalOverlay';
import VersionPlanPreview from './VersionPlanPreview';

export const ORIGINAL_VERSION_KEY = 'original';
const VERSION_TIMEOUT_MS = 180000;

const formatVersionTitle = (meta) => {
    if (!meta) {
        return 'Version';
    }
    if (Number(meta.number) === 0) {
        return 'Original · version 0';
    }
    return `Version ${meta.number}${meta.label ? ` · ${meta.label}` : ''}`;
};

const fetchPreview = async (projectId, key) => {
    const url = key === ORIGINAL_VERSION_KEY
        ? `projects/${projectId}/versions/original/`
        : `projects/${projectId}/versions/${key}/`;
    const response = await api.get(url, { timeout: VERSION_TIMEOUT_MS });
    return response.data;
};

const VersionCompareModal = ({ projectId, versionKeys, onClose }) => {
    const [panes, setPanes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [storeyOrder, setStoreyOrder] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError('');
            try {
                const results = await Promise.all(
                    (versionKeys || []).map(async (key) => {
                        const payload = await fetchPreview(projectId, key);
                        return { key, payload };
                    })
                );
                if (!cancelled) {
                    setPanes(results);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err.response?.data?.error || 'Failed to load version drawings.');
                    setPanes([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [projectId, versionKeys]);

    const storeyOptions = useMemo(() => {
        const byOrder = new Map();
        panes.forEach(({ payload }) => {
            (payload?.storeys || []).forEach((storey) => {
                const order = Number(storey.order);
                if (!byOrder.has(order)) {
                    byOrder.set(order, storey.name || `Level ${order}`);
                }
            });
        });
        return Array.from(byOrder.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([order, name]) => ({ order, name }));
    }, [panes]);

    const count = panes.length || (versionKeys || []).length;
    const gridClass = count <= 2
        ? 'grid-cols-2'
        : count === 3
            ? 'grid-cols-3'
            : 'grid-cols-2';

    return (
        <ModalOverlay className="bg-black bg-opacity-60 flex items-center justify-center z-[13000] p-2 sm:p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-[96vw] h-[92vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            Compare versions
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            View only. The live project is unchanged.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {storeyOptions.length > 1 && (
                            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                                <span>Level</span>
                                <select
                                    value={storeyOrder == null ? '' : String(storeyOrder)}
                                    onChange={(event) => {
                                        const value = event.target.value;
                                        setStoreyOrder(value === '' ? null : Number(value));
                                    }}
                                    className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                                >
                                    <option value="">All levels</option>
                                    {storeyOptions.map((option) => (
                                        <option key={option.order} value={option.order}>
                                            {option.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800"
                            aria-label="Close compare"
                        >
                            <FaTimes />
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 p-3 overflow-auto modal-scroll-panel">
                    {loading ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
                            Loading drawings…
                        </p>
                    ) : error ? (
                        <p className="text-sm text-red-700 dark:text-red-300 py-10 text-center">{error}</p>
                    ) : (
                        <div className={`grid ${gridClass} gap-3 h-full min-h-0`}>
                            {panes.map(({ key, payload }) => {
                                const meta = payload?.version;
                                return (
                                    <div
                                        key={key}
                                        className="min-h-0 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-950"
                                    >
                                        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                                {formatVersionTitle(meta)}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {meta?.wall_count ?? (payload?.walls || []).length} wall
                                                {(meta?.wall_count ?? (payload?.walls || []).length) === 1 ? '' : 's'}
                                                {', '}
                                                {meta?.room_count ?? (payload?.rooms || []).length} room
                                                {(meta?.room_count ?? (payload?.rooms || []).length) === 1 ? '' : 's'}
                                            </p>
                                        </div>
                                        <div className="relative flex-1 min-h-0">
                                            <VersionPlanPreview payload={payload} storeyOrder={storeyOrder} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default VersionCompareModal;
