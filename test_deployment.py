#!/usr/bin/env python
"""
Test script to verify deployment configuration
"""
import os
import sys
import django
from pathlib import Path

def test_deployment_config():
    print("🚀 Testing Model-V6 Deployment Configuration...")
    print("=" * 50)
    
    # Test 1: Check if production settings can be imported
    try:
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'model_builder.settings_production')
        django.setup()
        print("✅ Production settings imported successfully")
    except Exception as e:
        print(f"❌ Failed to import production settings: {e}")
        return False
    
    # Test 2: Check if required packages are available
    required_packages = [
        'django',
        'rest_framework',
        'corsheaders',
        'psycopg2',
        'whitenoise',
        'gunicorn'
    ]
    
    print("\n📦 Checking required packages...")
    for package in required_packages:
        try:
            __import__(package)
            print(f"✅ {package} is available")
        except ImportError:
            print(f"❌ {package} is NOT available")
            return False
    
    # Test 3: Check if frontend build exists
    frontend_build = Path("frontend/build")
    if frontend_build.exists():
        print(f"✅ Frontend build directory exists at {frontend_build}")
    else:
        print(f"❌ Frontend build directory not found at {frontend_build}")
        return False
    
    # Test 4: Check if Django template exists
    template_path = Path("model_builder/templates/index.html")
    if template_path.exists():
        print(f"✅ Django template exists at {template_path}")
    else:
        print(f"❌ Django template not found at {template_path}")
        return False
    
    # Test 5: Check if static files directory exists
    staticfiles_dir = Path("staticfiles")
    if staticfiles_dir.exists():
        print(f"✅ Static files directory exists at {staticfiles_dir}")
    else:
        print(f"❌ Static files directory not found at {staticfiles_dir}")
        return False
    
    # Test 6: Check if requirements.txt exists
    requirements_file = Path("requirements.txt")
    if requirements_file.exists():
        print(f"✅ Requirements file exists at {requirements_file}")
    else:
        print(f"❌ Requirements file not found at {requirements_file}")
        return False
    
    # Test 7: Check if Procfile exists
    procfile = Path("Procfile")
    if procfile.exists():
        print(f"✅ Procfile exists at {procfile}")
    else:
        print(f"❌ Procfile not found at {procfile}")
        return False
    
    print("\n" + "=" * 50)
    print("🎉 All deployment tests passed!")
    print("\n📋 Next steps:")
    print("1. Push your code to GitHub")
    print("2. Deploy to Railway or Render using DEPLOYMENT.md guide")
    print("3. Set environment variables in your deployment platform")
    print("4. Your app will be accessible via a public URL!")
    
    return True

if __name__ == "__main__":
    success = test_deployment_config()
    sys.exit(0 if success else 1)
