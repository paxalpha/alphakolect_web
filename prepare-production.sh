#!/bin/bash

# Simple script to prepare your existing backend/.env for production use
# This makes minimal changes to your working configuration

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_status "Preparing your existing backend/.env for production deployment..."

# Backup original file
cp backend/.env backend/.env.backup
print_success "Backup created: backend/.env.backup"

# Update only the necessary production settings
sed -i 's/PORT=3000/PORT=5000/' backend/.env
sed -i 's/NODE_ENV=development/NODE_ENV=production/' backend/.env

print_status "Updated settings:"
echo "  - PORT: 3000 → 5000"
echo "  - NODE_ENV: development → production"

# Create frontend environment
cat > .env.production << EOF
NODE_ENV=production
NEXT_PUBLIC_API_URL=http://localhost:5000
EOF

print_status "Created frontend environment: .env.production"

echo ""
print_success "Your environment is ready for production!"
echo ""
print_warning "Manual steps (optional but recommended):"
echo "1. Update JWT_SECRET in backend/.env to a more secure value"
echo "2. Update NEXT_PUBLIC_API_URL in .env.production with your VPS IP/domain"
echo "3. Consider updating email settings for production use"
echo ""
print_status "Your current configuration:"
echo "✓ Database: Using your existing Render PostgreSQL"
echo "✓ Email: Using your current SMTP settings"
echo "✓ OTP: Using your current OTP configuration"
echo ""
print_status "To deploy: run ./deploy.sh"
