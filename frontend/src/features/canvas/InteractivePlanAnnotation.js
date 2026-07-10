import React, { useEffect, useRef, useState } from 'react';
import { FaArrowRight, FaPencilAlt, FaTrash } from 'react-icons/fa';
import { useTheme } from '../theme/ThemeContext';
import {
    getPlanNoteBoxSizeMm,
    getPlanNoteBoxSizePx,
    PLAN_NOTE_MIN_SCREEN_SIZE,
} from './planAnnotationUtils';

const DRAG_THRESHOLD_PX = 5;

const InteractivePlanAnnotation = ({
    annotation,
    scaleFactor,
    offsetX,
    offsetY,
    isSelected = false,
    onSelect,
    onUpdate,
    onDelete,
    onStartArrowPlacement,
    isPlacingArrow = false,
    canEdit = false,
    canDrag = false,
    autoEdit = false,
    onAutoEditConsumed,
    onInteractionStart,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draftText, setDraftText] = useState(annotation.text || '');
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const lastDragPositionRef = useRef(null);
    const dragStartRef = useRef(null);
    const didDragRef = useRef(false);
    const wasSelectedOnMouseDownRef = useRef(false);
    const resizeStartRef = useRef(null);
    const textareaRef = useRef(null);
    const { isDark } = useTheme();

    const canvasX = annotation.position_x * scaleFactor + offsetX;
    const canvasY = annotation.position_y * scaleFactor + offsetY;
    const { width: boxWidthPx, height: boxHeightPx } = getPlanNoteBoxSizePx(annotation, scaleFactor);

    useEffect(() => {
        setDraftText(annotation.text || '');
    }, [annotation.text, annotation.id]);

    useEffect(() => {
        if (autoEdit && canEdit) {
            setIsEditing(true);
            onAutoEditConsumed?.();
        }
    }, [autoEdit, canEdit, annotation.id, onAutoEditConsumed]);

    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.select();
        }
    }, [isEditing]);

    useEffect(() => {
        if (!isSelected || !canEdit || isEditing) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') {
                return;
            }
            if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault();
                setIsEditing(true);
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                onDelete?.(annotation.id);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSelected, canEdit, isEditing, annotation.id, onDelete]);

    const commitText = () => {
        const trimmed = draftText.trim();
        setIsEditing(false);
        if (trimmed !== (annotation.text || '').trim()) {
            onUpdate?.(annotation.id, { text: trimmed });
        }
    };

    const startEditing = (event) => {
        if (!canEdit) {
            return;
        }
        event?.stopPropagation();
        setIsEditing(true);
    };

    const handleMouseDown = (event) => {
        if ((!canDrag && !canEdit) || isEditing || isResizing) {
            return;
        }
        if (event.button !== 0) {
            return;
        }
        if (event.target.closest('button, textarea, .plan-annotation-resize-handle')) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        onInteractionStart?.();
        wasSelectedOnMouseDownRef.current = isSelected;
        onSelect?.(annotation.id);
        didDragRef.current = false;
        dragStartRef.current = { x: event.clientX, y: event.clientY };
        setIsDragging(true);
        setDragOffset({
            x: event.clientX - canvasX,
            y: event.clientY - canvasY,
        });
    };

    const handleResizeMouseDown = (event) => {
        if (!canEdit || isEditing) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        onInteractionStart?.();
        onSelect?.(annotation.id);
        const { box_width_mm, box_height_mm } = getPlanNoteBoxSizeMm(annotation, scaleFactor);
        resizeStartRef.current = {
            startClientX: event.clientX,
            startClientY: event.clientY,
            startWidthMm: box_width_mm,
            startHeightMm: box_height_mm,
        };
        setIsResizing(true);
    };

    useEffect(() => {
        if (!isDragging) {
            return undefined;
        }

        const handleMouseMove = (event) => {
            if (dragStartRef.current) {
                const moved = Math.hypot(
                    event.clientX - dragStartRef.current.x,
                    event.clientY - dragStartRef.current.y
                );
                if (moved < DRAG_THRESHOLD_PX) {
                    return;
                }
                didDragRef.current = true;
            }

            const nextX = (event.clientX - dragOffset.x - offsetX) / scaleFactor;
            const nextY = (event.clientY - dragOffset.y - offsetY) / scaleFactor;
            lastDragPositionRef.current = { position_x: nextX, position_y: nextY };
            onUpdate?.(annotation.id, lastDragPositionRef.current, { transient: true });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            if (lastDragPositionRef.current && didDragRef.current) {
                onUpdate?.(annotation.id, lastDragPositionRef.current);
            }
            lastDragPositionRef.current = null;
            dragStartRef.current = null;

            if (!didDragRef.current && canEdit && wasSelectedOnMouseDownRef.current) {
                setIsEditing(true);
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset, offsetX, offsetY, scaleFactor, annotation.id, onUpdate, canEdit]);

    useEffect(() => {
        if (!isResizing) {
            return undefined;
        }

        const minSizeMm = PLAN_NOTE_MIN_SCREEN_SIZE / Math.max(scaleFactor, 0.001);

        const handleMouseMove = (event) => {
            if (!resizeStartRef.current) {
                return;
            }
            const deltaX = (event.clientX - resizeStartRef.current.startClientX) / scaleFactor;
            const deltaY = (event.clientY - resizeStartRef.current.startClientY) / scaleFactor;
            onUpdate?.(annotation.id, {
                box_width_mm: Math.max(minSizeMm, resizeStartRef.current.startWidthMm + deltaX),
                box_height_mm: Math.max(minSizeMm, resizeStartRef.current.startHeightMm + deltaY),
            }, { transient: true });
        };

        const handleMouseUp = (event) => {
            if (resizeStartRef.current) {
                const deltaX = (event.clientX - resizeStartRef.current.startClientX) / scaleFactor;
                const deltaY = (event.clientY - resizeStartRef.current.startClientY) / scaleFactor;
                onUpdate?.(annotation.id, {
                    box_width_mm: Math.max(minSizeMm, resizeStartRef.current.startWidthMm + deltaX),
                    box_height_mm: Math.max(minSizeMm, resizeStartRef.current.startHeightMm + deltaY),
                });
            }
            resizeStartRef.current = null;
            setIsResizing(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, scaleFactor, annotation.id, onUpdate]);

    const hasArrow = annotation.arrow_target_x != null && annotation.arrow_target_y != null;
    const displayText = (annotation.text || '').trim() || 'Click to add text';
    const isMovable = canDrag || canEdit;

    return (
        <div
            className={`absolute ${isSelected || isDragging || isEditing || isResizing ? 'z-[45]' : 'z-[35]'}`}
            style={{
                left: `${canvasX}px`,
                top: `${canvasY}px`,
                width: `${boxWidthPx}px`,
                pointerEvents: 'auto',
                cursor: isDragging && didDragRef.current ? 'grabbing' : isMovable ? 'grab' : 'default',
            }}
            onMouseDown={handleMouseDown}
            onClick={(event) => event.stopPropagation()}
        >
            <div
                className={`plan-annotation-box h-full rounded-lg border shadow-md flex flex-col overflow-hidden ${
                    isSelected
                        ? 'border-amber-500 ring-2 ring-amber-300'
                        : isDark
                            ? 'border-gray-600'
                            : 'border-gray-300'
                } ${isDark ? 'bg-gray-900/95 text-gray-100' : 'bg-white/95 text-gray-900'}`}
                style={{ width: `${boxWidthPx}px`, height: `${boxHeightPx}px` }}
            >
                {isEditing ? (
                    <textarea
                        ref={textareaRef}
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        onBlur={commitText}
                        onMouseDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                setDraftText(annotation.text || '');
                                setIsEditing(false);
                            }
                        }}
                        className={`flex-1 min-h-0 w-full resize-none overflow-auto rounded-lg px-2.5 py-2 text-sm border-0 focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                            isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
                        }`}
                        placeholder="Type your note..."
                    />
                ) : (
                    <div
                        className={`flex-1 min-h-0 overflow-auto px-2.5 py-2 text-sm whitespace-pre-wrap break-words ${
                            canEdit ? 'cursor-text' : ''
                        } ${!(annotation.text || '').trim() ? 'italic opacity-70' : ''}`}
                        onDoubleClick={startEditing}
                    >
                        {displayText}
                    </div>
                )}
            </div>

            {canEdit && isSelected && !isEditing && (
                <div className={`mt-1 flex flex-wrap items-center gap-1 rounded-lg border px-1.5 py-1 shadow-sm ${
                    isDark ? 'bg-gray-900/95 border-gray-600' : 'bg-white/95 border-gray-300'
                }`}>
                    <button
                        type="button"
                        onClick={startEditing}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                            isDark
                                ? 'bg-gray-800 text-gray-200 hover:bg-gray-700'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        <FaPencilAlt className="w-3 h-3" />
                        Edit
                    </button>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onStartArrowPlacement?.(annotation.id);
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                            isPlacingArrow
                                ? 'bg-green-600 text-white'
                                : isDark
                                    ? 'bg-gray-800 text-gray-200 hover:bg-gray-700'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        <FaArrowRight className="w-3 h-3" />
                        {isPlacingArrow ? 'Click plan for arrow tip' : hasArrow ? 'Move arrow' : 'Arrow'}
                    </button>
                    {hasArrow && (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onUpdate?.(annotation.id, {
                                    arrow_target_x: null,
                                    arrow_target_y: null,
                                });
                            }}
                            className={`px-2 py-1 rounded text-xs ${
                                isDark ? 'text-amber-300 hover:bg-gray-800' : 'text-amber-700 hover:bg-amber-50'
                            }`}
                        >
                            Remove arrow
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onDelete?.(annotation.id);
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                            isDark ? 'text-red-300 hover:bg-gray-800' : 'text-red-600 hover:bg-red-50'
                        }`}
                        title="Delete (Del)"
                    >
                        <FaTrash className="w-3 h-3" />
                        Delete
                    </button>
                </div>
            )}

            {canEdit && isSelected && !isEditing && (
                <button
                    type="button"
                    aria-label="Resize note box"
                    className="plan-annotation-resize-handle absolute h-4 w-4 cursor-se-resize rounded-sm border border-amber-500 bg-amber-300 shadow"
                    style={{
                        top: `${boxHeightPx - 8}px`,
                        left: `${boxWidthPx - 8}px`,
                    }}
                    onMouseDown={handleResizeMouseDown}
                />
            )}
        </div>
    );
};

export default InteractivePlanAnnotation;
