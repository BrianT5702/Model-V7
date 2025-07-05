import React, { useState, useEffect } from 'react';
import CreateProject from '../features/project/CreateProject';
import ProjectList from '../features/project/ProjectList';
import api from '../api/api';

const HomePage = () => {
    const [projects, setProjects] = useState([]);
    const [dbConnectionError, setDbConnectionError] = useState(false);

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

    // Fetch projects from the backend
    useEffect(() => {
        api.get('projects/')
            .then((response) => {
                setProjects(response.data);
            })
            .catch((error) => {
                console.error('Error fetching projects:', error);
                
                if (isDatabaseConnectionError(error)) {
                    showDatabaseError();
                } else {
                    // Show user-friendly error message
                    if (error.response) {
                        const { status, data } = error.response;
                        alert(`Error loading projects: ${data.error || 'Failed to load projects. Please refresh the page.'}`);
                    } else if (error.request) {
                        alert('Network error: Unable to connect to the server. Please check your internet connection and refresh the page.');
                    } else {
                        alert('An unexpected error occurred while loading projects. Please refresh the page.');
                    }
                }
            });
    }, []);

    return (
        <div>
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
            
            {/* Create Project Form */}
            <CreateProject setProjects={setProjects} />

            {/* Project List */}
            <ProjectList projects={projects} setProjects={setProjects} />
        </div>
    );
};

export default HomePage;
