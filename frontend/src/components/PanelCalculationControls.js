import React, { useState } from 'react';
import PanelCalculator from '../utils/PanelCalculator';

const PanelCalculationControls = ({ walls, intersections }) => {
    const [calculatedPanels, setCalculatedPanels] = useState(null);
    const [showTable, setShowTable] = useState(false);
    const [panelAnalysis, setPanelAnalysis] = useState(null);
    const [cutPanelsCount, setCutPanelsCount] = useState(0);
    const [showLeftoverDetails, setShowLeftoverDetails] = useState(false);
    const [panelCalculator, setPanelCalculator] = useState(null);

    const calculateAllPanels = () => {
        const calculator = new PanelCalculator();
        const allPanels = [];

        walls.forEach(wall => {
            const wallLength = Math.sqrt(
                Math.pow(wall.end_x - wall.start_x, 2) + 
                Math.pow(wall.end_y - wall.start_y, 2)
            );

            // Find all intersections for this wall
            const wallIntersections = intersections.filter(inter => 
                inter.pairs.some(pair => 
                    pair.wall1.id === wall.id || pair.wall2.id === wall.id
                )
            );

            // Determine joint types for both ends
            let leftJointType = 'butt_in';
            let rightJointType = 'butt_in';

            // Determine wall orientation and which end is left/right
            const isHorizontal = Math.abs(wall.end_y - wall.start_y) < Math.abs(wall.end_x - wall.start_x);
            const isLeftToRight = wall.end_x > wall.start_x;
            const isBottomToTop = wall.end_y > wall.start_y;

            // Track all intersections for each end
            const leftEndIntersections = [];
            const rightEndIntersections = [];

            wallIntersections.forEach(inter => {
                inter.pairs.forEach(pair => {
                    if (pair.wall1.id === wall.id || pair.wall2.id === wall.id) {
                        // For horizontal walls
                        if (isHorizontal) {
                            if (isLeftToRight) {
                                // Wall goes left to right
                                if (inter.x === wall.start_x) {
                                    leftEndIntersections.push(pair.joining_method);
                                } else if (inter.x === wall.end_x) {
                                    rightEndIntersections.push(pair.joining_method);
                                }
                            } else {
                                // Wall goes right to left
                                if (inter.x === wall.start_x) {
                                    rightEndIntersections.push(pair.joining_method);
                                } else if (inter.x === wall.end_x) {
                                    leftEndIntersections.push(pair.joining_method);
                                }
                            }
                        } else {
                            // For vertical walls
                            if (isBottomToTop) {
                                // Wall goes bottom to top
                                if (inter.y === wall.start_y) {
                                    leftEndIntersections.push(pair.joining_method);
                                } else if (inter.y === wall.end_y) {
                                    rightEndIntersections.push(pair.joining_method);
                                }
                            } else {
                                // Wall goes top to bottom
                                if (inter.y === wall.start_y) {
                                    rightEndIntersections.push(pair.joining_method);
                                } else if (inter.y === wall.end_y) {
                                    leftEndIntersections.push(pair.joining_method);
                                }
                            }
                        }
                    }
                });
            });

            // Set joint types, prioritizing 45_cut
            leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
            rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';

            console.log(`Wall ${wall.id} joint types:`, { 
                left: leftJointType, 
                right: rightJointType,
                orientation: isHorizontal ? 'horizontal' : 'vertical',
                direction: isHorizontal ? (isLeftToRight ? 'left-to-right' : 'right-to-left') : 
                           (isBottomToTop ? 'bottom-to-top' : 'top-to-bottom'),
                leftEndIntersections,
                rightEndIntersections
            });

            const panels = calculator.calculatePanels(
                wallLength,
                wall.thickness,
                { left: leftJointType, right: rightJointType }
            );

            // Add wall-specific information to each panel
            panels.forEach(panel => {
                // If a panel is a small remainder (like 50mm) and is not from leftover, ensure its type is 'side'
                let panelType = panel.type;
                if (panelType === 'leftover' && panel.width < 200 && !panel.isLeftover) {
                    panelType = 'side';
                }
                allPanels.push({
                    ...panel,
                    type: panelType,
                    length: wall.height,
                    application: wall.application_type || 'standard',
                    wallId: wall.id,
                    wallLength: wallLength,
                    wallStart: `(${Math.round(wall.start_x)}, ${Math.round(wall.start_y)})`,
                    wallEnd: `(${Math.round(wall.end_x)}, ${Math.round(wall.end_y)})`
                });
            });
        });

        // Get panel analysis
        const analysis = calculator.getPanelAnalysis();
        setPanelAnalysis(analysis);
        setPanelCalculator(calculator);

        // Group panels by dimensions and application
        const groupedPanels = allPanels.reduce((acc, panel) => {
            const key = `${panel.width}-${panel.length}-${panel.application}`;
            if (!acc[key]) {
                acc[key] = {
                    width: panel.width,
                    length: panel.length,
                    application: panel.application,
                    quantity: 0,
                    type: panel.type
                };
            }
            acc[key].quantity += 1;
            return acc;
        }, {});

        setCalculatedPanels(Object.values(groupedPanels));

        // Calculate cut panels count (only 'side' panels)
        const cutPanelsCount = Object.values(groupedPanels)
            .filter(panel => panel.type === 'side')
            .reduce((sum, panel) => sum + panel.quantity, 0);
        setCutPanelsCount(cutPanelsCount);
    };

    return (
        <div className="w-full max-w-4xl mt-4">
            <div className="flex gap-4 mb-4">
                <button
                    onClick={calculateAllPanels}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                    Calculate Panels Needed
                </button>
                {calculatedPanels && (
                    <button
                        onClick={() => setShowTable(!showTable)}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                        {showTable ? 'Hide Table' : 'Show Table'}
                    </button>
                )}
            </div>

            {panelAnalysis && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                    <h3 className="text-lg font-semibold mb-2">Panel Analysis</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                    </div>
                </div>
            )}

            {/* Leftover Panels Modal */}
            {showLeftoverDetails && panelCalculator && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
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
                                    {panelCalculator.leftovers.map((leftover, index) => (
                                        <tr key={leftover.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 border text-center">{index + 1}</td>
                                            <td className="px-4 py-2 border text-center">{leftover.shorter_face}</td>
                                            <td className="px-4 py-2 border text-center">{leftover.longer_face}</td>
                                            <td className="px-4 py-2 border text-center">{leftover.panelLength || walls[0]?.height || 'N/A'}</td>
                                            <td className="px-4 py-2 border text-center">{leftover.wallThickness}</td>
                                            <td className="px-4 py-2 border text-center">
                                                {`Left: ${leftover.leftEdgeType === '45_cut' ? '45° Cut' : 'Straight'}, Right: ${leftover.rightEdgeType === '45_cut' ? '45° Cut' : 'Straight'}`}
                                            </td>
                                            <td className="px-4 py-2 border text-center">
                                                {walls[0]?.project_name || 'N/A'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {showTable && calculatedPanels && (
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white border border-gray-300">
                        <thead>
                            <tr className="bg-gray-100">
                                <th className="px-4 py-2 border">No.</th>
                                <th className="px-4 py-2 border">Width (mm)</th>
                                <th className="px-4 py-2 border">Length (mm)</th>
                                <th className="px-4 py-2 border">Quantity</th>
                                <th className="px-4 py-2 border">Type</th>
                                <th className="px-4 py-2 border">Application</th>
                            </tr>
                        </thead>
                        <tbody>
                            {calculatedPanels.map((panel, index) => (
                                <tr key={index} className="hover:bg-gray-50">
                                    <td className="px-4 py-2 border text-center">{index + 1}</td>
                                    <td className="px-4 py-2 border text-center">{panel.width}</td>
                                    <td className="px-4 py-2 border text-center">{panel.length}</td>
                                    <td className="px-4 py-2 border text-center">{panel.quantity}</td>
                                    <td className="px-4 py-2 border text-center">{panel.type}</td>
                                    <td className="px-4 py-2 border text-center">{panel.application}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default PanelCalculationControls; 