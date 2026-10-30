import { isCurtainDoorType } from './doorSchedule';

const DOOR_TYPE_SORT_ORDER = {
    swing: 0,
    slide: 1,
    dock: 2,
    sectional: 3,
};

const DOOR_OPENING_SORT_ORDER = {
    single_sided: 0,
    single: 0,
    double_sided: 1,
    double: 1,
};

/**
 * Group doors by type first, then Single / Double opening.
 */
export function sortDoorsForMaterialList(doors) {
    if (!Array.isArray(doors) || doors.length <= 1) {
        return doors || [];
    }

    return [...doors].sort((a, b) => {
        const typeA = DOOR_TYPE_SORT_ORDER[a?.door_type] ?? 50;
        const typeB = DOOR_TYPE_SORT_ORDER[b?.door_type] ?? 50;
        if (typeA !== typeB) {
            return typeA - typeB;
        }

        // Curtain doors have no Single/Double — keep each family together by size
        if (isCurtainDoorType(a?.door_type) && a?.door_type === b?.door_type) {
            const widthDiff = (Number(a?.width) || 0) - (Number(b?.width) || 0);
            if (widthDiff !== 0) return widthDiff;
            return (Number(a?.height) || 0) - (Number(b?.height) || 0);
        }

        const openingA = DOOR_OPENING_SORT_ORDER[a?.configuration] ?? 50;
        const openingB = DOOR_OPENING_SORT_ORDER[b?.configuration] ?? 50;
        if (openingA !== openingB) {
            return openingA - openingB;
        }

        const widthDiff = (Number(a?.width) || 0) - (Number(b?.width) || 0);
        if (widthDiff !== 0) return widthDiff;
        return (Number(a?.height) || 0) - (Number(b?.height) || 0);
    });
}
