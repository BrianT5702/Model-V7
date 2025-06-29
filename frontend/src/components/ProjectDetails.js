import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/api';
import Canvas2D from './Canvas2D';
import ThreeCanvas3D from "./ThreeCanvas3D";
import RoomManager from './RoomManager';
import DoorManager from './DoorManager';
import DoorEditorModal from './DoorEditorModal';
import { FaPencilAlt } from 'react-icons/fa';

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
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [wallMergeError, setWallMergeError] = useState('');
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [showWallDeleteConfirm, setShowWallDeleteConfirm] = useState(false);
    const [wallToDelete, setWallToDelete] = useState(null);
    const [wallDeleteSuccess, setWallDeleteSuccess] = useState(false);
    const [wallDeleteError, setWallDeleteError] = useState('');
    const [roomCreateSuccess, setRoomCreateSuccess] = useState(false);
    const [wallMergeSuccess, setWallMergeSuccess] = useState(false);
    const [roomError, setRoomError] = useState('');
    const [projectLoadError, setProjectLoadError] = useState('');

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
            throw error;
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
    
                setRoomCreateSuccess(true);
                setTimeout(() => setRoomCreateSuccess(false), 3000);
                setShowRoomManagerModal(false); // ✅ correct modal visibility
                setSelectedRoomPoints([]);
                setCurrentMode(null);
            }
        } catch (error) {
            console.error('Error creating room:', error);
            if (isDatabaseConnectionError(error)) {
                setRoomError('Fail to connect to database. Try again later.');
            } else {
                setRoomError('Failed to create room.');
            }
            setTimeout(() => setRoomError(''), 5000);
        }
    };          

    useEffect(() => {
        const fetchRooms = async () => {
            try {
                const response = await api.get(`/rooms/?project=${projectId}`);
                setRooms(Array.isArray(response.data) ? response.data : []);
            } catch (error) {
                console.error('Error fetching rooms:', error);
                setRooms([]); // Set empty array on error
            }
        };

        fetchRooms();
    }, [projectId]);

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

    const isDatabaseConnectionError = (error) => {
        return (
            error.code === 'ERR_NETWORK' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.message?.includes('Network Error') ||
            error.message?.includes('Failed to fetch') ||
            error.message?.includes('Connection refused') ||
            error.message?.includes('getaddrinfo ENOTFOUND') ||
            (error.response?.status >= 500 && error.response?.status < 600)
        );
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
            if (isDatabaseConnectionError(error)) {
                setRoomError('Fail to connect to database. Try again later.');
            } else {
                setRoomError('Failed to update room.');
            }
            setTimeout(() => setRoomError(''), 5000);
        }
    };

    const handleRoomDelete = async (roomId) => {
        try {
            await api.delete(`/rooms/${roomId}/`);
            setRooms(rooms.filter(room => room.id !== roomId));
            setShowRoomManagerModal(false);
            setSelectedRoomPoints([]);
            setCurrentMode(null);
        } catch (error) {
            console.error('Error deleting room:', error);
            if (isDatabaseConnectionError(error)) {
                setRoomError('Fail to connect to database. Try again later.');
            } else {
                setRoomError('Failed to delete room.');
            }
            setTimeout(() => setRoomError(''), 5000);
        }
    };

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
            setProjectLoadError(''); // clear error if successful
        } catch (error) {
            console.error('Error fetching project details:', error);
            if (isDatabaseConnectionError(error)) {
                setProjectLoadError('Fail to connect to database. Try again later.');
            } else {
                setProjectLoadError('Failed to load project. Please try again.');
            }
        }
    };

    useEffect(() => {
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
        try {
            // Validate that wall dimensions are greater than 0
            if (updatedWall.height <= 0 || updatedWall.thickness <= 0) {
                alert("Wall Height and Thickness must be greater than 0");
                return;
            }

            const response = await api.put(`/walls/${updatedWall.id}/`, updatedWall);
            const updatedWallData = response.data;
            
            setWalls(prevWalls => 
                prevWalls.map(wall => 
                    wall.id === updatedWallData.id ? updatedWallData : wall
                )
            );
            
            // Check for potential wall merges after update
            await checkAndMergeWalls(updatedWallData);
            
        } catch (error) {
            if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error') || (error.response?.status >= 500 && error.response?.status < 600)) {
                setDbConnectionError(true);
                setTimeout(() => setDbConnectionError(false), 5000);
            } else {
                alert('Failed to update wall');
            }
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
            setWallMergeError("Invalid wall selection.");
            setTimeout(() => setWallMergeError(''), 5000);
            return;
        }

        if (
            wall1.application_type !== wall2.application_type ||
            wall1.height !== wall2.height ||
            wall1.thickness !== wall2.thickness
        ) {
            setWallMergeError("Walls must have the same type, height, and thickness.");
            setTimeout(() => setWallMergeError(''), 5000);
            return;
        }

        const connected =
            (wall1.start_x === wall2.end_x && wall1.start_y === wall2.end_y) ||
            (wall1.end_x === wall2.start_x && wall1.end_y === wall2.start_y) ||
            (wall1.start_x === wall2.start_x && wall1.start_y === wall2.start_y) ||
            (wall1.end_x === wall2.end_x && wall1.end_y === wall2.end_y);

        if (!connected) {
            setWallMergeError("Walls must be connected at one endpoint.");
            setTimeout(() => setWallMergeError(''), 5000);
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
                setWallMergeSuccess(true);
                setTimeout(() => setWallMergeSuccess(false), 3000);
            }
        } catch (error) {
            if (error.response && error.response.data) {
                const errorData = error.response.data;
                if (errorData.wall_ids) {
                    setWallMergeError(`Merge Error: ${errorData.wall_ids[0]}`);
                } else if (errorData.non_field_errors) {
                    setWallMergeError(`Merge Error: ${errorData.non_field_errors[0]}`);
                } else if (errorData.error) {
                    setWallMergeError(`Merge Error: ${errorData.error}`);
                } else if (typeof errorData === 'string') {
                    setWallMergeError(`Merge Error: ${errorData}`);
                } else {
                    setWallMergeError('Unable to merge walls. The walls may not be compatible for merging.');
                }
            } else if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
                setWallMergeError('Network error. Please check your connection and try again.');
            } else {
                setWallMergeError('Failed to merge walls. Please try again.');
            }
            setTimeout(() => setWallMergeError(''), 5000);
        }
    };

    // Updated wall merging logic to use backend merge logic
    const checkAndMergeWalls = async (updatedWall) => {
        const adjacentWalls = walls.filter((wall) =>
            (wall.end_x === updatedWall.start_x && wall.end_y === updatedWall.start_y) ||
            (wall.start_x === updatedWall.end_x && wall.start_y === updatedWall.end_y)
        );

        for (const neighborWall of adjacentWalls) {
            if (
                neighborWall.application_type === updatedWall.application_type &&
                neighborWall.height === updatedWall.height &&
                neighborWall.thickness === updatedWall.thickness &&
                areCollinearWalls(neighborWall, updatedWall)
            ) {
                try {
                    const mergeResponse = await api.post("/walls/merge_walls/", {
                        wall_ids: [neighborWall.id, updatedWall.id],
                    });

                    if (mergeResponse.status === 201) {
                        setWalls((prevWalls) =>
                            prevWalls.filter(w => w.id !== neighborWall.id && w.id !== updatedWall.id)
                                .concat(mergeResponse.data)
                        );
                        // After successful merge, check if the new wall can be merged with other walls
                        await checkAndMergeWalls(mergeResponse.data);
                    }
                } catch (error) {
                    // Handle automatic merge errors with user-friendly messages
                    if (error.response && error.response.data) {
                        const errorData = error.response.data;
                        
                        // Check for specific backend validation errors
                        if (errorData.wall_ids) {
                            console.warn(`Auto-merge failed: ${errorData.wall_ids[0]}`);
                        } else if (errorData.non_field_errors) {
                            console.warn(`Auto-merge failed: ${errorData.non_field_errors[0]}`);
                        } else if (errorData.error) {
                            console.warn(`Auto-merge failed: ${errorData.error}`);
                        } else if (typeof errorData === 'string') {
                            console.warn(`Auto-merge failed: ${errorData}`);
                        } else {
                            console.warn('Auto-merge failed: Walls may not be compatible for merging.');
                        }
                    } else if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
                        console.warn('Network error during auto-merge. Please check your connection.');
                    } else {
                        console.warn('Auto-merge failed. Please try again.');
                    }
                }
            }
        }
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

    const handleWallRemove = async (wallId) => {
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

    const handleNameEdit = () => {
        setEditedName(project.name);
        setIsEditingName(true);
    };

    const handleNameSave = async () => {
        try {
            const response = await api.put(`/projects/${projectId}/`, {
                ...project,
                name: editedName
            });
            setProject(response.data);
            setIsEditingName(false);
        } catch (error) {
            console.error('Error updating project name:', error);
            // Show backend error message if present, but do not exit editing mode
            if (error.response && error.response.data && error.response.data.name) {
                alert(`Error: ${error.response.data.name[0]}`);
            } else if (error.response && error.response.data && error.response.data.error) {
                alert(`Error: ${error.response.data.error}`);
            } else {
                alert('Failed to update project name');
            }
            // Do not call setIsEditingName(false) here, so the user can continue editing
        }
    };

    const handleNameCancel = () => {
        setIsEditingName(false);
        setEditedName('');
    };

    const handleConfirmWallDelete = async () => {
        if (wallToDelete === null) return;
        try {
            await handleWallRemove(wallToDelete);
            setWallDeleteSuccess(true);
            setTimeout(() => setWallDeleteSuccess(false), 3000);
            setSelectedWall(null);
        } catch (error) {
            setWallDeleteError('Failed to delete wall. Please try again.');
            setTimeout(() => setWallDeleteError(''), 5000);
        } finally {
            setShowWallDeleteConfirm(false);
            setWallToDelete(null);
        }
    };

    const handleCancelWallDelete = () => {
        setShowWallDeleteConfirm(false);
        setWallToDelete(null);
    };

    if (projectLoadError) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
                <div className="bg-white p-8 rounded-lg shadow-md flex flex-col items-center">
                    <svg className="w-12 h-12 text-red-500 mb-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <h2 className="text-xl font-semibold text-red-600 mb-2">{projectLoadError}</h2>
                    <button
                        onClick={fetchProjectDetails}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!project) {
        return <div>Loading...</div>;
    }

    return (
        <div className="max-w-7xl mx-auto p-6">
            {/* Header Section */}
            <div className="mb-8 bg-white rounded-lg shadow-sm p-6">
                <div className="mb-4 flex items-center">
                    {isEditingName ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={editedName}
                                onChange={(e) => setEditedName(e.target.value)}
                                className="border rounded px-2 py-1"
                                autoFocus
                            />
                            <button
                                onClick={handleNameSave}
                                className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                            >
                                Save
                            </button>
                            <button
                                onClick={handleNameCancel}
                                className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <h1 className="text-3xl font-bold text-gray-900 mb-2">{project.name}</h1>
                            <button
                                onClick={handleNameEdit}
                                className="text-gray-600 hover:text-gray-800"
                            >
                                <FaPencilAlt />
                            </button>
                        </div>
                    )}
                </div>
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
                                    setWallMergeError("Please select exactly 2 walls to merge.");
                                    setTimeout(() => setWallMergeError(''), 5000);
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
                                                    min="10"
                                                    step="10"
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
                                                    min="25"
                                                    step="25"
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
                                                setWallToDelete(selectedWall);
                                                setShowWallDeleteConfirm(true);
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
                        onDeleteDoor={async (doorId) => {
                            await api.delete(`/doors/${doorId}/`);
                            setDoors(doors.filter(d => d.id !== doorId));
                            setShowDoorManager(false);
                            setEditingDoor(null);
                        }}
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

            {/* Database Connection Error Banner */}
            {dbConnectionError && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Fail to connect to database. Try again later.</span>
                    </div>
                </div>
            )}

            {/* Wall Merge Error Banner */}
            {wallMergeError && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{wallMergeError}</span>
                    </div>
                </div>
            )}

            {showWallDeleteConfirm && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded shadow-lg flex items-center gap-4">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Are you sure you want to delete this wall?</span>
                    <button onClick={handleConfirmWallDelete} className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Yes, Delete</button>
                    <button onClick={handleCancelWallDelete} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
                </div>
            )}

            {wallDeleteSuccess && (
                <div className="fixed top-44 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Wall deleted successfully!</span>
                </div>
            )}

            {roomCreateSuccess && (
                <div className="fixed top-56 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Room created successfully!</span>
                </div>
            )}

            {wallMergeSuccess && (
                <div className="fixed top-56 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Walls merged successfully!</span>
                </div>
            )}

            {roomError && (
                <div className="fixed top-64 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">{roomError}</span>
                </div>
            )}
        </div>
    );
};

export default ProjectDetails;