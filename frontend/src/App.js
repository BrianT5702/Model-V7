import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ProjectList from './features/project/ProjectList';
import CreateProject from './features/project/CreateProject';
import ProjectDetails from './features/project/ProjectDetails';

// Ensure scroll position is reset on route changes and browser
// doesn't try to "restore" scroll from the previous page.
const ScrollToTop = () => {
    const location = useLocation();

    useEffect(() => {
        if ('scrollRestoration' in window.history) {
            window.history.scrollRestoration = 'manual';
        }
    }, []);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [location.pathname]);

    return null;
};

const App = () => {
    return (
        <Router>
            <div className="App">
                <ScrollToTop />
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
