from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Project, Wall, Room, Ceiling, Door, Intersection
from .serializers import (
    ProjectSerializer, WallSerializer, RoomSerializer,
    CeilingSerializer, DoorSerializer, IntersectionSerializer
)
from .services import WallService, RoomService, DoorService
from django.db import transaction, IntegrityError
from django.core.exceptions import PermissionDenied
from django.db.utils import OperationalError

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

    def update(self, request, *args, **kwargs):
        """Update wall properties"""
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
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

        serializer = self.get_serializer(data=request.data)
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
            merged_wall = WallService.merge_walls(wall_1, wall_2)
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

class CeilingViewSet(viewsets.ModelViewSet):
    queryset = Ceiling.objects.all()
    serializer_class = CeilingSerializer

    def get_queryset(self):
        """Optionally filter ceilings by room ID"""
        room_id = self.request.query_params.get('room')
        if room_id:
            return Ceiling.objects.filter(room_id=room_id)
        return super().get_queryset()

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