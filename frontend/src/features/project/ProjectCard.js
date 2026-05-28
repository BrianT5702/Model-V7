import React from 'react';

const ProjectCard = ({
    project,
    isDragging,
    onDragStart,
    onDragEnd,
    onClick,
    onEdit,
    onDelete,
    enableDrag = true,
}) => (
    <div
        draggable={enableDrag}
        onDragStart={enableDrag ? (e) => onDragStart(e, project) : undefined}
        onDragEnd={enableDrag ? onDragEnd : undefined}
        className={`group bg-white rounded-2xl border p-6 shadow-sm transition-all duration-300 transform ${
            enableDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
        } ${
            isDragging
                ? 'opacity-50 border-blue-400 ring-2 ring-blue-200 scale-[0.98]'
                : 'border-gray-200 hover:shadow-xl hover:border-blue-200 hover:-translate-y-2'
        }`}
        onClick={() => onClick(project.id)}
    >
        <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
            </div>
            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200">
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit(project);
                    }}
                    className="p-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-all duration-200"
                    title="Edit project"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                </button>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(project.id);
                    }}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all duration-200"
                    title="Delete project"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        </div>

        <h3 className="text-xl font-semibold text-gray-900 mb-3 group-hover:text-blue-600 transition-colors">
            {project.name}
        </h3>

        <div className="space-y-2 mb-4">
            <div className="flex items-center text-sm text-gray-600">
                <svg className="w-4 h-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                {project.width} × {project.length} × {project.calculated_height ?? project.height} mm
            </div>
            <div className="flex items-center text-sm text-gray-600">
                <svg className="w-4 h-4 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Wall thickness: {project.wall_thickness} mm
            </div>
        </div>

        <div className="flex items-center justify-between text-sm">
            {enableDrag ? (
                <span className="text-gray-400">Drag to move</span>
            ) : (
                <span className="text-gray-400">&nbsp;</span>
            )}
            <span className="text-blue-600 font-medium flex items-center">
                {enableDrag ? 'Open' : 'Click to open'}
                <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </span>
        </div>
    </div>
);

export default ProjectCard;
