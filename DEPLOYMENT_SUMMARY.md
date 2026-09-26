# AlphaWeb VPS Deployment - Updated Configuration

## Overview

I've updated the deployment configuration to properly use your existing `backend/.env` file structure. Here's what changed and how to deploy:

## Current Environment Setup

### Your Existing Configuration (backend/.env)
```bash
DATABASE_URL=postgresql://root:<REDACTED>@dpg-d3ai44qdbo4c738rug0g-a.oregon-postgres.render.com/alpha_database_qk9a
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
PORT=3000
NODE_ENV=development
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_SECURE=false
EMAIL_USER=482df1895e5b8f
EMAIL_PASS=<REDACTED>
EMAIL_FROM=AlphaWeb <no-reply@alphaweb.local>
OTP_SKIP_EXPIRY=true
OTP_GRACE_MS=300000
OTP_MASTER=000000
```

## Quick Deployment Guide

### 1. Prepare Environment Files

**Option A: Use the setup script (Recommended)**
```bash
chmod +x setup-env.sh
./setup-env.sh
```

**Option B: Manual setup**
```bash
# Copy the template to create production config
cp env.production.example backend/.env.production

# Create frontend environment
echo "NODE_ENV=production" > .env.production
echo "NEXT_PUBLIC_API_URL=http://YOUR_VPS_IP:5000" >> .env.production
```

### 2. Configure Production Settings

Edit `backend/.env.production` with these key changes:

```bash
# Change these for production security:
NODE_ENV=production
PORT=5000
JWT_SECRET=your_new_very_secure_production_jwt_secret

# Database options:
# Option 1: Use your existing Render database
DATABASE_URL=postgresql://root:<REDACTED>@dpg-d3ai44qdbo4c738rug0g-a.oregon-postgres.render.com/alpha_database_qk9a

# Option 2: Use local PostgreSQL (recommended for VPS)
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/alphacollect_db

# Email settings (update for production)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=true
EMAIL_USER=your-production-email@gmail.com
EMAIL_PASS=your-app-specific-password
EMAIL_FROM=AlphaWeb <no-reply@yourdomain.com>

# Security settings
OTP_SKIP_EXPIRY=false
# Remove OTP_MASTER for production
```

### 3. Deploy to VPS

```bash
# Upload your project to VPS
git clone https://github.com/yourusername/alphaweb.git
cd alphaweb

# Run automated deployment
chmod +x deploy.sh
./deploy.sh
```

## File Structure After Deployment

```
alphaweb/
├── .env.production                 # Frontend environment
├── backend/
│   ├── .env                       # Your original development config
│   ├── .env.production           # Production backend config
│   └── server.js
├── ecosystem.config.js            # PM2 configuration (updated)
├── nginx.conf                     # Nginx proxy configuration
├── deploy.sh                      # Automated deployment script
├── setup-env.sh                   # Environment setup helper
└── DEPLOYMENT.md                  # Detailed documentation
```

## Key Changes Made

### 1. Environment File Structure
- **Backend**: Uses `backend/.env.production` for production settings
- **Frontend**: Uses `.env.production` in root for Next.js configuration
- **PM2**: Updated to load `backend/.env.production` automatically

### 2. Database Options
You can choose between:
- **Your existing Render PostgreSQL** (no migration needed)
- **Local PostgreSQL on VPS** (recommended for performance)
- **Another cloud provider**

### 3. Security Improvements
- Generates new JWT secret for production
- Removes `OTP_MASTER` in production
- Sets proper production flags
- Disables OTP expiry skipping

## Access Your Application

After deployment:
- **Frontend**: `http://YOUR_VPS_IP` or `https://yourdomain.com`
- **Backend API**: `http://YOUR_VPS_IP/api` or direct routes
- **API Documentation**: `http://YOUR_VPS_IP/api-docs`
- **Health Check**: `http://YOUR_VPS_IP/health`

## Database Migration Options

### Option 1: Continue Using Render Database
- Keep your existing `DATABASE_URL` in production config
- No migration needed
- Your data remains intact

### Option 2: Migrate to Local PostgreSQL
- Set up PostgreSQL on your VPS
- Export data from Render: `pg_dump your_render_database > backup.sql`
- Import to local: `psql alphacollect_db < backup.sql`
- Update `DATABASE_URL` to local database

## Production Checklist

- [ ] Created `backend/.env.production` with secure settings
- [ ] Generated new JWT secret for production
- [ ] Configured production email SMTP settings
- [ ] Removed `OTP_MASTER` for security
- [ ] Updated `nginx.conf` with your VPS IP or domain
- [ ] Set up SSL certificate (optional but recommended)
- [ ] Tested all endpoints after deployment
- [ ] Configured firewall and security settings

## Troubleshooting

### Backend Issues
```bash
# Check backend logs
pm2 logs alphaweb-backend

# Check environment loading
cd backend && node -e "require('dotenv').config({path: '.env.production'}); console.log(process.env.DATABASE_URL)"
```

### Database Connection Issues
```bash
# Test database connection
psql "your_database_url_here"

# Check if database variables are loaded
pm2 show alphaweb-backend
```

### Environment Loading Issues
```bash
# Verify environment files exist
ls -la backend/.env*
ls -la .env*

# Check PM2 environment loading
pm2 restart alphaweb-backend --update-env
```

## Maintenance Commands

```bash
# Update application
git pull origin main
npm ci --production
cd backend && npm ci --production && cd ..
npm run build
pm2 restart all

# Check status
pm2 list
pm2 logs

# Monitor
pm2 monit
```

This setup maintains compatibility with your existing development environment while providing a secure, production-ready deployment configuration.
