import React, { useState, useEffect } from 'react';
import { FaCube, FaPlus, FaFolderOpen } from 'react-icons/fa';
import CreateProject from '../features/project/CreateProject';
import ProjectList from '../features/project/ProjectList';
import api from '../api/api';

const HomePage = () => {
    const [projects, setProjects] = useState([]);
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

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

    // Fetch projects from the backend
    useEffect(() => {
        setIsLoading(true);
        api.get('projects/')
            .then((response) => {
                setProjects(response.data);
                setIsLoading(false);
            })
            .catch((error) => {
                console.error('Error fetching projects:', error);
                setIsLoading(false);
                
                if (isDatabaseConnectionError(error)) {
                    showDatabaseError();
                } else {
                    if (error.response) {
                        const { status, data } = error.response;
                        console.error(`Error ${status}:`, data.error || 'Failed to load projects');
                    } else if (error.request) {
                        console.error('Network error: Unable to connect to the server');
                    } else {
                        console.error('An unexpected error occurred while loading projects');
                    }
                }
            });
    }, []);

    const quickActions = [
        {
            icon: FaPlus,
            title: "Create New Project",
            action: () => setShowCreateForm(true),
            color: "from-blue-500 to-indigo-600"
        },
        {
            icon: FaFolderOpen,
            title: "View Projects",
            action: () => document.getElementById('projects-section')?.scrollIntoView({ behavior: 'smooth' }),
            color: "from-green-500 to-emerald-600"
        }
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
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
            <div className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center">
                            <FaCube className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600 mr-3 sm:mr-4" />
                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">System V7.0</h1>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:space-x-4">
                            {quickActions.map((action, index) => (
                                <button
                                    key={index}
                                    onClick={action.action}
                                    className={`group relative px-4 sm:px-6 py-2 sm:py-3 rounded-xl bg-gradient-to-r ${action.color} text-white text-sm sm:text-base font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300`}
                                >
                                    <div className="flex items-center justify-center">
                                        <action.icon className="w-4 h-4 sm:w-5 sm:h-5 sm:mr-2 group-hover:scale-110 transition-transform duration-300" />
                                        <span className="hidden sm:inline">{action.title}</span>
                                        <span className="sm:hidden">{action.title.replace('New ', '').replace('View ', '')}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12">
                {/* Create Project Section */}
                {showCreateForm && (
                    <div className="mb-8 sm:mb-12">
                        <div className="text-center mb-6 sm:mb-8">
                            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Create New Project</h2>
                        </div>
                        
                        <div className="flex justify-center">
                            <CreateProject 
                                setProjects={setProjects} 
                                onClose={() => setShowCreateForm(false)}
                            />
                        </div>
                    </div>
                )}

                {/* Projects Section */}
                <div id="projects-section">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 mb-6 sm:mb-8">
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Projects</h2>
                        <div className="text-sm text-gray-600">
                            {isLoading ? 'Loading...' : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
                        </div>
                    </div>
                    
                    <ProjectList projects={projects} setProjects={setProjects} />
                </div>
            </div>
        </div>
    );
};

export default HomePage;
