// Collision detection utilities for dimension labels
// Shared across wall plan, floor plan, and ceiling plan

import { DIMENSION_CONFIG } from './DimensionConfig.js';

/**
 * Check if two bounding boxes overlap using Axis-Aligned Bounding Box (AABB) algorithm
 * Enhanced with minimum separation distance for better spacing
 * @param {Object} box1 - First bounding box {x, y, width, height}
 * @param {Object} box2 - Second bounding box {x, y, width, height}
 * @param {number} minSeparation - Minimum separation distance in pixels (default: 0)
 * @returns {boolean} - True if boxes overlap or are too close, false otherwise
 */
export function checkBoxOverlap(box1, box2, minSeparation = 0) {
    // Two boxes DON'T overlap (with separation) if any of these conditions are true:
    // - box1 is completely to the left of box2 (with separation)
    // - box1 is completely to the right of box2 (with separation)
    // - box1 is completely above box2 (with separation)
    // - box1 is completely below box2 (with separation)
    
    // Apply separation margin to both boxes
    const margin = minSeparation / 2;
    
    const noOverlap = (
        box1.x + box1.width + margin < box2.x - margin ||      // box1 is left of box2 (with separation)
        box2.x + box2.width + margin < box1.x - margin ||      // box1 is right of box2 (with separation)
        box1.y + box1.height + margin < box2.y - margin ||     // box1 is above box2 (with separation)
        box2.y + box2.height + margin < box1.y - margin        // box1 is below box2 (with separation)
    );
    
    return !noOverlap; // If not separated, they overlap or are too close
}

/**
 * Check if a label bounding box overlaps with any existing labels
 * Enhanced with minimum separation and spatial optimization
 * @param {Object} labelBounds - The new label bounds {x, y, width, height}
 * @param {Array} placedLabels - Array of already placed label bounds
 * @param {number} minSeparation - Minimum separation distance in pixels (default: 3)
 * @returns {boolean} - True if overlap detected, false otherwise
 */
/** True when a label can be drawn without overlapping existing labels. */
export function isLabelPlacementClean(labelBounds, placedLabels, minSeparation = DIMENSION_CONFIG.LABEL_MIN_SEPARATION) {
    if (!labelBounds || !placedLabels?.length) return true;
    return !hasLabelOverlap(labelBounds, placedLabels, minSeparation);
}

export function hasLabelOverlap(labelBounds, placedLabels, minSeparation = 3) {
    // Quick spatial optimization: only check labels that are potentially close
    // Calculate approximate distance to filter out obviously far labels
    const labelCenterX = labelBounds.x + labelBounds.width / 2;
    const labelCenterY = labelBounds.y + labelBounds.height / 2;
    const maxDistance = Math.max(labelBounds.width, labelBounds.height) + minSeparation * 2;
    
    // Filter labels that are potentially close (simple distance check)
    const nearbyLabels = placedLabels.filter(existing => {
        const existingCenterX = existing.x + existing.width / 2;
        const existingCenterY = existing.y + existing.height / 2;
        const distanceX = Math.abs(labelCenterX - existingCenterX);
        const distanceY = Math.abs(labelCenterY - existingCenterY);
        const maxDim = Math.max(existing.width, existing.height);
        // Only check if within reasonable distance
        return distanceX < maxDistance + maxDim && distanceY < maxDistance + maxDim;
    });
    
    // Check overlap with nearby labels only
    return nearbyLabels.some(existing => checkBoxOverlap(labelBounds, existing, minSeparation));
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
 * Screen AABB for dimension text drawn with rotate(-90°) at (labelX, labelY).
 * calculateVerticalLabelBounds is pre-rotation layout and misses wall overlap.
 */
export function calculateRotatedVerticalDimBounds(labelX, labelY, textWidth, fontSize, pad = 2) {
    const tw = textWidth + pad * 2;
    const th = Math.max(fontSize * 0.75, 8) + pad * 2;
    return {
        x: labelX - tw / 2,
        y: labelY - th / 2,
        width: tw,
        height: th
    };
}

/** Exterior vertical dim text extent (rotated label is tall along Y). */
export function exteriorVerticalLabelBounds(
    labelX,
    labelY,
    textWidth,
    fontSize = null,
    paddingH = 2,
    paddingV = 8
) {
    const axis = calculateVerticalLabelBounds(labelX, labelY, textWidth, paddingH, paddingV);
    if (!Number.isFinite(fontSize)) return axis;
    const rot = calculateRotatedVerticalDimBounds(labelX, labelY, textWidth, fontSize, paddingH);
    const x = Math.min(axis.x, rot.x);
    const y = Math.min(axis.y, rot.y);
    const r = Math.max(axis.x + axis.width, rot.x + rot.width);
    const b = Math.max(axis.y + axis.height, rot.y + rot.height);
    return { x, y, width: r - x, height: b - y };
}

/** Screen AABB for horizontal dimension text centered at (labelX, labelY). */
export function calculateNearWallHorizontalDimBounds(labelX, labelY, textWidth, fontSize, padH = 2, padV = 4) {
    const th = Math.max(fontSize * 0.75, 8) + padV * 2;
    return {
        x: labelX - textWidth / 2 - padH,
        y: labelY - th / 2,
        width: textWidth + padH * 2,
        height: th
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
        
        // Check for overlaps with minimum separation
        const hasOverlap = hasLabelOverlap(labelBounds, placedLabels, 3);
        
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
 * Calculate the overlap area between two bounding boxes
 * @param {Object} box1 - First bounding box {x, y, width, height}
 * @param {Object} box2 - Second bounding box {x, y, width, height}
 * @returns {number} - Overlap area in pixels (0 if no overlap)
 */
export function calculateOverlapArea(box1, box2) {
    const overlapX = Math.max(0, Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x));
    const overlapY = Math.max(0, Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y));
    return overlapX * overlapY;
}

/**
 * Calculate the total overlap area for a label with all existing labels
 * @param {Object} labelBounds - The label bounds to check {x, y, width, height}
 * @param {Array} placedLabels - Array of existing label bounds
 * @returns {number} - Total overlap area in pixels
 */
export function calculateTotalOverlapArea(labelBounds, placedLabels) {
    let totalOverlap = 0;
    const labelCenterX = labelBounds.x + labelBounds.width / 2;
    const labelCenterY = labelBounds.y + labelBounds.height / 2;
    const maxDistance = Math.max(labelBounds.width, labelBounds.height) * 2;
    
    // Only check nearby labels for performance
    const nearbyLabels = placedLabels.filter(existing => {
        const existingCenterX = existing.x + existing.width / 2;
        const existingCenterY = existing.y + existing.height / 2;
        const distance = Math.hypot(labelCenterX - existingCenterX, labelCenterY - existingCenterY);
        return distance < maxDistance;
    });
    
    nearbyLabels.forEach(existing => {
        if (checkBoxOverlap(labelBounds, existing, 0)) {
            totalOverlap += calculateOverlapArea(labelBounds, existing);
        }
    });
    
    return totalOverlap;
}

/**
 * Debug function to log collision detection info
 * @param {Object} labelBounds - The label being placed
 * @param {Array} placedLabels - Existing labels
 * @param {boolean} hadCollision - Whether collision was detected
 */
export function debugCollision(labelBounds, placedLabels, hadCollision) {
    if (hadCollision) {
        const overlapping = placedLabels.filter(existing => checkBoxOverlap(labelBounds, existing, 0));
        console.warn('⚠️ Collision detected:', {
            newLabel: labelBounds,
            existingLabels: placedLabels,
            overlappingWith: overlapping,
            overlapArea: calculateTotalOverlapArea(labelBounds, placedLabels)
        });
    }
}

/**
 * Count the number of overlapping labels for a given label bounds
 * Enhanced with minimum separation
 * @param {Object} labelBounds - The label bounds to check {x, y, width, height}
 * @param {Array} placedLabels - Array of existing label bounds
 * @param {number} minSeparation - Minimum separation distance in pixels (default: 3)
 * @returns {number} - Number of overlapping labels
 */
export function countOverlaps(labelBounds, placedLabels, minSeparation = 3) {
    // Use spatial optimization for better performance
    const labelCenterX = labelBounds.x + labelBounds.width / 2;
    const labelCenterY = labelBounds.y + labelBounds.height / 2;
    const maxDistance = Math.max(labelBounds.width, labelBounds.height) + minSeparation * 2;
    
    const nearbyLabels = placedLabels.filter(existing => {
        const existingCenterX = existing.x + existing.width / 2;
        const existingCenterY = existing.y + existing.height / 2;
        const distanceX = Math.abs(labelCenterX - existingCenterX);
        const distanceY = Math.abs(labelCenterY - existingCenterY);
        const maxDim = Math.max(existing.width, existing.height);
        return distanceX < maxDistance + maxDim && distanceY < maxDistance + maxDim;
    });
    
    return nearbyLabels.filter(existing => checkBoxOverlap(labelBounds, existing, minSeparation)).length;
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
    const labelGap = DIMENSION_CONFIG.LABEL_MIN_SEPARATION;
    // If side is locked, use it directly without evaluating both sides
    if (lockedSide === 'side1' || lockedSide === 'side2') {
        const calculatePosition = lockedSide === 'side1' ? calculatePositionSide1 : calculatePositionSide2;
        let offset = baseOffset;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            const position = calculatePosition(offset);
            const bounds = calculateBounds(position.labelX, position.labelY, textWidth);
            const overlaps = countOverlaps(bounds, placedLabels, labelGap);
            
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
            overlaps: countOverlaps(finalBounds, placedLabels, labelGap)
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
        const overlaps1 = countOverlaps(bounds1, placedLabels, labelGap);
        
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
        const overlaps2 = countOverlaps(bounds2, placedLabels, labelGap);
        
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
    // If equal overlaps, consider overlap area for better decision
    // If still equal, prefer the preferred side
    let chosen;
    if (bestOverlaps1 < bestOverlaps2) {
        chosen = { ...bestSide1, side: 'side1' };
    } else if (bestOverlaps2 < bestOverlaps1) {
        chosen = { ...bestSide2, side: 'side2' };
    } else {
        // Equal overlap count - compare overlap area for better decision
        const overlapArea1 = bestSide1 ? calculateTotalOverlapArea(bestSide1.bounds, placedLabels) : Infinity;
        const overlapArea2 = bestSide2 ? calculateTotalOverlapArea(bestSide2.bounds, placedLabels) : Infinity;
        
        if (overlapArea1 < overlapArea2) {
            chosen = { ...bestSide1, side: 'side1' };
        } else if (overlapArea2 < overlapArea1) {
            chosen = { ...bestSide2, side: 'side2' };
        } else {
            // Equal overlaps and area - use preferred side
        chosen = preferredSide === 'side1' ? { ...bestSide1, side: 'side1' } : { ...bestSide2, side: 'side2' };
        }
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

/** Pick top/left vs bottom/right without bumping row offset. */
export function pickExteriorDimensionSide({
    side1Bounds,
    side2Bounds,
    placedLabels,
    preferredSide = 'side1',
    lockedSide = null
}) {
    if (lockedSide === 'side1' || lockedSide === 'side2') return lockedSide;
    const gap = DIMENSION_CONFIG.LABEL_MIN_SEPARATION;
    const c1 = countOverlaps(side1Bounds, placedLabels, gap);
    const c2 = countOverlaps(side2Bounds, placedLabels, gap);
    if (c1 < c2) return 'side1';
    if (c2 < c1) return 'side2';
    return preferredSide;
}

/**
 * Place label on a fixed exterior row; slide along the measured span before adding a new row.
 */
export function tryPlaceExteriorDimensionLabel({
    isHorizontal,
    side,
    rowOffsetPx,
    spanLo,
    spanHi,
    anchorX,
    anchorY,
    bounds,
    scaleFactor,
    offsetX,
    offsetY,
    textWidth,
    paddingH = 4,
    paddingV = 6,
    placedLabels,
    minSeparation = DIMENSION_CONFIG.LABEL_MIN_SEPARATION,
    fixedLabelX = null,
    fontSize = null,
    yBiasPx = 0
}) {
    if (!bounds || !Number.isFinite(spanLo) || !Number.isFinite(spanHi)) return null;
    const sf = scaleFactor;
    const ox = offsetX;
    const oy = offsetY;
    const { minX, maxX, minY, maxY } = bounds;
    const sep = minSeparation;

    const buildCandidates = () => {
        const out = [];
        if (isHorizontal) {
            const y =
                side === 'side1'
                    ? minY * sf + oy - rowOffsetPx
                    : maxY * sf + oy + rowOffsetPx;
            const xCenter = anchorX * sf + ox;
            const xLo = spanLo * sf + ox;
            const xHi = spanHi * sf + ox;
            const halfW = textWidth / 2 + paddingH;
            const usable = Math.max(0, xHi - xLo - 2 * halfW);
            const step = Math.max(6, Math.min(halfW, usable / 6 || halfW));
            out.push(xCenter);
            for (let d = step; d <= usable / 2 + step; d += step) {
                out.push(xCenter + d, xCenter - d);
            }
            const clamped = [];
            for (const x of out) {
                const cx = Math.max(xLo + halfW, Math.min(xHi - halfW, x));
                if (!clamped.some((p) => Math.abs(p - cx) < 2)) clamped.push(cx);
            }
            return clamped.map((labelX) => ({ labelX, labelY: y }));
        }
        const x =
            fixedLabelX != null && Number.isFinite(fixedLabelX)
                ? fixedLabelX
                : side === 'side1'
                    ? minX * sf + ox - rowOffsetPx
                    : maxX * sf + ox + rowOffsetPx;
        const yCenter = anchorY * sf + oy + yBiasPx;
        const yLo = spanLo * sf + oy;
        const yHi = spanHi * sf + oy;
        const halfH = textWidth / 2 + paddingV;
        const usable = Math.max(0, yHi - yLo - 2 * halfH);
        const step = Math.max(4, Math.min(halfH / 2, usable / 12 || halfH / 2));
        const yEndLo = yLo + halfH;
        const yEndHi = yHi - halfH;
        const ys = [yEndLo, yEndHi, yCenter];
        for (let d = step; d <= usable / 2 + step; d += step) {
            ys.push(yCenter + d, yCenter - d);
        }
        const clamped = [];
        for (const y of ys) {
            const cy = Math.max(yEndLo, Math.min(yEndHi, y));
            if (!clamped.some((p) => Math.abs(p - cy) < 2)) clamped.push(cy);
        }
        return clamped.map((labelY) => ({ labelX: x, labelY }));
    };

    const candidates = buildCandidates();
    for (const { labelX, labelY } of candidates) {
        const labelBounds = isHorizontal
            ? calculateHorizontalLabelBounds(labelX, labelY, textWidth, paddingH, paddingV)
            : exteriorVerticalLabelBounds(labelX, labelY, textWidth, fontSize, paddingH, paddingV);
        if (!hasLabelOverlap(labelBounds, placedLabels, sep)) {
            return { labelX, labelY, labelBounds, offset: rowOffsetPx, side };
        }
    }
    return null;
}


