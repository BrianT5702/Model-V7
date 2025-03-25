import React, { useState, useEffect } from 'react';

const RoomManager = ({ 
    projectId, 
    walls, 
    onSaveRoom, 
    onUpdateRoom,
    onDeleteRoom,
    selectedWallIds = [], 
    editingRoom = null,
    isEditMode = false,
    onClose 
}) => {
    const [roomName, setRoomName] = useState('');
    const [floorType, setFloorType] = useState('');
    const [floorThickness, setFloorThickness] = useState('');
    const [temperature, setTemperature] = useState('');
    const [remarks, setRemarks] = useState('');
    const [displayWalls, setDisplayWalls] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        if (editingRoom) {
            setRoomName(editingRoom.room_name);
            setFloorType(editingRoom.floor_type);
            setFloorThickness(editingRoom.floor_thickness);
            setRemarks(editingRoom.remarks);
            setTemperature(editingRoom.temperature || '');
        }
    }, [editingRoom]);

    useEffect(() => {
        const wallDetails = selectedWallIds.map(id => {
            const wall = walls.find(w => w.id === id);
            return {
                id,
                startPoint: wall ? `(${wall.start_x.toFixed(2)}, ${wall.start_y.toFixed(2)})` : 'unknown',
                endPoint: wall ? `(${wall.end_x.toFixed(2)}, ${wall.end_y.toFixed(2)})` : 'unknown'
            };
        });
        setDisplayWalls(wallDetails);
    }, [selectedWallIds, walls]);

    const handleSave = () => {
        const roomData = {
            room_name: roomName,
            floor_type: floorType,
            floor_thickness: floorThickness,
            temperature: temperature,
            remarks: remarks,
            walls: selectedWallIds,
            project: projectId,
        };
    
        if (isEditMode && editingRoom) {
            onUpdateRoom({ ...roomData, id: editingRoom.id });
        } else {
            onSaveRoom(roomData);
        }
    };    

    const handleDelete = () => {
        if (editingRoom && onDeleteRoom) {
            onDeleteRoom(editingRoom.id);
            onClose();
        }
    };

    return (
        <div className="bg-gray-50 p-6">
            <div className="max-w-5xl mx-auto bg-white rounded-lg shadow-lg">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <h1 className="text-2xl font-bold text-gray-900">
                        {isEditMode ? 'Edit Room' : 'Create New Room'}
                    </h1>
                </div>
                
                <div className="p-6">
                    {/* Main Form Section - Two Columns Layout */}
                    <div className="grid grid-cols-2 gap-6">
                        {/* Left Column - Room Details */}
                        <div className="space-y-4">
                            {/* Room Details Section */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-gray-700">Room Name</label>
                                    <input
                                        type="text"
                                        value={roomName}
                                        onChange={(e) => setRoomName(e.target.value)}
                                        placeholder="Enter room name"
                                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700">Temperature</label>
                                    <div className="mt-1 relative">
                                        <input
                                            type="number"
                                            value={temperature}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                setTemperature(value !== '' ? Math.max(-50, Math.min(50, value)) : '');
                                            }}
                                            placeholder="Enter temperature"
                                            className="block w-full rounded-md border border-gray-300 px-3 py-2 pr-12 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">°C</span>
                                    </div>
                                </div>
                            </div>

                            {/* Floor Details Section */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-gray-700">Floor Type</label>
                                    <select
                                        value={floorType}
                                        onChange={(e) => setFloorType(e.target.value)}
                                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Select Type</option>
                                        <option value="Slab">Slab</option>
                                        <option value="Panel">Panel</option>
                                        <option value="None">None</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-gray-700">Thickness</label>
                                    <select
                                        value={floorThickness}
                                        onChange={(e) => setFloorThickness(e.target.value)}
                                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Select mm</option>
                                        {[50, 75, 100, 125, 150, 175, 200].map(value => (
                                            <option key={value} value={value}>{value} mm</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Remarks Section */}
                            <div>
                                <label className="text-sm font-medium text-gray-700">Remarks</label>
                                <textarea
                                    value={remarks}
                                    onChange={(e) => setRemarks(e.target.value)}
                                    placeholder="Add any additional notes here"
                                    rows="2"
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        {/* Right Column - Selected Walls */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-medium text-gray-900">Selected Walls</h3>
                                <span className="text-sm text-gray-500">({displayWalls.length})</span>
                            </div>
                            <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-48 overflow-y-auto">
                                {displayWalls.length > 0 ? (
                                    <div className="divide-y divide-gray-200">
                                        {displayWalls.map(wall => (
                                            <div
                                                key={wall.id}
                                                className="p-2 hover:bg-blue-50 transition-colors duration-150"
                                            >
                                                <span className="text-sm text-gray-700">Wall ID: {wall.id}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center">
                                        <p className="text-gray-500">No walls selected</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-4 mt-6 pt-4 border-t border-gray-200">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        {isEditMode && (
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                            >
                                Delete Room
                            </button>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={displayWalls.length === 0}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                        >
                            {isEditMode ? 'Update Room' : 'Save Room'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                        <h3 className="text-lg font-semibold text-gray-900">Delete Room</h3>
                        <p className="mt-2 text-sm text-gray-500">
                            Are you sure you want to delete this room? This action cannot be undone.
                        </p>
                        <div className="mt-6 flex justify-end gap-4">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RoomManager;