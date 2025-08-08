// Dimension filtering utility to avoid showing duplicate dimensions
// for identical walls and panels

/**
 * Creates a unique key for a wall based on its dimensions, joint types, and level
 */
export function createWallKey(wall, jointTypes) {
    const length = Math.sqrt(
        Math.pow(wall.end_x - wall.start_x, 2) + 
        Math.pow(wall.end_y - wall.start_y, 2)
    );
    
    // Round to nearest mm to handle floating point precision issues
    const roundedLength = Math.round(length);
    const roundedThickness = Math.round(wall.thickness);
    
    // Determine if wall is vertical or horizontal and get level coordinates
    const isVertical = Math.abs(wall.end_x - wall.start_x) < Math.abs(wall.end_y - wall.start_y);
    
    let levelKey;
    if (isVertical) {
        // For vertical walls, use Y coordinates (level)
        const startY = Math.round(wall.start_y);
        const endY = Math.round(wall.end_y);
        levelKey = `V-${startY}-${endY}`;
    } else {
        // For horizontal walls, use X coordinates (level)
        const startX = Math.round(wall.start_x);
        const endX = Math.round(wall.end_x);
        levelKey = `H-${startX}-${endX}`;
    }
    
    // Create a key that includes length, thickness, joint types, and level
    return `${roundedLength}-${roundedThickness}-${jointTypes.left}-${jointTypes.right}-${levelKey}`;
}

/**
 * Creates a unique key for a panel based on its dimensions, type, and wall level
 */
export function createPanelKey(panel, wallThickness, wall) {
    const roundedWidth = Math.round(panel.width);
    const roundedThickness = Math.round(wallThickness);
    
    // Determine wall level (same logic as wall key)
    const isVertical = Math.abs(wall.end_x - wall.start_x) < Math.abs(wall.end_y - wall.start_y);
    
    let levelKey;
    if (isVertical) {
        const startY = Math.round(wall.start_y);
        const endY = Math.round(wall.end_y);
        levelKey = `V-${startY}-${endY}`;
    } else {
        const startX = Math.round(wall.start_x);
        const endX = Math.round(wall.end_x);
        levelKey = `H-${startX}-${endX}`;
    }
    
    return `${roundedWidth}-${roundedThickness}-${panel.type}-${levelKey}`;
}

/**
 * Filters dimensions to show only unique ones
 * @param {Array} walls - Array of wall objects
 * @param {Array} intersections - Array of intersection objects
 * @param {Object} wallPanelsMap - Map of wall ID to panels array
 * @returns {Object} - Object with filtered dimensions
 */
export function filterDimensions(walls, intersections, wallPanelsMap) {
    const wallDimensionMap = new Map(); // wallKey -> { wall, jointTypes, shouldShow }
    const panelDimensionMap = new Map(); // panelKey -> { panel, wallThickness, shouldShow }
    
    // Process walls
    walls.forEach(wall => {
        // Get joint types for this wall
        const jointTypes = getWallJointTypes(wall, intersections, walls);
        const wallKey = createWallKey(wall, jointTypes);
        
        if (!wallDimensionMap.has(wallKey)) {
            // First occurrence - should show dimension
            wallDimensionMap.set(wallKey, {
                wall,
                jointTypes,
                shouldShow: true,
                occurrences: [wall.id],
                firstWallId: wall.id
            });
        } else {
            // Duplicate - add to occurrences
            const existing = wallDimensionMap.get(wallKey);
            existing.occurrences.push(wall.id);
        }
    });
    
    // Process panels
    Object.entries(wallPanelsMap).forEach(([wallId, panels]) => {
        const wall = walls.find(w => w.id === parseInt(wallId));
        if (!wall) return;
        
        panels.forEach(panel => {
            const panelKey = createPanelKey(panel, wall.thickness, wall);
            
            if (!panelDimensionMap.has(panelKey)) {
                // First occurrence - should show dimension
                panelDimensionMap.set(panelKey, {
                    panel,
                    wallThickness: wall.thickness,
                    shouldShow: true,
                    occurrences: [{ wallId: parseInt(wallId), panel }],
                    firstWallId: parseInt(wallId)
                });
            } else {
                // Duplicate - add to occurrences
                const existing = panelDimensionMap.get(panelKey);
                existing.occurrences.push({ wallId: parseInt(wallId), panel });
            }
        });
    });
    
    return {
        wallDimensions: wallDimensionMap,
        panelDimensions: panelDimensionMap
    };
}

/**
 * Helper function to get joint types for a wall
 */
function getWallJointTypes(wall, intersections, walls) {
    const leftEndIntersections = [];
    const rightEndIntersections = [];
    
    intersections.forEach(inter => {
        // Check if this intersection involves our wall
        const wall1 = inter.wall_1;
        const wall2 = inter.wall_2;
        
        if (wall1 === wall.id || wall2 === wall.id) {
            // Determine which end of our wall this intersection is at
            const otherWallId = wall1 === wall.id ? wall2 : wall1;
            const otherWall = walls.find(w => w.id === otherWallId);
            
            if (otherWall) {
                // Check if intersection is at start or end of our wall
                const tolerance = 1; // 1mm tolerance
                const isAtStart = (Math.abs(inter.x - wall.start_x) < tolerance && 
                                 Math.abs(inter.y - wall.start_y) < tolerance);
                const isAtEnd = (Math.abs(inter.x - wall.end_x) < tolerance && 
                               Math.abs(inter.y - wall.end_y) < tolerance);
                
                if (isAtStart) {
                    leftEndIntersections.push(inter.joining_method);
                } else if (isAtEnd) {
                    rightEndIntersections.push(inter.joining_method);
                }
            }
        }
    });
    
    const leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
    const rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
    
    return { left: leftJointType, right: rightJointType };
}

/**
 * Checks if a wall should show its dimension
 */
export function shouldShowWallDimension(wall, intersections, wallDimensions, walls) {
    const jointTypes = getWallJointTypes(wall, intersections, walls);
    const wallKey = createWallKey(wall, jointTypes);
    const dimensionInfo = wallDimensions.get(wallKey);
    
    if (!dimensionInfo) return true;
    
    // Only show dimension for the first occurrence of this unique wall type
    return dimensionInfo.firstWallId === wall.id;
}

/**
 * Checks if a panel should show its dimension
 */
export function shouldShowPanelDimension(panel, wallThickness, panelDimensions, wallId, wall) {
    const panelKey = createPanelKey(panel, wallThickness, wall);
    const dimensionInfo = panelDimensions.get(panelKey);
    
    if (!dimensionInfo) return true;
    
    // Only show dimension for the first occurrence of this unique panel type across identical walls
    return dimensionInfo.firstWallId === wallId;
}
