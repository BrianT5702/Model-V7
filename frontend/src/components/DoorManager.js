import React, { useState, useEffect } from 'react';

const DoorManager = ({
  projectId,
  wall,
  onSaveDoor,
  onUpdateDoor,
  editingDoor = null,
  isEditMode = false,
  onDeleteDoor,
  onClose
}) => {
  const [doorType, setDoorType] = useState('swing');
  const [configuration, setConfiguration] = useState('single');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [thickness, setThickness] = useState('');
  const [side, setSide] = useState('interior');
  const [swingDirection, setSwingDirection] = useState('right');
  const [slideDirection, setSlideDirection] = useState('right');
  const [localPosition, setLocalPosition] = useState(0.5);

  useEffect(() => {
    if (editingDoor) {
      setDoorType(editingDoor.door_type);
      setConfiguration(editingDoor.configuration?.includes('double') ? 'double' : 'single');
      setWidth(editingDoor.width);
      setHeight(editingDoor.height);
      setThickness(editingDoor.thickness);
      setSide(editingDoor.side || 'interior');
      setSwingDirection(editingDoor.swing_direction || 'right');
      setSlideDirection(editingDoor.slide_direction || 'right');
      setLocalPosition(editingDoor.position_x || 0.5);
    }
  }, [editingDoor]);

  useEffect(() => {
    if (!isEditMode && wall) {
      setHeight('');
      setThickness('');
    }
  }, [wall, isEditMode]);

  const handleSave = () => {
    if (!wall?.id || !projectId) {
      alert("Missing wall or project ID");
      return;
    }

    if (!width || !height || !thickness) {
      alert("Please fill in all required dimensions (width, height, thickness).");
      return;
    }

    // Validate that dimensions are greater than 0
    const widthValue = parseFloat(width);
    const heightValue = parseFloat(height);
    const thicknessValue = parseFloat(thickness);
    
    if (widthValue <= 0 || heightValue <= 0 || thicknessValue <= 0) {
      alert("Width, Height, and Thickness must be greater than 0");
      return;
    }

    const doorData = {
      project: projectId,
      linked_wall: wall.id,
      door_type: doorType,
      configuration: configuration === "single" ? "single_sided" : "double_sided",
      width: widthValue,
      height: heightValue,
      thickness: thicknessValue,
      position_x: localPosition,
      position_y: 0,
      swing_direction: swingDirection,
      slide_direction: slideDirection,
      side: side
    };

    if (isEditMode && editingDoor) {
      onUpdateDoor({ ...doorData, id: editingDoor.id });
    } else {
      onSaveDoor(doorData);
    }
  };

  const handleDelete = () => {
    if (editingDoor?.id && onDeleteDoor) {
      if (window.confirm("Are you sure you want to delete this door?")) {
        onDeleteDoor(editingDoor.id);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg">
        <h2 className="text-lg font-bold mb-4">
          {isEditMode ? 'Edit Door' : 'Add New Door'}
        </h2>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Type</label>
            <select value={doorType} onChange={(e) => setDoorType(e.target.value)} className="input">
              <option value="swing">Swing</option>
              <option value="slide">Slide</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Configuration</label>
            <select value={configuration} onChange={(e) => setConfiguration(e.target.value)} className="input">
              <option value="single">Single</option>
              <option value="double">Double</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Width (mm)</label>
            <input 
              type="number" 
              value={width} 
              onChange={(e) => setWidth(e.target.value)} 
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
              onChange={(e) => setHeight(e.target.value)} 
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
              onChange={(e) => setThickness(e.target.value)} 
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
            onChange={(e) => setLocalPosition(parseFloat(e.target.value))}
            className="w-full mt-1"
          />
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
      </div>
    </div>
  );
};

export default DoorManager;
