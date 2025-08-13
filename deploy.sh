#!/bin/bash

echo "🚀 Starting Model-V6 Deployment..."

# Check if we're in the right directory
if [ ! -f "manage.py" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install -r requirements.txt

# Install Node.js dependencies and build frontend
echo "🔨 Building React frontend..."
cd frontend
npm install
npm run build
cd ..

# Collect static files
echo "📁 Collecting static files..."
python manage.py collectstatic --noinput

# Run migrations
echo "🗄️ Running database migrations..."
python manage.py migrate

echo "✅ Deployment preparation completed!"
echo ""
echo "Next steps:"
echo "1. Push your code to GitHub"
echo "2. Deploy to Railway or Render using the DEPLOYMENT.md guide"
echo "3. Set environment variables in your deployment platform"
echo "4. Your app will be accessible via a public URL!"
