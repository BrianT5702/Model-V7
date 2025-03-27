from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework import status
from rest_framework.decorators import action
from .models import Project, Wall, Room, Ceiling, Door, Intersection
from .serializers import ProjectSerializer, WallSerializer, RoomSerializer, CeilingSerializer, DoorSerializer, IntersectionSerializer
from django.db import transaction

class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = serializer.save()

        # Create default walls for the project
        width = project.width
        length = project.length
        height = project.height
        thickness = project.wall_thickness

        walls = [
            {'project': project, 'start_x': 0, 'start_y': 0, 'end_x': width, 'end_y': 0, 'height': height, 'thickness': thickness},
            {'project': project, 'start_x': width, 'start_y': 0, 'end_x': width, 'end_y': length, 'height': height, 'thickness': thickness},
            {'project': project, 'start_x': width, 'start_y': length, 'end_x': 0, 'end_y': length, 'height': height, 'thickness': thickness},
            {'project': project, 'start_x': 0, 'start_y': length, 'end_x': 0, 'end_y': 0, 'height': height, 'thickness': thickness},
        ]

        Wall.objects.bulk_create([Wall(**wall) for wall in walls])

        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def walls(self, request, pk=None):
        """
        Retrieve walls associated with a specific project
        """
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
        """
        Optionally filter walls by project ID
        """
        project_id = self.request.query_params.get('project')
        if project_id:
            return Wall.objects.filter(project_id=project_id)
        return super().get_queryset()

    def update(self, request, *args, **kwargs):
        """
        Allow updating wall properties including height, thickness, and application_type.
        """
        instance = self.get_object()
        instance.height = request.data.get('height', instance.height)
        instance.thickness = request.data.get('thickness', instance.thickness)
        instance.application_type = request.data.get('application_type', instance.application_type)
        instance.start_x = request.data.get('start_x', instance.start_x)
        instance.start_y = request.data.get('start_y', instance.start_y)
        instance.end_x = request.data.get('end_x', instance.end_x)
        instance.end_y = request.data.get('end_y', instance.end_y)
        instance.save()
        return Response(WallSerializer(instance).data)

    @action(detail=False, methods=['post'])
    def create_wall(self, request):
        project_id = request.data.get('project')
        application_type = request.data.get('application_type', 'wall')  # Default to wall

        if not project_id:
            return Response({'error': 'Project ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            project = Project.objects.get(pk=project_id)
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = self.get_serializer(data=request.data)
        if serializer.is_valid():
            wall = serializer.save(project=project, application_type=application_type)  # Explicitly set application_type
            return Response(WallSerializer(wall).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def split_wall(self, request):
        """
        Split a wall at a specific intersection point
        """
        wall_id = request.data.get('wall_id')
        intersection_x = request.data.get('intersection_x')
        intersection_y = request.data.get('intersection_y')

        if not all([wall_id, intersection_x, intersection_y]):
            return Response({'error': 'wall_id, intersection_x, and intersection_y are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                wall = Wall.objects.get(pk=wall_id)

                # Create two new split walls, preserving original properties
                split_wall_1 = Wall.objects.create(
                    project=wall.project,
                    start_x=wall.start_x,
                    start_y=wall.start_y,
                    end_x=intersection_x,
                    end_y=intersection_y,
                    height=wall.height,
                    thickness=wall.thickness,
                    application_type=wall.application_type
                )
                split_wall_2 = Wall.objects.create(
                    project=wall.project,
                    start_x=intersection_x,
                    start_y=intersection_y,
                    end_x=wall.end_x,
                    end_y=wall.end_y,
                    height=wall.height,
                    thickness=wall.thickness,
                    application_type=wall.application_type
                )

                # Delete the original wall
                wall.delete()

                return Response(
                    {
                        'split_wall_1': WallSerializer(split_wall_1).data,
                        'split_wall_2': WallSerializer(split_wall_2).data,
                    },
                    status=status.HTTP_201_CREATED,
                )

        except Wall.DoesNotExist:
            return Response({'error': 'Wall not found'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['post'])
    def merge_walls(self, request):
        """
        Merge two walls into one if they now have the same application_type, height, and thickness.
        """
        wall_ids = request.data.get('wall_ids')
        if not wall_ids or len(wall_ids) != 2:
            return Response({'error': 'Exactly two wall_ids are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                wall_1 = Wall.objects.get(pk=wall_ids[0])
                wall_2 = Wall.objects.get(pk=wall_ids[1])

                # 🚨 Prevent merging if application_type, height, or thickness do not match
                if (
                    wall_1.application_type != wall_2.application_type or
                    wall_1.height != wall_2.height or
                    wall_1.thickness != wall_2.thickness
                ):
                    return Response({'error': 'Walls must have the same type, height, and thickness to merge.'}, status=status.HTTP_400_BAD_REQUEST)

                # Ensure walls share endpoints
                if (
                    (wall_1.end_x == wall_2.start_x and wall_1.end_y == wall_2.start_y) or
                    (wall_2.end_x == wall_1.start_x and wall_2.end_y == wall_1.start_y)
                ):
                    # Determine correct endpoints for merging
                    new_start_x = min(wall_1.start_x, wall_1.end_x, wall_2.start_x, wall_2.end_x)
                    new_start_y = min(wall_1.start_y, wall_1.end_y, wall_2.start_y, wall_2.end_y)
                    new_end_x = max(wall_1.start_x, wall_1.end_x, wall_2.start_x, wall_2.end_x)
                    new_end_y = max(wall_1.start_y, wall_1.end_y, wall_2.start_y, wall_2.end_y)

                    # Create a new merged wall, keeping properties from the first wall
                    merged_wall = Wall.objects.create(
                        project=wall_1.project,
                        start_x=new_start_x,
                        start_y=new_start_y,
                        end_x=new_end_x,
                        end_y=new_end_y,
                        height=wall_1.height,  # Keep the same height
                        thickness=wall_1.thickness,  # Keep the same thickness
                        application_type=wall_1.application_type  # Maintain original type (wall/partition)
                    )

                    # Delete original walls
                    wall_1.delete()
                    wall_2.delete()

                    return Response(WallSerializer(merged_wall).data, status=status.HTTP_201_CREATED)

                return Response({'error': 'Walls do not share endpoints'}, status=status.HTTP_400_BAD_REQUEST)

        except Wall.DoesNotExist:
            return Response({'error': 'One or more walls not found'}, status=status.HTTP_404_NOT_FOUND)
        
class RoomViewSet(viewsets.ModelViewSet):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer

    def get_queryset(self):
        """
        Optionally filter rooms by project ID
        """
        project_id = self.request.query_params.get('project')
        if project_id:
            return Room.objects.filter(project_id=project_id)
        return super().get_queryset()
    
    
class CeilingViewSet(viewsets.ModelViewSet):
    queryset = Ceiling.objects.all()
    serializer_class = CeilingSerializer

    def get_queryset(self):
        """
        Optionally filter ceilings by room ID
        """
        room_id = self.request.query_params.get('room')
        if room_id:
            return Ceiling.objects.filter(room_id=room_id)
        return super().get_queryset()


class DoorViewSet(viewsets.ModelViewSet):
    queryset = Door.objects.all()
    serializer_class = DoorSerializer

    def get_queryset(self):
        """
        Optionally filter doors by project ID
        """
        project_id = self.request.query_params.get('project')
        if project_id:
            return Door.objects.filter(project_id=project_id)
        return super().get_queryset()

class IntersectionViewSet(viewsets.ModelViewSet):
    queryset = Intersection.objects.all()
    serializer_class = IntersectionSerializer

    def get_queryset(self):
        """
        Optionally filter intersections by project ID
        """
        project_id = self.request.query_params.get('project')
        if project_id:
            return Intersection.objects.filter(project_id=project_id)
        return super().get_queryset()

    @action(detail=False, methods=['post'])
    def set_joint(self, request):
        project_id = request.data.get('project')
        wall_1_id = request.data.get('wall_1')
        wall_2_id = request.data.get('wall_2')
        method = request.data.get('joining_method')

        if not all([project_id, wall_1_id, wall_2_id, method]):
            return Response({'error': 'project, wall_1, wall_2, and joining_method are required'}, 
                        status=status.HTTP_400_BAD_REQUEST)

        try:
            # Ensure consistent ordering of wall IDs
            wall_ids = sorted([int(wall_1_id), int(wall_2_id)])
            
            intersection, created = Intersection.objects.update_or_create(
                project_id=project_id,
                wall_1_id=wall_ids[0],  # Always smaller ID first
                wall_2_id=wall_ids[1],  # Always larger ID second
                defaults={'joining_method': method}
            )
            
            return Response(
                IntersectionSerializer(intersection).data,
                status=status.HTTP_200_OK if not created else status.HTTP_201_CREATED
            )
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
