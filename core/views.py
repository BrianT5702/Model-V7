from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework import status
from rest_framework.decorators import action
from .models import Project, Wall
from .serializers import ProjectSerializer, WallSerializer


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