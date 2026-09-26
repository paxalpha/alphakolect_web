# Environment Setup Complete! 🎉

## ✅ Files Created

1. **`backend/.env`** - Backend environment variables with your database configuration
2. **`.env.local`** - Frontend environment variables for Next.js

## 📋 Environment Variables Summary

### Backend (.env)

#### Database Configuration

- ✅ **DATABASE_URL** - Connected to your Render PostgreSQL database
  - Database: `alphadb_y2ju`
  - Host: `dpg-d5chbk95pdvs73cd5qo0-a.virginia-postgres.render.com`
  - User: `alphadb_y2ju_user`
  - SSL: Enabled

#### Server Configuration

- **PORT**: 5000
- **NODE_ENV**: development

#### Authentication

- **JWT_SECRET**: Configured (⚠️ Change in production!)

#### Email Configuration (SMTP)

- **SMTP_HOST**: smtp.gmail.com
- **SMTP_PORT**: 587
- **EMAIL_USER**: ⚠️ Update with your email
- **EMAIL_PASS**: ⚠️ Update with your app password
- **EMAIL_DISABLED**: false

#### OTP Configuration

- **OTP_SKIP_EXPIRY**: false
- **OTP_GRACE_MS**: 120000 (2 minutes)

#### CORS

- **CORS_ORIGIN**: http://localhost:3000,http://localhost:5000

### Frontend (.env.local)

- **NEXT_PUBLIC_API_URL**: http://localhost:5000

## 🔧 Required Actions

### 1. Update Email Configuration (Optional but Recommended)

If you want email functionality (password reset, OTP), update these in `backend/.env`:

```env
EMAIL_USER=your-actual-email@gmail.com
EMAIL_PASS=your-gmail-app-specific-password
```

**How to get Gmail App Password:**

1. Go to Google Account Settings
2. Enable 2-Factor Authentication
3. Go to Security → App Passwords
4. Generate a new app password for "Mail"
5. Copy the 16-character password

**Or disable emails during development:**

```env
EMAIL_DISABLED=true
```

### 2. Update JWT Secret for Production

For production, generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Then update `JWT_SECRET` in `backend/.env`

## 🚀 Next Steps

### Step 1: Run Database Migration

The database tables need to be created. Run the migration:

```bash
cd backend
npx sequelize-cli db:migrate
```

This will create all necessary tables including:

- `super_admins`
- `activities`
- `plans`
- `merchants`
- `agents`
- `customers`
- And all other tables

### Step 2: Create Super Admin User

Create your first super admin account:

```bash
cd backend
node create-super-admin.js
```

Follow the prompts to enter:

- Name
- Email
- Password (minimum 8 characters)

### Step 3: Start Backend Server

```bash
cd backend
npm run dev
```

Expected output:

```
Database connection has been established successfully.
Server is running on port 5000
```

### Step 4: Start Frontend Server

In a new terminal:

```bash
# From root directory
npm run dev
```

Expected output:

```
ready - started server on 0.0.0.0:3000
```

### Step 5: Test the Application

1. **Open browser**: http://localhost:3000/admin
2. **Login** with the super admin credentials you created
3. **Verify** dashboard shows real data from your database

## 🧪 Verify Database Connection

Test the database connection:

```bash
cd backend
node -e "require('dotenv').config(); const {Sequelize} = require('sequelize'); const seq = new Sequelize(process.env.DATABASE_URL, {dialect:'postgres', dialectOptions:{ssl:{require:true,rejectUnauthorized:false}}}); seq.authenticate().then(() => console.log('✅ Database connected!')).catch(e => console.error('❌ Error:', e.message));"
```

Expected output:

```
✅ Database connected!
```

## 📊 Database Information

Your database is hosted on **Render** with the following details:

- **Database Name**: alphadb_y2ju
- **Host**: dpg-d5chbk95pdvs73cd5qo0-a.virginia-postgres.render.com
- **Port**: 5432
- **SSL**: Required (already configured)

## ⚠️ Important Security Notes

### For Development

- ✅ Current configuration is suitable for development
- ✅ Database credentials are in `.env` (gitignored)

### For Production

1. **Change JWT_SECRET** to a strong, unique value
2. **Update EMAIL credentials** if using email features
3. **Set NODE_ENV=production** in backend/.env
4. **Update CORS_ORIGIN** to your production frontend URL
5. **Update NEXT_PUBLIC_API_URL** to your production backend URL
6. **Never commit `.env` files** to version control

## 🔍 Troubleshooting

### Database Connection Issues

**Error: "Connection refused"**

- Check if DATABASE_URL is correct in `backend/.env`
- Verify your IP is whitelisted on Render (if applicable)
- Ensure SSL is enabled

**Error: "password authentication failed"**

- Verify database credentials are correct
- Check if password contains special characters (should be URL-encoded in DATABASE_URL)

### Migration Issues

**Error: "relation already exists"**

- Some tables may already exist
- Check which tables exist: `npx sequelize-cli db:migrate:status`
- You can skip existing migrations or drop and recreate

### Email Issues

**Error: "Invalid login"**

- Verify EMAIL_USER and EMAIL_PASS are correct
- Use Gmail App Password, not regular password
- Or set EMAIL_DISABLED=true to skip emails

### Frontend Connection Issues

**Error: "Failed to fetch"**

- Verify backend is running on port 5000
- Check NEXT_PUBLIC_API_URL in `.env.local`
- Restart frontend server after changing `.env.local`

## 📁 File Locations

```
Alphaweb-main/
├── backend/
│   └── .env                    ✅ Backend configuration
├── .env.local                  ✅ Frontend configuration
└── ENV_SETUP_COMPLETE.md       ✅ This file
```

## ✅ Checklist

- [x] Created `backend/.env` with database configuration
- [x] Created `.env.local` with API URL
- [x] Database credentials configured
- [x] JWT secret configured
- [ ] Run database migration
- [ ] Create super admin user
- [ ] Update email configuration (optional)
- [ ] Start backend server
- [ ] Start frontend server
- [ ] Test login and verify data

## 🎉 You're Ready!

Your environment is now configured with:

- ✅ Database connection to Render PostgreSQL
- ✅ Backend environment variables
- ✅ Frontend API configuration
- ✅ Security settings

**Next:** Follow the steps above to run migrations and start the servers!

---

**Need Help?** Check the troubleshooting section above or refer to:

- [QUICK_START.md](./QUICK_START.md)
- [ADMIN_INTEGRATION_GUIDE.md](./ADMIN_INTEGRATION_GUIDE.md)
- [VERIFICATION_CHECKLIST.md](./VERIFICATION_CHECKLIST.md)

**Last Updated:** January 3, 2026
