import React, { useState, useEffect, useMemo } from 'react';
import CeilingCanvas from '../canvas/CeilingCanvas';
import api from '../../api/api';

const CeilingManager = ({ projectId, onClose, onCeilingPlanGenerated, updateSharedPanelData = null }) => {
    // Essential state for project-level ceiling planning
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState(null);

    
    // Project-level data
    const [allRooms, setAllRooms] = useState([]);
    const [allWalls, setAllWalls] = useState([]);
    const [allIntersections, setAllIntersections] = useState([]);
    const [ceilingPlan, setCeilingPlan] = useState(null);
    const [ceilingPanels, setCeilingPanels] = useState([]);
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
    const [ceilingThickness, setCeilingThickness] = useState(150);
    
    // Support configuration
    const [supportType, setSupportType] = useState('nylon'); // 'nylon' or 'alu'
    const [nylonHangerOptions, setNylonHangerOptions] = useState({
        includeAccessories: false,
        includeCable: false
    });
    const [aluSuspensionCustomDrawing, setAluSuspensionCustomDrawing] = useState(false);
    
    // Track if current plan needs regeneration due to dimension changes
    const [planNeedsRegeneration, setPlanNeedsRegeneration] = useState(false);

    // Room selection state
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [showAllRooms, setShowAllRooms] = useState(true);
    const [showRoomDetails, setShowRoomDetails] = useState(false);
    
    // Handle room selection from canvas click
    const handleRoomSelection = (roomId) => {
        setSelectedRoomId(roomId);
        setShowAllRooms(false); // Switch to single room view
        setShowRoomDetails(true); // Auto-expand details
    };
    
    // Handle deselection (return to all rooms view)
    const handleRoomDeselection = () => {
        setSelectedRoomId(null);
        setShowAllRooms(true);
        setShowRoomDetails(false);
    };
    
    // Room-specific editing state
    const [roomEditConfig, setRoomEditConfig] = useState({
        ceilingThickness: ceilingThickness,
        panelWidth: panelWidth,
        panelLength: panelLength,
        customPanelLength: customPanelLength,
        orientationStrategy: selectedOrientationStrategy
    });
    const [isRegeneratingRoom, setIsRegeneratingRoom] = useState(false);
    const [roomRegenerationSuccess, setRoomRegenerationSuccess] = useState(false);

    useEffect(() => {
        if (projectId) {
            loadProjectData();
        }
    }, [projectId]);
    
    // Sync room edit config when room is selected - use room's current ceiling plan settings if available
    useEffect(() => {
        if (selectedRoomId) {
            const selectedRoom = allRooms.find(r => r.id === selectedRoomId);
            if (selectedRoom && selectedRoom.ceiling_plan) {
                // Use the room's current ceiling plan settings
                setRoomEditConfig({
                    ceilingThickness: selectedRoom.ceiling_plan.ceiling_thickness || ceilingThickness,
                    panelWidth: selectedRoom.ceiling_plan.panel_width || panelWidth,
                    panelLength: selectedRoom.ceiling_plan.panel_length || panelLength,
                    customPanelLength: selectedRoom.ceiling_plan.custom_panel_length || customPanelLength,
                    orientationStrategy: selectedRoom.ceiling_plan.orientation_strategy || selectedOrientationStrategy
                });
            } else {
                // Use global settings as fallback
                setRoomEditConfig({
                    ceilingThickness: ceilingThickness,
                    panelWidth: panelWidth,
                    panelLength: panelLength,
                    customPanelLength: customPanelLength,
                    orientationStrategy: selectedOrientationStrategy
                });
            }
        }
    }, [selectedRoomId, allRooms, ceilingThickness, panelWidth, panelLength, customPanelLength, selectedOrientationStrategy]);

    const loadProjectData = async () => {
        try {
            // Load project data first
            const projectResponse = await api.get(`/projects/${parseInt(projectId)}/`);
            setProjectData(projectResponse.data || null);
            
            // Load rooms
            const roomsResponse = await api.get(`/rooms/?project=${parseInt(projectId)}`);
            setAllRooms(roomsResponse.data || []);
            
            // Load walls
            const wallsResponse = await api.get(`/walls/?project=${parseInt(projectId)}`);
            console.log('Walls loaded:', wallsResponse.data);
            setAllWalls(wallsResponse.data || []);
            
            // Load intersections for the project
            const intersectionsResponse = await api.get(`/intersections/?project=${parseInt(projectId)}`);
            console.log('Intersections loaded:', intersectionsResponse.data);
            setAllIntersections(intersectionsResponse.data || []);
            
            // Load existing ceiling plan if any
            await loadExistingCeilingPlan();
            
            // Load orientation analysis
            await loadOrientationAnalysis();
        } catch (error) {
            console.error('Error loading project data:', error);
        }
    };

    // Process ceiling panels for sharing with other tabs (matches table structure)
    const processCeilingPanelsForSharing = (panels, rooms) => {
        if (!panels || panels.length === 0) return [];
        
        // Group panels by dimensions (width, length, thickness)
        const panelsByDimension = new Map();
        panels.forEach(panel => {
            // Use panel thickness if available, otherwise use the current ceiling thickness setting
            const panelThickness = panel.thickness || ceilingThickness;
            
            // SWAP: For vertical panels, swap width and length values (keep horizontal unchanged)
            const isVertical = panel.width >= panel.length;
            let displayWidth = panel.width;
            let displayLength = panel.length;
            
            if (isVertical) {
                // Swap values for vertical orientation
                displayWidth = panel.length;
                displayLength = panel.width;
            }
            
            const key = `${displayWidth}_${displayLength}_${panelThickness}`;
            if (!panelsByDimension.has(key)) {
                panelsByDimension.set(key, {
                    width: displayWidth,
                    length: displayLength,
                    thickness: panelThickness,
                    quantity: 0
                });
            }
            panelsByDimension.get(key).quantity++;
        });

        // Convert to array and sort by quantity (descending)
        const panelList = Array.from(panelsByDimension.values())
            .sort((a, b) => b.quantity - a.quantity);

        return panelList;
    };

    const loadExistingCeilingPlan = async () => {
        try {
            const planResponse = await api.get(`/ceiling-plans/?project=${parseInt(projectId)}`);
            if (planResponse.data && planResponse.data.length > 0) {
                const existingPlan = planResponse.data[0];
                
                // Load panels for the existing plan
                const panelsResponse = await api.get(`/ceiling-panels/?project=${parseInt(projectId)}`);
                const panels = panelsResponse.data || [];
                
                // Ensure the ceilingPlan object has proper panel count data
                const enhancedPlan = {
                    ...existingPlan,
                    total_panels: panels.length,
                    enhanced_panels: panels, // Store panels in enhanced_panels for consistency
                    ceiling_panels: panels  // Also store in ceiling_panels as backup
                };
                
                setCeilingPlan(enhancedPlan);
                setCeilingPanels(panels);
                
                // CRITICAL: Load saved generation parameters to restore UI state
                if (existingPlan.ceiling_thickness) {
                    setCeilingThickness(existingPlan.ceiling_thickness);
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
                if (existingPlan.support_type) {
                    setSupportType(existingPlan.support_type);
                }
                if (existingPlan.support_config) {
                    if (existingPlan.support_type === 'nylon') {
                        setNylonHangerOptions({
                            includeAccessories: existingPlan.support_config.includeAccessories || false,
                            includeCable: existingPlan.support_config.includeCable || false
                        });
                    } else if (existingPlan.support_type === 'alu') {
                        setAluSuspensionCustomDrawing(existingPlan.support_config.aluSuspensionCustomDrawing || false);
                    }
                }
            }
        } catch (error) {
            console.error('Error loading ceiling plan:', error);
        }
    };

    const loadOrientationAnalysis = async () => {
        try {
            const response = await api.post('/ceiling-plans/analyze_orientations/', {
                project_id: parseInt(projectId),
                panel_width: panelWidth,
                panel_length: panelLength === 'auto' ? 'auto' : customPanelLength,
                ceiling_thickness: ceilingThickness
            });
            
            if (response.data && !response.data.error) {
                setOrientationAnalysis(response.data);
                setSelectedOrientationStrategy(response.data.recommended_strategy);
            }
        } catch (error) {
            console.error('Error loading orientation analysis:', error);
        }
    };

    // Generate ceiling plan for a specific room only
    const generateCeilingPlanForRoom = async (roomId, config) => {
        setIsRegeneratingRoom(true);
        setError(null);
        setRoomRegenerationSuccess(false);

        console.log('🔄 Regenerating ceiling plan for room:', roomId);
        console.log('📊 Configuration:', config);

        try {
            // Send room-specific configuration to backend
            const response = await api.post('/ceiling-plans/generate_enhanced_ceiling_plan/', {
                project_id: parseInt(projectId),
                orientation_strategy: selectedOrientationStrategy,
                panel_width: panelWidth,  // Global panel width (for other rooms)
                panel_length: panelLength,  // Global panel length (for other rooms)
                ceiling_thickness: ceilingThickness,  // Global thickness (for other rooms)
                custom_panel_length: customPanelLength,  // Global custom length (for other rooms)
                support_type: supportType,
                support_config: {
                    ...nylonHangerOptions,
                    aluSuspensionCustomDrawing
                },
                // Room-specific configuration - ONLY this room will use these settings
                room_specific_config: {
                    room_id: roomId,
                    panel_width: config.panelWidth,
                    panel_length: config.panelLength === 'auto' ? 'auto' : config.customPanelLength,
                    ceiling_thickness: config.ceilingThickness,
                    custom_panel_length: config.panelLength === 'auto' ? null : config.customPanelLength,
                    orientation_strategy: config.orientationStrategy,
                    support_type: supportType,
                    support_config: {
                        ...nylonHangerOptions,
                        aluSuspensionCustomDrawing
                    }
                }
            });
            
            console.log('✅ API Response:', response.data);

            // Check if we have the expected data structure
            // Backend returns: enhanced_panels, ceiling_plans, strategy_used, etc.
            if (response.data.enhanced_panels || response.data.ceiling_plans) {
                console.log('✅ Ceiling plan generated successfully');
                
                // The backend returns enhanced_panels (with room assignments)
                const newPanels = response.data.enhanced_panels || [];
                console.log(`📦 Received ${newPanels.length} panels`);
                
                // NEW: cache project-wide waste percentage for immediate UI update
                if (response?.data?.summary?.project_waste_percentage !== undefined && response?.data?.summary?.project_waste_percentage !== null) {
                    setProjectWastePercentage(response.data.summary.project_waste_percentage);
                    console.log('📊 [UI] Cached project-wide waste % from POST:', response.data.summary.project_waste_percentage);
                }
                
                // Update ceiling plan (take the first one or the one for this room)
                if (response.data.ceiling_plans && response.data.ceiling_plans.length > 0) {
                    // Try to find the ceiling plan for the selected room
                    const roomCeilingPlan = response.data.ceiling_plans.find(cp => cp.room_id === roomId);
                    setCeilingPlan(roomCeilingPlan || response.data.ceiling_plans[0]);
                }
                
                // Update all panels
                setCeilingPanels(newPanels);
                
                // Reload project data to ensure we have the latest data
                await loadExistingCeilingPlan();
                
                // Update shared panel data if callback provided
                if (updateSharedPanelData) {
                    const processedPanels = processCeilingPanelsForSharing(newPanels, allRooms);
                    updateSharedPanelData('ceiling', processedPanels);
                }

                // Notify parent if callback provided
                if (onCeilingPlanGenerated) {
                    onCeilingPlanGenerated({
                        ceiling_plans: response.data.ceiling_plans,
                        ceiling_panels: newPanels,
                        room_id: roomId
                    });
                }
                
                console.log('✅ State updated successfully');
                
                // Reload the room data to get updated ceiling plan details
                const roomsResponse = await api.get(`/rooms/?project=${parseInt(projectId)}`);
                setAllRooms(roomsResponse.data || []);
                console.log('✅ Room data reloaded');
                
                // Update the roomEditConfig to reflect the new values from the database
                const updatedRoom = roomsResponse.data.find(r => r.id === roomId);
                if (updatedRoom && updatedRoom.ceiling_plan) {
                    setRoomEditConfig({
                        ceilingThickness: updatedRoom.ceiling_plan.ceiling_thickness,
                        panelWidth: updatedRoom.ceiling_plan.panel_width,
                        panelLength: updatedRoom.ceiling_plan.panel_length,
                        customPanelLength: updatedRoom.ceiling_plan.custom_panel_length,
                        orientationStrategy: updatedRoom.ceiling_plan.orientation_strategy
                    });
                    console.log('✅ Room edit config updated with new values from database');
                }
                
                // Show success message
                setRoomRegenerationSuccess(true);
                setTimeout(() => setRoomRegenerationSuccess(false), 3000);
            } else {
                console.error('❌ API returned unexpected response structure:', response.data);
                setError('Failed to generate ceiling plan. Please try again.');
            }
        } catch (error) {
            console.error('❌ Error regenerating ceiling plan for room:', error);
            console.error('Error details:', error.response?.data);
            const errorMessage = error.response?.data?.error || error.message || 'Failed to regenerate ceiling plan for this room. Please try again.';
            setError(errorMessage);
        } finally {
            console.log('🏁 Finished regeneration process');
            setIsRegeneratingRoom(false);
        }
    };

    const generateCeilingPlan = async () => {
        if (!projectId) {
            setError('No project selected');
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            const response = await api.post('/ceiling-plans/generate_enhanced_ceiling_plan/', {
                project_id: parseInt(projectId),
                orientation_strategy: selectedOrientationStrategy,
                panel_width: panelWidth,
                panel_length: panelLength === 'auto' ? 'auto' : customPanelLength,
                ceiling_thickness: ceilingThickness,
                custom_panel_length: panelLength === 'auto' ? null : customPanelLength,
                support_type: supportType,
                support_config: {
                    ...nylonHangerOptions,
                    aluSuspensionCustomDrawing
                }
            });

            if (response.data && !response.data.error) {
                setCeilingPlan(response.data);
                setCeilingPanels(response.data.enhanced_panels || []);
                if (response?.data?.summary?.project_waste_percentage !== undefined && response?.data?.summary?.project_waste_percentage !== null) {
                    setProjectWastePercentage(response.data.summary.project_waste_percentage);
                    console.log('📊 [UI] Cached project-wide waste % from POST (full generate):', response.data.summary.project_waste_percentage);
                }
                clearRegenerationFlag(); // Clear the regeneration flag
                
                if (onCeilingPlanGenerated) {
                    onCeilingPlanGenerated(response.data);
                }
                
                // Share ceiling panel data with other tabs
                if (updateSharedPanelData) {
                    // Process the raw panel data to match the table structure
                    const processedPanels = processCeilingPanelsForSharing(response.data.enhanced_panels || [], allRooms);
                    
                    // Share both the processed panels and support information
                    updateSharedPanelData('ceiling-plan', processedPanels, {
                        supportType: supportType,
                        includeAccessories: nylonHangerOptions.includeAccessories,
                        includeCable: nylonHangerOptions.includeCable,
                        aluSuspensionCustomDrawing: aluSuspensionCustomDrawing,
                        panelsNeedSupport: panelsNeedSupport,
                        // Room selection information
                        selectedRoomId: selectedRoomId,
                        showAllRooms: showAllRooms,
                        roomCount: allRooms.length
                    });
                }
            } else {
                setError(response.data?.error || 'Failed to generate ceiling plan');
            }
        } catch (error) {
            console.error('Error generating ceiling plan:', error);
            setError(error.response?.data?.error || 'Failed to generate ceiling plan');
        } finally {
            setIsGenerating(false);
        }
    };


    
    // Handle panel dimension changes
    const handlePanelWidthChange = (newWidth) => {
        setPanelWidth(newWidth);
        if (ceilingPlan) {
            setPlanNeedsRegeneration(true);
        }
    };
    
    const handlePanelLengthChange = (newLength) => {
        setPanelLength(newLength);
        if (ceilingPlan) {
            setPlanNeedsRegeneration(true);
        }
    };
    
    const handleCustomPanelLengthChange = (newLength) => {
        setCustomPanelLength(newLength);
        if (ceilingPlan) {
            setPlanNeedsRegeneration(true);
        }
    };
    
    const handleCeilingThicknessChange = (newThickness) => {
        setCeilingThickness(newThickness);
        if (ceilingPlan) {
            setPlanNeedsRegeneration(true);
        }
    };
    
    // Clear regeneration flag when plan is generated
    const clearRegenerationFlag = () => {
        setPlanNeedsRegeneration(false);
    };

    // Check if any panels need support (over 6000mm) - matches CeilingCanvas logic
    const panelsNeedSupport = useMemo(() => {
        if (!ceilingPanels || ceilingPanels.length === 0) return false;

        // Determine panel orientation from the first available panel
        let isHorizontalOrientation = false;
        if (ceilingPanels.length > 0) {
            isHorizontalOrientation = ceilingPanels[0].width > ceilingPanels[0].length;
        }

        // Check if any panels need support based on orientation
        for (const panel of ceilingPanels) {
            const needsSupport = isHorizontalOrientation ? 
                panel.width > 6000 :  // Horizontal: check width
                panel.length > 6000;  // Vertical: check length
            
            if (needsSupport) {
                return true;
            }
        }
        
        return false;
    }, [ceilingPanels]);

    if (!projectId) {
        return (
            <div className="p-6 bg-white rounded-lg shadow-lg">
                <div className="text-center text-gray-500">
                    No project selected for ceiling planning
                </div>
            </div>
        );
    }

    return (
        <div className="ceiling-manager">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 ml-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">
                            Project Ceiling Plan
                        </h2>
                        <p className="text-sm text-gray-600">
                            Generate optimal ceiling panel layout for the entire project
                        </p>
                    </div>
                    
                    {/* Room Selection Controls */}
                    {allRooms.length > 1 && (
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2">
                                <label className="text-sm font-medium text-gray-700">View:</label>
                                <select
                                    value={showAllRooms ? 'all' : selectedRoomId || ''}
                                    onChange={(e) => {
                                        if (e.target.value === 'all') {
                                            setShowAllRooms(true);
                                            setSelectedRoomId(null);
                                        } else {
                                            setShowAllRooms(false);
                                            setSelectedRoomId(parseInt(e.target.value));
                                        }
                                    }}
                                    className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="all">All Rooms</option>
                                    {allRooms.map(room => (
                                        <option key={room.id} value={room.id}>
                                            {room.room_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            
                            {!showAllRooms && selectedRoomId && (
                                <div className="text-sm text-gray-600">
                                    <span className="font-medium">Selected:</span> {allRooms.find(r => r.id === selectedRoomId)?.room_name}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

                        {/* Controls */}
            <div className="control-panel ml-8">
                {/* Main Controls Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 control-grid ml-4">
                    {/* Strategy Selection */}
                    <div className="control-card">
                        <label className="block text-sm font-semibold text-gray-700 mb-3">
                            <svg className="w-4 h-4 inline mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            Orientation Strategy
                        </label>
                        <select
                            value={selectedOrientationStrategy}
                            onChange={(e) => setSelectedOrientationStrategy(e.target.value)}
                            className="w-full"
                        >
                            <option value="auto">🚀 Auto (Recommended)</option>
                            <option value="all_vertical">⬇️ All Vertical (Up/Down)</option>
                            <option value="all_horizontal">➡️ All Horizontal (Left/Right)</option>
                            <option value="room_optimal">🏠 Room Optimal (Best per room)</option>
                            {/* <option value="project_merged">🔗 Project Merged (Same height)</option> */}
                        </select>
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
                                <label className="text-xs font-medium text-gray-600 min-w-[80px]">Width:</label>
                                <input
                                    type="number"
                                    min="100"
                                    max="3000"
                                    step="50"
                                    value={panelWidth}
                                    onChange={(e) => handlePanelWidthChange(parseInt(e.target.value))}
                                    className="flex-1"
                                    placeholder="1150"
                                />
                                <span className="text-xs text-gray-500">mm</span>
                            </div>
                            
                            <div className="flex items-center space-x-3">
                                <label className="text-xs font-medium text-gray-600 min-w-[80px]">Length:</label>
                                <select
                                    value={panelLength}
                                    onChange={(e) => handlePanelLengthChange(e.target.value)}
                                    className="flex-1"
                                >
                                    <option value="auto">🔄 Auto (Project)</option>
                                    <option value="custom">✏️ Custom</option>
                                </select>
                            </div>
                            
                            {panelLength === 'custom' && (
                                <div className="flex items-center space-x-3">
                                    <label className="text-xs font-medium text-gray-600 min-w-[80px]">Custom:</label>
                                    <input
                                        type="number"
                                        min="1000"
                                        max="20000"
                                        step="100"
                                        value={customPanelLength}
                                        onChange={(e) => handleCustomPanelLengthChange(parseInt(e.target.value))}
                                        className="flex-1"
                                        placeholder="5000"
                                    />
                                    <span className="text-xs text-gray-500">mm</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Ceiling Configuration */}
                    <div className="control-card">
                        <label className="block text-sm font-semibold text-gray-700 mb-3">
                            <svg className="w-4 h-4 inline mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            Ceiling Settings
                        </label>
                        <div className="space-y-3">
                            <div className="flex items-center space-x-3">
                                <label className="text-xs font-medium text-gray-600 min-w-[80px]">Thickness:</label>
                                <input
                                    type="number"
                                    min="50"
                                    max="500"
                                    step="10"
                                    value={ceilingThickness}
                                    onChange={(e) => handleCeilingThicknessChange(parseInt(e.target.value))}
                                    className="flex-1"
                                    placeholder="150"
                                />
                                <span className="text-xs text-gray-500">mm</span>
                            </div>
                            

                        </div>
                    </div>
                </div>

                {/* Support Configuration Row */}
                {panelsNeedSupport ? (
                    <div className="control-card ml-4">
                        <label className="block text-sm font-semibold text-gray-700 mb-3">
                            <svg className="w-4 h-4 inline mr-2 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            Support Configuration
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-3">
                                <div className="flex items-center space-x-3">
                                    <label className="text-sm font-medium text-gray-700">Support Type:</label>
                                    <select
                                        value={supportType}
                                        onChange={(e) => setSupportType(e.target.value)}
                                        className="flex-1"
                                    >
                                        <option value="nylon">🧵 Nylon Hanger (Auto)</option>
                                        <option value="alu">🔧 Alu Suspension (Custom)</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div className="space-y-3">
                                {/* Nylon Hanger Options */}
                                {supportType === 'nylon' && (
                                    <div className="flex items-center space-x-4">
                                        <label className="flex items-center space-x-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={nylonHangerOptions.includeAccessories}
                                                onChange={(e) => setNylonHangerOptions(prev => ({
                                                    ...prev,
                                                    includeAccessories: e.target.checked
                                                }))}
                                            />
                                            <span className="text-sm text-gray-700 group-hover:text-orange-600 transition-colors">Include Accessories</span>
                                        </label>
                                        <label className="flex items-center space-x-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={nylonHangerOptions.includeCable}
                                                onChange={(e) => setNylonHangerOptions(prev => ({
                                                    ...prev,
                                                    includeCable: e.target.checked
                                                }))}
                                            />
                                            <span className="text-sm text-gray-700 group-hover:text-orange-600 transition-colors">Include Cable</span>
                                        </label>
                                    </div>
                                )}
                                
                                {/* Alu Suspension Custom Drawing Toggle */}
                                {supportType === 'alu' && (
                                    <div className="flex items-center space-x-2">
                                        <label className="flex items-center space-x-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={aluSuspensionCustomDrawing}
                                                onChange={(e) => setAluSuspensionCustomDrawing(e.target.checked)}
                                            />
                                            <span className="text-sm text-gray-700 group-hover:text-orange-600 transition-colors">Enable Custom Drawing</span>
                                        </label>
                                        <span className="text-xs text-gray-500">(Draw support lines manually)</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="control-card ml-4 bg-green-50 border-green-200">
                        <label className="block text-sm font-semibold text-green-700 mb-3">
                            <svg className="w-4 h-4 inline mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Support Status
                        </label>
                        <div className="text-sm text-green-700">
                            <div className="flex items-center space-x-2">
                                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span>No support configuration needed</span>
                            </div>
                            <p className="text-xs text-green-600 mt-1">
                                All panels are under 6000mm in their critical dimension and can be installed without additional support systems.
                            </p>
                        </div>
                    </div>
                )}

                {/* Action Buttons Row */}
                <div className="flex flex-col sm:flex-row items-center justify-between space-y-3 sm:space-y-0 sm:space-x-4 mt-6 ml-4">
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={generateCeilingPlan}
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
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    <span>Generate Ceiling Plan</span>
                                </div>
                            )}
                        </button>
                        
                        {planNeedsRegeneration && (
                            <button
                                onClick={generateCeilingPlan}
                                disabled={isGenerating}
                                className="btn-regenerate"
                            >
                                {isGenerating ? 'Regenerating...' : '🔄 Regenerate Plan'}
                            </button>
                        )}
                    </div>
                    
                    <div className="text-sm text-gray-600">
                        <span className="font-medium">Project:</span> {projectData?.name || 'Loading...'}
                    </div>
                </div>
                

                
                {/* Status Indicators */}
                {planNeedsRegeneration && (
                    <div className="mt-3 p-3 bg-yellow-100 border border-yellow-300 text-yellow-700 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center">
                                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <span className="font-medium">Panel dimensions changed!</span>
                            </div>
                            <button
                                onClick={generateCeilingPlan}
                                disabled={isGenerating}
                                className="px-4 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isGenerating ? 'Regenerating...' : 'Regenerate Plan'}
                            </button>
                        </div>
                        <p className="text-sm mt-1">
                            The current ceiling plan was generated with different panel dimensions. 
                            Click "Regenerate Plan" to create a new plan with the updated dimensions.
                        </p>
                    </div>
                )}
                
                {/* Error Display */}
                {error && (
                    <div className="mt-3 p-3 bg-red-100 border border-red-300 text-red-700 rounded-lg">
                        {error}
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="p-6 pl-8">
                {ceilingPlan ? (
                    <div className="space-y-6">
                        {/* Canvas */}
                        <CeilingCanvas
                            rooms={showAllRooms ? allRooms : allRooms.filter(room => room.id === selectedRoomId)}
                            walls={allWalls}
                            intersections={allIntersections}
                            ceilingPlan={ceilingPlan}
                            ceilingPanels={ceilingPanels}
                            projectData={projectData}
                            projectWastePercentage={projectWastePercentage}
                            ceilingThickness={ceilingThickness}
                            ceilingPanelsMap={(() => {
                                // Convert ceilingPanels array to ceilingPanelsMap format
                                const panelsMap = {};
                                if (ceilingPanels && Array.isArray(ceilingPanels)) {
                                    ceilingPanels.forEach(panel => {
                                        const roomId = panel.room_id;
                                        if (roomId) {
                                            // Filter panels based on room selection
                                            if (showAllRooms || roomId === selectedRoomId) {
                                            if (!panelsMap[roomId]) {
                                                panelsMap[roomId] = [];
                                            }
                                            panelsMap[roomId].push(panel);
                                            }
                                        }
                                    });
                                }
                                
                                return panelsMap;
                            })()}
                            orientationAnalysis={orientationAnalysis}
                            // Support configuration
                            supportType={supportType}
                            nylonHangerOptions={nylonHangerOptions}
                            aluSuspensionCustomDrawing={aluSuspensionCustomDrawing}
                            panelsNeedSupport={panelsNeedSupport}
                            // Room selection props
                            selectedRoomId={selectedRoomId}
                            showAllRooms={showAllRooms}
                            onRoomSelect={handleRoomSelection}
                            onRoomDeselect={handleRoomDeselection}
                        />
                        
                        {/* Success Message */}
                        {roomRegenerationSuccess && (
                            <div className="mt-4 bg-green-100 border-2 border-green-500 rounded-lg p-4 flex items-center gap-3 animate-pulse">
                                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <div>
                                    <p className="font-semibold text-green-800">Success!</p>
                                    <p className="text-sm text-green-700">Ceiling plan regenerated for this room only.</p>
                                </div>
                            </div>
                        )}
                        
                        {/* Room Details Panel */}
                        {selectedRoomId && !showAllRooms && (
                            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-blue-900">
                                        Room Details: {allRooms.find(r => r.id === selectedRoomId)?.room_name}
                                    </h3>
                                    <button
                                        onClick={() => setShowRoomDetails(!showRoomDetails)}
                                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                                    >
                                        {showRoomDetails ? 'Hide Details' : 'Show Details'}
                                    </button>
                                </div>
                                
                                {showRoomDetails && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Room Information */}
                                        <div className="bg-white p-4 rounded-lg border">
                                            <h4 className="font-semibold text-gray-800 mb-3">Room Information</h4>
                                            <div className="space-y-2 text-sm">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Room Name:</span>
                                                    <span className="font-medium">{allRooms.find(r => r.id === selectedRoomId)?.room_name}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Room Height:</span>
                                                    <span className="font-medium">{allRooms.find(r => r.id === selectedRoomId)?.height || 'Default'} mm</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Panel Count:</span>
                                                    <span className="font-medium">
                                                        {ceilingPanels.filter(p => p.room_id === selectedRoomId).length} panels
                                                    </span>
                                                </div>
                                                <div className="mt-3 pt-3 border-t border-gray-200">
                                                    <h5 className="font-semibold text-gray-700 mb-2">Current Ceiling Settings</h5>
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Ceiling Thickness:</span>
                                                        <span className="font-medium text-blue-600">
                                                            {allRooms.find(r => r.id === selectedRoomId)?.ceiling_plan?.ceiling_thickness || 'Not set'} mm
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Panel Width:</span>
                                                        <span className="font-medium text-blue-600">
                                                            {allRooms.find(r => r.id === selectedRoomId)?.ceiling_plan?.panel_width || 'Not set'} mm
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Orientation:</span>
                                                        <span className="font-medium text-blue-600 capitalize">
                                                            {(() => {
                                                                const strategy = allRooms.find(r => r.id === selectedRoomId)?.ceiling_plan?.orientation_strategy;
                                                                if (!strategy) return 'Not set';
                                                                if (strategy === 'all_vertical') return 'Vertical';
                                                                if (strategy === 'all_horizontal') return 'Horizontal';
                                                                if (strategy === 'auto') return 'Auto';
                                                                return strategy.replace(/_/g, ' ');
                                                            })()}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        
                                         {/* Ceiling Configuration */}
                                        <div className="bg-white p-4 rounded-lg border">
                                            <h4 className="font-semibold text-gray-800 mb-3">Edit Ceiling Settings</h4>
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-sm text-gray-600">Ceiling Thickness:</label>
                                                    <input
                                                        type="number"
                                                        min="50"
                                                        max="500"
                                                        step="10"
                                                        value={roomEditConfig.ceilingThickness}
                                                        onChange={(e) => setRoomEditConfig({...roomEditConfig, ceilingThickness: parseInt(e.target.value)})}
                                                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span className="text-xs text-gray-500">mm</span>
                                                </div>
                                                
                                                <div className="flex items-center justify-between">
                                                    <label className="text-sm text-gray-600">Panel Width:</label>
                                                    <input
                                                        type="number"
                                                        min="100"
                                                        max="3000"
                                                        step="50"
                                                        value={roomEditConfig.panelWidth}
                                                        onChange={(e) => setRoomEditConfig({...roomEditConfig, panelWidth: parseInt(e.target.value)})}
                                                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span className="text-xs text-gray-500">mm</span>
                                                </div>
                                                
                                                <div className="flex items-center justify-between">
                                                    <label className="text-sm text-gray-600">Orientation:</label>
                                                    <select
                                                        value={roomEditConfig.orientationStrategy}
                                                        onChange={(e) => setRoomEditConfig({...roomEditConfig, orientationStrategy: e.target.value})}
                                                        className="flex-1 ml-2 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    >
                                                        <option value="auto">Auto (Best)</option>
                                                        <option value="all_vertical">Vertical</option>
                                                        <option value="all_horizontal">Horizontal</option>
                                                        <option value="room_optimal">Room Optimal</option>
                                                    </select>
                                                </div>
                                                
                                                <div className="flex items-center justify-between">
                                                    <label className="text-sm text-gray-600">Panel Length:</label>
                                                    <select
                                                        value={roomEditConfig.panelLength}
                                                        onChange={(e) => setRoomEditConfig({...roomEditConfig, panelLength: e.target.value})}
                                                        className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    >
                                                        <option value="auto">Auto</option>
                                                        <option value="custom">Custom</option>
                                                    </select>
                                                </div>
                                                
                                                {roomEditConfig.panelLength === 'custom' && (
                                                    <div className="flex items-center justify-between">
                                                        <label className="text-sm text-gray-600">Custom Length:</label>
                                                        <input
                                                            type="number"
                                                            min="1000"
                                                            max="20000"
                                                            step="100"
                                                            value={roomEditConfig.customPanelLength}
                                                            onChange={(e) => setRoomEditConfig({...roomEditConfig, customPanelLength: parseInt(e.target.value)})}
                                                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                        />
                                                        <span className="text-xs text-gray-500">mm</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Action Buttons */}
                                {showRoomDetails && (
                                    <div className="mt-4 flex items-center justify-between">
                                        <div className="text-xs text-gray-600 italic">
                                            💡 Changes will apply only to this room. Other rooms keep their current settings.
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setRoomEditConfig({
                                                    ceilingThickness: ceilingThickness,
                                                    panelWidth: panelWidth,
                                                    panelLength: panelLength,
                                                    customPanelLength: customPanelLength,
                                                    orientationStrategy: selectedOrientationStrategy
                                                })}
                                                className="px-4 py-2 bg-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-400 transition-colors font-medium"
                                            >
                                                Reset to Global
                                            </button>
                                            <button
                                                onClick={() => generateCeilingPlanForRoom(selectedRoomId, roomEditConfig)}
                                                disabled={isRegeneratingRoom}
                                                className={`px-6 py-2 text-sm rounded-lg font-medium transition-colors shadow-md ${
                                                    isRegeneratingRoom
                                                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                                                        : 'bg-green-600 text-white hover:bg-green-700'
                                                }`}
                                            >
                                                {isRegeneratingRoom ? (
                                                    <span className="flex items-center gap-2">
                                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                                                        </svg>
                                                        Applying...
                                                    </span>
                                                ) : (
                                                    '✓ Apply Settings to this room only'
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Debug info */}
                        {/* <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
                            <div>Debug Info:</div>
                            <div>Rooms: {allRooms.length}</div>
                            <div>Walls: {allWalls.length}</div>
                            <div>Ceiling Plan: {ceilingPlan ? 'Yes' : 'No'}</div>
                            <div>Panels: {ceilingPanels.length}</div>
                            <div>Panel Width: {panelWidth}mm</div>
                            <div>Panel Length: {panelLength === 'auto' ? 'Auto' : `${customPanelLength}mm`}</div>
                                                                    <div>Ceiling Thickness: {ceilingThickness}mm</div>
                            <div>Support Type: {supportType}</div>
                            {supportType === 'nylon' && (
                                <div>Nylon Options: Accessories: {nylonHangerOptions.includeAccessories ? 'Yes' : 'No'}, Cable: {nylonHangerOptions.includeCable ? 'Yes' : 'No'}</div>
                            )}
                            {supportType === 'alu' && (
                                <div>Alu Custom Drawing: {aluSuspensionCustomDrawing ? 'Enabled' : 'Disabled'}</div>
                            )}
                            <div className="mt-2 pt-2 border-t border-gray-300">
                                <div className="font-semibold">Panel Generation:</div>
                                <div>Standard panel widths used (no optimization)</div>
                                <div>All panels maintain original dimensions</div>
                            </div>
                        </div> */}
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <div className="text-gray-400 mb-4">
                            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                            No Ceiling Plan Generated
                        </h3>
                        <p className="text-gray-600 mb-4">
                            Generate a ceiling plan to automatically create optimal panel layout for this project.
                        </p>
                        <button
                            onClick={generateCeilingPlan}
                            disabled={isGenerating}
                            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isGenerating ? 'Generating...' : 'Generate Ceiling Plan'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CeilingManager;
