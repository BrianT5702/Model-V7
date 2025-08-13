"""
WSGI config for model_builder project in production.
"""

import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'model_builder.settings_production')

application = get_wsgi_application()
