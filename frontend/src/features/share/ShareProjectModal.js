import React, { useEffect, useState } from 'react';
import { FaCheck, FaCopy, FaLink, FaTimes } from 'react-icons/fa';
import api from '../../api/api';
import ModalOverlay from '../../components/ModalOverlay';

const buildShareUrl = (path) => {
    if (typeof window === 'undefined') return path;
    return `${window.location.origin}${path}`;
};

const ShareProjectModal = ({ projectId, projectName, onClose }) => {
    const [mode, setMode] = useState('view');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [link, setLink] = useState(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setLink(null);
        setCopied(false);
        setError('');
    }, [mode]);

    const createLink = async () => {
        setBusy(true);
        setError('');
        setCopied(false);
        try {
            const response = await api.post(`projects/${projectId}/share-links/`, { mode });
            setLink(response.data);
        } catch (err) {
            const message = err.response?.data?.error || 'Failed to create share link.';
            setError(message);
        } finally {
            setBusy(false);
        }
    };

    const copyLink = async () => {
        if (!link?.path) return;
        const url = buildShareUrl(link.path);
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
        } catch {
            // Fallback for older browsers / denied clipboard
            window.prompt('Copy this share link:', url);
        }
    };

    return (
        <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-[12000] p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <FaLink className="text-blue-600 dark:text-blue-400" />
                            Share project
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
                        className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800"
                        aria-label="Close"
                    >
                        <FaTimes />
                    </button>
                </div>

                <div className="px-4 py-4 space-y-4">
                    <div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">Access type</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setMode('view')}
                                className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                                    mode === 'view'
                                        ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-400'
                                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                            >
                                View only
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('edit')}
                                className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                                    mode === 'edit'
                                        ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-400'
                                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                }`}
                            >
                                Editable
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                            {mode === 'view'
                                ? 'Recipients can open this project only. They cannot open the project list, login, or registration screens from the share session.'
                                : 'Recipients can view the project and must log in with an editor account to edit. They cannot open the project list or registration.'}
                        </p>
                    </div>

                    {error && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                            {error}
                        </div>
                    )}

                    {link?.path ? (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Share link</label>
                            <div className="flex gap-2">
                                <input
                                    readOnly
                                    value={buildShareUrl(link.path)}
                                    className="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100"
                                />
                                <button
                                    type="button"
                                    onClick={copyLink}
                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
                                >
                                    {copied ? <FaCheck /> : <FaCopy />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={createLink}
                            disabled={busy}
                            className="w-full px-3 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                            {busy ? 'Creating link…' : `Create ${mode === 'view' ? 'view-only' : 'editable'} link`}
                        </button>
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default ShareProjectModal;
