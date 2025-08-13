# 🚀 Complete Model-V6 Deployment Guide

## 🎯 **Deployment Strategy Overview**

You have **3 main deployment strategies** to choose from:

### **Strategy 1: All-in-One Deployment (Easiest)**
- Deploy everything on Railway or Render
- Single URL for your entire system
- Perfect for testing and small to medium projects

### **Strategy 2: Split Deployment (Most Professional)**
- Backend on Railway/Render
- Frontend on Vercel/Netlify
- Better performance and scalability

### **Strategy 3: Enterprise Deployment**
- AWS, Google Cloud, or Azure
- Full control and scalability
- More complex setup

---

## 🚀 **Strategy 1: All-in-One Deployment (Recommended for Testing)**

### **Option A: Railway (Recommended)**

#### **Step 1: Prepare Your Repository**
1. **Ensure all deployment files are committed**:
   ```bash
   git add .
   git commit -m "Complete deployment setup"
   git push origin main
   ```

2. **Verify deployment files exist**:
   - ✅ `requirements.txt`
   - ✅ `Procfile`
   - ✅ `runtime.txt`
   - ✅ `model_builder/settings_production.py`
   - ✅ `model_builder/wsgi_production.py`

#### **Step 2: Deploy to Railway**
1. **Visit [railway.app](https://railway.app)**
2. **Sign up with GitHub account**
3. **Click "New Project" → "Deploy from GitHub repo"**
4. **Select your Model-V6 repository**
5. **Wait for initial deployment**

#### **Step 3: Add PostgreSQL Database**
1. **In your Railway project, click "New"**
2. **Select "Database" → "PostgreSQL"**
3. **Railway will automatically set database environment variables**

#### **Step 4: Configure Environment Variables**
1. **Go to your project's "Variables" tab**
2. **Add these environment variables**:

```bash
# Django Settings
SECRET_KEY=your-super-secret-key-here-make-it-long-and-random
DEBUG=False
ALLOWED_HOSTS=your-app-name.railway.app

# Database (Railway sets these automatically when you add PostgreSQL)
DB_NAME=${PGDATABASE}
DB_USER=${PGUSER}
DB_PASSWORD=${PGPASSWORD}
DB_HOST=${PGHOST}
DB_PORT=${PGPORT}

# CORS Settings
CORS_ALLOWED_ORIGINS=https://your-app-name.railway.app

# Security (Optional - enable after deployment)
SECURE_SSL_REDIRECT=True
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=True
SECURE_HSTS_PRELOAD=True
```

#### **Step 5: Configure Build Commands**
1. **Go to "Settings" tab**
2. **Set Build Command**:
   ```bash
   pip install -r requirements.txt && cd frontend && npm install && npm run build && cd .. && python manage.py collectstatic --noinput
   ```
3. **Set Start Command**:
   ```bash
   gunicorn model_builder.wsgi_production:application --bind 0.0.0.0:$PORT --workers 2 --timeout 120
   ```

#### **Step 6: Deploy and Test**
1. **Railway will automatically redeploy**
2. **Wait for build to complete**
3. **Visit your app URL: `https://your-app-name.railway.app`**

---

### **Option B: Render (Alternative)**

#### **Step 1: Deploy to Render**
1. **Visit [render.com](https://render.com)**
2. **Sign up with GitHub account**
3. **Click "New +" → "Web Service"**
4. **Connect your GitHub repository**

#### **Step 2: Configure Service**
- **Name**: `model-v6-backend`
- **Environment**: `Python 3`
- **Build Command**:
  ```bash
  pip install -r requirements.txt && cd frontend && npm install && npm run build && cd .. && python manage.py collectstatic --noinput
  ```
- **Start Command**:
  ```bash
  gunicorn model_builder.wsgi_production:application --bind 0.0.0.0:$PORT --workers 2 --timeout 120
  ```

#### **Step 3: Add PostgreSQL Database**
1. **Click "New +" → "PostgreSQL"**
2. **Name it**: `model-v6-database`
3. **Link it to your web service**

#### **Step 4: Set Environment Variables**
Same as Railway, but use Render's variable names:
```bash
SECRET_KEY=your-super-secret-key-here
DEBUG=False
ALLOWED_HOSTS=your-app-name.onrender.com
DB_NAME=${POSTGRES_DB}
DB_USER=${POSTGRES_USER}
DB_PASSWORD=${POSTGRES_PASSWORD}
DB_HOST=${POSTGRES_HOST}
DB_PORT=${POSTGRES_PORT}
CORS_ALLOWED_ORIGINS=https://your-app-name.onrender.com
```

---

## 🌟 **Strategy 2: Split Deployment (Recommended for Production)**

### **Backend on Railway/Render + Frontend on Vercel**

#### **Step 1: Deploy Backend (Same as above)**
- Follow the Railway or Render backend deployment steps
- Get your backend URL (e.g., `https://your-api.railway.app`)

#### **Step 2: Deploy Frontend on Vercel**
1. **Visit [vercel.com](https://vercel.com)**
2. **Sign up with GitHub account**
3. **Click "New Project"**
4. **Import your GitHub repository**
5. **Configure build settings**:
   - **Framework Preset**: `Create React App`
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
   - **Install Command**: `npm install`

#### **Step 3: Configure Frontend for Split Deployment**
1. **Create environment file**: `.env.production`
   ```bash
   REACT_APP_API_URL=https://your-api.railway.app
   ```
2. **Update API configuration** to use environment variable
3. **Deploy to Vercel**

#### **Step 4: Set CORS on Backend**
Update your backend CORS settings:
```bash
CORS_ALLOWED_ORIGINS=https://your-frontend.vercel.app
```

---

## 🔧 **Environment Variables Reference**

### **Required Variables**
```bash
# Django Core
SECRET_KEY=your-very-long-and-random-secret-key-here
DEBUG=False
ALLOWED_HOSTS=your-domain.com,your-app.railway.app

# Database
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_HOST=your_database_host
DB_PORT=5432

# CORS
CORS_ALLOWED_ORIGINS=https://your-domain.com,https://your-app.railway.app
```

### **Optional Security Variables**
```bash
# HTTPS Security
SECURE_SSL_REDIRECT=True
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=True
SECURE_HSTS_PRELOAD=True

# Cookie Security
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
```

---

## 🧪 **Testing Your Deployment**

### **Backend Health Check**
1. **Visit**: `https://your-app.railway.app/api/`
2. **Expected**: JSON response or API documentation

### **Frontend Functionality**
1. **Visit your main URL**
2. **Test 2D canvas**: Draw walls, create rooms
3. **Test 3D visualization**: Switch to 3D view
4. **Test material calculator**: Calculate panels
5. **Test export features**: Export 2D sketches

### **Database Operations**
1. **Create a new project**
2. **Add walls and rooms**
3. **Verify data persists after refresh**

---

## 🚨 **Troubleshooting Common Issues**

### **Build Failures**
```bash
# Check Python version
python --version  # Should be 3.11+

# Check Node.js version
node --version   # Should be 18+

# Verify dependencies
pip install -r requirements.txt
cd frontend && npm install
```

### **Database Connection Issues**
- Verify environment variables are set correctly
- Check if database is accessible from deployment region
- Ensure database exists and is running

### **Static Files Not Loading**
```bash
# Run locally first
python manage.py collectstatic --noinput --settings=model_builder.settings_production
```

### **CORS Issues**
- Check `CORS_ALLOWED_ORIGINS` format
- Ensure frontend and backend URLs are correct
- Verify CORS middleware is enabled

---

## 📱 **What Testers Will Experience**

### **All-in-One Deployment**
- **Single URL**: `https://your-app.railway.app`
- **Everything works**: Frontend, backend, database
- **No configuration needed**: Just click and use

### **Split Deployment**
- **Frontend URL**: `https://your-app.vercel.app`
- **Backend API**: `https://your-api.railway.app`
- **Same functionality**: All features work seamlessly

---

## 💰 **Cost Comparison**

### **Free Tiers**
- **Railway**: $5/month after free tier (500 hours)
- **Render**: Free tier available
- **Vercel**: Generous free tier
- **Netlify**: Free tier available

### **Recommended for Testing**
- **Railway**: All-in-one deployment
- **Total cost**: $5/month after free tier

### **Recommended for Production**
- **Railway**: Backend + Database ($5/month)
- **Vercel**: Frontend (Free tier)
- **Total cost**: $5/month

---

## 🎯 **Quick Start Commands**

### **Test Deployment Locally**
```bash
# Test production settings
python manage.py check --deploy --settings=model_builder.settings_production

# Test static files
python manage.py collectstatic --dry-run --settings=model_builder.settings_production

# Test frontend build
cd frontend && npm run build
```

### **Deploy to Production**
```bash
# 1. Commit all changes
git add .
git commit -m "Ready for deployment"
git push origin main

# 2. Deploy to Railway/Render
# Follow the platform-specific steps above

# 3. Test deployment
curl https://your-app.railway.app/api/
```

---

## 🏆 **Success Checklist**

- ✅ **Backend deployed** and accessible
- ✅ **Frontend loads** correctly
- ✅ **Database connected** and working
- ✅ **2D canvas functional** and interactive
- ✅ **3D visualization working**
- ✅ **Material calculator operational**
- ✅ **Export features working**
- ✅ **CORS configured** properly
- ✅ **Environment variables** set correctly

---

## 🆘 **Need Help?**

### **Platform Support**
- **Railway**: [docs.railway.app](https://docs.railway.app)
- **Render**: [render.com/docs](https://render.com/docs)
- **Vercel**: [vercel.com/docs](https://vercel.com/docs)

### **Django Support**
- **Django Docs**: [docs.djangoproject.com](https://docs.djangoproject.com)
- **Django REST Framework**: [django-rest-framework.org](https://django-rest-framework.org)

---

## 🎉 **Ready to Deploy?**

**Choose your strategy**:
- **Testing/Simple**: Use **All-in-One Railway deployment**
- **Production/Professional**: Use **Split deployment** (Railway + Vercel)

**Follow the steps above** and you'll have your Model-V6 system online in minutes!

**Good luck with your deployment! 🚀**
