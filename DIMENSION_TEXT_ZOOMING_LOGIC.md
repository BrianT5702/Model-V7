# Dimension Text Zooming Logic - Technical Documentation

## Overview
The dimension text zooming system ensures that text remains readable at all zoom levels while scaling appropriately when users zoom in or out. The system uses a **minimum font size** (8px) and **square root scaling** to prevent overly aggressive text growth.

---

## Key Variables

### 1. `scaleFactor` (Current Zoom Level)
- **Type**: `useRef` (mutable reference)
- **Purpose**: Tracks the current zoom level of the canvas
- **Updates**: 
  - Initially set to `optimalScale` (calculated to fit project)
  - Updated when user zooms in/out (multiplied by 1.2 or 0.8)
  - Maximum: 3.0x
  - Minimum: `initialScale` (cannot zoom out below initial fit)

### 2. `initialScale` (Initial Fit Scale)
- **Type**: `useRef` (mutable reference)
- **Purpose**: Stores the scale factor calculated to optimally fit the project on initial load
- **Calculation**:
  ```javascript
  const scaleX = (CANVAS_WIDTH - 4 * PADDING) / totalWidth;
  const scaleY = (CANVAS_HEIGHT - 4 * PADDING) / totalHeight;
  const optimalScale = Math.min(scaleX, scaleY, 2.0);
  initialScale.current = optimalScale;
  ```
- **Never changes** after initial calculation (unless project changes)

### 3. `FONT_SIZE` (Base Multiplier)
- **Value**: `200` (in `DimensionConfig.js`)
- **Purpose**: Base scaling multiplier for dimension text
- **Usage**: `calculatedFontSize = FONT_SIZE * scaleFactor`

### 4. `FONT_SIZE_MIN` (Minimum Font Size)
- **Value**: `8` pixels
- **Purpose**: Ensures text never becomes unreadable, even for very large projects

---

## Font Size Calculation Logic

### Step 1: Calculate Base Font Size
```javascript
const calculatedFontSize = DIMENSION_CONFIG.FONT_SIZE * scaleFactor.current;
// Example: 200 * 0.5 = 100px (for a large project at 0.5x scale)
// Example: 200 * 1.5 = 300px (for a small project at 1.5x scale)
```

### Step 2: Check if Below Minimum
```javascript
if (calculatedFontSize < DIMENSION_CONFIG.FONT_SIZE_MIN) {
    // Text would be too small - apply minimum logic
}
```

### Step 3A: If Below Minimum AND User Has Zoomed In
```javascript
if (initialScale.current > 0 && scaleFactor.current > initialScale.current) {
    // User has zoomed in from initial view
    const zoomRatio = scaleFactor.current / initialScale.current;
    fontSize = DIMENSION_CONFIG.FONT_SIZE_MIN * Math.sqrt(zoomRatio);
}
```

**Example Scenario:**
- Initial scale: `0.3` (large project, text would be 60px, but clamped to 8px)
- User zooms to: `0.6` (2x zoom)
- `zoomRatio = 0.6 / 0.3 = 2.0`
- `fontSize = 8 * √2.0 = 8 * 1.414 = 11.31px`
- **Result**: Text scales from 8px to 11.31px (less aggressive than 2x)

### Step 3B: If Below Minimum AND At Initial Scale (or Zoomed Out)
```javascript
else {
    // At initial scale or zoomed out - ALWAYS use minimum directly (8px)
    fontSize = DIMENSION_CONFIG.FONT_SIZE_MIN;
}
```

**Example Scenario:**
- Initial scale: `0.3` (large project)
- `calculatedFontSize = 200 * 0.3 = 60px` (but this is below minimum threshold)
- **Result**: Uses 8px directly (no scaling)

### Step 4: If Above Minimum
```javascript
else {
    // Use calculated value when above minimum
    fontSize = calculatedFontSize;
}
```

**Example Scenario:**
- Initial scale: `1.5` (small project)
- `calculatedFontSize = 200 * 1.5 = 300px`
- **Result**: Uses 300px (scales proportionally with zoom)

### Step 5: Final Safety Check
```javascript
// CRITICAL: Final safety check - ensure fontSize is NEVER below minimum (8px)
fontSize = Math.max(fontSize, DIMENSION_CONFIG.FONT_SIZE_MIN);
```

---

## Square Root Scaling (Why It's Used)

### Problem: Linear Scaling is Too Aggressive
If we used linear scaling:
- 2x zoom → 2x text size (too dramatic)
- 3x zoom → 3x text size (text becomes huge)

### Solution: Square Root Scaling
Using `Math.sqrt(zoomRatio)`:
- 2x zoom → √2 ≈ 1.41x text size (smoother)
- 3x zoom → √3 ≈ 1.73x text size (more controlled)
- 4x zoom → √4 = 2x text size (still reasonable)

**Formula:**
```javascript
fontSize = FONT_SIZE_MIN * Math.sqrt(scaleFactor / initialScale)
```

---

## Complete Flow Examples

### Example 1: Large Project (Initial Scale < 1)
1. **Initial Load:**
   - Project size: 50000mm × 30000mm
   - `initialScale = 0.02` (fits project in canvas)
   - `scaleFactor = 0.02`
   - `calculatedFontSize = 200 * 0.02 = 4px` (below 8px minimum)
   - **Result**: `fontSize = 8px` (uses minimum)

2. **User Zooms In 2x:**
   - `scaleFactor = 0.04` (2x zoom)
   - `calculatedFontSize = 200 * 0.04 = 8px` (still below minimum threshold)
   - `zoomRatio = 0.04 / 0.02 = 2.0`
   - `fontSize = 8 * √2.0 = 11.31px`
   - **Result**: Text scales from 8px to 11.31px

3. **User Zooms In 4x (from initial):**
   - `scaleFactor = 0.08` (4x zoom)
   - `zoomRatio = 0.08 / 0.02 = 4.0`
   - `fontSize = 8 * √4.0 = 16px`
   - **Result**: Text scales from 8px to 16px

### Example 2: Small Project (Initial Scale > 1)
1. **Initial Load:**
   - Project size: 5000mm × 3000mm
   - `initialScale = 1.5` (project fits with room to spare)
   - `scaleFactor = 1.5`
   - `calculatedFontSize = 200 * 1.5 = 300px` (above 8px minimum)
   - **Result**: `fontSize = 300px` (uses calculated value)

2. **User Zooms In 2x:**
   - `scaleFactor = 3.0` (2x zoom, capped at max)
   - `calculatedFontSize = 200 * 3.0 = 600px` (above 8px minimum)
   - **Result**: `fontSize = 600px` (scales linearly with zoom)

3. **User Zooms Out:**
   - `scaleFactor = 0.75` (zoomed out)
   - `calculatedFontSize = 200 * 0.75 = 150px` (above 8px minimum)
   - **Result**: `fontSize = 150px` (scales linearly)

---

## Implementation Locations

### 1. FloorCanvas.js
- **Location**: `drawDimensionTextBox` function (line ~1077)
- **Uses**: `DIMENSION_CONFIG.FONT_SIZE` and `DIMENSION_CONFIG.FONT_SIZE_MIN`
- **Status**: ✅ Uses config constants

### 2. CeilingCanvas.js
- **Location**: `drawDimensionTextBox` function (line ~1634)
- **Uses**: Hardcoded `200` and `8` (should use config constants)
- **Status**: ⚠️ Uses hardcoded values (inconsistent)

### 3. drawing.js (Wall Plan)
- **Location**: Multiple functions:
  - `drawProjectDimension` (line ~288)
  - `drawDimensions` (line ~495)
  - `drawPanelDivisions` (line ~660, 1592, 1782, 1812)
- **Uses**: Hardcoded `200` and `8`
- **Status**: ⚠️ Uses hardcoded values (inconsistent)

---

## Zoom Functions

### Zoom In
```javascript
const handleZoomIn = () => {
    const newScale = Math.min(3.0, scaleFactor.current * 1.2);
    zoomToCenter(newScale);
};
```
- Multiplies current scale by 1.2 (20% increase)
- Caps at 3.0x maximum
- Updates `scaleFactor.current`

### Zoom Out
```javascript
const handleZoomOut = () => {
    const newScale = Math.max(initialScale.current, scaleFactor.current * 0.8);
    zoomToCenter(newScale);
};
```
- Multiplies current scale by 0.8 (20% decrease)
- Cannot zoom out below `initialScale` (prevents project from being too small)
- Updates `scaleFactor.current`

### Reset Zoom
```javascript
const handleResetZoom = () => {
    isZoomed.current = false;
    setForceRefresh(prev => prev + 1); // Triggers recalculation
};
```
- Resets `isZoomed` flag
- Triggers recalculation which sets `scaleFactor` back to `initialScale`

---

## Key Behaviors

### ✅ What Works Correctly
1. **Minimum Font Size**: Text never goes below 8px
2. **Square Root Scaling**: Text scales less aggressively when zooming from minimum
3. **Proportional Scaling**: When above minimum, text scales linearly with zoom
4. **Initial Scale Tracking**: System remembers the initial fit scale

### ⚠️ Potential Issues
1. **Inconsistent Constants**: `CeilingCanvas.js` and `drawing.js` use hardcoded values instead of `DIMENSION_CONFIG`
2. **Threshold Check**: The check `calculatedFontSize < 8` might need to account for the actual minimum threshold (currently hardcoded in some places)

---

## Recommendations

1. **Standardize Constants**: Update `CeilingCanvas.js` and `drawing.js` to use `DIMENSION_CONFIG.FONT_SIZE` and `DIMENSION_CONFIG.FONT_SIZE_MIN`
2. **Consistent Logic**: Ensure all three canvas types use identical font size calculation logic
3. **Testing**: Test with:
   - Very large projects (initial scale < 0.1)
   - Medium projects (initial scale ≈ 1.0)
   - Small projects (initial scale > 1.5)
   - Various zoom levels (0.5x, 1x, 2x, 3x)

---

## Summary

The dimension text zooming system:
1. **Calculates** base font size from `FONT_SIZE * scaleFactor`
2. **Applies minimum** of 8px when calculated size is too small
3. **Scales from minimum** using square root when user zooms in (less aggressive)
4. **Scales linearly** when above minimum (proportional to zoom)
5. **Ensures readability** with final safety check

This creates a smooth, predictable zooming experience where text remains readable at all zoom levels while scaling appropriately with user interactions.










