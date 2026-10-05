const DOOR_FAMILIES = {
    swing: { code: 'SW', label: 'Swing' },
    slide: { code: 'SD', label: 'Sliding' },
    dock: { code: 'DS', label: 'Dock' },
};

const FAMILY_ORDER = ['swing', 'slide', 'dock'];

export function isDoubleConfiguration(configuration) {
    return String(configuration || '').toLowerCase().includes('double');
}

export function openingLabel(door) {
    if (!door || door.door_type === 'dock') return '—';
    return isDoubleConfiguration(door.configuration) ? 'Double' : 'Single';
}

/**
 * Doors that share type, opening, and size are one configuration.
 * Swing direction and install side stay on the plan graphic, not in the type.
 */
export function doorConfigurationKey(door) {
    const type = DOOR_FAMILIES[door?.door_type] ? door.door_type : 'swing';
    const width = Math.round(Number(door?.width) || 0);
    const height = Math.round(Number(door?.height) || 0);
    const thickness = Math.round(Number(door?.thickness) || 0);
    if (type === 'dock') {
        return `dock|${width}|${height}|${thickness}`;
    }
    const opening = isDoubleConfiguration(door?.configuration) ? 'double' : 'single';
    return `${type}|${opening}|${width}|${height}|${thickness}`;
}

function doorIdNumber(door) {
    const id = Number(door?.id ?? door?.pk);
    return Number.isFinite(id) ? id : Number.MAX_SAFE_INTEGER;
}

function familyOf(door) {
    return DOOR_FAMILIES[door?.door_type] ? door.door_type : 'swing';
}

/** Hue for a door type so different configurations read as different colors. */
export function doorMarkColor(typeNumber, family) {
    const familyShift = family === 'slide' ? 28 : family === 'dock' ? 56 : 0;
    const hue = Math.round((familyShift + (Math.max(1, typeNumber) - 1) * 47) % 360);
    return `hsl(${hue}, 72%, 38%)`;
}

/** SW1-1, SW1-2 - SW1-6 for one configuration on a door list. */
export function formatDoorMarkRun(code, count) {
    const n = Math.max(0, Number(count) || 0);
    if (n <= 1) return `${code}-1`;
    if (n === 2) return `${code}-1, ${code}-2`;
    return `${code}-1, ${code}-2 - ${code}-${n}`;
}

/**
 * SW1 / 2 on the plan is swing type 1, the 2nd door of that configuration.
 * The list writes that as SW1-2. Double swing is DSW, double sliding is DSD.
 * Type numbers restart for each prefix.
 */
export function buildDoorSchedule(doors) {
    const list = Array.isArray(doors) ? doors.filter(Boolean) : [];
    const byFamily = new Map();
    for (const door of list) {
        const family = familyOf(door);
        if (!byFamily.has(family)) byFamily.set(family, []);
        byFamily.get(family).push(door);
    }

    const marks = new Map();
    const types = [];
    const rows = [];

    for (const family of FAMILY_ORDER) {
        const familyDoors = byFamily.get(family) || [];
        const groups = new Map();
        for (const door of familyDoors) {
            const key = doorConfigurationKey(door);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(door);
        }

        const singleKeys = [];
        const doubleKeys = [];
        for (const key of groups.keys()) {
            const sample = groups.get(key)[0];
            if (family !== 'dock' && isDoubleConfiguration(sample.configuration)) {
                doubleKeys.push(key);
            } else {
                singleKeys.push(key);
            }
        }

        const emit = (prefix, keys) => {
            const orderedKeys = [...keys].sort((a, b) => {
                const minA = Math.min(...groups.get(a).map(doorIdNumber));
                const minB = Math.min(...groups.get(b).map(doorIdNumber));
                return minA - minB || a.localeCompare(b);
            });

            orderedKeys.forEach((key, index) => {
                const typeNumber = index + 1;
                const code = `${prefix}${typeNumber}`;
                const members = [...groups.get(key)].sort((a, b) => doorIdNumber(a) - doorIdNumber(b));
                const sample = members[0];
                const opening = family === 'dock' ? null : (isDoubleConfiguration(sample.configuration) ? 'double' : 'single');
                const color = doorMarkColor(typeNumber + (opening === 'double' ? 5 : 0), family);
                const typeEntry = {
                    code,
                    run: formatDoorMarkRun(code, members.length),
                    family,
                    familyLabel: DOOR_FAMILIES[family].label,
                    typeNumber,
                    opening,
                    openingLabel: openingLabel(sample),
                    width: Number(sample.width) || 0,
                    height: Number(sample.height) || 0,
                    thickness: Number(sample.thickness) || 0,
                    count: members.length,
                    color,
                    key,
                };
                types.push(typeEntry);

                members.forEach((door, instanceIndex) => {
                    const id = door.id ?? door.pk;
                    const instance = instanceIndex + 1;
                    const row = {
                        ...typeEntry,
                        instance,
                        mark: `${code}-${instance}`,
                        doorId: id,
                    };
                    rows.push(row);
                    if (id != null) {
                        marks.set(id, row);
                        marks.set(String(id), row);
                    }
                });
            });
        };

        emit(DOOR_FAMILIES[family].code, singleKeys);
        if (doubleKeys.length) emit(`D${DOOR_FAMILIES[family].code}`, doubleKeys);
    }

    return { marks, types, doors: rows };
}
