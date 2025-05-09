import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/api';
import Canvas2D from './Canvas2D';
import ThreeCanvas3D from "./ThreeCanvas3D";
import RoomManager from './RoomManager';
import DoorManager from './DoorManager';
import DoorEditorModal from './DoorEditorModal';

const ProjectDetails = () => {
    const { projectId } = useParams(); // Fetch project ID from URL
    const [project, setProject] = useState(null);
    const [walls, setWalls] = useState([]);
    const [isEditingMode, setIsEditingMode] = useState(false);
    const [currentMode, setCurrentMode] = useState(null); // "add-wall" or "edit-wall"
    const [selectedWall, setSelectedWall] = useState(null);
    const [is3DView, setIs3DView] = useState(null);
    const [isInteriorView, setIsInteriorView] = useState(false);
    const threeCanvasInstance = useRef(null);
    const [showRoomManager, setShowRoomManager] = useState(false);
    const [selectedWallsForRoom, setSelectedWallsForRoom] = useState([]);
    const [editingRoom, setEditingRoom] = useState(null);
    const [rooms, setRooms] = useState([]); // Initialize rooms
    const [selectedWallType, setSelectedWallType] = useState("wall");
    const [showWallEditor, setShowWallEditor] = useState(false);
    const [showRoomManagerModal, setShowRoomManagerModal] = useState(false);
    const [joints, setJoints] = useState([]);
    const [selectedDoorWall, setSelectedDoorWall] = useState(null);
    const [showDoorManager, setShowDoorManager] = useState(false);
    const [doors, setDoors] = useState([]);
    const [editingDoor, setEditingDoor] = useState(null);
    const [showDoorEditor, setShowDoorEditor] = useState(false);
    const [selectedRoomPoints, setSelectedRoomPoints] = useState([]);


    const handleViewToggle = () => {
        if (!threeCanvasInstance.current) return;
        
        setIsInteriorView(!isInteriorView);
        if (!isInteriorView) {
            threeCanvasInstance.current.animateToInteriorView();
        } else {
            threeCanvasInstance.current.animateToExteriorView();
        }
    };

    const handleCreateDoor = async (doorData) => {
        try {
          // Add default direction values
          const completeDoorData = {
            ...doorData,
            swing_direction: 'right',
            slide_direction: 'right',
            side: 'interior'
          };
          
          const response = await api.post('/doors/create_door/', completeDoorData);
          setDoors([...doors, response.data]);
          setShowDoorManager(false);
          setCurrentMode(null);
        } catch (error) {
          console.error('Error creating door:', error);
        }
      };

      const handleDoorSelect = (door) => {
        setEditingDoor(door);
        setShowDoorEditor(true); // show editor instead of DoorManager
      };

      const handleUpdateDoor = async (updatedDoor) => {
        try {
            const response = await api.put(`/doors/${updatedDoor.id}/`, {
                project: updatedDoor.project,
                wall: updatedDoor.wall,
                width: updatedDoor.width,
                height: updatedDoor.height,
                thickness: updatedDoor.thickness,
                position_x: updatedDoor.position_x,
                position_y: updatedDoor.position_y,
                door_type: updatedDoor.door_type,
                configuration: updatedDoor.configuration,
                swing_direction: updatedDoor.swing_direction,
                slide_direction: updatedDoor.slide_direction,
                side: updatedDoor.side,
              });
      
          const updated = response.data;
          setDoors(doors.map(d => d.id === updated.id ? updated : d));
          setShowDoorEditor(false);
          setEditingDoor(null);
          setSelectedWall(null);
        } catch (error) {
          console.error("Failed to update door:", error);
        }
      };

      const handleCreateRoom = async (roomData) => {
        try {
            const completeRoomData = {
                ...roomData,
                room_points: selectedRoomPoints,
            };
    
            const response = await api.post('/rooms/', completeRoomData);
            if (response.status === 201) {
                const newRoom = response.data;
                setRooms((prevRooms) => [...prevRooms, newRoom]);
    
                alert('Room created successfully!');
                setShowRoomManagerModal(false); // ✅ correct modal visibility
                setSelectedRoomPoints([]);
                setCurrentMode(null);
            }
        } catch (error) {
            console.error('Error creating room:', error);
            alert('Failed to create room.');
        }
    };          

    useEffect(() => {
        const fetchRooms = async () => {
            try {
                const response = await api.get('/rooms/');
                setRooms(Array.isArray(response.data) ? response.data : []);
            } catch (error) {
                console.error('Error fetching rooms:', error);
                setRooms([]); // Set empty array on error
            }
        };

        fetchRooms();
    }, []);

    // Update the handleRoomSelect function
    const handleRoomSelect = (roomId) => {
        const room = rooms.find(r => r.id === roomId);
        if (room) {
            setEditingRoom(room);
            setShowRoomManager(true);
            setSelectedWallsForRoom(room.walls);
            setSelectedRoomPoints(room.room_points || []);  // ✅ ← Set the polygon for editing
        }
    };    

    const handleRoomUpdate = async (updatedRoomData) => {
        try {
            const response = await api.put(`/rooms/${updatedRoomData.id}/`, updatedRoomData);
            setRooms(rooms.map(room => 
                room.id === updatedRoomData.id ? response.data : room
            ));
            setShowRoomManagerModal(false);
            setSelectedRoomPoints([]);
            setCurrentMode(null);
        } catch (error) {
            console.error('Error updating room:', error);
            alert('Failed to update room.');
        }
    };

    const handleRoomDelete = async (roomId) => {
        try {
            await api.delete(`/rooms/${roomId}/`);
            // Update rooms state by removing the deleted room
            setRooms(rooms.filter(room => room.id !== roomId));
            // Reset room-related states
            setShowRoomManagerModal(false);
            setSelectedRoomPoints([]);
            setCurrentMode(null);
        } catch (error) {
            console.error('Error deleting room:', error);
            alert('Failed to delete room.');
        }
    };

    useEffect(() => {
        const fetchProjectDetails = async () => {
            try {
                const projectResponse = await api.get(`/projects/${projectId}/`);
                setProject(projectResponse.data);
    
                const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
                setWalls(wallsResponse.data);

                const doorsResponse = await api.get(`/doors/?project=${projectId}`);
                setDoors(doorsResponse.data);
    
                // Fix the intersection API URL by removing the extra '/api'
                const intersectionsResponse = await api.get(`/intersections/?projectid=${projectId}`);
                setJoints(intersectionsResponse.data); // Update joints state with intersections data
            } catch (error) {
                console.error('Error fetching project details:', error);
            }
        };
    
        fetchProjectDetails();
    }, [projectId]);
    

    useEffect(() => {
        if (is3DView) {
            const threeCanvas = new ThreeCanvas3D('three-canvas-container', walls, joints, doors);
            threeCanvasInstance.current = threeCanvas;

            return () => {
                threeCanvas.renderer.dispose();
                threeCanvasInstance.current = null;
            };
        }
    }, [is3DView, walls]);

    const handleWallSelect = (wallIndex) => {
        setSelectedWall(wallIndex); // Update selectedWall in ProjectDetails
    };    

    const handleWallUpdate = async (updatedWall) => {
        if (!updatedWall?.id) {
            console.error("Error: Wall ID is undefined.");
            return;
        }
    
        try {
            // Step 1: Get the previous wall from state
            const prevWall = walls.find(w => w.id === updatedWall.id);
    
            // Step 2: Update local state immediately
            setWalls((prevWalls) =>
                prevWalls.map((wall) =>
                    wall.id === updatedWall.id ? { ...wall, ...updatedWall } : wall
                )
            );
    
            // Step 3: Send PUT request to backend
            const response = await api.put(`/walls/${updatedWall.id}/`, updatedWall);
            const updatedFromBackend = response.data;
    
            // Step 4: Handle type change cases
            const wasWall = prevWall?.application_type === 'wall';
            const wasPartition = prevWall?.application_type === 'partition';
            const nowWall = updatedFromBackend.application_type === 'wall';
            const nowPartition = updatedFromBackend.application_type === 'partition';
    
            if (wasWall && nowPartition) {
                console.log("Wall type changed from 'wall' to 'partition'. Attempting merge...");
                await checkAndMergeWalls(updatedFromBackend);
            }
    
            if (wasPartition && nowWall) {
                alert("Note: Walls changed from partition to wall do not automatically split other walls. If you want splitting behavior, please delete and re-add the wall.");
            }
    
        } catch (error) {
            console.error("Error updating wall:", error);
        }
    };
    
    
    // Updated helper function to check collinearity for any orientation
    const areCollinearWalls = (wall1, wall2) => {
        // Vector approach for collinearity check
        const vector1 = {
        x: wall1.end_x - wall1.start_x,
        y: wall1.end_y - wall1.start_y
        };
        
        const vector2 = {
        x: wall2.end_x - wall2.start_x,
        y: wall2.end_y - wall2.start_y
        };
    
        // Check if vectors are parallel using cross product
        const crossProduct = vector1.x * vector2.y - vector1.y * vector2.x;
        if (Math.abs(crossProduct) > 0.001) return false;
    
        // Check if a point from wall2 lies on wall1's line
        const dx = wall2.start_x - wall1.start_x;
        const dy = wall2.start_y - wall1.start_y;
        const crossPointCheck = dx * vector1.y - dy * vector1.x;
        return Math.abs(crossPointCheck) < 0.001;
    };
    
    const calculateIntersection = (wall1Start, wall1End, wall2Start, wall2End) => {
        const denominator = ((wall2End.y - wall2Start.y) * (wall1End.x - wall1Start.x)) -
                            ((wall2End.x - wall2Start.x) * (wall1End.y - wall1Start.y));
        if (denominator === 0) return null;
    
        const ua = (((wall2End.x - wall2Start.x) * (wall1Start.y - wall2Start.y)) -
                   ((wall2End.y - wall2Start.y) * (wall1Start.x - wall2Start.x))) / denominator;
        const ub = (((wall1End.x - wall1Start.x) * (wall1Start.y - wall2Start.y)) -
                   ((wall1End.y - wall1Start.y) * (wall1Start.x - wall2Start.x))) / denominator;
    
        if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
            return {
                x: wall1Start.x + (ua * (wall1End.x - wall1Start.x)),
                y: wall1Start.y + (ua * (wall1End.y - wall1Start.y))
            };
        }
        return null;
    };
    
    const arePointsEqual = (p1, p2, epsilon = 0.001) => {
        return Math.abs(p1.x - p2.x) < epsilon && Math.abs(p1.y - p2.y) < epsilon;
    };

    const handleManualWallMerge = async (selectedWallIds) => {
        const wall1 = walls.find(w => w.id === selectedWallIds[0]);
        const wall2 = walls.find(w => w.id === selectedWallIds[1]);

        if (!wall1 || !wall2) {
            alert("Invalid wall selection.");
            return;
        }

        if (
            wall1.application_type !== wall2.application_type ||
            wall1.height !== wall2.height ||
            wall1.thickness !== wall2.thickness
        ) {
            alert("Walls must have the same type, height, and thickness.");
            return;
        }

        const connected =
            (wall1.start_x === wall2.end_x && wall1.start_y === wall2.end_y) ||
            (wall1.end_x === wall2.start_x && wall1.end_y === wall2.start_y) ||
            (wall1.start_x === wall2.start_x && wall1.start_y === wall2.start_y) ||
            (wall1.end_x === wall2.end_x && wall1.end_y === wall2.end_y);

        if (!connected) {
            alert("Walls must be connected at one endpoint.");
            return;
        }

        try {
            const response = await api.post("/walls/merge_walls/", {
                wall_ids: [wall1.id, wall2.id],
            });

            if (response.status === 201) {
                const newWall = response.data;
                setWalls(prev => [
                    ...prev.filter(w => w.id !== wall1.id && w.id !== wall2.id),
                    newWall,
                ]);
                setSelectedWallsForRoom([]);
                alert("Walls merged successfully.");
            }
        } catch (error) {
            console.error("Merge failed:", error);
            alert("Wall merge failed.");
        }
    };

    // Updated wall merging logic
    const checkAndMergeWalls = async (updatedWall) => {
        const adjacentWalls = walls.filter((wall) =>
            (wall.end_x === updatedWall.start_x && wall.end_y === updatedWall.start_y) ||
            (wall.start_x === updatedWall.end_x && wall.start_y === updatedWall.end_y)
        );

        adjacentWalls.forEach(async (neighborWall) => {
            if (
                neighborWall.application_type === updatedWall.application_type &&
                neighborWall.height === updatedWall.height &&
                neighborWall.thickness === updatedWall.thickness &&
                areCollinearWalls(neighborWall, updatedWall)
            ) {
                // Determine merged line coordinates
                let mergedStart, mergedEnd;
                if (updatedWall.end_x === neighborWall.start_x && updatedWall.end_y === neighborWall.start_y) {
                    mergedStart = { x: updatedWall.start_x, y: updatedWall.start_y };
                    mergedEnd = { x: neighborWall.end_x, y: neighborWall.end_y };
                } else if (updatedWall.start_x === neighborWall.end_x && updatedWall.start_y === neighborWall.end_y) {
                    mergedStart = { x: neighborWall.start_x, y: neighborWall.start_y };
                    mergedEnd = { x: updatedWall.end_x, y: updatedWall.end_y };
                } else {
                    return; // Not adjacent
                }

                // Check for intersections with other walls
                let hasMidIntersection = false;
                walls.forEach((otherWall) => {
                    if (otherWall.id === updatedWall.id || otherWall.id === neighborWall.id) return;

                    const intersection = calculateIntersection(
                        mergedStart,
                        mergedEnd,
                        { x: otherWall.start_x, y: otherWall.start_y },
                        { x: otherWall.end_x, y: otherWall.end_y }
                    );

                    if (intersection) {
                        const isStart = arePointsEqual(intersection, mergedStart);
                        const isEnd = arePointsEqual(intersection, mergedEnd);
                        if (!isStart && !isEnd) {
                            hasMidIntersection = true;
                        }
                    }
                });

                if (hasMidIntersection) {
                    console.log('Cannot merge: Intersection detected');
                    return;
                }

                // Proceed with merging
                try {
                    const mergeResponse = await api.post("/walls/merge_walls/", {
                        wall_ids: [neighborWall.id, updatedWall.id],
                    });

                    if (mergeResponse.status === 201) {
                        setWalls((prevWalls) =>
                            prevWalls.filter(w => w.id !== neighborWall.id && w.id !== updatedWall.id)
                                .concat(mergeResponse.data)
                        );
                    }
                } catch (error) {
                    console.error("Error merging walls:", error);
                }
            }
        });
    };
    
    const handleWallCreate = async (wallData) => {
        try {
            // Include the project ID in the wall data
            const dataToSend = { ...wallData, project: project.id };
            const response = await api.post('/walls/create_wall/', dataToSend);
            return response.data; // Return the created wall data
        } catch (error) {
            console.error('Error creating wall:', error);
            throw error;
        }
    };

    const handleWallRemove = async () => {
        if (selectedWall !== null) {
            const wallToRemove = walls[selectedWall];
            console.log('Removing wall:', wallToRemove);
    
            try {
                const startPoint = `${wallToRemove.start_x},${wallToRemove.start_y}`;
                const endPoint = `${wallToRemove.end_x},${wallToRemove.end_y}`;
    
                const wallsByPoint = {};
                walls.forEach(wall => {
                    if (wall.id === wallToRemove.id) return;
    
                    [`${wall.start_x},${wall.start_y}`, `${wall.end_x},${wall.end_y}`].forEach(point => {
                        if (!wallsByPoint[point]) wallsByPoint[point] = [];
                        wallsByPoint[point].push(wall);
                    });
                });
    
                const mergeCandidates = [];
                [startPoint, endPoint].forEach(point => {
                    if (wallsByPoint[point]?.length === 2) {
                        const [wall1, wall2] = wallsByPoint[point];
    
                        // Check if walls have identical properties
                        if (
                            wall1.application_type !== wall2.application_type ||
                            wall1.height !== wall2.height ||
                            wall1.thickness !== wall2.thickness
                        ) {
                            console.log('Skipping merge: Walls have different properties');
                            return; // Skip merging if properties don't match
                        }
    
                        const isCollinear = Math.abs(
                            (wall1.end_y - wall1.start_y) * (wall2.end_x - wall2.start_x) -
                            (wall2.end_y - wall2.start_y) * (wall1.end_x - wall1.start_x)
                        ) < 0.0001;
    
                        if (isCollinear) {
                            mergeCandidates.push([wall1, wall2, point]);
                        }
                    }
                });
    
                await api.delete(`/walls/${wallToRemove.id}/`);
    
                let updatedWalls = walls.filter((_, index) => index !== selectedWall);
    
                for (const [wall1, wall2, point] of mergeCandidates) {
                    console.log('Merging walls at point:', point);
    
                    await api.delete(`/walls/${wall1.id}/`);
                    await api.delete(`/walls/${wall2.id}/`);
    
                    updatedWalls = updatedWalls.filter(w => 
                        w.id !== wall1.id && w.id !== wall2.id
                    );
    
                    const [pointX, pointY] = point.split(',').map(Number);
                    const end1 = wall1.start_x === pointX && wall1.start_y === pointY ?
                        { x: wall1.end_x, y: wall1.end_y } :
                        { x: wall1.start_x, y: wall1.start_y };
                    const end2 = wall2.start_x === pointX && wall2.start_y === pointY ?
                        { x: wall2.end_x, y: wall2.end_y } :
                        { x: wall2.start_x, y: wall2.start_y };
    
                    const mergedWall = {
                        start_x: end1.x,
                        start_y: end1.y,
                        end_x: end2.x,
                        end_y: end2.y,
                        height: wall1.height, // Since we know they're identical now
                        thickness: wall1.thickness, // Since we know they're identical now
                        project: projectId,
                        application_type: wall1.application_type,
                    };
    
                    const response = await api.post('/walls/create_wall/', mergedWall);
                    updatedWalls.push(response.data);
                }
    
                setWalls(updatedWalls);
                setSelectedWall(null);
    
            } catch (error) { 
                console.error('Error handling wall removal:', error);
            }
        }
    };
    
    const handleWallDelete = async (wallId) => {
        try {
            await api.delete(`/walls/${wallId}/`);
        } catch (error) {
            console.error('Error deleting wall:', error);
            throw error;
        }
    };

    const resetAllSelections = () => {
        setSelectedWall(null);
        setSelectedWallsForRoom([]);
        setShowRoomManager(false);
    };

    const toggleMode = (mode) => {
        console.log(`Current Mode (before toggle): ${currentMode}`);
    
        // If the mode is already active, disable it
        if (currentMode === mode) {
            console.log(`Exiting ${mode} mode.`);
    
            // Reset selections based on the mode we're exiting
            if (mode === 'define-room') {
                setShowRoomManagerModal(false);
                setSelectedRoomPoints([]);  // Reset polygon points when entering define-room
            } else if (mode === 'edit-wall') {
                setSelectedWall(null);
            } else if (mode === 'merge-wall') {
                setSelectedWallsForRoom([]); // Clear wall selection
            }
    
            setCurrentMode(null);
            return;
        }
    
        console.log(`Entering ${mode} mode.`);
    
        // Reset previous selections before switching modes
        resetAllSelections();
    
        // Handle special cases
        if (mode === 'define-room') {
            setShowRoomManagerModal(true);  // Changed from setShowRoomManager
        } else {
            setShowRoomManager(false); // Ensure RoomManager is hidden if switching to another mode
        }
    
        // Set new mode
        setCurrentMode(mode);
    };    

    if (!project) {
        return <div>Loading...</div>;
    }

    return (
        <div className="max-w-7xl mx-auto p-6">
            {/* Header Section */}
            <div className="mb-8 bg-white rounded-lg shadow-sm p-6">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{project.name}</h1>
                <p className="text-gray-600">
                    Dimensions: {project.width} x {project.length} x {project.height} mm
                </p>
            </div>

            {/* Control Panel */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                {/* Primary Controls */}
                <div className="flex flex-wrap gap-3 mb-4">
                    <button
                        onClick={() => setIs3DView(!is3DView)}
                        className={`px-4 py-2 rounded-lg transition-colors ${
                            is3DView ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                    >
                        {is3DView ? 'Switch to 2D View' : 'Switch to 3D View'}
                    </button>

                    {is3DView && (
                        <button
                            onClick={handleViewToggle}
                            className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                        >
                            {isInteriorView ? 'View Exterior' : 'View Interior'}
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (!is3DView) {  // ✅ Prevent editing in 3D mode
                                setIsEditingMode(!isEditingMode);
                                setCurrentMode(null);
                                resetAllSelections();
                            }
                        }}
                        disabled={is3DView}  // ✅ Disable button when in 3D mode
                        className={`px-4 py-2 rounded-lg transition-colors ${
                            isEditingMode ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 hover:bg-gray-200'
                        } ${is3DView ? 'opacity-50 cursor-not-allowed' : ''}`}  // ✅ Style it as disabled
                    >
                        {isEditingMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                    </button>
                </div>

                {/* Editing Mode Controls */}
                {isEditingMode && !is3DView && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => toggleMode('add-wall')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    currentMode === 'add-wall'
                                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                                        : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {currentMode === 'add-wall' ? 'Exit Add Wall Mode' : 'Add Wall'}
                            </button>

                            <button
                            onClick={() => {
                                if (selectedWall !== null) {
                                setShowWallEditor(true);
                                }
                                toggleMode('edit-wall');
                            }}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    currentMode === 'edit-wall'
                                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                                        : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {currentMode === 'edit-wall' ? 'Exit Edit Wall Mode' : 'Edit Wall'}
                            </button>

                            <button
                            onClick={() => toggleMode('merge-wall')}
                            className={`px-4 py-2 rounded-lg transition-colors ${
                                currentMode === 'merge-wall'
                                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                                    : 'border border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            {currentMode === 'merge-wall' ? 'Exit Merge Mode' : 'Merge Walls'}
                        </button>

                        {currentMode === 'merge-wall' && (
                            <button
                                onClick={() => {
                                    if (selectedWallsForRoom.length === 2) {
                                    handleManualWallMerge(selectedWallsForRoom);
                                    } else {
                                    alert("Please select exactly 2 walls to merge.");
                                    }
                                }}
                            className="px-4 py-2 rounded-lg transition-colors border border-gray-200 hover:bg-gray-50"
                            >
                                Confirm Merge
                            </button>
                        )}

                            <button
                                onClick={() => toggleMode('define-room')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    currentMode === 'define-room'
                                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                                        : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {currentMode === 'define-room' ? 'Exit Define Room Mode' : 'Define Room'}
                            </button>

                            <button
                                onClick={() => toggleMode('add-door')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                currentMode === 'add-door'
                                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                                    : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {currentMode === 'add-door' ? 'Exit Add Door' : 'Add Door'}
                            </button>
                            <button
                                onClick={() => toggleMode('edit-door')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    currentMode === 'edit-door'
                                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                                    : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                                >
                                {currentMode === 'edit-door' ? 'Exit Edit Door' : 'Edit Door'}
                            </button>
                        </div>

                        {/* Wall Type Selection */}
                        {currentMode === 'add-wall' && (
                            <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                                <label className="font-medium text-gray-700">Wall Type:</label>
                                <select 
                                    value={selectedWallType} 
                                    onChange={(e) => setSelectedWallType(e.target.value)}
                                    className="px-3 py-2 rounded-lg border border-gray-200 
                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="wall">Wall</option>
                                    <option value="partition">Partition</option>
                                </select>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="max-w-7xl mx-auto p-6 relative">
                {/* Wall Editor Modal */}
                    {selectedWall !== null && currentMode === 'edit-wall' && (
                        <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
                            <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl w-full">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-semibold">Wall Properties</h3>
                                    <button 
                                        onClick={() => {
                                            setSelectedWall(null);
                                            setCurrentMode(null);
                                        }}
                                        className="text-gray-500 hover:text-gray-700"
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">Start X:</span>
                                                <input
                                                    type="number"
                                                    value={walls[selectedWall]?.start_x || ''}
                                                    onChange={(e) => handleWallUpdate({ ...walls[selectedWall], id: walls[selectedWall].id, start_x: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">Start Y:</span>
                                                <input
                                                    type="number"
                                                    value={walls[selectedWall]?.start_y || ''}
                                                    onChange={(e) => handleWallUpdate({ ...walls[selectedWall], id: walls[selectedWall].id, start_y: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">End X:</span>
                                                <input
                                                    type="number"
                                                    value={walls[selectedWall]?.end_x || ''}
                                                    onChange={(e) => handleWallUpdate({ ...walls[selectedWall], id: walls[selectedWall].id, end_x: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">End Y:</span>
                                                <input
                                                    type="number"
                                                    value={walls[selectedWall]?.end_y || ''}
                                                    onChange={(e) => handleWallUpdate({ ...walls[selectedWall], id: walls[selectedWall].id, end_y: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">Wall Height (mm):</span>
                                                <input 
                                                    type="number" 
                                                    value={walls[selectedWall]?.height || ''} 
                                                    onChange={(e) => handleWallUpdate({ ...walls[selectedWall], id: walls[selectedWall].id, height: parseFloat(e.target.value) })} 
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">Wall Thickness (mm):</span>
                                                <input 
                                                    type="number" 
                                                    value={walls[selectedWall]?.thickness || ''} 
                                                    onChange={(e) => handleWallUpdate({ ...walls[selectedWall], id: walls[selectedWall].id, thickness: parseFloat(e.target.value) })} 
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">Wall Type:</span>
                                                <select 
                                                    value={walls[selectedWall]?.application_type || 'wall'} 
                                                    onChange={(e) => handleWallUpdate({ ...walls[selectedWall], id: walls[selectedWall].id, application_type: e.target.value })} 
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                >
                                                    <option value="wall">Wall</option>
                                                    <option value="partition">Partition</option>
                                                </select>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Action Buttons at the Bottom Right */}
                                    <div className="mt-6 flex justify-end space-x-3">
                                        <button
                                            onClick={() => {
                                                // You can add any additional save logic here if needed
                                                setSelectedWall(null);
                                            }}
                                            className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 
                                                transition-colors"
                                        >
                                            Save
                                        </button>
                                        
                                        <button
                                            onClick={() => {
                                                handleWallRemove(selectedWall);
                                                setSelectedWall(null);
                                            }}
                                            className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 
                                                transition-colors"
                                        >
                                            Remove Wall
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
            </div>

             {/* Room Manager Modal */}
                {showRoomManagerModal && !is3DView && (
                    <RoomManager
                        projectId={projectId}
                        walls={walls}
                        onSaveRoom={handleCreateRoom}
                        onUpdateRoom={handleRoomUpdate}
                        onDeleteRoom={handleRoomDelete}
                        selectedWallIds={selectedWallsForRoom}
                        editingRoom={editingRoom}
                        isEditMode={!!editingRoom}
                        onClose={() => {
                            setShowRoomManagerModal(false);
                            setEditingRoom(null);
                            setSelectedWallsForRoom([]);
                        }}
                        selectedPolygonPoints={selectedRoomPoints}
                    />
                )}

                {/* Door Manager Modal */}
                {showDoorManager && (
                    <DoorManager
                        projectId={projectId}
                        wall={selectedDoorWall}
                        editingDoor={editingDoor}
                        onSaveDoor={editingDoor ? handleUpdateDoor : handleCreateDoor}
                        onClose={() => {
                        setShowDoorManager(false);
                        setEditingDoor(null);
                        }}
                    />
                    )}

                 {/* Door Editor Modal */}
                {showDoorEditor && editingDoor && (
                    <DoorEditorModal
                        door={editingDoor}
                        onUpdate={handleUpdateDoor}
                        onDelete={async (doorId) => {
                        await api.delete(`/doors/${doorId}/`);
                        setDoors(doors.filter(d => d.id !== doorId));
                        setShowDoorEditor(false);
                        setEditingDoor(null);
                        }}
                        onClose={() => {
                        setShowDoorEditor(false);
                        setEditingDoor(null);
                        }}
                    />
                )}

            {/* Visualization Area */}
            <div className="bg-white rounded-lg shadow-sm p-6">
                {is3DView ? (
                    <div id="three-canvas-container" className="w-full h-[600px] bg-gray-50 rounded-lg" />
                ) : (
                    <>
                        <h2 className="text-xl font-semibold mb-4">2D Visualization</h2>
                        <Canvas2D
                            walls={walls}
                            setWalls={setWalls}
                            joints={joints}
                            projectId={projectId}
                            onWallTypeSelect={selectedWallType}
                            onWallUpdate={handleWallUpdate}
                            onNewWall={handleWallCreate}
                            onWallDelete={handleWallDelete}
                            isEditingMode={isEditingMode}
                            currentMode={currentMode}
                            onWallSelect={handleWallSelect}
                            selectedWallsForRoom={selectedWallsForRoom}
                            onRoomWallsSelect={setSelectedWallsForRoom}
                            rooms={rooms}
                            onRoomSelect={handleRoomSelect}
                            onJointsUpdate={(updatedJoints) => setJoints(updatedJoints)}
                            doors={doors}
                            onDoorSelect={handleDoorSelect}
                            onDoorWallSelect={(wall) => {
                                setSelectedDoorWall(wall);
                                setShowDoorManager(true);
                            }}
                            project = {project}
                            selectedRoomPoints={selectedRoomPoints}
                            onUpdateRoomPoints={setSelectedRoomPoints}
                        
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export default ProjectDetails;