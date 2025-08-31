import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api/api';
import PanelCalculator from '../panel/PanelCalculator';

const ProjectSummary = ({ projectId }) => {
    const [projectData, setProjectData] = useState(null);
    const [rooms, setRooms] = useState([]);
    const [ceilingPlans, setCeilingPlans] = useState([]);
    const [floorPlans, setFloorPlans] = useState([]);
    const [walls, setWalls] = useState([]);
    const [wallPanelList, setWallPanelList] = useState([]);
    const [doors, setDoors] = useState([]);
    
    // Loading states
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Fetch all project data
    useEffect(() => {
        const fetchProjectData = async () => {
            try {
                setIsLoading(true);
                setError(null);

                // Fetch project details
                const projectResponse = await api.get(`/projects/${projectId}/`);
                setProjectData(projectResponse.data);

                // Fetch rooms
                const roomsResponse = await api.get(`/rooms/?project=${projectId}`);
                setRooms(roomsResponse.data);

                // Fetch ceiling plans for all rooms
                const ceilingPlansPromises = roomsResponse.data.map(room => 
                    api.get(`/ceiling-plans/?room=${room.id}`)
                );
                const ceilingResponses = await Promise.all(ceilingPlansPromises);
                const allCeilingPlans = ceilingResponses.flatMap(response => response.data);
                setCeilingPlans(allCeilingPlans);

                // Fetch floor plans for all rooms
                const floorPlansPromises = roomsResponse.data.map(room => 
                    api.get(`/floor-plans/?room=${room.id}`)
                );
                const floorResponses = await Promise.all(floorPlansPromises);
                const allFloorPlans = floorResponses.flatMap(response => response.data);
                setFloorPlans(allFloorPlans);

                // Fetch walls for panel calculation
                const wallsResponse = await api.get(`/projects/${projectId}/walls/`);
                setWalls(wallsResponse.data);

                // Fetch wall panel list (actual quantities from panel table)
                try {
                    const wallPanelResponse = await api.get(`/projects/${projectId}/wall-panel-list/`);
                    setWallPanelList(wallPanelResponse.data);
                } catch (wallErr) {
                    console.log('Wall panel list not available');
                    setWallPanelList([]);
                }

                // Fetch doors
                const doorsResponse = await api.get(`/doors/?project=${projectId}`);
                setDoors(doorsResponse.data);

            } catch (err) {
                console.error('Error fetching project data:', err);
                setError('Failed to load project data. Please try again.');
            } finally {
                setIsLoading(false);
            }
        };

        if (projectId) {
            fetchProjectData();
        }
    }, [projectId]);

    // Calculate room area
    const calculateRoomArea = (roomPoints) => {
        if (roomPoints.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < roomPoints.length; i++) {
            const j = (i + 1) % roomPoints.length;
            area += roomPoints[i].x * roomPoints[j].y;
            area -= roomPoints[j].x * roomPoints[i].y;
        }
        return Math.abs(area) / 2;
    };

    // Calculate wall panels using PanelCalculator
    const calculateWallPanels = (walls) => {
        if (!walls || walls.length === 0) return 0;
        
        const calculator = new PanelCalculator();
        let totalPanels = 0;
        
        walls.forEach(wall => {
            if (wall.start_x !== undefined && wall.start_y !== undefined && 
                wall.end_x !== undefined && wall.end_y !== undefined &&
                wall.height && wall.thickness) {
                
                const wallLength = Math.sqrt(
                    Math.pow(wall.end_x - wall.start_x, 2) + 
                    Math.pow(wall.end_y - wall.start_y, 2)
                );
                
                // Calculate panels for this wall (assuming butt_in joints for simplicity)
                const panels = calculator.calculatePanels(wallLength, wall.thickness, { left: 'butt_in', right: 'butt_in' });
                totalPanels += panels.length;
            }
        });
        
        return totalPanels;
    };

    // Calculate aggregated panel information
    const panelSummary = useMemo(() => {
        if (!rooms.length) return null;

        // Count ceiling panels
        const ceilingPanels = ceilingPlans.reduce((total, plan) => {
            return total + (plan.total_panels || 0);
        }, 0);

        // Count floor panels
        const floorPanels = floorPlans.reduce((total, plan) => {
            return total + (plan.total_panels || 0);
        }, 0);

        // Calculate wall panels using PanelCalculator
        const wallPanels = calculateWallPanels(walls);

        // Calculate total area
        const totalArea = rooms.reduce((total, room) => {
            if (room.room_points && room.room_points.length > 0) {
                return total + calculateRoomArea(room.room_points);
            }
            return total;
        }, 0);

        return {
            ceiling: ceilingPanels,
            floor: floorPanels,
            wall: wallPanels,
            total: ceilingPanels + floorPanels + wallPanels,
            area: totalArea
        };
    }, [rooms, ceilingPlans, floorPlans, walls]);

    if (isLoading) {
        return (
            <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                    <div className="space-y-3">
                        <div className="h-4 bg-gray-200 rounded w-full"></div>
                        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="text-center text-red-600">
                    <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <p className="text-lg font-semibold">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="mb-6">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    Project Summary
                </h3>
                <p className="text-gray-600">
                    Comprehensive overview of all project materials and quantities
                </p>
            </div>

            {/* Project Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{rooms.length}</div>
                        <div className="text-sm text-blue-700">Rooms</div>
                    </div>
                </div>
                                 <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
                     <div className="text-center">
                         <div className="text-2xl font-bold text-green-600">{walls.length}</div>
                         <div className="text-sm text-green-700">Walls</div>
                     </div>
                 </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{doors.length}</div>
                        <div className="text-sm text-purple-700">Doors</div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg p-4">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">
                            {projectData ? `${projectData.width} × ${projectData.length}` : 'N/A'}
                        </div>
                        <div className="text-sm text-orange-700">Dimensions (mm)</div>
                    </div>
                </div>
            </div>

            {/* Panel Summary */}
            {panelSummary ? (
                <div className="bg-gray-50 rounded-lg p-6 mb-8">
                    <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        Panel Quantities
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-blue-600">{panelSummary.ceiling}</div>
                                <div className="text-sm text-gray-600">Ceiling Panels</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {ceilingPlans.length > 0 ? `${ceilingPlans.length} plans` : 'No plans'}
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-green-600">{panelSummary.floor}</div>
                                <div className="text-sm text-gray-600">Floor Panels</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {floorPlans.length > 0 ? `${floorPlans.length} plans` : 'No plans'}
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-purple-600">{panelSummary.wall}</div>
                                <div className="text-sm text-gray-600">Wall Panels</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {walls.length > 0 ? `${walls.length} walls` : 'No walls'}
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg p-4 border border-gray-200">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-indigo-600">{panelSummary.total}</div>
                                <div className="text-sm text-gray-600">Total Panels</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {panelSummary.area > 0 ? `${Math.round(panelSummary.area / 1000000)} m² area` : 'No area data'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-gray-50 rounded-lg p-6 mb-8">
                    <div className="text-center text-gray-500">
                        <p>No panel data available. Please generate ceiling and floor plans first.</p>
                    </div>
                </div>
            )}

            {/* Room Details */}
            {rooms.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-6">
                    <h4 className="font-semibold text-gray-800 mb-4 flex items-center">
                        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                        </svg>
                        Room Details
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="min-w-full border border-gray-300">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Room Name
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Floor Type
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Floor Thickness
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Height
                                    </th>
                                    <th className="px-4 py-2 border border-gray-300 text-left text-sm font-medium text-gray-700">
                                        Walls
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {rooms.map((room, index) => (
                                    <tr key={room.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900 font-medium">
                                            {room.room_name}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_type || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.floor_thickness || 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.height ? `${room.height}mm` : 'N/A'}
                                        </td>
                                        <td className="px-4 py-2 border border-gray-300 text-sm text-gray-900">
                                            {room.walls ? room.walls.length : 0}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectSummary;
