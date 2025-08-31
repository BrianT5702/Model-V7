import React, { useState, useEffect, useMemo } from 'react';
import jsPDF from 'jspdf';
import api from '../../api/api';
import PanelCalculator from '../panel/PanelCalculator';

const InstallationTimeEstimator = ({ projectId, sharedPanelData = null, updateSharedPanelData = null }) => {
    const [projectData, setProjectData] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [ceilingPlans, setCeilingPlans] = useState([]);
    const [floorPlans, setFloorPlans] = useState([]);
    const [walls, setWalls] = useState([]);
    const [doors, setDoors] = useState([]);
    
    // User input fields for installation rates
    const [panelsPerDay, setPanelsPerDay] = useState(20);
    const [doorsPerDay, setDoorsPerDay] = useState(2);
    const [slabsPerDay, setSlabsPerDay] = useState(10);
    
    // Loading states
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    
    // Export states
    const [showExportPreview, setShowExportPreview] = useState(false);
    const [exportData, setExportData] = useState(null);
    const [isExporting, setIsExporting] = useState(false);

    // Log shared panel data when it changes
    useEffect(() => {
        if (sharedPanelData) {
            console.log('InstallationTimeEstimator received shared panel data:', sharedPanelData);
        }
    }, [sharedPanelData]);

    // Fetch all project data
    useEffect(() => {
        const fetchProjectData = async () => {
            try {
                setIsLoading(true);
                setError(null);

                // Fetch project details
                const projectResponse = await api.get(`/projects/${projectId}/`);
                setProjectData(projectResponse.data);

                // Fetch rooms
                const roomsResponse = await api.get(`/rooms/?project=${projectId}`);
                setRooms(roomsResponse.data);

                // Fetch ceiling plans for all rooms
                const ceilingPlansPromises = roomsResponse.data.map(room => 
                    api.get(`/ceiling-plans/?room=${room.id}`)
                );
                const ceilingResponses = await Promise.all(ceilingPlansPromises);
                const allCeilingPlans = ceilingResponses.flatMap(response => response.data);
                setCeilingPlans(allCeilingPlans);

                // Fetch floor plans for all rooms
                const floorPlansPromises = roomsResponse.data.map(room => 
                    api.get(`/floor-plans/?room=${room.id}`)
                );
                const floorResponses = await Promise.all(floorPlansPromises);
                const allFloorPlans = floorResponses.flatMap(response => response.data);
                setFloorPlans(allFloorPlans);

                // Fetch walls for panel calculation
                try {
                    const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
                    setWalls(wallsResponse.data);
                } catch (wallErr) {
                    console.log('Walls not available');
                    setWalls([]);
                }

                // Fetch doors from project data
                try {
                    const doorsResponse = await api.get(`/doors/?project=${projectId}`);
                    setDoors(doorsResponse.data);
                } catch (doorErr) {
                    console.log('Doors not available');
                    setDoors([]);
                }

                // Auto-fetch existing panel data if available
                await autoFetchExistingPanelData(projectId, roomsResponse.data);

            } catch (err) {
                console.error('Error fetching project data:', err);
                setError('Failed to load project data. Please try again.');
            } finally {
                setIsLoading(false);
            }
        };

        if (projectId) {
            fetchProjectData();
        }
    }, [projectId]);

    // Auto-fetch existing panel data from all tabs
    const autoFetchExistingPanelData = async (projectId, rooms) => {
        if (!updateSharedPanelData) return;
        
        try {
            console.log('🔄 Auto-fetching existing panel data...');
            
            // 1. Auto-fetch existing wall panel data
            await autoFetchWallPanelData(projectId);
            
            // 2. Auto-fetch existing ceiling panel data
            await autoFetchCeilingPanelData(projectId, rooms);
            
            // 3. Auto-fetch existing floor panel data
            await autoFetchFloorPanelData(projectId, rooms);
            
            console.log('✅ Auto-fetch completed');
        } catch (error) {
            console.error('Error auto-fetching panel data:', error);
        }
    };

    // Manual trigger for auto-fetch (for refresh scenarios)
    const triggerAutoFetch = async () => {
        if (!projectId || !updateSharedPanelData) return;
        
        try {
            setIsLoading(true);
            console.log('🔄 Manual auto-fetch triggered...');
            
            // Fetch fresh project data and trigger auto-fetch
            const projectResponse = await api.get(`/projects/${projectId}/`);
            setProjectData(projectResponse.data);

            const roomsResponse = await api.get(`/rooms/?project=${projectId}`);
            const rooms = roomsResponse.data;
            setRooms(rooms);

            // Fetch ceiling plans for all rooms
            const ceilingPlansPromises = rooms.map(room => 
                api.get(`/ceiling-plans/?room=${room.id}`)
            );
            const ceilingResponses = await Promise.all(ceilingPlansPromises);
            const allCeilingPlans = ceilingResponses.flatMap(response => response.data);
            setCeilingPlans(allCeilingPlans);

            // Fetch floor plans for all rooms
            const floorPlansPromises = rooms.map(room => 
                api.get(`/floor-plans/?room=${room.id}`)
            );
            const floorResponses = await Promise.all(floorPlansPromises);
            const allFloorPlans = floorResponses.flatMap(response => response.data);
            setFloorPlans(allFloorPlans);

            // Fetch walls for panel calculation
            try {
                const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
                setWalls(wallsResponse.data);
            } catch (wallErr) {
                console.log('Walls not available');
                setWalls([]);
            }

            // Fetch doors from project data
            try {
                const doorsResponse = await api.get(`/doors/?project=${projectId}`);
                setDoors(doorsResponse.data);
            } catch (doorErr) {
                console.log('Doors not available');
                setDoors([]);
            }

            // Now trigger auto-fetch with fresh data
            await autoFetchExistingPanelData(projectId, rooms);
            
            console.log('✅ Manual auto-fetch completed');
        } catch (error) {
            console.error('Error in manual auto-fetch:', error);
            setError('Failed to auto-fetch data. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-fetch existing wall panel data
    const autoFetchWallPanelData = async (projectId) => {
        try {
            // Check if walls exist and calculate panels
            if (walls.length > 0) {
                console.log('🏗️ Auto-calculating wall panels from existing walls...');
                
                // Fetch intersections data needed for proper panel calculation
                let intersections = [];
                try {
                    const intersectionsResponse = await api.get(`/intersections/?projectid=${projectId}`);
                    intersections = intersectionsResponse.data || [];
                } catch (intersectionErr) {
                    console.log('Intersections not available, using default joint types');
                }
                
                // Use proper PanelCalculator to get actual panel data
                const wallPanelData = await calculateActualWallPanels(walls, intersections);
                
                if (wallPanelData && wallPanelData.length > 0) {
                    console.log('📊 Wall panel calculation results:', {
                        totalWalls: walls.length,
                        totalPanels: wallPanelData.reduce((sum, panel) => sum + panel.quantity, 0),
                        panelTypes: wallPanelData.map(p => ({ width: p.width, length: p.length, quantity: p.quantity, type: p.type }))
                    });
                    
                    // Share the auto-fetched wall panel data
                    updateSharedPanelData('wall-plan', wallPanelData, {
                        totalPanels: wallPanelData.reduce((sum, panel) => sum + panel.quantity, 0),
                        autoFetched: true
                    });
                    
                    console.log('✅ Wall panels auto-fetched:', wallPanelData);
                } else {
                    console.log('⚠️ No wall panels calculated from', walls.length, 'walls');
                }
            }
        } catch (error) {
            console.error('Error auto-fetching wall panel data:', error);
        }
    };

    // Auto-fetch existing ceiling panel data
    const autoFetchCeilingPanelData = async (projectId, rooms) => {
        try {
            // Check if ceiling plans exist
            if (ceilingPlans.length > 0) {
                console.log('🔝 Auto-fetching ceiling panel data from existing plans...');
                
                // Get ceiling panels for all rooms
                const ceilingPanelsPromises = rooms.map(room => 
                    api.get(`/ceiling-panels/?room=${room.id}`)
                );
                
                const ceilingPanelsResponses = await Promise.all(ceilingPanelsPromises);
                const allCeilingPanels = ceilingPanelsResponses.flatMap(response => response.data);
                
                if (allCeilingPanels.length > 0) {
                    // Process ceiling panels similar to CeilingManager
                    const processedPanels = processCeilingPanelsForSharing(allCeilingPanels);
                    
                    // Share the auto-fetched ceiling panel data
                    updateSharedPanelData('ceiling-plan', processedPanels, {
                        supportType: 'nylon', // Default values
                        includeAccessories: false,
                        includeCable: false,
                        aluSuspensionCustomDrawing: false,
                        panelsNeedSupport: processedPanels.some(panel => panel.length > 6000),
                        autoFetched: true
                    });
                    
                    console.log('✅ Ceiling panels auto-fetched:', processedPanels);
                }
            }
        } catch (error) {
            console.error('Error auto-fetching ceiling panel data:', error);
        }
    };

    // Calculate actual wall panels using proper PanelCalculator logic (mirrors PanelCalculationControls)
    const calculateActualWallPanels = async (walls, intersections) => {
        if (!walls || walls.length === 0) return [];
        
        try {
            const calculator = new PanelCalculator();
            const allPanels = [];

            walls.forEach(wall => {
                // Validate wall object structure
                if (!wall || typeof wall.start_x !== 'number' || typeof wall.start_y !== 'number' || 
                    typeof wall.end_x !== 'number' || typeof wall.end_y !== 'number') {
                    console.warn('Invalid wall data structure:', wall);
                    return;
                }
                
                const wallLength = Math.sqrt(
                    Math.pow(wall.end_x - wall.start_x, 2) + 
                    Math.pow(wall.end_y - wall.start_y, 2)
                );

                // Find all intersections for this wall
                const wallIntersections = intersections.filter(inter => 
                    inter.pairs && inter.pairs.some(pair => 
                        pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)
                    )
                );

                // Determine joint types for both ends
                let leftJointType = 'butt_in';
                let rightJointType = 'butt_in';

                // Determine wall orientation and which end is left/right
                const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
                const isLeftToRight = wall.end_x > wall.start_x;
                const isBottomToTop = wall.end_y > wall.start_y;

                // Track all intersections for each end
                const leftEndIntersections = [];
                const rightEndIntersections = [];

                wallIntersections.forEach(inter => {
                    if (!inter.pairs) return;
                    inter.pairs.forEach(pair => {
                        if (pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)) {
                            // For horizontal walls
                            if (isHorizontal) {
                                if (isLeftToRight) {
                                    // Wall goes left to right
                                    if (inter.x === wall.start_x) {
                                        leftEndIntersections.push(pair.joining_method);
                                    } else if (inter.x === wall.end_x) {
                                        rightEndIntersections.push(pair.joining_method);
                                    }
                                } else {
                                    // Wall goes right to left
                                    if (inter.x === wall.start_x) {
                                        rightEndIntersections.push(pair.joining_method);
                                    } else if (inter.x === wall.end_x) {
                                        leftEndIntersections.push(pair.joining_method);
                                    }
                                }
                            }
                            // For vertical walls
                            if (isBottomToTop) {
                                // Wall goes bottom to top
                                if (inter.y === wall.start_y) {
                                    leftEndIntersections.push(pair.joining_method);
                                } else if (inter.y === wall.end_y) {
                                    rightEndIntersections.push(pair.joining_method);
                                }
                            } else {
                                // Wall goes top to bottom
                                if (inter.y === wall.start_y) {
                                    rightEndIntersections.push(pair.joining_method);
                                } else if (inter.y === wall.end_y) {
                                    leftEndIntersections.push(pair.joining_method);
                                }
                            }
                        }
                    });
                });

                // Set joint types, prioritizing 45_cut
                leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
                rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';

                // Validate wall height and thickness
                if (typeof wall.height !== 'number' || typeof wall.thickness !== 'number') {
                    console.warn('Invalid wall height or thickness:', { height: wall.height, thickness: wall.thickness });
                    return;
                }
                
                const panels = calculator.calculatePanels(
                    wallLength,
                    wall.thickness,
                    { left: leftJointType, right: rightJointType }
                );

                // Validate panels array
                if (!panels || !Array.isArray(panels)) {
                    console.warn('No panels returned for wall:', wall.id);
                    return;
                }
                
                // Add wall-specific information to each panel
                panels.forEach(panel => {
                    if (!panel || typeof panel.width !== 'number') {
                        console.warn('Invalid panel data:', panel);
                        return;
                    }
                    
                    let panelType = panel.type;
                    if (panelType === 'leftover' && panel.width < 200 && !panel.isLeftover) {
                        panelType = 'side';
                    }
                    allPanels.push({
                        ...panel,
                        type: panelType,
                        length: wall.height,
                        application: wall.application_type || 'standard',
                        wallId: wall.id,
                        wallLength: wallLength,
                        wallStart: `(${Math.round(wall.start_x)}, ${Math.round(wall.start_y)})`,
                        wallEnd: `(${Math.round(wall.end_x)}, ${Math.round(wall.end_y)})`
                    });
                });
            });

            // Group panels by dimensions and application for sharing (matches table structure)
            const groupedPanelsForSharing = allPanels.reduce((acc, panel) => {
                const key = `${panel.width}-${panel.length}-${panel.application}`;
                if (!acc[key]) {
                    acc[key] = {
                        width: panel.width,
                        length: panel.length,
                        application: panel.application,
                        quantity: 0,
                        type: panel.type
                    };
                }
                acc[key].quantity += 1;
                return acc;
            }, {});

            return Object.values(groupedPanelsForSharing);
            
        } catch (error) {
            console.error('Error calculating actual wall panels:', error);
            return [];
        }
    };

    // Auto-fetch existing floor panel data
    const autoFetchFloorPanelData = async (projectId, rooms) => {
        try {
            // Check if floor plans exist
            if (floorPlans.length > 0) {
                console.log('🏠 Auto-fetching floor panel data from existing plans...');
                
                // Get floor panels for all rooms
                const floorPanelsPromises = rooms.map(room => 
                    api.get(`/floor-panels/?room=${room.id}`)
                );
                
                const floorPanelsResponses = await Promise.all(floorPanelsPromises);
                const allFloorPanels = floorPanelsResponses.flatMap(response => response.data);
                
                if (allFloorPanels.length > 0) {
                    // Process floor panels similar to FloorManager
                    const processedPanels = processFloorPanelsForSharing(allFloorPanels, rooms);
                    
                    // Share the auto-fetched floor panel data
                    updateSharedPanelData('floor-plan', processedPanels, {
                        autoFetched: true
                    });
                    
                    console.log('✅ Floor panels auto-fetched:', processedPanels);
                }
            }
        } catch (error) {
            console.error('Error auto-fetching floor panel data:', error);
        }
    };

    // Helper function to process ceiling panels for sharing (similar to CeilingManager)
    const processCeilingPanelsForSharing = (panels) => {
        if (!panels || panels.length === 0) return [];
        
        // Group panels by dimensions (width, length, thickness)
        const panelsByDimension = new Map();
        panels.forEach(panel => {
            // Use panel thickness if available, otherwise use default
            const panelThickness = panel.thickness || 150; // Default ceiling thickness
            
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

    // Helper function to process floor panels for sharing (similar to FloorManager)
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

    // Calculate room area using shoelace formula
    const calculateRoomArea = (roomPoints) => {
        if (roomPoints.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < roomPoints.length; i++) {
            const j = (i + 1) % roomPoints.length;
            area += roomPoints[i].x * roomPoints[j].y;
            area -= roomPoints[j].x * roomPoints[i].y;
        }
        return Math.abs(area) / 2;
    };

    // Calculate wall panels using PanelCalculator
    const calculateWallPanels = (walls) => {
        if (!walls || walls.length === 0) return 0;
        
        const calculator = new PanelCalculator();
        let totalPanels = 0;
        
        walls.forEach(wall => {
            if (wall.start_x !== undefined && wall.start_y !== undefined && 
                wall.end_x !== undefined && wall.end_y !== undefined &&
                wall.height && wall.thickness) {
                
                const wallLength = Math.sqrt(
                    Math.pow(wall.end_x - wall.start_x, 2) + 
                    Math.pow(wall.end_y - wall.start_y, 2)
                );
                
                // Calculate panels for this wall (assuming butt_in joints for simplicity)
                const panels = calculator.calculatePanels(wallLength, wall.thickness, { left: 'butt_in', right: 'butt_in' });
                totalPanels += panels.length;
            }
        });
        
        return totalPanels;
    };

    // Calculate total quantities from all sources
    const totalQuantities = useMemo(() => {
        if (!rooms.length) return { panels: 0, doors: 0, slabs: 0 };

        // Count ceiling panels from generated ceiling plans
        const ceilingPanels = ceilingPlans.reduce((total, plan) => {
            return total + (plan.total_panels || 0);
        }, 0);

        // Count floor panels from generated floor plans
        const floorPanels = floorPlans.reduce((total, plan) => {
            return total + (plan.total_panels || 0);
        }, 0);

        // Calculate wall panels using PanelCalculator
        const wallPanelsCount = calculateWallPanels(walls);

        // Count doors from actual project data
        const totalDoors = doors.length;

        // Calculate slabs needed based on room area (only for rooms with slab floors)
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

        return {
            panels: ceilingPanels + floorPanels + wallPanelsCount,
            doors: totalDoors,
            slabs: totalSlabs
        };
    }, [rooms, ceilingPlans, floorPlans, walls, doors]);

    // Calculate installation time estimates
    const installationEstimates = useMemo(() => {
        if (!totalQuantities.panels && !totalQuantities.doors && !totalQuantities.slabs) {
            return { days: 0, weeks: 0, months: 0 };
        }

        const panelDays = Math.ceil(totalQuantities.panels / panelsPerDay);
        const doorDays = Math.ceil(totalQuantities.doors / doorsPerDay);
        const slabDays = Math.ceil(totalQuantities.slabs / slabsPerDay);

        // Total days needed (assuming parallel work where possible)
        const totalDays = Math.max(panelDays, doorDays, slabDays);
        
        // Add some buffer for coordination and unexpected issues
        const daysWithBuffer = Math.ceil(totalDays * 1.2);

        // Calculate weeks and months with proper thresholds
        const weeks = daysWithBuffer >= 5 ? Math.ceil(daysWithBuffer / 5) : 0;
        const months = daysWithBuffer >= 22 ? Math.ceil(daysWithBuffer / 22) : 0;

        return {
            days: daysWithBuffer,
            weeks: weeks, // 0 if less than 5 days, otherwise calculated
            months: months // 0 if less than 22 days, otherwise calculated
        };
    }, [totalQuantities, panelsPerDay, doorsPerDay, slabsPerDay]);

    // Handle input changes
    const handleInputChange = (field, value) => {
        const numValue = Math.max(1, parseInt(value) || 1);
        switch (field) {
            case 'panels':
                setPanelsPerDay(numValue);
                break;
            case 'doors':
                setDoorsPerDay(numValue);
                break;
            case 'slabs':
                setSlabsPerDay(numValue);
                break;
            default:
                break;
        }
    };

    // Prepare export data
    const prepareExportData = async () => {
        console.log('Shared panel data:', sharedPanelData);
        console.log('Wall panels:', sharedPanelData?.wallPanels);
        console.log('Ceiling panels:', sharedPanelData?.ceilingPanels);
        console.log('Floor panels:', sharedPanelData?.floorPanels);
        
        // Check if we have panel data, if not, try to auto-fetch first
        if (!sharedPanelData?.wallPanels && !sharedPanelData?.ceilingPanels && !sharedPanelData?.floorPanels) {
            console.log('⚠️ No panel data available, attempting auto-fetch...');
            
            try {
                // Show loading state
                setIsLoading(true);
                
                // Trigger auto-fetch
                await triggerAutoFetch();
                
                // Wait a moment for the data to be processed
                await new Promise(resolve => setTimeout(resolve, 500));
                
                console.log('✅ Auto-fetch completed, now preparing export data...');
            } catch (error) {
                console.error('Auto-fetch failed:', error);
                // Continue with export even if auto-fetch fails
            } finally {
                setIsLoading(false);
            }
        }
        
        const data = {
            projectInfo: {
                name: projectData?.name || 'Unknown Project',
                dimensions: projectData ? `${Math.round(projectData.width / 1000)} × ${Math.round(projectData.length / 1000)} × ${Math.round(projectData.height / 1000)} m` : 'N/A',
                rooms: rooms.length,
                walls: walls.length,
                doors: doors.length
            },
            rooms: rooms, // Include full room data for the preview
            wallPanels: sharedPanelData?.wallPanels || [],
            ceilingPanels: sharedPanelData?.ceilingPanels || [],
            floorPanels: sharedPanelData?.floorPanels || [],
            wallPanelAnalysis: sharedPanelData?.wallPanelAnalysis || null,
            doors: doors,
            slabs: rooms.filter(room => room.floor_type === 'slab' || room.floor_type === 'Slab'),
            installationEstimates: installationEstimates,
            supportAccessories: {
                type: sharedPanelData?.supportType || 'nylon',
                includeAccessories: sharedPanelData?.includeAccessories || false,
                includeCable: sharedPanelData?.includeCable || false,
                customDrawing: sharedPanelData?.aluSuspensionCustomDrawing || false,
                // Use the panelsNeedSupport from shared data
                isNeeded: sharedPanelData?.panelsNeedSupport || false
            },
            exportDate: new Date().toLocaleString()
        };
        
        // Debug logging for support accessories
        console.log('🔍 Support Accessories Debug Info:');
        console.log('  - sharedPanelData:', sharedPanelData);
        console.log('  - supportType:', sharedPanelData?.supportType);
        console.log('  - includeAccessories:', sharedPanelData?.includeAccessories);
        console.log('  - includeCable:', sharedPanelData?.includeCable);
        console.log('  - aluSuspensionCustomDrawing:', sharedPanelData?.aluSuspensionCustomDrawing);
        console.log('  - panelsNeedSupport:', sharedPanelData?.panelsNeedSupport);
        console.log('  - Final supportAccessories:', data.supportAccessories);
        
        setExportData(data);
        setShowExportPreview(true);
    };

    // Generate PDF export
    const generatePDF = async () => {
        if (!exportData) return;
        
        setIsExporting(true);
        try {
            console.log('🔄 Starting PDF generation...');
            
            // Create a new PDF document
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 20;
            const contentWidth = pageWidth - (2 * margin);
            let currentY = margin;
            
            // Helper function to add text with proper positioning
            const addText = (text, x, y, fontSize = 12, isBold = false, alignment = 'left') => {
                pdf.setFontSize(fontSize);
                pdf.setFont('helvetica', isBold ? 'bold' : 'normal');
                if (alignment === 'center') {
                    pdf.text(text, x + (contentWidth / 2), y);
                } else {
                    pdf.text(text, x, y);
                }
            };
            
            // Helper function to add a simple text line
            const addTextLine = (text, y, fontSize = 10) => {
                pdf.setFontSize(fontSize);
                pdf.setFont('helvetica', 'normal');
                pdf.text(text, margin, y);
                return y + fontSize + 2;
            };
            
            // Helper function to add a section header
            const addSectionHeader = (text, y) => {
                // Add some spacing before the header
                y += 5;
                addText(text, margin, y, 16, true, 'center');
                return y + 20; // More space after header
            };
            
            // Helper function to add a subsection header
            const addSubsectionHeader = (text, y) => {
                addText(text, margin, y, 14, true);
                return y + 6;
            };
            
            // Helper function to add a table (simplified approach)
            const addTable = (headers, data, startY, colWidths) => {
                const rowHeight = 10;
                const headerY = startY;
                
                // Calculate total table width and adjust column widths proportionally
                const totalWidth = colWidths.reduce((sum, width) => sum + width, 0);
                const availableWidth = contentWidth;
                const scaleFactor = availableWidth / totalWidth;
                const adjustedColWidths = colWidths.map(width => width * scaleFactor);
                
                // Add headers with simple styling
                pdf.setFontSize(10);
                pdf.setFont('helvetica', 'bold');
                
                let currentX = margin;
                headers.forEach((header, index) => {
                    const colWidth = adjustedColWidths[index];
                    // Simple header with border only
                    pdf.rect(currentX, headerY - 2, colWidth, rowHeight + 2, 'S');
                    // Center the header text
                    const textWidth = pdf.getTextWidth(header);
                    const textX = currentX + (colWidth / 2) - (textWidth / 2);
                    pdf.text(header, textX, headerY + 3);
                    currentX += colWidth;
                });
                
                // Add data rows with simple styling
                pdf.setFontSize(9);
                pdf.setFont('helvetica', 'normal');
                data.forEach((row, rowIndex) => {
                    const rowY = headerY + (rowHeight + 2) + (rowIndex * rowHeight);
                    currentX = margin;
                    
                    row.forEach((cell, cellIndex) => {
                        const colWidth = adjustedColWidths[cellIndex];
                        // Simple cell with border only
                        pdf.rect(currentX, rowY - 1, colWidth, rowHeight, 'S');
                        
                        // Ensure cell is converted to string
                        let displayText = String(cell || 'N/A');
                        const maxTextWidth = colWidth - 6; // Leave 3px padding on each side
                        
                        if (pdf.getTextWidth(displayText) > maxTextWidth) {
                            // Truncate text to fit
                            while (displayText.length > 0 && pdf.getTextWidth(displayText + '...') > maxTextWidth) {
                                displayText = displayText.slice(0, -1);
                            }
                            displayText += '...';
                        }
                        
                        // Center the text in the cell
                        const textWidth = pdf.getTextWidth(displayText);
                        const textX = currentX + (colWidth / 2) - (textWidth / 2);
                        pdf.text(displayText, textX, rowY + 4);
                        
                        currentX += colWidth;
                    });
                });
                
                return startY + (rowHeight + 2) + (data.length * rowHeight) + 15;
            };
            
            // Helper function to check if we need a new page
            const checkNewPage = (requiredHeight) => {
                if (currentY + requiredHeight > pageHeight - margin) {
                    pdf.addPage();
                    currentY = margin;
                    return true;
                }
                return false;
            };
            
            // Title Page
            addText('PROJECT SUMMARY & INSTALLATION REPORT', margin, currentY, 20, true, 'center');
            currentY += 25;
            
            addText(exportData.projectInfo.name, margin, currentY, 18, true, 'center');
            currentY += 20;
            
            addText(`Generated on: ${exportData.exportDate}`, margin, currentY, 10, false, 'center');
            currentY += 30;
            
            // Project Overview
            currentY = addSectionHeader('PROJECT OVERVIEW', currentY);
            checkNewPage(40);
            
            const overviewData = [
                ['Project Dimensions', exportData.projectInfo.dimensions],
                ['Total Rooms', exportData.projectInfo.rooms.toString()],
                ['Total Walls', exportData.projectInfo.walls.toString()],
                ['Total Doors', exportData.projectInfo.doors.toString()]
            ];
            currentY = addTable(['Property', 'Value'], overviewData, currentY, [60, 40]);
            currentY += 15; // Add extra spacing
            
            // Room Details
            if (exportData.rooms && exportData.rooms.length > 0) {
                currentY = addSectionHeader('ROOM DETAILS', currentY);
                checkNewPage(50);
                
                const roomHeaders = ['Room Name', 'Floor Type', 'Floor Thickness (mm)', 'Height (mm)', 'Area (m²)'];
                const roomData = exportData.rooms.map(room => [
                    String(room.room_name || 'Unnamed Room'),
                    String(room.floor_type || 'N/A'),
                    String(room.floor_thickness || 'N/A'),
                    String(room.height || 'N/A'),
                    room.room_points && room.room_points.length > 0 
                        ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                        : 'N/A'
                ]);
                
                currentY = addTable(roomHeaders, roomData, currentY, [40, 30, 35, 25, 30]);
                currentY += 15; // Add extra spacing
            }
            
            // Wall Panels
            if (exportData.wallPanels.length > 0) {
                currentY = addSectionHeader('WALL PANELS', currentY);
                checkNewPage(60);
                
                const wallHeaders = ['No.', 'Width (mm)', 'Length (mm)', 'Quantity', 'Type', 'Application'];
                const wallData = exportData.wallPanels.map((panel, index) => [
                    (index + 1).toString(),
                    panel.width?.toString() || 'N/A',
                    panel.length?.toString() || 'N/A',
                    (panel.quantity || 1).toString(),
                    panel.type || 'N/A',
                    panel.application || 'N/A'
                ]);
                
                currentY = addTable(wallHeaders, wallData, currentY, [20, 35, 35, 25, 30, 35]);
                currentY += 15; // Add extra spacing
            }
            
            // Ceiling Panels
            if (exportData.ceilingPanels.length > 0) {
                currentY = addSectionHeader('CEILING PANELS', currentY);
                checkNewPage(60);
                
                const ceilingHeaders = ['Width (mm)', 'Length (mm)', 'Thickness (mm)', 'Quantity'];
                const ceilingData = exportData.ceilingPanels.map(panel => [
                    (panel.width || 'N/A').toString(),
                    (panel.length || 'N/A').toString(),
                    (panel.thickness || 'N/A').toString(),
                    (panel.quantity || 1).toString()
                ]);
                
                currentY = addTable(ceilingHeaders, ceilingData, currentY, [40, 40, 40, 40]);
                currentY += 15; // Add extra spacing
            }
            
            // Floor Panels
            if (exportData.floorPanels.length > 0) {
                currentY = addSectionHeader('FLOOR PANELS', currentY);
                checkNewPage(60);
                
                const floorHeaders = ['Width (mm)', 'Length (mm)', 'Thickness (mm)', 'Quantity', 'Type'];
                const floorData = exportData.floorPanels.map(panel => [
                    (panel.width || 'N/A').toString(),
                    (panel.length || 'N/A').toString(),
                    (panel.thickness || 'N/A').toString(),
                    (panel.quantity || 1).toString(),
                    panel.type || 'N/A'
                ]);
                
                currentY = addTable(floorHeaders, floorData, currentY, [35, 35, 35, 30, 25]);
                currentY += 15; // Add extra spacing
            }
            
            // Slab Panels
            if (exportData.slabs && exportData.slabs.length > 0) {
                currentY = addSectionHeader('SLAB FLOORS', currentY);
                checkNewPage(60);
                
                const slabHeaders = ['Room Name', 'Room Area (m²)', 'Slab Size (mm)', 'Number of Slabs Needed'];
                const slabData = exportData.slabs.map(room => [
                    room.room_name || 'Unnamed Room',
                    room.room_points && room.room_points.length > 0 
                        ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                        : 'N/A',
                    '1210 × 3000',
                    room.room_points && room.room_points.length > 0 
                        ? Math.ceil(calculateRoomArea(room.room_points) / (1210 * 3000)).toString()
                        : 'N/A'
                ]);
                
                currentY = addTable(slabHeaders, slabData, currentY, [50, 35, 35, 40]);
                currentY += 15; // Add extra spacing
            }
            
            // Doors
            if (exportData.doors.length > 0) {
                currentY = addSectionHeader('DOORS', currentY);
                checkNewPage(60);
                
                const doorHeaders = ['Door Type', 'Width (mm)', 'Height (mm)', 'Thickness (mm)'];
                const doorData = exportData.doors.map(door => [
                    door.door_type || 'N/A',
                    (door.width || 'N/A').toString(),
                    (door.height || 'N/A').toString(),
                    (door.thickness || 'N/A').toString()
                ]);
                
                currentY = addTable(doorHeaders, doorData, currentY, [45, 35, 35, 45]);
                currentY += 15; // Add extra spacing
            }
            
            // Support Accessories
            currentY = addSectionHeader('SUPPORT ACCESSORIES', currentY);
            checkNewPage(40);
            
            if (exportData.supportAccessories.isNeeded) {
                const supportData = [
                    ['Support Type', exportData.supportAccessories.type === 'nylon' ? 'Nylon Hanger' : 'Alu Suspension'],
                    ['Include Accessories', exportData.supportAccessories.includeAccessories ? 'Yes' : 'No'],
                    ['Include Cable', exportData.supportAccessories.includeCable ? 'Yes' : 'No'],
                    ['Custom Drawing', exportData.supportAccessories.customDrawing ? 'Yes' : 'No']
                ];
                currentY = addTable(['Property', 'Value'], supportData, currentY, [60, 40]);
            } else {
                currentY = addTextLine('Not needed in this project - All ceiling panels are under 6000mm length', currentY, 10);
            }
            currentY += 15; // Add extra spacing
            
            // Installation Estimates
            currentY = addSectionHeader('INSTALLATION TIME ESTIMATES', currentY);
            checkNewPage(40);
            
            const installationData = [
                ['Working Days', exportData.installationEstimates.days.toString()],
                ['Working Weeks', exportData.installationEstimates.weeks.toString()],
                ['Working Months', exportData.installationEstimates.months.toString()]
            ];
            currentY = addTable(['Time Unit', 'Estimate'], installationData, currentY, [60, 40]);
            currentY += 20; // Add extra spacing at the end
            
            // Generate filename
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `${exportData.projectInfo.name.replace(/[^a-zA-Z0-9]/g, '_')}_Report_${timestamp}.pdf`;
            
            // Save the PDF
            pdf.save(filename);
            
            console.log('✅ PDF generated successfully:', filename);
            
            // Show success message
            alert(`PDF generated successfully! File: ${filename}`);
            
        } catch (error) {
            console.error('Error generating PDF:', error);
            setError('Failed to generate PDF. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                    <div className="space-y-3">
                        <div className="h-4 bg-gray-200 rounded w-full"></div>
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="text-center text-red-600">
                    <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <p className="text-lg font-semibold">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="mb-6 flex justify-between items-start">
                <div>
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">
                        Project Summary & Installation Time Estimator
                    </h3>
                    <p className="text-gray-600">
                        Comprehensive project overview with installation time calculations
                    </p>
                </div>
                
                {/* Export Button */}
                <button
                    onClick={prepareExportData}
                    disabled={isLoading}
                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 font-medium shadow-lg flex items-center disabled:opacity-50"
                >
                    {isLoading ? (
                        <>
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                            Auto-Fetching Data...
                        </>
                    ) : (
                        <>
                            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Export Project Report
                        </>
                    )}
                </button>
            </div>

            {/* Auto-Fetch Status and Controls */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <h4 className="font-medium text-blue-800">Data Auto-Fetch Status</h4>
                            <p className="text-sm text-blue-700 mt-1">
                                {sharedPanelData && (sharedPanelData.wallPanels || sharedPanelData.ceilingPanels || sharedPanelData.floorPanels) 
                                    ? '✅ Project data is loaded and ready for export'
                                    : '⏳ No project data found - click "Auto-Fetch Data" to load existing plans'
                                }
                            </p>
                        </div>
                    </div>
                    
                    {/* Auto-Fetch Button */}
                    <button
                        onClick={() => triggerAutoFetch()}
                        disabled={isLoading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center"
                    >
                        {isLoading ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Loading...
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Auto-Fetch Data
                            </>
                        )}
                    </button>
                </div>
                
                {/* Data Status Indicators */}
                <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                        <span className={`w-2 h-2 rounded-full mr-2 ${sharedPanelData?.wallPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Wall Plan</span>
                    </div>
                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                        <span className={`w-2 h-2 rounded-full mr-2 ${sharedPanelData?.ceilingPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Ceiling Plan</span>
                    </div>
                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                        <span className={`w-2 h-2 rounded-full mr-2 ${sharedPanelData?.floorPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                        <span>Floor Plan</span>
                    </div>
                </div>
            </div>

            {/* Project Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{rooms.length}</div>
                        <div className="text-sm text-blue-700">Rooms</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{walls.length}</div>
                        <div className="text-sm text-green-700">Walls</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{doors.length}</div>
                        <div className="text-sm text-purple-700">Doors</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">
                            {projectData ? `${Math.round(projectData.width / 1000)} × ${Math.round(projectData.length / 1000)}` : 'N/A'}
                        </div>
                        <div className="text-sm text-orange-700">Dimensions (m)</div>
                    </div>
                </div>
            </div>

            {/* Installation Rate Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-5">
                    <h4 className="font-semibold text-blue-800 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        Panels per Day
                    </h4>
                    <div className="flex items-center">
                        <input
                            type="number"
                            min="1"
                            value={panelsPerDay}
                            onChange={(e) => handleInputChange('panels', e.target.value)}
                            className="w-20 px-3 py-2 border border-blue-300 rounded-lg text-center font-bold text-blue-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <span className="ml-2 text-blue-700 font-medium">panels/day</span>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-5">
                    <h4 className="font-semibold text-green-800 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m5-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                        Doors per Day
                    </h4>
                    <div className="flex items-center">
                        <input
                            type="number"
                            min="1"
                            value={doorsPerDay}
                            onChange={(e) => handleInputChange('doors', e.target.value)}
                            className="w-20 px-3 py-2 border border-green-300 rounded-lg text-center font-bold text-green-900 focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        />
                        <span className="ml-2 text-green-700 font-medium">doors/day</span>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-5">
                    <h4 className="font-semibold text-purple-800 mb-3 flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        Slabs per Day
                    </h4>
                    <div className="flex items-center">
                        <input
                            type="number"
                            min="1"
                            value={slabsPerDay}
                            onChange={(e) => handleInputChange('slabs', e.target.value)}
                            className="w-20 px-3 py-2 border border-purple-300 rounded-lg text-center font-bold text-purple-900 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                        <span className="ml-2 text-purple-700 font-medium">slabs/day</span>
                    </div>
                </div>
            </div>

            {/* Material Quantities Summary */}
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
                <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Project Material Quantities
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-3xl font-bold text-blue-600">{totalQuantities.panels}</div>
                            <div className="text-sm text-gray-600">Total Panels</div>
                                                         <div className="text-xs text-gray-500 mt-1">
                                 {ceilingPlans.length > 0 && `${ceilingPlans.reduce((sum, plan) => sum + (plan.total_panels || 0), 0)} ceiling`}
                                 {floorPlans.length > 0 && ceilingPlans.length > 0 && ' + '}
                                 {floorPlans.length > 0 && `${floorPlans.reduce((sum, plan) => sum + (plan.total_panels || 0), 0)} floor`}
                                 {walls.length > 0 && (ceilingPlans.length > 0 || floorPlans.length > 0) && ' + '}
                                 {walls.length > 0 && `${calculateWallPanels(walls)} wall`}
                             </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-3xl font-bold text-green-600">{totalQuantities.doors}</div>
                            <div className="text-sm text-gray-600">Total Doors</div>
                            <div className="text-xs text-gray-500 mt-1">From project data</div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-3xl font-bold text-purple-600">{totalQuantities.slabs}</div>
                            <div className="text-sm text-gray-600">Total Slabs</div>
                            <div className="text-xs text-gray-500 mt-1">From rooms with slab floors (1210×3000mm)</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Detailed Panel Breakdown */}
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
                <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Panel Breakdown
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600">
                                {ceilingPlans.reduce((total, plan) => total + (plan.total_panels || 0), 0)}
                            </div>
                            <div className="text-sm text-gray-600">Ceiling Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                {ceilingPlans.length > 0 ? `${ceilingPlans.length} plans` : 'No plans'}
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-green-600">
                                {floorPlans.reduce((total, plan) => total + (plan.total_panels || 0), 0)}
                            </div>
                            <div className="text-sm text-gray-600">Floor Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                {floorPlans.length > 0 ? `${floorPlans.length} plans` : 'No plans'}
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-purple-600">
                                {calculateWallPanels(walls)}
                            </div>
                            <div className="text-sm text-gray-600">Wall Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                {walls.length > 0 ? `${walls.length} walls` : 'No walls'}
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-indigo-600">
                                {totalQuantities.panels}
                            </div>
                            <div className="text-sm text-gray-600">Total Panels</div>
                            <div className="text-xs text-gray-500 mt-1">
                                Combined count
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Installation Time Estimates */}
            <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-6">
                <h4 className="font-semibold text-indigo-800 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Estimated Installation Time
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg p-4 border border-indigo-200 text-center">
                        <div className="text-3xl font-bold text-indigo-600">{installationEstimates.days}</div>
                        <div className="text-sm text-gray-600">Working Days</div>
                        <div className="text-xs text-gray-500 mt-1">Including 20% buffer</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-indigo-200 text-center">
                        <div className="text-3xl font-bold text-indigo-600">{installationEstimates.weeks}</div>
                        <div className="text-sm text-gray-600">Working Weeks</div>
                        <div className="text-xs text-gray-500 mt-1">5 days per week</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-indigo-200 text-center">
                        <div className="text-3xl font-bold text-indigo-600">{installationEstimates.months}</div>
                        <div className="text-sm text-gray-600">Working Months</div>
                        <div className="text-xs text-gray-500 mt-1">22 days per month</div>
                    </div>
                </div>
                
                <div className="mt-4 p-3 bg-indigo-100 rounded-lg">
                    <p className="text-sm text-indigo-800">
                        <strong>Note:</strong> This estimate assumes parallel work where possible and includes a 20% buffer for coordination and unexpected issues. 
                        Actual installation time may vary based on site conditions, crew size, and other factors.
                    </p>
                </div>
            </div>

            {/* Room Details */}
            {rooms.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-6 mt-8">
                    <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                        </svg>
                        Room Details
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-300">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Room Name
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Floor Type
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Floor Thickness
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Height
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Area
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {rooms.map((room, index) => (
                                    <tr key={room.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                            {room.room_name}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_type || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_thickness || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.height ? `${room.height}mm` : 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.room_points && room.room_points.length > 0 
                                                ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                                                : 'N/A'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Export Preview Modal */}
            {showExportPreview && exportData && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-gray-200">
                            <div className="flex justify-between items-center">
                                <h3 className="text-2xl font-bold text-gray-900">Export Preview</h3>
                                <button
                                    onClick={() => setShowExportPreview(false)}
                                    className="text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <p className="text-gray-600 mt-2">Preview of what will be exported to PDF</p>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Project Overview */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-semibold text-gray-800 mb-3">Project Overview</h4>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div><span className="font-medium">Project:</span> {exportData.projectInfo.name}</div>
                                    <div><span className="font-medium">Dimensions:</span> {exportData.projectInfo.dimensions}</div>
                                    <div><span className="font-medium">Rooms:</span> {exportData.projectInfo.rooms}</div>
                                    <div><span className="font-medium">Walls:</span> {exportData.projectInfo.walls}</div>
                                    <div><span className="font-medium">Doors:</span> {exportData.projectInfo.doors}</div>
                                </div>
                            </div>

                            {/* Room Details */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h4 className="font-semibold text-gray-800 mb-3">Room Details ({exportData.rooms?.length || 0})</h4>
                                {exportData.rooms && exportData.rooms.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Name
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Floor Type
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Floor Thickness (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Height (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Area (m²)
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {exportData.rooms.slice(0, 5).map((room, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_name || 'Unnamed Room'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                                room.floor_type === 'slab' || room.floor_type === 'Slab'
                                                                    ? 'bg-yellow-100 text-yellow-800'
                                                    : 'bg-blue-100 text-blue-800'
                                            }`}>
                                                {room.floor_type || 'N/A'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_thickness || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.height || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.room_points && room.room_points.length > 0 
                                                ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                                                : 'N/A'}
                                        </td>
                                    </tr>
                                ))}
                                {exportData.rooms.length > 5 && (
                                    <tr className="hover:bg-gray-50">
                                        <td colSpan="5" className="px-4 py-2 border border-gray-300 text-center text-gray-500">
                                            ... and {exportData.rooms.length - 5} more rooms
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center py-4 text-gray-500">
                        No room data available
                    </div>
                )}
            </div>

                            {/* Auto-Fetch Status */}
                            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                                <h4 className="font-semibold text-green-800 mb-3">🔄 Auto-Fetch Status</h4>
                                <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                                        <span className={`w-3 h-3 rounded-full mr-2 ${sharedPanelData?.wallPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                        <span>Wall Plan</span>
                                    </div>
                                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                                        <span className={`w-3 h-3 rounded-full mr-2 ${sharedPanelData?.ceilingPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                        <span>Ceiling Plan</span>
                                    </div>
                                    <div className="flex items-center justify-center p-2 bg-white rounded border">
                                        <span className={`w-3 h-3 rounded-full mr-2 ${sharedPanelData?.floorPanels ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                                        <span>Floor Plan</span>
                                    </div>
                                </div>
                                
                                <div className="text-sm text-green-700 mb-3">
                                    {sharedPanelData?.wallPanels || sharedPanelData?.ceilingPanels || sharedPanelData?.floorPanels ? 
                                        '✅ Data auto-fetched from existing plans' : 
                                        '⏳ No existing plans found - manual generation required'
                                    }
                                </div>
                                
                                <div className="text-xs text-green-600">
                                    <p className="font-medium mb-1">If tables are empty, make sure to:</p>
                                    <ul className="list-disc list-inside space-y-1">
                                        <li>Calculate wall panels in the Wall Plan tab</li>
                                        <li>Generate ceiling plan in the Ceiling Plan tab</li>
                                        <li>Generate floor plan in the Floor Plan tab</li>
                                    </ul>
                                </div>
                            </div>

                            {/* Wall Panels */}
                            <div className="bg-blue-50 rounded-lg p-4">
                                <h4 className="font-semibold text-blue-800 mb-3">
                                    Wall Panels ({exportData.wallPanels.length})
                                </h4>
                                {exportData.wallPanels.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        No.
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Width (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Length (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Quantity
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Type
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Application
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {exportData.wallPanels.slice(0, 5).map((panel, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-center">{index + 1}</td>
                                                        <td className="px-4 py-2 border border-gray-300 text-center">{panel.width}</td>
                                                        <td className="px-4 py-2 border border-gray-300 text-center">{panel.length}</td>
                                                        <td className="px-4 py-2 border border-gray-300 text-center">{panel.quantity || 1}</td>
                                                        <td className="px-4 py-2 border border-gray-300 text-center">{panel.type || 'N/A'}</td>
                                                        <td className="px-4 py-2 border border-gray-300 text-center">{panel.application || 'N/A'}</td>
                                                    </tr>
                                                ))}
                                                {exportData.wallPanels.length > 5 && (
                                                    <tr className="hover:bg-gray-50">
                                                        <td colSpan="6" className="px-4 py-2 border border-gray-300 text-center text-gray-500">
                                                            ... and {exportData.wallPanels.length - 5} more panels
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        No wall panels found. Calculate wall panels first.
                                    </div>
                                )}
                            </div>

                            {/* Ceiling Panels */}
                            <div className="bg-green-50 rounded-lg p-4">
                                <h4 className="font-semibold text-green-800 mb-3">
                                    Ceiling Panels ({exportData.ceilingPanels.length})
                                </h4>
                                {exportData.ceilingPanels.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Panel Width (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Panel Length (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Thickness (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Quantity
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {exportData.ceilingPanels.slice(0, 5).map((panel, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.width || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.length || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.thickness || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                                            {panel.quantity || 1}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {exportData.ceilingPanels.length > 5 && (
                                                    <tr className="hover:bg-gray-50">
                                                        <td colSpan="4" className="px-4 py-2 border border-gray-300 text-center text-gray-500">
                                                            ... and {exportData.ceilingPanels.length - 5} more panels
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        No ceiling panels found. Generate a ceiling plan first.
                                    </div>
                                )}
                            </div>

                            {/* Floor Panels */}
                            <div className="bg-purple-50 rounded-lg p-4">
                                <h4 className="font-semibold text-purple-800 mb-3">
                                    Floor Panels ({exportData.floorPanels.length})
                                </h4>
                                {exportData.floorPanels.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Panel Width (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Panel Length (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Thickness (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Quantity
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Type
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {exportData.floorPanels.slice(0, 5).map((panel, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.width || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.length || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {panel.thickness || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                                            {panel.quantity || 1}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-center text-gray-900">
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                                panel.type === 'Full' 
                                                                    ? 'bg-green-100 text-green-800' 
                                                                    : 'bg-red-100 text-red-800'
                                                            }`}>
                                                                {panel.type || 'N/A'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {exportData.floorPanels.length > 5 && (
                                                    <tr className="hover:bg-gray-50">
                                                        <td colSpan="5" className="px-4 py-2 border border-gray-300 text-center text-gray-500">
                                                            ... and {exportData.floorPanels.length - 5} more panels
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-gray-500">
                                        No floor panels found. Generate a floor plan first.
                                    </div>
                                )}
                            </div>

                            {/* Slab Panels */}
                            {exportData.slabs.length > 0 && (
                                <div className="bg-yellow-50 rounded-lg p-4">
                                    <h4 className="font-semibold text-yellow-800 mb-3">Slab Floors ({exportData.slabs.length})</h4>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Name
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Room Area (m²)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Slab Size (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Number of Slabs Needed
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {exportData.slabs.slice(0, 5).map((room, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_name}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_points && room.room_points.length > 0 
                                                                ? `${Math.round(calculateRoomArea(room.room_points) / 1000000)} m²` 
                                                                : 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            1210 × 3000
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {room.room_points && room.room_points.length > 0 
                                                                ? Math.ceil(calculateRoomArea(room.room_points) / (1210 * 3000))
                                                                : 'N/A'}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {exportData.slabs.length > 5 && (
                                                    <tr className="hover:bg-gray-50">
                                                        <td colSpan="4" className="px-4 py-2 border border-gray-300 text-center text-gray-500">
                                                            ... and {exportData.slabs.length - 5} more rooms
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Doors List */}
                            {exportData.doors.length > 0 && (
                                <div className="bg-indigo-50 rounded-lg p-4">
                                    <h4 className="font-semibold text-indigo-800 mb-3">
                                        Doors ({exportData.doors.length})
                                    </h4>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full border border-gray-300">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Door Type
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Width (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Height (mm)
                                                    </th>
                                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                                        Thickness (mm)
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {exportData.doors.slice(0, 5).map((door, index) => (
                                                    <tr key={index} className="hover:bg-gray-50">
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.door_type || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.width || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.height || 'N/A'}
                                                        </td>
                                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                                            {door.thickness || 'N/A'}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {exportData.doors.length > 5 && (
                                                    <tr className="hover:bg-gray-50">
                                                        <td colSpan="4" className="px-4 py-2 border border-gray-300 text-center text-gray-500">
                                                            ... and {exportData.doors.length - 5} more doors
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                                        {/* Support Accessories */}
            <div className="bg-orange-50 rounded-lg p-4">
                <h4 className="font-semibold text-orange-800 mb-3">Support Accessories</h4>
                {exportData.supportAccessories.isNeeded ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-300">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Property
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Value
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-900">
                                        Support Type
                                    </td>
                                    <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                                            exportData.supportAccessories.type === 'nylon' 
                                                ? 'bg-blue-100 text-blue-800' 
                                                : 'bg-green-100 text-green-800'
                                        }`}>
                                            {exportData.supportAccessories.type === 'nylon' ? 'Nylon Hanger' : 'Alu Suspension'}
                                        </span>
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-900">
                                        Include Accessories
                                    </td>
                                    <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                        <span className={`px-4 py-1 rounded text-xs font-medium ${
                                            exportData.supportAccessories.includeAccessories 
                                                ? 'bg-green-100 text-green-800' 
                                                : 'bg-red-100 text-red-800'
                                        }`}>
                                            {exportData.supportAccessories.includeAccessories ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-900">
                                        Include Cable
                                    </td>
                                    <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                        <span className={`px-4 py-1 rounded text-xs font-medium ${
                                            exportData.supportAccessories.includeCable 
                                                ? 'bg-green-100 text-green-800' 
                                                : 'bg-red-100 text-red-800'
                                        }`}>
                                            {exportData.supportAccessories.includeCable ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                </tr>
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-900">
                                        Custom Drawing
                                    </td>
                                    <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                        <span className={`px-4 py-1 rounded text-xs font-medium ${
                                            exportData.supportAccessories.customDrawing 
                                                ? 'bg-green-100 text-green-800' 
                                                : 'bg-red-100 text-red-800'
                                        }`}>
                                            {exportData.supportAccessories.customDrawing ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="text-center py-6">
                        <div className="text-lg font-medium text-orange-700 mb-2">Not needed in this project</div>
                        <div className="text-sm text-orange-600">All ceiling panels are under 6000mm length</div>
                        <div className="mt-3 p-3 bg-orange-100 rounded-lg">
                            <div className="text-xs text-orange-800">
                                <strong>Note:</strong> Support accessories are only required when ceiling panels exceed 6000mm in length. 
                                For shorter panels, standard installation methods are sufficient.
                            </div>
                        </div>
                    </div>
                )}
            </div>

                            {/* Installation Estimates */}
                            <div className="bg-indigo-50 rounded-lg p-4">
                                <h4 className="font-semibold text-indigo-800 mb-3">Installation Time Estimates</h4>
                                <div className="grid grid-cols-3 gap-4 text-center">
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200">
                                        <div className="text-2xl font-bold text-indigo-600">{exportData.installationEstimates.days}</div>
                                        <div className="text-sm text-gray-600">Working Days</div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200">
                                        <div className="text-2xl font-bold text-indigo-600">{exportData.installationEstimates.weeks}</div>
                                        <div className="text-sm text-gray-600">Working Weeks</div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200">
                                        <div className="text-2xl font-bold text-indigo-600">{exportData.installationEstimates.months}</div>
                                        <div className="text-sm text-gray-600">Working Months</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-200 bg-gray-50">
                            <div className="flex justify-between items-center">
                                <p className="text-sm text-gray-600">
                                    This preview shows the data that will be exported. PNG images of plans will be included in the final PDF.
                                </p>
                                <div className="flex space-x-3">
                                    <button
                                        onClick={() => setShowExportPreview(false)}
                                        className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={generatePDF}
                                        disabled={isExporting}
                                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center"
                                    >
                                        {isExporting ? (
                                            <>
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                                Generating PDF...
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                                Generate & Download PDF
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default InstallationTimeEstimator;
