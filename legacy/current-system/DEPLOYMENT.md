# AlphaWeb VPS Deployment Guide

This guide provides comprehensive instructions for deploying your AlphaWeb Next.js application with Express.js backend to a VPS server. The application will work with both IP address and domain name.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start with Automated Script](#quick-start-with-automated-script)
3. [Manual Deployment](#manual-deployment)
4. [Docker Deployment (Alternative)](#docker-deployment-alternative)
5. [Post-Deployment Configuration](#post-deployment-configuration)
6. [Troubleshooting](#troubleshooting)
7. [Maintenance](#maintenance)

## Prerequisites

### VPS Requirements
- Ubuntu 20.04+ or Debian 11+ (recommended)
- Minimum 2GB RAM, 2 CPU cores
- 20GB+ storage space
- Root or sudo access
- Public IP address

### Local Requirements
- Git installed
- SSH access to your VPS
- Domain name (optional but recommended)

## Quick Start with Automated Script

### 1. Clone and Prepare Your Project

```bash
# On your VPS server
git clone https://github.com/yourusername/alphaweb.git
cd alphaweb

# Make the deployment script executable (on Linux)
chmod +x deploy.sh
```

### 2. Run the Automated Deployment Script

```bash
# Run the deployment script
./deploy.sh
```

The script will guide you through:
- System updates
- Node.js installation
- PostgreSQL setup
- Nginx configuration
- SSL certificate setup (optional)
- Application deployment

### 3. Configure Environment Variables

```bash
# Edit the environment file with your actual values
nano .env.production
```

Update the following critical values:
- `DB_PASSWORD`: Your PostgreSQL password
- `JWT_SECRET`: A secure JWT secret key
- `EMAIL_*`: Your email configuration for OTP functionality
- `NEXT_PUBLIC_API_URL`: Your VPS IP or domain

## Manual Deployment

If you prefer manual control or the automated script doesn't work for your setup:

### 1. System Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install PM2 globally
sudo npm install -g pm2

# Install Nginx
sudo apt install -y nginx
```

### 2. Database Setup

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE alphacollect_db;
CREATE USER your_username WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE alphacollect_db TO your_username;
\q
```

### 3. Application Setup

```bash
# Clone your repository
git clone https://github.com/yourusername/alphaweb.git
cd alphaweb

# Install dependencies
npm ci --production
cd backend && npm ci --production && cd ..

# Create environment file
cp env.production.example .env.production
nano .env.production  # Edit with your values

# Create necessary directories
mkdir -p logs backend/uploads

# Build the frontend
npm run build
```

### 4. Nginx Configuration

```bash
# Copy Nginx configuration
sudo cp nginx.conf /etc/nginx/sites-available/alphaweb

# Update with your IP/domain
sudo sed -i 's/YOUR_VPS_IP/your.vps.ip.address/g' /etc/nginx/sites-available/alphaweb
sudo sed -i 's/YOUR_DOMAIN/yourdomain.com/g' /etc/nginx/sites-available/alphaweb

# Enable the site
sudo ln -sf /etc/nginx/sites-available/alphaweb /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Start Applications

```bash
# Start with PM2
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 6. Configure Firewall

```bash
# Enable firewall
sudo ufw enable

# Allow necessary ports
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
```

## Docker Deployment (Alternative)

For a containerized deployment:

### 1. Install Docker and Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Configure Environment

```bash
# Create environment file for Docker
cp env.production.example .env

# Edit with your values (especially database password)
nano .env
```

### 3. Deploy with Docker Compose

```bash
# Build and start all services
docker-compose up -d --build

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

## Post-Deployment Configuration

### 1. SSL Certificate Setup (Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

### 2. Database Migration

```bash
# Run database migrations (if needed)
cd backend
node migrations/migrate.js
```

### 3. Test Your Deployment

#### Check Services
```bash
# PM2 status
pm2 list

# Nginx status
sudo systemctl status nginx

# PostgreSQL status
sudo systemctl status postgresql
```

#### Test Endpoints
```bash
# Frontend
curl http://your-vps-ip

# Backend health check
curl http://your-vps-ip/health

# API documentation
curl http://your-vps-ip/api-docs
```

## Access Your Application

### Via IP Address
- Frontend: `http://YOUR_VPS_IP`
- Backend API: `http://YOUR_VPS_IP/api`
- API Documentation: `http://YOUR_VPS_IP/api-docs`

### Via Domain (if configured)
- Frontend: `https://yourdomain.com`
- Backend API: `https://yourdomain.com/api`
- API Documentation: `https://yourdomain.com/api-docs`

## Troubleshooting

### Common Issues

#### 1. Frontend Not Loading
```bash
# Check Next.js application
pm2 logs alphaweb-frontend

# Restart frontend
pm2 restart alphaweb-frontend
```

#### 2. Backend API Errors
```bash
# Check backend logs
pm2 logs alphaweb-backend

# Check database connection
sudo -u postgres psql -c "\l"
```

#### 3. Nginx Issues
```bash
# Test Nginx configuration
sudo nginx -t

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Restart Nginx
sudo systemctl restart nginx
```

#### 4. Database Connection Issues
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test database connection
psql -h localhost -U your_username -d alphacollect_db
```

### Logs Location
- PM2 Logs: `~/.pm2/logs/`
- Nginx Logs: `/var/log/nginx/`
- Application Logs: `./logs/`
- PostgreSQL Logs: `/var/log/postgresql/`

## Maintenance

### Regular Updates

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update your application
git pull origin main
npm ci --production
cd backend && npm ci --production && cd ..
npm run build
pm2 restart all
```

### Backup Database

```bash
# Create database backup
sudo -u postgres pg_dump alphacollect_db > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup
sudo -u postgres psql alphacollect_db < backup_file.sql
```

### Monitor Resources

```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check PM2 processes
pm2 monit
```

### SSL Certificate Renewal

SSL certificates from Let's Encrypt are automatically renewed, but you can manually check:

```bash
# Check certificate status
sudo certbot certificates

# Manual renewal
sudo certbot renew
```

## Security Best Practices

1. **Keep system updated**: Regular security updates
2. **Use strong passwords**: For database and JWT secrets
3. **Enable firewall**: Only allow necessary ports
4. **Use SSL**: Always use HTTPS in production
5. **Regular backups**: Database and application backups
6. **Monitor logs**: Watch for suspicious activities
7. **Limit file uploads**: Configure appropriate file size limits

## Performance Optimization

1. **Enable Gzip**: Already configured in Nginx
2. **Use CDN**: For static assets (optional)
3. **Database indexing**: Optimize database queries
4. **PM2 clustering**: Use multiple processes for high load
5. **Nginx caching**: Cache static content

## Support

If you encounter issues:

1. Check the logs for error messages
2. Verify all environment variables are set correctly
3. Ensure all services are running
4. Check firewall settings
5. Verify domain DNS settings (if using domain)

For additional help, refer to the troubleshooting section or check the application logs for specific error messages.
