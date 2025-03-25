import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/api';
import Canvas2D from './Canvas2D';
import ThreeCanvas3D from "./ThreeCanvas3D";
import RoomManager from './RoomManager';

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

    const handleViewToggle = () => {
        if (!threeCanvasInstance.current) return;
        
        setIsInteriorView(!isInteriorView);
        if (!isInteriorView) {
            threeCanvasInstance.current.animateToInteriorView();
        } else {
            threeCanvasInstance.current.animateToExteriorView();
        }
    };

    const handleCreateRoom = async (roomData) => {
        try {
            const response = await api.post('/rooms/', roomData);
    
            if (response.status === 201) {
                const newRoom = response.data;
                console.log('✅ Room created successfully:', newRoom);
    
                // ✅ Update state immediately to reflect the new room
                setRooms((prevRooms) => [...prevRooms, newRoom]);
    
                // ✅ Clear selected walls after room creation
                setSelectedWallsForRoom([]);
    
                // ✅ Show success message
                alert('Room created successfully!');
    
                // ✅ Close the Room Manager after creation
                setShowRoomManager(false);
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
            // Pre-select the walls that belong to this room
            setSelectedWallsForRoom(room.walls);
        }
    };

    const handleRoomUpdate = async (updatedRoomData) => {
        try {
            const response = await api.put(`/rooms/${updatedRoomData.id}/`, updatedRoomData);
            setRooms(rooms.map(room => 
                room.id === updatedRoomData.id ? response.data : room
            ));
            setShowRoomManager(false);
            setEditingRoom(null);
            setSelectedWallsForRoom([]);
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
            setShowRoomManager(false);
            setEditingRoom(null);
            setSelectedWallsForRoom([]);
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
            } catch (error) {
                console.error('Error fetching project details:', error);
            }
        };
    
        fetchProjectDetails();
    }, [projectId]);

    useEffect(() => {
        if (is3DView) {
            const threeCanvas = new ThreeCanvas3D('three-canvas-container', walls);
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
            // Update local state first
            setWalls((prevWalls) =>
                prevWalls.map((wall) =>
                    wall.id === updatedWall.id ? { ...wall, ...updatedWall } : wall
                )
            );
    
            // Send PUT request (assuming `api` is Axios or similar)
            const response = await api.put(`/walls/${updatedWall.id}/`, updatedWall);
    
            // Axios stores response data in `response.data`
            console.log("Backend response:", response.data);
    
            // Check if merge is needed (use the updatedWall from the server if needed)
            checkAndMergeWalls(updatedWall); // Or use response.data if server returns merged data
    
        } catch (error) {
            console.error("Error updating wall:", error);
        }
    };

    const checkAndMergeWalls = async (updatedWall) => {
        // Helper function to check if walls form a straight line
        const areLevelWalls = (wall1, wall2) => {
            // Case 1: Vertical walls (same X coordinates)
            if (wall1.start_x === wall1.end_x && wall2.start_x === wall2.end_x && wall1.start_x === wall2.start_x) {
                return true;
            }
            
            // Case 2: Horizontal walls (same Y coordinates)
            if (wall1.start_y === wall1.end_y && wall2.start_y === wall2.end_y && wall1.start_y === wall2.start_y) {
                return true;
            }
            
            return false;
        };
    
        const adjacentWalls = walls.filter((wall) =>
            (wall.end_x === updatedWall.start_x && wall.end_y === updatedWall.start_y) ||
            (wall.start_x === updatedWall.end_x && wall.start_y === updatedWall.end_y)
        );
    
        adjacentWalls.forEach(async (neighborWall) => {
            if (
                neighborWall.application_type === updatedWall.application_type &&
                neighborWall.height === updatedWall.height &&
                neighborWall.thickness === updatedWall.thickness &&
                areLevelWalls(neighborWall, updatedWall)  // Add level check
            ) {
                console.log(`Merging walls ${neighborWall.id} and ${updatedWall.id} as they now have identical properties and are level.`);
    
                try {
                    const mergeResponse = await api.post("/walls/merge_walls/", {
                        wall_ids: [neighborWall.id, updatedWall.id],
                    });
    
                    if (mergeResponse.status === 201) {
                        console.log("Merge successful, response:", mergeResponse.data);
                        const mergedWall = mergeResponse.data;
    
                        setWalls((prevWalls) =>
                            prevWalls.filter((wall) => wall.id !== neighborWall.id && wall.id !== updatedWall.id)
                                .concat(mergedWall)
                        );
                    } else {
                        console.error("Error merging walls. Unexpected status:", mergeResponse.status);
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
                setSelectedWallsForRoom([]);
                setShowRoomManager(false);
            } else if (mode === 'edit-wall') {
                setSelectedWall(null);
            }
    
            setCurrentMode(null);
            return;
        }
    
        console.log(`Entering ${mode} mode.`);
    
        // Reset previous selections before switching modes
        resetAllSelections();
    
        // Handle special cases
        if (mode === 'define-room') {
            setShowRoomManager(true);
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
                                onClick={() => toggleMode('edit-wall')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    currentMode === 'edit-wall'
                                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                                        : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {currentMode === 'edit-wall' ? 'Exit Edit Wall Mode' : 'Edit Wall'}
                            </button>

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
                                onClick={() => handleWallRemove(selectedWall)}
                                disabled={selectedWall === null}
                                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 
                                    transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Remove Wall
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

            {/* Wall Editing Panel */}
            {selectedWall !== null && currentMode === 'edit-wall' && (
                <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                    <h3 className="text-lg font-semibold mb-4">Wall Properties</h3>
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
                </div>
            )}

            {/* Room Manager */}
            {showRoomManager && !is3DView && (
                <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                    <RoomManager
                        projectId={projectId}
                        walls={walls}
                        selectedWallIds={selectedWallsForRoom}
                        onSaveRoom={handleCreateRoom}
                        onUpdateRoom={handleRoomUpdate}
                        onDeleteRoom={handleRoomDelete}
                        editingRoom={editingRoom}
                        isEditMode={!!editingRoom}
                        onClose={() => {
                            setShowRoomManager(false);
                            setEditingRoom(null);
                            setSelectedWallsForRoom([]);
                        }}
                    />
                </div>
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
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export default ProjectDetails;