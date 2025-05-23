import React from 'react';
import { useNavigate } from 'react-router-dom'; // Import React Router navigation hook
import api from '../api/api';

const ProjectList = ({ projects, setProjects }) => {
    const navigate = useNavigate(); // React Router navigation hook

    // Handle project deletion
    const handleDelete = (id) => {
        const confirmDelete = window.confirm('Are you sure you want to delete this project?');
        if (!confirmDelete) return;
    
        api.delete(`projects/${id}/`)
            .then(() => {
                setProjects(projects.filter((project) => project.id !== id));
            })
            .catch((error) => {
                console.error('Error deleting project:', error);
            });
    };

    // Handle navigation to the project details page
    const handleProjectClick = (projectId) => {
        navigate(`/projects/${projectId}`); // Redirect to ProjectDetails page
    };

    return (
        <div className="max-w-5xl mx-auto p-6">
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
                                        handleDelete(project.id);
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
