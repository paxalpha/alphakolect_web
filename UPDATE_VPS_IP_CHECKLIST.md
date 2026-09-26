# VPS IP Update Checklist - 159.198.36.24

## Files That Need VPS IP Updates

### ✅ ALREADY UPDATED
1. **`services/api.tsx`** - ✅ FIXED
   - Line 1: `BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'`
   - Now uses environment variable for production

2. **`nginx.conf`** - ✅ FIXED
   - Line 7: `server_name 159.198.36.24;`

3. **`deploy.sh`** - ✅ FIXED  
   - Line 176: `NEXT_PUBLIC_API_URL=http://159.198.36.24`

### 🔧 NEEDS MANUAL UPDATE

4. **`backend/server.js`** - ⚠️ NEEDS UPDATE
   - **Line 75**: `url: 'http://localhost:3000',` (Swagger API docs server URL)
   - **Should be**: `url: 'http://159.198.36.24',`
   - **Purpose**: Sets the base URL for API documentation

## Files That Are Environment-Driven (No Changes Needed)

### ✅ ALREADY CONFIGURED CORRECTLY
- **`backend/models/index.js`** - Uses `process.env.DATABASE_URL` ✅
- **`backend/server.js`** - Uses `process.env.PORT` ✅  
- **Frontend components** - All use `services/api.tsx` ✅
- **All API calls** - Go through `BASE_URL` from `services/api.tsx` ✅

## How Environment Variables Work

### Development (Local)
```bash
# No .env.production file
NEXT_PUBLIC_API_URL = undefined
BASE_URL = 'http://localhost:3000'  # Fallback
```

### Production (VPS)
```bash
# .env.production (created by deploy.sh)
NEXT_PUBLIC_API_URL = 'http://159.198.36.24'
BASE_URL = 'http://159.198.36.24'  # From environment
```

### Backend Environment
```bash
# backend/.env (your existing file, modified by deploy.sh)
PORT = 5000                     # Changed from 3000
NODE_ENV = production           # Changed from development
DATABASE_URL = your_database    # Stays same
# ... all other settings stay the same
```

## Summary

### ✅ What's Already Working:
- Frontend API calls will use correct VPS IP in production
- Backend runs on correct port (5000)
- Nginx routing configured for VPS IP
- Environment variables properly configured

### ⚠️ What Still Needs Fix:
- **Swagger documentation base URL** in backend/server.js

### 🎯 Production URLs After Deployment:
- **Frontend**: `http://159.198.36.24`
- **API Health**: `http://159.198.36.24/health`  
- **API Docs**: `http://159.198.36.24/api-docs`
- **All API Endpoints**: `http://159.198.36.24/api/*`

## Final Update Needed

Only **1 file** needs manual update:
```javascript
// backend/server.js line 75
// Change from:
url: 'http://localhost:3000',

// Change to:
url: 'http://159.198.36.24',
```

This ensures the Swagger API documentation shows the correct server URL for testing.
