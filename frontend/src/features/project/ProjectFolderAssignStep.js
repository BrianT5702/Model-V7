import React, { useMemo, useState } from 'react';
import { FaFolder, FaFolderPlus } from 'react-icons/fa';
import api from '../../api/api';
import {
    UNCATEGORIZED_KEY,
    buildFolderTree,
    flattenVisibleFolderTree,
    getCreateFolderParentId,
    getFolderLabel,
    getFolderPath,
} from './projectFolderUtils';

const ProjectFolderAssignStep = ({
    projectName,
    folders,
    setFolders,
    selectedFolderKey,
    onSelectedFolderKeyChange,
    onConfirm,
    onSkip,
    isSubmitting,
    error,
}) => {
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [createFolderError, setCreateFolderError] = useState('');

    const folderOptions = useMemo(() => {
        const tree = buildFolderTree(folders);
        const expanded = new Set(folders.map((folder) => folder.id));
        const rows = flattenVisibleFolderTree(tree, expanded);
        return [
            { key: UNCATEGORIZED_KEY, label: 'Uncategorized', depth: 0 },
            ...rows.map((row) => ({
                key: row.key,
                label: getFolderPath(row.key, folders),
                depth: row.depth + 1,
            })),
        ];
    }, [folders]);

    const handleCreateFolder = async (e) => {
        e.preventDefault();
        const name = newFolderName.trim();
        if (!name) return;

        setCreateFolderError('');
        try {
            const parent = getCreateFolderParentId(selectedFolderKey);
            const response = await api.post('project-folders/', { name, parent });
            setFolders((prev) => [...prev, response.data]);
            onSelectedFolderKeyChange(response.data.id);
            setNewFolderName('');
            setIsCreatingFolder(false);
        } catch (err) {
            const message = err.response?.data?.name?.[0]
                || err.response?.data?.error
                || (typeof err.response?.data === 'object'
                    ? Object.values(err.response.data).flat().join(' ')
                    : null)
                || 'Failed to create folder.';
            setCreateFolderError(message);
        }
    };

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">Choose a folder</h2>
                <p className="mt-2 text-sm text-gray-600">
                    Where should <span className="font-semibold text-gray-900">&ldquo;{projectName}&rdquo;</span> be saved?
                </p>
            </div>

            <div className="max-h-56 overflow-y-auto pr-1 space-y-1 border border-gray-200 rounded-lg p-2 bg-gray-50/50">
                {folderOptions.map((option) => {
                    const isSelected = selectedFolderKey === option.key;
                    return (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => onSelectedFolderKeyChange(option.key)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${
                                isSelected
                                    ? 'border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-200'
                                    : 'border-transparent bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                            style={{ marginLeft: `${option.depth * 12}px`, width: `calc(100% - ${option.depth * 12}px)` }}
                        >
                            <FaFolder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-500' : 'text-amber-500'}`} />
                            <span className="truncate">{option.label}</span>
                        </button>
                    );
                })}
            </div>

            <div className="border-t border-gray-100 pt-4">
                {!isCreatingFolder ? (
                    <button
                        type="button"
                        onClick={() => setIsCreatingFolder(true)}
                        className="inline-flex items-center gap-2 text-sm font-medium text-indigo-700 hover:text-indigo-900"
                    >
                        <FaFolderPlus className="w-4 h-4" />
                        {selectedFolderKey === UNCATEGORIZED_KEY
                            ? 'Create a new folder'
                            : `Create subfolder in ${getFolderLabel(selectedFolderKey, folders)}`}
                    </button>
                ) : (
                    <form onSubmit={handleCreateFolder} className="space-y-2">
                        <p className="text-xs text-gray-500">
                            {selectedFolderKey === UNCATEGORIZED_KEY
                                ? 'New folder will be created at the top level.'
                                : `New folder will be created inside ${getFolderLabel(selectedFolderKey, folders)}.`}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                type="text"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                placeholder="Folder name"
                                className="flex-1 min-w-[160px] px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                                autoFocus
                            />
                            <button
                                type="submit"
                                className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                                Add folder
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsCreatingFolder(false);
                                    setNewFolderName('');
                                    setCreateFolderError('');
                                }}
                                className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
                {createFolderError && (
                    <p className="mt-2 text-sm text-red-600">{createFolderError}</p>
                )}
            </div>

            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                    {error}
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                    type="button"
                    onClick={onSkip}
                    disabled={isSubmitting}
                    className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
                >
                    Leave in Uncategorized
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                    {isSubmitting
                        ? 'Saving...'
                        : `Save to ${getFolderLabel(selectedFolderKey, folders)}`}
                </button>
            </div>
        </div>
    );
};

export default ProjectFolderAssignStep;
