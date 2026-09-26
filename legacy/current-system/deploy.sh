#!/bin/bash

# AlphaWeb Deployment Script for VPS
# This script automates the deployment process for Ubuntu/Debian VPS

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_error "This script should not be run as root. Please run as a regular user with sudo privileges."
        exit 1
    fi
}

# Update system packages
update_system() {
    print_status "Updating system packages..."
    sudo apt update && sudo apt upgrade -y
    print_success "System packages updated successfully"
}

# Install Node.js and npm
install_nodejs() {
    print_status "Installing Node.js and npm..."
    
    # Install Node.js 20.x
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    # Verify installation
    node_version=$(node --version)
    npm_version=$(npm --version)
    
    print_success "Node.js $node_version and npm $npm_version installed successfully"
}

# Install PostgreSQL
install_postgresql() {
    print_status "Installing PostgreSQL..."
    
    sudo apt install -y postgresql postgresql-contrib
    
    # Start and enable PostgreSQL
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
    
    print_success "PostgreSQL installed and started successfully"
    print_warning "Please configure PostgreSQL database manually:"
    echo "1. sudo -u postgres psql"
    echo "2. CREATE DATABASE alphacollect_db;"
    echo "3. CREATE USER your_username WITH ENCRYPTED PASSWORD 'your_password';"
    echo "4. GRANT ALL PRIVILEGES ON DATABASE alphacollect_db TO your_username;"
    echo "5. \\q"
}

# Install PM2 globally
install_pm2() {
    print_status "Installing PM2 process manager..."
    sudo npm install -g pm2
    print_success "PM2 installed successfully"
}

# Install and configure Nginx
install_nginx() {
    print_status "Installing and configuring Nginx..."
    
    sudo apt install -y nginx
    
    # Start and enable Nginx
    sudo systemctl start nginx
    sudo systemctl enable nginx
    
    # Backup default config
    sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup
    
    # Copy our Nginx configuration
    if [ -f "nginx.conf" ]; then
        sudo cp nginx.conf /etc/nginx/sites-available/alphaweb
        sudo ln -sf /etc/nginx/sites-available/alphaweb /etc/nginx/sites-enabled/
        sudo rm -f /etc/nginx/sites-enabled/default
    else
        print_error "nginx.conf file not found in current directory"
        exit 1
    fi
    
    # Test Nginx configuration
    sudo nginx -t
    
    # Reload Nginx
    sudo systemctl reload nginx
    
    print_success "Nginx installed and configured successfully"
}

# Install project dependencies
install_dependencies() {
    print_status "Installing project dependencies..."
    
    # Install frontend dependencies
    print_status "Installing frontend dependencies..."
    npm ci --production
    
    # Install backend dependencies
    print_status "Installing backend dependencies..."
    cd backend
    npm ci --production
    cd ..
    
    print_success "All dependencies installed successfully"
}

# Build the project
build_project() {
    print_status "Building the project..."
    
    # Build Next.js frontend
    npm run build
    
    print_success "Project built successfully"
}

# Setup environment variables
setup_environment() {
    print_status "Setting up environment variables..."
    
    # Check if backend/.env exists
    if [ ! -f "backend/.env" ]; then
        print_error "backend/.env file not found. Please ensure your project has the backend environment file."
        exit 1
    else
        print_success "Found backend/.env - will use for production deployment"
        
        # Update PORT and NODE_ENV for production in the existing file
        if grep -q "PORT=3000" backend/.env; then
            sed -i 's/PORT=3000/PORT=5000/' backend/.env
            print_status "Updated PORT from 3000 to 5000 for production"
        fi
        
        if grep -q "NODE_ENV=development" backend/.env; then
            sed -i 's/NODE_ENV=development/NODE_ENV=production/' backend/.env
            print_status "Updated NODE_ENV to production"
        fi
        
        print_warning "Review backend/.env to ensure JWT_SECRET is secure for production"
    fi
    
    # Setup frontend environment (root level)
    if [ ! -f ".env.production" ]; then
        cat > .env.production << EOF
NODE_ENV=production
NEXT_PUBLIC_API_URL=http://159.198.36.24
EOF
        print_status "Frontend environment file created with VPS IP."
        print_warning "If you have a domain, update NEXT_PUBLIC_API_URL in .env.production"
    else
        print_warning ".env.production already exists. Please verify it contains correct values."
    fi
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p logs
    mkdir -p backend/uploads
    
    print_success "Directories created successfully"
}

# Configure firewall
configure_firewall() {
    print_status "Configuring firewall..."
    
    # Enable UFW
    sudo ufw --force enable
    
    # Allow SSH
    sudo ufw allow ssh
    
    # Allow HTTP and HTTPS
    sudo ufw allow 80
    sudo ufw allow 443
    
    # Allow application ports (optional, since Nginx will proxy)
    # sudo ufw allow 3000
    # sudo ufw allow 5000
    
    print_success "Firewall configured successfully"
}

# Start applications with PM2
start_applications() {
    print_status "Starting applications with PM2..."
    
    # Stop any existing PM2 processes
    pm2 delete all 2>/dev/null || true
    
    # Start applications using ecosystem file
    if [ -f "ecosystem.config.js" ]; then
        pm2 start ecosystem.config.js --env production
        
        # Save PM2 configuration
        pm2 save
        
        # Setup PM2 to start on boot
        pm2 startup
        
        print_success "Applications started successfully with PM2"
    else
        print_error "ecosystem.config.js file not found"
        exit 1
    fi
}

# Setup SSL with Let's Encrypt (optional)
setup_ssl() {
    read -p "Do you want to setup SSL with Let's Encrypt? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Installing Certbot for Let's Encrypt..."
        
        sudo apt install -y certbot python3-certbot-nginx
        
        read -p "Enter your domain name: " domain_name
        
        if [ ! -z "$domain_name" ]; then
            # Update Nginx configuration with domain
            sudo sed -i "s/YOUR_DOMAIN/$domain_name/g" /etc/nginx/sites-available/alphaweb
            sudo nginx -t && sudo systemctl reload nginx
            
            # Obtain SSL certificate
            sudo certbot --nginx -d $domain_name -d www.$domain_name
            
            print_success "SSL certificate installed successfully"
        else
            print_warning "Domain name not provided. Skipping SSL setup."
        fi
    else
        print_warning "Skipping SSL setup"
    fi
}

# Function to display deployment status
show_status() {
    print_status "Deployment Status:"
    echo "===================="
    
    # Check PM2 status
    echo "PM2 Processes:"
    pm2 list
    
    # Check Nginx status
    echo -e "\nNginx Status:"
    sudo systemctl status nginx --no-pager -l
    
    # Check PostgreSQL status
    echo -e "\nPostgreSQL Status:"
    sudo systemctl status postgresql --no-pager -l
    
    # Show server info
    echo -e "\nServer Information:"
    echo "Frontend URL: http://$(curl -s ifconfig.me):80"
    echo "Backend API: http://$(curl -s ifconfig.me):80/api"
    echo "API Documentation: http://$(curl -s ifconfig.me):80/api-docs"
}

# Main deployment function
main() {
    print_status "Starting AlphaWeb deployment..."
    
    check_root
    
    # Create menu for deployment options
    echo "Select deployment option:"
    echo "1. Full deployment (recommended for first time)"
    echo "2. Update existing deployment"
    echo "3. Setup SSL only"
    echo "4. Show status only"
    
    read -p "Enter your choice (1-4): " choice
    
    case $choice in
        1)
            print_status "Starting full deployment..."
            update_system
            install_nodejs
            install_postgresql
            install_pm2
            install_nginx
            setup_environment
            create_directories
            install_dependencies
            build_project
            configure_firewall
            start_applications
            setup_ssl
            show_status
            print_success "Full deployment completed successfully!"
            ;;
        2)
            print_status "Starting update deployment..."
            install_dependencies
            build_project
            pm2 restart all
            show_status
            print_success "Update deployment completed successfully!"
            ;;
        3)
            setup_ssl
            ;;
        4)
            show_status
            ;;
        *)
            print_error "Invalid choice. Exiting."
            exit 1
            ;;
    esac
    
    print_success "Deployment process completed!"
    print_warning "Don't forget to:"
    echo "1. Configure your database credentials in .env.production"
    echo "2. Update your VPS IP or domain name in nginx.conf"
    echo "3. Setup your email credentials for OTP functionality"
    echo "4. Test your application thoroughly"
}

# Run main function
main "$@"
