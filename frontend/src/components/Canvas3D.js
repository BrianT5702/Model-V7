import React, { useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

const Canvas3D = ({ walls, onWallUpdate }) => {
    const wallRefs = useRef([]);

    // Function to convert wall data to 3D objects
    const renderWalls = () => {
        return walls.map((wall, index) => {
            const width = Math.sqrt(
                Math.pow(wall.end_x - wall.start_x, 2) +
                Math.pow(wall.end_y - wall.start_y, 2)
            );
            const angle = Math.atan2(
                wall.end_y - wall.start_y,
                wall.end_x - wall.start_x
            );

            return (
                <mesh
                    key={index}
                    position={[
                        (wall.start_x + wall.end_x) / 2,
                        wall.thickness / 2,
                        (wall.start_y + wall.end_y) / 2,
                    ]}
                    rotation={[0, -angle, 0]}
                    onClick={() => handleWallClick(index)}
                >
                    <boxGeometry args={[width, wall.height, wall.thickness]} />
                    <meshStandardMaterial color="#cccccc" />
                </mesh>
            );
        });
    };

    const handleWallClick = (index) => {
        // Example: Highlight wall when clicked
        const updatedWalls = walls.map((wall, i) =>
            i === index ? { ...wall, color: '#ff0000' } : wall
        );
        onWallUpdate(updatedWalls);
    };

    return (
        <Canvas camera={{ position: [0, 10, 10], fov: 50 }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} />
            <OrbitControls />
            {renderWalls()}
        </Canvas>
    );
};

export default Canvas3D;
