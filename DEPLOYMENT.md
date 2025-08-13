# Model-V6 Deployment Guide

This guide will help you deploy your Model-V6 system online for testing and production use.

## Prerequisites

1. **GitHub Repository**: Your code should be in a GitHub repository
2. **Python 3.11+**: Ensure you have Python 3.11 or higher
3. **Node.js 18+**: For building the React frontend
4. **PostgreSQL Database**: You'll need a cloud database

## Option 1: Deploy to Railway (Recommended for Testing)

Railway offers a generous free tier and is perfect for testing deployments.

### Step 1: Prepare Your Repository

1. **Update API Configuration**: 
   - Replace `frontend/src/api/api.js` with `frontend/src/api/api_production.js`
   - Or update the existing file to use the production logic

2. **Commit and Push Changes**:
   ```bash
   git add .
   git commit -m "Add deployment configuration"
   git push origin main
   ```

### Step 2: Deploy to Railway

1. **Visit [Railway.app](https://railway.app)** and sign up with GitHub
2. **Create New Project** → "Deploy from GitHub repo"
3. **Select Your Repository**
4. **Add Environment Variables**:
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

5. **Add PostgreSQL Database**:
   - Click "New" → "Database" → "PostgreSQL"
   - Railway will automatically set the database environment variables

6. **Deploy**: Railway will automatically build and deploy your app

### Step 3: Configure Frontend Build

1. **Add Build Command** in Railway:
   ```
   cd frontend && npm install && npm run build && cd .. && python manage.py collectstatic --noinput
   ```

2. **Set Start Command**:
   ```
   gunicorn model_builder.wsgi_production:application --bind 0.0.0.0:$PORT --workers 2 --timeout 120
   ```

## Option 2: Deploy to Render

Render also offers a free tier and is great for production deployments.

### Step 1: Prepare Your Repository

Same as Railway preparation.

### Step 2: Deploy to Render

1. **Visit [Render.com](https://render.com)** and sign up with GitHub
2. **Create New Web Service** → "Connect your repository"
3. **Configure Service**:
   - **Name**: `model-v6-backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt && cd frontend && npm install && npm run build && cd .. && python manage.py collectstatic --noinput`
   - **Start Command**: `gunicorn model_builder.wsgi_production:application --bind 0.0.0.0:$PORT --workers 2 --timeout 120`

4. **Add Environment Variables** (same as Railway)
5. **Add PostgreSQL Database**:
   - Create new PostgreSQL service
   - Link it to your web service

### Step 3: Deploy Frontend Separately

1. **Create Static Site** in Render
2. **Connect Frontend Repository**
3. **Build Command**: `npm install && npm run build`
4. **Publish Directory**: `build`

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `SECRET_KEY` | Django secret key | `your-super-secret-key-here` |
| `DEBUG` | Debug mode | `False` |
| `ALLOWED_HOSTS` | Allowed hostnames | `your-app.railway.app` |
| `DB_NAME` | Database name | `model_builder_prod` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | `your-password` |
| `DB_HOST` | Database host | `your-db-host` |
| `DB_PORT` | Database port | `5432` |
| `CORS_ALLOWED_ORIGINS` | Allowed CORS origins | `https://your-app.railway.app` |

## Testing Your Deployment

1. **Check Backend Health**: Visit `https://your-app.railway.app/api/`
2. **Test Frontend**: Visit your app URL
3. **Verify Database**: Check if you can create projects and walls
4. **Test 2D/3D Features**: Ensure canvas functionality works

## Troubleshooting

### Common Issues

1. **Build Failures**:
   - Check Python/Node.js versions
   - Verify all dependencies are in requirements.txt
   - Check build logs for specific errors

2. **Database Connection Issues**:
   - Verify database environment variables
   - Check if database is accessible from your deployment region
   - Ensure database exists and is running

3. **Static Files Not Loading**:
   - Run `python manage.py collectstatic` locally first
   - Check STATIC_ROOT and STATIC_URL settings
   - Verify whitenoise is properly configured

4. **CORS Issues**:
   - Check CORS_ALLOWED_ORIGINS format
   - Ensure frontend and backend URLs are correct
   - Verify CORS middleware is enabled

### Debug Mode

For troubleshooting, temporarily set `DEBUG=True` in environment variables.

## Security Considerations

1. **Never commit sensitive data** like database passwords
2. **Use strong SECRET_KEY** in production
3. **Enable HTTPS** when possible
4. **Regularly update dependencies**
5. **Monitor application logs**

## Next Steps After Deployment

1. **Set up monitoring** (Railway/Render provide basic monitoring)
2. **Configure custom domain** if needed
3. **Set up CI/CD pipeline** for automatic deployments
4. **Add SSL certificates** for production use
5. **Set up backup strategies** for your database

## Support

- **Railway**: [docs.railway.app](https://docs.railway.app)
- **Render**: [render.com/docs](https://render.com/docs)
- **Django**: [docs.djangoproject.com](https://docs.djangoproject.com)

Your Model-V6 system will be accessible via a simple URL that you can share with testers!
