"""
Template tag to load React build assets dynamically from asset-manifest.json
"""
import json
import os
from django import template
from django.conf import settings

register = template.Library()


@register.simple_tag
def react_asset(asset_type='js'):
    """
    Load React build assets dynamically from asset-manifest.json
    
    Usage:
        {% react_asset 'js' %} - Returns the main JS file path
        {% react_asset 'css' %} - Returns the main CSS file path
    """
    try:
        # Try to find asset-manifest.json in the build directory
        build_path = os.path.join(settings.BASE_DIR, 'frontend', 'build', 'asset-manifest.json')
        
        if not os.path.exists(build_path):
            # Fallback to staticfiles if build directory doesn't exist
            build_path = os.path.join(settings.BASE_DIR, 'staticfiles', 'asset-manifest.json')
        
        if os.path.exists(build_path):
            with open(build_path, 'r') as f:
                manifest = json.load(f)
                
            if asset_type == 'js':
                # Get main.js from entrypoints or files
                if 'entrypoints' in manifest and len(manifest['entrypoints']) > 0:
                    for entry in manifest['entrypoints']:
                        if entry.endswith('.js'):
                            # Ensure absolute path (starting with /)
                            return entry if entry.startswith('/') else '/' + entry
                # Fallback to files.main.js
                if 'files' in manifest and 'main.js' in manifest['files']:
                    path = manifest['files']['main.js']
                    return path if path.startswith('/') else '/' + path
            elif asset_type == 'css':
                # Get main.css from entrypoints or files
                if 'entrypoints' in manifest and len(manifest['entrypoints']) > 0:
                    for entry in manifest['entrypoints']:
                        if entry.endswith('.css'):
                            # Ensure absolute path (starting with /)
                            return entry if entry.startswith('/') else '/' + entry
                # Fallback to files.main.css
                if 'files' in manifest and 'main.css' in manifest['files']:
                    path = manifest['files']['main.css']
                    return path if path.startswith('/') else '/' + path
    except Exception as e:
        # Log error but don't break the template
        print(f"Error loading React assets: {e}")
    
    # Fallback to default paths if manifest can't be loaded
    if asset_type == 'js':
        return '/static/js/main.js'
    elif asset_type == 'css':
        return '/static/css/main.css'
    return ''

