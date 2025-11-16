import React, { useState, useRef, useEffect, useCallback } from 'react';
import { isPointInPolygon } from './utils';

const InteractiveRoomLabel = ({ 
    room, 
    position, 
    scaleFactor, 
    initialScale = 1,
    offsetX, 
    offsetY, 
    onUpdateRoom,
    onPositionChange,
    isSelected = false,
    onSelect,
    currentMode,
    selectedRoomPoints = []
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
    const labelBoxRef = useRef(null);

    // Calculate display text
    const getDisplayText = () => {
        const name = room.room_name || 'Unnamed Room';
        const temperature = room.temperature !== undefined && room.temperature !== null && room.temperature !== 0
            ? `${room.temperature > 0 ? '+' : ''}${room.temperature}°C`
            : '';
        const height = room.height ? `EXT. HT. ${room.height}mm` : 'EXT. HT. No height';
        
        // Format: Room name + temperature (if not 0), then external height
        // If room name is long, we can put temperature on a new line
        let lines = [];
        
        if (temperature) {
            // Check if room name is long (more than ~15 characters) - put temperature on new line
            if (name.length > 15) {
                lines.push(name);
                lines.push(temperature);
            } else {
                // Put room name and temperature on same line
                lines.push(`${name} ${temperature}`);
            }
        } else {
            // No temperature, just room name
            lines.push(name);
        }
        
        // Always add external height as last line
        lines.push(height);
        
        return lines.join('<br/>');
    };

    // Helper function to find the closest point on a line segment to a given point
    const closestPointOnSegment = (px, py, x1, y1, x2, y2) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSquared = dx * dx + dy * dy;
        
        if (lengthSquared === 0) {
            return { x: x1, y: y1 };
        }
        
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
        return {
            x: x1 + t * dx,
            y: y1 + t * dy
        };
    };

    // Calculate if room is large enough to contain the label
    const canRoomContainLabel = useCallback(() => {
        if (!room.room_points || room.room_points.length < 3) {
            return true; // No boundary, assume it can contain
        }
        
        const normalizedPolygon = room.room_points.map(pt => ({
            x: Number(pt.x) || 0,
            y: Number(pt.y) || 0
        }));
        
        // Calculate room bounding box
        const minX = Math.min(...normalizedPolygon.map(p => p.x));
        const maxX = Math.max(...normalizedPolygon.map(p => p.x));
        const minY = Math.min(...normalizedPolygon.map(p => p.y));
        const maxY = Math.max(...normalizedPolygon.map(p => p.y));
        
        const roomWidth = maxX - minX;
        const roomHeight = maxY - minY;
        
        // Estimate label size (in model coordinates, not scaled)
        // Use base dimensions to estimate minimum required space
        const baseLabelWidth = 140; // BASE_MAX_WIDTH
        const baseLabelHeight = 50; // Approximate label height
        const labelWidth = baseLabelWidth / scaleFactor; // Convert to model coordinates
        const labelHeight = baseLabelHeight / scaleFactor; // Approximate label height in model coordinates
        
        // Check if room can contain the label with some margin
        const margin = 20 / scaleFactor; // 20px margin in model coordinates
        return roomWidth >= labelWidth + margin && roomHeight >= labelHeight + margin;
    }, [room.room_points, scaleFactor]);

    // Helper function to find closest point on room boundary
    const findClosestPointOnRoomBoundary = useCallback((point) => {
        if (!room.room_points || room.room_points.length < 3) {
            return null;
        }
        
        const normalizedPolygon = room.room_points.map(pt => ({
            x: Number(pt.x) || 0,
            y: Number(pt.y) || 0
        }));
        
        let closestPoint = null;
        let minDistance = Infinity;
        
        for (let i = 0; i < normalizedPolygon.length; i++) {
            const p1 = normalizedPolygon[i];
            const p2 = normalizedPolygon[(i + 1) % normalizedPolygon.length];
            const segmentPoint = closestPointOnSegment(point.x, point.y, p1.x, p1.y, p2.x, p2.y);
            const distance = Math.hypot(segmentPoint.x - point.x, segmentPoint.y - point.y);
            
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = segmentPoint;
            }
        }
        
        return closestPoint;
    }, [room.room_points]);

    // Helper function to constrain a point to be inside the room polygon
    // But allow it outside if room is too small
    const constrainToRoomBoundary = useCallback((point) => {
        if (!room.room_points || room.room_points.length < 3) {
            return point; // No boundary to check, return as-is
        }
        
        const normalizedPolygon = room.room_points.map(pt => ({
            x: Number(pt.x) || 0,
            y: Number(pt.y) || 0
        }));
        
        // Check if point is inside the room polygon
        if (isPointInPolygon(point, normalizedPolygon)) {
            return point; // Already inside, return as-is
        }
        
        // Check if room is large enough to contain the label
        const roomCanContain = canRoomContainLabel();
        
        // If room is too small, allow label to be outside
        if (!roomCanContain) {
            return point; // Allow outside placement
        }
        
        // Room is large enough, so constrain to inside
        // Find the closest point inside the polygon
        let closestPoint = null;
        let minDistance = Infinity;
        
        for (let i = 0; i < normalizedPolygon.length; i++) {
            const p1 = normalizedPolygon[i];
            const p2 = normalizedPolygon[(i + 1) % normalizedPolygon.length];
            const segmentPoint = closestPointOnSegment(point.x, point.y, p1.x, p1.y, p2.x, p2.y);
            const distance = Math.hypot(segmentPoint.x - point.x, segmentPoint.y - point.y);
            
            if (distance < minDistance) {
                minDistance = distance;
                closestPoint = segmentPoint;
            }
        }
        
        // If the closest point on the edge is inside, use it
        if (closestPoint && isPointInPolygon(closestPoint, normalizedPolygon)) {
            return closestPoint;
        }
        
        // Move the point slightly inside the polygon
        const centerX = normalizedPolygon.reduce((sum, p) => sum + p.x, 0) / normalizedPolygon.length;
        const centerY = normalizedPolygon.reduce((sum, p) => sum + p.y, 0) / normalizedPolygon.length;
        
        let minT = 0;
        let maxT = 1;
        let bestPoint = { x: centerX, y: centerY };
        
        // Binary search for a point inside the polygon
        for (let i = 0; i < 20; i++) {
            const t = (minT + maxT) / 2;
            const testPoint = {
                x: centerX + ((closestPoint?.x || point.x) - centerX) * t,
                y: centerY + ((closestPoint?.y || point.y) - centerY) * t
            };
            
            if (isPointInPolygon(testPoint, normalizedPolygon)) {
                bestPoint = testPoint;
                minT = t;
            } else {
                maxT = t;
            }
        }
        
        return bestPoint;
    }, [room.room_points, canRoomContainLabel]);

    // Update current position when prop changes, ensuring it's within room boundary
    useEffect(() => {
        const constrainedPosition = constrainToRoomBoundary(position);
        setCurrentPosition(constrainedPosition);
    }, [position, constrainToRoomBoundary]);

    // Calculate canvas position
    const canvasX = currentPosition.x * scaleFactor + offsetX;
    const canvasY = currentPosition.y * scaleFactor + offsetY;
    
    // Check if room selection is disabled
    // Only disable room selection when actively defining a room (has polygon points)
    const isSelectionDisabled = currentMode === 'define-room' && selectedRoomPoints && selectedRoomPoints.length > 0;

    // Handle double click to start editing
    const handleDoubleClick = (e) => {
        e.stopPropagation();
        // Disable room editing when in room definition mode
        if (currentMode === 'define-room') {
            return;
        }
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
        // Disable room selection when in room definition mode
        if (currentMode === 'define-room') {
            return;
        }
        onSelect && onSelect(room.id);
    };

    // Handle mouse down for dragging
    const handleMouseDown = (e) => {
        if (isEditing) return;
        // Disable room label dragging when in room definition mode
        if (currentMode === 'define-room') {
            return;
        }
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
        
        // Constrain the position to be within the room boundary
        const constrainedPosition = constrainToRoomBoundary({ x: newX, y: newY });
        
        setCurrentPosition(constrainedPosition);
        onPositionChange && onPositionChange(room.id, constrainedPosition);
    }, [isDragging, dragOffset, offsetX, offsetY, scaleFactor, onPositionChange, room.id, constrainToRoomBoundary]);

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

    // Calculate scaled dimensions based on zoom ratio
    // Scale labels proportionally with zoom changes, but less aggressively
    // This ensures labels always scale when user zooms, regardless of project size
    const zoomRatio = initialScale > 0 ? scaleFactor / initialScale : 1; // Ratio of current zoom to initial zoom
    
    // Use square root scaling to make zoom less aggressive (smoother scaling curve)
    // This means 2x zoom only results in ~1.41x label size, not 2x
    const smoothZoomRatio = Math.sqrt(zoomRatio);
    
    // Base dimensions at 1x zoom (initial scale) - made smaller
    const BASE_FONT_SIZE = 8; // Reduced from 12
    const BASE_PADDING_V = 4; // Reduced from 6
    const BASE_PADDING_H = 6; // Reduced from 10
    const BASE_MIN_WIDTH = 80; // Reduced from 120
    const BASE_MAX_WIDTH = 120; // Reduced to limit label width
    const BASE_BORDER_WIDTH = 0.8;
    const BASE_BORDER_WIDTH_SELECTED = 1.5;
    const BASE_BORDER_RADIUS = 3;
    const BASE_GAP = 3;
    
    // Scale dimensions with smooth zoom ratio (less aggressive scaling)
    // This ensures labels scale immediately when zooming, but not too dramatically
    const scaledFontSize = Math.max(BASE_FONT_SIZE * smoothZoomRatio, 6); // Minimum 6px for readability
    const scaledPaddingV = Math.max(BASE_PADDING_V * smoothZoomRatio, 2);
    const scaledPaddingH = Math.max(BASE_PADDING_H * smoothZoomRatio, 4);
    const scaledMinWidth = Math.max(BASE_MIN_WIDTH * smoothZoomRatio, 60);
    const scaledMaxWidth = Math.max(BASE_MAX_WIDTH * smoothZoomRatio, 90);
    const scaledBorderWidth = Math.max(BASE_BORDER_WIDTH * smoothZoomRatio, 0.5);
    const scaledBorderWidthSelected = Math.max(BASE_BORDER_WIDTH_SELECTED * smoothZoomRatio, 1);
    const scaledBorderRadius = Math.max(BASE_BORDER_RADIUS * smoothZoomRatio, 2);
    const scaledGap = Math.max(BASE_GAP * smoothZoomRatio, 2);
    
    // Check if label is out of bounds (assuming canvas dimensions)
    const canvasWidth = 1000; // Match the canvas width from Canvas2D
    const canvasHeight = 600; // Match the canvas height from Canvas2D
    const labelWidth = scaledMaxWidth; // Use scaled max width for bounds check
    const labelHeight = 50 * smoothZoomRatio; // Approximate scaled label height (base 50px * smoothZoomRatio)
    
    const isOutOfBounds = canvasX < -labelWidth/2 || 
                         canvasX > canvasWidth + labelWidth/2 || 
                         canvasY < -labelHeight/2 || 
                         canvasY > canvasHeight + labelHeight/2;
    
    // Don't render if out of bounds
    if (isOutOfBounds) {
        return null;
    }

    // Check if label is outside the room and room is too small
    const isLabelOutsideRoom = room.room_points && room.room_points.length >= 3 && 
                               !isPointInPolygon(currentPosition, room.room_points.map(pt => ({
                                   x: Number(pt.x) || 0,
                                   y: Number(pt.y) || 0
                               })));
    const roomCanContain = canRoomContainLabel();
    const shouldShowArrow = isLabelOutsideRoom && !roomCanContain;

    // Calculate arrow position if needed
    let arrowPath = null;
    if (shouldShowArrow && room.room_points && room.room_points.length >= 3) {
        // Calculate room center (centroid)
        const normalizedPolygon = room.room_points.map(pt => ({
            x: Number(pt.x) || 0,
            y: Number(pt.y) || 0
        }));
        const roomCenterX = normalizedPolygon.reduce((sum, p) => sum + p.x, 0) / normalizedPolygon.length;
        const roomCenterY = normalizedPolygon.reduce((sum, p) => sum + p.y, 0) / normalizedPolygon.length;
        
        // Calculate direction from label center to room center
        const dx = roomCenterX - currentPosition.x;
        const dy = roomCenterY - currentPosition.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        
        // Get actual rendered dimensions from the label box element
        let actualLabelWidth, actualLabelHeight;
        const labelBoxElement = labelBoxRef.current;
        if (labelBoxElement) {
            const rect = labelBoxElement.getBoundingClientRect();
            // getBoundingClientRect returns dimensions including border and padding
            actualLabelWidth = rect.width;
            actualLabelHeight = rect.height;
        } else {
            // Fallback to calculated dimensions if ref not available yet
            const labelPaddingH = scaledPaddingH;
            const labelPaddingV = scaledPaddingV;
            const labelBorderWidth = isSelected ? scaledBorderWidthSelected : scaledBorderWidth;
            const contentWidth = scaledMaxWidth;
            const contentHeight = 50 * smoothZoomRatio;
            // Total label box dimensions (content + padding + border on both sides)
            actualLabelWidth = contentWidth + (labelPaddingH * 2) + (labelBorderWidth * 2);
            actualLabelHeight = contentHeight + (labelPaddingV * 2) + (labelBorderWidth * 2);
        }
        
        let startX, startY;
        let isHorizontalEdge = false; // Track if we're starting from horizontal or vertical edge
        
        // Determine which edge based on the direction
        if (absDx > absDy) {
            // Horizontal direction (left or right edge)
            isHorizontalEdge = true;
            if (dx > 0) {
                // Room is to the right, start from right edge
                startX = canvasX + actualLabelWidth / 2;
                startY = canvasY;
            } else {
                // Room is to the left, start from left edge
                startX = canvasX - actualLabelWidth / 2;
                startY = canvasY;
            }
        } else {
            // Vertical direction (top or bottom edge)
            isHorizontalEdge = false;
            if (dy > 0) {
                // Room is below, start from bottom edge
                startX = canvasX;
                startY = canvasY + actualLabelHeight / 2;
            } else {
                // Room is above, start from top edge
                startX = canvasX;
                startY = canvasY - actualLabelHeight / 2;
            }
        }
        
        // End point at room center (in canvas coordinates)
        const endX = roomCenterX * scaleFactor + offsetX;
        const endY = roomCenterY * scaleFactor + offsetY;
        
        // Create L-shaped path: extend in the direction of the edge first, then turn if needed
        let midX, midY;
        if (isHorizontalEdge) {
            // Starting from left or right edge: extend horizontally first
            // Go horizontally first (in the direction of the edge), then vertical if needed
            midX = endX; // Extend horizontally to the room center's X
            midY = startY; // Keep the same Y as the starting edge
        } else {
            // Starting from top or bottom edge: extend vertically first
            // Go vertically first (in the direction of the edge), then horizontal if needed
            midX = startX; // Keep the same X as the starting edge
            midY = endY; // Extend vertically to the room center's Y
        }
        
        arrowPath = {
            startX,
            startY,
            midX,
            midY,
            endX,
            endY
        };
    }

    return (
        <>
            <div
                ref={labelRef}
                style={{
                    position: 'absolute',
                    left: canvasX,
                    top: canvasY,
                    transform: 'translate(-50%, -50%)',
                    cursor: isSelectionDisabled ? 'not-allowed' : (isDragging ? 'grabbing' : 'grab'),
                    zIndex: isSelected ? 40 : 30,
                    userSelect: 'none'
                }}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onMouseDown={handleMouseDown}
                className={`room-label ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
                title={isSelectionDisabled ? 'Room selection disabled while defining room points' : 'Click to select room, double-click to edit'}
            >
                {isEditing ? (
                    <div
                        ref={labelBoxRef}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            borderRadius: `${scaledBorderRadius}px`,
                            padding: `${scaledPaddingV}px ${scaledPaddingH}px`,
                            fontSize: `${scaledFontSize}px`,
                            fontFamily: 'Arial',
                            minWidth: `${scaledMinWidth * 1.25}px`,
                            maxWidth: `${scaledMaxWidth * 1.25}px`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: `${scaledGap}px`
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
                                fontSize: `${scaledFontSize}px`,
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
                                fontSize: `${scaledFontSize}px`,
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
                                fontSize: `${scaledFontSize}px`,
                                fontFamily: 'Arial',
                                background: 'transparent',
                                textAlign: 'center'
                            }}
                        />
                    </div>
                ) : (
                    <div
                        ref={labelBoxRef}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            borderRadius: `${scaledBorderRadius}px`,
                            padding: `${scaledPaddingV}px ${scaledPaddingH}px`,
                            fontSize: `${scaledFontSize}px`,
                            fontFamily: 'Arial',
                            lineHeight: '1.2',
                            textAlign: 'center',
                            minWidth: `${scaledMinWidth}px`,
                            maxWidth: `${scaledMaxWidth}px`,
                            wordWrap: 'break-word',
                            overflowWrap: 'break-word',
                            whiteSpace: 'normal',
                            overflow: 'hidden',
                            boxShadow: 'none',
                            transition: 'all 0.2s ease',
                            opacity: isSelectionDisabled ? 0.6 : 1
                        }}
                        dangerouslySetInnerHTML={{ __html: getDisplayText() }}
                    />
                )}
            </div>
            {shouldShowArrow && arrowPath && (
                <svg
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: `${canvasWidth}px`,
                        height: `${canvasHeight}px`,
                        pointerEvents: 'none',
                        zIndex: isSelected ? 39 : 29,
                        overflow: 'visible'
                    }}
                >
                    <defs>
                        <marker
                            id={`arrowhead-${room.id}`}
                            markerWidth="8"
                            markerHeight="8"
                            refX="7"
                            refY="2.5"
                            orient="auto"
                        >
                            <polygon
                                points="0 0, 8 2.5, 0 5"
                                fill="#ff0000"
                            />
                        </marker>
                    </defs>
                    {/* L-shaped path: horizontal line then vertical line */}
                    <line
                        x1={arrowPath.startX}
                        y1={arrowPath.startY}
                        x2={arrowPath.midX}
                        y2={arrowPath.midY}
                        stroke="#ff0000"
                        strokeWidth={Math.max(1.2 * smoothZoomRatio, 1)}
                    />
                    <line
                        x1={arrowPath.midX}
                        y1={arrowPath.midY}
                        x2={arrowPath.endX}
                        y2={arrowPath.endY}
                        stroke="#ff0000"
                        strokeWidth={Math.max(1.2 * smoothZoomRatio, 1)}
                        markerEnd={`url(#arrowhead-${room.id})`}
                    />
                </svg>
            )}
        </>
    );
};

export default InteractiveRoomLabel;
