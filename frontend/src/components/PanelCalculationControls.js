import React, { useState } from 'react';
import PanelCalculator from '../utils/PanelCalculator';

const PanelCalculationControls = ({ walls }) => {
    const [calculatedPanels, setCalculatedPanels] = useState(null);
    const [showTable, setShowTable] = useState(false);
    const [panelAnalysis, setPanelAnalysis] = useState(null);
    const [cutPanelsCount, setCutPanelsCount] = useState(0);

    const calculateAllPanels = () => {
        const panelCalculator = new PanelCalculator();
        const allPanels = [];

        walls.forEach(wall => {
            const wallLength = Math.sqrt(
                Math.pow(wall.end_x - wall.start_x, 2) + 
                Math.pow(wall.end_y - wall.start_y, 2)
            );

            const panels = panelCalculator.calculatePanels(
                wallLength,
                wall.thickness,
                wall.joint_type || 'butt_in',
                wall.application_type || 'wall'
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
                    application: wall.application_type || 'wall',
                    wallId: wall.id,
                    wallLength: wallLength,
                    wallStart: `(${Math.round(wall.start_x)}, ${Math.round(wall.start_y)})`,
                    wallEnd: `(${Math.round(wall.end_x)}, ${Math.round(wall.end_y)})`
                });
            });
        });

        // Get panel analysis
        const analysis = panelCalculator.getPanelAnalysis();
        setPanelAnalysis(analysis);

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
                        <div className="p-2 bg-white rounded shadow">
                            <div className="text-sm text-gray-600">Leftover Panels</div>
                            <div className="text-xl font-bold">{panelAnalysis.details.leftoverPanels}</div>
                        </div>
                        <div className="p-2 bg-white rounded shadow">
                            <div className="text-sm text-gray-600">Total Waste</div>
                            <div className="text-xl font-bold">{Math.round(panelAnalysis.totalWaste)} mm</div>
                        </div>
                    </div>
                    <div className="mt-4 p-2 bg-white rounded shadow">
                        <div className="text-sm text-gray-600">Optimization Score</div>
                        <div className="text-xl font-bold">{Math.round(panelAnalysis.optimizationScore)}%</div>
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