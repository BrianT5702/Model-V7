import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useProjectDetails from './useProjectDetails';
import Canvas2D from '../canvas/Canvas2D';
import RoomManager from '../room/RoomManager';
import DoorManager from '../door/DoorManager';
import DoorEditorModal from '../door/DoorEditorModal';
import CeilingManager from '../ceiling/CeilingManager';
import FloorManager from '../floor/FloorManager';
import InstallationTimeEstimator from '../estimation/InstallationTimeEstimator';

import { 
    FaPencilAlt, 
    FaCube, 
    FaSquare, 
    FaEdit, 
    FaObjectGroup, 
    FaDoorOpen, 
    FaHome,
    FaCog,
    FaEye,
    FaEyeSlash,
    FaArrowLeft,
    FaLayerGroup
} from 'react-icons/fa';

const ProjectDetails = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const projectDetails = useProjectDetails(projectId);
    
    // Modal state for image capture
    const [isCapturingImages, setIsCapturingImages] = useState(false);
    const [captureSuccess, setCaptureSuccess] = useState(false);

    // Add this state for the edited wall
    const [editedWall, setEditedWall] = useState(null);
    
    // Capture canvas images when switching tabs
    useEffect(() => {
        // Helper function to remove grid lines from canvas
        const removeGridFromCanvas = (sourceCanvas) => {
            console.log('🎨 Removing grid lines from canvas...');
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = sourceCanvas.width;
            tempCanvas.height = sourceCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Fill with white background first
            tempCtx.fillStyle = '#FFFFFF';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            // Copy original canvas on top
            tempCtx.drawImage(sourceCanvas, 0, 0);
            
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = imageData.data;
            
            // Grid color: #ddd = rgb(221, 221, 221)
            const gridR = 221, gridG = 221, gridB = 221;
            const bgR = 255, bgG = 255, bgB = 255; // Pure white
            const tolerance = 20; // Increased tolerance
            
            let pixelsChanged = 0;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const a = data[i + 3];
                
                if (Math.abs(r - gridR) < tolerance && 
                    Math.abs(g - gridG) < tolerance && 
                    Math.abs(b - gridB) < tolerance &&
                    a > 200) {
                    data[i] = bgR;
                    data[i + 1] = bgG;
                    data[i + 2] = bgB;
                    pixelsChanged++;
                }
            }
            
            console.log(`✅ Removed ${pixelsChanged / 4} grid pixels`);
            
            tempCtx.putImageData(imageData, 0, 0);
            return tempCanvas;
        };
        
        const captureCanvasImage = async () => {
            // Wait for canvas to render
            await new Promise(resolve => setTimeout(resolve, 500));
            
            let canvas = null;
            let planType = null;
            
            if (projectDetails.currentView === 'wall-plan') {
                canvas = document.querySelector('canvas[data-plan-type="wall"]');
                planType = 'wall';
            } else if (projectDetails.currentView === 'ceiling-plan') {
                canvas = document.querySelector('canvas[data-plan-type="ceiling"]');
                planType = 'ceiling';
            } else if (projectDetails.currentView === 'floor-plan') {
                canvas = document.querySelector('canvas[data-plan-type="floor"]');
                planType = 'floor';
            }
            
            if (canvas && planType) {
                try {
                    // Remove grid lines before capturing
                    const cleanCanvas = removeGridFromCanvas(canvas);
                    const imageData = cleanCanvas.toDataURL('image/png', 0.9);
                    console.log(`📸 Captured ${planType} plan image (without grid)`);
                    
                    // Store in shared data - use special method for canvas images
                    projectDetails.updateCanvasImage(planType, imageData);
                } catch (error) {
                    console.warn(`Failed to capture ${planType} plan:`, error);
                }
            }
        };
        
        // Only capture when on a canvas tab
        if (['wall-plan', 'ceiling-plan', 'floor-plan'].includes(projectDetails.currentView)) {
            captureCanvasImage();
        }
    }, [projectDetails.currentView, projectDetails.walls, projectDetails.rooms]);

    // Memoize the room close handler to prevent unnecessary re-renders
    const handleRoomClose = useCallback(() => {
        projectDetails.setShowRoomManagerModal(false);
        projectDetails.setEditingRoom(null);
        projectDetails.setCurrentMode(null);
    }, [projectDetails]);

    // Memoize the room save handler to prevent unnecessary re-renders
    const handleRoomSave = useCallback((roomData) => {
        if (projectDetails.editingRoom) {
            projectDetails.handleRoomUpdate(roomData);
        } else {
            projectDetails.handleCreateRoom(roomData);
        }
    }, [projectDetails]);

    // Memoize the room delete handler to prevent unnecessary re-renders
    const handleRoomDelete = useCallback((roomId) => {
        if (projectDetails.editingRoom) {
            projectDetails.handleRoomDelete(roomId);
        }
    }, [projectDetails]);

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
        <div className="min-h-screen bg-gray-50 project-details-container">
            {/* Full-Screen Loading Modal for Image Capture */}
            {isCapturingImages && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
                    <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md mx-4">
                        <div className="text-center">
                            {captureSuccess ? (
                                <>
                                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-800 mb-3">Success!</h3>
                                    <p className="text-gray-600 mb-4">
                                        All plan images have been captured successfully.
                                    </p>
                                    <div className="space-y-2 text-sm text-green-600">
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                            <span>Wall Plan ✓</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                            <span>Ceiling Plan ✓</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                            <span>Floor Plan ✓</span>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-4">
                                        You can now export your project report with images.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-6"></div>
                                    <h3 className="text-xl font-bold text-gray-800 mb-3">Auto-Fetching Data & Images</h3>
                                    <p className="text-gray-600 mb-4">
                                        Capturing plan images from all tabs...
                                    </p>
                                    <div className="space-y-2 text-sm text-gray-500">
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                                            <span>Switching to Wall Plan...</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                                            <span>Switching to Ceiling Plan...</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                                            <span>Switching to Floor Plan...</span>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-4">
                                        Please wait while we capture all plan images...
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Navigation Bar */}
            <div className="bg-white border-b border-gray-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={() => navigate('/')}
                                className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <FaArrowLeft className="w-4 h-4 mr-2" />
                                Back to Home
                            </button>
                            <div className="h-6 w-px bg-gray-300"></div>
                            <div className="flex items-center text-gray-900">
                                <FaCube className="w-5 h-5 mr-2 text-blue-600" />
                                <span className="font-medium">Project View</span>
                            </div>
                        </div>
                        
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={() => navigate('/')}
                                className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <FaHome className="w-4 h-4 mr-2" />
                                Home
                            </button>
                            <div className="h-6 w-px bg-gray-300"></div>
                            <button
                                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                                className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                                Top
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Header Section */}
            <div className="bg-white border-b border-gray-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                    {(!projectDetails.project || !projectDetails.project.name) ? (
                                <h1 className="text-2xl font-bold text-gray-900">Loading project...</h1>
                            ) : (
                                <h1 className="text-2xl font-bold text-gray-900">{projectDetails.project.name}</h1>
                            )}
                            {projectDetails.project && (
                                <p className="text-sm text-gray-600 mt-1">
                                    Dimensions: {projectDetails.project.width} × {projectDetails.project.length} × {projectDetails.project.height} mm
                                </p>
                            )}
                        </div>
                        
                        {/* View Toggle Buttons */}
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={() => {
                                    const newViewState = !projectDetails.is3DView;
                                    if (projectDetails.is3DView) {
                                        // Force cleanup when switching from 3D to 2D
                                        projectDetails.forceCleanup3D();
                                    }
                                    projectDetails.setIs3DView(newViewState);
                                }}
                                className={`flex items-center px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                                    projectDetails.is3DView 
                                        ? 'btn-primary' 
                                        : 'btn-secondary'
                                }`}
                            >
                                {projectDetails.is3DView ? (
                                    <>
                                        <FaSquare className="mr-2" />
                                        2D View
                                    </>
                                ) : (
                                    <>
                                        <FaCube className="mr-2" />
                                        3D View
                                    </>
                                )}
                            </button>
                            

                        </div>
                    </div>
                </div>
            </div>



            {/* Define Room Container - Above Canvas */}
            {projectDetails.currentMode === 'define-room' && (
                <div className="w-full bg-white border-b border-gray-200 shadow-sm">
                    {/* Room Definition Header */}
                    <div className="p-4 border-b border-gray-200">
                        <div className="max-w-4xl mx-auto">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">Define Room</h3>
                                    <p className="text-sm text-gray-600 mt-1">
                                        Select walls to define room boundaries. Click on walls to select/deselect them.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-sm text-gray-600">
                                        <span className="font-medium">Selected:</span> {projectDetails.selectedWallsForRoom.length} walls
                                    </div>
                    <button
                                        onClick={() => projectDetails.setCurrentMode(null)}
                                        className="px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                    </button>
                                </div>
                            </div>
                            
                            {projectDetails.selectedWallsForRoom.length > 0 && (
                                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm text-blue-800">
                                            <span className="font-medium">Ready to create room</span> with {projectDetails.selectedWallsForRoom.length} walls
                                        </div>
                                        <button
                                            onClick={() => projectDetails.setShowRoomManagerModal(!projectDetails.showRoomManagerModal)}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                        >
                                            {projectDetails.showRoomManagerModal ? 'Hide Room Form' : 'Create Room'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Room Creation Interface */}
                    {projectDetails.showRoomManagerModal && (
                        <div className="p-4 room-creation-interface">
                            <div className="max-w-4xl mx-auto">
                                <div className="room-form-container p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-lg font-semibold text-gray-900">
                                            {projectDetails.editingRoom ? 'Edit Room' : 'Create New Room'}
                                        </h4>
                        <button
                                            onClick={() => projectDetails.setShowRoomManagerModal(false)}
                                            className="text-gray-400 hover:text-gray-600 transition-colors"
                        >
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                        </button>
                                    </div>
                                    <RoomManager
                                        projectId={projectId}
                                        walls={projectDetails.walls}
                                        selectedWallIds={projectDetails.selectedWallsForRoom}
                                        onSave={handleRoomSave}
                                        onDelete={handleRoomDelete}
                                        onClose={handleRoomClose}
                                        editingRoom={projectDetails.editingRoom}
                                        selectedPolygonPoints={projectDetails.selectedRoomPoints}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex min-h-[calc(100vh-120px)]">
                {/* Left Sidebar - Controls */}
                <div className="w-80 bg-white border-r border-gray-200 shadow-sm overflow-y-auto sidebar-scroll">
                    <div className="p-6">
                        {/* Edit Mode Toggle */}
                        <div className="mb-6">
                    <button
                        onClick={() => {
                                    if (!projectDetails.is3DView) {
                                projectDetails.setIsEditingMode(!projectDetails.isEditingMode);
                                projectDetails.setCurrentMode(null);
                                projectDetails.resetAllSelections();
                            }
                        }}
                                disabled={projectDetails.is3DView}
                                className={`w-full flex items-center justify-center px-4 py-3 rounded-lg font-medium transition-all duration-200 ${
                                    projectDetails.isEditingMode 
                                        ? 'btn-danger' 
                                        : 'btn-secondary'
                                } ${projectDetails.is3DView ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <FaCog className="mr-2" />
                        {projectDetails.isEditingMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                    </button>
                            {projectDetails.is3DView && (
                                <p className="text-xs text-gray-500 mt-2 text-center">
                                    Edit mode is disabled in 3D view
                                </p>
                            )}
                </div>

                {/* Editing Mode Controls */}
                {projectDetails.isEditingMode && !projectDetails.is3DView && (
                    <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Drawing Tools</h3>
                                
                                <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => projectDetails.toggleMode('add-wall')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'add-wall' ? 'active' : ''
                                        }`}
                                    >
                                        <FaPencilAlt className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Add Wall</span>
                            </button>

                            <button
                            onClick={() => {
                                if (projectDetails.selectedWall !== null) {
                                projectDetails.setShowWallEditor(true);
                                }
                                projectDetails.toggleMode('edit-wall');
                            }}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'edit-wall' ? 'active' : ''
                                        }`}
                                    >
                                        <FaEdit className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Edit Wall</span>
                            </button>

                            <button
                            onClick={() => projectDetails.toggleMode('merge-wall')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'merge-wall' ? 'active' : ''
                                        }`}
                                    >
                                        <FaObjectGroup className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Merge Walls</span>
                                    </button>

                                    <button
                                        onClick={() => projectDetails.toggleMode('define-room')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'define-room' ? 'active' : ''
                                        }`}
                                    >
                                        <FaHome className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Define Room</span>
                                    </button>

                                    <button
                                        onClick={() => projectDetails.toggleMode('add-door')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'add-door' ? 'active' : ''
                                        }`}
                                    >
                                        <FaDoorOpen className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Add Door</span>
                        </button>

                                    <button
                                        onClick={() => projectDetails.toggleMode('edit-door')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'edit-door' ? 'active' : ''
                                        }`}
                                    >
                                        <FaEdit className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Edit Door</span>
                                    </button>
                                </div>

                                {/* Wall Type Selection */}
                                {projectDetails.currentMode === 'add-wall' && (
                                    <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 shadow-sm">
                                        <label className="block text-sm font-semibold text-blue-800 mb-3 uppercase tracking-wide">Wall Type:</label>
                                        <select 
                                            value={projectDetails.selectedWallType} 
                                            onChange={(e) => projectDetails.setSelectedWallType(e.target.value)}
                                            className="w-full px-4 py-3 rounded-lg border-2 border-blue-300 
                                                focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                                                bg-white text-blue-900 focus-ring font-medium shadow-sm"
                                        >
                                            <option value="wall">Wall</option>
                                            <option value="partition">Partition</option>
                                        </select>
                                    </div>
                                )}

                                {/* Merge Confirmation */}
                        {projectDetails.currentMode === 'merge-wall' && (
                                    <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border border-yellow-200 shadow-sm">
                                        <p className="text-sm text-yellow-800 mb-3 font-medium">
                                            Select exactly 2 walls to merge
                                        </p>
                            <button
                                onClick={() => {
                                    if (projectDetails.selectedWallsForRoom.length === 2) {
                                    projectDetails.handleManualWallMerge(projectDetails.selectedWallsForRoom);
                                    } else {
                                    projectDetails.setWallMergeError("Please select exactly 2 walls to merge.");
                                    setTimeout(() => projectDetails.setWallMergeError(''), 5000);
                                    }
                                }}
                                            className="w-full px-4 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg hover:from-yellow-600 hover:to-orange-600 transition-all duration-200 font-semibold shadow-lg transform hover:scale-105"
                            >
                                Confirm Merge
                            </button>
                                    </div>
                                )}

                                {/* Status Messages */}
                                {projectDetails.wallMergeError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                        <p className="text-sm text-red-700">{projectDetails.wallMergeError}</p>
                                    </div>
                                )}

                                {projectDetails.wallMergeSuccess && (
                                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <p className="text-sm text-green-700">Walls merged successfully!</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 3D View Notice */}
                        {projectDetails.is3DView && (
                            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                <div className="flex items-center">
                                    <svg className="w-5 h-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <span className="text-sm text-yellow-800 font-medium">
                                        Edit mode is disabled in 3D view. Switch to 2D view to edit your project.
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Project Stats */}
                        <div className="mt-8 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                            <h3 className="text-sm font-semibold text-blue-800 uppercase tracking-wide mb-3">Project Stats</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                    <span className="text-blue-700 font-medium">Walls:</span>
                                    <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full">{projectDetails.walls.length}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                    <span className="text-blue-700 font-medium">Rooms:</span>
                                    <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full">{projectDetails.rooms.length}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                    <span className="text-blue-700 font-medium">Doors:</span>
                                    <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full">{projectDetails.doors.length}</span>
                                </div>
                                {projectDetails.rooms && projectDetails.rooms.length > 0 && (
                                    <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                        <span className="text-blue-700 font-medium">Est. Install:</span>
                                        <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full text-xs">
                                            {Math.ceil(projectDetails.rooms.length * 2 / 8)} days
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col overflow-visible">
                    {/* 3D Controls Bar - Only show when in 3D view */}
                    {projectDetails.is3DView && (
                        <div className="mx-6 mt-6 mb-2">
                            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-4">
                                        <h3 className="text-lg font-semibold text-gray-900">3D View Controls</h3>
                                        <button
                                            onClick={projectDetails.handleViewToggle}
                                            className="flex items-center px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-all duration-200 shadow-lg"
                                        >
                                            {projectDetails.isInteriorView ? (
                                                <>
                                                    <FaEye className="mr-2" />
                                                    Switch to Exterior
                                                </>
                                            ) : (
                                                <>
                                                    <FaEyeSlash className="mr-2" />
                                                    Switch to Interior
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={projectDetails.togglePanelLines}
                                            className={`flex items-center px-4 py-2 rounded-lg font-medium transition-all duration-200 shadow-lg ${
                                                projectDetails.showPanelLines 
                                                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                                                    : 'bg-gray-600 text-white hover:bg-gray-700'
                                            }`}
                                        >
                                            {projectDetails.showPanelLines ? 'Hide Panel Lines' : 'Show Panel Lines'}
                                        </button>
                                    </div>
                                    <div className="flex items-center space-x-4">
                                        <div className="text-sm text-gray-600">
                                            <span className="font-medium">View:</span> {projectDetails.isInteriorView ? 'Interior' : 'Exterior'}
                                        </div>
                                        <div className="h-6 w-px bg-gray-300"></div>
                                        <div className="text-sm text-gray-600">
                                            <span className="font-medium">Canvas Controls:</span> Use buttons on 3D canvas
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Canvas Container */}
                    <div className="bg-white m-6 rounded-lg shadow-sm border border-gray-200 canvas-container">
                        {projectDetails.is3DView ? (
                            <div id="three-canvas-container" className="w-full h-[600px] bg-gray-50 active" />
                        ) : (
                            <div className="flex flex-col">
                                {/* Tab Navigation */}
                                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                                    <div className="flex items-center justify-between">
                                        <div className="flex space-x-1">
                                            <button
                                                onClick={() => projectDetails.setCurrentView('wall-plan')}
                                                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                                                    projectDetails.currentView === 'wall-plan'
                                                        ? 'bg-blue-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <FaSquare className="inline mr-2" />
                                                Wall Plan
                                            </button>
                                            <button
                                                onClick={() => projectDetails.setCurrentView('ceiling-plan')}
                                                disabled={!projectDetails.rooms || projectDetails.rooms.length === 0}
                                                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                                                    (!projectDetails.rooms || projectDetails.rooms.length === 0)
                                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                        : projectDetails.currentView === 'ceiling-plan'
                                                        ? 'bg-green-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <FaLayerGroup className="inline mr-2" />
                                                Ceiling Plan
                                            </button>
                                            <button
                                                onClick={() => projectDetails.setCurrentView('floor-plan')}
                                                disabled={!projectDetails.rooms || projectDetails.rooms.length === 0 || !projectDetails.rooms.some(room => room.floor_type === 'panel' || room.floor_type === 'Panel')}
                                                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                                                    (!projectDetails.rooms || projectDetails.rooms.length === 0 || !projectDetails.rooms.some(room => room.floor_type === 'panel' || room.floor_type === 'Panel'))
                                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                        : projectDetails.currentView === 'floor-plan'
                                                        ? 'bg-green-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <FaSquare className="inline mr-2" />
                                                Floor Plan
                                                {projectDetails.rooms && projectDetails.rooms.length > 0 && (
                                                    <span className="ml-1 text-xs">
                                                        ({projectDetails.rooms.filter(room => room.floor_type === 'panel' || room.floor_type === 'Panel').length} panel rooms)
                                                    </span>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => projectDetails.setCurrentView('installation-estimator')}
                                                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                                                    projectDetails.currentView === 'installation-estimator'
                                                        ? 'bg-orange-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                Project Summary & Installation Time
                                            </button>
                                        </div>
                                        <div className="text-sm text-gray-600">
                                            {projectDetails.currentView === 'wall-plan' 
                                                ? ''
                                                : projectDetails.currentView === 'ceiling-plan'
                                                ? 'Generate and manage ceiling panels for optimal coverage'
                                                : projectDetails.currentView === 'floor-plan'
                                                ? 'Generate and manage floor panels with wall thickness deduction (only for rooms with floor_type = "panel")'
                                                : projectDetails.currentView === 'installation-estimator'
                                                ? 'Comprehensive project overview with installation time calculations'
                                                : 'Click and drag to navigate, use scroll to zoom'
                                            }
                                            {projectDetails.rooms && projectDetails.rooms.length > 0 && !projectDetails.rooms.some(room => room.floor_type === 'panel' || room.floor_type === 'Panel') && projectDetails.currentView === 'floor-plan' && (
                                                <span className="text-orange-600 font-medium ml-2">
                                                    ⚠️ No rooms with panel floors found
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Tab Content */}
                                <div className="relative">
                                    {projectDetails.currentView === 'wall-plan' ? (
                                        <Canvas2D
                                            key={`canvas-${projectDetails.walls.length}`}
                                            walls={projectDetails.walls}
                                            setWalls={projectDetails.setWalls}
                                            joints={projectDetails.joints}
                                            intersections={projectDetails.joints}
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
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                        />
                                    ) : projectDetails.currentView === 'floor-plan' ? (
                                        <FloorManager
                                            projectId={projectId}
                                            onClose={() => projectDetails.setCurrentView('wall-plan')}
                                            onFloorPlanGenerated={(floorPlan) => {
                                                console.log('Floor plan generated:', floorPlan);
                                            }}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                        />
                                    ) : projectDetails.currentView === 'installation-estimator' ? (
                                        <InstallationTimeEstimator
                                            projectId={projectId}
                                            sharedPanelData={projectDetails.getAllPanelData()}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                            updateCanvasImage={projectDetails.updateCanvasImage}
                                            setCurrentView={projectDetails.setCurrentView}
                                            isCapturingImages={isCapturingImages}
                                            setIsCapturingImages={setIsCapturingImages}
                                            captureSuccess={captureSuccess}
                                            setCaptureSuccess={setCaptureSuccess}
                                        />
                                    ) : (
                                        <CeilingManager
                                            projectId={projectId}
                                            room={projectDetails.rooms && projectDetails.rooms.length > 0 ? projectDetails.rooms[0] : null}
                                            onClose={() => projectDetails.setCurrentView('wall-plan')}
                                            onCeilingPlanGenerated={(ceilingPlan) => {
                                                console.log('Ceiling plan generated:', ceilingPlan);
                                            }}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                            sharedPanelData={projectDetails.sharedPanelData}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>



            {/* Modals and Overlays */}
                {/* Wall Editor Modal */}
                    {projectDetails.selectedWall !== null && projectDetails.currentMode === 'edit-wall' && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4">
                                <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Edit Wall</h3>
                                    <button 
                                        onClick={() => {
                                            projectDetails.setSelectedWall(null);
                                            projectDetails.setCurrentMode(null);
                                        }}
                                className="text-gray-400 hover:text-gray-600 focus-ring"
                                    >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                    </button>
                                </div>
                        {/* Wall editor content */}
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
                                                    for (const wall of projectDetails.walls) {
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
                        wall={projectDetails.walls.find(w => w.id === (projectDetails.editingDoor.linked_wall || projectDetails.editingDoor.wall_id))}
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

            {/* Notification Banners */}
            {/* Database Connection Error */}
            {projectDetails.dbConnectionError && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Database connection failed. Please try again later.</span>
                    </div>
                </div>
            )}

            {/* Wall Delete Confirmation */}
            {projectDetails.showWallDeleteConfirm && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-6 py-4 rounded-lg shadow-lg notification">
                    <div className="flex items-center gap-4">
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Are you sure you want to delete this wall?</span>
                        <div className="flex gap-2">
                                                            <button 
                                    onClick={projectDetails.handleConfirmWallDelete} 
                                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium btn-danger"
                                >
                                    Delete
                                </button>
                                <button 
                                    onClick={projectDetails.handleCancelWallDelete} 
                                    className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 transition-colors font-medium btn-secondary"
                                >
                                    Cancel
                                </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Messages */}
            {projectDetails.wallDeleteSuccess && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Wall deleted successfully!</span>
                    </div>
                </div>
            )}

            {projectDetails.roomCreateSuccess && (
                <div className="fixed top-40 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Room created successfully!</span>
                </div>
                </div>
            )}

            {/* Error Messages */}
            {projectDetails.roomError && (
                <div className="fixed top-48 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">{projectDetails.roomError}</span>
                    </div>
                </div>
            )}

            {projectDetails.projectLoadError && (
                <div className="fixed top-56 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{projectDetails.projectLoadError}</span>
                    </div>
                </div>
            )}


        </div>
    );
};

export default ProjectDetails;