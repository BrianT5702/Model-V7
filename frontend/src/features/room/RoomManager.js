import React from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import useRoomForm from './useRoomForm';
import { calculateMinWallHeight } from '../../api/api';

function Field({ label, error, hint, children, className = '' }) {
    return (
        <div className={className}>
            {label && <label className="room-form-label">{label}</label>}
            {children}
            {error && <p className="room-form-error">{error}</p>}
            {!error && hint && <p className="room-form-hint">{hint}</p>}
        </div>
    );
}

function inputClass(hasError) {
    return `room-form-control${hasError ? ' room-form-control-error' : ''}`;
}

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
        onSave,
        onUpdate: onSave,
        onDelete,
        onClose,
        projectId,
        selectedWallIds,
        selectedPolygonPoints,
        walls,
        storeys,
        activeStoreyId
    });

    const showGeometry = !isEditMode && (selectedPolygonPoints.length > 0 || selectedWallIds.length > 0);
    const minWallHeight = selectedWallIds.length > 0
        ? Math.min(...walls.filter(w => selectedWallIds.includes(w.id)).map(w => w.height))
        : null;

    return (
        <div className="room-form">
            <div className="room-form-body">
                {showGeometry && (
                    <div className="room-form-card">
                        <h3 className="room-form-card-title">Room outline</h3>
                        {selectedPolygonPoints.length > 0 && (
                            <div className="mb-3">
                                <p className="text-xs font-medium text-gray-600 mb-1.5">
                                    Points ({selectedPolygonPoints.length})
                                </p>
                                <div className={`room-form-geometry ${form.validationErrors.polygonPoints ? 'border-red-300' : ''}`}>
                                    {selectedPolygonPoints.map((pt, index) => (
                                        <p key={index} className="text-xs font-mono text-gray-700 py-0.5">
                                            {index + 1}. ({pt.x.toFixed(0)}, {pt.y.toFixed(0)})
                                        </p>
                                    ))}
                                </div>
                                {form.validationErrors.polygonPoints && (
                                    <p className="room-form-error">{form.validationErrors.polygonPoints}</p>
                                )}
                            </div>
                        )}
                        {selectedWallIds.length > 0 && (
                            <div>
                                <p className="text-xs font-medium text-gray-600 mb-1.5">
                                    Walls ({selectedWallIds.length})
                                </p>
                                <div className="room-form-geometry border-green-200 bg-green-50/50">
                                    {selectedWallIds.map((wallId) => {
                                        const wall = walls.find(w => w.id === wallId);
                                        return (
                                            <p key={wallId} className="text-xs text-gray-700 py-0.5">
                                                Wall {wallId} · {wall?.height ?? '?'} mm
                                            </p>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="room-form-card">
                    <h3 className="room-form-card-title">Room details</h3>
                    <div className="room-form-row">
                        <Field label="Room name" error={form.validationErrors.roomName}>
                            <input
                                type="text"
                                value={form.roomName}
                                onChange={(e) => {
                                    form.setRoomName(e.target.value);
                                    form.clearValidationError('roomName');
                                }}
                                placeholder="e.g. Cold Room 1"
                                className={inputClass(!!form.validationErrors.roomName)}
                            />
                        </Field>
                        <Field
                            label="Temperature (°C)"
                            hint="Single value or range, e.g. 5 or 2 - 6"
                            error={form.validationErrors.temperature}
                        >
                            <input
                                type="text"
                                value={form.temperature}
                                onChange={(e) => {
                                    form.setTemperature(e.target.value);
                                    form.clearValidationError('temperature');
                                }}
                                placeholder="e.g. 5 or 2 - 6"
                                className={inputClass(!!form.validationErrors.temperature)}
                            />
                        </Field>
                    </div>
                    <Field
                        label="Room height (mm)"
                        hint="Single value or range (5000-6000). Values ≤50 are treated as metres."
                        error={form.validationErrors.roomHeight}
                    >
                        <input
                            type="text"
                            value={form.roomHeight}
                            onChange={(e) => {
                                form.setRoomHeight(e.target.value);
                                form.clearValidationError('roomHeight');
                            }}
                            placeholder="e.g. 3000 or 5000-6000"
                            className={inputClass(!!form.validationErrors.roomHeight)}
                        />
                        {minWallHeight != null && (
                            <button
                                type="button"
                                onClick={() => {
                                    calculateMinWallHeight(selectedWallIds)
                                        .then((response) => {
                                            if (response.data.min_height) {
                                                form.setRoomHeight(response.data.min_height);
                                            }
                                        })
                                        .catch((error) => {
                                            console.error('Error calculating minimum wall height:', error);
                                        });
                                }}
                                className="mt-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                                Use minimum wall height ({minWallHeight} mm)
                            </button>
                        )}
                    </Field>
                    <label className="flex items-start gap-2 cursor-pointer rounded border border-gray-200 bg-gray-50/80 px-2 py-1.5">
                        <input
                            type="checkbox"
                            checked={form.allowVariableWallHeights}
                            onChange={(e) => form.setAllowVariableWallHeights(e.target.checked)}
                            className="mt-0.5 h-3.5 w-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-[11px] text-gray-700 leading-snug">
                            <span className="font-medium">Variable wall heights</span>
                            <span className="block text-[10px] text-gray-500">
                                Sloped roofs — room height won&apos;t update walls.
                            </span>
                        </span>
                    </label>
                    <Field
                        label="Base elevation (mm)"
                        hint={`Default: ${form.defaultBaseElevationMm} mm (active level)`}
                    >
                        <div className="relative max-w-xs">
                            <input
                                type="text"
                                inputMode="numeric"
                                value={form.baseElevation}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === '' || value === '-' || /^-?\d*\.?\d*$/.test(value)) {
                                        form.setBaseElevation(value);
                                    }
                                }}
                                onBlur={() => {
                                    const value = form.baseElevation;
                                    if (value === '' || value === '-') {
                                        form.setBaseElevation(form.defaultBaseElevationMm);
                                    } else {
                                        const numValue = parseFloat(value);
                                        form.setBaseElevation(
                                            Number.isNaN(numValue) ? form.defaultBaseElevationMm : numValue
                                        );
                                    }
                                }}
                                placeholder={String(form.defaultBaseElevationMm)}
                                className={`${inputClass(false)} pr-10`}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">mm</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {[-300, -150, 0, 150, 300].map((value) => {
                                const selected =
                                    form.baseElevation === value.toString()
                                    || (value === 0 && (form.baseElevation === '0' || form.baseElevation === 0));
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => form.setBaseElevation(value.toString())}
                                        className={`px-1.5 py-0.5 text-[10px] rounded border font-medium transition-colors ${
                                            selected
                                                ? 'bg-blue-600 border-blue-600 text-white'
                                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                        }`}
                                    >
                                        {value > 0 ? `+${value}` : value}
                                    </button>
                                );
                            })}
                        </div>
                    </Field>
                </div>

                <div className="room-form-card">
                    <h3 className="room-form-card-title">Floor</h3>
                    <div className="room-form-row-3">
                        <Field label="Type" error={form.validationErrors.floorType}>
                            <select
                                value={form.floorType}
                                onChange={(e) => {
                                    form.setFloorType(e.target.value);
                                    form.clearValidationError('floorType');
                                }}
                                className={inputClass(!!form.validationErrors.floorType)}
                            >
                                <option value="">Select…</option>
                                <option value="Slab">Slab</option>
                                <option value="Panel">Panel</option>
                                <option value="None">None</option>
                            </select>
                        </Field>
                        <Field label="Thickness" error={form.validationErrors.floorThickness}>
                            <select
                                value={form.floorThickness}
                                onChange={(e) => {
                                    form.setFloorThickness(e.target.value);
                                    form.clearValidationError('floorThickness');
                                }}
                                className={inputClass(!!form.validationErrors.floorThickness)}
                            >
                                <option value="">Select…</option>
                                {[0, 50, 75, 100, 125, 150, 175, 200].map((value) => (
                                    <option key={value} value={value}>
                                        {value === 0 ? 'None' : `${value} mm`}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field
                            label="Layers"
                            hint={
                                form.floorThickness && form.floorThickness !== '0' && form.floorThickness !== ''
                                    ? `Total ${form.floorThickness * form.floorLayers} mm`
                                    : undefined
                            }
                            error={form.validationErrors.floorLayers}
                        >
                            <input
                                type="number"
                                min="1"
                                value={form.floorLayers}
                                onChange={(e) => {
                                    const value = parseInt(e.target.value, 10) || 1;
                                    form.setFloorLayers(Math.max(1, value));
                                    form.clearValidationError('floorLayers');
                                }}
                                className={inputClass(!!form.validationErrors.floorLayers)}
                            />
                        </Field>
                    </div>
                </div>

                <div className="room-form-card">
                    <h3 className="room-form-card-title">Notes</h3>
                    <textarea
                        value={form.remarks}
                        onChange={(e) => form.setRemarks(e.target.value)}
                        placeholder="Optional remarks…"
                        rows={2}
                        className="room-form-control min-h-[2.75rem] py-1 resize-y"
                    />
                </div>
            </div>

            <div className="room-form-footer">
                <button type="button" onClick={onClose} className="form-btn-secondary w-full sm:w-auto">
                    Cancel
                </button>
                {isEditMode && (
                    <button
                        type="button"
                        onClick={() => form.setShowDeleteConfirm(true)}
                        className="form-btn-danger w-full sm:w-auto"
                    >
                        Delete
                    </button>
                )}
                <button
                    type="button"
                    onClick={form.handleSave}
                    className="form-btn-primary w-full sm:w-auto"
                    disabled={!form.isFormValid()}
                >
                    {isEditMode ? 'Save changes' : 'Create room'}
                </button>
            </div>

            {form.showDeleteConfirm && (
                <ModalOverlay className="bg-black/50 flex items-center justify-center z-[12000]">
                    <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-5">
                        <h3 className="text-base font-semibold text-gray-900">Delete room?</h3>
                        <p className="text-sm text-gray-500 mt-1">This cannot be undone.</p>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => form.setShowDeleteConfirm(false)}
                                className="form-btn-secondary"
                            >
                                Cancel
                            </button>
                            <button type="button" onClick={form.handleDelete} className="form-btn-danger">
                                Delete
                            </button>
                        </div>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
};

export default RoomManager;
