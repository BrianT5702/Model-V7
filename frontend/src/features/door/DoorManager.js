import React, { useState, useEffect } from 'react';

const DoorManager = ({
  projectId,
  wall,
  onSaveDoor,
  onUpdateDoor,
  editingDoor = null,
  isEditMode = false,
  onDeleteDoor,
  onClose,
  activeStoreyId = null,
  activeStoreyName = ''
}) => {
  // Local state for all door fields
  const [doorType, setDoorType] = useState('swing');
  const [configuration, setConfiguration] = useState('single');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [thickness, setThickness] = useState('');
  const [side, setSide] = useState('interior');
  const [swingDirection, setSwingDirection] = useState('right');
  const [slideDirection, setSlideDirection] = useState('right');
  const [localPosition, setLocalPosition] = useState(0.5);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dbConnectionError, setDbConnectionError] = useState(false);
  const [validationError, setValidationError] = useState("");

  // Derived wall length to support distance inputs
  const getWallLength = () => {
    if (!wall) return 0;
    const dx = (wall.end_x || 0) - (wall.start_x || 0);
    const dy = (wall.end_y || 0) - (wall.start_y || 0);
    return Math.hypot(dx, dy);
  };
  const wallLength = getWallLength();

  // Pre-fill in edit mode, reset in add mode
  useEffect(() => {
    if (isEditMode && editingDoor) {
      setDoorType(editingDoor.door_type);
      setConfiguration(editingDoor.configuration?.includes('double') ? 'double' : 'single');
      setWidth(editingDoor.width);
      setHeight(editingDoor.height);
      setThickness(editingDoor.thickness);
      setSide(editingDoor.side || 'interior');
      setSwingDirection(editingDoor.swing_direction || 'right');
      setSlideDirection(editingDoor.slide_direction || 'right');
      setLocalPosition(editingDoor.position_x || 0.5);
    } else if (!isEditMode && wall) {
      setDoorType('swing');
      setConfiguration('single');
      setWidth('');
      setHeight('');
      setThickness('');
      setSide('interior');
      setSwingDirection('right');
      setSlideDirection('right');
      setLocalPosition(0.5);
    }
  }, [editingDoor, isEditMode, wall]);

  const handleSave = () => {
    let wallId = wall?.id;
    if (isEditMode && editingDoor) {
      wallId = editingDoor.linked_wall || editingDoor.wall_id;
    }
    if (!wallId || !projectId) {
      setValidationError("Missing wall or project ID");
      setTimeout(() => setValidationError(""), 4000);
      return;
    }
    if (!width || !height || !thickness) {
      setValidationError("Please fill in all required dimensions (width, height, thickness).");
      setTimeout(() => setValidationError(""), 4000);
      return;
    }
    // Validate that dimensions are greater than 0
    const widthValue = parseFloat(width);
    const heightValue = parseFloat(height);
    const thicknessValue = parseFloat(thickness);
    if (widthValue <= 0 || heightValue <= 0 || thicknessValue <= 0) {
      setValidationError("Width, Height, and Thickness must be greater than 0");
      setTimeout(() => setValidationError(""), 4000);
      return;
    }
    const doorData = {
      project: projectId,
      wall: wallId,
      door_type: doorType,
      configuration: configuration === "single" ? "single_sided" : "double_sided",
      width: widthValue,
      height: heightValue,
      thickness: thicknessValue,
      position_x: localPosition,
      position_y: 0,
      swing_direction: swingDirection,
      slide_direction: slideDirection,
      side: side,
      storey: activeStoreyId
    };
    if (isEditMode && editingDoor) {
      onUpdateDoor({ ...doorData, id: editingDoor.id });
    } else {
      onSaveDoor({ ...doorData, linked_wall: wallId });
    }
  };

  const handleDelete = () => {
    if (editingDoor?.id && onDeleteDoor) {
      setShowDeleteConfirm(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (editingDoor?.id && onDeleteDoor) {
      try {
        await onDeleteDoor(editingDoor.id);
        setShowDeleteConfirm(false);
      } catch (error) {
        setDbConnectionError(true);
        setTimeout(() => setDbConnectionError(false), 5000);
      }
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleTypeChange = (e) => {
    const newType = e.target.value;
    setDoorType(newType);
    if (newType === 'swing') {
      setSwingDirection('right');
      setSlideDirection('');
    } else {
      setSlideDirection('right');
      setSwingDirection('');
    }
  };

  const handleConfigChange = (e) => {
    setConfiguration(e.target.value);
  };

  const handleFlipDirection = () => {
    if (doorType === 'swing') {
      setSwingDirection(swingDirection === 'left' ? 'right' : 'left');
    } else {
      setSlideDirection(slideDirection === 'left' ? 'right' : 'left');
    }
  };

  const handleFlipSide = () => {
    setSide(side === 'interior' ? 'exterior' : 'interior');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg">
        <h2 className="text-lg font-bold mb-4">
          {isEditMode ? 'Edit Door' : 'Add New Door'}
        </h2>

        <div className="mb-4 text-sm text-gray-600">
          <span className="font-medium text-gray-700">Storey:</span>{' '}
          {activeStoreyName || (activeStoreyId ? `Level ${activeStoreyId}` : 'Not set')}
        </div>

        {validationError && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">{validationError}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Type</label>
            <select value={doorType} onChange={handleTypeChange} className="input">
              <option value="swing">Swing</option>
              <option value="slide">Slide</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Configuration</label>
            <select value={configuration} onChange={handleConfigChange} className="input">
              <option value="single">Single</option>
              <option value="double">Double</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Width (mm)</label>
            <input 
              type="number" 
              value={width} 
              onChange={e => setWidth(e.target.value)} 
              min="100"
              step="100"
              className="input" 
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Height (mm)</label>
            <input 
              type="number" 
              value={height} 
              onChange={e => setHeight(e.target.value)} 
              min="100"
              step="100"
              className="input" 
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Thickness (mm)</label>
            <input 
              type="number" 
              value={thickness} 
              onChange={e => setThickness(e.target.value)} 
              min="25"
              step="25"
              className="input" 
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="text-sm font-medium text-gray-700">Position on wall</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={localPosition}
            onChange={e => setLocalPosition(parseFloat(e.target.value))}
            className="w-full mt-1"
          />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className="text-xs text-gray-600">Distance from left (mm)</span>
              <input
                type="number"
                value={Math.round((localPosition || 0) * wallLength) || 0}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(wallLength, Number(e.target.value) || 0));
                  const newPos = wallLength > 0 ? v / wallLength : 0;
                  setLocalPosition(Number.isFinite(newPos) ? newPos : 0);
                }}
                min="0"
                max={Math.max(0, Math.round(wallLength))}
                step="1"
                className="input"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Distance from right (mm)</span>
              <input
                type="number"
                value={Math.max(0, Math.round(wallLength - (localPosition || 0) * wallLength)) || 0}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(wallLength, Number(e.target.value) || 0));
                  const left = Math.max(0, wallLength - v);
                  const newPos = wallLength > 0 ? left / wallLength : 0;
                  setLocalPosition(Number.isFinite(newPos) ? newPos : 0);
                }}
                min="0"
                max={Math.max(0, Math.round(wallLength))}
                step="1"
                className="input"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 rounded hover:bg-gray-200">Cancel</button>
          {isEditMode && (
            <button onClick={handleDelete} className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600">
              Delete
            </button>
          )}
          <button onClick={handleSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            {isEditMode ? 'Update Door' : 'Add Door'}
          </button>
        </div>

        {showDeleteConfirm && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded shadow-lg flex items-center gap-4">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Are you sure you want to delete this door?</span>
            <button onClick={handleConfirmDelete} className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Yes, Delete</button>
            <button onClick={handleCancelDelete} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
          </div>
        )}

        {dbConnectionError && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">Fail to connect to database. Try again later.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DoorManager;
