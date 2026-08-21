import React, { useEffect, useMemo, useState } from 'react';
import { FaCheck, FaSearch, FaTimes, FaUserFriends } from 'react-icons/fa';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../api/api';

const ProjectVisibilityModal = ({ project, onClose, onSaved }) => {
    const [salesmen, setSalesmen] = useState([]);
    const [selectedIds, setSelectedIds] = useState(
        () => new Set((project.visible_to_salesman_ids || []).map(Number)),
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setIsLoading(true);
            setError('');
            try {
                const response = await api.get('auth/salesmen/');
                if (!cancelled) {
                    setSalesmen(response.data.users || []);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err.response?.data?.error || 'Failed to load salesman accounts.');
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const { selectedSalesmen, unselectedSalesmen } = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const matches = query
            ? salesmen.filter((account) => account.username.toLowerCase().includes(query))
            : salesmen;
        const selected = [];
        const unselected = [];
        matches.forEach((account) => {
            if (selectedIds.has(Number(account.id))) {
                selected.push(account);
            } else {
                unselected.push(account);
            }
        });
        return { selectedSalesmen: selected, unselectedSalesmen: unselected };
    }, [salesmen, searchQuery, selectedIds]);

    const toggleId = (userId) => {
        const id = Number(userId);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
        if (error) setError('');
    };

    const handleSave = async (event) => {
        event.preventDefault();
        setIsSaving(true);
        setError('');
        try {
            const response = await api.patch(`projects/${project.id}/salesman-viewers/`, {
                user_ids: Array.from(selectedIds),
            });
            onSaved?.(response.data);
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save visibility.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-[12000] p-4">
            <form
                onSubmit={handleSave}
                className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md overflow-hidden"
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <FaUserFriends className="text-blue-600 dark:text-blue-400" />
                            Salesman visibility
                        </h2>
                        {project?.name && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5" title={project.name}>
                                {project.name}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800"
                        aria-label="Close"
                    >
                        <FaTimes />
                    </button>
                </div>

                <div className="px-4 py-4 space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        Choose which salesman accounts can see this project. Admins and drafters still see every project.
                    </p>

                    <div className="relative">
                        <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search salesman accounts..."
                            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        />
                    </div>

                    <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 modal-scroll-panel">
                        {isLoading ? (
                            <p className="px-3 py-6 text-sm text-gray-500 text-center">Loading accounts...</p>
                        ) : selectedSalesmen.length === 0 && unselectedSalesmen.length === 0 ? (
                            <p className="px-3 py-6 text-sm text-gray-500 text-center">
                                {salesmen.length === 0
                                    ? 'No salesman accounts yet.'
                                    : 'No matching salesman accounts.'}
                            </p>
                        ) : (
                            <div>
                                {selectedSalesmen.length > 0 && (
                                    <div>
                                        <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-100 dark:border-amber-900">
                                            Can view this project
                                        </p>
                                        <ul>
                                            {selectedSalesmen.map((account) => (
                                                <li key={account.id} className="border-b border-amber-100 dark:border-amber-900/60">
                                                    <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer bg-amber-50/80 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50">
                                                        <input
                                                            type="checkbox"
                                                            checked
                                                            onChange={() => toggleId(account.id)}
                                                            className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                                                        />
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1">
                                                            {account.username}
                                                        </span>
                                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 shrink-0">
                                                            <FaCheck className="w-3 h-3" />
                                                            Selected
                                                        </span>
                                                    </label>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {unselectedSalesmen.length > 0 && (
                                    <div>
                                        <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                                            Not assigned
                                        </p>
                                        <ul>
                                            {unselectedSalesmen.map((account) => (
                                                <li key={account.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                                                    <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/70">
                                                        <input
                                                            type="checkbox"
                                                            checked={false}
                                                            onChange={() => toggleId(account.id)}
                                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                                                            {account.username}
                                                        </span>
                                                    </label>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {selectedIds.size === 0
                            ? 'No salesman can see this project yet.'
                            : `${selectedIds.size} salesman account${selectedIds.size === 1 ? '' : 's'} selected.`}
                    </p>

                    {error && (
                        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isSaving || isLoading}
                        className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </form>
        </ModalOverlay>
    );
};

export default ProjectVisibilityModal;
