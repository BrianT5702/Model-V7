/**
 * Tour walk collision — door passages in wall-local space (matches mesh cutouts).
 */

function snap(val, precision = 0.01) {
  return Math.round(val / precision) * precision;
}

export function getDoorWallId(door) {
  if (door?.calculatedPosition?.wallId != null) {
    return door.calculatedPosition.wallId;
  }
  return door?.wall ?? door?.linked_wall ?? door?.wall_id ?? null;
}

export function collectDoorWallIds(door, primaryWallId) {
  const ids = new Set();
  [primaryWallId, door?.wall, door?.linked_wall, door?.wall_id, door?.calculatedPosition?.wallId]
    .filter((id) => id != null)
    .forEach((id) => ids.add(String(id)));
  return [...ids];
}

export function doorMatchesWall(door, wallId) {
  const target = String(wallId);
  return [door?.wall, door?.linked_wall, door?.wall_id, door?.calculatedPosition?.wallId]
    .filter((id) => id != null)
    .some((id) => String(id) === target);
}

export function openingMatchesWall(opening, wallId) {
  if (!opening) {
    return false;
  }
  if (opening.wallIds?.length) {
    return opening.wallIds.some((id) => String(id) === String(wallId));
  }
  return String(opening.wallId) === String(wallId);
}

export function getWallRunGeometry(instance, wall) {
  if (wall._tourRun) {
    return {
      ...wall._tourRun,
      wasFlipped: false,
    };
  }

  const scale = instance.scalingFactor;
  const offset = instance.modelOffset || { x: 0, z: 0 };
  const modelCenter = instance.calculateModelCenter?.() || { x: 0, z: 0 };

  const startX = snap(wall.start_x * scale);
  const startZ = snap(wall.start_y * scale);
  const endX = snap(wall.end_x * scale);
  const endZ = snap(wall.end_y * scale);

  const isHorizontal = Math.abs(wall.start_y - wall.end_y) < 1e-6;
  const isVertical = Math.abs(wall.start_x - wall.end_x) < 1e-6;

  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;

  if (isHorizontal) {
    if (modelCenter.z < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    if (modelCenter.x > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }

  const wasFlipped =
    Math.abs(finalStartX - startX) > 1e-6 || Math.abs(finalStartZ - startZ) > 1e-6;
  const runLength = Math.hypot(finalEndX - finalStartX, finalEndZ - finalStartZ) || 1e-6;

  return {
    ax: finalStartX + offset.x,
    az: finalStartZ + offset.z,
    bx: finalEndX + offset.x,
    bz: finalEndZ + offset.z,
    wasFlipped,
    runLength,
    halfThickness: ((wall.thickness || 200) * scale) * 0.5,
    fullThickness: (wall.thickness || 200) * scale,
  };
}

export function getDoorCutoutWidth(door, scale) {
  const isSlideDoor = door.door_type === 'slide';
  const isDockDoor = door.door_type === 'dock';
  const isDoubleSidedSlide = isSlideDoor && door.configuration === 'double_sided';
  const doorWidth = Number(door.width) * scale;
  if (!Number.isFinite(doorWidth) || doorWidth <= 0) {
    return 900 * scale * 1.05;
  }
  return doorWidth * (
    isDoubleSidedSlide ? 1.0 : isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05
  );
}

function runAxisFromEndpoints(runStartX, runStartZ, runEndX, runEndZ) {
  const dx = runEndX - runStartX;
  const dz = runEndZ - runStartZ;
  const len = Math.hypot(dx, dz) || 1;
  return {
    axisX: dx / len,
    axisZ: dz / len,
    runLength: len,
    wallAngle: Math.atan2(dz, dx),
  };
}

function cutoutCenterOnRun(opening) {
  const midDist = (opening.cutoutStart + opening.cutoutEnd) / 2;
  const t = midDist / (opening.runLength || 1);
  return {
    x: opening.runStartX + (opening.runEndX - opening.runStartX) * t,
    z: opening.runStartZ + (opening.runEndZ - opening.runStartZ) * t,
  };
}

/** Inverse of wall mesh rotation (rotation.y = -wallAngle). */
export function worldToWallLocalXZ(opening, x, z) {
  const relX = x - opening.runStartX;
  const relZ = z - opening.runStartZ;
  const angle = opening.wallAngle;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    localX: relX * c + relZ * s,
    localZ: -relX * s + relZ * c,
  };
}

export function isPointInDoorVolume(opening, x, z, options = {}) {
  const { localX, localZ } = worldToWallLocalXZ(opening, x, z);
  const collisionBoost = options.collision ? 1.3 : 1;
  let alongMargin = (
    options.interior ? opening.interiorSideMargin : opening.sideMargin
  ) * collisionBoost;
  let perpMargin = (
    options.interior ? opening.interiorPerpMargin : opening.perpMargin
  ) * collisionBoost;
  if (options.collision && options.playerRadius) {
    alongMargin += options.playerRadius * 0.42;
    perpMargin += options.playerRadius * 0.42;
  }
  return (
    localX >= opening.cutoutStart - alongMargin
    && localX <= opening.cutoutEnd + alongMargin
    && localZ >= -perpMargin
    && localZ <= opening.wallThickness + perpMargin
  );
}

export function isPointNearDoorCutout(openings, x, z, wallId = null, playerRadius = 0) {
  if (!openings?.length) {
    return false;
  }
  return openings.some((opening) => {
    if (wallId != null && !openingMatchesWall(opening, wallId)) {
      return false;
    }
    return isPointInDoorVolume(opening, x, z, {
      interior: true,
      collision: true,
      playerRadius,
    });
  });
}

/** Door approach + passage — disables wall collision while entering or crossing a doorway. */
export function isInDoorMovementZone(openings, x, z, playerRadius = 0) {
  if (!openings?.length) {
    return false;
  }
  return isPointInDoorPassage(openings, x, z)
    || isPointNearDoorCutout(openings, x, z, null, playerRadius);
}

export function buildDoorOpeningZone(instance, wall, door, gapMarginMm, playerRadius) {
  const scale = instance.scalingFactor;
  const geom = getWallRunGeometry(instance, wall);
  const margin = gapMarginMm * scale;
  const calc = door.calculatedPosition;
  const nominalWidth = getDoorCutoutWidth(door, scale);
  const sideMargin = playerRadius * 0.28 + margin * 0.06;
  const perpMargin = playerRadius * 0.3 + margin * 0.1;
  const interiorSideMargin = sideMargin;
  const interiorPerpMargin = perpMargin;

  if (
    calc
    && Number.isFinite(calc.cutoutStart)
    && Number.isFinite(calc.cutoutEnd)
    && Number.isFinite(calc.runStartX)
    && Number.isFinite(calc.runEndX)
    && Number.isFinite(calc.runLength)
  ) {
    const { axisX, axisZ, runLength, wallAngle } = runAxisFromEndpoints(
      calc.runStartX,
      calc.runStartZ,
      calc.runEndX,
      calc.runEndZ
    );
    const opening = {
      wallId: String(calc.wallId ?? wall.id),
      wallIds: collectDoorWallIds(door, calc.wallId ?? wall.id),
      roomId: door.room ?? null,
      runStartX: calc.runStartX,
      runStartZ: calc.runStartZ,
      runEndX: calc.runEndX,
      runEndZ: calc.runEndZ,
      runLength: calc.runLength || runLength,
      cutoutStart: calc.cutoutStart,
      cutoutEnd: calc.cutoutEnd,
      axisX,
      axisZ,
      wallAngle: Number.isFinite(calc.angle) ? calc.angle : wallAngle,
      wallThickness: Number.isFinite(calc.depth) ? calc.depth : geom.fullThickness,
      sideMargin,
      perpMargin,
      interiorSideMargin,
      interiorPerpMargin,
    };
    const center = cutoutCenterOnRun(opening);
    opening.centerX = center.x;
    opening.centerZ = center.z;
    return opening;
  }

  const rawPos = Number(door.position_x);
  const positionX = Number.isFinite(rawPos) ? rawPos : 0.5;
  const adjustedPositionX = geom.wasFlipped ? 1 - positionX : positionX;
  const wallLen = geom.runLength || Math.hypot(geom.bx - geom.ax, geom.bz - geom.az) || 1;
  const doorPos = adjustedPositionX * wallLen;
  const cutoutStart = Math.max(0, doorPos - nominalWidth / 2);
  const cutoutEnd = Math.min(wallLen, doorPos + nominalWidth / 2);
  const { axisX, axisZ, wallAngle } = runAxisFromEndpoints(geom.ax, geom.az, geom.bx, geom.bz);
  const opening = {
    wallId: String(wall.id),
    wallIds: collectDoorWallIds(door, wall.id),
    roomId: door.room ?? null,
    runStartX: geom.ax,
    runStartZ: geom.az,
    runEndX: geom.bx,
    runEndZ: geom.bz,
    runLength: wallLen,
    cutoutStart,
    cutoutEnd,
    axisX,
    axisZ,
    wallAngle,
    wallThickness: geom.fullThickness,
    sideMargin,
    perpMargin,
    interiorSideMargin,
    interiorPerpMargin,
  };
  const center = cutoutCenterOnRun(opening);
  opening.centerX = center.x;
  opening.centerZ = center.z;
  return opening;
}

export function isPointInDoorCutout(opening, x, z, options = {}) {
  return isPointInDoorVolume(opening, x, z, options);
}

export function isPointInAnyDoorCutout(openings, x, z, wallId = null, options = {}) {
  if (!openings?.length) {
    return false;
  }
  return openings.some((opening) => {
    if (wallId != null && !openingMatchesWall(opening, wallId)) {
      return false;
    }
    return isPointInDoorVolume(opening, x, z, options);
  });
}

/** World-space corridor aligned to door center and wall axis (stable across room boundary). */
export function isPointInDoorPassage(openings, x, z) {
  if (!openings?.length) {
    return false;
  }
  return openings.some((opening) => {
    const relX = x - opening.centerX;
    const relZ = z - opening.centerZ;
    const along = relX * opening.axisX + relZ * opening.axisZ;
    const perp = -relX * opening.axisZ + relZ * opening.axisX;
    const cutoutWidth = opening.cutoutEnd - opening.cutoutStart;
    const alongHalf = cutoutWidth / 2 + opening.sideMargin * 0.68;
    const perpHalf = opening.wallThickness / 2 + opening.perpMargin * 0.68;
    return Math.abs(along) <= alongHalf && Math.abs(perp) <= perpHalf;
  });
}

export function distPointToSegment2D(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) {
    return Math.hypot(px - ax, pz - az);
  }
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

export function shouldSkipCollinearWall(openings, instance, wall, x, z) {
  if (!openings?.length) {
    return false;
  }
  const nearDoor = isInDoorMovementZone(openings, x, z)
    || isPointInDoorPassage(openings, x, z);
  if (!nearDoor) {
    return false;
  }

  const geom = getWallRunGeometry(instance, wall);
  const wallDx = geom.bx - geom.ax;
  const wallDz = geom.bz - geom.az;
  const wallLen = Math.hypot(wallDx, wallDz) || 1;
  const wallAxisX = wallDx / wallLen;
  const wallAxisZ = wallDz / wallLen;

  return openings.some((opening) => {
    const dot = Math.abs(opening.axisX * wallAxisX + opening.axisZ * wallAxisZ);
    if (dot < 0.92) {
      return false;
    }
    const dist = distPointToSegment2D(x, z, geom.ax, geom.az, geom.bx, geom.bz);
    return dist < opening.wallThickness / 2 + opening.perpMargin * 0.68;
  });
}

export function buildAllDoorOpenings(instance, gapMarginMm, playerRadius) {
  const openings = [];
  (instance.doors || []).forEach((door) => {
    const wallId = getDoorWallId(door);
    if (wallId == null) {
      return;
    }
    const wall = (instance.walls || []).find((entry) => doorMatchesWall(door, entry.id));
    if (!wall) {
      return;
    }
    openings.push(buildDoorOpeningZone(instance, wall, door, gapMarginMm, playerRadius));
  });
  return openings;
}
