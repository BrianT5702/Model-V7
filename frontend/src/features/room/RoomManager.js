import React from 'react';
import useRoomForm from './useRoomForm';
import { calculateMinWallHeight } from '../../api/api';

const RoomManager = ({ 
    projectId, 
    walls, 
    onSave, 
    onDelete,
    onClose,
    selectedWallIds = [], 
    editingRoom = null,
    selectedPolygonPoints = []
}) => {
    const isEditMode = !!editingRoom;
    const form = useRoomForm({
        initialRoom: editingRoom,
        isEditMode,
        onSave: onSave,
        onUpdate: onSave, // Use onSave for both create and update
        onDelete: onDelete,
        onClose,
        projectId,
        selectedWallIds,
        selectedPolygonPoints,
        walls
    });

    return (
        <div className="bg-gray-50 p-4">
            <div className="max-w-5xl mx-auto bg-white rounded-lg shadow-lg">
                {/* Header */}
                <div className="px-4 py-2 border-b border-gray-200">
                    <h1 className="text-xl font-bold text-gray-900">
                        {isEditMode ? 'Edit Room' : 'Create New Room'}
                    </h1>
                </div>
                
                <div className="p-4">
                    {/* Main Form Section - Two Columns Layout */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Left Column - Room Details */}
                        <div className="space-y-3">
                            {/* Room Details Section */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-700">Room Name</label>
                                    <input
                                        type="text"
                                        value={form.roomName}
                                        onChange={(e) => {
                                            form.setRoomName(e.target.value);
                                            form.clearValidationError('roomName');
                                        }}
                                        placeholder="Enter room name"
                                        className={`mt-1 block w-full rounded-md border px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 ${
                                            form.validationErrors.roomName 
                                                ? 'border-red-300 focus:border-red-500' 
                                                : 'border-gray-300 focus:border-blue-500'
                                        }`}
                                    />
                                    {form.validationErrors.roomName && (
                                        <p className="text-xs text-red-500 mt-1">{form.validationErrors.roomName}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-700">Temperature</label>
                                    <div className="mt-1 relative">
                                        <input
                                            type="number"
                                            value={form.temperature}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                form.setTemperature(value !== '' ? Math.max(-50, Math.min(50, value)) : '');
                                                form.clearValidationError('temperature');
                                            }}
                                            placeholder="Enter temperature"
                                            className={`block w-full rounded-md border px-2 py-1 pr-8 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 ${
                                                form.validationErrors.temperature 
                                                    ? 'border-red-300 focus:border-red-500' 
                                                    : 'border-gray-300 focus:border-blue-500'
                                            }`}
                                        />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">°C</span>
                                    </div>
                                    {form.validationErrors.temperature && (
                                        <p className="text-xs text-red-500 mt-1">{form.validationErrors.temperature}</p>
                                    )}
                                </div>
                            </div>

                            {/* Floor Details Section */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-700">Floor Type</label>
                                    <select
                                        value={form.floorType}
                                        onChange={(e) => {
                                            form.setFloorType(e.target.value);
                                            form.clearValidationError('floorType');
                                        }}
                                        className={`mt-1 block w-full rounded-md border px-2 py-1 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 ${
                                            form.validationErrors.floorType 
                                                ? 'border-red-300 focus:border-red-500' 
                                                : 'border-gray-300 focus:border-blue-500'
                                        }`}
                                    >
                                        <option value="">Select Type</option>
                                        <option value="Slab">Slab</option>
                                        <option value="Panel">Panel</option>
                                        <option value="None">None</option>
                                    </select>
                                    {form.validationErrors.floorType && (
                                        <p className="text-xs text-red-500 mt-1">{form.validationErrors.floorType}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-700">Thickness</label>
                                    <select
                                        value={form.floorThickness}
                                        onChange={(e) => {
                                            form.setFloorThickness(e.target.value);
                                            form.clearValidationError('floorThickness');
                                        }}
                                        className={`mt-1 block w-full rounded-md border px-2 py-1 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 ${
                                            form.validationErrors.floorThickness 
                                                ? 'border-red-300 focus:border-red-500' 
                                                : 'border-gray-300 focus:border-blue-500'
                                        }`}
                                    >
                                        <option value="">Select mm</option>
                                        {[0, 50, 75, 100, 125, 150, 175, 200].map(value => (
                                            <option key={value} value={value}>{value === 0 ? 'None' : `${value} mm`}</option>
                                        ))}
                                    </select>
                                    {form.validationErrors.floorThickness && (
                                        <p className="text-xs text-red-500 mt-1">{form.validationErrors.floorThickness}</p>
                                    )}
                                </div>
                            </div>

                            {/* Room Height Section */}
                            <div>
                                <label className="text-xs font-medium text-gray-700">Room Height</label>
                                <div className="mt-1 relative">
                                    <input
                                        type="number"
                                        value={form.roomHeight}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            form.setRoomHeight(value !== '' ? Math.max(0, parseFloat(value) || 0) : '');
                                            form.clearValidationError('roomHeight');
                                        }}
                                        placeholder="Enter room height"
                                        className={`block w-full rounded-md border px-2 py-1 pr-12 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 ${
                                            form.validationErrors.roomHeight 
                                                ? 'border-red-300 focus:border-red-500' 
                                                : 'border-gray-300 focus:border-blue-500'
                                        }`}
                                    />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">mm</span>
                                </div>
                                {form.validationErrors.roomHeight && (
                                    <p className="text-xs text-red-500 mt-1">{form.validationErrors.roomHeight}</p>
                                )}
                                {form.roomHeight && (
                                    <p className="text-xs text-blue-600 mt-1">
                                        This will update all wall heights in the room to {form.roomHeight} mm
                                    </p>
                                )}
                                {selectedWallIds.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            calculateMinWallHeight(selectedWallIds)
                                                .then(response => {
                                                    if (response.data.min_height) {
                                                        form.setRoomHeight(response.data.min_height);
                                                    }
                                                })
                                                .catch(error => {
                                                    console.error('Error calculating minimum wall height:', error);
                                                });
                                        }}
                                        className="mt-1 text-xs text-blue-600 hover:text-blue-800 underline"
                                    >
                                        Use minimum wall height ({Math.min(...walls.filter(w => selectedWallIds.includes(w.id)).map(w => w.height))} mm)
                                    </button>
                                )}
                            </div>

                            {/* Base Elevation Section */}
                            <div>
                                <label className="text-xs font-medium text-gray-700">Base Elevation</label>
                                <div className="mt-1 relative">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={form.baseElevation}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            // Allow empty, minus sign, and valid number patterns
                                            if (value === '' || value === '-') {
                                                form.setBaseElevation(value);
                                            } else if (/^-?\d*\.?\d*$/.test(value)) {
                                                // Allow valid number patterns (including negative)
                                                form.setBaseElevation(value);
                                            }
                                            // If pattern doesn't match, don't update (prevents invalid input)
                                        }}
                                        onBlur={(e) => {
                                            // On blur, ensure we have a valid number
                                            const value = e.target.value;
                                            if (value === '' || value === '-') {
                                                form.setBaseElevation(0);
                                            } else {
                                                const numValue = parseFloat(value);
                                                form.setBaseElevation(isNaN(numValue) ? 0 : numValue);
                                            }
                                        }}
                                        placeholder="0"
                                        className="block w-full rounded-md border border-gray-300 px-2 py-1 pr-12 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">mm</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    Positive = raised, Negative = sunken from ground level
                                </p>
                                <div className="mt-1 flex gap-1">
                                    {[-300, -150, 0, 150, 300].map(value => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => form.setBaseElevation(value.toString())}
                                            className={`px-2 py-0.5 text-xs rounded border ${
                                                form.baseElevation === value.toString() || (value === 0 && (form.baseElevation === '0' || form.baseElevation === 0))
                                                    ? 'bg-blue-100 border-blue-500 text-blue-700'
                                                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                                            }`}
                                        >
                                            {value > 0 ? `+${value}` : value}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Remarks Section */}
                            <div>
                                <label className="text-xs font-medium text-gray-700">Remarks</label>
                                <textarea
                                    value={form.remarks}
                                    onChange={(e) => form.setRemarks(e.target.value)}
                                    placeholder="Add any additional notes here"
                                    rows="2"
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        {/* Right Column - Selected Points and Walls */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-base font-medium text-gray-900">Selected Points</h3>
                                <span className="text-xs text-gray-500">({selectedPolygonPoints.length})</span>
                            </div>
                            <div className={`bg-white border rounded-lg shadow-sm h-32 overflow-y-auto ${
                                form.validationErrors.polygonPoints ? 'border-red-300' : 'border-gray-200'
                            }`}>
                                {selectedPolygonPoints.length > 0 ? (
                                    <div className="divide-y divide-gray-200">
                                        {selectedPolygonPoints.map((pt, index) => (
                                            <div
                                                key={index}
                                                className="p-1 hover:bg-blue-50 transition-colors duration-150"
                                            >
                                                <span className="text-xs text-gray-700">
                                                    Point {index + 1}: ({pt.x.toFixed(2)}, {pt.y.toFixed(2)})
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center">
                                        <p className="text-xs text-gray-500">No points selected</p>
                                    </div>
                                )}
                            </div>
                            {form.validationErrors.polygonPoints && (
                                <p className="text-xs text-red-500 mt-1">{form.validationErrors.polygonPoints}</p>
                            )}
                            
                            {/* Auto-detected Walls Section */}
                            {selectedWallIds.length > 0 && (
                                <div className="mt-3">
                                    <div className="flex items-center justify-between mb-1">
                                        <h3 className="text-base font-medium text-gray-900">Auto-detected Walls</h3>
                                        <span className="text-xs text-gray-500">({selectedWallIds.length})</span>
                                    </div>
                                    <div className="bg-green-50 border border-green-200 rounded-lg shadow-sm h-24 overflow-y-auto">
                                        <div className="divide-y divide-green-200">
                                            {selectedWallIds.map((wallId) => {
                                                const wall = walls.find(w => w.id === wallId);
                                                return (
                                                    <div key={wallId} className="p-1 hover:bg-green-100 transition-colors duration-150">
                                                        <span className="text-xs text-gray-700">
                                                            Wall {wallId}: ({wall?.start_x?.toFixed(2) || '?'}, {wall?.start_y?.toFixed(2) || '?'}) → ({wall?.end_x?.toFixed(2) || '?'}, {wall?.end_y?.toFixed(2) || '?'}) - Height: {wall?.height || '?'} mm
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 mt-4 pt-2 border-t border-gray-200">
                        <button
                            onClick={onClose}
                            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        {isEditMode && (
                            <button
                                onClick={() => form.setShowDeleteConfirm(true)}
                                className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                            >
                                Delete Room
                            </button>
                        )}
                        <button
                            onClick={form.handleSave}
                            className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                            disabled={!form.isFormValid()}
                        >
                            {isEditMode ? 'Update Room' : 'Save Room'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {form.showDeleteConfirm && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-4">
                        <h3 className="text-base font-semibold text-gray-900">Delete Room</h3>
                        <p className="mt-1 text-xs text-gray-500">
                            Are you sure you want to delete this room? This action cannot be undone.
                        </p>
                        <div className="mt-3 flex justify-end gap-3">
                            <button
                                onClick={() => form.setShowDeleteConfirm(false)}
                                className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={form.handleDelete}
                                className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
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