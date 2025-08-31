# Use Python 3.11 slim image as base
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NODE_VERSION=18

# Install system dependencies including Node.js
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy package.json and package-lock.json for frontend
COPY frontend/package*.json ./frontend/

# Install Node.js dependencies
WORKDIR /app/frontend
RUN npm ci --only=production

# Copy frontend source code
COPY frontend/ .

# Build frontend
RUN npm run build

# Go back to app root
WORKDIR /app

# Copy the rest of the application
COPY . .

# Collect static files
RUN python manage.py collectstatic --noinput

# Expose port
EXPOSE 8000

# Start command
CMD ["gunicorn", "model_builder.wsgi_production:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "120"]
