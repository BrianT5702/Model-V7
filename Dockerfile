FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including Node.js
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies with retry and increased timeout
RUN pip install --no-cache-dir --timeout=300 --retries=5 -r requirements.txt

# Copy frontend package files first (for better caching)
COPY frontend/package*.json ./frontend/

# Install frontend dependencies
WORKDIR /app/frontend
RUN npm install --legacy-peer-deps

# Copy frontend source files
COPY frontend/ .

# Build frontend
RUN npm run build

# Return to app root
WORKDIR /app

# Copy remaining project files
# Note: frontend is already copied and built above, so this won't overwrite the build directory
COPY . .

# Collect static files
RUN python manage.py collectstatic --noinput || true

# Expose port
EXPOSE 8000

# Run gunicorn
CMD ["gunicorn", "model_builder.wsgi_production:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "120"]

