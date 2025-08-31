
import React, { useState, useEffect } from 'react';
import PanelCalculator from './PanelCalculator';
import { exportCanvasAsImage, exportCanvasAsSVG } from '../canvas/utils';

const PanelCalculationControls = ({ 
    walls, 
    intersections, 
    doors, 
    showMaterialDetails, 
    toggleMaterialDetails,
    canvasRef,
    rooms = [],
    project = null,
    updateSharedPanelData // Added prop for sharing data
}) => {
    const [calculatedPanels, setCalculatedPanels] = useState(null);
    const [showTable, setShowTable] = useState(false);
    const [panelAnalysis, setPanelAnalysis] = useState(null);
    const [cutPanelsCount, setCutPanelsCount] = useState(0);
    const [showLeftoverDetails, setShowLeftoverDetails] = useState(false);
    const [panelCalculator, setPanelCalculator] = useState(null);
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportTab, setExportTab] = useState('pdf'); // 'pdf', 'csv', 'sketch'
    const [isCalculating, setIsCalculating] = useState(false);

    // Auto-show panel table when panels are calculated
    useEffect(() => {
        if (calculatedPanels && calculatedPanels.length > 0) {
            setShowTable(true);
        }
    }, [calculatedPanels]);

    // Helper to generate CSV string from calculatedPanels
    const getCSVString = () => {
        if (!calculatedPanels) return '';
        const header = 'Width,Length,Application,Quantity,Type';
        const rows = calculatedPanels.map(panel =>
            `${panel.width},${panel.length},${panel.application},${panel.quantity},${panel.type}`
        );
        return [header, ...rows].join('\n');
    };

    // Helper to generate HTML table for PDF preview (as React element)
    const getPDFTable = () => {
        if (!calculatedPanels) return null;
        return (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                    <tr style={{ background: '#f3f3f3' }}>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Width</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Length</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Application</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Quantity</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Type</th>
                    </tr>
                </thead>
                <tbody>
                    {calculatedPanels.map((panel, idx) => (
                        <tr key={idx}>
                            <td style={{ border: '1px solid #ccc', padding: '4px' }}>{panel.width}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px' }}>{panel.length}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px' }}>{panel.application}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px' }}>{panel.quantity}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px' }}>{panel.type}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    // Helper to generate HTML table as a string for PDF export
    const getPDFTableHtml = () => {
        if (!calculatedPanels) return '';
        const header = `
            <tr>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Width</th>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Length</th>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Application</th>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Quantity</th>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Type</th>
            </tr>
        `;
        const rows = calculatedPanels.map(panel => `
            <tr>
                <td style="border:1px solid #ccc;padding:4px;">${panel.width}</td>
                <td style="border:1px solid #ccc;padding:4px;">${panel.length}</td>
                <td style="border:1px solid #ccc;padding:4px;">${panel.application}</td>
                <td style="border:1px solid #ccc;padding:4px;">${panel.quantity}</td>
                <td style="border:1px solid #ccc;padding:4px;">${panel.type}</td>
            </tr>
        `).join('');
        return `<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
    };

    // Helper to generate HTML table for door details (React element)
    const getDoorTable = () => {
        if (!doors || doors.length === 0) return null;
        return (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', marginTop: '32px' }}>
                <thead>
                    <tr style={{ background: '#f3f3f3' }}>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>No.</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Door Type</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Single/Double Side</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px' }}>Clear Opening Size</th>
                    </tr>
                </thead>
                <tbody>
                    {doors.map((door, idx) => (
                        <tr key={door.id || idx}>
                            <td style={{ border: '1px solid #ccc', padding: '4px', textAlign: 'center' }}>{idx + 1}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px', textAlign: 'center' }}>{door.door_type === 'swing' ? 'Swing' : 'Slide'}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px', textAlign: 'center' }}>{door.configuration === 'single_sided' ? 'Single' : 'Double'}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px', textAlign: 'center' }}>{`W ${door.width}mm x ${door.height}mm HT`}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    // Helper to generate HTML table as a string for door details (for PDF export)
    const getDoorTableHtml = () => {
        if (!doors || doors.length === 0) return '';
        const header = `
            <tr>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">No.</th>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Door Type</th>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Single/Double Side</th>
                <th style="border:1px solid #ccc;padding:4px;background:#f3f3f3;">Clear Opening Size</th>
            </tr>
        `;
        const rows = doors.map((door, idx) => `
            <tr>
                <td style="border:1px solid #ccc;padding:4px;text-align:center;">${idx + 1}</td>
                <td style="border:1px solid #ccc;padding:4px;text-align:center;">${door.door_type === 'swing' ? 'Swing' : 'Slide'}</td>
                <td style="border:1px solid #ccc;padding:4px;text-align:center;">${door.configuration === 'single_sided' ? 'Single' : 'Double'}</td>
                <td style="border:1px solid #ccc;padding:4px;text-align:center;">W ${door.width}mm x ${door.height}mm HT</td>
            </tr>
        `).join('');
        return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:32px;"><thead>${header}</thead><tbody>${rows}</tbody></table>`;
    };

    // Helper to generate CSV for doors
    const getDoorCSV = () => {
        if (!doors || doors.length === 0) return '';
        const header = 'No.,Door Type,Single/Double Side,Clear Opening Size';
        const rows = doors.map((door, idx) =>
            `${idx + 1},${door.door_type === 'swing' ? 'Swing' : 'Slide'},${door.configuration === 'single_sided' ? 'Single' : 'Double'},W ${door.width}mm x ${door.height}mm HT`
        );
        return [header, ...rows].join('\n');
    };

    // Update getPDFTableHtml and getCSVString to include door table
    const getPDFTableHtmlWithDoors = () => {
        return getPDFTableHtml() + getDoorTableHtml();
    };
    const getCSVStringWithDoors = () => {
        return getCSVString() + '\n\n' + getDoorCSV();
    };

    // Download helpers
    const downloadCSV = () => {
        const csv = getCSVStringWithDoors();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'material_panels_and_doors.csv';
        a.click();
        URL.revokeObjectURL(url);
    };
    const downloadPDF = () => {
        // Open a new window with both tables for printing
        const tableHtml = `<!DOCTYPE html><html><head><title>Material Panels PDF</title><style>
            table { width: 100%; border-collapse: collapse; font-size: 14px; }
            th, td { border: 1px solid #ccc; padding: 4px; }
            th { background: #f3f3f3; }
        </style></head><body>${getPDFTableHtmlWithDoors()}</body></html>`;
        const printWindow = window.open('', '', 'width=800,height=600');
        printWindow.document.write(tableHtml);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        // Do NOT close the window automatically!
    };

    // Sketch export functions
    const downloadSketchAsPNG = () => {
        const projectName = project?.name || 'project';
        const filename = `${projectName}_2d_sketch.png`;
        exportCanvasAsImage(canvasRef, filename);
    };

    const downloadSketchAsSVG = () => {
        const projectName = project?.name || 'project';
        const filename = `${projectName}_2d_sketch.svg`;
        exportCanvasAsSVG(canvasRef, walls, rooms, doors, intersections, filename);
    };

    const calculateAllPanels = () => {
        try {
            setIsCalculating(true);
            
            if (!walls || !Array.isArray(walls) || walls.length === 0) {
                console.warn('No walls data available for panel calculation');
                setIsCalculating(false);
                return;
            }
            
            if (!intersections || !Array.isArray(intersections)) {
                console.warn('No intersections data available for panel calculation');
                setIsCalculating(false);
                return;
            }

            // Check if PanelCalculator is available
            if (typeof PanelCalculator !== 'function') {
                console.error('PanelCalculator class is not available');
                setIsCalculating(false);
                return;
            }

            const calculator = new PanelCalculator();
            const allPanels = [];

        walls.forEach(wall => {
            // Validate wall object structure
            if (!wall || typeof wall.start_x !== 'number' || typeof wall.start_y !== 'number' || 
                typeof wall.end_x !== 'number' || typeof wall.end_y !== 'number') {
                console.warn('Invalid wall data structure:', wall);
                return;
            }
            
            const wallLength = Math.sqrt(
                Math.pow(wall.end_x - wall.start_x, 2) + 
                Math.pow(wall.end_y - wall.start_y, 2)
            );

            // Find all intersections for this wall
            const wallIntersections = intersections.filter(inter => 
                inter.pairs && inter.pairs.some(pair => 
                    pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)
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
                if (!inter.pairs) return;
                inter.pairs.forEach(pair => {
                    if (pair.wall1 && pair.wall2 && (pair.wall1.id === wall.id || pair.wall2.id === wall.id)) {
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
                        }
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
                });
            });

            // Set joint types, prioritizing 45_cut
            leftJointType = leftEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';
            rightJointType = rightEndIntersections.includes('45_cut') ? '45_cut' : 'butt_in';

            // Validate wall height and thickness
            if (typeof wall.height !== 'number' || typeof wall.thickness !== 'number') {
                console.warn('Invalid wall height or thickness:', { height: wall.height, thickness: wall.thickness });
                return;
            }
            
            const panels = calculator.calculatePanels(
                wallLength,
                wall.thickness,
                { left: leftJointType, right: rightJointType }
            );

            // Validate panels array
            if (!panels || !Array.isArray(panels)) {
                console.warn('No panels returned for wall:', wall.id);
                return;
            }
            
            // Add wall-specific information to each panel
            panels.forEach(panel => {
                if (!panel || typeof panel.width !== 'number') {
                    console.warn('Invalid panel data:', panel);
                    return;
                }
                
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

        // Share panel data with other tabs if updateSharedPanelData is provided
        if (updateSharedPanelData) {
            // Group panels by dimensions and application for sharing (matches table structure)
            const groupedPanelsForSharing = allPanels.reduce((acc, panel) => {
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
            
            updateSharedPanelData('wall-plan', Object.values(groupedPanelsForSharing), analysis);
        }

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

        // Final validation before setting state
        if (Object.keys(groupedPanels).length === 0) {
            console.warn('No panels calculated');
            return;
        }

        setCalculatedPanels(Object.values(groupedPanels));

        // Calculate cut panels count (only 'side' panels)
        const cutPanelsCount = Object.values(groupedPanels)
            .filter(panel => panel.type === 'side')
            .reduce((sum, panel) => sum + panel.quantity, 0);
        setCutPanelsCount(cutPanelsCount);
        
        setIsCalculating(false);
        } catch (error) {
            console.error('Error calculating panels:', error);
            setCalculatedPanels(null);
            setShowTable(false);
            setIsCalculating(false);
        }
    };

    const handleButtonClick = () => {
        if (!showMaterialDetails) {
            // Calculate panels when showing material details
            calculateAllPanels();
        } else {
            // Clear data when hiding material details
            setCalculatedPanels(null);
            setPanelAnalysis(null);
            setShowTable(false);
            setCutPanelsCount(0);
        }
        toggleMaterialDetails();
    };

    return (
        <div className="w-full max-w-4xl mt-4 material-list-container">
            <div className="flex gap-4 mb-4">
                <button
                    onClick={handleButtonClick}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                    {showMaterialDetails ? 'Hide Material Needed' : 'View Material Needed'}
                </button>
                {/* Show Panel Details button only when material details are visible */}
                {showMaterialDetails && calculatedPanels && (
                    <button
                        onClick={() => setShowTable(!showTable)}
                        className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                        {showTable ? 'Hide Panel Details' : 'Show Panel Details'}
                    </button>
                )}
                {/* Export button, only show when material details are visible */}
                {showMaterialDetails && calculatedPanels && (
                    <button
                        onClick={() => setShowExportModal(true)}
                        className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900"
                    >
                        Export
                    </button>
                )}
            </div>

            {/* Export Modal */}
            {showExportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
                    <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl relative">
                        <button
                            onClick={() => setShowExportModal(false)}
                            className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 text-xl"
                        >
                            &times;
                        </button>
                        <div className="flex gap-4 mb-4">
                            <button
                                className={`px-4 py-2 rounded ${exportTab === 'pdf' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
                                onClick={() => setExportTab('pdf')}
                            >PDF Preview</button>
                            <button
                                className={`px-4 py-2 rounded ${exportTab === 'csv' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
                                onClick={() => setExportTab('csv')}
                            >CSV Preview</button>
                            <button
                                className={`px-4 py-2 rounded ${exportTab === 'sketch' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
                                onClick={() => setExportTab('sketch')}
                            >2D Sketch</button>
                        </div>
                        <div className="overflow-auto max-h-96 border rounded p-4 bg-gray-50">
                            {exportTab === 'pdf' ? (
                                <div>
                                    {getPDFTable()}
                                    {getDoorTable()}
                                </div>
                            ) : exportTab === 'csv' ? (
                                <pre className="whitespace-pre-wrap text-sm">{getCSVStringWithDoors()}</pre>
                            ) : exportTab === 'sketch' ? (
                                <div className="text-center">
                                    <div className="mb-4">
                                        <h3 className="text-lg font-semibold mb-2">2D Sketch Export</h3>
                                        <p className="text-gray-600 mb-4">
                                            Export your 2D floor plan sketch in high-quality image or vector format.
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="p-4 border rounded bg-white">
                                            <h4 className="font-semibold mb-2">PNG Image</h4>
                                            <p className="text-sm text-gray-600 mb-3">
                                                High-resolution raster image suitable for printing and sharing.
                                            </p>
                                            <button
                                                onClick={downloadSketchAsPNG}
                                                className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                            >
                                                Download PNG
                                            </button>
                                        </div>
                                        <div className="p-4 border rounded bg-white">
                                            <h4 className="font-semibold mb-2">SVG Vector</h4>
                                            <p className="text-sm text-gray-600 mb-3">
                                                Scalable vector format for editing and high-quality printing.
                                            </p>
                                            <button
                                                onClick={downloadSketchAsSVG}
                                                className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                                            >
                                                Download SVG
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        <div className="flex gap-4 mt-6 justify-end">
                            {exportTab === 'pdf' && (
                                <button
                                    onClick={downloadPDF}
                                    className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800"
                                >
                                    Save as PDF
                                </button>
                            )}
                            {exportTab === 'csv' && (
                                <button
                                    onClick={downloadCSV}
                                    className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800"
                                >
                                    Save as CSV
                                </button>
                            )}
                            {exportTab === 'sketch' && (
                                <>
                                    <button
                                        onClick={downloadSketchAsPNG}
                                        className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800"
                                    >
                                        Download PNG
                                    </button>
                                    <button
                                        onClick={downloadSketchAsSVG}
                                        className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800"
                                    >
                                        Download SVG
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showMaterialDetails && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <h3 className="text-lg font-semibold mb-2 text-gray-900">Material Analysis</h3>
                    
                    {!walls || walls.length === 0 ? (
                        <div className="text-center py-4 text-gray-500">
                            No walls available for material calculation. Please add walls to your project first.
                        </div>
                    ) : isCalculating ? (
                        <div className="text-center py-8">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="mt-2 text-gray-600">Calculating material requirements...</p>
                        </div>
                    ) : panelAnalysis ? (
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
                        {calculatedPanels && (
                            <div className="p-2 bg-white rounded shadow">
                                <div className="text-sm text-gray-600">Doors Needed</div>
                                <div className="text-xl font-bold">{doors.length}</div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-center py-4 text-gray-500">
                        No material data available. Please ensure you have walls in your project.
                    </div>
                )}
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