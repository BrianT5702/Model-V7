import React, { useCallback, useEffect, useState } from 'react';
import { FaColumns, FaEye, FaHistory, FaTimes, FaTrash, FaUndo } from 'react-icons/fa';
import api from '../../api/api';
import ModalOverlay from '../../components/ModalOverlay';
import { ORIGINAL_VERSION_KEY } from './VersionCompareModal';

const VERSION_TIMEOUT_MS = 180000;

const formatVersionTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const ProjectVersionModal = ({
    projectId,
    projectName,
    canManage = false,
    viewingVersionId = null,
    editingFromVersionId = null,
    onClose,
    onRestored,
    onViewed,
    onSaved,
    onDeleted,
    onRestoreOriginal,
    onBeforeSave,
    onCompare,
}) => {
    const [label, setLabel] = useState('');
    const [versions, setVersions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [confirmRestoreId, setConfirmRestoreId] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [compareKeys, setCompareKeys] = useState([]);

    const loadVersions = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.get(`projects/${projectId}/versions/`, {
                timeout: VERSION_TIMEOUT_MS,
            });
            setVersions(Array.isArray(response.data) ? response.data : []);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load version history.');
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        loadVersions();
    }, [loadVersions]);

    const clearConfirms = () => {
        setConfirmRestoreId(null);
        setConfirmDeleteId(null);
    };

    const saveVersion = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        setNotice('');
        clearConfirms();
        try {
            if (onBeforeSave) {
                await onBeforeSave();
            }
            const response = await api.post(
                `projects/${projectId}/versions/`,
                { label: label.trim() },
                { timeout: VERSION_TIMEOUT_MS },
            );
            setLabel('');
            const preview = response.data || {};
            const version = preview.version || preview;
            setVersions((current) => [version, ...current.filter((item) => item.id !== version.id)]);
            const savedLabel = version.label ? ` “${version.label}”` : '';
            setNotice(`Version ${version.number}${savedLabel} saved.`);
            if (onSaved) {
                await onSaved(preview.version ? preview : { version, ...preview });
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save version.');
        } finally {
            setSaving(false);
        }
    };

    const restoreVersion = async (version) => {
        setBusyId(version.id);
        setError('');
        setNotice('');
        try {
            await api.post(
                `projects/${projectId}/versions/${version.id}/restore/`,
                {},
                { timeout: VERSION_TIMEOUT_MS },
            );
            if (onRestored) {
                await onRestored(version);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to restore this version.');
            setBusyId(null);
            clearConfirms();
        }
    };

    const deleteVersion = async (version) => {
        setBusyId(version.id);
        setError('');
        setNotice('');
        try {
            await api.delete(
                `projects/${projectId}/versions/${version.id}/`,
                { timeout: VERSION_TIMEOUT_MS },
            );
            setVersions((current) => current.filter((item) => item.id !== version.id));
            setNotice(`Deleted version ${version.number}${version.label ? ` “${version.label}”` : ''}.`);
            clearConfirms();
            if (onDeleted) {
                await onDeleted(version);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to delete this version.');
        } finally {
            setBusyId(null);
        }
    };

    const viewVersion = async (version) => {
        setBusyId(version.id);
        setError('');
        setNotice('');
        clearConfirms();
        try {
            const response = await api.get(
                `projects/${projectId}/versions/${version.id}/`,
                { timeout: VERSION_TIMEOUT_MS },
            );
            if (onViewed) {
                onViewed(response.data);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to open this version.');
            setBusyId(null);
        }
    };

    const viewOriginal = async () => {
        setBusyId(ORIGINAL_VERSION_KEY);
        setError('');
        setNotice('');
        clearConfirms();
        try {
            const response = await api.get(
                `projects/${projectId}/versions/original/`,
                { timeout: VERSION_TIMEOUT_MS },
            );
            if (onViewed) {
                onViewed({
                    ...response.data,
                    version: {
                        ...(response.data.version || {}),
                        id: ORIGINAL_VERSION_KEY,
                        number: 0,
                        label: response.data.version?.label || 'Original',
                    },
                });
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to open the original drawing.');
            setBusyId(null);
        }
    };

    const restoreOriginal = async () => {
        setBusyId(ORIGINAL_VERSION_KEY);
        setError('');
        setNotice('');
        try {
            if (onRestoreOriginal) {
                await onRestoreOriginal();
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to restore the original drawing.');
            setBusyId(null);
            clearConfirms();
        }
    };

    const toggleCompareKey = (key) => {
        setCompareKeys((current) => {
            if (current.includes(key)) {
                return current.filter((item) => item !== key);
            }
            if (current.length >= 4) {
                return current;
            }
            return [...current, key];
        });
    };

    const startCompare = () => {
        if (!onCompare || compareKeys.length < 2) {
            return;
        }
        onCompare(compareKeys);
    };

    const isBusy = saving || busyId != null;
    const isViewingOriginal = viewingVersionId === ORIGINAL_VERSION_KEY;
    const showingOriginalLive = viewingVersionId == null && editingFromVersionId == null;
    const showingOriginal = showingOriginalLive || isViewingOriginal;
    const confirmingRestoreOriginal = confirmRestoreId === ORIGINAL_VERSION_KEY;
    const originalRowBusy = busyId === ORIGINAL_VERSION_KEY;

    return (
        <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-[12000] p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <FaHistory className="text-blue-600 dark:text-blue-400" />
                            Versions
                        </h2>
                        {projectName && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5" title={projectName}>
                                {projectName}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isBusy}
                        className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                        aria-label="Close"
                    >
                        <FaTimes />
                    </button>
                </div>

                <div className="px-4 py-4 space-y-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        {canManage
                            ? 'Opening this project always shows the original (version 0). Save version stores your current drawing as a snapshot, then opens that snapshot on the wall plan. Use View to look at another snapshot, including Original — it also opens the wall plan first; then you can switch to Ceiling or Floor. Compare shows two to four snapshots side by side without changing the live project. Restore loads a snapshot onto the canvas so you can edit from it; version 0 stays frozen until you Restore Original. Save version afterwards to keep those edits as the next snapshot. Delete removes a snapshot only.'
                            : 'Opening this project always shows the original (version 0). Use View to look at another snapshot, including Original. View always opens the wall plan first; then you can switch to Ceiling or Floor. Compare shows two to four snapshots side by side.'}
                    </p>

                    {canManage && (
                    <form onSubmit={saveVersion} className="space-y-2">
                        <label className="text-sm font-medium text-gray-800 dark:text-gray-200" htmlFor="project-version-label">
                            Save version
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="project-version-label"
                                type="text"
                                value={label}
                                onChange={(event) => setLabel(event.target.value)}
                                maxLength={255}
                                disabled={isBusy}
                                placeholder="Optional label, e.g. Walls complete"
                                className="flex-1 min-w-0 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
                            />
                            <button
                                type="submit"
                                disabled={isBusy}
                                className="shrink-0 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                            >
                                {saving ? 'Saving…' : 'Save version'}
                            </button>
                        </div>
                    </form>
                    )}

                    {error && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800">
                            {error}
                        </div>
                    )}
                    {notice && (
                        <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2 dark:bg-green-950/40 dark:text-green-100 dark:border-green-800">
                            {notice}
                        </div>
                    )}

                    <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">History</p>
                            <button
                                type="button"
                                disabled={isBusy || compareKeys.length < 2}
                                onClick={startCompare}
                                className="flex items-center px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                            >
                                <FaColumns className="mr-1.5" />
                                Compare{compareKeys.length ? ` (${compareKeys.length})` : ''}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            Tick 2 to 4 snapshots, including Original, then click Compare.
                        </p>
                        <div className="max-h-80 overflow-y-auto modal-scroll-panel space-y-2 pr-0.5">
                            {loading ? (
                                <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Loading versions…</p>
                            ) : (
                                <>
                                    <div
                                        className={`rounded-lg border px-3 py-2.5 ${
                                            showingOriginal
                                                ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                                                : 'border-gray-200 dark:border-gray-700'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <label className="flex items-start gap-2 min-w-0 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1"
                                                    checked={compareKeys.includes(ORIGINAL_VERSION_KEY)}
                                                    onChange={() => toggleCompareKey(ORIGINAL_VERSION_KEY)}
                                                    disabled={isBusy || (!compareKeys.includes(ORIGINAL_VERSION_KEY) && compareKeys.length >= 4)}
                                                />
                                                <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                    Original
                                                    <span className="font-normal text-gray-600 dark:text-gray-300">
                                                        {' '}· version 0
                                                    </span>
                                                </p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                    {showingOriginalLive
                                                        ? 'This is what you see when you open the project.'
                                                        : isViewingOriginal
                                                            ? 'Snapshot of the original drawing.'
                                                            : 'The original drawing. Restore it to edit from version 0.'}
                                                </p>
                                                </div>
                                            </label>
                                        </div>
                                        {confirmingRestoreOriginal ? (
                                            <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2.5 py-2">
                                                <p className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed">
                                                    Restore original (version 0)? This loads the original drawing onto the canvas for editing. Unsaved drawing on the canvas will be replaced.
                                                </p>
                                                <div className="mt-2 flex gap-2">
                                                    <button
                                                        type="button"
                                                        disabled={originalRowBusy}
                                                        onClick={restoreOriginal}
                                                        className="px-2.5 py-1 rounded-md text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
                                                    >
                                                        {originalRowBusy ? 'Restoring…' : 'Restore'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={originalRowBusy}
                                                        onClick={() => setConfirmRestoreId(null)}
                                                        className="px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="mt-2">
                                                {showingOriginal && (
                                                    <p className="mb-2 text-xs font-medium text-blue-800 dark:text-blue-200">
                                                        Showing
                                                    </p>
                                                )}
                                                {!showingOriginalLive && (
                                                    <div className="flex flex-wrap gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={isBusy || isViewingOriginal}
                                                            onClick={viewOriginal}
                                                            className="flex items-center px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                                                        >
                                                            <FaEye className="mr-1.5" />
                                                            {originalRowBusy && !confirmingRestoreOriginal ? 'Opening…' : isViewingOriginal ? 'Viewing' : 'View'}
                                                        </button>
                                                        {canManage && (
                                                            <button
                                                                type="button"
                                                                disabled={isBusy}
                                                                onClick={() => {
                                                                    setConfirmDeleteId(null);
                                                                    setConfirmRestoreId(ORIGINAL_VERSION_KEY);
                                                                }}
                                                                className="flex items-center px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                                                            >
                                                                <FaUndo className="mr-1.5" />
                                                                Restore
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {versions.length === 0 ? (
                                        <p className="text-sm text-gray-500 dark:text-gray-400 py-3 text-center">
                                            No other versions yet.{canManage ? ' Save one after a milestone, such as walls finished or before a big change.' : ''}
                                        </p>
                                    ) : (
                                        versions.map((version) => {
                                            const confirmingRestore = confirmRestoreId === version.id;
                                            const confirmingDelete = confirmDeleteId === version.id;
                                            const rowBusy = busyId === version.id;
                                            const isViewing = viewingVersionId === version.id;
                                            const isEditingFrom = viewingVersionId == null && editingFromVersionId === version.id;
                                            const isShowing = isViewing || isEditingFrom;
                                            const compareChecked = compareKeys.includes(version.id);
                                            return (
                                                <div
                                                    key={version.id}
                                                    className={`rounded-lg border px-3 py-2.5 ${
                                                        isShowing
                                                            ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                                                            : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <label className="flex items-start gap-2 min-w-0 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                className="mt-1"
                                                                checked={compareChecked}
                                                                onChange={() => toggleCompareKey(version.id)}
                                                                disabled={isBusy || (!compareChecked && compareKeys.length >= 4)}
                                                            />
                                                            <div className="min-w-0">
                                                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                Version {version.number}
                                                                {version.label ? (
                                                                    <span className="font-normal text-gray-600 dark:text-gray-300">
                                                                        {' '}· {version.label}
                                                                    </span>
                                                                ) : null}
                                                            </p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                                                {formatVersionTime(version.created_at)}
                                                                {version.created_by_username ? ` · ${version.created_by_username}` : ''}
                                                            </p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                                {version.wall_count} wall{version.wall_count === 1 ? '' : 's'}, {version.room_count} room{version.room_count === 1 ? '' : 's'}
                                                            </p>
                                                            </div>
                                                        </label>
                                                    </div>
                                                    {confirmingRestore ? (
                                                        <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2.5 py-2">
                                                            <p className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed">
                                                                Restore version {version.number}? This loads that snapshot onto the canvas for editing. Version 0 stays. Unsaved drawing on the canvas will be replaced. Save version afterwards to keep these edits.
                                                            </p>
                                                            <div className="mt-2 flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={rowBusy}
                                                                    onClick={() => restoreVersion(version)}
                                                                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
                                                                >
                                                                    {rowBusy ? 'Restoring…' : 'Restore'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={rowBusy}
                                                                    onClick={() => setConfirmRestoreId(null)}
                                                                    className="px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : confirmingDelete ? (
                                                        <div className="mt-2 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-2.5 py-2">
                                                            <p className="text-xs text-red-900 dark:text-red-100 leading-relaxed">
                                                                Delete version {version.number}? The original project stays. This snapshot cannot be recovered.
                                                            </p>
                                                            <div className="mt-2 flex gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={rowBusy}
                                                                    onClick={() => deleteVersion(version)}
                                                                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                                                                >
                                                                    {rowBusy ? 'Deleting…' : 'Delete'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={rowBusy}
                                                                    onClick={() => setConfirmDeleteId(null)}
                                                                    className="px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="mt-2">
                                                            {isShowing && (
                                                                <p className="mb-2 text-xs font-medium text-blue-800 dark:text-blue-200">
                                                                    {isEditingFrom && !isViewing ? 'Showing · loaded for editing' : 'Showing'}
                                                                </p>
                                                            )}
                                                            <div className="flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                disabled={isBusy || isViewing}
                                                                onClick={() => viewVersion(version)}
                                                                className="flex items-center px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                                                            >
                                                                <FaEye className="mr-1.5" />
                                                                {rowBusy ? 'Opening…' : isViewing ? 'Viewing' : 'View'}
                                                            </button>
                                                            {canManage && (
                                                            <button
                                                                type="button"
                                                                disabled={isBusy}
                                                                onClick={() => {
                                                                    setConfirmDeleteId(null);
                                                                    setConfirmRestoreId(version.id);
                                                                }}
                                                                className="flex items-center px-2.5 py-1 rounded-md text-xs font-medium btn-secondary disabled:opacity-60"
                                                            >
                                                                <FaUndo className="mr-1.5" />
                                                                Restore
                                                            </button>
                                                            )}
                                                            {canManage && (
                                                            <button
                                                                type="button"
                                                                disabled={isBusy}
                                                                onClick={() => {
                                                                    setConfirmRestoreId(null);
                                                                    setConfirmDeleteId(version.id);
                                                                }}
                                                                className="flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40 disabled:opacity-60"
                                                            >
                                                                <FaTrash className="mr-1.5" />
                                                                Delete
                                                            </button>
                                                            )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ModalOverlay>
    );
};

export default ProjectVersionModal;
