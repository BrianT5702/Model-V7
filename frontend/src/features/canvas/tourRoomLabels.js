import THREE from './threeInstance';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { calculatePolygonVisualCenter } from './utils';
import { buildRoomLabelLines } from '../room/roomLabelUtils';

const LABEL_FLOAT_MM = 2400;
const LABEL_SHOW_MIN_MM = 1200;
const LABEL_SHOW_MAX_MM = 42000;
const STOREY_SAME_FLOOR_TOLERANCE_MM = 2800;
const OCCLUSION_MARGIN_MM = 150;

function viewCrossesWall(px, pz, lx, lz, vx, vz, vLen2, wall) {
  const { ax, az, bx, bz, half } = wall;
  const minX = Math.min(px, lx) - half;
  const maxX = Math.max(px, lx) + half;
  const minZ = Math.min(pz, lz) - half;
  const maxZ = Math.max(pz, lz) + half;
  if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX) return false;
  if (Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) return false;

  const wx = bx - ax;
  const wz = bz - az;
  const wLen2 = wx * wx + wz * wz;
  if (wLen2 < 1e-8) return false;
  const b = vx * wx + vz * wz;
  const d = vx * (px - ax) + vz * (pz - az);
  const e = wx * (px - ax) + wz * (pz - az);
  const denom = vLen2 * wLen2 - b * b;
  let s;
  let t;
  if (denom < 1e-6) {
    s = 0;
    t = e / wLen2;
  } else {
    s = (b * e - wLen2 * d) / denom;
    t = (vLen2 * e - b * d) / denom;
  }
  if (s < 0.08 || s > 0.92) return false;
  t = Math.max(0, Math.min(1, t));
  const dx = px + s * vx - (ax + t * wx);
  const dz = pz + s * vz - (az + t * wz);
  return dx * dx + dz * dz <= half * half;
}

/** 3D tour labels always sit at the room polygon center (independent of 2D label drag position). */
function resolveRoomCenterPosition(room, scale, offset) {
  if (!room.room_points || room.room_points.length < 3) {
    return null;
  }

  const center = calculatePolygonVisualCenter(room.room_points);
  if (!center) {
    return null;
  }

  return {
    x: center.x * scale + offset.x,
    z: center.y * scale + offset.z,
  };
}

export default class TourRoomLabelManager {
  constructor(instance) {
    this.instance = instance;
    this.active = false;
    this.labelObjects = [];
    this._rayOrigin = new THREE.Vector3();
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'tour-room-label-layer';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.instance.container.appendChild(this.labelRenderer.domElement);
    this.syncRendererSize();
  }

  syncRendererSize() {
    const { clientWidth, clientHeight } = this.instance.container;
    if (clientWidth > 0 && clientHeight > 0) {
      this.labelRenderer.setSize(clientWidth, clientHeight);
    }
  }

  rebuild() {
    this.clear();
    this.wallSegments = null;
    const rooms = this.instance.project?.rooms || [];
    const scale = this.instance.scalingFactor;
    const offset = this.instance.modelOffset || { x: 0, z: 0 };

    rooms.forEach((room) => {
      if (!room.room_points || room.room_points.length < 3) {
        return;
      }

      const position = resolveRoomCenterPosition(room, scale, offset);
      if (!position) {
        return;
      }

      const floorThicknessMm = room.floor_thickness || 150;
      const baseElevationMm = room.base_elevation_mm ?? 0;
      const floorY = baseElevationMm * scale + floorThicknessMm * scale;
      const floatY = floorY + LABEL_FLOAT_MM * scale;

      const element = document.createElement('div');
      element.className = 'tour-room-label';

      const lines = buildRoomLabelLines(room);
      const title = document.createElement('div');
      title.className = 'tour-room-label__title';
      title.textContent = lines[0] || room.room_name || `Room ${room.id}`;
      element.appendChild(title);

      if (lines.length > 1) {
        const meta = document.createElement('div');
        meta.className = 'tour-room-label__meta';
        meta.textContent = lines.slice(1).join(' · ');
        element.appendChild(meta);
      }

      const label = new CSS2DObject(element);
      label.position.set(position.x, floatY, position.z);
      label.userData.floorY = floorY;
      label.userData.roomId = room.id;
      this.instance.scene.add(label);
      this.labelObjects.push(label);
    });
  }

  getWallSegments() {
    if (this.wallSegments) return this.wallSegments;
    const scale = this.instance.scalingFactor || 0.01;
    const offset = this.instance.modelOffset || { x: 0, z: 0 };
    const margin = OCCLUSION_MARGIN_MM * scale;
    this.wallSegments = (this.instance.walls || []).map((wall) => {
      const half = ((Number(wall.thickness) || 200) * scale) * 0.5 + margin;
      return {
        ax: wall.start_x * scale + offset.x,
        az: wall.start_y * scale + offset.z,
        bx: wall.end_x * scale + offset.x,
        bz: wall.end_y * scale + offset.z,
        half,
      };
    });
    return this.wallSegments;
  }

  isLabelOccludedByWall(label) {
    const walls = this.getWallSegments();
    if (!walls.length) return false;
    const px = this._rayOrigin.x;
    const pz = this._rayOrigin.z;
    const lx = label.position.x;
    const lz = label.position.z;
    const vx = lx - px;
    const vz = lz - pz;
    const vLen2 = vx * vx + vz * vz;
    if (vLen2 < 1e-4) return false;
    for (let i = 0; i < walls.length; i += 1) {
      const wall = walls[i];
      if (viewCrossesWall(px, pz, lx, lz, vx, vz, vLen2, wall)) return true;
    }
    return false;
  }

  getViewerFloorY(player) {
    const controller = this.instance.roomTourController;
    if (controller?.findFloorZoneAt) {
      const zone = controller.findFloorZoneAt(player.x, player.z, player.y);
      if (zone) {
        return zone.floorY;
      }
    }

    let bestFloorY = null;
    let bestDelta = Infinity;
    const seen = new Set();
    this.labelObjects.forEach((label) => {
      const floorY = label.userData.floorY;
      const key = floorY.toFixed(3);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const delta = Math.abs(player.y - floorY);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestFloorY = floorY;
      }
    });
    return bestFloorY;
  }

  setActive(active) {
    this.active = active;
    this.labelRenderer.domElement.style.display = active ? 'block' : 'none';
    this.labelObjects.forEach((label) => {
      label.visible = active;
    });
    if (active) {
      this.syncRendererSize();
    }
  }

  update(player = null) {
    if (!this.active || !player) {
      return;
    }

    const scale = this.instance.scalingFactor;
    const minDist = LABEL_SHOW_MIN_MM * scale;
    const maxDist = LABEL_SHOW_MAX_MM * scale;
    const storeyTol = STOREY_SAME_FLOOR_TOLERANCE_MM * scale;
    const viewerFloorY = this.getViewerFloorY(player);
    this._rayOrigin.set(player.x, player.y, player.z);

    this.labelObjects.forEach((label) => {
      const dx = label.position.x - player.x;
      const dz = label.position.z - player.z;
      const dist = Math.hypot(dx, dz);

      let opacity = 1;
      if (viewerFloorY == null || Math.abs(label.userData.floorY - viewerFloorY) > storeyTol) {
        opacity = 0;
      } else if (dist > maxDist) {
        opacity = 0;
      } else if (dist > minDist) {
        opacity = 1 - (dist - minDist) / (maxDist - minDist);
      }

      if (opacity > 0.02 && this.isLabelOccludedByWall(label)) {
        opacity = 0;
      }

      label.element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
      label.visible = opacity > 0.02;
    });
  }

  render() {
    if (!this.active) {
      return;
    }
    this.syncRendererSize();
    this.labelRenderer.render(this.instance.scene, this.instance.camera);
  }

  clear() {
    this.labelObjects.forEach((label) => {
      this.instance.scene.remove(label);
      if (label.element?.parentNode) {
        label.element.parentNode.removeChild(label.element);
      }
    });
    this.labelObjects = [];
    this.wallSegments = null;
  }

  dispose() {
    this.clear();
    if (this.labelRenderer.domElement.parentNode) {
      this.labelRenderer.domElement.parentNode.removeChild(this.labelRenderer.domElement);
    }
  }
}
