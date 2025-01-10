import React, { useState } from 'react';
import api from '../api/api';

const CreateProject = ({ setProjects }) => {
    const [formData, setFormData] = useState({
        name: '',
        width: '',
        length: '',
        height: '',
        wall_thickness: 200,
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        api.post('projects/', formData)
            .then((response) => {
                alert('Project created successfully!');
                setProjects((prevProjects) => [...prevProjects, response.data]); // Add the new project to the list
                setFormData({ name: '', width: '', length: '', height: '', wall_thickness: 200 });
            })
            .catch((error) => {
                console.error('Error creating project:', error);
            });
    };

    return (
        <form onSubmit={handleSubmit}>
            <input
                type="text"
                name="name"
                placeholder="Project Name"
                value={formData.name}
                onChange={handleChange}
                required
            />
            <input
                type="number"
                name="width"
                placeholder="Width"
                value={formData.width}
                onChange={handleChange}
                required
            />
            <input
                type="number"
                name="length"
                placeholder="Length"
                value={formData.length}
                onChange={handleChange}
                required
            />
            <input
                type="number"
                name="height"
                placeholder="Height"
                value={formData.height}
                onChange={handleChange}
                required
            />
            <input
                type="number"
                name="wall_thickness"
                placeholder="Wall Thickness"
                value={formData.wall_thickness}
                onChange={handleChange}
            />
            <button type="submit">Create</button>
        </form>
    );
};

export default CreateProject;
