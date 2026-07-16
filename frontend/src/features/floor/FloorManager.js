import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import FloorCanvas from '../canvas/FloorCanvas';
import api from '../../api/api';
import { sortMaterialPanels } from '../panel/wallPlanPanelUtils';
import { calculateGhostDataForStorey } from '../estimation/pdfVectorWallPlan';

const FloorManager = ({ projectId, canEdit = true, onClose, onFloorPlanGenerated, updateSharedPanelData = null }) => {
    const { isAuthenticated } = useAuth();
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
    const [storeys, setStoreys] = useState([]);
    const [selectedStoreyId, setSelectedStoreyId] = useState(null);
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

    // Slab size (mm) for slab floor estimation - default 1210 x 3000, memorized per project
    const SLAB_STORAGE_KEY = (id) => `floor_plan_slab_${id}`;
    const DEFAULT_SLAB_WIDTH = 1210;
    const DEFAULT_SLAB_LENGTH = 3000;
    const [slabWidth, setSlabWidth] = useState(DEFAULT_SLAB_WIDTH);
    const [slabLength, setSlabLength] = useState(DEFAULT_SLAB_LENGTH);

    // Load memorized slab size when project changes
    useEffect(() => {
        if (!projectId) return;
        try {
            const raw = localStorage.getItem(SLAB_STORAGE_KEY(projectId));
            if (raw) {
                const { width, length } = JSON.parse(raw);
                if (typeof width === 'number' && width > 0) setSlabWidth(width);
                if (typeof length === 'number' && length > 0) setSlabLength(length);
            }
        } catch (_) { /* ignore */ }
    }, [projectId]);

    const handleSlabWidthChange = (value) => {
        if (!canEdit) return;
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n > 0) {
            setSlabWidth(n);
            if (projectId) {
                try {
                    const raw = localStorage.getItem(SLAB_STORAGE_KEY(projectId));
                    const prev = raw ? JSON.parse(raw) : { width: DEFAULT_SLAB_WIDTH, length: DEFAULT_SLAB_LENGTH };
                    localStorage.setItem(SLAB_STORAGE_KEY(projectId), JSON.stringify({ ...prev, width: n }));
                } catch (_) { /* ignore */ }
            }
        }
    };

    const handleSlabLengthChange = (value) => {
        if (!canEdit) return;
        const n = parseInt(value, 10);
        if (!Number.isNaN(n) && n > 0) {
            setSlabLength(n);
            if (projectId) {
                try {
                    const raw = localStorage.getItem(SLAB_STORAGE_KEY(projectId));
                    const prev = raw ? JSON.parse(raw) : { width: DEFAULT_SLAB_WIDTH, length: DEFAULT_SLAB_LENGTH };
                    localStorage.setItem(SLAB_STORAGE_KEY(projectId), JSON.stringify({ ...prev, length: n }));
                } catch (_) { /* ignore */ }
            }
        }
    };

    // Filter rooms by selected storey (level)
    const filteredRooms = useMemo(() => {
        if (!selectedStoreyId) return allRooms;
        return allRooms.filter(room => String(room.storey) === String(selectedStoreyId));
    }, [allRooms, selectedStoreyId]);

    // Filter walls by selected storey
    const filteredWalls = useMemo(() => {
        if (!selectedStoreyId) return allWalls;
        return allWalls.filter(wall => {
            const wallStoreyId = wall.storey ?? wall.storey_id;
            return String(wallStoreyId) === String(selectedStoreyId);
        });
    }, [allWalls, selectedStoreyId]);

    // Filter floor panels to panel-floor rooms on the selected level only (exclude slab/other so stale panels vanish after floor_type changes)
    const filteredFloorPanels = useMemo(() => {
        if (!floorPanels || floorPanels.length === 0) return [];
        return floorPanels.filter(panel => {
            const rid = panel.room_id ?? (typeof panel.room === 'object' ? panel.room?.id : panel.room);
            if (rid == null) return false;
            const room = filteredRooms.find(r => String(r.id) === String(rid));
            if (!room) return false;
            return room.floor_type === 'panel' || room.floor_type === 'Panel';
        });
    }, [floorPanels, filteredRooms]);

    // Double-height / lower-level ghosts (same rules as wall plan)
    const { ghostWalls, ghostAreas } = useMemo(() => {
        if (!selectedStoreyId || !storeys?.length) {
            return { ghostWalls: [], ghostAreas: [] };
        }
        const targetStorey = storeys.find((s) => String(s.id) === String(selectedStoreyId));
        if (!targetStorey) {
            return { ghostWalls: [], ghostAreas: [] };
        }
        return calculateGhostDataForStorey(
            selectedStoreyId,
            targetStorey,
            storeys,
            allWalls,
            filteredRooms,
            allRooms
        );
    }, [selectedStoreyId, storeys, allWalls, filteredRooms, allRooms]);

    const loadExistingFloorPlan = useCallback(async () => {
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
    }, [projectId]);

    const loadOrientationAnalysis = useCallback(async () => {
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
    }, [projectId, panelWidth, panelLength, customPanelLength, floorPlan]);

    const loadProjectData = useCallback(async () => {
        try {
            const pid = parseInt(projectId, 10);
            const [
                projectResponse,
                storeysResponse,
                roomsResponse,
                wallsResponse,
                intersectionsResponse,
            ] = await Promise.all([
                api.get(`/projects/${pid}/`),
                api.get(`/storeys/?project=${pid}`),
                api.get(`/rooms/?project=${pid}`),
                api.get(`/walls/?project=${pid}`),
                api.get(`/intersections/?project=${pid}`),
            ]);

            setProjectData(projectResponse.data || null);

            const loadedStoreys = storeysResponse.data || [];
            setStoreys(loadedStoreys);
            if (loadedStoreys.length > 0) {
                setSelectedStoreyId((prev) => prev ?? loadedStoreys[0].id);
            }

            const rooms = roomsResponse.data || [];
            setAllRooms(rooms);

            const panelRooms = rooms.filter(room => room.floor_type === 'panel' || room.floor_type === 'Panel');
            const slabRooms = rooms.filter(room => room.floor_type === 'slab' || room.floor_type === 'Slab');
            const hasPanelOrSlabRooms = panelRooms.length > 0 || slabRooms.length > 0;
            if (!hasPanelOrSlabRooms) {
                setError('No rooms with panel or slab floors found. Floor plan is available for rooms with floor_type = "panel" (panel layout) or "slab" (slab count).');
                return;
            }

            setAllWalls(wallsResponse.data || []);
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
    }, [projectId, loadExistingFloorPlan, loadOrientationAnalysis]);

    useEffect(() => {
        if (projectId) {
            loadProjectData();
        }
    }, [projectId, loadProjectData]);

    // Process floor panels for sharing with other tabs (matches table structure)
    const processFloorPanelsForSharing = (panels, rooms) => {
        if (!panels || panels.length === 0) return [];

        const roomById = new Map((rooms || []).map((room) => [String(room.id), room]));
        const panelsByKey = new Map();

        panels.forEach(panel => {
            if (!panel) return;
            const roomId = panel.room_id || panel.room;
            const room = roomById.get(String(typeof roomId === 'object' ? roomId?.id : roomId));
            const floorThickness = room?.floor_thickness || 20;
            const isCut = !!(panel.is_cut_panel || panel.is_cut);
            const panelType = isCut ? 'Cut' : 'Full';
            const isVertical = panel.width >= panel.length;
            let displayWidth = panel.width;
            let displayLength = panel.length;
            if (isVertical) {
                displayWidth = panel.length;
                displayLength = panel.width;
            }

            const key = `${displayWidth}_${displayLength}_${floorThickness}_${panelType}`;
            if (!panelsByKey.has(key)) {
                panelsByKey.set(key, {
                    width: displayWidth,
                    length: displayLength,
                    thickness: floorThickness,
                    quantity: 0,
                    type: panelType
                });
            }
            panelsByKey.get(key).quantity += 1;
        });

        return sortMaterialPanels(Array.from(panelsByKey.values()));
    };

    const generateFloorPlan = async () => {
        if (!canEdit) return;
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
        <div className="floor-manager bg-gray-50 dark:bg-gray-900 min-h-0 transition-colors">
            {/* Header */}
            <div className="bg-white dark:bg-gray-900 shadow-sm border-b border-gray-200 dark:border-gray-700 px-3 sm:px-4 py-2 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <div className="min-w-0">
                                <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                                    {canEdit ? 'Floor Plan Generator' : 'Floor Plan'}
                                </h1>
                                {canEdit ? (
                                    <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-tight mt-0.5">
                                        Generate optimal floor panel layouts with orientation strategies to minimize waste
                                    </p>
                                ) : (
                                    <p className="text-amber-800 dark:text-amber-200 text-xs mt-0.5">
                                        {isAuthenticated ? (
                                            'View-only access (Salesman). You can view floor plans and export, but cannot generate or edit.'
                                        ) : (
                                            <>
                                                View-only mode.{' '}
                                                <Link to="/login" className="font-medium underline hover:text-amber-900">
                                                    Log in
                                                </Link>{' '}
                                                to generate floor plans or change slab size.
                                            </>
                                        )}
                                    </p>
                                )}
                            </div>
                            {/* Level (storey) selector - same as ceiling plan */}
                            {storeys.length > 1 && (
                                <div className="flex items-center gap-1.5">
                                    <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Level:</label>
                                    <select
                                        value={selectedStoreyId ?? ''}
                                        onChange={(e) => setSelectedStoreyId(e.target.value ? parseInt(e.target.value, 10) : null)}
                                        className="form-control w-auto min-w-[7rem]"
                                    >
                                        {storeys.map(storey => (
                                            <option key={storey.id} value={storey.id}>
                                                {storey.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {canEdit && planNeedsRegeneration && (
                        <div className="bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 rounded-md px-2.5 py-1.5 shrink-0">
                            <div className="flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5 text-yellow-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                                <span className="text-yellow-800 dark:text-yellow-200 text-xs font-medium">
                                    Floor plan needs regeneration due to parameter changes
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {canEdit && (
            <div className="px-3 sm:px-4 py-2">
                {/* Dimension visibility checkboxes */}
                <div className="mb-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            checked={dimensionVisibility.room}
                            onChange={() => toggleDimensionVisibility('room')}
                        />
                        <span className="text-xs text-gray-700 dark:text-gray-300">Room dimensions</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            checked={dimensionVisibility.panel}
                            onChange={() => toggleDimensionVisibility('panel')}
                        />
                        <span className="text-xs text-gray-700 dark:text-gray-300">Panel dimensions</span>
                    </label>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2 max-w-3xl">
                    {/* Strategy Selection */}
                    <div className="control-card">
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                            <svg className="w-3.5 h-3.5 inline mr-1.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            Strategy
                        </label>
                        <div className="flex items-center gap-2">
                            <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400 shrink-0">Orientation:</label>
                            <select
                                value={selectedOrientationStrategy}
                                onChange={(e) => setSelectedOrientationStrategy(e.target.value)}
                                className="flex-1 min-w-0"
                            >
                                    <option value="auto">🔄 Auto (Recommended)</option>
                                    <option value="all_horizontal">➡️ All Horizontal</option>
                                    <option value="all_vertical">⬇️ All Vertical</option>
                                    <option value="room_optimal">🎯 Room Optimal</option>
                                </select>
                        </div>
                    </div>

                    {/* Panel Dimensions */}
                    <div className="control-card">
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                            <svg className="w-3.5 h-3.5 inline mr-1.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                            Panel Dimensions
                        </label>
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                                <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400 min-w-[3.5rem] shrink-0">Width:</label>
                                <input
                                    type="number"
                                    value={panelWidth}
                                    onChange={(e) => handlePanelWidthChange(parseInt(e.target.value))}
                                    className="w-16 min-w-0"
                                    min="100"
                                    max="2000"
                                    step="50"
                                />
                                <span className="text-[10px] text-gray-500 shrink-0">mm</span>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400 min-w-[3.5rem] shrink-0">Length:</label>
                                <select
                                    value={panelLength}
                                    onChange={(e) => handlePanelLengthChange(e.target.value)}
                                    className="flex-1 min-w-0"
                                >
                                    <option value="auto">🔄 Auto (Optimal)</option>
                                    <option value="custom">✏️ Custom</option>
                                </select>
                            </div>
                            
                            {panelLength === 'custom' && (
                                <div className="flex items-center gap-2">
                                    <label className="text-[11px] font-medium text-gray-600 dark:text-gray-400 min-w-[3.5rem] shrink-0">Custom:</label>
                                    <input
                                        type="number"
                                        value={customPanelLength}
                                        onChange={(e) => handleCustomPanelLengthChange(parseInt(e.target.value))}
                                        className="w-16 min-w-0"
                                        min="500"
                                        max="15000"
                                        step="100"
                                    />
                                    <span className="text-[10px] text-gray-500 shrink-0">mm</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            onClick={generateFloorPlan}
                            disabled={isGenerating}
                            className="btn-generate inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-md text-sm font-medium hover:from-green-700 hover:to-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {isGenerating ? (
                                <div className="flex items-center gap-1.5">
                                    <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Generating...</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                                className="btn-regenerate px-2.5 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Regenerate
                            </button>
                        )}
                    </div>
                    
                    {planNeedsRegeneration && (
                        <div className="text-xs text-yellow-600 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950/40 px-2 py-1 rounded-md">
                            ⚠️ Parameters changed - regenerate for updated plan
                        </div>
                    )}
                </div>
                
                {/* Error Display */}
                {error && (
                    <div className="mt-2 px-2.5 py-1.5 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 rounded-md text-xs">
                        {error}
                    </div>
                )}
            </div>
            )}

            {/* Main Content: show canvas when we have a generated plan OR when we have panel/slab rooms (so slab counts and Generate are available) */}
            <div className="px-3 sm:px-4 py-3">
                {(floorPlan || (filteredRooms.length > 0 && filteredRooms.some(r => (r.floor_type === 'panel' || r.floor_type === 'Panel' || r.floor_type === 'slab' || r.floor_type === 'Slab')))) ? (
                    <div className="space-y-6">
                        {/* Canvas */}
                        <FloorCanvas
                            rooms={filteredRooms}
                            walls={filteredWalls}
                            intersections={allIntersections}
                            floorPlan={floorPlan || null}
                            floorPanels={filteredFloorPanels}
                            projectData={projectData}
                            projectWastePercentage={projectWastePercentage}
                            dimensionVisibility={dimensionVisibility}
                            slabWidth={slabWidth}
                            slabLength={slabLength}
                            canEdit={canEdit}
                            onSlabWidthChange={canEdit ? handleSlabWidthChange : null}
                            onSlabLengthChange={canEdit ? handleSlabLengthChange : null}
                            storeys={storeys}
                            ghostWalls={ghostWalls}
                            ghostAreas={ghostAreas}

                            floorPanelsMap={(() => {
                                // Convert filtered floor panels to floorPanelsMap format (by room for selected level)
                                const panelsMap = {};
                                if (filteredFloorPanels && Array.isArray(filteredFloorPanels)) {
                                    filteredFloorPanels.forEach(panel => {
                                        let roomId = panel.room_id;
                                        if (!roomId && panel.room) {
                                            roomId = typeof panel.room === 'object' ? panel.room.id : panel.room;
                                        }
                                        if (roomId) {
                                            if (!panelsMap[roomId]) panelsMap[roomId] = [];
                                            panelsMap[roomId].push(panel);
                                        }
                                    });
                                }
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
                            {canEdit
                                ? 'Generate a floor plan to automatically create optimal panel layout with the best orientation strategy.'
                                : 'No floor plan has been generated for this project yet.'}
                        </p>
                        {canEdit && (
                            <button
                                onClick={generateFloorPlan}
                                disabled={isGenerating}
                                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isGenerating ? 'Generating...' : 'Generate Floor Plan'}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FloorManager;
