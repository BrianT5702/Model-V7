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
    const [ceilingPlans, setCeilingPlans] = useState([]); // Array of all ceiling plans for multi-room mode
    const [ceilingPanels, setCeilingPanels] = useState([]);
    const [projectData, setProjectData] = useState(null);
    const [storeys, setStoreys] = useState([]);
    const [selectedStoreyId, setSelectedStoreyId] = useState("");
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
    const [selectedPanelIds, setSelectedPanelIds] = useState([]);
    const [panelSwapError, setPanelSwapError] = useState(null);
    const [panelSwapSuccess, setPanelSwapSuccess] = useState(false);
    const [isSwappingPanels, setIsSwappingPanels] = useState(false);
    const swapFeedbackTimeoutRef = useRef(null);
    const previousSelectedRoomKeyRef = useRef(null);
    
    // Dimension visibility filters (checkboxes)
    const [dimensionVisibility, setDimensionVisibility] = useState({
        room: true,
        panel: true,
        cutPanel: false  // Cut panel dimensions unchecked by default
    });
    const toggleDimensionVisibility = (key) => {
        setDimensionVisibility(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Orientation strategy
    const [selectedOrientationStrategy, setSelectedOrientationStrategy] = useState('auto');
    const [orientationAnalysis, setOrientationAnalysis] = useState(null);
    
    // Panel dimension configuration
    const [panelWidth, setPanelWidth] = useState(1150);
    const [panelLength, setPanelLength] = useState('auto');
    const [customPanelLength, setCustomPanelLength] = useState(10000);
    const [ceilingThickness, setCeilingThickness] = useState(150);

    // Per-room ceiling configuration (thickness, panel size, finishes, orientation)
    // roomEditConfig = currently selected room's config
    const [roomEditConfig, setRoomEditConfig] = useState({
        ceilingThickness,
        panelWidth,
        panelLength,
        customPanelLength,
        orientationStrategy: selectedOrientationStrategy,
        innerFaceMaterial: 'PPGI',
        innerFaceThickness: 0.5,
        outerFaceMaterial: 'PPGI',
        outerFaceThickness: 0.5
    });
    // Cache configs per-room so edits persist when switching rooms, even before regeneration
    const [roomConfigsByRoomId, setRoomConfigsByRoomId] = useState({});

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

    // Ceiling face configuration (inner/outer materials + sheet thickness)
    const [ceilingInnerFaceMaterial, setCeilingInnerFaceMaterial] = useState('PPGI');
    const [ceilingInnerFaceThickness, setCeilingInnerFaceThickness] = useState(0.5);
    const [ceilingOuterFaceMaterial, setCeilingOuterFaceMaterial] = useState('PPGI');
    const [ceilingOuterFaceThickness, setCeilingOuterFaceThickness] = useState(0.5);
    
    // Track if current plan needs regeneration due to dimension changes
    const [planNeedsRegeneration, setPlanNeedsRegeneration] = useState(false);

    // Room selection state
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [showAllRooms, setShowAllRooms] = useState(true);
    const [showRoomDetails, setShowRoomDetails] = useState(false);
    const [detailsPanelTab, setDetailsPanelTab] = useState('details'); // 'details', 'joints', 'panels'
    
    // Ceiling joint configuration state
    const [wallJointConfigs, setWallJointConfigs] = useState({}); // {wallId: {jointType, horizontalExtension}}
    const [isSavingJointConfigs, setIsSavingJointConfigs] = useState(false);
    const [jointSaveSuccess, setJointSaveSuccess] = useState(false);
    const [jointSaveError, setJointSaveError] = useState(null);
    
    // Clear feedback messages when switching tabs
    useEffect(() => {
        if (detailsPanelTab !== 'joints') {
            setJointSaveSuccess(false);
            setJointSaveError(null);
        }
    }, [detailsPanelTab]);
    
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
            setDetailsPanelTab('details'); // Default to details tab
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
        setSelectedPanelIds([]);
        setPanelSwapError(null);
        setPanelSwapSuccess(false);
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

    const normalizePanelIdentifier = useCallback((value) => {
        return value === null || value === undefined ? null : value.toString();
    }, []);

    const normalizeRoomKey = useCallback((value) => {
        if (value === null || value === undefined) return null;
        return typeof value === 'string' ? value : value.toString();
    }, []);

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

    useEffect(() => {
        const currentRoomKey = normalizeRoomKey(selectedRoomId);
        const previousKey = previousSelectedRoomKeyRef.current;
        if (previousKey && currentRoomKey && previousKey !== currentRoomKey) {
            setSelectedPanelIds([]);
            setPanelSwapError(null);
            setPanelSwapSuccess(false);
        }
        if (!currentRoomKey) {
            setSelectedPanelIds([]);
            setPanelSwapError(null);
            setPanelSwapSuccess(false);
        }
        previousSelectedRoomKeyRef.current = currentRoomKey;
    }, [selectedRoomId, normalizeRoomKey]);

    // Filter rooms and zones by selected storey
    const filteredRooms = useMemo(() => {
        // Remove the null check: if (!selectedStoreyId) return allRooms;
        return allRooms.filter(room => String(room.storey) === String(selectedStoreyId));
    }, [allRooms, selectedStoreyId]);

    // Filter walls by selected storey
    const filteredWalls = useMemo(() => {
        if (!selectedStoreyId) return allWalls; // Show all if no storey selected
        return allWalls.filter(wall => {
            const wallStoreyId = wall.storey ?? wall.storey_id;
            return String(wallStoreyId) === String(selectedStoreyId);
        });
    }, [allWalls, selectedStoreyId]);

    const filteredZones = useMemo(() => {
        if (!selectedStoreyId) return ceilingZones; // Show all if no storey selected
        return ceilingZones.filter(zone => {
            // Check if zone has rooms that match the selected storey
            if (!zone.room_ids || zone.room_ids.length === 0) return false;
            return zone.room_ids.some(roomId => {
                const room = allRooms.find(r => r.id === roomId);
                return room && String(room.storey) === String(selectedStoreyId);
            });
        });
    }, [ceilingZones, allRooms, selectedStoreyId]);

    const roomsAvailableForMerge = useMemo(() => {
        if (!filteredRooms || filteredRooms.length === 0) return [];
        return filteredRooms.filter(room => !room.ceiling_zones || room.ceiling_zones.length === 0);
    }, [filteredRooms]);

    const getPanelIdentifier = useCallback((panel) => {
        if (!panel) return null;
        const rawId = panel.id ?? panel.panel_id ?? panel.panelId ?? panel.uuid ?? null;
        return normalizePanelIdentifier(rawId);
    }, [normalizePanelIdentifier]);

    const getPanelByIdentifier = useCallback((panelId) => {
        const normalized = normalizePanelIdentifier(panelId);
        if (!normalized) return null;
        return ceilingPanels.find(panel => getPanelIdentifier(panel) === normalized) || null;
    }, [ceilingPanels, getPanelIdentifier]);

    const getPanelRoomKey = useCallback((panel) => {
        if (!panel) return null;
        if (panel.room_id !== undefined && panel.room_id !== null) {
            return panel.room_id.toString();
        }
        if (panel.zone_id !== undefined && panel.zone_id !== null) {
            return `zone-${panel.zone_id}`;
        }
        if (panel.zone !== undefined && panel.zone !== null) {
            return `zone-${panel.zone}`;
        }
        return null;
    }, []);

    useEffect(() => {
        return () => {
            if (swapFeedbackTimeoutRef.current) {
                clearTimeout(swapFeedbackTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        setSelectedPanelIds(prev => prev.filter(id => !!getPanelByIdentifier(id)));
    }, [ceilingPanels, getPanelByIdentifier]);

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

    const selectedPanels = useMemo(() => {
        return selectedPanelIds
            .map(id => getPanelByIdentifier(id))
            .filter(Boolean);
    }, [selectedPanelIds, getPanelByIdentifier]);

    const firstSelectedPanelRoomKey = useMemo(() => {
        if (selectedPanels.length === 0) return null;
        return getPanelRoomKey(selectedPanels[0]);
    }, [selectedPanels, getPanelRoomKey]);

    const selectedPanelRoomName = useMemo(() => {
        if (!firstSelectedPanelRoomKey) return null;

        if (firstSelectedPanelRoomKey.startsWith('zone-')) {
            const zoneId = parseInt(firstSelectedPanelRoomKey.replace('zone-', ''), 10);
            if (!Number.isNaN(zoneId)) {
                const zone = ceilingZones.find(z => z.id === zoneId);
                if (zone) {
                    const roomNames = Array.isArray(zone.room_ids)
                        ? zone.room_ids
                            .map(id => allRooms.find(room => room.id === id)?.room_name || `Room ${id}`)
                            .filter(Boolean)
                        : [];
                    return `Zone #${zoneId}${roomNames.length ? ` (${roomNames.join(', ')})` : ''}`;
                }
            }
            return `Zone ${firstSelectedPanelRoomKey.replace('zone-', '#')}`;
        }

        const room = allRooms.find(r => normalizeRoomKey(r.id) === firstSelectedPanelRoomKey);
        if (room?.room_name) {
            return room.room_name;
        }
        return `Room #${firstSelectedPanelRoomKey}`;
    }, [allRooms, ceilingZones, firstSelectedPanelRoomKey, normalizeRoomKey]);

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
    
    // Save support options and global ceiling face finishes to shared panel data whenever they change
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
                panelsNeedSupport: panelsNeedSupport,
                ceilingInnerFaceMaterial,
                ceilingInnerFaceThickness,
                ceilingOuterFaceMaterial,
                ceilingOuterFaceThickness
            };
            
            // Only update if values actually changed
            const prev = prevSupportOptionsRef.current;
            const hasChanged = 
                prev.enableNylonHangers !== currentOptions.enableNylonHangers ||
                prev.enableAluSuspension !== currentOptions.enableAluSuspension ||
                prev.includeAccessories !== currentOptions.includeAccessories ||
                prev.includeCable !== currentOptions.includeCable ||
                prev.aluSuspensionCustomDrawing !== currentOptions.aluSuspensionCustomDrawing ||
                prev.panelsNeedSupport !== currentOptions.panelsNeedSupport ||
                prev.ceilingInnerFaceMaterial !== currentOptions.ceilingInnerFaceMaterial ||
                prev.ceilingInnerFaceThickness !== currentOptions.ceilingInnerFaceThickness ||
                prev.ceilingOuterFaceMaterial !== currentOptions.ceilingOuterFaceMaterial ||
                prev.ceilingOuterFaceThickness !== currentOptions.ceilingOuterFaceThickness;
            
            if (hasChanged) {
                prevSupportOptionsRef.current = currentOptions;
                updateSharedPanelData('ceiling-support-options', null, currentOptions);
            }
        }
    }, [
        updateSharedPanelData,
        enableNylonHangers,
        enableAluSuspension,
        supportType,
        nylonHangerOptions.includeAccessories,
        nylonHangerOptions.includeCable,
        aluSuspensionCustomDrawing,
        panelsNeedSupport,
        ceilingInnerFaceMaterial,
        ceilingInnerFaceThickness,
        ceilingOuterFaceMaterial,
        ceilingOuterFaceThickness
    ]);
    
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
    
    // Track previous selectedRoomId to only reset config when room actually changes (not when allRooms updates)
    const previousSelectedRoomIdForConfigRef = useRef(null);
    
    // Sync room edit config when room is selected:
    // - Use room's current ceiling plan settings (thickness, width, orientation, etc.)
    // - Derive face finishes from existing ceiling panels for that room so UI reflects saved state
    useEffect(() => {
        const currentRoomId = selectedRoomId;
        const previousRoomId = previousSelectedRoomIdForConfigRef.current;
        const currentRoomKey = normalizeRoomKey(currentRoomId);
        
        // Only reset config if the room actually changed (not when allRooms updates)
        if (currentRoomId !== previousRoomId) {
            previousSelectedRoomIdForConfigRef.current = currentRoomId;

            if (currentRoomId) {
                // If we already have a cached config for this room (user edited earlier), restore it
                const cachedConfig = currentRoomKey ? roomConfigsByRoomId[currentRoomKey] : undefined;
                if (cachedConfig) {
                    setRoomEditConfig(cachedConfig);
                    return;
                }

                const selectedRoom = allRooms.find(r => r.id === currentRoomId);
                const roomIdNum = typeof currentRoomId === 'string' ? parseInt(currentRoomId, 10) : currentRoomId;
                // Try to find at least one panel for this room to infer face finishes
                const firstPanelForRoom = ceilingPanels.find(p => {
                    const pid = p.room_id ?? p.room;
                    return pid !== undefined && String(pid) === String(roomIdNum);
                });
                
                const intMat = firstPanelForRoom?.inner_face_material ?? ceilingInnerFaceMaterial;
                const intThk = firstPanelForRoom?.inner_face_thickness ?? ceilingInnerFaceThickness;
                const extMat = firstPanelForRoom?.outer_face_material ?? ceilingOuterFaceMaterial;
                const extThk = firstPanelForRoom?.outer_face_thickness ?? ceilingOuterFaceThickness;
                
                if (selectedRoom && selectedRoom.ceiling_plan) {
                    // Use the room's current ceiling plan settings + inferred face finishes
                    console.log(`🔄 [Room Config] Loading config for room ${currentRoomId} from ceiling plan + panels`, {
                        orientation: selectedRoom.ceiling_plan.orientation_strategy,
                        inner_face_material: intMat,
                        outer_face_material: extMat
                    });
                    const initialConfig = {
                        ceilingThickness: selectedRoom.ceiling_plan.ceiling_thickness || ceilingThickness,
                        panelWidth: selectedRoom.ceiling_plan.panel_width || panelWidth,
                        panelLength: selectedRoom.ceiling_plan.panel_length || panelLength,
                        customPanelLength: selectedRoom.ceiling_plan.custom_panel_length || customPanelLength,
                        orientationStrategy: selectedRoom.ceiling_plan.orientation_strategy || selectedOrientationStrategy,
                        innerFaceMaterial: intMat,
                        innerFaceThickness: intThk,
                        outerFaceMaterial: extMat,
                        outerFaceThickness: extThk
                    };
                    setRoomEditConfig(initialConfig);
                    setRoomConfigsByRoomId(prev => ({
                        ...prev,
                        [currentRoomKey]: initialConfig
                    }));
                } else {
                    // Use global settings as fallback (including global face finishes)
                    console.log(`🔄 [Room Config] Loading default config for room ${currentRoomId} (no ceiling_plan)`);                    
                    const defaultConfig = {
                        ceilingThickness: ceilingThickness,
                        panelWidth: panelWidth,
                        panelLength: panelLength,
                        customPanelLength: customPanelLength,
                        orientationStrategy: selectedOrientationStrategy,
                        innerFaceMaterial: ceilingInnerFaceMaterial,
                        innerFaceThickness: ceilingInnerFaceThickness,
                        outerFaceMaterial: ceilingOuterFaceMaterial,
                        outerFaceThickness: ceilingOuterFaceThickness
                    };
                    setRoomEditConfig(defaultConfig);
                    setRoomConfigsByRoomId(prev => ({
                        ...prev,
                        [currentRoomKey]: defaultConfig
                    }));
                }
            }
        } else {
            // Room hasn't changed, but allRooms or ceilingPanels might have updated after generation.
            // We intentionally avoid auto-overwriting roomEditConfig here to preserve in-progress user edits.
        }
    }, [
        selectedRoomId,
        allRooms,
        ceilingPanels,
        ceilingThickness,
        panelWidth,
        panelLength,
        customPanelLength,
        selectedOrientationStrategy,
        ceilingInnerFaceMaterial,
        ceilingInnerFaceThickness,
        ceilingOuterFaceMaterial,
        ceilingOuterFaceThickness,
        roomConfigsByRoomId
    ]);
    
    // Helper function to get default Cut L horizontal extension based on wall thickness
    const getCutLDefaultExtension = (wallThickness) => {
        if (wallThickness >= 200) return 125.0;
        if (wallThickness >= 150) return 100.0;
        if (wallThickness >= 125) return 75.0;
        if (wallThickness >= 100) return 75.0;
        if (wallThickness >= 75) return 50.0;
        return 50.0; // Default for thinner walls
    };
    
    // Helper function to get wall direction/label for better UX
    const getWallLabel = (wall, room) => {
        if (!room || !room.room_points || room.room_points.length < 3) {
            return `Wall #${wall.id}`;
        }
        
        // Calculate room center and bounding box
        const xs = room.room_points.map(p => p.x);
        const ys = room.room_points.map(p => p.y);
        const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
        const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        
        // Calculate wall midpoint
        const wallMidX = (wall.start_x + wall.end_x) / 2;
        const wallMidY = (wall.start_y + wall.end_y) / 2;
        
        // Determine wall position relative to room
        const tolerance = 10; // 10mm tolerance
        
        if (Math.abs(wall.start_x - minX) < tolerance && Math.abs(wall.end_x - minX) < tolerance) {
            return 'Left Wall';
        } else if (Math.abs(wall.start_x - maxX) < tolerance && Math.abs(wall.end_x - maxX) < tolerance) {
            return 'Right Wall';
        } else if (Math.abs(wall.start_y - minY) < tolerance && Math.abs(wall.end_y - minY) < tolerance) {
            return 'Bottom Wall';
        } else if (Math.abs(wall.start_y - maxY) < tolerance && Math.abs(wall.end_y - maxY) < tolerance) {
            return 'Top Wall';
        }
        
        // If not on a clear boundary, use direction
        const dx = wall.end_x - wall.start_x;
        const dy = wall.end_y - wall.start_y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        if (length < tolerance) {
            return `Wall #${wall.id}`;
        }
        
        // Determine if primarily horizontal or vertical
        if (Math.abs(dx) > Math.abs(dy)) {
            // Horizontal wall
            if (wallMidY < centerY) return 'Bottom Wall';
            return 'Top Wall';
        } else {
            // Vertical wall
            if (wallMidX < centerX) return 'Left Wall';
            return 'Right Wall';
        }
    };
    
    // Helper function to get joint type icon/color
    const getJointTypeDisplay = (jointType) => {
        switch (jointType) {
            case 'AA11':
                return { icon: '📐', color: 'blue', label: 'AA11' };
            case 'cut_l':
                return { icon: '🔨', color: 'orange', label: 'Cut L' };
            case 'cut_45':
                return { icon: '📐', color: 'purple', label: 'Cut 45' };
            default:
                return { icon: '⚪', color: 'gray', label: 'Not Set' };
        }
    };
    
    // Get walls for selected room or zone
    const getWallsForSelection = useMemo(() => {
        if (!selectedRoomId) return [];
        
        // Check if it's a zone
        if (typeof selectedRoomId === 'string' && selectedRoomId.startsWith('zone-')) {
            const zoneId = parseInt(selectedRoomId.replace('zone-', ''));
            const zone = ceilingZones.find(z => z.id === zoneId);
            if (!zone) return [];
            
            // Get all rooms in the zone
            const zoneRooms = allRooms.filter(room => 
                zone.rooms && zone.rooms.some(r => r.id === room.id || r === room.id)
            );
            const zoneRoomIds = new Set(zoneRooms.map(r => r.id));
            
            // Get all walls for these rooms
            const allZoneWalls = allWalls.filter(wall => {
                if (!wall.rooms || !Array.isArray(wall.rooms)) return false;
                // Check if wall belongs to any room in the zone
                return wall.rooms.some(roomId => {
                    const roomIdNum = typeof roomId === 'string' ? parseInt(roomId) : roomId;
                    return zoneRoomIds.has(roomIdNum);
                });
            });
            
            // Filter to only perimeter walls (walls that are NOT shared between rooms in the zone)
            // Internal walls are walls shared by 2+ rooms in the zone
            const perimeterWalls = allZoneWalls.filter(wall => {
                const wallRoomIds = Array.isArray(wall.rooms) ? wall.rooms.map(id => typeof id === 'string' ? parseInt(id) : id) : [];
                const sharedByZoneRooms = wallRoomIds.filter(id => zoneRoomIds.has(id));
                // If wall is only shared by rooms in this zone (all wall rooms are in zone), it's internal (exclude it)
                // If wall has rooms outside the zone, it's perimeter (include it)
                const allWallRoomsInZone = wallRoomIds.length > 0 && wallRoomIds.every(id => zoneRoomIds.has(id));
                return !(allWallRoomsInZone && sharedByZoneRooms.length >= 2);
            });
            
            return perimeterWalls;
        } else {
            // Single room - get all walls for this room
            const roomIdNum = typeof selectedRoomId === 'string' ? parseInt(selectedRoomId) : selectedRoomId;
            return allWalls.filter(wall => {
                if (!wall.rooms || !Array.isArray(wall.rooms)) return false;
                return wall.rooms.some(roomId => 
                    String(roomId) === String(roomIdNum) || parseInt(roomId) === roomIdNum
                );
            });
        }
    }, [selectedRoomId, allWalls, allRooms, ceilingZones]);
    
    // Load wall joint configurations when room/zone is selected
    useEffect(() => {
        if (!selectedRoomId || getWallsForSelection.length === 0) {
            setWallJointConfigs({});
            return;
        }
        
        // Load current joint configurations from walls
        const configs = {};
        getWallsForSelection.forEach(wall => {
            configs[wall.id] = {
                jointType: wall.ceiling_joint_type || null,
                horizontalExtension: wall.ceiling_cut_l_horizontal_extension || null
            };
        });
        setWallJointConfigs(configs);
    }, [selectedRoomId, getWallsForSelection]);
    
    // Handle joint type change
    const handleJointTypeChange = (wallId, jointType) => {
        setWallJointConfigs(prev => {
            const updated = { ...prev };
            if (!updated[wallId]) {
                updated[wallId] = {};
            }
            updated[wallId].jointType = jointType;
            
            // If Cut L is selected and no custom extension set, use default
            if (jointType === 'cut_l' && !updated[wallId].horizontalExtension) {
                const wall = allWalls.find(w => w.id === wallId);
                if (wall) {
                    updated[wallId].horizontalExtension = getCutLDefaultExtension(wall.thickness);
                }
            }
            
            return updated;
        });
    };
    
    // Handle Cut L horizontal extension change
    const handleCutLExtensionChange = (wallId, value) => {
        setWallJointConfigs(prev => {
            const updated = { ...prev };
            if (!updated[wallId]) {
                updated[wallId] = {};
            }
            updated[wallId].horizontalExtension = value ? parseFloat(value) : null;
            return updated;
        });
    };
    
    // Save wall joint configurations
    const saveWallJointConfigs = async () => {
        if (isSavingJointConfigs) return;
        
        setIsSavingJointConfigs(true);
        setJointSaveSuccess(false);
        setJointSaveError(null);
        
        try {
            const configsToSave = Object.entries(wallJointConfigs).filter(([_, config]) => config.jointType);
            const savedCount = configsToSave.length;
            
            if (savedCount === 0) {
                setJointSaveError('No joint configurations to save. Please configure at least one wall.');
                setIsSavingJointConfigs(false);
                return;
            }
            
            const updatePromises = configsToSave.map(async ([wallId, config]) => {
                const wall = allWalls.find(w => w.id === parseInt(wallId));
                if (!wall) return;
                
                const updateData = {
                    ceiling_joint_type: config.jointType || null,
                    ceiling_cut_l_horizontal_extension: config.jointType === 'cut_l' ? (config.horizontalExtension || null) : null
                };
                
                await api.patch(`/walls/${wallId}/`, updateData);
            });
            
            await Promise.all(updatePromises);
            
            // Reload walls to get updated data
            const wallsResponse = await api.get(`/walls/?project=${projectId}`);
            setAllWalls(wallsResponse.data || []);
            
            // Show success message
            setJointSaveSuccess(true);
            console.log(`✅ Saved ${savedCount} wall joint configuration(s)`);
            
            // Auto-hide success message after 3 seconds
            setTimeout(() => {
                setJointSaveSuccess(false);
            }, 3000);
            
        } catch (error) {
            console.error('Error saving wall joint configurations:', error);
            const errorMessage = error.response?.data?.detail || error.message || 'Failed to save wall joint configurations. Please try again.';
            setJointSaveError(errorMessage);
            
            // Auto-hide error message after 5 seconds
            setTimeout(() => {
                setJointSaveError(null);
            }, 5000);
        } finally {
            setIsSavingJointConfigs(false);
        }
    };

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
            
            // Load storeys
            const storeysResponse = await api.get(`/storeys/?project=${parseInt(projectId)}`);
            const loadedStoreys = storeysResponse.data || [];
            setStoreys(loadedStoreys);
            // Set default storey to first one if available, or null to show all
            if (loadedStoreys.length > 0 && !selectedStoreyId) {
                setSelectedStoreyId(loadedStoreys[0].id);
            }
            
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

    const handlePanelSelectionReset = useCallback(() => {
        if (swapFeedbackTimeoutRef.current) {
            clearTimeout(swapFeedbackTimeoutRef.current);
        }
        setSelectedPanelIds([]);
        setPanelSwapError(null);
        setPanelSwapSuccess(false);
    }, [swapFeedbackTimeoutRef]);

    const handlePanelSelection = useCallback((panelId) => {
        const normalizedId = normalizePanelIdentifier(panelId);

        if (!normalizedId) {
            handlePanelSelectionReset();
            return;
        }

        const panel = getPanelByIdentifier(normalizedId);
        if (!panel) {
            setPanelSwapError('Unable to locate the selected panel.');
            return;
        }

        setSelectedPanelIds(prev => {
            if (prev.length === 0) {
                setPanelSwapError(null);
                setPanelSwapSuccess(false);
                return [normalizedId];
            }

            if (prev.length === 1) {
                if (prev[0] === normalizedId) {
                    setPanelSwapError(null);
                    setPanelSwapSuccess(false);
                    return [];
                }

                const firstPanel = getPanelByIdentifier(prev[0]);
                const firstRoomKey = getPanelRoomKey(firstPanel);
                const currentRoomKey = getPanelRoomKey(panel);

                if (firstRoomKey && currentRoomKey && firstRoomKey !== currentRoomKey) {
                    setPanelSwapError('Please select two panels within the same room or zone.');
                    return prev;
                }

                setPanelSwapError(null);
                setPanelSwapSuccess(false);
                return [prev[0], normalizedId];
            }

            if (prev.includes(normalizedId)) {
                setPanelSwapError(null);
                setPanelSwapSuccess(false);
                if (prev[0] === normalizedId) {
                    return prev.slice(1);
                }
                return [prev[0]];
            }

            setPanelSwapError(null);
            setPanelSwapSuccess(false);
            return [normalizedId];
        });
    }, [getPanelByIdentifier, getPanelRoomKey, handlePanelSelectionReset, normalizePanelIdentifier]);

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

    const handleSwapPanels = useCallback(async () => {
        if (selectedPanelIds.length !== 2) {
            setPanelSwapError('Select two panels within the same room to swap.');
            return;
        }

        const [firstId, secondId] = selectedPanelIds;
        const firstPanel = getPanelByIdentifier(firstId);
        const secondPanel = getPanelByIdentifier(secondId);

        if (!firstPanel || !secondPanel) {
            setPanelSwapError('Unable to locate the selected panels.');
            return;
        }

        const firstRoomKey = getPanelRoomKey(firstPanel);
        const secondRoomKey = getPanelRoomKey(secondPanel);
        if (firstRoomKey && secondRoomKey && firstRoomKey !== secondRoomKey) {
            setPanelSwapError('Panels must belong to the same room or merged zone.');
            return;
        }

        const firstBackendId = firstPanel.id ?? firstPanel.panel_id;
        const secondBackendId = secondPanel.id ?? secondPanel.panel_id;
        if (firstBackendId === undefined || secondBackendId === undefined) {
            setPanelSwapError('Selected panels are missing identifiers needed for swapping.');
            return;
        }

        const getPanelDimensions = (panel) => {
            const startX = panel.start_x ?? panel.x ?? 0;
            const startY = panel.start_y ?? panel.y ?? 0;
            const width = panel.width ?? Math.abs((panel.end_x ?? startX) - startX);
            const length = panel.length ?? Math.abs((panel.end_y ?? startY) - startY);
            return { startX, startY, width, length };
        };

        const getRoomOrZoneBounds = (panel) => {
            const roomKey = getPanelRoomKey(panel);
            if (!roomKey) return null;

            if (roomKey.startsWith('zone-')) {
                const zoneId = parseInt(roomKey.replace('zone-', ''), 10);
                const zone = ceilingZones.find(z => z.id === zoneId);
                if (zone?.outline_points && zone.outline_points.length >= 3) {
                    const xs = zone.outline_points.map(p => p.x);
                    const ys = zone.outline_points.map(p => p.y);
                    return {
                        minX: Math.min(...xs),
                        maxX: Math.max(...xs),
                        minY: Math.min(...ys),
                        maxY: Math.max(...ys)
                    };
                }
            } else {
                const room = allRooms.find(r => normalizeRoomKey(r.id) === roomKey);
                if (room?.room_points && room.room_points.length >= 3) {
                    const xs = room.room_points.map(p => p.x);
                    const ys = room.room_points.map(p => p.y);
                    return {
                        minX: Math.min(...xs),
                        maxX: Math.max(...xs),
                        minY: Math.min(...ys),
                        maxY: Math.max(...ys)
                    };
                }
            }
            return null;
        };

        const clampWithinBounds = (value, min, max) => {
            if (min === undefined || max === undefined) return value;
            if (value < min) return min;
            if (value > max) return max;
            return value;
        };

        const computePayload = (panel, newStartX, newStartY, bounds) => {
            const { width, length } = getPanelDimensions(panel);
            let clampedStartX = newStartX;
            let clampedStartY = newStartY;

            if (bounds) {
                clampedStartX = clampWithinBounds(newStartX, bounds.minX, bounds.maxX - width);
                clampedStartY = clampWithinBounds(newStartY, bounds.minY, bounds.maxY - length);
            }

            const payload = {
                start_x: clampedStartX,
                start_y: clampedStartY,
                end_x: clampedStartX + width,
                end_y: clampedStartY + length,
                x: clampedStartX,
                y: clampedStartY
            };

            return payload;
        };

        const rectanglesOverlap = (a, b) => {
            if (!a || !b) return false;
            return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
        };

        const getBoundingBoxFromPayload = (payload) => ({
            minX: payload.start_x,
            maxX: payload.end_x,
            minY: payload.start_y,
            maxY: payload.end_y
        });

        const getBoundingBoxForPanel = (panel, overridePayload = null) => {
            if (overridePayload) {
                return getBoundingBoxFromPayload(overridePayload);
            }
            const { startX, startY, width, length } = getPanelDimensions(panel);
            return {
                minX: startX,
                maxX: startX + width,
                minY: startY,
                maxY: startY + length
            };
        };

        const firstPanelBounds = getRoomOrZoneBounds(firstPanel);
        const secondPanelBounds = getRoomOrZoneBounds(secondPanel);

        const secondPanelDims = getPanelDimensions(secondPanel);
        const firstPanelDims = getPanelDimensions(firstPanel);

        const firstPayload = computePayload(
            firstPanel,
            secondPanelDims.startX,
            secondPanelDims.startY,
            firstPanelBounds
        );

        const secondPayload = computePayload(
            secondPanel,
            firstPanelDims.startX,
            firstPanelDims.startY,
            secondPanelBounds
        );

        const firstBoundingBox = getBoundingBoxFromPayload(firstPayload);
        const secondBoundingBox = getBoundingBoxFromPayload(secondPayload);

        const involvedRoomKey = firstPanelBounds ? getPanelRoomKey(firstPanel) : getPanelRoomKey(secondPanel);
        const panelsInArea = ceilingPanels.filter(panel => {
            const key = getPanelRoomKey(panel);
            return key === involvedRoomKey;
        });

        const overlapsExistingPanel = panelsInArea.some(panel => {
            const panelId = getPanelIdentifier(panel);
            if (panelId === firstId || panelId === secondId) {
                return false;
            }
            const otherBox = getBoundingBoxForPanel(panel);
            return rectanglesOverlap(firstBoundingBox, otherBox) || rectanglesOverlap(secondBoundingBox, otherBox);
        });

        if (overlapsExistingPanel || rectanglesOverlap(firstBoundingBox, secondBoundingBox)) {
            setPanelSwapError('Unable to swap: panels would overlap after swapping.');
            setPanelSwapSuccess(false);
            setIsSwappingPanels(false);
            return;
        }

        setIsSwappingPanels(true);
        setPanelSwapError(null);

        try {
            await Promise.all([
                api.patch(`/ceiling-panels/${firstBackendId}/`, firstPayload),
                api.patch(`/ceiling-panels/${secondBackendId}/`, secondPayload)
            ]);

            const updatedPanels = ceilingPanels.map(panel => {
                const panelId = getPanelIdentifier(panel);
                if (panelId === firstId) {
                    return { ...panel, ...firstPayload };
                }
                if (panelId === secondId) {
                    return { ...panel, ...secondPayload };
                }
                return panel;
            });

            const applyPayloadToCollection = (collection) => {
                if (!Array.isArray(collection)) return collection;
                return collection.map(panel => {
                    const panelId = getPanelIdentifier(panel);
                    if (panelId === firstId) {
                        return { ...panel, ...firstPayload };
                    }
                    if (panelId === secondId) {
                        return { ...panel, ...secondPayload };
                    }
                    return panel;
                });
            };

            setCeilingPanels(updatedPanels);

            setCeilingPlan(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    ceiling_panels: applyPayloadToCollection(prev.ceiling_panels),
                    enhanced_panels: applyPayloadToCollection(prev.enhanced_panels),
                    zone_plans: Array.isArray(prev.zone_plans)
                        ? prev.zone_plans.map(zone => ({
                            ...zone,
                            ceiling_panels: applyPayloadToCollection(zone.ceiling_panels)
                        }))
                        : prev.zone_plans
                };
            });

            setCeilingZones(prev => prev.map(zone => ({
                ...zone,
                ceiling_panels: applyPayloadToCollection(zone.ceiling_panels)
            })));

            if (updateSharedPanelData) {
                const sharedPanels = processCeilingPanelsForSharing(updatedPanels, allRooms);
                updateSharedPanelData('ceiling', sharedPanels);
            }

            handlePanelSelectionReset();
            setPanelSwapSuccess(true);
            if (swapFeedbackTimeoutRef.current) {
                clearTimeout(swapFeedbackTimeoutRef.current);
            }
            swapFeedbackTimeoutRef.current = setTimeout(() => setPanelSwapSuccess(false), 4000);
        } catch (error) {
            console.error('Error swapping ceiling panels:', error);
            const message = error?.response?.data?.error || error.message || 'Failed to swap selected panels.';
            setPanelSwapError(message);
        } finally {
            setIsSwappingPanels(false);
        }
    }, [
        allRooms,
        ceilingPanels,
        getPanelByIdentifier,
        getPanelIdentifier,
        getPanelRoomKey,
        handlePanelSelectionReset,
        processCeilingPanelsForSharing,
        selectedPanelIds,
        updateSharedPanelData
    ]);

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
                // Update ceilingPlans array for multi-room mode
                setCeilingPlans(planResponse.data);
                console.log(`✅ [Load Existing] Updated ceilingPlans array with ${planResponse.data.length} plan(s)`);
                
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
        // Save wall joint configurations before generating
        if (selectedRoomId && Object.keys(wallJointConfigs).length > 0) {
            await saveWallJointConfigs();
        }
        setIsRegeneratingRoom(true);
        setError(null);
        setRoomRegenerationSuccess(false);

        console.log('🔄 Regenerating ceiling plan for room:', roomId);
        console.log('📊 Configuration:', config);
        console.log('🎯 Orientation Strategy from config:', config.orientationStrategy);
        console.log('🎯 Global Orientation Strategy:', selectedOrientationStrategy);
        console.log('🎯 Current roomEditConfig.orientationStrategy:', roomEditConfig.orientationStrategy);
        console.log('🎯 Dropdown value should match config:', config.orientationStrategy === roomEditConfig.orientationStrategy);

        try {
            // Ensure roomId is an integer
            const normalizedRoomId = typeof roomId === 'string' ? parseInt(roomId, 10) : roomId;
            console.log('🔍 [Room Generation] Normalized room ID:', normalizedRoomId, 'Type:', typeof normalizedRoomId);
            
            // Validate config values
            if (!config.orientationStrategy) {
                console.error('❌ [Room Generation] Missing orientationStrategy in config');
                setError('Orientation strategy is required. Please select an orientation.');
                setIsRegeneratingRoom(false);
                return;
            }
            
            if (!config.panelWidth || config.panelWidth <= 0) {
                console.error('❌ [Room Generation] Invalid panelWidth:', config.panelWidth);
                setError('Panel width must be greater than 0.');
                setIsRegeneratingRoom(false);
                return;
            }
            
            if (!config.ceilingThickness || config.ceilingThickness <= 0) {
                console.error('❌ [Room Generation] Invalid ceilingThickness:', config.ceilingThickness);
                setError('Ceiling thickness must be greater than 0.');
                setIsRegeneratingRoom(false);
                return;
            }
            
            // Prepare room_specific_config with validated values
            // Match the format used in project-wide generation: panel_length should be 'auto' or the actual value
            // When not 'auto', send the number directly as panel_length (backend handles both formats)
            // Note: Backend uses panel_length directly, custom_panel_length is for database storage only
            const roomSpecificConfig = {
                room_id: normalizedRoomId,
                panel_width: parseInt(config.panelWidth, 10),
                panel_length: config.panelLength === 'auto' ? 'auto' : parseFloat(config.customPanelLength),
                ceiling_thickness: parseFloat(config.ceilingThickness),
                custom_panel_length: config.panelLength === 'auto' ? null : parseFloat(config.customPanelLength),
                orientation_strategy: config.orientationStrategy,
                support_type: supportType,
                support_config: {
                    enableNylonHangers: enableNylonHangers,
                    enableAluSuspension: enableAluSuspension,
                    ...nylonHangerOptions,
                    aluSuspensionCustomDrawing,
                    customSupports: customSupports
                },
                // Per-room ceiling face finishes
                inner_face_material: config.innerFaceMaterial || ceilingInnerFaceMaterial,
                inner_face_thickness: config.innerFaceThickness || ceilingInnerFaceThickness,
                outer_face_material: config.outerFaceMaterial || ceilingOuterFaceMaterial,
                outer_face_thickness: config.outerFaceThickness || ceilingOuterFaceThickness
            };
            
            // Ensure room_id is an integer (not string) for proper backend matching
            // Backend compares room IDs as strings, but we ensure it's an integer for consistency
            if (typeof roomSpecificConfig.room_id === 'string') {
                roomSpecificConfig.room_id = parseInt(roomSpecificConfig.room_id, 10);
            }
            
            // Validate that room exists before attempting generation
            const targetRoom = allRooms.find(r => r.id === normalizedRoomId);
            if (!targetRoom) {
                console.error('❌ [Room Generation] Room not found:', normalizedRoomId);
                setError(`Room with ID ${normalizedRoomId} not found. Please refresh and try again.`);
                setIsRegeneratingRoom(false);
                return;
            }
            
            // Validate room has valid geometry
            if (!targetRoom.room_points || !Array.isArray(targetRoom.room_points) || targetRoom.room_points.length < 3) {
                console.error('❌ [Room Generation] Room has invalid geometry:', targetRoom);
                setError('Room geometry is invalid. Please check the room has at least 3 points.');
                setIsRegeneratingRoom(false);
                return;
            }
            
            console.log('✅ [Room Generation] Room validation passed:', {
                roomId: normalizedRoomId,
                roomName: targetRoom.room_name,
                pointCount: targetRoom.room_points.length,
                config: roomSpecificConfig
            });
            
            console.log('📤 [Room Generation] Sending request with room_specific_config:', roomSpecificConfig);
            
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
                room_specific_config: roomSpecificConfig
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
                    // Update ceilingPlans array for multi-room mode
                    setCeilingPlans(response.data.ceiling_plans);
                    console.log(`✅ [Room Generation] Updated ceilingPlans array with ${response.data.ceiling_plans.length} plan(s)`);
                    
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
                
                // Reload the room data FIRST to get updated ceiling plan details
                // This ensures CeilingCanvas has the latest room.ceiling_plan relationship
                console.log('🔄 [Room Generation] Reloading room data...');
                const roomsResponse = await api.get(`/rooms/?project=${parseInt(projectId)}`);
                setAllRooms(roomsResponse.data || []);
                console.log('✅ [Room Generation] Room data reloaded with updated ceiling_plan relationships');
                
                // Reload project data to ensure we have the latest data
                await new Promise(resolve => setTimeout(resolve, 600));
                await new Promise(resolve => setTimeout(resolve, 600));
                await new Promise(resolve => setTimeout(resolve, 600));
                await loadExistingCeilingPlan();
                setIsZonesUpdating(false);
                
                // Update shared panel data if callback provided
                if (updateSharedPanelData) {
                    const processedPanels = processCeilingPanelsForSharing(newPanels, roomsResponse.data || []);
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
                
                console.log('✅ [Room Generation] State updated successfully');
                
                // Persist the config we just applied to the per-room cache so it is not lost when switching rooms.
                // (Backend response may not include face materials; we keep exactly what the user applied.)
                const roomKey = normalizeRoomKey(roomId);
                if (roomKey) {
                    setRoomConfigsByRoomId(prev => ({ ...prev, [roomKey]: { ...config } }));
                }
                
                // Update the roomEditConfig: merge DB plan fields with the applied config so face materials are preserved
                const updatedRoom = roomsResponse.data.find(r => r.id === roomId);
                if (updatedRoom && updatedRoom.ceiling_plan) {
                    setRoomEditConfig(prev => ({
                        ...config,
                        ceilingThickness: updatedRoom.ceiling_plan.ceiling_thickness ?? prev.ceilingThickness,
                        panelWidth: updatedRoom.ceiling_plan.panel_width ?? prev.panelWidth,
                        panelLength: updatedRoom.ceiling_plan.panel_length ?? prev.panelLength,
                        customPanelLength: updatedRoom.ceiling_plan.custom_panel_length ?? prev.customPanelLength,
                        orientationStrategy: updatedRoom.ceiling_plan.orientation_strategy ?? prev.orientationStrategy
                    }));
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
        // Save wall joint configurations before generating (if any changes)
        if (selectedRoomId && Object.keys(wallJointConfigs).length > 0) {
            try {
                await saveWallJointConfigs();
            } catch (error) {
                console.error('Error saving joint configs before generation:', error);
                // Continue with generation even if save fails
            }
        }
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
                // Update ceilingPlans array for multi-room mode
                if (response.data.ceiling_plans && Array.isArray(response.data.ceiling_plans)) {
                    setCeilingPlans(response.data.ceiling_plans);
                    console.log(`✅ [Full Generate] Updated ceilingPlans array with ${response.data.ceiling_plans.length} plan(s)`);
                }
                
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
    // Filter panels by selected storey and room selection
    const ceilingPanelsMap = useMemo(() => {
        const panelsMap = {};
        if (ceilingPanels && Array.isArray(ceilingPanels)) {
            ceilingPanels.forEach(panel => {
                if (!panel) return;
                const roomId = panel.room_id;
                const zoneId = panel.zone_id || panel.zone;

                // Check if panel's room belongs to selected storey
                if (roomId) {
                    const room = allRooms.find(r => r.id === roomId);
                    if (room && selectedStoreyId && String(room.storey) !== String(selectedStoreyId)) {
                        return; // Skip panels from rooms not in selected storey
                    }
                    if (showAllRooms || roomId === selectedRoomId) {
                        if (!panelsMap[roomId]) {
                            panelsMap[roomId] = [];
                        }
                        panelsMap[roomId].push(panel);
                    }
                } else if (zoneId) {
                    // Check if zone belongs to selected storey
                    const zone = ceilingZones.find(z => z.id === zoneId);
                    if (zone && selectedStoreyId) {
                        const zoneHasRoomsInStorey = zone.room_ids?.some(rid => {
                            const room = allRooms.find(r => r.id === rid);
                            return room && String(room.storey) === String(selectedStoreyId);
                        });
                        if (!zoneHasRoomsInStorey) {
                            return; // Skip zones not in selected storey
                        }
                    }
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
    }, [ceilingPanels, showAllRooms, selectedRoomId, selectedStoreyId, allRooms, ceilingZones]);

    const shouldShowPanelSwapCard = selectedPanelIds.length > 0 || Boolean(panelSwapError) || Boolean(panelSwapSuccess);

    const panelSwapCard = shouldShowPanelSwapCard ? (
        <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h4 className="text-sm font-semibold text-blue-700">Panel Swap</h4>
                    {selectedPanelRoomName && (
                        <p className="text-xs text-blue-500 mt-1">
                            Room: {selectedPanelRoomName}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handlePanelSelectionReset}
                        className="px-3 py-1 text-xs rounded border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
                    >
                        Clear Selection
                    </button>
                </div>
            </div>

            <div className="space-y-3">
                {[0, 1].map(index => {
                    const panel = selectedPanels[index];
                    const label = index === 0 ? 'Panel A' : 'Panel B';
                    const panelId = selectedPanelIds[index];

                    if (!panel) {
                        return (
                            <div
                                key={`panel-placeholder-${index}`}
                                className="border border-dashed border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-500 bg-blue-50/40"
                            >
                                {index === 0
                                    ? 'Select a panel in the canvas to begin.'
                                    : 'Select another panel in the same room to enable swapping.'}
                            </div>
                        );
                    }

                    const isCutPanel = panel.is_cut || panel.is_cut_panel;
                    const widthDisplay = panel.width ?? '—';
                    const lengthDisplay = panel.length ?? '—';
                    const positionX = Math.round(panel.start_x ?? panel.x ?? 0);
                    const positionY = Math.round(panel.start_y ?? panel.y ?? 0);
                    return (
                        <div
                            key={`panel-selection-${panelId}-${index}`}
                            className="border border-blue-100 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-3 bg-blue-50/40"
                        >
                            <div>
                                <p className="text-xs uppercase tracking-wide text-blue-500">{label}</p>
                                <p className="text-sm font-semibold text-gray-800">
                                    #{panel.panel_id ?? panel.id ?? panelId ?? '—'}
                                </p>
                            </div>
                            <div className="text-xs text-gray-600 space-y-1 text-right">
                                <div>
                                    <span className="font-medium text-gray-700">{widthDisplay}</span> ×{' '}
                                    <span className="font-medium text-gray-700">{lengthDisplay}</span> mm
                                </div>
                                <div>
                                    Pos: (
                                    <span className="font-medium text-gray-700">
                                        {positionX}
                                    </span>
                                    ,{' '}
                                    <span className="font-medium text-gray-700">
                                        {positionY}
                                    </span>
                                    )
                                </div>
                                <div className={isCutPanel ? 'text-amber-600' : 'text-green-600'}>
                                    {isCutPanel ? 'Cut Panel' : 'Full Panel'}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {panelSwapError && (
                <div className="bg-red-50 border border-red-200 text-sm text-red-600 rounded-lg px-3 py-2">
                    {panelSwapError}
                </div>
            )}

            {panelSwapSuccess && (
                <div className="bg-green-50 border border-green-200 text-sm text-green-700 rounded-lg px-3 py-2">
                    Panels swapped successfully.
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                    Select two panels in the canvas to enable the swap action.
                </p>
                <button
                    onClick={handleSwapPanels}
                    disabled={selectedPanelIds.length !== 2 || isSwappingPanels}
                    className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                        selectedPanelIds.length !== 2 || isSwappingPanels
                            ? 'bg-blue-200 text-blue-500 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                >
                    {isSwappingPanels ? 'Swapping...' : 'Swap Selected Panels'}
                </button>
            </div>
        </div>
    ) : null;

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
        <div className="ceiling-manager flex flex-col min-h-0 min-w-0 w-full">
            {/* Header - extra right padding so View/Level controls don't touch boundary */}
            <div className="px-4 sm:px-6 pr-6 sm:pr-8 py-4 border-b border-gray-200 ml-4 sm:ml-8 mr-4 sm:mr-6 shrink-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                    <div className="min-w-0">
                        <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                            Project Ceiling Plan
                        </h2>
                        <p className="text-xs sm:text-sm text-gray-600 truncate">
                            Generate optimal ceiling panel layout for the entire project
                        </p>
                    </div>
                    
                    {/* Storey and Room Selection Controls */}
                        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                        {/* Storey Selector */}
                        {storeys.length > 1 && (
                            <div className="flex items-center space-x-2">
                                <label className="text-sm font-medium text-gray-700">Level:</label>
                                <select
                                    value={selectedStoreyId || 'all'}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        setSelectedStoreyId(value === 'all' ? null : parseInt(value));
                                        // Reset room selection when changing storey
                                        setShowAllRooms(true);
                                        setSelectedRoomId(null);
                                    }}
                                    className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {storeys.map(storey => (
                                        <option key={storey.id} value={storey.id}>
                                            {storey.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        
                        {/* Room Selection Controls */}
                        {filteredRooms.length > 1 && (
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
                                    {filteredRooms.map(room => (
                                        <option key={room.id} value={room.id}>
                                            {room.room_name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                            
                            {!showAllRooms && selectedRoomId && (
                                <div className="text-sm text-gray-600">
                                <span className="font-medium">Selected:</span> {filteredRooms.find(r => r.id === selectedRoomId)?.room_name}
                                </div>
                            )}
                        </div>
                </div>
            </div>

                        {/* Controls - right margin so Orientation/Panel/Ceiling cards don't touch boundary */}
            <div className="control-panel ml-4 sm:ml-8 mr-4 sm:mr-6 shrink-0">
                {/* Main Controls Row */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6 control-grid ml-0 sm:ml-4 pr-2 sm:pr-0">
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
                            {/* Ceiling face finishes (global defaults for generated panels) */}
                            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100 mt-2">
                                <div>
                                    <div className="text-xs font-semibold text-gray-600 mb-1">Inner Face</div>
                                    <div className="space-y-1">
                                        <div className="flex items-center space-x-2">
                                            <label className="text-xs text-gray-600 min-w-[60px]">Material:</label>
                                            <select
                                                value={ceilingInnerFaceMaterial}
                                                onChange={(e) => setCeilingInnerFaceMaterial(e.target.value)}
                                                className="flex-1 text-xs"
                                            >
                                                <option value="PPGI">PPGI</option>
                                                <option value="S/Steel">S/Steel</option>
                                                <option value="Aluminium">Aluminium</option>
                                                <option value="PVC">PVC</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <label className="text-xs text-gray-600 min-w-[60px]">Sheet thk:</label>
                                            <input
                                                type="number"
                                                min="0.3"
                                                max="2"
                                                step="0.1"
                                                value={ceilingInnerFaceThickness}
                                                onChange={(e) => setCeilingInnerFaceThickness(parseFloat(e.target.value) || 0.5)}
                                                className="flex-1 text-xs"
                                            />
                                            <span className="text-[10px] text-gray-500">mm</span>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-600 mb-1">Outer Face</div>
                                    <div className="space-y-1">
                                        <div className="flex items-center space-x-2">
                                            <label className="text-xs text-gray-600 min-w-[60px]">Material:</label>
                                            <select
                                                value={ceilingOuterFaceMaterial}
                                                onChange={(e) => setCeilingOuterFaceMaterial(e.target.value)}
                                                className="flex-1 text-xs"
                                            >
                                                <option value="PPGI">PPGI</option>
                                                <option value="S/Steel">S/Steel</option>
                                                <option value="Aluminium">Aluminium</option>
                                                <option value="PVC">PVC</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <label className="text-xs text-gray-600 min-w-[60px]">Sheet thk:</label>
                                            <input
                                                type="number"
                                                min="0.3"
                                                max="2"
                                                step="0.1"
                                                value={ceilingOuterFaceThickness}
                                                onChange={(e) => setCeilingOuterFaceThickness(parseFloat(e.target.value) || 0.5)}
                                                className="flex-1 text-xs"
                                            />
                                            <span className="text-[10px] text-gray-500">mm</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Ceiling Joint Configuration - Moved to Details Panel */}
                {/* This section is now integrated into the details panel below */}

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
                            {/* Support Type Selection - Both can be enabled, one line horizontally */}
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
                                    <p className="text-xs font-semibold text-gray-600 mb-2">Alu suspension</p>
                                    <p className="text-xs text-gray-600 leading-relaxed">
                                        On the canvas, use <strong>Draw Support Line</strong>: first click sets the rail start, second click sets the end.
                                        Hangers are placed <strong>along the full rail</strong> at about 1200&nbsp;mm spacing wherever the rail runs over panels; the purple rail stays visible. Use <strong>Clear Supports</strong> to remove all.
                                    </p>
                                </div>
                            )}
                            
                            {/* Info message when both are enabled */}
                            {enableNylonHangers && enableAluSuspension && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                    <p className="text-xs text-blue-700 leading-relaxed">
                                        <strong>Note:</strong> Nylon hangers (red) are automatic on long panels. Alu suspension (purple rail + hangers) is drawn manually on the canvas and is stored with the plan.
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
                <div className="flex flex-col sm:flex-row items-center justify-between space-y-3 sm:space-y-0 sm:space-x-4 mt-6 ml-4 mr-4 sm:mr-6">
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
                            ) : filteredZones.length === 0 ? (
                                <p className="text-sm text-gray-600">No merged zones created yet.</p>
                            ) : (
                                <div className="space-y-3">
                                    {filteredZones.map(zone => (
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

            {/* Main Content - fills space, scrolls if needed; layout is responsive inside CeilingCanvas */}
            <div className="p-4 sm:p-6 pl-4 sm:pl-8 w-full min-w-0 min-h-0 flex-1 flex flex-col overflow-y-auto">
                {ceilingPlan ? (
                    <div className="space-y-6 w-full min-w-0">
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
                            walls={filteredWalls}
                            intersections={allIntersections}
                            ceilingPlan={ceilingPlan}
                            ceilingPlans={ceilingPlans}
                            ceilingPanels={ceilingPanels}
                            projectData={projectData}
                            projectWastePercentage={projectWastePercentage}
                            ceilingThickness={ceilingThickness}
                            ceilingPanelsMap={ceilingPanelsMap}
                            zones={filteredZones}
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
                            selectedPanelId={selectedPanelIds[0] ?? null}
                            selectedPanelIds={selectedPanelIds}
                            onPanelSelect={handlePanelSelection}
                            onRoomSelect={handleRoomSelection}
                            onRoomDeselect={handleRoomDeselection}
                            // Add updateSharedPanelData prop to pass support options
                            updateSharedPanelData={updateSharedPanelData}
                            dimensionVisibility={dimensionVisibility}
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
                                {/* Header */}
                                <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 gap-3">
                                    <div className="space-y-1">
                                        {showRoomDetailsPanel ? (
                                            <>
                                                <h3 className="text-lg font-semibold text-gray-900">
                                                    {selectedRoom?.room_name || 'Room'} Configuration
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
                                
                                {/* Tabs for Room Details Panel */}
                                {showRoomDetailsPanel && (
                                    <div className="border-b border-gray-200">
                                        <div className="flex space-x-1 px-5">
                                            <button
                                                onClick={() => setDetailsPanelTab('details')}
                                                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                                                    detailsPanelTab === 'details'
                                                        ? 'border-blue-600 text-blue-600'
                                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                                }`}
                                            >
                                                Room Details
                                            </button>
                                            {getWallsForSelection.length > 0 && (
                                                <button
                                                    onClick={() => setDetailsPanelTab('joints')}
                                                    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 relative ${
                                                        detailsPanelTab === 'joints'
                                                            ? 'border-indigo-600 text-indigo-600'
                                                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                                    }`}
                                                >
                                                    Joint Configuration
                                                    {Object.keys(wallJointConfigs).filter(id => wallJointConfigs[id]?.jointType).length > 0 && (
                                                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded-full">
                                                            {Object.keys(wallJointConfigs).filter(id => wallJointConfigs[id]?.jointType).length}
                                                        </span>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                                
                                <div className="px-5 py-4 overflow-y-auto max-h-[60vh]">
                                    {showRoomDetailsPanel ? (
                                        detailsPanelTab === 'joints' ? (
                                            /* Joint Configuration Tab */
                                            getWallsForSelection.length > 0 ? (
                                                <div className="space-y-4">
                                                    <p className="text-xs text-gray-600 mb-3">
                                                        Configure how the ceiling joins with each wall. For merged zones, only perimeter walls are shown (internal walls are automatically AA11).
                                                    </p>
                                                    
                                                    {/* Quick Actions */}
                                                    <div className="flex flex-wrap gap-2 pb-2 border-b border-gray-200">
                                                        <button
                                                            onClick={() => {
                                                                const updates = {};
                                                                getWallsForSelection.forEach(wall => {
                                                                    updates[wall.id] = { jointType: 'AA11', horizontalExtension: null };
                                                                });
                                                                setWallJointConfigs(prev => ({ ...prev, ...updates }));
                                                            }}
                                                            className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                                                            title="Set all walls to AA11"
                                                        >
                                                            Set All AA11
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const updates = {};
                                                                getWallsForSelection.forEach(wall => {
                                                                    updates[wall.id] = { 
                                                                        jointType: 'cut_l', 
                                                                        horizontalExtension: getCutLDefaultExtension(wall.thickness)
                                                                    };
                                                                });
                                                                setWallJointConfigs(prev => ({ ...prev, ...updates }));
                                                            }}
                                                            className="text-xs px-3 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition-colors"
                                                            title="Set all walls to Cut L with defaults"
                                                        >
                                                            Set All Cut L (Default)
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setWallJointConfigs({});
                                                            }}
                                                            className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                                                            title="Clear all joint configurations"
                                                        >
                                                            Clear All
                                                        </button>
                                                    </div>
                                                    
                                                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2">
                                                        {getWallsForSelection.map(wall => {
                                                            const config = wallJointConfigs[wall.id] || { jointType: null, horizontalExtension: null };
                                                            const wallLength = Math.sqrt(
                                                                Math.pow((wall.end_x || 0) - (wall.start_x || 0), 2) + 
                                                                Math.pow((wall.end_y || 0) - (wall.start_y || 0), 2)
                                                            );
                                                            
                                                            // Get current room for wall labeling
                                                            const currentRoom = typeof selectedRoomId === 'string' && selectedRoomId.startsWith('zone-') 
                                                                ? null 
                                                                : allRooms.find(r => r.id === selectedRoomId);
                                                            
                                                            const wallLabel = getWallLabel(wall, currentRoom);
                                                            const jointDisplay = getJointTypeDisplay(config.jointType);
                                                            
                                                            // Check if wall is shared (for display info)
                                                            const wallRoomIds = Array.isArray(wall.rooms) ? wall.rooms.map(id => typeof id === 'string' ? parseInt(id) : id) : [];
                                                            const isShared = wallRoomIds.length > 1;
                                                            const sharedRooms = isShared ? allRooms.filter(r => wallRoomIds.includes(r.id)) : [];
                                                            
                                                            // Determine which room controls the joint type (for shared walls without fill_gap_mode)
                                                            let controllingRoom = null;
                                                            if (isShared && !wall.fill_gap_mode) {
                                                                // Find room with higher height
                                                                const roomsWithHeights = sharedRooms
                                                                    .map(r => ({ room: r, height: r.height || 0 }))
                                                                    .filter(r => r.height > 0)
                                                                    .sort((a, b) => b.height - a.height);
                                                                if (roomsWithHeights.length > 0) {
                                                                    controllingRoom = roomsWithHeights[0].room;
                                                                }
                                                            }
                                                            
                                                            return (
                                                                <div 
                                                                    key={wall.id} 
                                                                    className={`border rounded-lg p-3 transition-all ${
                                                                        config.jointType 
                                                                            ? config.jointType === 'AA11' 
                                                                                ? 'border-blue-300 bg-blue-50/30' 
                                                                                : config.jointType === 'cut_l'
                                                                                ? 'border-orange-300 bg-orange-50/30'
                                                                                : 'border-purple-300 bg-purple-50/30'
                                                                            : 'border-gray-200 bg-gray-50'
                                                                    }`}
                                                                >
                                                                    <div className="flex items-start justify-between mb-3">
                                                                        <div className="flex-1">
                                                                            <div className="flex items-center flex-wrap gap-2 mb-1">
                                                                                <span className={`text-sm font-semibold ${
                                                                                    config.jointType ? 'text-gray-900' : 'text-gray-600'
                                                                                }`}>
                                                                                    {wallLabel}
                                                                                </span>
                                                                                <span className="text-xs text-gray-500">#{wall.id}</span>
                                                                                {config.jointType && (
                                                                                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                                                                        config.jointType === 'AA11' 
                                                                                            ? 'bg-blue-100 text-blue-700'
                                                                                            : config.jointType === 'cut_l'
                                                                                            ? 'bg-orange-100 text-orange-700'
                                                                                            : 'bg-purple-100 text-purple-700'
                                                                                    }`}>
                                                                                        {jointDisplay.icon} {jointDisplay.label}
                                                                                    </span>
                                                                                )}
                                                                                {isShared && (
                                                                                    <>
                                                                                        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                                                                                            Shared ({sharedRooms.length} rooms)
                                                                                        </span>
                                                                                        {controllingRoom && (
                                                                                            <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded">
                                                                                                Controlled by: {controllingRoom.room_name}
                                                                                            </span>
                                                                                        )}
                                                                                        {wall.fill_gap_mode && (
                                                                                            <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">
                                                                                                Fill Gap Mode
                                                                                            </span>
                                                                                        )}
                                                                                    </>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-xs text-gray-600 space-x-3">
                                                                                <span>Thickness: <strong>{wall.thickness}mm</strong></span>
                                                                                <span>•</span>
                                                                                <span>Length: <strong>{Math.round(wallLength)}mm</strong></span>
                                                                                <span>•</span>
                                                                                <span>Position: ({Math.round(wall.start_x)}, {Math.round(wall.start_y)}) → ({Math.round(wall.end_x)}, {Math.round(wall.end_y)})</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    <div className="space-y-2">
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                                                Joint Type
                                                                            </label>
                                                                            <select
                                                                                value={config.jointType || ''}
                                                                                onChange={(e) => handleJointTypeChange(wall.id, e.target.value || null)}
                                                                                className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                                                                            >
                                                                                <option value="">⚪ Not Set</option>
                                                                                <option value="AA11">📐 AA11 - No cutting, directly on top</option>
                                                                                <option value="cut_l">🔨 Cut L - L-shaped cut in wall</option>
                                                                                <option value="cut_45">📐 Cut 45 - 45-degree cut</option>
                                                                            </select>
                                                                        </div>
                                                                        
                                                                        {config.jointType === 'cut_l' && (
                                                                            <div className="bg-orange-50 border border-orange-200 rounded-md p-2.5">
                                                                                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                                                                    Horizontal Extension (mm)
                                                                                    <span className="text-gray-500 font-normal ml-1">
                                                                                        (Default: {getCutLDefaultExtension(wall.thickness)}mm)
                                                                                    </span>
                                                                                </label>
                                                                                <div className="flex items-center gap-2">
                                                                                    <input
                                                                                        type="number"
                                                                                        min="0"
                                                                                        max={wall.thickness}
                                                                                        step="1"
                                                                                        value={config.horizontalExtension || getCutLDefaultExtension(wall.thickness)}
                                                                                        onChange={(e) => handleCutLExtensionChange(wall.id, e.target.value)}
                                                                                        className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                                                                                        placeholder={getCutLDefaultExtension(wall.thickness).toString()}
                                                                                    />
                                                                                    <button
                                                                                        onClick={() => handleCutLExtensionChange(wall.id, getCutLDefaultExtension(wall.thickness))}
                                                                                        className="text-xs px-2 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                                                                                        title="Reset to default"
                                                                                    >
                                                                                        Reset
                                                                                    </button>
                                                                                </div>
                                                                                <p className="text-xs text-gray-600 mt-1.5">
                                                                                    Vertical depth = ceiling thickness ({ceilingThickness}mm)
                                                                                </p>
                                                                            </div>
                                                                        )}
                                                                        
                                                                        {config.jointType === 'AA11' && (
                                                                            <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 p-2.5 rounded-md">
                                                                                <strong>Auto-adjustment:</strong> Wall height will be set to room height - ceiling thickness ({ceilingThickness}mm)
                                                                            </div>
                                                                        )}
                                                                        
                                                                        {config.jointType === 'cut_45' && (
                                                                            <div className="text-xs text-purple-700 bg-purple-50 border border-purple-200 p-2.5 rounded-md">
                                                                                <strong>Note:</strong> Cut 45 is a marker type - no automatic calculations are applied.
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    
                                                    {/* Success/Error Feedback Messages */}
                                                    {jointSaveSuccess && (
                                                        <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 animate-fade-in">
                                                            <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                            <div className="flex-1">
                                                                <p className="text-sm font-medium text-green-800">
                                                                    Joint configurations saved successfully!
                                                                </p>
                                                                <p className="text-xs text-green-600 mt-0.5">
                                                                    {Object.keys(wallJointConfigs).filter(id => wallJointConfigs[id]?.jointType).length} wall{Object.keys(wallJointConfigs).filter(id => wallJointConfigs[id]?.jointType).length !== 1 ? 's' : ''} configured
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={() => setJointSaveSuccess(false)}
                                                                className="text-green-600 hover:text-green-800 transition-colors"
                                                                aria-label="Dismiss"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    )}
                                                    
                                                    {jointSaveError && (
                                                        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 animate-fade-in">
                                                            <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                            <div className="flex-1">
                                                                <p className="text-sm font-medium text-red-800">
                                                                    Failed to save joint configurations
                                                                </p>
                                                                <p className="text-xs text-red-600 mt-0.5">
                                                                    {jointSaveError}
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={() => setJointSaveError(null)}
                                                                className="text-red-600 hover:text-red-800 transition-colors"
                                                                aria-label="Dismiss"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    )}
                                                    
                                                    <div className="flex items-center justify-between pt-3 border-t border-gray-200 mt-3">
                                                        <div className="flex-1">
                                                            <p className="text-xs text-gray-500 mb-1">
                                                                Configurations are saved automatically when you generate the ceiling plan.
                                                            </p>
                                                            {Object.keys(wallJointConfigs).length > 0 && (
                                                                <p className="text-xs text-gray-600">
                                                                    <strong>{Object.keys(wallJointConfigs).filter(id => wallJointConfigs[id]?.jointType).length}</strong> of {getWallsForSelection.length} wall{getWallsForSelection.length !== 1 ? 's' : ''} configured
                                                                </p>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={saveWallJointConfigs}
                                                            disabled={isSavingJointConfigs || Object.keys(wallJointConfigs).filter(id => wallJointConfigs[id]?.jointType).length === 0}
                                                            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors shadow-sm flex items-center gap-2 ${
                                                                isSavingJointConfigs
                                                                    ? 'bg-indigo-400 text-white cursor-wait'
                                                                    : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed'
                                                            }`}
                                                        >
                                                            {isSavingJointConfigs ? (
                                                                <>
                                                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                                    </svg>
                                                                    <span>Saving...</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                                    </svg>
                                                                    <span>Save Now</span>
                                                                </>
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-center py-8 text-gray-500">
                                                    <p className="text-sm">No walls available for this selection.</p>
                                                </div>
                                            )
                                        ) : (
                                            /* Room Details Tab */
                                        showRoomDetails ? (
                                            <>
                                                {panelSwapCard}
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
                                                {/* Panel count removed per user preference */}
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
                                                {/* Per-room ceiling face finishes */}
                                                <div className="mt-3 grid grid-cols-2 gap-3">
                                                    <div>
                                                        <div className="text-xs font-semibold text-gray-600 mb-1">Inner Face</div>
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <label className="text-xs text-gray-600 min-w-[70px]">Material:</label>
                                                                <select
                                                                    value={roomEditConfig.innerFaceMaterial}
                                                                    onChange={(e) => {
                                                                        const value = e.target.value;
                                                                        setRoomEditConfig(prev => {
                                                                            const next = {
                                                                                ...prev,
                                                                                innerFaceMaterial: value
                                                                            };
                                                                            const key = normalizeRoomKey(selectedRoomId);
                                                                            if (key) {
                                                                                setRoomConfigsByRoomId(map => ({
                                                                                    ...map,
                                                                                    [key]: next
                                                                                }));
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500"
                                                                >
                                                                    <option value="PPGI">PPGI</option>
                                                                    <option value="S/Steel">S/Steel</option>
                                                                    <option value="Aluminium">Aluminium</option>
                                                                    <option value="PVC">PVC</option>
                                                                </select>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <label className="text-xs text-gray-600 min-w-[70px]">Sheet thk:</label>
                                                                <input
                                                                    type="number"
                                                                    min="0.3"
                                                                    max="2"
                                                                    step="0.1"
                                                                    value={roomEditConfig.innerFaceThickness}
                                                                    onChange={(e) => {
                                                                        const num = parseFloat(e.target.value) || 0.5;
                                                                        setRoomEditConfig(prev => {
                                                                            const next = {
                                                                                ...prev,
                                                                                innerFaceThickness: num
                                                                            };
                                                                            const key = normalizeRoomKey(selectedRoomId);
                                                                            if (key) {
                                                                                setRoomConfigsByRoomId(map => ({
                                                                                    ...map,
                                                                                    [key]: next
                                                                                }));
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500"
                                                                />
                                                                <span className="text-[10px] text-gray-500">mm</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-semibold text-gray-600 mb-1">Outer Face</div>
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <label className="text-xs text-gray-600 min-w-[70px]">Material:</label>
                                                                <select
                                                                    value={roomEditConfig.outerFaceMaterial}
                                                                    onChange={(e) => {
                                                                        const value = e.target.value;
                                                                        setRoomEditConfig(prev => {
                                                                            const next = {
                                                                                ...prev,
                                                                                outerFaceMaterial: value
                                                                            };
                                                                            const key = normalizeRoomKey(selectedRoomId);
                                                                            if (key) {
                                                                                setRoomConfigsByRoomId(map => ({
                                                                                    ...map,
                                                                                    [key]: next
                                                                                }));
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500"
                                                                >
                                                                    <option value="PPGI">PPGI</option>
                                                                    <option value="S/Steel">S/Steel</option>
                                                                    <option value="Aluminium">Aluminium</option>
                                                                    <option value="PVC">PVC</option>
                                                                </select>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <label className="text-xs text-gray-600 min-w-[70px]">Sheet thk:</label>
                                                                <input
                                                                    type="number"
                                                                    min="0.3"
                                                                    max="2"
                                                                    step="0.1"
                                                                    value={roomEditConfig.outerFaceThickness}
                                                                    onChange={(e) => {
                                                                        const num = parseFloat(e.target.value) || 0.5;
                                                                        setRoomEditConfig(prev => {
                                                                            const next = {
                                                                                ...prev,
                                                                                outerFaceThickness: num
                                                                            };
                                                                            const key = normalizeRoomKey(selectedRoomId);
                                                                            if (key) {
                                                                                setRoomConfigsByRoomId(map => ({
                                                                                    ...map,
                                                                                    [key]: next
                                                                                }));
                                                                            }
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="w-20 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500"
                                                                />
                                                                <span className="text-[10px] text-gray-500">mm</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                        </div>
                                                        <div className="mt-4 flex items-center justify-between">
                                            <button
                                            onClick={() => {
                                                const resetConfig = {
                                                    ceilingThickness: ceilingThickness,
                                                    panelWidth: panelWidth,
                                                    panelLength: panelLength,
                                                    customPanelLength: customPanelLength,
                                                    orientationStrategy: selectedOrientationStrategy,
                                                    innerFaceMaterial: ceilingInnerFaceMaterial,
                                                    innerFaceThickness: ceilingInnerFaceThickness,
                                                    outerFaceMaterial: ceilingOuterFaceMaterial,
                                                    outerFaceThickness: ceilingOuterFaceThickness
                                                };
                                                setRoomEditConfig(resetConfig);
                                                const key = normalizeRoomKey(selectedRoomId);
                                                if (key) {
                                                    setRoomConfigsByRoomId(map => ({
                                                        ...map,
                                                        [key]: resetConfig
                                                    }));
                                                }
                                            }}
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
                                                                        <th className="px-3 py-2 border text-left">Face Material</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {selectedRoomPanelStats.panels.map(panel => {
                                                                        const intMat = panel.inner_face_material ?? 'PPGI';
                                                                        const intThk = panel.inner_face_thickness ?? 0.5;
                                                                        const extMat = panel.outer_face_material ?? 'PPGI';
                                                                        const extThk = panel.outer_face_thickness ?? 0.5;
                                                                        const same = intMat === extMat && intThk === extThk;
                                                                        const finishing = same
                                                                            ? `Both Side ${extThk}mm ${extMat}`
                                                                            : `INT: ${intThk}mm ${intMat} / EXT: ${extThk}mm ${extMat}`;
                                                                        return (
                                                                            <tr key={panel.id || panel.panel_id} className="hover:bg-gray-50">
                                                                                <td className="px-3 py-2 border">{panel.panel_id || panel.id || '—'}</td>
                                                                                <td className="px-3 py-2 border">{panel.width}</td>
                                                                                <td className="px-3 py-2 border">{panel.length}</td>
                                                                                <td className="px-3 py-2 border">{panel.thickness || ceilingThickness}</td>
                                                                                <td className="px-3 py-2 border">
                                                                                    {panel.is_cut_panel || panel.is_cut ? 'Cut' : 'Full'}
                                                                                </td>
                                                                                <td className="px-3 py-2 border whitespace-nowrap">{finishing}</td>
                                                                            </tr>
                                                                        );
                                                                    })}
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
                                                Click "Show Details" to view room information and settings.
                                            </div>
                                        )
                                        )
                                    ) : (
                                        <>
                                            {panelSwapCard}
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
                                                                {/* Panel count removed per user preference */}
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

