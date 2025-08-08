import React, { useState, useRef, useEffect, useCallback } from 'react';

const InteractiveRoomLabel = ({ 
    room, 
    position, 
    scaleFactor, 
    offsetX, 
    offsetY, 
    onUpdateRoom,
    onPositionChange,
    isSelected = false,
    onSelect
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editHeight, setEditHeight] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [currentPosition, setCurrentPosition] = useState(position);
    const nameInputRef = useRef(null);
    const heightInputRef = useRef(null);
    const descriptionInputRef = useRef(null);
    const labelRef = useRef(null);

    // Calculate display text
    const getDisplayText = () => {
        const name = room.room_name || 'Unnamed Room';
        const height = room.height ? `EXT HT: ${room.height}mm` : 'EXT HT: No height';
        const description = room.remarks || 'No description';
        return `${name}<br/>${height}<br/>${description}`;
    };

    // Update current position when prop changes
    useEffect(() => {
        setCurrentPosition(position);
    }, [position]);

    // Calculate canvas position
    const canvasX = currentPosition.x * scaleFactor + offsetX;
    const canvasY = currentPosition.y * scaleFactor + offsetY;

    // Handle double click to start editing
    const handleDoubleClick = (e) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditName(room.room_name || '');
        setEditHeight(room.height ? room.height.toString() : '');
        setEditDescription(room.remarks || '');
        setTimeout(() => {
            if (nameInputRef.current) {
                nameInputRef.current.focus();
                nameInputRef.current.select();
            }
        }, 0);
    };

    // Handle single click to select
    const handleClick = (e) => {
        e.stopPropagation();
        onSelect && onSelect(room.id);
    };

    // Handle mouse down for dragging
    const handleMouseDown = (e) => {
        if (isEditing) return;
        e.stopPropagation();
        setIsDragging(true);
        
        // Calculate the initial mouse position in canvas coordinates
        const initialMouseX = (e.clientX - offsetX) / scaleFactor;
        const initialMouseY = (e.clientY - offsetY) / scaleFactor;
        
        // Store the offset between mouse and label position
        setDragOffset({
            x: initialMouseX - currentPosition.x,
            y: initialMouseY - currentPosition.y
        });
    };

    // Handle mouse move for dragging
    const handleMouseMove = useCallback((e) => {
        if (!isDragging) return;
        e.preventDefault();
        
        // Calculate the new mouse position in canvas coordinates
        const mouseX = (e.clientX - offsetX) / scaleFactor;
        const mouseY = (e.clientY - offsetY) / scaleFactor;
        
        // Calculate new label position by subtracting the drag offset
        const newX = mouseX - dragOffset.x;
        const newY = mouseY - dragOffset.y;
        
        setCurrentPosition({ x: newX, y: newY });
        onPositionChange && onPositionChange(room.id, { x: newX, y: newY });
    }, [isDragging, dragOffset, offsetX, offsetY, scaleFactor, onPositionChange, room.id]);

    // Handle mouse up to stop dragging
    const handleMouseUp = useCallback(() => {
        if (isDragging) {
            // Save the final position
            onUpdateRoom && onUpdateRoom(room.id, { label_position: currentPosition });
        }
        setIsDragging(false);
    }, [isDragging, currentPosition, onUpdateRoom, room.id]);

    // Handle input changes
    const handleNameChange = (e) => {
        setEditName(e.target.value);
    };

    const handleHeightChange = (e) => {
        setEditHeight(e.target.value);
    };

    const handleDescriptionChange = (e) => {
        setEditDescription(e.target.value);
    };

    // Handle input key down
    const handleInputKeyDown = (e) => {
        if (e.key === 'Enter') {
            if (e.target === nameInputRef.current) {
                heightInputRef.current?.focus();
            } else if (e.target === heightInputRef.current) {
                descriptionInputRef.current?.focus();
            } else if (e.target === descriptionInputRef.current) {
                handleSave();
            }
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setEditName('');
            setEditHeight('');
            setEditDescription('');
        }
    };

    // Handle input blur
    const handleInputBlur = () => {
        // Only save if all inputs have lost focus
        setTimeout(() => {
            if (!nameInputRef.current?.contains(document.activeElement) &&
                !heightInputRef.current?.contains(document.activeElement) &&
                !descriptionInputRef.current?.contains(document.activeElement)) {
                handleSave();
            }
        }, 100);
    };

    // Save changes
    const handleSave = () => {
        const updates = {};
        
        if (editName.trim() !== room.room_name) {
            updates.room_name = editName.trim();
        }
        
        const heightValue = parseFloat(editHeight);
        if (editHeight !== '' && (isNaN(heightValue) || heightValue !== room.height)) {
            updates.height = heightValue;
        } else if (editHeight === '' && room.height !== null) {
            updates.height = null;
        }
        
        if (editDescription !== room.remarks) {
            updates.remarks = editDescription;
        }
        
        if (Object.keys(updates).length > 0) {
            onUpdateRoom && onUpdateRoom(room.id, updates);
        }
        
        setIsEditing(false);
        setEditName('');
        setEditHeight('');
        setEditDescription('');
    };

    // Add global mouse event listeners for dragging
    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Prevent text selection during drag
    useEffect(() => {
        if (isDragging) {
            document.body.style.userSelect = 'none';
            return () => {
                document.body.style.userSelect = '';
            };
        }
    }, [isDragging]);

    return (
        <div
            ref={labelRef}
            style={{
                position: 'absolute',
                left: canvasX,
                top: canvasY,
                transform: 'translate(-50%, -50%)',
                cursor: isDragging ? 'grabbing' : 'grab',
                zIndex: isSelected ? 40 : 30,
                userSelect: 'none'
            }}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onMouseDown={handleMouseDown}
            className={`room-label ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
        >
            {isEditing ? (
                <div
                    style={{
                        background: 'white',
                        border: '2px solid #007bff',
                        borderRadius: '4px',
                        padding: '6px 10px',
                        fontSize: '12px',
                        fontFamily: 'Arial',
                        minWidth: '150px',
                        maxWidth: '250px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                    }}
                >
                    <input
                        ref={nameInputRef}
                        type="text"
                        value={editName}
                        onChange={handleNameChange}
                        onKeyDown={handleInputKeyDown}
                        onBlur={handleInputBlur}
                        placeholder="Room Name"
                        style={{
                            border: 'none',
                            outline: 'none',
                            fontSize: '12px',
                            fontFamily: 'Arial',
                            background: 'transparent',
                            textAlign: 'center'
                        }}
                    />
                    <input
                        ref={heightInputRef}
                        type="number"
                        value={editHeight}
                        onChange={handleHeightChange}
                        onKeyDown={handleInputKeyDown}
                        onBlur={handleInputBlur}
                        placeholder="Height (mm)"
                        style={{
                            border: 'none',
                            outline: 'none',
                            fontSize: '12px',
                            fontFamily: 'Arial',
                            background: 'transparent',
                            textAlign: 'center'
                        }}
                    />
                    <input
                        ref={descriptionInputRef}
                        type="text"
                        value={editDescription}
                        onChange={handleDescriptionChange}
                        onKeyDown={handleInputKeyDown}
                        onBlur={handleInputBlur}
                        placeholder="Description"
                        style={{
                            border: 'none',
                            outline: 'none',
                            fontSize: '12px',
                            fontFamily: 'Arial',
                            background: 'transparent',
                            textAlign: 'center'
                        }}
                    />
                </div>
            ) : (
                <div
                    style={{
                        background: 'white',
                        border: isSelected ? '2px solid #007bff' : '1px solid #ccc',
                        borderRadius: '4px',
                        padding: '6px 10px',
                        fontSize: '12px',
                        fontFamily: 'Arial',
                        lineHeight: '1.2',
                        textAlign: 'center',
                        minWidth: '120px',
                        maxWidth: '200px',
                        boxShadow: isSelected ? '0 2px 8px rgba(0,123,255,0.3)' : '0 1px 3px rgba(0,0,0,0.1)',
                        transition: 'all 0.2s ease'
                    }}
                    dangerouslySetInnerHTML={{ __html: getDisplayText() }}
                />
            )}
        </div>
    );
};

export default InteractiveRoomLabel;
