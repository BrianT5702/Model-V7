// Collision detection utilities for dimension labels
// Shared across wall plan, floor plan, and ceiling plan

/**
 * Check if two bounding boxes overlap using Axis-Aligned Bounding Box (AABB) algorithm
 * @param {Object} box1 - First bounding box {x, y, width, height}
 * @param {Object} box2 - Second bounding box {x, y, width, height}
 * @returns {boolean} - True if boxes overlap, false otherwise
 */
export function checkBoxOverlap(box1, box2) {
    // Two boxes DON'T overlap if any of these conditions are true:
    // - box1 is completely to the left of box2
    // - box1 is completely to the right of box2
    // - box1 is completely above box2
    // - box1 is completely below box2
    
    const noOverlap = (
        box1.x + box1.width < box2.x ||      // box1 is left of box2
        box2.x + box2.width < box1.x ||      // box1 is right of box2
        box1.y + box1.height < box2.y ||     // box1 is above box2
        box2.y + box2.height < box1.y        // box1 is below box2
    );
    
    return !noOverlap; // If not separated, they overlap
}

/**
 * Check if a label bounding box overlaps with any existing labels
 * @param {Object} labelBounds - The new label bounds {x, y, width, height}
 * @param {Array} placedLabels - Array of already placed label bounds
 * @returns {boolean} - True if overlap detected, false otherwise
 */
export function hasLabelOverlap(labelBounds, placedLabels) {
    return placedLabels.some(existing => checkBoxOverlap(labelBounds, existing));
}

/**
 * Calculate bounding box for horizontal text label
 * @param {number} labelX - Label X position (canvas coordinates)
 * @param {number} labelY - Label Y position (canvas coordinates)
 * @param {number} textWidth - Width of the text
 * @param {number} paddingH - Horizontal padding (default 4)
 * @param {number} paddingV - Vertical padding (default 8)
 * @returns {Object} - Bounding box {x, y, width, height}
 */
export function calculateHorizontalLabelBounds(labelX, labelY, textWidth, paddingH = 4, paddingV = 8) {
    return {
        x: labelX - textWidth / 2 - paddingH,
        y: labelY - paddingV,
        width: textWidth + paddingH * 2,
        height: paddingV * 2
    };
}

/**
 * Calculate bounding box for vertical (rotated) text label
 * Note: For rotated text, width and height are swapped
 * @param {number} labelX - Label X position (canvas coordinates)
 * @param {number} labelY - Label Y position (canvas coordinates)
 * @param {number} textWidth - Width of the text (before rotation)
 * @param {number} paddingH - Horizontal padding (default 8)
 * @param {number} paddingV - Vertical padding (default 4)
 * @returns {Object} - Bounding box {x, y, width, height} (swapped for rotation)
 */
export function calculateVerticalLabelBounds(labelX, labelY, textWidth, paddingH = 8, paddingV = 4) {
    return {
        x: labelX - paddingV,              // Swapped: using vertical padding for x
        y: labelY - textWidth / 2 - paddingH,  // Swapped: using horizontal padding for y
        width: paddingV * 2,               // Swapped: width becomes narrow
        height: textWidth + paddingH * 2   // Swapped: height becomes the text width
    };
}

/**
 * Find an available position for a label by incrementing offset until no collision
 * @param {Object} params - Configuration object
 * @param {Function} params.calculatePosition - Function(offset) that returns {labelX, labelY}
 * @param {Function} params.calculateBounds - Function(labelX, labelY, textWidth) that returns bounds
 * @param {number} params.textWidth - Width of the text to place
 * @param {Array} params.placedLabels - Array of existing label bounds
 * @param {number} params.baseOffset - Starting offset value
 * @param {number} params.offsetIncrement - How much to increase offset on collision
 * @param {number} params.maxAttempts - Maximum number of attempts
 * @returns {Object} - {labelX, labelY, offset, attempts, hadCollision}
 */
export function findAvailableLabelPosition({
    calculatePosition,
    calculateBounds,
    textWidth,
    placedLabels,
    baseOffset,
    offsetIncrement = 20,
    maxAttempts = 10
}) {
    let offset = baseOffset;
    let attempts = 0;
    let labelX, labelY, labelBounds;
    let hadCollision = false;
    
    do {
        // Calculate position for this offset
        const position = calculatePosition(offset);
        labelX = position.labelX;
        labelY = position.labelY;
        
        // Calculate bounds for this position
        labelBounds = calculateBounds(labelX, labelY, textWidth);
        
        // Check for overlaps
        const hasOverlap = hasLabelOverlap(labelBounds, placedLabels);
        
        if (!hasOverlap) break;
        
        hadCollision = true;
        offset += offsetIncrement;
        attempts++;
    } while (attempts < maxAttempts);
    
    return {
        labelX,
        labelY,
        labelBounds,
        offset,
        attempts,
        hadCollision
    };
}

/**
 * Add a label to the placed labels array for future collision detection
 * @param {Array} placedLabels - Array to add to
 * @param {Object} labelBounds - Bounding box {x, y, width, height}
 * @param {string} text - Label text (optional, for debugging)
 * @param {string} type - Label type (optional, for debugging)
 * @returns {Object} - The label object that was added
 */
export function addToPlacedLabels(placedLabels, labelBounds, text = '', type = '') {
    const label = {
        x: labelBounds.x,
        y: labelBounds.y,
        width: labelBounds.width,
        height: labelBounds.height,
        text: text,
        type: type
    };
    
    placedLabels.push(label);
    return label;
}

/**
 * Calculate label bounds based on orientation (horizontal or vertical)
 * @param {boolean} isHorizontal - True for horizontal text, false for vertical (rotated)
 * @param {number} labelX - Label X position
 * @param {number} labelY - Label Y position
 * @param {number} textWidth - Width of the text
 * @param {number} paddingH - Horizontal padding
 * @param {number} paddingV - Vertical padding
 * @returns {Object} - Bounding box {x, y, width, height}
 */
export function calculateLabelBounds(isHorizontal, labelX, labelY, textWidth, paddingH = 4, paddingV = 8) {
    if (isHorizontal) {
        return calculateHorizontalLabelBounds(labelX, labelY, textWidth, paddingH, paddingV);
    } else {
        return calculateVerticalLabelBounds(labelX, labelY, textWidth, paddingH, paddingV);
    }
}

/**
 * Debug function to log collision detection info
 * @param {Object} labelBounds - The label being placed
 * @param {Array} placedLabels - Existing labels
 * @param {boolean} hadCollision - Whether collision was detected
 */
export function debugCollision(labelBounds, placedLabels, hadCollision) {
    if (hadCollision) {
        console.warn('⚠️ Collision detected:', {
            newLabel: labelBounds,
            existingLabels: placedLabels,
            overlappingWith: placedLabels.filter(existing => checkBoxOverlap(labelBounds, existing))
        });
    }
}

/**
 * Count the number of overlapping labels for a given label bounds
 * @param {Object} labelBounds - The label bounds to check {x, y, width, height}
 * @param {Array} placedLabels - Array of existing label bounds
 * @returns {number} - Number of overlapping labels
 */
export function countOverlaps(labelBounds, placedLabels) {
    return placedLabels.filter(existing => checkBoxOverlap(labelBounds, existing)).length;
}

/**
 * Smart placement: Choose the best side (left/right for vertical, top/bottom for horizontal)
 * by evaluating both sides and selecting the one with fewer overlaps
 * @param {Object} params - Configuration object
 * @param {Function} params.calculatePositionSide1 - Function(offset) that returns {labelX, labelY} for first side
 * @param {Function} params.calculatePositionSide2 - Function(offset) that returns {labelX, labelY} for second side
 * @param {Function} params.calculateBounds - Function(labelX, labelY, textWidth) that returns bounds
 * @param {number} params.textWidth - Width of the text to place
 * @param {Array} params.placedLabels - Array of existing label bounds
 * @param {number} params.baseOffset - Starting offset value
 * @param {number} params.offsetIncrement - How much to increase offset on collision
 * @param {number} params.maxAttempts - Maximum number of attempts per side
 * @param {string} params.preferredSide - 'side1' or 'side2' - preferred side if equal overlaps
 * @param {string} params.lockedSide - 'side1' or 'side2' or null - if provided, use this side and don't re-evaluate
 * @returns {Object} - {labelX, labelY, offset, attempts, side, labelBounds}
 */
export function smartPlacement({
    calculatePositionSide1,
    calculatePositionSide2,
    calculateBounds,
    textWidth,
    placedLabels,
    baseOffset,
    offsetIncrement = 20,
    maxAttempts = 10,
    preferredSide = 'side1',
    lockedSide = null
}) {
    // If side is locked, use it directly without evaluating both sides
    if (lockedSide === 'side1' || lockedSide === 'side2') {
        const calculatePosition = lockedSide === 'side1' ? calculatePositionSide1 : calculatePositionSide2;
        let offset = baseOffset;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            const position = calculatePosition(offset);
            const bounds = calculateBounds(position.labelX, position.labelY, textWidth);
            const overlaps = countOverlaps(bounds, placedLabels);
            
            if (overlaps === 0) {
                // Perfect position found
                return {
                    labelX: position.labelX,
                    labelY: position.labelY,
                    labelBounds: bounds,
                    offset: offset,
                    attempts: attempts,
                    side: lockedSide,
                    overlaps: 0
                };
            }
            
            offset += offsetIncrement;
            attempts++;
        }
        
        // If we couldn't find a perfect position, use the last tried position
        const finalPosition = calculatePosition(offset - offsetIncrement);
        const finalBounds = calculateBounds(finalPosition.labelX, finalPosition.labelY, textWidth);
        return {
            labelX: finalPosition.labelX,
            labelY: finalPosition.labelY,
            labelBounds: finalBounds,
            offset: offset - offsetIncrement,
            attempts: attempts,
            side: lockedSide,
            overlaps: countOverlaps(finalBounds, placedLabels)
        };
    }
    
    // Original logic: evaluate both sides if not locked
    // Try side 1 with increasing offsets
    let bestSide1 = null;
    let bestOverlaps1 = Infinity;
    let offset1 = baseOffset;
    let attempts1 = 0;
    
    while (attempts1 < maxAttempts) {
        const position1 = calculatePositionSide1(offset1);
        const bounds1 = calculateBounds(position1.labelX, position1.labelY, textWidth);
        const overlaps1 = countOverlaps(bounds1, placedLabels);
        
        if (overlaps1 === 0) {
            // Perfect position found - use it immediately
            bestSide1 = { labelX: position1.labelX, labelY: position1.labelY, offset: offset1, bounds: bounds1, overlaps: 0 };
            break;
        }
        
        if (overlaps1 < bestOverlaps1) {
            bestOverlaps1 = overlaps1;
            bestSide1 = { labelX: position1.labelX, labelY: position1.labelY, offset: offset1, bounds: bounds1, overlaps: overlaps1 };
        }
        
        offset1 += offsetIncrement;
        attempts1++;
    }
    
    // Try side 2 with increasing offsets
    let bestSide2 = null;
    let bestOverlaps2 = Infinity;
    let offset2 = baseOffset;
    let attempts2 = 0;
    
    while (attempts2 < maxAttempts) {
        const position2 = calculatePositionSide2(offset2);
        const bounds2 = calculateBounds(position2.labelX, position2.labelY, textWidth);
        const overlaps2 = countOverlaps(bounds2, placedLabels);
        
        if (overlaps2 === 0) {
            // Perfect position found - use it immediately
            bestSide2 = { labelX: position2.labelX, labelY: position2.labelY, offset: offset2, bounds: bounds2, overlaps: 0 };
            break;
        }
        
        if (overlaps2 < bestOverlaps2) {
            bestOverlaps2 = overlaps2;
            bestSide2 = { labelX: position2.labelX, labelY: position2.labelY, offset: offset2, bounds: bounds2, overlaps: overlaps2 };
        }
        
        offset2 += offsetIncrement;
        attempts2++;
    }
    
    // Choose the side with fewer overlaps
    // If equal, prefer the preferred side
    let chosen;
    if (bestOverlaps1 < bestOverlaps2) {
        chosen = { ...bestSide1, side: 'side1' };
    } else if (bestOverlaps2 < bestOverlaps1) {
        chosen = { ...bestSide2, side: 'side2' };
    } else {
        // Equal overlaps - use preferred side
        chosen = preferredSide === 'side1' ? { ...bestSide1, side: 'side1' } : { ...bestSide2, side: 'side2' };
    }
    
    return {
        labelX: chosen.labelX,
        labelY: chosen.labelY,
        labelBounds: chosen.bounds,
        offset: chosen.offset,
        attempts: chosen.side === 'side1' ? attempts1 : attempts2,
        side: chosen.side,
        overlaps: chosen.overlaps
    };
}


