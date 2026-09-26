const bcrypt = require('bcryptjs');

const { Merchant, WalletTransaction, InvestmentTransaction, LoanApplication, Repayment, Plan, Activity, AdminLog } = require('../models');

const { Op } = require('sequelize');

const sanitizeMerchant = (merchant) => {
  const safe = merchant.toJSON ? merchant.toJSON() : { ...merchant };
  delete safe.password;
  delete safe.otp;
  delete safe.otpExpires;
  return safe;
};

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



    // Update merchant

    await merchant.update({

      businessName: businessName || merchant.businessName,

      email: email || merchant.email,

      phone: phone || merchant.phone,

      currency: currency || merchant.currency,

      businessAlias: businessAlias || merchant.businessAlias,

    });



    res.json({

      success: true,

      message: 'Merchant updated successfully',

      data: sanitizeMerchant(merchant),

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

      data: sanitizeMerchant(merchant),

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

      currentPlan: merchant.isVerified ? 'Basic' : 'Free',

      status: merchant.isVerified ? 'Active' : 'Inactive',

      billingCycle: 'Monthly',

      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),

      paymentMethod: 'Not set',

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






// Get current logged-in merchant subscription
const getMySubscription = async (req, res) => {
  try {
    const id = req.user.id;
    const { Merchant, Plan, Subscription, Agent } = require('../models');

    const merchant = await Merchant.findByPk(id, {
      include: [
        { model: Plan, as: 'plan' }
      ]
    });

    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found',
      });
    }

    if (merchant.next_billing_date && new Date() > new Date(merchant.next_billing_date) && merchant.subscription_status === 'Active') {
      merchant.subscription_status = 'Suspended';
      await merchant.save();
    }

    const history = await Subscription.findAll({
      where: { merchantId: id },
      include: [{ model: Plan, as: 'plan' }],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    const agentCount = await Agent.count({ where: { merchantId: id } });

    const safeMerchant = sanitizeMerchant(merchant);

    res.json({
      success: true,
      data: {
        merchant: safeMerchant,
        history: history,
        agentCount: agentCount
      },
    });
  } catch (error) {
    console.error('Error fetching my subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription',
      error: error.message,
    });
  }
};


const reactivateSubscription = async (req, res) => {
  try {
    const id = req.user.id;
    const { Merchant, Agent, Plan, Subscription, WalletTransaction } = require('../models');
    const { resolvePlanByAgentCount } = require('../services/billingService');

    const merchant = await Merchant.findByPk(id);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        message: 'Merchant not found',
      });
    }

    // Count active agents to determine the correct plan
    const agentCount = await Agent.count({ where: { merchantId: id } });
    const resolved = resolvePlanByAgentCount(agentCount);

    if (resolved.isCustom) {
      return res.status(400).json({
        success: false,
        message: 'Your account qualifies for the Enterprise plan. Please contact the Super Admin for custom pricing and activation.',
      });
    }

    const price = resolved.price;
    const currentBalance = parseFloat(merchant.wallet_balance || 0);

    if (currentBalance < price) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Your ${resolved.name} plan costs ₦${price.toLocaleString()}/month. Current balance: ₦${currentBalance.toLocaleString()}. Please fund your wallet first.`,
        requiredAmount: price,
        currentBalance,
      });
    }

    const newBalance = currentBalance - price;
    const now = new Date();
    const nextBilling = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    merchant.wallet_balance = newBalance;
    merchant.subscription_status = 'Active';
    merchant.next_billing_date = nextBilling;
    merchant.plan_id = resolved.planId;
    await merchant.save();

    await Subscription.create({
      merchantId: id,
      planId: resolved.planId,
      amount: price,
      status: 'Paid',
      periodStart: now,
      periodEnd: nextBilling,
      paymentDate: now,
    });

    await WalletTransaction.create({
      merchantId: id,
      amount: price,
      type: 'debit',
      transactionType: 'subscription',
      category: 'subscription',
      description: `Subscription Reactivation - ${resolved.name} (${agentCount} agent${agentCount !== 1 ? 's' : ''})`,
      status: 'Completed',
      balanceBefore: currentBalance,
      balanceAfter: newBalance,
      date: now,
    });

    res.json({
      success: true,
      message: `Subscription reactivated on ${resolved.name} plan for ₦${price.toLocaleString()}/month.`,
      data: {
        planName: resolved.name,
        planId: resolved.planId,
        agentCount,
        amountCharged: price,
        walletBalance: newBalance,
        subscriptionStatus: 'Active',
        nextBillingDate: nextBilling,
      }
    });

  } catch (error) {
    console.error('Error reactivating subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reactivate subscription',
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
  getMySubscription,
  reactivateSubscription,
};
