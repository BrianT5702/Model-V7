/** Parse natural-language replies for the project chatbot. Units default to mm; accept m. */

const FLOOR_TYPES = ['Slab', 'Panel', 'None'];
const FACE_MATERIALS = ['PPGI', 'S/Steel', 'PVC'];
const FLOOR_THICKNESSES = [0, 50, 75, 100, 125, 150, 175, 200];

const NUM = String.raw`\d+(?:\.\d+)?`;
const UNIT = String.raw`m|meters?|metres?|cm|mm`;
/** x, ×, *, or the word "by". Slash is not a size separator — project names use it. */
const DIM_SEP = String.raw`\s*(?:[x×*]|by)\s*`;

/**
 * Tidy punctuation and units so slightly different typing still parses.
 * Safe to run more than once.
 */
export function normalizeChatText(text) {
  let t = String(text || '');
  t = t.replace(/[\u00d7\u2715\u2716\uff58\uff38\u22c5]/g, 'x');
  t = t.replace(/[\u2013\u2014\u2212]/g, '-');
  t = t.replace(/℃/g, 'C').replace(/℉/g, 'F');
  t = t.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  t = t.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) => m.replace(/,/g, ''));
  t = t.replace(/(\d(?:\.\d+)?)(mm|cm)\b/gi, '$1 $2');
  t = t.replace(/(\d(?:\.\d+)?)m\b/gi, '$1 m');
  t = t.replace(/\b(slab|panel)(\d)/gi, '$1 $2');
  t = t.replace(/(\d)([cC])\b/g, '$1 $2');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/[ \t]*\r?\n[ \t]*/g, '\n');
  return t.trim();
}

function dimsFromMatch(a, u1, b, u2, c, u3) {
  const shared = u1 || u2 || u3 || '';
  const width = toMm(a, u1 || shared);
  const length = toMm(b, u2 || shared);
  if (!width || !length) return null;
  const height = c != null && c !== '' ? toMm(c, u3 || shared) : null;
  return height ? { width, length, height } : { width, length };
}

function parseLabeledDimensions(text) {
  const t = normalizeChatText(text);
  const take = (pattern) => {
    const re = new RegExp(`\\b(?:${pattern})\\s*[:=]?\\s*(${NUM})\\s*(${UNIT})?`, 'i');
    const m = t.match(re);
    return m ? toMm(m[1], m[2] || '') : null;
  };
  const width = take('width|\\bw\\b');
  const length = take('length|len|\\bl\\b');
  const height = take('height|\\bht\\b|\\bh\\b');
  if (width && length) {
    return height ? { width, length, height } : { width, length };
  }
  return null;
}

/**
 * Whole-message "5000, 8500, 6000" / "5000 8500 6000" — not used on long dumps,
 * so room lines like "3050, 2 to 6, slab 100" stay intact.
 */
function parseIsolatedNumberTriple(text) {
  const t = normalizeChatText(text);
  if (!t || t.length > 80 || /\b(chiller|freezer|room|slab|panel|temp)\b/i.test(t)) return null;
  const m = t.match(
    new RegExp(
      `^(?:(?:site|size|overall|envelope)\\s*(?:is|=|:)?\\s*)?(${NUM})\\s*(${UNIT})?\\s*[,;\\s/]+\\s*(${NUM})\\s*(${UNIT})?\\s*[,;\\s/]+\\s*(${NUM})\\s*(${UNIT})?\\s*$`,
      'i'
    )
  );
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const c = Number(m[5]);
  const hasUnit = !!(m[2] || m[4] || m[6]);
  if (!hasUnit && (a < 200 || b < 200 || c < 200)) return null;
  return dimsFromMatch(m[1], m[2], m[3], m[4], m[5], m[6]);
}

function parseIsolatedNumberPair(text) {
  const t = normalizeChatText(text);
  if (!t || t.length > 60 || /\b(temp|slab|panel|to|chiller|freezer|room)\b/i.test(t)) return null;
  const m = t.match(
    new RegExp(
      `^(${NUM})\\s*(${UNIT})?\\s*[,;\\s/]+\\s*(${NUM})\\s*(${UNIT})?\\s*$`,
      'i'
    )
  );
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const hasUnit = !!(m[2] || m[4]);
  if (!hasUnit && (a < 200 || b < 200)) return null;
  return dimsFromMatch(m[1], m[2], m[3], m[4]);
}

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
  const normalized = normalizeChatText(text);
  const labeled = parseLabeledDimensions(normalized);
  if (labeled) return labeled;

  const tripleRe = new RegExp(
    `(${NUM})\\s*(${UNIT})?${DIM_SEP}(${NUM})\\s*(${UNIT})?${DIM_SEP}(${NUM})\\s*(${UNIT})?`,
    'i'
  );
  const triple = normalized.match(tripleRe);
  if (triple) {
    const parsed = dimsFromMatch(triple[1], triple[2], triple[3], triple[4], triple[5], triple[6]);
    if (parsed?.width && parsed?.length && parsed?.height) return parsed;
  }

  const pairRe = new RegExp(
    `(${NUM})\\s*(${UNIT})?${DIM_SEP}(${NUM})\\s*(${UNIT})?`,
    'i'
  );
  const match = normalized.match(pairRe);
  if (match) {
    const parsed = dimsFromMatch(match[1], match[2], match[3], match[4]);
    if (parsed) return parsed;
  }

  return parseIsolatedNumberTriple(normalized) || parseIsolatedNumberPair(normalized);
}

export function parseSingleDimension(text) {
  if (!text) return null;
  const match = normalizeChatText(text).match(new RegExp(`^(${NUM})\\s*(${UNIT})?$`, 'i'));
  if (!match) return null;
  return toMm(match[1], match[2] || '');
}

export function parseProjectSize(text) {
  const normalized = normalizeChatText(text);
  const dims = parseDimensionPair(normalized) || parseIsolatedNumberTriple(normalized);
  if (!dims) return null;

  const heightMatch = normalized.match(
    new RegExp(`(?:height|\\bht\\b|\\bh\\b)\\s*[:=]?\\s*(${NUM})\\s*(${UNIT})?`, 'i')
  );
  if (heightMatch) {
    dims.height = toMm(heightMatch[1], heightMatch[2] || '');
  } else if (!dims.height) {
    const numbers = normalized.match(new RegExp(`(${NUM})\\s*(${UNIT})?`, 'gi'));
    if (numbers && numbers.length === 3) {
      const third = numbers[2].match(new RegExp(`(${NUM})\\s*(${UNIT})?`, 'i'));
      if (third) dims.height = toMm(third[1], third[2] || '');
    }
  }
  return dims;
}

export function parseYesNo(text) {
  const t = normalizeChatText(text).toLowerCase();
  if (!t) return null;
  if (/^(y|yes|yeah|yep|yup|yea|true|ok|okay|sure|include|with)\b/.test(t)) return true;
  if (/^(n|no|nah|nope|false|skip|none|without|exclude)\b/.test(t)) return false;
  return null;
}

/** Copy remaining details from the previous room (not "same" = project height). */
export function isSameAsPrevious(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return /^(same\s+as\s+(previous|last|before|the\s+last(\s+room)?)|ditto|as\s+before|copy(\s+(previous|last))?|same\s+as\s+last\s+room)$/i.test(t);
}

/**
 * Parse a room temperature in °C.
 * Accepts "0", "-18", "2-6", "2 to 6", "ambient", "default".
 * @returns {{ temperature: number, temperature_min?: number, temperature_max?: number } | null}
 */
export function parseTemperature(text) {
  const t = normalizeChatText(text).toLowerCase()
    .replace(/°\s*c|deg(?:rees?)?\s*c?|\bc\b/g, '')
    .trim();
  if (!t) return null;
  if (/^(default|skip|ambient|none|na|n\/a|room)$/i.test(t)) {
    return { temperature: 0 };
  }

  const range = t.match(/([+\-]?\d+(?:\.\d+)?)\s*(?:-|to|~)\s*([+\-]?\d+(?:\.\d+)?)/)
    || (t.length < 24 ? t.match(/^([+\-]?\d+(?:\.\d+)?)\s*\/\s*([+\-]?\d+(?:\.\d+)?)$/) : null);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return { temperature: max, temperature_min: min, temperature_max: max };
  }

  const one = t.match(/^([+\-]?\d+(?:\.\d+)?)$/);
  if (!one) return null;
  const value = Number(one[1]);
  if (!Number.isFinite(value)) return null;
  return { temperature: value };
}

/** Find a temperature inside a longer reply (range, °C, or a comma-token like `0`). */
export function parseTemperatureInText(text) {
  const raw = normalizeChatText(text);
  if (!raw.trim()) return null;

  const labeled = raw.match(
    /\b(?:temp(?:erature)?)\s*[:=]?\s*([+\-]?\d+(?:\.\d+)?)(?:\s*(?:to|-|~|\/)\s*([+\-]?\d+(?:\.\d+)?))?/i
  );
  if (labeled) {
    if (labeled[2] != null) {
      return parseTemperature(`${labeled[1]} to ${labeled[2]}`);
    }
    return parseTemperature(labeled[1]);
  }

  const withUnit = raw.match(/([+\-]?\d+(?:\.\d+)?)\s*(?:to|-|~|\/)\s*([+\-]?\d+(?:\.\d+)?)\s*(?:°\s*c|deg(?:rees?)?\s*c|c\b)/i)
    || raw.match(/([+\-]?\d+(?:\.\d+)?)\s*(?:°\s*c|deg(?:rees?)?\s*c)\b/i)
    || raw.match(/([+\-]?\d+(?:\.\d+)?)\s*(?:to|-|~)\s*([+\-]?\d+(?:\.\d+)?)c\b/i);
  if (withUnit) {
    return withUnit[2]
      ? parseTemperature(`${withUnit[1]} to ${withUnit[2]}`)
      : parseTemperature(withUnit[1]);
  }

  const range = raw.match(/([+\-]?\d+(?:\.\d+)?)\s+(?:to)\s+([+\-]?\d+(?:\.\d+)?)/i);
  if (range) return parseTemperature(`${range[1]} to ${range[2]}`);

  const tokens = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  for (const tok of tokens) {
    if (parseFloorType(tok) || parseFloorThickness(tok) != null && /mm/i.test(tok)) continue;
    if (/height|width|length|slab|panel|ceiling|wall|ppgi|site|project/i.test(tok)) continue;
    const parsed = parseTemperature(tok);
    if (parsed && Math.abs(parsed.temperature) <= 50) return parsed;
  }
  return null;
}

export function extractWallThickness(text) {
  const t = normalizeChatText(text);
  const match = t.match(/\bwalls?\s*(?:thickness\s*)?[:=]?\s*(\d+(?:\.\d+)?)\s*(mm)?\b/i)
    || t.match(/\b(\d+(?:\.\d+)?)\s*mm\s+walls?\b/i)
    || t.match(/\b(?:wall\s*)?(?:thk|thick(?:ness)?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm)?\b/i)
    || t.match(/\b(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:thk|thick(?:ness)?)\b/i)
    || t.match(/\bthickness\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(mm)?\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 500) return null;
  return Math.round(value);
}

/**
 * Pull any room fields mentioned in one reply (size, height, temp, floor, ceiling, walls).
 */
export function parseRoomDetailsFromText(text) {
  const spec = {};
  const raw = normalizeChatText(text);
  if (!raw) return spec;

  if (isFollowProjectSize(raw)) spec.followProjectSize = true;
  if (isSameAsPrevious(raw)) spec.sameAsPrevious = true;

  const dims = parseDimensionPair(raw);
  if (dims?.width && dims?.length) {
    spec.width = dims.width;
    spec.length = dims.length;
    if (dims.height) spec.height = dims.height;
  }

  const heightMatch = raw.match(new RegExp(`\\b(?:height|ht)\\s*[:=]?\\s*(${NUM})\\s*(${UNIT})?`, 'i'));
  if (heightMatch) {
    const height = toMm(heightMatch[1], heightMatch[2] || '');
    if (height) spec.height = height;
  } else if (/^(same|default|project)$/i.test(raw.trim())) {
    spec.useProjectHeight = true;
  }

  const temp = parseTemperatureInText(raw) || parseTemperature(raw);
  if (temp) {
    spec.temperature = temp.temperature;
    spec.temperature_min = temp.temperature_min ?? null;
    spec.temperature_max = temp.temperature_max ?? null;
  }

  const floorMatch = raw.match(/\b(\d+)\s*(mm)?\s*(slab|panel|concrete)\b/i)
    || raw.match(/\b(slab|panel|none|concrete)\b(?:\s+(\d+)\s*(mm)?)?/i);
  if (floorMatch) {
    const typeFirst = /slab|panel|none|concrete/i.test(floorMatch[1] || '');
    const typeTok = typeFirst ? floorMatch[1] : floorMatch[3];
    const thickTok = typeFirst ? floorMatch[2] : floorMatch[1];
    spec.floor_type = parseFloorType(typeTok);
    if (thickTok != null && thickTok !== '') spec.floor_thickness = Math.round(Number(thickTok));
    else if (spec.floor_type === 'None') spec.floor_thickness = 0;
  }

  if (/\b(no\s+ceiling|without\s+ceiling|exclude\s+ceiling)\b/i.test(raw)) {
    spec.include_ceiling = false;
  } else {
    const ceil = raw.match(/\bceiling\s*[:=]?\s*(yes|no|none|true|false)\b/i);
    if (ceil) spec.include_ceiling = !/^(no|none|false)$/i.test(ceil[1]);
  }

  const faces = raw.match(/\b(ppgi|s\/steel|steel|pvc)\s*(?:\/|,| and )\s*(ppgi|s\/steel|steel|pvc)\b/i);
  if (faces) {
    spec.inner_face_material = parseFaceMaterial(faces[1]);
    spec.outer_face_material = parseFaceMaterial(faces[2]);
  } else if (/\bdefault\s+(ppgi|walls?)|\bppgi\b/i.test(raw) && /wall|ppgi|default/i.test(raw)) {
    spec.inner_face_material = 'PPGI';
    spec.outer_face_material = 'PPGI';
  }

  return spec;
}

/**
 * Parse named room lines from a dump, e.g.
 * `CHILLER 3050x8500 height 6000, 2 to 6, slab 100`
 */
export function parseNamedRoomSpecs(text) {
  const specs = [];
  const raw = normalizeChatText(text);
  if (!raw) return specs;

  const starts = [];
  const re = new RegExp(
    `(?:^|[\\n;,]|\\.\\s+|\\band\\s+)(?:room\\s*\\d+\\s*[:.)-]?\\s*)?([A-Za-z][\\w ./-]{0,32}?)\\s*[:\\-=]?\\s*\\(?\\s*(?=${NUM}\\s*(?:${UNIT})?${DIM_SEP}${NUM})`,
    'gim'
  );
  let match = re.exec(raw);
  while (match) {
    const name = match[1].trim().replace(/^(?:and|with|rooms?:)\s+/i, '');
    if (
      name
      && name.length <= 40
                    && !/^(create|help|site|project|size|width|length|height|folder|wall|name|under|temp|temperature|floor|ceiling|slab|panel|make|build)\b/i.test(name)
    ) {
      starts.push({
        name,
        bodyIndex: match.index + match[0].length,
      });
    }
    match = re.exec(raw);
  }

  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].bodyIndex : raw.length;
    const body = raw.slice(start.bodyIndex, end).replace(/[.;,\s]+$/, '');
    const details = parseRoomDetailsFromText(body);
    if (!details.width || !details.length) return;
    specs.push({ name: start.name, ...details });
  });

  const seen = new Set();
  return specs.filter((spec) => {
    const key = spec.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  if (isUsageHelpIntent(t) && !/\bguide me\b/i.test(t)) return false;
  if (isCreateNewFolderIntent(t) && !/\bproject\b/i.test(t)) return false;
  return (
    /\b(help\s+me\s+(to\s+)?create|create\s+(a\s+|new\s+)?project|make\s+(me\s+)?(a\s+|new\s+)?project|build\s+(a\s+|new\s+)?project|set\s*up\s+(a\s+|new\s+)?project|new\s+project|i\s+(want|need|wanna)\s+(to\s+)?(create|make|build|a\s+project))\b/i.test(t)
    || /\bcreate\s+[A-Za-z0-9].*\b(site|folder|wall|rooms?|in|under)\b/i.test(t)
    || /^(start|begin|guide me|i'?m new[—\s-]*guide me)$/i.test(t)
  );
}

/** Newbie asking how the chat works, not starting a project yet. */
export function isUsageHelpIntent(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (/help\s+me\s+(to\s+)?create/i.test(t)) return false;
  return (
    /^(help|how|example|guide|instructions|tutorial|\?)$/i.test(t)
    || /\b(how (do i|to) use|how (does|do) (this|it) work|show (me )?(an )?example|what can you do|i'?m new|newbie)\b/i.test(t)
  );
}

/** User wants a brand-new folder, not one that already exists. */
export function isCreateNewFolderIntent(text) {
  const t = normalizeChatText(text).toLowerCase();
  if (!t) return false;
  if (/\bproject\b/.test(t) && !/\bfolder\b/.test(t)) return false;
  return (
    // “create/make/add a new folder”, plus a missing-c typo (“reate a new folder”)
    /\b(c?reate|make|add)\s+(a\s+)?(new\s+)?folder\b/i.test(t)
    || /^(new\s+folder)\b/i.test(t)
    || /\b(i\s+(want|need)\s+(to\s+)?(create|make|c?reate)\s+(a\s+)?(new\s+)?folder)\b/i.test(t)
    || /^(create\s+it|yes,?\s*create(\s+it)?)$/i.test(t)
  );
}

/** `new folder Cold Stores` / `create folder Brian/2026` — null if they only said “new folder”. */
export function extractNewFolderName(text) {
  const t = normalizeChatText(text);
  if (!t) return null;
  const named = t.match(
    /(?:c?reate|make|add|new)\s+(?:a\s+)?(?:new\s+)?folder(?:\s+(?:called|named))?\s*[:\-]?\s*["']?([^"'.,\n]+?)["']?\s*$/i
  );
  if (!named?.[1]) return null;
  let name = named[1].trim().replace(/^(called|named|for)\s+/i, '');
  name = name.replace(/\s+for\s+(it|this|me|the\s+project)$/i, '').trim();
  if (!name || /^(it|this|that|please|here|me)$/i.test(name)) return null;
  return name.slice(0, 80);
}

export function extractFolderMention(text) {
  const t = normalizeChatText(text);
  if (!t) return null;
  if (isCreateNewFolderIntent(t) && !extractNewFolderName(t)) return null;

  const patterns = [
    /(?:place(?:\s+it)?|put(?:\s+it)?|save(?:\s+it)?|add(?:\s+it)?)\s+(?:under|in|into|to)\s+(?:the\s+)?folder\s+["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.|and\b)/i,
    /(?:under|in|into)\s+(?:the\s+)?folder\s+["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.|and\b)/i,
    /folder\s*[:=]\s*["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.)/i,
    /(?:place(?:\s+it)?|put(?:\s+it)?)\s+(?:under|in)\s+["']?([^"'.,\n]+?)["']?(?=\s|$|,|\.)/i,
    /\bin\s+(?:the\s+)?["']?([A-Za-z][\w /]*?)["']?\s+folder\b/i,
    /\b["']?([A-Za-z][\w /]{1,40}?)["']?\s+folder\b/i,
    /\b(?:in|under)\s+["']?([A-Za-z][\w /]*?)["']?(?=\s*,|\s+site|\s+with|\s+wall|\s+rooms?\b|\s*$)/i,
  ];

  for (const re of patterns) {
    const match = t.match(re);
    if (match?.[1]) {
      const name = match[1].trim().replace(/\s+/g, ' ');
      if (name && !/^(here|there|this|the|a|an|folder|new|create|make|add)$/i.test(name)) return name;
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
export function resolveFolderByPathSegments(segments, folders) {
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
  const t = normalizeChatText(text);
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

  // "create project Cold Store A" / "make a project called X"
  const createNamed = t.match(
    /(?:create|make|build)\s+(?:me\s+)?(?:a\s+|new\s+)?(?:project\s+)?(?:called\s+|named\s+)?["']?([A-Za-z0-9][^"'.,\n]*?)["']?(?=\s*,|\s+with|\s+site|\s+under|\s+in\b|\s+wall|\s*$)/i
  );
  if (createNamed?.[1]) {
    const candidate = createNamed[1].trim();
    if (candidate && !/^(for|me|please|help|a|new|project)$/i.test(candidate)) return candidate.slice(0, 100);
  }

  // Reject create-intent-only / folder-only / dimension / how-to replies
  if (isUsageHelpIntent(t)) return null;
  if (isCreateProjectIntent(t) && !createNamed) return null;
  if (isCreateNewFolderIntent(t) && !named) return null;
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
