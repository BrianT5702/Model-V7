"""
Custom views for serving React app in production
"""
import os

from django.conf import settings
from django.http import FileResponse, Http404
from django.shortcuts import render


def _frontend_dist_index_path():
    frontend_build = getattr(
        settings,
        'FRONTEND_BUILD_PATH',
        os.path.join(settings.BASE_DIR, 'frontend', 'dist'),
    )
    return os.path.join(frontend_build, 'index.html')


def serve_react_app(request):
    """
    Serve the React app for all non-API routes.
    Prefer Vite's built frontend/dist/index.html (has type=module scripts).
    Fall back to Django template when dist is missing (local dev).
    """
    path = request.path.lstrip('/')

    if (
        path.startswith('static/')
        or path.startswith('media/')
        or path.startswith('api/')
        or '/static/' in path
        or '/media/' in path
    ):
        raise Http404("Not found")

    dist_index = _frontend_dist_index_path()
    if os.path.isfile(dist_index):
        return FileResponse(
            open(dist_index, 'rb'),
            content_type='text/html; charset=utf-8',
        )

    return render(request, 'index.html')
