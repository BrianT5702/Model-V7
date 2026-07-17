
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import { getPanelFinishingLabel, sortMaterialPanels } from './wallPlanPanelUtils';
import {
    getWallCalculationFingerprint,
    groupWallPanelsForDisplay,
} from './wallPanelCalculationUtils';
import { optimizeWallPanelCalculation } from './wallPanelOptimizer';

const PanelCalculationControls = ({ 
    walls, 
    intersections, 
    doors, 
    showMaterialDetails, 
    toggleMaterialDetails,
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

    const calculateAllPanels = useCallback(async () => {
        try {
            setIsCalculating(true);
            setRefreshMessage('');

            if (!walls || !Array.isArray(walls) || walls.length === 0) {
                console.warn('No walls data available for panel calculation');
                return;
            }

            if (!intersections || !Array.isArray(intersections)) {
                console.warn('No intersections data available for panel calculation');
                return;
            }

            const result = await new Promise((resolve) => {
                window.setTimeout(() => resolve(optimizeWallPanelCalculation(walls, intersections)), 0);
            });

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
            setOptimizationInfo({
                combinationsTested,
                optimizationMode,
                wallOrder,
                score,
            });
            setLastCalculatedFingerprint(currentFingerprint);

            if (updateSharedPanelData) {
                const groupedPanelsForSharing = groupWallPanelsForDisplay(allPanels);
                updateSharedPanelData('wall-plan', sortMaterialPanels(groupedPanelsForSharing), analysis);
            }

            const sortedPanels = sortMaterialPanels(groupWallPanelsForDisplay(allPanels));
            setCalculatedPanels(sortedPanels);

            const sideCutCount = sortedPanels
                .filter((panel) => panel.type === 'side')
                .reduce((sum, panel) => sum + panel.quantity, 0);
            setCutPanelsCount(sideCutCount);
        } catch (error) {
            console.error('Error calculating panels:', error);
            setCalculatedPanels(null);
            setShowTable(false);
            setOptimizationInfo(null);
        } finally {
            setIsCalculating(false);
        }
    }, [walls, intersections, currentFingerprint, updateSharedPanelData]);

    const handleToggleMaterialView = () => {
        if (showMaterialDetails) {
            setShowTable(false);
        }
        toggleMaterialDetails();
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
        ? optimizationInfo.optimizationMode === 'exhaustive'
            ? `Tested all ${optimizationInfo.combinationsTested} wall orders`
            : `Tested ${optimizationInfo.combinationsTested} wall orders (heuristic)`
        : null;

    const sortedLeftovers = useMemo(() => {
        const leftovers = panelCalculator?.leftovers || [];
        return [...leftovers].sort((a, b) => {
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
    }, [panelCalculator]);

    return (
        <div className="w-full mt-2 material-list-container">
            <div className="flex flex-wrap gap-1.5 mb-2">
                <button
                    onClick={handleToggleMaterialView}
                    className="plan-panel-btn-primary"
                >
                    {showMaterialDetails ? 'Hide Material' : 'View Material'}
                </button>

                {showMaterialDetails && (
                    <button
                        onClick={calculateAllPanels}
                        disabled={isCalculating || isRefreshing || !walls?.length}
                        className="plan-panel-btn bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                        title="Find the wall processing order with least waste (uses shared leftovers)"
                    >
                        {isCalculating ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Calculating...</span>
                            </>
                        ) : (
                            <span>Calculate Wall Panels</span>
                        )}
                    </button>
                )}

                {showMaterialDetails && calculatedPanels && (
                    <button
                        onClick={() => setShowTable(!showTable)}
                        className="plan-panel-btn bg-green-600 text-white hover:bg-green-700"
                    >
                        {showTable ? 'Hide Details' : 'Show Details'}
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

            {showMaterialDetails && !calculatedPanels && !isCalculating && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                    <strong>Manual calculation:</strong> panel counts are not updated automatically when walls or joints change.
                    Click <strong>Calculate Wall Panels</strong> when you are ready — the system will try different wall orders and pick the least-waste combination.
                </div>
            )}

            {showMaterialDetails && isStale && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    Walls or joints changed since the last calculation. Click <strong>Calculate Wall Panels</strong> to refresh the material list.
                </div>
            )}

            {!onRefreshWalls && showMaterialDetails && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                    <strong>Tip:</strong> Added new levels or walls? Use <strong>Refresh Walls</strong>, then click <strong>Calculate Wall Panels</strong>.
                </div>
            )}

            {showMaterialDetails && (
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
            )}

            {showLeftoverDetails && panelCalculator && (
                <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto modal-scroll-panel">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-semibold">Leftover Panels Details</h3>
                            <button
                                onClick={() => setShowLeftoverDetails(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                ×
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full bg-white border border-gray-300">
                                <thead>
                                    <tr className="bg-gray-100">
                                        <th className="px-4 py-2 border">No.</th>
                                        <th className="px-4 py-2 border">Shorter Face Width (mm)</th>
                                        <th className="px-4 py-2 border">Longer Face Width (mm)</th>
                                        <th className="px-4 py-2 border">Panel Length (mm)</th>
                                        <th className="px-4 py-2 border">Wall Thickness (mm)</th>
                                        <th className="px-4 py-2 border">Edge Type</th>
                                        <th className="px-4 py-2 border">Project</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedLeftovers.map((leftover, index) => {
                                        let panelLength = leftover.panelLength;
                                        if (!panelLength) {
                                            const matchingWall = walls.find((w) => w.thickness === leftover.wallThickness);
                                            if (matchingWall) {
                                                panelLength = (matchingWall.fill_gap_mode && matchingWall.gap_fill_height)
                                                    ? matchingWall.gap_fill_height
                                                    : matchingWall.height;
                                            }
                                        }
                                        panelLength = panelLength || 'N/A';
                                        const shorterFace = leftover.shorter_face || 0;
                                        const longerFace = leftover.longer_face || 0;
                                        const wallThickness = leftover.wallThickness || 'N/A';
                                        const leftEdge = leftover.leftEdgeType === '45_cut' ? '45° Cut' : 'Straight';
                                        const rightEdge = leftover.rightEdgeType === '45_cut' ? '45° Cut' : (leftover.rightEdgeType || 'Straight');

                                        return (
                                            <tr key={leftover.id} className="hover:bg-gray-50">
                                                <td className="px-4 py-2 border text-center">{index + 1}</td>
                                                <td className="px-4 py-2 border text-center">{shorterFace}</td>
                                                <td className="px-4 py-2 border text-center">{longerFace}</td>
                                                <td className="px-4 py-2 border text-center">{panelLength}</td>
                                                <td className="px-4 py-2 border text-center">{wallThickness}</td>
                                                <td className="px-4 py-2 border text-center">
                                                    {`Left: ${leftEdge}, Right: ${rightEdge}`}
                                                </td>
                                                <td className="px-4 py-2 border text-center">
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
