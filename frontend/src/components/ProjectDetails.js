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
            console.log('Room created successfully:', response.data);
            setSelectedWallsForRoom([]);
            alert('Room created successfully!');
            setShowRoomManager(false);
        } catch (error) {
            console.error('Error creating room:', error);
            alert('Failed to create room.');
        }
    };

    useEffect(() => {
        const fetchRooms = async () => {
            try {
                const response = await api.get('http://127.0.0.1:8000/api/rooms/');
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

    const handleWallUpdate = (updatedWalls) => {
        // Update walls locally and in the backend
        setWalls(updatedWalls);
        updatedWalls.forEach(async (wall) => {
            try {
                await api.put(`/walls/${wall.id}/`, wall);
            } catch (error) {
                console.error('Error updating wall:', error);
            }
        })
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
                        height: Math.max(wall1.height, wall2.height),
                        thickness: Math.max(wall1.thickness, wall2.thickness),
                        project: projectId
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
        
        // If we're already in this mode, exit it
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
        } else {
            console.log(`Entering ${mode} mode.`);
            
            // Reset previous selections before entering new mode
            resetAllSelections();
            
            // Set up new mode
            if (mode === 'define-room') {
                setShowRoomManager(true);
            }
            
            setCurrentMode(mode);
        }
    }; 

    if (!project) {
        return <div>Loading...</div>;
    }

    return (
        <div>
            <h1>{project.name}</h1>
            <p>
                Dimensions: {project.width} x {project.length} x {project.height} mm
            </p>

            {/* Editing Mode Controls */}
            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => setIs3DView(!is3DView)}
                    className={`px-4 py-2 rounded ${is3DView ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
                >
                    {is3DView ? 'Switch to 2D View' : 'Switch to 3D View'}
                </button>

                {is3DView && (
                    <button
                        onClick={handleViewToggle}
                        className="px-4 py-2 rounded bg-blue-500 text-white"
                    >
                        {isInteriorView ? 'View Exterior' : 'View Interior'}
                    </button>
                )}

                <button
                    onClick={() => {
                        setIsEditingMode(!isEditingMode);
                        setCurrentMode(null);
                        resetAllSelections(); // Reset all selections when toggling edit mode
                    }}
                    className={`px-4 py-2 rounded ${
                        isEditingMode ? 'bg-red-500 text-white' : 'bg-gray-200'
                    }`}
                >
                    {isEditingMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                </button>

                {isEditingMode && (
                    <>
                        <button onClick={() => toggleMode('add-wall')}>
                            {currentMode === 'add-wall' ? 'Exit Add Wall Mode' : 'Enter Add Wall Mode'}
                        </button>
                        <button onClick={() => toggleMode('edit-wall')}>
                            {currentMode === 'edit-wall' ? 'Exit Edit Wall Mode' : 'Enter Edit Wall Mode'}
                        </button>
                        <button
                            onClick={() => handleWallRemove(selectedWall)}
                            disabled={selectedWall === null}
                            className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-300"
                        >
                            Remove Wall
                        </button>
                        <button onClick={() => toggleMode('define-room')}>
                            {currentMode === 'define-room' ? 'Exit Define Room Mode' : 'Enter Define Room Mode'}
                        </button>

                        {showRoomManager && (
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
                        )}
                    </>
                )}
            </div>

            {/* Wall Dimension Editing */}
            {selectedWall !== null && currentMode === 'edit-wall' && (
                <div className="flex flex-col gap-2 mb-4">
                    <label>
                        Start X:
                        <input
                            type="number"
                            value={walls[selectedWall]?.start_x || ''}
                            onChange={(e) => {
                                const updatedWalls = [...walls];
                                updatedWalls[selectedWall].start_x = parseFloat(e.target.value);
                                setWalls(updatedWalls);
                                handleWallUpdate(updatedWalls);
                            }}
                        />
                    </label>
                    <label>
                        Start Y:
                        <input
                            type="number"
                            value={walls[selectedWall]?.start_y || ''}
                            onChange={(e) => {
                                const updatedWalls = [...walls];
                                updatedWalls[selectedWall].start_y = parseFloat(e.target.value);
                                setWalls(updatedWalls);
                                handleWallUpdate(updatedWalls);
                            }}
                        />
                    </label>
                    <label>
                        End X:
                        <input
                            type="number"
                            value={walls[selectedWall]?.end_x || ''}
                            onChange={(e) => {
                                const updatedWalls = [...walls];
                                updatedWalls[selectedWall].end_x = parseFloat(e.target.value);
                                setWalls(updatedWalls);
                                handleWallUpdate(updatedWalls);
                            }}
                        />
                    </label>
                    <label>
                        End Y:
                        <input
                            type="number"
                            value={walls[selectedWall]?.end_y || ''}
                            onChange={(e) => {
                                const updatedWalls = [...walls];
                                updatedWalls[selectedWall].end_y = parseFloat(e.target.value);
                                setWalls(updatedWalls);
                                handleWallUpdate(updatedWalls);
                            }}
                        />
                    </label>
                </div>
            )}

                {is3DView ? (
                    <div id="three-canvas-container" style={{ width: '100%', height: '600px' }} />
                ) : (
            <>
                <h2>2D Visualization:</h2>
                <Canvas2D
                    walls={walls}
                    setWalls={setWalls}
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
    );
};

export default ProjectDetails;