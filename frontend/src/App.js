import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ProjectList from './features/project/ProjectList';
import CreateProject from './features/project/CreateProject';
import ProjectDetails from './features/project/ProjectDetails';
// import WallDetails from './components/WallDetails'; // New component for walls
// import RoomDetails from './components/RoomDetails'; // New component for rooms
// import CeilingDetails from './components/CeilingDetails'; // New component for ceilings
// import DoorDetails from './components/DoorDetails'; // New component for doors
// import IntersectionDetails from './components/IntersectionDetails'; // New component for intersections

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
                    {/* <Route path="/projects/:projectId/walls" element={<WallDetails />} /> Render WallDetails for walls */}
                    {/* <Route path="/projects/:projectId/rooms" element={<RoomDetails />} /> Render RoomDetails for rooms */}
                    {/* <Route path="/projects/:projectId/ceilings" element={<CeilingDetails />} /> Render CeilingDetails for ceilings */}
                    {/* <Route path="/projects/:projectId/doors" element={<DoorDetails />} /> Render DoorDetails for doors */}
                    {/* <Route path="/projects/:projectId/intersections" element={<IntersectionDetails />} /> Render IntersectionDetails */}
                </Routes>
            </div>
        </Router>
    );
};

export default App;
