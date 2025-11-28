import React from 'react';
import useRoomForm from './useRoomForm';
import { calculateMinWallHeight } from '../../api/api';

const RoomManager = ({ 
    projectId, 
    walls, 
    storeys = [],
    activeStoreyId = null,
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
        walls,
        storeys,
        activeStoreyId
    });

    return (
        <div className="space-y-6">
                    {/* Main Form Section - Two Columns Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
                        {/* Left Column - Room Details */}
                        <div className="space-y-6">
                            {/* Basic Information Section */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">Basic Information</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                                    <div>
                                        <label className="text-sm font-medium text-gray-700">Room Name</label>
                                        <input
                                            type="text"
                                            value={form.roomName}
                                            onChange={(e) => {
                                                form.setRoomName(e.target.value);
                                                form.clearValidationError('roomName');
                                            }}
                                            placeholder="Enter room name"
                                            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 ${
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
                                        <label className="text-sm font-medium text-gray-700">Temperature</label>
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
                                                className={`block w-full rounded-lg border px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 ${
                                                    form.validationErrors.temperature 
                                                        ? 'border-red-300 focus:border-red-500' 
                                                        : 'border-gray-300 focus:border-blue-500'
                                                }`}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">°C</span>
                                        </div>
                                        {form.validationErrors.temperature && (
                                            <p className="text-xs text-red-500 mt-1">{form.validationErrors.temperature}</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Floor Details Section */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">Floor Properties</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                                    <div>
                                        <label className="text-sm font-medium text-gray-700">Floor Type</label>
                                        <select
                                            value={form.floorType}
                                            onChange={(e) => {
                                                form.setFloorType(e.target.value);
                                                form.clearValidationError('floorType');
                                            }}
                                            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 ${
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
                                        <label className="text-sm font-medium text-gray-700">Thickness (mm)</label>
                                        <select
                                            value={form.floorThickness}
                                            onChange={(e) => {
                                                form.setFloorThickness(e.target.value);
                                                form.clearValidationError('floorThickness');
                                            }}
                                            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 ${
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
                                    <div>
                                        <label className="text-sm font-medium text-gray-700">Layers</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={form.floorLayers}
                                            onChange={(e) => {
                                                const value = parseInt(e.target.value) || 1;
                                                form.setFloorLayers(Math.max(1, value));
                                                form.clearValidationError('floorLayers');
                                            }}
                                            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 ${
                                                form.validationErrors.floorLayers 
                                                    ? 'border-red-300 focus:border-red-500' 
                                                    : 'border-gray-300 focus:border-blue-500'
                                            }`}
                                            placeholder="1"
                                        />
                                        {form.floorThickness && form.floorThickness !== '0' && form.floorThickness !== '' && (
                                            <p className="text-xs text-blue-600 mt-1 font-medium">
                                                Total: {form.floorThickness * form.floorLayers} mm
                                            </p>
                                        )}
                                        {form.validationErrors.floorLayers && (
                                            <p className="text-xs text-red-500 mt-1">{form.validationErrors.floorLayers}</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Room Dimensions Section */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">Room Dimensions</h4>
                                <div className="space-y-4 mt-3">
                                    <div>
                                        <label className="text-sm font-medium text-gray-700">Room Height (mm)</label>
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
                                                className={`block w-full rounded-lg border px-3 py-2 pr-14 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 ${
                                                    form.validationErrors.roomHeight 
                                                        ? 'border-red-300 focus:border-red-500' 
                                                        : 'border-gray-300 focus:border-blue-500'
                                                }`}
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">mm</span>
                                        </div>
                                        {form.validationErrors.roomHeight && (
                                            <p className="text-xs text-red-500 mt-1">{form.validationErrors.roomHeight}</p>
                                        )}
                                        {form.roomHeight && (
                                            <p className="text-xs text-blue-600 mt-1 font-medium">
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
                                                className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline font-medium"
                                            >
                                                Use minimum wall height ({Math.min(...walls.filter(w => selectedWallIds.includes(w.id)).map(w => w.height))} mm)
                                            </button>
                                        )}
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium text-gray-700">Base Elevation (mm)</label>
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
                                                className="block w-full rounded-lg border border-gray-300 px-3 py-2 pr-14 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">mm</span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">
                                            Positive = raised, Negative = sunken from ground level
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {[-300, -150, 0, 150, 300].map(value => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    onClick={() => form.setBaseElevation(value.toString())}
                                                    className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
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
                                </div>
                            </div>

                            {/* Remarks Section */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b border-gray-200">Additional Notes</h4>
                                <textarea
                                    value={form.remarks}
                                    onChange={(e) => form.setRemarks(e.target.value)}
                                    placeholder="Add any additional notes here..."
                                    rows="3"
                                    className="mt-3 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        {/* Right Column - Selected Points and Walls */}
                        <div className="space-y-6">
                            {/* Selected Points Section */}
                            <div>
                                <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                                    <h4 className="text-sm font-semibold text-gray-700">Selected Points</h4>
                                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">{selectedPolygonPoints.length}</span>
                                </div>
                                <div className={`bg-white border rounded-lg shadow-sm h-40 overflow-y-auto mt-3 ${
                                    form.validationErrors.polygonPoints ? 'border-red-300' : 'border-gray-200'
                                }`}>
                                    {selectedPolygonPoints.length > 0 ? (
                                        <div className="divide-y divide-gray-200">
                                            {selectedPolygonPoints.map((pt, index) => (
                                                <div
                                                    key={index}
                                                    className="p-2 hover:bg-blue-50 transition-colors duration-150"
                                                >
                                                    <span className="text-sm text-gray-700 font-mono">
                                                        Point {index + 1}: ({pt.x.toFixed(2)}, {pt.y.toFixed(2)})
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="h-full flex items-center justify-center">
                                            <p className="text-sm text-gray-500">No points selected</p>
                                        </div>
                                    )}
                                </div>
                                {form.validationErrors.polygonPoints && (
                                    <p className="text-xs text-red-500 mt-1">{form.validationErrors.polygonPoints}</p>
                                )}
                            </div>
                            
                            {/* Auto-detected Walls Section */}
                            {selectedWallIds.length > 0 && (
                                <div>
                                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                                        <h4 className="text-sm font-semibold text-gray-700">Auto-detected Walls</h4>
                                        <span className="text-xs text-gray-500 bg-green-100 px-2 py-1 rounded-full">{selectedWallIds.length}</span>
                                    </div>
                                    <div className="bg-green-50 border border-green-200 rounded-lg shadow-sm h-40 overflow-y-auto mt-3">
                                        <div className="divide-y divide-green-200">
                                            {selectedWallIds.map((wallId) => {
                                                const wall = walls.find(w => w.id === wallId);
                                                return (
                                                    <div key={wallId} className="p-2 hover:bg-green-100 transition-colors duration-150">
                                                        <span className="text-sm text-gray-700 font-mono">
                                                            Wall {wallId}: ({wall?.start_x?.toFixed(2) || '?'}, {wall?.start_y?.toFixed(2) || '?'}) → ({wall?.end_x?.toFixed(2) || '?'}, {wall?.end_y?.toFixed(2) || '?'})
                                                        </span>
                                                        <div className="text-xs text-gray-600 mt-0.5">
                                                            Height: {wall?.height || '?'} mm
                                                        </div>
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
                    <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t border-gray-200">
                        <button
                            onClick={onClose}
                            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            Cancel
                        </button>
                        {isEditMode && (
                            <button
                                onClick={() => form.setShowDeleteConfirm(true)}
                                className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                            >
                                Delete Room
                            </button>
                        )}
                        <button
                            onClick={form.handleSave}
                            className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                            disabled={!form.isFormValid()}
                        >
                            {isEditMode ? 'Update Room' : 'Save Room'}
                        </button>
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