# 2D Sketch Export Functionality

This document explains how to use the new 2D sketch export feature that has been added to the application.

## Overview

The 2D sketch export functionality allows users to export their floor plan drawings in two formats:
- **PNG Image**: High-resolution raster image suitable for printing and sharing
- **SVG Vector**: Scalable vector format for editing and high-quality printing

## How to Use

### Accessing the Export Feature

1. Navigate to your project's 2D canvas view
2. Look for the "Export" button in the panel calculation controls section
3. Click the "Export" button to open the export modal

### Export Options

The export modal now includes three tabs:

1. **PDF Preview**: Export material panels and door data as PDF
2. **CSV Preview**: Export material panels and door data as CSV
3. **2D Sketch**: Export the 2D floor plan drawing

### 2D Sketch Export

When you select the "2D Sketch" tab, you'll see two export options:

#### PNG Export
- **Format**: High-resolution raster image
- **Quality**: 2x resolution for crisp images
- **Use Case**: Printing, sharing, documentation
- **Features**: 
  - Includes all walls, rooms, doors, and labels
  - High-quality output suitable for professional use
  - Automatic file naming with project name

#### SVG Export
- **Format**: Scalable vector graphics
- **Quality**: Vector format, infinitely scalable
- **Use Case**: Further editing, CAD software, high-quality printing
- **Features**:
  - Includes all walls, rooms, doors, and labels
  - Grid lines for reference
  - Properly scaled and centered
  - Can be opened in vector editing software

## Technical Details

### PNG Export Process
1. Creates a temporary high-resolution canvas (2x scale)
2. Draws the current canvas content to the temporary canvas
3. Converts to PNG blob
4. Triggers automatic download

### SVG Export Process
1. Calculates drawing bounds and optimal scale
2. Generates SVG markup with proper styling
3. Includes all drawing elements:
   - Walls with proper thickness
   - Room fills with transparency
   - Doors with correct positioning
   - Room labels with text
   - Grid lines for reference
4. Creates and downloads SVG file

### File Naming
Files are automatically named using the project name:
- PNG: `{project_name}_2d_sketch.png`
- SVG: `{project_name}_2d_sketch.svg`

## Features Included in Export

### Walls
- All wall segments with proper thickness
- Wall endpoints and intersections
- Joint types (45° cuts, butt joints)

### Rooms
- Room boundaries and fills
- Room labels with name, height, and description
- Room area calculations

### Doors
- Door positions along walls
- Door types and dimensions
- Proper door representation

### Additional Elements
- Grid lines for reference
- Proper scaling and centering
- High-quality styling

## Error Handling

The export functions include comprehensive error handling:
- Canvas reference validation
- Context creation error handling
- Blob creation error handling
- File download error handling

## Browser Compatibility

The export functionality works in all modern browsers that support:
- HTML5 Canvas API
- Blob API
- File download API

## Troubleshooting

### Common Issues

1. **Export button not visible**
   - Ensure you're in the 2D canvas view
   - Check that the panel calculation controls are visible

2. **Export fails**
   - Check browser console for error messages
   - Ensure the canvas has content to export
   - Verify browser supports required APIs

3. **Poor image quality**
   - PNG export uses 2x resolution for better quality
   - SVG export provides vector quality at any scale

4. **File not downloading**
   - Check browser download settings
   - Ensure popup blockers are disabled
   - Verify sufficient disk space

## Future Enhancements

Potential improvements for future versions:
- Custom export settings (resolution, format options)
- Batch export functionality
- Integration with cloud storage
- Additional export formats (DXF, DWG)
- Custom styling options
- Export with measurements and dimensions
