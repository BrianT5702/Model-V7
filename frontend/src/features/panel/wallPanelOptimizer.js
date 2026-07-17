import {
    calculateProjectWallPanels,
    count45CutEnds,
    getWallLength,
    hasMixedJoints,
} from './wallPanelCalculationUtils';

const EXHAUSTIVE_WALL_LIMIT = 7;
const HEURISTIC_RANDOM_SAMPLES = 40;

function compareScores(a, b) {
    if (a.fullPanelsUsedForCutting !== b.fullPanelsUsedForCutting) {
        return a.fullPanelsUsedForCutting - b.fullPanelsUsedForCutting;
    }
    if (a.leftoverReused !== b.leftoverReused) {
        return b.leftoverReused - a.leftoverReused;
    }
    if (a.leftoverArea !== b.leftoverArea) {
        return a.leftoverArea - b.leftoverArea;
    }
    if (a.usableLeftoverCount !== b.usableLeftoverCount) {
        return a.usableLeftoverCount - b.usableLeftoverCount;
    }
    return a.totalPanels - b.totalPanels;
}

function isBetterScore(candidate, currentBest) {
    if (!currentBest) return true;
    return compareScores(candidate, currentBest) < 0;
}

function permutations(items) {
    if (items.length <= 1) return [items];
    const result = [];
    const swap = (arr, i, j) => {
        const copy = arr.slice();
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
        return copy;
    };
    const permute = (arr, start = 0) => {
        if (start === arr.length - 1) {
            result.push(arr.slice());
            return;
        }
        for (let i = start; i < arr.length; i += 1) {
            permute(swap(arr, start, i), start + 1);
        }
    };
    permute(items.slice());
    return result;
}

function buildHeuristicOrders(walls, intersections) {
    const orders = [];
    const pushUnique = (order) => {
        const key = order.map((w) => w.id).join(',');
        if (!orders.some((existing) => existing.map((w) => w.id).join(',') === key)) {
            orders.push(order);
        }
    };

    pushUnique(walls);
    pushUnique([...walls].reverse());
    pushUnique([...walls].sort((a, b) => getWallLength(b) - getWallLength(a)));
    pushUnique([...walls].sort((a, b) => getWallLength(a) - getWallLength(b)));
    pushUnique([...walls].sort((a, b) => count45CutEnds(b, intersections) - count45CutEnds(a, intersections)));
    pushUnique([...walls].sort((a, b) => {
        const mixedDiff = Number(hasMixedJoints(b, intersections)) - Number(hasMixedJoints(a, intersections));
        if (mixedDiff !== 0) return mixedDiff;
        return count45CutEnds(b, intersections) - count45CutEnds(a, intersections);
    }));

    for (let i = 0; i < HEURISTIC_RANDOM_SAMPLES; i += 1) {
        const shuffled = [...walls];
        for (let j = shuffled.length - 1; j > 0; j -= 1) {
            const k = Math.floor(Math.random() * (j + 1));
            [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
        }
        pushUnique(shuffled);
    }

    return orders;
}

/**
 * Try multiple wall processing orders and return the combination with least waste.
 */
export function optimizeWallPanelCalculation(walls = [], intersections = []) {
    const validWalls = (walls || []).filter((wall) =>
        wall && typeof wall.start_x === 'number' && typeof wall.end_y === 'number'
    );

    if (validWalls.length === 0) {
        return {
            allPanels: [],
            calculator: null,
            analysis: null,
            score: null,
            combinationsTested: 0,
            optimizationMode: 'none',
            wallOrder: [],
        };
    }

    if (validWalls.length === 1) {
        const single = calculateProjectWallPanels(validWalls, intersections, validWalls);
        return {
            ...single,
            combinationsTested: 1,
            optimizationMode: 'single_wall',
            wallOrder: validWalls.map((w) => w.id),
        };
    }

    let orders;
    let optimizationMode;

    if (validWalls.length <= EXHAUSTIVE_WALL_LIMIT) {
        orders = permutations(validWalls);
        optimizationMode = 'exhaustive';
    } else {
        orders = buildHeuristicOrders(validWalls, intersections);
        optimizationMode = 'heuristic';
    }

    let best = null;
    let bestOrder = null;

    orders.forEach((order) => {
        const result = calculateProjectWallPanels(validWalls, intersections, order);
        if (isBetterScore(result.score, best?.score)) {
            best = result;
            bestOrder = order.map((w) => w.id);
        }
    });

    return {
        ...best,
        combinationsTested: orders.length,
        optimizationMode,
        wallOrder: bestOrder,
    };
}
