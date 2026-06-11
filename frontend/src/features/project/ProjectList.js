import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPlus } from 'react-icons/fa';
import api from '../../api/api';
import EditProject from './EditProject';
import ProjectExplorer from './ProjectExplorer';
import CreateFolderModal from './CreateFolderModal';
import { UNCATEGORIZED_KEY } from './ProjectFolderSection';
import {
    collectDescendantFolderIds,
    getCreateFolderParentId,
    getFolderLabel,
} from './projectFolderUtils';

const ProjectList = ({
    projects,
    setProjects,
    folders,
    setFolders,
    foldersAvailable = true,
    canEdit = false,
    isAuthenticated = false,
    selectedFolderKey: selectedFolderKeyProp,
    onSelectedFolderKeyChange,
    onCreateInFolder,
}) => {
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
    const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
    const [createFolderParentKey, setCreateFolderParentKey] = useState(UNCATEGORIZED_KEY);
    const [internalSelectedFolderKey, setInternalSelectedFolderKey] = useState(UNCATEGORIZED_KEY);
    const selectedFolderKey = selectedFolderKeyProp ?? internalSelectedFolderKey;
    const setSelectedFolderKey = onSelectedFolderKeyChange ?? setInternalSelectedFolderKey;

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

    const flatProjectsByFolder = useMemo(() => ({
        [UNCATEGORIZED_KEY]: sortProjects(safeProjects),
    }), [safeProjects, sortProjects]);

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

        if (targetFolderKey !== selectedFolderKey) {
            setSelectedFolderKey(targetFolderKey);
        }

        try {
            const response = await api.patch(`projects/${projectId}/`, {
                folder: targetFolderId,
                list_order: listOrder,
            });
            setProjects((current) => current.map((p) =>
                p.id === projectId ? { ...p, ...response.data } : p
            ));
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

    const openCreateFolderModal = (parentKey = selectedFolderKey) => {
        setCreateFolderParentKey(parentKey);
        setShowCreateFolderModal(true);
    };

    const closeCreateFolderModal = () => {
        setShowCreateFolderModal(false);
    };

    const handleCreateFolder = async (name) => {
        const parent = getCreateFolderParentId(createFolderParentKey);
        try {
            const response = await api.post('project-folders/', { name, parent });
            setFolders([...safeFolders, response.data]);
            if (createFolderParentKey !== UNCATEGORIZED_KEY) {
                setSelectedFolderKey(createFolderParentKey);
            } else {
                setSelectedFolderKey(response.data.id);
            }
        } catch (error) {
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            }
            throw error;
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

    const handleRenameFolderRequest = (folderId) => {
        const folder = safeFolders.find((f) => f.id === folderId);
        const nextName = window.prompt('Rename folder', folder?.name || '');
        if (nextName?.trim() && nextName.trim() !== folder?.name) {
            handleRenameFolder(folderId, nextName.trim());
        }
    };

    const handleDeleteFolderClick = (folderId) => {
        setFolderToDelete(folderId);
        setShowFolderDeleteConfirm(true);
    };

    const handleConfirmFolderDelete = async () => {
        if (!folderToDelete) return;
        const removedFolderIds = collectDescendantFolderIds(folderToDelete, safeFolders);
        try {
            await api.delete(`project-folders/${folderToDelete}/`);
            setFolders(safeFolders.filter((f) => !removedFolderIds.includes(f.id)));
            setProjects(safeProjects.map((p) =>
                removedFolderIds.includes(p.folder)
                    ? { ...p, folder: null, folder_name: null }
                    : p
            ));
            if (removedFolderIds.includes(selectedFolderKey)) {
                setSelectedFolderKey(UNCATEGORIZED_KEY);
            }
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

    const explorerProps = {
        projectsByFolder: foldersAvailable ? projectsByFolder : flatProjectsByFolder,
        selectedFolderKey: foldersAvailable ? selectedFolderKey : UNCATEGORIZED_KEY,
        onSelectFolder: setSelectedFolderKey,
        dropTargetId,
        canEdit,
        draggingProjectId,
        onStartCreateFolder: () => openCreateFolderModal(selectedFolderKey),
        onRenameFolderRequest: handleRenameFolderRequest,
        onDeleteFolder: handleDeleteFolderClick,
        onDragOverFolder: handleDragOverFolder,
        onDragLeaveFolder: () => setDropTargetId(null),
        onDropOnFolder: handleDropOnFolder,
        onProjectDragStart: handleProjectDragStart,
        onProjectDragEnd: handleProjectDragEnd,
        onProjectClick: handleProjectClick,
        onProjectEdit: handleEditClick,
        onProjectDelete: handleDeleteClick,
        onCreateInFolder: canEdit && foldersAvailable && onCreateInFolder
            ? () => onCreateInFolder(selectedFolderKey)
            : undefined,
        currentFolderLabel: getFolderLabel(selectedFolderKey, safeFolders),
        createFolderParentLabel: selectedFolderKey === UNCATEGORIZED_KEY
            ? 'top level'
            : getFolderLabel(selectedFolderKey, safeFolders),
        onStartCreateSubfolder: canEdit && foldersAvailable
            ? (folderKey) => openCreateFolderModal(folderKey)
            : undefined,
    };

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
                    <span className="font-medium">Delete this folder and all subfolders? Projects inside will move to Uncategorized.</span>
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
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Project folders are not available on this server yet. Showing all projects in a single list.
                </div>
            )}

            {!hasAnyContent ? (
                <div className="text-center py-12 rounded-xl border border-gray-200 bg-white">
                    <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No projects</h3>
                    {canEdit ? (
                        <button
                            type="button"
                            onClick={() => onCreateInFolder?.(UNCATEGORIZED_KEY)}
                            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <FaPlus className="w-4 h-4 mr-2" />
                            Create Project
                        </button>
                    ) : (
                        <p className="text-sm text-gray-500">
                            {isAuthenticated
                                ? 'No projects yet. Your account cannot create projects.'
                                : 'Log in to create projects.'}
                        </p>
                    )}
                </div>
            ) : (
                <ProjectExplorer
                    folders={foldersAvailable ? safeFolders : []}
                    showSidebar={foldersAvailable}
                    showFolderToolbar={foldersAvailable}
                    {...explorerProps}
                />
            )}

            {canEdit && showEditModal && projectToEdit && (
                <EditProject
                    project={projectToEdit}
                    onClose={handleEditClose}
                    onSuccess={handleEditSuccess}
                />
            )}

            {canEdit && foldersAvailable && (
                <CreateFolderModal
                    isOpen={showCreateFolderModal}
                    parentKey={createFolderParentKey}
                    parentLabel={getFolderLabel(createFolderParentKey, safeFolders)}
                    onClose={closeCreateFolderModal}
                    onSubmit={handleCreateFolder}
                />
            )}
        </div>
    );
};

export default ProjectList;
