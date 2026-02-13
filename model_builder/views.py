"""
Custom views for serving React app in production
"""
from django.shortcuts import render
from django.conf import settings
from django.http import Http404
import os

def serve_react_app(request):
    """
    Serve the React app for all non-API routes
    Excludes static and media files which should be handled by WhiteNoise
    """
    # Get the path from the request
    path = request.path.lstrip('/')
    
    # Don't serve the React app for static/media/api paths
    # These should be handled by WhiteNoise middleware or API routes
    if (path.startswith('static/') or 
        path.startswith('media/') or 
        path.startswith('api/') or
        '/static/' in path or
        '/media/' in path):
        raise Http404("Not found")
    
    # Otherwise, serve the React app
    return render(request, 'index.html')
