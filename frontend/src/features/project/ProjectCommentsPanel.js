import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaComment, FaTimes, FaMapMarkerAlt } from 'react-icons/fa';
import api from '../../api/api';

const formatDateTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const ProjectCommentsPanel = ({
    projectId,
    isOpen,
    onClose,
    canComment,
    canEdit,
    isAuthenticated,
    commentWallSelectMode,
    onToggleWallSelectMode,
    selectedWallsForComment = [],
    onClearSelectedWalls,
    activeCommentId,
    onSelectComment,
    onClearActiveComment,
    onCommentsRead,
}) => {
    const [comments, setComments] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [body, setBody] = useState('');
    const [error, setError] = useState('');
    const [feedback, setFeedback] = useState('');

    const loadComments = useCallback(async () => {
        if (!projectId || !isAuthenticated) return;
        setIsLoading(true);
        setError('');
        try {
            const response = await api.get(`projects/${projectId}/comments/`);
            setComments(response.data.comments || []);
        } catch (err) {
            const message = err.response?.data?.error || 'Failed to load comments.';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [projectId, isAuthenticated]);

    useEffect(() => {
        if (!isOpen) return;
        loadComments();
    }, [isOpen, loadComments]);

    useEffect(() => {
        if (!isOpen || !canEdit || !projectId) return;

        const markRead = async () => {
            try {
                await api.post(`projects/${projectId}/comments/mark-read/`);
                onCommentsRead?.();
            } catch (err) {
                console.warn('Failed to mark comments as read:', err);
            }
        };

        markRead();
    }, [isOpen, canEdit, projectId, onCommentsRead]);

    useEffect(() => {
        if (!isOpen) return;

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose?.();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        const trimmed = body.trim();
        if (!trimmed) {
            setError('Please enter a comment.');
            return;
        }

        setIsSubmitting(true);
        setError('');
        setFeedback('');
        try {
            await api.get('/csrf-token/');
            const response = await api.post(`projects/${projectId}/comments/`, {
                body: trimmed,
                wall_ids: selectedWallsForComment,
            });
            setComments((prev) => [response.data, ...prev]);
            setBody('');
            onClearSelectedWalls?.();
            onToggleWallSelectMode?.(false);
            setFeedback('Comment added.');
            setTimeout(() => setFeedback(''), 3000);
        } catch (err) {
            const message = err.response?.data?.error || 'Failed to add comment.';
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[60] flex justify-end">
            <button
                type="button"
                className="flex-1 bg-black/40"
                onClick={onClose}
                aria-label="Close comments panel"
            />
            <aside className="project-comments-panel w-full max-w-md bg-white shadow-2xl border-l border-gray-200 flex flex-col h-full">
                <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <FaComment className="text-amber-600 shrink-0" />
                        <div className="min-w-0">
                            <h2 className="font-semibold text-gray-900 truncate">Customer Feedback</h2>
                            <p className="text-xs text-gray-500 truncate">
                                {canComment ? 'Share feedback from the customer' : 'Comments from sales'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="project-comments-close flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-200 rounded-lg shrink-0"
                        aria-label="Close comments panel"
                    >
                        <FaTimes />
                        Close
                    </button>
                </header>

                {activeCommentId && (
                    <div className="comment-highlight-bar flex items-center justify-between gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900">
                        <span>Walls highlighted on the plan</span>
                        <button
                            type="button"
                            onClick={() => onClearActiveComment?.()}
                            className="px-2 py-1 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 shrink-0"
                        >
                            Clear highlight
                        </button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {isLoading && (
                        <p className="text-sm text-gray-500">Loading comments...</p>
                    )}
                    {!isLoading && comments.length === 0 && (
                        <p className="text-sm text-gray-500">No comments yet.</p>
                    )}
                    {comments.map((comment) => {
                        const hasWalls = Array.isArray(comment.wall_ids) && comment.wall_ids.length > 0;
                        const isActive = activeCommentId === comment.id;
                        return (
                            <button
                                key={comment.id}
                                type="button"
                                onClick={() => onSelectComment?.(comment)}
                                className={`w-full text-left rounded-lg border p-3 transition-colors comment-card ${
                                    isActive
                                        ? 'comment-card-active border-amber-400 bg-amber-50 ring-1 ring-amber-200'
                                        : 'border-gray-200 bg-white hover:border-amber-200 hover:bg-amber-50/40'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-sm font-medium text-gray-900">
                                        {comment.author_username || 'Unknown'}
                                    </span>
                                    <span className="text-xs text-gray-500 shrink-0">
                                        {formatDateTime(comment.created_at)}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.body}</p>
                                {hasWalls && (
                                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-amber-700">
                                        <FaMapMarkerAlt className="w-3 h-3" />
                                        {comment.wall_ids.length} wall{comment.wall_ids.length !== 1 ? 's' : ''} referenced
                                        {isActive ? ' · highlighted on plan' : ' · click to highlight'}
                                    </p>
                                )}
                                {isActive && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onClearActiveComment?.();
                                        }}
                                        className="mt-2 text-xs text-amber-800 hover:text-amber-950 underline"
                                    >
                                        Clear highlight
                                    </button>
                                )}
                            </button>
                        );
                    })}
                </div>

                {canComment && (
                    <form onSubmit={handleSubmit} className="project-comments-form border-t border-gray-200 p-4 space-y-3 bg-gray-50">
                        {error && (
                            <p className="text-sm text-red-600">{error}</p>
                        )}
                        {feedback && (
                            <p className="text-sm text-green-700">{feedback}</p>
                        )}
                        <textarea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            rows={4}
                            placeholder="Enter customer feedback..."
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => onToggleWallSelectMode?.(!commentWallSelectMode)}
                                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                                    commentWallSelectMode
                                        ? 'bg-green-600 text-white border-green-600'
                                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                }`}
                            >
                                {commentWallSelectMode ? 'Selecting walls…' : 'Select walls on plan'}
                            </button>
                            {selectedWallsForComment.length > 0 && (
                                <span className="text-xs text-green-700">
                                    {selectedWallsForComment.length} wall{selectedWallsForComment.length !== 1 ? 's' : ''} selected
                                </span>
                            )}
                            {selectedWallsForComment.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => onClearSelectedWalls?.()}
                                    className="text-xs text-gray-500 hover:text-gray-800 underline"
                                >
                                    Clear walls
                                </button>
                            )}
                        </div>
                        {commentWallSelectMode && (
                            <p className="text-xs text-gray-600">
                                Click walls on the floor plan to attach them to this comment.
                            </p>
                        )}
                        <button
                            type="submit"
                            disabled={isSubmitting || !body.trim()}
                            className="w-full px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Adding…' : 'Add comment'}
                        </button>
                    </form>
                )}

                <div className="project-comments-footer border-t border-gray-200 px-4 py-3 bg-gray-50 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                        Close panel
                    </button>
                </div>
            </aside>
        </div>,
        document.body
    );
};

export default ProjectCommentsPanel;
