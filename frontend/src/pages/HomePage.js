import React, { useState, useEffect } from 'react';
import CreateProject from '../components/CreateProject';
import ProjectList from '../components/ProjectList';
import api from '../api/api';

const HomePage = () => {
    const [projects, setProjects] = useState([]);

    // Fetch projects from the backend
    useEffect(() => {
        api.get('projects/')
            .then((response) => {
                setProjects(response.data);
            })
            .catch((error) => {
                console.error('Error fetching projects:', error);
            });
    }, []);

    return (
        <div>
            <h1>Welcome to Project Management</h1>
            {/* Create Project Form */}
            <CreateProject setProjects={setProjects} />

            {/* Project List */}
            <ProjectList projects={projects} setProjects={setProjects} />
        </div>
    );
};

export default HomePage;
