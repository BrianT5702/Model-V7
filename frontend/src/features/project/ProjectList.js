import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPlus, FaFolderPlus } from 'react-icons/fa';
import api from '../../api/api';
import EditProject from './EditProject';
import ProjectCard from './ProjectCard';
import ProjectFolderSection, { UNCATEGORIZED_KEY } from './ProjectFolderSection';

const ProjectList = ({ projects, setProjects, folders, setFolders, foldersAvailable = true }) => {
    const navigate = useNavigate();
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState(null);
    const [deleteSuccess, setDeleteSuccess] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const [showEditModal, setShowEditModal] = useState(false);
    const [projectToEdit, setProjectToEdit] = useState(null);
    const [draggingProjectId, setDraggingProjectId] = useState(null);
    const [dropTargetId, setDropTargetId] = useState(null);
    const [showFolderDeleteConfirm, setShowFolderDeleteConfirm] = useState(false);
    const [folderToDelete, setFolderToDelete] = useState(null);
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    const safeProjects = Array.isArray(projects) ? projects : [];
    const safeFolders = Array.isArray(folders) ? folders : [];

    const isDatabaseConnectionError = (error) => (
        error.code === 'ERR_NETWORK' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('Network Error') ||
        error.message?.includes('Failed to fetch') ||
        error.message?.includes('Connection refused') ||
        error.message?.includes('getaddrinfo ENOTFOUND') ||
        (error.response?.status >= 500 && error.response?.status < 600)
    );

    const showDatabaseError = () => {
        setDbConnectionError(true);
        setTimeout(() => setDbConnectionError(false), 5000);
    };

    const sortProjects = useCallback((items) => {
        return [...items].sort((a, b) => {
            const orderA = a.list_order ?? 0;
            const orderB = b.list_order ?? 0;
            if (orderA !== orderB) return orderA - orderB;
            return new Date(b.updated_at) - new Date(a.updated_at);
        });
    }, []);

    const projectsByFolder = useMemo(() => {
        const grouped = { [UNCATEGORIZED_KEY]: [] };
        safeFolders.forEach((folder) => {
            grouped[folder.id] = [];
        });
        safeProjects.forEach((project) => {
            const key = project.folder ?? UNCATEGORIZED_KEY;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(project);
        });
        Object.keys(grouped).forEach((key) => {
            grouped[key] = sortProjects(grouped[key]);
        });
        return grouped;
    }, [safeProjects, safeFolders, sortProjects]);

    const handleDeleteClick = (id) => {
        setProjectToDelete(id);
        setShowDeleteConfirm(true);
    };

    const handleEditClick = (project) => {
        setProjectToEdit(project);
        setShowEditModal(true);
    };

    const handleEditClose = () => {
        setShowEditModal(false);
        setProjectToEdit(null);
    };

    const handleEditSuccess = (updatedProject) => {
        setProjects(safeProjects.map((project) =>
            project.id === updatedProject.id ? { ...project, ...updatedProject } : project
        ));
    };

    const handleConfirmDelete = () => {
        if (!projectToDelete) return;
        api.delete(`projects/${projectToDelete}/`)
            .then(() => {
                setProjects(safeProjects.filter((project) => project.id !== projectToDelete));
                setDeleteSuccess(true);
                setTimeout(() => setDeleteSuccess(false), 3000);
            })
            .catch((error) => {
                if (isDatabaseConnectionError(error)) {
                    showDatabaseError();
                } else if (error.response) {
                    const { status, data } = error.response;
                    let msg = data.error || 'Failed to delete project. Please try again.';
                    if (status === 400) msg = data.error || 'Cannot delete project due to database constraints.';
                    else if (status === 403) msg = data.error || 'You do not have permission to delete this project.';
                    else if (status === 404) msg = data.error || 'Project not found.';
                    setDeleteError(msg);
                } else if (error.request) {
                    setDeleteError('Network error: Unable to connect to the server.');
                } else {
                    setDeleteError('An unexpected error occurred while deleting the project.');
                }
                setTimeout(() => setDeleteError(''), 5000);
            })
            .finally(() => {
                setShowDeleteConfirm(false);
                setProjectToDelete(null);
            });
    };

    const handleCancelDelete = () => {
        setShowDeleteConfirm(false);
        setProjectToDelete(null);
    };

    const handleProjectClick = (projectId) => {
        navigate(`/projects/${projectId}`);
    };

    const handleProjectDragStart = (e, project) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ projectId: project.id }));
        e.dataTransfer.effectAllowed = 'move';
        setDraggingProjectId(project.id);
    };

    const handleProjectDragEnd = () => {
        setDraggingProjectId(null);
        setDropTargetId(null);
    };

    const getNextListOrder = (folderKey) => {
        const inFolder = projectsByFolder[folderKey] || [];
        if (inFolder.length === 0) return 0;
        return Math.max(...inFolder.map((p) => p.list_order ?? 0)) + 1;
    };

    const moveProjectToFolder = async (projectId, targetFolderKey) => {
        const project = safeProjects.find((p) => p.id === projectId);
        if (!project) return;

        const targetFolderId = targetFolderKey === UNCATEGORIZED_KEY ? null : targetFolderKey;
        if ((project.folder ?? null) === targetFolderId) return;

        const listOrder = getNextListOrder(targetFolderKey);
        const targetFolder = safeFolders.find((f) => f.id === targetFolderId);

        const previousProjects = safeProjects;
        setProjects(safeProjects.map((p) =>
            p.id === projectId
                ? {
                    ...p,
                    folder: targetFolderId,
                    folder_name: targetFolder?.name ?? null,
                    list_order: listOrder,
                }
                : p
        ));

        try {
            await api.patch(`projects/${projectId}/`, {
                folder: targetFolderId,
                list_order: listOrder,
            });
        } catch (error) {
            setProjects(previousProjects);
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
        }
    };

    const handleDropOnFolder = (e, targetFolderKey) => {
        e.preventDefault();
        setDropTargetId(null);
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (data?.projectId) {
                moveProjectToFolder(data.projectId, targetFolderKey);
            }
        } catch {
            // ignore invalid drag data
        }
        setDraggingProjectId(null);
    };

    const handleDragOverFolder = (e, folderKey) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTargetId(folderKey);
    };

    const handleCreateFolder = async (e) => {
        e.preventDefault();
        const name = newFolderName.trim();
        if (!name) return;

        try {
            const response = await api.post('project-folders/', { name });
            setFolders([...safeFolders, response.data]);
            setNewFolderName('');
            setIsCreatingFolder(false);
        } catch (error) {
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
        }
    };

    const handleRenameFolder = async (folderId, name) => {
        try {
            const response = await api.patch(`project-folders/${folderId}/`, { name });
            setFolders(safeFolders.map((f) => (f.id === folderId ? response.data : f)));
        } catch (error) {
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
        }
    };

    const handleDeleteFolderClick = (folderId) => {
        setFolderToDelete(folderId);
        setShowFolderDeleteConfirm(true);
    };

    const handleConfirmFolderDelete = async () => {
        if (!folderToDelete) return;
        try {
            await api.delete(`project-folders/${folderToDelete}/`);
            setFolders(safeFolders.filter((f) => f.id !== folderToDelete));
            setProjects(safeProjects.map((p) =>
                p.folder === folderToDelete
                    ? { ...p, folder: null, folder_name: null }
                    : p
            ));
        } catch (error) {
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
        } finally {
            setShowFolderDeleteConfirm(false);
            setFolderToDelete(null);
        }
    };

    const hasAnyContent = safeProjects.length > 0 || safeFolders.length > 0;

    return (
        <div className="w-full">
            {dbConnectionError && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Fail to connect to database. Try again later.</span>
                    </div>
                </div>
            )}

            {showDeleteConfirm && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded shadow-lg flex items-center gap-4">
                    <span className="font-medium">Are you sure you want to delete this project?</span>
                    <button type="button" onClick={handleConfirmDelete} className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Yes, Delete</button>
                    <button type="button" onClick={handleCancelDelete} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
                </div>
            )}

            {showFolderDeleteConfirm && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded shadow-lg flex flex-wrap items-center gap-3 max-w-lg">
                    <span className="font-medium">Delete this folder? Projects inside will move to Uncategorized.</span>
                    <button type="button" onClick={handleConfirmFolderDelete} className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Delete Folder</button>
                    <button type="button" onClick={() => { setShowFolderDeleteConfirm(false); setFolderToDelete(null); }} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
                </div>
            )}

            {deleteSuccess && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <span className="font-medium">Project deleted successfully!</span>
                </div>
            )}

            {deleteError && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg flex items-center">
                    <span className="font-medium">{deleteError}</span>
                </div>
            )}

            {!foldersAvailable && (
                <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Project folders are not available on this server yet. Redeploy the backend and run migrations
                    (<code className="text-xs bg-amber-100 px-1 rounded">python manage.py migrate</code>), then restart Gunicorn.
                    Your projects still load below.
                </div>
            )}

            {foldersAvailable && (
            <div className="flex flex-wrap items-center gap-3 mb-6">
                {isCreatingFolder ? (
                    <form onSubmit={handleCreateFolder} className="flex items-center gap-2">
                        <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="Folder name"
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            autoFocus
                        />
                        <button type="submit" className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Create</button>
                        <button type="button" onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }} className="px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">Cancel</button>
                    </form>
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsCreatingFolder(true)}
                        className="inline-flex items-center px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
                    >
                        <FaFolderPlus className="w-4 h-4 mr-2" />
                        New Folder
                    </button>
                )}
                <p className="text-sm text-gray-500">Drag projects between folders to organize them.</p>
            </div>
            )}

            {!hasAnyContent ? (
                <div className="text-center py-12">
                    <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No projects</h3>
                    <button
                        type="button"
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                        className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        <FaPlus className="w-4 h-4 mr-2" />
                        Create Project
                    </button>
                </div>
            ) : !foldersAvailable ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortProjects(safeProjects).map((project) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            enableDrag={false}
                            onClick={handleProjectClick}
                            onEdit={handleEditClick}
                            onDelete={handleDeleteClick}
                        />
                    ))}
                </div>
            ) : (
                <>
                    <ProjectFolderSection
                        folderId={UNCATEGORIZED_KEY}
                        folderName="Uncategorized"
                        projects={projectsByFolder[UNCATEGORIZED_KEY] || []}
                        isDropTarget={dropTargetId === UNCATEGORIZED_KEY}
                        onDragOver={(e) => handleDragOverFolder(e, UNCATEGORIZED_KEY)}
                        onDragLeave={() => setDropTargetId(null)}
                        onDrop={(e) => handleDropOnFolder(e, UNCATEGORIZED_KEY)}
                        showFolderActions={false}
                        draggingProjectId={draggingProjectId}
                        onProjectDragStart={handleProjectDragStart}
                        onProjectDragEnd={handleProjectDragEnd}
                        onProjectClick={handleProjectClick}
                        onProjectEdit={handleEditClick}
                        onProjectDelete={handleDeleteClick}
                    />

                    {safeFolders.map((folder) => (
                        <ProjectFolderSection
                            key={folder.id}
                            folderId={folder.id}
                            folderName={folder.name}
                            projects={projectsByFolder[folder.id] || []}
                            isDropTarget={dropTargetId === folder.id}
                            onDragOver={(e) => handleDragOverFolder(e, folder.id)}
                            onDragLeave={() => setDropTargetId(null)}
                            onDrop={(e) => handleDropOnFolder(e, folder.id)}
                            onRenameFolder={handleRenameFolder}
                            onDeleteFolder={handleDeleteFolderClick}
                            draggingProjectId={draggingProjectId}
                            onProjectDragStart={handleProjectDragStart}
                            onProjectDragEnd={handleProjectDragEnd}
                            onProjectClick={handleProjectClick}
                            onProjectEdit={handleEditClick}
                            onProjectDelete={handleDeleteClick}
                        />
                    ))}
                </>
            )}

            {showEditModal && projectToEdit && (
                <EditProject
                    project={projectToEdit}
                    onClose={handleEditClose}
                    onSuccess={handleEditSuccess}
                />
            )}
        </div>
    );
};

export default ProjectList;
