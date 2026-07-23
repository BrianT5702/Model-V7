import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FaCube, FaPlus } from 'react-icons/fa';
import CreateProject from '../features/project/CreateProject';
import ChatbotFab from '../features/chatbot/ChatbotFab';
import ProjectList from '../features/project/ProjectList';
import AuthStatusBar from '../components/AuthStatusBar';
import { useAuth } from '../features/auth/AuthContext';
import {
    FOLDER_QUERY_PARAM,
    UNCATEGORIZED_KEY,
    folderKeyFromQueryValue,
    folderKeyToQueryValue,
} from '../features/project/projectFolderUtils';
import api from '../api/api';

const HomePage = () => {
    const { canEdit, isAuthenticated } = useAuth();
    const [projects, setProjects] = useState([]);
    const [folders, setFolders] = useState([]);
    const [foldersAvailable, setFoldersAvailable] = useState(true);
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createTargetFolderKey, setCreateTargetFolderKey] = useState(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedFolderKey, setSelectedFolderKey] = useState(() => (
        folderKeyFromQueryValue(searchParams.get(FOLDER_QUERY_PARAM), [])
    ));
    const [isLoading, setIsLoading] = useState(true);

    const handleSelectedFolderKeyChange = useCallback((folderKey) => {
        setSelectedFolderKey(folderKey);
        const queryValue = folderKeyToQueryValue(folderKey);
        if (queryValue) {
            setSearchParams({ [FOLDER_QUERY_PARAM]: queryValue }, { replace: true });
        } else {
            setSearchParams({}, { replace: true });
        }
    }, [setSearchParams]);

    useEffect(() => {
        const folderParam = searchParams.get(FOLDER_QUERY_PARAM);
        if (folderParam === null) {
            setSelectedFolderKey(UNCATEGORIZED_KEY);
            return;
        }
        setSelectedFolderKey(folderKeyFromQueryValue(folderParam, folders));
    }, [searchParams, folders]);

    const openCreateProject = (folderKey = null) => {
        setCreateTargetFolderKey(folderKey);
        setShowCreateForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const closeCreateProject = () => {
        setShowCreateForm(false);
        setCreateTargetFolderKey(null);
    };

    // Utility function to detect database connection errors
    const isDatabaseConnectionError = (error) => {
        return (
            error.code === 'ERR_NETWORK' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.message?.includes('Network Error') ||
            error.message?.includes('Failed to fetch') ||
            error.message?.includes('Connection refused') ||
            error.message?.includes('getaddrinfo ENOTFOUND') ||
            (error.response?.status >= 500 && error.response?.status < 600)
        );
    };

    // Function to show database connection error
    const showDatabaseError = () => {
        setDbConnectionError(true);
        setTimeout(() => setDbConnectionError(false), 5000);
    };

    // Fetch projects first; folders are optional (older backends return 404)
    useEffect(() => {
        setIsLoading(true);

        api.get('projects/')
            .then((response) => {
                setProjects(response.data);
            })
            .catch((error) => {
                console.error('Error fetching projects:', error);
                if (isDatabaseConnectionError(error)) {
                    showDatabaseError();
                } else if (error.response) {
                    const { status, data } = error.response;
                    console.error(`Error ${status}:`, data.error || 'Failed to load projects');
                } else if (error.request) {
                    console.error('Network error: Unable to connect to the server');
                } else {
                    console.error('An unexpected error occurred while loading projects');
                }
            })
            .finally(() => setIsLoading(false));

        api.get('project-folders/')
            .then((response) => {
                setFolders(response.data);
                setFoldersAvailable(true);
            })
            .catch((error) => {
                if (error.response?.status === 404) {
                    setFolders([]);
                    setFoldersAvailable(false);
                    return;
                }
                console.warn('Could not load project folders:', error);
                setFoldersAvailable(false);
            });
    }, []);

    useEffect(() => {
        const handleCommentsRead = (event) => {
            const readProjectId = event.detail?.projectId;
            if (!readProjectId) return;
            setProjects((prev) => prev.map((project) => (
                project.id === readProjectId
                    ? { ...project, unread_comment_count: 0 }
                    : project
            )));
        };

        window.addEventListener('project-comments-read', handleCommentsRead);
        return () => window.removeEventListener('project-comments-read', handleCommentsRead);
    }, []);

    const showCreateButton = canEdit;

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-slate-900 transition-colors">
            {/* Database Connection Error Message */}
            {dbConnectionError && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded-xl shadow-lg animate-fade-in">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Database connection failed. Please try again later.</span>
                    </div>
                </div>
            )}

            {/* Header Section */}
            <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center">
                            <FaCube className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600 mr-3 sm:mr-4" />
                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">System V7.0</h1>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:space-x-4">
                            <AuthStatusBar />
                            {showCreateButton && (
                                <button
                                    type="button"
                                    onClick={() => openCreateProject(null)}
                                    className="group relative px-4 sm:px-6 py-2 sm:py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm sm:text-base font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300"
                                >
                                    <div className="flex items-center justify-center">
                                        <FaPlus className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2 group-hover:scale-110 transition-transform duration-300" />
                                        <span className="hidden sm:inline">Create New Project</span>
                                        <span className="sm:hidden">Create Project</span>
                                    </div>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12">
                {/* Create Project Section */}
                {canEdit && showCreateForm && (
                    <div className="mb-8 sm:mb-12">
                        <div className="text-center mb-6 sm:mb-8">
                            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Create New Project</h2>
                        </div>
                        
                        <div className="flex justify-center">
                            <CreateProject
                                projects={projects}
                                setProjects={setProjects}
                                folders={folders}
                                setFolders={setFolders}
                                foldersAvailable={foldersAvailable}
                                targetFolderKey={createTargetFolderKey}
                                onFolderAssigned={handleSelectedFolderKeyChange}
                                onClose={closeCreateProject}
                            />
                        </div>
                    </div>
                )}

                {/* Projects Section */}
                <div id="projects-section" className="flex flex-col min-h-[480px]">
                    {!canEdit && (
                        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                            {isAuthenticated ? (
                                'View-only access (Salesman). You can browse projects, open plans, use 3D, and export — but cannot create or edit.'
                            ) : (
                                <>
                                    You are browsing in view-only mode.{' '}
                                    <Link to="/login" className="font-medium underline hover:text-amber-900">Log in</Link>{' '}
                                    to create, edit, or delete projects.
                                </>
                            )}
                        </div>
                    )}

                    {isLoading ? (
                        <div className="flex items-center justify-center flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400">
                            Loading projects...
                        </div>
                    ) : (
                    <ProjectList
                        projects={projects}
                        setProjects={setProjects}
                        folders={folders}
                        setFolders={setFolders}
                        foldersAvailable={foldersAvailable}
                        canEdit={canEdit}
                        isAuthenticated={isAuthenticated}
                        selectedFolderKey={selectedFolderKey}
                        onSelectedFolderKeyChange={handleSelectedFolderKeyChange}
                        onCreateInFolder={openCreateProject}
                    />
                    )}
                </div>
            </div>

            {canEdit && (
                <ChatbotFab
                    projects={projects}
                    setProjects={setProjects}
                    folders={folders}
                    setFolders={setFolders}
                    foldersAvailable={foldersAvailable}
                    onFolderAssigned={handleSelectedFolderKeyChange}
                />
            )}
        </div>
    );
};

export default HomePage;
