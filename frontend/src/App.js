import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import CreateProject from './features/project/CreateProject';
import ProjectDetails from './features/project/ProjectDetails';
import LoginPage from './features/auth/LoginPage';
import ProtectedRoute from './features/auth/ProtectedRoute';
import { AuthProvider } from './features/auth/AuthContext';
import { ThemeProvider } from './features/theme/ThemeContext';

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
        <ThemeProvider>
        <AuthProvider>
            <Router>
                <div className="App min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
                    <ScrollToTop />
                    <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/login" element={<LoginPage />} />
                        <Route path="/projects" element={<Navigate to="/" replace />} />
                        <Route
                            path="/projects/create"
                            element={(
                                <ProtectedRoute>
                                    <CreateProject />
                                </ProtectedRoute>
                            )}
                        />
                        <Route path="/projects/:projectId" element={<ProjectDetails />} />
                    </Routes>
                </div>
            </Router>
        </AuthProvider>
        </ThemeProvider>
    );
};

export default App;
