# Support Type Analysis: Can Both Types Be Applied Simultaneously?

## Current Implementation Status

### ❌ **NO - Both types cannot be applied at the same time**

## Current Behavior

### 1. **UI Selection (CeilingManager.js)**
- Single dropdown selection: `supportType` can be either `'nylon'` or `'alu'`
- Line 916-923: Radio button-like select dropdown
- Only one option can be selected at a time

### 2. **Rendering Logic (CeilingCanvas.js lines 845-854)**
```javascript
// Draw default supports (nylon hangers only) and custom supports
if (!aluSuspensionCustomDrawing) {
    // Draw default nylon hanger supports
    drawPanelSupports(ctx, roomPanels, scaleFactor.current, offsetX.current, offsetY.current);
}

// Draw custom supports if custom drawing is enabled
if (aluSuspensionCustomDrawing) {
    drawCustomSupports(ctx, effectiveCustomSupports, scaleFactor.current, offsetX.current, offsetY.current);
}
```

**Current Behavior:**
- If `aluSuspensionCustomDrawing` is `false` → Only draws default nylon hanger supports automatically
- If `aluSuspensionCustomDrawing` is `true` → Only draws custom supports (which can be alu suspension)
- **These are mutually exclusive** - when custom drawing is enabled, default nylon supports are NOT drawn

### 3. **Default Nylon Hanger Supports (drawPanelSupports function)**
- Automatically drawn on panels that need support (width/length > 6000mm)
- Only drawn when `supportType === 'nylon'` AND `aluSuspensionCustomDrawing === false`
- Line 2422-2425: Checks `if (supportType === 'nylon')` before drawing

### 4. **Custom Supports (drawCustomSupports function)**
- Manually placed by user (drawing lines)
- Can contain both nylon and alu types (line 2446-2450)
- Only drawn when `aluSuspensionCustomDrawing === true`

## What Would Need to Change to Allow Both Types Simultaneously?

### Option 1: Enable Both as Checkboxes
1. Change UI from dropdown to checkboxes:
   - ☑️ Enable Nylon Hanger Supports
   - ☑️ Enable Alu Suspension Custom Drawing
2. Update rendering logic to draw both:
```javascript
// Draw default nylon hanger supports if enabled
if (supportType === 'nylon' && enableNylonHangers) {
    drawPanelSupports(ctx, roomPanels, scaleFactor.current, offsetX.current, offsetY.current);
}

// Draw custom supports if enabled
if (aluSuspensionCustomDrawing) {
    drawCustomSupports(ctx, effectiveCustomSupports, scaleFactor.current, offsetX.current, offsetY.current);
}
```

### Option 2: Allow Both in Custom Drawing
- Allow users to place both nylon and alu supports in custom drawing mode
- Keep the current logic but add a toggle in custom drawing mode to switch between placing nylon vs alu supports

### Option 3: Mixed Mode
- Default nylon hangers for automatic placement
- Additional alu suspension for custom placement
- Both render simultaneously

## Recommendation

**Option 3 (Mixed Mode)** seems most practical:
- Keep automatic nylon hanger supports for panels that need them
- Allow additional custom alu suspension to be placed manually
- Both types can coexist on different panels

## Files That Would Need Changes

1. **CeilingManager.js**:
   - Change support type selection UI
   - Update state management to allow both types

2. **CeilingCanvas.js**:
   - Update rendering logic (lines 845-854)
   - Ensure both types can be drawn simultaneously

3. **Backend (support_config)**:
   - Already supports JSON structure, so can store both types








