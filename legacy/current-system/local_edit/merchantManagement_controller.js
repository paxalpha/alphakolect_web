const bcrypt = require('bcryptjs');
const { Merchant, WalletTransaction, InvestmentTransaction, LoanApplication, Repayment, Plan, Activity, AdminLog } = require('../models');
const { Op } = require('sequelize');

// Update merchant
const updateMerchant = async (req, res) => {
  try {
    const { id } = req.params;
    const { businessName, email, phone, currency, businessAlias } = req.body;

    const merchant = await Merchant.findByPk(id);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found',
      });
    }

    await merchant.update({
      businessName: businessName || merchant.businessName,
      email: email || merchant.email,
      phone: phone || merchant.phone,
      currency: currency || merchant.currency,
      businessAlias: businessAlias || merchant.businessAlias,
      isCustomFee: req.body.isCustomFee !== undefined ? req.body.isCustomFee : merchant.isCustomFee,
      customFee: req.body.customFee !== undefined ? req.body.customFee : merchant.customFee,
    });

    res.json({
      success: true,
      message: 'Merchant updated successfully',
      data: merchant,
    });
  } catch (error) {
    console.error('Error updating merchant:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update merchant',
      error: error.message,
    });
  }
};

// Update merchant status
const updateMerchantStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Active', 'Inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be Active or Inactive',
      });
    }

    const merchant = await Merchant.findByPk(id);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found',
      });
    }

    // Update isVerified based on status
    await merchant.update({
      isVerified: status === 'Active',
    });

    res.json({
      success: true,
      message: 'Merchant status updated successfully',
      data: merchant,
    });
  } catch (error) {
    console.error('Error updating merchant status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update merchant status',
      error: error.message,
    });
  }
};

// Reset merchant password
const resetMerchantPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long',
      });
    }

    const merchant = await Merchant.findByPk(id);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found',
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await merchant.update({ password: hashedPassword });

    res.json({
      success: true,
      message: 'Merchant password reset successfully',
    });
  } catch (error) {
    console.error('Error resetting merchant password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset merchant password',
      error: error.message,
    });
  }
};

// Delete merchant
const deleteMerchant = async (req, res) => {
  try {
    const { id } = req.params;

    const merchant = await Merchant.findByPk(id);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found',
      });
    }

    await merchant.destroy();

    res.json({
      success: true,
      message: 'Merchant deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting merchant:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete merchant',
      error: error.message,
    });
  }
};

// Get merchant transactions
const getMerchantTransactions = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch all transaction types for this merchant
    const [walletTransactions, investmentTransactions, loanApplications, repayments] = await Promise.all([
      WalletTransaction.findAll({
        where: { merchantId: id },
        order: [['createdAt', 'DESC']],
        limit: 100,
      }),
      InvestmentTransaction.findAll({
        where: { merchantId: id },
        order: [['createdAt', 'DESC']],
        limit: 100,
      }),
      LoanApplication.findAll({
        where: { merchantId: id },
        order: [['createdAt', 'DESC']],
        limit: 100,
      }),
      Repayment.findAll({
        where: { merchantId: id },
        order: [['createdAt', 'DESC']],
        limit: 100,
      }),
    ]);

    // Combine and format all transactions
    const transactions = [
      ...walletTransactions.map(t => ({
        id: `WT-${t.id}`,
        type: 'Wallet Transaction',
        amount: t.amount || 0,
        initiatedBy: t.initiatedBy || 'System',
        status: t.status || 'pending',
        date: t.createdAt,
      })),
      ...investmentTransactions.map(t => ({
        id: `IT-${t.id}`,
        type: 'Investment',
        amount: t.amount || 0,
        initiatedBy: t.initiatedBy || 'System',
        status: t.status || 'pending',
        date: t.createdAt,
      })),
      ...loanApplications.map(t => ({
        id: `LA-${t.id}`,
        type: 'Loan Application',
        amount: t.loanAmount || 0,
        initiatedBy: 'Customer',
        status: t.status || 'pending',
        date: t.createdAt,
      })),
      ...repayments.map(t => ({
        id: `RP-${t.id}`,
        type: 'Loan Repayment',
        amount: t.amount || 0,
        initiatedBy: 'Customer',
        status: t.status || 'completed',
        date: t.createdAt,
      })),
    ];

    // Sort by date descending
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error('Error fetching merchant transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch merchant transactions',
      error: error.message,
    });
  }
};

// Get merchant subscriptions
const getMerchantSubscriptions = async (req, res) => {
  try {
    const { id } = req.params;

    const merchant = await Merchant.findByPk(id);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found',
      });
    }

    // For now, return basic subscription info
    // You can expand this to include actual subscription/billing data
    const subscriptionData = {
      currentPlan: merchant.planId || 'Starter Pack', // needs to be enriched with Plan name later
      status: merchant.subscriptionStatus || 'Active',
      billingCycle: 'Monthly',
      nextBillingDate: merchant.nextBillingDate,
      totalDebt: merchant.totalDebt,
      trialEndDate: merchant.trialEndDate,
      isCustomFee: merchant.isCustomFee,
      customFee: merchant.customFee,
    };

    res.json({
      success: true,
      data: subscriptionData,
    });
  } catch (error) {
    console.error('Error fetching merchant subscriptions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch merchant subscriptions',
      error: error.message,
    });
  }
};

// Get merchant logs
const getMerchantLogs = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch activities related to this merchant
    const activities = await Activity.findAll({
      where: {
        [Op.or]: [
          { personId: id },
          { details: { [Op.like]: `%merchant ${id}%` } },
        ],
      },
      order: [['createdAt', 'DESC']],
      limit: 100,
    });

    // Fetch admin logs related to this merchant
    const adminLogs = await AdminLog.findAll({
      where: {
        [Op.or]: [
          { targetId: id },
          { details: { [Op.like]: `%merchant ${id}%` } },
        ],
      },
      order: [['createdAt', 'DESC']],
      limit: 100,
    });

    // Combine and format logs
    const logs = [
      ...activities.map(log => ({
        id: log.id,
        action: log.action || 'Activity',
        user: log.personName || 'System',
        timestamp: log.createdAt,
        details: log.details || 'No details available',
        type: 'activity',
      })),
      ...adminLogs.map(log => ({
        id: log.id,
        action: log.action || 'Admin Action',
        user: log.adminName || 'Admin',
        timestamp: log.createdAt,
        details: log.details || 'No details available',
        type: 'admin_log',
      })),
    ];

    // Sort by timestamp descending
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    console.error('Error fetching merchant logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch merchant logs',
      error: error.message,
    });
  }
};

module.exports = {
  updateMerchant,
  updateMerchantStatus,
  resetMerchantPassword,
  deleteMerchant,
  getMerchantTransactions,
  getMerchantSubscriptions,
  getMerchantLogs,
};
