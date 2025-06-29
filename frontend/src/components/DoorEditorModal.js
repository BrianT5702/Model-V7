import React, { useState, useEffect } from 'react';

const DoorEditorModal = ({ door, onUpdate, onDelete, onClose }) => {
  const [editedDoor, setEditedDoor] = useState({ ...door });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dbConnectionError, setDbConnectionError] = useState(false);
  const [validationError, setValidationError] = useState("");

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

  const handleSave = async () => {
    // Validate that dimensions are greater than 0 and required fields are present
    if (!editedDoor.width || editedDoor.width <= 0 ||
        !editedDoor.height || editedDoor.height <= 0 ||
        !editedDoor.thickness || editedDoor.thickness <= 0 ||
        !editedDoor.door_type || !editedDoor.configuration ||
        editedDoor.position_x === undefined || editedDoor.position_x === null) {
      setValidationError("Please fill in all required fields. Width, Height, and Thickness must be greater than 0.");
      setTimeout(() => setValidationError(""), 4000);
      return;
    }
    try {
      await onUpdate(editedDoor);
    } catch (error) {
      if (isDatabaseConnectionError(error)) {
        setDbConnectionError(true);
        setTimeout(() => setDbConnectionError(false), 5000);
      }
    }
  };

  const isDatabaseConnectionError = (error) => {
    return (
      error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.message?.includes('Network Error') ||
      error.message?.includes('Failed to fetch') ||
      error.message?.includes('Connection refused') ||
      error.message?.includes('getaddrinfo ENOTFOUND') ||
      (error.response?.status >= 500 && error.response?.status < 600)
    );
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
              min="100"
              step="100"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Height (mm)</span>
            <input
              type="number"
              value={editedDoor.height}
              onChange={e => handleChange('height', parseFloat(e.target.value))}
              min="100"
              step="100"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Thickness (mm)</span>
            <input
              type="number"
              value={editedDoor.thickness}
              onChange={e => handleChange('thickness', parseFloat(e.target.value))}
              min="25"
              step="25"
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
            onClick={() => setShowDeleteConfirm(true)}
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

      {showDeleteConfirm && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded shadow-lg flex items-center gap-4">
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="font-medium">Are you sure you want to delete this door?</span>
          <button onClick={async () => {
            try {
              await onDelete(door.id);
              setShowDeleteConfirm(false);
            } catch (error) {
              if (isDatabaseConnectionError(error)) {
                setDbConnectionError(true);
                setTimeout(() => setDbConnectionError(false), 5000);
              }
            }
          }} className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Yes, Delete</button>
          <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
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
    </div>
  );
};

export default DoorEditorModal;
