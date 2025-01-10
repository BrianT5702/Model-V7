from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from core.views import ProjectViewSet, WallViewSet

# Create a router for the API endpoints
router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'walls', WallViewSet, basename='wall')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),  # Include URLs from the core app
]