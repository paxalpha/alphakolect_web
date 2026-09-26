# Testing Frontend-Backend Communication

## Your VPS IP: 159.198.36.24

After deployment, here's how everything will work:

## 🌐 **Access Points**

### Frontend (Next.js App)
- **URL**: `http://159.198.36.24`
- **What happens**: Nginx serves your React/Next.js frontend from port 3000

### Backend API
- **Direct API**: `http://159.198.36.24/health`
- **API Docs**: `http://159.198.36.24/api-docs`
- **All API routes**: `http://159.198.36.24/api/*`

## 🔄 **Communication Flow**

```
User Browser
    ↓
http://159.198.36.24 (Nginx on port 80)
    ↓
Nginx routes to:
├── Frontend (port 3000) - for webpage requests
└── Backend (port 5000) - for API requests
```

## 📡 **Frontend API Configuration**

Your frontend will be configured to make API calls to:
```javascript
// In your Next.js app
const API_URL = "http://159.198.36.24"  // No port needed!

// API calls will go to:
fetch(`${API_URL}/api/auth/login`)     // → Backend port 5000
fetch(`${API_URL}/health`)             // → Backend port 5000
fetch(`${API_URL}/customers`)          // → Backend port 5000
```

## 🔧 **Port Configuration Summary**

| Service | Internal Port | External Access |
|---------|---------------|-----------------|
| Nginx | 80 | `http://159.198.36.24` |
| Frontend | 3000 | Via Nginx proxy |
| Backend | 5000 | Via Nginx proxy |
| PostgreSQL | 5432 | Internal only |

## ✅ **Why This Works Perfectly**

1. **Nginx handles routing**: Users only access port 80
2. **Frontend gets API_URL**: Points to `http://159.198.36.24` (no port)
3. **Nginx proxies API calls**: Routes `/api/*` to backend port 5000
4. **Same origin**: Frontend and API appear to come from same server

## 🧪 **Test Commands (after deployment)**

```bash
# Test frontend
curl http://159.198.36.24

# Test backend health
curl http://159.198.36.24/health

# Test API endpoint
curl http://159.198.36.24/merchant/login

# Test API docs
curl http://159.198.36.24/api-docs
```

## 🔒 **Security Note**

All internal communication stays on localhost:
- Frontend (localhost:3000) ← Internal
- Backend (localhost:5000) ← Internal  
- Only Nginx (port 80) is exposed externally

Your backend port change from 3000 → 5000 is completely invisible to users and frontend!
