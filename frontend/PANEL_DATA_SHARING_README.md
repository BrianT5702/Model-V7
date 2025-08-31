# Panel Data Sharing Between Tabs

This document explains how panel data is shared between different tabs in the project view, allowing the final "Project Summary & Installation Time" tab to access real-time panel calculations from other tabs.

## Overview

The system allows each tab to calculate and share its panel data with other tabs, particularly the final summary tab. This ensures that the installation time estimator has access to the most accurate, up-to-date panel information.

## How It Works

### 1. Shared State Management

The `useProjectDetails` hook maintains a shared state object that stores panel data from each tab:

```javascript
const [sharedPanelData, setSharedPanelData] = useState({
  wallPanels: null,        // From wall plan tab
  ceilingPanels: null,     // From ceiling plan tab
  floorPanels: null,       // From floor plan tab
  wallPanelAnalysis: null, // Panel analysis from wall calculations
  lastUpdated: null        // Track when data was last updated
});
```

### 2. Data Update Functions

Each tab can update the shared data using the `updateSharedPanelData` function:

```javascript
const updateSharedPanelData = (tabName, panelData, analysis = null) => {
  setSharedPanelData(prev => ({
    ...prev,
    [tabName === 'wall-plan' ? 'wallPanels' : 
     tabName === 'ceiling-plan' ? 'ceilingPanels' : 
     tabName === 'floor-plan' ? 'floorPanels' : 'unknown']: panelData,
    wallPanelAnalysis: tabName === 'wall-plan' ? analysis : prev.wallPanelAnalysis,
    lastUpdated: new Date().toISOString()
  }));
};
```

### 3. Data Retrieval

The final summary tab can access all shared panel data using:

```javascript
const getAllPanelData = () => {
  return {
    wallPanels: sharedPanelData.wallPanels,
    ceilingPanels: sharedPanelData.ceilingPanels,
    floorPanels: sharedPanelData.floorPanels,
    wallPanelAnalysis: sharedPanelData.wallPanelAnalysis,
    totalPanels: (sharedPanelData.wallPanels?.length || 0) + 
                 (sharedPanelData.ceilingPanels?.length || 0) + 
                 (sharedPanelData.floorPanels?.length || 0),
    lastUpdated: sharedPanelData.lastUpdated
  };
};
```

## Implementation in Each Tab

### Wall Plan Tab

- **Component**: `Canvas2D` → `PanelCalculationControls`
- **Data Shared**: Wall panel calculations, panel analysis
- **When**: After panel calculations are completed
- **How**: Calls `updateSharedPanelData('wall-plan', allPanels, analysis)`

### Ceiling Plan Tab

- **Component**: `CeilingManager`
- **Data Shared**: Ceiling panel generation results
- **When**: After ceiling plan generation
- **How**: Should call `updateSharedPanelData('ceiling-plan', ceilingPanels)`

### Floor Plan Tab

- **Component**: `FloorManager`
- **Data Shared**: Floor panel generation results
- **When**: After floor plan generation
- **How**: Should call `updateSharedPanelData('floor-plan', floorPanels)`

## Usage in Installation Time Estimator

The `InstallationTimeEstimator` component receives the shared panel data and uses it to:

1. **Display live panel data status** - Shows which tabs have provided data
2. **Calculate accurate totals** - Uses real-time data instead of database fallbacks
3. **Show data freshness** - Displays when data was last updated

### Example Display

```javascript
{sharedPanelData && (
  <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
    <div className="flex items-center mb-2">
      <span className="font-semibold text-blue-800">Live Panel Data from Other Tabs</span>
    </div>
    <div className="text-sm text-blue-700">
      <p>Using real-time panel calculations from: </p>
      <ul className="list-disc list-inside mt-1 space-y-1">
        {sharedPanelData.wallPanels && <li>Wall Plan: {sharedPanelData.wallPanels.length} panels</li>}
        {sharedPanelData.ceilingPanels && <li>Ceiling Plan: {sharedPanelData.ceilingPanels.length} panels</li>}
        {sharedPanelData.floorPanels && <li>Floor Plan: {sharedPanelData.floorPanels.length} panels</li>}
      </ul>
      <p className="mt-2 text-xs">
        Last updated: {sharedPanelData.lastUpdated ? new Date(sharedPanelData.lastUpdated).toLocaleString() : 'Unknown'}
      </p>
    </div>
  </div>
)}
```

## Benefits

1. **Real-time Accuracy**: Final calculations use the most current panel data
2. **No Database Dependency**: Works even when panel data isn't saved to database
3. **Cross-tab Communication**: Seamless data sharing between different views
4. **User Experience**: Users see live updates as they work in different tabs
5. **Data Consistency**: All tabs work with the same panel information

## Future Enhancements

1. **Auto-save**: Automatically save shared panel data to database
2. **Data Validation**: Validate panel data before sharing
3. **Conflict Resolution**: Handle conflicts when multiple tabs update simultaneously
4. **Data Persistence**: Persist shared data across browser sessions
5. **Real-time Updates**: Use WebSockets for live updates across multiple users

## Troubleshooting

### Panel Data Not Showing

1. Check if `updateSharedPanelData` is being called in the source tab
2. Verify the tab name parameter matches expected values
3. Check browser console for error messages
4. Ensure the shared state is properly initialized

### Data Not Updating

1. Verify the `updateSharedPanelData` function is being passed correctly
2. Check if the component is re-rendering when data changes
3. Ensure the dependency array in useEffect includes `sharedPanelData`

### Performance Issues

1. Limit the frequency of data updates
2. Consider debouncing rapid updates
3. Only update when data actually changes
4. Use React.memo for components that don't need frequent updates
