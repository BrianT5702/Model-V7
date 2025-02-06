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
    const [remarks, setRemarks] = useState('');
    const [displayWalls, setDisplayWalls] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    useEffect(() => {
        if (editingRoom) {
            setRoomName(editingRoom.room_name);
            setFloorType(editingRoom.floor_type);
            setFloorThickness(editingRoom.floor_thickness);
            setRemarks(editingRoom.remarks);
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
        <div className="bg-white p-4 rounded-lg shadow-lg">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">
                    {isEditMode ? 'Edit Room' : 'Create New Room'}
                </h2>
            </div>

            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">Room Name</label>
                                <input
                                    type="text"
                                    value={roomName}
                                    onChange={(e) => setRoomName(e.target.value)}
                                    placeholder="Room Name"
                                    className="w-full p-2 border rounded mt-1"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">Floor Type</label>
                                <select
                                    value={floorType}
                                    onChange={(e) => setFloorType(e.target.value)}
                                    className="w-full p-2 border rounded mt-1"
                                >
                                    <option value="">Select Floor Type</option>
                                    <option value="Slab">Slab</option>
                                    <option value="Panel">Panel</option>
                                    <option value="None">None</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Floor Thickness (mm)</label>
                            <select
                                value={floorThickness}
                                onChange={(e) => setFloorThickness(e.target.value)}
                                className="w-full p-2 border rounded mt-1"
                            >
                                <option value="">Select a Floor Thickness</option>
                                <option value="50">50 mm</option>
                                <option value="75">75 mm</option>
                                <option value="100">100 mm</option>
                                <option value="125">125 mm</option>
                                <option value="150">150 mm</option>
                                <option value="175">175 mm</option>
                                <option value="200">200 mm</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Remarks</label>
                            <textarea
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value)}
                                placeholder="Remarks"
                                className="w-full p-2 border rounded mt-1"
                                rows="3"
                            />
                        </div>
                    </div>
                    <div>
                        <h3 className="font-medium mb-2">Selected Walls: {displayWalls.length}</h3>
                        <div className="max-h-48 overflow-y-auto border rounded p-2">
                            {displayWalls.length > 0 ? (
                                displayWalls.map(wall => (
                                    <div key={wall.id} className="p-2 bg-green-100 rounded mb-1">
                                        <div>Wall ID: {wall.id}</div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-500">No walls selected</p>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex gap-2 justify-end mt-4">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 border rounded hover:bg-gray-100"
                    >
                        Cancel
                    </button>
                    {isEditMode && (
                        <button 
                            onClick={() => setShowDeleteConfirm(true)}
                            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                        >
                            Delete Room
                        </button>
                    )}
                    <button 
                        onClick={handleSave}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300"
                        disabled={displayWalls.length === 0}
                    >
                        {isEditMode ? 'Update Room' : 'Save Room'}
                    </button>
                </div>

                {showDeleteConfirm && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                        <div className="bg-white p-4 rounded-lg">
                            <h3 className="text-lg font-semibold mb-2">Delete Room</h3>
                            <p>Are you sure you want to delete this room?</p>
                            <div className="flex gap-2 justify-end mt-4">
                                <button 
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="px-4 py-2 border rounded hover:bg-gray-100"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleDelete}
                                    className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default RoomManager;