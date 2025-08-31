import React, { useState } from 'react';
import api from '../../api/api';

const CreateProject = ({ setProjects, onClose }) => {
    const [formData, setFormData] = useState({
        name: '',
        width: '',
        length: '',
        height: '',
        wall_thickness: '',
    });
    const [dbConnectionError, setDbConnectionError] = useState(false);
    const [projectCreateSuccess, setProjectCreateSuccess] = useState(false);
    const [projectCreateError, setProjectCreateError] = useState('');

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        // Clear any existing error messages when user starts typing
        if (projectCreateError) {
            setProjectCreateError('');
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        // Validate that dimensions are greater than 0
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
        
        api.post('projects/', formData)
            .then((response) => {
                setProjectCreateSuccess(true);
                setProjectCreateError(''); // Clear any existing errors
                setProjects((prevProjects) => [...prevProjects, response.data]);
                setFormData({ name: '', width: '', length: '', height: '', wall_thickness: 200 });
                
                // Auto-hide success message after 3 seconds
                setTimeout(() => setProjectCreateSuccess(false), 3000);
                
                // Close the modal after a short delay to show the success message
                setTimeout(() => {
                    if (onClose) onClose();
                }, 1500);
            })
            .catch((error) => {
                console.error('Error creating project:', error);
                
                if (isDatabaseConnectionError(error)) {
                    showDatabaseError();
                } else {
                    // Handle duplicate name error
                    if (error.response && error.response.data && error.response.data.name) {
                        setProjectCreateError(`Error: ${error.response.data.name[0]}`);
                    } else if (error.response && error.response.data && error.response.data.error) {
                        setProjectCreateError(`Error: ${error.response.data.error}`);
                    } else {
                        setProjectCreateError('An error occurred while creating the project. Please try again.');
                    }
                    
                    // Auto-hide error message after 5 seconds
                    setTimeout(() => setProjectCreateError(''), 5000);
                }
            });
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
        setTimeout(() => setDbConnectionError(false), 5000); // Hide after 5 seconds
    };

    return (
        <div className="max-w-4xl mx-auto bg-white p-8 rounded-2xl shadow-xl border border-gray-100 relative">
            {/* Close Button */}
            {onClose && (
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
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

            {/* Project Creation Success Message */}
            {projectCreateSuccess && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Project created successfully!</span>
                    </div>
                </div>
            )}

            {/* Project Creation Error Message */}
            {projectCreateError && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{projectCreateError}</span>
                    </div>
                </div>
            )}
            
            <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">Create New Project</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Project Name Row */}
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

                {/* Project Dimensions Row */}
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

                {/* Wall Thickness Row */}
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

                {/* Submit Button */}
                <div className="flex justify-end">
                    <button
                        type="submit"
                        className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
                    >
                        Create Project
                    </button>
                </div>
            </form>
        </div>
    );
};

export default CreateProject;
