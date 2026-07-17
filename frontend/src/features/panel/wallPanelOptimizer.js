import {
    calculateProjectWallPanels,
    count45CutEnds,
    getWallLength,
    hasMixedJoints,
} from './wallPanelCalculationUtils';

/** Walls at or below this count: try every order (n!). Above: heuristic + random samples. */
const EXHAUSTIVE_WALL_LIMIT = 7;
/** Random samples when running in the background (UI stays responsive via chunking). */
const HEURISTIC_RANDOM_SAMPLES = 50000;
/** How many full wall-panel calculations to run before yielding to the browser. */
const CHUNK_SIZE = 16;

export function compareScores(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
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

function yieldToBrowser() {
    return new Promise((resolve) => {
        window.setTimeout(resolve, 0);
    });
}

function orderKey(order) {
    return order.map((w) => w.id).join(',');
}

function shuffleWalls(walls) {
    const shuffled = [...walls];
    for (let j = shuffled.length - 1; j > 0; j -= 1) {
        const k = Math.floor(Math.random() * (j + 1));
        [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    return shuffled;
}

function* permutationGenerator(items) {
    const arr = items.slice();
    const n = arr.length;
    if (n === 0) return;
    if (n === 1) {
        yield arr.slice();
        return;
    }

    const c = new Array(n).fill(0);
    yield arr.slice();

    let i = 0;
    while (i < n) {
        if (c[i] < i) {
            const swapIndex = i % 2 === 0 ? 0 : c[i];
            [arr[swapIndex], arr[i]] = [arr[i], arr[swapIndex]];
            yield arr.slice();
            c[i] += 1;
            i = 0;
        } else {
            c[i] = 0;
            i += 1;
        }
    }
}

function factorial(n) {
    let result = 1;
    for (let i = 2; i <= n; i += 1) result *= i;
    return result;
}

function buildSeedOrders(walls, intersections) {
    const orders = [];
    const seen = new Set();
    const pushUnique = (order) => {
        const key = orderKey(order);
        if (seen.has(key)) return;
        seen.add(key);
        orders.push(order);
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

    return { orders, seen };
}

function emptyResult() {
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

/**
 * Sync optimizer (scripts / small projects). Prefer the async version in the UI
 * so the tab does not freeze during long searches.
 */
export function optimizeWallPanelCalculation(walls = [], intersections = []) {
    const validWalls = (walls || []).filter((wall) =>
        wall && typeof wall.start_x === 'number' && typeof wall.end_y === 'number'
    );

    if (validWalls.length === 0) return emptyResult();

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
        orders = [...permutationGenerator(validWalls)];
        optimizationMode = 'exhaustive';
    } else {
        const { orders: seeds, seen } = buildSeedOrders(validWalls, intersections);
        orders = seeds;
        for (let i = 0; i < HEURISTIC_RANDOM_SAMPLES; i += 1) {
            const shuffled = shuffleWalls(validWalls);
            const key = orderKey(shuffled);
            if (seen.has(key)) continue;
            seen.add(key);
            orders.push(shuffled);
        }
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

/**
 * Background-friendly optimizer: evaluates orders in small chunks and yields to
 * the browser between chunks so the UI stays interactive.
 *
 * - ≤7 walls: every order (exhaustive)
 * - >7 walls: seed heuristics + up to ~12k unique random orders
 *   (trying EVERY order is not possible — e.g. 20 walls ≈ 2.4e18)
 *
 * @param {object[]} walls
 * @param {object[]} intersections
 * @param {{ onProgress?: Function, signal?: AbortSignal, randomSamples?: number }} [options]
 */
export async function optimizeWallPanelCalculationAsync(walls = [], intersections = [], options = {}) {
    const {
        onProgress = null,
        signal = null,
        randomSamples = HEURISTIC_RANDOM_SAMPLES,
    } = options;

    const throwIfAborted = () => {
        if (signal?.aborted) {
            const error = new Error('Optimization cancelled');
            error.name = 'AbortError';
            throw error;
        }
    };

    const validWalls = (walls || []).filter((wall) =>
        wall && typeof wall.start_x === 'number' && typeof wall.end_y === 'number'
    );

    if (validWalls.length === 0) return emptyResult();

    if (validWalls.length === 1) {
        const single = calculateProjectWallPanels(validWalls, intersections, validWalls);
        return {
            ...single,
            combinationsTested: 1,
            optimizationMode: 'single_wall',
            wallOrder: validWalls.map((w) => w.id),
        };
    }

    const useExhaustive = validWalls.length <= EXHAUSTIVE_WALL_LIMIT;
    const optimizationMode = useExhaustive ? 'exhaustive' : 'heuristic';

    const { orders: seedOrders, seen } = buildSeedOrders(validWalls, intersections);
    const totalEstimate = useExhaustive
        ? factorial(validWalls.length)
        : seedOrders.length + randomSamples;

    let best = null;
    let bestOrder = null;
    let tested = 0;
    let sinceYield = 0;

    const evaluateOrder = async (order) => {
        throwIfAborted();
        const result = calculateProjectWallPanels(validWalls, intersections, order);
        tested += 1;
        sinceYield += 1;

        if (isBetterScore(result.score, best?.score)) {
            best = result;
            bestOrder = order.map((w) => w.id);
        }

        if (onProgress && (tested === 1 || tested % CHUNK_SIZE === 0 || tested === totalEstimate)) {
            onProgress({
                tested,
                total: totalEstimate,
                optimizationMode,
                score: best?.score || null,
            });
        }

        if (sinceYield >= CHUNK_SIZE) {
            sinceYield = 0;
            await yieldToBrowser();
        }
    };

    if (useExhaustive) {
        for (const order of permutationGenerator(validWalls)) {
            await evaluateOrder(order);
        }
    } else {
        for (const order of seedOrders) {
            await evaluateOrder(order);
        }

        let attempts = 0;
        const maxAttempts = randomSamples * 3;
        while (tested < seedOrders.length + randomSamples && attempts < maxAttempts) {
            attempts += 1;
            const shuffled = shuffleWalls(validWalls);
            const key = orderKey(shuffled);
            if (seen.has(key)) continue;
            seen.add(key);
            await evaluateOrder(shuffled);
        }
    }

    throwIfAborted();

    if (onProgress) {
        onProgress({
            tested,
            total: tested,
            optimizationMode,
            score: best?.score || null,
            done: true,
        });
    }

    return {
        ...best,
        combinationsTested: tested,
        optimizationMode,
        wallOrder: bestOrder,
    };
}
