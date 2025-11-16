# Initial Scale Calculation - Technical Documentation

## Overview
The initial scale (`initialScale`) is calculated to optimally fit the project (walls/rooms) within the canvas viewport. This scale is used as a reference point for dimension text zooming and prevents zooming out beyond the initial fit.

---

## Calculation Process

### Step 1: Calculate Project Bounds

#### **Wall Plan (Canvas2D.js)**
```javascript
// Find bounding box of all wall endpoints
const minX = Math.min(...walls.map((wall) => Math.min(wall.start_x, wall.end_x)), 0);
const maxX = Math.max(...walls.map((wall) => Math.max(wall.start_x, wall.end_x)), 0);
const minY = Math.min(...walls.map((wall) => Math.min(wall.start_y, wall.end_y)), 0);
const maxY = Math.max(...walls.map((wall) => Math.max(wall.start_y, wall.end_y)), 0);

const wallWidth = maxX - minX || 1;
const wallHeight = maxY - minY || 1;
```

#### **Floor Plan (FloorCanvas.js)**
```javascript
// Calculate bounds for all rooms combined
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

rooms.forEach(room => {
    if (room.room_points && room.room_points.length > 0) {
        const xCoords = room.room_points.map(p => p.x);
        const yCoords = room.room_points.map(p => p.y);
        
        const roomMinX = Math.min(...xCoords);
        const roomMaxX = Math.max(...xCoords);
        const roomMinY = Math.min(...yCoords);
        const roomMaxY = Math.max(...yCoords);
        
        minX = Math.min(minX, roomMinX);
        maxX = Math.max(maxX, roomMaxX);
        minY = Math.min(minY, roomMinY);
        maxY = Math.max(maxY, roomMaxY);
    }
});

const totalWidth = maxX - minX || 1;
const totalHeight = maxY - minY || 1;
```

#### **Ceiling Plan (CeilingCanvas.js)**
```javascript
// Same approach as Floor Plan - calculates bounds from room_points
const totalWidth = maxX - minX || 1;
const totalHeight = maxY - minY || 1;
```

---

### Step 2: Calculate Scale for Each Dimension

#### **Wall Plan (Canvas2D.js)**
```javascript
const padding = 50;
const sf = Math.min(
    (canvas.width - 4 * padding) / wallWidth,
    (canvas.height - 4 * padding) / wallHeight
);
```

**Formula:**
- `scaleX = (canvas.width - 4 * padding) / wallWidth`
- `scaleY = (canvas.height - 4 * padding) / wallHeight`
- `initialScale = Math.min(scaleX, scaleY)`

**Example:**
- Canvas: 1000px × 600px
- Padding: 50px (applied 4 times = 200px total)
- Wall Width: 50000mm, Wall Height: 30000mm
- `scaleX = (1000 - 200) / 50000 = 0.016`
- `scaleY = (600 - 200) / 30000 = 0.0133`
- `initialScale = Math.min(0.016, 0.0133) = 0.0133`

#### **Floor Plan & Ceiling Plan**
```javascript
const PADDING = 50;
const scaleX = (CANVAS_WIDTH - 4 * PADDING) / totalWidth;
const scaleY = (CANVAS_HEIGHT - 4 * PADDING) / totalHeight;
const optimalScale = Math.min(scaleX, scaleY, 2.0); // Cap at 2x zoom
```

**Formula:**
- `scaleX = (CANVAS_WIDTH - 4 * PADDING) / totalWidth`
- `scaleY = (CANVAS_HEIGHT - 4 * PADDING) / totalHeight`
- `initialScale = Math.min(scaleX, scaleY, 2.0)` ← **Capped at 2.0**

**Key Difference:**
- Floor/Ceiling plans cap the scale at **2.0** (prevents zooming in too much initially)
- Wall plan has **no cap** (can be any value)

---

### Step 3: Store Initial Scale

```javascript
// Wall Plan
initialScale.current = sf; // Always store the initial scale

// Floor Plan & Ceiling Plan
initialScale.current = optimalScale; // Always store the initial scale
```

**Important:** `initialScale` is **always** updated, even if the user has manually zoomed. This ensures it always reflects the optimal fit scale.

---

## Constants Used

### Canvas Dimensions
- **Wall Plan:** `canvas.width = 1000`, `canvas.height = 600`
- **Floor/Ceiling Plan:** `CANVAS_WIDTH = 1000`, `CANVAS_HEIGHT = 600` (default, can be responsive)

### Padding
- **Wall Plan:** `padding = 50` (hardcoded)
- **Floor/Ceiling Plan:** `PADDING = 50` (constant)

**Padding Application:**
- `4 * padding` = 200px total padding
- Applied as: `(canvasSize - 200) / projectSize`
- This leaves 50px margin on each side (top, bottom, left, right)

---

## Why Math.min()?

The `Math.min(scaleX, scaleY)` ensures the project fits within **both** dimensions:

- If `scaleX < scaleY`: Project is wider → use X scale (fits width, height has extra space)
- If `scaleY < scaleX`: Project is taller → use Y scale (fits height, width has extra space)
- If equal: Project is square → both scales work

**Example:**
- Project: 50000mm × 30000mm (wide rectangle)
- Canvas: 1000px × 600px
- `scaleX = 0.016` (fits width)
- `scaleY = 0.0133` (fits height)
- Use `0.0133` → fits height, width has extra space (better than cutting off)

---

## Scale Cap (Floor/Ceiling Only)

```javascript
const optimalScale = Math.min(scaleX, scaleY, 2.0); // Cap at 2x zoom
```

**Purpose:** Prevents the initial view from being too zoomed in for small projects.

**Example:**
- Small project: 2000mm × 1500mm
- `scaleX = (1000 - 200) / 2000 = 0.4`
- `scaleY = (600 - 200) / 1500 = 0.267`
- Without cap: `initialScale = 0.267` (very zoomed in)
- With cap: `initialScale = Math.min(0.267, 2.0) = 0.267` (still uses calculated value)
- But if calculated was `3.0`: `initialScale = Math.min(3.0, 2.0) = 2.0` (capped)

---

## When Initial Scale is Updated

### Always Updated:
- When project bounds change (walls/rooms added/removed)
- When canvas size changes
- On every render (but only affects `scaleFactor` if user hasn't zoomed)

### Only Affects `scaleFactor` if:
```javascript
if (!isZoomed.current) {
    scaleFactor.current = optimalScale; // Update current scale
}
initialScale.current = optimalScale; // Always update initial scale
```

**Logic:**
- If user hasn't manually zoomed → `scaleFactor` = `initialScale` (auto-fit)
- If user has manually zoomed → `scaleFactor` stays at user's zoom level
- `initialScale` is **always** updated (used as reference for dimension text)

---

## Usage in Dimension Text Zooming

The `initialScale` is used to:
1. **Determine if text should use minimum font size:**
   ```javascript
   if (calculatedFontSize < FONT_SIZE_MIN) {
       // Use minimum logic
   }
   ```

2. **Calculate zoom ratio for square root scaling:**
   ```javascript
   const zoomRatio = scaleFactor.current / initialScale.current;
   fontSize = FONT_SIZE_MIN * Math.sqrt(zoomRatio);
   ```

3. **Prevent zooming out below initial fit:**
   ```javascript
   const newScale = Math.max(initialScale.current, scaleFactor.current * 0.8);
   ```

---

## Summary

### Calculation Formula:
```
initialScale = Math.min(
    (canvasWidth - 4 * padding) / projectWidth,
    (canvasHeight - 4 * padding) / projectHeight,
    2.0  // Only for Floor/Ceiling plans
)
```

### Key Points:
1. **Calculated from project bounds** (walls or rooms)
2. **Uses Math.min()** to ensure fit in both dimensions
3. **Always stored** (even if user has zoomed)
4. **Used as reference** for dimension text scaling
5. **Floor/Ceiling plans cap at 2.0** to prevent over-zooming
6. **Padding of 50px** on each side (200px total removed from canvas size)

### Example Values:
- **Large Project (50000mm × 30000mm):** `initialScale ≈ 0.013`
- **Medium Project (10000mm × 8000mm):** `initialScale ≈ 0.08`
- **Small Project (2000mm × 1500mm):** `initialScale ≈ 0.27` (or capped at 2.0 if calculated higher)

---

## Files Involved

1. **Canvas2D.js** (Wall Plan) - Lines 1720-1740
2. **FloorCanvas.js** (Floor Plan) - Lines 255-298
3. **CeilingCanvas.js** (Ceiling Plan) - Lines 344-388

All three use the same calculation approach, with Floor/Ceiling having the 2.0 cap.










