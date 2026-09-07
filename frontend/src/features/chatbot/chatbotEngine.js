import {
  extractFolderMention,
  extractProjectName,
  extractRoomNames,
  extractWallThickness,
  extractNewFolderName,
  isCreateProjectIntent,
  isCreateNewFolderIntent,
  isUsageHelpIntent,
  normalizeChatText,
  parseDimensionPair,
  parseThicknessMm,
  parseProjectSize,
  parseRoomCount,
  parseRoomDetailsFromText,
  parseNamedRoomSpecs,
  parseSingleDimension,
  parseYesNo,
  isSameAsPrevious,
  resolveFolderChoice,
  getSortedFolderEntries,
} from './parseChatMessage';
import { arrangeRooms } from './roomLayoutEngine';
import { UNCATEGORIZED_KEY, getFolderPath } from '../project/projectFolderUtils';

export const PHASES = {
  WELCOME: 'welcome',
  FOLDER: 'folder',
  FOLDER_NEW: 'folder_new',
  PROJECT_NAME: 'project_name',
  PROJECT_SIZE: 'project_size',
  WALL_THICKNESS: 'wall_thickness',
  ROOM_INTENT: 'room_intent',
  ROOM_NAMES: 'room_names',
  ROOM_DETAILS: 'room_details',
  ROOM_SIZE: 'room_size',
  ROOM_HEIGHT: 'room_height',
  ROOM_TEMPERATURE: 'room_temperature',
  ROOM_FLOOR: 'room_floor',
  ROOM_FLOOR_THICKNESS: 'room_floor_thickness',
  ROOM_CEILING: 'room_ceiling',
  ROOM_WALLS: 'room_walls',
  CONFIRM: 'confirm',
  CREATING: 'creating',
  DONE: 'done',
};

const ROOM_DETAIL_PHASES = [
  PHASES.ROOM_DETAILS,
  PHASES.ROOM_SIZE,
  PHASES.ROOM_HEIGHT,
  PHASES.ROOM_TEMPERATURE,
  PHASES.ROOM_FLOOR,
  PHASES.ROOM_FLOOR_THICKNESS,
  PHASES.ROOM_CEILING,
  PHASES.ROOM_WALLS,
];

export function createInitialDraft() {
  return {
    name: '',
    width: null,
    length: null,
    height: null,
    wall_thickness: 100,
    wallThicknessDecided: false,
    rooms: [],
    currentRoomIndex: 0,
    skipRooms: false,
    folderKey: null,
    folderLabel: null,
    folderDecided: false,
    newFolderName: null,
    unmatchedFolderName: null,
  };
}

export function createEmptyRoom(name = '') {
  return {
    name: name || '',
    width: null,
    length: null,
    height: null,
    temperature: null,
    temperature_min: null,
    temperature_max: null,
    floor_type: null,
    floor_thickness: null,
    include_ceiling: null,
    inner_face_material: null,
    outer_face_material: null,
  };
}

function bot(text, extras = {}) {
  return { role: 'assistant', text, ...extras };
}

function currentRoom(draft) {
  return draft.rooms[draft.currentRoomIndex] || null;
}

function roomPromptPrefix(draft) {
  const room = currentRoom(draft);
  const n = draft.currentRoomIndex + 1;
  const total = draft.rooms.length;
  const label = room?.name ? `"${room.name}"` : `Room ${n}`;
  return `For ${label} (${n}/${total})`;
}

function missingProjectSize(draft) {
  return draft.width == null || draft.length == null || draft.height == null;
}

function applyProjectSize(draft, dims) {
  if (!dims) return draft;
  return {
    ...draft,
    width: dims.width ?? draft.width,
    length: dims.length ?? draft.length,
    height: dims.height ?? draft.height,
  };
}

function formatMm(n) {
  if (n == null) return '—';
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000} m`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)} m (${n} mm)`;
  return `${n} mm`;
}

/** Floor/wall thickness — always show as mm (never convert 50 → 50 m). */
function formatThicknessMm(n) {
  if (n == null) return '—';
  return `${n} mm`;
}

export function buildSummary(draft, folders = []) {
  const folderLine = draft.folderDecided
    ? (draft.newFolderName
      ? `${draft.newFolderName} (new folder)`
      : (draft.folderLabel
        || getFolderPath(draft.folderKey ?? UNCATEGORIZED_KEY, folders)
        || 'Uncategorized'))
    : '(not chosen yet)';

  const lines = [
    `Project: ${draft.name || '(unnamed)'}`,
    `Folder: ${folderLine}`,
    `Site: ${formatMm(draft.width)} × ${formatMm(draft.length)}, height ${formatMm(draft.height)}`,
    `Wall thickness: ${formatThicknessMm(draft.wall_thickness)}`,
  ];

  if (!draft.rooms.length || draft.skipRooms) {
    lines.push('Rooms: none (site boundary walls only)');
  } else {
    lines.push(`Rooms (${draft.rooms.length}):`);
    draft.rooms.forEach((room, i) => {
      const temp = room.temperature_min != null && room.temperature_max != null
        ? `${room.temperature_min} to ${room.temperature_max} °C`
        : (room.temperature != null ? `${room.temperature} °C` : '—');
      lines.push(
        `  ${i + 1}. ${room.name} — ${formatMm(room.width)} × ${formatMm(room.length)}, ` +
          `height ${formatMm(room.height)}, ${temp}, ` +
          `floor ${room.floor_type}/${formatThicknessMm(room.floor_thickness)}, ` +
          `ceiling ${room.include_ceiling ? 'yes' : 'no'}, walls ${room.inner_face_material}/${room.outer_face_material}`
      );
    });

    const layout = arrangeRooms(
      draft.rooms.map((r) => ({ name: r.name, width: r.width, length: r.length })),
      draft.width,
      draft.length
    );
    if (layout.overflow) {
      lines.push(`Layout warning: ${layout.message}`);
    } else {
      lines.push(
        `Auto-layout: rooms packed into ${formatMm(layout.usedWidth)} × ${formatMm(layout.usedLength)} ` +
          `(site ${formatMm(draft.width)} × ${formatMm(draft.length)}). ` +
          `Shared walls will be reused. Joints will not be created.`
      );
    }
  }

  return lines.join('\n');
}

export function getWelcomeMessages() {
  return [
    bot(
      "Hi — I can **create a full project from this chat** (folder, site, rooms, walls, floor, and ceiling). I skip joints.\n\n" +
        "**Sizes:** `5000 × 8500 × 6000` is millimetres. `5m × 8.5m × 6m` is metres.\n" +
        "Missing room details default to project height, 0°C, slab 100 mm, ceiling yes, PPGI.\n\n" +
        "**Never used this?**\n" +
        "1. Tap **I’m new — guide me** below.\n" +
        "2. Answer one question at a time (or tap a chip).\n" +
        "3. When I show a summary, tap **Create project**.\n\n" +
        "Or tap **Show an example** to paste a full spec. Type **restart** to start over."
    ),
  ];
}

export function getExampleMessages() {
  return [
    bot(
      "Paste something like this in **one message**, then tap **Create project**:\n\n" +
        "`Create project My Cold Store in Testing, site 5000 × 8500 × 6000, walls 100`\n" +
        "`CHILLER 3050 × 8500 height 6000, 2 to 6°C, slab 100`\n" +
        "`EXT HT 1950 × 8500 height 3300, 0°C, slab 100`\n\n" +
        "Wording can vary — `5000x8500`, `5m by 8.5m`, `CHILLER: 3050*8500`, `2-6C`, `slab100` all work.\n\n" +
        "Or tap **I’m new — guide me** and I’ll ask you the pieces one by one."
    ),
  ];
}

function formatFolderList(folders) {
  if (!folders.length) {
    return '• Uncategorized (no folders yet)';
  }
  const entries = getSortedFolderEntries(folders);
  const lines = entries.map((e, i) => `• **${i + 1}.** ${e.path}`);
  return lines.join('\n');
}

function askFolder(folders = []) {
  const existing = folders.length
    ? `${formatFolderList(folders)}\n\n`
    : '';
  return bot(
    "Where should this project **go**? You choose:\n\n" +
      "1. **Place it in a folder that already exists** — tap a chip or type the path (e.g. `Testing`).\n" +
      "2. **Create a new folder** — tap **Create new folder**, or say `new folder Cold Stores`.\n" +
      "3. **Uncategorized** — no folder.\n\n" +
      `${existing}` +
      'You can also type a number from the list.'
  );
}

function askNewFolderName() {
  return bot(
    "What should the **new folder** be called?\n\n" +
      "Type a name like `Cold Stores`, or a path like `Brian/2026` (I'll create any missing parts).\n" +
      "Or tap an **existing folder** below if you'd rather place it there instead."
  );
}

function applyFolderChoice(draft, choice) {
  if (!choice) return draft;
  return {
    ...draft,
    folderKey: choice.key === 'uncategorized' ? UNCATEGORIZED_KEY : choice.key,
    folderLabel: choice.label,
    folderDecided: true,
    newFolderName: null,
    unmatchedFolderName: null,
  };
}

function applyNewFolderChoice(draft, name) {
  const folderName = String(name || '').trim();
  if (!folderName) return draft;
  const sameAsProjectName = String(draft.name || '').trim().toLowerCase() === folderName.toLowerCase();
  return {
    ...draft,
    name: sameAsProjectName ? '' : draft.name,
    newFolderName: folderName,
    folderKey: null,
    folderLabel: `${folderName} (new)`,
    folderDecided: true,
    unmatchedFolderName: null,
  };
}

function tryApplyFolderFromText(draft, text, folders, foldersAvailable) {
  if (!foldersAvailable) {
    return applyFolderChoice(draft, { key: 'uncategorized', label: 'Uncategorized' });
  }
  const newName = extractNewFolderName(text);
  if (newName) return applyNewFolderChoice(draft, newName);
  if (isCreateNewFolderIntent(text)) return draft;
  const choice = resolveFolderChoice(text, folders);
  if (choice) return applyFolderChoice(draft, choice);
  // Mentioned a folder name that didn't resolve — keep undecided
  if (extractFolderMention(text)) return draft;
  return draft;
}

function folderNameGuess(text) {
  if (isCreateNewFolderIntent(text) && !extractNewFolderName(text)) return null;
  const mentioned = extractFolderMention(text);
  if (mentioned) return mentioned.slice(0, 80);
  const cleaned = String(text || '').trim().replace(/^(folder|the|in|under|into)\s+/i, '').trim();
  if (!cleaned || cleaned.length > 80) return null;
  if (parseProjectSize(cleaned) || parseDimensionPair(cleaned)) return null;
  if (/^(yes|no|y|n|ok|okay|create|restart)$/i.test(cleaned)) return null;
  if (!/[a-z]/i.test(cleaned)) return null;
  return cleaned;
}

function offerCreateMissingFolder(draft, guess, folders) {
  return {
    draft: { ...draft, unmatchedFolderName: guess, folderDecided: false },
    phase: PHASES.FOLDER,
    messages: [
      bot(
        `There's no folder **${guess}** yet.\n\n` +
          `Reply **create it** to make that new folder, pick an existing one, tap **Create new folder**, or say **uncategorized**.`
      ),
      askFolder(folders),
    ],
  };
}

function startNewFolderFlow(draft, text, folders) {
  const named = extractNewFolderName(text);
  if (named) {
    const next = applyNewFolderChoice(draft, named);
    return continueDraft(next, folders, `I'll **create a new folder** **${named}** and put the project there.`);
  }
  if (/^(create\s+it|yes,?\s*create(\s+it)?)$/i.test(String(text || '').trim()) && draft.unmatchedFolderName) {
    const next = applyNewFolderChoice(draft, draft.unmatchedFolderName);
    return continueDraft(next, folders, `I'll **create a new folder** **${draft.unmatchedFolderName}** and put the project there.`);
  }
  return {
    draft,
    phase: PHASES.FOLDER_NEW,
    messages: [askNewFolderName()],
  };
}

function specWithoutMeta(spec) {
  const {
    name,
    followProjectSize,
    sameAsPrevious,
    useProjectHeight,
    ...fields
  } = spec || {};
  return fields;
}

function applySpecToRoom(room, spec, draft) {
  if (!spec) return room;
  const next = { ...room, ...specWithoutMeta(spec) };
  if (spec.followProjectSize && draft.width && draft.length) {
    next.width = draft.width;
    next.length = draft.length;
  }
  if (spec.useProjectHeight && draft.height) {
    next.height = draft.height;
  }
  return next;
}

function finalizeRoom(room, draft) {
  if (!room?.width || !room?.length) return room;
  const floorType = room.floor_type || 'Slab';
  const noneFloor = floorType === 'None';
  return {
    ...room,
    height: room.height || draft.height,
    temperature: room.temperature ?? 0,
    temperature_min: room.temperature_min ?? null,
    temperature_max: room.temperature_max ?? null,
    floor_type: floorType,
    floor_thickness: noneFloor ? 0 : (room.floor_thickness ?? 100),
    include_ceiling: room.include_ceiling ?? true,
    inner_face_material: room.inner_face_material || 'PPGI',
    outer_face_material: room.outer_face_material || 'PPGI',
  };
}

function finalizeAllSizedRooms(draft) {
  return {
    ...draft,
    rooms: draft.rooms.map((room) => finalizeRoom(room, draft)),
  };
}

function applyNamedRoomSpecs(draft, specs) {
  if (!specs?.length) return draft;
  let rooms = [...draft.rooms];
  if (!rooms.length) {
    rooms = specs.map((spec) => applySpecToRoom(createEmptyRoom(spec.name), spec, draft));
  } else {
    specs.forEach((spec) => {
      const idx = rooms.findIndex((r) => r.name.toLowerCase() === spec.name.toLowerCase());
      if (idx >= 0) {
        rooms[idx] = applySpecToRoom(rooms[idx], spec, draft);
      } else {
        rooms.push(applySpecToRoom(createEmptyRoom(spec.name), spec, draft));
      }
    });
  }
  return {
    ...draft,
    rooms,
    currentRoomIndex: 0,
    skipRooms: false,
  };
}

function firstRoomMissingSize(draft) {
  const idx = draft.rooms.findIndex((room) => !room.width || !room.length);
  return idx < 0 ? null : idx;
}

function harvestDraft(draft, text, folders, canUseFolders, phase) {
  let next = { ...draft };
  next = tryApplyFolderFromText(next, text, folders, canUseFolders);

  const roomPhase = ROOM_DETAIL_PHASES.includes(phase);
  const size = parseProjectSize(text);
  if (size && size.width && size.length) {
    if (!roomPhase) {
      next = applyProjectSize(next, size);
    } else if (missingProjectSize(next) && /\b(site|project)\b/i.test(text) && size.height) {
      next = applyProjectSize(next, size);
    }
  }

  const thickness = extractWallThickness(text);
  if (thickness) {
    next = { ...next, wall_thickness: thickness, wallThicknessDecided: true };
  }

  if (
    !next.name
    && [PHASES.WELCOME, PHASES.DONE, PHASES.FOLDER, PHASES.PROJECT_NAME].includes(phase)
    && phase !== PHASES.FOLDER_NEW
    && !isCreateNewFolderIntent(text)
  ) {
    const name = extractProjectName(text);
    const roomNames = extractRoomNames(text);
    const looksLikeRoomList = roomNames.length > 1
      && !isCreateProjectIntent(text)
      && !parseProjectSize(text);
    const folderOnlyReply = (phase === PHASES.FOLDER || phase === PHASES.FOLDER_NEW)
      && name
      && name.toLowerCase() === String(text || '').trim().toLowerCase();
    if (name && !looksLikeRoomList && !folderOnlyReply) next = { ...next, name };
  }

  const namedSpecs = parseNamedRoomSpecs(text);
  if (namedSpecs.length) {
    next = applyNamedRoomSpecs(next, namedSpecs);
  } else if (
    !next.rooms.length
    && [
      PHASES.WELCOME,
      PHASES.DONE,
      PHASES.FOLDER,
      PHASES.PROJECT_NAME,
      PHASES.PROJECT_SIZE,
      PHASES.WALL_THICKNESS,
      PHASES.ROOM_INTENT,
      PHASES.ROOM_NAMES,
    ].includes(phase)
  ) {
    const names = extractRoomNames(text);
    if (names.length > 0) {
      next = {
        ...next,
        rooms: names.map((n) => createEmptyRoom(n)),
        currentRoomIndex: 0,
        skipRooms: false,
      };
    }
  }

  return next;
}

function continueDraft(draft, folders = [], preface = null) {
  const messages = [];
  if (preface) messages.push(bot(preface));

  let next = { ...draft };
  if (!next.wallThicknessDecided) {
    next = {
      ...next,
      wall_thickness: next.wall_thickness || 100,
      wallThicknessDecided: true,
    };
  }

  if (!next.folderDecided) {
    messages.push(askFolder(folders));
    return { draft: next, phase: PHASES.FOLDER, messages };
  }
  if (!next.name) {
    messages.push(askProjectName());
    return { draft: next, phase: PHASES.PROJECT_NAME, messages };
  }
  if (missingProjectSize(next)) {
    messages.push(askProjectSize(next));
    return { draft: next, phase: PHASES.PROJECT_SIZE, messages };
  }

  if (!next.skipRooms && next.rooms.length === 0) {
    messages.push(askRoomIntent());
    return { draft: next, phase: PHASES.ROOM_INTENT, messages };
  }

  if (!next.skipRooms) {
    if (next.rooms.length === 1 && next.width && next.length && !next.rooms[0].width) {
      next = fillRoomWithProjectSize(next, 0);
    }
    const idx = firstRoomMissingSize(next);
    if (idx != null) {
      const ready = { ...next, currentRoomIndex: idx };
      messages.push(askRoomDetails(ready));
      return { draft: ready, phase: PHASES.ROOM_DETAILS, messages };
    }
    const filled = finalizeAllSizedRooms(next);
    messages.push(askConfirm(filled, folders));
    return { draft: filled, phase: PHASES.CONFIRM, messages };
  }

  messages.push(askConfirm(next, folders));
  return { draft: next, phase: PHASES.CONFIRM, messages };
}

function ensureFolderOrContinue(draft, folders, foldersAvailable, preface = null) {
  if (!foldersAvailable) {
    const next = applyFolderChoice(draft, { key: 'uncategorized', label: 'Uncategorized' });
    return continueDraft(next, folders, preface);
  }
  if (draft.folderDecided) {
    const folderNote = preface
      || `Okay — I'll put it in **${draft.folderLabel || getFolderPath(draft.folderKey, folders)}**.`;
    return continueDraft(draft, folders, folderNote);
  }
  const messages = [];
  if (preface) messages.push(bot(preface));
  messages.push(askFolder(folders));
  return { draft, phase: PHASES.FOLDER, messages };
}

function askProjectName() {
  return bot('What should we name this project?');
}

function askProjectSize(draft) {
  const missing = [];
  if (draft.width == null) missing.push('width');
  if (draft.length == null) missing.push('length');
  if (draft.height == null) missing.push('height');
  return bot(
    `I still need the **project site size** (${missing.join(', ')}).\n\n` +
      'Please reply like: `24000 × 12000 × 6000` (mm) or `24m × 12m × 6m`.'
  );
}

function askRoomIntent() {
  return bot(
    'Do you want **rooms** inside this project?\n' +
      'Reply with names (`CHILLER, EXT HT`), **yes** + a count, or **no** for site walls only.'
  );
}

function askRoomNames() {
  return bot(
    'List the **room names**, separated by commas.\nExample: `Freezer, Chiller, Packing`'
  );
}

function askRoomDetails(draft) {
  const heightHint = draft.height ? formatMm(draft.height) : 'the project height';
  const extras = draft.currentRoomIndex > 0
    ? '\nOr say **same as previous** to copy the last room’s height, temperature, floor, ceiling, and walls.'
    : '';
  return bot(
    `${roomPromptPrefix(draft)}: send the **size** in one message. ` +
      'You can add height, temperature, and floor in the same reply.\n\n' +
      'Example: `3050 × 8500, height 6000, 2 to 6°C, slab 100`\n' +
      `If you only send the size, I’ll use ${heightHint}, 0°C, slab 100 mm, ceiling yes, PPGI.` +
      extras
  );
}

function fillRoomWithProjectSize(draft, index = draft.currentRoomIndex) {
  if (draft.width == null || draft.length == null) return null;
  const rooms = [...draft.rooms];
  if (!rooms[index]) return null;
  rooms[index] = {
    ...rooms[index],
    width: draft.width,
    length: draft.length,
  };
  return { ...draft, rooms };
}

function copyPreviousRoom(draft, { copySize = false } = {}) {
  const index = draft.currentRoomIndex;
  if (index < 1) return null;
  const previous = draft.rooms[index - 1];
  const rooms = [...draft.rooms];
  rooms[index] = {
    ...rooms[index],
    ...(copySize && previous.width && previous.length
      ? { width: previous.width, length: previous.length }
      : {}),
    height: previous.height,
    temperature: previous.temperature,
    temperature_min: previous.temperature_min,
    temperature_max: previous.temperature_max,
    floor_type: previous.floor_type,
    floor_thickness: previous.floor_thickness,
    include_ceiling: previous.include_ceiling,
    inner_face_material: previous.inner_face_material,
    outer_face_material: previous.outer_face_material,
  };
  return { ...draft, rooms };
}

function tryCopyPrevious(draft, text, folders, { copySize = false } = {}) {
  if (!isSameAsPrevious(text) || draft.currentRoomIndex < 1) return null;
  const next = copyPreviousRoom(draft, { copySize });
  if (!next) return null;
  const room = next.rooms[next.currentRoomIndex];
  if (room.width && room.length) {
    const filled = {
      ...next,
      rooms: next.rooms.map((r, i) => (
        i === next.currentRoomIndex ? finalizeRoom(r, next) : r
      )),
    };
    return advanceAfterRoomDetails(
      filled,
      folders,
      'Copied height, temperature, floor, ceiling, and wall finishes from the previous room.'
    );
  }
  return {
    draft: next,
    phase: PHASES.ROOM_DETAILS,
    messages: [
      bot('Copied the other details from the previous room. I still need this room’s size.'),
      askRoomDetails(next),
    ],
  };
}

/** Start collecting room details — auto-fit a single room to the full project site. */
function askConfirm(draft, folders = []) {
  return bot(
    `Please confirm this plan:\n\n${buildSummary(draft, folders)}\n\n` +
      'Reply **create** to build the project (rooms, walls, floor, and ceiling). ' +
      'Joints will not be created. Or **restart** to start over.'
  );
}

function advanceAfterRoomDetails(draft, folders = [], copiedNote = null) {
  const rooms = draft.rooms.map((room, i) => (
    i === draft.currentRoomIndex ? finalizeRoom(room, draft) : room
  ));
  const next = { ...draft, rooms };
  return continueDraft(next, folders, copiedNote);
}

/**
 * Process one user message against conversation state.
 * @param {object} [options]
 * @param {Array} [options.folders]
 * @param {boolean} [options.foldersAvailable]
 * @returns {{ draft, phase, messages: Array, readyToCreate?: boolean }}
 */
export function processChatMessage(phase, draft, userText, options = {}) {
  const folders = Array.isArray(options.folders) ? options.folders : [];
  const canUseFolders = options.foldersAvailable !== false;

  const text = normalizeChatText(userText);
  const lower = text.toLowerCase();

  if (!text) {
    return { draft, phase, messages: [bot('Please type a reply so I can continue.')] };
  }

  if (lower === 'restart' || lower === 'reset' || lower === 'start over') {
    const fresh = createInitialDraft();
    return {
      draft: fresh,
      phase: PHASES.WELCOME,
      messages: [
        bot("Okay, let's start fresh. Ask me to create a project whenever you're ready."),
        ...getWelcomeMessages(),
      ],
    };
  }

  // --- WELCOME / free-form kickoff ---
  if (phase === PHASES.WELCOME || phase === PHASES.DONE) {
    if (isUsageHelpIntent(text) && !isCreateProjectIntent(text)) {
      return {
        draft: phase === PHASES.DONE ? createInitialDraft() : draft,
        phase: PHASES.WELCOME,
        messages: /example/i.test(lower) ? getExampleMessages() : getWelcomeMessages(),
      };
    }
    if (/^(hi|hello|hey)$/i.test(lower)) {
      return {
        draft: phase === PHASES.DONE ? createInitialDraft() : draft,
        phase: PHASES.WELCOME,
        messages: getWelcomeMessages(),
      };
    }

    let next = phase === PHASES.DONE ? createInitialDraft() : { ...createInitialDraft(), ...draft };
    next = harvestDraft(next, text, folders, canUseFolders, PHASES.WELCOME);

    if (isCreateNewFolderIntent(text) && !next.folderDecided && canUseFolders) {
      return startNewFolderFlow(next, text, folders);
    }

    if (extractFolderMention(text) && !next.folderDecided && canUseFolders) {
      const guess = folderNameGuess(text);
      if (guess) return offerCreateMissingFolder(next, guess, folders);
      return {
        draft: next,
        phase: PHASES.FOLDER,
        messages: [
          bot("I couldn't match that folder."),
          askFolder(folders),
        ],
      };
    }

    const preface = isCreateProjectIntent(text) || next.name || !missingProjectSize(next) || next.folderDecided
      ? (next.folderDecided
        ? `Sure — I'll create a project in **${next.folderLabel}**.`
        : 'Sure — I can help you create a project.')
      : null;

    return ensureFolderOrContinue(next, folders, canUseFolders, preface);
  }

  // --- FOLDER ---
  if (phase === PHASES.FOLDER) {
    const harvested = harvestDraft(draft, text, folders, canUseFolders, phase);
    if (harvested.folderDecided) {
      const note = harvested.newFolderName
        ? `I'll **create a new folder** **${harvested.newFolderName}** and put the project there.`
        : `Got it — I'll **place it** in **${harvested.folderLabel}**.`;
      return continueDraft(harvested, folders, note);
    }
    if (!canUseFolders) {
      const next = applyFolderChoice(draft, { key: 'uncategorized', label: 'Uncategorized' });
      return continueDraft(next, folders, 'Folders are unavailable, so I will leave it uncategorized.');
    }
    if (isCreateNewFolderIntent(text)) {
      return startNewFolderFlow(harvested, text, folders);
    }
    const guess = folderNameGuess(text);
    if (guess) return offerCreateMissingFolder(harvested, guess, folders);
    return {
      draft: harvested,
      phase: PHASES.FOLDER,
      messages: [
        bot("I need a placement: an **existing folder**, **Create new folder**, or **uncategorized**."),
        askFolder(folders),
      ],
    };
  }

  // --- NEW FOLDER NAME ---
  if (phase === PHASES.FOLDER_NEW) {
    const harvested = harvestDraft(draft, text, folders, canUseFolders, PHASES.FOLDER_NEW);
    if (harvested.folderDecided) {
      const note = harvested.newFolderName
        ? `I'll **create a new folder** **${harvested.newFolderName}** and put the project there.`
        : `Got it — I'll **place it** in **${harvested.folderLabel}**.`;
      return continueDraft(harvested, folders, note);
    }
    if (/^(uncategorized|skip|cancel|none)$/i.test(lower)) {
      const next = applyFolderChoice(harvested, { key: 'uncategorized', label: 'Uncategorized' });
      return continueDraft(next, folders, "Okay — I'll leave it uncategorized.");
    }
    if (isCreateNewFolderIntent(text) && !extractNewFolderName(text)) {
      return {
        draft: harvested,
        phase: PHASES.FOLDER_NEW,
        messages: [askNewFolderName()],
      };
    }
    const named = extractNewFolderName(text) || folderNameGuess(text);
    if (named) {
      const next = applyNewFolderChoice(harvested, named);
      return continueDraft(next, folders, `I'll **create a new folder** **${named}** and put the project there.`);
    }
    return {
      draft: harvested,
      phase: PHASES.FOLDER_NEW,
      messages: [
        bot("Please type a folder name, or tap an existing folder to place the project there instead."),
        askNewFolderName(),
      ],
    };
  }

  // --- PROJECT NAME ---
  if (phase === PHASES.PROJECT_NAME) {
    const harvested = harvestDraft(draft, text, folders, canUseFolders, phase);
    if (!harvested.name) {
      return { draft: harvested, phase, messages: [bot('Please give a project name (e.g. `Cold Store Alpha`).')] };
    }
    return continueDraft(harvested, folders, `Project name set to **${harvested.name}**.`);
  }

  // --- PROJECT SIZE ---
  if (phase === PHASES.PROJECT_SIZE) {
    let next = harvestDraft(draft, text, folders, canUseFolders, phase);
    const size = parseProjectSize(text) || parseDimensionPair(text);
    if (size) next = applyProjectSize(next, size);

    const wMatch = text.match(/width\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i);
    const lMatch = text.match(/length\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i);
    const hMatch = text.match(/height\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i);
    if (wMatch) next.width = parseSingleDimension(`${wMatch[1]}${wMatch[2] || ''}`) ?? next.width;
    if (lMatch) next.length = parseSingleDimension(`${lMatch[1]}${lMatch[2] || ''}`) ?? next.length;
    if (hMatch) next.height = parseSingleDimension(`${hMatch[1]}${hMatch[2] || ''}`) ?? next.height;

    if (missingProjectSize(next)) {
      const nums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(m|mm|cm)?/gi)];
      if (nums.length >= 3) {
        next.width = parseSingleDimension(`${nums[0][1]}${nums[0][2] || ''}`);
        next.length = parseSingleDimension(`${nums[1][1]}${nums[1][2] || ''}`);
        next.height = parseSingleDimension(`${nums[2][1]}${nums[2][2] || ''}`);
      }
    }

    if (missingProjectSize(next)) {
      return { draft: next, phase: PHASES.PROJECT_SIZE, messages: [askProjectSize(next)] };
    }
    return continueDraft(
      next,
      folders,
      `Site size set to ${formatMm(next.width)} × ${formatMm(next.length)}, height ${formatMm(next.height)}.`
    );
  }

  // --- WALL THICKNESS (optional leftover step) ---
  if (phase === PHASES.WALL_THICKNESS) {
    let next = harvestDraft(draft, text, folders, canUseFolders, phase);
    let thickness = next.wall_thickness || 100;
    if (/default|skip|ok|same/i.test(lower)) {
      thickness = 100;
    } else {
      const parsed = parseThicknessMm(text) ?? extractWallThickness(text);
      if (parsed != null && parsed > 0) thickness = parsed;
    }
    next = { ...next, wall_thickness: thickness, wallThicknessDecided: true };
    return continueDraft(next, folders, `Wall thickness ${formatThicknessMm(thickness)}.`);
  }

  // --- ROOM INTENT ---
  if (phase === PHASES.ROOM_INTENT) {
    const harvested = harvestDraft(draft, text, folders, canUseFolders, phase);
    const yesNo = parseYesNo(text);
    const count = parseRoomCount(text);

    if (yesNo === false || count === 0) {
      return continueDraft({ ...harvested, skipRooms: true, rooms: [] }, folders);
    }
    if (harvested.rooms.length > 0) {
      return continueDraft(harvested, folders, `Great — ${harvested.rooms.length} room(s).`);
    }
    if (count === 1) {
      return continueDraft({
        ...harvested,
        rooms: [createEmptyRoom('Room 1')],
        currentRoomIndex: 0,
        skipRooms: false,
      }, folders, 'Okay — **1 room**.');
    }
    if (count != null && count > 1) {
      const rooms = Array.from({ length: count }, (_, i) => createEmptyRoom(`Room ${i + 1}`));
      return {
        draft: { ...harvested, rooms, currentRoomIndex: 0, skipRooms: false },
        phase: PHASES.ROOM_NAMES,
        messages: [
          bot(`Okay, ${count} rooms. Rename them now, or say **keep** to use Room 1…Room ${count}.`),
          askRoomNames(),
        ],
      };
    }
    if (yesNo === true) {
      return { draft: harvested, phase: PHASES.ROOM_NAMES, messages: [askRoomNames()] };
    }
    return {
      draft: harvested,
      phase,
      messages: [bot('Please reply with room names (`CHILLER, EXT HT`), **yes** + a count, or **no**.')],
    };
  }

  // --- ROOM NAMES ---
  if (phase === PHASES.ROOM_NAMES) {
    const harvested = harvestDraft(draft, text, folders, canUseFolders, phase);
    if (harvested.rooms.length && harvested.rooms.some((r) => r.width && r.length)) {
      return continueDraft(harvested, folders);
    }
    let rooms = harvested.rooms;
    if (!/^(keep|ok|same|default)$/i.test(lower)) {
      const names = extractRoomNames(text);
      if (!names.length && !rooms.length) {
        return { draft: harvested, phase, messages: [askRoomNames()] };
      }
      if (names.length) rooms = names.map((n) => createEmptyRoom(n));
    } else if (!rooms.length) {
      return { draft: harvested, phase, messages: [askRoomNames()] };
    }
    return continueDraft(
      { ...harvested, rooms, currentRoomIndex: 0, skipRooms: false },
      folders,
      `Rooms: ${rooms.map((r) => r.name).join(', ')}.`
    );
  }

  // --- PER-ROOM DETAILS (one message per room, or a dump of all rooms) ---
  if (ROOM_DETAIL_PHASES.includes(phase)) {
    const copied = tryCopyPrevious(draft, text, folders, { copySize: false });
    if (copied) return copied;

    let next = harvestDraft(draft, text, folders, canUseFolders, phase);
    const spec = parseRoomDetailsFromText(text);
    const rooms = [...next.rooms];
    const idx = next.currentRoomIndex;
    if (rooms[idx]) {
      rooms[idx] = applySpecToRoom(rooms[idx], spec, next);
      if (/^(ok|okay|defaults|default|same)$/i.test(lower) && next.width && next.length && rooms.length === 1) {
        rooms[idx] = {
          ...rooms[idx],
          width: rooms[idx].width || next.width,
          length: rooms[idx].length || next.length,
        };
      }
    }
    next = { ...next, rooms };

    if (!rooms[idx]?.width || !rooms[idx]?.length) {
      return {
        draft: next,
        phase: PHASES.ROOM_DETAILS,
        messages: [
          bot("I still need this room’s size. Example: `3050 × 8500` or `3050 × 8500, height 6000, 2 to 6°C, slab 100`."),
          askRoomDetails(next),
        ],
      };
    }

    rooms[idx] = finalizeRoom(rooms[idx], next);
    next = { ...next, rooms };
    return continueDraft(next, folders);
  }


  // --- CONFIRM ---
  if (phase === PHASES.CONFIRM) {
    if (/^(create|confirm|yes|go|build|ok)\b/i.test(lower)) {
      const layout = arrangeRooms(
        draft.rooms.map((r) => ({ name: r.name, width: r.width, length: r.length })),
        draft.width,
        draft.length
      );
      if (!draft.skipRooms && draft.rooms.length && layout.overflow) {
        return {
          draft,
          phase: PHASES.CONFIRM,
          messages: [
            bot(
              `${layout.message}\n\nAdjust project size or room sizes, then say **create** again — or **restart**.`
            ),
          ],
        };
      }
      if (!draft.folderDecided && canUseFolders) {
        return ensureFolderOrContinue(draft, folders, canUseFolders, 'One more thing before creating:');
      }
      if (!draft.folderDecided) {
        const next = applyFolderChoice(draft, { key: 'uncategorized', label: 'Uncategorized' });
        return {
          draft: next,
          phase: PHASES.CREATING,
          messages: [bot('Creating your project, placing rooms, and generating floor and ceiling (no joints)…')],
          readyToCreate: true,
        };
      }
      return {
        draft,
        phase: PHASES.CREATING,
        messages: [bot('Creating your project, placing rooms, and generating floor and ceiling (no joints)…')],
        readyToCreate: true,
      };
    }
    return {
      draft,
      phase,
      messages: [bot('Reply **create** to build the project, or **restart** to begin again.')],
    };
  }

  if (phase === PHASES.CREATING) {
    return { draft, phase, messages: [bot('Still creating — please wait a moment.')] };
  }

  return {
    draft,
    phase: PHASES.WELCOME,
    messages: getWelcomeMessages(),
  };
}
