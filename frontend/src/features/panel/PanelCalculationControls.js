
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import { getPanelFinishingLabel, sortMaterialPanels } from './wallPlanPanelUtils';
import {
    calculateProjectWallPanels,
    getWallCalculationFingerprint,
    groupWallPanelsForDisplay,
} from './wallPanelCalculationUtils';
import { optimizeWallPanelCalculationAsync, compareScores } from './wallPanelOptimizer';
import api from '../../api/api';

const PanelCalculationControls = ({ 
    walls, 
    intersections, 
    doors, 
    project = null,
    updateSharedPanelData,
    onRefreshWalls
}) => {
    const [calculatedPanels, setCalculatedPanels] = useState(null);
    const [showTable, setShowTable] = useState(false);
    const [panelAnalysis, setPanelAnalysis] = useState(null);
    const [cutPanelsCount, setCutPanelsCount] = useState(0);
    const [showLeftoverDetails, setShowLeftoverDetails] = useState(false);
    const [panelCalculator, setPanelCalculator] = useState(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshMessage, setRefreshMessage] = useState('');
    const [optimizationInfo, setOptimizationInfo] = useState(null);
    const [lastCalculatedFingerprint, setLastCalculatedFingerprint] = useState(null);
    const [calculationMethod, setCalculationMethod] = useState('optimized');
    const [optimizationProgress, setOptimizationProgress] = useState(null);

    // Remembers the best optimized result seen so far for a given wall/joint state,
    // so repeated loads keep the best solution instead of a worse random one.
    const bestOptimizedResultRef = useRef(null);
    // Tracks the optimization payload most recently persisted to the backend so we
    // don't PATCH the project again when nothing improved.
    const persistedOptRef = useRef(null);
    // Ensures the saved best result is auto-displayed only once per project/wall-state.
    const autoAppliedRef = useRef(null);
    // Cancels an in-flight background search when the user starts another calculate.
    const optimizationAbortRef = useRef(null);

    const currentFingerprint = useMemo(
        () => getWallCalculationFingerprint(walls, intersections),
        [walls, intersections]
    );

    const isStale = Boolean(
        calculatedPanels &&
        lastCalculatedFingerprint &&
        lastCalculatedFingerprint !== currentFingerprint
    );

    useEffect(() => {
        if (calculatedPanels && calculatedPanels.length > 0) {
            setShowTable(true);
        }
    }, [calculatedPanels]);

    // Deterministically rebuild a result for a saved wall order (array of wall ids).
    // Returns null if the saved order can't be mapped onto the current walls.
    const buildResultFromOrder = useCallback((wallOrder) => {
        if (!Array.isArray(wallOrder) || wallOrder.length === 0) return null;
        const byId = new Map((walls || []).map((wall) => [wall.id, wall]));
        const orderedWalls = wallOrder.map((id) => byId.get(id)).filter(Boolean);
        if (orderedWalls.length !== (walls || []).length) return null;

        const rebuilt = calculateProjectWallPanels(walls, intersections, orderedWalls);
        if (!rebuilt.allPanels || rebuilt.allPanels.length === 0) return null;
        return {
            ...rebuilt,
            combinationsTested: 1,
            optimizationMode: 'saved',
            wallOrder: [...wallOrder],
        };
    }, [walls, intersections]);

    // Push the best optimized result to the backend so a reopened project can
    // reproduce it. Skips the PATCH when nothing improved on what's already saved.
    const persistBestOptimization = useCallback((result, fingerprint) => {
        if (!project?.id || !result?.wallOrder || !result?.score) return;

        const alreadyPersisted = persistedOptRef.current;
        if (
            alreadyPersisted &&
            alreadyPersisted.fingerprint === fingerprint &&
            compareScores(result.score, alreadyPersisted.score) >= 0
        ) {
            return;
        }

        const existing = project.panel_optimization;
        if (
            existing &&
            existing.fingerprint === fingerprint &&
            compareScores(result.score, existing.score) >= 0
        ) {
            persistedOptRef.current = { fingerprint, score: existing.score };
            return;
        }

        const payload = {
            fingerprint,
            wallOrder: result.wallOrder,
            score: result.score,
        };
        persistedOptRef.current = { fingerprint, score: result.score };
        if (project.panel_optimization !== undefined) {
            project.panel_optimization = payload;
        }
        api.patch(`projects/${project.id}/`, { panel_optimization: payload })
            .catch((error) => {
                console.error('Failed to save panel optimization:', error);
            });
    }, [project]);

    // Apply a computed result to the visible UI state.
    const applyResult = useCallback((result, fingerprint) => {
        const { allPanels, calculator, analysis, combinationsTested, optimizationMode, wallOrder, score } = result;

        if (!allPanels || allPanels.length === 0) {
            setCalculatedPanels(null);
            setPanelAnalysis(null);
            setPanelCalculator(null);
            setOptimizationInfo(null);
            return;
        }

        setPanelAnalysis(analysis);
        setPanelCalculator(calculator);
        setOptimizationInfo({ combinationsTested, optimizationMode, wallOrder, score });
        setLastCalculatedFingerprint(fingerprint);

        const sortedPanels = sortMaterialPanels(groupWallPanelsForDisplay(allPanels));
        if (updateSharedPanelData) {
            updateSharedPanelData('wall-plan', sortedPanels, analysis);
        }
        setCalculatedPanels(sortedPanels);

        const sideCutCount = sortedPanels
            .filter((panel) => panel.type === 'side')
            .reduce((sum, panel) => sum + panel.quantity, 0);
        setCutPanelsCount(sideCutCount);
    }, [updateSharedPanelData]);

    const calculateAllPanels = useCallback(async (method = calculationMethod) => {
        if (optimizationAbortRef.current) {
            optimizationAbortRef.current.abort();
            optimizationAbortRef.current = null;
        }

        const abortController = new AbortController();
        optimizationAbortRef.current = abortController;

        try {
            setIsCalculating(true);
            setRefreshMessage('');
            setOptimizationProgress(null);

            if (!walls || !Array.isArray(walls) || walls.length === 0) {
                console.warn('No walls data available for panel calculation');
                return;
            }

            if (!intersections || !Array.isArray(intersections)) {
                console.warn('No intersections data available for panel calculation');
                return;
            }

            let freshResult;
            if (method === 'default') {
                const defaultResult = calculateProjectWallPanels(walls, intersections, walls);
                freshResult = {
                    ...defaultResult,
                    combinationsTested: 1,
                    optimizationMode: 'default',
                    wallOrder: walls.map((wall) => wall.id),
                };
            } else {
                // Chunked background search — yields between batches so the tab stays usable.
                freshResult = await optimizeWallPanelCalculationAsync(walls, intersections, {
                    signal: abortController.signal,
                    onProgress: (progress) => {
                        if (!abortController.signal.aborted) {
                            setOptimizationProgress(progress);
                        }
                    },
                });
            }

            if (abortController.signal.aborted) return;

            let result = freshResult;

            // For the optimized method, keep the best result across runs AND reloads.
            // Candidate sources: this fresh run, the in-memory best, and the best saved
            // on the project (reproduced deterministically from its wall order).
            if (method === 'optimized' && freshResult?.allPanels?.length > 0) {
                const considerCandidate = (candidate) => {
                    if (candidate?.allPanels?.length > 0 && compareScores(candidate.score, result.score) < 0) {
                        result = candidate;
                    }
                };

                const remembered = bestOptimizedResultRef.current;
                if (remembered && remembered.fingerprint === currentFingerprint) {
                    considerCandidate(remembered.result);
                }

                const saved = project?.panel_optimization;
                if (saved && saved.fingerprint === currentFingerprint) {
                    considerCandidate(buildResultFromOrder(saved.wallOrder));
                }

                bestOptimizedResultRef.current = { fingerprint: currentFingerprint, result };
                persistBestOptimization(result, currentFingerprint);
            }

            if (!result.allPanels || result.allPanels.length === 0) {
                setCalculatedPanels(null);
                setPanelAnalysis(null);
                setPanelCalculator(null);
                setOptimizationInfo(null);
                return;
            }

            applyResult(result, currentFingerprint);
        } catch (error) {
            if (error?.name === 'AbortError') return;
            console.error('Error calculating panels:', error);
            setCalculatedPanels(null);
            setShowTable(false);
            setOptimizationInfo(null);
        } finally {
            if (optimizationAbortRef.current === abortController) {
                optimizationAbortRef.current = null;
            }
            setOptimizationProgress(null);
            setIsCalculating(false);
        }
    }, [walls, intersections, currentFingerprint, calculationMethod, project, buildResultFromOrder, persistBestOptimization, applyResult]);

    useEffect(() => () => {
        if (optimizationAbortRef.current) {
            optimizationAbortRef.current.abort();
        }
    }, []);

    // On open, if the project has a saved best order that matches the current walls,
    // reproduce and show it automatically so the leftovers match the last session.
    useEffect(() => {
        const saved = project?.panel_optimization;
        if (!saved || saved.fingerprint !== currentFingerprint) return;
        if (autoAppliedRef.current === currentFingerprint) return;
        if (!walls?.length || !Array.isArray(intersections)) return;
        if (calculatedPanels && lastCalculatedFingerprint === currentFingerprint) return;

        const rebuilt = buildResultFromOrder(saved.wallOrder);
        if (!rebuilt) return;

        autoAppliedRef.current = currentFingerprint;
        bestOptimizedResultRef.current = { fingerprint: currentFingerprint, result: rebuilt };
        persistedOptRef.current = { fingerprint: currentFingerprint, score: saved.score };
        applyResult(rebuilt, currentFingerprint);
    }, [project, currentFingerprint, walls, intersections, calculatedPanels, lastCalculatedFingerprint, buildResultFromOrder, applyResult]);

    const handleSwitchCalculationMethod = () => {
        const nextMethod = calculationMethod === 'optimized' ? 'default' : 'optimized';
        setCalculationMethod(nextMethod);
        calculateAllPanels(nextMethod);
    };

    const handleRefreshWalls = async () => {
        if (!onRefreshWalls) return;
        setIsRefreshing(true);
        setRefreshMessage('');
        try {
            await onRefreshWalls();
            setRefreshMessage(`Walls refreshed (${walls?.length ?? 0} walls loaded). Click "Calculate Wall Panels" to update counts.`);
            setTimeout(() => setRefreshMessage(''), 6000);
        } catch (error) {
            console.error('Error refreshing walls:', error);
            setRefreshMessage('Error refreshing walls. Please try again.');
            setTimeout(() => setRefreshMessage(''), 5000);
        } finally {
            setIsRefreshing(false);
        }
    };

    const optimizationLabel = optimizationInfo
        ? optimizationInfo.optimizationMode === 'default'
            ? 'Default method · Current wall order (no order optimization)'
            : optimizationInfo.optimizationMode === 'saved'
            ? 'Saved best result from a previous session'
            : optimizationInfo.optimizationMode === 'exhaustive'
            ? `Tested all ${optimizationInfo.combinationsTested} wall orders`
            : `Tested ${optimizationInfo.combinationsTested} wall orders (heuristic)`
        : null;

    const groupedLeftovers = useMemo(() => {
        const leftovers = panelCalculator?.leftovers || [];
        const normalizeDimension = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
        const groups = new Map();

        leftovers.forEach((leftover) => {
            let panelLength = Number(leftover?.panelLength) || 0;
            if (!panelLength) {
                const matchingWall = walls.find(
                    (wall) => Number(wall.thickness) === Number(leftover?.wallThickness)
                );
                if (matchingWall) {
                    panelLength = matchingWall.fill_gap_mode && matchingWall.gap_fill_height
                        ? matchingWall.gap_fill_height
                        : matchingWall.height;
                }
            }

            const grouped = {
                ...leftover,
                shorter_face: normalizeDimension(leftover?.shorter_face),
                longer_face: normalizeDimension(leftover?.longer_face),
                panelLength: normalizeDimension(panelLength),
                wallThickness: normalizeDimension(leftover?.wallThickness),
            };
            const key = [
                grouped.shorter_face,
                grouped.longer_face,
                grouped.panelLength,
                grouped.wallThickness,
                grouped.leftEdgeType || 'straight',
                grouped.rightEdgeType || 'straight',
                grouped.innerFaceMaterial || '',
                grouped.innerFaceThickness ?? '',
                grouped.outerFaceMaterial || '',
                grouped.outerFaceThickness ?? '',
            ].join('|');

            const existing = groups.get(key);
            if (existing) {
                existing.quantity += 1;
            } else {
                groups.set(key, { ...grouped, groupKey: key, quantity: 1 });
            }
        });

        return [...groups.values()].sort((a, b) => {
            const lengthA = Number(a?.panelLength) || 0;
            const lengthB = Number(b?.panelLength) || 0;
            if (lengthA !== lengthB) return lengthB - lengthA;

            const thicknessA = Number(a?.wallThickness) || 0;
            const thicknessB = Number(b?.wallThickness) || 0;
            if (thicknessA !== thicknessB) return thicknessA - thicknessB;

            const longerA = Number(a?.longer_face) || 0;
            const longerB = Number(b?.longer_face) || 0;
            if (longerA !== longerB) return longerB - longerA;

            const shorterA = Number(a?.shorter_face) || 0;
            const shorterB = Number(b?.shorter_face) || 0;
            if (shorterA !== shorterB) return shorterB - shorterA;

            const leftEdgeA = String(a?.leftEdgeType || '');
            const leftEdgeB = String(b?.leftEdgeType || '');
            if (leftEdgeA !== leftEdgeB) return leftEdgeA.localeCompare(leftEdgeB);

            const rightEdgeA = String(a?.rightEdgeType || '');
            const rightEdgeB = String(b?.rightEdgeType || '');
            return rightEdgeA.localeCompare(rightEdgeB);
        });
    }, [panelCalculator, walls]);

    return (
        <div className="w-full mt-2 material-list-container">
            <div className="flex flex-wrap gap-1.5 mb-2">
                <button
                    onClick={() => calculateAllPanels()}
                    disabled={isCalculating || isRefreshing || !walls?.length}
                    className="plan-panel-btn bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                    title={calculationMethod === 'optimized'
                        ? 'Find the wall processing order with least waste'
                        : 'Calculate once using the current wall order'}
                >
                    {isCalculating ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            <span>
                                {optimizationProgress
                                    ? `Searching ${Math.min(100, Math.round(
                                        (optimizationProgress.tested / optimizationProgress.total) * 100
                                    ))}%…`
                                    : 'Calculating...'}
                            </span>
                        </>
                    ) : (
                        <span>
                            Calculate Wall Panels ({calculationMethod === 'optimized' ? 'Optimized' : 'Default'})
                        </span>
                    )}
                </button>

                <button
                    onClick={handleSwitchCalculationMethod}
                    disabled={isCalculating || isRefreshing || !walls?.length}
                    className="plan-panel-btn bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                    title={calculationMethod === 'optimized'
                        ? 'Recalculate using the original current-wall-order method'
                        : 'Recalculate by testing wall orders for less waste'}
                >
                    {calculationMethod === 'optimized' ? 'Try Default Method' : 'Try Optimized Method'}
                </button>

                {calculatedPanels && (
                    <button
                        onClick={() => setShowTable(!showTable)}
                        className="plan-panel-btn bg-green-600 text-white hover:bg-green-700"
                    >
                        {showTable ? 'Hide Panel Table' : 'Show Panel Table'}
                    </button>
                )}

                {onRefreshWalls && (
                    <button
                        onClick={handleRefreshWalls}
                        disabled={isRefreshing || isCalculating}
                        className="plan-panel-btn bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 flex items-center gap-1.5"
                        title="Reload walls from all levels/storeys"
                    >
                        {isRefreshing ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Refreshing...</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                <span>Refresh Walls</span>
                            </>
                        )}
                    </button>
                )}
            </div>

            {refreshMessage && (
                <div className={`mb-3 p-3 rounded-lg text-sm ${
                    refreshMessage.toLowerCase().includes('error')
                        ? 'bg-red-50 border border-red-200 text-red-700'
                        : 'bg-green-50 border border-green-200 text-green-700'
                }`}>
                    {refreshMessage}
                </div>
            )}

            {!calculatedPanels && !isCalculating && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                    <strong>Manual calculation:</strong> panel counts are not updated automatically when walls or joints change.
                    Click <strong>Calculate Wall Panels</strong> when you are ready — the system will try different wall orders and pick the least-waste combination.
                </div>
            )}

            {isStale && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    Walls or joints changed since the last calculation. Click <strong>Calculate Wall Panels</strong> to refresh the material list.
                </div>
            )}

            {!onRefreshWalls && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                    <strong>Tip:</strong> Added new levels or walls? Use <strong>Refresh Walls</strong>, then click <strong>Calculate Wall Panels</strong>.
                </div>
            )}

            <div className="mb-3 sm:mb-4 p-3 sm:p-4 bg-gray-50 rounded-lg border border-gray-200">
                <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-900">Material Analysis</h3>

                {!walls || walls.length === 0 ? (
                    <div className="text-center py-4 text-gray-500">
                        No walls available for material calculation. Please add walls to your project first.
                    </div>
                ) : isCalculating ? (
                    <div className="text-center py-8">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <p className="mt-2 text-gray-600">Optimizing wall panel layout...</p>
                        {walls.length <= 7 && (
                            <p className="mt-1 text-xs text-gray-500">Testing all wall processing orders for least waste.</p>
                        )}
                    </div>
                ) : panelAnalysis ? (
                    <>
                        {optimizationLabel && (
                            <p className="text-xs text-gray-600 mb-3">
                                {optimizationLabel}
                                {optimizationInfo?.score && (
                                    <>
                                        {' '}
                                        · New stock cuts: {optimizationInfo.score.fullPanelsUsedForCutting}
                                        {' '}
                                        · Leftover reuse: {optimizationInfo.score.leftoverReused}
                                    </>
                                )}
                            </p>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
                            <div className="p-2 bg-white rounded shadow">
                                <div className="text-sm text-gray-600">Full Panels</div>
                                <div className="text-xl font-bold">
                                    {panelAnalysis.details.fullPanels + panelAnalysis.details.fullPanelsUsedForCutting}
                                    {panelAnalysis.details.fullPanelsUsedForCutting > 0 && (
                                        <span className="text-xs text-gray-500"> ({panelAnalysis.details.fullPanelsUsedForCutting} used for cutting)</span>
                                    )}
                                </div>
                            </div>
                            <div className="p-2 bg-white rounded shadow">
                                <div className="text-sm text-gray-600">Cut Panels</div>
                                <div className="text-xl font-bold">{cutPanelsCount}</div>
                            </div>
                            <div
                                className="p-2 bg-white rounded shadow cursor-pointer hover:bg-gray-50 transition-colors"
                                onClick={() => setShowLeftoverDetails(true)}
                            >
                                <div className="text-sm text-gray-600">Leftover Panels</div>
                                <div className="text-xl font-bold">{panelAnalysis.details.leftoverPanels}</div>
                            </div>
                            {calculatedPanels && (
                                <div className="p-2 bg-white rounded shadow">
                                    <div className="text-sm text-gray-600">Doors Needed</div>
                                    <div className="text-xl font-bold">{doors.length}</div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="text-center py-4 text-gray-500">
                        Click <strong>Calculate Wall Panels</strong> to generate material quantities.
                    </div>
                )}
            </div>

            {showLeftoverDetails && panelCalculator && (
                <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-5 max-w-5xl w-full max-h-[80vh] overflow-y-auto modal-scroll-panel">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h3 className="text-lg font-semibold">Leftover Panels Details</h3>
                                <p className="text-xs text-gray-500">
                                    {panelCalculator.leftovers.length} pieces grouped into {groupedLeftovers.length} rows
                                </p>
                            </div>
                            <button
                                onClick={() => setShowLeftoverDetails(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                ×
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full bg-white border border-gray-300 text-xs">
                                <thead>
                                    <tr className="bg-gray-100">
                                        <th className="px-2 py-1.5 border">No.</th>
                                        <th className="px-2 py-1.5 border">Shorter Face (mm)</th>
                                        <th className="px-2 py-1.5 border">Longer Face (mm)</th>
                                        <th className="px-2 py-1.5 border">Panel Length (mm)</th>
                                        <th className="px-2 py-1.5 border">Wall Thickness (mm)</th>
                                        <th className="px-2 py-1.5 border">Qty</th>
                                        <th className="px-2 py-1.5 border">Edge Type</th>
                                        <th className="px-2 py-1.5 border">Project</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {groupedLeftovers.map((leftover, index) => {
                                        const panelLength = leftover.panelLength || 'N/A';
                                        const shorterFace = leftover.shorter_face || 0;
                                        const longerFace = leftover.longer_face || 0;
                                        const wallThickness = leftover.wallThickness || 'N/A';
                                        const leftEdge = leftover.leftEdgeType === '45_cut' ? '45° Cut' : 'Straight';
                                        const rightEdge = leftover.rightEdgeType === '45_cut' ? '45° Cut' : (leftover.rightEdgeType || 'Straight');

                                        return (
                                            <tr key={leftover.groupKey} className="hover:bg-gray-50">
                                                <td className="px-2 py-1.5 border text-center">{index + 1}</td>
                                                <td className="px-2 py-1.5 border text-center">{shorterFace}</td>
                                                <td className="px-2 py-1.5 border text-center">{longerFace}</td>
                                                <td className="px-2 py-1.5 border text-center">{panelLength}</td>
                                                <td className="px-2 py-1.5 border text-center">{wallThickness}</td>
                                                <td className="px-2 py-1.5 border text-center font-semibold">{leftover.quantity}</td>
                                                <td className="px-2 py-1.5 border text-center whitespace-nowrap">
                                                    {`Left: ${leftEdge}, Right: ${rightEdge}`}
                                                </td>
                                                <td className="px-2 py-1.5 border text-center whitespace-nowrap">
                                                    {project?.name || 'N/A'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </ModalOverlay>
            )}

            {showTable && calculatedPanels && (
                <div className="overflow-x-auto w-full">
                    <table className="w-full bg-white border border-gray-300">
                        <thead>
                            <tr className="bg-gray-100">
                                <th className="px-4 py-2 border">No.</th>
                                <th className="px-4 py-2 border">Width (mm)</th>
                                <th className="px-4 py-2 border">Length (mm)</th>
                                <th className="px-4 py-2 border">Quantity</th>
                                <th className="px-4 py-2 border">Type</th>
                                <th className="px-4 py-2 border">Application</th>
                                <th className="px-4 py-2 border">Panel Thickness (mm)</th>
                                <th className="px-4 py-2 border">Finishing</th>
                            </tr>
                        </thead>
                        <tbody>
                            {calculatedPanels.map((panel, index) => {
                                const finishing = getPanelFinishingLabel(panel);

                                return (
                                    <tr key={index} className="hover:bg-gray-50">
                                        <td className="px-4 py-2 border text-center">{index + 1}</td>
                                        <td className="px-4 py-2 border text-center">{panel.width}</td>
                                        <td className="px-4 py-2 border text-center">{panel.length}</td>
                                        <td className="px-4 py-2 border text-center">{panel.quantity}</td>
                                        <td className="px-4 py-2 border text-center">{panel.type}</td>
                                        <td className="px-4 py-2 border text-center">{panel.application}</td>
                                        <td className="px-4 py-2 border text-center">{panel.thickness || 'N/A'}</td>
                                        <td className="px-4 py-2 border text-left text-sm">{finishing}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default PanelCalculationControls;
