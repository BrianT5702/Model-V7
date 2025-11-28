// Shared configuration for dimension placement across floor and ceiling plans
// This ensures consistent spacing and appearance

export const DIMENSION_CONFIG = {
    // Spacing and positioning
    BASE_OFFSET: 15,              // Base distance from model boundary (px) - for large dimensions
    BASE_OFFSET_SMALL: 5,         // Base distance for small dimensions (px) - place near wall
    PROJECT_BASE_OFFSET: 35,      // Base distance for project dimensions (px) - outermost layer
    OFFSET_INCREMENT: 20,         // Increment when overlap detected (px)
    PROJECT_OFFSET_INCREMENT: 30, // Increment for project dimensions (px) - more aggressive
    MIN_VERTICAL_OFFSET: 30,      // Minimum offset for vertical dimensions (px)
    MIN_VERTICAL_OFFSET_SMALL: 10, // Minimum offset for small vertical dimensions (px)
    PROJECT_MIN_VERTICAL_OFFSET: 50, // Minimum offset for project vertical dimensions (px)
    MAX_ATTEMPTS: 10,             // Maximum collision resolution attempts
    PROJECT_MAX_ATTEMPTS: 15,     // Maximum attempts for project dimensions
    SMALL_DIMENSION_THRESHOLD: 0.15, // Dimension is "small" if < 5% of project size
    
    // Appearance - Dimensions
    FONT_SIZE: 200,               // Dimension text scaling multiplier - matches wall plan
    FONT_SIZE_MIN: 8,             // Minimum font size when scaled down
    FONT_FAMILY: "'Segoe UI', Arial, sans-serif",  // Modern font with fallbacks
    FONT_WEIGHT: 'normal',          // Font weight for dimensions
    LINE_WIDTH: 1,              // Extension line width (px)
    DIMENSION_LINE_WIDTH: 1,      // Main dimension line width (px)
    EXTENSION_DASH: [5, 5],       // Dash pattern for extension lines
    BACKGROUND_OPACITY: 1,     // Text background opacity
    LABEL_PADDING_H: 8,           // Horizontal label padding (px)
    LABEL_PADDING_V: 8,           // Vertical label padding (px)
    LABEL_BORDER_WIDTH: 1,        // Label border width (px)
    
    // Appearance - General Drawing
    GRID_LINE_WIDTH: 1,           // Grid line width
    GRID_LINE_WIDTH_ACTIVE: 0.9,  // Grid line width when drawing
    WALL_LINE_WIDTH: 1,           // Wall line width
    WALL_CAP_LINE_WIDTH: 1,     // Wall cap line width
    PARTITION_LINE_WIDTH: 1,    // Partition slash line width
    ROOM_PREVIEW_LINE_WIDTH: 2,   // Room preview line width
    ROOM_PREVIEW_DASH: [3, 5],    // Room preview dash pattern
    ENDPOINT_SIZE: 2,             // Normal endpoint circle size
    ENDPOINT_SIZE_HOVER: 3,       // Hovered endpoint circle size
    
    // Colors for different dimension types
    COLORS: {
        WALL: '#2196F3',          // Blue for wall dimensions (2D/wall plan)
        PANEL: '#FF6B35',         // Orange for panel dimensions (2D/wall plan)
        PROJECT: '#8B5CF6',       // Purple for overall project dimensions
        ROOM: '#1e40af',          // Dark blue for room dimensions (ceiling/floor plan)
        PANEL_GROUP: '#6b7280',   // GREY for panel dimensions - matches legend! (ceiling/floor plan)
        CUT_PANEL: '#dc2626',     // Red for cut panel dimensions (ceiling/floor plan)
        SELECTED: 'red',          // Red for selected elements
        GRID: '#ddd',             // Grid color (inactive)
        GRID_ACTIVE: '#a0a0a0',   // Grid color (active/drawing)
        ROOM_PREVIEW: 'rgba(0, 123, 255, 0.8)',      // Room preview outline
        ROOM_PREVIEW_FILL: 'rgba(0, 123, 255, 0.2)', // Room preview fill
        ENDPOINT: 'blue',         // Endpoint color
        ENDPOINT_HOVER: '#FF5722', // Hovered endpoint color
        PARTITION: '#666'         // Partition slash color
    },
    
    // Priority levels (lower number = higher priority, drawn first)
    PRIORITY: {
        PROJECT: 0,               // Highest - Overall project dimensions
        ROOM: 1,                  // Room dimensions
        WALL: 2,                  // Wall dimensions
        PANEL_GROUP: 3,           // Grouped panel dimensions
        PANEL: 4,                 // Individual panel dimensions
        CUT_PANEL: 5              // Lowest - Cut panel dimensions
    }
};

