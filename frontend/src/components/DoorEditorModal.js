import React, { useState, useEffect } from 'react';

const DoorEditorModal = ({ door, onUpdate, onDelete, onClose }) => {
  const [editedDoor, setEditedDoor] = useState({ ...door });

  useEffect(() => {
    setEditedDoor({ ...door });
  }, [door]);

  const handleChange = (field, value) => {
    setEditedDoor(prev => ({ ...prev, [field]: value }));
  };

  const handleFlipDirection = () => {
    if (editedDoor.door_type === 'swing') {
      handleChange('swing_direction', editedDoor.swing_direction === 'left' ? 'right' : 'left');
    } else {
      handleChange('slide_direction', editedDoor.slide_direction === 'left' ? 'right' : 'left');
    }
  };
  
  const handleFlipSide = () => {
    handleChange('side', editedDoor.side === 'interior' ? 'exterior' : 'interior');
  };  

  const handleTypeChange = (e) => {
    const newType = e.target.value;
    const defaults = newType === 'swing'
      ? { swing_direction: 'right', slide_direction: null }
      : { slide_direction: 'right', swing_direction: null };
  
    setEditedDoor(prev => ({
      ...prev,
      door_type: newType,
      ...defaults
    }));
  };
  

  const handleConfigChange = (e) => {
    handleChange('configuration', e.target.value);
  };

  const handlePositionChange = (e) => {
    handleChange('position_x', parseFloat(e.target.value));
  };

  const handleSave = () => {
    onUpdate(editedDoor);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">Edit Door</h2>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Door Type</span>
            <select
              value={editedDoor.door_type}
              onChange={handleTypeChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="swing">Swing</option>
              <option value="slide">Slide</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Configuration</span>
            <select
              value={editedDoor.configuration}
              onChange={handleConfigChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="single_sided">Single-Sided</option>
              <option value="double_sided">Double-Sided</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Width (mm)</span>
            <input
              type="number"
              value={editedDoor.width}
              onChange={e => handleChange('width', parseFloat(e.target.value))}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Height (mm)</span>
            <input
              type="number"
              value={editedDoor.height}
              onChange={e => handleChange('height', parseFloat(e.target.value))}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Thickness (mm)</span>
            <input
              type="number"
              value={editedDoor.thickness}
              onChange={e => handleChange('thickness', parseFloat(e.target.value))}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Position on Wall</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={editedDoor.position_x}
              onChange={handlePositionChange}
              className="w-full"
            />
          </label>

          <div className="flex gap-3">
            <button
              onClick={handleFlipDirection}
              className="flex-1 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
            >
              Flip Opening Direction
            </button>

            <button
              onClick={handleFlipSide}
              className="flex-1 bg-purple-500 text-white py-2 px-4 rounded hover:bg-purple-600"
            >
              Flip Installing Side
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onDelete(door.id)}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Delete
          </button>
          <button
            onClick={handleSave}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default DoorEditorModal;
