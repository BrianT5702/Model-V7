import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // Import React Router navigation hook
import api from '../../api/api';

const ProjectList = ({ projects, setProjects }) => {
    const navigate = useNavigate(); // React Router navigation hook
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState(null);
    const [deleteSuccess, setDeleteSuccess] = useState(false);
    const [deleteError, setDeleteError] = useState('');

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
        setTimeout(() => setDbConnectionError(false), 5000); // Hide after 5 seconds
    };

    // Handle project deletion
    const handleDeleteClick = (id) => {
        setProjectToDelete(id);
        setShowDeleteConfirm(true);
    };

    const handleConfirmDelete = () => {
        if (!projectToDelete) return;
        api.delete(`projects/${projectToDelete}/`)
            .then(() => {
                setProjects(projects.filter((project) => project.id !== projectToDelete));
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
                    else if (status === 500) msg = data.error || 'An unexpected error occurred. Please try again.';
                    else if (status === 503) msg = data.error || 'Database connection error. Please try again later.';
                    setDeleteError(msg);
                } else if (error.request) {
                    setDeleteError('Network error: Unable to connect to the server. Please check your internet connection and try again.');
                } else {
                    setDeleteError('An unexpected error occurred while deleting the project. Please try again.');
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

    // Handle navigation to the project details page
    const handleProjectClick = (projectId) => {
        navigate(`/projects/${projectId}`); // Redirect to ProjectDetails page
    };

    return (
        <div className="max-w-5xl mx-auto p-6">
            {/* Database Connection Error Message */}
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
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Are you sure you want to delete this project?</span>
                    <button onClick={handleConfirmDelete} className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Yes, Delete</button>
                    <button onClick={handleCancelDelete} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
                </div>
            )}
            
            {deleteSuccess && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Project deleted successfully!</span>
                </div>
            )}
            
            {deleteError && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">{deleteError}</span>
                </div>
            )}
            
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Projects</h2>
            {projects.length === 0 ? (
                <p className="text-gray-500">No projects available.</p>
            ) : (
                <ul className="space-y-4">
                    {projects.map((project) => (
                        <li key={project.id}>
                            <div
                                className="border border-gray-300 rounded-lg p-4 shadow-sm bg-white hover:shadow-md transition cursor-pointer flex justify-between items-center"
                                onClick={() => handleProjectClick(project.id)}
                            >
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-800">{project.name}</h3>
                                    <p className="text-gray-600">
                                        Dimensions: {project.width} x {project.length} x {project.height} mm
                                    </p>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent navigation when clicking delete
                                        handleDeleteClick(project.id);
                                    }}
                                    className="px-3 py-1 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition"
                                >
                                    Delete
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};    

export default ProjectList;
