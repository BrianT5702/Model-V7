import { useState, useEffect } from 'react';

/**
 * useDoorForm - Custom hook for managing door form state and logic
 * @param {Object} options - Configuration options
 * @param {Object} options.initialDoor - Initial door data (for edit mode)
 * @param {boolean} options.isEditMode - Whether the form is in edit mode
 * @param {Function} options.onSave - Callback for saving/adding a door
 * @param {Function} options.onUpdate - Callback for updating a door
 * @param {Function} options.onDelete - Callback for deleting a door
 * @param {Function} options.onClose - Callback for closing the form/modal
 * @param {string|number} options.projectId - Project ID (for add mode)
 * @param {Object} options.wall - Wall object (for add mode)
 */
export default function useDoorForm({
  initialDoor = null,
  isEditMode = false,
  onSave,
  onUpdate,
  onDelete,
  onClose,
  projectId,
  wall
}) {
  // State for door fields
  const [doorType, setDoorType] = useState(initialDoor?.door_type || 'swing');
  const [configuration, setConfiguration] = useState(
    initialDoor?.configuration?.includes('double') ? 'double' : 'single'
  );
  const [width, setWidth] = useState(initialDoor?.width || '');
  const [height, setHeight] = useState(initialDoor?.height || '');
  const [thickness, setThickness] = useState(initialDoor?.thickness || '');
  const [side, setSide] = useState(initialDoor?.side || 'interior');
  const [swingDirection, setSwingDirection] = useState(initialDoor?.swing_direction || 'right');
  const [slideDirection, setSlideDirection] = useState(initialDoor?.slide_direction || 'right');
  const [localPosition, setLocalPosition] = useState(
    initialDoor?.position_x !== undefined ? initialDoor.position_x : 0.5
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [dbConnectionError, setDbConnectionError] = useState(false);
  const [validationError, setValidationError] = useState("");

  // Sync state when editing a different door
  useEffect(() => {
    if (initialDoor) {
      setDoorType(initialDoor.door_type);
      setConfiguration(initialDoor.configuration?.includes('double') ? 'double' : 'single');
      setWidth(initialDoor.width);
      setHeight(initialDoor.height);
      setThickness(initialDoor.thickness);
      setSide(initialDoor.side || 'interior');
      setSwingDirection(initialDoor.swing_direction || 'right');
      setSlideDirection(initialDoor.slide_direction || 'right');
      setLocalPosition(initialDoor.position_x || 0.5);
    }
  }, [initialDoor]);

  // Reset height/thickness when switching wall in add mode
  useEffect(() => {
    if (!isEditMode && wall) {
      setHeight('');
      setThickness('');
    }
  }, [wall, isEditMode]);

  // Utility: Check for DB/network errors
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

  // Handlers for field changes
  const handleTypeChange = (e) => {
    const newType = e.target.value;
    setDoorType(newType);
    if (newType === 'swing') {
      setSwingDirection('right');
      setSlideDirection(null);
    } else {
      setSlideDirection('right');
      setSwingDirection(null);
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

  const handlePositionChange = (e) => {
    setLocalPosition(parseFloat(e.target.value));
  };

  // Add these handlers for height and thickness changes
  const handleHeightChange = (eOrValue) => {
    if (eOrValue && eOrValue.target) {
      setHeight(eOrValue.target.value);
    } else {
      setHeight(eOrValue);
    }
  };
  const handleThicknessChange = (eOrValue) => {
    if (eOrValue && eOrValue.target) {
      setThickness(eOrValue.target.value);
    } else {
      setThickness(eOrValue);
    }
  };

  // Save handler (add or update)
  const handleSave = async () => {
    // Validate required fields
    if (!width || !height || !thickness) {
      setValidationError("Please fill in all required dimensions (width, height, thickness).");
      setTimeout(() => setValidationError(""), 4000);
      return;
    }
    const widthValue = parseFloat(width);
    const heightValue = parseFloat(height);
    const thicknessValue = parseFloat(thickness);
    if (widthValue <= 0 || heightValue <= 0 || thicknessValue <= 0) {
      setValidationError("Width, Height, and Thickness must be greater than 0");
      setTimeout(() => setValidationError(""), 4000);
      return;
    }
    // Compose door data
    let wallId = wall?.id;
    if (isEditMode && initialDoor) {
      wallId = initialDoor.linked_wall || initialDoor.wall_id;
    }
    const doorData = {
      project: projectId,
      linked_wall: wallId,
      door_type: doorType,
      configuration: configuration === 'single' ? 'single_sided' : 'double_sided',
      width: widthValue,
      height: heightValue,
      thickness: thicknessValue,
      position_x: localPosition,
      position_y: 0,
      swing_direction: swingDirection,
      slide_direction: slideDirection,
      side: side,
      orientation: 'horizontal',
    };
    try {
      if (isEditMode && initialDoor) {
        await onUpdate({ ...doorData, id: initialDoor.id });
      } else {
        await onSave(doorData);
      }
    } catch (error) {
      if (isDatabaseConnectionError(error)) {
        setDbConnectionError(true);
        setTimeout(() => setDbConnectionError(false), 5000);
      }
    }
  };

  // Delete handlers
  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };
  const handleConfirmDelete = async () => {
    if (initialDoor?.id && onDelete) {
      try {
        await onDelete(initialDoor.id);
        setShowDeleteConfirm(false);
      } catch (error) {
        if (isDatabaseConnectionError(error)) {
          setDbConnectionError(true);
          setTimeout(() => setDbConnectionError(false), 5000);
        }
      }
    }
  };
  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  // Expose all state and handlers
  return {
    doorType,
    setDoorType,
    configuration,
    setConfiguration,
    width,
    setWidth,
    height,
    setHeight,
    thickness,
    setThickness,
    side,
    setSide,
    swingDirection,
    setSwingDirection,
    slideDirection,
    setSlideDirection,
    localPosition,
    setLocalPosition,
    showDeleteConfirm,
    setShowDeleteConfirm,
    dbConnectionError,
    setDbConnectionError,
    validationError,
    setValidationError,
    handleTypeChange,
    handleConfigChange,
    handleFlipDirection,
    handleFlipSide,
    handlePositionChange,
    handleSave,
    handleDelete,
    handleConfirmDelete,
    handleCancelDelete,
    handleHeightChange,
    handleThicknessChange
  };
} 