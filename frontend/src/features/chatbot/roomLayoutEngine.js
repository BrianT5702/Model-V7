/**
 * Pack rectangular rooms into a site (width × length), origin top-left, Y down (mm).
 * Tries shelf packing and MaxRects so adjacent rooms share edges (no stretching).
 */

const EPS = 0.5;

function rectPoints(x, y, w, l) {
  return [
    { x: Math.round(x), y: Math.round(y) },
    { x: Math.round(x + w), y: Math.round(y) },
    { x: Math.round(x + w), y: Math.round(y + l) },
    { x: Math.round(x), y: Math.round(y + l) },
  ];
}

function overlap1d(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function sharedEdgeLength(placed) {
  let total = 0;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      const aRight = a.x + a.placedWidth;
      const aBottom = a.y + a.placedLength;
      const bRight = b.x + b.placedWidth;
      const bBottom = b.y + b.placedLength;

      if (Math.abs(aRight - b.x) <= EPS || Math.abs(bRight - a.x) <= EPS) {
        total += overlap1d(a.y, aBottom, b.y, bBottom);
      }
      if (Math.abs(aBottom - b.y) <= EPS || Math.abs(bBottom - a.y) <= EPS) {
        total += overlap1d(a.x, aRight, b.x, bRight);
      }
    }
  }
  return total;
}

function scoreLayout(layout, siteW, siteL) {
  if (!layout || layout.overflow) return Number.NEGATIVE_INFINITY;
  const shared = sharedEdgeLength(layout.placed);
  const box = (layout.usedWidth || 0) * (layout.usedLength || 0);
  const leftover = siteW * siteL - box;
  const originBonus = layout.placed.every((r) => r.x === 0 || r.y === 0) ? 1 : 0;
  return shared * 10 - leftover * 0.0001 + originBonus;
}

function toResult(placed, overflow, message, maxX, maxY) {
  const ordered = [...placed].sort((a, b) => a.index - b.index);
  return {
    placed: ordered,
    overflow: Boolean(overflow),
    usedWidth: maxX || 0,
    usedLength: maxY || 0,
    message,
  };
}

function fail(message) {
  return toResult([], true, message, 0, 0);
}

function finalizePlaced(raw) {
  let maxX = 0;
  let maxY = 0;
  const placed = raw.map((room) => {
    maxX = Math.max(maxX, room.x + room.placedWidth);
    maxY = Math.max(maxY, room.y + room.placedLength);
    return {
      ...room,
      room_points: rectPoints(room.x, room.y, room.placedWidth, room.placedLength),
    };
  });
  return toResult(placed, false, undefined, maxX, maxY);
}

function orientationsOf(room) {
  const opts = [{ w: room.width, l: room.length, rotated: false }];
  if (Math.abs(room.width - room.length) > EPS) {
    opts.push({ w: room.length, l: room.width, rotated: true });
  }
  return opts;
}

function packShelf(rooms, siteW, siteL, largestFirst) {
  const ordered = largestFirst
    ? [...rooms].sort((a, b) => (b.width * b.length) - (a.width * a.length))
    : [...rooms];

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const placed = [];

  const fitsAt = (x, y, w, l) => x + w <= siteW + EPS && y + l <= siteL + EPS;

  for (const room of ordered) {
    const opts = orientationsOf(room);
    let chosen = null;

    for (const o of opts) {
      if (fitsAt(cursorX, cursorY, o.w, o.l)) {
        chosen = { ...o, x: cursorX, y: cursorY };
        break;
      }
    }

    if (!chosen && cursorX > 0) {
      const nextX = 0;
      const nextY = cursorY + rowHeight;
      for (const o of opts) {
        if (fitsAt(nextX, nextY, o.w, o.l)) {
          chosen = { ...o, x: nextX, y: nextY };
          break;
        }
      }
    }

    if (!chosen) return fail(
      `Cannot fit all rooms inside the project site (${siteW} × ${siteL} mm). ` +
        `Increase the project size or reduce room sizes.`
    );

    if (chosen.x === 0 && chosen.y !== cursorY) {
      cursorX = 0;
      cursorY = chosen.y;
      rowHeight = 0;
    }

    placed.push({
      ...room,
      x: chosen.x,
      y: chosen.y,
      placedWidth: chosen.w,
      placedLength: chosen.l,
      rotated: chosen.rotated,
    });

    cursorX = chosen.x + chosen.w;
    rowHeight = Math.max(rowHeight, chosen.l);
  }

  return finalizePlaced(placed);
}

function pruneFreeRects(rects) {
  const kept = [];
  for (let i = 0; i < rects.length; i += 1) {
    const a = rects[i];
    if (a.w <= EPS || a.l <= EPS) continue;
    const contained = rects.some((b, j) => (
      j !== i
      && a.x >= b.x - EPS
      && a.y >= b.y - EPS
      && a.x + a.w <= b.x + b.w + EPS
      && a.y + a.l <= b.y + b.l + EPS
      && (a.w * a.l < b.w * b.l - EPS)
    ));
    if (!contained) kept.push(a);
  }
  return kept;
}

function splitFreeRect(fr, x, y, w, l) {
  const result = [];
  // leftover to the right of the placed box, within this free rect
  const rightW = (fr.x + fr.w) - (x + w);
  if (rightW > EPS) {
    result.push({ x: x + w, y: fr.y, w: rightW, l: fr.l });
  }
  // leftover below the placed box
  const belowL = (fr.y + fr.l) - (y + l);
  if (belowL > EPS) {
    result.push({ x: fr.x, y: y + l, w: fr.w, l: belowL });
  }
  // leftover to the left (if placed inset)
  const leftW = x - fr.x;
  if (leftW > EPS) {
    result.push({ x: fr.x, y: fr.y, w: leftW, l: fr.l });
  }
  // leftover above
  const aboveL = y - fr.y;
  if (aboveL > EPS) {
    result.push({ x: fr.x, y: fr.y, w: fr.w, l: aboveL });
  }
  return result.filter((r) => r.w > EPS && r.l > EPS);
}

function packMaxRects(rooms, siteW, siteL, largestFirst) {
  const ordered = largestFirst
    ? [...rooms].sort((a, b) => (b.width * b.length) - (a.width * a.length))
    : [...rooms];

  let free = [{ x: 0, y: 0, w: siteW, l: siteL }];
  const placed = [];

  for (const room of ordered) {
    let best = null;

    for (const fr of free) {
      for (const o of orientationsOf(room)) {
        if (o.w > fr.w + EPS || o.l > fr.l + EPS) continue;
        const leftover = (fr.w - o.w) * fr.l + fr.w * (fr.l - o.l);
        if (
          !best
          || fr.y < best.y - EPS
          || (Math.abs(fr.y - best.y) <= EPS && fr.x < best.x - EPS)
          || (Math.abs(fr.y - best.y) <= EPS && Math.abs(fr.x - best.x) <= EPS && leftover < best.leftover)
        ) {
          best = {
            x: fr.x,
            y: fr.y,
            w: o.w,
            l: o.l,
            rotated: o.rotated,
            leftover,
          };
        }
      }
    }

    if (!best) {
      return fail(
        `Cannot fit all rooms inside the project site (${siteW} × ${siteL} mm). ` +
          `Increase the project size or reduce room sizes.`
      );
    }

    placed.push({
      ...room,
      x: best.x,
      y: best.y,
      placedWidth: best.w,
      placedLength: best.l,
      rotated: best.rotated,
    });

    const nextFree = [];
    free.forEach((fr) => {
      const overlaps = !(
        best.x + best.w <= fr.x + EPS
        || fr.x + fr.w <= best.x + EPS
        || best.y + best.l <= fr.y + EPS
        || fr.y + fr.l <= best.y + EPS
      );
      if (!overlaps) {
        nextFree.push(fr);
        return;
      }
      nextFree.push(...splitFreeRect(fr, best.x, best.y, best.w, best.l));
    });
    free = pruneFreeRects(nextFree);
  }

  return finalizePlaced(placed);
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
    return fail('Site size is missing or invalid.');
  }

  const indexed = rooms.map((room, index) => ({
    ...room,
    width: Number(room.width),
    length: Number(room.length),
    index,
  }));

  for (const room of indexed) {
    if (!(room.width > 0) || !(room.length > 0)) {
      return fail(`Room "${room.name || room.index + 1}" has invalid size.`);
    }
  }

  const candidates = [
    packShelf(indexed, siteW, siteL, true),
    packShelf(indexed, siteW, siteL, false),
    packMaxRects(indexed, siteW, siteL, true),
    packMaxRects(indexed, siteW, siteL, false),
  ];

  let best = candidates[0];
  let bestScore = scoreLayout(best, siteW, siteL);
  candidates.slice(1).forEach((layout) => {
    const score = scoreLayout(layout, siteW, siteL);
    if (score > bestScore) {
      best = layout;
      bestScore = score;
    }
  });

  return best;
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
