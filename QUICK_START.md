# Admin Backend Integration - Quick Start Guide

## ✅ What Has Been Done

1. **Backend Consolidation**

   - ✅ Copied SuperAdmin model to main backend
   - ✅ Copied Activity and Plan models to main backend
   - ✅ Copied superAdminController to main backend
   - ✅ Added requireSuperAdmin middleware
   - ✅ Added all super admin routes to main backend server.js
   - ✅ Updated models/index.js to include new models

2. **Frontend Integration**

   - ✅ Created adminApi.ts utility for API calls
   - ✅ Updated admin login page to connect to backend
   - ✅ Updated admin dashboard to fetch real data
   - ✅ Added token management (localStorage)

3. **Documentation**
   - ✅ Created comprehensive integration guide
   - ✅ Created environment configuration guide
   - ✅ Created database migration file
   - ✅ Created super admin creation script

## 🚀 Quick Setup (5 Steps)

### Step 1: Create Environment File

```bash
# Create .env.local in the root directory
echo "NEXT_PUBLIC_API_URL=http://localhost:5000" > .env.local
```

### Step 2: Run Database Migration

```bash
cd backend
npx sequelize-cli db:migrate
```

### Step 3: Create Super Admin User

```bash
cd backend
node create-super-admin.js
```

Follow the prompts to create your first super admin user.

### Step 4: Start Backend Server

```bash
cd backend
npm run dev
```

Backend will run on http://localhost:5000

### Step 5: Start Frontend Server

```bash
# From root directory
npm run dev
```

Frontend will run on http://localhost:3000

## 🎯 Test the Integration

1. **Open Admin Login**

   - Navigate to: http://localhost:3000/admin

2. **Login**

   - Use the credentials you created in Step 3

3. **View Dashboard**
   - You should be redirected to: http://localhost:3000/admin/dashboard
   - Dashboard should show real merchant statistics

## 📋 Available API Endpoints

All endpoints are now on the main backend (port 5000):

### Public Endpoints

- `POST /superadmin/login` - Super admin login

### Protected Endpoints (require JWT token)

- `GET /superadmin/superStats` - Dashboard statistics
- `GET /superadmin/merchantStats?duration=Last 3 months` - Merchant stats
- `GET /superadmin/allActivities` - All activities
- `GET /superadmin/allMerchants` - All merchants
- `GET /superadmin/allTransactions` - All transactions
- `POST /superadmin/createPlan` - Create subscription plan
- `GET /superadmin/getAllPlans` - Get all plans
- And more... (see ADMIN_INTEGRATION_GUIDE.md)

## 🧪 Test with cURL

### Login

```bash
curl -X POST http://localhost:5000/superadmin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@example.com","password":"your-password"}'
```

### Get Stats (replace TOKEN with your JWT)

```bash
curl http://localhost:5000/superadmin/superStats \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## 📁 File Structure

```
Alphaweb-main/
├── backend/
│   ├── controllers/
│   │   └── superAdminController.js ✅ (copied from admin-backend)
│   ├── models/
│   │   ├── SuperAdmin.js ✅ (new)
│   │   ├── activity.js ✅ (new)
│   │   └── plan.js ✅ (new)
│   ├── middleware/
│   │   └── auth.js ✅ (updated with requireSuperAdmin)
│   ├── migrations/
│   │   └── 20260103120000-add-super-admin-tables.js ✅ (new)
│   ├── server.js ✅ (updated with super admin routes)
│   └── create-super-admin.js ✅ (new helper script)
│
├── src/app/admin/
│   ├── utilis/
│   │   └── adminApi.ts ✅ (new API client)
│   ├── page.tsx ✅ (updated login)
│   └── dashboard/
│       └── page.tsx ✅ (updated with API calls)
│
├── .env.local ⚠️ (you need to create this)
├── ADMIN_INTEGRATION_GUIDE.md ✅ (detailed guide)
├── ENV_CONFIG.md ✅ (environment setup)
└── QUICK_START.md ✅ (this file)
```

## ⚠️ Important Notes

1. **The admin-backend folder is now redundant** - All functionality has been merged into the main backend. You can archive or delete it after verifying everything works.

2. **Database Migration Required** - You MUST run the migration to create the new tables before using the admin panel.

3. **Environment Variables** - Make sure to create `.env.local` with the API URL.

4. **JWT Secret** - Ensure your backend has a strong JWT_SECRET in its .env file.

## 🔧 Troubleshooting

### "Cannot connect to backend"

- Check if backend is running on port 5000
- Verify NEXT_PUBLIC_API_URL in .env.local
- Check browser console for CORS errors

### "Access token is required"

- Make sure you're logged in
- Check if token is stored in localStorage (browser DevTools → Application → Local Storage)

### "Table doesn't exist"

- Run the migration: `cd backend && npx sequelize-cli db:migrate`

### "Invalid credentials"

- Verify you created a super admin user
- Check the email and password you're using

## 📚 Next Steps

1. Read the full guide: `ADMIN_INTEGRATION_GUIDE.md`
2. Update other admin pages to use the API
3. Add protected route middleware on frontend
4. Implement logout functionality
5. Add error boundaries and better loading states
6. Set up production environment

## 🎉 Success Checklist

- [ ] Backend running on port 5000
- [ ] Frontend running on port 3000
- [ ] Database migration completed
- [ ] Super admin user created
- [ ] Can login at /admin
- [ ] Dashboard shows real data
- [ ] API calls work in browser network tab

---

**Need Help?** Check the detailed guide in `ADMIN_INTEGRATION_GUIDE.md`

**Last Updated:** January 3, 2026
