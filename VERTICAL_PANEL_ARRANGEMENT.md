# Vertical Panel Arrangement - Clarification

## Your Understanding: ✅ CORRECT!

**For vertical panels:**
- The 1150mm dimension (panel width constraint) aligns horizontally
- Multiple panels of 1150mm width are placed side-by-side to fill the room width
- If room width = 11500mm, then 10 panels of 1150mm will fit

**This is correct!**

---

## How Vertical Panels Work

### Standard Panel Constraint
From the model definition (line 260 in `models.py`):
```python
width = models.FloatField(help_text="Width of the panel in mm (max 1150mm)")
```

**Standard panel maximum width = 1150mm**

### Vertical Panel Arrangement

**For vertical panels** (panels that run vertically, up-to-down):

1. **Panel Orientation**: Panels run **vertically** (up-to-down direction)
2. **Panel Width**: Each panel has `width = 1150mm` (or less if cut)
3. **Panel Length**: Each panel has `length = room height` (or custom length)
4. **Arrangement**: Multiple panels are placed **side-by-side horizontally**

### Example: Room Width = 11500mm

```
Room Width: 11500mm
Panel Width: 1150mm (standard constraint)
Number of panels: 11500 ÷ 1150 = 10 panels

Visual:
┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
│      ││      ││      ││      ││      ││      ││      ││      ││      ││      │
│1150mm││1150mm││1150mm││1150mm││1150mm││1150mm││1150mm││1150mm││1150mm││1150mm│
│      ││      ││      ││      ││      ││      ││      ││      ││      ││      │
│      ││      ││      ││      ││      ││      ││      ││      ││      ││      │
│      ││      ││      ││      ││      ││      ││      ││      ││      ││      │
│      ││      ││      ││      ││      ││      ││      ││      ││      ││      │
└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘└──────┘
   ↑        ↑        ↑        ↑        ↑        ↑        ↑        ↑        ↑        ↑
  10 panels of 1150mm width each, placed side-by-side horizontally
```

### Panel Dimensions for Vertical Panels

For each vertical panel:
- **width** = 1150mm (X-axis, horizontal span) - **This fills the room width**
- **length** = room height or custom (Y-axis, vertical span) - This is how tall the panel is

**Key Point**: 
- The **1150mm width** is the dimension that **fills the room width horizontally**
- Multiple panels of 1150mm width are placed side-by-side
- If room width = 11500mm, then **10 panels** of 1150mm will fit

---

## Comparison: Horizontal vs Vertical Panels

### Horizontal Panels (runs left-to-right)
- **width** = 1150mm (X-axis) - Shorter dimension, **across** the panel
- **length** = 15000mm (Y-axis) - Longer dimension, **along** the panel
- Panels are stacked **vertically** (one above another)
- Multiple rows of panels fill the room height

### Vertical Panels (runs up-to-down)
- **width** = 1150mm (X-axis) - Standard constraint, **fills room width**
- **length** = room height (Y-axis) - Longer dimension, **along** the panel
- Panels are placed **side-by-side horizontally**
- Multiple columns of panels fill the room width

---

## Summary

✅ **Your understanding is correct:**

> "For vertical, the 1150 will align at the width, so the width, of the place, will filled by multiple 1150. So if the project is 11500 width, there will be 10 1150 panel at here."

**This is exactly right!**

- For vertical panels, the 1150mm (panel width) aligns horizontally
- Multiple 1150mm panels are placed side-by-side
- Room width = 11500mm → 10 panels of 1150mm width

The 1150mm dimension is the **standard panel width constraint** that determines how many panels fit horizontally across the room width.

