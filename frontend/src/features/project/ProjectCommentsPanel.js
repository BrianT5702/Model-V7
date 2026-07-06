import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaCheck, FaComment, FaTimes, FaMapMarkerAlt, FaUndo } from 'react-icons/fa';
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
    onCommentStatusChanged,
    highlightedWallCount = 0,
}) => {
    const [comments, setComments] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [body, setBody] = useState('');
    const [error, setError] = useState('');
    const [feedback, setFeedback] = useState('');
    const [isMinimized, setIsMinimized] = useState(false);
    const [updatingStatusId, setUpdatingStatusId] = useState(null);

    const isDrafterView = canEdit && !canComment;
    const isDrafterHighlightView = isDrafterView && activeCommentId && highlightedWallCount > 0;

    const handleFinishWallSelect = useCallback(() => {
        onToggleWallSelectMode?.(false);
    }, [onToggleWallSelectMode]);

    const handleStartWallSelect = useCallback(() => {
        onToggleWallSelectMode?.(true);
    }, [onToggleWallSelectMode]);

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
        if (!isOpen) {
            setIsMinimized(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (isDrafterHighlightView) {
            setIsMinimized(true);
        }
    }, [isDrafterHighlightView, activeCommentId, highlightedWallCount]);

    useEffect(() => {
        if (!activeCommentId || highlightedWallCount === 0) {
            setIsMinimized(false);
        }
    }, [activeCommentId, highlightedWallCount]);

    useEffect(() => {
        if (!isOpen) return;

        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (commentWallSelectMode) {
                    handleFinishWallSelect();
                } else if (isMinimized && isDrafterHighlightView) {
                    setIsMinimized(false);
                } else {
                    onClose?.();
                }
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose, commentWallSelectMode, handleFinishWallSelect, isMinimized, isDrafterHighlightView]);

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
            handleFinishWallSelect();
            setFeedback('Comment added.');
            setTimeout(() => setFeedback(''), 3000);
        } catch (err) {
            const message = err.response?.data?.error || 'Failed to add comment.';
            setError(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleStatusChange = async (commentId, nextStatus, event) => {
        event?.stopPropagation();
        if (!canEdit || updatingStatusId) return;

        setUpdatingStatusId(commentId);
        setError('');
        try {
            await api.get('/csrf-token/');
            const response = await api.patch(
                `projects/${projectId}/comments/${commentId}/status/`,
                { status: nextStatus }
            );
            setComments((prev) =>
                prev.map((item) => (item.id === commentId ? response.data : item))
            );
            onCommentStatusChanged?.(nextStatus);
        } catch (err) {
            const message = err.response?.data?.error || 'Failed to update comment status.';
            setError(message);
        } finally {
            setUpdatingStatusId(null);
        }
    };

    if (!isOpen) return null;

    if (commentWallSelectMode) {
        return createPortal(
            <div className="fixed bottom-6 right-6 z-[11000] pointer-events-none">
                <div className="project-comments-minimized pointer-events-auto bg-gray-900/90 text-white px-4 py-3 rounded-lg shadow-lg max-w-sm border border-gray-700">
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">Selecting walls for feedback…</div>
                        <button
                            type="button"
                            onClick={handleFinishWallSelect}
                            className="text-xs text-blue-200 hover:text-white transition-colors shrink-0"
                        >
                            Restore panel
                        </button>
                    </div>
                    <p className="text-xs text-gray-200 mt-2">
                        Click walls on the floor plan to attach them to your comment.
                    </p>
                    {selectedWallsForComment.length > 0 && (
                        <p className="text-xs text-green-300 mt-1">
                            {selectedWallsForComment.length} wall{selectedWallsForComment.length !== 1 ? 's' : ''} selected
                        </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {selectedWallsForComment.length > 0 && (
                            <button
                                type="button"
                                onClick={() => onClearSelectedWalls?.()}
                                className="px-3 py-1.5 rounded-md bg-gray-700 text-xs font-medium hover:bg-gray-600 transition-colors"
                            >
                                Clear walls
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleFinishWallSelect}
                            className="px-3 py-1.5 rounded-md bg-green-600 text-xs font-medium hover:bg-green-500 transition-colors"
                        >
                            Done selecting
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    }

    if (isMinimized && isDrafterHighlightView) {
        return createPortal(
            <div className="fixed bottom-6 right-6 z-[11000] pointer-events-none">
                <div className="project-comments-minimized pointer-events-auto bg-gray-900/90 text-white px-4 py-3 rounded-lg shadow-lg max-w-sm border border-gray-700">
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">Viewing referenced walls…</div>
                        <button
                            type="button"
                            onClick={() => setIsMinimized(false)}
                            className="text-xs text-blue-200 hover:text-white transition-colors shrink-0"
                        >
                            Restore panel
                        </button>
                    </div>
                    <p className="text-xs text-gray-200 mt-2">
                        {highlightedWallCount} wall{highlightedWallCount !== 1 ? 's' : ''} highlighted on the floor plan.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onClearActiveComment?.()}
                            className="px-3 py-1.5 rounded-md bg-gray-700 text-xs font-medium hover:bg-gray-600 transition-colors"
                        >
                            Clear highlight
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsMinimized(false)}
                            className="px-3 py-1.5 rounded-md bg-amber-600 text-xs font-medium hover:bg-amber-500 transition-colors"
                        >
                            Back to comments
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        );
    }

    return createPortal(
        <div className="fixed inset-0 z-[60] flex justify-end pointer-events-none">
            <button
                type="button"
                className="flex-1 pointer-events-auto bg-black/40"
                onClick={onClose}
                aria-label="Close comments panel"
            />
            <aside className="project-comments-panel pointer-events-auto w-full max-w-md bg-white shadow-2xl border-l border-gray-200 flex flex-col h-full">
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
                    {error && !canComment && (
                        <p className="text-sm text-red-600">{error}</p>
                    )}
                    {isLoading && (
                        <p className="text-sm text-gray-500">Loading comments...</p>
                    )}
                    {!isLoading && comments.length === 0 && (
                        <p className="text-sm text-gray-500">No comments yet.</p>
                    )}
                    {comments.map((comment) => {
                        const hasWalls = Array.isArray(comment.wall_ids) && comment.wall_ids.length > 0;
                        const isActive = activeCommentId === comment.id;
                        const isDone = comment.status === 'done';
                        const isUpdating = updatingStatusId === comment.id;
                        return (
                            <button
                                key={comment.id}
                                type="button"
                                onClick={() => onSelectComment?.(comment)}
                                className={`w-full text-left rounded-lg border p-3 transition-colors comment-card ${
                                    isActive
                                        ? 'comment-card-active border-amber-400 bg-amber-50 ring-1 ring-amber-200'
                                        : isDone
                                            ? 'border-gray-200 bg-gray-50 opacity-90'
                                            : 'border-gray-200 bg-white hover:border-amber-200 hover:bg-amber-50/40'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                    <div className="min-w-0">
                                        <span className="text-sm font-medium text-gray-900">
                                            {comment.author_username || 'Unknown'}
                                        </span>
                                        <span
                                            className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                                isDone
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-amber-100 text-amber-800'
                                            }`}
                                        >
                                            {isDone ? 'Done' : 'Open'}
                                        </span>
                                    </div>
                                    <span className="text-xs text-gray-500 shrink-0">
                                        {formatDateTime(comment.created_at)}
                                    </span>
                                </div>
                                <p className={`text-sm whitespace-pre-wrap ${isDone ? 'text-gray-600' : 'text-gray-700'}`}>
                                    {comment.body}
                                </p>
                                {isDone && comment.resolved_by_username && (
                                    <p className="mt-1 text-xs text-green-700">
                                        Marked done by {comment.resolved_by_username}
                                        {comment.resolved_at ? ` · ${formatDateTime(comment.resolved_at)}` : ''}
                                    </p>
                                )}
                                {hasWalls && (
                                    <p className="mt-2 inline-flex items-center gap-1 text-xs text-amber-700">
                                        <FaMapMarkerAlt className="w-3 h-3" />
                                        {comment.wall_ids.length} wall{comment.wall_ids.length !== 1 ? 's' : ''} referenced
                                        {isActive ? ' · highlighted on plan' : ' · click to highlight'}
                                    </p>
                                )}
                                {canEdit && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                        {isDone ? (
                                            <button
                                                type="button"
                                                disabled={isUpdating}
                                                onClick={(e) => handleStatusChange(comment.id, 'open', e)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                <FaUndo className="w-3 h-3" />
                                                {isUpdating ? 'Updating…' : 'Reopen'}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                disabled={isUpdating}
                                                onClick={(e) => handleStatusChange(comment.id, 'done', e)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                                            >
                                                <FaCheck className="w-3 h-3" />
                                                {isUpdating ? 'Updating…' : 'Mark as done'}
                                            </button>
                                        )}
                                    </div>
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
                                onClick={handleStartWallSelect}
                                className="px-3 py-1.5 text-sm rounded-lg border transition-colors bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                            >
                                Select walls on plan
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
