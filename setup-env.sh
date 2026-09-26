#!/bin/bash

# Environment Setup Script for AlphaWeb
# This script helps configure environment variables for production deployment

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to generate a random JWT secret
generate_jwt_secret() {
    openssl rand -base64 64 | tr -d '\n'
}

# Main setup function
setup_backend_env() {
    print_status "Setting up backend environment variables..."
    
    # Copy template if backend/.env.production doesn't exist
    if [ ! -f "backend/.env.production" ]; then
        if [ -f "env.production.example" ]; then
            cp env.production.example backend/.env.production
            print_success "Backend environment template copied to backend/.env.production"
        else
            print_error "env.production.example template not found!"
            exit 1
        fi
    fi
    
    # Check if current development .env exists and offer to use some values
    if [ -f "backend/.env" ]; then
        print_status "Found existing backend/.env file."
        read -p "Do you want to copy some settings from your development environment? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Extract and preserve certain development settings
            if grep -q "SMTP_HOST" backend/.env; then
                SMTP_HOST=$(grep "SMTP_HOST=" backend/.env | cut -d'=' -f2-)
                sed -i "s|SMTP_HOST=.*|SMTP_HOST=$SMTP_HOST|" backend/.env.production
            fi
            if grep -q "EMAIL_USER" backend/.env; then
                EMAIL_USER=$(grep "EMAIL_USER=" backend/.env | cut -d'=' -f2-)
                sed -i "s|EMAIL_USER=.*|EMAIL_USER=$EMAIL_USER|" backend/.env.production
            fi
            if grep -q "EMAIL_PASS" backend/.env; then
                EMAIL_PASS=$(grep "EMAIL_PASS=" backend/.env | cut -d'=' -f2-)
                sed -i "s|EMAIL_PASS=.*|EMAIL_PASS=$EMAIL_PASS|" backend/.env.production
            fi
            print_success "Copied email settings from development environment"
        fi
    fi
    
    # Generate a new JWT secret for production
    JWT_SECRET=$(generate_jwt_secret)
    sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" backend/.env.production
    print_success "Generated new JWT secret for production"
    
    # Get VPS IP for configuration
    VPS_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_VPS_IP")
    
    # Setup database configuration
    echo ""
    print_status "Database Configuration"
    echo "Choose your database setup:"
    echo "1. Use local PostgreSQL database (recommended)"
    echo "2. Use existing cloud database (like your current Render setup)"
    echo "3. Keep current DATABASE_URL"
    
    read -p "Enter your choice (1-3): " db_choice
    
    case $db_choice in
        1)
            read -p "Enter database name [alphacollect_db]: " db_name
            db_name=${db_name:-alphacollect_db}
            
            read -p "Enter database username [postgres]: " db_user
            db_user=${db_user:-postgres}
            
            read -s -p "Enter database password: " db_pass
            echo
            
            DATABASE_URL="postgresql://$db_user:$db_pass@localhost:5432/$db_name"
            sed -i "s|DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" backend/.env.production
            print_success "Local database configuration set"
            ;;
        2)
            read -p "Enter your cloud database URL: " cloud_db_url
            sed -i "s|DATABASE_URL=.*|DATABASE_URL=$cloud_db_url|" backend/.env.production
            print_success "Cloud database configuration set"
            ;;
        3)
            print_warning "Keeping existing DATABASE_URL configuration"
            ;;
        *)
            print_warning "Invalid choice, keeping default configuration"
            ;;
    esac
    
    # Configure production settings
    sed -i "s|NODE_ENV=.*|NODE_ENV=production|" backend/.env.production
    sed -i "s|PORT=.*|PORT=5000|" backend/.env.production
    sed -i "s|OTP_SKIP_EXPIRY=.*|OTP_SKIP_EXPIRY=false|" backend/.env.production
    
    # Remove OTP_MASTER for security
    if grep -q "OTP_MASTER" backend/.env.production; then
        sed -i '/OTP_MASTER/d' backend/.env.production
        print_warning "Removed OTP_MASTER for production security"
    fi
    
    print_success "Backend environment configured in backend/.env.production"
}

# Setup frontend environment
setup_frontend_env() {
    print_status "Setting up frontend environment variables..."
    
    # Get VPS IP or domain
    VPS_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_VPS_IP")
    
    read -p "Do you have a domain name? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your domain name (without http/https): " domain_name
        API_URL="https://$domain_name"
    else
        API_URL="http://$VPS_IP:5000"
    fi
    
    # Create frontend environment file
    cat > .env.production << EOF
NODE_ENV=production
NEXT_PUBLIC_API_URL=$API_URL
EOF
    
    print_success "Frontend environment configured in .env.production"
    print_status "Frontend will connect to: $API_URL"
}

# Main function
main() {
    print_status "AlphaWeb Environment Setup"
    echo "================================"
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ] || [ ! -d "backend" ]; then
        print_error "Please run this script from the AlphaWeb root directory"
        exit 1
    fi
    
    setup_backend_env
    echo ""
    setup_frontend_env
    
    echo ""
    print_success "Environment setup completed!"
    echo ""
    print_warning "Important next steps:"
    echo "1. Review and edit backend/.env.production if needed"
    echo "2. Configure your email SMTP settings for production use"
    echo "3. Set up your production database"
    echo "4. Update nginx.conf with your VPS IP or domain"
    echo "5. Run ./deploy.sh to deploy your application"
    
    echo ""
    print_status "Configuration Summary:"
    echo "- Backend config: backend/.env.production"
    echo "- Frontend config: .env.production"
    echo "- Generated new JWT secret for security"
    echo "- Removed development-only settings"
}

# Run main function
main "$@"
