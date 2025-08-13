# 🚀 Deployment Checklist

## Pre-Deployment Checklist

### ✅ Code Preparation
- [ ] All deployment files are committed to Git
- [ ] API configuration updated for production
- [ ] Environment variables documented
- [ ] Production settings configured
- [ ] Static files configuration ready

### ✅ Dependencies
- [ ] `requirements.txt` created and updated
- [ ] `package.json` has all necessary dependencies
- [ ] Python version specified in `runtime.txt`
- [ ] Node.js version compatible (18+)

### ✅ Configuration Files
- [ ] `Procfile` created for Railway/Render
- [ ] `settings_production.py` configured
- [ ] `wsgi_production.py` created
- [ ] CORS settings configured
- [ ] Database settings ready for environment variables

### ✅ Frontend Build
- [ ] React app builds successfully locally
- [ ] Build script (`build.sh`) created
- [ ] Static files collection configured
- [ ] Template directory created for Django

## Deployment Steps

### 1. Railway Deployment (Recommended for Testing)
- [ ] Sign up at [railway.app](https://railway.app)
- [ ] Connect GitHub repository
- [ ] Add PostgreSQL database
- [ ] Set environment variables
- [ ] Configure build and start commands
- [ ] Deploy and test

### 2. Render Deployment (Alternative)
- [ ] Sign up at [render.com](https://render.com)
- [ ] Create web service
- [ ] Connect repository
- [ ] Add PostgreSQL database
- [ ] Configure build and start commands
- [ ] Deploy and test

## Post-Deployment Testing

### ✅ Backend Health Check
- [ ] API endpoints accessible
- [ ] Database connection working
- [ ] Admin panel accessible
- [ ] CORS working properly

### ✅ Frontend Functionality
- [ ] React app loads correctly
- [ ] 2D canvas working
- [ ] 3D visualization working
- [ ] Material calculator functional
- [ ] Export features working

### ✅ User Experience
- [ ] Navigation working
- [ ] Forms submitting correctly
- [ ] Data persistence working
- [ ] Error handling working

## Environment Variables to Set

```
SECRET_KEY=your-super-secret-key-here
DEBUG=False
ALLOWED_HOSTS=your-app-name.railway.app
DB_NAME=your-db-name
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_HOST=your-db-host
DB_PORT=5432
CORS_ALLOWED_ORIGINS=https://your-app-name.railway.app
```

## Quick Commands

```bash
# Test build locally
./deploy.sh

# Check if everything is ready
python manage.py check --deploy

# Test static files
python manage.py collectstatic --dry-run

# Test production settings
python manage.py runserver --settings=model_builder.settings_production
```

## Troubleshooting

- **Build fails**: Check Python/Node.js versions
- **Database issues**: Verify environment variables
- **Static files**: Run `collectstatic` locally first
- **CORS errors**: Check `CORS_ALLOWED_ORIGINS` format

## Success Indicators

✅ Your app is accessible via a public URL  
✅ Testers can access the system with a single click  
✅ All features work as expected  
✅ Database operations are working  
✅ Export functionality is operational  

---

**Ready to deploy?** Follow the `DEPLOYMENT.md` guide for detailed steps!
