import React, { useState } from 'react';
import { FaCube, FaFolderOpen } from 'react-icons/fa';
import { useShare } from './ShareContext';
import ProjectDetails from '../project/ProjectDetails';

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

const formatDimensions = (project) => {
    const height = project.height ?? '—';
    return `${project.width} × ${project.length} × ${height} mm`;
};

const ShareFolderPage = () => {
    const { share } = useShare();
    const [openProjectId, setOpenProjectId] = useState(null);
    const projects = Array.isArray(share?.projects) ? share.projects : [];
    const folderLabel = share?.folderPath || share?.folderName || 'Shared folder';

    if (openProjectId) {
        return (
            <ProjectDetails
                shareProjectId={String(openProjectId)}
                onShareBack={() => setOpenProjectId(null)}
                shareBackLabel="Back to folder"
            />
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
            <div className="max-w-5xl mx-auto px-4 py-6">
                <div className="flex items-start gap-3 mb-6">
                    <div className="mt-0.5 w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                        <FaFolderOpen />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            Shared folder · {share?.mode === 'edit' ? 'Editable' : 'View only'}
                        </p>
                        <h1 className="text-xl font-semibold truncate" title={folderLabel}>
                            {folderLabel}
                        </h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {projects.length === 0
                                ? 'This folder has no projects to open.'
                                : `${projects.length} project${projects.length === 1 ? '' : 's'}, including subfolders.`}
                        </p>
                    </div>
                </div>

                {projects.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 dark:bg-gray-800 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                <tr>
                                    <th className="px-4 py-2.5">Project</th>
                                    <th className="px-4 py-2.5 hidden md:table-cell">Folder</th>
                                    <th className="px-4 py-2.5 hidden sm:table-cell">Dimensions</th>
                                    <th className="px-4 py-2.5 hidden sm:table-cell">Modified</th>
                                    <th className="px-4 py-2.5 w-24" />
                                </tr>
                            </thead>
                            <tbody>
                                {projects.map((project) => (
                                    <tr
                                        key={project.id}
                                        className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer"
                                        onDoubleClick={() => setOpenProjectId(project.id)}
                                    >
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                onClick={() => setOpenProjectId(project.id)}
                                                className="flex items-center gap-2 min-w-0 text-left font-medium hover:text-blue-700 dark:hover:text-blue-300"
                                            >
                                                <FaCube className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                                                <span className="truncate">{project.name}</span>
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 hidden md:table-cell text-sm text-gray-500 dark:text-gray-400">
                                            {project.folder_name || '—'}
                                        </td>
                                        <td className="px-4 py-3 hidden sm:table-cell text-sm text-gray-500 dark:text-gray-400">
                                            {formatDimensions(project)}
                                        </td>
                                        <td className="px-4 py-3 hidden sm:table-cell text-sm text-gray-500 dark:text-gray-400">
                                            {formatDate(project.updated_at)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                type="button"
                                                onClick={() => setOpenProjectId(project.id)}
                                                className="px-2.5 py-1 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
                                            >
                                                Open
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ShareFolderPage;
