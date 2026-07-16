import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import useProjectDetails from './useProjectDetails';
import { useAuth } from '../auth/AuthContext';
import AuthStatusBar from '../../components/AuthStatusBar';
import { getWallSegmentKey } from './projectUtils';
import {
    FOLDER_QUERY_PARAM,
    UNCATEGORIZED_KEY,
    buildHomeFolderPath,
    folderKeyFromQueryValue,
} from './projectFolderUtils';
import Canvas2D from '../canvas/Canvas2D';
import RoomManager from '../room/RoomManager';
import DoorManager from '../door/DoorManager';
import DoorEditorModal from '../door/DoorEditorModal';
import CeilingManager from '../ceiling/CeilingManager';
import FloorManager from '../floor/FloorManager';
import InstallationTimeEstimator from '../estimation/InstallationTimeEstimator';
import ProjectCommentsPanel from './ProjectCommentsPanel';
import { buildRoomLabelLines } from '../room/roomLabelUtils';
import api from '../../api/api';
import ModalOverlay from '../../components/ModalOverlay';

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
    FaLayerGroup,
    FaTimes,
    FaLock,
    FaUnlock,
    FaComment,
    FaStickyNote,
    FaChevronDown,
    FaPlus,
    FaTrash,
    FaUndo,
    FaRedo,
    FaStreetView,
} from 'react-icons/fa';

const ProjectDetails = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { canEdit, canComment, isAuthenticated } = useAuth();
    const projectDetails = useProjectDetails(projectId, { canEdit });
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [controlsSidebarCollapsed, setControlsSidebarCollapsed] = useState(true);
    const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
    const [commentWallSelectMode, setCommentWallSelectMode] = useState(false);
    const [selectedWallsForComment, setSelectedWallsForComment] = useState([]);
    const [activeCommentId, setActiveCommentId] = useState(null);
    const [commentHighlightWallIds, setCommentHighlightWallIds] = useState([]);
    const [unreadCommentCount, setUnreadCommentCount] = useState(0);
    const [planAnnotateMode, setPlanAnnotateMode] = useState(false);
    const [planNoteAddMode, setPlanNoteAddMode] = useState(false);
    const [selectedPlanAnnotationId, setSelectedPlanAnnotationId] = useState(null);
    const [planAnnotationArrowPlacementId, setPlanAnnotationArrowPlacementId] = useState(null);
    const [levelActionsMenuOpen, setLevelActionsMenuOpen] = useState(false);

    const isWallPlanView = projectDetails.currentView === 'wall-plan';
    const undoProjectAction = projectDetails.undoProjectAction;
    const redoProjectAction = projectDetails.redoProjectAction;

    useEffect(() => {
        if (!canEdit) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            const target = event.target;
            const tagName = target?.tagName?.toLowerCase();
            const isEditableTarget =
                tagName === 'input' ||
                tagName === 'textarea' ||
                tagName === 'select' ||
                target?.isContentEditable;

            if (isEditableTarget) {
                return;
            }

            const key = event.key.toLowerCase();
            const isUndo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
            const isRedo =
                (event.ctrlKey || event.metaKey) &&
                (key === 'y' || (key === 'z' && event.shiftKey));

            if (isUndo) {
                event.preventDefault();
                undoProjectAction();
            } else if (isRedo) {
                event.preventDefault();
                redoProjectAction();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canEdit, undoProjectAction, redoProjectAction]);

    const getProjectsListPath = useCallback(() => {
        const folderParam = searchParams.get(FOLDER_QUERY_PARAM);
        if (folderParam !== null) {
            return buildHomeFolderPath(folderKeyFromQueryValue(folderParam, []));
        }
        const projectFolder = projectDetails.project?.folder;
        if (projectFolder != null) {
            return buildHomeFolderPath(projectFolder);
        }
        return buildHomeFolderPath(UNCATEGORIZED_KEY);
    }, [searchParams, projectDetails.project?.folder]);

    useEffect(() => {
        setControlsSidebarCollapsed(true);
        setSidebarOpen(false);
        setCommentsPanelOpen(false);
        setCommentWallSelectMode(false);
        setSelectedWallsForComment([]);
        setActiveCommentId(null);
        setCommentHighlightWallIds([]);
        setUnreadCommentCount(0);
        setPlanAnnotateMode(false);
        setSelectedPlanAnnotationId(null);
        setPlanAnnotationArrowPlacementId(null);
        setLevelActionsMenuOpen(false);
    }, [projectId]);

    useEffect(() => {
        setUnreadCommentCount(projectDetails.project?.unread_comment_count ?? 0);
    }, [projectDetails.project?.unread_comment_count, projectId]);

    const handleCommentsRead = useCallback(() => {
        setUnreadCommentCount(0);
        window.dispatchEvent(new CustomEvent('project-comments-read', {
            detail: { projectId: Number(projectId) },
        }));
    }, [projectId]);

    const handleCommentStatusChanged = useCallback((status) => {
        if (status === 'done') {
            setUnreadCommentCount((count) => Math.max(0, count - 1));
        }
    }, []);

    const handleToggleCommentWallSelectMode = useCallback((enabled) => {
        setCommentWallSelectMode(enabled);
        if (enabled) {
            projectDetails.setCurrentView('wall-plan');
            projectDetails.setIs3DView(false);
        }
    }, [projectDetails]);

    useEffect(() => {
        if (commentWallSelectMode && !isWallPlanView) {
            projectDetails.setCurrentView('wall-plan');
            projectDetails.setIs3DView(false);
        }
    }, [commentWallSelectMode, isWallPlanView, projectDetails]);

    const handleTogglePlanAnnotateMode = useCallback((enabled) => {
        const nextEnabled = typeof enabled === 'boolean' ? enabled : !planAnnotateMode;
        setPlanAnnotateMode(nextEnabled);
        if (nextEnabled) {
            setCommentWallSelectMode(false);
            setPlanNoteAddMode(false);
            projectDetails.setCurrentView('wall-plan');
            projectDetails.setIs3DView(false);
        } else {
            setPlanAnnotationArrowPlacementId(null);
            setPlanNoteAddMode(false);
        }
    }, [planAnnotateMode, projectDetails]);

    useEffect(() => {
        if (planAnnotateMode && !isWallPlanView) {
            projectDetails.setCurrentView('wall-plan');
            projectDetails.setIs3DView(false);
        }
    }, [planAnnotateMode, isWallPlanView, projectDetails]);

    useEffect(() => {
        if (!projectDetails.annotationIdRemap) {
            return;
        }
        const { from, to } = projectDetails.annotationIdRemap;
        setSelectedPlanAnnotationId((prev) => (prev === from ? to : prev));
        setPlanAnnotationArrowPlacementId((prev) => (prev === from ? to : prev));
        projectDetails.clearAnnotationIdRemap();
    }, [projectDetails.annotationIdRemap, projectDetails]);

    const handleSelectComment = useCallback((comment) => {
        if (!comment) {
            setActiveCommentId(null);
            setCommentHighlightWallIds([]);
            return;
        }
        const isSame = activeCommentId === comment.id;
        if (isSame) {
            setActiveCommentId(null);
            setCommentHighlightWallIds([]);
            return;
        }
        setActiveCommentId(comment.id);
        setCommentHighlightWallIds(Array.isArray(comment.wall_ids) ? comment.wall_ids : []);
        if (comment.wall_ids?.length > 0) {
            projectDetails.setCurrentView('wall-plan');
            projectDetails.setIs3DView(false);
            const firstWall = (projectDetails.walls || []).find((wall) => comment.wall_ids.includes(wall.id));
            if (firstWall?.storey != null) {
                projectDetails.setActiveStoreyId(firstWall.storey);
            }
        }
    }, [activeCommentId, projectDetails]);

    const handleClearActiveComment = useCallback(() => {
        setActiveCommentId(null);
        setCommentHighlightWallIds([]);
    }, []);

    const handleDeleteActiveStorey = useCallback(() => {
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
    }, [projectDetails]);

    const handlePlanViewChange = useCallback((view) => {
        if (projectDetails.is3DView) {
            projectDetails.forceCleanup3D();
            projectDetails.setIs3DView(false);
        }
        projectDetails.setCurrentView(view);
    }, [projectDetails]);

    const handleToggle3DView = useCallback(() => {
        if (projectDetails.is3DView) {
            projectDetails.forceCleanup3D();
        }
        projectDetails.setIs3DView(!projectDetails.is3DView);
    }, [projectDetails]);

    const exitEditModeIfActive = useCallback(() => {
        if (!projectDetails.isEditingMode) {
            return;
        }
        projectDetails.setIsEditingMode(false);
        projectDetails.resetAllSelections();
    }, [projectDetails]);

    const handleCollapseControlsSidebar = useCallback(() => {
        setControlsSidebarCollapsed(true);
        exitEditModeIfActive();
    }, [exitEditModeIfActive]);

    const handleCloseControlsSidebar = useCallback(() => {
        setSidebarOpen(false);
        exitEditModeIfActive();
    }, [exitEditModeIfActive]);

    useEffect(() => {
        if (!isWallPlanView && !projectDetails.is3DView) {
            setControlsSidebarCollapsed(true);
            setSidebarOpen(false);
        }
    }, [isWallPlanView, projectDetails.is3DView]);

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
    const activeStoreyWallKeys = new Set(
        (projectDetails.walls || [])
            .filter((wall) => String(wall.storey) === String(projectDetails.activeStoreyId))
            .map((wall) => getWallSegmentKey(wall))
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
    
    // Add this state for the edited wall
    const [editedWall, setEditedWall] = useState(null);
    const [gapFillError, setGapFillError] = useState('');
    const [isLengthLocked, setIsLengthLocked] = useState(false);
    
    // Window management state for walls
    const [wallWindows, setWallWindows] = useState([]);
    const [showWallWindowForm, setShowWallWindowForm] = useState(false);
    const [editingWallWindow, setEditingWallWindow] = useState(null);
    const [wallWindowFormData, setWallWindowFormData] = useState({
        position_x: 0.5,
        position_y: 0.5,
        width: 600,
        height: 800,
        window_type: 'glass'
    });
    
    // Capture canvas images when switching tabs
    const { currentView, filteredRooms, updateCanvasImage, storeys } = projectDetails;
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
            const storey = storeys?.find(s => String(s.id) === String(room.storey));
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
                
                const lines = buildRoomLabelLines(room);
                
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
            
            if (currentView === 'wall-plan') {
                canvas = document.querySelector('canvas[data-plan-type="wall"]');
                planType = 'wall';
            } else if (currentView === 'ceiling-plan') {
                canvas = document.querySelector('canvas[data-plan-type="ceiling"]');
                planType = 'ceiling';
            } else if (currentView === 'floor-plan') {
                canvas = document.querySelector('canvas[data-plan-type="floor"]');
                planType = 'floor';
            }
            
            if (canvas && planType) {
                try {
                    // Remove grid lines before capturing
                    let cleanCanvas = removeGridFromCanvas(canvas);
                    
                    // For wall plan, draw room labels on the canvas
                    if (planType === 'wall' && filteredRooms && filteredRooms.length > 0) {
                        console.log(`🔍 Attempting to draw room labels for ${filteredRooms.length} rooms`);
                        
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
                        console.log(`📋 Rooms with label positions:`, filteredRooms
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
                        drawRoomLabelsOnCanvas(labeledCtx, filteredRooms, scaleFactor, offsetX, offsetY);
                        
                        cleanCanvas = labeledCanvas;
                    } else {
                        console.log(`⚠️ Skipping room labels: planType=${planType}, hasRooms=${!!(filteredRooms && filteredRooms.length > 0)}`);
                    }
                    
                    const imageData = cleanCanvas.toDataURL('image/png', 0.9);
                    console.log(`📸 Captured ${planType} plan image (without grid${planType === 'wall' ? ', with room labels' : ''})`);
                    
                    // Store in shared data - use special method for canvas images
                    updateCanvasImage(planType, imageData);
                } catch (error) {
                    console.warn(`Failed to capture ${planType} plan:`, error);
                }
            }
        };
        
        // Only capture when on a canvas tab
        if (['wall-plan', 'ceiling-plan', 'floor-plan'].includes(currentView)) {
            // Defer capture to keep initial project open/render snappy.
            const timerId = setTimeout(() => {
                captureCanvasImage();
            }, 250);
            return () => clearTimeout(timerId);
        }
    }, [currentView, filteredRooms, updateCanvasImage, storeys]);

    // Memoize the room close handler – closing the tab/panel with "x" wipes all selection
    const handleRoomClose = useCallback(() => {
        projectDetails.resetAllSelections();
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
            setIsLengthLocked(false); // Reset lock when opening modal
        } else if (projectDetails.selectedWallsForEdit.length > 0 && projectDetails.showWallEditor) {
            // For multi-wall editing, use the first wall as a template
            const firstWall = projectDetails.filteredWalls.find(w => w.id === projectDetails.selectedWallsForEdit[0]);
            if (firstWall) {
                setEditedWall({ ...firstWall });
            }
            setIsLengthLocked(false);
        } else {
            setEditedWall(null);
            setIsLengthLocked(false);
        }
    }, [projectDetails.selectedWall, projectDetails.selectedWallsForEdit, projectDetails.showWallEditor, projectDetails.filteredWalls]);
    
    // Load windows when wall changes
    useEffect(() => {
        if (editedWall?.id) {
            loadWallWindows(editedWall.id);
        } else {
            setWallWindows([]);
        }
    }, [editedWall?.id]);
    
    // Load windows for a wall
    const loadWallWindows = async (wallId) => {
        try {
            const response = await api.get(`/wall-windows/?wall=${wallId}`);
            setWallWindows(response.data || []);
        } catch (error) {
            console.error('Error loading wall windows:', error);
            setWallWindows([]);
        }
    };
    
    // Window management functions for walls
    const handleAddWallWindow = () => {
        setEditingWallWindow(null);
        setWallWindowFormData({
            position_x: 0.5,
            position_y: 0.5,
            width: 600,
            height: 800,
            window_type: 'glass'
        });
        setShowWallWindowForm(true);
    };
    
    const handleEditWallWindow = (window) => {
        setEditingWallWindow(window);
        setWallWindowFormData({
            position_x: window.position_x,
            position_y: window.position_y,
            width: window.width,
            height: window.height,
            window_type: window.window_type || 'glass'
        });
        setShowWallWindowForm(true);
    };
    
    const handleSaveWallWindow = async () => {
        if (!editedWall?.id) return;
        
        try {
            if (editingWallWindow) {
                // Update existing window
                await api.put(`/wall-windows/${editingWallWindow.id}/`, {
                    ...wallWindowFormData,
                    wall: editedWall.id
                });
            } else {
                // Create new window
                await api.post('/wall-windows/', {
                    ...wallWindowFormData,
                    wall: editedWall.id
                });
            }
            
            // Reload windows
            await loadWallWindows(editedWall.id);
            setShowWallWindowForm(false);
            setEditingWallWindow(null);
            
            // Refresh walls to get updated window data
            const wallsResponse = await api.get(`/walls/?project=${projectId}`);
            projectDetails.setWalls(wallsResponse.data);
            
            // Rebuild 3D scene
            if (projectDetails.threeCanvas) {
                projectDetails.threeCanvas.buildModel();
            }
        } catch (error) {
            console.error('Error saving wall window:', error);
            alert('Failed to save window: ' + (error.response?.data?.error || error.message));
        }
    };
    
    const handleDeleteWallWindow = async (windowId) => {
        if (!windowId || !editedWall?.id) return;
        
        if (!window.confirm('Are you sure you want to delete this window?')) {
            return;
        }
        
        try {
            await api.delete(`/wall-windows/${windowId}/`);
            await loadWallWindows(editedWall.id);
            
            // Refresh walls
            const wallsResponse = await api.get(`/walls/?project=${projectId}`);
            projectDetails.setWalls(wallsResponse.data);
            
            // Rebuild 3D scene
            if (projectDetails.threeCanvas) {
                projectDetails.threeCanvas.buildModel();
            }
        } catch (error) {
            console.error('Error deleting wall window:', error);
            alert('Failed to delete window: ' + (error.response?.data?.error || error.message));
        }
    };

    useEffect(() => {
        if (projectDetails.is3DView) {
            setSidebarOpen(false);
        }
    }, [projectDetails.is3DView]);

    // Guard: If projectId is missing or invalid, show error and redirect
    if (!projectId || projectId === 'undefined' || projectId === 'null') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-800 mb-4">Invalid Project</h2>
                    <p className="text-gray-600 mb-6">The project ID is missing or invalid.</p>
                    <button
                        onClick={() => navigate(getProjectsListPath())}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Go to Projects
                    </button>
                </div>
            </div>
        );
    }

    const hasRooms = projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0;
    const panelRoomCount = hasRooms
        ? projectDetails.filteredRooms.filter(
            (room) => room.floor_type === 'panel' || room.floor_type === 'Panel'
        ).length
        : 0;

    const renderPlanViewTabs = () => (
        <nav className="plan-view-tabs" aria-label="Plan views">
            <button
                type="button"
                onClick={() => handlePlanViewChange('wall-plan')}
                className={
                    projectDetails.currentView === 'wall-plan'
                        ? 'plan-view-tab-active-blue'
                        : 'plan-view-tab-inactive'
                }
            >
                <FaSquare className="w-3 h-3 mr-1.5" />
                Wall
            </button>
            <button
                type="button"
                onClick={() => handlePlanViewChange('ceiling-plan')}
                disabled={!hasRooms}
                className={
                    !hasRooms
                        ? 'plan-view-tab-disabled'
                        : projectDetails.currentView === 'ceiling-plan'
                        ? 'plan-view-tab-active-green'
                        : 'plan-view-tab-inactive'
                }
            >
                <FaLayerGroup className="w-3 h-3 mr-1.5" />
                Ceiling
            </button>
            <button
                type="button"
                onClick={() => handlePlanViewChange('floor-plan')}
                disabled={!hasRooms}
                title={hasRooms ? `${panelRoomCount} panel room(s)` : 'Add rooms first'}
                className={
                    !hasRooms
                        ? 'plan-view-tab-disabled'
                        : projectDetails.currentView === 'floor-plan'
                        ? 'plan-view-tab-active-green'
                        : 'plan-view-tab-inactive'
                }
            >
                <FaSquare className="w-3 h-3 mr-1.5" />
                Floor
                {hasRooms && panelRoomCount > 0 && (
                    <span className="ml-1 opacity-80">({panelRoomCount})</span>
                )}
            </button>
            <button
                type="button"
                onClick={() => handlePlanViewChange('installation-estimator')}
                className={
                    projectDetails.currentView === 'installation-estimator'
                        ? 'plan-view-tab-active-orange'
                        : 'plan-view-tab-inactive'
                }
            >
                <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="hidden md:inline">Summary &amp; Install Time</span>
                <span className="md:hidden">Summary</span>
            </button>
        </nav>
    );

    return (
        <div className="min-h-screen lg:h-screen lg:max-h-screen flex flex-col overflow-y-auto lg:overflow-hidden bg-gray-50 dark:bg-gray-950 project-details-container transition-colors">
            {/* Wrapper to contain header and content for full-width header */}
            <div className="flex flex-col flex-1 min-h-0 lg:overflow-hidden overflow-visible w-full" style={{ minWidth: 0, maxWidth: '100%' }}>
            {/* Full-Screen Loading Modal for Image Capture */}
            {isCapturingImages && (
                <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
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
                </ModalOverlay>
            )}

            {/* Sticky top chrome: nav, project toolbar, and plan-note banners stay visible while scrolling */}
            <div className="project-details-sticky-chrome sticky top-0 z-50 shrink-0 w-full bg-gray-50 dark:bg-gray-950">
            {/* Navigation Bar */}
            <div className="project-details-nav shrink-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 shadow-sm transition-colors" style={{ width: '100%', minWidth: '100%' }}>
                <div className="w-full px-3 sm:px-4 py-2" style={{ width: '100%' }}>
                    <div className="flex items-center justify-between w-full">
                        <div className="flex items-center space-x-1.5 sm:space-x-2">
                            {!projectDetails.is3DView && isWallPlanView && (
                            <>
                            <button
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                                className="lg:hidden flex items-center px-1.5 py-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                                aria-label="Toggle controls menu"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            </button>
                            {controlsSidebarCollapsed && (
                                <button
                                    onClick={() => setControlsSidebarCollapsed(false)}
                                    className="hidden lg:flex items-center px-2 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
                                >
                                    Show Controls
                                </button>
                            )}
                            </>
                            )}
                            <button
                                onClick={() => navigate(getProjectsListPath())}
                                className="flex items-center px-2 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                            >
                                <FaArrowLeft className="w-3.5 h-3.5 sm:mr-1.5" />
                                <span className="hidden sm:inline">Back to Projects</span>
                            </button>
                            <div className="h-5 w-px bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                            <div className="flex items-center text-sm text-gray-900 dark:text-gray-100">
                                <FaCube className="w-3.5 h-3.5 mr-1.5 text-blue-600 dark:text-blue-400" />
                                <span className="font-medium hidden sm:inline">Project View</span>
                            </div>
                            <div className="h-5 w-px bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                            <button
                                type="button"
                                onClick={handleToggle3DView}
                                className={`flex items-center px-2.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                                    projectDetails.is3DView
                                        ? 'btn-primary'
                                        : 'btn-secondary'
                                }`}
                            >
                                {projectDetails.is3DView ? (
                                    <>
                                        <FaSquare className="mr-1.5 text-xs" />
                                        2D View
                                    </>
                                ) : (
                                    <>
                                        <FaCube className="mr-1.5 text-xs" />
                                        3D View
                                    </>
                                )}
                            </button>
                        </div>
                        
                        <div className="flex items-center space-x-1.5 sm:space-x-2">
                            <AuthStatusBar />
                            <button
                                onClick={() => navigate(getProjectsListPath())}
                                className="flex items-center px-2 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                            >
                                <FaHome className="w-3.5 h-3.5 sm:mr-1.5" />
                                <span className="hidden sm:inline">Projects</span>
                            </button>
                            <div className="h-5 w-px bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                            <button
                                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                                className="flex items-center px-2 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                            >
                                <svg className="w-3.5 h-3.5 sm:mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                </svg>
                                <span className="hidden sm:inline">Top</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {!canEdit && (
                <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2 text-sm text-amber-800">
                    {isAuthenticated ? (
                        'View-only access (Salesman). You can navigate all tabs, view 3D, export, and leave customer feedback comments — but cannot edit walls, rooms, levels, or plans.'
                    ) : (
                        <>
                            View-only mode.{' '}
                            <Link to="/login" className="font-medium underline hover:text-amber-900">Log in</Link>{' '}
                            to edit walls, rooms, levels, and plans.
                        </>
                    )}
                </div>
            )}

            {/* Header Section */}
            <div className="project-details-header shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm transition-colors" style={{ width: '100%', minWidth: '100%' }}>
                <div className="w-full px-3 sm:px-4 lg:px-6 py-2" style={{ width: '100%' }}>
                    <div
                        className={`flex flex-col gap-1.5 w-full min-w-0 lg:grid lg:items-center lg:gap-2 ${
                            projectDetails.is3DView
                                ? 'lg:grid-cols-[minmax(0,1fr)_auto]'
                                : 'lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto]'
                        }`}
                    >
                        <div className="min-w-0">
                    {(!projectDetails.project || !projectDetails.project.name) ? (
                                <h1 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-gray-100">Loading project...</h1>
                            ) : (
                                <h1
                                    className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-gray-100 truncate"
                                    title={projectDetails.project.name}
                                >
                                    {projectDetails.project.name}
                                </h1>
                            )}
                            {projectDetails.project && (
                                <p
                                    className="text-[11px] text-gray-600 dark:text-gray-400 truncate leading-tight"
                                    title={`${projectDetails.project?.width ?? '—'} × ${projectDetails.project?.length ?? '—'} × ${effectiveProjectHeight} mm`}
                                >
                                    {(projectDetails.project?.width ?? '—')} × {(projectDetails.project?.length ?? '—')} × {effectiveProjectHeight} mm
                                </p>
                            )}
                        </div>

                        {!projectDetails.is3DView ? (
                            <div className="min-w-0 lg:col-start-2">
                                {renderPlanViewTabs()}
                            </div>
                        ) : null}
                        
                        {/* Header actions */}
                        <div
                            className={`flex flex-wrap items-center gap-1.5 shrink-0 lg:justify-self-end ${
                                projectDetails.is3DView ? 'lg:col-start-2' : 'lg:col-start-3'
                            }`}
                        >
                            {canEdit && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => projectDetails.undoProjectAction()}
                                        disabled={!projectDetails.canUndoProject}
                                        className="flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition-all duration-200 btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Undo (Ctrl+Z)"
                                    >
                                        <FaUndo className="mr-1.5 text-xs" />
                                        <span className="hidden sm:inline">Undo</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => projectDetails.redoProjectAction()}
                                        disabled={!projectDetails.canRedoProject}
                                        className="flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition-all duration-200 btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Redo (Ctrl+Y)"
                                    >
                                        <FaRedo className="mr-1.5 text-xs" />
                                        <span className="hidden sm:inline">Redo</span>
                                    </button>
                                </>
                            )}
                            {isAuthenticated && (
                                <button
                                    type="button"
                                    onClick={() => setCommentsPanelOpen((open) => !open)}
                                    className={`relative flex items-center px-2.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                                        commentsPanelOpen
                                            ? 'bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-600'
                                            : 'btn-secondary'
                                    }`}
                                >
                                    <FaComment className="mr-1.5 text-xs" />
                                    {canComment ? 'Feedback' : 'Comments'}
                                    {!canComment && unreadCommentCount > 0 && !commentsPanelOpen && (
                                        <span
                                            className="ml-2 min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-green-500 text-white text-[11px] font-semibold"
                                            title={`${unreadCommentCount} unread comment${unreadCommentCount !== 1 ? 's' : ''}`}
                                        >
                                            {unreadCommentCount > 9 ? '9+' : unreadCommentCount}
                                        </span>
                                    )}
                                </button>
                            )}
                            {canEdit && projectDetails.currentView === 'wall-plan' && (
                                <button
                                    type="button"
                                    onClick={() => handleTogglePlanAnnotateMode(!planAnnotateMode)}
                                    className={`flex items-center px-2.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                                        planAnnotateMode
                                            ? 'bg-blue-100 text-blue-900 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-600'
                                            : 'btn-secondary'
                                    }`}
                                >
                                    <FaStickyNote className="mr-1.5 text-xs" />
                                    Plan notes
                                </button>
                            )}
                            {projectDetails.currentView === 'wall-plan' && (
                                <>
                            <div className="h-5 w-px bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
                                <FaLayerGroup className="text-blue-600 dark:text-blue-400 hidden sm:block shrink-0 text-sm" />
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
                                    className="form-control min-w-0 w-full sm:min-w-[112px] sm:w-auto"
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
                                {canEdit && (
                                    <div className="relative shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setLevelActionsMenuOpen((open) => !open)}
                                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs sm:text-sm font-medium border transition-colors whitespace-nowrap ${
                                                projectDetails.isLevelEditMode
                                                    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-600 dark:hover:bg-amber-900/60'
                                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-700'
                                            }`}
                                            title="Level actions"
                                            aria-expanded={levelActionsMenuOpen}
                                            aria-haspopup="menu"
                                        >
                                            <FaCog className="w-3 h-3 shrink-0" />
                                            <span className="hidden sm:inline">Manage</span>
                                            <FaChevronDown className={`w-3 h-3 shrink-0 transition-transform ${levelActionsMenuOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                        {levelActionsMenuOpen && (
                                            <>
                                                <div
                                                    className="fixed inset-0 z-10"
                                                    onClick={() => setLevelActionsMenuOpen(false)}
                                                />
                                                <div
                                                    className="absolute right-0 top-full mt-1 z-20 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg py-1 text-sm text-gray-900 dark:text-gray-100"
                                                    role="menu"
                                                >
                                                    {projectDetails.isLevelEditMode ? (
                                                        <button
                                                            type="button"
                                                            role="menuitem"
                                                            className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 text-amber-700 dark:text-amber-300"
                                                            onClick={() => {
                                                                projectDetails.exitLevelEditMode();
                                                                setLevelActionsMenuOpen(false);
                                                            }}
                                                        >
                                                            <FaTimes className="w-3 h-3 shrink-0" />
                                                            Exit Edit Level
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            role="menuitem"
                                                            className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                                            onClick={() => {
                                                                projectDetails.enterLevelEditMode();
                                                                setLevelActionsMenuOpen(false);
                                                            }}
                                                        >
                                                            <FaEdit className="w-3 h-3 shrink-0" />
                                                            Edit Level
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        role="menuitem"
                                                        className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                                                        onClick={() => {
                                                            projectDetails.openStoreyWizard();
                                                            setLevelActionsMenuOpen(false);
                                                        }}
                                                    >
                                                        <FaPlus className="w-3 h-3 shrink-0" />
                                                        Add Level
                                                    </button>
                                                    <div className="my-1 border-t border-gray-200 dark:border-gray-600" />
                                                    <button
                                                        type="button"
                                                        role="menuitem"
                                                        className="w-full px-3 py-2 text-left hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 text-red-600 dark:text-red-400"
                                                        onClick={() => {
                                                            setLevelActionsMenuOpen(false);
                                                            handleDeleteActiveStorey();
                                                        }}
                                                    >
                                                        <FaTrash className="w-3 h-3 shrink-0" />
                                                        Delete Level
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                                {projectDetails.isStoreyLoading && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">Loading...</span>
                                )}
                                {projectDetails.storeyError && (
                                    <span className="text-xs text-red-500 dark:text-red-400">{projectDetails.storeyError}</span>
                                )}
                            </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            </div>
            
            {canEdit && projectDetails.currentView === 'wall-plan' && projectDetails.isLevelEditMode && (
                <div className="shrink-0 max-h-[min(40vh,320px)] overflow-y-auto overscroll-y-contain border-b border-amber-200/80">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-amber-900">Edit Level Mode</h2>
                                <p className="text-sm text-amber-800">
                                    Select rooms from other levels to copy their wall outlines onto <span className="font-medium">{projectDetails.activeStorey?.name || 'this level'}</span> (walls only, no rooms).
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
                                    No rooms available on other levels to copy walls from.
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
                                                
                                                const sourceWallIds = Array.isArray(room.walls) ? room.walls : [];
                                                const alreadyExists = sourceWallIds.length > 0 && sourceWallIds.every((wallId) => {
                                                    const sourceWall = (projectDetails.walls || []).find(
                                                        (wall) => String(wall.id) === String(wallId)
                                                    );
                                                    return sourceWall && activeStoreyWallKeys.has(getWallSegmentKey(sourceWall));
                                                });
                                                
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
                                                                    Walls already copied to {projectDetails.activeStorey?.name || 'this level'}
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
                </div>
            )}

            {/* Define Room Container - Above Canvas */}
            {canEdit && projectDetails.currentMode === 'define-room' && (
                <div className="shrink-0 w-full bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm transition-colors">
                    {/* Room Definition Header */}
                    <div className="p-4 border-b border-gray-200">
                        <div className="max-w-4xl mx-auto">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">Define Room</h3>
                                    <p className="text-sm text-gray-600 mt-1">
                                        Click on the canvas to place points. Close the loop on the first point, then resume the room form to save.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-sm text-gray-600">
                                        <span className="font-medium">Points:</span> {projectDetails.selectedRoomPoints?.length ?? 0}
                                        {projectDetails.selectedWallsForRoom.length > 0 && (
                                            <span className="ml-3">
                                                <span className="font-medium">Walls:</span> {projectDetails.selectedWallsForRoom.length}
                                            </span>
                                        )}
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
                        </div>
                    </div>

                    {/* Room Creation Interface */}
                    {projectDetails.showRoomManagerModal && !projectDetails.isRoomManagerMinimized && (
                        <ModalOverlay className="bg-black/50 flex items-center justify-center z-[11000] p-3 sm:p-4">
                            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg sm:max-w-xl max-h-[92vh] flex flex-col modal-scroll-panel">
                                <div className="form-modal-header shrink-0 rounded-t-xl">
                                    <div className="flex-1 min-w-0 pr-2">
                                        <h2 className="form-modal-title">
                                            {projectDetails.editingRoom ? 'Edit Room' : 'Create Room'}
                                        </h2>
                                        {!projectDetails.editingRoom && projectDetails.currentMode === 'define-room' && (
                                            <p className="form-modal-subtitle">
                                                Place points on the canvas, then close the loop on the first point.
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => projectDetails.setRoomManagerMinimized(true)}
                                            className="form-icon-btn"
                                            title="Minimize"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (projectDetails.currentMode === 'define-room' && !projectDetails.editingRoom) {
                                                    projectDetails.setRoomManagerMinimized(true);
                                                } else {
                                                    projectDetails.setShowRoomManagerModal(false);
                                                }
                                            }}
                                            className="form-icon-btn"
                                            title={projectDetails.currentMode === 'define-room' && !projectDetails.editingRoom ? 'Minimize' : 'Close'}
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
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
                        </ModalOverlay>
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

            <div className="project-details-workspace flex flex-1 min-h-0 lg:overflow-hidden overflow-visible relative" style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
                {/* Mobile Sidebar Overlay (hidden in 3D: sidebar not used) */}
                {sidebarOpen && !projectDetails.is3DView && isWallPlanView && (
                    <div 
                        className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
                        onClick={handleCloseControlsSidebar}
                    ></div>
                )}
                
                {/* Left Sidebar - wall plan drawing tools only (ceiling/floor use canvas Plan Details) */}
                {!projectDetails.is3DView && isWallPlanView && (
                <div className={`controls-sidebar-scroll fixed lg:static inset-y-0 left-0 z-50 lg:z-auto bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 shadow-sm lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain transition-all duration-300 ease-in-out w-80 min-w-[300px] max-w-[340px] ${
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                } ${controlsSidebarCollapsed ? 'lg:w-0 lg:min-w-0 lg:max-w-0 lg:border-r-0 lg:shadow-none lg:overflow-hidden lg:pointer-events-none' : ''}`}>
                    <div className="p-4 sm:p-6">
                        {/* Mobile Close Button */}
                        <div className="flex items-center justify-between mb-4 lg:hidden">
                            <h2 className="text-lg font-semibold text-gray-900">Controls</h2>
                            <button
                                onClick={handleCloseControlsSidebar}
                                className="text-gray-500 hover:text-gray-700"
                                aria-label="Close controls"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        {/* Desktop header with collapse */}
                        <div className="hidden lg:flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-gray-900">Controls</h2>
                            <button
                                onClick={handleCollapseControlsSidebar}
                                className="px-3 py-1 text-xs sm:text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                            >
                                Collapse
                            </button>
                        </div>
                        {canEdit ? (
                        <>
                        {/* Edit Mode Toggle (sidebar hidden in 3D) */}
                        <div className="mb-6">
                    <button
                        onClick={() => {
                                projectDetails.setIsEditingMode(!projectDetails.isEditingMode);
                                projectDetails.setCurrentMode(null);
                                projectDetails.resetAllSelections();
                        }}
                                className={`w-full flex items-center justify-center px-4 py-3 rounded-lg font-medium transition-all duration-200 ${
                                    projectDetails.isEditingMode 
                                        ? 'btn-danger' 
                                        : 'btn-secondary'
                                }`}
                            >
                                <FaCog className="mr-2" />
                        {projectDetails.isEditingMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                    </button>
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
                                projectDetails.toggleMode('edit-wall');
                                // Reset multi-selection when entering edit mode
                                projectDetails.setSelectedWallsForEdit([]);
                                projectDetails.setIsMultiWallEditMode(false);
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

                                {/* Edit Wall Mode Controls */}
                                {projectDetails.currentMode === 'edit-wall' && (
                                    <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-gray-800 dark:to-gray-800 rounded-lg border border-green-200 dark:border-green-700 shadow-sm space-y-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="block text-xs font-semibold text-green-800 dark:text-green-200 uppercase tracking-wide">Edit Wall Mode</label>
                                            <button
                                                onClick={() => {
                                                    projectDetails.setCurrentMode(null);
                                                    projectDetails.setSelectedWall(null);
                                                    projectDetails.setSelectedWallsForEdit([]);
                                                    projectDetails.setIsMultiWallEditMode(false);
                                                }}
                                                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center gap-2 shadow-sm active:scale-95"
                                                title="Cancel editing"
                                            >
                                                <FaTimes className="text-xs" />
                                                <span>Cancel</span>
                                            </button>
                                        </div>
                                        
                                        {/* Multi-Wall Selection Checkbox */}
                                        <div className="flex items-center space-x-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-600">
                                            <input
                                                type="checkbox"
                                                id="multi-wall-edit"
                                                checked={projectDetails.isMultiWallEditMode}
                                                onChange={(e) => {
                                                    projectDetails.setIsMultiWallEditMode(e.target.checked);
                                                    if (!e.target.checked) {
                                                        projectDetails.setSelectedWallsForEdit([]);
                                                    } else {
                                                        projectDetails.setSelectedWall(null);
                                                    }
                                                }}
                                                className="w-4 h-4 text-green-600 border-gray-300 dark:border-gray-500 rounded focus:ring-green-500 dark:bg-gray-700"
                                            />
                                            <label htmlFor="multi-wall-edit" className="text-sm font-medium text-green-800 dark:text-gray-100 cursor-pointer">
                                                Select Multiple Walls
                                            </label>
                                        </div>

                                        {/* Single Wall Selection Info */}
                                        {!projectDetails.isMultiWallEditMode && (
                                            <div className="text-sm text-green-700 dark:text-gray-200 p-3 bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-600">
                                                <p>Click on a wall on the canvas to select and edit it.</p>
                                            </div>
                                        )}

                                        {/* Multi-Wall Selection Info and Button */}
                                        {projectDetails.isMultiWallEditMode && (
                                            <div className="space-y-3">
                                                <div className="text-sm text-green-700 dark:text-gray-200 p-3 bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-600">
                                                    <p>Click on walls on the canvas to select multiple walls for editing.</p>
                                                    {projectDetails.selectedWallsForEdit.length > 0 && (
                                                        <p className="mt-2 font-medium text-green-900 dark:text-green-100">
                                                            {projectDetails.selectedWallsForEdit.length} wall(s) selected
                                                        </p>
                                                    )}
                                                </div>
                                                
                                                {projectDetails.selectedWallsForEdit.length > 0 && (
                                                    <button
                                                        onClick={() => {
                                                            projectDetails.setShowWallEditor(true);
                                                        }}
                                                        className="w-full px-4 py-3 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium shadow-sm"
                                                    >
                                                        Show Edit Wall Form ({projectDetails.selectedWallsForEdit.length} wall{projectDetails.selectedWallsForEdit.length > 1 ? 's' : ''})
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Wall Type Selection */}
                                {projectDetails.currentMode === 'add-wall' && (
                                    <div className="form-inline-panel max-h-[85vh] overflow-y-auto">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="form-section-title">Add Wall</span>
                                            <button
                                                onClick={() => projectDetails.setCurrentMode(null)}
                                                className="form-btn-danger flex items-center gap-1"
                                                title="Cancel adding wall"
                                            >
                                                <FaTimes className="text-[10px]" />
                                                <span>Cancel</span>
                                            </button>
                                        </div>

                                        <div className="form-grid-narrow">
                                            <div className="form-field">
                                                <label className="form-label">Wall Type</label>
                                                <select
                                                    value={projectDetails.selectedWallType}
                                                    onChange={(e) => projectDetails.setSelectedWallType(e.target.value)}
                                                    className="form-control"
                                                >
                                                    <option value="wall">Wall</option>
                                                    <option value="partition">Partition</option>
                                                </select>
                                            </div>
                                            <div className="form-grid-narrow-pair">
                                                <div className="form-field">
                                                    <label className="form-label">Height (mm)</label>
                                                    <input
                                                        type="number"
                                                        value={projectDetails.wallHeight}
                                                        onChange={(e) => projectDetails.setWallHeight(parseFloat(e.target.value) || 2800)}
                                                        min="100"
                                                        step="100"
                                                        className="form-control"
                                                    />
                                                </div>
                                                <div className="form-field">
                                                    <label className="form-label">Thickness (mm)</label>
                                                    <input
                                                        type="number"
                                                        value={projectDetails.wallThickness}
                                                        onChange={(e) => projectDetails.setWallThickness(parseFloat(e.target.value) || 200)}
                                                        min="25"
                                                        step="25"
                                                        className="form-control"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="pt-2 border-t border-gray-100">
                                            <p className="form-section-title mb-2">Face Finishes</p>
                                            <div className="form-grid-narrow">
                                                <div className="form-subsection">
                                                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Inner</p>
                                                    <div className="form-field">
                                                        <label className="form-label">Material</label>
                                                        <select
                                                            value={projectDetails.innerFaceMaterial}
                                                            onChange={(e) => projectDetails.setInnerFaceMaterial(e.target.value)}
                                                            className="form-control"
                                                        >
                                                            <option value="PPGI">PPGI</option>
                                                            <option value="S/Steel">S/Steel</option>
                                                            <option value="PVC">PVC</option>
                                                        </select>
                                                    </div>
                                                    <div className="form-field">
                                                        <label className="form-label">Thickness (mm)</label>
                                                        <input
                                                            type="number"
                                                            min="0.1"
                                                            step="0.1"
                                                            value={projectDetails.innerFaceThickness}
                                                            onChange={(e) => projectDetails.setInnerFaceThickness(parseFloat(e.target.value) || 0.5)}
                                                            className="form-control"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="form-subsection">
                                                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Outer</p>
                                                    <div className="form-field">
                                                        <label className="form-label">Material</label>
                                                        <select
                                                            value={projectDetails.outerFaceMaterial}
                                                            onChange={(e) => projectDetails.setOuterFaceMaterial(e.target.value)}
                                                            className="form-control"
                                                        >
                                                            <option value="PPGI">PPGI</option>
                                                            <option value="S/Steel">S/Steel</option>
                                                            <option value="PVC">PVC</option>
                                                        </select>
                                                    </div>
                                                    <div className="form-field">
                                                        <label className="form-label">Thickness (mm)</label>
                                                        <input
                                                            type="number"
                                                            min="0.1"
                                                            step="0.1"
                                                            value={projectDetails.outerFaceThickness}
                                                            onChange={(e) => projectDetails.setOuterFaceThickness(parseFloat(e.target.value) || 0.5)}
                                                            className="form-control"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <p className="form-hint pt-2 border-t border-gray-100">
                                            Click on the canvas to start drawing. Click again to finish.
                                        </p>
                                    </div>
                                )}

                                {/* Merge Confirmation */}
                        {projectDetails.currentMode === 'merge-wall' && (
                                    <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-gray-800 dark:to-gray-800 rounded-lg border border-yellow-200 dark:border-amber-700 shadow-sm">
                                        <p className="text-sm text-yellow-800 dark:text-amber-100 mb-3 font-medium">
                                            Select exactly 2 walls to merge
                                        </p>
                            <button
                                onClick={() => {
                                    if (projectDetails.selectedWallsForRoom.length === 2) {
                                    projectDetails.handleManualWallMerge(projectDetails.selectedWallsForRoom);
                                    } else {
                                    projectDetails.setWallMergeError("Please select exactly 2 walls to merge.");
                                    projectDetails.setSelectedWallsForRoom([]);
                                    projectDetails.setSelectedWallsForEdit([]);
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
                                    <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-gray-800 dark:to-gray-800 rounded-lg border border-emerald-200 dark:border-teal-700 shadow-sm space-y-3">
                                        <p className="text-sm text-emerald-800 dark:text-teal-100 font-medium">
                                            Select a wall, then either click along it to split at a snapped point,
                                            or enter an exact distance in the split panel beside the canvas.
                                        </p>
                                        <p className="text-xs text-emerald-700 dark:text-teal-200">
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
                        </>
                        ) : (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                                <p className="font-medium mb-1">View-only mode</p>
                                <p>
                                    {isAuthenticated ? (
                                        'You can explore this project and use 3D/export, but cannot add or edit walls, rooms, doors, or levels.'
                                    ) : (
                                        <>
                                            You can explore this project, but editing tools are disabled.{' '}
                                            <Link to="/login" className="underline hover:text-amber-900">Log in</Link>
                                            {' '}
                                            to add walls, rooms, doors, and levels.
                                        </>
                                    )}
                                </p>
                            </div>
                        )}

                    </div>
                </div>
                )}

                {/* Main Content Area - scrolls independently from edit sidebar */}
                <div className="project-details-main flex-1 flex flex-col min-h-0 min-w-0 lg:overflow-hidden overflow-visible">
                    {/* Canvas Container - scrollable so ceiling/wall/floor content fits at 100% zoom; tighter margins in 3D for more canvas width */}
                    <div className={`bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 canvas-container flex-1 min-h-0 min-w-0 ${
                        projectDetails.is3DView ? 'canvas-container-3d flex flex-col m-2 sm:m-3' : 'canvas-container-2d flex flex-col overflow-hidden m-3 sm:m-6'
                    }`}>
                        {projectDetails.is3DView ? (
                            <div className="three-canvas-view flex flex-col flex-1 min-h-0">
                                {/* Tab Navigation - Same structure as 2D */}
                                <div className="px-3 sm:px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 transition-colors shrink-0">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                                        <div className="flex flex-wrap gap-1">
                                            <button
                                                onClick={projectDetails.handleViewToggle}
                                                className="flex items-center px-2 sm:px-2.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 bg-green-600 text-white hover:bg-green-700 shadow-sm"
                                            >
                                                {projectDetails.isInteriorView ? (
                                                    <>
                                                        <FaEye className="mr-1.5 text-xs" />
                                                        <span className="hidden sm:inline">Switch to Exterior</span>
                                                        <span className="sm:hidden">Exterior</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <FaEyeSlash className="mr-1.5 text-xs" />
                                                        <span className="hidden sm:inline">Switch to Interior</span>
                                                        <span className="sm:hidden">Interior</span>
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={projectDetails.toggleTourMode}
                                                title={projectDetails.isTourMode ? 'Exit tour' : 'Pick a starting point and walk the model'}
                                                className={`flex items-center px-2 sm:px-2.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 shadow-sm ${
                                                    projectDetails.isTourMode
                                                        ? 'bg-violet-600 text-white hover:bg-violet-700'
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 dark:border dark:border-gray-600'
                                                }`}
                                            >
                                                <FaStreetView className="mr-1.5 text-xs" />
                                                <span className="hidden sm:inline">
                                                    {projectDetails.isTourMode ? 'Exit Tour' : 'Tour'}
                                                </span>
                                                <span className="sm:hidden">{projectDetails.isTourMode ? 'Exit' : 'Tour'}</span>
                                            </button>
                                            <button
                                                onClick={projectDetails.togglePanelLines}
                                                className={`flex items-center px-2 sm:px-2.5 py-1.5 rounded-md text-sm font-medium transition-all duration-200 shadow-sm ${
                                                    projectDetails.showPanelLines 
                                                        ? 'bg-blue-600 text-white hover:bg-blue-700' 
                                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 dark:border dark:border-gray-600'
                                                }`}
                                            >
                                                <span className="hidden sm:inline">{projectDetails.showPanelLines ? 'Hide Panel Lines' : 'Show Panel Lines'}</span>
                                                <span className="sm:hidden">{projectDetails.showPanelLines ? 'Hide' : 'Show'}</span>
                                            </button>
                                        </div>
                                        <div className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-400 leading-tight">
                                            <span className="font-medium">View:</span>{' '}
                                            {projectDetails.isTourMode
                                                ? 'Tour'
                                                : projectDetails.isInteriorView
                                                ? 'Interior'
                                                : 'Exterior'}{' '}
                                            •
                                            <span className="ml-1">
                                                {projectDetails.isTourMode
                                                    ? 'Click the floor to set start · Start tour or Enter · Esc cancel'
                                                    : 'Use pinch-to-zoom on mobile'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* 3D Canvas Content — fills remaining height (no page scroll) */}
                                <div className="three-canvas-stage">
                                    <div
                                        id="three-canvas-container"
                                        className="bg-gray-50 dark:bg-gray-800 active overflow-hidden transition-colors"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="canvas-panel flex flex-col flex-1 min-h-0 min-w-0">
                                {(planAnnotateMode || (activeCommentId && !commentWallSelectMode) || commentWallSelectMode) && (
                                    <div className="canvas-panel-banners shrink-0">
                                {planAnnotateMode && (
                                    <div className="plan-annotate-banner border-b border-blue-700/30 dark:border-blue-500/30 shadow-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-blue-600 text-white text-sm">
                                            <span>
                                                {planNoteAddMode
                                                    ? 'Click for a default text box · Drag to draw a custom size'
                                                    : 'Select a note to edit, move, or resize · Click Add to place a new note'}
                                            </span>
                                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                                {canEdit && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPlanNoteAddMode((active) => !active)}
                                                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${
                                                            planNoteAddMode
                                                                ? 'bg-amber-300 text-amber-950 hover:bg-amber-200'
                                                                : 'bg-white/20 hover:bg-white/30'
                                                        }`}
                                                    >
                                                        <FaPlus className="w-3 h-3" />
                                                        {planNoteAddMode ? 'Adding…' : 'Add note'}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => handleTogglePlanAnnotateMode(false)}
                                                    className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 text-xs font-medium"
                                                >
                                                    Done
                                                </button>
                                            </div>
                                        </div>
                                        {projectDetails.filteredPlanAnnotations.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/50 text-sm">
                                                <span className="text-blue-900/70 dark:text-blue-200/70 text-xs font-medium shrink-0">
                                                    Notes ({projectDetails.filteredPlanAnnotations.length}):
                                                </span>
                                                {projectDetails.filteredPlanAnnotations.map((annotation) => {
                                                    const label = (annotation.text || '').trim() || 'Untitled note';
                                                    const isActive = selectedPlanAnnotationId === annotation.id;
                                                    return (
                                                        <button
                                                            key={annotation.id}
                                                            type="button"
                                                            onClick={() => setSelectedPlanAnnotationId(annotation.id)}
                                                            className={`max-w-[200px] truncate px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                                                isActive
                                                                    ? 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-100 dark:border-amber-500'
                                                                    : 'bg-white text-blue-900 border-blue-200 hover:bg-blue-100 dark:bg-gray-800 dark:text-blue-100 dark:border-blue-700 dark:hover:bg-gray-700'
                                                            }`}
                                                            title={label}
                                                        >
                                                            {label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {activeCommentId && !commentWallSelectMode && (
                                    <div className="comment-highlight-banner flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-amber-500 text-white text-sm">
                                        <span>Viewing walls referenced by a comment</span>
                                        <button
                                            type="button"
                                            onClick={handleClearActiveComment}
                                            className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 text-xs font-medium"
                                        >
                                            Clear highlight
                                        </button>
                                    </div>
                                )}
                                {commentWallSelectMode && (
                                    <div className="comment-wall-select-banner flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-green-600 text-white text-sm">
                                        <span>
                                            Click walls on the plan to attach them to your comment.
                                            {selectedWallsForComment.length > 0 && (
                                                <> {selectedWallsForComment.length} wall{selectedWallsForComment.length !== 1 ? 's' : ''} selected.</>
                                            )}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => handleToggleCommentWallSelectMode(false)}
                                            className="px-2 py-1 rounded bg-white/20 hover:bg-white/30 text-xs font-medium"
                                        >
                                            Done selecting
                                        </button>
                                    </div>
                                )}
                                    </div>
                                )}
                                <div className="canvas-panel-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain">
                                <div className="relative">
                                    {projectDetails.currentView === 'wall-plan' ? (
                                        <Canvas2D
                                            walls={projectDetails.filteredWalls}
                                            allWalls={projectDetails.walls}
                                            setWalls={projectDetails.setWalls}
                                            joints={projectDetails.filteredJoints}
                                            intersections={projectDetails.filteredJoints}
                                            projectId={projectId}
                                            onWallTypeSelect={projectDetails.selectedWallType}
                                            wallThickness={projectDetails.wallThickness}
                                            wallHeight={projectDetails.wallHeight}
                                            innerFaceMaterial={projectDetails.innerFaceMaterial}
                                            innerFaceThickness={projectDetails.innerFaceThickness}
                                            outerFaceMaterial={projectDetails.outerFaceMaterial}
                                            outerFaceThickness={projectDetails.outerFaceThickness}
                                            onWallUpdate={projectDetails.handleWallUpdate}
                                            onNewWall={projectDetails.handleAddWallWithSplitting}
                                            onWallDelete={projectDetails.handleWallDelete}
                                            isEditingMode={projectDetails.isEditingMode}
                                            currentMode={projectDetails.currentMode}
                                            setCurrentMode={projectDetails.setCurrentMode}
                                            onWallSelect={projectDetails.handleWallSelect}
                                            isMultiWallEditMode={projectDetails.isMultiWallEditMode}
                                            selectedWallsForEdit={projectDetails.selectedWallsForEdit}
                                            onWallsForEditSelect={projectDetails.setSelectedWallsForEdit}
                                            selectedWallsForRoom={projectDetails.selectedWallsForRoom}
                                            onRoomWallsSelect={projectDetails.setSelectedWallsForRoom}
                                            rooms={projectDetails.filteredRooms}
                                            onRoomSelect={projectDetails.handleRoomSelect}
                                            onRoomUpdate={projectDetails.handleRoomUpdate}
                                            onRoomLabelPositionUpdate={projectDetails.handleRoomLabelPositionUpdate}
                                            onJointsUpdate={projectDetails.setJoints}
                                            doors={projectDetails.filteredDoors}
                                            allDoors={projectDetails.doors}
                                            allRooms={projectDetails.rooms}
                                            onRefreshWalls={projectDetails.refreshWalls}
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
                                            showPanelLines={projectDetails.showPanelLines}
                                            onTogglePanelLines={projectDetails.togglePanelLines}
                                            commentWallSelectMode={commentWallSelectMode}
                                            selectedWallsForComment={selectedWallsForComment}
                                            onCommentWallSelect={setSelectedWallsForComment}
                                            commentHighlightWallIds={commentHighlightWallIds}
                                            canAnnotate={canEdit}
                                            planAnnotateMode={planAnnotateMode}
                                            planNoteAddMode={planNoteAddMode}
                                            onPlanNoteAddModeChange={setPlanNoteAddMode}
                                            planAnnotations={projectDetails.filteredPlanAnnotations}
                                            selectedPlanAnnotationId={selectedPlanAnnotationId}
                                            onSelectPlanAnnotation={setSelectedPlanAnnotationId}
                                            onCreatePlanAnnotation={projectDetails.createPlanAnnotation}
                                            onUpdatePlanAnnotation={projectDetails.updatePlanAnnotation}
                                            onDeletePlanAnnotation={async (annotationId) => {
                                                await projectDetails.deletePlanAnnotation(annotationId);
                                                if (selectedPlanAnnotationId === annotationId) {
                                                    setSelectedPlanAnnotationId(null);
                                                }
                                                if (planAnnotationArrowPlacementId === annotationId) {
                                                    setPlanAnnotationArrowPlacementId(null);
                                                }
                                            }}
                                            planAnnotationArrowPlacementId={planAnnotationArrowPlacementId}
                                            onPlanAnnotationArrowPlacementId={setPlanAnnotationArrowPlacementId}
                                            annotationIdRemap={projectDetails.annotationIdRemap}
                                        />
                                    ) : projectDetails.currentView === 'floor-plan' ? (
                                        <FloorManager
                                            projectId={projectId}
                                            canEdit={canEdit}
                                            onClose={() => {
                                                projectDetails.resetAllSelections();
                                                projectDetails.setCurrentView('wall-plan');
                                            }}
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
                                            activeStoreyId={projectDetails.activeStoreyId}
                                            setActiveStoreyId={projectDetails.setActiveStoreyId}
                                            allWalls={projectDetails.walls}
                                            roomsFromParent={projectDetails.rooms}
                                            wallsFromParent={projectDetails.walls}
                                            doorsFromParent={projectDetails.doors}
                                            storeysFromParent={projectDetails.storeys}
                                            projectDataFromParent={projectDetails.project}
                                        />
                                    ) : (
                                        <CeilingManager
                                            projectId={projectId}
                                            canEdit={canEdit}
                                            room={projectDetails.filteredRooms && projectDetails.filteredRooms.length > 0 ? projectDetails.filteredRooms[0] : null}
                                            onClose={() => {
                                                projectDetails.resetAllSelections();
                                                projectDetails.setCurrentView('wall-plan');
                                            }}
                                            onCeilingPlanGenerated={(ceilingPlan) => {
                                                console.log('Ceiling plan generated:', ceilingPlan);
                                            }}
                                            updateSharedPanelData={projectDetails.updateSharedPanelData}
                                            sharedPanelData={projectDetails.sharedPanelData}
                                        />
                                    )}
                                </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>



            {/* Modals and Overlays */}
            {projectDetails.showStoreyWizard && !projectDetails.isStoreyWizardMinimized && (
                <ModalOverlay className="bg-black bg-opacity-50 flex items-center justify-center z-[11000] p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto modal-scroll-panel">
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
                                            className="form-control"
                                            placeholder="e.g., First Floor"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Copy Layout From</label>
                                        <select
                                            value={sourceStoreyId ?? ''}
                                            onChange={handleSourceStoreyChange}
                                            className="form-control"
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
                                        Select rooms from <span className="font-semibold">{projectDetails.storeys.find(s => String(s.id) === String(sourceStoreyId))?.name || 'the base storey'}</span> to copy their wall outlines to the new level (walls only, no rooms), or draw new areas on the canvas. Close the polygon by clicking back on the first point.
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="border border-gray-200 rounded-lg">
                                            <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                                                <span className="text-sm font-semibold text-gray-700">Rooms to Copy Walls From</span>
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
                                                                        <span className="form-label">{room.room_name}</span>
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
                                                                <span className="form-label">Area {index + 1}</span>
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
                </ModalOverlay>
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
                    {((projectDetails.selectedWall !== null || (projectDetails.selectedWallsForEdit.length > 0 && projectDetails.showWallEditor)) && projectDetails.currentMode === 'edit-wall') && (
                <>
                <ModalOverlay className="bg-black bg-opacity-50 flex justify-center items-center z-50 p-2 sm:p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[95vh] overflow-y-auto modal-scroll-panel">
                                <div className="form-modal-header">
                            <h3 className="form-modal-title">
                                {projectDetails.selectedWallsForEdit.length > 0 
                                    ? `Edit ${projectDetails.selectedWallsForEdit.length} Wall${projectDetails.selectedWallsForEdit.length > 1 ? 's' : ''}`
                                    : 'Edit Wall'}
                            </h3>
                                    <button 
                                        onClick={() => {
                                            projectDetails.setSelectedWall(null);
                                            projectDetails.setSelectedWallsForEdit([]);
                                            projectDetails.setShowWallEditor(false);
                                            projectDetails.setIsMultiWallEditMode(false);
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
                                <div className="form-panel space-y-4">
                                    {/* Multi-wall info */}
                                    {projectDetails.selectedWallsForEdit.length > 0 && (
                                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                            <p className="text-sm text-blue-800">
                                                Editing {projectDetails.selectedWallsForEdit.length} wall{projectDetails.selectedWallsForEdit.length > 1 ? 's' : ''}. 
                                                Changes will be applied to all selected walls.
                                            </p>
                                        </div>
                                    )}
                                    
                                    {/* Position & Dimensions Section - Only show for single wall */}
                                    {projectDetails.selectedWall !== null && (
                                    <div>
                                        <h4 className="form-section-title block mb-2 pb-1 border-b border-gray-200">Position & Dimensions</h4>
                                        <div className="form-grid mt-2">
                                            <div className="space-y-3">
                                                <label className="block">
                                                    <span className="form-label">Start Point</span>
                                                    <div className="grid grid-cols-2 gap-2 mt-1">
                                                        <div>
                                                            <span className="text-xs text-gray-500">X:</span>
                                                            <input
                                                                type="number"
                                                                value={editedWall?.start_x || ''}
                                                                onChange={(e) => {
                                                                    const newStartX = parseFloat(e.target.value);
                                                                    if (isNaN(newStartX) || !editedWall) return;
                                                                    
                                                                    if (isLengthLocked) {
                                                                        // Calculate current direction vector and length
                                                                        const dx = (editedWall.end_x || 0) - (editedWall.start_x || 0);
                                                                        const dy = (editedWall.end_y || 0) - (editedWall.start_y || 0);
                                                                        const length = Math.hypot(dx, dy);
                                                                        
                                                                        if (length === 0) {
                                                                            setEditedWall({ ...editedWall, start_x: newStartX });
                                                                            return;
                                                                        }
                                                                        
                                                                        // Calculate unit direction vector (normalized)
                                                                        const unitX = dx / length;
                                                                        const unitY = dy / length;
                                                                        
                                                                        // Apply the same direction from new start point with locked length
                                                                        const newEndX = newStartX + unitX * length;
                                                                        const newEndY = (editedWall.start_y || 0) + unitY * length;
                                                                        
                                                                        setEditedWall({ 
                                                                            ...editedWall, 
                                                                            start_x: newStartX,
                                                                            end_x: newEndX,
                                                                            end_y: newEndY
                                                                        });
                                                                    } else {
                                                                        setEditedWall({ ...editedWall, start_x: newStartX });
                                                                    }
                                                                }}
                                                                className="form-control mt-1"
                                                            />
                                                        </div>
                                                        <div>
                                                            <span className="text-xs text-gray-500">Y:</span>
                                                            <input
                                                                type="number"
                                                                value={editedWall?.start_y || ''}
                                                                onChange={(e) => {
                                                                    const newStartY = parseFloat(e.target.value);
                                                                    if (isNaN(newStartY) || !editedWall) return;
                                                                    
                                                                    if (isLengthLocked) {
                                                                        // Calculate current direction vector and length
                                                                        const dx = (editedWall.end_x || 0) - (editedWall.start_x || 0);
                                                                        const dy = (editedWall.end_y || 0) - (editedWall.start_y || 0);
                                                                        const length = Math.hypot(dx, dy);
                                                                        
                                                                        if (length === 0) {
                                                                            setEditedWall({ ...editedWall, start_y: newStartY });
                                                                            return;
                                                                        }
                                                                        
                                                                        // Calculate unit direction vector (normalized)
                                                                        const unitX = dx / length;
                                                                        const unitY = dy / length;
                                                                        
                                                                        // Apply the same direction from new start point with locked length
                                                                        const newEndX = (editedWall.start_x || 0) + unitX * length;
                                                                        const newEndY = newStartY + unitY * length;
                                                                        
                                                                        setEditedWall({ 
                                                                            ...editedWall, 
                                                                            start_y: newStartY,
                                                                            end_x: newEndX,
                                                                            end_y: newEndY
                                                                        });
                                                                    } else {
                                                                        setEditedWall({ ...editedWall, start_y: newStartY });
                                                                    }
                                                                }}
                                                                className="form-control mt-1"
                                                            />
                                                        </div>
                                                    </div>
                                                </label>
                                            </div>

                                            <div className="space-y-3">
                                                <label className="block">
                                                    <span className="form-label">End Point</span>
                                                    <div className="grid grid-cols-2 gap-2 mt-1">
                                                        <div>
                                                            <span className="text-xs text-gray-500">X:</span>
                                                            <input
                                                                type="number"
                                                                value={editedWall?.end_x || ''}
                                                                onChange={(e) => {
                                                                    const newEndX = parseFloat(e.target.value);
                                                                    if (isNaN(newEndX) || !editedWall) return;
                                                                    
                                                                    if (isLengthLocked) {
                                                                        // Calculate locked length
                                                                        const dx = (editedWall.end_x || 0) - (editedWall.start_x || 0);
                                                                        const dy = (editedWall.end_y || 0) - (editedWall.start_y || 0);
                                                                        const length = Math.hypot(dx, dy);
                                                                        
                                                                        if (length === 0) {
                                                                            setEditedWall({ ...editedWall, end_x: newEndX });
                                                                            return;
                                                                        }
                                                                        
                                                                        // Calculate new direction from start to new end X
                                                                        const newDx = newEndX - (editedWall.start_x || 0);
                                                                        const newDy = (editedWall.end_y || 0) - (editedWall.start_y || 0);
                                                                        const newLength = Math.hypot(newDx, newDy);
                                                                        
                                                                        if (newLength === 0) {
                                                                            // If new length is 0, keep Y the same
                                                                            setEditedWall({ ...editedWall, end_x: newEndX });
                                                                            return;
                                                                        }
                                                                        
                                                                        // Adjust end Y to maintain locked length
                                                                        // We have: length^2 = newDx^2 + newDy^2
                                                                        // So: newDy = ±sqrt(length^2 - newDx^2)
                                                                        // We'll use the sign of the original dy to maintain direction
                                                                        const sign = dy >= 0 ? 1 : -1;
                                                                        const newDySquared = length * length - newDx * newDx;
                                                                        
                                                                        if (newDySquared < 0) {
                                                                            // Can't maintain length with this X change, just update X
                                                                            setEditedWall({ ...editedWall, end_x: newEndX });
                                                                            return;
                                                                        }
                                                                        
                                                                        const newEndY = (editedWall.start_y || 0) + sign * Math.sqrt(newDySquared);
                                                                        
                                                                        setEditedWall({ 
                                                                            ...editedWall, 
                                                                            end_x: newEndX,
                                                                            end_y: newEndY
                                                                        });
                                                                    } else {
                                                                        setEditedWall({ ...editedWall, end_x: newEndX });
                                                                    }
                                                                }}
                                                                className="form-control mt-1"
                                                            />
                                                        </div>
                                                        <div>
                                                            <span className="text-xs text-gray-500">Y:</span>
                                                            <input
                                                                type="number"
                                                                value={editedWall?.end_y || ''}
                                                                onChange={(e) => {
                                                                    const newEndY = parseFloat(e.target.value);
                                                                    if (isNaN(newEndY) || !editedWall) return;
                                                                    
                                                                    if (isLengthLocked) {
                                                                        // Calculate locked length
                                                                        const dx = (editedWall.end_x || 0) - (editedWall.start_x || 0);
                                                                        const dy = (editedWall.end_y || 0) - (editedWall.start_y || 0);
                                                                        const length = Math.hypot(dx, dy);
                                                                        
                                                                        if (length === 0) {
                                                                            setEditedWall({ ...editedWall, end_y: newEndY });
                                                                            return;
                                                                        }
                                                                        
                                                                        // Calculate new direction from start to new end Y
                                                                        const newDx = (editedWall.end_x || 0) - (editedWall.start_x || 0);
                                                                        const newDy = newEndY - (editedWall.start_y || 0);
                                                                        const newLength = Math.hypot(newDx, newDy);
                                                                        
                                                                        if (newLength === 0) {
                                                                            // If new length is 0, keep X the same
                                                                            setEditedWall({ ...editedWall, end_y: newEndY });
                                                                            return;
                                                                        }
                                                                        
                                                                        // Adjust end X to maintain locked length
                                                                        // We have: length^2 = newDx^2 + newDy^2
                                                                        // So: newDx = ±sqrt(length^2 - newDy^2)
                                                                        // We'll use the sign of the original dx to maintain direction
                                                                        const sign = dx >= 0 ? 1 : -1;
                                                                        const newDxSquared = length * length - newDy * newDy;
                                                                        
                                                                        if (newDxSquared < 0) {
                                                                            // Can't maintain length with this Y change, just update Y
                                                                            setEditedWall({ ...editedWall, end_y: newEndY });
                                                                            return;
                                                                        }
                                                                        
                                                                        const newEndX = (editedWall.start_x || 0) + sign * Math.sqrt(newDxSquared);
                                                                        
                                                                        setEditedWall({ 
                                                                            ...editedWall, 
                                                                            end_x: newEndX,
                                                                            end_y: newEndY
                                                                        });
                                                                    } else {
                                                                        setEditedWall({ ...editedWall, end_y: newEndY });
                                                                    }
                                                                }}
                                                                className="form-control mt-1"
                                                            />
                                                        </div>
                                                    </div>
                                                </label>
                                            </div>

                                            <div className="md:col-span-2">
                                                <label className="block">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="form-label">Wall Length (mm):</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsLengthLocked(!isLengthLocked)}
                                                            className={`p-2 rounded-lg transition-colors ${
                                                                isLengthLocked
                                                                    ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                            }`}
                                                            title={isLengthLocked ? 'Unlock length' : 'Lock length'}
                                                        >
                                                            {isLengthLocked ? (
                                                                <FaLock className="w-4 h-4" />
                                                            ) : (
                                                                <FaUnlock className="w-4 h-4" />
                                                            )}
                                                        </button>
                                                    </div>
                                                    <input 
                                                        type="number" 
                                                        value={editedWall ? Math.round(Math.hypot(
                                                            (editedWall.end_x || 0) - (editedWall.start_x || 0),
                                                            (editedWall.end_y || 0) - (editedWall.start_y || 0)
                                                        ) * 100) / 100 : ''} 
                                                        onChange={(e) => {
                                                            if (isLengthLocked) return; // Ignore changes when locked
                                                            
                                                            const newLength = parseFloat(e.target.value);
                                                            if (isNaN(newLength) || newLength <= 0 || !editedWall) return;
                                                            
                                                            // Calculate current direction vector
                                                            const dx = (editedWall.end_x || 0) - (editedWall.start_x || 0);
                                                            const dy = (editedWall.end_y || 0) - (editedWall.start_y || 0);
                                                            const currentLength = Math.hypot(dx, dy);
                                                            
                                                            if (currentLength === 0) return; // Can't determine direction
                                                            
                                                            // Calculate unit direction vector
                                                            const unitX = dx / currentLength;
                                                            const unitY = dy / currentLength;
                                                            
                                                            // Calculate new end point keeping start point fixed
                                                            const newEndX = (editedWall.start_x || 0) + unitX * newLength;
                                                            const newEndY = (editedWall.start_y || 0) + unitY * newLength;
                                                            
                                                            setEditedWall({ 
                                                                ...editedWall, 
                                                                end_x: newEndX,
                                                                end_y: newEndY
                                                            });
                                                        }}
                                                        min="0"
                                                        step="1"
                                                        disabled={isLengthLocked}
                                                        className={`form-control mt-1 ${isLengthLocked ? 'bg-gray-100 cursor-not-allowed opacity-60' : ''}`}
                                                    />
                                                    {isLengthLocked && (
                                                        <p className="mt-1 text-xs text-blue-600">
                                                            Length is locked. Changing start/end coordinates will adjust the other point to maintain this length.
                                                        </p>
                                                    )}
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                    )}

                                    {/* Wall Properties Section */}
                                    <div>
                                        <h4 className="form-section-title block mb-2 pb-1 border-b border-gray-200">Wall Properties</h4>
                                        <div className="form-grid mt-2">
                                            <label className="block">
                                                <span className="form-label">Wall Height (mm):</span>
                                                <input 
                                                    type="number" 
                                                    value={editedWall?.height || ''} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, height: parseFloat(e.target.value) })} 
                                                    min="10"
                                                    step="10"
                                                    className="form-control mt-1"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="form-label">Wall Base Elevation (mm):</span>
                                                <input 
                                                    type="number" 
                                                    value={editedWall?.base_elevation_mm ?? 0} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, base_elevation_mm: parseFloat(e.target.value) || 0 })} 
                                                    step="10"
                                                    className="form-control mt-1"
                                                    placeholder="0"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="form-label">Wall Thickness (mm):</span>
                                                <input 
                                                    type="number" 
                                                    value={editedWall?.thickness || ''} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, thickness: parseFloat(e.target.value) })} 
                                                    min="25"
                                                    step="25"
                                                    className="form-control mt-1"
                                                />
                                            </label>

                                            <label className="block">
                                                <span className="form-label">Wall Type:</span>
                                                <select 
                                                    value={editedWall?.application_type || 'wall'} 
                                                    onChange={(e) => setEditedWall({ ...editedWall, application_type: e.target.value })} 
                                                    className="form-control mt-1"
                                                >
                                                    <option value="wall">Wall</option>
                                                    <option value="partition">Partition</option>
                                                </select>
                                            </label>
                                        </div>
                                    </div>

                                    {/* Face Finishes Section */}
                                    <div>
                                        <h4 className="form-section-title block mb-2 pb-1 border-b border-gray-200">Face Finishes</h4>
                                        <div className="form-grid mt-2">
                                            <div className="form-subsection">
                                                <h5 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Inner Face</h5>
                                                <label className="block">
                                                    <span className="form-label">Material:</span>
                                                    <select
                                                        value={editedWall?.inner_face_material || 'PPGI'}
                                                        onChange={(e) => setEditedWall({ ...editedWall, inner_face_material: e.target.value })}
                                                        className="form-control mt-1"
                                                    >
                                                        <option value="PPGI">PPGI</option>
                                                        <option value="S/Steel">S/Steel</option>
                                                        <option value="PVC">PVC</option>
                                                    </select>
                                                </label>
                                                <label className="block">
                                                    <span className="form-label">Thickness (mm):</span>
                                                    <input
                                                        type="number"
                                                        min="0.1"
                                                        step="0.1"
                                                        value={editedWall?.inner_face_thickness ?? 0.5}
                                                        onChange={(e) => setEditedWall({ ...editedWall, inner_face_thickness: parseFloat(e.target.value) })}
                                                        className="form-control mt-1"
                                                    />
                                                </label>
                                            </div>
                                            <div className="form-subsection">
                                                <h5 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Outer Face</h5>
                                                <label className="block">
                                                    <span className="form-label">Material:</span>
                                                    <select
                                                        value={editedWall?.outer_face_material || 'PPGI'}
                                                        onChange={(e) => setEditedWall({ ...editedWall, outer_face_material: e.target.value })}
                                                        className="form-control mt-1"
                                                    >
                                                        <option value="PPGI">PPGI</option>
                                                        <option value="S/Steel">S/Steel</option>
                                                        <option value="PVC">PVC</option>
                                                    </select>
                                                </label>
                                                <label className="block">
                                                    <span className="form-label">Thickness (mm):</span>
                                                    <input
                                                        type="number"
                                                        min="0.1"
                                                        step="0.1"
                                                        value={editedWall?.outer_face_thickness ?? 0.5}
                                                        onChange={(e) => setEditedWall({ ...editedWall, outer_face_thickness: parseFloat(e.target.value) })}
                                                        className="form-control mt-1"
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Gap-Fill Toggle Section - Only show for single wall */}
                                    {projectDetails.selectedWall !== null && (
                                    <div>
                                        <h4 className="form-section-title block mb-2 pb-1 border-b border-gray-200">Advanced Options</h4>
                                        <div className="mt-3">
                                            <div className="form-toggle-row">
                                                <div className="flex-1 min-w-0">
                                                    <h5 className="text-xs font-medium text-gray-800">Fill Gap Between Rooms</h5>
                                                    <p className="form-hint">
                                                        Fill only the gap between rooms with different heights
                                                    </p>
                                                    {editedWall?.gap_fill_height && (
                                                        <div className="mt-2 text-xs text-blue-700 font-medium">
                                                            Current: {editedWall.gap_fill_height}mm at {editedWall.gap_base_position}mm position
                                                        </div>
                                                    )}
                                                    {gapFillError && (
                                                        <div className="mt-2 text-xs text-red-600 font-medium">
                                                            {gapFillError}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        const enabled = !editedWall.fill_gap_mode;
                                                        setGapFillError('');

                                                        try {
                                                            const response = await api.post(
                                                                `/walls/${editedWall.id}/toggle_gap_fill/`,
                                                                { enabled }
                                                            );
                                                            if (response.status === 200) {
                                                                setEditedWall({ ...editedWall, ...response.data });
                                                                const wallsResponse = await api.get(`/walls/?project=${projectId}`);
                                                                projectDetails.setWalls(wallsResponse.data);
                                                                if (projectDetails.threeCanvas) {
                                                                    projectDetails.threeCanvas.buildModel();
                                                                }
                                                            }
                                                        } catch (error) {
                                                            const message = error.response?.data?.error
                                                                || 'Failed to toggle gap-fill mode.';
                                                            setGapFillError(message);
                                                            console.error('Error toggling gap-fill mode:', error);
                                                        }
                                                    }}
                                                    className={`shrink-0 form-btn ${
                                                        editedWall?.fill_gap_mode
                                                            ? 'bg-green-600 text-white hover:bg-green-700'
                                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                                    }`}
                                                >
                                                    {editedWall?.fill_gap_mode ? '✓ Enabled' : 'Enable Gap-Fill'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    )}
                                    
                                    {/* Windows Section - Only show for single wall */}
                                    {projectDetails.selectedWall !== null && (
                                    <div>
                                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                                            <h4 className="text-sm font-semibold text-gray-700">Windows on Wall</h4>
                                            <button
                                                onClick={handleAddWallWindow}
                                                disabled={!editedWall?.id}
                                                className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
                                                    editedWall?.id
                                                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                }`}
                                                title={!editedWall?.id ? 'Save the wall first to add windows' : ''}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                </svg>
                                                Add Window
                                            </button>
                                        </div>
                                        
                                        {!editedWall?.id ? (
                                            <p className="text-sm text-gray-500 italic mt-2">Save the wall first to add windows.</p>
                                        ) : wallWindows.length === 0 ? (
                                            <p className="text-sm text-gray-500 italic mt-2">No windows added yet. Click "Add Window" to add one.</p>
                                        ) : (
                                            <div className="space-y-2 mt-3">
                                                {wallWindows.map((window) => (
                                                    <div key={window.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="form-label">
                                                                    {window.window_type || 'glass'} window
                                                                </span>
                                                                <span className="text-xs text-gray-500">
                                                                    {window.width}mm × {window.height}mm
                                                                </span>
                                                            </div>
                                                            <div className="text-xs text-gray-500 mt-1">
                                                                Position: {Math.round(window.position_x * 100)}% along wall, {Math.round(window.position_y * 100)}% height
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleEditWallWindow(window)}
                                                                className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                                                            >
                                                                Edit
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteWallWindow(window.id)}
                                                                className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                                                            >
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    )}

                                    {/* Action Buttons: delete left, save right */}
                                    <div className={`form-actions px-4 pb-4${projectDetails.selectedWall !== null ? ' !justify-between' : ''}`}>
                                        {projectDetails.selectedWall !== null && (
                                        <button
                                            onClick={() => {
                                                projectDetails.setWallToDelete(projectDetails.selectedWall);
                                                projectDetails.setShowWallDeleteConfirm(true);
                                            }}
                                            className="form-btn-danger w-full sm:w-auto 
                                                transition-colors text-sm font-medium"
                                        >
                                            Remove Wall
                                        </button>
                                        )}
                                        <button
                                            onClick={async () => {
                                                if (projectDetails.selectedWallsForEdit.length > 0) {
                                                    // Multi-wall editing: apply changes to all selected walls
                                                    const updates = [];
                                                    const propertiesToUpdate = {
                                                        height: editedWall?.height,
                                                        thickness: editedWall?.thickness,
                                                        application_type: editedWall?.application_type,
                                                        inner_face_material: editedWall?.inner_face_material,
                                                        inner_face_thickness: editedWall?.inner_face_thickness,
                                                        outer_face_material: editedWall?.outer_face_material,
                                                        outer_face_thickness: editedWall?.outer_face_thickness,
                                                        base_elevation_mm: editedWall?.base_elevation_mm,
                                                        base_elevation_manual: editedWall?.base_elevation_manual
                                                    };
                                                    
                                                    for (const wallId of projectDetails.selectedWallsForEdit) {
                                                        const wall = projectDetails.walls.find(w => w.id === wallId);
                                                        if (wall) {
                                                            const updatedWall = { ...wall, ...propertiesToUpdate };
                                                            updates.push(projectDetails.handleWallUpdateNoMerge(updatedWall));
                                                        }
                                                    }
                                                    
                                                    await Promise.all(updates);
                                                    projectDetails.setSelectedWallsForEdit([]);
                                                    projectDetails.setShowWallEditor(false);
                                                    setEditedWall(null);
                                                } else {
                                                    // Single wall editing: original logic
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
                                                }
                                            }}
                                            className="form-btn-primary w-full sm:w-auto"
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>
                    </div>
                </ModalOverlay>
                    
                                {/* Window Form Modal */}
                                {showWallWindowForm && (
                                    <ModalOverlay className="bg-black bg-opacity-50 flex justify-center items-center z-[60]">
                                        <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto modal-scroll-panel">
                                            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
                                                <h3 className="text-lg font-semibold text-gray-900">
                                                    {editingWallWindow ? 'Edit Window' : 'Add Window'}
                                                </h3>
                                                <button
                                                    onClick={() => {
                                                        setShowWallWindowForm(false);
                                                        setEditingWallWindow(null);
                                                    }}
                                                    className="text-gray-400 hover:text-gray-600"
                                                >
                                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                            
                                            <div className="p-6 space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Window Type</label>
                                                    <select
                                                        value={wallWindowFormData.window_type}
                                                        onChange={(e) => setWallWindowFormData({ ...wallWindowFormData, window_type: e.target.value })}
                                                        className="form-control"
                                                    >
                                                        <option value="glass">Glass</option>
                                                    </select>
                                                </div>
                                                
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Width (mm)</label>
                                                        <input
                                                            type="number"
                                                            value={wallWindowFormData.width}
                                                            onChange={(e) => setWallWindowFormData({ ...wallWindowFormData, width: parseFloat(e.target.value) || 0 })}
                                                            min="100"
                                                            step="50"
                                                            className="form-control"
                                                        />
                                                    </div>
                                                    
                                                    <div>
                                                        <label className="block text-sm font-medium text-gray-700 mb-1">Height (mm)</label>
                                                        <input
                                                            type="number"
                                                            value={wallWindowFormData.height}
                                                            onChange={(e) => setWallWindowFormData({ ...wallWindowFormData, height: parseFloat(e.target.value) || 0 })}
                                                            min="100"
                                                            step="50"
                                                            className="form-control"
                                                        />
                                                    </div>
                                                </div>
                                                
                                                {/* Position Along Wall */}
                                                <div>
                                                    <h4 className="form-section-title block mb-2 pb-1 border-b border-gray-200">Position Along Wall</h4>
                                                    <div className="mt-3 space-y-4">
                                                        <div>
                                                            <label className="text-sm font-medium text-gray-700 mb-2 block">Position Slider</label>
                                                            <input
                                                                type="range"
                                                                min="0"
                                                                max="1"
                                                                step="0.01"
                                                                value={wallWindowFormData.position_x}
                                                                onChange={(e) => setWallWindowFormData({ ...wallWindowFormData, position_x: parseFloat(e.target.value) })}
                                                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                                            />
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            <div>
                                                                <label className="form-label">Distance from Left (mm)</label>
                                                                <input
                                                                    type="number"
                                                                    value={Math.round((wallWindowFormData.position_x || 0) * (editedWall ? Math.hypot((editedWall.end_x || 0) - (editedWall.start_x || 0), (editedWall.end_y || 0) - (editedWall.start_y || 0)) : 0)) || 0}
                                                                    onChange={(e) => {
                                                                        const wallLength = editedWall ? Math.hypot((editedWall.end_x || 0) - (editedWall.start_x || 0), (editedWall.end_y || 0) - (editedWall.start_y || 0)) : 0;
                                                                        const distance = Math.max(0, Math.min(wallLength, Number(e.target.value) || 0));
                                                                        const newPos = wallLength > 0 ? distance / wallLength : 0;
                                                                        setWallWindowFormData({ ...wallWindowFormData, position_x: Number.isFinite(newPos) ? newPos : 0 });
                                                                    }}
                                                                    min="0"
                                                                    max={editedWall ? Math.round(Math.hypot((editedWall.end_x || 0) - (editedWall.start_x || 0), (editedWall.end_y || 0) - (editedWall.start_y || 0))) : 0}
                                                                    step="1"
                                                                    className="form-control mt-1"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="form-label">Distance from Right (mm)</label>
                                                                <input
                                                                    type="number"
                                                                    value={Math.round((1 - (wallWindowFormData.position_x || 0)) * (editedWall ? Math.hypot((editedWall.end_x || 0) - (editedWall.start_x || 0), (editedWall.end_y || 0) - (editedWall.start_y || 0)) : 0)) || 0}
                                                                    onChange={(e) => {
                                                                        const wallLength = editedWall ? Math.hypot((editedWall.end_x || 0) - (editedWall.start_x || 0), (editedWall.end_y || 0) - (editedWall.start_y || 0)) : 0;
                                                                        const distance = Math.max(0, Math.min(wallLength, Number(e.target.value) || 0));
                                                                        const left = Math.max(0, wallLength - distance);
                                                                        const newPos = wallLength > 0 ? left / wallLength : 0;
                                                                        setWallWindowFormData({ ...wallWindowFormData, position_x: Number.isFinite(newPos) ? newPos : 0 });
                                                                    }}
                                                                    min="0"
                                                                    max={editedWall ? Math.round(Math.hypot((editedWall.end_x || 0) - (editedWall.start_x || 0), (editedWall.end_y || 0) - (editedWall.start_y || 0))) : 0}
                                                                    step="1"
                                                                    className="form-control mt-1"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* Position Height */}
                                                <div>
                                                    <h4 className="form-section-title block mb-2 pb-1 border-b border-gray-200">Position Height</h4>
                                                    <div className="mt-3 space-y-4">
                                                        <div>
                                                            <label className="text-sm font-medium text-gray-700 mb-2 block">Position Slider</label>
                                                            <input
                                                                type="range"
                                                                min="0"
                                                                max="1"
                                                                step="0.01"
                                                                value={wallWindowFormData.position_y}
                                                                onChange={(e) => setWallWindowFormData({ ...wallWindowFormData, position_y: parseFloat(e.target.value) })}
                                                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                                            />
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            <div>
                                                                <label className="form-label">Distance from Bottom (mm)</label>
                                                                <input
                                                                    type="number"
                                                                    value={Math.round((wallWindowFormData.position_y || 0) * (editedWall?.height || 0)) || 0}
                                                                    onChange={(e) => {
                                                                        const wallHeight = editedWall?.height || 0;
                                                                        const distance = Math.max(0, Math.min(wallHeight, Number(e.target.value) || 0));
                                                                        const newPos = wallHeight > 0 ? distance / wallHeight : 0;
                                                                        setWallWindowFormData({ ...wallWindowFormData, position_y: Number.isFinite(newPos) ? newPos : 0 });
                                                                    }}
                                                                    min="0"
                                                                    max={Math.round(editedWall?.height || 0)}
                                                                    step="1"
                                                                    className="form-control mt-1"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="form-label">Distance from Top (mm)</label>
                                                                <input
                                                                    type="number"
                                                                    value={Math.round((1 - (wallWindowFormData.position_y || 0)) * (editedWall?.height || 0)) || 0}
                                                                    onChange={(e) => {
                                                                        const wallHeight = editedWall?.height || 0;
                                                                        const distance = Math.max(0, Math.min(wallHeight, Number(e.target.value) || 0));
                                                                        const bottom = Math.max(0, wallHeight - distance);
                                                                        const newPos = wallHeight > 0 ? bottom / wallHeight : 0;
                                                                        setWallWindowFormData({ ...wallWindowFormData, position_y: Number.isFinite(newPos) ? newPos : 0 });
                                                                    }}
                                                                    min="0"
                                                                    max={Math.round(editedWall?.height || 0)}
                                                                    step="1"
                                                                    className="form-control mt-1"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
                                                <button
                                                    onClick={() => {
                                                        setShowWallWindowForm(false);
                                                        setEditingWallWindow(null);
                                                    }}
                                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={handleSaveWallWindow}
                                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        </div>
                                    </ModalOverlay>
                                )}
                    </>
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
                            projectDetails.resetAllSelections();
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
                <div className="notification-banner-error top-4 px-4 py-3">
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
                <div className="notification-banner-warning top-20 px-6 py-4">
                    <div className="flex items-center gap-4">
                        <svg className="w-6 h-6 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">Are you sure you want to delete this wall?</span>
                        <div className="flex gap-2 shrink-0">
                            <button
                                onClick={projectDetails.handleConfirmWallDelete}
                                className="form-btn-danger px-4 py-2 text-sm"
                            >
                                Delete
                            </button>
                            <button
                                onClick={projectDetails.handleCancelWallDelete}
                                className="form-btn-secondary px-4 py-2 text-sm"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success Messages */}
            {projectDetails.wallDeleteSuccess && (
                <div className="notification-banner-success top-32 px-4 py-3">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3-9a1 1 0 10-2 0 1 1 0 002 0zm-1-4a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Wall deleted successfully!</span>
                    </div>
                </div>
            )}

            {projectDetails.roomCreateSuccess && (
                <div className="notification-banner-success top-40 px-4 py-3">
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
                <div className="notification-banner-error top-48 px-4 py-3">
                    <div className="flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">{projectDetails.roomError}</span>
                    </div>
                </div>
            )}

            {projectDetails.projectLoadError && (
                <div className="notification-banner-error top-56 px-4 py-3">
                    <div className="flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="font-medium">{projectDetails.projectLoadError}</span>
                    </div>
                </div>
            )}

            <ProjectCommentsPanel
                projectId={projectId}
                isOpen={commentsPanelOpen}
                onClose={() => {
                    setCommentsPanelOpen(false);
                    setCommentWallSelectMode(false);
                    setSelectedWallsForComment([]);
                    setActiveCommentId(null);
                    setCommentHighlightWallIds([]);
                }}
                canComment={canComment}
                canEdit={canEdit}
                isAuthenticated={isAuthenticated}
                commentWallSelectMode={commentWallSelectMode}
                onToggleWallSelectMode={handleToggleCommentWallSelectMode}
                selectedWallsForComment={selectedWallsForComment}
                onClearSelectedWalls={() => setSelectedWallsForComment([])}
                activeCommentId={activeCommentId}
                onSelectComment={handleSelectComment}
                onClearActiveComment={handleClearActiveComment}
                onCommentsRead={handleCommentsRead}
                onCommentStatusChanged={handleCommentStatusChanged}
                highlightedWallCount={commentHighlightWallIds.length}
            />

            </div>
        </div>
    );
};

export default ProjectDetails;