# Wall Placement Analysis for Project 457

## Wall Coordinates Overview

### Wall List:
1. **Wall 7049**: (0, 5000) → (5000, 5000) - **Top horizontal wall** (full width)
2. **Wall 7255**: (3049, 2243) → (5000, 2243) - **Middle horizontal wall** (partial, right side)
3. **Wall 7256**: (3049, 0) → (3049, 2243) - **Left vertical wall** (partial, bottom section)
4. **Wall 7257**: (5000, 2243) → (5000, 5000) - **Right vertical wall** (partial, top section)
5. **Wall 7056**: (0, 0) → (0, 5000) - **Left full vertical wall** (full height)
6. **Wall 7252**: (0, 0) → (3049, 0) - **Bottom horizontal wall** (partial, left side)

## Coordinate System
**IMPORTANT**: (0,0) is TOP-LEFT, X increases RIGHT, Y increases DOWN (like screen coordinates)

## Room Shape Visualization

```
(0,0) ─────────── (3049,0)                    (5000,0)
   │                           │                    │
   │                           │                    │
   │                    (3049,2243)                │
   │                           │                    │
   │                           │                    │
   │                    (5000,2243)                │
   │                           │                    │
   │                           │                    │
(0,5000) ──────────────────────────────────── (5000,5000)
```

**Room Boundary (room_points) would be:**
- (0, 0) - **Top-left corner**
- (3049, 0) - **Top notch right**
- (3049, 2243) - **Notch bottom-left**
- (5000, 2243) - **Notch bottom-right**
- (5000, 5000) - **Bottom-right corner**
- (0, 5000) - **Bottom-left corner**

This forms a **rectangle with a notch** in the **top-right corner** (not bottom-right!).

## Wall Thickness Direction Analysis

### Model Center Calculation
Assuming model center is at approximately (2500, 2500) - center of the 5000×5000 building.

### Wall-by-Wall Analysis:

**Model Center**: Approximately (2500, 2500) - center of the 5000×5000 building

#### Wall 7049: Bottom Horizontal (0,5000) → (5000,5000)
- **Type**: Horizontal (at y=5000, which is BOTTOM)
- **Flipping Check**: `modelCenter.z < 5000` → TRUE → **FLIPPED**
  - Flipped: (5000, 5000) → (0, 5000)
- **Normal Calculation**:
  - Direction: (-1, 0) [pointing left]
  - Perpendicular: (0, -1) [pointing UP in screen coords, but this is the normal calculation]
  - Model center is at (2500, 2500), wall is at y=5000 (bottom)
  - Vector to center: (2500-2500, 2500-5000) = (0, -2500) [pointing UP]
  - After normal calculation, normal points toward center
  - **Normal**: (0, -1) [points UP, toward model center at y=2500]
- **Inner Face**: Outer face + (0, -1) × 150mm = **moves UP by 150mm**
- **Inner face Y**: 5000 - 150 = **4850**

#### Wall 7056: Left Vertical (0,0) → (0,5000)
- **Type**: Vertical (at x=0, which is LEFT edge)
- **Flipping Check**: `modelCenter.x > 0` → TRUE → **FLIPPED**
  - Flipped: (0, 5000) → (0, 0)
- **Normal Calculation**:
  - Direction: (0, -1) [pointing UP in screen coords]
  - Perpendicular: (1, 0) [pointing right]
  - Model center is at (2500, 2500), wall is at x=0 (left)
  - Vector to center: (2500-0, 2500-2500) = (2500, 0) [pointing RIGHT]
  - **Normal**: (1, 0) [points RIGHT, toward model center at x=2500]
- **Inner Face**: Outer face + (1, 0) × 150mm = **moves RIGHT by 150mm**
- **Inner face X**: 0 + 150 = **150**

#### Wall 7252: Top Horizontal (0,0) → (3049,0)
- **Type**: Horizontal (at y=0, which is TOP)
- **Flipping Check**: `modelCenter.z < 0` → FALSE → **NOT FLIPPED**
  - Original: (0, 0) → (3049, 0)
- **Normal Calculation**:
  - Direction: (1, 0) [pointing right]
  - Perpendicular: (0, 1) [pointing DOWN in screen coords]
  - Model center is at (2500, 2500), wall is at y=0 (top)
  - Vector to center: (2500-1524.5, 2500-0) = (975.5, 2500) [pointing DOWN]
  - **Normal**: (0, 1) [points DOWN, toward model center at y=2500]
- **Inner Face**: Outer face + (0, 1) × 150mm = **moves DOWN by 150mm**
- **Inner face Y**: 0 + 150 = **150**

#### Wall 7256: Notch Vertical (3049,0) → (3049,2243)
- **Type**: Vertical (at x=3049, right side of notch)
- **Flipping Check**: `modelCenter.x > 3049` → FALSE → **NOT FLIPPED**
  - Original: (3049, 0) → (3049, 2243)
- **Normal Calculation**:
  - Direction: (0, 1) [pointing DOWN in screen coords]
  - Perpendicular: (-1, 0) [pointing left]
  - Model center is at (2500, 2500), wall is at x=3049 (right of center)
  - Vector to center: (2500-3049, 2500-1121.5) = (-549, 1378.5) [pointing LEFT and DOWN]
  - **Normal**: (-1, 0) [points LEFT, toward model center at x=2500]
- **Inner Face**: Outer face + (-1, 0) × 150mm = **moves LEFT by 150mm**
- **Inner face X**: 3049 - 150 = **2899**

#### Wall 7255: Notch Horizontal (3049,2243) → (5000,2243)
- **Type**: Horizontal (at y=2243, bottom of notch)
- **Flipping Check**: `modelCenter.z < 2243` → FALSE → **NOT FLIPPED**
  - Original: (3049, 2243) → (5000, 2243)
- **Normal Calculation**:
  - Direction: (1, 0) [pointing right]
  - Perpendicular: (0, 1) [pointing DOWN in screen coords]
  - Model center is at (2500, 2500), wall is at y=2243 (above center at y=2500)
  - Vector to center: (2500-4024.5, 2500-2243) = (-1524.5, 257) [pointing LEFT and DOWN]
  - **Normal**: (0, 1) [points DOWN, toward model center at y=2500]
- **Inner Face**: Outer face + (0, 1) × 150mm = **moves DOWN by 150mm**
- **Inner face Y**: 2243 + 150 = **2393**

#### Wall 7257: Right Vertical (5000,2243) → (5000,5000)
- **Type**: Vertical (at x=5000, which is RIGHT edge)
- **Flipping Check**: `modelCenter.x > 5000` → FALSE → **NOT FLIPPED**
  - Original: (5000, 2243) → (5000, 5000)
- **Normal Calculation**:
  - Direction: (0, 1) [pointing DOWN in screen coords]
  - Perpendicular: (-1, 0) [pointing left]
  - Model center is at (2500, 2500), wall is at x=5000 (right)
  - Vector to center: (2500-5000, 2500-3621.5) = (-2500, -1121.5) [pointing LEFT and UP]
  - **Normal**: (-1, 0) [points LEFT, toward model center at x=2500]
- **Inner Face**: Outer face + (-1, 0) × 150mm = **moves LEFT by 150mm**
- **Inner face X**: 5000 - 150 = **4850**

## Expected Room Points (Inner Face Boundary)

Based on the inner face calculations above, the floor should align with (remembering y=0 is TOP):

1. **Top-left**: (150, 150) - from Wall 7056 (x=150) and Wall 7252 (y=150)
2. **Top notch right**: (2899, 150) - from Wall 7256 (x=2899) and Wall 7252 (y=150)
3. **Notch bottom-left**: (2899, 2393) - from Wall 7256 (x=2899) and Wall 7255 (y=2393)
4. **Notch bottom-right**: (4850, 2393) - from Wall 7257 (x=4850) and Wall 7255 (y=2393)
5. **Bottom-right**: (4850, 4850) - from Wall 7257 (x=4850) and Wall 7049 (y=4850)
6. **Bottom-left**: (150, 4850) - from Wall 7056 (x=150) and Wall 7049 (y=4850)

## Gap Analysis

### Potential Gap Locations:

1. **At Wall 7256 (x=3049, notch right edge)**: 
   - Outer face at x=3049
   - Inner face at x=2899 (moved left by 150mm)
   - If room_points are at x=3049, floor needs to shrink to x=2899
   - **Gap risk**: If we don't shrink, floor overlaps. If we shrink too much, gap appears.

2. **At Wall 7255 (y=2243, notch bottom)**:
   - Outer face at y=2243
   - Inner face at y=2393 (moved down by 150mm)
   - If room_points are at y=2243, floor needs to shrink to y=2393
   - **Gap risk**: Same as above

3. **At Joints**:
   - Wall 7256 meets Wall 7255 at (3049, 2243) - **Notch corner**
   - Wall 7255 meets Wall 7257 at (5000, 2243) - **Right notch corner**
   - Wall 7256 meets Wall 7252 at (3049, 0) - **Top notch corner**
   - **Extension may occur**: Walls may extend at these joints, moving inner faces outward
   - This is the **primary cause of gaps** - if walls extend, inner faces extend, but floor shrinks from original room_points

## Why Gaps Occur

1. **Wall Extension**: When walls extend at joints, their inner faces also extend outward. If we shrink the floor based on original room_points, we create gaps at extended positions.

2. **Incorrect Inner Face Calculation**: If we calculate inner face incorrectly (wrong normal direction or wrong extension), the floor won't align.

3. **Over-Shrinking**: If we shrink vertices that are already at or inside the inner face, we create gaps.

## Solution

The `shrinkPolygonSelectivelyByInnerFace` function should:
1. Calculate extended inner faces for all walls (accounting for extension at joints)
2. For each room_points vertex, check if it's outside the inner face
3. Only shrink if outside; keep if at or inside

This ensures:
- No gaps (don't shrink when already inside)
- No overlap (shrink when outside)

