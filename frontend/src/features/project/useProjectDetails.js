import { useState, useEffect, useRef } from 'react';
import api from '../../api/api';
import ThreeCanvas3D from '../canvas/ThreeCanvas3D';
import { areCollinearWalls, calculateIntersection, arePointsEqual, detectRoomWalls } from './projectUtils';

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
  
  // Function to update room points and automatically detect walls
  const updateRoomPointsAndDetectWalls = (newPoints) => {
    setSelectedRoomPoints(newPoints);
    
    // If we have enough points to form a polygon, detect walls
    if (newPoints.length >= 3) {
      const detectedWallIds = detectRoomWalls(newPoints, walls, 1); // 1mm tolerance
      console.log('Auto-detected walls for room:', detectedWallIds);
      setSelectedWallsForRoom(detectedWallIds);
    } else {
      // Clear selected walls if not enough points
      setSelectedWallsForRoom([]);
    }
  };
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
    updateRoomPointsAndDetectWalls([]);
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
      const threeCanvas = new ThreeCanvas3D('three-canvas-container', walls, joints, doors, 0.01, project);
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
        
        // Update wall heights in frontend state immediately
        if (roomData.walls && roomData.height) {
          setWalls(prevWalls => 
            prevWalls.map(wall => 
              roomData.walls.includes(wall.id) 
                ? { ...wall, height: roomData.height }
                : wall
            )
          );
          console.log('Updated wall heights in frontend state:', roomData.walls, 'to height:', roomData.height);
        }
        
        setRoomCreateSuccess(true);
        setTimeout(() => setRoomCreateSuccess(false), 3000);
        setShowRoomManagerModal(false);
        updateRoomPointsAndDetectWalls([]);
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
      
      // Update wall heights in frontend state immediately if height was changed
      if (updatedRoomData.height) {
        // Get the room to find its associated walls
        const room = rooms.find(r => r.id === updatedRoomData.id);
        if (room && room.walls) {
          setWalls(prevWalls => 
            prevWalls.map(wall => 
              room.walls.includes(wall.id) 
                ? { ...wall, height: updatedRoomData.height }
                : wall
            )
          );
          console.log('Updated wall heights in frontend state for room update:', room.walls, 'to height:', updatedRoomData.height);
        }
      }
      
      setShowRoomManagerModal(false);
      updateRoomPointsAndDetectWalls([]);
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
      updateRoomPointsAndDetectWalls([]);
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
    setCurrentMode((prev) => {
      if (prev === mode) {
        // Exiting mode
        if (mode === 'define-room') {
          setShowRoomManagerModal(false);
          updateRoomPointsAndDetectWalls([]);
        }
        return null;
      } else {
        // Entering new mode
        if (mode === 'define-room') {
          setShowRoomManagerModal(true); // Always show modal in define-room mode
          updateRoomPointsAndDetectWalls([]);    // Clear points when entering
        }
        return mode;
      }
    });
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

  // Add this function to handle room selection and open the editor modal
  const handleRoomSelect = (roomId) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      setEditingRoom(room);
      setShowRoomManagerModal(true); // Always show modal for editing
      setSelectedWallsForRoom(room.walls);
      updateRoomPointsAndDetectWalls(room.room_points || []);
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

  // Add a new helper function handleWallUpdateNoMerge that is like handleWallUpdate but does not call checkAndMergeWalls
  const handleWallUpdateNoMerge = async (updatedWall) => {
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
      // Do NOT call checkAndMergeWalls here
    } catch (error) {
      if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error') || (error.response?.status >= 500 && error.response?.status < 600)) {
        setDbConnectionError(true);
        setTimeout(() => setDbConnectionError(false), 5000);
      } else {
        alert('Failed to update wall');
      }
    }
  };

  // Add this function to handle wall deletion
  const handleWallDelete = async (wallId) => {
    try {
      // Find the wall to be deleted
      const wallToDelete = walls.find(w => w.id === wallId);
      if (!wallToDelete) return;

      // Collect all intersection points (endpoints and mid-wall intersections)
      const pointsToCheck = [
        { x: wallToDelete.start_x, y: wallToDelete.start_y },
        { x: wallToDelete.end_x, y: wallToDelete.end_y }
      ];
      // Find all walls that intersect wallToDelete (not at endpoints)
      walls.forEach(wall => {
        if (wall.id === wallToDelete.id) return;
        const intersection = calculateIntersection(
          { x: wallToDelete.start_x, y: wallToDelete.start_y },
          { x: wallToDelete.end_x, y: wallToDelete.end_y },
          { x: wall.start_x, y: wall.start_y },
          { x: wall.end_x, y: wall.end_y }
        );
        if (intersection) {
          // Exclude endpoints
          const isEndpoint = (pt, w) =>
            (Math.abs(w.start_x - pt.x) < 0.001 && Math.abs(w.start_y - pt.y) < 0.001) ||
            (Math.abs(w.end_x - pt.x) < 0.001 && Math.abs(w.end_y - pt.y) < 0.001);
          if (!isEndpoint(intersection, wallToDelete) && !isEndpoint(intersection, wall)) {
            // Only add if not already present
            if (!pointsToCheck.some(pt => Math.abs(pt.x - intersection.x) < 0.001 && Math.abs(pt.y - intersection.y) < 0.001)) {
              pointsToCheck.push(intersection);
            }
          }
        }
      });

      // Delete the wall
      await api.delete(`/walls/${wallId}/`);
      let updatedWalls = walls.filter(w => w.id !== wallId);

      // Helper to find walls sharing a point
      const findWallsAtPoint = (pt, wallList) =>
        wallList.filter(w =>
          (Math.abs(w.start_x - pt.x) < 0.001 && Math.abs(w.start_y - pt.y) < 0.001) ||
          (Math.abs(w.end_x - pt.x) < 0.001 && Math.abs(w.end_y - pt.y) < 0.001)
        );
      // Helper to check if two walls can be merged
      const canMerge = (w1, w2) => {
        if (
          w1.application_type !== w2.application_type ||
          w1.height !== w2.height ||
          w1.thickness !== w2.thickness
        ) return false;
        // Collinear check
        return areCollinearWalls(w1, w2);
      };
      // Recursive merge
      const tryMergeAtPoint = async (pt) => {
        let mergeHappened = false;
        let wallsAtPt = findWallsAtPoint(pt, updatedWalls);
        if (wallsAtPt.length === 2) {
          const [w1, w2] = wallsAtPt;
          if (canMerge(w1, w2)) {
            // Call merge API
            const response = await api.post("/walls/merge_walls/", {
              wall_ids: [w1.id, w2.id],
            });
            if (response.status === 201) {
              const newWall = response.data;
              updatedWalls = updatedWalls.filter(w => w.id !== w1.id && w.id !== w2.id);
              updatedWalls.push(newWall);
              mergeHappened = true;
              // Recursively try to merge at both endpoints of the new wall
              await tryMergeAtPoint({ x: newWall.start_x, y: newWall.start_y });
              await tryMergeAtPoint({ x: newWall.end_x, y: newWall.end_y });
            }
          }
        }
        return mergeHappened;
      };
      // --- Network-wide merge: collect all unique endpoints ---
      const getAllEndpoints = (wallList) => {
        const pts = [];
        wallList.forEach(w => {
          const addPt = (pt) => {
            if (!pts.some(p => Math.abs(p.x - pt.x) < 0.001 && Math.abs(p.y - pt.y) < 0.001)) {
              pts.push({ x: pt.x, y: pt.y });
            }
          };
          addPt({ x: w.start_x, y: w.start_y });
          addPt({ x: w.end_x, y: w.end_y });
        });
        return pts;
      };
      // Try to merge at all collected points (endpoints and intersections)
      for (const pt of pointsToCheck) {
        await tryMergeAtPoint(pt);
      }
      // --- Now do a network-wide merge pass ---
      let mergeOccurred = true;
      while (mergeOccurred) {
        mergeOccurred = false;
        const endpoints = getAllEndpoints(updatedWalls);
        for (const pt of endpoints) {
          const merged = await tryMergeAtPoint(pt);
          if (merged) mergeOccurred = true;
        }
      }
      setWalls(updatedWalls);
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

  // Advanced modular wall adding with splitting (splits both existing and new wall at intersections)
  const handleAddWallWithSplitting = async (startPoint, endPoint, wallProps) => {
    // 1. Find all intersections between the new wall and existing walls (not at endpoints)
    const intersections = [];
    const isAtEndpoint = (pt, w) =>
      (Math.abs(w.start_x - pt.x) < 0.001 && Math.abs(w.start_y - pt.y) < 0.001) ||
      (Math.abs(w.end_x - pt.x) < 0.001 && Math.abs(w.end_y - pt.y) < 0.001);
    // Helper: check if a point is on the body of a wall (not at endpoint)
    const isOnWallBody = (pt, wall) => {
      // Vector math: check if pt is on the segment
      const dx = wall.end_x - wall.start_x;
      const dy = wall.end_y - wall.start_y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq === 0) return false;
      const t = ((pt.x - wall.start_x) * dx + (pt.y - wall.start_y) * dy) / lengthSq;
      if (t <= 0 || t >= 1) return false;
      // Closest point on segment
      const closest = { x: wall.start_x + t * dx, y: wall.start_y + t * dy };
      return Math.abs(closest.x - pt.x) < 0.001 && Math.abs(closest.y - pt.y) < 0.001;
    };
    walls.forEach(wall => {
      // 1a. Standard intersection
      const intersection = calculateIntersection(
        { x: startPoint.x, y: startPoint.y },
        { x: endPoint.x, y: endPoint.y },
        { x: wall.start_x, y: wall.start_y },
        { x: wall.end_x, y: wall.end_y }
      );
      if (intersection) {
        if (!isAtEndpoint(intersection, wall) &&
            !(Math.abs(intersection.x - startPoint.x) < 0.001 && Math.abs(intersection.y - startPoint.y) < 0.001) &&
            !(Math.abs(intersection.x - endPoint.x) < 0.001 && Math.abs(intersection.y - endPoint.y) < 0.001)) {
          intersections.push({ wall, intersection });
        }
      }
      // 1b. Split if startPoint is on wall body (not at endpoint)
      if (isOnWallBody(startPoint, wall)) {
        intersections.push({ wall, intersection: { x: startPoint.x, y: startPoint.y } });
      }
      // 1c. Split if endPoint is on wall body (not at endpoint)
      if (isOnWallBody(endPoint, wall)) {
        intersections.push({ wall, intersection: { x: endPoint.x, y: endPoint.y } });
      }
    });

    // 2. Split existing walls at intersections
    const wallsToDelete = [];
    let wallsToAdd = [];
    intersections.forEach(({ wall, intersection }) => {
      wallsToDelete.push(wall);
      wallsToAdd.push({
        start_x: wall.start_x,
        start_y: wall.start_y,
        end_x: intersection.x,
        end_y: intersection.y,
        height: wall.height,
        thickness: wall.thickness,
        application_type: wall.application_type,
        project: project.id
      });
      wallsToAdd.push({
        start_x: intersection.x,
        start_y: intersection.y,
        end_x: wall.end_x,
        end_y: wall.end_y,
        height: wall.height,
        thickness: wall.thickness,
        application_type: wall.application_type,
        project: project.id
      });
    });

    // 3. Split the new wall at intersection points (sort by distance from start)
    let splitPoints = [startPoint, ...intersections.map(i => i.intersection), endPoint];
    splitPoints = splitPoints.sort((a, b) => {
      const da = Math.hypot(a.x - startPoint.x, a.y - startPoint.y);
      const db = Math.hypot(b.x - startPoint.x, b.y - startPoint.y);
      return da - db;
    });
    let newWallSegments = [];
    for (let i = 0; i < splitPoints.length - 1; i++) {
      newWallSegments.push({
        start_x: splitPoints[i].x,
        start_y: splitPoints[i].y,
        end_x: splitPoints[i+1].x,
        end_y: splitPoints[i+1].y,
        height: wallProps.height,
        thickness: wallProps.thickness,
        application_type: wallProps.application_type,
        project: project.id
      });
    }

    // --- Filter out zero-length segments ---
    const isZeroLength = (w) => Math.hypot(w.start_x - w.end_x, w.start_y - w.end_y) < 0.001;
    wallsToAdd = wallsToAdd.filter(w => !isZeroLength(w));
    newWallSegments = newWallSegments.filter(w => !isZeroLength(w));

    // 4. Delete split walls, add new segments (API)
    try {
      for (const wall of wallsToDelete) {
        await api.delete(`/walls/${wall.id}/`);
      }
      const createdWalls = [];
      for (const wallData of wallsToAdd) {
        const created = await api.post('/walls/create_wall/', wallData);
        createdWalls.push(created.data);
      }
      for (const wallData of newWallSegments) {
        const created = await api.post('/walls/create_wall/', wallData);
        createdWalls.push(created.data);
      }
      await refreshWalls();
      return createdWalls;
    } catch (error) {
      console.error('Error in modular wall splitting:', error);
      throw error;
    }
  };

  // Add this function to toggle between interior and exterior 3D views
  const handleViewToggle = () => {
    if (!threeCanvasInstance.current) return;
    if (isInteriorView) {
      threeCanvasInstance.current.animateToExteriorView();
      setIsInteriorView(false);
    } else {
      threeCanvasInstance.current.animateToInteriorView();
      setIsInteriorView(true);
    }
  };

  // Expose all state and handlers
  return {
    // State
    project,
    walls,
    setWalls,
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
    updateRoomPointsAndDetectWalls,
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
    handleAddWallWithSplitting,
    handleViewToggle,
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
    handleWallUpdateNoMerge,
    handleRoomSelect,
  };
} 