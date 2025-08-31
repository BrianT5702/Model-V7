# Project Summary & Installation Time Estimator Feature

## Overview

The Project Summary & Installation Time Estimator is a comprehensive feature that provides a complete project overview and calculates project installation time based on material quantities from all plan types (wall, ceiling, and floor plans) and user-defined daily installation rates.

## Features

### 1. **Project Overview**
- **Room Count**: Total number of rooms in the project
- **Wall Count**: Total number of walls
- **Door Count**: Total number of doors
- **Project Dimensions**: Site width and length in meters

### 2. **Installation Rate Inputs**
- **Panels per Day**: Number of panels that can be installed in one day
- **Doors per Day**: Number of doors that can be installed in one day  
- **Slabs per Day**: Number of slabs that can be installed in one day

### 3. **Automatic Material Quantification**
- **Ceiling Panels**: Counts panels from generated ceiling plans
- **Floor Panels**: Counts panels from generated floor plans
- **Wall Panels**: Calculates panels using PanelCalculator based on wall dimensions
- **Doors**: Gets actual count from project door data
- **Slabs**: Calculates slabs based on room area using 1210×3000mm slab size (only for rooms with slab floors)

### 4. **Installation Time Calculations**
- **Working Days**: Total days needed including 20% buffer
- **Working Weeks**: Converted to weeks (5 working days per week)
- **Working Months**: Converted to months (22 working days per month)

## How It Works

### Material Counting Logic

#### Ceiling Panels
```javascript
const ceilingPanels = ceilingPlans.reduce((total, plan) => {
    return total + (plan.total_panels || 0);
}, 0);
```

#### Floor Panels
```javascript
const floorPanels = floorPlans.reduce((total, plan) => {
    return total + (plan.total_panels || 0);
}, 0);
```

#### Wall Panels
```javascript
const wallPanels = walls.reduce((total, wall) => {
    const wallLength = Math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y);
    const wallHeight = wall.height || 2400; // Default height
    const MAX_PANEL_WIDTH = 1150; // mm
    const MAX_PANEL_HEIGHT = 2400; // mm
    
    const panelsForLength = Math.ceil(wallLength / MAX_PANEL_WIDTH);
    const panelsForHeight = Math.ceil(wallHeight / MAX_PANEL_HEIGHT);
    return total + (panelsForLength * panelsForHeight);
}, 0);
```

#### Doors
```javascript
const totalDoors = doors.length; // Actual door count from project data
```

#### Slabs
```javascript
const totalSlabs = rooms.reduce((total, room) => {
    if (room.room_points && room.room_points.length > 0 && 
        (room.floor_type === 'slab' || room.floor_type === 'Slab')) {
        const roomArea = calculateRoomArea(room.room_points);
        const slabArea = 1210 * 3000; // mm²
        const slabsNeeded = Math.ceil(roomArea / slabArea);
        return total + slabsNeeded;
    }
    return total;
}, 0);
```
Slabs are calculated based on room area using 1210×3000mm slab size (3.63 m² per slab), but **only for rooms that have slab floors**.

### Installation Time Calculation

```javascript
const panelDays = Math.ceil(totalQuantities.panels / panelsPerDay);
const doorDays = Math.ceil(totalQuantities.doors / doorsPerDay);
const slabDays = Math.ceil(totalQuantities.slabs / slabsPerDay);

// Total days needed (assuming parallel work where possible)
const totalDays = Math.max(panelDays, doorDays, slabDays);

// Add 20% buffer for coordination and unexpected issues
const daysWithBuffer = Math.ceil(totalDays * 1.2);

return {
    days: daysWithBuffer,
    weeks: Math.ceil(daysWithBuffer / 5), // 5 working days per week
    months: Math.ceil(daysWithBuffer / 22) // 22 working days per month
};
```

## Usage

### 1. **Access the Feature**
- Navigate to your project
- Click on the "Project Summary & Installation Time" tab
- The feature is only available when rooms exist in the project

### 2. **Set Installation Rates**
- **Panels per Day**: Enter the number of panels your crew can install daily
- **Doors per Day**: Enter the number of doors your crew can install daily
- **Slabs per Day**: Enter the number of slabs your crew can install daily

### 3. **View Results**
- **Project Overview**: See room count, wall count, door count, and project dimensions
- **Material Quantities**: See total counts for panels, doors, and slabs
- **Panel Breakdown**: Detailed breakdown of ceiling, floor, and wall panels
- **Installation Estimates**: View estimated time in days, weeks, and months
- **Room Details**: Complete table of room information including floor types and areas

## Assumptions

### Panel Sizes
- **Standard Panel Width**: 1150mm
- **Standard Panel Height**: 2400mm
- **Standard Slab Size**: 600mm × 600mm

### Installation Logic
- **Parallel Work**: Assumes different trades can work simultaneously
- **Buffer Time**: Includes 20% additional time for coordination and unexpected issues
- **Working Schedule**: Based on 5 working days per week and 22 working days per month

### Door Estimation
- **Source**: Actual door count from project data
- **No Estimation**: Uses real door data instead of assumptions

## Integration Points

### 1. **Project Details Component**
- Added as a new tab alongside Wall Plan, Ceiling Plan, and Floor Plan
- Integrated with existing project data fetching

### 2. **API Endpoints Used**
- `/projects/{id}/` - Project details
- `/rooms/?project={id}` - Room information
- `/ceiling-plans/?room={id}` - Ceiling plan data
- `/floor-plans/?room={id}` - Floor plan data
- `/projects/{id}/walls/` - Wall information (for panel calculation)
- `/doors/?project={id}` - Door information

### 3. **Data Flow**
```
Project Data → Material Quantification → Installation Rate Inputs → Time Calculation → Display Results
```

## Customization Options

### 1. **Panel Sizes**
Modify the constants in `InstallationTimeEstimator.js`:
```javascript
const MAX_PANEL_WIDTH = 1150; // mm
const MAX_PANEL_HEIGHT = 2400; // mm
const SLAB_SIZE = 600; // mm
```

### 2. **Buffer Percentage**
Adjust the buffer time calculation:
```javascript
const daysWithBuffer = Math.ceil(totalDays * 1.2); // 20% buffer
```

### 3. **Working Schedule**
Modify working day assumptions:
```javascript
weeks: Math.ceil(daysWithBuffer / 5), // 5 working days per week
months: Math.ceil(daysWithBuffer / 22) // 22 working days per month
```

## Benefits

1. **Comprehensive View**: Aggregates data from all plan types
2. **Realistic Estimates**: Includes buffer time and parallel work assumptions
3. **User Customizable**: Installation rates can be adjusted based on crew capabilities
4. **Project Planning**: Helps with scheduling and resource allocation
5. **Cost Estimation**: Can be used for labor cost calculations

## Future Enhancements

1. **Crew Size Input**: Add crew size to calculate per-person productivity
2. **Weather Factors**: Include weather impact on installation rates
3. **Material Complexity**: Factor in panel types and installation difficulty
4. **Export Functionality**: Generate PDF reports for project documentation
5. **Historical Data**: Use past project data to improve estimates

## Technical Notes

- **React Hooks**: Uses `useState`, `useEffect`, and `useMemo` for efficient state management
- **API Integration**: Fetches data from multiple endpoints and aggregates results
- **Error Handling**: Includes loading states and error messages
- **Responsive Design**: Works on both desktop and mobile devices
- **Performance**: Optimized with memoization to prevent unnecessary recalculations
