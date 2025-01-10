import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ProjectList from './components/ProjectList';
import CreateProject from './components/CreateProject';
import ProjectDetails from './components/ProjectDetails';

const App = () => {
    return (
        <Router>
            <div className="App">
                {/* Define routes for navigation */}
                <Routes>
                    <Route path="/" element={<HomePage />} /> {/* Render HomePage for root route */}
                    <Route path="/projects" element={<ProjectList />} /> {/* Render ProjectList for /projects */}
                    <Route path="/projects/create" element={<CreateProject />} /> {/* Render CreateProject for creating new projects */}
                    <Route path="/projects/:projectId" element={<ProjectDetails />} /> {/* Render ProjectDetails for specific project */}
                </Routes>
            </div>
        </Router>
    );
};

export default App;
