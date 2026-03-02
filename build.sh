#!/usr/bin/env bash
set -e
# Build frontend and collect static files for production (Railway, etc.)
export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-model_builder.settings_production}"
echo "Building frontend..."
cd frontend
npm ci
npm run build
cd ..
echo "Collecting static files..."
python manage.py collectstatic --noinput --clear
echo "Build complete."
