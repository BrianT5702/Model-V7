import { useState, useEffect, useRef } from 'react';
import api from '../../api/api';
import ThreeCanvas3D from '../canvas/ThreeCanvas3D';
import { areCollinearWalls, calculateIntersection, arePointsEqual } from './projectUtils';

export default function useProjectDetails(projectId) {
  // State
  const [project, setProject] = useState(null);
  const [walls, setWalls] = useState([]);
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [currentMode, setCurrentMode] = useState(null);
  const [selectedWall, setSelectedWall] = useState(null);
  const [is3DView, setIs3DView] = useState(null);
  const [isInteriorView, setIsInteriorView] = useState(false);
  const threeCanvasInstance = useRef(null);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const [selectedWallsForRoom, setSelectedWallsForRoom] = useState([]);
  const [editingRoom, setEditingRoom] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [selectedWallType, setSelectedWallType] = useState('wall');
  const [showWallEditor, setShowWallEditor] = useState(false);
  const [showRoomManagerModal, setShowRoomManagerModal] = useState(false);
  const [joints, setJoints] = useState([]);
  const [selectedDoorWall, setSelectedDoorWall] = useState(null);
  const [showDoorManager, setShowDoorManager] = useState(false);
  const [doors, setDoors] = useState([]);
  const [editingDoor, setEditingDoor] = useState(null);
  const [showDoorEditor, setShowDoorEditor] = useState(false);
  const [selectedRoomPoints, setSelectedRoomPoints] = useState([]);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [wallMergeError, setWallMergeError] = useState('');
  const [dbConnectionError, setDbConnectionError] = useState(false);
  const [showWallDeleteConfirm, setShowWallDeleteConfirm] = useState(false);
  const [wallToDelete, setWallToDelete] = useState(null);
  const [wallDeleteSuccess, setWallDeleteSuccess] = useState(false);
  const [wallDeleteError, setWallDeleteError] = useState('');
  const [roomCreateSuccess, setRoomCreateSuccess] = useState(false);
  const [wallMergeSuccess, setWallMergeSuccess] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [projectLoadError, setProjectLoadError] = useState('');

  // Utility: DB/network error check
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

  // Add resetAllSelections utility
  const resetAllSelections = () => {
    setSelectedWall(null);
    setSelectedWallsForRoom([]);
    setEditingRoom(null);
    setSelectedRoomPoints([]);
    setCurrentMode(null);
    setShowWallEditor(false);
    setShowRoomManagerModal(false);
    setShowDoorManager(false);
    setEditingDoor(null);
    setShowDoorEditor(false);
    setSelectedDoorWall(null);
    setWallMergeError('');
    setWallToDelete(null);
    setShowWallDeleteConfirm(false);
    setWallDeleteSuccess(false);
    setWallDeleteError('');
    setRoomError('');
    setWallMergeSuccess(false);
  };

  // Fetch project details
  const fetchProjectDetails = async () => {
    try {
      const projectResponse = await api.get(`/projects/${projectId}/`);
      setProject(projectResponse.data);
      const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
      setWalls(wallsResponse.data);
      const doorsResponse = await api.get(`/doors/?project=${projectId}`);
      setDoors(doorsResponse.data);
      const intersectionsResponse = await api.get(`/intersections/?projectid=${projectId}`);
      setJoints(intersectionsResponse.data);
      setProjectLoadError('');
    } catch (error) {
      console.error('Error fetching project details:', error);
      if (isDatabaseConnectionError(error)) {
        setProjectLoadError('Fail to connect to database. Try again later.');
      } else {
        setProjectLoadError('Failed to load project. Please try again.');
      }
    }
  };

  useEffect(() => {
    fetchProjectDetails();
    // eslint-disable-next-line
  }, [projectId]);

  // Fetch rooms
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const response = await api.get(`/rooms/?project=${projectId}`);
        setRooms(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        console.error('Error fetching rooms:', error);
        setRooms([]);
      }
    };
    fetchRooms();
  }, [projectId]);

  // 3D view effect
  useEffect(() => {
    if (is3DView) {
      const threeCanvas = new ThreeCanvas3D('three-canvas-container', walls, joints, doors);
      threeCanvasInstance.current = threeCanvas;
      return () => {
        threeCanvas.renderer.dispose();
        threeCanvasInstance.current = null;
      };
    }
    // eslint-disable-next-line
  }, [is3DView, walls]);

  // Room handlers
  const handleCreateRoom = async (roomData) => {
    try {
      const completeRoomData = {
        ...roomData,
        room_points: selectedRoomPoints,
      };
      const response = await api.post('/rooms/', completeRoomData);
      if (response.status === 201) {
        const newRoom = response.data;
        setRooms((prevRooms) => [...prevRooms, newRoom]);
        setRoomCreateSuccess(true);
        setTimeout(() => setRoomCreateSuccess(false), 3000);
        setShowRoomManagerModal(false);
        setSelectedRoomPoints([]);
        setCurrentMode(null);
      }
    } catch (error) {
      console.error('Error creating room:', error);
      if (isDatabaseConnectionError(error)) {
        setRoomError('Fail to connect to database. Try again later.');
      } else {
        setRoomError('Failed to create room.');
      }
      setTimeout(() => setRoomError(''), 5000);
    }
  };

  const handleRoomUpdate = async (updatedRoomData) => {
    try {
      const response = await api.put(`/rooms/${updatedRoomData.id}/`, updatedRoomData);
      setRooms(rooms.map(room => room.id === updatedRoomData.id ? response.data : room));
      setShowRoomManagerModal(false);
      setSelectedRoomPoints([]);
      setCurrentMode(null);
    } catch (error) {
      console.error('Error updating room:', error);
      if (isDatabaseConnectionError(error)) {
        setRoomError('Fail to connect to database. Try again later.');
      } else {
        setRoomError('Failed to update room.');
      }
      setTimeout(() => setRoomError(''), 5000);
    }
  };

  const handleRoomDelete = async (roomId) => {
    try {
      await api.delete(`/rooms/${roomId}/`);
      setRooms(rooms.filter(room => room.id !== roomId));
      setShowRoomManagerModal(false);
      setSelectedRoomPoints([]);
      setCurrentMode(null);
    } catch (error) {
      console.error('Error deleting room:', error);
      if (isDatabaseConnectionError(error)) {
        setRoomError('Fail to connect to database. Try again later.');
      } else {
        setRoomError('Failed to delete room.');
      }
      setTimeout(() => setRoomError(''), 5000);
    }
  };

  // Door handlers (partial)
  const handleCreateDoor = async (doorData) => {
    try {
      const completeDoorData = {
        ...doorData,
        swing_direction: 'right',
        slide_direction: 'right',
        side: 'interior'
      };
      const response = await api.post('/doors/create_door/', completeDoorData);
      setDoors([...doors, response.data]);
      setShowDoorManager(false);
      setCurrentMode(null);
    } catch (error) {
      console.error('Error creating door:', error);
    }
  };

  const handleUpdateDoor = async (updatedDoor) => {
    try {
      const wallId = updatedDoor.linked_wall || updatedDoor.wall_id;
      const response = await api.put(`/doors/${updatedDoor.id}/`, {
        project: projectId,
        linked_wall: wallId,
        width: updatedDoor.width,
        height: updatedDoor.height,
        thickness: updatedDoor.thickness,
        position_x: updatedDoor.position_x,
        position_y: updatedDoor.position_y,
        door_type: updatedDoor.door_type,
        configuration: updatedDoor.configuration,
        swing_direction: updatedDoor.swing_direction,
        slide_direction: updatedDoor.slide_direction,
        side: updatedDoor.side,
        orientation: updatedDoor.orientation || 'horizontal',
      });
      const updated = response.data;
      setDoors(doors.map(d => d.id === updated.id ? updated : d));
      setShowDoorEditor(false);
      setEditingDoor(null);
      setSelectedWall(null);
    } catch (error) {
      console.error('Failed to update door:', error);
      if (error.response && error.response.data) {
        console.error('Backend error details:', error.response.data);
        alert(JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  };

  // Add toggleMode utility
  const toggleMode = (mode) => {
    setCurrentMode((prev) => (prev === mode ? null : mode));
  };

  // Add a function to refresh walls from the backend
  const refreshWalls = async () => {
    try {
      const response = await api.get(`/projects/${projectId}/walls/`);
      setWalls(response.data);
    } catch (error) {
      console.error('Error refreshing walls:', error);
    }
  };

  // Update handleWallCreate to refresh walls after creation
  const handleWallCreate = async (wallData) => {
    try {
      const dataToSend = { ...wallData, project: project.id };
      const response = await api.post('/walls/create_wall/', dataToSend);
      await refreshWalls(); // Ensure UI is in sync with backend
      return response.data;
    } catch (error) {
      console.error('Error creating wall:', error);
      throw error;
    }
  };

  // Add this function to handle wall selection and open the editor modal
  const handleWallSelect = (wallId) => {
    setSelectedWall(wallId);
    setShowWallEditor(true);
  };

  // Add this function to handle wall updates
  const handleWallUpdate = async (updatedWall) => {
    try {
      // Validate that wall dimensions are greater than 0
      if (updatedWall.height <= 0 || updatedWall.thickness <= 0) {
        alert("Wall Height and Thickness must be greater than 0");
        return;
      }
      const response = await api.put(`/walls/${updatedWall.id}/`, updatedWall);
      const updatedWallData = response.data;
      setWalls(prevWalls =>
        prevWalls.map(wall =>
          wall.id === updatedWallData.id ? updatedWallData : wall
        )
      );
      // Optionally, refresh walls from backend for full sync
      // await refreshWalls();
    } catch (error) {
      alert('Failed to update wall');
    }
  };

  // Add this function to handle wall deletion
  const handleWallDelete = async (wallId) => {
    try {
      await api.delete(`/walls/${wallId}/`);
      setWalls(prevWalls => prevWalls.filter(wall => wall.id !== wallId));
    } catch (error) {
      console.error('Error deleting wall:', error);
      throw error;
    }
  };

  // Add these functions to handle wall delete confirmation/cancellation
  const handleConfirmWallDelete = async () => {
    if (wallToDelete === null) return;
    try {
      await handleWallDelete(wallToDelete);
      setWallDeleteSuccess(true);
      setTimeout(() => setWallDeleteSuccess(false), 3000);
      setSelectedWall(null);
    } catch (error) {
      setWallDeleteError('Failed to delete wall. Please try again.');
      setTimeout(() => setWallDeleteError(''), 5000);
    } finally {
      setShowWallDeleteConfirm(false);
      setWallToDelete(null);
    }
  };

  const handleCancelWallDelete = () => {
    setShowWallDeleteConfirm(false);
    setWallToDelete(null);
  };

  // Add this function to handle manual wall merging
  const handleManualWallMerge = async (selectedWallIds) => {
    const wall1 = walls.find(w => w.id === selectedWallIds[0]);
    const wall2 = walls.find(w => w.id === selectedWallIds[1]);

    if (!wall1 || !wall2) {
      setWallMergeError("Invalid wall selection.");
      setTimeout(() => setWallMergeError(''), 5000);
      return;
    }

    if (
      wall1.application_type !== wall2.application_type ||
      wall1.height !== wall2.height ||
      wall1.thickness !== wall2.thickness
    ) {
      setWallMergeError("Walls must have the same type, height, and thickness.");
      setTimeout(() => setWallMergeError(''), 5000);
      return;
    }

    const connected =
      (wall1.start_x === wall2.end_x && wall1.start_y === wall2.end_y) ||
      (wall1.end_x === wall2.start_x && wall1.end_y === wall2.start_y) ||
      (wall1.start_x === wall2.start_x && wall1.start_y === wall2.start_y) ||
      (wall1.end_x === wall2.end_x && wall1.end_y === wall2.end_y);

    if (!connected) {
      setWallMergeError("Walls must be connected at one endpoint.");
      setTimeout(() => setWallMergeError(''), 5000);
      return;
    }

    try {
      const response = await api.post("/walls/merge_walls/", {
        wall_ids: [wall1.id, wall2.id],
      });

      if (response.status === 201) {
        const newWall = response.data;
        setWalls(prev => [
          ...prev.filter(w => w.id !== wall1.id && w.id !== wall2.id),
          newWall,
        ]);
        setSelectedWallsForRoom([]);
        setWallMergeSuccess(true);
        setTimeout(() => setWallMergeSuccess(false), 3000);
      }
    } catch (error) {
      if (error.response && error.response.data) {
        const errorData = error.response.data;
        if (errorData.wall_ids) {
          setWallMergeError(`Merge Error: ${errorData.wall_ids[0]}`);
        } else if (errorData.non_field_errors) {
          setWallMergeError(`Merge Error: ${errorData.non_field_errors[0]}`);
        } else if (errorData.error) {
          setWallMergeError(`Merge Error: ${errorData.error}`);
        } else if (typeof errorData === 'string') {
          setWallMergeError(`Merge Error: ${errorData}`);
        } else {
          setWallMergeError('Unable to merge walls. The walls may not be compatible for merging.');
        }
      } else if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
        setWallMergeError('Network error. Please check your connection and try again.');
      } else {
        setWallMergeError('Failed to merge walls. Please try again.');
      }
      setTimeout(() => setWallMergeError(''), 5000);
    }
  };

  // Add this function to handle door selection and open the editor modal
  const handleDoorSelect = (door) => {
    setEditingDoor(door);
    setShowDoorEditor(true);
  };

  // Add this function to handle door deletion
  const handleDeleteDoor = async (doorId) => {
    try {
      await api.delete(`/doors/${doorId}/`);
      setDoors(prevDoors => prevDoors.filter(door => door.id !== doorId));
      setShowDoorEditor(false);
      setEditingDoor(null);
    } catch (error) {
      console.error('Error deleting door:', error);
      alert('Failed to delete door.');
    }
  };

  // Expose all state and handlers
  return {
    // State
    project,
    walls,
    isEditingMode,
    setIsEditingMode,
    currentMode,
    setCurrentMode,
    selectedWall,
    setSelectedWall,
    is3DView,
    setIs3DView,
    isInteriorView,
    setIsInteriorView,
    threeCanvasInstance,
    showRoomManager,
    setShowRoomManager,
    selectedWallsForRoom,
    setSelectedWallsForRoom,
    editingRoom,
    setEditingRoom,
    rooms,
    setRooms,
    selectedWallType,
    setSelectedWallType,
    showWallEditor,
    setShowWallEditor,
    showRoomManagerModal,
    setShowRoomManagerModal,
    joints,
    setJoints,
    selectedDoorWall,
    setSelectedDoorWall,
    showDoorManager,
    setShowDoorManager,
    doors,
    setDoors,
    editingDoor,
    setEditingDoor,
    showDoorEditor,
    setShowDoorEditor,
    selectedRoomPoints,
    setSelectedRoomPoints,
    isEditingName,
    setIsEditingName,
    editedName,
    setEditedName,
    wallMergeError,
    setWallMergeError,
    dbConnectionError,
    setDbConnectionError,
    showWallDeleteConfirm,
    setShowWallDeleteConfirm,
    wallToDelete,
    setWallToDelete,
    wallDeleteSuccess,
    setWallDeleteSuccess,
    wallDeleteError,
    setWallDeleteError,
    roomCreateSuccess,
    setRoomCreateSuccess,
    wallMergeSuccess,
    setWallMergeSuccess,
    roomError,
    setRoomError,
    projectLoadError,
    setProjectLoadError,
    // Handlers
    fetchProjectDetails,
    handleCreateRoom,
    handleRoomUpdate,
    handleRoomDelete,
    handleCreateDoor,
    handleUpdateDoor,
    handleWallCreate,
    handleWallSelect,
    handleWallUpdate,
    handleWallDelete,
    handleManualWallMerge,
    handleDoorSelect,
    handleDeleteDoor,
    // Utility
    isDatabaseConnectionError,
    areCollinearWalls,
    calculateIntersection,
    arePointsEqual,
    resetAllSelections,
    toggleMode,
    refreshWalls,
    handleConfirmWallDelete,
    handleCancelWallDelete,
  };
} 