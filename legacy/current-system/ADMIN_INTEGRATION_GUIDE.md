# Admin Backend Integration Guide

This document explains how the admin frontend has been connected to the main backend and how the admin-backend functionality has been merged.

## Changes Made

### 1. Backend Consolidation

#### Models Added to Main Backend (`backend/models/`)

- **SuperAdmin.js** - Super admin authentication and management
- **activity.js** - Activity tracking for merchants, agents, and staff
- **plan.js** - Subscription plans management

#### Controllers Added

- **superAdminController.js** - All super admin functionality copied from admin-backend

#### Middleware Updates (`backend/middleware/auth.js`)

- Added `requireSuperAdmin` middleware for super admin route protection
- Supports both `super_admin` and `superadmin` role values

#### Routes Added to Main Backend (`backend/server.js`)

All super admin routes are now available on the main backend:

**Authentication:**

- `POST /superadmin/login` - Super admin login

**Dashboard & Stats:**

- `GET /superadmin/superStats` - Get overall statistics
- `GET /superadmin/merchantStats` - Get merchant registration stats

**Data Management:**

- `GET /superadmin/allActivities` - Get all activities
- `GET /superadmin/allMerchants` - Get all merchants
- `GET /superadmin/allTransactions` - Get all transactions

**Plans Management:**

- `POST /superadmin/createPlan` - Create subscription plan
- `GET /superadmin/getAllPlans` - Get all plans

**Roles & Permissions:**

- `POST /superadmin/createRole` - Create admin role
- `GET /superadmin/getAllPermissions` - Get all permissions
- `GET /superadmin/getAllRoles` - Get all roles

**Admin Staff:**

- `POST /superadmin/createAdminStaff` - Create admin staff
- `GET /superadmin/getAllAdminStaff` - Get all admin staff

**Logs:**

- `GET /superAdmin/logs` - Get all admin logs
- `GET /superAdmin/logs/:staffId` - Get logs by staff ID

### 2. Frontend Integration

#### API Utility Created (`src/app/admin/utilis/adminApi.ts`)

- Centralized API client for all super admin endpoints
- Automatic token management (localStorage)
- Type-safe request/response handling
- Helper functions for authentication

#### Admin Login Updated (`src/app/admin/page.tsx`)

- Now connects to `/superadmin/login` endpoint
- Stores JWT token in localStorage
- Redirects to dashboard on successful login
- Improved error handling

#### Admin Dashboard Updated (`src/app/admin/dashboard/page.tsx`)

- Fetches real data from backend API
- Uses React Query for data fetching and caching
- Displays actual merchant statistics
- Shows loading states

## Setup Instructions

### 1. Environment Configuration

Create a `.env.local` file in the root directory:

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:5000

# For production, update to your backend URL
# NEXT_PUBLIC_API_URL=https://your-backend-domain.com
```

### 2. Database Setup

The new models need to be added to your database. You have two options:

#### Option A: Create Migration (Recommended)

```bash
cd backend
npx sequelize-cli migration:generate --name add-super-admin-models
```

Then edit the migration file to create the tables:

- `super_admins`
- `activities`
- `plans`

#### Option B: Auto-sync (Development Only)

Temporarily enable sync in `backend/server.js`:

```javascript
db.sequelize.sync({ alter: true }).then(() => {
  console.log("Database synchronized successfully.");
});
```

### 3. Create Super Admin User

You need to create at least one super admin user. Run this SQL or create a seeder:

```sql
INSERT INTO super_admins (name, email, password, role, created_at, updated_at)
VALUES (
  'System Admin',
  'admin@alphaweb.com',
  -- Use bcrypt to hash your password
  '$2a$10$...',
  'superadmin',
  NOW(),
  NOW()
);
```

Or use this Node.js script:

```javascript
const bcrypt = require("bcryptjs");
const db = require("./backend/models");

async function createSuperAdmin() {
  const hashedPassword = await bcrypt.hash("YourSecurePassword123!", 10);

  await db.SuperAdmin.create({
    name: "System Admin",
    email: "admin@alphaweb.com",
    password: hashedPassword,
    role: "superadmin",
  });

  console.log("Super admin created successfully!");
}

createSuperAdmin();
```

### 4. Start the Servers

#### Start Backend (Port 5000)

```bash
cd backend
npm run dev
```

#### Start Frontend (Port 3000)

```bash
# From root directory
npm run dev
```

### 5. Access Admin Panel

1. Navigate to `http://localhost:3000/admin`
2. Login with your super admin credentials
3. You'll be redirected to the dashboard at `http://localhost:3000/admin/dashboard`

## API Authentication

All protected super admin routes require a JWT token in the Authorization header:

```javascript
Authorization: Bearer <your-jwt-token>
```

The admin frontend automatically handles this using the `adminApi.ts` utility.

## Testing the Integration

### 1. Test Login

```bash
curl -X POST http://localhost:5000/superadmin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@alphaweb.com","password":"YourPassword"}'
```

### 2. Test Protected Route

```bash
curl http://localhost:5000/superadmin/superStats \
  -H "Authorization: Bearer <your-token>"
```

## Migration from Admin-Backend

The `admin-backend` folder can now be safely archived or removed since all functionality has been merged into the main `backend`. However, keep it temporarily for reference until you've verified all features work correctly.

### What Was Merged:

✅ SuperAdmin model and authentication
✅ All super admin controllers
✅ Activity tracking
✅ Plan management
✅ Admin roles and permissions
✅ Admin staff management
✅ Audit logs

### What Remains Separate:

- The frontend admin panel (`src/app/admin/`) - This is part of the main Next.js app
- Swagger documentation is now in the main backend

## Troubleshooting

### Issue: "Access token is required"

- Make sure you're logged in and the token is stored in localStorage
- Check that the Authorization header is being sent

### Issue: "Access denied. SuperAdmin role required"

- Verify your super admin user has role set to 'superadmin' or 'super_admin'
- Check that the JWT token contains the correct role

### Issue: "Cannot connect to backend"

- Verify backend is running on port 5000
- Check NEXT_PUBLIC_API_URL in .env.local
- Ensure CORS is properly configured in backend

### Issue: Database errors

- Run migrations to create new tables
- Verify database connection in backend/.env

## Next Steps

1. ✅ Test all super admin endpoints
2. ✅ Verify authentication flow
3. ✅ Update other admin pages to use the API
4. ✅ Add error boundaries and loading states
5. ✅ Implement proper logout functionality
6. ✅ Add protected route middleware on frontend
7. ✅ Set up production environment variables

## Security Considerations

- Always use HTTPS in production
- Store JWT_SECRET securely (never commit to git)
- Implement token refresh mechanism
- Add rate limiting to login endpoint
- Use strong password requirements
- Implement account lockout after failed attempts
- Add audit logging for all admin actions

## Production Deployment

When deploying to production:

1. Update `NEXT_PUBLIC_API_URL` to your production backend URL
2. Set strong `JWT_SECRET` in backend environment
3. Enable SSL/TLS for all connections
4. Configure proper CORS origins (not "\*")
5. Set up database backups
6. Enable logging and monitoring
7. Use environment-specific configurations

---

**Last Updated:** January 3, 2026
**Version:** 1.0.0
