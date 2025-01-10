import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/api';
import Canvas2D from './Canvas2D';

const ProjectDetails = () => {
    const { projectId } = useParams(); // Fetch project ID from URL
    const [project, setProject] = useState(null);
    const [walls, setWalls] = useState([]);
    const [isEditingMode, setIsEditingMode] = useState(false);
    const [currentMode, setCurrentMode] = useState(null); // "add-wall" or "edit-wall"
    const [selectedWall, setSelectedWall] = useState(null);

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

    const handleWallUpdate = (updatedWalls) => {
        // Update walls locally and in the backend
        setWalls(updatedWalls);
        updatedWalls.forEach(async (wall) => {
            try {
                await api.put(`/walls/${wall.id}/`, wall);
            } catch (error) {
                console.error('Error updating wall:', error);
            }
        });
    };

    const handleWallCreate = (newWall) => {
        // Include the project ID in the wall data
        const wallData = { ...newWall, project: project.id };

        api.post('/walls/create_wall/', wallData)
            .then((response) => {
                setWalls((prevWalls) => [...prevWalls, response.data]); // Add the newly created wall to the state
            })
            .catch((error) => {
                console.error('Error creating wall:', error);
            });
    };

    const handleWallRemove = () => {
        if (selectedWall !== null) {
            const wallToRemove = walls[selectedWall];
            api.delete(`/walls/${wallToRemove.id}/`)
                .then(() => {
                    setWalls((prevWalls) => prevWalls.filter((_, index) => index !== selectedWall));
                    setSelectedWall(null); // Deselect the wall
                })
                .catch((error) => {
                    console.error('Error deleting wall:', error);
                });
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
                    onClick={() => {
                        setIsEditingMode(!isEditingMode);
                        setCurrentMode(null); // Reset mode on toggling editing mode
                    }}
                    className={`px-4 py-2 rounded ${
                        isEditingMode ? 'bg-red-500 text-white' : 'bg-gray-200'
                    }`}
                >
                    {isEditingMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                </button>

                {isEditingMode && (
                    <>
                        <button
                            onClick={() => setCurrentMode('add-wall')}
                            className={`px-4 py-2 rounded ${
                                currentMode === 'add-wall' ? 'bg-blue-500 text-white' : 'bg-gray-200'
                            }`}
                        >
                            Add Wall
                        </button>
                        <button
                            onClick={() => setCurrentMode('edit-wall')}
                            className={`px-4 py-2 rounded ${
                                currentMode === 'edit-wall' ? 'bg-blue-500 text-white' : 'bg-gray-200'
                            }`}
                        >
                            Edit Wall
                        </button>
                        <button
                            onClick={handleWallRemove}
                            disabled={selectedWall === null}
                            className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-300"
                        >
                            Remove Wall
                        </button>
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

            {/* Canvas2D Component */}
            <h2>2D Visualization:</h2>
            <Canvas2D
                walls={walls}
                setWalls={setWalls} // Pass the setter
                onWallUpdate={handleWallUpdate}
                onNewWall={handleWallCreate}
                isEditingMode={isEditingMode}
                currentMode={currentMode}
            />


            {/* Placeholder for 3D Visualization */}
            <h2>3D Visualization (Coming Soon):</h2>
            <div style={{ width: '800px', height: '600px', backgroundColor: '#e0e0e0' }}>
                3D View Placeholder
            </div>
        </div>
    );
};

export default ProjectDetails;
