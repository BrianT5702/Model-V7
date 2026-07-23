import api from '../../api/api';
import { detectRoomWalls } from '../project/projectUtils';
import {
  arrangeRooms,
  collectUniqueWallSegments,
  isFullSiteSingleRoom,
  segmentKey,
} from './roomLayoutEngine';

const FACE_THICKNESS = 0.5;

function wallPayload({
  projectId,
  storeyId,
  start,
  end,
  height,
  thickness,
  inner,
  outer,
  isDefault = false,
}) {
  return {
    project: projectId,
    storey: storeyId,
    start_x: start.x,
    start_y: start.y,
    end_x: end.x,
    end_y: end.y,
    height,
    thickness,
    application_type: 'wall',
    inner_face_material: inner || 'PPGI',
    inner_face_thickness: FACE_THICKNESS,
    outer_face_material: outer || 'PPGI',
    outer_face_thickness: FACE_THICKNESS,
    is_default: isDefault,
    has_concrete_base: false,
    concrete_base_height: null,
    fill_gap_mode: false,
    gap_fill_height: null,
    gap_base_position: null,
  };
}

function resolveRoomWallIds(roomPoints, walls, preferDefaultBoundary = false) {
  let wallIds = detectRoomWalls(roomPoints, walls, 2);
  if (wallIds.length >= 3) return wallIds;

  if (preferDefaultBoundary) {
    const defaultWalls = walls.filter((w) => w.is_default !== false);
    const defaultIds = detectRoomWalls(roomPoints, defaultWalls, 2);
    if (defaultIds.length >= 3) return defaultIds;
    if (defaultWalls.length >= 3) return defaultWalls.map((w) => w.id);
  }

  return wallIds;
}

/**
 * Create project + optionally rooms with shared walls and smart packing.
 * @param {object} draft chatbot draft
 * @returns {Promise<{ project: object, rooms: object[], layout: object }>}
 */
export async function createProjectFromChatDraft(draft) {
  if (!draft?.name || !draft.width || !draft.length || !draft.height) {
    throw new Error('Project name and site size (width, length, height) are required.');
  }

  const projectResponse = await api.post('projects/', {
    name: draft.name,
    width: draft.width,
    length: draft.length,
    height: draft.height,
    wall_thickness: draft.wall_thickness || 200,
  });

  const listProject = projectResponse.data;
  const projectId = listProject.id;

  const detailResponse = await api.get(`projects/${projectId}/`);
  const project = detailResponse.data;
  const storeyId =
    project.storeys?.[0]?.id ||
    listProject.storeys?.[0]?.id ||
    null;

  if (!storeyId) {
    throw new Error('Ground Floor storey was not created for the project.');
  }

  let walls = Array.isArray(project.walls) ? [...project.walls] : [];
  if (!walls.length) {
    const wallsRes = await api.get(`projects/${projectId}/walls/`);
    walls = wallsRes.data || [];
  }

  const createdRooms = [];
  let layout = { placed: [], overflow: false };

  if (!draft.skipRooms && Array.isArray(draft.rooms) && draft.rooms.length > 0) {
    layout = arrangeRooms(
      draft.rooms.map((r) => ({
        name: r.name,
        width: r.width,
        length: r.length,
        height: r.height,
        floor_type: r.floor_type,
        floor_thickness: r.floor_thickness,
        include_ceiling: r.include_ceiling,
        inner_face_material: r.inner_face_material,
        outer_face_material: r.outer_face_material,
      })),
      draft.width,
      draft.length
    );

    if (layout.overflow) {
      throw new Error(layout.message || 'Rooms do not fit in the project site.');
    }

    const fullSiteSingle = isFullSiteSingleRoom(draft, layout.placed);
    const thickness = draft.wall_thickness || 200;

    const wallBySegment = new Map();
    walls.forEach((wall) => {
      const key = segmentKey(
        { x: wall.start_x, y: wall.start_y },
        { x: wall.end_x, y: wall.end_y }
      );
      wallBySegment.set(key, wall);
    });

    // Only create interior/partition walls — never duplicate the site boundary for a full-site room
    if (!fullSiteSingle) {
      const uniqueSegments = collectUniqueWallSegments(layout.placed);
      const maxRoomHeight = Math.max(
        ...layout.placed.map((r) => Number(r.height) || Number(draft.height) || 3000),
        Number(draft.height) || 3000
      );

      for (const segment of uniqueSegments) {
        const key = segmentKey(segment.start, segment.end);
        if (wallBySegment.has(key)) continue;

        const owner = layout.placed.find((room) => {
          const pts = room.room_points;
          for (let i = 0; i < pts.length; i += 1) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            if (segmentKey(a, b) === key) return true;
          }
          return false;
        });

        const response = await api.post('/walls/', wallPayload({
          projectId,
          storeyId,
          start: segment.start,
          end: segment.end,
          height: maxRoomHeight,
          thickness,
          inner: owner?.inner_face_material,
          outer: owner?.outer_face_material,
          isDefault: false,
        }));
        wallBySegment.set(key, response.data);
        walls.push(response.data);
      }
    }

    for (const placed of layout.placed) {
      let linkedIds = resolveRoomWallIds(
        placed.room_points,
        walls,
        fullSiteSingle
      );

      if (linkedIds.length < 3 && !fullSiteSingle) {
        const pts = placed.room_points;
        for (let i = 0; i < pts.length; i += 1) {
          const start = pts[i];
          const end = pts[(i + 1) % pts.length];
          const key = segmentKey(start, end);
          if (!wallBySegment.has(key)) {
            const response = await api.post('/walls/', wallPayload({
              projectId,
              storeyId,
              start,
              end,
              height: placed.height || draft.height,
              thickness,
              inner: placed.inner_face_material,
              outer: placed.outer_face_material,
              isDefault: false,
            }));
            wallBySegment.set(key, response.data);
            walls.push(response.data);
          }
        }
        linkedIds = resolveRoomWallIds(placed.room_points, walls, false);
      }

      const roomPayload = {
        project: projectId,
        storey: storeyId,
        room_name: placed.name,
        floor_type: placed.floor_type || 'Panel',
        floor_thickness: placed.floor_thickness ?? 0,
        floor_layers: 1,
        temperature: 0,
        height: placed.height || draft.height,
        base_elevation_mm: 0,
        remarks: 'Created by project chatbot',
        walls: linkedIds,
        room_points: placed.room_points,
      };

      const roomRes = await api.post('/rooms/', roomPayload);
      let room = roomRes.data;

      const excludeCeiling = placed.include_ceiling === false;
      if (excludeCeiling) {
        try {
          const patch = await api.patch(`/rooms/${room.id}/`, {
            exclude_from_ceiling: true,
          });
          room = patch.data;
        } catch (err) {
          console.warn('Could not set exclude_from_ceiling:', err);
        }
      }

      createdRooms.push(room);
    }
  }

  const refreshed = await api.get(`projects/${projectId}/`);
  return {
    project: refreshed.data,
    rooms: createdRooms,
    layout,
  };
}
