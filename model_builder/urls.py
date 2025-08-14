from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static
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

# Serve static files in development
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# Serve React frontend for all other routes (production)
if not settings.DEBUG:
    urlpatterns += [
        re_path(r'^.*$', TemplateView.as_view(template_name='index.html')),
    ]
else:
    # In development, serve static files
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)