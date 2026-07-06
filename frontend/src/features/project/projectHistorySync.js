const WALL_COMPARE_KEYS = [
  'start_x', 'start_y', 'end_x', 'end_y',
  'height', 'thickness', 'base_elevation_mm', 'base_elevation_manual',
  'application_type', 'inner_face_material', 'inner_face_thickness',
  'outer_face_material', 'outer_face_thickness', 'is_default',
  'has_concrete_base', 'concrete_base_height', 'fill_gap_mode',
  'gap_fill_height', 'gap_base_position', 'ceiling_joint_type',
  'ceiling_cut_l_horizontal_extension', 'storey',
];

const ROOM_COMPARE_KEYS = [
  'room_name', 'height', 'room_points', 'walls', 'storey',
  'label_position', 'base_elevation_mm', 'floor_type', 'floor_thickness',
  'floor_layers', 'temperature', 'temperature_min', 'temperature_max',
];

const DOOR_COMPARE_KEYS = [
  'linked_wall', 'wall_id', 'width', 'height', 'thickness',
  'position_x', 'position_y', 'door_type', 'configuration',
  'swing_direction', 'slide_direction', 'side', 'orientation', 'storey',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickComparable(source, keys) {
  const result = {};
  keys.forEach((key) => {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  });
  return result;
}

function entitiesEqual(a, b, keys) {
  return JSON.stringify(pickComparable(a, keys)) === JSON.stringify(pickComparable(b, keys));
}

function computeEntityDelta(targetEntities, currentEntities, compareKeys) {
  const targetById = new Map(targetEntities.map((entity) => [entity.id, entity]));
  const currentById = new Map(currentEntities.map((entity) => [entity.id, entity]));

  const toDelete = currentEntities.filter((entity) => !targetById.has(entity.id));
  const toCreate = targetEntities.filter((entity) => !currentById.has(entity.id));
  const toUpdate = targetEntities.filter((entity) => {
    const current = currentById.get(entity.id);
    return current && !entitiesEqual(current, entity, compareKeys);
  });

  return { toDelete, toCreate, toUpdate };
}

function stripWallForCreate(wall, projectId) {
  const {
    id,
    rooms,
    windows,
    storey_id,
    ...rest
  } = wall;
  return {
    ...rest,
    project: wall.project ?? projectId,
    storey: wall.storey ?? storey_id ?? null,
  };
}

function stripWallForUpdate(wall) {
  const { rooms, windows, ...rest } = wall;
  return rest;
}

function stripRoomForWrite(room, projectId, wallIdMap) {
  const {
    id,
    ceiling_plan,
    floor_plan,
    ceiling_zones,
    zone_ceiling_plan,
    ...rest
  } = room;
  const walls = Array.isArray(room.walls)
    ? room.walls.map((wallId) => wallIdMap.get(wallId) ?? wallId)
    : room.walls;
  return {
    ...rest,
    walls,
    project: room.project ?? projectId,
  };
}

function stripDoorForWrite(door, projectId, wallIdMap) {
  const { windows, wall_id, ...rest } = door;
  const linkedWall = door.linked_wall ?? wall_id;
  return {
    ...rest,
    project: door.project ?? projectId,
    linked_wall: wallIdMap.get(linkedWall) ?? linkedWall,
    swing_direction: door.swing_direction ?? 'right',
    slide_direction: door.slide_direction ?? 'right',
    side: door.side ?? 'interior',
    orientation: door.orientation ?? 'horizontal',
  };
}

export function captureProjectSnapshot(walls, rooms, doors) {
  return {
    walls: clone(walls || []),
    rooms: clone(rooms || []),
    doors: clone(doors || []),
  };
}

async function syncWalls(api, projectId, targetWalls, currentWalls) {
  const wallIdMap = new Map();
  const { toDelete, toCreate, toUpdate } = computeEntityDelta(
    targetWalls,
    currentWalls,
    WALL_COMPARE_KEYS
  );

  if (toDelete.length === 0 && toCreate.length === 0 && toUpdate.length === 0) {
    return { walls: currentWalls, wallIdMap, changed: false };
  }

  await Promise.all(
    toDelete.map((wall) => api.delete(`/walls/${wall.id}/`))
  );

  const createResults = await Promise.all(
    toCreate.map(async (wall) => {
      const response = await api.post(
        '/walls/create_wall/',
        stripWallForCreate(wall, projectId)
      );
      return { oldId: wall.id, newWall: response.data };
    })
  );

  createResults.forEach(({ oldId, newWall }) => {
    wallIdMap.set(oldId, newWall.id);
  });

  await Promise.all(
    toUpdate.map((wall) => {
      const resolvedId = wallIdMap.get(wall.id) ?? wall.id;
      return api.put(`/walls/${resolvedId}/`, stripWallForUpdate({
        ...wall,
        id: resolvedId,
      }));
    })
  );

  const finalResponse = await api.get(`/projects/${projectId}/walls/`);
  return { walls: finalResponse.data, wallIdMap, changed: true };
}

async function syncRooms(api, projectId, targetRooms, currentRooms, wallIdMap) {
  const { toDelete, toCreate, toUpdate } = computeEntityDelta(
    targetRooms,
    currentRooms,
    ROOM_COMPARE_KEYS
  );

  if (toDelete.length === 0 && toCreate.length === 0 && toUpdate.length === 0) {
    return { rooms: currentRooms, changed: false };
  }

  await Promise.all(
    toDelete.map((room) => api.delete(`/rooms/${room.id}/`))
  );

  await Promise.all(
    toCreate.map((room) =>
      api.post('/rooms/', stripRoomForWrite(room, projectId, wallIdMap))
    )
  );

  await Promise.all(
    toUpdate.map((room) =>
      api.put(`/rooms/${room.id}/`, stripRoomForWrite(room, projectId, wallIdMap))
    )
  );

  const finalResponse = await api.get(`/rooms/?project=${projectId}`);
  return {
    rooms: Array.isArray(finalResponse.data) ? finalResponse.data : [],
    changed: true,
  };
}

async function syncDoors(api, projectId, targetDoors, currentDoors, wallIdMap) {
  const { toDelete, toCreate, toUpdate } = computeEntityDelta(
    targetDoors,
    currentDoors,
    DOOR_COMPARE_KEYS
  );

  if (toDelete.length === 0 && toCreate.length === 0 && toUpdate.length === 0) {
    return { doors: currentDoors, changed: false };
  }

  await Promise.all(
    toDelete.map((door) => api.delete(`/doors/${door.id}/`))
  );

  await Promise.all(
    toCreate.map((door) =>
      api.post('/doors/create_door/', stripDoorForWrite(door, projectId, wallIdMap))
    )
  );

  await Promise.all(
    toUpdate.map((door) =>
      api.put(`/doors/${door.id}/`, stripDoorForWrite(door, projectId, wallIdMap))
    )
  );

  const finalResponse = await api.get(`/doors/?project=${projectId}`);
  return { doors: finalResponse.data || [], changed: true };
}

export async function restoreProjectSnapshot(api, projectId, snapshot) {
  const [wallsResponse, roomsResponse, doorsResponse] = await Promise.all([
    api.get(`/projects/${projectId}/walls/`),
    api.get(`/rooms/?project=${projectId}`),
    api.get(`/doors/?project=${projectId}`),
  ]);

  const currentWalls = wallsResponse.data || [];
  const currentRooms = Array.isArray(roomsResponse.data) ? roomsResponse.data : [];
  const currentDoors = doorsResponse.data || [];

  const { walls: syncedWalls, wallIdMap, changed: wallsChanged } = await syncWalls(
    api,
    projectId,
    snapshot.walls || [],
    currentWalls
  );

  const { rooms: syncedRooms, changed: roomsChanged } = await syncRooms(
    api,
    projectId,
    snapshot.rooms || [],
    currentRooms,
    wallIdMap
  );

  const { doors: syncedDoors, changed: doorsChanged } = await syncDoors(
    api,
    projectId,
    snapshot.doors || [],
    currentDoors,
    wallIdMap
  );

  return {
    walls: syncedWalls,
    rooms: syncedRooms,
    doors: syncedDoors,
    needsIntersectionRefresh: wallsChanged || roomsChanged || doorsChanged,
  };
}
