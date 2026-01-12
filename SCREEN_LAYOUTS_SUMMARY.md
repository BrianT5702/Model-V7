# Screen Layout Summary - Ceiling Plan, Floor Plan, and Wall Plan

## Overview
This document describes the screen layout structure for the three main plan views: **Ceiling Plan**, **Floor Plan**, and **Wall Plan**.

---

## 1. WALL PLAN (Canvas2D.js)

### Main Container Structure
- **Location**: `frontend/src/features/canvas/Canvas2D.js`
- **Wrapper Class**: `wall-canvas-container` (white background, rounded, shadow, padding)

### Layout Components

#### A. Header Section
```
┌─────────────────────────────────────────┐
│ Wall Plan                               │
│ Professional Layout                     │
└─────────────────────────────────────────┘
```
- Title: "Wall Plan" (2xl, bold)
- Subtitle: "Professional Layout" (gray-600, lg)

#### B. Main Canvas Area
```
┌─────────────────────────────────────────┐
│  Canvas Container (flex-1)              │
│  ┌───────────────────────────────────┐  │
│  │  [Zoom Controls: Top-Right]       │  │
│  │  ┌───┐                            │  │
│  │  │ + │ Zoom In                    │  │
│  │  │ - │ Zoom Out                   │  │
│  │  │ ⟳ │ Reset Zoom                 │  │
│  │  └───┘                            │  │
│  │                                   │  │
│  │  [Canvas Drawing Area]            │  │
│  │  - Walls                          │  │
│  │  - Rooms                          │  │
│  │  - Dimensions                     │  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
│  Scale: 1.00x                           │
│  Click and drag to navigate            │
└─────────────────────────────────────────┘
```
- Canvas: White border, rounded, shadow
- Zoom controls: Absolute positioned, top-right corner
- Scale indicator below canvas

#### C. Details Panel Sidebar (Optional/Collapsible)
```
┌──────────────────┐
│ Plan Details     │ [Collapse]
├──────────────────┤
│ [Wall Finish     │
│  Legend]         │
│                  │
│ [Manual Wall     │
│  Split Section]  │
│                  │
│ [Other details]  │
└──────────────────┘
```
- Width: 320px (w-80)
- Background: Gradient gray-50 to gray-100
- Border, rounded, shadow
- Shows when `isDetailsPanelOpen` is true

---

## 2. CEILING PLAN (CeilingManager.js + CeilingCanvas.js)

### Main Container Structure
- **Manager**: `frontend/src/features/ceiling/CeilingManager.js`
- **Canvas**: `frontend/src/features/canvas/CeilingCanvas.js`
- **Wrapper Class**: `ceiling-manager` (gray-50 background, min-height screen)

### Layout Components

#### A. Header Section (CeilingManager)
```
┌─────────────────────────────────────────┐
│ Ceiling Plan Generator                  │
│ Generate optimal ceiling panel layouts  │
│ [Note: Info box about ceiling plans]    │
└─────────────────────────────────────────┘
```
- Title: "Ceiling Plan Generator"
- Description text
- Info box about ceiling plans

#### B. Control Panel Section (CeilingManager)
```
┌─────────────────────────────────────────┐
│ [Dimension Visibility Checkboxes]       │
│ ☑ Room dimensions  ☑ Panel dimensions  │
│                                        │
│ ┌─────────┬─────────┬─────────┐        │
│ │Strategy │ Panel   │ Ceiling │        │
│ │         │ Dims    │ Settings│        │
│ └─────────┴─────────┴─────────┘        │
│                                        │
│ [Support Configuration] (if needed)    │
│                                        │
│ [Action Buttons]                       │
│ [Generate] [Regenerate] [Merge]        │
└─────────────────────────────────────────┘
```
- Dimension visibility toggles (room, panel, cutPanel)
- Three control cards in a grid:
  - Strategy selection
  - Panel dimensions (width, length)
  - Ceiling settings (thickness)
- Support configuration (conditional)
- Action buttons row

#### C. Canvas Section (CeilingCanvas)
```
┌──────────────────────────┬──────────────┐
│ Canvas (flex-1)          │ Summary      │
│ ┌──────────────────────┐ │ Sidebar      │
│ │ [Zoom Controls]      │ │ (w-80)       │
│ │                      │ │              │
│ │ [Canvas Drawing]     │ │ Plan Details │
│ │ - Rooms              │ │ - Total      │
│ │ - Ceiling Panels     │ │   Panels     │
│ │ - Supports           │ │ - Full/Cut   │
│ │ - Dimensions         │ │ - Waste %    │
│ │                      │ │ - Zones      │
│ └──────────────────────┘ │              │
│ Scale: 1.00x            │ [Details     │
│ [Support Drawing Btns]  │  Panel]      │
└──────────────────────────┴──────────────┘
```
- **Header**: "Ceiling Plan" title + room count/subtitle
- **Canvas Area**: Left side (flex-1)
  - Zoom controls (top-right)
  - Canvas with rooms, panels, supports
  - Scale indicator
  - Support drawing buttons (if alu suspension enabled)
- **Summary Sidebar**: Right side (320px)
  - Plan statistics
  - Panel counts
  - Waste percentage
  - Zone information

#### D. Details Panel (Side Panel, Conditional)
- Opens when room/zone is selected
- Shows room/zone information
- Settings for selected room/zone
- Panel lists and statistics
- Tabs: Details, Joints, Panels

---

## 3. FLOOR PLAN (FloorManager.js + FloorCanvas.js)

### Main Container Structure
- **Manager**: `frontend/src/features/floor/FloorManager.js`
- **Canvas**: `frontend/src/features/canvas/FloorCanvas.js`
- **Wrapper Class**: `floor-manager` (gray-50 background, min-height screen)

### Layout Components

#### A. Header Section (FloorManager)
```
┌─────────────────────────────────────────┐
│ Floor Plan Generator                    │
│ Generate optimal floor panel layouts    │
│ [Note: Only for rooms with panel floors]│
└─────────────────────────────────────────┘
```
- Title: "Floor Plan Generator"
- Description
- Info box about floor types

#### B. Control Panel Section (FloorManager)
```
┌─────────────────────────────────────────┐
│ [Dimension Visibility Checkboxes]       │
│ ☑ Room dimensions  ☑ Panel dimensions  │
│                                        │
│ ┌─────────┬─────────┬─────────┐        │
│ │Strategy │ Panel   │ Wall    │        │
│ │         │ Dims    │ Thickness│        │
│ └─────────┴─────────┴─────────┘        │
│                                        │
│ [Action Buttons]                       │
│ [Generate] [Regenerate]                │
└─────────────────────────────────────────┘
```
- Dimension visibility toggles (room, panel)
- Three control cards:
  - Strategy selection
  - Panel dimensions
  - Wall thickness info
- Action buttons (Generate/Regenerate)

#### C. Canvas Section (FloorCanvas)
```
┌──────────────────────────┬──────────────┐
│ Canvas (flex-1)          │ Sidebar      │
│ ┌──────────────────────┐ │ (w-80)       │
│ │ [Zoom Controls]      │ │              │
│ │                      │ │ Floor Plan   │
│ │ [Canvas Drawing]     │ │ Stats:       │
│ │ - Rooms              │ │ - Total      │
│ │ - Floor Panels       │ │ - Full/Cut   │
│ │ - Dimensions         │ │ - Waste %    │
│ │                      │ │ - Strategy   │
│ └──────────────────────┘ │              │
│ Scale: 1.00x            │ [Slab Table] │
│                         │ (if any)     │
└──────────────────────────┴──────────────┘
```
- **Canvas Area**: Left side (flex-1)
  - Zoom controls (top-right)
  - Canvas with rooms, floor panels, dimensions
  - Scale indicator
- **Sidebar**: Right side (320px)
  - Statistics grid (Total, Full, Cut, Waste %)
  - Recommended strategy
  - Slab calculation table (if slab rooms exist)

---

## Common Layout Patterns

### 1. Canvas Structure (All Plans)
- Container: White background, border-2, rounded-xl, shadow-lg
- Zoom Controls: Absolute positioned, top-right (3 buttons: +, -, reset)
- Scale Indicator: Below canvas, shows current zoom level
- Canvas Element: Full width/height of container

### 2. Sidebar Structure
- Width: 320px (Tailwind `w-80`)
- Background: White or gradient (gray-50 to gray-100)
- Border, rounded corners, shadow
- Padding: 6 (p-6)
- Fixed width, scrollable content if needed

### 3. Header Pattern
- Title: 2xl or 3xl, bold, gray-900
- Subtitle: lg, gray-600
- Optional: Info boxes or status indicators

### 4. Control Panel Pattern
- Grid layout (grid-cols-1 lg:grid-cols-3 for 3 cards)
- Control cards: White background, border, rounded, padding
- Action buttons: Bottom row, flex layout

### 5. Dimension Visibility
- Checkboxes for toggling dimension types
- Common options: Room, Panel, Cut Panel (ceiling only)
- Located at top of control panel

---

## File Locations Summary

| Plan Type | Manager Component | Canvas Component |
|-----------|-------------------|------------------|
| **Wall Plan** | N/A (directly in ProjectDetails) | `frontend/src/features/canvas/Canvas2D.js` |
| **Ceiling Plan** | `frontend/src/features/ceiling/CeilingManager.js` | `frontend/src/features/canvas/CeilingCanvas.js` |
| **Floor Plan** | `frontend/src/features/floor/FloorManager.js` | `frontend/src/features/canvas/FloorCanvas.js` |

---

## Integration in ProjectDetails

All three plans are integrated in `ProjectDetails.js`:
- Tab navigation at top
- Conditional rendering based on `currentView` state
- Shared state management via `useProjectDetails` hook
- All three views accessible via tab buttons

---

## Key Differences

1. **Wall Plan**: 
   - No manager wrapper, embedded directly
   - Simpler structure, no separate header
   - Details panel is optional/collapsible

2. **Ceiling Plan**: 
   - Most complex with zones and room selection
   - Support configuration section
   - Details panel with tabs (Details, Joints, Panels)
   - Merge ceiling zones feature

3. **Floor Plan**: 
   - Simpler than ceiling plan
   - Slab calculation table in sidebar
   - Only for rooms with `floor_type = "panel"`
   - No support configuration

---

## Responsive Considerations

- All layouts use Tailwind responsive classes
- Grid layouts: `grid-cols-1 lg:grid-cols-3`
- Flex layouts: `flex-col sm:flex-row`
- Text sizing: `text-sm sm:text-base`
- Buttons: Full width on mobile, auto on desktop
- Sidebars: May stack below canvas on smaller screens

