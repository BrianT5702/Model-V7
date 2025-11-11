import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import CeilingCanvas from '../canvas/CeilingCanvas';
import api from '../../api/api';

const CeilingManager = ({ projectId, onClose, onCeilingPlanGenerated, updateSharedPanelData = null, sharedPanelData = null }) => {
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
    const [ceilingZones, setCeilingZones] = useState([]);
    const [isZonesUpdating, setIsZonesUpdating] = useState(false);
    const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
    const [activeDetailType, setActiveDetailType] = useState(null);
    const [activeZoneId, setActiveZoneId] = useState(null);
    const [isMergeMode, setIsMergeMode] = useState(false);
    const [mergeSelection, setMergeSelection] = useState([]);
    const [mergeError, setMergeError] = useState(null);
    const [isMerging, setIsMerging] = useState(false);
    const [dissolvingZoneId, setDissolvingZoneId] = useState(null);
    
    // Orientation strategy
    const [selectedOrientationStrategy, setSelectedOrientationStrategy] = useState('auto');
    const [orientationAnalysis, setOrientationAnalysis] = useState(null);
    
    // Panel dimension configuration
    const [panelWidth, setPanelWidth] = useState(1150);
    const [panelLength, setPanelLength] = useState('auto');
    const [customPanelLength, setCustomPanelLength] = useState(10000);
    const [ceilingThickness, setCeilingThickness] = useState(150);

    const [roomEditConfig, setRoomEditConfig] = useState({
        ceilingThickness,
        panelWidth,
        panelLength,
        customPanelLength,
        orientationStrategy: selectedOrientationStrategy
    });

    const [zoneEditConfig, setZoneEditConfig] = useState({
        ceilingThickness,
        panelWidth,
        panelLength,
        customPanelLength,
        orientationStrategy: selectedOrientationStrategy
    });
    
    // Support configuration - both types can be enabled simultaneously
    const [enableNylonHangers, setEnableNylonHangers] = useState(true); // Enable automatic nylon hanger supports
    const [nylonHangerOptions, setNylonHangerOptions] = useState({
        includeAccessories: false,
        includeCable: false
    });
    const [enableAluSuspension, setEnableAluSuspension] = useState(false); // Enable alu suspension custom drawing
    const [aluSuspensionCustomDrawing, setAluSuspensionCustomDrawing] = useState(false);
    const [customSupports, setCustomSupports] = useState([]); // Store custom alu suspension supports
    // Keep supportType for backward compatibility (defaults to nylon if only nylon is enabled)
    const supportType = enableNylonHangers && !enableAluSuspension ? 'nylon' : 
                        enableAluSuspension && !enableNylonHangers ? 'alu' : 'mixed';
    
    // Track if current plan needs regeneration due to dimension changes
    const [planNeedsRegeneration, setPlanNeedsRegeneration] = useState(false);

    // Room selection state
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [showAllRooms, setShowAllRooms] = useState(true);
    const [showRoomDetails, setShowRoomDetails] = useState(false);
    
    // Handle room selection from canvas click
    const handleRoomSelection = (roomId) => {
        setSelectedRoomId(roomId);

        const isZone = typeof roomId === 'string' && roomId.startsWith('zone-');

        if (isZone) {
            setShowAllRooms(true);
            setShowRoomDetails(false);
            const numericZoneId = parseInt(roomId.replace('zone-', ''), 10);
            setActiveZoneId(Number.isNaN(numericZoneId) ? null : numericZoneId);
            setActiveDetailType('zone');
            setIsDetailsPanelOpen(true);
        } else {
        setShowAllRooms(false); // Switch to single room view
        setShowRoomDetails(true); // Auto-expand details
            setActiveZoneId(null);
            setActiveDetailType('room');
            setIsDetailsPanelOpen(true);
        }
    };
    
    // Handle deselection (return to all rooms view)
    const handleRoomDeselection = () => {
        setSelectedRoomId(null);
        setShowAllRooms(true);
        setShowRoomDetails(false);
        setActiveZoneId(null);
        setActiveDetailType(null);
        setIsDetailsPanelOpen(false);
    };
    
    // Room-specific editing state
    const [isRegeneratingRoom, setIsRegeneratingRoom] = useState(false);
    const [roomRegenerationSuccess, setRoomRegenerationSuccess] = useState(false);
    const [zoneRegenerationSuccess, setZoneRegenerationSuccess] = useState(false);
    const [isRegeneratingZone, setIsRegeneratingZone] = useState(false);

    useEffect(() => {
        if (projectId) {
            loadProjectData();
        }
    }, [projectId]);
    
    // Check if any panels need support (over 6000mm) - matches CeilingCanvas logic
    // MUST be defined before useEffects that use it
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

    const activeZone = useMemo(() => {
        if (activeZoneId === null) return null;
        return ceilingZones.find(zone => zone.id === activeZoneId) || null;
    }, [activeZoneId, ceilingZones]);

    const selectedRoom = useMemo(() => {
        if (!selectedRoomId) return null;
        return allRooms.find(room => room.id === selectedRoomId) || null;
    }, [selectedRoomId, allRooms]);

    const shouldShowDetailsPanel = isDetailsPanelOpen && (activeDetailType === 'room' || activeDetailType === 'zone');
    const showRoomDetailsPanel = shouldShowDetailsPanel && activeDetailType === 'room';
    const showZoneDetailsPanel = shouldShowDetailsPanel && activeDetailType === 'zone';
    const hasActiveSelection = Boolean(selectedRoomId) || activeZoneId !== null;

    useEffect(() => {
        if (activeZone) {
            setZoneEditConfig({
                ceilingThickness: activeZone.ceiling_thickness ?? ceilingThickness,
                panelWidth: activeZone.panel_width ?? panelWidth,
                panelLength: activeZone.panel_length ?? 'auto',
                customPanelLength: activeZone.custom_panel_length ?? customPanelLength,
                orientationStrategy: activeZone.orientation_strategy ?? selectedOrientationStrategy
            });
        }
    }, [activeZone, ceilingThickness, panelWidth, panelLength, customPanelLength, selectedOrientationStrategy]);

    const roomsAvailableForMerge = useMemo(() => {
        if (!allRooms || allRooms.length === 0) return [];
        return allRooms.filter(room => !room.ceiling_zones || room.ceiling_zones.length === 0);
    }, [allRooms]);

    const formatOrientationLabel = useCallback((strategy) => {
        if (!strategy) return 'Not set';
        switch (strategy) {
            case 'all_vertical':
                return 'Vertical';
            case 'all_horizontal':
                return 'Horizontal';
            case 'room_optimal':
                return 'Room Optimal';
            case 'auto':
                return 'Auto';
            default:
                return strategy.replace(/_/g, ' ');
        }
    }, []);

    const activeZonePanelStats = useMemo(() => {
        if (!activeZone) return null;
        const panels = Array.isArray(activeZone.ceiling_panels) ? activeZone.ceiling_panels : [];
        const total = panels.length;
        const full = panels.filter(panel => !(panel.is_cut_panel || panel.is_cut)).length;
        const cut = total - full;

        const groupedMap = new Map();
        panels.forEach(panel => {
            const panelThickness = panel.thickness || ceilingThickness;
            const isVertical = panel.width >= panel.length;
            let displayWidth = panel.width;
            let displayLength = panel.length;
            if (isVertical) {
                displayWidth = panel.length;
                displayLength = panel.width;
            }
            const key = `${displayWidth}_${displayLength}_${panelThickness}_${panel.is_cut_panel || panel.is_cut ? 'cut' : 'full'}`;
            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    width: displayWidth,
                    length: displayLength,
                    thickness: panelThickness,
                    isCut: panel.is_cut_panel || panel.is_cut,
                    quantity: 0
                });
            }
            groupedMap.get(key).quantity += 1;
        });

        return {
            total,
            full,
            cut,
            panels,
            groupedPanels: Array.from(groupedMap.values())
        };
    }, [activeZone, ceilingThickness]);

    const selectedRoomPanelStats = useMemo(() => {
        if (!selectedRoomId) return null;
        const panels = ceilingPanels.filter(panel => panel.room_id === selectedRoomId);
        if (panels.length === 0) return null;

        const total = panels.length;
        const full = panels.filter(panel => !(panel.is_cut_panel || panel.is_cut)).length;
        const cut = total - full;

        const groupedMap = new Map();
        panels.forEach(panel => {
            const panelThickness = panel.thickness || ceilingThickness;
            const isVertical = panel.width >= panel.length;
            let displayWidth = panel.width;
            let displayLength = panel.length;
            if (isVertical) {
                displayWidth = panel.length;
                displayLength = panel.width;
            }
            const key = `${displayWidth}_${displayLength}_${panelThickness}_${panel.is_cut_panel || panel.is_cut ? 'cut' : 'full'}`;
            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    width: displayWidth,
                    length: displayLength,
                    thickness: panelThickness,
                    isCut: panel.is_cut_panel || panel.is_cut,
                    quantity: 0
                });
            }
            groupedMap.get(key).quantity += 1;
        });

        return {
            total,
            full,
            cut,
            panels,
            groupedPanels: Array.from(groupedMap.values())
        };
    }, [selectedRoomId, ceilingPanels, ceilingThickness]);

    const selectedMergeRooms = useMemo(() => {
        return roomsAvailableForMerge.filter(room => mergeSelection.includes(room.id));
    }, [roomsAvailableForMerge, mergeSelection]);

    const getRoomTopElevation = useCallback((room) => {
        if (!room) return null;
        const height = room.height ?? projectData?.height;
        if (height === undefined || height === null) return null;
        const baseElevation = room.base_elevation_mm ?? 0;
        return baseElevation + height;
    }, [projectData]);

    const selectedMergeHeight = useMemo(() => {
        if (selectedMergeRooms.length === 0) return null;
        const topElevations = selectedMergeRooms
            .map(room => getRoomTopElevation(room))
            .filter(value => value !== null && value !== undefined);
        if (topElevations.length === 0) return null;
        const first = topElevations[0];
        const consistent = topElevations.every(value => Math.abs(value - first) < 0.1);
        return consistent ? first : null;
    }, [selectedMergeRooms, getRoomTopElevation]);

    useEffect(() => {
        setMergeSelection(prev => prev.filter(id => roomsAvailableForMerge.some(room => room.id === id)));
    }, [roomsAvailableForMerge]);
    
    // Use refs to track previous values and prevent infinite loops
    const prevSupportOptionsRef = useRef({
        enableNylonHangers: null,
        enableAluSuspension: null,
        includeAccessories: null,
        includeCable: null,
        aluSuspensionCustomDrawing: null,
        panelsNeedSupport: null
    });
    const isRestoringFromSharedRef = useRef(false);
    const userChangedSupportOptionsRef = useRef(false); // Track if user manually changed options
    
    // Restore support options from shared panel data when component mounts or shared data changes
    // Only update if values actually changed to prevent loops
    // IMPORTANT: Only depends on sharedPanelData to prevent interference with user clicks
    useEffect(() => {
        // Skip if user just changed values manually (within last 100ms)
        if (userChangedSupportOptionsRef.current) {
            return;
        }
        
        if (sharedPanelData && !isRestoringFromSharedRef.current) {
            // Check if values actually differ before updating
            let needsUpdate = false;
            
            // Handle backward compatibility: supportType can be 'nylon', 'alu', or 'mixed'
            if (sharedPanelData.supportType) {
                if (sharedPanelData.supportType === 'nylon') {
                    if (!enableNylonHangers || enableAluSuspension) {
                        needsUpdate = true;
                        setEnableNylonHangers(true);
                        setEnableAluSuspension(false);
                    }
                } else if (sharedPanelData.supportType === 'alu') {
                    if (enableNylonHangers || !enableAluSuspension) {
                        needsUpdate = true;
                        setEnableNylonHangers(false);
                        setEnableAluSuspension(true);
                    }
                } else if (sharedPanelData.supportType === 'mixed') {
                    if (!enableNylonHangers || !enableAluSuspension) {
                        needsUpdate = true;
                        setEnableNylonHangers(true);
                        setEnableAluSuspension(true);
                    }
                }
            }
            
            // Restore enableNylonHangers and enableAluSuspension if available
            if (sharedPanelData.enableNylonHangers !== undefined && 
                sharedPanelData.enableNylonHangers !== enableNylonHangers) {
                needsUpdate = true;
                setEnableNylonHangers(sharedPanelData.enableNylonHangers);
            }
            if (sharedPanelData.enableAluSuspension !== undefined && 
                sharedPanelData.enableAluSuspension !== enableAluSuspension) {
                needsUpdate = true;
                setEnableAluSuspension(sharedPanelData.enableAluSuspension);
            }
            
            if (sharedPanelData.includeAccessories !== undefined && 
                sharedPanelData.includeAccessories !== nylonHangerOptions.includeAccessories) {
                needsUpdate = true;
                setNylonHangerOptions(prev => ({
                    ...prev,
                    includeAccessories: sharedPanelData.includeAccessories
                }));
            }
            if (sharedPanelData.includeCable !== undefined && 
                sharedPanelData.includeCable !== nylonHangerOptions.includeCable) {
                needsUpdate = true;
                setNylonHangerOptions(prev => ({
                    ...prev,
                    includeCable: sharedPanelData.includeCable
                }));
            }
            if (sharedPanelData.aluSuspensionCustomDrawing !== undefined && 
                sharedPanelData.aluSuspensionCustomDrawing !== aluSuspensionCustomDrawing) {
                needsUpdate = true;
                setAluSuspensionCustomDrawing(sharedPanelData.aluSuspensionCustomDrawing);
            }
            
            // If we updated, mark that we're restoring to prevent the other useEffect from triggering
            if (needsUpdate) {
                isRestoringFromSharedRef.current = true;
                // Reset flag after a short delay to allow state updates to complete
                setTimeout(() => {
                    isRestoringFromSharedRef.current = false;
                }, 0);
            }
            // panelsNeedSupport is computed from ceiling panels, no need to restore it
        }
    }, [sharedPanelData]); // Only depend on sharedPanelData, not local state values
    
    // Save support options to shared panel data whenever they change
    // Skip if we're currently restoring from shared data to prevent loops
    useEffect(() => {
        if (updateSharedPanelData && !isRestoringFromSharedRef.current) {
            const currentOptions = {
                supportType: supportType, // For backward compatibility
                enableNylonHangers: enableNylonHangers,
                enableAluSuspension: enableAluSuspension,
                includeAccessories: nylonHangerOptions.includeAccessories,
                includeCable: nylonHangerOptions.includeCable,
                aluSuspensionCustomDrawing: aluSuspensionCustomDrawing,
                panelsNeedSupport: panelsNeedSupport
            };
            
            // Only update if values actually changed
            const prev = prevSupportOptionsRef.current;
            const hasChanged = 
                prev.enableNylonHangers !== currentOptions.enableNylonHangers ||
                prev.enableAluSuspension !== currentOptions.enableAluSuspension ||
                prev.includeAccessories !== currentOptions.includeAccessories ||
                prev.includeCable !== currentOptions.includeCable ||
                prev.aluSuspensionCustomDrawing !== currentOptions.aluSuspensionCustomDrawing ||
                prev.panelsNeedSupport !== currentOptions.panelsNeedSupport;
            
            if (hasChanged) {
                prevSupportOptionsRef.current = currentOptions;
                updateSharedPanelData('ceiling-support-options', null, currentOptions);
            }
        }
    }, [updateSharedPanelData, enableNylonHangers, enableAluSuspension, supportType, nylonHangerOptions.includeAccessories, nylonHangerOptions.includeCable, aluSuspensionCustomDrawing, panelsNeedSupport]);
    
    // Save custom supports to backend when they change (debounced)
    const saveCustomSupportsTimeoutRef = useRef(null);
    useEffect(() => {
        // Skip if no ceiling plan exists yet
        if (!ceilingPlan || !projectId) return;
        
        // Clear existing timeout
        if (saveCustomSupportsTimeoutRef.current) {
            clearTimeout(saveCustomSupportsTimeoutRef.current);
        }
        
        // Debounce: save after 1 second of no changes
        saveCustomSupportsTimeoutRef.current = setTimeout(async () => {
            try {
                // Get all ceiling plans for this project
                const planResponse = await api.get(`/ceiling-plans/?project=${parseInt(projectId)}`);
                const plans = planResponse.data || [];
                
                // Update support_config for all ceiling plans
                const updatePromises = plans.map(plan => {
                    const updatedSupportConfig = {
                        ...(plan.support_config || {}),
                        enableNylonHangers: enableNylonHangers,
                        enableAluSuspension: enableAluSuspension,
                        ...nylonHangerOptions,
                        aluSuspensionCustomDrawing,
                        customSupports: customSupports
                    };
                    
                    return api.patch(`/ceiling-plans/${plan.id}/`, {
                        support_config: updatedSupportConfig
                    });
                });
                
                await Promise.all(updatePromises);
                console.log('✅ Custom supports saved to backend');
            } catch (error) {
                console.error('Error saving custom supports:', error);
            }
        }, 1000); // 1 second debounce
        
        return () => {
            if (saveCustomSupportsTimeoutRef.current) {
                clearTimeout(saveCustomSupportsTimeoutRef.current);
            }
        };
    }, [customSupports, ceilingPlan, projectId, nylonHangerOptions, aluSuspensionCustomDrawing]);
    
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

    const loadCeilingZones = useCallback(async () => {
        if (!projectId) return;
        try {
            setIsZonesUpdating(true);
            const response = await api.get(`/ceiling-zones/?project=${parseInt(projectId)}`);
            setCeilingZones(response.data || []);
        } catch (error) {
            console.error('Error loading ceiling zones:', error);
        } finally {
            setIsZonesUpdating(false);
        }
    }, [projectId]);

    const loadProjectData = async () => {
        try {
            // Load project data first
            const projectResponse = await api.get(`/projects/${parseInt(projectId)}/`);
            setProjectData(projectResponse.data || null);
            
            // Load rooms
            const roomsResponse = await api.get(`/rooms/?project=${parseInt(projectId)}`);
            const loadedRooms = roomsResponse.data || [];
            setAllRooms(loadedRooms);
            
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
            await loadCeilingZones();
            
            // Load ceiling panels and calculate project waste after ceiling plan is loaded
            try {
                const panelsResponse = await api.get(`/ceiling-panels/?project=${parseInt(projectId)}`);
                const loadedPanels = panelsResponse.data || [];
                
                console.log('📦 [INITIAL LOAD] Loaded panels:', loadedPanels.length, loadedPanels);
                console.log('📦 [INITIAL LOAD] Loaded rooms:', loadedRooms.length, loadedRooms);
                
                // Calculate waste using leftover-based approach
                // We need to estimate leftover area from cut panels since database only stores used dimensions
                if (loadedPanels.length > 0 && loadedRooms.length > 0) {
                    // Estimate leftover area from cut panels
                    // For each cut panel, estimate the leftover based on standard panel width (1150mm)
                    const MAX_PANEL_WIDTH = 1150;
                    let estimatedLeftoverArea = 0;
                    
                    loadedPanels.forEach(panel => {
                        if (panel.is_cut_panel) {
                            // If panel is cut, the leftover is approximately (MAX_WIDTH - actual_width) * length
                            if (panel.width < MAX_PANEL_WIDTH) {
                                const leftoverWidth = MAX_PANEL_WIDTH - panel.width;
                                const leftoverArea = leftoverWidth * panel.length;
                                estimatedLeftoverArea += leftoverArea;
                                console.log(`📊 [INITIAL LOAD] Cut panel ${panel.panel_id}: leftover ~${leftoverWidth}mm × ${panel.length}mm = ${leftoverArea} mm²`);
                            }
                        }
                    });
                    
                    // Calculate total room area
                    const totalRoomArea = loadedRooms.reduce((sum, room) => {
                        if (room.room_points && room.room_points.length >= 3) {
                            let area = 0;
                            for (let i = 0; i < room.room_points.length; i++) {
                                const j = (i + 1) % room.room_points.length;
                                area += room.room_points[i].x * room.room_points[j].y;
                                area -= room.room_points[j].x * room.room_points[i].y;
                            }
                            return sum + Math.abs(area) / 2;
                        }
                        return sum;
                    }, 0);
                    
                    if (estimatedLeftoverArea > 0 && totalRoomArea > 0) {
                        // Formula: waste% = Leftover Area / Total Room Area × 100%
                        const estimatedWaste = (estimatedLeftoverArea / totalRoomArea) * 100;
                        setProjectWastePercentage(estimatedWaste);
                        console.log('📊 [INITIAL LOAD] Estimated leftover area:', estimatedLeftoverArea);
                        console.log('📊 [INITIAL LOAD] Total room area:', totalRoomArea);
                        console.log('✅ [INITIAL LOAD] Estimated waste %:', estimatedWaste.toFixed(1) + '%');
                    } else {
                        console.log('ℹ️ [INITIAL LOAD] No waste to display (no cut panels or perfect fit)');
                        setProjectWastePercentage(0);
                    }
                }
            } catch (error) {
                console.error('❌ [INITIAL LOAD] Error calculating initial waste percentage:', error);
            }
            
            // Load orientation analysis
            await loadOrientationAnalysis();
        } catch (error) {
            console.error('Error loading project data:', error);
        }
    };

    const toggleMergeMode = () => {
        setIsMergeMode(prev => !prev);
        setMergeSelection([]);
        setMergeError(null);
    };

    const handleMergeRoomToggle = (roomId) => {
        setMergeSelection(prev => {
            if (prev.includes(roomId)) {
                return prev.filter(id => id !== roomId);
            }
            return [...prev, roomId];
        });
    };

    const handleMergeCeiling = async () => {
        if (!projectId) return;
        if (mergeSelection.length < 2) {
            setMergeError('Select at least two rooms to merge.');
            return;
        }

        const selectedRooms = allRooms.filter(room => mergeSelection.includes(room.id));
        if (selectedRooms.length !== mergeSelection.length) {
            setMergeError('Some selected rooms could not be found.');
            return;
        }

        const topElevations = selectedRooms
            .map(room => getRoomTopElevation(room))
            .filter(value => value !== null && value !== undefined);

        if (topElevations.length !== selectedRooms.length) {
            setMergeError('Some rooms are missing height information.');
            return;
        }

        const uniqueTops = new Set(topElevations.map(value => Math.round(value * 1000) / 1000));
        if (uniqueTops.size > 1) {
            setMergeError('Selected rooms must share the same top elevation before merging.');
            return;
        }

        setIsMerging(true);
        setMergeError(null);

        try {
            const payload = {
                project_id: parseInt(projectId),
                room_ids: mergeSelection,
                ceiling_thickness: ceilingThickness,
                orientation_strategy: selectedOrientationStrategy,
                panel_width: panelWidth,
                panel_length: panelLength,
                custom_panel_length: panelLength === 'auto' ? null : customPanelLength,
                support_type: supportType,
                support_config: {
                    enableNylonHangers,
                    enableAluSuspension,
                    ...nylonHangerOptions,
                    aluSuspensionCustomDrawing,
                    customSupports
                }
            };

            const response = await api.post('/ceiling-zones/', payload);
            console.log('✅ Ceiling zone created:', response.data);

            const roomsResponse = await api.get(`/rooms/?project=${parseInt(projectId)}`);
            setAllRooms(roomsResponse.data || []);

            await loadExistingCeilingPlan();
            await loadCeilingZones();

            const panelsResponse = await api.get(`/ceiling-panels/?project=${parseInt(projectId)}`);
            const panels = panelsResponse.data || [];
            setCeilingPanels(panels);

            if (updateSharedPanelData) {
                const sharedPanels = processCeilingPanelsForSharing(panels, roomsResponse.data || []);
                updateSharedPanelData('ceiling', sharedPanels);
            }

            setMergeSelection([]);
            setIsMergeMode(false);
        } catch (err) {
            console.error('Error merging ceiling zone:', err);
            const message = err?.response?.data?.error || err.message || 'Failed to merge ceiling zone. Please try again.';
            setMergeError(message);
        } finally {
            setIsMerging(false);
        }
    };

    const handleDissolveZone = async (zoneId) => {
        if (!projectId) return;
        setDissolvingZoneId(zoneId);
        setMergeError(null);
        try {
            await api.delete(`/ceiling-zones/${zoneId}/?regenerate=true`);
            const roomsResponse = await api.get(`/rooms/?project=${parseInt(projectId)}`);
            setAllRooms(roomsResponse.data || []);
            await loadExistingCeilingPlan();
            await loadCeilingZones();
            const panelsResponse = await api.get(`/ceiling-panels/?project=${parseInt(projectId)}`);
            const panels = panelsResponse.data || [];
            setCeilingPanels(panels);
            if (updateSharedPanelData) {
                const sharedPanels = processCeilingPanelsForSharing(panels, roomsResponse.data || []);
                updateSharedPanelData('ceiling', sharedPanels);
            }
        } catch (err) {
            console.error('Error removing ceiling zone:', err);
            const message = err?.response?.data?.error || err.message || 'Failed to remove ceiling zone. Please try again.';
            setMergeError(message);
        } finally {
            setDissolvingZoneId(null);
        }
    };

    // Process ceiling panels for sharing with other tabs (matches table structure)
    const processCeilingPanelsForSharing = (panels, rooms) => {
        if (!panels || panels.length === 0) return [];
        
        // Group panels by dimensions (width, length, thickness)
        const panelsByDimension = new Map();
        panels.forEach(panel => {
            if (!panel) return;
            if (!showAllRooms) {
                if (panel.room_id && panel.room_id !== selectedRoomId) {
                    return;
                }
                const selectedIsZone = typeof selectedRoomId === 'string' && selectedRoomId.startsWith('zone-');
                if (!panel.room_id && panel.zone_id) {
                    if (!selectedIsZone || selectedRoomId !== `zone-${panel.zone_id}`) {
                        return;
                    }
                }
                if (!panel.room_id && !panel.zone_id && !selectedIsZone) {
                    return;
                }
            }

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
            const [planResponse, panelsResponse, zonesResponse] = await Promise.all([
                api.get(`/ceiling-plans/?project=${parseInt(projectId)}`),
                api.get(`/ceiling-panels/?project=${parseInt(projectId)}`),
                api.get(`/ceiling-zones/?project=${parseInt(projectId)}`)
            ]);

                const panels = panelsResponse.data || [];
            const zonesData = zonesResponse.data || [];

            setCeilingPanels(panels);
            setCeilingZones(zonesData);

            if (planResponse.data && planResponse.data.length > 0) {
                const existingPlan = planResponse.data[0];
                const enhancedPlan = {
                    ...existingPlan,
                    total_panels: panels.length,
                    enhanced_panels: panels,
                    ceiling_panels: panels,
                    zone_plans: zonesData
                };
                
                setCeilingPlan(enhancedPlan);
                
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
                if (existingPlan.support_config) {
                    // Handle backward compatibility: if only support_type exists, use it
                    if (existingPlan.support_type && !existingPlan.support_config.enableNylonHangers && !existingPlan.support_config.enableAluSuspension) {
                        if (existingPlan.support_type === 'nylon') {
                            setEnableNylonHangers(true);
                            setEnableAluSuspension(false);
                        } else if (existingPlan.support_type === 'alu') {
                            setEnableNylonHangers(false);
                            setEnableAluSuspension(true);
                        }
                    } else {
                        // Use new format if available
                        if (existingPlan.support_config.enableNylonHangers !== undefined) {
                            setEnableNylonHangers(existingPlan.support_config.enableNylonHangers);
                        }
                        if (existingPlan.support_config.enableAluSuspension !== undefined) {
                            setEnableAluSuspension(existingPlan.support_config.enableAluSuspension);
                        }
                    }
                    
                    // Load nylon hanger options
                    if (existingPlan.support_config.includeAccessories !== undefined || existingPlan.support_config.includeCable !== undefined) {
                        setNylonHangerOptions({
                            includeAccessories: existingPlan.support_config.includeAccessories || false,
                            includeCable: existingPlan.support_config.includeCable || false
                        });
                    }
                    
                    // Load alu suspension custom drawing
                    if (existingPlan.support_config.aluSuspensionCustomDrawing !== undefined) {
                        setAluSuspensionCustomDrawing(existingPlan.support_config.aluSuspensionCustomDrawing);
                    }
                    
                    // Load custom supports if they exist
                    if (existingPlan.support_config.customSupports && Array.isArray(existingPlan.support_config.customSupports)) {
                        setCustomSupports(existingPlan.support_config.customSupports);
                    }
                }
            } else if (zonesData.length > 0) {
                const synthesizedPlan = {
                    project_id: parseInt(projectId),
                    strategy_used: 'zones_only',
                    enhanced_panels: panels,
                    ceiling_panels: panels,
                    zone_plans: zonesData,
                    summary: {
                        total_panels: panels.length,
                        recommended_strategy: 'zones_only',
                        project_waste_percentage: zonesData.reduce((sum, zone) => sum + (zone.waste_percentage || 0), 0) / zonesData.length
                    }
                };
                setCeilingPlan(synthesizedPlan);
            }
        } catch (error) {
            console.error('Error loading ceiling plan:', error);
        }
    };

    const applyZoneSettings = async (zoneId) => {
        if (!zoneId) return;
        try {
            setIsRegeneratingZone(true);
            setError(null);

            const payload = {
                project_id: parseInt(projectId),
                orientation_strategy: zoneEditConfig.orientationStrategy,
                panel_width: zoneEditConfig.panelWidth,
                panel_length: zoneEditConfig.panelLength === 'auto' ? 'auto' : zoneEditConfig.customPanelLength,
                ceiling_thickness: zoneEditConfig.ceilingThickness,
                custom_panel_length: zoneEditConfig.panelLength === 'auto' ? null : zoneEditConfig.customPanelLength,
                support_type: supportType,
                support_config: {
                    enableNylonHangers,
                    enableAluSuspension,
                    ...nylonHangerOptions,
                    aluSuspensionCustomDrawing,
                    customSupports
                }
            };

            const response = await api.post(`/ceiling-zones/${zoneId}/regenerate/`, payload);

            if (response.data && !response.data.error) {
                const updatedZoneData = response.data.zone;
                if (updatedZoneData) {
                    setCeilingZones(prev =>
                        prev.map(zone => zone.id === updatedZoneData.id ? updatedZoneData : zone)
                    );
                }

                setZoneRegenerationSuccess(true);
                setTimeout(() => setZoneRegenerationSuccess(false), 3000);

                await new Promise(resolve => setTimeout(resolve, 600));
                await loadExistingCeilingPlan();
            } else {
                setError(response.data?.error || 'Failed to apply zone settings');
            }
        } catch (error) {
            console.error('Error applying zone settings:', error);
            setError(error.response?.data?.error || 'Failed to apply zone settings');
        } finally {
            setIsRegeneratingZone(false);
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
                    enableNylonHangers: enableNylonHangers,
                    enableAluSuspension: enableAluSuspension,
                    ...nylonHangerOptions,
                    aluSuspensionCustomDrawing,
                    customSupports: customSupports
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
                        enableNylonHangers: enableNylonHangers,
                        enableAluSuspension: enableAluSuspension,
                        ...nylonHangerOptions,
                        aluSuspensionCustomDrawing,
                        customSupports: customSupports
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
                    const zonePlansFromPlans = response.data.ceiling_plans
                        .flatMap(plan => plan?.zone_plans || [])
                        .filter(Boolean);
                    const fallbackZonePlans = response.data.zone_plans;
                    const zonePlans = (zonePlansFromPlans && zonePlansFromPlans.length > 0) ? zonePlansFromPlans : fallbackZonePlans;
                    if (zonePlans && Array.isArray(zonePlans)) {
                        setCeilingZones(zonePlans);
                    }
                }
                
                // Update all panels
                setCeilingPanels(newPanels);
                
                // Reload project data to ensure we have the latest data
                await new Promise(resolve => setTimeout(resolve, 600));
                await new Promise(resolve => setTimeout(resolve, 600));
                await new Promise(resolve => setTimeout(resolve, 600));
                await loadExistingCeilingPlan();
                setIsZonesUpdating(false);
                
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
            setIsZonesUpdating(false);
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
                    enableNylonHangers: enableNylonHangers,
                    enableAluSuspension: enableAluSuspension,
                    ...nylonHangerOptions,
                    aluSuspensionCustomDrawing,
                    customSupports: customSupports
                }
            });

            if (response.data && !response.data.error) {
                setCeilingPlan(response.data);
                setCeilingPanels(response.data.enhanced_panels || []);

                let newZonePlans = null;
                setIsZonesUpdating(true);

                if (response.data.zone_plans && Array.isArray(response.data.zone_plans)) {
                    newZonePlans = response.data.zone_plans;
                } else if (Array.isArray(response.data.ceiling_plans)) {
                    newZonePlans = response.data.ceiling_plans
                        .flatMap(plan => plan?.zone_plans || [])
                        .filter(Boolean);
                }
                if (newZonePlans && newZonePlans.length > 0) {
                    setCeilingZones(newZonePlans);
                }
                if (response?.data?.summary?.project_waste_percentage !== undefined && response?.data?.summary?.project_waste_percentage !== null) {
                    setProjectWastePercentage(response.data.summary.project_waste_percentage);
                    console.log('📊 [UI] Cached project-wide waste % from POST (full generate):', response.data.summary.project_waste_percentage);
                }
                clearRegenerationFlag(); // Clear the regeneration flag
                await new Promise(resolve => setTimeout(resolve, 600));
                await loadExistingCeilingPlan();
                setIsZonesUpdating(false);
                
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
            setIsZonesUpdating(false);
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

    // Memoize ceilingPanelsMap to prevent infinite re-renders
    const ceilingPanelsMap = useMemo(() => {
        const panelsMap = {};
        if (ceilingPanels && Array.isArray(ceilingPanels)) {
            ceilingPanels.forEach(panel => {
                if (!panel) return;
                const roomId = panel.room_id;
                const zoneId = panel.zone_id || panel.zone;

                if (roomId) {
                    if (showAllRooms || roomId === selectedRoomId) {
                        if (!panelsMap[roomId]) {
                            panelsMap[roomId] = [];
                        }
                        panelsMap[roomId].push(panel);
                    }
                } else if (zoneId) {
                    const key = `zone-${zoneId}`;
                    if (showAllRooms || selectedRoomId === key) {
                        if (!panelsMap[key]) {
                            panelsMap[key] = [];
                        }
                        panelsMap[key].push(panel);
                    }
                }
            });
        }
        return panelsMap;
    }, [ceilingPanels, showAllRooms, selectedRoomId]);

    // Memoize filtered rooms to prevent unnecessary re-renders
    const filteredRooms = useMemo(() => {
        return showAllRooms ? allRooms : allRooms.filter(room => room.id === selectedRoomId);
    }, [allRooms, showAllRooms, selectedRoomId]);

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
                        <div className="space-y-4">
                            {/* Support Type Selection - Both can be enabled */}
                            <div className="space-y-3">
                                <div className="flex items-center space-x-4">
                                    <label className="flex items-center space-x-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={enableNylonHangers}
                                            onChange={(e) => {
                                                userChangedSupportOptionsRef.current = true;
                                                setEnableNylonHangers(e.target.checked);
                                                setTimeout(() => {
                                                    userChangedSupportOptionsRef.current = false;
                                                }, 200);
                                            }}
                                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <span className="text-sm font-medium text-gray-700 group-hover:text-orange-600 transition-colors">
                                            🧵 Enable Nylon Hanger Supports (Auto)
                                        </span>
                                    </label>
                                </div>
                                
                                <div className="flex items-center space-x-4">
                                    <label className="flex items-center space-x-2 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={enableAluSuspension}
                                            onChange={(e) => {
                                                userChangedSupportOptionsRef.current = true;
                                                setEnableAluSuspension(e.target.checked);
                                                // Auto-enable custom drawing when alu suspension is enabled
                                                if (e.target.checked && !aluSuspensionCustomDrawing) {
                                                    setAluSuspensionCustomDrawing(true);
                                                }
                                                setTimeout(() => {
                                                    userChangedSupportOptionsRef.current = false;
                                                }, 200);
                                            }}
                                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <span className="text-sm font-medium text-gray-700 group-hover:text-orange-600 transition-colors">
                                            🔧 Enable Alu Suspension (Custom Drawing)
                                        </span>
                                    </label>
                                </div>
                            </div>
                            
                            {/* Nylon Hanger Options */}
                            {enableNylonHangers && (
                                <div className="pl-6 border-l-2 border-blue-200 space-y-2">
                                    <p className="text-xs font-semibold text-gray-600 mb-2">Nylon Hanger Options:</p>
                                    <div className="flex items-center space-x-4">
                                        <label className="flex items-center space-x-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={nylonHangerOptions.includeAccessories}
                                                onChange={(e) => {
                                                    userChangedSupportOptionsRef.current = true;
                                                    setNylonHangerOptions(prev => ({
                                                        ...prev,
                                                        includeAccessories: e.target.checked
                                                    }));
                                                    setTimeout(() => {
                                                        userChangedSupportOptionsRef.current = false;
                                                    }, 200);
                                                }}
                                            />
                                            <span className="text-sm text-gray-700 group-hover:text-orange-600 transition-colors">Include Accessories</span>
                                        </label>
                                        <label className="flex items-center space-x-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={nylonHangerOptions.includeCable}
                                                onChange={(e) => {
                                                    userChangedSupportOptionsRef.current = true;
                                                    setNylonHangerOptions(prev => ({
                                                        ...prev,
                                                        includeCable: e.target.checked
                                                    }));
                                                    setTimeout(() => {
                                                        userChangedSupportOptionsRef.current = false;
                                                    }, 200);
                                                }}
                                            />
                                            <span className="text-sm text-gray-700 group-hover:text-orange-600 transition-colors">Include Cable</span>
                                        </label>
                                    </div>
                                </div>
                            )}
                            
                            {/* Alu Suspension Options - Info only, drawing is controlled by button in canvas */}
                            {enableAluSuspension && (
                                <div className="pl-6 border-l-2 border-purple-200 space-y-2">
                                    <p className="text-xs font-semibold text-gray-600 mb-2">Alu Suspension:</p>
                                    <p className="text-xs text-gray-600">
                                        Use the "Draw Support Line" button in the canvas to place support lines. 
                                        Supports will remain visible after drawing.
                                    </p>
                                </div>
                            )}
                            
                            {/* Info message when both are enabled */}
                            {enableNylonHangers && enableAluSuspension && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                    <p className="text-xs text-blue-700">
                                        <strong>Note:</strong> Both support types are enabled. Nylon hangers will be automatically placed on panels {'>'} 6000mm, and you can manually draw Alu suspension supports.
                                    </p>
                                </div>
                            )}
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
                        <button
                            onClick={toggleMergeMode}
                            className={`px-4 py-2 rounded-xl font-semibold transition-all duration-200 shadow-md hover:shadow-lg ${
                                isMergeMode
                                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                                    : 'bg-white text-orange-600 border border-orange-300 hover:bg-orange-50'
                            }`}
                        >
                            {isMergeMode ? 'Close Merge Mode' : 'Merge Ceilings'}
                        </button>
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

                {isMergeMode && (
                    <div className="mt-4 p-5 border-2 border-orange-300 bg-orange-50 rounded-xl shadow-sm">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-orange-700 flex items-center">
                                    <svg className="w-5 h-5 mr-2 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l3 3" />
                                    </svg>
                                    Merge Ceiling Zone
                                </h3>
                                <p className="text-sm text-orange-700 mt-1">
                                    Select rooms with matching heights. Internal walls must be lower than the available clearance (room height − ceiling thickness).
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    setMergeSelection([]);
                                    setMergeError(null);
                                }}
                                className="px-3 py-1 text-sm text-orange-600 border border-orange-300 rounded-lg hover:bg-orange-100"
                            >
                                Clear Selection
                            </button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="bg-white rounded-lg border border-orange-200 p-4">
                                <h4 className="text-sm font-semibold text-orange-800 mb-3">Available Rooms</h4>
                                {roomsAvailableForMerge.length === 0 ? (
                                    <p className="text-sm text-gray-600">All rooms are already part of merged zones.</p>
                                ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-2">
                                        {roomsAvailableForMerge.map(room => (
                                            <label key={room.id} className="flex items-center justify-between border border-orange-100 rounded-lg px-3 py-2 hover:bg-orange-100 transition-colors cursor-pointer">
                                                <div className="flex items-center space-x-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={mergeSelection.includes(room.id)}
                                                        onChange={() => handleMergeRoomToggle(room.id)}
                                                        className="w-4 h-4 text-orange-600 border-orange-300 rounded focus:ring-orange-400"
                                                    />
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-800">{room.room_name}</p>
                                                        <p className="text-xs text-gray-500">Height: {room.height || projectData?.height || 'n/a'} mm</p>
                                                    </div>
                                                </div>
                                                <span className="text-xs text-gray-500">ID #{room.id}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="bg-white rounded-lg border border-orange-200 p-4 space-y-3">
                                <h4 className="text-sm font-semibold text-orange-800">Merge Summary</h4>
                                <div className="text-sm text-gray-700 space-y-1">
                                    <p><span className="font-medium">Rooms selected:</span> {mergeSelection.length}</p>
                                    <p>
                                        <span className="font-medium">Shared top elevation:</span> {selectedMergeHeight ? `${selectedMergeHeight} mm` : mergeSelection.length === 0 ? '—' : 'Mismatch'}
                                    </p>
                                    <p><span className="font-medium">Ceiling thickness:</span> {ceilingThickness} mm</p>
                                    <p><span className="font-medium">Orientation:</span> {selectedOrientationStrategy}</p>
                                    <p><span className="font-medium">Panel width:</span> {panelWidth} mm</p>
                                </div>
                                {mergeError && (
                                    <div className="p-2 bg-red-100 border border-red-300 text-red-700 text-sm rounded">
                                        {mergeError}
                                    </div>
                                )}
                                <button
                                    onClick={handleMergeCeiling}
                                    disabled={isMerging || mergeSelection.length < 2}
                                    className={`w-full px-4 py-2 rounded-lg font-semibold transition-colors ${
                                        isMerging || mergeSelection.length < 2
                                            ? 'bg-orange-200 text-orange-500 cursor-not-allowed'
                                            : 'bg-orange-600 text-white hover:bg-orange-700'
                                    }`}
                                >
                                    {isMerging ? 'Merging...' : 'Merge Selected Rooms'}
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 bg-white border border-orange-200 rounded-lg p-4">
                            <h4 className="text-sm font-semibold text-orange-800 mb-3 flex items-center">
                                <svg className="w-4 h-4 mr-2 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m6 0h-2m-8 4h10" />
                                </svg>
                                Existing Merged Zones
                            </h4>
                            {isZonesUpdating ? (
                                <div className="flex items-center justify-center py-6 text-sm text-orange-600">
                                    <svg className="w-4 h-4 mr-2 animate-spin" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                    </svg>
                                    Updating merged zones…
                                </div>
                            ) : ceilingZones.length === 0 ? (
                                <p className="text-sm text-gray-600">No merged zones created yet.</p>
                            ) : (
                                <div className="space-y-3">
                                    {ceilingZones.map(zone => (
                                        <div key={zone.id} className="border border-orange-100 rounded-lg px-3 py-2 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                            <div>
                                                <p className="text-sm font-semibold text-gray-800">Zone #{zone.id}</p>
                                                <p className="text-xs text-gray-500">
                                                    Rooms: {zone.room_ids?.map(id => allRooms.find(room => room.id === id)?.room_name || `Room ${id}`).join(', ') || '—'}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    Panels: {zone.total_panels} • Waste: {zone.waste_percentage?.toFixed?.(1) ?? '0.0'}% • Orientation: {zone.orientation_strategy}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleDissolveZone(zone.id)}
                                                disabled={dissolvingZoneId === zone.id}
                                                className={`px-3 py-1 rounded-lg text-sm font-medium ${
                                                    dissolvingZoneId === zone.id
                                                        ? 'bg-gray-200 text-gray-500'
                                                        : 'bg-white border border-red-300 text-red-600 hover:bg-red-50'
                                                }`}
                                            >
                                                {dissolvingZoneId === zone.id ? 'Removing...' : 'Unmerge Zone'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Main Content */}
            <div className="p-6 pl-8">
                {ceilingPlan ? (
                    <div className="space-y-6">
                        <div className="space-y-4">
                            {hasActiveSelection && (
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => setIsDetailsPanelOpen(prev => !prev)}
                                        className="px-4 py-2 text-xs sm:text-sm rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
                                    >
                                        {isDetailsPanelOpen ? 'Hide Details Panel' : 'Show Details Panel'}
                                    </button>
                                </div>
                            )}
                        {/* Canvas */}
                        <CeilingCanvas
                            rooms={filteredRooms}
                            walls={allWalls}
                            intersections={allIntersections}
                            ceilingPlan={ceilingPlan}
                            ceilingPanels={ceilingPanels}
                            projectData={projectData}
                            projectWastePercentage={projectWastePercentage}
                            ceilingThickness={ceilingThickness}
                            ceilingPanelsMap={ceilingPanelsMap}
                                zones={ceilingZones}
                            orientationAnalysis={orientationAnalysis}
                            // Support configuration
                            supportType={supportType}
                            enableNylonHangers={enableNylonHangers}
                            enableAluSuspension={enableAluSuspension}
                            nylonHangerOptions={nylonHangerOptions}
                            aluSuspensionCustomDrawing={aluSuspensionCustomDrawing}
                            panelsNeedSupport={panelsNeedSupport}
                            customSupports={customSupports}
                            onCustomSupportsChange={setCustomSupports}
                            // Room selection props
                            selectedRoomId={selectedRoomId}
                            showAllRooms={showAllRooms}
                            onRoomSelect={handleRoomSelection}
                            onRoomDeselect={handleRoomDeselection}
                            // Add updateSharedPanelData prop to pass support options
                            updateSharedPanelData={updateSharedPanelData}
                        />
                        </div>
                        
                        {/* Success Message */}
                        {roomRegenerationSuccess && (
                            <div className="bg-green-100 border-2 border-green-500 rounded-lg p-4 flex items-center gap-3 animate-pulse">
                                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <div>
                                    <p className="font-semibold text-green-800">Success!</p>
                                    <p className="text-sm text-green-700">Ceiling plan regenerated for this room only.</p>
                                </div>
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

                        {shouldShowDetailsPanel && (
                            <div className="w-full bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
                                <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 gap-3">
                                    <div className="space-y-1">
                                        {showRoomDetailsPanel ? (
                                            <>
                                                <h3 className="text-lg font-semibold text-gray-900">
                                                    Room Details: {selectedRoom?.room_name || 'Room'}
                                    </h3>
                                                {selectedRoom && (
                                                    <p className="text-xs text-gray-500">
                                                        ID #{selectedRoom.id}
                                                    </p>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <h3 className="text-lg font-semibold text-gray-900">
                                                    {activeZone ? `Zone #${activeZone.id} Panel Details` : 'Zone Panel Details'}
                                                </h3>
                                                {activeZone && (
                                                    <p className="text-xs text-gray-500">
                                                        Rooms: {activeZone.room_ids?.map(id => allRooms.find(room => room.id === id)?.room_name || `Room ${id}`).join(', ') || '—'}
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap justify-end">
                                        {showZoneDetailsPanel && isZonesUpdating && (
                                            <div className="flex items-center text-xs text-orange-600 gap-1">
                                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                                </svg>
                                                <span>Updating…</span>
                                            </div>
                                        )}
                                        {showRoomDetailsPanel && (
                                    <button
                                        onClick={() => setShowRoomDetails(!showRoomDetails)}
                                                className="px-3 py-1 text-xs sm:text-sm rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
                                    >
                                        {showRoomDetails ? 'Hide Details' : 'Show Details'}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setIsDetailsPanelOpen(false)}
                                            className="px-3 py-1 text-xs sm:text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                                        >
                                            Collapse
                                        </button>
                                        <button
                                            onClick={handleRoomDeselection}
                                            className="px-3 py-1 text-xs sm:text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            Clear
                                    </button>
                                </div>
                                </div>
                                <div className="px-5 py-4 overflow-y-auto max-h-[60vh]">
                                    {showRoomDetailsPanel ? (
                                        showRoomDetails ? (
                                            <>
                                                <div className="grid grid-cols-1 gap-6">
                                                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                                                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Room Information</h4>
                                            <div className="space-y-2 text-sm">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Room Name:</span>
                                                                <span className="font-medium text-gray-800">
                                                                    {selectedRoom?.room_name || '—'}
                                                                </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Room Height:</span>
                                                                <span className="font-medium text-gray-800">
                                                                    {selectedRoom?.height ?? 'Default'} mm
                                                                </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-600">Panel Count:</span>
                                                                <span className="font-medium text-gray-800">
                                                                    {selectedRoomPanelStats?.total ?? ceilingPanels.filter(p => p.room_id === selectedRoomId).length} panels
                                                    </span>
                                                </div>
                                                            <div className="pt-3 mt-3 border-t border-gray-200">
                                                                <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                                                                    Current Ceiling Settings
                                                                </h5>
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Ceiling Thickness:</span>
                                                        <span className="font-medium text-blue-600">
                                                                        {selectedRoom?.ceiling_plan?.ceiling_thickness || ceilingThickness} mm
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Panel Width:</span>
                                                        <span className="font-medium text-blue-600">
                                                                        {selectedRoom?.ceiling_plan?.panel_width || panelWidth} mm
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-600">Orientation:</span>
                                                                    <span className="font-medium text-blue-600">
                                                                        {formatOrientationLabel(selectedRoom?.ceiling_plan?.orientation_strategy)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                                                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Edit Ceiling Settings</h4>
                                                        <div className="space-y-3 text-sm">
                                                <div className="flex items-center justify-between">
                                                                <label className="text-gray-600">Ceiling Thickness:</label>
                                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        min="50"
                                                        max="500"
                                                        step="10"
                                                        value={roomEditConfig.ceilingThickness}
                                                                        onChange={(e) => setRoomEditConfig(prev => ({
                                                                            ...prev,
                                                                            ceilingThickness: parseInt(e.target.value)
                                                                        }))}
                                                                        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span className="text-xs text-gray-500">mm</span>
                                                </div>
                                                            </div>
                                                <div className="flex items-center justify-between">
                                                                <label className="text-gray-600">Panel Width:</label>
                                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        min="100"
                                                        max="3000"
                                                        step="50"
                                                        value={roomEditConfig.panelWidth}
                                                                        onChange={(e) => setRoomEditConfig(prev => ({
                                                                            ...prev,
                                                                            panelWidth: parseInt(e.target.value)
                                                                        }))}
                                                                        className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span className="text-xs text-gray-500">mm</span>
                                                </div>
                                                            </div>
                                                <div className="flex items-center justify-between">
                                                                <label className="text-gray-600">Orientation:</label>
                                                    <select
                                                        value={roomEditConfig.orientationStrategy}
                                                                    onChange={(e) => setRoomEditConfig(prev => ({
                                                                        ...prev,
                                                                        orientationStrategy: e.target.value
                                                                    }))}
                                                        className="flex-1 ml-2 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    >
                                                        <option value="auto">Auto (Best)</option>
                                                        <option value="all_vertical">Vertical</option>
                                                        <option value="all_horizontal">Horizontal</option>
                                                        <option value="room_optimal">Room Optimal</option>
                                                    </select>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                                <label className="text-gray-600">Panel Length:</label>
                                                    <select
                                                        value={roomEditConfig.panelLength}
                                                                    onChange={(e) => setRoomEditConfig(prev => ({
                                                                        ...prev,
                                                                        panelLength: e.target.value
                                                                    }))}
                                                        className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                    >
                                                        <option value="auto">Auto</option>
                                                        <option value="custom">Custom</option>
                                                    </select>
                                                </div>
                                                {roomEditConfig.panelLength === 'custom' && (
                                                    <div className="flex items-center justify-between">
                                                                    <label className="text-gray-600">Custom Length:</label>
                                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="number"
                                                            min="1000"
                                                            max="20000"
                                                            step="100"
                                                            value={roomEditConfig.customPanelLength}
                                                                            onChange={(e) => setRoomEditConfig(prev => ({
                                                                                ...prev,
                                                                                customPanelLength: parseInt(e.target.value)
                                                                            }))}
                                                                            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                        />
                                                        <span className="text-xs text-gray-500">mm</span>
                                        </div>
                                    </div>
                                )}
                                        </div>
                                                        <div className="mt-4 flex items-center justify-between">
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
                                                </div>
                                                <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                                                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Panel Totals by Dimension</h4>
                                                    {selectedRoomPanelStats?.groupedPanels && selectedRoomPanelStats.groupedPanels.length > 0 ? (
                                                        <div className="overflow-x-auto">
                                                            <table className="min-w-full bg-white border border-gray-200 text-sm">
                                                                <thead className="bg-gray-100">
                                                                    <tr>
                                                                        <th className="px-3 py-2 border text-left">Panel Width (mm)</th>
                                                                        <th className="px-3 py-2 border text-left">Panel Length (mm)</th>
                                                                        <th className="px-3 py-2 border text-left">Thickness (mm)</th>
                                                                        <th className="px-3 py-2 border text-left">Type</th>
                                                                        <th className="px-3 py-2 border text-left">Quantity</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {selectedRoomPanelStats.groupedPanels.map((panel, index) => (
                                                                        <tr key={`${panel.width}-${panel.length}-${panel.thickness}-${index}`} className="hover:bg-gray-50">
                                                                            <td className="px-3 py-2 border">{panel.width}</td>
                                                                            <td className="px-3 py-2 border">{panel.length}</td>
                                                                            <td className="px-3 py-2 border">{panel.thickness}</td>
                                                                            <td className="px-3 py-2 border">
                                                                                {panel.isCut ? (
                                                                                    <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                                                                                        Cut
                                                                                    </span>
                                                                                ) : (
                                                                                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                                                                                        Full
                                                                                    </span>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-3 py-2 border font-semibold">{panel.quantity}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <div className="text-gray-500 text-sm">
                                                            No panel data available for this room.
                            </div>
                        )}
                                                </div>
                                                <div className="mt-6 bg-white border border-gray-200 rounded-lg p-4">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h4 className="text-sm font-semibold text-gray-700">Individual Panels</h4>
                                                        {selectedRoomPanelStats?.panels && selectedRoomPanelStats.panels.length > 0 && (
                                                            <span className="text-xs text-gray-500">
                                                                Showing {selectedRoomPanelStats.panels.length} panels
                                                            </span>
                                                        )}
                                                    </div>
                                                    {selectedRoomPanelStats?.panels && selectedRoomPanelStats.panels.length > 0 ? (
                                                        <div className="overflow-x-auto max-h-64">
                                                            <table className="min-w-full border border-gray-200 text-sm">
                                                                <thead className="bg-gray-100">
                                                                    <tr>
                                                                        <th className="px-3 py-2 border text-left">Panel ID</th>
                                                                        <th className="px-3 py-2 border text-left">Width (mm)</th>
                                                                        <th className="px-3 py-2 border text-left">Length (mm)</th>
                                                                        <th className="px-3 py-2 border text-left">Thickness (mm)</th>
                                                                        <th className="px-3 py-2 border text-left">Type</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {selectedRoomPanelStats.panels.map(panel => (
                                                                        <tr key={panel.id || panel.panel_id} className="hover:bg-gray-50">
                                                                            <td className="px-3 py-2 border">{panel.panel_id || panel.id || '—'}</td>
                                                                            <td className="px-3 py-2 border">{panel.width}</td>
                                                                            <td className="px-3 py-2 border">{panel.length}</td>
                                                                            <td className="px-3 py-2 border">{panel.thickness || ceilingThickness}</td>
                                                                            <td className="px-3 py-2 border">
                                                                                {panel.is_cut_panel || panel.is_cut ? 'Cut' : 'Full'}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    ) : (
                                                        <div className="text-gray-500 text-sm">
                                                            No panels found for this room.
                                                        </div>
                                                    )}
                            </div>
                                            </>
                                        ) : (
                                            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                                                Details are hidden. Click "Show Details" to view room information.
                                            </div>
                                        )
                                    ) : (
                                        <>
                                            {zoneRegenerationSuccess && (
                                                <div className="mb-4 bg-green-100 border border-green-500 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    <span>Zone settings applied successfully.</span>
                                                </div>
                                            )}
                                            {!activeZone ? (
                                                <div className="flex items-center justify-center py-12 text-gray-500">
                                                    Loading zone information…
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="space-y-6 mb-6">
                                                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                                                            <h4 className="text-sm font-semibold text-gray-700 mb-3">Zone Information</h4>
                                                            <div className="space-y-2 text-sm">
                                                                <div className="flex justify-between">
                                                                    <span className="text-gray-600">Zone Name:</span>
                                                                    <span className="font-medium text-gray-800">
                                                                        Zone #{activeZone.id}
                                                                    </span>
                                                                </div>
                                                                <div className="flex justify-between items-start">
                                                                    <span className="text-gray-600">Rooms Included:</span>
                                                                    <span className="font-medium text-right text-gray-800">
                                                                        {activeZone.room_ids?.map(id => allRooms.find(room => room.id === id)?.room_name || `Room ${id}`).join(', ') || '—'}
                                                                    </span>
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <span className="text-gray-600">Panel Count:</span>
                                                                    <span className="font-medium text-gray-800">
                                                                        {activeZonePanelStats?.total ?? 0} panels
                                                                    </span>
                                                                </div>
                                                                <div className="pt-3 mt-3 border-t border-gray-200">
                                                                    <h5 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                                                                        Current Ceiling Settings
                                                                    </h5>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-gray-600">Ceiling Thickness:</span>
                                                                        <span className="font-medium text-blue-600">
                                                                            {activeZone?.ceiling_thickness ?? ceilingThickness} mm
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-gray-600">Panel Width:</span>
                                                                        <span className="font-medium text-blue-600">
                                                                            {activeZone?.panel_width ?? '—'} mm
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex justify-between">
                                                                        <span className="text-gray-600">Orientation:</span>
                                                                        <span className="font-medium text-blue-600">
                                                                            {formatOrientationLabel(activeZone?.orientation_strategy)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                                                            <h4 className="text-sm font-semibold text-gray-700 mb-3">Zone Ceiling Settings</h4>
                                                            <div className="space-y-3 text-sm">
                                                                <div className="flex items-center justify-between">
                                                                    <label className="text-gray-600">Ceiling Thickness:</label>
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="number"
                                                                            min="50"
                                                                            max="500"
                                                                            step="10"
                                                                            value={zoneEditConfig.ceilingThickness}
                                                                            onChange={(e) => setZoneEditConfig(prev => ({
                                                                                ...prev,
                                                                                ceilingThickness: parseInt(e.target.value)
                                                                            }))}
                                                                            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                                        />
                                                                        <span className="text-xs text-gray-500">mm</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-between">
                                                                    <label className="text-gray-600">Panel Width:</label>
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="number"
                                                                            min="100"
                                                                            max="3000"
                                                                            step="50"
                                                                            value={zoneEditConfig.panelWidth}
                                                                            onChange={(e) => setZoneEditConfig(prev => ({
                                                                                ...prev,
                                                                                panelWidth: parseInt(e.target.value)
                                                                            }))}
                                                                            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                                        />
                                                                        <span className="text-xs text-gray-500">mm</span>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center justify-between">
                                                                    <label className="text-gray-600">Orientation:</label>
                                                                    <select
                                                                        value={zoneEditConfig.orientationStrategy}
                                                                        onChange={(e) => setZoneEditConfig(prev => ({
                                                                            ...prev,
                                                                            orientationStrategy: e.target.value
                                                                        }))}
                                                                        className="flex-1 ml-2 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                                    >
                                                                        <option value="auto">Auto (Best)</option>
                                                                        <option value="all_vertical">Vertical</option>
                                                                        <option value="all_horizontal">Horizontal</option>
                                                                        <option value="room_optimal">Room Optimal</option>
                                                                    </select>
                                                                </div>
                                                                <div className="flex items-center justify-between">
                                                                    <label className="text-gray-600">Panel Length:</label>
                                                                    <select
                                                                        value={zoneEditConfig.panelLength}
                                                                        onChange={(e) => setZoneEditConfig(prev => ({
                                                                            ...prev,
                                                                            panelLength: e.target.value
                                                                        }))}
                                                                        className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                                    >
                                                                        <option value="auto">Auto</option>
                                                                        <option value="custom">Custom</option>
                                                                    </select>
                                                                </div>
                                                                {zoneEditConfig.panelLength === 'custom' && (
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="text-gray-600">Custom Length:</label>
                                                                        <div className="flex items-center gap-2">
                                                                            <input
                                                                                type="number"
                                                                                min="1000"
                                                                                max="20000"
                                                                                step="100"
                                                                                value={zoneEditConfig.customPanelLength}
                                                                                onChange={(e) => setZoneEditConfig(prev => ({
                                                                                    ...prev,
                                                                                    customPanelLength: parseInt(e.target.value)
                                                                                }))}
                                                                                className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                                                            />
                                                                            <span className="text-xs text-gray-500">mm</span>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-600 italic">
                                                                💡 Changes will apply only to this zone. Other zones keep their current settings.
                                                            </div>
                                                            <div className="mt-4 flex items-center justify-between">
                                                                <div className="text-xs text-gray-600 italic">
                                                                    Need to reuse global defaults? Use the reset button below.
                                                                </div>
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        onClick={() => setZoneEditConfig({
                                                                            ceilingThickness,
                                                                            panelWidth,
                                                                            panelLength,
                                                                            customPanelLength,
                                                                            orientationStrategy: selectedOrientationStrategy
                                                                        })}
                                                                        className="px-4 py-2 bg-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-400 transition-colors font-medium"
                                                                    >
                                                                        Reset to Global
                                                                    </button>
                                                                    <button
                                                                        onClick={() => applyZoneSettings(activeZone?.id)}
                                                                        disabled={isRegeneratingZone}
                                                                        className={`px-6 py-2 text-sm rounded-lg font-medium transition-colors shadow-md ${
                                                                            isRegeneratingZone
                                                                                ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                                                                                : 'bg-green-600 text-white hover:bg-green-700'
                                                                        }`}
                                                                    >
                                                                        {isRegeneratingZone ? (
                                                                            <span className="flex items-center gap-2">
                                                                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                                                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                                                                                </svg>
                                                                                Applying...
                                                                            </span>
                                                                        ) : (
                                                                            '✓ Apply Settings to this zone only'
                                                                        )}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                                            <h4 className="text-sm font-semibold text-gray-700 mb-3">Panel Totals by Dimension</h4>
                                                            {activeZonePanelStats?.groupedPanels && activeZonePanelStats.groupedPanels.length > 0 ? (
                                                                <div className="overflow-x-auto">
                                                                    <table className="min-w-full bg-white border border-gray-200 text-sm">
                                                                        <thead className="bg-gray-100">
                                                                            <tr>
                                                                                <th className="px-3 py-2 border text-left">Panel Width (mm)</th>
                                                                                <th className="px-3 py-2 border text-left">Panel Length (mm)</th>
                                                                                <th className="px-3 py-2 border text-left">Thickness (mm)</th>
                                                                                <th className="px-3 py-2 border text-left">Type</th>
                                                                                <th className="px-3 py-2 border text-left">Quantity</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {activeZonePanelStats.groupedPanels.map((panel, index) => (
                                                                                <tr key={`${panel.width}-${panel.length}-${panel.thickness}-${index}`} className="hover:bg-gray-50">
                                                                                    <td className="px-3 py-2 border">{panel.width}</td>
                                                                                    <td className="px-3 py-2 border">{panel.length}</td>
                                                                                    <td className="px-3 py-2 border">{panel.thickness}</td>
                                                                                    <td className="px-3 py-2 border">
                                                                                        {panel.isCut ? (
                                                                                            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                                                                                                Cut
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                                                                                                Full
                                                                                            </span>
                                                                                        )}
                                                                                    </td>
                                                                                    <td className="px-3 py-2 border font-semibold">{panel.quantity}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            ) : (
                                                                <div className="text-gray-500 text-sm">
                                                                    No panel data available for this zone.
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="bg-white border border-gray-200 rounded-lg p-4">
                                                            <div className="flex items-center justify-between mb-3">
                                                                <h4 className="text-sm font-semibold text-gray-700">Individual Panels</h4>
                                                                {activeZonePanelStats?.panels && activeZonePanelStats.panels.length > 0 && (
                                                                    <span className="text-xs text-gray-500">
                                                                        Showing {activeZonePanelStats.panels.length} panels
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {activeZonePanelStats?.panels && activeZonePanelStats.panels.length > 0 ? (
                                                                <div className="overflow-x-auto max-h-80">
                                                                    <table className="min-w-full border border-gray-200 text-sm">
                                                                        <thead className="bg-gray-100">
                                                                            <tr>
                                                                                <th className="px-3 py-2 border text-left">Panel ID</th>
                                                                                <th className="px-3 py-2 border text-left">Width (mm)</th>
                                                                                <th className="px-3 py-2 border text-left">Length (mm)</th>
                                                                                <th className="px-3 py-2 border text-left">Thickness (mm)</th>
                                                                                <th className="px-3 py-2 border text-left">Type</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {activeZonePanelStats.panels.map(panel => (
                                                                                <tr key={panel.id || panel.panel_id} className="hover:bg-gray-50">
                                                                                    <td className="px-3 py-2 border">
                                                                                        {panel.panel_id || panel.id || '—'}
                                                                                    </td>
                                                                                    <td className="px-3 py-2 border">{panel.width}</td>
                                                                                    <td className="px-3 py-2 border">{panel.length}</td>
                                                                                    <td className="px-3 py-2 border">{panel.thickness || ceilingThickness}</td>
                                                                                    <td className="px-3 py-2 border">
                                                                                        {panel.is_cut_panel || panel.is_cut ? 'Cut' : 'Full'}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            ) : (
                                                                <div className="text-gray-500 text-sm">
                                                                    No panels found for this zone.
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
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

