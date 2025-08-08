import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import useProjectDetails from './useProjectDetails';
import Canvas2D from '../canvas/Canvas2D';
import ThreeCanvas3D from '../canvas/ThreeCanvas3D';
import RoomManager from '../room/RoomManager';
import DoorManager from '../door/DoorManager';
import DoorEditorModal from '../door/DoorEditorModal';
import { FaPencilAlt } from 'react-icons/fa';

const ProjectDetails = () => {
    const { projectId } = useParams();
    const projectDetails = useProjectDetails(projectId);

    // Add this state for the edited wall
    const [editedWall, setEditedWall] = useState(null);

    // When the modal opens, copy the selected wall to local state
    useEffect(() => {
        if (projectDetails.selectedWall !== null) {
            const wall = projectDetails.walls.find(w => w.id === projectDetails.selectedWall);
            setEditedWall(wall ? { ...wall } : null);
        } else {
            setEditedWall(null);
        }
    }, [projectDetails.selectedWall, projectDetails.walls]);

    return (
        <div className="max-w-7xl mx-auto p-6">
            {/* Header Section */}
            <div className="mb-8 bg-white rounded-lg shadow-sm p-6">
                <div className="mb-4 flex items-center">
                    {(!projectDetails.project || !projectDetails.project.name) ? (
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">Loading project...</h1>
                    ) : (
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">{projectDetails.project.name}</h1>
                    )}
                </div>
                {projectDetails.project ? (
                <p className="text-gray-600">
                        Dimensions: {projectDetails.project.width} x {projectDetails.project.length} x {projectDetails.project.height} mm
                </p>
                ) : null}
            </div>

            {/* Control Panel */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                {/* Primary Controls */}
                <div className="flex flex-wrap gap-3 mb-4">
                    <button
                        onClick={() => projectDetails.setIs3DView(!projectDetails.is3DView)}
                        className={`px-4 py-2 rounded-lg transition-colors ${
                            projectDetails.is3DView ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                    >
                        {projectDetails.is3DView ? 'Switch to 2D View' : 'Switch to 3D View'}
                    </button>

                    {projectDetails.is3DView && (
                        <button
                            onClick={projectDetails.handleViewToggle}
                            className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                        >
                            {projectDetails.isInteriorView ? 'View Exterior' : 'View Interior'}
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (!projectDetails.is3DView) {  // ✅ Prevent editing in 3D mode
                                projectDetails.setIsEditingMode(!projectDetails.isEditingMode);
                                projectDetails.setCurrentMode(null);
                                projectDetails.resetAllSelections();
                            }
                        }}
                        disabled={projectDetails.is3DView}  // ✅ Disable button when in 3D mode
                        className={`px-4 py-2 rounded-lg transition-colors ${
                            projectDetails.isEditingMode ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-100 hover:bg-gray-200'
                        } ${projectDetails.is3DView ? 'opacity-50 cursor-not-allowed' : ''}`}  // ✅ Style it as disabled
                    >
                        {projectDetails.isEditingMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                    </button>
                </div>

                {/* Editing Mode Controls */}
                {projectDetails.isEditingMode && !projectDetails.is3DView && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => projectDetails.toggleMode('add-wall')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    projectDetails.currentMode === 'add-wall'
                                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                                        : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {projectDetails.currentMode === 'add-wall' ? 'Exit Add Wall Mode' : 'Add Wall'}
                            </button>

                            <button
                            onClick={() => {
                                if (projectDetails.selectedWall !== null) {
                                projectDetails.setShowWallEditor(true);
                                }
                                projectDetails.toggleMode('edit-wall');
                            }}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    projectDetails.currentMode === 'edit-wall'
                                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                                        : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {projectDetails.currentMode === 'edit-wall' ? 'Exit Edit Wall Mode' : 'Edit Wall'}
                            </button>

                            <button
                            onClick={() => projectDetails.toggleMode('merge-wall')}
                            className={`px-4 py-2 rounded-lg transition-colors ${
                                projectDetails.currentMode === 'merge-wall'
                                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                                    : 'border border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            {projectDetails.currentMode === 'merge-wall' ? 'Exit Merge Mode' : 'Merge Walls'}
                        </button>

                        {projectDetails.currentMode === 'merge-wall' && (
                            <button
                                onClick={() => {
                                    if (projectDetails.selectedWallsForRoom.length === 2) {
                                    projectDetails.handleManualWallMerge(projectDetails.selectedWallsForRoom);
                                    } else {
                                    projectDetails.setWallMergeError("Please select exactly 2 walls to merge.");
                                    setTimeout(() => projectDetails.setWallMergeError(''), 5000);
                                    }
                                }}
                            className="px-4 py-2 rounded-lg transition-colors border border-gray-200 hover:bg-gray-50"
                            >
                                Confirm Merge
                            </button>
                        )}

                            <button
                                onClick={() => projectDetails.toggleMode('define-room')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    projectDetails.currentMode === 'define-room'
                                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                                        : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {projectDetails.currentMode === 'define-room' ? 'Exit Define Room Mode' : 'Define Room'}
                            </button>

                            <button
                                onClick={() => projectDetails.toggleMode('add-door')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                projectDetails.currentMode === 'add-door'
                                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                                    : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                            >
                                {projectDetails.currentMode === 'add-door' ? 'Exit Add Door' : 'Add Door'}
                            </button>
                            <button
                                onClick={() => projectDetails.toggleMode('edit-door')}
                                className={`px-4 py-2 rounded-lg transition-colors ${
                                    projectDetails.currentMode === 'edit-door'
                                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                                    : 'border border-gray-200 hover:bg-gray-50'
                                }`}
                                >
                                {projectDetails.currentMode === 'edit-door' ? 'Exit Edit Door' : 'Edit Door'}
                            </button>
                        </div>

                        {/* Wall Type Selection */}
                        {projectDetails.currentMode === 'add-wall' && (
                            <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                                <label className="font-medium text-gray-700">Wall Type:</label>
                                <select 
                                    value={projectDetails.selectedWallType} 
                                    onChange={(e) => projectDetails.setSelectedWallType(e.target.value)}
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
                    {projectDetails.selectedWall !== null && projectDetails.currentMode === 'edit-wall' && (
                        <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
                            <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl w-full">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-semibold">Wall Properties</h3>
                                    <button 
                                        onClick={() => {
                                            projectDetails.setSelectedWall(null);
                                            projectDetails.setCurrentMode(null);
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
                                                    value={editedWall?.start_x || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, start_x: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">Start Y:</span>
                                                <input
                                                    type="number"
                                                    value={editedWall?.start_y || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, start_y: parseFloat(e.target.value) })}
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
                                                    value={editedWall?.end_x || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, end_x: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">End Y:</span>
                                                <input
                                                    type="number"
                                                    value={editedWall?.end_y || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, end_y: parseFloat(e.target.value) })}
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
                                                    value={editedWall?.height || ''} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, height: parseFloat(e.target.value) })} 
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
                                                    value={editedWall?.thickness || ''} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, thickness: parseFloat(e.target.value) })} 
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
                                                    value={editedWall?.application_type || 'wall'} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, application_type: e.target.value })} 
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
                                            onClick={async () => {
                                                // 1. Find which endpoints changed
                                                const original = projectDetails.walls.find(w => w.id === projectDetails.selectedWall);
                                                const edited = editedWall;
                                                const changedEndpoints = [];
                                                if (original && edited) {
                                                    if (original.start_x !== edited.start_x || original.start_y !== edited.start_y) {
                                                        changedEndpoints.push({
                                                            which: 'start',
                                                            old: { x: original.start_x, y: original.start_y },
                                                            new: { x: edited.start_x, y: edited.start_y }
                                                        });
                                                    }
                                                    if (original.end_x !== edited.end_x || original.end_y !== edited.end_y) {
                                                        changedEndpoints.push({
                                                            which: 'end',
                                                            old: { x: original.end_x, y: original.end_y },
                                                            new: { x: edited.end_x, y: edited.end_y }
                                                        });
                                                    }
                                                }
                                                // 2. For each changed endpoint, update all other walls sharing that endpoint
                                                const updates = [];
                                                for (const endpoint of changedEndpoints) {
                                                    for (const [idx, wall] of projectDetails.walls.entries()) {
                                                        if (wall.id === edited.id) continue;
                                                        // Check start
                                                        if (Math.abs(endpoint.old.x - wall.start_x) < 0.001 && Math.abs(endpoint.old.y - wall.start_y) < 0.001) {
                                                            const updatedWall = { ...wall, start_x: endpoint.new.x, start_y: endpoint.new.y };
                                                            updates.push(projectDetails.handleWallUpdateNoMerge(updatedWall));
                                                        }
                                                        // Check end
                                                        if (Math.abs(endpoint.old.x - wall.end_x) < 0.001 && Math.abs(endpoint.old.y - wall.end_y) < 0.001) {
                                                            const updatedWall = { ...wall, end_x: endpoint.new.x, end_y: endpoint.new.y };
                                                            updates.push(projectDetails.handleWallUpdateNoMerge(updatedWall));
                                                        }
                                                    }
                                                }
                                                // 3. Update the edited wall itself (skip merge)
                                                await Promise.all([
                                                    ...updates,
                                                    projectDetails.handleWallUpdateNoMerge(edited)
                                                ]);
                                                projectDetails.setSelectedWall(null);
                                                setEditedWall(null);
                                            }}
                                            className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                                        >
                                            Save
                                        </button>
                                        
                                        <button
                                            onClick={() => {
                                                projectDetails.setWallToDelete(projectDetails.selectedWall);
                                                projectDetails.setShowWallDeleteConfirm(true);
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
                {projectDetails.showRoomManagerModal && !projectDetails.is3DView && (
                    <RoomManager
                        projectId={projectId}
                        walls={projectDetails.walls}
                        onSaveRoom={projectDetails.handleCreateRoom}
                        onUpdateRoom={projectDetails.handleRoomUpdate}
                        onDeleteRoom={projectDetails.handleRoomDelete}
                        selectedWallIds={projectDetails.selectedWallsForRoom}
                        editingRoom={projectDetails.editingRoom}
                        isEditMode={!!projectDetails.editingRoom}
                        onClose={() => {
                            projectDetails.setShowRoomManagerModal(false);
                            projectDetails.setEditingRoom(null);
                            projectDetails.setSelectedWallsForRoom([]);
                        }}
                        selectedPolygonPoints={projectDetails.selectedRoomPoints}
                    />
                )}

                {/* Door Manager Modal */}
                {projectDetails.showDoorManager && (
                    <DoorManager
                        projectId={projectId}
                        wall={projectDetails.selectedDoorWall}
                        editingDoor={projectDetails.editingDoor}
                        onSaveDoor={projectDetails.editingDoor ? projectDetails.handleUpdateDoor : projectDetails.handleCreateDoor}
                        onDeleteDoor={async (doorId) => {
                            await projectDetails.handleDeleteDoor(doorId);
                        }}
                        onClose={() => {
                            projectDetails.setShowDoorManager(false);
                            projectDetails.setEditingDoor(null);
                        }}
                    />
                )}

                 {/* Door Editor Modal */}
                {projectDetails.showDoorEditor && projectDetails.editingDoor && (
                    <DoorEditorModal
                        door={projectDetails.editingDoor}
                        onUpdate={projectDetails.handleUpdateDoor}
                        onDelete={async (doorId) => {
                            await projectDetails.handleDeleteDoor(doorId);
                        }}
                        onClose={() => {
                            projectDetails.setShowDoorEditor(false);
                            projectDetails.setEditingDoor(null);
                        }}
                    />
                )}

            {/* Visualization Area */}
            <div className="bg-white rounded-lg shadow-sm p-6">
                {projectDetails.is3DView ? (
                    <div id="three-canvas-container" className="w-full h-[600px] bg-gray-50 rounded-lg" />
                ) : (
                    <>
                        <h2 className="text-xl font-semibold mb-4">2D Visualization</h2>
                        <Canvas2D
                            walls={projectDetails.walls}
                            setWalls={projectDetails.setWalls}
                            joints={projectDetails.joints}
                            projectId={projectId}
                            onWallTypeSelect={projectDetails.selectedWallType}
                            onWallUpdate={projectDetails.handleWallUpdate}
                            onNewWall={projectDetails.handleAddWallWithSplitting}
                            onWallDelete={projectDetails.handleWallDelete}
                            isEditingMode={projectDetails.isEditingMode}
                            currentMode={projectDetails.currentMode}
                            onWallSelect={projectDetails.handleWallSelect}
                            selectedWallsForRoom={projectDetails.selectedWallsForRoom}
                            onRoomWallsSelect={projectDetails.setSelectedWallsForRoom}
                            rooms={projectDetails.rooms}
                            onRoomSelect={projectDetails.handleRoomSelect}
                            onRoomUpdate={projectDetails.handleRoomUpdate}
                            onRoomLabelPositionUpdate={projectDetails.handleRoomLabelPositionUpdate}
                            onJointsUpdate={projectDetails.setJoints}
                            doors={projectDetails.doors}
                            onDoorSelect={projectDetails.handleDoorSelect}
                            onDoorWallSelect={(wall) => {
                                projectDetails.setSelectedDoorWall(wall);
                                projectDetails.setShowDoorManager(true);
                            }}
                            project={projectDetails.project}
                            selectedRoomPoints={projectDetails.selectedRoomPoints}
                            onUpdateRoomPoints={projectDetails.updateRoomPointsAndDetectWalls}
                        />
                    </>
                )}
            </div>

            {/* Database Connection Error Banner */}
            {projectDetails.dbConnectionError && (
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
            {projectDetails.wallMergeError && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{projectDetails.wallMergeError}</span>
                    </div>
                </div>
            )}

            {projectDetails.showWallDeleteConfirm && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded shadow-lg flex items-center gap-4">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Are you sure you want to delete this wall?</span>
                    <button onClick={projectDetails.handleConfirmWallDelete} className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Yes, Delete</button>
                    <button onClick={projectDetails.handleCancelWallDelete} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
                </div>
            )}

            {projectDetails.wallDeleteSuccess && (
                <div className="fixed top-44 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Wall deleted successfully!</span>
                </div>
            )}

            {projectDetails.roomCreateSuccess && (
                <div className="fixed top-56 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Room created successfully!</span>
                </div>
            )}

            {projectDetails.wallMergeSuccess && (
                <div className="fixed top-56 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Walls merged successfully!</span>
                </div>
            )}

            {projectDetails.roomError && (
                <div className="fixed top-64 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">{projectDetails.roomError}</span>
                </div>
            )}
        </div>
    );
};

export default ProjectDetails;