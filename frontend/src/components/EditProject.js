import React, { useState } from 'react';
import api from '../api/api';

const EditProject = ({ project, setProjects, onEditComplete }) => {
    const [formData, setFormData] = useState({
        name: project.name,
        width: project.width,
        length: project.length,
        height: project.height,
        wall_thickness: project.wall_thickness,
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        api.put(`projects/${project.id}/`, formData)
            .then((response) => {
                alert('Project updated successfully!');
                setProjects((prevProjects) =>
                    prevProjects.map((p) => (p.id === project.id ? response.data : p))
                );
                onEditComplete(); // Notify parent to close the edit form
            })
            .catch((error) => {
                console.error('Error updating project:', error);
            });
    };

    return (
        <form onSubmit={handleSubmit}>
            <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
            />
            <input
                type="number"
                name="width"
                value={formData.width}
                onChange={handleChange}
            />
            <input
                type="number"
                name="length"
                value={formData.length}
                onChange={handleChange}
            />
            <input
                type="number"
                name="height"
                value={formData.height}
                onChange={handleChange}
            />
            <input
                type="number"
                name="wall_thickness"
                value={formData.wall_thickness}
                onChange={handleChange}
            />
            <button type="submit">Update</button>
        </form>
    );
};

export default EditProject;
