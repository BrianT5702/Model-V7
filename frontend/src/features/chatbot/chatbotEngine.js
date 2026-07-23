import {
  CHAT_OPTIONS,
  extractFolderMention,
  extractProjectName,
  extractRoomNames,
  isCreateProjectIntent,
  isFollowProjectSize,
  parseDimensionPair,
  parseFaceMaterial,
  parseFloorThickness,
  parseThicknessMm,
  parseFloorType,
  parseProjectSize,
  parseRoomCount,
  parseSingleDimension,
  parseYesNo,
  resolveFolderChoice,
  buildFolderPaths,
  getSortedFolderEntries,
} from './parseChatMessage';
import { arrangeRooms } from './roomLayoutEngine';
import { UNCATEGORIZED_KEY, getFolderPath } from '../project/projectFolderUtils';

export const PHASES = {
  WELCOME: 'welcome',
  FOLDER: 'folder',
  PROJECT_NAME: 'project_name',
  PROJECT_SIZE: 'project_size',
  WALL_THICKNESS: 'wall_thickness',
  ROOM_INTENT: 'room_intent',
  ROOM_NAMES: 'room_names',
  ROOM_SIZE: 'room_size',
  ROOM_HEIGHT: 'room_height',
  ROOM_FLOOR: 'room_floor',
  ROOM_FLOOR_THICKNESS: 'room_floor_thickness',
  ROOM_CEILING: 'room_ceiling',
  ROOM_WALLS: 'room_walls',
  CONFIRM: 'confirm',
  CREATING: 'creating',
  DONE: 'done',
};

export function createInitialDraft() {
  return {
    name: '',
    width: null,
    length: null,
    height: null,
    wall_thickness: 200,
    rooms: [],
    currentRoomIndex: 0,
    skipRooms: false,
    folderKey: null,
    folderLabel: null,
    folderDecided: false,
  };
}

export function createEmptyRoom(name = '') {
  return {
    name: name || '',
    width: null,
    length: null,
    height: null,
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
    ? (draft.folderLabel
      || getFolderPath(draft.folderKey ?? UNCATEGORIZED_KEY, folders)
      || 'Uncategorized')
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
      lines.push(
        `  ${i + 1}. ${room.name} — ${formatMm(room.width)} × ${formatMm(room.length)}, ` +
          `height ${formatMm(room.height)}, floor ${room.floor_type}/${formatThicknessMm(room.floor_thickness)}, ` +
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
          `(site ${formatMm(draft.width)} × ${formatMm(draft.length)}). Shared walls will be reused.`
      );
    }
  }

  return lines.join('\n');
}

export function getWelcomeMessages() {
  return [
    bot(
      "Hi! Ask me to **create a project** and I'll walk you through it.\n\n" +
        "Examples:\n" +
        "• *Help me create a project*\n" +
        "• *Create a project and place it under folder Cold Stores*\n" +
        "• *Help me create project Alpha, site 24m × 12m × 6m, under folder Clients*\n\n" +
        "If you don't say where to put it, I'll ask which folder to use."
    ),
  ];
}

function formatFolderList(folders) {
  if (!folders.length) {
    return '• Uncategorized (no folders yet)';
  }
  const entries = getSortedFolderEntries(folders);
  const lines = entries.map((e, i) => `• **${i + 1}.** ${e.path}`);
  lines.push('• Or say **uncategorized** for no folder');
  return lines.join('\n');
}

function askFolder(folders = []) {
  return bot(
    "Where should I **place this project**?\n\n" +
      `${formatFolderList(folders)}\n\n` +
      'Reply with a folder path (e.g. `Brian/2025`), number, or **uncategorized**.'
  );
}

function applyFolderChoice(draft, choice) {
  if (!choice) return draft;
  return {
    ...draft,
    folderKey: choice.key === 'uncategorized' ? UNCATEGORIZED_KEY : choice.key,
    folderLabel: choice.label,
    folderDecided: true,
  };
}

function tryApplyFolderFromText(draft, text, folders, foldersAvailable) {
  if (!foldersAvailable) {
    return applyFolderChoice(draft, { key: 'uncategorized', label: 'Uncategorized' });
  }
  const choice = resolveFolderChoice(text, folders);
  if (choice) return applyFolderChoice(draft, choice);
  // Mentioned a folder name that didn't resolve — keep undecided
  if (extractFolderMention(text)) return draft;
  return draft;
}

function nextAfterFolder(draft, preface = null) {
  const messages = [];
  if (preface) messages.push(bot(preface));

  if (!draft.name) {
    messages.push(askProjectName());
    return { draft, phase: PHASES.PROJECT_NAME, messages };
  }
  if (missingProjectSize(draft)) {
    messages.push(askProjectSize(draft));
    return { draft, phase: PHASES.PROJECT_SIZE, messages };
  }
  messages.push(askWallThickness());
  return { draft, phase: PHASES.WALL_THICKNESS, messages };
}

function ensureFolderOrContinue(draft, folders, foldersAvailable, preface = null) {
  if (!foldersAvailable) {
    const next = applyFolderChoice(draft, { key: 'uncategorized', label: 'Uncategorized' });
    return nextAfterFolder(next, preface);
  }
  if (draft.folderDecided) {
    const folderNote = preface
      || `Okay — I'll put it in **${draft.folderLabel || getFolderPath(draft.folderKey, folders)}**.`;
    return nextAfterFolder(draft, folderNote);
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

function askWallThickness() {
  return bot(
    'What **wall thickness** should we use? (mm)\nReply with a number, or say **default** for 200 mm.'
  );
}

function askRoomIntent() {
  return bot(
    'Do you want me to create **rooms** inside this project?\n' +
      'Reply **yes** (and optionally how many / names), or **no** for site + boundary walls only.'
  );
}

function askRoomNames() {
  return bot(
    'List the **room names**, separated by commas.\nExample: `Freezer, Chiller, Packing`'
  );
}

function askRoomSize(draft) {
  const projectHint = draft.width && draft.length
    ? `\nOr say **follow the project size** to use ${formatMm(draft.width)} × ${formatMm(draft.length)}.`
    : '';
  return bot(
    `${roomPromptPrefix(draft)}: what is the **floor plan size** (width × length)?\n` +
      `Example: \`8000 × 6000\` or \`8m × 6m\`.${projectHint}`
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

/** Start collecting room details — auto-fit a single room to the full project site. */
function beginRoomDetails(draft, preface = null) {
  const messages = [];
  if (preface) messages.push(bot(preface));

  if (draft.rooms.length === 1 && draft.width && draft.length) {
    const next = fillRoomWithProjectSize(draft, 0);
    messages.push(bot(
      `Since there's only **one room**, I'll fit it to the whole project site ` +
        `(${formatMm(next.width)} × ${formatMm(next.length)}).`
    ));
    messages.push(askRoomHeight(next));
    return { draft: next, phase: PHASES.ROOM_HEIGHT, messages };
  }

  messages.push(askRoomSize(draft));
  return { draft, phase: PHASES.ROOM_SIZE, messages };
}

function askRoomHeight(draft) {
  const fallback = draft.height ? ` (project height is ${formatMm(draft.height)})` : '';
  return bot(
    `${roomPromptPrefix(draft)}: what is the **room height**?${fallback}\n` +
      'Example: `4500` or `4.5m`, or say **same** to use the project height.'
  );
}

function askRoomFloor(draft) {
  return bot(
    `${roomPromptPrefix(draft)}: what is the **floor identity**?\n` +
      `Choose: ${CHAT_OPTIONS.FLOOR_TYPES.join(', ')}`
  );
}

function askRoomFloorThickness(draft) {
  return bot(
    `${roomPromptPrefix(draft)}: what is the **floor thickness** (mm)?\n` +
      `Typical options: ${CHAT_OPTIONS.FLOOR_THICKNESSES.join(', ')}\n` +
      'Use `0` for none.'
  );
}

function askRoomCeiling(draft) {
  return bot(
    `${roomPromptPrefix(draft)}: should this room **include a ceiling**?\n` +
      'Reply **yes** or **no** (no = exclude from ceiling generation).'
  );
}

function askRoomWalls(draft) {
  return bot(
    `${roomPromptPrefix(draft)}: wall face materials (**inner / outer**)?\n` +
      `Options: ${CHAT_OPTIONS.FACE_MATERIALS.join(', ')}\n` +
      'Example: `PPGI / PPGI` or say **default**.'
  );
}

function askConfirm(draft, folders = []) {
  return bot(
    `Please confirm this plan:\n\n${buildSummary(draft, folders)}\n\n` +
      'Reply **create** to build it, or **restart** to start over.'
  );
}

function advanceAfterRoomWalls(draft, folders = []) {
  const nextIndex = draft.currentRoomIndex + 1;
  if (nextIndex < draft.rooms.length) {
    return beginRoomDetails(
      { ...draft, currentRoomIndex: nextIndex },
      `Next room (${nextIndex + 1}/${draft.rooms.length}).`
    );
  }
  return {
    draft,
    phase: PHASES.CONFIRM,
    messages: [askConfirm(draft, folders)],
  };
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

  const text = String(userText || '').trim();
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
    let next = { ...createInitialDraft(), ...draft };
    // Reset done-state draft into a fresh create attempt when user speaks again
    if (phase === PHASES.DONE) {
      next = createInitialDraft();
    }

    next = tryApplyFolderFromText(next, text, folders, canUseFolders);

    const name = extractProjectName(text);
    const size = parseProjectSize(text);
    const roomNames = extractRoomNames(text);
    const roomCount = parseRoomCount(text);
    const createIntent = isCreateProjectIntent(text);

    if (name) next.name = name;
    if (size) next = applyProjectSize(next, size);

    if (roomNames.length > 1 || (roomNames.length === 1 && /room/i.test(text))) {
      next.rooms = roomNames.map((n) => createEmptyRoom(n));
      next.currentRoomIndex = 0;
    } else if (roomCount != null && roomCount > 0) {
      next.rooms = Array.from({ length: roomCount }, (_, i) => createEmptyRoom(`Room ${i + 1}`));
      next.currentRoomIndex = 0;
    }

    // Vague greeting without create intent
    if (!createIntent && !name && !size && !next.folderDecided
      && /^(hi|hello|hey)$/i.test(lower)) {
      return {
        draft: next,
        phase: PHASES.WELCOME,
        messages: getWelcomeMessages(),
      };
    }

    // Folder mentioned but not matched
    if (extractFolderMention(text) && !next.folderDecided && canUseFolders) {
      return {
        draft: next,
        phase: PHASES.FOLDER,
        messages: [
          bot("I couldn't match that folder. Try the full path, e.g. `Brian/2025`."),
          askFolder(folders),
        ],
      };
    }

    const preface = createIntent || name || size || next.folderDecided
      ? (next.folderDecided
        ? `Sure — I'll create a project in **${next.folderLabel}**.`
        : 'Sure — I can help you create a project.')
      : null;

    return ensureFolderOrContinue(next, folders, canUseFolders, preface);
  }

  // --- FOLDER ---
  if (phase === PHASES.FOLDER) {
    if (!canUseFolders) {
      const next = applyFolderChoice(draft, { key: 'uncategorized', label: 'Uncategorized' });
      return nextAfterFolder(next, 'Folders are unavailable, so I will leave it uncategorized.');
    }

    const choice = resolveFolderChoice(text, folders);
    if (!choice) {
      return {
        draft,
        phase: PHASES.FOLDER,
        messages: [
          bot("I couldn't match that. Use a full path like `Brian/2025`, pick a number, or say **uncategorized**."),
          askFolder(folders),
        ],
      };
    }

    const next = applyFolderChoice(draft, choice);
    return nextAfterFolder(
      next,
      `Got it — project will go in **${choice.label}**.`
    );
  }

  // --- PROJECT NAME ---
  if (phase === PHASES.PROJECT_NAME) {
    const name = extractProjectName(text);
    if (!name) {
      return { draft, phase, messages: [bot('Please give a project name (e.g. `Cold Store Alpha`).')] };
    }
    let next = { ...draft, name };
    next = tryApplyFolderFromText(next, text, folders, canUseFolders);
    const size = parseProjectSize(text);
    if (size) next = applyProjectSize(next, size);

    if (!next.folderDecided && canUseFolders) {
      return ensureFolderOrContinue(next, folders, canUseFolders, `Project name set to **${name}**.`);
    }

    if (missingProjectSize(next)) {
      return {
        draft: next,
        phase: PHASES.PROJECT_SIZE,
        messages: [bot(`Project name set to **${name}**.`), askProjectSize(next)],
      };
    }
    return {
      draft: next,
      phase: PHASES.WALL_THICKNESS,
      messages: [bot(`Project **${name}** noted.`), askWallThickness()],
    };
  }

  // --- PROJECT SIZE (must ask if missing) ---
  if (phase === PHASES.PROJECT_SIZE) {
    let next = { ...draft };
    const size = parseProjectSize(text) || parseDimensionPair(text);
    if (size) next = applyProjectSize(next, size);

    // Allow "width 24m, length 12m, height 6m"
    const wMatch = text.match(/width\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i);
    const lMatch = text.match(/length\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i);
    const hMatch = text.match(/height\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(m|mm|cm)?/i);
    if (wMatch) next.width = parseSingleDimension(`${wMatch[1]}${wMatch[2] || ''}`) ?? next.width;
    if (lMatch) next.length = parseSingleDimension(`${lMatch[1]}${lMatch[2] || ''}`) ?? next.length;
    if (hMatch) next.height = parseSingleDimension(`${hMatch[1]}${hMatch[2] || ''}`) ?? next.height;

    // Three bare numbers
    if (missingProjectSize(next)) {
      const nums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(m|mm|cm)?/gi)];
      if (nums.length >= 3) {
        next.width = parseSingleDimension(`${nums[0][1]}${nums[0][2] || ''}`);
        next.length = parseSingleDimension(`${nums[1][1]}${nums[1][2] || ''}`);
        next.height = parseSingleDimension(`${nums[2][1]}${nums[2][2] || ''}`);
      }
    }

    if (missingProjectSize(next)) {
      return {
        draft: next,
        phase: PHASES.PROJECT_SIZE,
        messages: [askProjectSize(next)],
      };
    }

    return {
      draft: next,
      phase: PHASES.WALL_THICKNESS,
      messages: [
        bot(
          `Site size set to ${formatMm(next.width)} × ${formatMm(next.length)}, height ${formatMm(next.height)}.`
        ),
        askWallThickness(),
      ],
    };
  }

  // --- WALL THICKNESS ---
  if (phase === PHASES.WALL_THICKNESS) {
    let thickness = draft.wall_thickness || 200;
    if (/default|skip|ok|same/i.test(lower)) {
      thickness = 200;
    } else {
      const parsed = parseThicknessMm(text);
      if (parsed == null || parsed <= 0) {
        return {
          draft,
          phase,
          messages: [bot('Please enter a wall thickness in mm (e.g. `150`), or **default**.')],
        };
      }
      thickness = parsed;
    }
    const next = { ...draft, wall_thickness: thickness };

    if (next.rooms.length > 0) {
      return beginRoomDetails(
        { ...next, currentRoomIndex: 0 },
        `Wall thickness ${formatMm(thickness)}. I'll collect details for each room.`
      );
    }

    return {
      draft: next,
      phase: PHASES.ROOM_INTENT,
      messages: [bot(`Wall thickness ${formatMm(thickness)}.`), askRoomIntent()],
    };
  }

  // --- ROOM INTENT ---
  if (phase === PHASES.ROOM_INTENT) {
    const yesNo = parseYesNo(text);
    const count = parseRoomCount(text);
    const names = extractRoomNames(text);

    if (yesNo === false || count === 0) {
      const next = { ...draft, skipRooms: true, rooms: [] };
      return {
        draft: next,
        phase: PHASES.CONFIRM,
        messages: [askConfirm(next, folders)],
      };
    }

    // Prefer explicit count ("yes, 2 rooms") over accidental name parsing
    if (count === 1) {
      const next = {
        ...draft,
        rooms: [createEmptyRoom('Room 1')],
        currentRoomIndex: 0,
        skipRooms: false,
      };
      return beginRoomDetails(next, 'Okay — **1 room**.');
    }

    if (count != null && count > 1) {
      const rooms = Array.from({ length: count }, (_, i) => createEmptyRoom(`Room ${i + 1}`));
      const next = { ...draft, rooms, currentRoomIndex: 0, skipRooms: false };
      return {
        draft: next,
        phase: PHASES.ROOM_NAMES,
        messages: [
          bot(`Okay, ${count} rooms. You can rename them now, or say **keep** to use Room 1…Room ${count}.`),
          askRoomNames(),
        ],
      };
    }

    if (names.length > 0 && yesNo !== false) {
      const rooms = names.map((n) => createEmptyRoom(n));
      const next = { ...draft, rooms, currentRoomIndex: 0, skipRooms: false };
      return beginRoomDetails(next, `Great — ${rooms.length} room(s).`);
    }

    if (yesNo === true) {
      return {
        draft,
        phase: PHASES.ROOM_NAMES,
        messages: [askRoomNames()],
      };
    }

    return {
      draft,
      phase,
      messages: [bot('Please reply **yes** (with room count/names) or **no**.')],
    };
  }

  // --- ROOM NAMES ---
  if (phase === PHASES.ROOM_NAMES) {
    let rooms = draft.rooms;
    if (!/^(keep|ok|same|default)$/i.test(lower)) {
      const names = extractRoomNames(text);
      if (!names.length) {
        return { draft, phase, messages: [askRoomNames()] };
      }
      rooms = names.map((n) => createEmptyRoom(n));
    } else if (!rooms.length) {
      return { draft, phase, messages: [askRoomNames()] };
    }

    const next = { ...draft, rooms, currentRoomIndex: 0, skipRooms: false };
    return beginRoomDetails(next, `Rooms: ${rooms.map((r) => r.name).join(', ')}.`);
  }

  // --- PER-ROOM FIELDS ---
  if (phase === PHASES.ROOM_SIZE) {
    let dims = parseDimensionPair(text);
    if (!dims && isFollowProjectSize(text)) {
      if (draft.width == null || draft.length == null) {
        return {
          draft,
          phase,
          messages: [
            bot('Project size is not set yet, so I need an explicit room size (e.g. `8m × 6m`).'),
            askRoomSize(draft),
          ],
        };
      }
      dims = { width: draft.width, length: draft.length };
    }
    if (!dims) {
      return {
        draft,
        phase,
        messages: [
          bot("I didn't catch a size. Reply like `8m × 6m`, or say **follow the project size**."),
          askRoomSize(draft),
        ],
      };
    }
    const rooms = [...draft.rooms];
    rooms[draft.currentRoomIndex] = {
      ...rooms[draft.currentRoomIndex],
      width: dims.width,
      length: dims.length,
    };
    const next = { ...draft, rooms };
    const note = isFollowProjectSize(text)
      ? bot(`Using the project size: ${formatMm(dims.width)} × ${formatMm(dims.length)}.`)
      : null;
    return {
      draft: next,
      phase: PHASES.ROOM_HEIGHT,
      messages: note ? [note, askRoomHeight(next)] : [askRoomHeight(next)],
    };
  }

  if (phase === PHASES.ROOM_HEIGHT) {
    let height = null;
    if (/^(same|default|project)$/i.test(lower)) {
      height = draft.height;
    } else {
      height = parseSingleDimension(text);
    }
    if (height == null || height <= 0) {
      return { draft, phase, messages: [askRoomHeight(draft)] };
    }
    const rooms = [...draft.rooms];
    rooms[draft.currentRoomIndex] = { ...rooms[draft.currentRoomIndex], height };
    const next = { ...draft, rooms };
    return {
      draft: next,
      phase: PHASES.ROOM_FLOOR,
      messages: [askRoomFloor(next)],
    };
  }

  if (phase === PHASES.ROOM_FLOOR) {
    const floorType = parseFloorType(text);
    if (!floorType) {
      return { draft, phase, messages: [askRoomFloor(draft)] };
    }
    const rooms = [...draft.rooms];
    rooms[draft.currentRoomIndex] = { ...rooms[draft.currentRoomIndex], floor_type: floorType };
    const next = { ...draft, rooms };
    if (floorType === 'None') {
      rooms[draft.currentRoomIndex].floor_thickness = 0;
      return {
        draft: { ...next, rooms },
        phase: PHASES.ROOM_CEILING,
        messages: [askRoomCeiling({ ...next, rooms })],
      };
    }
    return {
      draft: next,
      phase: PHASES.ROOM_FLOOR_THICKNESS,
      messages: [askRoomFloorThickness(next)],
    };
  }

  if (phase === PHASES.ROOM_FLOOR_THICKNESS) {
    const thickness = parseFloorThickness(text);
    if (thickness == null || thickness < 0) {
      return { draft, phase, messages: [askRoomFloorThickness(draft)] };
    }
    const rooms = [...draft.rooms];
    rooms[draft.currentRoomIndex] = {
      ...rooms[draft.currentRoomIndex],
      floor_thickness: thickness,
    };
    const next = { ...draft, rooms };
    return {
      draft: next,
      phase: PHASES.ROOM_CEILING,
      messages: [askRoomCeiling(next)],
    };
  }

  if (phase === PHASES.ROOM_CEILING) {
    const include = parseYesNo(text);
    if (include == null) {
      return { draft, phase, messages: [askRoomCeiling(draft)] };
    }
    const rooms = [...draft.rooms];
    rooms[draft.currentRoomIndex] = {
      ...rooms[draft.currentRoomIndex],
      include_ceiling: include,
    };
    const next = { ...draft, rooms };
    return {
      draft: next,
      phase: PHASES.ROOM_WALLS,
      messages: [askRoomWalls(next)],
    };
  }

  if (phase === PHASES.ROOM_WALLS) {
    let inner = 'PPGI';
    let outer = 'PPGI';
    if (!/^(default|same|ok)$/i.test(lower)) {
      const parts = text.split(/\/|,| and | & /i).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        inner = parseFaceMaterial(parts[0]) || null;
        outer = parseFaceMaterial(parts[1]) || null;
      } else {
        const one = parseFaceMaterial(text);
        if (one) {
          inner = one;
          outer = one;
        } else {
          return { draft, phase, messages: [askRoomWalls(draft)] };
        }
      }
      if (!inner || !outer) {
        return { draft, phase, messages: [askRoomWalls(draft)] };
      }
    }
    const rooms = [...draft.rooms];
    rooms[draft.currentRoomIndex] = {
      ...rooms[draft.currentRoomIndex],
      inner_face_material: inner,
      outer_face_material: outer,
    };
    return advanceAfterRoomWalls({ ...draft, rooms }, folders);
  }

  // --- CONFIRM ---
  if (phase === PHASES.CONFIRM) {
    if (/^(create|confirm|yes|go|build|ok)$/i.test(lower)) {
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
          messages: [bot('Creating your project and arranging rooms…')],
          readyToCreate: true,
        };
      }
      return {
        draft,
        phase: PHASES.CREATING,
        messages: [bot('Creating your project and arranging rooms…')],
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
