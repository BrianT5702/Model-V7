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
  applicationType = 'wall',
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
    application_type: applicationType,
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

function pointOnWall(point, wall, tol = 1) {
  const dx = Number(wall.end_x) - Number(wall.start_x);
  const dy = Number(wall.end_y) - Number(wall.start_y);
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return false;
  const ux = dx / len;
  const uy = dy / len;
  const relX = point.x - Number(wall.start_x);
  const relY = point.y - Number(wall.start_y);
  const along = relX * ux + relY * uy;
  const perp = Math.abs(relX * -uy + relY * ux);
  return perp <= tol && along >= -tol && along <= len + tol;
}

/** True when both ends already lie on an existing wall (site boundary or earlier segment). */
function isSegmentCoveredByWalls(start, end, walls, tol = 1) {
  return walls.some((wall) => pointOnWall(start, wall, tol) && pointOnWall(end, wall, tol));
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
        temperature: r.temperature,
        temperature_min: r.temperature_min,
        temperature_max: r.temperature_max,
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
        if (isSegmentCoveredByWalls(segment.start, segment.end, walls)) continue;

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
          applicationType: 'partition',
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
          if (!wallBySegment.has(key) && !isSegmentCoveredByWalls(start, end, walls)) {
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
              applicationType: 'partition',
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
        temperature: placed.temperature ?? 0,
        temperature_min: placed.temperature_min ?? null,
        temperature_max: placed.temperature_max ?? null,
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

      const innerFinish = placed.inner_face_material || 'PPGI';
      const outerFinish = placed.outer_face_material || 'PPGI';
      for (const wallId of linkedIds) {
        const wall = walls.find((w) => w.id === wallId);
        if (!wall || wall.is_default === false) continue;
        if (wall.inner_face_material === innerFinish && wall.outer_face_material === outerFinish) continue;
        try {
          const patched = await api.patch(`/walls/${wallId}/`, {
            inner_face_material: innerFinish,
            outer_face_material: outerFinish,
          });
          const idx = walls.findIndex((w) => w.id === wallId);
          if (idx >= 0) walls[idx] = patched.data;
        } catch (err) {
          console.warn('Could not update boundary wall finishes:', err);
        }
      }
    }
  }

  const warnings = [];

  const hasPanelFloor = createdRooms.some((room) => {
    const type = String(room.floor_type || '').toLowerCase();
    return type === 'panel';
  });
  if (hasPanelFloor) {
    try {
      await api.post('/floor-plans/generate_floor_plan/', {
        project_id: projectId,
        orientation_strategy: 'auto',
        panel_width: 1150,
        panel_length: 'auto',
      });
    } catch (err) {
      console.warn('Chatbot floor generation failed:', err);
      warnings.push('Floor panels could not be generated automatically. You can generate them on the Floor tab.');
    }
  }

  const hasCeiling = createdRooms.some((room) => room.exclude_from_ceiling !== true);
  if (hasCeiling && createdRooms.length > 0) {
    try {
      await api.post('/ceiling-plans/generate_enhanced_ceiling_plan/', {
        project_id: projectId,
        orientation_strategy: 'auto',
        panel_width: 1150,
        panel_length: 6000,
        custom_panel_length: 6000,
        ceiling_thickness: 150,
        support_type: 'nylon',
        support_config: {
          enableNylonHangers: true,
          enableAluSuspension: false,
        },
      });
    } catch (err) {
      console.warn('Chatbot ceiling generation failed:', err);
      warnings.push('Ceiling panels could not be generated automatically. You can generate them on the Ceiling tab.');
    }
  }

  const refreshed = await api.get(`projects/${projectId}/`);
  return {
    project: refreshed.data,
    rooms: createdRooms,
    layout,
    warnings,
  };
}
