from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ProjectViewSet, WallViewSet, RoomViewSet, CeilingViewSet, DoorViewSet, IntersectionViewSet

# Create a router for registering viewsets
router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'walls', WallViewSet, basename='wall')
router.register(r'rooms', RoomViewSet, basename='room')
router.register(r'ceilings', CeilingViewSet, basename='ceiling')  # New endpoint for ceilings
router.register(r'doors', DoorViewSet, basename='door')  # New endpoint for doors
router.register(r'intersections', IntersectionViewSet, basename='intersection')  # New endpoint for intersections

# Define urlpatterns
urlpatterns = [
    path('', include(router.urls)),  # Include all routes defined by the router
]
