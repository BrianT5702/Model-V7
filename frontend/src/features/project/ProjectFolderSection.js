import React, { useState } from 'react';
import { FaFolder, FaFolderOpen, FaChevronDown, FaChevronRight, FaPencilAlt, FaTrash } from 'react-icons/fa';
import ProjectCard from './ProjectCard';

const UNCATEGORIZED_KEY = 'uncategorized';

const ProjectFolderSection = ({
    folderId,
    folderName,
    projects,
    isDropTarget,
    onDragOver,
    onDragLeave,
    onDrop,
    onRenameFolder,
    onDeleteFolder,
    draggingProjectId,
    onProjectDragStart,
    onProjectDragEnd,
    onProjectClick,
    onProjectEdit,
    onProjectDelete,
    defaultCollapsed = false,
    showFolderActions = true,
    canEdit = true,
}) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(folderName);

    const handleRenameSubmit = (e) => {
        e.preventDefault();
        const trimmed = editName.trim();
        if (trimmed && trimmed !== folderName && onRenameFolder) {
            onRenameFolder(folderId, trimmed);
        }
        setIsEditing(false);
        setEditName(folderName);
    };

    const isUncategorized = folderId === UNCATEGORIZED_KEY;

    return (
        <section
            className={`mb-8 rounded-2xl border-2 transition-colors duration-200 ${
                isDropTarget
                    ? 'border-blue-400 bg-blue-50/50 shadow-inner'
                    : 'border-gray-200 bg-gray-50/50'
            }`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 border-b border-gray-200 bg-white rounded-t-2xl">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => setCollapsed(!collapsed)}
                        className="p-1 text-gray-500 hover:text-gray-800 rounded"
                        aria-label={collapsed ? 'Expand folder' : 'Collapse folder'}
                    >
                        {collapsed ? <FaChevronRight className="w-4 h-4" /> : <FaChevronDown className="w-4 h-4" />}
                    </button>
                    {collapsed ? (
                        <FaFolder className="w-5 h-5 text-amber-500 shrink-0" />
                    ) : (
                        <FaFolderOpen className="w-5 h-5 text-amber-500 shrink-0" />
                    )}
                    {isEditing && showFolderActions ? (
                        <form onSubmit={handleRenameSubmit} className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                            <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full px-2 py-1 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                                autoFocus
                                onBlur={() => {
                                    setIsEditing(false);
                                    setEditName(folderName);
                                }}
                            />
                        </form>
                    ) : (
                        <h3 className="text-lg font-semibold text-gray-900 truncate">{folderName}</h3>
                    )}
                    <span className="text-sm text-gray-500 shrink-0">({projects.length})</span>
                </div>
                {showFolderActions && !isUncategorized && (
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                setEditName(folderName);
                                setIsEditing(true);
                            }}
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Rename folder"
                        >
                            <FaPencilAlt className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onDeleteFolder?.(folderId)}
                            className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Delete folder"
                        >
                            <FaTrash className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </header>

            {!collapsed && (
                <div className="p-4 sm:p-5 min-h-[120px]">
                    {projects.length === 0 ? (
                        <p className="text-center text-sm text-gray-400 py-8 border-2 border-dashed border-gray-200 rounded-xl">
                            {isDropTarget ? 'Drop project here' : 'Drag projects here'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {projects.map((project) => (
                                <ProjectCard
                                    key={project.id}
                                    project={project}
                                    isDragging={draggingProjectId === project.id}
                                    enableDrag={canEdit}
                                    canEdit={canEdit}
                                    onDragStart={onProjectDragStart}
                                    onDragEnd={onProjectDragEnd}
                                    onClick={onProjectClick}
                                    onEdit={onProjectEdit}
                                    onDelete={onProjectDelete}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};

export { UNCATEGORIZED_KEY };
export default ProjectFolderSection;
