from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework import status
from rest_framework.decorators import action
from .models import Project, Wall
from .serializers import ProjectSerializer, WallSerializer
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

    @action(detail=False, methods=['post'])
    def create_wall(self, request):
        project_id = request.data.get('project')
        if not project_id:
            return Response({'error': 'Project ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            project = Project.objects.get(pk=project_id)
        except Project.DoesNotExist:
            return Response({'error': 'Project not found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = self.get_serializer(data=request.data)
        if serializer.is_valid():
            wall = serializer.save(project=project)  # Explicitly set the project
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

                # Create two new split walls
                split_wall_1 = Wall.objects.create(
                    project=wall.project,
                    start_x=wall.start_x,
                    start_y=wall.start_y,
                    end_x=intersection_x,
                    end_y=intersection_y,
                    height=wall.height,
                    thickness=wall.thickness,
                )
                split_wall_2 = Wall.objects.create(
                    project=wall.project,
                    start_x=intersection_x,
                    start_y=intersection_y,
                    end_x=wall.end_x,
                    end_y=wall.end_y,
                    height=wall.height,
                    thickness=wall.thickness,
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
        Merge two walls into one
        """
        wall_ids = request.data.get('wall_ids')
        if not wall_ids or len(wall_ids) != 2:
            return Response({'error': 'Exactly two wall_ids are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                wall_1 = Wall.objects.get(pk=wall_ids[0])
                wall_2 = Wall.objects.get(pk=wall_ids[1])

                # Ensure walls share endpoints
                if (
                    (wall_1.end_x == wall_2.start_x and wall_1.end_y == wall_2.start_y) or
                    (wall_2.end_x == wall_1.start_x and wall_2.end_y == wall_1.start_y)
                ):
                    merged_wall = Wall.objects.create(
                        project=wall_1.project,
                        start_x=min(wall_1.start_x, wall_2.start_x),
                        start_y=min(wall_1.start_y, wall_2.start_y),
                        end_x=max(wall_1.end_x, wall_2.end_x),
                        end_y=max(wall_1.end_y, wall_2.end_y),
                        height=wall_1.height,
                        thickness=wall_1.thickness,
                    )

                    # Delete original walls
                    wall_1.delete()
                    wall_2.delete()

                    return Response(WallSerializer(merged_wall).data, status=status.HTTP_201_CREATED)

                return Response({'error': 'Walls do not share endpoints'}, status=status.HTTP_400_BAD_REQUEST)

        except Wall.DoesNotExist:
            return Response({'error': 'One or more walls not found'}, status=status.HTTP_404_NOT_FOUND)
