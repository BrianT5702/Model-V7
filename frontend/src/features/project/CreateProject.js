import React, { useState } from 'react';
import api from '../../api/api';
import ProjectFolderAssignStep from './ProjectFolderAssignStep';
import {
    UNCATEGORIZED_KEY,
    folderKeyToId,
    getFolderPath,
    getNextListOrder,
    mergeProjectFolderMeta,
} from './projectFolderUtils';

const CreateProject = ({
    projects = [],
    setProjects,
    onClose,
    folders = [],
    setFolders,
    foldersAvailable = false,
    targetFolderKey = null,
    onFolderAssigned,
}) => {
    const [step, setStep] = useState('create');
    const [createdProject, setCreatedProject] = useState(null);
    const [assignFolderKey, setAssignFolderKey] = useState(UNCATEGORIZED_KEY);
    const [isAssigning, setIsAssigning] = useState(false);
    const [assignError, setAssignError] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        width: '',
        length: '',
        height: '',
        wall_thickness: '',
    });
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [projectCreateError, setProjectCreateError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const targetFolderLabel = targetFolderKey != null
        ? getFolderPath(targetFolderKey, folders)
        : null;

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        if (projectCreateError) {
            setProjectCreateError('');
        }
    };

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

    const updateProjectInList = (project) => {
        setProjects((prevProjects) => {
            const exists = prevProjects.some((p) => p.id === project.id);
            if (exists) {
                return prevProjects.map((p) => (p.id === project.id ? { ...p, ...project } : p));
            }
            return [...prevProjects, project];
        });
    };

    const getProjectsSnapshot = (project) => (
        projects.some((p) => p.id === project.id) ? projects : [...projects, project]
    );

    const assignProjectToFolder = async (project, folderKey, projectsSnapshot = getProjectsSnapshot(project)) => {
        const targetFolderId = folderKeyToId(folderKey);
        const listOrder = getNextListOrder(projectsSnapshot, folderKey);

        const response = await api.patch(`projects/${project.id}/`, {
            folder: targetFolderId,
            list_order: listOrder,
        });

        return mergeProjectFolderMeta(response.data, folderKey, folders);
    };

    const finishWithFolder = (folderKey) => {
        onFolderAssigned?.(folderKey);
        if (onClose) onClose();
    };

    const handleAssignConfirm = async () => {
        if (!createdProject) return;
        setIsAssigning(true);
        setAssignError('');

        try {
            const updated = await assignProjectToFolder(createdProject, assignFolderKey);
            updateProjectInList(updated);
            finishWithFolder(assignFolderKey);
        } catch (error) {
            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            } else {
                setAssignError('Failed to save the project to that folder. Please try again.');
            }
        } finally {
            setIsAssigning(false);
        }
    };

    const handleAssignSkip = () => {
        finishWithFolder(UNCATEGORIZED_KEY);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        const width = parseFloat(formData.width);
        const length = parseFloat(formData.length);
        const height = parseFloat(formData.height);
        const wallThickness = parseFloat(formData.wall_thickness);

        if (width <= 0 || length <= 0 || height <= 0) {
            setProjectCreateError('Width, Length, and Height must be greater than 0');
            setTimeout(() => setProjectCreateError(''), 5000);
            return;
        }

        if (wallThickness <= 0) {
            setProjectCreateError('Wall Thickness must be greater than 0');
            setTimeout(() => setProjectCreateError(''), 5000);
            return;
        }

        setIsSubmitting(true);
        setProjectCreateError('');

        try {
            const response = await api.post('projects/', formData);
            const project = response.data;
            updateProjectInList(project);
            setFormData({ name: '', width: '', length: '', height: '', wall_thickness: '' });

            if (foldersAvailable && targetFolderKey != null) {
                const folderKey = targetFolderKey;
                const updated = await assignProjectToFolder(project, folderKey);
                updateProjectInList(updated);
                finishWithFolder(folderKey);
                return;
            }

            if (foldersAvailable) {
                setCreatedProject(project);
                setAssignFolderKey(UNCATEGORIZED_KEY);
                setStep('assign-folder');
                return;
            }

            finishWithFolder(UNCATEGORIZED_KEY);
        } catch (error) {
            console.error('Error creating project:', error);

            if (isDatabaseConnectionError(error)) {
                showDatabaseError();
            } else if (error.response?.data?.name) {
                setProjectCreateError(`Error: ${error.response.data.name[0]}`);
            } else if (error.response?.data?.error) {
                setProjectCreateError(`Error: ${error.response.data.error}`);
            } else {
                setProjectCreateError('An error occurred while creating the project. Please try again.');
            }
            setTimeout(() => setProjectCreateError(''), 5000);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto bg-white p-8 rounded-2xl shadow-xl border border-gray-100 relative">
            {onClose && (
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}

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

            {projectCreateError && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{projectCreateError}</span>
                    </div>
                </div>
            )}

            {step === 'assign-folder' && createdProject ? (
                <ProjectFolderAssignStep
                    projectName={createdProject.name}
                    folders={folders}
                    setFolders={setFolders}
                    selectedFolderKey={assignFolderKey}
                    onSelectedFolderKeyChange={setAssignFolderKey}
                    onConfirm={handleAssignConfirm}
                    onSkip={handleAssignSkip}
                    isSubmitting={isAssigning}
                    error={assignError}
                />
            ) : (
                <>
                    <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Create New Project</h2>
                    {targetFolderLabel && (
                        <p className="text-center text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-6">
                            This project will be added to <span className="font-semibold">{targetFolderLabel}</span>.
                        </p>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="flex gap-6">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">Project Name</label>
                                <input
                                    type="text"
                                    name="name"
                                    placeholder="Enter project name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    required
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="flex gap-6">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">Width (mm)</label>
                                <input
                                    type="number"
                                    name="width"
                                    placeholder="Width"
                                    value={formData.width}
                                    onChange={handleChange}
                                    min="100"
                                    required
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">Length (mm)</label>
                                <input
                                    type="number"
                                    name="length"
                                    placeholder="Length"
                                    value={formData.length}
                                    onChange={handleChange}
                                    min="100"
                                    required
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">Height (mm)</label>
                                <input
                                    type="number"
                                    name="height"
                                    placeholder="Height"
                                    value={formData.height}
                                    onChange={handleChange}
                                    min="100"
                                    required
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="flex gap-6">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700">Wall Thickness (mm)</label>
                                <input
                                    type="number"
                                    name="wall_thickness"
                                    placeholder="Wall Thickness"
                                    value={formData.wall_thickness}
                                    onChange={handleChange}
                                    min="25"
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-60"
                            >
                                {isSubmitting ? 'Creating...' : 'Create Project'}
                            </button>
                        </div>
                    </form>
                </>
            )}
        </div>
    );
};

export default CreateProject;
