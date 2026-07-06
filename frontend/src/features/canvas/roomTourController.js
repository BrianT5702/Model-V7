import * as THREE from 'three';
import { resolveWallBaseElevationMm } from '../project/projectUtils';
import { isPointInPolygon } from './utils';
import {
  buildAllDoorOpenings,
  buildDoorOpeningZone,
  distPointToSegment2D,
  doorMatchesWall,
  getWallRunGeometry,
  isPointInDoorPassage,
  openingMatchesWall,
  shouldSkipCollinearWall,
} from './tourWallCollision';

const TOUR = {
  WALK_SPEED: 32,
  FLY_SPEED: 36,
  SPRINT_MULTIPLIER: 1.65,
  PLAYER_RADIUS_MM: 220,
  EYE_HEIGHT_MM: 1650,
  FLOOR_THICKNESS_MM: 150,
  DOOR_GAP_MARGIN_MM: 35,
  MOVE_SUBSTEP_MM: 45,
  MOUSE_SENSITIVITY: 0.0022,
  MIN_PITCH: -1.15,
  MAX_PITCH: 1.05,
  FOV_DEFAULT: 72,
  FOV_MIN: 52,
  FOV_MAX: 92,
  ZOOM_WHEEL_STEP: 1.8,
  PLAY_MARGIN_FACTOR: 0.85,
  PLAY_MARGIN_MIN: 100,
  WALL_SAMPLE_OFFSET_MM: 250,
  STOREY_BAND_TOLERANCE_MM: 450,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default class RoomTourController {
  constructor(instance) {
    this.instance = instance;
    this.active = false;
    this.placementMode = false;
    this.pendingSpawn = null;
    this.placementMarker = null;
    this.keys = new Set();
    this.floorZones = [];
    this.doorOpenings = [];
    this.playBounds = null;
    this.defaultGroundY = 0;
    this.player = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.fov = TOUR.FOV_DEFAULT;
    this.playerRadius = TOUR.PLAYER_RADIUS_MM * instance.scalingFactor;
    this.eyeHeight = TOUR.EYE_HEIGHT_MM * instance.scalingFactor;
    this.insideBuilding = false;
    this.hud = null;
    this.lastFrameTime = performance.now();
    this.pointerLocked = false;
    this.pointerLockRetryAfter = 0;
    this.savedControlsEnabled = true;
    this.savedCameraFov = instance.camera.fov;

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handlePointerLockChange = this.handlePointerLockChange.bind(this);
    this.handleCanvasClick = this.handleCanvasClick.bind(this);
    this.handleHudStartClick = this.handleHudStartClick.bind(this);
  }

  isPlacing() {
    return this.placementMode;
  }

  isWalking() {
    return this.active;
  }

  buildFloorZones() {
    const { instance } = this;
    const scale = instance.scalingFactor;
    const offset = instance.modelOffset || { x: 0, z: 0 };
    const rooms = instance.project?.rooms || [];
    const zones = [];

    rooms.forEach((room) => {
      if (!room.room_points || room.room_points.length < 3) {
        return;
      }
      const floorThicknessMm = room.floor_thickness || TOUR.FLOOR_THICKNESS_MM;
      const baseElevationMm = room.base_elevation_mm ?? 0;
      const roomHeightMm = room.height ?? room.room_height ?? 3000;
      zones.push({
        roomId: room.id,
        polygon: room.room_points.map((point) => ({
          x: point.x * scale + offset.x,
          y: point.y * scale + offset.z,
        })),
        floorY: baseElevationMm * scale + floorThicknessMm * scale,
        ceilingY: baseElevationMm * scale + roomHeightMm * scale,
      });
    });

    this.floorZones = zones;
    return zones;
  }

  buildDoorOpenings() {
    this.doorOpenings = buildAllDoorOpenings(
      this.instance,
      TOUR.DOOR_GAP_MARGIN_MM,
      this.playerRadius
    );
    return this.doorOpenings;
  }

  isAlongDoorOpening(x, z, wallId = null) {
    if (wallId != null) {
      return this.doorOpenings.some((opening) => (
        openingMatchesWall(opening, wallId)
        && isPointInDoorPassage([opening], x, z)
      ));
    }
    return isPointInDoorPassage(this.doorOpenings, x, z);
  }

  findDoorOpeningAt(x, z) {
    return this.doorOpenings.find((opening) => isPointInDoorPassage([opening], x, z));
  }

  getWallGeometry(wall) {
    return getWallRunGeometry(this.instance, wall);
  }

  /** Matches wall mesh vertical extent in meshUtils (base elevation + height). */
  getWallBaseY(wall) {
    const scale = this.instance.scalingFactor;
    if (
      wall.fill_gap_mode
      && wall.gap_base_position != null
    ) {
      return Number(wall.gap_base_position) * scale;
    }
    return resolveWallBaseElevationMm(wall, this.instance.project) * scale;
  }

  getWallTopY(wall) {
    const scale = this.instance.scalingFactor;
    if (
      wall.fill_gap_mode
      && wall.gap_fill_height != null
      && wall.gap_base_position != null
    ) {
      return (
        Number(wall.gap_base_position) * scale
        + Number(wall.gap_fill_height) * scale
      );
    }
    const baseY = resolveWallBaseElevationMm(wall, this.instance.project) * scale;
    const heightMm = Number(wall.height) || 3000;
    return baseY + heightMm * scale;
  }

  isAboveWallTop(wall, playerY = this.player.y) {
    const clearanceY = playerY + this.eyeHeight;
    return clearanceY >= this.getWallTopY(wall);
  }

  /**
   * Tall lower-storey shells (e.g. 25 m ASRS) pass through upper floors in XZ but
   * should not block walking on those upper floor slabs.
   */
  isThroughStoreyShaftWall(wall, zone) {
    if (!zone) {
      return false;
    }
    const tol = TOUR.STOREY_BAND_TOLERANCE_MM * this.instance.scalingFactor;
    const wallBase = this.getWallBaseY(wall);
    const wallTop = this.getWallTopY(wall);
    const { floorY, ceilingY } = zone;
    return wallBase < floorY - tol && wallTop > ceilingY + tol;
  }

  wallBlocksOnPlayerStorey(wall, zone) {
    if (!zone) {
      return true;
    }
    if (this.isThroughStoreyShaftWall(wall, zone)) {
      return false;
    }
    const wallBase = this.getWallBaseY(wall);
    const wallTop = this.getWallTopY(wall);
    return wallTop > zone.floorY && wallBase < zone.ceilingY;
  }

  isExteriorWall(wall, referenceY = this.player.y) {
    if (!this.floorZones.length) {
      return true;
    }
    const scale = this.instance.scalingFactor;
    const offset = this.instance.modelOffset || { x: 0, z: 0 };
    const midX = ((wall.start_x + wall.end_x) / 2) * scale + offset.x;
    const midZ = ((wall.start_y + wall.end_y) / 2) * scale + offset.z;
    const nx = -(wall.end_y - wall.start_y);
    const nz = wall.end_x - wall.start_x;
    const len = Math.hypot(nx, nz) || 1;
    const off = TOUR.WALL_SAMPLE_OFFSET_MM * scale;
    const side1 = { x: midX + (nx / len) * off, y: midZ + (nz / len) * off };
    const side2 = { x: midX - (nx / len) * off, y: midZ - (nz / len) * off };
    const in1 = this.findFloorZoneAt(side1.x, side1.y, referenceY) != null;
    const in2 = this.findFloorZoneAt(side2.x, side2.y, referenceY) != null;
    return !(in1 && in2);
  }

  isFlying() {
    return this.keys.has('space') || this.keys.has('altleft');
  }

  getVerticalBounds() {
    let minY = this.defaultGroundY;
    let maxY = this.defaultGroundY + 30;
    if (this.floorZones.length) {
      minY = Math.min(this.defaultGroundY, ...this.floorZones.map((zone) => zone.floorY));
      maxY = Math.max(
        ...this.floorZones.map((zone) => zone.ceilingY ?? zone.floorY + 10)
      );
    }
    const margin = 500 * this.instance.scalingFactor;
    return { minY: minY - margin, maxY: maxY + margin };
  }

  clampVerticalPosition() {
    const { minY, maxY } = this.getVerticalBounds();
    this.player.y = clamp(this.player.y, minY, maxY);
  }

  findFloorZoneAt(x, z, referenceY = this.player.y) {
    const point = { x, y: z };
    let best = null;
    let bestDelta = Infinity;

    this.floorZones.forEach((zone) => {
      if (!isPointInPolygon(point, zone.polygon)) {
        return;
      }
      const delta = Math.abs(zone.floorY - referenceY);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = zone;
      }
    });

    return best;
  }

  isInsideAnyRoom(x, z) {
    return this.findFloorZoneAt(x, z) != null;
  }

  isEffectivelyInside(x, z) {
    if (this.isInsideAnyRoom(x, z)) {
      return true;
    }
    return isPointInDoorPassage(this.doorOpenings, x, z);
  }

  isBlockedByWall(x, z) {
    // Full wall pass-through in door corridor — never push the player sideways at the threshold.
    if (isPointInDoorPassage(this.doorOpenings, x, z)) {
      return false;
    }

    const insideRoom = this.isInsideAnyRoom(x, z);
    const playerZone = this.findFloorZoneAt(this.player.x, this.player.z, this.player.y);

    for (const wall of this.instance.walls || []) {
      if (this.isAlongDoorOpening(x, z, wall.id)) {
        continue;
      }

      if (shouldSkipCollinearWall(this.doorOpenings, this.instance, wall, x, z)) {
        continue;
      }

      if (this.isAboveWallTop(wall)) {
        continue;
      }

      if (!this.wallBlocksOnPlayerStorey(wall, playerZone)) {
        continue;
      }

      const geom = this.getWallGeometry(wall);
      const minDist = distPointToSegment2D(x, z, geom.ax, geom.az, geom.bx, geom.bz);
      const exterior = this.isExteriorWall(wall);

      if (insideRoom && exterior) {
        continue;
      }

      if (exterior) {
        if (minDist < geom.halfThickness + this.playerRadius * 0.25) {
          return true;
        }
        continue;
      }

      if (minDist < geom.halfThickness + this.playerRadius * 0.35) {
        return true;
      }
    }

    return false;
  }

  findSpawnPoint() {
    const bounds = this.instance.getModelBounds();
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const depth = bounds.maxZ - bounds.minZ;
    const margin = Math.max(40, depth * 0.28);

    let x = centerX;
    let z = bounds.maxZ + margin;
    let y = this.defaultGroundY;

    const doorSpawn = this.findDoorSpawnPoint();
    if (doorSpawn) {
      ({ x, y, z } = doorSpawn);
    }

    this.yaw = Math.atan2(centerX - x, centerZ - z);
    this.pitch = 0;

    return { x, y, z };
  }

  findDoorSpawnPoint() {
    const { instance } = this;
    const doors = instance.doors || [];
    if (!doors.length) {
      return null;
    }

    const bounds = instance.getModelBounds();
    const buildingCenterX = (bounds.minX + bounds.maxX) / 2;
    const buildingCenterZ = (bounds.minZ + bounds.maxZ) / 2;

    let best = null;
    let bestScore = Infinity;

    doors.forEach((door) => {
      const wall = (instance.walls || []).find((entry) => doorMatchesWall(door, entry.id));
      if (!wall) {
        return;
      }

      const opening = buildDoorOpeningZone(
        instance,
        wall,
        door,
        TOUR.DOOR_GAP_MARGIN_MM,
        this.playerRadius
      );
      const { centerX, centerZ, axisX, axisZ } = opening;
      const geom = getWallRunGeometry(instance, wall);
      const outsideOffset = geom.fullThickness + this.playerRadius * 2.5;

      const sample1 = {
        x: centerX + -axisZ * outsideOffset,
        z: centerZ + axisX * outsideOffset,
      };
      const sample2 = {
        x: centerX - -axisZ * outsideOffset,
        z: centerZ - axisX * outsideOffset,
      };
      const out1 = !this.isInsideAnyRoom(sample1.x, sample1.z);
      const out2 = !this.isInsideAnyRoom(sample2.x, sample2.z);
      const spawnX = out1 ? sample1.x : out2 ? sample2.x : centerX + -axisZ * outsideOffset;
      const spawnZ = out1 ? sample1.z : out2 ? sample2.z : centerZ + axisX * outsideOffset;
      const score = Math.hypot(spawnX - buildingCenterX, spawnZ - buildingCenterZ);

      if (score < bestScore && this.canStandAt(spawnX, spawnZ)) {
        bestScore = score;
        best = { x: spawnX, y: this.getFloorYAt(spawnX, spawnZ, this.defaultGroundY), z: spawnZ };
      }
    });

    return best;
  }

  computeDefaultGroundY() {
    if (!this.floorZones.length) {
      this.buildFloorZones();
    }
    if (!this.floorZones.length) {
      const groundY = this.instance.studioGround?.position.y ?? 0;
      return groundY + 0.05;
    }
    return Math.min(...this.floorZones.map((zone) => zone.floorY));
  }

  computePlayBounds() {
    const bounds = this.instance.getModelBounds();
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const margin = Math.max(
      TOUR.PLAY_MARGIN_MIN,
      Math.max(width, depth) * TOUR.PLAY_MARGIN_FACTOR
    );
    return {
      minX: bounds.minX - margin,
      maxX: bounds.maxX + margin,
      minZ: bounds.minZ - margin,
      maxZ: bounds.maxZ + margin,
    };
  }

  getFloorYAt(x, z, referenceY = this.player.y) {
    const point = { x, y: z };
    let bestFloorY = null;
    let bestDelta = Infinity;

    // Stacked storeys share the same XZ footprint — pick the floor nearest current height.
    this.floorZones.forEach((zone) => {
      if (!isPointInPolygon(point, zone.polygon)) {
        return;
      }
      const delta = Math.abs(zone.floorY - referenceY);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestFloorY = zone.floorY;
      }
    });

    if (bestFloorY != null) {
      return bestFloorY;
    }

    const inDoor = isPointInDoorPassage(this.doorOpenings, x, z);
    if (inDoor) {
      const doorOpening = this.findDoorOpeningAt(x, z);
      if (doorOpening?.roomId != null) {
        const linkedZone = this.floorZones.find(
          (zone) => String(zone.roomId) === String(doorOpening.roomId)
        );
        if (linkedZone) {
          return linkedZone.floorY;
        }
      }
    }

    return this.defaultGroundY;
  }

  canStandAt(x, z) {
    if (!this.playBounds) {
      return true;
    }
    const { minX, maxX, minZ, maxZ } = this.playBounds;
    if (x < minX || x > maxX || z < minZ || z > maxZ) {
      return false;
    }
    return !this.isBlockedByWall(x, z);
  }

  tryMoveAxis(dx, dz) {
    const scale = this.instance.scalingFactor;
    const substep = Math.max(TOUR.MOVE_SUBSTEP_MM * scale, this.playerRadius * 0.08);
    const dist = Math.hypot(dx, dz);

    if (dist < 1e-9) {
      return false;
    }

    const startX = this.player.x;
    const startZ = this.player.z;
    const steps = Math.max(1, Math.min(Math.ceil(dist / substep), 16));
    let lastGoodX = startX;
    let lastGoodZ = startZ;

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const nextX = startX + dx * t;
      const nextZ = startZ + dz * t;
      if (!this.canStandAt(nextX, nextZ)) {
        break;
      }
      lastGoodX = nextX;
      lastGoodZ = nextZ;
    }

    if (lastGoodX === startX && lastGoodZ === startZ) {
      return false;
    }

    this.player.x = lastGoodX;
    this.player.z = lastGoodZ;
    return true;
  }

  tryMove(dx, dz) {
    return this.tryMoveAxis(dx, dz);
  }

  getForwardVector() {
    return {
      x: Math.sin(this.yaw),
      z: Math.cos(this.yaw),
    };
  }

  getRightVector() {
    return {
      x: Math.cos(this.yaw),
      z: -Math.sin(this.yaw),
    };
  }

  updateCamera() {
    const { camera } = this.instance;
    const eyeY = this.player.y + this.eyeHeight;
    const cosPitch = Math.cos(this.pitch);

    camera.position.set(this.player.x, eyeY, this.player.z);
    camera.lookAt(
      this.player.x + Math.sin(this.yaw) * cosPitch,
      eyeY + Math.sin(this.pitch),
      this.player.z + Math.cos(this.yaw) * cosPitch
    );

    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }

  updateInteriorFeel() {
    const inDoor = isPointInDoorPassage(this.doorOpenings, this.player.x, this.player.z);
    const eyeReferenceY = this.player.y + this.eyeHeight * 0.35;
    const inside = this.findFloorZoneAt(this.player.x, this.player.z, eyeReferenceY) != null;
    // Only hide ceiling once clearly inside — not while still in the door corridor.
    const shouldFeelInside = inside && !inDoor;
    if (shouldFeelInside === this.insideBuilding) {
      return;
    }
    this.insideBuilding = shouldFeelInside;
    if (typeof this.instance.setCeilingsVisible === 'function') {
      this.instance.setCeilingsVisible(!shouldFeelInside);
    }
  }

  hudMessage(pointerLocked) {
    if (pointerLocked) {
      return '<strong>Tour</strong> — WASD move · Space up · Left Alt down · Shift sprint · Mouse look · Scroll zoom · Esc exit';
    }
    return '<strong>Tour</strong> — Click the model to capture mouse · Walk or fly between storeys · Esc exit';
  }

  placementHudMessage(hasSpawn, invalid = false) {
    if (invalid) {
      return '<strong>Choose start</strong> — That spot is blocked. Click another point on the floor.';
    }
    if (hasSpawn) {
      return [
        '<strong>Choose start</strong> — Starting point set.',
        '<button type="button" class="tour-start-btn" style="margin:0 6px;padding:4px 12px;border:none;border-radius:6px;background:#7c3aed;color:#fff;font-size:12px;font-weight:600;cursor:pointer;pointer-events:auto;">Start tour</button>',
        'Enter · click elsewhere to move · Esc cancel',
      ].join(' ');
    }
    return '<strong>Choose start</strong> — Click the floor to pick where your tour begins · Esc cancel';
  }

  updatePlacementHud(invalid = false) {
    if (!this.hud) {
      return;
    }
    this.hud.innerHTML = this.placementHudMessage(Boolean(this.pendingSpawn), invalid);
    const btn = this.hud.querySelector('.tour-start-btn');
    if (btn) {
      btn.addEventListener('click', this.handleHudStartClick);
    }
  }

  handleHudStartClick(event) {
    event.preventDefault();
    event.stopPropagation();
    this.confirmPlacement();
  }

  collectPlacementPickTargets() {
    const targets = [];
    this.instance.scene.traverse((child) => {
      if (!child.isMesh || !child.visible) {
        return;
      }
      if (child.userData?.isFloor || child.name?.toLowerCase().includes('floor')) {
        targets.push(child);
      }
    });
    if (this.instance.studioGround?.visible) {
      targets.push(this.instance.studioGround);
    }
    return targets;
  }

  createPlacementMarker() {
    const scale = this.instance.scalingFactor;
    const group = new THREE.Group();
    group.name = 'tour-placement-marker';

    const ringGeom = new THREE.RingGeometry(160 * scale, 260 * scale, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7c3aed,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 6 * scale;

    const pinGeom = new THREE.SphereGeometry(110 * scale, 16, 16);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xa78bfa });
    const pin = new THREE.Mesh(pinGeom, pinMat);
    pin.position.y = 130 * scale;

    const stemGeom = new THREE.CylinderGeometry(28 * scale, 28 * scale, 120 * scale, 10);
    const stem = new THREE.Mesh(stemGeom, pinMat);
    stem.position.y = 60 * scale;

    group.add(ring);
    group.add(stem);
    group.add(pin);
    group.visible = false;
    this.instance.scene.add(group);
    this.placementMarker = group;
  }

  updatePlacementMarker(x, y, z) {
    if (!this.placementMarker) {
      return;
    }
    this.placementMarker.position.set(x, y, z);
    this.placementMarker.visible = true;
  }

  removePlacementMarker() {
    if (!this.placementMarker) {
      return;
    }
    this.placementMarker.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (child.material) {
        child.material.dispose();
      }
    });
    this.instance.scene.remove(this.placementMarker);
    this.placementMarker = null;
  }

  handlePlacementClick(event) {
    if (!this.placementMode) {
      return;
    }

    const rect = this.instance.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.instance.raycaster.setFromCamera(mouse, this.instance.camera);
    const targets = this.collectPlacementPickTargets();
    if (!targets.length) {
      this.updatePlacementHud(true);
      return;
    }

    const hits = this.instance.raycaster.intersectObjects(targets, false);
    if (!hits.length) {
      this.updatePlacementHud(true);
      return;
    }

    const { point } = hits[0];
    const x = point.x;
    const z = point.z;
    const zone = this.findFloorZoneAt(x, z, point.y);
    const y = zone?.floorY ?? point.y;

    if (!this.canStandAt(x, z)) {
      this.updatePlacementHud(true);
      return;
    }

    this.pendingSpawn = { x, y, z };
    this.updatePlacementMarker(x, y, z);
    this.updatePlacementHud(false);
  }

  prepareTourEnvironment() {
    this.buildFloorZones();
    this.buildDoorOpenings();
    this.defaultGroundY = this.computeDefaultGroundY();
    this.playBounds = this.computePlayBounds();
  }

  beginWalkingFromPendingSpawn() {
    const spawn = this.pendingSpawn;
    if (!spawn) {
      return false;
    }

    this.removePlacementMarker();
    this.placementMode = false;
    this.pendingSpawn = null;
    document.body.style.cursor = 'default';

    this.player = { x: spawn.x, y: spawn.y, z: spawn.z };
    const lookDir = new THREE.Vector3();
    this.instance.camera.getWorldDirection(lookDir);
    this.yaw = Math.atan2(lookDir.x, lookDir.z);
    this.pitch = 0;
    this.fov = TOUR.FOV_DEFAULT;
    this.insideBuilding = false;
    this.lastFrameTime = performance.now();
    this.active = true;
    this.savedCameraFov = this.instance.camera.fov;

    if (this.instance.controls) {
      this.savedControlsEnabled = this.instance.controls.enabled;
      this.instance.controls.enabled = false;
      if (typeof this.instance.controls.disconnect === 'function') {
        this.instance.controls.disconnect();
      }
    }

    window.removeEventListener('keydown', this.handleKeyDown);
    this.attachWalkingListeners();
    if (this.hud) {
      this.hud.innerHTML = this.hudMessage(false);
    }
    this.updateInteriorFeel();
    this.updateCamera();
    return true;
  }

  confirmPlacement() {
    if (!this.placementMode || !this.pendingSpawn) {
      return false;
    }
    return this.beginWalkingFromPendingSpawn();
  }

  createHud() {
    const hud = document.createElement('div');
    hud.className = 'walk-tour-hud';
    hud.style.cssText = [
      'position:absolute',
      'left:50%',
      'bottom:16px',
      'transform:translateX(-50%)',
      'max-width:92%',
      'padding:10px 16px',
      'border-radius:10px',
      'background:rgba(15,23,42,0.82)',
      'color:#f8fafc',
      'font-size:13px',
      'line-height:1.45',
      'text-align:center',
      'pointer-events:none',
      'z-index:20',
      'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
    ].join(';');
    hud.innerHTML = this.placementHudMessage(false);
    this.instance.uiContainer.appendChild(hud);
    this.hud = hud;
  }

  removeHud() {
    if (this.hud?.parentNode) {
      this.hud.parentNode.removeChild(this.hud);
    }
    this.hud = null;
  }

  attachPlacementListeners() {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  attachWalkingListeners() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    this.instance.renderer.domElement.addEventListener('click', this.handleCanvasClick);
    this.instance.renderer.domElement.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  attachListeners() {
    this.attachWalkingListeners();
  }

  detachListeners() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.instance.renderer.domElement.removeEventListener('click', this.handleCanvasClick);
    this.instance.renderer.domElement.removeEventListener('wheel', this.handleWheel);
    if (document.pointerLockElement === this.instance.renderer.domElement) {
      document.exitPointerLock();
    }
    this.keys.clear();
    this.pointerLocked = false;
    document.body.style.cursor = 'default';
  }

  handleKeyDown(event) {
    if (!this.placementMode && !this.active) {
      return;
    }
    const key = event.key.toLowerCase();
    const code = event.code?.toLowerCase() ?? '';

    if (this.placementMode) {
      if (key === 'escape') {
        event.preventDefault();
        this.instance.setTourActive(false);
        return;
      }
      if (key === 'enter' && this.pendingSpawn) {
        event.preventDefault();
        this.confirmPlacement();
      }
      return;
    }

    if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      event.preventDefault();
      this.keys.add(key);
    }
    if (code === 'space') {
      event.preventDefault();
      this.keys.add('space');
    }
    if (code === 'altleft') {
      event.preventDefault();
      this.keys.add('altleft');
    }
    if (key === 'escape' && this.active) {
      this.instance.setTourActive(false);
    }
  }

  handleKeyUp(event) {
    const key = event.key.toLowerCase();
    const code = event.code?.toLowerCase() ?? '';
    this.keys.delete(key);
    if (code === 'space') {
      this.keys.delete('space');
    }
    if (code === 'altleft') {
      this.keys.delete('altleft');
    }
  }

  handleMouseMove(event) {
    if (!this.active || !this.pointerLocked) {
      return;
    }
    this.yaw -= event.movementX * TOUR.MOUSE_SENSITIVITY;
    this.pitch -= event.movementY * TOUR.MOUSE_SENSITIVITY;
    this.pitch = clamp(this.pitch, TOUR.MIN_PITCH, TOUR.MAX_PITCH);
  }

  handleWheel(event) {
    if (!this.active) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.fov = clamp(
      this.fov + event.deltaY * TOUR.ZOOM_WHEEL_STEP * 0.01,
      TOUR.FOV_MIN,
      TOUR.FOV_MAX
    );
  }

  requestPointerLockSafe() {
    if (!this.active || this.pointerLocked) {
      return;
    }
    if (performance.now() < this.pointerLockRetryAfter) {
      return;
    }

    const el = this.instance.renderer.domElement;
    if (!el?.requestPointerLock) {
      return;
    }

    const result = el.requestPointerLock();
    if (result && typeof result.then === 'function') {
      result.catch(() => {
        // Browser blocks immediate re-lock after Esc — wait briefly, then click again.
        this.pointerLockRetryAfter = performance.now() + 450;
      });
    }
  }

  handlePointerLockChange() {
    const locked = document.pointerLockElement === this.instance.renderer.domElement;
    if (!locked && this.pointerLocked) {
      this.pointerLockRetryAfter = performance.now() + 450;
    }
    this.pointerLocked = locked;
    document.body.style.cursor = this.pointerLocked ? 'none' : 'default';
    if (this.hud) {
      this.hud.innerHTML = this.hudMessage(this.pointerLocked);
    }
  }

  handleCanvasClick() {
    this.requestPointerLockSafe();
  }

  beginPlacement() {
    if (this.placementMode || this.active) {
      return false;
    }

    if (!this.instance.walls?.length) {
      return false;
    }

    const meshAligned = (this.instance.doors || []).length === 0
      || (this.instance.doors || []).every((door) => {
        const wall = (this.instance.walls || []).find((entry) => doorMatchesWall(door, entry.id));
        return wall?._tourRun && door.calculatedPosition?.cutoutStart != null;
      });
    if (!meshAligned && typeof this.instance.buildModel === 'function') {
      this.instance.buildModel();
    }

    (this.instance.doors || []).forEach((door) => {
      if (door.linked_wall && !door.wall) {
        door.wall = door.linked_wall;
      }
    });

    this.instance.animationManager?.killCameraAnimations?.();
    this.prepareTourEnvironment();

    this.placementMode = true;
    this.pendingSpawn = null;
    this.createPlacementMarker();
    this.createHud();
    this.attachPlacementListeners();
    document.body.style.cursor = 'crosshair';
    return true;
  }

  activate() {
    return this.beginPlacement();
  }

  deactivate() {
    if (!this.placementMode && !this.active) {
      return;
    }
    this.placementMode = false;
    this.active = false;
    this.pendingSpawn = null;
    this.detachListeners();
    this.removePlacementMarker();
    this.removeHud();
    document.body.style.cursor = 'default';

    if (typeof this.instance.setCeilingsVisible === 'function') {
      this.instance.setCeilingsVisible(true);
    }

    this.instance.camera.fov = this.savedCameraFov;
    this.instance.camera.updateProjectionMatrix();

    if (this.instance.controls) {
      if (typeof this.instance.controls.connect === 'function') {
        this.instance.controls.connect(this.instance.renderer.domElement);
      }
      this.instance.controls.enabled = this.savedControlsEnabled;
      this.instance.controls.update();
    }
  }

  update() {
    if (!this.active) {
      return;
    }

    this.instance.animationManager?.killCameraAnimations?.();

    const now = performance.now();
    const delta = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    const forward = this.getForwardVector();
    const right = this.getRightVector();
    let moveX = 0;
    let moveZ = 0;

    if (this.keys.has('w') || this.keys.has('arrowup')) {
      moveX += forward.x;
      moveZ += forward.z;
    }
    if (this.keys.has('s') || this.keys.has('arrowdown')) {
      moveX -= forward.x;
      moveZ -= forward.z;
    }
    if (this.keys.has('a') || this.keys.has('arrowleft')) {
      moveX += right.x;
      moveZ += right.z;
    }
    if (this.keys.has('d') || this.keys.has('arrowright')) {
      moveX -= right.x;
      moveZ -= right.z;
    }

    const len = Math.hypot(moveX, moveZ);
    if (len > 0) {
      const sprint = this.keys.has('shift') ? TOUR.SPRINT_MULTIPLIER : 1;
      const speed = TOUR.WALK_SPEED * sprint * delta;
      this.tryMove((moveX / len) * speed, (moveZ / len) * speed);
    }

    const flying = this.isFlying();
    if (flying) {
      const sprint = this.keys.has('shift') ? TOUR.SPRINT_MULTIPLIER : 1;
      const flySpeed = TOUR.FLY_SPEED * sprint * delta;
      if (this.keys.has('space')) {
        this.player.y += flySpeed;
      }
      if (this.keys.has('altleft')) {
        this.player.y -= flySpeed;
      }
      this.clampVerticalPosition();
    }
    this.updateInteriorFeel();
    this.updateCamera();
  }

  dispose() {
    this.deactivate();
  }
}
