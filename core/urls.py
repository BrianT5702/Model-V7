from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ProjectViewSet, WallViewSet

# Create a router for registering viewsets
router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'walls', WallViewSet, basename='wall')

# Define urlpatterns
urlpatterns = [
    path('', include(router.urls)),  # Include all routes defined by the router
]
