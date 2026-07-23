/** Parse natural-language replies for the project chatbot. Units default to mm; accept m. */

const FLOOR_TYPES = ['Slab', 'Panel', 'None'];
const FACE_MATERIALS = ['PPGI', 'S/Steel', 'PVC'];
const FLOOR_THICKNESSES = [0, 50, 75, 100, 125, 150, 175, 200];

export function toMm(value, unitHint) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (unitHint || '').toLowerCase();
  if (unit === 'm' || unit === 'meter' || unit === 'meters' || unit === 'metre' || unit === 'metres') {
    return Math.round(n * 1000);
  }
  if (unit === 'cm' || unit === 'centimeter' || unit === 'centimeters') {
    return Math.round(n * 10);
  }
  // Heuristic: small numbers without unit are likely meters
  if (!unit && n > 0 && n < 200) {
    return Math.round(n * 1000);
  }
  return Math.round(n);
}

export function parseDimensionPair(text) {
  if (!text) return null;
  const normalized = String(text).trim();

  const pairRe = /(\d+(?:\.\d+)?)\s*(m|meters?|metres?|cm|mm)?\s*[x×*by]+\s*(\d+(?:\.\d+)?)\s*(m|meters?|metres?|cm|mm)?/i;
  const match = normalized.match(pairRe);
  if (match) {
    const unit = match[2] || match[4] || '';
    const width = toMm(match[1], unit || match[2]);
    const length = toMm(match[3], unit || match[4]);
    if (width && length) return { width, length };
  }

  const tripleRe = /(\d+(?:\.\d+)?)\s*(m|mm|cm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i;
  const triple = normalized.match(tripleRe);
  if (triple) {
    const u1 = triple[2] || triple[4] || triple[6] || '';
    const width = toMm(triple[1], u1 || triple[2]);
    const length = toMm(triple[3], u1 || triple[4]);
    const height = toMm(triple[5], u1 || triple[6]);
    if (width && length && height) return { width, length, height };
  }

  return null;
}

export function parseSingleDimension(text) {
  if (!text) return null;
  const match = String(text).trim().match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|cm|mm)?$/i);
  if (!match) return null;
  return toMm(match[1], match[2] || '');
}

export function parseProjectSize(text) {
  const dims = parseDimensionPair(text);
  if (!dims) return null;

  const heightMatch = String(text).match(
    /(?:height|ht|h)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i
  );
  if (heightMatch) {
    dims.height = toMm(heightMatch[1], heightMatch[2] || '');
  } else if (!dims.height) {
    const numbers = String(text).match(/(\d+(?:\.\d+)?)\s*(m|mm|cm)?/gi);
    if (numbers && numbers.length >= 3) {
      const third = numbers[2].match(/(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i);
      if (third) dims.height = toMm(third[1], third[2] || '');
    }
  }
  return dims;
}

export function parseYesNo(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/^(y|yes|yeah|yep|true|ok|okay|sure|include|with)\b/.test(t)) return true;
  if (/^(n|no|nope|false|skip|none|without|exclude)\b/.test(t)) return false;
  return null;
}

export function parseFloorType(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (t.includes('slab') || t === 'concrete') return 'Slab';
  if (t.includes('panel')) return 'Panel';
  if (t.includes('none') || t === 'no' || t === 'n/a' || t === 'na') return 'None';
  const idx = FLOOR_TYPES.findIndex((f) => f.toLowerCase() === t);
  return idx >= 0 ? FLOOR_TYPES[idx] : null;
}

export function parseFloorThickness(text) {
  return parseThicknessMm(text);
}

/** Thickness values (floor/wall) default to mm. Bare "50" → 50 mm, not 50 m. */
export function parseThicknessMm(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;

  const match = t.match(/^(\d+(?:\.\d+)?)\s*(mm|m|cm)?$/i);
  if (!match) {
    const raw = Number(t.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw);
  }

  const value = Number(match[1]);
  const unit = (match[2] || 'mm').toLowerCase();
  if (!Number.isFinite(value) || value < 0) return null;

  if (unit === 'm') return Math.round(value * 1000);
  if (unit === 'cm') return Math.round(value * 10);
  return Math.round(value);
}

export function parseFaceMaterial(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (t.includes('steel') || t === 'ss' || t.includes('s/steel')) return 'S/Steel';
  if (t.includes('pvc')) return 'PVC';
  if (t.includes('ppgi') || t === 'default') return 'PPGI';
  return FACE_MATERIALS.find((m) => m.toLowerCase() === t) || null;
}

export function parseRoomCount(text) {
  const t = String(text || '').trim().toLowerCase();
  if (/^(none|no|0|zero)$/.test(t)) return 0;
  const match = t.match(/(\d+)\s*rooms?/);
  if (match) return Number(match[1]);
  const onlyNum = t.match(/^(\d+)$/);
  if (onlyNum) return Number(onlyNum[1]);
  return null;
}

function parseNameList(listText) {
  return String(listText || '')
    .split(/,| and | & |\n|;/i)
    .map((p) => p.replace(/^\d+[\).\-\s]+/, '').trim())
    .filter((p) => p && !/^\d+$/.test(p) && !/^rooms?$/i.test(p) && p.length < 80)
    .slice(0, 20);
}

export function extractRoomNames(text) {
  const t = String(text || '').trim();
  if (!t) return [];

  // Count-only phrases: "2 rooms", "yes, 2 rooms" — not name lists
  if (/^(yes,?\s*)?\d+\s*rooms?\s*$/i.test(t)) return [];

  // Explicit list after "rooms:" or "rooms -" (word boundary avoids "2 rooms")
  const afterRooms = t.match(/\brooms\s*[:=-]\s*(.+)$/i);
  if (afterRooms) {
    return parseNameList(afterRooms[1]);
  }

  // "with rooms: A, B" / "rooms Freezer, Chiller"
  const withRooms = t.match(/\bwith\s+rooms?\s*[:=-]?\s*(.+)$/i);
  if (withRooms) {
    return parseNameList(withRooms[1]);
  }

  // Comma-separated names (not "yes, 2 rooms")
  if (t.includes(',') && !/^\s*(yes|no|yep|ok)\s*,?\s*\d+\s*rooms?\b/i.test(t)) {
    const names = parseNameList(t);
    if (names.length > 0) return names;
  }

  return [];
}

export function isFollowProjectSize(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (/^(same|full|project|site|default|fit|ok|okay)$/i.test(t)) return true;
  return (
    /\b(follow|same\s+as|match|use|fit|fill|full|entire|whole)\b[\s\w]*\b(project|site|building)\b/.test(t)
    || /\b(project|site)\s+size\b/.test(t)
    || /\bfollow\s+(the\s+)?(project|site)\b/.test(t)
    || /\bas\s+(the\s+)?project\b/.test(t)
    || /\bsame\s+(size|as\s+project)\b/.test(t)
  );
}

export function isCreateProjectIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(help\s+me\s+(to\s+)?create|create\s+(a\s+|new\s+)?project|make\s+(a\s+|new\s+)?project|new\s+project|i\s+want\s+to\s+create)\b/i.test(t)
    || /^(start|begin)$/i.test(t)
  );
}

export function extractFolderMention(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  const patterns = [
    /(?:place(?:\s+it)?|put(?:\s+it)?|save(?:\s+it)?|add(?:\s+it)?)\s+(?:under|in|into|to)\s+(?:the\s+)?folder\s+["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.|and\b)/i,
    /(?:under|in|into)\s+(?:the\s+)?folder\s+["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.|and\b)/i,
    /folder\s*[:=]\s*["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.)/i,
    /(?:place(?:\s+it)?|put(?:\s+it)?)\s+(?:under|in)\s+["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.)/i,
  ];

  for (const re of patterns) {
    const match = t.match(re);
    if (match?.[1]) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      if (name && !/^(here|there|this)$/i.test(name)) return name;
    }
  }
  return null;
}

/** Get parent folder id whether API returns a number or nested object. */
export function getFolderParentId(folder) {
  if (!folder || folder.parent == null || folder.parent === undefined) return null;
  if (typeof folder.parent === 'object') return folder.parent.id ?? null;
  return folder.parent;
}

/**
 * Build full paths for all folders (supports nested parent/child).
 */
export function buildFolderPaths(folders = []) {
  const map = new Map();
  folders.forEach((f) => {
    map.set(f.id, f);
    map.set(String(f.id), f);
    if (typeof f.id === 'number') map.set(Number(f.id), f);
  });

  return folders.map((folder) => {
    const parts = [];
    let current = folder;
    const seen = new Set();

    while (current) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      parts.unshift(current.name);
      const parentId = getFolderParentId(current);
      if (parentId == null) break;
      current = map.get(parentId) ?? map.get(String(parentId)) ?? map.get(Number(parentId)) ?? null;
    }

    return {
      folder,
      path: parts.join(' / '),
      pathSlash: parts.join('/'),
      leaf: parts[parts.length - 1],
    };
  });
}

export function getSortedFolderEntries(folders = []) {
  return buildFolderPaths(folders).sort((a, b) => a.path.localeCompare(b.path));
}

/** Walk folder tree segment by segment: Brian/2025 */
function resolveFolderByPathSegments(segments, folders) {
  if (!segments.length || !folders.length) return null;

  let parentId = null;
  let matched = null;

  for (const rawSeg of segments) {
    const seg = rawSeg.trim().toLowerCase();
    if (!seg) return null;

    const matches = folders.filter((f) => {
      const fParent = getFolderParentId(f);
      const parentMatches =
        (parentId == null && (fParent == null || fParent === undefined))
        || String(fParent) === String(parentId);
      return parentMatches && String(f.name).trim().toLowerCase() === seg;
    });

    if (matches.length !== 1) return null;
    matched = matches[0];
    parentId = matched.id;
  }

  if (!matched) return null;
  const entry = buildFolderPaths(folders).find((e) => e.folder.id === matched.id);
  return {
    key: matched.id,
    label: entry?.path ?? matched.name,
  };
}

/** Normalize folder path input: Brian/2025, Brian \ 2025, Brian > 2025 → brian/2025 */
export function normalizeFolderPathInput(text) {
  return String(text || '')
    .trim()
    .replace(/\s*[\\/>]\s*/g, '/')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Resolve a folder reply/mention against available folders.
 * Supports nested paths like "Brian/2025" or "Brian / 2025".
 * @returns {{ key: string|number, label: string } | null}
 */
export function resolveFolderChoice(text, folders = []) {
  const t = String(text || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  if (
    /^(uncategorized|none|no\s*folder|root|skip|default|n\/a|na)$/i.test(lower)
    || /^(place\s+)?(it\s+)?(in\s+)?uncategorized$/i.test(lower)
  ) {
    return { key: 'uncategorized', label: 'Uncategorized' };
  }

  const entries = getSortedFolderEntries(folders);

  // Numbered list reply: "1", "2." (same order as shown in chat)
  const numMatch = lower.match(/^(\d+)\.?$/);
  if (numMatch && entries.length) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && idx < entries.length) {
      const entry = entries[idx];
      return { key: entry.folder.id, label: entry.path };
    }
  }

  const mentioned = extractFolderMention(t) || t.replace(/^(folder|the)\s+/i, '').trim();
  if (!mentioned) return null;

  const mentionLower = mentioned.toLowerCase();
  if (/^uncategorized$/i.test(mentionLower)) {
    return { key: 'uncategorized', label: 'Uncategorized' };
  }

  const normalizedInput = normalizeFolderPathInput(mentioned);

  // Tree walk for nested paths — most reliable for Brian/2025
  if (normalizedInput.includes('/')) {
    const segments = normalizedInput.split('/').filter(Boolean);
    const walked = resolveFolderByPathSegments(segments, folders);
    if (walked) return walked;
  }

  // Full path string match (fallback)
  const pathMatches = entries.filter(
    (e) => normalizeFolderPathInput(e.pathSlash) === normalizedInput
      || normalizeFolderPathInput(e.path) === normalizedInput
  );
  if (pathMatches.length === 1) {
    return { key: pathMatches[0].folder.id, label: pathMatches[0].path };
  }

  // Single-segment name: exact leaf match only (must be unique)
  if (!normalizedInput.includes('/')) {
    const exactLeaf = entries.filter(
      (e) => e.leaf.toLowerCase() === mentionLower
    );
    if (exactLeaf.length === 1) {
      return { key: exactLeaf[0].folder.id, label: exactLeaf[0].path };
    }
  }

  return null;
}

export function extractProjectName(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  // Explicit name patterns
  const named = t.match(
    /(?:project(?:\s+name)?|name|called|named)\s*(?:is|=|:)?\s*["']?([^"'\n,]+)/i
  );
  if (named) {
    let candidate = named[1].trim();
    // Strip trailing folder clauses
    candidate = candidate.replace(/\s+(under|in|into|place).*$/i, '').trim();
    if (candidate && !isCreateProjectIntent(candidate)) return candidate.slice(0, 100);
  }

  // "create project Cold Store A" / "create a project called X"
  const createNamed = t.match(
    /create(?:\s+a|\s+new)?\s+project\s+(?:called\s+|named\s+)?["']?([A-Za-z0-9][^"'.,\n]*?)["']?(?=\s*,|\s+with|\s+site|\s+under|\s+in\s+folder|\s*$)/i
  );
  if (createNamed?.[1]) {
    const candidate = createNamed[1].trim();
    if (candidate && !/^(for|me|please|help)$/i.test(candidate)) return candidate.slice(0, 100);
  }

  // Reject create-intent-only / folder-only / dimension replies
  if (isCreateProjectIntent(t) && !createNamed) return null;
  if (extractFolderMention(t) && !named) return null;
  if (parseDimensionPair(t) || parseSingleDimension(t)) return null;
  if (/^(yes|no|y|n|start|begin|hi|hello)$/i.test(t)) return null;
  if (/help\s+me|create\s+(a\s+)?project|place\s+it|under\s+folder/i.test(t)) return null;

  return t.slice(0, 100);
}

export const CHAT_OPTIONS = {
  FLOOR_TYPES,
  FACE_MATERIALS,
  FLOOR_THICKNESSES,
};
