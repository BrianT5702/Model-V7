from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ProjectViewSet, WallViewSet, RoomViewSet, CeilingPanelViewSet, CeilingPlanViewSet, FloorPanelViewSet, FloorPlanViewSet, DoorViewSet, IntersectionViewSet

# Create a router for registering viewsets
router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'walls', WallViewSet, basename='wall')
router.register(r'rooms', RoomViewSet, basename='room')
router.register(r'ceiling-panels', CeilingPanelViewSet, basename='ceiling-panel')  # Endpoint for ceiling panels
router.register(r'ceiling-plans', CeilingPlanViewSet, basename='ceiling-plan')  # Endpoint for ceiling plans
router.register(r'floor-panels', FloorPanelViewSet, basename='floor-panel')  # Endpoint for floor panels
router.register(r'floor-plans', FloorPlanViewSet, basename='floor-plan')  # Endpoint for floor plans
router.register(r'doors', DoorViewSet, basename='door')  # New endpoint for doors
router.register(r'intersections', IntersectionViewSet, basename='intersection')  # New endpoint for intersections

# Define urlpatterns
urlpatterns = [
    path('', include(router.urls)),  # Include all routes defined by the router
]
