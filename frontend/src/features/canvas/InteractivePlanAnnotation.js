import React, { useEffect, useRef, useState } from 'react';
import { FaArrowRight, FaTrash } from 'react-icons/fa';
import { useTheme } from '../theme/ThemeContext';

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
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draftText, setDraftText] = useState(annotation.text || '');
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const lastDragPositionRef = useRef(null);
    const textareaRef = useRef(null);
    const { isDark } = useTheme();

    const canvasX = annotation.position_x * scaleFactor + offsetX;
    const canvasY = annotation.position_y * scaleFactor + offsetY;

    useEffect(() => {
        setDraftText(annotation.text || '');
    }, [annotation.text, annotation.id]);

    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.select();
        }
    }, [isEditing]);

    const commitText = () => {
        const trimmed = draftText.trim();
        setIsEditing(false);
        if (trimmed !== (annotation.text || '').trim()) {
            onUpdate?.(annotation.id, { text: trimmed });
        }
    };

    const handleMouseDown = (event) => {
        if ((!canDrag && !canEdit) || isEditing) {
            return;
        }
        if (event.button !== 0) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        onSelect?.(annotation.id);
        setIsDragging(true);
        setDragOffset({
            x: event.clientX - canvasX,
            y: event.clientY - canvasY,
        });
    };

    useEffect(() => {
        if (!isDragging) {
            return undefined;
        }

        const handleMouseMove = (event) => {
            const nextX = (event.clientX - dragOffset.x - offsetX) / scaleFactor;
            const nextY = (event.clientY - dragOffset.y - offsetY) / scaleFactor;
            lastDragPositionRef.current = { position_x: nextX, position_y: nextY };
            onUpdate?.(annotation.id, lastDragPositionRef.current, { transient: true });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            if (lastDragPositionRef.current) {
                onUpdate?.(annotation.id, lastDragPositionRef.current);
                lastDragPositionRef.current = null;
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset, offsetX, offsetY, scaleFactor, annotation.id, onUpdate]);

    const hasArrow = annotation.arrow_target_x != null && annotation.arrow_target_y != null;
    const displayText = (annotation.text || '').trim() || 'Double-click to edit';
    const isMovable = canDrag || canEdit;

    return (
        <div
            className={`absolute ${isSelected || isDragging ? 'z-[45]' : 'z-[35]'}`}
            style={{
                left: `${canvasX}px`,
                top: `${canvasY}px`,
                transform: 'translate(0, 0)',
                pointerEvents: 'auto',
                cursor: isDragging ? 'grabbing' : isMovable ? 'grab' : 'default',
            }}
            onMouseDown={handleMouseDown}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
                if (!canEdit) return;
                event.stopPropagation();
                setIsEditing(true);
            }}
        >
            <div
                className={`plan-annotation-box min-w-[72px] max-w-[220px] rounded-lg border shadow-md ${
                    isSelected
                        ? 'border-amber-500 ring-2 ring-amber-300'
                        : isDark
                            ? 'border-gray-600'
                            : 'border-gray-300'
                } ${isDark ? 'bg-gray-900/95 text-gray-100' : 'bg-white/95 text-gray-900'}`}
            >
                {isEditing ? (
                    <textarea
                        ref={textareaRef}
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        onBlur={commitText}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                commitText();
                            }
                            if (event.key === 'Escape') {
                                setDraftText(annotation.text || '');
                                setIsEditing(false);
                            }
                        }}
                        rows={3}
                        className={`w-full resize-none rounded-lg px-2 py-1.5 text-sm border-0 focus:outline-none focus:ring-2 focus:ring-amber-400 ${
                            isDark ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
                        }`}
                        placeholder="Type note..."
                    />
                ) : (
                    <div className="px-2.5 py-2 text-sm whitespace-pre-wrap break-words">
                        {displayText}
                    </div>
                )}

                {canEdit && isSelected && !isEditing && (
                    <div className={`flex flex-wrap items-center gap-1 px-2 pb-2 border-t ${
                        isDark ? 'border-gray-700' : 'border-gray-200'
                    }`}>
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
                            {isPlacingArrow ? 'Click plan for arrow tip' : hasArrow ? 'Move arrow tip' : 'Add arrow'}
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
                        >
                            <FaTrash className="w-3 h-3" />
                            Delete
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default InteractivePlanAnnotation;
