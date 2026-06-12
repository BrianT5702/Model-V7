import { useState, useEffect, useMemo } from 'react';
import { calculateMinWallHeight } from '../../api/api';
import { getStoreyElevationMm } from '../project/projectUtils';
import {
  formatRoomHeightForInput,
  parseRoomHeightInput,
} from './roomHeightUtils';
import {
  formatRoomTemperatureForInput,
  parseRoomTemperatureInput,
} from './roomTemperatureUtils';

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
const pointsAreEqual = (a, b, tolerance = 0.01) => {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
};

const normalizePolygonPoints = (points, tolerance = 0.01) => {
  if (!Array.isArray(points)) {
    return [];
  }

  const cleaned = [];

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    if (!current || typeof current.x !== 'number' || typeof current.y !== 'number') {
      continue;
    }

    const last = cleaned[cleaned.length - 1];
    if (last && pointsAreEqual(last, current, tolerance)) {
      // Skip consecutive duplicate points
      continue;
    }

    cleaned.push({ x: current.x, y: current.y });
  }

  if (cleaned.length > 1 && pointsAreEqual(cleaned[0], cleaned[cleaned.length - 1], tolerance)) {
    cleaned.pop();
  }

  return cleaned;
};

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
  walls = [],
  storeys = [],
  activeStoreyId = null
}) {
  // State for room fields
  const [roomName, setRoomName] = useState(initialRoom?.room_name || '');
  const [floorType, setFloorType] = useState(initialRoom?.floor_type || '');
  const [floorThickness, setFloorThickness] = useState(initialRoom?.floor_thickness || '');
  const [floorLayers, setFloorLayers] = useState(initialRoom?.floor_layers || 1);
  const [temperature, setTemperature] = useState(formatRoomTemperatureForInput(initialRoom));
  const [roomHeight, setRoomHeight] = useState(formatRoomHeightForInput(initialRoom));
  const normaliseStoreyId = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
  };
  const defaultStoreyId = normaliseStoreyId(
    initialRoom?.storey ?? initialRoom?.storey_id ?? activeStoreyId ?? (storeys[0]?.id ?? null)
  );
  const resolveDefaultBaseElevation = (storeyIdValue) =>
    getStoreyElevationMm(storeys, normaliseStoreyId(storeyIdValue ?? activeStoreyId ?? storeys[0]?.id));
  const defaultBaseElevationMm = useMemo(
    () => resolveDefaultBaseElevation(defaultStoreyId),
    [storeys, activeStoreyId, defaultStoreyId]
  );
  const [storeyId, setStoreyId] = useState(defaultStoreyId);
  // Store as string to allow intermediate typing states like "-" or "-3"
  const [baseElevation, setBaseElevation] = useState(
    initialRoom?.base_elevation_mm !== undefined && initialRoom?.base_elevation_mm !== null
      ? initialRoom.base_elevation_mm.toString()
      : defaultBaseElevationMm.toString()
  );
  
  // Helper function to set base elevation allowing intermediate typing states
  const setBaseElevationSafe = (value) => {
    // Always store as string to allow intermediate states
    if (typeof value === 'string') {
      setBaseElevation(value);
    } else {
      setBaseElevation(value.toString());
    }
  };
  const [remarks, setRemarks] = useState(initialRoom?.remarks || '');
  const [allowVariableWallHeights, setAllowVariableWallHeights] = useState(initialRoom?.allow_variable_wall_heights || false);
  const [displayWalls, setDisplayWalls] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  // Sync state when editing a different room, or clear when not editing
  useEffect(() => {
    if (initialRoom) {
      // Populate form with room data when editing
      setRoomName(initialRoom.room_name);
      setFloorType(initialRoom.floor_type);
      setFloorThickness(initialRoom.floor_thickness);
      setFloorLayers(initialRoom.floor_layers || 1);
      setRemarks(initialRoom.remarks);
      setTemperature(formatRoomTemperatureForInput(initialRoom));
      setRoomHeight(formatRoomHeightForInput(initialRoom));
      setAllowVariableWallHeights(initialRoom?.allow_variable_wall_heights || false);
      const editStoreyId = normaliseStoreyId(
        initialRoom.storey ?? initialRoom.storey_id ?? activeStoreyId ?? (storeys[0]?.id ?? null)
      );
      setBaseElevation(
        initialRoom.base_elevation_mm !== undefined && initialRoom.base_elevation_mm !== null
          ? initialRoom.base_elevation_mm.toString()
          : resolveDefaultBaseElevation(editStoreyId).toString()
      );
      setStoreyId(editStoreyId);
    } else {
      // Clear form fields when not editing (for creating new room)
      const targetStoreyId = normaliseStoreyId(activeStoreyId ?? (storeys[0]?.id ?? null));
      setRoomName('');
      setFloorType('');
      setFloorThickness('');
      setFloorLayers(1);
      setRemarks('');
      setTemperature('');
      setRoomHeight('');
      setAllowVariableWallHeights(false);
      setBaseElevation(resolveDefaultBaseElevation(targetStoreyId).toString());
      setStoreyId(targetStoreyId);
    }
  }, [initialRoom, activeStoreyId, storeys]);

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
  }, [selectedWallIds, walls]);

  // Calculate minimum wall height when selectedWallIds change and room height is not set
  useEffect(() => {
    if (selectedWallIds.length > 0 && !roomHeight) {
      console.log('Calculating minimum wall height for wall IDs:', selectedWallIds);
      calculateMinWallHeight(selectedWallIds)
        .then(response => {
          console.log('API response for min height:', response.data);
          if (response.data.min_height) {
            console.log('Setting room height to:', response.data.min_height);
            setRoomHeight(String(response.data.min_height));
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
            setRoomHeight(String(minHeight));
          }
        });
    }
  }, [selectedWallIds, walls]);

  // Validation function
  const validateForm = () => {
    const errors = {};
    const normalizedPoints = normalizePolygonPoints(selectedPolygonPoints);

    if (!roomName.trim()) {
      errors.roomName = 'Room name is required';
    }
    if (!floorType) {
      errors.floorType = 'Floor type is required';
    }
    if (floorThickness === '' || floorThickness === null || floorThickness === undefined) {
      errors.floorThickness = 'Floor thickness is required';
    }
    const parsedTemperature = parseRoomTemperatureInput(temperature);
    if (!parsedTemperature.ok) {
      errors.temperature = parsedTemperature.error;
    }
    const parsedHeight = parseRoomHeightInput(roomHeight);
    if (!parsedHeight.ok) {
      errors.roomHeight = parsedHeight.error;
    }
    if (normalizedPoints.length < 3) {
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
    const normalizedPoints = normalizePolygonPoints(selectedPolygonPoints);

    return roomName.trim() && 
           floorType && 
           (floorThickness !== '' && floorThickness !== null && floorThickness !== undefined) && 
           parseRoomTemperatureInput(temperature).ok && 
           parseRoomHeightInput(roomHeight).ok && 
           normalizedPoints.length >= 3;
  };

  // Save handler (add or update)
  const handleSave = () => {
    if (!validateForm()) {
      return;
    }
    const normalizedPoints = normalizePolygonPoints(selectedPolygonPoints);

    const parsedHeight = parseRoomHeightInput(roomHeight);
    if (!parsedHeight.ok) {
      setValidationErrors({ roomHeight: parsedHeight.error });
      return;
    }

    const parsedTemperature = parseRoomTemperatureInput(temperature);
    if (!parsedTemperature.ok) {
      setValidationErrors({ temperature: parsedTemperature.error });
      return;
    }

    const roomData = {
      room_name: roomName,
      floor_type: floorType,
      floor_thickness: floorThickness,
      floor_layers: floorLayers || 1,
      temperature: parsedTemperature.temperature,
      temperature_min: parsedTemperature.temperature_min,
      temperature_max: parsedTemperature.temperature_max,
      height: parsedHeight.height,
      height_min: parsedHeight.height_min,
      height_max: parsedHeight.height_max,
      base_elevation_mm: baseElevation === '' || baseElevation === '-' ? 0 : parseFloat(baseElevation) || 0,
      allow_variable_wall_heights: allowVariableWallHeights,
      remarks: remarks,
      walls: selectedWallIds,
      project: projectId,
      room_points: normalizedPoints,
      storey: activeStoreyId || storeyId || null, // Use activeStoreyId if available, otherwise use form storeyId
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
    floorLayers,
    setFloorLayers,
    setFloorThickness,
    temperature,
    setTemperature,
    roomHeight,
    setRoomHeight,
    storeyId,
    setStoreyId,
    baseElevation,
    setBaseElevation: setBaseElevationSafe,
    defaultBaseElevationMm,
    remarks,
    setRemarks,
    allowVariableWallHeights,
    setAllowVariableWallHeights,
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