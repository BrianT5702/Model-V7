import React, { useMemo } from 'react';
import { buildDoorSchedule } from './doorSchedule';

const DoorTable = ({ doors }) => {
    const schedule = useMemo(() => buildDoorSchedule(doors), [doors]);

    if (!schedule.types.length) {
        return (
            <p className="text-sm text-gray-500 dark:text-gray-400">No doors on this plan yet.</p>
        );
    }

    return (
        <div className="w-full">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                SW swing, SD sliding, DS dock. Double swing is DSW and double sliding is DSD. Doors of the same configuration share one row, written SW1-1, SW1-2 - SW1-6.
            </p>
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-[11px] leading-tight">
                    <thead>
                        <tr className="bg-gray-100 dark:bg-gray-800">
                            <th className="px-2 py-1 border border-gray-300 dark:border-gray-600 font-medium">Marks</th>
                            <th className="px-2 py-1 border border-gray-300 dark:border-gray-600 font-medium">Kind</th>
                            <th className="px-2 py-1 border border-gray-300 dark:border-gray-600 font-medium">Opening</th>
                            <th className="px-2 py-1 border border-gray-300 dark:border-gray-600 font-medium">Qty</th>
                            <th className="px-2 py-1 border border-gray-300 dark:border-gray-600 font-medium">Clear opening</th>
                        </tr>
                    </thead>
                    <tbody>
                        {schedule.types.map((row) => (
                            <tr key={row.key} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                                <td className="px-2 py-1 border border-gray-300 dark:border-gray-600 text-left whitespace-nowrap">
                                    {row.run}
                                </td>
                                <td className="px-2 py-1 border border-gray-300 dark:border-gray-600 text-center">{row.familyLabel}</td>
                                <td className="px-2 py-1 border border-gray-300 dark:border-gray-600 text-center">{row.openingLabel}</td>
                                <td className="px-2 py-1 border border-gray-300 dark:border-gray-600 text-center">{row.count}</td>
                                <td className="px-2 py-1 border border-gray-300 dark:border-gray-600 text-center">
                                    {`W ${row.width}mm × ${row.height}mm HT`}
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
