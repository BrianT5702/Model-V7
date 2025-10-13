from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Project, Wall, Room, CeilingPanel, CeilingPlan, FloorPanel, FloorPlan, Door, Intersection
from .serializers import (
    ProjectSerializer, WallSerializer, RoomSerializer,
    CeilingPanelSerializer, CeilingPlanSerializer, FloorPanelSerializer, FloorPlanSerializer,
    DoorSerializer, IntersectionSerializer
)
from .services import WallService, RoomService, DoorService, CeilingService, FloorService, normalize_wall_coordinates


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = serializer.save()

        # Create default walls using the service
        WallService.create_default_walls(project)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def walls(self, request, pk=None):
        """Retrieve walls associated with a specific project"""
        try:
            project = Project.objects.get(pk=pk)
            walls = Wall.objects.filter(project=project)
            serializer = WallSerializer(walls, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)

class WallViewSet(viewsets.ModelViewSet):
    queryset = Wall.objects.all()
    serializer_class = WallSerializer

    def get_queryset(self):
        """Optionally filter walls by project ID"""
        project_id = self.request.query_params.get('project')
        if project_id:
            return Wall.objects.filter(project_id=project_id)
        return super().get_queryset()

    def create(self, request, *args, **kwargs):
        """Create a new wall with normalized coordinates"""
        # Normalize wall coordinates before validation
        data = request.data.copy()
        if 'start_x' in data and 'start_y' in data and 'end_x' in data and 'end_y' in data:
            norm_start_x, norm_start_y, norm_end_x, norm_end_y = normalize_wall_coordinates(
                data['start_x'], data['start_y'], data['end_x'], data['end_y']
            )
            data['start_x'] = norm_start_x
            data['start_y'] = norm_start_y
            data['end_x'] = norm_end_x
            data['end_y'] = norm_end_y

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        """Update wall properties"""
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        # After updating a wall, recalculate room boundaries for all rooms that contain this wall
        from .services import RoomService
        rooms_with_wall = instance.rooms.all()
        for room in rooms_with_wall:
            RoomService.recalculate_room_boundary_from_walls(room.id)
        
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def create_wall(self, request):
        """Create a new wall"""
        project_id = request.data.get('project')
        if not project_id:
            return Response({'error': 'Project ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            project = Project.objects.get(pk=project_id)
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)

        # Normalize wall coordinates before validation
        data = request.data.copy()
        if 'start_x' in data and 'start_y' in data and 'end_x' in data and 'end_y' in data:
            norm_start_x, norm_start_y, norm_end_x, norm_end_y = normalize_wall_coordinates(
                data['start_x'], data['start_y'], data['end_x'], data['end_y']
            )
            data['start_x'] = norm_start_x
            data['start_y'] = norm_start_y
            data['end_x'] = norm_end_x
            data['end_y'] = norm_end_y

        serializer = self.get_serializer(data=data)
        if serializer.is_valid():
            wall = serializer.save(project=project)
            return Response(WallSerializer(wall).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def split_wall(self, request):
        """Split a wall at a specific intersection point"""
        wall_id = request.data.get('wall_id')
        intersection_x = request.data.get('intersection_x')
        intersection_y = request.data.get('intersection_y')

        if not all([wall_id, intersection_x, intersection_y]):
            return Response(
                {'error': 'wall_id, intersection_x, and intersection_y are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            split_wall_1, split_wall_2 = WallService.split_wall(wall_id, intersection_x, intersection_y)
            
            # After splitting a wall, recalculate room boundaries for all rooms that contained the original wall
            from .services import RoomService
            original_wall = Wall.objects.get(pk=wall_id)
            rooms_with_wall = original_wall.rooms.all()
            for room in rooms_with_wall:
                RoomService.recalculate_room_boundary_from_walls(room.id)
            
            return Response(
                {
                    'split_wall_1': WallSerializer(split_wall_1).data,
                    'split_wall_2': WallSerializer(split_wall_2).data,
                },
                status=status.HTTP_201_CREATED,
            )
        except Wall.DoesNotExist:
            return Response({'error': 'Wall not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def merge_walls(self, request):
        """Merge two walls into one"""
        wall_ids = request.data.get('wall_ids')
        if not wall_ids or len(wall_ids) != 2:
            return Response(
                {'error': 'Exactly two wall_ids are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            wall_1 = Wall.objects.get(pk=wall_ids[0])
            wall_2 = Wall.objects.get(pk=wall_ids[1])
            
            # Get rooms that contain these walls before merging
            rooms_with_walls = set()
            rooms_with_walls.update(wall_1.rooms.all())
            rooms_with_walls.update(wall_2.rooms.all())
            
            merged_wall = WallService.merge_walls(wall_1, wall_2)
            
            # After merging walls, recalculate room boundaries for all affected rooms
            from .services import RoomService
            for room in rooms_with_walls:
                RoomService.recalculate_room_boundary_from_walls(room.id)
            
            return Response(WallSerializer(merged_wall).data, status=status.HTTP_201_CREATED)
        except Wall.DoesNotExist:
            return Response({'error': 'One or more walls not found'}, status=status.HTTP_404_NOT_FOUND)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class RoomViewSet(viewsets.ModelViewSet):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer

    def get_queryset(self):
        """Optionally filter rooms by project ID"""
        project_id = self.request.query_params.get('project')
        if project_id:
            return Room.objects.filter(project_id=project_id)
        return super().get_queryset()

    def create(self, request, *args, **kwargs):
        """Create a new room with validation and automatic height calculation"""
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            logger.info(f"Creating room with data: {request.data}")
            RoomService.validate_room_points(request.data.get('room_points', []))
            room = RoomService.create_room_with_height(request.data)
            logger.info(f"Successfully created room {room.id} with height {room.height}")
            return Response(RoomSerializer(room).data, status=status.HTTP_201_CREATED)
        except ValueError as e:
            logger.error(f"Validation error creating room: {str(e)}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Error creating room: {str(e)}")
            return Response({'error': f'An error occurred: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def update(self, request, *args, **kwargs):
        """Update a room with validation and wall height updates"""
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            logger.info(f"Updating room with data: {request.data}")
            RoomService.validate_room_points(request.data.get('room_points', []))
            
            # Get the room instance
            room = self.get_object()
            logger.info(f"Found room to update: {room.id}, current height: {room.height}")
            
            # Update the room
            serializer = self.get_serializer(room, data=request.data, partial=kwargs.get('partial', False))
            serializer.is_valid(raise_exception=True)
            updated_room = serializer.save()
            logger.info(f"Updated room height to: {updated_room.height}")
            
            # If height is being updated, update wall heights
            if 'height' in request.data and request.data['height'] is not None:
                wall_ids = list(updated_room.walls.values_list('id', flat=True))
                logger.info(f"Updating {len(wall_ids)} walls with new height: {request.data['height']}")
                updated_count = RoomService.update_wall_heights_for_room(wall_ids, request.data['height'])
                logger.info(f"Successfully updated {updated_count} walls")
            
            # Always recalculate room boundaries after any room update to ensure consistency
            RoomService.recalculate_room_boundary_from_walls(updated_room.id)
            
            return Response(serializer.data, status=status.HTTP_200_OK)
        except ValueError as e:
            logger.error(f"Validation error updating room: {str(e)}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Error updating room: {str(e)}")
            return Response({'error': f'An error occurred: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['patch'])
    def update_height(self, request, pk=None):
        """Update room height and all associated wall heights"""
        try:
            new_height = request.data.get('height')
            if new_height is None:
                return Response({'error': 'height is required'}, status=status.HTTP_400_BAD_REQUEST)
            
            room = RoomService.update_room_height(pk, new_height)
            return Response(RoomSerializer(room).data, status=status.HTTP_200_OK)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': f'An error occurred: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'])
    def calculate_min_height(self, request):
        """Calculate minimum wall height for given wall IDs"""
        try:
            wall_ids = request.data.get('wall_ids', [])
            min_height = RoomService.calculate_minimum_wall_height(wall_ids)
            return Response({'min_height': min_height}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': f'An error occurred: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'])
    def recalculate_boundaries(self, request):
        """Recalculate room boundaries for all rooms in a project"""
        try:
            project_id = request.data.get('project_id')
            if not project_id:
                return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
            updated_count = RoomService.recalculate_all_room_boundaries(project_id)
            return Response({
                'message': f'Successfully recalculated boundaries for {updated_count} rooms',
                'updated_count': updated_count
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': f'An error occurred: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class FloorPanelViewSet(viewsets.ModelViewSet):
    queryset = FloorPanel.objects.all()
    serializer_class = FloorPanelSerializer

    def get_queryset(self):
        """Optionally filter floor panels by room ID or project ID"""
        room_id = self.request.query_params.get('room')
        project_id = self.request.query_params.get('project')
        
        if room_id:
            return FloorPanel.objects.filter(room_id=room_id)
        elif project_id:
            # Filter by project by getting rooms that belong to the project
            from .models import Room
            project_rooms = Room.objects.filter(project_id=project_id)
            return FloorPanel.objects.filter(room__in=project_rooms)
        
        return super().get_queryset()

class FloorPlanViewSet(viewsets.ModelViewSet):
    queryset = FloorPlan.objects.all()
    serializer_class = FloorPlanSerializer

    def get_queryset(self):
        """Optionally filter floor plans by room ID or project ID"""
        room_id = self.request.query_params.get('room')
        project_id = self.request.query_params.get('project')
        
        if room_id:
            return FloorPlan.objects.filter(room_id=room_id)
        elif project_id:
            # Filter by project by getting rooms that belong to the project
            from .models import Room
            project_rooms = Room.objects.filter(project_id=project_id)
            return FloorPlan.objects.filter(room__in=project_rooms)
        
        return super().get_queryset()

    @action(detail=False, methods=['post'])
    def analyze_floor_orientations(self, request):
        """Analyze different orientation strategies for floor panels"""
        project_id = request.data.get('project_id')
        panel_width = request.data.get('panel_width', 1150)
        panel_length = request.data.get('panel_length', 'auto')
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            orientation_analysis = FloorService.analyze_floor_orientation_strategies(
                project_id, panel_width, panel_length
            )
            
            if 'error' in orientation_analysis:
                return Response({'error': orientation_analysis['error']}, status=status.HTTP_400_BAD_REQUEST)
            
            return Response(orientation_analysis, status=status.HTTP_200_OK)
            
        except Exception as e:
            return Response({'error': f'Internal server error: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'])
    def generate_floor_plan(self, request):
        """Generate floor plan with intelligent panel placement (excluding walls)"""
        project_id = request.data.get('project_id')
        orientation_strategy = request.data.get('orientation_strategy', 'auto')
        panel_width = request.data.get('panel_width', 1150)
        panel_length = request.data.get('panel_length', 'auto')
        
        # Extract additional generation parameters
        custom_panel_length = request.data.get('custom_panel_length')
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # Convert project_id to int if it's a string
            try:
                project_id = int(project_id)
            except (ValueError, TypeError):
                return Response({'error': 'project_id must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Convert custom_panel_length to float if provided
            if custom_panel_length is not None:
                try:
                    custom_panel_length = float(custom_panel_length)
                except (ValueError, TypeError):
                    return Response({'error': 'custom_panel_length must be a valid number'}, status=status.HTTP_400_BAD_REQUEST)
            
            floor_plan = FloorService.generate_floor_plan(
                project_id, 
                orientation_strategy,
                panel_width,
                panel_length,
                custom_panel_length
            )
            
            if 'error' in floor_plan:
                return Response({'error': floor_plan['error']}, status=status.HTTP_400_BAD_REQUEST)
            
            return Response(floor_plan, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({'error': f'Internal server error: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class CeilingPanelViewSet(viewsets.ModelViewSet):
    queryset = CeilingPanel.objects.all()
    serializer_class = CeilingPanelSerializer

    def get_queryset(self):
        """Optionally filter ceiling panels by room ID or project ID"""
        room_id = self.request.query_params.get('room')
        project_id = self.request.query_params.get('project')
        
        if room_id:
            return CeilingPanel.objects.filter(room_id=room_id)
        elif project_id:
            # Filter by project by getting rooms that belong to the project
            from .models import Room
            project_rooms = Room.objects.filter(project_id=project_id)
            return CeilingPanel.objects.filter(room__in=project_rooms)
        
        return super().get_queryset()

class CeilingPlanViewSet(viewsets.ModelViewSet):
    queryset = CeilingPlan.objects.all()
    serializer_class = CeilingPlanSerializer

    def get_queryset(self):
        """Optionally filter ceiling plans by room ID or project ID"""
        room_id = self.request.query_params.get('room')
        project_id = self.request.query_params.get('project')
        
        if room_id:
            return CeilingPlan.objects.filter(room_id=room_id)
        elif project_id:
            # Filter by project by getting rooms that belong to the project
            from .models import Room
            project_rooms = Room.objects.filter(project_id=project_id)
            return CeilingPlan.objects.filter(room__in=project_rooms)
        
        return super().get_queryset()

    @action(detail=False, methods=['post'])
    def generate_ceiling_plan(self, request):
        """Automatically generate ceiling plan for a room"""
        room_id = request.data.get('room_id')
        panel_length_option = request.data.get('panel_length_option', 1)  # Default to option 1
        
        if not room_id:
            return Response({'error': 'room_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate panel length option
        if panel_length_option not in [1, 2, 3, 4, 5]:
            return Response({'error': 'panel_length_option must be 1, 2, 3, 4, or 5'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            ceiling_plan = CeilingService.generate_ceiling_plan(room_id, panel_length_option)
            return Response(CeilingPlanSerializer(ceiling_plan).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def analyze_project_heights(self, request):
        """Analyze project room heights and provide grouping recommendations"""
        project_id = request.query_params.get('project_id')
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            height_analysis = CeilingService.analyze_project_heights(project_id)
            return Response(height_analysis, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def analyze_orientations(self, request):
        """Stage 2: Analyze different panel orientation strategies"""
        project_id = request.data.get('project_id')
        panel_width = request.data.get('panel_width', 1150)
        panel_length = request.data.get('panel_length', 'auto')
        ceiling_thickness = request.data.get('ceiling_thickness', 150)
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # Convert project_id to int if it's a string
            try:
                project_id = int(project_id)
            except (ValueError, TypeError):
                return Response({'error': 'project_id must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST)
            
            orientation_analysis = CeilingService.analyze_orientation_strategies(
                project_id, 
                panel_width, 
                panel_length, 
                ceiling_thickness
            )
            
            if 'error' in orientation_analysis:
                return Response({'error': orientation_analysis['error']}, status=status.HTTP_400_BAD_REQUEST)
            
            return Response(orientation_analysis, status=status.HTTP_200_OK)
            
        except Exception as e:
            return Response({'error': f'Internal server error: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'])
    def generate_enhanced_ceiling_plan(self, request):
        """Stage 3: Generate enhanced ceiling plan with intelligent panel placement"""
        project_id = request.data.get('project_id')
        orientation_strategy = request.data.get('orientation_strategy', 'auto')
        panel_width = request.data.get('panel_width', 1150)
        panel_length = request.data.get('panel_length', 'auto')
        ceiling_thickness = request.data.get('ceiling_thickness', 150)
        
        # Extract additional generation parameters
        custom_panel_length = request.data.get('custom_panel_length')
        support_type = request.data.get('support_type', 'nylon')
        support_config = request.data.get('support_config', {})
        
        # Extract room-specific configuration (if provided)
        room_specific_config = request.data.get('room_specific_config')
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            # Convert project_id to int if it's a string
            try:
                project_id = int(project_id)
            except (ValueError, TypeError):
                return Response({'error': 'project_id must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Convert custom_panel_length to float if provided
            if custom_panel_length is not None:
                try:
                    custom_panel_length = float(custom_panel_length)
                except (ValueError, TypeError):
                    return Response({'error': 'custom_panel_length must be a valid number'}, status=status.HTTP_400_BAD_REQUEST)
            
            enhanced_plan = CeilingService.generate_enhanced_ceiling_plan(
                project_id, 
                orientation_strategy,
                panel_width,
                panel_length,
                ceiling_thickness,
                custom_panel_length,
                support_type,
                support_config,
                room_specific_config
            )
            
            if 'error' in enhanced_plan:
                return Response({'error': enhanced_plan['error']}, status=status.HTTP_400_BAD_REQUEST)
            
            return Response(enhanced_plan, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({'error': f'Internal server error: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'])
    def generate_project_ceiling_plan(self, request):
        """Generate ceiling plans for entire project using height-based grouping"""
        project_id = request.data.get('project_id')
        panel_length_option = request.data.get('panel_length_option', 1)
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Validate panel length option
        if panel_length_option not in [1, 2, 3, 4, 5]:
            return Response({'error': 'panel_length_option must be 1, 2, 3, 4, or 5'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            project_ceiling_plan = CeilingService.generate_project_ceiling_plan(project_id, panel_length_option)
            return Response(project_ceiling_plan, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def generate_project_report(self, request):
        """Stage 5: Generate comprehensive project ceiling report"""
        project_id = request.query_params.get('project_id')
        include_detailed = request.query_params.get('include_detailed', 'true').lower() == 'true'
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            report = CeilingService.generate_project_ceiling_report(project_id, include_detailed)
            return Response(report, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def export_report_csv(self, request):
        """Stage 5: Export ceiling report to CSV format"""
        project_id = request.query_params.get('project_id')
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            csv_data = CeilingService.export_ceiling_report_to_csv(project_id)
            if 'error' in csv_data:
                return Response({'error': csv_data['error']}, status=status.HTTP_400_BAD_REQUEST)
            
            # Return CSV as downloadable file
            from django.http import HttpResponse
            response = HttpResponse(csv_data['csv_content'], content_type='text/csv')
            response['Content-Disposition'] = f'attachment; filename="{csv_data["filename"]}"'
            return response
            
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def visualization_data(self, request):
        """Stage 5: Get ceiling plan visualization data"""
        project_id = request.query_params.get('project_id')
        room_id = request.query_params.get('room_id')
        
        if not project_id:
            return Response({'error': 'project_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            visualization_data = CeilingService.generate_ceiling_plan_visualization_data(project_id, room_id)
            return Response(visualization_data, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class DoorViewSet(viewsets.ModelViewSet):
    queryset = Door.objects.all()
    serializer_class = DoorSerializer

    def get_queryset(self):
        """Optionally filter doors by project ID"""
        project_id = self.request.query_params.get('project')
        if project_id:
            return Door.objects.filter(project_id=project_id)
        return super().get_queryset()

    @action(detail=True, methods=['get'])
    def doors(self, request, pk=None):
        """Retrieve doors associated with a specific project"""
        try:
            project = Project.objects.get(pk=pk)
            doors = Door.objects.filter(project=project)
            serializer = DoorSerializer(doors, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def create_door(self, request):
        """Create a new door with validation"""
        try:
            door = DoorService.create_door(request.data)
            return Response(DoorSerializer(door).data, status=status.HTTP_201_CREATED)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': f'An error occurred: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class IntersectionViewSet(viewsets.ModelViewSet):
    queryset = Intersection.objects.all()
    serializer_class = IntersectionSerializer

    def get_queryset(self):
        """Optionally filter intersections by project ID"""
        project_id = self.request.query_params.get('project')
        if project_id:
            return Intersection.objects.filter(project_id=project_id)
        return super().get_queryset()

    @action(detail=False, methods=['post'], url_path='set_joint')
    def set_joint(self, request):
        """Set the joining method for an intersection"""
        wall_1_id = request.data.get('wall_1')
        wall_2_id = request.data.get('wall_2')
        joining_method = request.data.get('joining_method')

        if not all([wall_1_id, wall_2_id, joining_method]):
            return Response(
                {'error': 'wall_1, wall_2, and joining_method are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            wall_1 = Wall.objects.get(pk=wall_1_id)
            wall_2 = Wall.objects.get(pk=wall_2_id)
            
            intersection, created = Intersection.objects.get_or_create(
                project=wall_1.project,
                wall_1=wall_1,
                wall_2=wall_2,
                defaults={'joining_method': joining_method}
            )
            
            if not created:
                intersection.joining_method = joining_method
                intersection.save()

            return Response(IntersectionSerializer(intersection).data, status=status.HTTP_200_OK)
        except Wall.DoesNotExist:
            return Response({'error': 'One or more walls not found'}, status=status.HTTP_404_NOT_FOUND)