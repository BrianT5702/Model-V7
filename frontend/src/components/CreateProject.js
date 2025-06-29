import React, { useState } from 'react';
import api from '../api/api';

const CreateProject = ({ setProjects }) => {
    const [formData, setFormData] = useState({
        name: '',
        width: '',
        length: '',
        height: '',
        wall_thickness: '',
    });
    const [dbConnectionError, setDbConnectionError] = useState(false);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        // Validate that dimensions are greater than 0
        const width = parseFloat(formData.width);
        const length = parseFloat(formData.length);
        const height = parseFloat(formData.height);
        const wallThickness = parseFloat(formData.wall_thickness);
        
        if (width <= 0 || length <= 0 || height <= 0) {
            alert('Width, Length, and Height must be greater than 0');
            return;
        }
        
        if (wallThickness <= 0) {
            alert('Wall Thickness must be greater than 0');
            return;
        }
        
        api.post('projects/', formData)
            .then((response) => {
                alert('Project created successfully!');
                setProjects((prevProjects) => [...prevProjects, response.data]); // Add the new project to the list
                setFormData({ name: '', width: '', length: '', height: '', wall_thickness: 200 });
            })
            .catch((error) => {
                console.error('Error creating project:', error);
                
                if (isDatabaseConnectionError(error)) {
                    showDatabaseError();
                } else {
                    // Handle duplicate name error
                    if (error.response && error.response.data && error.response.data.name) {
                        alert(`Error: ${error.response.data.name[0]}`);
                    } else if (error.response && error.response.data && error.response.data.error) {
                        alert(`Error: ${error.response.data.error}`);
                    } else {
                        alert('An error occurred while creating the project. Please try again.');
                    }
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
        <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md">
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
            
            <h2 className="text-2xl font-semibold text-gray-900 mb-6">Create New Project</h2>
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
                            step="100"
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
                            step="100"
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
                            step="100"
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
                            step="25"
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
