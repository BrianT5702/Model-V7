import React, { useMemo } from 'react';
import { sortDoorsForMaterialList } from './doorSortUtils';

const DoorTable = ({ doors }) => {
    const sortedDoors = useMemo(() => sortDoorsForMaterialList(doors), [doors]);

    return (
        <div className="w-full max-w-4xl mt-4">
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white border border-gray-300">
                    <thead>
                        <tr className="bg-gray-100">
                            <th className="px-4 py-2 border">No.</th>
                            <th className="px-4 py-2 border">Door Type</th>
                            <th className="px-4 py-2 border">Single/Double Side</th>
                            <th className="px-4 py-2 border">Clear Opening Size</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedDoors.map((door, index) => (
                            <tr key={door.id ?? index} className="hover:bg-gray-50">
                                <td className="px-4 py-2 border text-center">{index + 1}</td>
                                <td className="px-4 py-2 border text-center">
                                    {door.door_type === 'swing' ? 'Swing' : door.door_type === 'slide' ? 'Slide' : 'Dock Door'}
                                </td>
                                <td className="px-4 py-2 border text-center">
                                    {door.door_type === 'dock' ? 'N/A' : (door.configuration === 'single_sided' || door.configuration === 'single' ? 'Single' : 'Double')}
                                </td>
                                <td className="px-4 py-2 border text-center">
                                    {`W ${door.width}mm x ${door.height}mm HT`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default DoorTable;
