import { useState, useEffect } from 'react';
import { calculateMinWallHeight } from '../../api/api';

/**
 * useRoomForm - Custom hook for managing room form state and logic
 * @param {Object} options - Configuration options
 * @param {Object} options.initialRoom - Initial room data (for edit mode)
 * @param {boolean} options.isEditMode - Whether the form is in edit mode
 * @param {Function} options.onSave - Callback for saving/adding a room
 * @param {Function} options.onUpdate - Callback for updating a room
 * @param {Function} options.onDelete - Callback for deleting a room
 * @param {Function} options.onClose - Callback for closing the form/modal
 * @param {string|number} options.projectId - Project ID
 * @param {Array} options.selectedWallIds - Array of selected wall IDs
 * @param {Array} options.selectedPolygonPoints - Array of selected polygon points
 * @param {Array} options.walls - Array of wall objects
 */
export default function useRoomForm({
  initialRoom = null,
  isEditMode = false,
  onSave,
  onUpdate,
  onDelete,
  onClose,
  projectId,
  selectedWallIds = [],
  selectedPolygonPoints = [],
  walls = []
}) {
  // State for room fields
  const [roomName, setRoomName] = useState(initialRoom?.room_name || '');
  const [floorType, setFloorType] = useState(initialRoom?.floor_type || '');
  const [floorThickness, setFloorThickness] = useState(initialRoom?.floor_thickness || '');
  const [temperature, setTemperature] = useState(initialRoom?.temperature || '');
  const [roomHeight, setRoomHeight] = useState(initialRoom?.height || '');
  const [remarks, setRemarks] = useState(initialRoom?.remarks || '');
  const [displayWalls, setDisplayWalls] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  // Sync state when editing a different room
  useEffect(() => {
    if (initialRoom) {
      setRoomName(initialRoom.room_name);
      setFloorType(initialRoom.floor_type);
      setFloorThickness(initialRoom.floor_thickness);
      setRemarks(initialRoom.remarks);
      setTemperature(initialRoom.temperature || '');
      setRoomHeight(initialRoom.height || '');
    }
  }, [initialRoom]);

  // Update displayWalls when selectedWallIds or walls change
  useEffect(() => {
    const wallDetails = selectedWallIds.map(id => {
      const wall = walls.find(w => w.id === id);
      return {
        id,
        startPoint: wall ? `(${wall.start_x.toFixed(2)}, ${wall.start_y.toFixed(2)})` : 'unknown',
        endPoint: wall ? `(${wall.end_x.toFixed(2)}, ${wall.end_y.toFixed(2)})` : 'unknown',
        height: wall ? wall.height : null
      };
    });
    setDisplayWalls(wallDetails);
    
    // Calculate and set minimum wall height if room height is not set
    if (selectedWallIds.length > 0 && !roomHeight) {
      console.log('Calculating minimum wall height for wall IDs:', selectedWallIds);
      calculateMinWallHeight(selectedWallIds)
        .then(response => {
          console.log('API response for min height:', response.data);
          if (response.data.min_height) {
            console.log('Setting room height to:', response.data.min_height);
            setRoomHeight(response.data.min_height);
          }
        })
        .catch(error => {
          console.error('Error calculating minimum wall height:', error);
          // Fallback to local calculation
          const selectedWalls = walls.filter(w => selectedWallIds.includes(w.id));
          console.log('Fallback: selected walls for local calculation:', selectedWalls);
          if (selectedWalls.length > 0) {
            const minHeight = Math.min(...selectedWalls.map(w => w.height));
            console.log('Fallback: setting room height to:', minHeight);
            setRoomHeight(minHeight);
          }
        });
    }
  }, [selectedWallIds, walls, roomHeight]);

  // Validation function
  const validateForm = () => {
    const errors = {};
    if (!roomName.trim()) {
      errors.roomName = 'Room name is required';
    }
    if (!floorType) {
      errors.floorType = 'Floor type is required';
    }
    if (!floorThickness) {
      errors.floorThickness = 'Floor thickness is required';
    }
    if (!temperature) {
      errors.temperature = 'Temperature is required';
    }
    if (!roomHeight || roomHeight <= 0) {
      errors.roomHeight = 'Room height must be greater than 0';
    }
    if (selectedPolygonPoints.length < 3) {
      errors.polygonPoints = 'At least 3 points are required to define a room';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Clear validation errors when user starts typing
  const clearValidationError = (fieldName) => {
    if (validationErrors[fieldName]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };

  // Check if form is valid for button disabled state
  const isFormValid = () => {
    return roomName.trim() && 
           floorType && 
           floorThickness && 
           temperature && 
           roomHeight && 
           selectedPolygonPoints.length >= 3;
  };

  // Save handler (add or update)
  const handleSave = () => {
    if (!validateForm()) {
      return;
    }
    const roomData = {
      room_name: roomName,
      floor_type: floorType,
      floor_thickness: floorThickness,
      temperature: temperature,
      height: roomHeight,
      remarks: remarks,
      walls: selectedWallIds,
      project: projectId,
      room_points: selectedPolygonPoints,
    };
    
    console.log('Saving room with data:', roomData);
    console.log('Selected wall IDs:', selectedWallIds);
    console.log('Room height:', roomHeight);
    
    if (isEditMode && initialRoom) {
      onUpdate({ ...roomData, id: initialRoom.id });
    } else {
      onSave(roomData);
    }
  };

  // Delete handler
  const handleDelete = () => {
    if (initialRoom && onDelete) {
      onDelete(initialRoom.id);
      onClose();
    }
  };

  // Expose all state and handlers
  return {
    roomName,
    setRoomName,
    floorType,
    setFloorType,
    floorThickness,
    setFloorThickness,
    temperature,
    setTemperature,
    roomHeight,
    setRoomHeight,
    remarks,
    setRemarks,
    displayWalls,
    showDeleteConfirm,
    setShowDeleteConfirm,
    validationErrors,
    setValidationErrors,
    clearValidationError,
    isFormValid,
    handleSave,
    handleDelete
  };
} 