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


