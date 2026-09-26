const { 
  Customer, 
  Agent, 
  Loan, 
  Investment, 
  Repayment, 
  InvestmentApplication, 
  LoanApplication,
  Merchant,
  WalletTransaction,
  Collection,
  CustomerWallet
} = require('../models');
const { Op, col, where } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Dashboard
 *     description: Dashboard statistics
 * /dashboard/stats:
 *   get:
 *     summary: Get aggregated dashboard statistics
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 walletBalance: 150000
 *                 allCollectionWallet: 95000
 *                 totalDue: 120000
 *                 smsBalance: 75
 *                 totalCustomers: 420
 *                 totalAgents: 35
 *                 activeLoans: 55
 *                 activeInvestments: 28
 * /dashboard/transactions:
 *   get:
 *     summary: Get dashboard transactions timeseries
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: duration
 *         schema: { type: string, enum: ["Last 3 months", "Last 6 months", "Last 12 months"], default: "Last 12 months" }
 *     responses:
 *       200:
 *         description: Timeseries data
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - name: "Jan"
 *                   Collection: 120000
 *                   Investment: 80000
 *                   Loan: 40000
 * /dashboard/agent-customer:
 *   get:
 *     summary: Get agent vs customer statistics
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pie chart data
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - name: "Agents"
 *                   value: 35
 *                 - name: "Customers"
 *                   value: 420
 */
// Get dashboard statistics
const getDashboardStats = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;

    // Get counts for various entities
    const merchant = await Merchant.findByPk(merchantId);
    const smsBalance = merchant?.sms_balance || 0;

    const [
      totalCustomers,
      totalAgents,
      activeLoans,
      activeInvestments,
      packageCollectionsSum,
      loanRepaymentsSum,
      totalDue
    ] = await Promise.all([
      Customer.count({ where: { merchantId } }),
      Agent.count({ where: { merchantId } }),
      Loan.count({ where: { merchantId, status: 'Active' } }),
      Investment.count({ where: { merchantId, status: 'Active' } }),
      Collection.sum('amountCollected', { where: { merchantId, status: 'Collected' } }),
      Repayment.sum('amount', { where: { merchantId, status: 'Completed' } }),
      Loan.sum('remainingAmount', { where: { merchantId, status: 'Active' } })
    ]);

    const totalCollections = (parseFloat(packageCollectionsSum || 0) + parseFloat(loanRepaymentsSum || 0));

    // Calculate per-merchant wallet balance from WalletTransaction ledger (matching walletController)
    let walletBalance = 0;
    const walletTransactions = await WalletTransaction.findAll({
      where: { merchantId },
      attributes: ['type', 'transactionType', 'amount', 'status']
    });

    walletTransactions.forEach(transaction => {
      const isCompleted = (transaction.status || '').toLowerCase() === 'completed';
      const tType = (transaction.type || '').toLowerCase();
      const trType = (transaction.transactionType || '').toLowerCase();
      const amount = parseFloat(transaction.amount || 0);

      if (isCompleted) {
        if (tType === 'credit') {
          walletBalance += amount;
        } else if (tType === 'debit') {
          walletBalance -= amount;
        } else if (trType === 'credit' || trType === 'initial_balance' || trType === 'remittance_approval' || trType === 'transfer_in') {
          walletBalance += amount;
        } else if (trType === 'debit' || trType === 'charge_deduction' || trType === 'loan_disbursement' || trType === 'transfer_out') {
          walletBalance -= amount;
        }
      }
    });

    walletBalance = Math.max(0, walletBalance);

    // Cumulative Collection Wallets - sum of all customer wallet collection balances
    const rawCollectionWallet = await CustomerWallet.sum('collection_balance', { 
        where: { merchantId } 
    }) || 0;
    const allCollectionWallet = parseFloat(rawCollectionWallet);

    res.json({
      success: true,
      data: {
        walletBalance,
        allCollectionWallet,
        totalDue: Math.max(0, parseFloat(totalDue || 0)),
        smsBalance,
        totalCustomers,
        totalAgents,
        activeLoans,
        activeInvestments,
        totalCollections: Math.max(0, totalCollections || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
      error: error.message
    });
  }
};

// Get transaction statistics for charts
const getTransactionStats = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;
    const { duration = 'Last 12 months' } = req.query;

    // Calculate date range based on duration
    const now = new Date();
    let startDate;
    
    switch (duration) {
      case 'Last 3 months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      case 'Last 6 months':
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        break;
      case 'Last 12 months':
      default:
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        break;
    }

    // Generate monthly data
    const monthlyData = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= now) {
      const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      
      const monthName = monthStart.toLocaleDateString('en-US', { month: 'short' });
      
      // Get collections for this month
      const collections = await Repayment.sum('amount', {
        where: {
          merchantId,
          status: 'Completed',
          date: {
            [require('sequelize').Op.between]: [monthStart, monthEnd]
          }
        }
      });

      // Get investments for this month
      const investments = await Investment.sum('amount', {
        where: {
          merchantId,
          dateCreated: {
            [require('sequelize').Op.between]: [monthStart, monthEnd]
          }
        }
      });

      // Get loans for this month
      const loans = await Loan.sum('loanAmount', {
        where: {
          merchantId,
          dateIssued: {
            [require('sequelize').Op.between]: [monthStart, monthEnd]
          }
        }
      });

      monthlyData.push({
        name: monthName,
        Collection: collections || 0,
        Investment: investments || 0,
        Loan: loans || 0
      });

      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    res.json({
      success: true,
      data: monthlyData
    });
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction statistics',
      error: error.message
    });
  }
};

// Get agent vs customer statistics
const getAgentCustomerStats = async (req, res) => {
  try {
    const merchantId = req.user.merchantId || req.user.id;

    const [totalAgents, totalCustomers] = await Promise.all([
      Agent.count({ where: { merchantId } }),
      Customer.count({ where: { merchantId } })
    ]);

    const pieData = [
      { name: 'Agents', value: totalAgents },
      { name: 'Customers', value: totalCustomers }
    ];

    res.json({
      success: true,
      data: pieData
    });
  } catch (error) {
    console.error('Error fetching agent-customer stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch agent-customer statistics',
      error: error.message
    });
  }
};

// exports moved to bottom after function definitions

/**
 * @swagger
 * /dashboard/agent-summary:
 *   get:
 *     summary: Get summarized KPIs for the authenticated agent's merchant
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary KPIs
 *       401:
 *         description: Unauthorized
 */
const getAgentSummary = async (req, res) => {
  try {
    // Resolve merchant for both merchants and agents
    const merchantId = req.user?.merchantId || req.user?.id;
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }

    // Dates
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalCollectionsSum,
      allTransactionsCount,
      totalCollectionAmountSum,
      totalCollectionTodaySum,
      activeInvestmentsCount,
      investmentApplicationsCount,
      activeLoansCount,
      loanApplicationsCount,
      totalCollectionAmountTodaySum,
      totalCollectionMonthSum,
      merchant,
      totalCustomersCount,
      allCustomersAccumulatedBalanceSum
    ] = await Promise.all([
      // Interpret as count of completed collections (repayments) records
      Repayment.count({ where: { merchantId, status: 'Completed' } }),
      WalletTransaction.count({ where: { merchantId, status: 'Completed' } }),
      // Total amount of all completed collections
      Repayment.sum('amount', { where: { merchantId, status: 'Completed' } }),
      // Collections completed today
      Repayment.sum('amount', { where: { merchantId, status: 'Completed', date: { [Op.gte]: startOfToday } } }),
      Investment.count({ where: { merchantId, status: 'Active' } }),
      InvestmentApplication.count({ where: { merchantId } }),
      Loan.count({ where: { merchantId, status: 'Active' } }),
      // Explicitly reference DB column for LoanApplication to avoid camelCase mismatch
      LoanApplication.count({ where: where(col('LoanApplication.merchant_id'), merchantId) }),
      // Alias of totalCollectionToday but kept for explicit field mapping
      Repayment.sum('amount', { where: { merchantId, status: 'Completed', date: { [Op.gte]: startOfToday } } }),
      // Collections in current month
      Repayment.sum('amount', { where: { merchantId, status: 'Completed', date: { [Op.gte]: startOfMonth } } }),
      Merchant.findByPk(merchantId),
      Customer.count({ where: { merchantId } }),
      // Accumulated balance from customer wallets
      CustomerWallet.sum('balance', { where: { merchantId } })
    ]);

    // Currency symbol mapping
    const getCurrencySymbol = (currency) => {
      const symbolMap = {
        'NGN': '₦',
        'USD': '$',
        'EUR': '€',
        'GBP': '£',
        'XOF': 'CFA',
        'GHS': '₵',
        'GMD': 'D',
        'GNF': 'FG',
        'LRD': 'L$',
        'MRU': 'UM',
        'SLL': 'Le',
        'CVE': 'Esc'
      };
      return symbolMap[currency] || currency;
    };

    return res.json({
      success: true,
      data: {
        numTotalCollections: Number(totalCollectionsSum || 0),
        allTransactions: Number(allTransactionsCount || 0),
        totalCollectionAmount: Number(totalCollectionAmountSum || 0),
        totalCollectionToday: Number(totalCollectionTodaySum || 0),
        activeInvestments: Number(activeInvestmentsCount || 0),
        investmentApplications: Number(investmentApplicationsCount || 0),
        activeLoans: Number(activeLoansCount || 0),
        loanApplications: Number(loanApplicationsCount || 0),
        totalCollectionAmountToday: Number(totalCollectionAmountTodaySum || 0),
        totalCollectionMonth: Number(totalCollectionMonthSum || 0),
        currency: merchant?.currency || 'NGN',
        currencySymbol: getCurrencySymbol(merchant?.currency || 'NGN'),
        totalCollectionAmountMonth: Number(totalCollectionMonthSum || 0),
        totalCustomers: Number(totalCustomersCount || 0),
        allCustomersAccumulatedBalance: Number(allCustomersAccumulatedBalanceSum || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching agent summary:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch agent summary', error: error.message });
  }
};




module.exports = {
  getDashboardStats,
  getTransactionStats,
  getAgentCustomerStats,
  getAgentSummary
};