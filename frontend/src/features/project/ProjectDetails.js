import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useProjectDetails from './useProjectDetails';
import Canvas2D from '../canvas/Canvas2D';
import RoomManager from '../room/RoomManager';
import DoorManager from '../door/DoorManager';
import DoorEditorModal from '../door/DoorEditorModal';
import CeilingManager from '../ceiling/CeilingManager';
import FloorManager from '../floor/FloorManager';
import InstallationTimeEstimator from '../estimation/InstallationTimeEstimator';
import api from '../../api/api';

import { 
    FaPencilAlt, 
    FaCube, 
    FaSquare, 
    FaEdit, 
    FaObjectGroup, 
    FaCut,
    FaDoorOpen, 
    FaHome,
    FaCog,
    FaEye,
    FaEyeSlash,
    FaArrowLeft,
    FaLayerGroup
} from 'react-icons/fa';

const ProjectDetails = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const projectDetails = useProjectDetails(projectId);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const wizardStep = projectDetails.storeyWizardStep;
    const sourceStoreyId = projectDetails.storeyWizardSourceStoreyId ?? projectDetails.activeStoreyId;
    const selectedRoomsSet = new Set(projectDetails.storeyWizardRoomSelections || []);
    const roomOverrides = projectDetails.storeyWizardRoomOverrides || {};
    const sourceRooms = (projectDetails.rooms || []).filter(
        (room) => sourceStoreyId ? String(room.storey) === String(sourceStoreyId) : true
    );
    const isDrawingStoreyArea = projectDetails.selectionContext === 'storey' && projectDetails.currentMode === 'storey-area';
    const effectiveProjectHeight = Math.max(
        Number(projectDetails.project?.height) || 0,
        Number(projectDetails.projectCalculatedHeight) || 0
    );
    // Get rooms on the active storey to check for duplicates
    const activeStoreyRooms = (projectDetails.rooms || []).filter(
        (room) => String(room.storey) === String(projectDetails.activeStoreyId)
    );
    
    // Create a set of room point signatures for quick lookup
    const activeStoreyRoomSignatures = new Set(
        activeStoreyRooms
            .filter((room) => Array.isArray(room.room_points) && room.room_points.length >= 3)
            .map((room) => {
                const normalizedPoints = room.room_points.map((point) => [
                    Number(point.x) || 0,
                    Number(point.y) || 0,
                ]);
                return JSON.stringify(normalizedPoints);
            })
    );

    const roomsGroupedForLevelEdit = (projectDetails.storeys || [])
        .filter((storey) => String(storey.id) !== String(projectDetails.activeStoreyId))
        .map((storey) => ({
            storey,
            rooms: (projectDetails.rooms || []).filter(
                (room) => String(room.storey) === String(storey.id)
            ),
        }))
        .filter((group) => group.rooms.length > 0);

    const handleSourceStoreyChange = (event) => {
        const value = event.target.value;
        const numericValue = value === '' ? null : Number(value);
        projectDetails.setStoreyWizardSourceStoreyId(numericValue);
        projectDetails.setStoreyWizardRoomSelections([]);
        projectDetails.setStoreyWizardError('');

        if (numericValue !== null) {
            const baseStorey = projectDetails.storeys.find(storey => String(storey.id) === String(numericValue));
            if (baseStorey) {
                projectDetails.setStoreyWizardElevation((baseStorey.elevation_mm ?? 0) + (baseStorey.default_room_height_mm ?? 3000) + (baseStorey.slab_thickness_mm ?? 0));
                projectDetails.setStoreyWizardDefaultHeight(baseStorey.default_room_height_mm ?? 3000);
                projectDetails.setStoreyWizardSlabThickness(baseStorey.slab_thickness_mm ?? 0);
            }
        }
    };

    const toggleStoreyWizardRoom = (roomId) => {
        if (roomId === null || roomId === undefined) return;
        projectDetails.setStoreyWizardError('');
        projectDetails.setStoreyWizardRoomSelections((prev) => {
            const next = new Set(prev || []);
            if (next.has(roomId)) {
                next.delete(roomId);
            } else {
                next.add(roomId);
            }
            return Array.from(next);
        });
    };

    const handleRoomHeightOverrideChange = (roomId, value) => {
        const parsed = Number(value);
        const numeric = Number.isNaN(parsed) ? 0 : parsed;
        projectDetails.updateStoreyWizardRoomOverride(roomId, { height: numeric });
        projectDetails.computeStoreyWizardElevation();
    };

    const handleRemoveWizardArea = (areaId) => {
        projectDetails.setStoreyWizardError('');
        projectDetails.setStoreyWizardAreas((prev) => prev.filter((area) => area.id !== areaId));
        projectDetails.setStoreyWizardAreaOverrides((prev) => {
            const next = { ...prev };
            delete next[areaId];
            return next;
        });
    };

    const handleStoreyWizardNext = () => {
        projectDetails.setStoreyWizardError('');
        if (wizardStep === 1) {
            projectDetails.setStoreyWizardStep(2);
        } else if (wizardStep === 2) {
            const hasRooms = (projectDetails.storeyWizardRoomSelections || []).length > 0;
            const hasAreas = (projectDetails.storeyWizardAreas || []).length > 0;
            if (!hasRooms && !hasAreas) {
                projectDetails.setStoreyWizardError('Select at least one room or draw an area.');
                return;
            }
            if (isDrawingStoreyArea) {
                projectDetails.setStoreyWizardError('Finish drawing the current area before continuing.');
                return;
            }
            projectDetails.computeStoreyWizardElevation();
            projectDetails.setStoreyWizardStep(3);
        }
    };

    const handleStoreyWizardBack = () => {
        projectDetails.setStoreyWizardError('');
        if (wizardStep === 2) {
            projectDetails.setStoreyWizardStep(1);
        } else if (wizardStep === 3) {
            projectDetails.setStoreyWizardStep(2);
        }
    };

    const handleStoreyWizardClose = () => {
        projectDetails.closeStoreyWizard();
    };
    
    // Modal state for image capture
    const [isCapturingImages, setIsCapturingImages] = useState(false);
    const [captureSuccess, setCaptureSuccess] = useState(false);
    
    // Dynamic 3D container height for mobile responsiveness (matching Canvas2D pattern)
    const [threeDContainerHeight, setThreeDContainerHeight] = useState(600);
    
    // Mobile-specific constants (matching Canvas2D)
    const MAX_CANVAS_HEIGHT_RATIO = typeof window !== 'undefined' && window.innerWidth < 640 ? 0.85 : 0.7;
    const MIN_CANVAS_HEIGHT = 240;

    // Add this state for the edited wall
    const [editedWall, setEditedWall] = useState(null);
    
    // Capture canvas images when switching tabs
    useEffect(() => {
        // Helper function to remove grid lines from canvas
        const removeGridFromCanvas = (sourceCanvas) => {
            console.log('🎨 Removing grid lines from canvas...');
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = sourceCanvas.width;
            tempCanvas.height = sourceCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Fill with white background first
            tempCtx.fillStyle = '#FFFFFF';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            
            // Copy original canvas on top
            tempCtx.drawImage(sourceCanvas, 0, 0);
            
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = imageData.data;
            
            // Grid color: #ddd = rgb(221, 221, 221)
            const gridR = 221, gridG = 221, gridB = 221;
            const bgR = 255, bgG = 255, bgB = 255; // Pure white
            const tolerance = 20; // Increased tolerance
            
            let pixelsChanged = 0;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const a = data[i + 3];
                
                if (Math.abs(r - gridR) < tolerance && 
                    Math.abs(g - gridG) < tolerance && 
                    Math.abs(b - gridB) < tolerance &&
                    a > 200) {
                    data[i] = bgR;
                    data[i + 1] = bgG;
                    data[i + 2] = bgB;
                    pixelsChanged++;
                }
            }
            
            console.log(`✅ Removed ${pixelsChanged / 4} grid pixels`);
            
            tempCtx.putImageData(imageData, 0, 0);
            return tempCanvas;
        };
        
        // Helper function to check if point is in polygon (ray casting algorithm)
        const isPointInPolygon = (point, polygon) => {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i].x, yi = polygon[i].y;
                const xj = polygon[j].x, yj = polygon[j].y;
                const intersect = ((yi > point.y) !== (yj > point.y))
                    && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        };
        
        // Helper function to calculate room center if no label_position
        const calculateRoomCenter = (room) => {
            if (!room.room_points || room.room_points.length < 3) {
                return null;
            }
            const sumX = room.room_points.reduce((sum, p) => sum + (Number(p.x) || 0), 0);
            const sumY = room.room_points.reduce((sum, p) => sum + (Number(p.y) || 0), 0);
            return {
                x: sumX / room.room_points.length,
                y: sumY / room.room_points.length
            };
        };
        
        // Helper function to check if room can contain label
        const canRoomContainLabel = (room, scaleFactor) => {
            if (!room.room_points || room.room_points.length < 3) {
                return true; // No boundary, assume it can contain
            }
            const normalizedPolygon = room.room_points.map(pt => ({
                x: Number(pt.x) || 0,
                y: Number(pt.y) || 0
            }));
            const minX = Math.min(...normalizedPolygon.map(p => p.x));
            const maxX = Math.max(...normalizedPolygon.map(p => p.x));
            const minY = Math.min(...normalizedPolygon.map(p => p.y));
            const maxY = Math.max(...normalizedPolygon.map(p => p.y));
            const roomWidth = maxX - minX;
            const roomHeight = maxY - minY;
            const baseLabelWidth = 140;
            const baseLabelHeight = 50;
            const labelWidth = baseLabelWidth / scaleFactor;
            const labelHeight = baseLabelHeight / scaleFactor;
            const margin = 20 / scaleFactor;
            return roomWidth >= labelWidth + margin && roomHeight >= labelHeight + margin;
        };
        
        // Helper function to check if room is on ground floor
        const isGroundFloorRoom = (room) => {
            if (!room.storey) {
                // If no storey assigned, assume ground floor (legacy data)
                return true;
            }
            // Find the storey object
            const storey = projectDetails.storeys?.find(s => String(s.id) === String(room.storey));
            if (!storey) {
                // If storey not found, assume ground floor
                return true;
            }
            // Ground floor has elevation_mm === 0 and order === 0
            return (storey.elevation_mm === 0 || storey.elevation_mm === null) && 
                   (storey.order === 0 || storey.order === null);
        };
        
        // Helper function to draw room labels on canvas
        const drawRoomLabelsOnCanvas = (ctx, rooms, scaleFactor, offsetX, offsetY) => {
            if (!rooms || rooms.length === 0) {
                console.log('⚠️ No rooms to draw labels for');
                return;
            }
            
            // Filter to only ground floor rooms
            const groundFloorRooms = rooms.filter(isGroundFloorRoom);
            
            if (groundFloorRooms.length === 0) {
                console.log('⚠️ No ground floor rooms to draw labels for');
                return;
            }
            
            console.log(`🎨 Drawing labels for ${groundFloorRooms.length} ground floor rooms (out of ${rooms.length} total), scaleFactor=${scaleFactor}, offsetX=${offsetX}, offsetY=${offsetY}`);
            
            let labelsDrawn = 0;
            groundFloorRooms.forEach((room, index) => {
                // Get label position - ALWAYS prioritize stored user position
                let labelPos = null;
                let usingStoredPosition = false;
                
                if (room.label_position && 
                    room.label_position.x !== undefined && 
                    room.label_position.y !== undefined &&
                    !isNaN(Number(room.label_position.x)) &&
                    !isNaN(Number(room.label_position.y))) {
                    // Use the exact position the user placed
                    labelPos = {
                        x: Number(room.label_position.x),
                        y: Number(room.label_position.y)
                    };
                    usingStoredPosition = true;
                } else {
                    // Only calculate center if no stored position exists
                    labelPos = calculateRoomCenter(room);
                    if (!labelPos) {
                        console.log(`⚠️ Room ${room.id} (${room.room_name}) has no label_position and no room_points, skipping`);
                        return; // Skip if we can't determine position
                    }
                }
                
                // Calculate canvas position using the EXACT same formula as InteractiveRoomLabel
                // InteractiveRoomLabel uses: canvasX = currentPosition.x * scaleFactor + offsetX
                const canvasX = labelPos.x * scaleFactor + offsetX;
                const canvasY = labelPos.y * scaleFactor + offsetY;
                
                console.log(`📍 Drawing label for room ${room.id} (${room.room_name}):`, {
                    usingStoredPosition,
                    modelPosition: { x: labelPos.x.toFixed(2), y: labelPos.y.toFixed(2) },
                    transform: { scaleFactor: scaleFactor.toFixed(4), offsetX: offsetX.toFixed(2), offsetY: offsetY.toFixed(2) },
                    canvasPosition: { x: canvasX.toFixed(2), y: canvasY.toFixed(2) }
                });
                
                // Prepare text content (same format as InteractiveRoomLabel)
                const name = room.room_name || 'Unnamed Room';
                // Don't show temperature if it's 0°C
                const tempValue = Number(room.temperature);
                const temperature = (room.temperature !== undefined && room.temperature !== null && tempValue !== 0)
                    ? `${tempValue > 0 ? '+' : ''}${tempValue}°C`
                    : '';
                const height = room.height ? `EXT. HT. ${room.height}mm` : 'EXT. HT. No height';
                
                // Format text lines
                let lines = [];
                if (temperature) {
                    if (name.length > 15) {
                        lines.push(name);
                        lines.push(temperature);
                    } else {
                        lines.push(`${name} ${temperature}`);
                    }
                } else {
                    lines.push(name);
                }
                lines.push(height);
                
                // Draw text on canvas with better styling
                ctx.save();
                
                // Set font size based on scale factor (similar to InteractiveRoomLabel)
                const baseFontSize = 8;
                const fontSize = Math.max(baseFontSize, baseFontSize * scaleFactor);
                ctx.font = `${fontSize}px Arial`;
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                // Calculate text dimensions
                const lineHeight = fontSize + 2;
                const totalHeight = lines.length * lineHeight;
                const startY = canvasY - (totalHeight / 2) + (lineHeight / 2);
                
                // Draw each line
                lines.forEach((line, index) => {
                    ctx.fillText(line, canvasX, startY + (index * lineHeight));
                });
                
                ctx.restore();
                
                // Draw arrow if label is outside room and room is too small
                if (room.room_points && room.room_points.length >= 3) {
                    const normalizedPolygon = room.room_points.map(pt => ({
                        x: Number(pt.x) || 0,
                        y: Number(pt.y) || 0
                    }));
                    
                    const isLabelOutsideRoom = !isPointInPolygon(labelPos, normalizedPolygon);
                    const roomCanContain = canRoomContainLabel(room, scaleFactor);
                    const shouldShowArrow = isLabelOutsideRoom && !roomCanContain;
                    
                    if (shouldShowArrow) {
                        // Calculate room center
                        const roomCenterX = normalizedPolygon.reduce((sum, p) => sum + p.x, 0) / normalizedPolygon.length;
                        const roomCenterY = normalizedPolygon.reduce((sum, p) => sum + p.y, 0) / normalizedPolygon.length;
                        
                        // Calculate direction from label to room center
                        const dx = roomCenterX - labelPos.x;
                        const dy = roomCenterY - labelPos.y;
                        const absDx = Math.abs(dx);
                        const absDy = Math.abs(dy);
                        
                        // Estimate label dimensions (approximate)
                        const estimatedLabelWidth = 120;
                        const estimatedLabelHeight = 50;
                        
                        // Determine starting point on label edge
                        let startX, startY;
                        let isHorizontalEdge = false;
                        
                        if (absDx > absDy) {
                            // Horizontal direction
                            isHorizontalEdge = true;
                            if (dx > 0) {
                                startX = canvasX + estimatedLabelWidth / 2;
                                startY = canvasY;
                            } else {
                                startX = canvasX - estimatedLabelWidth / 2;
                                startY = canvasY;
                            }
                        } else {
                            // Vertical direction
                            if (dy > 0) {
                                startX = canvasX;
                                startY = canvasY + estimatedLabelHeight / 2;
                            } else {
                                startX = canvasX;
                                startY = canvasY - estimatedLabelHeight / 2;
                            }
                        }
                        
                        // End point at room center (in canvas coordinates)
                        const endX = roomCenterX * scaleFactor + offsetX;
                        const endY = roomCenterY * scaleFactor + offsetY;
                        
                        // Create L-shaped path
                        let midX, midY;
                        if (isHorizontalEdge) {
                            midX = endX;
                            midY = startY;
                        } else {
                            midX = startX;
                            midY = endY;
                        }
                        
                        // Draw arrow (L-shaped path with arrowhead)
                        ctx.save();
                        ctx.strokeStyle = '#ff0000';
                        ctx.lineWidth = Math.max(1.2 * Math.sqrt(scaleFactor), 1);
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        
                        // Draw first segment (horizontal or vertical)
                        ctx.beginPath();
                        ctx.moveTo(startX, startY);
                        ctx.lineTo(midX, midY);
                        ctx.stroke();
                        
                        // Draw second segment to room center
                        ctx.beginPath();
                        ctx.moveTo(midX, midY);
                        ctx.lineTo(endX, endY);
                        ctx.stroke();
                        
                        // Draw arrowhead
                        const angle = Math.atan2(endY - midY, endX - midX);
                        const arrowLength = 8;
                        ctx.beginPath();
                        ctx.moveTo(endX, endY);
                        ctx.lineTo(
                            endX - arrowLength * Math.cos(angle - Math.PI / 6),
                            endY - arrowLength * Math.sin(angle - Math.PI / 6)
                        );
                        ctx.moveTo(endX, endY);
                        ctx.lineTo(
                            endX - arrowLength * Math.cos(angle + Math.PI / 6),
                            endY - arrowLength * Math.sin(angle + Math.PI / 6)
                        );
                        ctx.stroke();
                        
                        ctx.restore();
                    }
                }
                
                labelsDrawn++;
            });
            
            console.log(`✅ Drew ${labelsDrawn} room labels on canvas`);
        };
        
        const captureCanvasImage = async () => {
            // Wait for canvas to render
            await new Promise(resolve => setTimeout(resolve, 500));
            
            let canvas = null;
            let planType = null;
            
            if (projectDetails.currentView === 'wall-plan') {
                canvas = document.querySelector('canvas[data-plan-type="wall"]');
                planType = 'wall';
            } else if (projectDetails.currentView === 'ceiling-plan') {
                canvas = document.querySelector('canvas[data-plan-type="ceiling"]');
                planType = 'ceiling';
            } else if (projectDetails.currentView === 'floor-plan') {
                canvas = document.querySelector('canvas[data-plan-type="floor"]');
                planType = 'floor';
            }
            
            if (canvas && planType) {
                try {
                    // Remove grid lines before capturing
                    let cleanCanvas = removeGridFromCanvas(canvas);
                    
                    // For wall plan, draw room labels on the canvas
                    if (planType === 'wall' && projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0) {
                        console.log(`🔍 Attempting to draw room labels for ${projectDetails.filteredRooms.length} rooms`);
                        
                        // Get transform values from canvas data attributes (set by Canvas2D)
                        // These MUST match the values used by InteractiveRoomLabel for correct positioning
                        const scaleFactorAttr = canvas.getAttribute('data-scale-factor');
                        const offsetXAttr = canvas.getAttribute('data-offset-x');
                        const offsetYAttr = canvas.getAttribute('data-offset-y');
                        
                        const scaleFactor = scaleFactorAttr ? parseFloat(scaleFactorAttr) : 1;
                        const offsetX = offsetXAttr ? parseFloat(offsetXAttr) : 0;
                        const offsetY = offsetYAttr ? parseFloat(offsetYAttr) : 0;
                        
                        // Validate transform values
                        if (isNaN(scaleFactor) || isNaN(offsetX) || isNaN(offsetY)) {
                            console.warn(`⚠️ Invalid transform values from canvas: scaleFactor=${scaleFactorAttr}, offsetX=${offsetXAttr}, offsetY=${offsetYAttr}`);
                        }
                        
                        console.log(`📐 Canvas transform values (from data attributes):`, {
                            scaleFactor: scaleFactor.toFixed(4),
                            offsetX: offsetX.toFixed(2),
                            offsetY: offsetY.toFixed(2),
                            raw: { scaleFactorAttr, offsetXAttr, offsetYAttr }
                        });
                        console.log(`📋 Rooms with label positions:`, projectDetails.filteredRooms
                            .filter(r => r.label_position && r.label_position.x !== undefined && r.label_position.y !== undefined)
                            .map(r => ({
                                id: r.id,
                                name: r.room_name,
                                labelPosition: r.label_position
                            })));
                        
                        // Create a new canvas with room labels drawn
                        const labeledCanvas = document.createElement('canvas');
                        labeledCanvas.width = canvas.width;
                        labeledCanvas.height = canvas.height;
                        const labeledCtx = labeledCanvas.getContext('2d');
                        
                        // Copy the clean canvas
                        labeledCtx.drawImage(cleanCanvas, 0, 0);
                        
                        // Draw room labels using the actual transform values
                        drawRoomLabelsOnCanvas(labeledCtx, projectDetails.filteredRooms, scaleFactor, offsetX, offsetY);
                        
                        cleanCanvas = labeledCanvas;
                    } else {
                        console.log(`⚠️ Skipping room labels: planType=${planType}, hasRooms=${!!(projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0)}`);
                    }
                    
                    const imageData = cleanCanvas.toDataURL('image/png', 0.9);
                    console.log(`📸 Captured ${planType} plan image (without grid${planType === 'wall' ? ', with room labels' : ''})`);
                    
                    // Store in shared data - use special method for canvas images
                    projectDetails.updateCanvasImage(planType, imageData);
                } catch (error) {
                    console.warn(`Failed to capture ${planType} plan:`, error);
                }
            }
        };
        
        // Only capture when on a canvas tab
        if (['wall-plan', 'ceiling-plan', 'floor-plan'].includes(projectDetails.currentView)) {
            captureCanvasImage();
        }
    }, [projectDetails.currentView, projectDetails.filteredWalls, projectDetails.filteredRooms]);

    // Memoize the room close handler to prevent unnecessary re-renders
    const handleRoomClose = useCallback(() => {
        projectDetails.setShowRoomManagerModal(false);
        projectDetails.setEditingRoom(null);
        projectDetails.setCurrentMode(null);
    }, [projectDetails]);

    // Memoize the room save handler to prevent unnecessary re-renders
    const handleRoomSave = useCallback((roomData) => {
        if (projectDetails.editingRoom) {
            projectDetails.handleRoomUpdate(roomData);
        } else {
            projectDetails.handleCreateRoom(roomData);
        }
    }, [projectDetails]);

    // Memoize the room delete handler to prevent unnecessary re-renders
    const handleRoomDelete = useCallback((roomId) => {
        if (projectDetails.editingRoom) {
            projectDetails.handleRoomDelete(roomId);
        }
    }, [projectDetails]);

    // When the modal opens, copy the selected wall to local state
    useEffect(() => {
        if (projectDetails.selectedWall !== null) {
            const wall = projectDetails.filteredWalls.find(w => w.id === projectDetails.selectedWall);
            setEditedWall(wall ? { ...wall } : null);
        } else {
            setEditedWall(null);
        }
    }, [projectDetails.selectedWall, projectDetails.filteredWalls]);

    // Calculate dynamic 3D container height for mobile responsiveness
    useEffect(() => {
        if (!projectDetails.is3DView) return;

        const updateContainerHeight = () => {
            // Get the container element
            const container = document.getElementById('three-canvas-container');
            if (!container) {
                // Retry after a short delay if container not found
                setTimeout(updateContainerHeight, 100);
                return;
            }

            // Get the parent container to calculate available space
            const parentContainer = container.parentElement;
            if (!parentContainer) return;

            // Get available width from parent container
            const containerWidth = parentContainer.clientWidth || container.clientWidth || window.innerWidth;
            
            // Calculate max height based on viewport
            const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
            const maxHeight = viewportHeight * MAX_CANVAS_HEIGHT_RATIO;
            
            // Calculate height based on aspect ratio (similar to 2D view)
            // Default aspect ratio: 600/1000 = 0.6, but allow more height on mobile
            const calculatedHeight = containerWidth * 0.6;
            const preferredHeight = Math.max(calculatedHeight, MIN_CANVAS_HEIGHT);
            const constrainedHeight = Math.min(preferredHeight, maxHeight);
            const finalHeight = Math.max(constrainedHeight, MIN_CANVAS_HEIGHT);

            // Mobile: use calculated height (fills more space), Desktop: calculated or 600px max
            const isMobile = window.innerWidth < 640;
            const newHeight = isMobile 
                ? Math.min(finalHeight, maxHeight) // On mobile, use more of the available space
                : Math.min(finalHeight, 600); // On desktop, cap at 600px

            // Only update if height actually changed (prevents infinite loops)
            setThreeDContainerHeight(prevHeight => {
                if (Math.abs(prevHeight - newHeight) < 1) {
                    return prevHeight;
                }
                return newHeight;
            });
        };

        // Initial calculation with delay to ensure DOM is ready
        const initialTimeout = setTimeout(updateContainerHeight, 50);

        // Setup ResizeObserver for parent container (watches the canvas-container div)
        let resizeObserver = null;
        const parentContainer = document.querySelector('.canvas-container');
        
        if (parentContainer && typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver((entries) => {
                // Use requestAnimationFrame to throttle updates
                requestAnimationFrame(() => {
                    updateContainerHeight();
                });
            });
            resizeObserver.observe(parentContainer);
        }

        // Window resize and orientation change listeners
        const handleWindowResize = () => {
            // Use requestAnimationFrame to throttle resize updates
            requestAnimationFrame(() => {
                updateContainerHeight();
            });
        };
        
        const handleOrientationChange = () => {
            // Delay slightly to allow browser to finish orientation change
            setTimeout(() => {
                updateContainerHeight();
            }, 100);
        };
        
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', handleWindowResize);
            window.addEventListener('orientationchange', handleOrientationChange);
            // Also listen for visual viewport changes (better for mobile)
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', handleWindowResize);
            }
        }

        return () => {
            clearTimeout(initialTimeout);
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', handleWindowResize);
                window.removeEventListener('orientationchange', handleOrientationChange);
                if (window.visualViewport) {
                    window.visualViewport.removeEventListener('resize', handleWindowResize);
                }
            }
        };
    }, [projectDetails.is3DView]);

    return (
        <div className="min-h-screen bg-gray-50 project-details-container">
            {/* Full-Screen Loading Modal for Image Capture */}
            {isCapturingImages && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
                    <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md mx-4">
                        <div className="text-center">
                            {captureSuccess ? (
                                <>
                                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                                        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-800 mb-3">Success!</h3>
                                    <p className="text-gray-600 mb-4">
                                        All plan images have been captured successfully.
                                    </p>
                                    <div className="space-y-2 text-sm text-green-600">
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                            <span>Wall Plan ✓</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                            <span>Ceiling Plan ✓</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                                            <span>Floor Plan ✓</span>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-4">
                                        You can now export your project report with images.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-6"></div>
                                    <h3 className="text-xl font-bold text-gray-800 mb-3">Auto-Fetching Data & Images</h3>
                                    <p className="text-gray-600 mb-4">
                                        Capturing plan images from all tabs...
                                    </p>
                                    <div className="space-y-2 text-sm text-gray-500">
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                                            <span>Switching to Wall Plan...</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                                            <span>Switching to Ceiling Plan...</span>
                                        </div>
                                        <div className="flex items-center justify-center">
                                            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                                            <span>Switching to Floor Plan...</span>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-4">
                                        Please wait while we capture all plan images...
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Navigation Bar */}
            <div className="bg-white border-b border-gray-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 sm:space-x-4">
                            <button
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                                className="lg:hidden flex items-center px-2 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            </button>
                            <button
                                onClick={() => navigate('/')}
                                className="flex items-center px-2 sm:px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <FaArrowLeft className="w-4 h-4 sm:mr-2" />
                                <span className="hidden sm:inline">Back to Home</span>
                            </button>
                            <div className="h-6 w-px bg-gray-300 hidden sm:block"></div>
                            <div className="flex items-center text-gray-900">
                                <FaCube className="w-5 h-5 mr-2 text-blue-600" />
                                <span className="font-medium hidden sm:inline">Project View</span>
                            </div>
                        </div>
                        
                        <div className="flex items-center space-x-2 sm:space-x-3">
                            <button
                                onClick={() => navigate('/')}
                                className="flex items-center px-2 sm:px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <FaHome className="w-4 h-4 sm:mr-2" />
                                <span className="hidden sm:inline">Home</span>
                            </button>
                            <div className="h-6 w-px bg-gray-300 hidden sm:block"></div>
                            <button
                                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                                className="flex items-center px-2 sm:px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                                <span className="hidden sm:inline">Top</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Header Section */}
            <div className="bg-white border-b border-gray-200 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex-shrink-0">
                    {(!projectDetails.project || !projectDetails.project.name) ? (
                                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">Loading project...</h1>
                            ) : (
                                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">{projectDetails.project.name}</h1>
                            )}
                            {projectDetails.project && (
                                <p className="text-xs sm:text-sm text-gray-600 mt-1">
                                    Dimensions: {(projectDetails.project?.width ?? '—')} × {(projectDetails.project?.length ?? '—')} × {effectiveProjectHeight} mm
                                </p>
                            )}
                        </div>
                        
                        {/* View Toggle Buttons */}
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:gap-4">
                            <button
                                onClick={() => {
                                    const newViewState = !projectDetails.is3DView;
                                    if (projectDetails.is3DView) {
                                        // Force cleanup when switching from 3D to 2D
                                        projectDetails.forceCleanup3D();
                                    }
                                    projectDetails.setIs3DView(newViewState);
                                }}
                                className={`flex items-center px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                                    projectDetails.is3DView 
                                        ? 'btn-primary' 
                                        : 'btn-secondary'
                                }`}
                            >
                                {projectDetails.is3DView ? (
                                    <>
                                        <FaSquare className="mr-2" />
                                        2D View
                                    </>
                                ) : (
                                    <>
                                        <FaCube className="mr-2" />
                                        3D View
                                    </>
                                )}
                            </button>
                            <div className="h-6 w-px bg-gray-300 hidden sm:block"></div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-2 w-full sm:w-auto">
                                <FaLayerGroup className="text-blue-600 hidden sm:block" />
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                                    <select
                                        value={projectDetails.activeStoreyId ?? ''}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            if (value === '' || value === undefined) {
                                                return;
                                            }
                                            const numericValue = Number(value);
                                            projectDetails.setActiveStoreyId(Number.isNaN(numericValue) ? value : numericValue);
                                        }}
                                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:min-w-[160px]"
                                    >
                                        {projectDetails.storeys.length === 0 && (
                                            <option value="">No levels</option>
                                        )}
                                        {projectDetails.storeys.map((storey) => (
                                            <option key={storey.id} value={storey.id}>
                                                {storey.name}
                                            </option>
                                        ))}
                                    </select>
                                    {projectDetails.isLevelEditMode ? (
                                        <button
                                            onClick={projectDetails.exitLevelEditMode}
                                            className="px-3 py-1 rounded-lg text-xs sm:text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors whitespace-nowrap"
                                        >
                                            Exit Edit Level
                                        </button>
                                    ) : (
                                        <button
                                            onClick={projectDetails.enterLevelEditMode}
                                            className="px-3 py-1 rounded-lg text-xs sm:text-sm font-medium bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 transition-colors whitespace-nowrap"
                                        >
                                            Edit Level
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            if (!projectDetails.activeStoreyId) {
                                                return;
                                            }
                                            const activeId = projectDetails.activeStoreyId;
                                            const sortedStoreys = [...(projectDetails.storeys || [])]
                                                .sort((a, b) => {
                                                    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
                                                    if (orderDiff !== 0) return orderDiff;
                                                    const elevationDiff = (a.elevation_mm ?? 0) - (b.elevation_mm ?? 0);
                                                    if (Math.abs(elevationDiff) > 1e-6) return elevationDiff;
                                                    return (a.id ?? 0) - (b.id ?? 0);
                                                });
                                            const lowest = sortedStoreys[0];
                                            if (lowest && String(lowest.id) === String(activeId)) {
                                                projectDetails.setStoreyError('Ground floor cannot be deleted.');
                                                setTimeout(() => projectDetails.setStoreyError(''), 4000);
                                                return;
                                            }
                                            if (window.confirm('Delete this level? Rooms, walls, and panels on this storey will be removed.')) {
                                                projectDetails.deleteStorey(activeId);
                                            }
                                        }}
                                        className="px-3 py-1 rounded-lg text-xs sm:text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200 transition-colors whitespace-nowrap"
                                        title="Delete selected level"
                                    >
                                        <span className="hidden sm:inline">Delete Level</span>
                                        <span className="sm:hidden">Delete</span>
                                    </button>
                                    <button
                                        onClick={projectDetails.openStoreyWizard}
                                        className="px-3 py-1 rounded-lg text-xs sm:text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
                                    >
                                        Add Level
                                    </button>
                                    {projectDetails.isStoreyLoading && (
                                        <span className="text-xs text-gray-400">Loading...</span>
                                    )}
                                    {projectDetails.storeyError && (
                                        <span className="text-xs text-red-500">{projectDetails.storeyError}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            {projectDetails.isLevelEditMode && (
                <div className="max-w-7xl mx-auto px-6 mt-4">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-amber-900">Edit Level Mode</h2>
                                <p className="text-sm text-amber-800">
                                    Select rooms from other levels to duplicate onto <span className="font-medium">{projectDetails.activeStorey?.name || 'this level'}</span>.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={projectDetails.clearLevelEditSelections}
                                    className="px-3 py-1.5 text-sm rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
                                >
                                    Clear Selection
                                </button>
                                <button
                                    onClick={projectDetails.exitLevelEditMode}
                                    className="px-3 py-1.5 text-sm rounded-lg border border-amber-400 text-amber-800 hover:bg-amber-200 transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        {(projectDetails.levelEditError || projectDetails.levelEditSuccess) && (
                            <div className="mt-3 space-y-2">
                                {projectDetails.levelEditError && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                        {projectDetails.levelEditError}
                                    </div>
                                )}
                                {projectDetails.levelEditSuccess && (
                                    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                                        {projectDetails.levelEditSuccess}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mt-4 max-h-72 overflow-y-auto pr-1">
                            {roomsGroupedForLevelEdit.length === 0 ? (
                                <p className="text-sm text-amber-700">
                                    No rooms available on other levels to duplicate.
                                </p>
                            ) : (
                                roomsGroupedForLevelEdit.map(({ storey, rooms }) => (
                                    <div key={storey.id} className="mb-4 rounded-lg border border-white bg-white/60 p-3 last:mb-0">
                                        <div>
                                            <p className="text-sm font-semibold text-amber-900">
                                                {storey.name}
                                            </p>
                                            <p className="text-xs text-amber-700">
                                                Elevation {Math.round(storey.elevation_mm ?? 0)} mm · Default height {Math.round(storey.default_room_height_mm ?? 0)} mm
                                            </p>
                                        </div>
                                        <div className="mt-3 space-y-2">
                                            {rooms.map((room) => {
                                                const isSelected = (projectDetails.levelEditSelections || []).some(
                                                    (id) => String(id) === String(room.id)
                                                );
                                                
                                                // Check if this room already exists on the active storey
                                                const roomPoints = Array.isArray(room.room_points) && room.room_points.length >= 3
                                                    ? room.room_points
                                                    : null;
                                                const roomSignature = roomPoints
                                                    ? JSON.stringify(
                                                          roomPoints.map((point) => [
                                                              Number(point.x) || 0,
                                                              Number(point.y) || 0,
                                                          ])
                                                      )
                                                    : null;
                                                const alreadyExists = roomSignature
                                                    ? activeStoreyRoomSignatures.has(roomSignature)
                                                    : false;
                                                
                                                const baseElevation =
                                                    Number(room.base_elevation_mm ?? storey.elevation_mm ?? 0) || 0;
                                                const height =
                                                    Number(room.height ?? storey.default_room_height_mm ?? 0) || 0;
                                                const topElevation = baseElevation + height;
                                                const plannedBase =
                                                    (projectDetails.levelEditOverrides &&
                                                        projectDetails.levelEditOverrides[String(room.id)] &&
                                                        projectDetails.levelEditOverrides[String(room.id)].baseElevation !== undefined)
                                                        ? projectDetails.levelEditOverrides[String(room.id)].baseElevation
                                                        : projectDetails.activeStorey?.elevation_mm ?? 0;
                                                const plannedHeight =
                                                    (projectDetails.levelEditOverrides &&
                                                        projectDetails.levelEditOverrides[String(room.id)] &&
                                                        projectDetails.levelEditOverrides[String(room.id)].height !== undefined)
                                                        ? projectDetails.levelEditOverrides[String(room.id)].height
                                                        : height;
                                                const plannedBaseValue = Number.isFinite(Number(plannedBase))
                                                    ? Number(plannedBase)
                                                    : Number(projectDetails.activeStorey?.elevation_mm ?? 0);
                                                const plannedHeightValue = Number.isFinite(Number(plannedHeight))
                                                    ? Number(plannedHeight)
                                                    : Number(height);
                                                return (
                                                    <label
                                                        key={room.id}
                                                        className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                                                            alreadyExists
                                                                ? 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                                                                : 'border-amber-100 bg-white text-amber-900 hover:border-amber-300'
                                                        }`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            className={`mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 ${
                                                                alreadyExists ? 'opacity-50 cursor-not-allowed' : ''
                                                            }`}
                                                            checked={isSelected}
                                                            disabled={alreadyExists}
                                                            onChange={() => {
                                                                if (!alreadyExists) {
                                                                    projectDetails.toggleLevelEditRoom(room.id);
                                                                }
                                                            }}
                                                        />
                                                        <div className="flex-1">
                                                            <p className="font-medium">{room.room_name}</p>
                                                            {alreadyExists ? (
                                                                <p className="text-xs text-red-600 font-medium mt-1">
                                                                    Already exists on {projectDetails.activeStorey?.name || 'this level'}
                                                                </p>
                                                            ) : (
                                                                <p className="text-xs text-amber-700">
                                                                    Origin base {Math.round(baseElevation)} mm · Origin height {Math.round(height)} mm · Origin top {Math.round(topElevation)} mm
                                                                </p>
                                                            )}
                                                            {isSelected && (
                                                                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                                    <label className="text-xs text-amber-800">
                                                                        <span className="block font-medium mb-1">Base Elevation (mm)</span>
                                                                        <input
                                                                            type="number"
                                                                            className="w-full rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                                                            value={plannedBaseValue}
                                                                            min={Math.round(projectDetails.activeStorey?.elevation_mm ?? 0)}
                                                                            onChange={(event) => {
                                                                                projectDetails.updateLevelEditOverride(room.id, {
                                                                                    baseElevation: event.target.value,
                                                                                });
                                                                            }}
                                                                        />
                                                                    </label>
                                                                    <label className="text-xs text-amber-800">
                                                                        <span className="block font-medium mb-1">Room Height (mm)</span>
                                                                        <input
                                                                            type="number"
                                                                            className="w-full rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                                                            value={plannedHeightValue}
                                                                            min={0}
                                                                            onChange={(event) => {
                                                                                projectDetails.updateLevelEditOverride(room.id, {
                                                                                    height: event.target.value,
                                                                                });
                                                                            }}
                                                                        />
                                                                    </label>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                                onClick={projectDetails.addRoomsToActiveStorey}
                                disabled={
                                    projectDetails.isLevelEditApplying ||
                                    (projectDetails.levelEditSelections || []).length === 0
                                }
                                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                                    (projectDetails.levelEditSelections || []).length === 0 || projectDetails.isLevelEditApplying
                                        ? 'bg-amber-200 text-amber-500 cursor-not-allowed'
                                        : 'bg-amber-500 text-white hover:bg-amber-600'
                                }`}
                            >
                                {projectDetails.isLevelEditApplying ? 'Adding...' : 'Add Selected Rooms'}
                            </button>
                            <span className="text-xs text-amber-700">
                                Selected {projectDetails.levelEditSelections?.length || 0} rooms
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Define Room Container - Above Canvas */}
            {projectDetails.currentMode === 'define-room' && (
                <div className="w-full bg-white border-b border-gray-200 shadow-sm">
                    {/* Room Definition Header */}
                    <div className="p-4 border-b border-gray-200">
                        <div className="max-w-4xl mx-auto">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">Define Room</h3>
                                    <p className="text-sm text-gray-600 mt-1">
                                        Select walls to define room boundaries. Click on walls to select/deselect them.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-sm text-gray-600">
                                        <span className="font-medium">Selected:</span> {projectDetails.selectedWallsForRoom.length} walls
                                    </div>
                    <button
                                        onClick={() => projectDetails.setCurrentMode(null)}
                                        className="px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                    </button>
                                </div>
                            </div>
                            
                            {projectDetails.selectedWallsForRoom.length > 0 && (
                                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm text-blue-800">
                                            <span className="font-medium">Ready to create room</span> with {projectDetails.selectedWallsForRoom.length} walls
                                        </div>
                                        <button
                                            onClick={() => projectDetails.setShowRoomManagerModal(!projectDetails.showRoomManagerModal)}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                        >
                                            {projectDetails.showRoomManagerModal ? 'Hide Room Form' : 'Create Room'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Room Creation Interface */}
                    {projectDetails.showRoomManagerModal && !projectDetails.isRoomManagerMinimized && (
                        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[11000] p-4">
                            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-xl">
                                    <div>
                                        <h2 className="text-xl font-semibold text-gray-900">
                                            {projectDetails.editingRoom ? 'Edit Room' : 'Create New Room'}
                                        </h2>
                                        <p className="text-sm text-gray-500">
                                            {projectDetails.currentMode === 'define-room' ? 'Click on the canvas to place points. Close the loop by clicking the first point.' : 'Define room properties'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => projectDetails.setRoomManagerMinimized(true)}
                                            className="text-gray-500 hover:text-gray-700 transition-colors"
                                            title="Minimize"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => projectDetails.setShowRoomManagerModal(false)}
                                            className="text-gray-500 hover:text-gray-700 transition-colors"
                                        >
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6">
                                    <RoomManager
                                        projectId={projectId}
                                        walls={projectDetails.filteredWalls}
                                        storeys={projectDetails.storeys}
                                        activeStoreyId={projectDetails.activeStoreyId}
                                        onStoreyChange={projectDetails.setActiveStoreyId}
                                        selectedWallIds={projectDetails.selectedWallsForRoom}
                                        onSave={handleRoomSave}
                                        onDelete={handleRoomDelete}
                                        onClose={handleRoomClose}
                                        editingRoom={projectDetails.editingRoom}
                                        selectedPolygonPoints={projectDetails.selectedRoomPoints}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {projectDetails.showRoomManagerModal && projectDetails.isRoomManagerMinimized && (
                        <div className="fixed bottom-6 right-6 z-[11000] flex flex-col gap-2">
                            <div className="bg-gray-900/90 text-white px-4 py-3 rounded-lg shadow-lg max-w-md">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium">
                                        {projectDetails.currentMode === 'define-room' ? 'Drawing room area…' : (projectDetails.editingRoom ? 'Editing room…' : 'Creating room…')}
                                    </div>
                                    <button
                                        onClick={() => projectDetails.setRoomManagerMinimized(false)}
                                        className="text-xs text-blue-200 hover:text-white transition-colors"
                                    >
                                        Restore panel
                                    </button>
                                </div>
                                <p className="text-xs text-gray-200 mt-2">
                                    {projectDetails.currentMode === 'define-room' 
                                        ? 'Click on the canvas to place points. Close the loop by clicking the first point.'
                                        : 'Complete the room form to save.'}
                                </p>
                                <div className="mt-3 flex items-center gap-2">
                                    <button
                                        onClick={handleRoomClose}
                                        className="px-3 py-1.5 rounded-md bg-red-500 text-xs font-medium hover:bg-red-600 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => projectDetails.setRoomManagerMinimized(false)}
                                        className="px-3 py-1.5 rounded-md bg-gray-700 text-xs font-medium hover:bg-gray-600 transition-colors"
                                    >
                                        Resume form
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex min-h-[calc(100vh-120px)] relative">
                {/* Mobile Sidebar Overlay */}
                {sidebarOpen && (
                    <div 
                        className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    ></div>
                )}
                
                {/* Left Sidebar - Controls */}
                <div className={`fixed lg:static inset-y-0 left-0 z-50 lg:z-auto w-80 bg-white border-r border-gray-200 shadow-sm overflow-y-auto sidebar-scroll transform transition-transform duration-300 ease-in-out ${
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}>
                    <div className="p-4 sm:p-6">
                        {/* Mobile Close Button */}
                        <div className="flex items-center justify-between mb-4 lg:hidden">
                            <h2 className="text-lg font-semibold text-gray-900">Controls</h2>
                            <button
                                onClick={() => setSidebarOpen(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        {/* Edit Mode Toggle */}
                        <div className="mb-6">
                    <button
                        onClick={() => {
                                    if (!projectDetails.is3DView) {
                                projectDetails.setIsEditingMode(!projectDetails.isEditingMode);
                                projectDetails.setCurrentMode(null);
                                projectDetails.resetAllSelections();
                            }
                        }}
                                disabled={projectDetails.is3DView}
                                className={`w-full flex items-center justify-center px-4 py-3 rounded-lg font-medium transition-all duration-200 ${
                                    projectDetails.isEditingMode 
                                        ? 'btn-danger' 
                                        : 'btn-secondary'
                                } ${projectDetails.is3DView ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <FaCog className="mr-2" />
                        {projectDetails.isEditingMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                    </button>
                            {projectDetails.is3DView && (
                                <p className="text-xs text-gray-500 mt-2 text-center">
                                    Edit mode is disabled in 3D view
                                </p>
                            )}
                </div>

                {/* Editing Mode Controls */}
                {projectDetails.isEditingMode && !projectDetails.is3DView && (
                    <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Drawing Tools</h3>
                                
                                <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => projectDetails.toggleMode('add-wall')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'add-wall' ? 'active' : ''
                                        }`}
                                    >
                                        <FaPencilAlt className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Add Wall</span>
                            </button>

                            <button
                            onClick={() => {
                                if (projectDetails.selectedWall !== null) {
                                projectDetails.setShowWallEditor(true);
                                }
                                projectDetails.toggleMode('edit-wall');
                            }}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'edit-wall' ? 'active' : ''
                                        }`}
                                    >
                                        <FaEdit className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Edit Wall</span>
                            </button>

                            <button
                            onClick={() => projectDetails.toggleMode('merge-wall')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'merge-wall' ? 'active' : ''
                                        }`}
                                    >
                                        <FaObjectGroup className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Merge Walls</span>
                                    </button>

                                    <button
                                        onClick={() => projectDetails.toggleMode('split-wall')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'split-wall' ? 'active' : ''
                                        }`}
                                    >
                                        <FaCut className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Split Wall</span>
                                    </button>

                                    <button
                                        onClick={() => projectDetails.toggleMode('define-room')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'define-room' ? 'active' : ''
                                        }`}
                                    >
                                        <FaHome className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Define Room</span>
                                    </button>

                                    <button
                                        onClick={() => projectDetails.toggleMode('add-door')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'add-door' ? 'active' : ''
                                        }`}
                                    >
                                        <FaDoorOpen className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Add Door</span>
                        </button>

                                    <button
                                        onClick={() => projectDetails.toggleMode('edit-door')}
                                        className={`tool-button ${
                                            projectDetails.currentMode === 'edit-door' ? 'active' : ''
                                        }`}
                                    >
                                        <FaEdit className="text-xl mb-2" />
                                        <span className="text-sm font-medium">Edit Door</span>
                                    </button>
                                </div>

                                {/* Wall Type Selection */}
                                {projectDetails.currentMode === 'add-wall' && (
                                    <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 shadow-sm">
                                        <label className="block text-sm font-semibold text-blue-800 mb-3 uppercase tracking-wide">Wall Type:</label>
                                        <select 
                                            value={projectDetails.selectedWallType} 
                                            onChange={(e) => projectDetails.setSelectedWallType(e.target.value)}
                                            className="w-full px-4 py-3 rounded-lg border-2 border-blue-300 
                                                focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                                                bg-white text-blue-900 focus-ring font-medium shadow-sm"
                                        >
                                            <option value="wall">Wall</option>
                                            <option value="partition">Partition</option>
                                        </select>
                                    </div>
                                )}

                                {/* Merge Confirmation */}
                        {projectDetails.currentMode === 'merge-wall' && (
                                    <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border border-yellow-200 shadow-sm">
                                        <p className="text-sm text-yellow-800 mb-3 font-medium">
                                            Select exactly 2 walls to merge
                                        </p>
                            <button
                                onClick={() => {
                                    if (projectDetails.selectedWallsForRoom.length === 2) {
                                    projectDetails.handleManualWallMerge(projectDetails.selectedWallsForRoom);
                                    } else {
                                    projectDetails.setWallMergeError("Please select exactly 2 walls to merge.");
                                    setTimeout(() => projectDetails.setWallMergeError(''), 5000);
                                    }
                                }}
                                            className="w-full px-4 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg hover:from-yellow-600 hover:to-orange-600 transition-all duration-200 font-semibold shadow-lg transform hover:scale-105"
                            >
                                Confirm Merge
                            </button>
                                    </div>
                                )}

                                {projectDetails.currentMode === 'split-wall' && (
                                    <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg border border-emerald-200 shadow-sm space-y-3">
                                        <p className="text-sm text-emerald-800 font-medium">
                                            Select a wall, then either click along it to split at a snapped point,
                                            or enter an exact distance in the split panel beside the canvas.
                                        </p>
                                        <p className="text-xs text-emerald-700">
                                            Tip: the preview marker updates as you move the cursor over the selected wall.
                                        </p>
                                    </div>
                                )}

                                {/* Status Messages */}
                                {projectDetails.wallMergeError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                        <p className="text-sm text-red-700">{projectDetails.wallMergeError}</p>
                                    </div>
                                )}

                                {projectDetails.wallMergeSuccess && (
                                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <p className="text-sm text-green-700">Walls merged successfully!</p>
                                    </div>
                                )}

                                {projectDetails.wallSplitError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                        <p className="text-sm text-red-700">{projectDetails.wallSplitError}</p>
                                    </div>
                                )}

                                {projectDetails.wallSplitSuccess && (
                                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <p className="text-sm text-green-700">Wall split completed successfully!</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 3D View Notice */}
                        {projectDetails.is3DView && (
                            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                <div className="flex items-center">
                                    <svg className="w-5 h-5 text-yellow-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <span className="text-sm text-yellow-800 font-medium">
                                        Edit mode is disabled in 3D view. Switch to 2D view to edit your project.
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Project Stats */}
                        <div className="mt-8 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                            <h3 className="text-sm font-semibold text-blue-800 uppercase tracking-wide mb-3">Project Stats</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                    <span className="text-blue-700 font-medium">Walls:</span>
                                    <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full">{projectDetails.filteredWalls.length}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                    <span className="text-blue-700 font-medium">Rooms:</span>
                                    <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full">{projectDetails.filteredRooms.length}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                    <span className="text-blue-700 font-medium">Doors:</span>
                                    <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full">{projectDetails.filteredDoors.length}</span>
                                </div>
                                {projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0 && (
                                    <div className="flex justify-between items-center p-2 bg-white rounded-lg border border-blue-200">
                                        <span className="text-blue-700 font-medium">Est. Install:</span>
                                        <span className="font-bold text-blue-900 bg-blue-100 px-2 py-1 rounded-full text-xs">
                                            {Math.ceil(projectDetails.filteredRooms.length * 2 / 8)} days
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col overflow-visible">
                    {/* 3D Controls Bar - Only show when in 3D view */}
                    {projectDetails.is3DView && (
                        <div className="mx-3 sm:mx-6 mt-3 sm:mt-6 mb-2">
                            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                                        <h3 className="text-base sm:text-lg font-semibold text-gray-900">3D View Controls</h3>
                                        <div className="text-xs sm:text-sm text-gray-500 hidden sm:block">
                                            (Use pinch-to-zoom on mobile)
                                        </div>
                                        <button
                                            onClick={projectDetails.handleViewToggle}
                                            className="flex items-center px-3 sm:px-4 py-2 rounded-lg bg-green-600 text-white text-sm sm:text-base font-medium hover:bg-green-700 transition-all duration-200 shadow-lg"
                                        >
                                            {projectDetails.isInteriorView ? (
                                                <>
                                                    <FaEye className="mr-1 sm:mr-2" />
                                                    <span className="hidden sm:inline">Switch to Exterior</span>
                                                    <span className="sm:hidden">Exterior</span>
                                                </>
                                            ) : (
                                                <>
                                                    <FaEyeSlash className="mr-1 sm:mr-2" />
                                                    <span className="hidden sm:inline">Switch to Interior</span>
                                                    <span className="sm:hidden">Interior</span>
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={projectDetails.togglePanelLines}
                                            className={`flex items-center px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-all duration-200 shadow-lg ${
                                                projectDetails.showPanelLines 
                                                    ? 'bg-blue-600 text-white hover:bg-blue-700' 
                                                    : 'bg-gray-600 text-white hover:bg-gray-700'
                                            }`}
                                        >
                                            <span className="hidden sm:inline">{projectDetails.showPanelLines ? 'Hide Panel Lines' : 'Show Panel Lines'}</span>
                                            <span className="sm:hidden">{projectDetails.showPanelLines ? 'Hide' : 'Show'}</span>
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm">
                                        <div className="text-sm text-gray-600">
                                            <span className="font-medium">View:</span> {projectDetails.isInteriorView ? 'Interior' : 'Exterior'}
                                        </div>
                                        <div className="h-6 w-px bg-gray-300"></div>
                                        <div className="text-sm text-gray-600">
                                            <span className="font-medium">Canvas Controls:</span> Use buttons on 3D canvas
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Canvas Container */}
                    <div className="bg-white m-3 sm:m-6 rounded-lg shadow-sm border border-gray-200 canvas-container">
                        {projectDetails.is3DView ? (
                            <div 
                                id="three-canvas-container" 
                                className="w-full bg-gray-50 active relative overflow-hidden" 
                                style={{ 
                                    height: `${threeDContainerHeight}px`,
                                    minHeight: `${MIN_CANVAS_HEIGHT}px`
                                }}
                            />
                        ) : (
                            <div className="flex flex-col">
                                {/* Tab Navigation */}
                                <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-gray-200 bg-gray-50">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                        <div className="flex flex-wrap gap-1 sm:space-x-1">
                                            <button
                                                onClick={() => projectDetails.setCurrentView('wall-plan')}
                                                className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-all duration-200 ${
                                                    projectDetails.currentView === 'wall-plan'
                                                        ? 'bg-blue-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <FaSquare className="inline mr-1 sm:mr-2" />
                                                <span className="hidden sm:inline">Wall Plan</span>
                                                <span className="sm:hidden">Wall</span>
                                            </button>
                                            <button
                                                onClick={() => projectDetails.setCurrentView('ceiling-plan')}
                                                disabled={!projectDetails.filteredRooms || projectDetails.filteredRooms.length === 0}
                                                className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-all duration-200 ${
                                                    (!projectDetails.filteredRooms || projectDetails.filteredRooms.length === 0)
                                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                        : projectDetails.currentView === 'ceiling-plan'
                                                        ? 'bg-green-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <FaLayerGroup className="inline mr-1 sm:mr-2" />
                                                <span className="hidden sm:inline">Ceiling Plan</span>
                                                <span className="sm:hidden">Ceiling</span>
                                            </button>
                                            <button
                                                onClick={() => projectDetails.setCurrentView('floor-plan')}
                                                disabled={
                                                    !projectDetails.filteredRooms ||
                                                    projectDetails.filteredRooms.length === 0 ||
                                                    !projectDetails.filteredRooms.some(room => room.floor_type === 'panel' || room.floor_type === 'Panel')
                                                }
                                                className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-all duration-200 ${
                                                    (!projectDetails.filteredRooms || projectDetails.filteredRooms.length === 0 || !projectDetails.filteredRooms.some(room => room.floor_type === 'panel' || room.floor_type === 'Panel'))
                                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                        : projectDetails.currentView === 'floor-plan'
                                                        ? 'bg-green-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <FaSquare className="inline mr-1 sm:mr-2" />
                                                <span className="hidden sm:inline">Floor Plan</span>
                                                <span className="sm:hidden">Floor</span>
                                                {projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0 && (
                                                    <span className="ml-1 text-xs hidden sm:inline">
                                                        ({projectDetails.filteredRooms.filter(room => room.floor_type === 'panel' || room.floor_type === 'Panel').length} panel rooms)
                                                    </span>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => projectDetails.setCurrentView('installation-estimator')}
                                                className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-all duration-200 ${
                                                    projectDetails.currentView === 'installation-estimator'
                                                        ? 'bg-orange-600 text-white shadow-md'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                }`}
                                            >
                                                <svg className="w-4 h-4 inline mr-1 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <span className="hidden lg:inline">Project Summary & Installation Time</span>
                                                <span className="lg:hidden hidden sm:inline">Summary</span>
                                                <span className="sm:hidden">Time</span>
                                            </button>
                                        </div>
                                        <div className="text-xs sm:text-sm text-gray-600">
                                            {projectDetails.currentView === 'wall-plan' 
                                                ? ''
                                                : projectDetails.currentView === 'ceiling-plan'
                                                ? 'Generate and manage ceiling panels for optimal coverage'
                                                : projectDetails.currentView === 'floor-plan'
                                                ? 'Generate and manage floor panels for optimal coverage (only for rooms with floor_type = "panel")'
                                                : projectDetails.currentView === 'installation-estimator'
                                                ? 'Project overview with installation time calculations'
                                                : 'Click and drag to navigate, use scroll to zoom'
                                            }
                                            {projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0 && !projectDetails.filteredRooms.some(room => room.floor_type === 'panel' || room.floor_type === 'Panel') && projectDetails.currentView === 'floor-plan' && (
                                                <span className="text-orange-600 font-medium ml-2">
                                                    ⚠️ No rooms with panel floors found
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Tab Content */}
                                <div className="relative">
                                    {projectDetails.currentView === 'wall-plan' ? (
                                        <Canvas2D
                                            walls={projectDetails.filteredWalls}
                                            setWalls={projectDetails.setWalls}
                                            joints={projectDetails.filteredJoints}
                                            intersections={projectDetails.filteredJoints}
                                            projectId={projectId}
                                            onWallTypeSelect={projectDetails.selectedWallType}
                                            onWallUpdate={projectDetails.handleWallUpdate}
                                            onNewWall={projectDetails.handleAddWallWithSplitting}
                                            onWallDelete={projectDetails.handleWallDelete}
                                            isEditingMode={projectDetails.isEditingMode}
                                            currentMode={projectDetails.currentMode}
                                            onWallSelect={projectDetails.handleWallSelect}
                                            selectedWallsForRoom={projectDetails.selectedWallsForRoom}
                                            onRoomWallsSelect={projectDetails.setSelectedWallsForRoom}
                                            rooms={projectDetails.filteredRooms}
                                            onRoomSelect={projectDetails.handleRoomSelect}
                                            onRoomUpdate={projectDetails.handleRoomUpdate}
                                            onRoomLabelPositionUpdate={projectDetails.handleRoomLabelPositionUpdate}
                                            onJointsUpdate={projectDetails.setJoints}
                                            doors={projectDetails.filteredDoors}
                                            onDoorSelect={projectDetails.handleDoorSelect}
                                            onDoorWallSelect={(wall) => {
                                                projectDetails.setSelectedDoorWall(wall);
                                                projectDetails.setShowDoorManager(true);
                                            }}
                                            project={projectDetails.project}
                                            selectedRoomPoints={projectDetails.selectedRoomPoints}
                                            onUpdateRoomPoints={projectDetails.updateRoomPointsAndDetectWalls}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                            onManualWallSplit={projectDetails.handleManualWallSplit}
                                            wallSplitError={projectDetails.wallSplitError}
                                            setWallSplitError={projectDetails.setWallSplitError}
                                            wallSplitSuccess={projectDetails.wallSplitSuccess}
                                            ghostWalls={projectDetails.filteredGhostWalls}
                                            ghostAreas={projectDetails.filteredGhostAreas}
                                        />
                                    ) : projectDetails.currentView === 'floor-plan' ? (
                                        <FloorManager
                                            projectId={projectId}
                                            onClose={() => projectDetails.setCurrentView('wall-plan')}
                                            onFloorPlanGenerated={(floorPlan) => {
                                                console.log('Floor plan generated:', floorPlan);
                                            }}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                        />
                                    ) : projectDetails.currentView === 'installation-estimator' ? (
                                        <InstallationTimeEstimator
                                            projectId={projectId}
                                            sharedPanelData={projectDetails.getAllPanelData()}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                            updateCanvasImage={projectDetails.updateCanvasImage}
                                            setCurrentView={projectDetails.setCurrentView}
                                            isCapturingImages={isCapturingImages}
                                            setIsCapturingImages={setIsCapturingImages}
                                            captureSuccess={captureSuccess}
                                            setCaptureSuccess={setCaptureSuccess}
                                        />
                                    ) : (
                                        <CeilingManager
                                            projectId={projectId}
                                            room={projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0 ? projectDetails.filteredRooms[0] : null}
                                            onClose={() => projectDetails.setCurrentView('wall-plan')}
                                            onCeilingPlanGenerated={(ceilingPlan) => {
                                                console.log('Ceiling plan generated:', ceilingPlan);
                                            }}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                            sharedPanelData={projectDetails.sharedPanelData}
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>



            {/* Modals and Overlays */}
            {projectDetails.showStoreyWizard && !projectDetails.isStoreyWizardMinimized && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[11000] p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-xl">
                            <div>
                                <h2 className="text-xl font-semibold text-gray-900">Create New Storey</h2>
                                <p className="text-sm text-gray-500">Step {wizardStep} of 3</p>
                            </div>
                            <button
                                onClick={handleStoreyWizardClose}
                                className="text-gray-500 hover:text-gray-700 transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {wizardStep === 1 && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Storey Name</label>
                                        <input
                                            type="text"
                                            value={projectDetails.storeyWizardName || ''}
                                            onChange={(e) => projectDetails.setStoreyWizardName(e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            placeholder="e.g., First Floor"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Copy Layout From</label>
                                        <select
                                            value={sourceStoreyId ?? ''}
                                            onChange={handleSourceStoreyChange}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        >
                                            <option value="">None (start blank)</option>
                                            {projectDetails.storeys.map((storey) => (
                                                <option key={storey.id} value={storey.id}>
                                                    {storey.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
                                        Elevation and default room height will be calculated automatically after you choose rooms or draw areas in Step 2.
                                    </div>
                                </div>
                            )}

                            {wizardStep === 2 && (
                                <div className="space-y-4">
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
                                        Select the rooms from <span className="font-semibold">{projectDetails.storeys.find(s => String(s.id) === String(sourceStoreyId))?.name || 'the base storey'}</span> that should appear on the new storey, or draw new areas on the canvas. Close the polygon by clicking back on the first point.
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="border border-gray-200 rounded-lg">
                                            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                                                <span className="text-sm font-semibold text-gray-700">Rooms to Copy</span>
                                                <span className="text-xs text-gray-500">{selectedRoomsSet.size} selected</span>
                                            </div>
                                            <div className="max-h-56 overflow-y-auto">
                                                {sourceRooms.length === 0 ? (
                                                    <div className="p-4 text-sm text-gray-500">
                                                        No rooms available on the selected storey.
                                                    </div>
                                                ) : (
                                                    <ul className="divide-y divide-gray-200">
                                                        {sourceRooms.map((room) => (
                                                            <li key={room.id} className="px-4 py-2 flex items-center justify-between text-sm">
                                                                <label className="flex items-center gap-2">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedRoomsSet.has(room.id)}
                                                                        onChange={() => toggleStoreyWizardRoom(room.id)}
                                                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                                    />
                                                                    <span className="text-gray-700">{room.room_name}</span>
                                                                </label>
                                                                <span className="text-xs text-gray-500">
                                                                    {room.floor_type || 'No floor type'}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        </div>

                                        <div className="border border-gray-200 rounded-lg">
                                            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                                                <span className="text-sm font-semibold text-gray-700">Custom Areas</span>
                                                <button
                                                    className="text-sm text-blue-600 hover:text-blue-800"
                                                    onClick={() => {
                                                        projectDetails.setStoreyWizardError('');
                                                        if (projectDetails.is3DView) {
                                                            projectDetails.forceCleanup3D();
                                                            projectDetails.setIs3DView(false);
                                                        }
                                                        if (projectDetails.currentView !== 'wall-plan') {
                                                            projectDetails.setCurrentView('wall-plan');
                                                        }
                                                        projectDetails.beginStoreyAreaSelection();
                                                    }}
                                                    disabled={isDrawingStoreyArea}
                                                >
                                                    {isDrawingStoreyArea ? 'Drawing...' : 'Draw Area'}
                                                </button>
                                            </div>
                                            <div className="max-h-56 overflow-y-auto p-4 space-y-2">
                                                {isDrawingStoreyArea && (
                                                    <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-3 py-2 rounded-lg flex items-center justify-between">
                                                        <span>Click on the canvas to define the area. Close the loop by clicking the starting point.</span>
                                                        <button
                                                            className="text-yellow-700 underline text-xs"
                                                            onClick={projectDetails.cancelStoreyAreaSelection}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                )}
                                                {projectDetails.storeyWizardAreas.length === 0 && !isDrawingStoreyArea && (
                                                    <div className="text-sm text-gray-500">
                                                        No custom areas yet. Use "Draw Area" to outline new space on the canvas.
                                                    </div>
                                                )}
                                                {projectDetails.storeyWizardAreas.map((area, index) => (
                                                    <div key={area.id} className="border border-gray-200 rounded-lg px-3 py-2 flex items-center justify-between text-sm">
                                                        <div>
                                                            <div className="font-medium text-gray-700">Area {index + 1}</div>
                                                            <div className="text-xs text-gray-500">{area.points.length} points</div>
                                                        </div>
                                                        <button
                                                            className="text-xs text-red-600 hover:text-red-800"
                                                            onClick={() => handleRemoveWizardArea(area.id)}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {wizardStep === 3 && (
                                <div className="space-y-4">
                                    <div className="border border-gray-200 rounded-lg p-4">
                                        <h3 className="text-sm font-semibold text-gray-700 mb-2">Storey Details</h3>
                                        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
                                            <div className="flex justify-between">
                                                <dt className="font-medium text-gray-700">Name:</dt>
                                                <dd>{projectDetails.storeyWizardName}</dd>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <dt className="font-medium text-gray-700">Elevation (mm):</dt>
                                                <dd>
                                                    <input
                                                        type="number"
                                                        value={projectDetails.storeyWizardElevation !== null && projectDetails.storeyWizardElevation !== undefined
                                                            ? projectDetails.storeyWizardElevation
                                                            : ''}
                                                        onChange={(e) => {
                                                            const numeric = Number(e.target.value);
                                                            if (!isNaN(numeric)) {
                                                                projectDetails.setStoreyWizardElevation(numeric);
                                                            } else if (e.target.value === '') {
                                                                projectDetails.setStoreyWizardElevation(null);
                                                            }
                                                        }}
                                                        placeholder="Will be calculated after Step 2"
                                                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                    />
                                                </dd>
                                            </div>
                                            <div className="flex justify-between">
                                                <dt className="font-medium text-gray-700">Default Height:</dt>
                                                <dd>
                                                    {projectDetails.storeyWizardDefaultHeight !== null && projectDetails.storeyWizardDefaultHeight !== undefined
                                                        ? `${projectDetails.storeyWizardDefaultHeight} mm`
                                                        : 'Will be calculated after Step 2'}
                                                </dd>
                                            </div>
                                        </dl>
                                    </div>

                                    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                                        <h3 className="text-sm font-semibold text-gray-700 mb-2">Included Rooms</h3>
                                        {selectedRoomsSet.size === 0 ? (
                                            <p className="text-sm text-gray-500">No rooms selected.</p>
                                        ) : (
                                            <>
                                                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                                    {projectDetails.rooms
                                                        .filter(room => selectedRoomsSet.has(room.id))
                                                        .map(room => (
                                                            <li key={room.id}>{room.room_name}</li>
                                                        ))}
                                                </ul>
                                                <div className="space-y-3">
                                                    {projectDetails.rooms
                                                        .filter(room => selectedRoomsSet.has(room.id))
                                                        .map(room => {
                                                            const override = roomOverrides[String(room.id)] || {};
                                                            const originalBase = Number(room.base_elevation_mm) || 0;
                                                            const originalHeight = Number(room.height) || 0;
                                                            const computedBase =
                                                                (override.baseElevation !== undefined && override.baseElevation !== null)
                                                                    ? Number(override.baseElevation) || 0
                                                                    : originalBase + (originalHeight || projectDetails.storeyWizardDefaultHeight || 0);
                                                            const computedHeight =
                                                                (override.height !== undefined && override.height !== null)
                                                                    ? Number(override.height) || 0
                                                                    : originalHeight || projectDetails.storeyWizardDefaultHeight || 0;
                                                            return (
                                                                <div key={`override-${room.id}`} className="border border-gray-200 rounded-lg px-3 py-2">
                                                                    <div className="flex justify-between items-center">
                                                                        <span className="text-sm font-medium text-gray-700">{room.room_name}</span>
                                                                        <span className="text-xs text-gray-500">
                                                                            Ground top: {originalBase + originalHeight} mm
                                                                        </span>
                                                                    </div>
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-600">New Base Elevation (mm)</label>
                                                                            <div className="mt-1 text-sm text-gray-800">{computedBase} mm</div>
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-600">Room Height (mm)</label>
                                                                            <input
                                                                                type="number"
                                                                                value={computedHeight}
                                                                                onChange={(e) => handleRoomHeightOverrideChange(room.id, e.target.value)}
                                                                                className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                                        <h3 className="text-sm font-semibold text-gray-700 mb-2">Custom Areas</h3>
                                        {projectDetails.storeyWizardAreas.length === 0 ? (
                                            <p className="text-sm text-gray-500">No custom areas defined.</p>
                                        ) : (
                                            <div className="space-y-3">
                                                {projectDetails.storeyWizardAreas.map((area, index) => {
                                                    const areaOverride = projectDetails.storeyWizardAreaOverrides?.[area.id] || {};
                                                    const areaHeight = areaOverride.height ?? projectDetails.storeyWizardDefaultHeight ?? 3000;
                                                    return (
                                                        <div key={area.id} className="border border-gray-200 rounded-lg px-3 py-2">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-sm font-medium text-gray-700">Area {index + 1}</span>
                                                                <span className="text-xs text-gray-500">
                                                                    {area.points.length} points
                                                                </span>
                                                            </div>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                                                                <div>
                                                                    <label className="block text-xs font-medium text-gray-600">Base Elevation (mm)</label>
                                                                    <div className="mt-1 text-sm text-gray-800">
                                                                        {projectDetails.storeyWizardElevation !== null && projectDetails.storeyWizardElevation !== undefined
                                                                            ? `${projectDetails.storeyWizardElevation} mm`
                                                                            : 'Will be calculated'}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs font-medium text-gray-600">Room Height (mm)</label>
                                                                    <input
                                                                        type="number"
                                                                        value={areaHeight}
                                                                        onChange={(e) => {
                                                                            const numeric = Number(e.target.value);
                                                                            if (!isNaN(numeric) && numeric > 0) {
                                                                                projectDetails.updateStoreyWizardAreaOverride(area.id, { height: numeric });
                                                                            }
                                                                        }}
                                                                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {projectDetails.storeyWizardError && (
                                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                                    {projectDetails.storeyWizardError}
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                            <button
                                onClick={handleStoreyWizardBack}
                                disabled={wizardStep === 1}
                                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                                    wizardStep === 1
                                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                Back
                            </button>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleStoreyWizardClose}
                                    className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                                >
                                    Cancel
                                </button>
                                {wizardStep < 3 ? (
                                    <button
                                        onClick={handleStoreyWizardNext}
                                        className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
                                    >
                                        Next
                                    </button>
                                ) : (
                                    <button
                                        onClick={projectDetails.completeStoreyWizard}
                                        className="px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700"
                                    >
                                        Create Storey
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {projectDetails.showStoreyWizard && projectDetails.isStoreyWizardMinimized && (
                <div className="fixed bottom-6 right-6 z-[11000] flex flex-col gap-2">
                    <div className="bg-gray-900/90 text-white px-4 py-3 rounded-lg shadow-lg max-w-md">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium">
                                Drawing storey area…
                            </div>
                            <button
                                onClick={() => projectDetails.setStoreyWizardMinimized(false)}
                                className="text-xs text-blue-200 hover:text-white transition-colors"
                            >
                                Restore panel
                            </button>
                        </div>
                        <p className="text-xs text-gray-200 mt-2">
                            Click on the canvas to place points. Close the loop by clicking the first point.
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                            <button
                                onClick={projectDetails.cancelStoreyAreaSelection}
                                className="px-3 py-1.5 rounded-md bg-red-500 text-xs font-medium hover:bg-red-600 transition-colors"
                            >
                                Cancel drawing
                            </button>
                            <button
                                onClick={() => projectDetails.setStoreyWizardMinimized(false)}
                                className="px-3 py-1.5 rounded-md bg-gray-700 text-xs font-medium hover:bg-gray-600 transition-colors"
                            >
                                Resume wizard
                            </button>
                        </div>
                    </div>
                </div>
            )}

                {/* Wall Editor Modal */}
                    {projectDetails.selectedWall !== null && projectDetails.currentMode === 'edit-wall' && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 modal-backdrop">
                    <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4">
                                <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Edit Wall</h3>
                                    <button 
                                        onClick={() => {
                                            projectDetails.setSelectedWall(null);
                                            projectDetails.setCurrentMode(null);
                                        }}
                                className="text-gray-400 hover:text-gray-600 focus-ring"
                                    >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                    </button>
                                </div>
                        {/* Wall editor content */}
                                <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">Start X:</span>
                                                <input
                                                    type="number"
                                                    value={editedWall?.start_x || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, start_x: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">Start Y:</span>
                                                <input
                                                    type="number"
                                                    value={editedWall?.start_y || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, start_y: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">End X:</span>
                                                <input
                                                    type="number"
                                                    value={editedWall?.end_x || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, end_x: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">End Y:</span>
                                                <input
                                                    type="number"
                                                    value={editedWall?.end_y || ''}
                                                    onChange={(e) => setEditedWall({ ...editedWall, end_y: parseFloat(e.target.value) })}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">Wall Height (mm):</span>
                                                <input 
                                                    type="number" 
                                                    value={editedWall?.height || ''} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, height: parseFloat(e.target.value) })} 
                                                    min="10"
                                                    step="10"
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="font-medium text-gray-700">Wall Thickness (mm):</span>
                                                <input 
                                                    type="number" 
                                                    value={editedWall?.thickness || ''} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, thickness: parseFloat(e.target.value) })} 
                                                    min="25"
                                                    step="25"
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                />
                                            </label>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="block">
                                                <span className="font-medium text-gray-700">Wall Type:</span>
                                                <select 
                                                    value={editedWall?.application_type || 'wall'} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, application_type: e.target.value })} 
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                >
                                                    <option value="wall">Wall</option>
                                                    <option value="partition">Partition</option>
                                                </select>
                                            </label>
                                        </div>

                                        {/* Face Finishes */}
                                        <div className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                            <div className="space-y-3">
                                                <label className="block">
                                                    <span className="font-medium text-gray-700">Inner Face Material:</span>
                                                    <select
                                                        value={editedWall?.inner_face_material || 'PPGI'}
                                                        onChange={(e) => setEditedWall({ ...editedWall, inner_face_material: e.target.value })}
                                                        className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                            focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                    >
                                                        <option value="PPGI">PPGI</option>
                                                        <option value="S/Steel">S/Steel</option>
                                                        <option value="PVC">PVC</option>
                                                    </select>
                                                </label>
                                                <label className="block">
                                                    <span className="font-medium text-gray-700">Inner Face Thickness (mm):</span>
                                                    <input
                                                        type="number"
                                                        min="0.1"
                                                        step="0.1"
                                                        value={editedWall?.inner_face_thickness ?? 0.5}
                                                        onChange={(e) => setEditedWall({ ...editedWall, inner_face_thickness: parseFloat(e.target.value) })}
                                                        className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                            focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                    />
                                                </label>
                                            </div>
                                            <div className="space-y-3">
                                                <label className="block">
                                                    <span className="font-medium text-gray-700">Outer Face Material:</span>
                                                    <select
                                                        value={editedWall?.outer_face_material || 'PPGI'}
                                                        onChange={(e) => setEditedWall({ ...editedWall, outer_face_material: e.target.value })}
                                                        className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                            focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                    >
                                                        <option value="PPGI">PPGI</option>
                                                        <option value="S/Steel">S/Steel</option>
                                                        <option value="PVC">PVC</option>
                                                    </select>
                                                </label>
                                                <label className="block">
                                                    <span className="font-medium text-gray-700">Outer Face Thickness (mm):</span>
                                                    <input
                                                        type="number"
                                                        min="0.1"
                                                        step="0.1"
                                                        value={editedWall?.outer_face_thickness ?? 0.5}
                                                        onChange={(e) => setEditedWall({ ...editedWall, outer_face_thickness: parseFloat(e.target.value) })}
                                                        className="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg 
                                                            focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                    />
                                                </label>
                                            </div>
                                        </div>

                                        {/* Gap-Fill Toggle Section */}
                                        <div className="col-span-2 space-y-3 mt-4">
                                            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
                                                <div className="flex-1">
                                                    <h4 className="font-medium text-gray-800 mb-1">Fill Gap Between Rooms</h4>
                                                    <p className="text-sm text-gray-600">
                                                        Fill only the gap between rooms with different heights
                                                    </p>
                                                    {editedWall?.gap_fill_height && (
                                                        <div className="mt-2 text-xs text-blue-700 font-medium">
                                                            Current: {editedWall.gap_fill_height}mm at {editedWall.gap_base_position}mm position
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        const enabled = !editedWall.fill_gap_mode;
                                                        
                                                        try {
                                                            const response = await api.post(
                                                                `/walls/${editedWall.id}/toggle_gap_fill/`,
                                                                { enabled }
                                                            );
                                                            if (response.status === 200) {
                                                                // Update local state
                                                                setEditedWall({ ...editedWall, ...response.data });
                                                                // Refresh walls list
                                                                const wallsResponse = await api.get(`/walls/?project=${projectId}`);
                                                                projectDetails.setWalls(wallsResponse.data);
                                                                // Rebuild 3D scene
                                                                if (projectDetails.threeCanvas) {
                                                                    projectDetails.threeCanvas.buildModel();
                                                                }
                                                            }
                                                        } catch (error) {
                                                            console.error('Error toggling gap-fill mode:', error);
                                                        }
                                                    }}
                                                    className={`ml-4 px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                                                        editedWall?.fill_gap_mode
                                                            ? 'bg-green-600 text-white hover:bg-green-700 shadow-lg'
                                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                    }`}
                                                >
                                                    {editedWall?.fill_gap_mode ? '✓ Enabled' : 'Enable Gap-Fill'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Buttons at the Bottom Right */}
                                    <div className="mt-6 flex justify-end space-x-3">
                                        <button
                                            onClick={async () => {
                                                // 1. Find which endpoints changed
                                                const original = projectDetails.walls.find(w => w.id === projectDetails.selectedWall);
                                                const edited = editedWall;
                                                const changedEndpoints = [];
                                                if (original && edited) {
                                                    if (original.start_x !== edited.start_x || original.start_y !== edited.start_y) {
                                                        changedEndpoints.push({
                                                            which: 'start',
                                                            old: { x: original.start_x, y: original.start_y },
                                                            new: { x: edited.start_x, y: edited.start_y }
                                                        });
                                                    }
                                                    if (original.end_x !== edited.end_x || original.end_y !== edited.end_y) {
                                                        changedEndpoints.push({
                                                            which: 'end',
                                                            old: { x: original.end_x, y: original.end_y },
                                                            new: { x: edited.end_x, y: edited.end_y }
                                                        });
                                                    }
                                                }
                                                // 2. For each changed endpoint, update all other walls sharing that endpoint
                                                const updates = [];
                                                for (const endpoint of changedEndpoints) {
                                                    for (const wall of projectDetails.walls) {
                                                        if (wall.id === edited.id) continue;
                                                        // Check start
                                                        if (Math.abs(endpoint.old.x - wall.start_x) < 0.001 && Math.abs(endpoint.old.y - wall.start_y) < 0.001) {
                                                            const updatedWall = { ...wall, start_x: endpoint.new.x, start_y: endpoint.new.y };
                                                            updates.push(projectDetails.handleWallUpdateNoMerge(updatedWall));
                                                        }
                                                        // Check end
                                                        if (Math.abs(endpoint.old.x - wall.end_x) < 0.001 && Math.abs(endpoint.old.y - wall.end_y) < 0.001) {
                                                            const updatedWall = { ...wall, end_x: endpoint.new.x, end_y: endpoint.new.y };
                                                            updates.push(projectDetails.handleWallUpdateNoMerge(updatedWall));
                                                        }
                                                    }
                                                }
                                                // 3. Update the edited wall itself (skip merge)
                                                await Promise.all([
                                                    ...updates,
                                                    projectDetails.handleWallUpdateNoMerge(edited)
                                                ]);
                                                projectDetails.setSelectedWall(null);
                                                setEditedWall(null);
                                            }}
                                            className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                                        >
                                            Save
                                        </button>
                                        
                                        <button
                                            onClick={() => {
                                                projectDetails.setWallToDelete(projectDetails.selectedWall);
                                                projectDetails.setShowWallDeleteConfirm(true);
                                            }}
                                            className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 
                                                transition-colors"
                                        >
                                            Remove Wall
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}



                {/* Door Manager Modal */}
                {projectDetails.showDoorManager && (
                    <DoorManager
                        projectId={projectId}
                        wall={projectDetails.selectedDoorWall}
                        editingDoor={projectDetails.editingDoor}
                        isEditMode={!!projectDetails.editingDoor}
                        onSaveDoor={projectDetails.handleCreateDoor}
                        onUpdateDoor={projectDetails.handleUpdateDoor}
                        onDeleteDoor={async (doorId) => {
                            await projectDetails.handleDeleteDoor(doorId);
                        }}
                        onClose={() => {
                            projectDetails.setShowDoorManager(false);
                            projectDetails.setEditingDoor(null);
                            projectDetails.setSelectedDoorWall(null);
                        }}
                        activeStoreyId={projectDetails.editingDoor?.storey ?? projectDetails.activeStoreyId}
                        activeStoreyName={
                            projectDetails.editingDoor?.storey
                                ? (projectDetails.storeys.find(s => s.id === projectDetails.editingDoor.storey)?.name || '')
                                : projectDetails.activeStorey?.name
                        }
                    />
                )}

                 {/* Door Editor Modal */}
                {projectDetails.showDoorEditor && projectDetails.editingDoor && (
                    <DoorEditorModal
                        door={projectDetails.editingDoor}
                        wall={projectDetails.walls.find(w => w.id === (projectDetails.editingDoor.linked_wall || projectDetails.editingDoor.wall_id))}
                        onUpdate={projectDetails.handleUpdateDoor}
                        onDelete={async (doorId) => {
                            await projectDetails.handleDeleteDoor(doorId);
                        }}
                        onClose={() => {
                            projectDetails.setShowDoorEditor(false);
                            projectDetails.setEditingDoor(null);
                        }}
                    />
                )}

            {/* Notification Banners */}
            {/* Database Connection Error */}
            {projectDetails.dbConnectionError && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Database connection failed. Please try again later.</span>
                    </div>
                </div>
            )}

            {/* Wall Delete Confirmation */}
            {projectDetails.showWallDeleteConfirm && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-6 py-4 rounded-lg shadow-lg notification">
                    <div className="flex items-center gap-4">
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Are you sure you want to delete this wall?</span>
                        <div className="flex gap-2">
                                                            <button 
                                    onClick={projectDetails.handleConfirmWallDelete} 
                                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium btn-danger"
                                >
                                    Delete
                                </button>
                                <button 
                                    onClick={projectDetails.handleCancelWallDelete} 
                                    className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 transition-colors font-medium btn-secondary"
                                >
                                    Cancel
                                </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Messages */}
            {projectDetails.wallDeleteSuccess && (
                <div className="fixed top-32 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Wall deleted successfully!</span>
                    </div>
                </div>
            )}

            {projectDetails.roomCreateSuccess && (
                <div className="fixed top-40 left-1/2 transform -translate-x-1/2 z-50 bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Room created successfully!</span>
                </div>
                </div>
            )}

            {/* Error Messages */}
            {projectDetails.roomError && (
                <div className="fixed top-48 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">{projectDetails.roomError}</span>
                    </div>
                </div>
            )}

            {projectDetails.projectLoadError && (
                <div className="fixed top-56 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg notification">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{projectDetails.projectLoadError}</span>
                    </div>
                </div>
            )}


        </div>
    );
};

export default ProjectDetails;