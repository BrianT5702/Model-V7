# Wall Joint Test Demo

## Overview

This standalone HTML file demonstrates the 3D wall generation system with two perpendicular walls and different joint types.

## How to Run

### Option 1: Using Local Server (Recommended)
```bash
# Already running on port 8000
# Open in browser:
http://localhost:8000/wall_joint_test.html
```

### Option 2: Direct File Open
Simply double-click `wall_joint_test.html` to open in your browser.

## What It Shows

The demo creates two perpendicular walls meeting at a 90° angle:

### Wall 1 (Red - Horizontal)
- **Start:** (3000mm, 3000mm)
- **End:** (7000mm, 3000mm)
- **Height:** 3000mm
- **Thickness:** 200mm
- **Color:** Red

### Wall 2 (Blue - Vertical)
- **Start:** (5000mm, 3000mm)
- **End:** (5000mm, 7000mm)
- **Height:** 3000mm
- **Thickness:** 200mm
- **Color:** Blue

### Model Center (Green Sphere)
- Position: (5000mm, 0, 5000mm) - 5m × 5m from origin
- This determines which direction the wall thickness extends

## Joint Types

### 1. **butt_in** (Default)
- Walls meet at perpendicular ends
- No mitered cuts
- Standard butt joint

### 2. **45_cut**
- Walls have 45° mitered cuts at the intersection
- Visual cutting planes shown (red/green semi-transparent boxes)
- Smoother connection at corners

## Controls

### Mouse
- **Left Click + Drag:** Rotate camera
- **Right Click + Drag:** Pan camera
- **Scroll:** Zoom in/out

### Buttons
- **Toggle Joint Type:** Switch between `butt_in` and `45_cut`
- **Reset Camera:** Return to initial viewing position

## Technical Details

### Wall Generation Process

1. **Data Extraction**: Wall coordinates from database (mm)
2. **Scaling**: Convert mm to meters (×0.01)
3. **Normal Calculation**: Determine which direction thickness extends
4. **Joint Detection**: Check for 45° cut joints
5. **Shape Creation**: Create 2D profile with THREE.Shape
6. **Extrusion**: Extrude shape by thickness (200mm)
7. **Positioning**: Rotate and translate to final position

### Coordinate System

```
2D Database        →    3D World
----------------        -------------
start_x, start_y   →    X, Z (ground plane)
height              →    Y (vertical)
thickness           →    extruded depth
```

### Wall Orientation Logic

**Horizontal Walls** (red):
- Normal points toward model center in Z direction
- Thickness extends perpendicular to wall length

**Vertical Walls** (blue):
- Normal points toward model center in X direction
- Thickness extends perpendicular to wall length

### Scaling

All dimensions converted:
- **Database units:** millimeters (mm)
- **3D scene units:** meters (m)
- **Scale factor:** 0.01

Example: 3000mm wall → 30m in scene

## Visual Indicators

- **Red walls**: Horizontal walls
- **Blue walls**: Vertical walls  
- **Green sphere**: Model center
- **Black lines**: Edge geometry
- **Semi-transparent red/green boxes**: 45° cut planes (when active)

## Next Steps

To integrate this with your full system:

1. Add door cutouts
2. Implement full CSG boolean operations for 45° cuts
3. Add gap-fill wall support
4. Connect to your panel calculation system
5. Add room-specific materials

## Debugging

Open browser console (F12) to see:
- Wall creation logs
- Joint detection information
- Any errors during generation

## Files Created

- `wall_joint_test.html` - Main test file
- This README - Documentation

## Related Code

Based on your existing `meshUtils.js`:
- `createWallMesh()` function
- `apply45DegreeCuts()` function
- Wall flipping logic
- Joint detection system

