import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '../../api/api';
import ThreeCanvas3D from '../canvas/ThreeCanvas3D';
import { areCollinearWalls, calculateIntersection, arePointsEqual, detectRoomWalls } from './projectUtils';
import { normalizeWallCoordinates } from '../canvas/drawing';

export default function useProjectDetails(projectId) {
  // State
  const [project, setProject] = useState(null);
  const [walls, setWalls] = useState([]);
  const [storeys, setStoreys] = useState([]);
  const [activeStoreyId, setActiveStoreyId] = useState(null);
  const [storeyError, setStoreyError] = useState('');
  const [isStoreyLoading, setIsStoreyLoading] = useState(false);
  const [filteredWalls, setFilteredWalls] = useState([]);
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [currentMode, setCurrentMode] = useState(null);
  const [selectedWall, setSelectedWall] = useState(null);
  const [is3DView, setIs3DView] = useState(false);
  const [isInteriorView, setIsInteriorView] = useState(false);
  const threeCanvasInstance = useRef(null);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const [selectedWallsForRoom, setSelectedWallsForRoom] = useState([]);
  const [editingRoom, setEditingRoom] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [filteredRooms, setFilteredRooms] = useState([]);
  const [filteredGhostWalls, setFilteredGhostWalls] = useState([]);
  const [filteredGhostAreas, setFilteredGhostAreas] = useState([]);
  const [projectCalculatedHeight, setProjectCalculatedHeight] = useState(0);
  const [selectedWallType, setSelectedWallType] = useState('wall');
  const [showWallEditor, setShowWallEditor] = useState(false);
  const [showRoomManagerModal, setShowRoomManagerModal] = useState(false);
  const [isRoomManagerMinimized, setRoomManagerMinimized] = useState(false);
  const [joints, setJoints] = useState([]);
  const [filteredJoints, setFilteredJoints] = useState([]);
  const [selectedDoorWall, setSelectedDoorWall] = useState(null);
  const [showDoorManager, setShowDoorManager] = useState(false);
  const [doors, setDoors] = useState([]);
  const [filteredDoors, setFilteredDoors] = useState([]);
  const [editingDoor, setEditingDoor] = useState(null);
  const [showDoorEditor, setShowDoorEditor] = useState(false);
  const [showStoreyWizard, setShowStoreyWizard] = useState(false);
  const [selectionContext, setSelectionContext] = useState('room'); // 'room' | 'storey'
  const [storeyWizardStep, setStoreyWizardStep] = useState(1);
  const [storeyWizardSourceStoreyId, setStoreyWizardSourceStoreyId] = useState(null);
  const [storeyWizardName, setStoreyWizardName] = useState('');
  const [storeyWizardElevation, setStoreyWizardElevation] = useState(0);
  const [storeyWizardDefaultHeight, setStoreyWizardDefaultHeight] = useState(3000);
  const [storeyWizardSlabThickness, setStoreyWizardSlabThickness] = useState(0);
  const [storeyWizardAreas, setStoreyWizardAreas] = useState([]);
  const [storeyWizardRoomSelections, setStoreyWizardRoomSelections] = useState([]);
  const [storeyWizardRoomOverrides, setStoreyWizardRoomOverrides] = useState({});
  const [storeyWizardAreaOverrides, setStoreyWizardAreaOverrides] = useState({});
  const [storeyWizardError, setStoreyWizardError] = useState('');
  const [isStoreyWizardMinimized, setStoreyWizardMinimized] = useState(false);
  const [isLevelEditMode, setIsLevelEditMode] = useState(false);
  const [levelEditSelections, setLevelEditSelections] = useState([]);
  const [levelEditOverrides, setLevelEditOverrides] = useState({});
  const [isLevelEditApplying, setIsLevelEditApplying] = useState(false);
  const [levelEditError, setLevelEditError] = useState('');
  const [levelEditSuccess, setLevelEditSuccess] = useState('');
  const activeStorey = useMemo(() => {
    if (!activeStoreyId) return null;
    return storeys.find(storey => String(storey.id) === String(activeStoreyId)) || null;
  }, [storeys, activeStoreyId]);
  useEffect(() => {
    api.get('/csrf-token/').catch((error) => {
      console.warn('Failed to prefetch CSRF token:', error);
    });
  }, []);

  const initializeRoomOverride = useCallback((room) => {
    if (!room) {
      return {
        baseElevation: 0,
        height: storeyWizardDefaultHeight || 3000,
      };
    }
    const baseElevation =
      (Number(room.base_elevation_mm) || 0) +
      (Number(room.height) || storeyWizardDefaultHeight || 0);
    const height = Number(room.height) || storeyWizardDefaultHeight || 3000;
    return {
      baseElevation,
      height,
    };
  }, [storeyWizardDefaultHeight]);

  useEffect(() => {
    setStoreyWizardRoomOverrides((prev) => {
      const next = { ...prev };
      const selectedIds = new Set(
        (storeyWizardRoomSelections || []).map((id) => String(id))
      );

      selectedIds.forEach((id) => {
        if (!next[id]) {
          const room = rooms.find((r) => String(r.id) === id);
          if (room) {
            next[id] = initializeRoomOverride(room);
          }
        }
      });

      Object.keys(next).forEach((id) => {
        if (!selectedIds.has(id)) {
          delete next[id];
        }
      });

      return next;
    });
  }, [storeyWizardRoomSelections, rooms, initializeRoomOverride]);

  const updateStoreyWizardRoomOverride = useCallback((roomId, updates) => {
    setStoreyWizardRoomOverrides((prev) => {
      const key = String(roomId);
      const existing = prev[key] || initializeRoomOverride(
        rooms.find((room) => String(room.id) === key)
      );
      return {
        ...prev,
        [key]: {
          ...existing,
          ...updates,
        },
      };
    });
  }, [initializeRoomOverride, rooms]);

  const updateStoreyWizardAreaOverride = useCallback((areaId, updates) => {
    setStoreyWizardAreaOverrides((prev) => {
      const key = String(areaId);
      const existing = prev[key] || {
        height: storeyWizardDefaultHeight || 3000,
      };
      return {
        ...prev,
        [key]: {
          ...existing,
          ...updates,
        },
      };
    });
  }, [storeyWizardDefaultHeight]);

  const enterLevelEditMode = useCallback(() => {
    setIsLevelEditMode(true);
    setLevelEditSelections([]);
    setLevelEditOverrides({});
    setLevelEditError('');
    setLevelEditSuccess('');
    setSelectionContext('room');
  }, []);

  const exitLevelEditMode = useCallback(() => {
    setIsLevelEditMode(false);
    setLevelEditSelections([]);
    setLevelEditOverrides({});
    setIsLevelEditApplying(false);
    setLevelEditError('');
    setLevelEditSuccess('');
    if (currentMode === 'storey-area') {
      setCurrentMode(null);
    }
    setSelectedRoomPoints([]);
    setSelectedWallsForRoom([]);
  }, [currentMode]);

  const toggleLevelEditRoom = useCallback((roomId) => {
    if (roomId === null || roomId === undefined) {
      return;
    }
    const targetStoreyElevation =
      activeStorey && activeStorey.elevation_mm !== undefined
        ? Number(activeStorey.elevation_mm) || 0
        : 0;

    setLevelEditSelections((prev) => {
      const next = new Set(prev || []);
      const key = String(roomId);
      const alreadySelected = next.has(roomId);

      if (alreadySelected) {
        next.delete(roomId);
        setLevelEditOverrides((prevOverrides) => {
          if (!prevOverrides[key]) {
            return prevOverrides;
          }
          const updated = { ...prevOverrides };
          delete updated[key];
          return updated;
        });
      } else {
        next.add(roomId);
        const sourceRoom = rooms.find((room) => String(room.id) === key);
        const sourceStorey =
          storeys.find((storey) => String(storey.id) === String(sourceRoom?.storey)) || null;
        const sourceHeight =
          sourceRoom && sourceRoom.height !== undefined && sourceRoom.height !== null
            ? Number(sourceRoom.height) || 0
            : sourceStorey && sourceStorey.default_room_height_mm !== undefined
              ? Number(sourceStorey.default_room_height_mm) || 0
              : activeStorey && activeStorey.default_room_height_mm !== undefined
                ? Number(activeStorey.default_room_height_mm) || 0
                : 0;
        const sourceBase =
          sourceRoom && sourceRoom.base_elevation_mm !== undefined && sourceRoom.base_elevation_mm !== null
            ? Number(sourceRoom.base_elevation_mm) || 0
            : sourceStorey && sourceStorey.elevation_mm !== undefined
              ? Number(sourceStorey.elevation_mm) || 0
              : 0;
        const stackedBase = sourceBase + sourceHeight;
        const suggestedBase = Math.max(stackedBase, targetStoreyElevation);

        setLevelEditOverrides((prevOverrides) => ({
          ...prevOverrides,
          [key]: {
            baseElevation: suggestedBase,
            height: sourceHeight,
          },
        }));
      }

      return Array.from(next);
    });
    setLevelEditError('');
    setLevelEditSuccess('');
  }, [activeStorey, rooms, storeys]);

  const clearLevelEditSelections = useCallback(() => {
    setLevelEditSelections([]);
    setLevelEditOverrides({});
    setLevelEditError('');
    setLevelEditSuccess('');
  }, []);

  const updateLevelEditOverride = useCallback((roomId, updates) => {
    const key = String(roomId);
    setLevelEditOverrides((prev) => {
      const existing = prev[key] || {};
      const normalizedUpdates = { ...updates };
      if (normalizedUpdates.baseElevation !== undefined && normalizedUpdates.baseElevation !== null) {
        normalizedUpdates.baseElevation = Number(normalizedUpdates.baseElevation);
        if (Number.isNaN(normalizedUpdates.baseElevation)) {
          normalizedUpdates.baseElevation = existing.baseElevation ?? activeStorey?.elevation_mm ?? 0;
        }
      }
      if (normalizedUpdates.height !== undefined && normalizedUpdates.height !== null) {
        normalizedUpdates.height = Number(normalizedUpdates.height);
        if (Number.isNaN(normalizedUpdates.height)) {
          normalizedUpdates.height = existing.height ?? activeStorey?.default_room_height_mm ?? 0;
        }
      }
      const next = {
        ...prev,
        [key]: {
          baseElevation: existing.baseElevation ?? (activeStorey?.elevation_mm ?? 0),
          height: existing.height ?? activeStorey?.default_room_height_mm ?? 0,
          ...normalizedUpdates,
        },
      };
      if (!next[key].baseElevation && next[key].baseElevation !== 0) {
        next[key].baseElevation = activeStorey?.elevation_mm ?? 0;
      }
      if (!next[key].height && next[key].height !== 0) {
        next[key].height = activeStorey?.default_room_height_mm ?? 0;
      }
      const minBase = activeStorey?.elevation_mm !== undefined && activeStorey?.elevation_mm !== null
        ? Number(activeStorey.elevation_mm) || 0
        : 0;
      if (next[key].baseElevation < minBase) {
        next[key].baseElevation = minBase;
      }
      if (next[key].height < 0) {
        next[key].height = 0;
      }
      return next;
    });
  }, [activeStorey]);
  const [selectedRoomPoints, setSelectedRoomPoints] = useState([]);
  const [currentView, setCurrentView] = useState('wall-plan'); // 'wall-plan', 'ceiling-plan', or 'floor-plan'
  const [wallSplitError, setWallSplitError] = useState('');
  const [wallSplitSuccess, setWallSplitSuccess] = useState(false);
  const MERGE_POINT_TOLERANCE = 0.5;
  const SPLIT_ENDPOINT_TOLERANCE = 1.0;

  const defaultStoreyId = useMemo(() => {
    return storeys.length > 0 ? storeys[0].id : null;
  }, [storeys]);

  const applyStoreyList = useCallback((incomingStoreys) => {
    if (!Array.isArray(incomingStoreys)) {
      setStoreys([]);
      setActiveStoreyId(null);
      return [];
    }

    const sorted = [...incomingStoreys].sort((a, b) => {
      const orderDiff = (a.order ?? 0) - (b.order ?? 0);
      if (orderDiff !== 0) return orderDiff;

      const elevationDiff = (a.elevation_mm ?? 0) - (b.elevation_mm ?? 0);
      if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;

      return (a.id ?? 0) - (b.id ?? 0);
    });

    setStoreys(sorted);
    setActiveStoreyId((prev) => {
      if (prev && sorted.some(storey => String(storey.id) === String(prev))) {
        return prev;
      }
      return sorted[0]?.id ?? null;
    });

    return sorted;
  }, []);

  const ensureStoreys = useCallback(async (projectData = null) => {
    setIsStoreyLoading(true);
    try {
      if (projectData && Array.isArray(projectData.storeys) && projectData.storeys.length > 0) {
        return applyStoreyList(projectData.storeys);
      }

      const response = await api.get(`/storeys/?project=${projectId}`);
      const storeyList = Array.isArray(response.data) ? response.data : [];
      if (storeyList.length > 0) {
        return applyStoreyList(storeyList);
      }

      const fallbackProject = projectData || project;
      if (!fallbackProject) {
        return applyStoreyList([]);
      }

      const createPayload = {
        project: parseInt(projectId, 10),
        name: 'Ground Floor',
        elevation_mm: 0,
        order: 0,
        default_room_height_mm: fallbackProject.height || 3000,
        slab_thickness_mm: 0,
      };

      const createdResponse = await api.post('/storeys/', createPayload);
      return applyStoreyList([createdResponse.data]);
    } catch (error) {
      console.error('Error loading storeys:', error);
      setStoreyError('Failed to load storeys');
      applyStoreyList([]);
      return [];
    } finally {
      setIsStoreyLoading(false);
    }
  }, [applyStoreyList, projectId, project]);

  const openStoreyWizard = useCallback(() => {
    const baseStorey =
      storeys.find(storey => String(storey.id) === String(activeStoreyId)) ||
      storeys[storeys.length - 1] ||
      null;

    const nextOrder = (storeys[storeys.length - 1]?.order ?? storeys.length - 1) + 1;
    const defaultName = baseStorey
      ? `${baseStorey.name} +1`
      : `Level ${storeys.length + 1}`;

    const baseHeight = baseStorey?.default_room_height_mm ?? 3000;

    setStoreyWizardStep(1);
    setStoreyWizardSourceStoreyId(baseStorey?.id ?? null);
    setStoreyWizardName(defaultName);
    setStoreyWizardElevation(null);
    setStoreyWizardDefaultHeight(baseHeight);
    setStoreyWizardSlabThickness(0);
    setStoreyWizardAreas([]);
    setStoreyWizardRoomSelections([]);
    setStoreyWizardRoomOverrides({});
    setStoreyWizardAreaOverrides({});
    setStoreyWizardError('');
    setSelectionContext('room');
    setSelectedRoomPoints([]);
    setSelectedWallsForRoom([]);
    setShowStoreyWizard(true);
  }, [activeStoreyId, storeys]);

  const closeStoreyWizard = useCallback(() => {
    setShowStoreyWizard(false);
    setSelectionContext('room');
    setStoreyWizardAreas([]);
    setStoreyWizardRoomSelections([]);
    setStoreyWizardRoomOverrides({});
    setStoreyWizardAreaOverrides({});
    setStoreyWizardError('');
    setStoreyWizardStep(1);
    setStoreyWizardMinimized(false);
    if (currentMode === 'storey-area') {
      setCurrentMode(null);
    }
    setSelectedRoomPoints([]);
    setSelectedWallsForRoom([]);
  }, [currentMode]);

  const beginStoreyAreaSelection = useCallback(() => {
    setSelectionContext('storey');
    setSelectedRoomPoints([]);
    setSelectedWallsForRoom([]);
    setIsEditingMode(true);
    setCurrentMode('storey-area');
    setStoreyWizardMinimized(true);
  }, []);

  const cancelStoreyAreaSelection = useCallback(() => {
    setSelectionContext('room');
    setSelectedRoomPoints([]);
    setSelectedWallsForRoom([]);
    setStoreyWizardMinimized(false);
    if (currentMode === 'storey-area') {
      setCurrentMode(null);
    }
  }, [currentMode]);
  
  // Add shared panel data state for cross-tab communication
  const [sharedPanelData, setSharedPanelData] = useState({
    wallPanels: null,        // From wall plan tab
    ceilingPanels: null,
    // Canvas images for export
    wallPlanImage: null,
    ceilingPlanImage: null,
    floorPlanImage: null,     // From ceiling plan tab
    floorPanels: null,       // From floor plan tab
    wallPanelAnalysis: null, // Panel analysis from wall calculations
    // Support accessories information from ceiling plan
    supportType: null,
    includeAccessories: false,
    includeCable: false,
    aluSuspensionCustomDrawing: false,
    panelsNeedSupport: false,
    lastUpdated: null        // Track when data was last updated
  });
  
  useEffect(() => {
    const matchesActiveStorey = (storeyId) => {
      if (!activeStoreyId) {
        return true;
      }
      if (storeyId === null || storeyId === undefined) {
        if (defaultStoreyId === null || defaultStoreyId === undefined) {
          return false;
        }
        return String(defaultStoreyId) === String(activeStoreyId);
      }
      return String(storeyId) === String(activeStoreyId);
    };

    const normalizedWalls = Array.isArray(walls) ? walls : [];
    const visibleWalls = normalizedWalls.filter((wall) => matchesActiveStorey(wall.storey));
    setFilteredWalls(visibleWalls);

    const normalizedRooms = Array.isArray(rooms) ? rooms : [];
    const visibleRooms = normalizedRooms.filter((room) => matchesActiveStorey(room.storey));
    setFilteredRooms(visibleRooms);

    const wallStoreyMap = new Map(
      normalizedWalls.map((wall) => [String(wall.id), wall.storey])
    );

    const normalizedDoors = Array.isArray(doors) ? doors : [];
    const visibleDoors = normalizedDoors.filter((door) => {
      const directStorey = door.storey ?? door.storey_id;
      if (directStorey !== null && directStorey !== undefined) {
        return matchesActiveStorey(directStorey);
      }

      const linkedWallId = door.linked_wall || door.wall || door.wall_id;
      if (!linkedWallId) {
        return matchesActiveStorey(null);
      }
      const wallStorey = wallStoreyMap.get(String(linkedWallId));
      return matchesActiveStorey(wallStorey);
    });
    setFilteredDoors(visibleDoors);

    const visibleWallIds = new Set(visibleWalls.map((wall) => wall.id));
    const normalizedJoints = Array.isArray(joints) ? joints : [];
    const visibleJoints = normalizedJoints.filter(
      (joint) =>
        visibleWallIds.has(joint.wall_1) && visibleWallIds.has(joint.wall_2)
    );
    setFilteredJoints(visibleJoints);
  }, [walls, rooms, doors, joints, activeStoreyId, defaultStoreyId]);

  useEffect(() => {
    if (selectedWallsForRoom.length === 0) {
      return;
    }
    setSelectedWallsForRoom((prev) =>
      prev.filter((wallId) => filteredWalls.some((wall) => wall.id === wallId))
    );
  }, [filteredWalls]);

  useEffect(() => {
    if (!activeStoreyId) {
      setFilteredGhostWalls([]);
      setFilteredGhostAreas([]);
      return;
    }

    const targetStorey =
      storeys.find(storey => String(storey.id) === String(activeStoreyId)) || null;

    if (!targetStorey) {
      setFilteredGhostWalls([]);
      setFilteredGhostAreas([]);
      return;
    }

    const targetElevation = typeof targetStorey.elevation_mm === 'number'
      ? targetStorey.elevation_mm
      : Number(targetStorey.elevation_mm) || 0;
    const defaultHeight = typeof targetStorey.default_room_height_mm === 'number'
      ? targetStorey.default_room_height_mm
      : Number(targetStorey.default_room_height_mm) || 0;

    const ghostMap = new Map();
    const normalizedWalls = Array.isArray(walls) ? walls : [];
    const normalizedRooms = Array.isArray(filteredRooms) ? filteredRooms : [];

    normalizedRooms.forEach((room) => {
      const roomWalls = Array.isArray(room.walls) ? room.walls : [];
      const roomHeight = room.height !== undefined && room.height !== null
        ? Number(room.height) || 0
        : defaultHeight;
      const requiredTop = targetElevation + roomHeight;

      roomWalls.forEach((wallId) => {
        const wall = normalizedWalls.find((w) => String(w.id) === String(wallId));
        if (!wall) {
          return;
        }

        if (String(wall.storey) === String(activeStoreyId)) {
          return;
        }

        const sharedCount = Array.isArray(wall.rooms) ? wall.rooms.length : 0;
        if (sharedCount <= 1) {
          return;
        }

        const wallStorey =
          storeys.find(storey => String(storey.id) === String(wall.storey)) || null;
        const wallBaseElevation = wallStorey && wallStorey.elevation_mm !== undefined
          ? Number(wallStorey.elevation_mm) || 0
          : 0;
        const wallHeight = wall.height !== undefined && wall.height !== null
          ? Number(wall.height) || 0
          : 0;
        const wallTop = wallBaseElevation + wallHeight;

        if (wallTop + 1e-3 < requiredTop) {
          return;
        }

        if (ghostMap.has(wall.id)) {
          return;
        }

        ghostMap.set(wall.id, {
          id: `ghost-${wall.id}-${activeStoreyId}`,
          originalWallId: wall.id,
          storey: wall.storey,
          start_x: wall.start_x,
          start_y: wall.start_y,
          end_x: wall.end_x,
          end_y: wall.end_y,
          thickness: wall.thickness,
          height: wall.height,
        });
      });
    });

    setFilteredGhostWalls(Array.from(ghostMap.values()));

    const sortedStoreys = [...storeys].sort((a, b) => {
      const orderDiff = (a.order ?? 0) - (b.order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      const elevationDiff = (Number(a.elevation_mm) || 0) - (Number(b.elevation_mm) || 0);
      if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
      return (a.id ?? 0) - (b.id ?? 0);
    });

    const activeIndex = sortedStoreys.findIndex(
      (storey) => String(storey.id) === String(activeStoreyId)
    );

    if (activeIndex <= 0) {
      setFilteredGhostAreas([]);
    } else {
      const normalizedRooms = Array.isArray(rooms) ? rooms : [];

      const activeRoomSignatures = new Set(
        (Array.isArray(filteredRooms) ? filteredRooms : [])
          .map((room) => {
            if (!Array.isArray(room.room_points) || room.room_points.length < 3) {
              return null;
            }
            const normalizedPoints = room.room_points.map((point) => [
              Number(point.x) || 0,
              Number(point.y) || 0,
            ]);
            return JSON.stringify(normalizedPoints);
          })
          .filter(Boolean)
      );

      const occupiedSignatures = new Set(activeRoomSignatures);
      const descendingStoreys = sortedStoreys.slice(0, activeIndex).reverse();
      const ghostAreas = [];

      descendingStoreys.forEach((storey) => {
        const storeyRooms = normalizedRooms.filter(
          (room) => String(room.storey) === String(storey.id)
        );

        storeyRooms.forEach((room) => {
          if (!Array.isArray(room.room_points) || room.room_points.length < 3) {
            return;
          }

          const normalizedPoints = room.room_points.map((point) => [
            Number(point.x) || 0,
            Number(point.y) || 0,
          ]);
          const signature = JSON.stringify(normalizedPoints);

          if (occupiedSignatures.has(signature)) {
            return;
          }

          const baseElevation =
            room.base_elevation_mm !== undefined && room.base_elevation_mm !== null
              ? Number(room.base_elevation_mm) || 0
              : Number(storey.elevation_mm) || 0;
          const roomHeight =
            room.height !== undefined && room.height !== null
              ? Number(room.height) || 0
              : Number(storey.default_room_height_mm) || 0;
          const roomTop = baseElevation + roomHeight;

          if (roomTop + 1e-3 < targetElevation) {
            return;
          }

          occupiedSignatures.add(signature);
          ghostAreas.push({
            id: `ghost-area-${room.id}-${activeStoreyId}`,
            sourceRoomId: room.id,
            room_name: room.room_name,
            room_points: room.room_points,
            storey: room.storey,
            source_storey_name: storey.name,
          });
        });
      });

      setFilteredGhostAreas(ghostAreas);
    }
  }, [walls, rooms, filteredRooms, storeys, activeStoreyId]);

  useEffect(() => {
    if (!levelEditSuccess) {
      return;
    }
    const timeout = setTimeout(() => {
      setLevelEditSuccess('');
    }, 4000);
    return () => clearTimeout(timeout);
  }, [levelEditSuccess]);

  useEffect(() => {
    const normalizedStoreys = Array.isArray(storeys) ? storeys : [];
    const normalizedRooms = Array.isArray(rooms) ? rooms : [];

    let maxTop = 0;

    normalizedRooms.forEach((room) => {
      const storeyRef = normalizedStoreys.find(
        (storey) => String(storey.id) === String(room.storey)
      );

      const baseElevation =
        room.base_elevation_mm !== undefined && room.base_elevation_mm !== null
          ? Number(room.base_elevation_mm) || 0
          : storeyRef && storeyRef.elevation_mm !== undefined
            ? Number(storeyRef.elevation_mm) || 0
            : 0;

      const roomHeight =
        room.height !== undefined && room.height !== null
          ? Number(room.height) || 0
          : storeyRef && storeyRef.default_room_height_mm !== undefined
            ? Number(storeyRef.default_room_height_mm) || 0
            : 0;

      const top = baseElevation + roomHeight;
      if (!Number.isNaN(top) && top > maxTop) {
        maxTop = top;
      }
    });

    normalizedStoreys.forEach((storey) => {
      const baseElevation = Number(storey.elevation_mm) || 0;
      const defaultHeight = Number(storey.default_room_height_mm) || 0;
      const top = baseElevation + defaultHeight;
      if (!Number.isNaN(top) && top > maxTop) {
        maxTop = top;
      }
    });

    setProjectCalculatedHeight(maxTop);
  }, [storeys, rooms]);

  const computeStoreyWizardElevation = () => {
    const selectedRooms = rooms.filter((room) =>
      storeyWizardRoomSelections.includes(room.id)
    );

    if (!selectedRooms.length && !storeyWizardAreas.length) {
      setStoreyWizardError('Select at least one room or draw an area.');
      return;
    }

    let minBase = Infinity;
    let maxHeight = 0;

    selectedRooms.forEach((room) => {
      const override = storeyWizardRoomOverrides[String(room.id)] || initializeRoomOverride(room);
      const base = Number(override?.baseElevation) || 0;
      const height = Number(override?.height) || storeyWizardDefaultHeight || 0;
      if (base < minBase) {
        minBase = base;
      }
      if (height > maxHeight) {
        maxHeight = height;
      }
    });

    if (storeyWizardAreas.length > 0) {
      if (storeys.length > 0) {
        // Find the highest storey based on actual room top elevations, not just default heights
        let maxTopElevation = -Infinity;
        let highestStorey = null;
        
        storeys.forEach((storey) => {
          // Find all rooms on this storey
          const storeyRooms = rooms.filter((room) => 
            String(room.storey) === String(storey.id)
          );
          
          // Calculate the top elevation for each room (base + height)
          let storeyMaxTop = storey.elevation_mm ?? 0;
          storeyRooms.forEach((room) => {
            const roomBase = Number(room.base_elevation_mm) ?? Number(storey.elevation_mm) ?? 0;
            const roomHeight = Number(room.height) ?? Number(storey.default_room_height_mm) ?? 0;
            const roomTop = roomBase + roomHeight;
            if (roomTop > storeyMaxTop) {
              storeyMaxTop = roomTop;
            }
          });
          
          // If no rooms, use storey elevation + default height
          if (storeyRooms.length === 0) {
            storeyMaxTop = (storey.elevation_mm ?? 0) + (storey.default_room_height_mm ?? 0);
          }
          
          if (storeyMaxTop > maxTopElevation) {
            maxTopElevation = storeyMaxTop;
            highestStorey = storey;
          }
        });
        
        if (highestStorey) {
          // Use the calculated max top elevation as the base for the new storey
          minBase = Math.min(minBase, maxTopElevation);
          
          // Also find the maximum room height from the highest storey for default height calculation
          const highestStoreyRooms = rooms.filter((room) => 
            String(room.storey) === String(highestStorey.id)
          );
          
          if (highestStoreyRooms.length > 0) {
            highestStoreyRooms.forEach((room) => {
              const roomHeight = Number(room.height) ?? Number(highestStorey.default_room_height_mm) ?? 0;
              maxHeight = Math.max(maxHeight, roomHeight);
            });
          } else {
            if (highestStorey.default_room_height_mm) {
              maxHeight = Math.max(
                maxHeight,
                Number(highestStorey.default_room_height_mm) || 0
              );
            }
          }
        }
      } else if (!Number.isFinite(minBase)) {
        minBase = 0;
      }
      // Consider area height overrides
      storeyWizardAreas.forEach((area) => {
        const areaOverride = storeyWizardAreaOverrides[area.id] || {};
        const areaHeight = areaOverride.height ?? storeyWizardDefaultHeight ?? 3000;
        maxHeight = Math.max(maxHeight, Number(areaHeight) || 0);
      });
    }

    if (!Number.isFinite(minBase)) {
      minBase = 0;
    }

    setStoreyWizardElevation(minBase);
    setStoreyWizardDefaultHeight(maxHeight || storeyWizardDefaultHeight || 3000);
    setStoreyWizardSlabThickness(0);
  };

  useEffect(() => {
    if (!selectedDoorWall) {
      return;
    }
    const stillVisible = filteredWalls.some(
      (wall) => wall.id === selectedDoorWall.id
    );
    if (!stillVisible) {
      setSelectedDoorWall(null);
    }
  }, [filteredWalls, selectedDoorWall]);

  useEffect(() => {
    setSelectedRoomPoints([]);
    setSelectedWallsForRoom([]);
  }, [activeStoreyId]);

  useEffect(() => {
    if (selectionContext !== 'storey') {
      return;
    }
    if (selectedRoomPoints.length < 4) {
      return;
    }
    const firstPoint = selectedRoomPoints[0];
    const lastPoint = selectedRoomPoints[selectedRoomPoints.length - 1];
    const isClosed =
      Math.abs(firstPoint.x - lastPoint.x) < 0.001 &&
      Math.abs(firstPoint.y - lastPoint.y) < 0.001;

    if (!isClosed) {
      return;
    }

    const polygon = selectedRoomPoints.slice(0, -1);
    if (polygon.length < 3) {
      return;
    }

    const newArea = {
      id: `${Date.now()}-${polygon.length}`,
      points: polygon,
      source: 'manual',
    };

    setStoreyWizardAreas(prev => [...prev, newArea]);
    // Initialize height for the new area
    setStoreyWizardAreaOverrides(prev => ({
      ...prev,
      [newArea.id]: {
        height: storeyWizardDefaultHeight || 3000,
      },
    }));
    setSelectedRoomPoints([]);
    setSelectedWallsForRoom([]);
    setSelectionContext('room');
    setStoreyWizardMinimized(false);
    setShowStoreyWizard(true);
    if (currentMode === 'storey-area') {
      setCurrentMode(null);
    }
  }, [selectionContext, selectedRoomPoints, currentMode]);

  // Function to update shared panel data from any tab
  // Memoized to prevent unnecessary re-renders and wrapped in useCallback
  const updateSharedPanelData = useCallback((tabName, panelData, analysis = null) => {
    setSharedPanelData(prev => {
      // Determine which field to update based on tab name
      const fieldName = tabName === 'wall-plan' ? 'wallPanels' : 
                       tabName === 'ceiling-plan' ? 'ceilingPanels' : 
                       tabName === 'floor-plan' ? 'floorPanels' : 'unknown';
      
      // Check if values actually changed to prevent unnecessary updates
      const currentData = prev[fieldName];
      const dataChanged = JSON.stringify(currentData) !== JSON.stringify(panelData);
      
      // For ceiling-support-options, check if analysis values changed
      let supportDataChanged = false;
      if ((tabName === 'ceiling-plan' || tabName === 'ceiling-support-options') && analysis && typeof analysis === 'object') {
        const newSupportType = analysis.supportType ?? prev.supportType;
        const newIncludeAccessories = analysis.includeAccessories ?? prev.includeAccessories;
        const newIncludeCable = analysis.includeCable ?? prev.includeCable;
        const newAluSuspensionCustomDrawing = analysis.aluSuspensionCustomDrawing ?? prev.aluSuspensionCustomDrawing;
        const newPanelsNeedSupport = analysis.panelsNeedSupport ?? prev.panelsNeedSupport;
        
        supportDataChanged = 
          prev.supportType !== newSupportType ||
          prev.includeAccessories !== newIncludeAccessories ||
          prev.includeCable !== newIncludeCable ||
          prev.aluSuspensionCustomDrawing !== newAluSuspensionCustomDrawing ||
          prev.panelsNeedSupport !== newPanelsNeedSupport;
      }
      
      // Only update if something actually changed
      // For ceiling-support-options, we need to check supportDataChanged specifically
      if (tabName === 'ceiling-support-options') {
        if (!supportDataChanged) {
          return prev; // Return previous state unchanged to prevent unnecessary re-renders
        }
      } else if (!dataChanged && !supportDataChanged) {
        return prev; // Return previous state unchanged to prevent unnecessary re-renders
      }
      
      const baseUpdate = {
        ...prev,
        [fieldName]: panelData,
        wallPanelAnalysis: tabName === 'wall-plan' ? analysis : prev.wallPanelAnalysis,
        lastUpdated: new Date().toISOString()
      };
      
      // If ceiling plan is being updated and analysis contains support info, update support data
      if ((tabName === 'ceiling-plan' || tabName === 'ceiling-support-options') && analysis && typeof analysis === 'object') {
        return {
          ...baseUpdate,
          supportType: analysis.supportType ?? prev.supportType,
          includeAccessories: analysis.includeAccessories ?? prev.includeAccessories,
          includeCable: analysis.includeCable ?? prev.includeCable,
          aluSuspensionCustomDrawing: analysis.aluSuspensionCustomDrawing ?? prev.aluSuspensionCustomDrawing,
          panelsNeedSupport: analysis.panelsNeedSupport ?? prev.panelsNeedSupport
        };
      }
      
      return baseUpdate;
    });
    // Only log when values actually changed to reduce console spam
    if (tabName !== 'ceiling-support-options' || (analysis && Object.keys(analysis).length > 0)) {
      console.log(`Updated shared panel data for ${tabName}:`, panelData, analysis);
    }
  }, []); // Empty dependency array - function doesn't depend on any props/state
  
  // Function to update canvas images
  const updateCanvasImage = (planType, imageData) => {
    setSharedPanelData(prev => ({
      ...prev,
      [`${planType}PlanImage`]: imageData
    }));
    console.log(`📸 Stored ${planType} plan image in shared data`);
  };
  
  // Function to get all panel data for the final summary tab
  const getAllPanelData = () => {
    return {
      wallPanels: sharedPanelData.wallPanels,
      ceilingPanels: sharedPanelData.ceilingPanels,
      floorPanels: sharedPanelData.floorPanels,
      wallPanelAnalysis: sharedPanelData.wallPanelAnalysis,
      // Support accessories information
      supportType: sharedPanelData.supportType,
      includeAccessories: sharedPanelData.includeAccessories,
      includeCable: sharedPanelData.includeCable,
      aluSuspensionCustomDrawing: sharedPanelData.aluSuspensionCustomDrawing,
      panelsNeedSupport: sharedPanelData.panelsNeedSupport,
      totalPanels: (sharedPanelData.wallPanels?.length || 0) + 
                   (sharedPanelData.ceilingPanels?.length || 0) + 
                   (sharedPanelData.floorPanels?.length || 0),
      lastUpdated: sharedPanelData.lastUpdated,
      // Canvas images for export
      wallPlanImage: sharedPanelData.wallPlanImage,
      ceilingPlanImage: sharedPanelData.ceilingPlanImage,
      floorPlanImage: sharedPanelData.floorPlanImage
    };
  };
  
  // Function to update room points and automatically detect walls
  const updateRoomPointsAndDetectWalls = (newPoints) => {
    setSelectedRoomPoints(newPoints);
    
    if (selectionContext === 'storey') {
      setSelectedWallsForRoom([]);
      return;
    }

    // If we have enough points to form a polygon, detect walls
    if (newPoints.length >= 3) {
      const detectedWallIds = detectRoomWalls(newPoints, filteredWalls, 1); // 1mm tolerance
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
    const [showPanelLines, setShowPanelLines] = useState(false);

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
    setSelectionContext('room');
  };

  // Fetch project details
  const fetchProjectDetails = async () => {
    try {
      const projectResponse = await api.get(`/projects/${projectId}/`);
      const projectData = projectResponse.data;
      setProject(projectData);
      await ensureStoreys(projectData);
      setStoreyError('');
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
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        const container = document.getElementById('three-canvas-container');
        if (container) {
          try {
            const threeCanvas = new ThreeCanvas3D('three-canvas-container', walls, joints, doors, 0.01, project);
            threeCanvasInstance.current = threeCanvas;
          } catch (error) {
            console.error('Error creating 3D canvas:', error);
            threeCanvasInstance.current = null;
          }
        }
      }, 100);
      return () => {
        if (threeCanvasInstance.current) {
          // Use dispose method if available (includes resize handler cleanup)
          if (typeof threeCanvasInstance.current.dispose === 'function') {
            threeCanvasInstance.current.dispose();
          } else {
            // Fallback to manual cleanup
            if (threeCanvasInstance.current.renderer) {
              threeCanvasInstance.current.renderer.dispose();
            }
          }
          threeCanvasInstance.current = null;
        }
      };
    } else {
      // Clean up 3D canvas when switching back to 2D
      if (threeCanvasInstance.current) {
        // Use dispose method if available (includes resize handler cleanup)
        if (typeof threeCanvasInstance.current.dispose === 'function') {
          threeCanvasInstance.current.dispose();
        } else {
          // Fallback to manual cleanup
          if (threeCanvasInstance.current.renderer) {
            threeCanvasInstance.current.renderer.dispose();
          }
        }
        threeCanvasInstance.current = null;
      }
    }
    // eslint-disable-next-line
  }, [is3DView, walls, joints, doors]);

  // Update 3D canvas when walls, joints, or doors change
  useEffect(() => {
    if (is3DView && threeCanvasInstance.current) {
      threeCanvasInstance.current.updateData(walls, joints, doors);
    }
  }, [is3DView, walls, joints, doors]);

  // Sync panel lines visibility with 3D canvas
  useEffect(() => {
    if (is3DView && threeCanvasInstance.current) {
      // Set both wall and ceiling panel lines visibility
      if (threeCanvasInstance.current.setAllPanelLinesVisibility) {
        threeCanvasInstance.current.setAllPanelLinesVisibility(showPanelLines);
      } else if (threeCanvasInstance.current.setPanelLinesVisibility) {
        // Fallback to just wall panel lines if combined method not available
        threeCanvasInstance.current.setPanelLinesVisibility(showPanelLines);
      }
    }
  }, [is3DView, showPanelLines]);





  // Reset edit mode when switching to 3D view
  useEffect(() => {
    if (is3DView) {
      setIsEditingMode(false);
      setCurrentMode(null);
      resetAllSelections();
    }
  }, [is3DView]);

  // Ensure proper canvas visibility
  useEffect(() => {
    const threeContainer = document.getElementById('three-canvas-container');
    const canvas2D = document.querySelector('.canvas-container canvas');
    
    if (threeContainer) {
      if (is3DView) {
        threeContainer.style.display = 'block';
        if (canvas2D) {
          canvas2D.style.display = 'none';
        }
      } else {
        threeContainer.style.display = 'none';
        if (canvas2D) {
          canvas2D.style.display = 'block';
        }
      }
    }
  }, [is3DView]);

  // Add a function to force cleanup of 3D canvas
  const forceCleanup3D = () => {
    try {
      if (threeCanvasInstance.current) {
        // Dispose of renderer
        if (threeCanvasInstance.current.renderer) {
          threeCanvasInstance.current.renderer.dispose();
        }
        // Clear the container
        const container = document.getElementById('three-canvas-container');
        if (container) {
          container.innerHTML = '';
        }
        threeCanvasInstance.current = null;
      }
    } catch (error) {
      console.warn('Error during 3D cleanup:', error);
      threeCanvasInstance.current = null;
    }
  };

  // Room handlers
  const handleCreateRoom = async (roomData) => {
    try {
      // Check if any point is in a ghosted area
      if (Array.isArray(filteredGhostAreas) && filteredGhostAreas.length > 0 && Array.isArray(selectedRoomPoints) && selectedRoomPoints.length >= 3) {
        const isPointInPolygon = (point, polygon) => {
          let inside = false;
          for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const intersect = ((yi > point.y) !== (yj > point.y))
              && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        };

        for (const point of selectedRoomPoints) {
          for (const ghostArea of filteredGhostAreas) {
            const ghostPoints = Array.isArray(ghostArea.room_points)
              ? ghostArea.room_points
              : Array.isArray(ghostArea.points)
                ? ghostArea.points
                : [];
            if (ghostPoints.length >= 3) {
              const normalizedPolygon = ghostPoints.map((pt) => ({
                x: Number(pt.x) || 0,
                y: Number(pt.y) || 0,
              }));
              if (isPointInPolygon(point, normalizedPolygon)) {
                setRoomError('Cannot create rooms in ghosted areas (double-height spaces from lower levels).');
                setTimeout(() => setRoomError(''), 5000);
                return;
              }
            }
          }
        }
      }

      const completeRoomData = {
        ...roomData,
        room_points: selectedRoomPoints,
      };
      const response = await api.post('/rooms/', completeRoomData);
      if (response.status === 201) {
        const newRoom = response.data;
        setRooms((prevRooms) => [...prevRooms, newRoom]);
        
        // Refetch walls to get updated heights (especially for shared walls)
        // Shared walls will have the maximum height of all rooms that share them
        if (roomData.height !== undefined) {
          try {
            const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
            setWalls(wallsResponse.data);
            console.log('Refetched walls after room creation to sync shared wall heights');
          } catch (error) {
            console.error('Error refetching walls after room creation:', error);
            // Continue even if refetch fails
          }
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
      
      // Refetch walls to get updated heights (especially for shared walls)
      // Shared walls will have the maximum height of all rooms that share them
      if (updatedRoomData.height !== undefined) {
        try {
          const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
          setWalls(wallsResponse.data);
          console.log('Refetched walls after room height update to sync shared wall heights');
        } catch (error) {
          console.error('Error refetching walls after room update:', error);
          // Continue even if refetch fails
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

  // Separate function for label position updates that doesn't trigger room state updates
  const handleRoomLabelPositionUpdate = async (roomId, labelPosition) => {
    try {
      // Get the current room to include all required fields
      const currentRoom = rooms.find(room => room.id === roomId);
      if (!currentRoom) {
        console.error('Room not found:', roomId);
        return;
      }
      
      // Send only the label position for partial update
      console.log('Sending label position update:', { label_position: labelPosition });
      const response = await api.patch(`/rooms/${roomId}/`, { label_position: labelPosition });
      // Don't update the rooms state to avoid triggering panel calculations
      console.log('Label position updated successfully');
    } catch (error) {
      console.error('Error updating room label position:', error);
      console.error('Error response data:', error.response?.data);
      if (isDatabaseConnectionError(error)) {
        setRoomError('Fail to connect to database. Try again later.');
      } else {
        setRoomError('Failed to update room label position.');
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
        side: 'interior',
        storey: activeStoreyId ?? defaultStoreyId
      };
      const response = await api.post('/doors/create_door/', completeDoorData);
      setDoors([...doors, response.data]);
      setShowDoorManager(false);
      setCurrentMode(null);
      setSelectedDoorWall(null);
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
        storey: updatedDoor.storey ?? activeStoreyId ?? defaultStoreyId,
      });
      const updated = response.data;
      setDoors(doors.map(d => d.id === updated.id ? updated : d));
      setShowDoorEditor(false);
      setEditingDoor(null);
      setSelectedDoorWall(null);
    } catch (error) {
      console.error('Failed to update door:', error);
      if (error.response && error.response.data) {
        console.error('Backend error details:', error.response.data);
        alert(JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  };

  const duplicateRoomToStorey = async (roomId, targetStoreyId, overrides = {}) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) {
      console.warn('Room not found for duplication:', roomId);
      return null;
    }

    const roomStoreyName =
      storeys.find(storey => String(storey.id) === String(targetStoreyId))?.name || 'New Level';

    const targetStorey =
      storeys.find(storey => String(storey.id) === String(targetStoreyId)) || null;
    // Prioritize overrides parameter (from edit level mode) over storeyWizardRoomOverrides
    const targetElevation = overrides.base_elevation_mm !== undefined && overrides.base_elevation_mm !== null
      ? Number(overrides.base_elevation_mm) || 0
      : (() => {
          const wizardOverride = storeyWizardRoomOverrides[String(room.id)];
          if (wizardOverride?.baseElevation !== undefined) {
            return Number(wizardOverride.baseElevation) || 0;
          }
          return targetStorey && targetStorey.elevation_mm !== undefined
            ? Number(targetStorey.elevation_mm) || 0
            : 0;
        })();
    const roomHeight = overrides.height !== undefined && overrides.height !== null
      ? Number(overrides.height) || 0
      : (() => {
          const wizardOverride = storeyWizardRoomOverrides[String(room.id)];
          if (wizardOverride?.height !== undefined) {
            return Number(wizardOverride.height) || 0;
          }
          if (room.height !== undefined && room.height !== null) {
            return Number(room.height) || 0;
          }
          return targetStorey && targetStorey.default_room_height_mm !== undefined
            ? Number(targetStorey.default_room_height_mm) || 0
            : 0;
        })();

    const wallIds = Array.isArray(room.walls) ? room.walls : [];
    const createdWalls = [];
    const reusedWallIds = [];

    for (const wallId of wallIds) {
      const wall = walls.find(w => w.id === wallId);
      if (!wall) {
        continue;
      }

       const wallStorey =
         storeys.find(storey => String(storey.id) === String(wall.storey)) || null;
       const wallBaseElevation = wallStorey && wallStorey.elevation_mm !== undefined
         ? Number(wallStorey.elevation_mm) || 0
         : 0;
       const wallHeight = wall.height !== undefined && wall.height !== null
         ? Number(wall.height) || 0
         : 0;
       const wallTop = wallBaseElevation + wallHeight;
       const requiredTop = targetElevation + roomHeight;
       const sharedCount = Array.isArray(wall.rooms) ? wall.rooms.length : 0;
       const shouldReuse =
         sharedCount > 1 &&
         wallTop + 1e-3 >= requiredTop;

       if (shouldReuse) {
         reusedWallIds.push(wall.id);
         continue;
       }

      const wallPayload = {
        project: projectId,
        storey: targetStoreyId,
        start_x: wall.start_x,
        start_y: wall.start_y,
        end_x: wall.end_x,
        end_y: wall.end_y,
        height: wall.height,
        thickness: wall.thickness,
        application_type: wall.application_type,
        inner_face_material: wall.inner_face_material,
        inner_face_thickness: wall.inner_face_thickness,
        outer_face_material: wall.outer_face_material,
        outer_face_thickness: wall.outer_face_thickness,
        is_default: wall.is_default ?? false,
        has_concrete_base: wall.has_concrete_base ?? false,
        concrete_base_height: wall.concrete_base_height,
        fill_gap_mode: false,
        gap_fill_height: null,
        gap_base_position: null,
      };

      const wallResponse = await api.post('/walls/', wallPayload);
      createdWalls.push(wallResponse.data);
    }

    if (createdWalls.length > 0) {
      setWalls(prev => [...prev, ...createdWalls]);
    }

    const combinedWallIds = [
      ...createdWalls.map(w => w.id),
      ...reusedWallIds
    ];

    const uniqueWallIds = Array.from(new Set(combinedWallIds));

    const roomPayload = {
      project: projectId,
      storey: targetStoreyId,
      room_name: overrides.room_name || `${room.room_name} (${roomStoreyName})`,
      floor_type: overrides.floor_type || room.floor_type || 'Panel',
      floor_thickness: overrides.floor_thickness ?? room.floor_thickness ?? 0,
      floor_layers: overrides.floor_layers ?? room.floor_layers ?? 1,
      temperature: overrides.temperature ?? room.temperature ?? 0,
      height: roomHeight, // Use the calculated roomHeight which respects overrides
      base_elevation_mm: targetElevation, // Use the calculated targetElevation which respects overrides
      remarks: overrides.remarks ?? room.remarks ?? '',
      walls: uniqueWallIds,
      room_points: overrides.room_points || room.room_points || [],
    };

    const roomResponse = await api.post('/rooms/', roomPayload);
    setRooms(prev => [...prev, roomResponse.data]);
    return roomResponse.data;
  };

  const addRoomsToActiveStorey = useCallback(async () => {
    if (!isLevelEditMode) {
      return;
    }
    if (!activeStoreyId) {
      setLevelEditError('Select a level to edit before adding rooms.');
      return;
    }
    if (!Array.isArray(levelEditSelections) || levelEditSelections.length === 0) {
      setLevelEditError('Select at least one room to add to this level.');
      return;
    }

    const targetStorey =
      storeys.find((storey) => String(storey.id) === String(activeStoreyId)) || null;

    if (!targetStorey) {
      setLevelEditError('Active level details could not be found.');
      return;
    }

    setIsLevelEditApplying(true);
    setLevelEditError('');
    setLevelEditSuccess('');

    try {
      let addedCount = 0;

      for (const roomId of levelEditSelections) {
        const sourceRoom = rooms.find((room) => String(room.id) === String(roomId));
        if (!sourceRoom) {
          continue;
        }

        const sourceStorey =
          storeys.find((storey) => String(storey.id) === String(sourceRoom.storey)) || null;

        const defaultHeight =
          sourceRoom && sourceRoom.height !== undefined && sourceRoom.height !== null
            ? Number(sourceRoom.height) || 0
            : sourceStorey && sourceStorey.default_room_height_mm !== undefined
              ? Number(sourceStorey.default_room_height_mm) || 0
              : targetStorey && targetStorey.default_room_height_mm !== undefined
                ? Number(targetStorey.default_room_height_mm) || 0
                : 0;

        const override = levelEditOverrides[String(roomId)] || {};

        let desiredBase =
          override.baseElevation !== undefined && override.baseElevation !== null
            ? Number(override.baseElevation) || 0
            : Number(targetStorey.elevation_mm) || 0;

        let desiredHeight =
          override.height !== undefined && override.height !== null
            ? Number(override.height) || 0
            : defaultHeight;

        const minBase = Number(targetStorey.elevation_mm) || 0;
        if (desiredBase < minBase) {
          desiredBase = minBase;
        }

        if (desiredHeight < 0) {
          desiredHeight = 0;
        }

        const payloadOverrides = {
          base_elevation_mm: desiredBase,
          height: desiredHeight,
        };

        await duplicateRoomToStorey(sourceRoom.id, activeStoreyId, payloadOverrides);
        addedCount += 1;
      }

      if (addedCount > 0) {
        setLevelEditSelections([]);
        setLevelEditOverrides({});
        setLevelEditSuccess(`Added ${addedCount} ${addedCount === 1 ? 'room' : 'rooms'} to ${targetStorey.name}.`);
      } else {
        setLevelEditError('No rooms were added. They may already exist on this level.');
      }
    } catch (error) {
      console.error('Failed to add rooms to level:', error);
      const message =
        error.response?.data?.error ||
        error.message ||
        'Failed to add rooms to this level.';
      setLevelEditError(message);
    } finally {
      setIsLevelEditApplying(false);
    }
  }, [isLevelEditMode, activeStoreyId, levelEditSelections, levelEditOverrides, rooms, storeys, duplicateRoomToStorey]);

  const createRoomFromPolygon = async (points, targetStoreyId, options = {}) => {
    if (!Array.isArray(points) || points.length < 3) {
      return null;
    }

    // Check if any point is in a ghosted area (only if we're on an upper level)
    if (Array.isArray(filteredGhostAreas) && filteredGhostAreas.length > 0) {
      const isPointInPolygon = (point, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const xi = polygon[i].x, yi = polygon[i].y;
          const xj = polygon[j].x, yj = polygon[j].y;
          const intersect = ((yi > point.y) !== (yj > point.y))
            && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      };

      for (const point of points) {
        for (const ghostArea of filteredGhostAreas) {
          const ghostPoints = Array.isArray(ghostArea.room_points)
            ? ghostArea.room_points
            : Array.isArray(ghostArea.points)
              ? ghostArea.points
              : [];
          if (ghostPoints.length >= 3) {
            const normalizedPolygon = ghostPoints.map((pt) => ({
              x: Number(pt.x) || 0,
              y: Number(pt.y) || 0,
            }));
            if (isPointInPolygon(point, normalizedPolygon)) {
              throw new Error('Cannot create rooms in ghosted areas (double-height spaces from lower levels).');
            }
          }
        }
      }
    }

    const wallHeight = options.height ?? storeyWizardDefaultHeight;
    const wallThickness = options.thickness ?? project?.wall_thickness ?? 200;
    const roomStoreyName =
      storeys.find(storey => String(storey.id) === String(targetStoreyId))?.name || 'New Level';

    const createdWalls = [];
    for (let i = 0; i < points.length; i += 1) {
      const start = points[i];
      const end = points[(i + 1) % points.length];
      const wallPayload = {
        project: projectId,
        storey: targetStoreyId,
        start_x: start.x,
        start_y: start.y,
        end_x: end.x,
        end_y: end.y,
        height: wallHeight,
        thickness: wallThickness,
        application_type: 'wall',
        inner_face_material: 'PPGI',
        inner_face_thickness: 0.5,
        outer_face_material: 'PPGI',
        outer_face_thickness: 0.5,
        is_default: false,
        has_concrete_base: false,
        concrete_base_height: null,
        fill_gap_mode: false,
        gap_fill_height: null,
        gap_base_position: null,
      };

      const wallResponse = await api.post('/walls/', wallPayload);
      createdWalls.push(wallResponse.data);
    }

    if (createdWalls.length > 0) {
      setWalls(prev => [...prev, ...createdWalls]);
    }

    const roomPayload = {
      project: projectId,
      storey: targetStoreyId,
      room_name: options.room_name || `Upper Area ${storeyWizardAreas.length + 1} (${roomStoreyName})`,
      floor_type: options.floor_type || 'Panel',
      floor_thickness: options.floor_thickness ?? 0,
      floor_layers: options.floor_layers ?? 1,
      temperature: options.temperature ?? 0,
      height: wallHeight,
      base_elevation_mm: options.base_elevation_mm ?? 0,
      remarks: options.remarks ?? '',
      walls: createdWalls.map(w => w.id),
      room_points: points,
    };

    const roomResponse = await api.post('/rooms/', roomPayload);
    setRooms(prev => [...prev, roomResponse.data]);
    return roomResponse.data;
  };

  const completeStoreyWizard = async () => {
    if (!storeyWizardName || !storeyWizardName.trim()) {
      setStoreyWizardError('Storey name is required.');
      return;
    }

    try {
      setStoreyWizardError('');
      try {
        await api.get('/csrf-token/');
      } catch (tokenError) {
        console.warn('Failed to refresh CSRF token:', tokenError);
      }
      const payload = {
        project: projectId,
        name: storeyWizardName.trim(),
        elevation_mm: storeyWizardElevation,
        default_room_height_mm: storeyWizardDefaultHeight,
        slab_thickness_mm: storeyWizardSlabThickness,
        order: storeys.length,
      };

      const storeyResponse = await api.post('/storeys/', payload);
      const newStorey = storeyResponse.data;
      await ensureStoreys();
      setActiveStoreyId(newStorey.id);
      const storeyElevation = newStorey.elevation_mm ?? storeyWizardElevation ?? 0;

      for (const roomId of storeyWizardRoomSelections) {
        await duplicateRoomToStorey(roomId, newStorey.id, {
          base_elevation_mm: storeyElevation,
        });
      }

      for (let index = 0; index < storeyWizardAreas.length; index += 1) {
        const area = storeyWizardAreas[index];
        const areaOverride = storeyWizardAreaOverrides[area.id] || {};
        const areaHeight = areaOverride.height ?? storeyWizardDefaultHeight ?? 3000;
        await createRoomFromPolygon(area.points, newStorey.id, {
          room_name: `Area ${index + 1} - ${storeyWizardName}`,
          base_elevation_mm: storeyElevation,
          height: areaHeight,
        });
      }

      await fetchProjectDetails();
      closeStoreyWizard();
      setStoreyWizardMinimized(false);
    } catch (error) {
      console.error('Error completing storey wizard:', error);
      const message =
        error.response?.data?.error ||
        error.message ||
        'Failed to create storey.';
      setStoreyWizardError(message);
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
      // Normalize wall coordinates before sending to backend
      const normalizedCoords = normalizeWallCoordinates(
        { x: wallData.start_x, y: wallData.start_y },
        { x: wallData.end_x, y: wallData.end_y }
      );
      
      const dataToSend = { 
        ...wallData, 
        start_x: normalizedCoords.startPoint.x,
        start_y: normalizedCoords.startPoint.y,
        end_x: normalizedCoords.endPoint.x,
        end_y: normalizedCoords.endPoint.y,
        project: project.id,
        storey: wallData.storey ?? activeStoreyId ?? defaultStoreyId
      };
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
            try {
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
            } catch (mergeError) {
              // Log merge errors but don't fail the entire deletion
              console.warn('Could not merge walls at point:', pt, mergeError);
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

  // Helper function to fetch updated walls from backend
  const fetchUpdatedWalls = async () => {
    console.log('Fetching updated walls from backend...');
    try {
      const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
      if (wallsResponse.status === 200) {
        console.log('Successfully fetched updated walls from backend:', wallsResponse.data);
        setWalls(wallsResponse.data);
        setSelectedWallsForRoom([]);
        setWallMergeSuccess(true);
        setTimeout(() => setWallMergeSuccess(false), 3000);
        return true;
      }
    } catch (fetchError) {
      console.error('Failed to fetch updated walls:', fetchError);
    }
    return false;
  };

  const handleManualWallSplit = async (wallId, splitPoint) => {
    if (!wallId || !splitPoint) {
      setWallSplitError('Select a wall and specify a split point.');
      setTimeout(() => setWallSplitError(''), 5000);
      return;
    }

    const targetWall = walls.find(w => w.id === wallId);
    if (!targetWall) {
      setWallSplitError('Selected wall could not be found.');
      setTimeout(() => setWallSplitError(''), 5000);
      return;
    }

    const wallLength = Math.hypot(
      targetWall.end_x - targetWall.start_x,
      targetWall.end_y - targetWall.start_y
    );

    if (wallLength <= MERGE_POINT_TOLERANCE) {
      setWallSplitError('Wall is too short to split.');
      setTimeout(() => setWallSplitError(''), 5000);
      return;
    }

    const sanitizedPoint = {
      x: Number(splitPoint.x),
      y: Number(splitPoint.y)
    };

    const distFromStart = Math.hypot(
      sanitizedPoint.x - targetWall.start_x,
      sanitizedPoint.y - targetWall.start_y
    );
    const distFromEnd = Math.hypot(
      sanitizedPoint.x - targetWall.end_x,
      sanitizedPoint.y - targetWall.end_y
    );

    if (
      distFromStart < SPLIT_ENDPOINT_TOLERANCE ||
      distFromEnd < SPLIT_ENDPOINT_TOLERANCE
    ) {
      setWallSplitError('Split point must be away from the wall endpoints.');
      setTimeout(() => setWallSplitError(''), 5000);
      return;
    }

    const onSegment =
      Math.abs(distFromStart + distFromEnd - wallLength) <= MERGE_POINT_TOLERANCE;

    if (!onSegment) {
      setWallSplitError('Split point must lie on the selected wall.');
      setTimeout(() => setWallSplitError(''), 5000);
      return;
    }

    const roundValue = (value) => Number(Number(value).toFixed(3));
    const projectIdForWall = project?.id ?? targetWall.project ?? projectId;
    const optionalWallFields = [
      'inner_face_material',
      'outer_face_material',
      'inner_face_color',
      'outer_face_color',
      'core_material',
      'fire_rating',
      'acoustic_rating',
      'remarks',
      'fill_gap_mode',
      'gap_fill_height',
      'installation_side',
      'application_detail',
      'panel_type'
    ];

    const createSegment = async (startPoint, endPoint) => {
      const normalized = normalizeWallCoordinates(startPoint, endPoint);
      const payload = {
        start_x: roundValue(normalized.startPoint.x),
        start_y: roundValue(normalized.startPoint.y),
        end_x: roundValue(normalized.endPoint.x),
        end_y: roundValue(normalized.endPoint.y),
        height: targetWall.height,
        thickness: targetWall.thickness,
        application_type: targetWall.application_type,
        project: projectIdForWall
      };

      optionalWallFields.forEach((key) => {
        if (targetWall[key] !== undefined && targetWall[key] !== null) {
          payload[key] = targetWall[key];
        }
      });

      const response = await api.post('/walls/create_wall/', payload);
      return response.data;
    };

    const startPoint = {
      x: targetWall.start_x,
      y: targetWall.start_y
    };
    const endPoint = {
      x: targetWall.end_x,
      y: targetWall.end_y
    };
    const splitMidPoint = {
      x: Math.round(sanitizedPoint.x),
      y: Math.round(sanitizedPoint.y)
    };
    const roundedSplitMidPoint = {
      x: roundValue(splitMidPoint.x),
      y: roundValue(splitMidPoint.y)
    };

    const createdSegments = [];

    try {
      const firstSegment = await createSegment(startPoint, roundedSplitMidPoint);
      createdSegments.push(firstSegment);
      const secondSegment = await createSegment(roundedSplitMidPoint, endPoint);
      createdSegments.push(secondSegment);

      await api.delete(`/walls/${wallId}/`);
      await refreshWalls();
      setWallSplitError('');
      setWallSplitSuccess(true);
      setTimeout(() => setWallSplitSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to split wall:', error);
      setWallSplitError('Unable to split wall. Please try again.');
      setTimeout(() => setWallSplitError(''), 5000);

      // Cleanup any created segments if something failed
      for (const segment of createdSegments) {
        if (segment?.id) {
          try {
            await api.delete(`/walls/${segment.id}/`);
          } catch (cleanupError) {
            console.error('Cleanup failed for segment:', cleanupError);
          }
        }
      }
      await refreshWalls();
    }
  };

  // Helper function to construct merged wall coordinates
  const constructMergedWallCoordinates = async (newWall, wall1, wall2) => {
    console.log('Constructing merged wall coordinates from original walls...');
    
    // Find the original walls to get their coordinates
    const wall1Coords = { start_x: wall1.start_x, start_y: wall1.start_y, end_x: wall1.end_x, end_y: wall1.end_y };
    const wall2Coords = { start_x: wall2.start_x, start_y: wall2.start_y, end_x: wall2.end_x, end_y: wall2.end_y };
    
    console.log('Wall 1 coordinates:', wall1Coords);
    console.log('Wall 2 coordinates:', wall2Coords);
    
    let mergedWall = { ...newWall };
    const pointsAlmostEqual = (ax, ay, bx, by) =>
      arePointsEqual({ x: ax, y: ay }, { x: bx, y: by }, MERGE_POINT_TOLERANCE);
    
    // Determine the merged wall coordinates based on connection type
    if (pointsAlmostEqual(wall1.start_x, wall1.start_y, wall2.end_x, wall2.end_y)) {
      // Wall1 start connects to Wall2 end
      mergedWall.start_x = wall2.start_x;
      mergedWall.start_y = wall2.start_y;
      mergedWall.end_x = wall1.end_x;
      mergedWall.end_y = wall1.end_y;
    } else if (pointsAlmostEqual(wall1.end_x, wall1.end_y, wall2.start_x, wall2.start_y)) {
      // Wall1 end connects to Wall2 start
      mergedWall.start_x = wall1.start_x;
      mergedWall.start_y = wall1.start_y;
      mergedWall.end_x = wall2.end_x;
      mergedWall.end_y = wall2.end_y;
    } else if (pointsAlmostEqual(wall1.start_x, wall1.start_y, wall2.start_x, wall2.start_y)) {
      // Walls share start point
      mergedWall.start_x = wall1.end_x;
      mergedWall.start_y = wall1.end_y;
      mergedWall.end_x = wall2.end_x;
      mergedWall.end_y = wall2.end_y;
    } else if (pointsAlmostEqual(wall1.end_x, wall1.end_y, wall2.end_x, wall2.end_y)) {
      // Walls share end point
      mergedWall.start_x = wall1.start_x;
      mergedWall.start_y = wall1.start_y;
      mergedWall.end_x = wall2.start_x;
      mergedWall.end_y = wall2.start_y;
    }
    
    console.log('Constructed merged wall coordinates:', mergedWall);
    
    // Validate the constructed wall
    if (mergedWall.start_x !== undefined && mergedWall.start_y !== undefined && 
        mergedWall.end_x !== undefined && mergedWall.end_y !== undefined) {
      return mergedWall;
    } else {
      console.error('Failed to construct merged wall coordinates');
      throw new Error('Could not construct merged wall coordinates');
    }
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

    if (!areCollinearWalls(wall1, wall2)) {
      setWallMergeError("Walls must be collinear to merge (180° alignment required).");
      setTimeout(() => setWallMergeError(''), 5000);
      return;
    }

    const connected =
      arePointsEqual(
        { x: wall1.start_x, y: wall1.start_y },
        { x: wall2.end_x, y: wall2.end_y },
        MERGE_POINT_TOLERANCE
      ) ||
      arePointsEqual(
        { x: wall1.end_x, y: wall1.end_y },
        { x: wall2.start_x, y: wall2.start_y },
        MERGE_POINT_TOLERANCE
      ) ||
      arePointsEqual(
        { x: wall1.start_x, y: wall1.start_y },
        { x: wall2.start_x, y: wall2.start_y },
        MERGE_POINT_TOLERANCE
      ) ||
      arePointsEqual(
        { x: wall1.end_x, y: wall1.end_y },
        { x: wall2.end_x, y: wall2.end_y },
        MERGE_POINT_TOLERANCE
      );

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
        let mergedWall = response.data;
        console.log('Wall merge successful, API response:', mergedWall);
        console.log('Response data type:', typeof mergedWall);
        console.log('Response data keys:', Object.keys(mergedWall));
        console.log('Previous walls count:', walls.length);
        
        // Check if the API response has the required properties
        if (mergedWall.start_x === undefined || mergedWall.start_y === undefined || mergedWall.end_x === undefined || mergedWall.end_y === undefined) {
          console.log('API response missing coordinates, attempting to construct merged wall...');
          
          // If we have the wall ID, try to fetch the complete wall data
          if (mergedWall.id) {
            console.log('Attempting to fetch complete merged wall data...');
            
            try {
              // Try to fetch the specific merged wall by ID
              const wallResponse = await api.get(`/walls/${mergedWall.id}/`);
              if (wallResponse.status === 200 && wallResponse.data) {
                const completeWall = wallResponse.data;
                console.log('Successfully fetched complete merged wall:', completeWall);
                
                // Check if this wall has coordinates
                if (completeWall.start_x && completeWall.start_y && completeWall.end_x && completeWall.end_y) {
                  mergedWall = completeWall;
                  console.log('Using complete wall data from API');
                } else {
                  console.log('Fetched wall still missing coordinates, attempting coordinate construction...');
                  // Fall back to coordinate construction
                  try {
                    mergedWall = await constructMergedWallCoordinates(mergedWall, wall1, wall2);
                  } catch (constructionError) {
                    console.error('Coordinate construction failed:', constructionError);
                    // Try to fetch all walls as fallback
                    await fetchUpdatedWalls();
                    return;
                  }
                }
              } else {
                console.log('Failed to fetch wall by ID, attempting coordinate construction...');
                // Fall back to coordinate construction
                try {
                  mergedWall = await constructMergedWallCoordinates(mergedWall, wall1, wall2);
                } catch (constructionError) {
                  console.error('Coordinate construction failed:', constructionError);
                  // Try to fetch all walls as fallback
                  await fetchUpdatedWalls();
                  return;
                }
              }
            } catch (fetchError) {
              console.log('Failed to fetch wall by ID, attempting coordinate construction...');
              // Fall back to coordinate construction
              try {
                mergedWall = await constructMergedWallCoordinates(mergedWall, wall1, wall2);
              } catch (constructionError) {
                console.error('Coordinate construction failed:', constructionError);
                // Try to fetch all walls as fallback
                await fetchUpdatedWalls();
                return;
              }
            }
          } else {
            console.log('No wall ID in response, attempting coordinate construction...');
            try {
              mergedWall = await constructMergedWallCoordinates(mergedWall, wall1, wall2);
            } catch (constructionError) {
              console.error('Coordinate construction failed:', constructionError);
              // Try to fetch all walls as fallback
              await fetchUpdatedWalls();
              return;
            }
          }
        }
        
        // Final validation that we have a complete wall
        if (
          mergedWall &&
          mergedWall.start_x !== undefined &&
          mergedWall.start_y !== undefined &&
          mergedWall.end_x !== undefined &&
          mergedWall.end_y !== undefined
        ) {
          console.log('Wall merge complete with valid coordinates, updating state...');
          setWalls(prev => {
            const filteredWalls = prev.filter(w => w.id !== wall1.id && w.id !== wall2.id);
            const updatedWalls = [...filteredWalls, mergedWall];
            console.log('Updated walls count:', updatedWalls.length);
            console.log('New walls array:', updatedWalls);
            return updatedWalls;
          });
          
          setSelectedWallsForRoom([]);
          setWallMergeSuccess(true);
          setTimeout(() => setWallMergeSuccess(false), 3000);
        } else {
          console.error('Final validation failed, wall still missing coordinates:', mergedWall);
          const refreshed = await fetchUpdatedWalls();
          if (!refreshed) {
            setWallMergeError('Unable to merge walls because merged geometry is incomplete.');
            setTimeout(() => setWallMergeError(''), 5000);
          }
        }
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
    // Normalize wall coordinates to ensure proper direction
    const normalizedCoords = normalizeWallCoordinates(startPoint, endPoint);
    startPoint = normalizedCoords.startPoint;
    endPoint = normalizedCoords.endPoint;
    
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
      
      // Normalize first segment
      const segment1Coords = normalizeWallCoordinates(
        { x: wall.start_x, y: wall.start_y },
        { x: intersection.x, y: intersection.y }
      );
      wallsToAdd.push({
        start_x: segment1Coords.startPoint.x,
        start_y: segment1Coords.startPoint.y,
        end_x: segment1Coords.endPoint.x,
        end_y: segment1Coords.endPoint.y,
        height: wall.height,
        thickness: wall.thickness,
        application_type: wall.application_type,
        project: project.id,
        storey: wall.storey ?? activeStoreyId ?? defaultStoreyId
      });
      
      // Normalize second segment
      const segment2Coords = normalizeWallCoordinates(
        { x: intersection.x, y: intersection.y },
        { x: wall.end_x, y: wall.end_y }
      );
      wallsToAdd.push({
        start_x: segment2Coords.startPoint.x,
        start_y: segment2Coords.startPoint.y,
        end_x: segment2Coords.endPoint.x,
        end_y: segment2Coords.endPoint.y,
        height: wall.height,
        thickness: wall.thickness,
        application_type: wall.application_type,
        project: project.id,
        storey: wall.storey ?? activeStoreyId ?? defaultStoreyId
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
      // Normalize each new wall segment
      const segmentCoords = normalizeWallCoordinates(
        { x: splitPoints[i].x, y: splitPoints[i].y },
        { x: splitPoints[i+1].x, y: splitPoints[i+1].y }
      );
      newWallSegments.push({
        start_x: segmentCoords.startPoint.x,
        start_y: segmentCoords.startPoint.y,
        end_x: segmentCoords.endPoint.x,
        end_y: segmentCoords.endPoint.y,
        height: wallProps.height,
        thickness: wallProps.thickness,
        application_type: wallProps.application_type,
        project: project.id,
        storey: wallProps.storey ?? activeStoreyId ?? defaultStoreyId
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
    storeys,
    setStoreys,
    activeStorey,
    activeStoreyId,
    setActiveStoreyId,
    storeyError,
    setStoreyError,
    isStoreyLoading,
    showStoreyWizard,
    setShowStoreyWizard,
    openStoreyWizard,
    closeStoreyWizard,
    selectionContext,
    setSelectionContext,
    storeyWizardStep,
    setStoreyWizardStep,
    storeyWizardSourceStoreyId,
    setStoreyWizardSourceStoreyId,
    storeyWizardName,
    setStoreyWizardName,
    storeyWizardElevation,
    setStoreyWizardElevation,
    storeyWizardDefaultHeight,
    setStoreyWizardDefaultHeight,
    storeyWizardSlabThickness,
    setStoreyWizardSlabThickness,
    storeyWizardAreas,
    setStoreyWizardAreas,
    storeyWizardRoomSelections,
    setStoreyWizardRoomSelections,
    storeyWizardRoomOverrides,
    updateStoreyWizardRoomOverride,
    storeyWizardAreaOverrides,
    setStoreyWizardAreaOverrides,
    updateStoreyWizardAreaOverride,
    deleteStorey: async (storeyId) => {
      try {
        await api.delete(`/storeys/${storeyId}/`);
        await ensureStoreys();
        await fetchProjectDetails();
      } catch (error) {
        console.error('Failed to delete storey:', error);
        const message =
          error.response?.data?.error ||
          error.message ||
          'Failed to delete storey.';
        setStoreyError(message);
      }
    },
    storeyWizardError,
    setStoreyWizardError,
    filteredWalls,
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
    filteredRooms,
    filteredGhostWalls,
    filteredGhostAreas,
    isLevelEditMode,
    enterLevelEditMode,
    exitLevelEditMode,
    levelEditSelections,
    levelEditOverrides,
    toggleLevelEditRoom,
    clearLevelEditSelections,
    addRoomsToActiveStorey,
    isLevelEditApplying,
    levelEditError,
    updateLevelEditOverride,
    levelEditSuccess,
    projectCalculatedHeight,
    selectedWallType,
    setSelectedWallType,
    showWallEditor,
    setShowWallEditor,
    showRoomManagerModal,
    setShowRoomManagerModal,
    isRoomManagerMinimized,
    setRoomManagerMinimized,
    joints,
    setJoints,
    filteredJoints,
    selectedDoorWall,
    setSelectedDoorWall,
    showDoorManager,
    setShowDoorManager,
    doors,
    setDoors,
    filteredDoors,
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
    wallSplitError,
    setWallSplitError,
    wallSplitSuccess,
    setWallSplitSuccess,
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
    showPanelLines,
    setShowPanelLines,
    currentView,
    setCurrentView,
    // Add shared panel data state for cross-tab communication
    sharedPanelData,
    setSharedPanelData,
    updateSharedPanelData,
    getAllPanelData,
    // Handlers
    fetchProjectDetails,
    ensureStoreys,
    beginStoreyAreaSelection,
    cancelStoreyAreaSelection,
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
    handleManualWallSplit,
    handleDoorSelect,
    handleDeleteDoor,
    handleAddWallWithSplitting,
    handleViewToggle,
    completeStoreyWizard,
    computeStoreyWizardElevation,
    computeStoreyWizardElevation,
    isStoreyWizardMinimized,
    setStoreyWizardMinimized,
    togglePanelLines: () => {
      setShowPanelLines(prev => !prev);
      // Also toggle ceiling panel lines when toggling wall panel lines
      if (is3DView && threeCanvasInstance.current && threeCanvasInstance.current.toggleAllPanelLines) {
        threeCanvasInstance.current.toggleAllPanelLines();
      }
    },
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
    forceCleanup3D,
    // Canvas image methods
    updateCanvasImage,
  };
} 