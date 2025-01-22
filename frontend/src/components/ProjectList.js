import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // Import React Router navigation hook
import api from '../api/api';

const ProjectList = ({ projects, setProjects }) => {
    const [editingProject, setEditingProject] = useState(null); // Tracks which project is being edited
    const navigate = useNavigate(); // React Router navigation hook

    // Handle project deletion
    const handleDelete = (id) => {
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
        <div>
            <h2>Projects</h2>
            <ul>
                {projects.map((project) => (
                    <li key={project.id}>
                        <div
                            style={{
                                border: '1px solid #ccc',
                                padding: '10px',
                                marginBottom: '10px',
                                cursor: 'pointer',
                            }}
                            onClick={() => handleProjectClick(project.id)}
                        >
                            <strong>{project.name}</strong> - {project.width} x {project.length} x {project.height} mm
                            <div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent navigation when clicking delete
                                        handleDelete(project.id);
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default ProjectList;
