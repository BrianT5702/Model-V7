"""
Custom views for serving React app in production
"""
from django.shortcuts import render
from django.conf import settings
import os

def serve_react_app(request, path=''):
    """
    Serve the React app for all non-API routes
    """
    # Check if the file exists in the frontend build directory
    build_path = os.path.join(settings.BASE_DIR, 'frontend', 'build')
    file_path = os.path.join(build_path, path.lstrip('/'))
    
    # If it's a static file (CSS, JS, images), serve it directly
    if os.path.isfile(file_path) and not path.startswith('api/'):
        from django.http import FileResponse
        return FileResponse(open(file_path, 'rb'))
    
    # Otherwise, serve the React app
    return render(request, 'index.html')
