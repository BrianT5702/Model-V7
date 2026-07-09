import THREE from './threeInstance';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { calculatePolygonVisualCenter } from './utils';
import { buildRoomLabelLines } from '../room/roomLabelUtils';

const LABEL_FLOAT_MM = 2400;
const LABEL_SHOW_MIN_MM = 1200;
const LABEL_SHOW_MAX_MM = 42000;
const STOREY_SAME_FLOOR_TOLERANCE_MM = 2800;
const OCCLUSION_MARGIN_MM = 150;
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
    this.wallMeshes = null;
    this.raycaster = new THREE.Raycaster();
    this._rayOrigin = new THREE.Vector3();
    this._rayTarget = new THREE.Vector3();
    this._rayDirection = new THREE.Vector3();
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
    this.wallMeshes = null;
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

  getWallMeshes() {
    if (!this.wallMeshes) {
      this.wallMeshes = [];
      this.instance.scene.traverse((object) => {
        if (object.isMesh && object.userData?.isWall && object.visible) {
          this.wallMeshes.push(object);
        }
      });
    }
    return this.wallMeshes;
  }

  isLabelOccludedByWall(label) {
    const walls = this.getWallMeshes();
    if (!walls.length) {
      return false;
    }

    const camera = this.instance.camera;
    label.getWorldPosition(this._rayTarget);
    this._rayOrigin.copy(camera.position);

    const distToLabel = this._rayOrigin.distanceTo(this._rayTarget);
    if (distToLabel < 1e-6) {
      return false;
    }

    this._rayDirection.copy(this._rayTarget).sub(this._rayOrigin).normalize();
    const margin = OCCLUSION_MARGIN_MM * this.instance.scalingFactor;
    this.raycaster.set(this._rayOrigin, this._rayDirection);
    this.raycaster.near = 0.01;
    this.raycaster.far = Math.max(distToLabel - margin, margin * 0.25);

    return this.raycaster.intersectObjects(walls, false).length > 0;
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

      if (this.isLabelOccludedByWall(label)) {
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
    this.wallMeshes = null;
  }

  dispose() {
    this.clear();
    if (this.labelRenderer.domElement.parentNode) {
      this.labelRenderer.domElement.parentNode.removeChild(this.labelRenderer.domElement);
    }
  }
}
