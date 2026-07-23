/**
 * Shelf-pack rectangular rooms into a site (width × length), origin top-left, Y down (mm).
 * Adjacent rooms share edges so wall creation can reuse segments.
 */

function rectPoints(x, y, w, l) {
  return [
    { x: Math.round(x), y: Math.round(y) },
    { x: Math.round(x + w), y: Math.round(y) },
    { x: Math.round(x + w), y: Math.round(y + l) },
    { x: Math.round(x), y: Math.round(y + l) },
  ];
}

/** Single room filling the entire project site at origin. */
export function isFullSiteSingleRoom(draft, placed) {
  if (!Array.isArray(placed) || placed.length !== 1) return false;
  const room = placed[0];
  const siteW = Math.round(Number(draft.width));
  const siteL = Math.round(Number(draft.length));
  return (
    Math.round(room.x) === 0
    && Math.round(room.y) === 0
    && Math.round(room.placedWidth) === siteW
    && Math.round(room.placedLength) === siteL
  );
}

/**
 * @param {Array<{ name: string, width: number, length: number }>} rooms
 * @param {number} siteWidth
 * @param {number} siteLength
 * @returns {{ placed: Array, overflow: boolean, usedWidth: number, usedLength: number, message?: string }}
 */
export function arrangeRooms(rooms, siteWidth, siteLength) {
  const siteW = Number(siteWidth);
  const siteL = Number(siteLength);

  if (!Array.isArray(rooms) || rooms.length === 0) {
    return { placed: [], overflow: false, usedWidth: 0, usedLength: 0 };
  }

  if (!siteW || !siteL || siteW <= 0 || siteL <= 0) {
    return {
      placed: [],
      overflow: true,
      usedWidth: 0,
      usedLength: 0,
      message: 'Site size is missing or invalid.',
    };
  }

  // Sort larger-first for tighter packing, keep original index for stable naming
  const indexed = rooms.map((room, index) => ({
    ...room,
    width: Number(room.width),
    length: Number(room.length),
    index,
  }));

  for (const room of indexed) {
    if (!(room.width > 0) || !(room.length > 0)) {
      return {
        placed: [],
        overflow: true,
        usedWidth: 0,
        usedLength: 0,
        message: `Room "${room.name || room.index + 1}" has invalid size.`,
      };
    }
    // Allow rotating a room 90° if it fits better later
  }

  const sorted = [...indexed].sort((a, b) => (b.width * b.length) - (a.width * a.length));

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let maxX = 0;
  let maxY = 0;
  const placed = [];

  const tryPlace = (room, rotate) => {
    const w = rotate ? room.length : room.width;
    const l = rotate ? room.width : room.length;
    return { w, l };
  };

  for (const room of sorted) {
    let orientation = tryPlace(room, false);
    let rotated = false;

    // If it doesn't fit on current row, try rotate, then wrap
    const fitsCurrentRow = (o) => cursorX + o.w <= siteW + 0.5 && cursorY + o.l <= siteL + 0.5;
    const fitsNewRow = (o) => o.w <= siteW + 0.5 && cursorY + rowHeight + o.l <= siteL + 0.5;

    if (!fitsCurrentRow(orientation)) {
      const rotatedOri = tryPlace(room, true);
      if (fitsCurrentRow(rotatedOri)) {
        orientation = rotatedOri;
        rotated = true;
      } else if (cursorX > 0) {
        // wrap to next row
        cursorX = 0;
        cursorY += rowHeight;
        rowHeight = 0;
        if (!fitsCurrentRow(orientation)) {
          if (fitsCurrentRow(rotatedOri)) {
            orientation = rotatedOri;
            rotated = true;
          }
        }
      }
    }

    if (!fitsCurrentRow(orientation)) {
      const rotatedOri = tryPlace(room, true);
      if (fitsNewRow(rotatedOri) || fitsCurrentRow(rotatedOri)) {
        orientation = rotatedOri;
        rotated = true;
      }
    }

    if (cursorX + orientation.w > siteW + 0.5 || cursorY + orientation.l > siteL + 0.5) {
      return {
        placed: [],
        overflow: true,
        usedWidth: maxX,
        usedLength: maxY,
        message:
          `Cannot fit all rooms inside the project site (${siteW} × ${siteL} mm). ` +
          `Increase the project size or reduce room sizes.`,
      };
    }

    const x = cursorX;
    const y = cursorY;
    const { w, l } = orientation;

    placed.push({
      ...room,
      x,
      y,
      placedWidth: w,
      placedLength: l,
      rotated,
      room_points: rectPoints(x, y, w, l),
    });

    cursorX += w;
    rowHeight = Math.max(rowHeight, l);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + l);
  }

  // Restore original order
  placed.sort((a, b) => a.index - b.index);

  return {
    placed,
    overflow: false,
    usedWidth: maxX,
    usedLength: maxY,
  };
}

/** Build unique wall segments from placed room polygons (shared edges merged). */
export function collectUniqueWallSegments(placedRooms) {
  const keyOf = (a, b) => {
    const p1 = `${Math.round(a.x)},${Math.round(a.y)}`;
    const p2 = `${Math.round(b.x)},${Math.round(b.y)}`;
    return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
  };

  const segments = new Map();
  placedRooms.forEach((room) => {
    const pts = room.room_points;
    for (let i = 0; i < pts.length; i += 1) {
      const start = pts[i];
      const end = pts[(i + 1) % pts.length];
      const key = keyOf(start, end);
      if (!segments.has(key)) {
        segments.set(key, { start, end, key });
      }
    }
  });
  return Array.from(segments.values());
}

export function segmentKey(start, end, tolerance = 1) {
  const round = (v) => Math.round(v / tolerance) * tolerance;
  const a = `${round(start.x)},${round(start.y)}`;
  const b = `${round(end.x)},${round(end.y)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
