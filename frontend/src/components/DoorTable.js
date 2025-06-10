import React from 'react';

const DoorTable = ({ doors }) => {
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
                        {doors.map((door, index) => (
                            <tr key={door.id} className="hover:bg-gray-50">
                                <td className="px-4 py-2 border text-center">{index + 1}</td>
                                <td className="px-4 py-2 border text-center">{door.door_type === 'swing' ? 'Swing' : 'Slide'}</td>
                                <td className="px-4 py-2 border text-center">{door.configuration === 'single_sided' ? 'Single' : 'Double'}</td>
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