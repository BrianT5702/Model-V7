import React, { useState, useEffect } from 'react';
import FloorCanvas from '../canvas/FloorCanvas';
import api from '../../api/api';

const FloorManager = ({ projectId, onClose, onFloorPlanGenerated, updateSharedPanelData = null }) => {
    // Essential state for project-level floor planning
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState(null);

    // Project-level data
    const [allRooms, setAllRooms] = useState([]);
    const [allWalls, setAllWalls] = useState([]);
    const [allIntersections, setAllIntersections] = useState([]);
    const [floorPlan, setFloorPlan] = useState(null);
    const [floorPanels, setFloorPanels] = useState([]);
    const [projectData, setProjectData] = useState(null);
    // Cached project-wide waste % from latest POST, to ensure immediate UI update
    const [projectWastePercentage, setProjectWastePercentage] = useState(null);
    
    // Orientation strategy
    const [selectedOrientationStrategy, setSelectedOrientationStrategy] = useState('auto');
    const [orientationAnalysis, setOrientationAnalysis] = useState(null);
    
    // Panel dimension configuration
    const [panelWidth, setPanelWidth] = useState(1150);
    const [panelLength, setPanelLength] = useState('auto');
    const [customPanelLength, setCustomPanelLength] = useState(10000);
    
    // Track if current plan needs regeneration due to dimension changes
    const [planNeedsRegeneration, setPlanNeedsRegeneration] = useState(false);

    // Dimension visibility filters (checkboxes)
    const [dimensionVisibility, setDimensionVisibility] = useState({
        room: true,
        panel: true
    });
    const toggleDimensionVisibility = (key) => {
        setDimensionVisibility(prev => ({ ...prev, [key]: !prev[key] }));
    };

    useEffect(() => {
        if (projectId) {
            loadProjectData();
        }
    }, [projectId]);

    const loadProjectData = async () => {
        try {
            // Load project data first
            const projectResponse = await api.get(`/projects/${parseInt(projectId)}/`);
            setProjectData(projectResponse.data || null);
            
            // Load rooms
            const roomsResponse = await api.get(`/rooms/?project=${parseInt(projectId)}`);
            const rooms = roomsResponse.data || [];
            setAllRooms(rooms);
            
            // Check if any rooms have panel floors
            const panelRooms = rooms.filter(room => room.floor_type === 'panel' || room.floor_type === 'Panel');
            if (panelRooms.length === 0) {
                setError('No rooms with panel floors found. Floor plans are only generated for rooms with floor_type = "panel". Rooms with slab or other floor types do not need floor plans.');
                return;
            }
            
            console.log(`Found ${panelRooms.length} rooms with panel floors out of ${rooms.length} total rooms`);
            
            // Load walls
            const wallsResponse = await api.get(`/walls/?project=${parseInt(projectId)}`);
            console.log('Walls loaded:', wallsResponse.data);
            setAllWalls(wallsResponse.data || []);
            
            // Load intersections for the project
            const intersectionsResponse = await api.get(`/intersections/?project=${parseInt(projectId)}`);
            console.log('Intersections loaded:', intersectionsResponse.data);
            setAllIntersections(intersectionsResponse.data || []);
            
            // Load existing floor plan if any
            await loadExistingFloorPlan();
            
            // Load floor panels and calculate project waste after floor plan is loaded
            console.log('🔄 [FLOOR INITIAL LOAD] Starting to load floor panels...');
            try {
                const panelsResponse = await api.get(`/floor-panels/?project=${parseInt(projectId)}`);
                const loadedPanels = panelsResponse.data || [];
                
                console.log('📦 [FLOOR INITIAL LOAD] Loaded panels:', loadedPanels.length, loadedPanels);
                console.log('📦 [FLOOR INITIAL LOAD] Loaded rooms:', rooms.length, rooms);
                
                // Calculate waste using leftover-based approach (estimate from cut panels)
                if (loadedPanels.length > 0 && rooms.length > 0) {
                    const MAX_PANEL_WIDTH = 1150;
                    let estimatedLeftoverArea = 0;
                    
                    loadedPanels.forEach(panel => {
                        if (panel.is_cut_panel) {
                            if (panel.width < MAX_PANEL_WIDTH) {
                                const leftoverWidth = MAX_PANEL_WIDTH - panel.width;
                                const leftoverArea = leftoverWidth * panel.length;
                                estimatedLeftoverArea += leftoverArea;
                                console.log(`📊 [FLOOR INITIAL LOAD] Cut panel ${panel.panel_id}: leftover ~${leftoverWidth}mm × ${panel.length}mm = ${leftoverArea} mm²`);
                            }
                        }
                    });
                    
                    // Calculate total room area (for floor, we include wall exclusion)
                    const totalRoomArea = rooms.reduce((sum, room) => {
                        if (room.room_points && room.room_points.length >= 3) {
                            // Only count rooms with panel floors
                            if (room.floor_type === 'panel' || room.floor_type === 'Panel') {
                                let area = 0;
                                for (let i = 0; i < room.room_points.length; i++) {
                                    const j = (i + 1) % room.room_points.length;
                                    area += room.room_points[i].x * room.room_points[j].y;
                                    area -= room.room_points[j].x * room.room_points[i].y;
                                }
                                return sum + Math.abs(area) / 2;
                            }
                        }
                        return sum;
                    }, 0);
                    
                    if (estimatedLeftoverArea > 0 && totalRoomArea > 0) {
                        const estimatedWaste = (estimatedLeftoverArea / totalRoomArea) * 100;
                        setProjectWastePercentage(estimatedWaste);
                        console.log('📊 [FLOOR INITIAL LOAD] Estimated leftover area:', estimatedLeftoverArea);
                        console.log('📊 [FLOOR INITIAL LOAD] Total room area:', totalRoomArea);
                        console.log('✅ [FLOOR INITIAL LOAD] Estimated waste %:', estimatedWaste.toFixed(1) + '%');
                    } else {
                        console.log('ℹ️ [FLOOR INITIAL LOAD] No waste to display (no cut panels or perfect fit)');
                        setProjectWastePercentage(0);
                    }
                }
            } catch (error) {
                console.error('❌ [FLOOR INITIAL LOAD] Error calculating initial waste percentage:', error);
            }
            
            // Load orientation analysis
            await loadOrientationAnalysis();
        } catch (error) {
            console.error('Error loading project data:', error);
        }
    };

    // Process floor panels for sharing with other tabs (matches table structure)
    const processFloorPanelsForSharing = (panels, rooms) => {
        if (!panels || panels.length === 0) return [];
        
        const panelList = [];
        
        // Group panels by room
        const panelsByRoom = {};
        panels.forEach(panel => {
            const roomId = panel.room_id || panel.room;
            if (!panelsByRoom[roomId]) {
                panelsByRoom[roomId] = [];
            }
            panelsByRoom[roomId].push(panel);
        });
        
        // Process each room's panels
        Object.entries(panelsByRoom).forEach(([roomId, roomPanels]) => {
            if (!roomPanels || roomPanels.length === 0) return;
            
            // Group panels by dimensions
            const panelsByDimension = new Map();
            roomPanels.forEach(panel => {
                const isHorizontal = panel.width < panel.length;
                const groupingDimension = isHorizontal ? panel.length : panel.width;
                const dimensionValue = Math.round(groupingDimension * 100) / 100;
                
                if (!panelsByDimension.has(dimensionValue)) {
                    panelsByDimension.set(dimensionValue, []);
                }
                panelsByDimension.get(dimensionValue).push(panel);
            });
            
            // Create panel list entries
            panelsByDimension.forEach((panels, dimension) => {
                const fullPanels = panels.filter(p => !p.is_cut_panel);
                const cutPanels = panels.filter(p => p.is_cut_panel);
                
                // Get the room for this panel to access floor_thickness
                const room = rooms.find(r => r.id === parseInt(roomId));
                const floorThickness = room?.floor_thickness || 20; // Default to 20mm if not specified
                
                if (fullPanels.length > 0) {
                    const panel = fullPanels[0];
                    const isVertical = panel.width >= panel.length;
                    
                    // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
                    let displayWidth = panel.width;
                    let displayLength = panel.length;
                    
                    if (isVertical) {
                        // Swap values for vertical orientation
                        displayWidth = panel.length;
                        displayLength = panel.width;
                    }
                    
                    panelList.push({
                        width: displayWidth,
                        length: displayLength,
                        thickness: floorThickness,
                        quantity: fullPanels.length,
                        type: 'Full'
                    });
                }
                
                if (cutPanels.length > 0) {
                    const panel = cutPanels[0];
                    const isVertical = panel.width >= panel.length;
                    
                    // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
                    let displayWidth = panel.width;
                    let displayLength = panel.length;
                    
                    if (isVertical) {
                        // Swap values for vertical orientation
                        displayWidth = panel.length;
                        displayLength = panel.width;
                    }
                    
                    panelList.push({
                        width: displayWidth,
                        length: displayLength,
                        thickness: floorThickness,
                        quantity: cutPanels.length,
                        type: 'Cut'
                    });
                }
            });
        });
        
        return panelList;
    };

    const loadExistingFloorPlan = async () => {
        try {
            const planResponse = await api.get(`/floor-plans/?project=${parseInt(projectId)}`);
            if (planResponse.data && planResponse.data.length > 0) {
                const existingPlan = planResponse.data[0];
                
                // Load panels for the existing plan
                const panelsResponse = await api.get(`/floor-panels/?project=${parseInt(projectId)}`);
                const panels = panelsResponse.data || [];
                
                console.log('Loaded existing floor plan:', existingPlan);
                console.log('Loaded floor panels:', panels);
                
                // Ensure the floorPlan object has proper panel count data
                const enhancedPlan = {
                    ...existingPlan,
                    total_panels: panels.length,
                    floor_panels: panels, // Store panels in floor_panels for consistency
                };
                
                setFloorPlan(enhancedPlan);
                setFloorPanels(panels);
                
                // CRITICAL: Load saved generation parameters to restore UI state
                // Load waste percentage from existing plan
                if (existingPlan.summary?.project_waste_percentage !== undefined && existingPlan.summary?.project_waste_percentage !== null) {
                    setProjectWastePercentage(existingPlan.summary.project_waste_percentage);
                    console.log('📊 [FLOOR INITIAL LOAD] Loaded existing waste % from floor plan:', existingPlan.summary.project_waste_percentage);
                } else if (existingPlan.waste_percentage !== undefined && existingPlan.waste_percentage !== null) {
                    setProjectWastePercentage(existingPlan.waste_percentage);
                    console.log('📊 [FLOOR INITIAL LOAD] Loaded legacy waste % from floor plan:', existingPlan.waste_percentage);
                }

                if (existingPlan.orientation_strategy) {
                    setSelectedOrientationStrategy(existingPlan.orientation_strategy);
                }
                if (existingPlan.panel_width) {
                    setPanelWidth(existingPlan.panel_width);
                }
                if (existingPlan.panel_length) {
                    // Check if panel_length is 'auto' or a numeric value
                    if (existingPlan.panel_length === 'auto') {
                        setPanelLength('auto');
                    } else {
                        // It's a custom value, set dropdown to 'custom' and use the value
                        setPanelLength('custom');
                        setCustomPanelLength(existingPlan.panel_length);
                    }
                }
                if (existingPlan.custom_panel_length) {
                    setCustomPanelLength(existingPlan.custom_panel_length);
                }

            }
        } catch (error) {
            console.error('Error loading floor plan:', error);
        }
    };

    const loadOrientationAnalysis = async () => {
        try {
            const response = await api.post('/floor-plans/analyze_floor_orientations/', {
                project_id: parseInt(projectId),
                panel_width: panelWidth,
                panel_length: panelLength === 'auto' ? 'auto' : customPanelLength
            });
            
            if (response.data && !response.data.error) {
                setOrientationAnalysis(response.data);
                // Only update strategy if no floor plan exists yet
                if (!floorPlan) {
                    setSelectedOrientationStrategy(response.data.recommended_strategy);
                }
            }
        } catch (error) {
            console.error('Error loading orientation analysis:', error);
        }
    };

    const generateFloorPlan = async () => {
        if (!projectId) {
            setError('No project selected');
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            const response = await api.post('/floor-plans/generate_floor_plan/', {
                project_id: parseInt(projectId),
                orientation_strategy: selectedOrientationStrategy,
                panel_width: panelWidth,
                panel_length: panelLength === 'auto' ? 'auto' : customPanelLength,
                custom_panel_length: panelLength === 'auto' ? null : customPanelLength
            });

            if (response.data && !response.data.error) {
                console.log('🚀 Floor plan generation response:', response.data);
                console.log('   - floor_panels field:', response.data.floor_panels);
                console.log('   - floor_plans field:', response.data.floor_plans);
                
                // Extract the floor plan summary for the project
                // Create a unified floor plan object with PROJECT-LEVEL statistics
                const unifiedFloorPlan = {
                    // From the generation response
                    ...response.data,
                    
                    // Use PROJECT-LEVEL statistics (aggregate of all rooms), NOT first room only!
                    total_panels: response.data.summary?.total_panels || response.data.floor_panels?.length || 0,
                    full_panels: response.data.floor_panels?.filter(p => !p.is_cut_panel).length || 0,
                    cut_panels: response.data.floor_panels?.filter(p => p.is_cut_panel).length || 0,
                    waste_percentage: response.data.summary?.average_waste_percentage || 0,
                    
                    // Ensure we have the correct strategy fields for UI display
                    orientation_strategy: response.data.strategy_used || response.data.recommended_strategy || 'auto',
                    
                    // Keep the generation response data
                    floor_panels: response.data.floor_panels,
                    floor_plans: response.data.floor_plans,  // Keep individual room plans
                    leftover_stats: response.data.leftover_stats,
                    summary: response.data.summary
                };
                
                setFloorPlan(unifiedFloorPlan);
                
                // Cache project-wide waste percentage for immediate UI update
                if (response?.data?.summary?.project_waste_percentage !== undefined && response?.data?.summary?.project_waste_percentage !== null) {
                    setProjectWastePercentage(response.data.summary.project_waste_percentage);
                    console.log('📊 [FLOOR UI] Cached project-wide waste % from POST:', response.data.summary.project_waste_percentage);
                }
                
                // Set floor panels from response
                const panels = response.data.floor_panels || [];
                console.log('   - Setting floor panels:', panels);
                setFloorPanels(panels);
                
                clearRegenerationFlag(); // Clear the regeneration flag
                
                if (onFloorPlanGenerated) {
                    onFloorPlanGenerated(response.data);
                }
                
                // Share floor panel data with other tabs
                if (updateSharedPanelData) {
                    // Process the raw panel data to match the table structure
                    const processedPanels = processFloorPanelsForSharing(panels, allRooms);
                    updateSharedPanelData('floor-plan', processedPanels);
                }
            } else {
                setError(response.data?.error || 'Failed to generate floor plan');
            }
        } catch (error) {
            console.error('Error generating floor plan:', error);
            setError(error.response?.data?.error || 'Failed to generate floor plan');
        } finally {
            setIsGenerating(false);
        }
    };

    // Handle panel dimension changes
    const handlePanelWidthChange = (newWidth) => {
        setPanelWidth(newWidth);
        if (floorPlan) {
            setPlanNeedsRegeneration(true);
        }
    };
    
    const handlePanelLengthChange = (newLength) => {
        setPanelLength(newLength);
        if (floorPlan) {
            setPlanNeedsRegeneration(true);
        }
    };
    
    const handleCustomPanelLengthChange = (newLength) => {
        setCustomPanelLength(newLength);
        if (floorPlan) {
            setPlanNeedsRegeneration(true);
        }
    };
    



    
    // Clear regeneration flag when plan is generated
    const clearRegenerationFlag = () => {
        setPlanNeedsRegeneration(false);
    };

    if (!projectId) {
        return (
            <div className="text-center py-8">
                <div className="text-gray-500">No project selected for floor planning</div>
            </div>
        );
    }

    return (
        <div className="floor-manager bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="bg-white shadow-sm border-b border-gray-200 p-6 ml-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Floor Plan Generator</h1>
                        <p className="text-gray-600 mt-2">
                            Generate optimal floor panel layouts with orientation strategies to minimize waste
                        </p>
                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <div className="flex items-center">
                                <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-blue-800 text-sm">
                                    <strong>Note:</strong> Floor plans are only generated for rooms with <code className="bg-blue-100 px-1 rounded">floor_type = "panel"</code>. 
                                    Rooms with <code className="bg-blue-100 px-1 rounded">floor_type = "slab"</code> or other types do not need floor plans.
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    {planNeedsRegeneration && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <div className="flex items-center">
                                <svg className="w-5 h-5 text-yellow-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                                <span className="text-yellow-800 font-medium">
                                    Floor plan needs regeneration due to parameter changes
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Control Panel */}
            <div className="p-6 ml-8">
                {/* Dimension visibility checkboxes */}
                <div className="mb-4 flex items-center space-x-4">
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            checked={dimensionVisibility.room}
                            onChange={() => toggleDimensionVisibility('room')}
                        />
                        <span className="text-sm text-gray-700">Room dimensions</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            checked={dimensionVisibility.panel}
                            onChange={() => toggleDimensionVisibility('panel')}
                        />
                        <span className="text-sm text-gray-700">Panel dimensions</span>
                    </label>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    {/* Strategy Selection */}
                    <div className="control-card">
                        <label className="block text-sm font-semibold text-gray-700 mb-3">
                            <svg className="w-4 h-4 inline mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            Strategy
                        </label>
                        <div className="space-y-3">
                            <div className="flex items-center space-x-3">
                                <label className="text-sm font-medium text-gray-700">Orientation:</label>
                                <select
                                    value={selectedOrientationStrategy}
                                    onChange={(e) => setSelectedOrientationStrategy(e.target.value)}
                                    className="flex-1"
                                >
                                    <option value="auto">🔄 Auto (Recommended)</option>
                                    <option value="all_horizontal">➡️ All Horizontal</option>
                                    <option value="all_vertical">⬇️ All Vertical</option>
                                    <option value="room_optimal">🎯 Room Optimal</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Panel Dimensions */}
                    <div className="control-card">
                        <label className="block text-sm font-semibold text-gray-700 mb-3">
                            <svg className="w-4 h-4 inline mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                            Panel Dimensions
                        </label>
                        <div className="space-y-3">
                            <div className="flex items-center space-x-3">
                                <label className="text-sm font-medium text-gray-700">Width:</label>
                                <input
                                    type="number"
                                    value={panelWidth}
                                    onChange={(e) => handlePanelWidthChange(parseInt(e.target.value))}
                                    className="flex-1"
                                    min="100"
                                    max="2000"
                                    step="50"
                                />
                                <span className="text-xs text-gray-500">mm</span>
                            </div>
                            
                            <div className="flex items-center space-x-3">
                                <label className="text-sm font-medium text-gray-700">Length:</label>
                                <select
                                    value={panelLength}
                                    onChange={(e) => handlePanelLengthChange(e.target.value)}
                                    className="flex-1"
                                >
                                    <option value="auto">🔄 Auto (Optimal)</option>
                                    <option value="custom">✏️ Custom</option>
                                </select>
                            </div>
                            
                            {panelLength === 'custom' && (
                                <div className="flex items-center space-x-3">
                                    <label className="text-sm font-medium text-gray-700">Custom:</label>
                                    <input
                                        type="number"
                                        value={customPanelLength}
                                        onChange={(e) => handleCustomPanelLengthChange(parseInt(e.target.value))}
                                        className="flex-1"
                                        min="500"
                                        max="15000"
                                        step="100"
                                    />
                                    <span className="text-xs text-gray-500">mm</span>
                                </div>
                            )}
                        </div>
                    </div>



                    {/* Wall Thickness Info */}
                    <div className="control-card bg-blue-50 border-blue-200">
                        <label className="block text-sm font-semibold text-blue-700 mb-3">
                            <svg className="w-4 h-4 inline mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Wall Thickness
                        </label>
                        <div className="text-sm text-blue-700">
                            <div className="flex items-center space-x-2">
                                <span>Current: {projectData?.wall_thickness || 200}mm</span>
                            </div>
                            <p className="text-xs text-blue-600 mt-1">
                                Floor panels will automatically exclude wall areas using this thickness
                            </p>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-between space-y-3 sm:space-y-0 sm:space-x-4 mt-6 ml-4">
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={generateFloorPlan}
                            disabled={isGenerating}
                            className="btn-generate px-8 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl font-semibold hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl"
                        >
                            {isGenerating ? (
                                <div className="flex items-center space-x-2">
                                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Generating...</span>
                                </div>
                            ) : (
                                <div className="flex items-center space-x-2">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                    </svg>
                                    <span>Generate Floor Plan</span>
                                </div>
                            )}
                        </button>
                        
                        {floorPlan && (
                            <button
                                onClick={generateFloorPlan}
                                disabled={isGenerating}
                                className="btn-regenerate px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Regenerate
                            </button>
                        )}
                    </div>
                    
                    {planNeedsRegeneration && (
                        <div className="text-sm text-yellow-600 bg-yellow-50 px-3 py-2 rounded-lg">
                            ⚠️ Parameters changed - regenerate for updated plan
                        </div>
                    )}
                </div>
                
                {/* Error Display */}
                {error && (
                    <div className="mt-3 p-3 bg-red-100 border border-red-300 text-red-700 rounded-lg">
                        {error}
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="p-6 pl-8">
                {floorPlan ? (
                    <div className="space-y-6">
                        {/* Canvas */}
                        <FloorCanvas
                            rooms={allRooms}
                            walls={allWalls}
                            intersections={allIntersections}
                            floorPlan={floorPlan}
                            floorPanels={floorPanels}
                            projectData={projectData}
                            projectWastePercentage={projectWastePercentage}
                            dimensionVisibility={dimensionVisibility}

                            floorPanelsMap={(() => {
                                // Convert floorPanels array to floorPanelsMap format
                                const panelsMap = {};
                                if (floorPanels && Array.isArray(floorPanels)) {
                                    console.log('Floor panels data:', floorPanels);
                                    floorPanels.forEach(panel => {
                                        // Handle both room_id (from serializer) and room (from model)
                                        let roomId = panel.room_id;
                                        if (!roomId && panel.room) {
                                            roomId = typeof panel.room === 'object' ? panel.room.id : panel.room;
                                        }
                                        
                                        if (roomId) {
                                            if (!panelsMap[roomId]) {
                                                panelsMap[roomId] = [];
                                            }
                                            panelsMap[roomId].push(panel);
                                        } else {
                                            console.log('⚠️ Panel has no room ID:', panel);
                                        }
                                    });
                                }
                                
                                console.log('Floor panels map:', panelsMap);
                                return panelsMap;
                            })()}
                            orientationAnalysis={orientationAnalysis}
                        />
                        
                        {/* Debug info */}
                        {/* <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
                            <div>Debug Info:</div>
                            <div>Rooms: {allRooms.length}</div>
                            <div>Walls: {allWalls.length}</div>
                            <div>Floor Plan: {floorPlan ? 'Yes' : 'No'}</div>
                            <div>Panels: {floorPanels.length}</div>
                            <div>Panel Width: {panelWidth}mm</div>
                            <div>Panel Length: {panelLength === 'auto' ? 'Auto' : `${customPanelLength}mm`}</div>

                            <div className="mt-2 pt-2 border-t border-gray-300">
                                <div className="font-semibold">Room Floor Types:</div>
                                {allRooms.map(room => (
                                    <div key={room.id} className={`ml-2 ${room.floor_type === 'panel' || room.floor_type === 'Panel' ? 'text-green-700' : 'text-gray-500'}`}>
                                        {room.room_name}: {room.floor_type || 'none'} {room.floor_type === 'panel' || room.floor_type === 'Panel' ? '✅' : '❌'}
                                    </div>
                                ))}
                            </div>

                            <div className="mt-2 pt-2 border-t border-gray-300">
                                <div className="font-semibold">Floor Panel Generation:</div>
                                <div>Wall thickness deduction: {projectData?.wall_thickness || 200}mm</div>
                                <div>Floor area excludes wall boundaries</div>
                                <div>All panels maintain original dimensions</div>
                                <div className="text-blue-700 font-medium">Only rooms with floor_type = "panel" generate floor plans</div>
                            </div>
                        </div> */}
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <div className="text-gray-400 mb-4">
                            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                            No Floor Plan Generated
                        </h3>
                        <p className="text-gray-600 mb-4">
                            Generate a floor plan to automatically create optimal panel layout with the best orientation strategy.
                        </p>
                        <button
                            onClick={generateFloorPlan}
                            disabled={isGenerating}
                            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isGenerating ? 'Generating...' : 'Generate Floor Plan'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FloorManager;
