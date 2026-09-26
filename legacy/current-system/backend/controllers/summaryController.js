const { User } = require('../models');

// Get user summary/dashboard data
const getUserSummary = async (req, res) => {
  try {
    const userId = req.query.userId || req.user.id;

    // Mock summary data - in real implementation, calculate from actual data
    const mockSummary = {
      userId: parseInt(userId),
      balance: 1250.75,
      totalCredits: 2850.00,
      totalDebits: 1599.25,
      transactionCount: 24,
      lastTransaction: {
        amount: 500.00,
        type: 'credit',
        date: new Date().toISOString(),
        description: 'Payment received'
      },
      monthlyStats: {
        thisMonth: {
          credits: 1200.00,
          debits: 800.00,
          net: 400.00
        },
        lastMonth: {
          credits: 1650.00,
          debits: 799.25,
          net: 850.75
        }
      },
      recentActivity: [
        {
          id: 1,
          type: 'credit',
          amount: 500.00,
          description: 'Payment received',
          date: new Date().toISOString(),
          status: 'completed'
        },
        {
          id: 2,
          type: 'debit',
          amount: 150.00,
          description: 'Service payment',
          date: new Date(Date.now() - 86400000).toISOString(),
          status: 'completed'
        },
        {
          id: 3,
          type: 'credit',
          amount: 200.00,
          description: 'Refund',
          date: new Date(Date.now() - 172800000).toISOString(),
          status: 'pending'
        }
      ]
    };

    res.json({
      success: true,
      summary: mockSummary
    });
  } catch (error) {
    console.error('Get user summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user summary',
      error: error.message
    });
  }
};

// Get user statistics
const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Mock statistics - in real implementation, calculate from database
    const mockStats = {
      totalTransactions: 24,
      successfulTransactions: 22,
      failedTransactions: 2,
      averageTransactionAmount: 125.50,
      monthlyGrowth: 15.5, // percentage
      categories: {
        payments: 12,
        transfers: 8,
        refunds: 4
      },
      trends: {
        weekly: [120, 150, 180, 200, 175, 190, 210],
        monthly: [1200, 1350, 1500, 1650, 1800, 1950, 2100]
      }
    };

    res.json({
      success: true,
      stats: mockStats
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user statistics',
      error: error.message
    });
  }
};

module.exports = {
  getUserSummary,
  getUserStats,
};
