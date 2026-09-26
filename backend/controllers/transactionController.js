const { User } = require('../models');

// Get transactions for a user
const getUserTransactions = async (req, res) => {
  try {
    const userId = req.query.userId || req.user.id;

    // For now, return mock transaction data
    // In a real implementation, you would have a Transaction model
    const mockTransactions = [
      {
        id: 1,
        userId: parseInt(userId),
        type: 'credit',
        amount: 500.00,
        description: 'Payment received',
        date: new Date().toISOString(),
        status: 'completed'
      },
      {
        id: 2,
        userId: parseInt(userId),
        type: 'debit',
        amount: 150.00,
        description: 'Service payment',
        date: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        status: 'completed'
      },
      {
        id: 3,
        userId: parseInt(userId),
        type: 'credit',
        amount: 200.00,
        description: 'Refund',
        date: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        status: 'pending'
      }
    ];

    // Filter transactions by userId if provided
    const userTransactions = mockTransactions.filter(t => t.userId === parseInt(userId));

    res.json({
      success: true,
      transactions: userTransactions,
      total: userTransactions.length
    });
  } catch (error) {
    console.error('Get user transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transactions',
      error: error.message
    });
  }
};

// Get transaction by ID
const getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Mock transaction data - in real implementation, query database
    const mockTransaction = {
      id: parseInt(id),
      userId: userId,
      type: 'credit',
      amount: 500.00,
      description: 'Payment received',
      date: new Date().toISOString(),
      status: 'completed',
      details: {
        reference: 'TXN-' + id,
        method: 'bank_transfer',
        notes: 'Monthly payment'
      }
    };

    res.json({
      success: true,
      transaction: mockTransaction
    });
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction',
      error: error.message
    });
  }
};

// Create new transaction
const createTransaction = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, amount, description, recipientId } = req.body;

    // Mock transaction creation - in real implementation, save to database
    const newTransaction = {
      id: Date.now(), // Mock ID
      userId: userId,
      type: type || 'debit',
      amount: parseFloat(amount),
      description: description || 'Transaction',
      date: new Date().toISOString(),
      status: 'pending',
      recipientId: recipientId
    };

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      transaction: newTransaction
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: error.message
    });
  }
};

module.exports = {
  getUserTransactions,
  getTransactionById,
  createTransaction,
};
