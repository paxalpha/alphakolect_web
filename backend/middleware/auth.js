const jwt = require('jsonwebtoken');
const { Agent, Staff } = require('../models');

// Middleware to verify JWT token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const xAccessToken = req.headers['x-access-token'];
  const candidate = authHeader || xAccessToken || req.query.token || (req.body && req.body.token);

  if (!candidate) {
    return res.status(401).json({ message: 'Access token is required' });
  }

  // Support formats: "Bearer <token>", "Token <token>", or raw token
  const parts = String(candidate).split(' ');
  const token = parts.length > 1 ? parts[1] : parts[0];

  if (!token) {
    return res.status(401).json({ message: 'Access token is required' });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    
    // Backward compatibility: enrich agent or collaborator token with merchantId if missing
    if (req.user) {
      if (req.user.type === 'agent' && !req.user.merchantId) {
        try {
          const agentRecord = await Agent.findByPk(req.user.id);
          if (agentRecord && agentRecord.merchantId) {
            req.user.merchantId = agentRecord.merchantId;
          }
        } catch (_) {}
      } else if ((req.user.type === 'collaborator' || req.user.type === 'staff') && !req.user.merchantId) {
        try {
          const staffRecord = await Staff.findByPk(req.user.id || req.user.staffId);
          if (staffRecord && staffRecord.merchantId) {
            req.user.merchantId = staffRecord.merchantId;
          }
        } catch (_) {}
      }
    }
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Middleware to check if user is a merchant
const requireMerchant = (req, res, next) => {
  if (req.user.type !== 'merchant') {
    return res.status(403).json({ message: 'Access denied. Merchant role required.' });
  }
  next();
};

// Middleware to check if user is a collaborator
const requireCollaborator = (req, res, next) => {
  if (req.user.type !== 'collaborator') {
    return res.status(403).json({ message: 'Access denied. Collaborator role required.' });
  }
  next();
};

// Middleware to check if user is authenticated as merchant, collaborator, staff, or agent
const requireAuthenticated = (req, res, next) => {
  if (
    !req.user ||
    (req.user.type !== 'merchant' && req.user.type !== 'collaborator' && req.user.type !== 'staff' && req.user.type !== 'agent')
  ) {
    return res.status(403).json({ message: 'Access denied. Authentication required.' });
  }
  next();
};

// Middleware to check if user is a super admin
const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ message: 'Access denied. SuperAdmin role required.' });
  }
  next();
};

// Middleware to check if merchant subscription is active
const checkActiveSubscription = async (req, res, next) => {
  try {
    const { Merchant } = require('../models');
    
    // Resolve merchant ID for current user (merchant, agent, or collaborator)
    const merchantId = req.user.type === 'merchant' ? req.user.id : req.user.merchantId;
    
    if (!merchantId) {
      return next();
    }
    
    const merchant = await Merchant.findByPk(merchantId);
    if (!merchant) {
      return res.status(404).json({ message: 'Merchant not found' });
    }
    
    const isExpiredByDate = merchant.next_billing_date && new Date() > new Date(merchant.next_billing_date);
    const isBlockedStatus = ['Suspended', 'Blocked', 'Grace'].includes(merchant.subscription_status) || isExpiredByDate;
    
    if (isBlockedStatus) {
      return res.status(403).json({
        success: false,
        subscriptionExpired: true,
        message: 'Your subscription has expired. Please reactivate your account to perform this action.'
      });
    }
    
    next();
  } catch (error) {
    console.error('Error checking active subscription:', error);
    next();
  }
};

module.exports = {
  verifyToken,
  requireMerchant,
  requireCollaborator,
  requireAuthenticated,
  requireSuperAdmin,
  checkActiveSubscription,
};

