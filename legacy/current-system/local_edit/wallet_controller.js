const { WalletTransaction, Merchant } = require('../models');
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Wallet
 *     description: Merchant wallet operations
 * /wallet/balance:
 *   get:
 *     summary: Get merchant wallet balance
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               balance: 50000.00
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /wallet/transactions:
 *   get:
 *     summary: List wallet transactions
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: 
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema: 
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: type
 *         schema: 
 *           type: string
 *           enum: [credit, debit]
 *         description: Transaction type
 *       - in: query
 *         name: status
 *         schema: 
 *           type: string
 *         description: Transaction status
 *     responses:
 *       200:
 *         description: Transactions list retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               transactions:
 *                 - id: 9001
 *                   type: "credit"
 *                   transactionType: "credit"
 *                   amount: 2000.00
 *                   status: "Completed"
 *                   reference: "TXN123456"
 *                   description: "Payment received from customer"
 *                   merchantId: 1
 *                   paymentMethod: "Bank Transfer"
 *                   relatedId: 123
 *                   relatedType: "customer_wallet"
 *                   notes: "Transaction processed successfully"
 *                   balanceBefore: 5000.00
 *                   balanceAfter: 7000.00
 *                   category: "Collection"
 *                   processedBy: 2
 *                   date: "2024-01-15T10:30:00.000Z"
 *                   createdAt: "2024-01-15T10:30:00.000Z"
 *                   updatedAt: "2024-01-15T10:30:00.000Z"
 *               pagination:
 *                 currentPage: 1
 *                 totalPages: 2
 *                 totalItems: 12
 *                 itemsPerPage: 10
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *   post:
 *     summary: Create wallet transaction
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, amount]
 *             properties:
 *               type: 
 *                 type: string
 *                 enum: [credit, debit]
 *                 description: Transaction type
 *                 example: "credit"
 *               amount: 
 *                 type: number
 *                 format: float
 *                 description: Transaction amount
 *                 example: 1000.00
 *               description: 
 *                 type: string
 *                 description: Transaction description
 *                 example: "Payment received"
 *               reference: 
 *                 type: string
 *                 description: Transaction reference
 *                 example: "TXN123456"
 *     responses:
 *       201:
 *         description: Transaction created successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Transaction created successfully"
 *               transaction:
 *                 id: 9002
 *                 type: "debit"
 *                 transactionType: "debit"
 *                 amount: 1500.00
 *                 status: "Pending"
 *                 reference: "TXN123457"
 *                 description: "Payment made to supplier"
 *                 merchantId: 1
 *                 paymentMethod: "Bank Transfer"
 *                 relatedId: 124
 *                 relatedType: "supplier_payment"
 *                 notes: "Monthly supplier payment"
 *                 balanceBefore: 7000.00
 *                 balanceAfter: 5500.00
 *                 category: "Payment"
 *                 processedBy: 2
 *                 date: "2024-01-15T10:30:00.000Z"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /wallet/transactions/{id}:
 *   get:
 *     summary: Get wallet transaction by ID
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: 
 *           type: integer
 *         description: Transaction ID
 *     responses:
 *       200:
 *         description: Transaction retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               transaction:
 *                 id: 9001
 *                 type: "credit"
 *                 transactionType: "credit"
 *                 amount: 2000.00
 *                 status: "Completed"
 *                 reference: "TXN123456"
 *                 description: "Payment received from customer"
 *                 merchantId: 1
 *                 paymentMethod: "Bank Transfer"
 *                 relatedId: 123
 *                 relatedType: "customer_wallet"
 *                 notes: "Transaction processed successfully"
 *                 balanceBefore: 5000.00
 *                 balanceAfter: 7000.00
 *                 category: "Collection"
 *                 processedBy: 2
 *                 date: "2024-01-15T10:30:00.000Z"
 *                 createdAt: "2024-01-15T10:30:00.000Z"
 *                 updatedAt: "2024-01-15T10:30:00.000Z"
 *       404:
 *         description: Transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /wallet/transactions/{id}/status:
 *   put:
 *     summary: Update wallet transaction status
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: 
 *           type: integer
 *         description: Transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: 
 *                 type: string
 *                 description: New transaction status
 *                 example: "completed"
 *               notes: 
 *                 type: string
 *                 description: Additional notes
 *                 example: "Transaction processed successfully"
 *     responses:
 *       200:
 *         description: Transaction status updated successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Transaction status updated successfully"
 *               transaction:
 *                 id: 9001
 *                 status: "completed"
 *       404:
 *         description: Transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /wallet/stats:
 *   get:
 *     summary: Get wallet statistics
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: 
 *           type: integer
 *           default: 30
 *         description: Period in days
 *     responses:
 *       200:
 *         description: Wallet statistics retrieved successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               stats:
 *                 totalBalance: 50000.00
 *                 totalCredits: 75000.00
 *                 totalDebits: 25000.00
 *                 transactionCount: 150
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 * /wallet/transfer:
 *   post:
 *     summary: Transfer funds to customer wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, amount]
 *             properties:
 *               customerId: 
 *                 type: integer
 *                 description: Customer ID
 *                 example: 1
 *               amount: 
 *                 type: number
 *                 format: float
 *                 description: Transfer amount
 *                 example: 1000.00
 *               description: 
 *                 type: string
 *                 description: Transfer description
 *                 example: "Fund transfer to customer"
 *               transactionType: 
 *                 type: string
 *                 enum: [credit, debit]
 *                 description: Transaction type
 *                 example: "debit"
 *               type: 
 *                 type: string
 *                 enum: [credit, debit]
 *                 description: Transaction type
 *                 example: "debit"
 *               paymentMethod: 
 *                 type: string
 *                 description: Payment method
 *                 example: "Bank Transfer"
 *     responses:
 *       200:
 *         description: Transfer completed successfully
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: "Transfer completed successfully"
 *               transaction:
 *                 id: 9010
 *                 type: "debit"
 *                 amount: 1000
 *                 status: "completed"
 *       400:
 *         description: Invalid input or insufficient funds
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

// Get wallet balance for a merchant
const getWalletBalance = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { Merchant } = require('../models');
    const { getWalletBalance: fetchTpBalance } = require('../utils/transactPay');

    const merchant = await Merchant.findByPk(merchantId);
    
    // If merchant has a TransactPay account number, fetch balance from there
    if (merchant && merchant.accountNumber) {
        const tpBalanceData = await fetchTpBalance(merchant.accountNumber);
        if (tpBalanceData) {
            return res.json({
                success: true,
                balance: {
                    total: parseFloat(tpBalanceData.availableBalance || tpBalanceData.balance || 0),
                    available: parseFloat(tpBalanceData.availableBalance || tpBalanceData.balance || 0),
                    pending: parseFloat(tpBalanceData.pendingBalance || 0),
                    currency: 'NGN',
                    fromWallet: true,
                    accountNumber: merchant.accountNumber,
                    bankName: merchant.bankName,
                    accountName: merchant.accountName
                }
            });
        }
    }

    // Calculate balance from all transactions
    const transactions = await WalletTransaction.findAll({
      where: { merchantId },
      attributes: ['type', 'transactionType', 'amount', 'status']
    });

    let totalBalance = 0;
    let availableBalance = 0;
    let pendingAmount = 0;

    transactions.forEach(transaction => {
      if (transaction.status === 'Completed') {
        // Simplified balance calculation: Always deduct debit transactions
        // Credit transactions increase balance, Debit transactions decrease balance
        if (transaction.transactionType === 'credit') {
          // Credit increases merchant's wallet balance
          totalBalance += parseFloat(transaction.amount);
          availableBalance += parseFloat(transaction.amount);
        } else if (transaction.transactionType === 'debit') {
          // Debit decreases merchant's wallet balance
          totalBalance -= parseFloat(transaction.amount);
          availableBalance -= parseFloat(transaction.amount);
        } else if (transaction.transactionType === 'initial_balance') {
          // Initial balance increases merchant's wallet
          totalBalance += parseFloat(transaction.amount);
          availableBalance += parseFloat(transaction.amount);
        } else {
          // Fallback to old logic for transactions without transactionType
          if (transaction.type === 'credit') {
            totalBalance += parseFloat(transaction.amount);
            availableBalance += parseFloat(transaction.amount);
          } else if (transaction.type === 'debit') {
            totalBalance -= parseFloat(transaction.amount);
            availableBalance -= parseFloat(transaction.amount);
          }
        }
      } else if (transaction.status === 'Pending') {
        pendingAmount += parseFloat(transaction.amount);
      }
    });

    res.json({
      success: true,
      balance: {
        total: totalBalance,
        available: availableBalance,
        pending: pendingAmount,
        currency: 'NGN',
        fromWallet: false
      }
    });
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet balance',
      error: error.message
    });
  }
};

// Create a new wallet transaction
const createWalletTransaction = async (req, res) => {
  try {
    const { type, amount, description, reference } = req.body;
    const merchantId = req.user.id;

    // Create any transaction after checking limits
    try {
        await checkMerchantTierLimits(merchantId, parseFloat(amount), type);
    } catch (limitError) {
        return res.status(400).json({
            success: false,
            message: limitError.message
        });
    }

    const transaction = await WalletTransaction.create({
      merchantId,
      type,
      transactionType: type, // Ensure transactionType is set
      amount: parseFloat(amount),
      description: description || '',
      reference: reference || `TXN_${Date.now()}`,
      status: 'Completed',
      date: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Wallet transaction created successfully',
      transaction
    });
  } catch (error) {
    console.error('Error creating wallet transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create wallet transaction',
      error: error.message
    });
  }
};

// Get all wallet transactions for a merchant
const getWalletTransactions = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { page = 1, limit = 10, type, status } = req.query;
    const { Merchant } = require('../models');
    const { getWalletTransactions: fetchTpTransactions } = require('../utils/transactPay');

    const merchant = await Merchant.findByPk(merchantId);
    
    // If merchant has a TransactPay account number, fetch transactions from there
    if (merchant && merchant.accountNumber) {
        const tpTransactions = await fetchTpTransactions(merchant.accountNumber);
        if (tpTransactions && tpTransactions.length > 0) {
            // Map TP transactions to our local format for consistency
            const mappedTransactions = tpTransactions.map(txn => ({
                id: txn.id || txn.reference,
                type: txn.type || (txn.amount > 0 ? 'credit' : 'debit'),
                transactionType: txn.transactionType || (txn.amount > 0 ? 'credit' : 'debit'),
                amount: Math.abs(parseFloat(txn.amount)),
                status: txn.status || 'Completed',
                reference: txn.reference,
                description: txn.description || txn.narration || '',
                date: txn.date || txn.createdAt,
                createdAt: txn.createdAt || txn.date,
                fromWallet: true
            }));

            return res.json({
                success: true,
                transactions: mappedTransactions.slice((page - 1) * limit, page * limit),
                pagination: {
                    total: mappedTransactions.length,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(mappedTransactions.length / parseInt(limit))
                }
            });
        }
    }

    const whereClause = { merchantId };
    
    if (type) {
      whereClause.type = type;
    }
    
    if (status) {
      whereClause.status = status;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: transactions } = await WalletTransaction.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    res.json({
      success: true,
      transactions,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching wallet transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet transactions',
      error: error.message
    });
  }
};

// Get wallet transaction by ID
const getWalletTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const transaction = await WalletTransaction.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      transaction
    });
  } catch (error) {
    console.error('Error fetching wallet transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet transaction',
      error: error.message
    });
  }
};

// Update wallet transaction status
const updateTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const merchantId = req.user.id;

    const transaction = await WalletTransaction.findOne({
      where: { 
        id,
        merchantId 
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    await transaction.update({
      status,
      notes: notes || transaction.notes,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Transaction status updated successfully',
      transaction
    });
  } catch (error) {
    console.error('Error updating transaction status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update transaction status',
      error: error.message
    });
  }
};

// Get wallet statistics
const getWalletStats = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { period = '30' } = req.query; // Default to last 30 days

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    const transactions = await WalletTransaction.findAll({
      where: {
        merchantId,
        date: {
          [Op.gte]: startDate
        },
        status: 'Completed'
      }
    });

    let totalCredits = 0;
    let totalDebits = 0;
    let transactionCount = transactions.length;

    transactions.forEach(transaction => {
      if (transaction.type === 'Credit' || transaction.type === 'Deposit') {
        totalCredits += parseFloat(transaction.amount);
      } else if (transaction.type === 'Debit' || transaction.type === 'Withdrawal') {
        totalDebits += parseFloat(transaction.amount);
      }
    });

    res.json({
      success: true,
      stats: {
        period: `Last ${period} days`,
        totalCredits,
        totalDebits,
        netAmount: totalCredits - totalDebits,
        transactionCount,
        averageTransaction: transactionCount > 0 ? (totalCredits + totalDebits) / transactionCount : 0
      }
    });
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet statistics',
      error: error.message
    });
  }
};

// Helper to check merchant tier limits
const checkMerchantTierLimits = async (merchantId, amount, type) => {
    const { Merchant, WalletTier, WalletTransaction } = require('../models');
    
    // 1. Get merchant and their tier
    const merchant = await Merchant.findByPk(merchantId);
    if (!merchant) throw new Error('Merchant not found');

    const level = parseInt((merchant.accountLevel || 'Tier 0').replace(/[^0-9]/g, '')) || 0;
    const tier = await WalletTier.findOne({ where: { level } });
    if (!tier) return true; // If no tier definition, allow (or default to level 0)

    // Helper to parse currency strings like "₦50,000" to number
    const parseLimit = (limitStr) => {
        if (!limitStr || limitStr.toUpperCase() === 'NO' || limitStr.toUpperCase() === 'NONE') return 0;
        return parseFloat(limitStr.replace(/[^0-9.]/g, '')) || 0;
    };

    const dailyLimit = parseLimit(tier.dailyLimit);
    const maxBalance = parseLimit(tier.maxBalance);

    // 2. Check Daily Limit for debits
    if (type === 'debit') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const todayDebits = await WalletTransaction.sum('amount', {
            where: {
                merchantId,
                type: 'debit',
                status: 'Completed',
                date: { [Op.gte]: startOfDay }
            }
        }) || 0;

        if (dailyLimit > 0 && (todayDebits + amount) > dailyLimit) {
            throw new Error(`Daily limit exceeded. Your current tier (${tier.name}) limit is ₦${dailyLimit.toLocaleString()}`);
        }
    }

    // 3. Check Max Balance for credits
    if (type === 'credit') {
        let currentBalance = 0;
        
        // Try to get live balance first
        if (merchant.accountNumber) {
            const { getWalletBalance: fetchTpBalance } = require('../utils/transactPay');
            const tpBalanceData = await fetchTpBalance(merchant.accountNumber);
            if (tpBalanceData) {
                currentBalance = parseFloat(tpBalanceData.availableBalance || tpBalanceData.balance || 0);
            } else {
                // Fallback to local sum if TP fails
                const txs = await WalletTransaction.findAll({
                    where: { merchantId, status: 'Completed' },
                    attributes: ['type', 'transactionType', 'amount']
                });
                txs.forEach(t => {
                    const a = parseFloat(t.amount);
                    const tt = t.transactionType || t.type;
                    if (tt === 'credit' || tt === 'initial_balance') currentBalance += a;
                    else if (tt === 'debit') currentBalance -= a;
                });
            }
        } else {
            // Local sum for merchants without virtual accounts
            const txs = await WalletTransaction.findAll({
                where: { merchantId, status: 'Completed' },
                attributes: ['type', 'transactionType', 'amount']
            });
            txs.forEach(t => {
                const a = parseFloat(t.amount);
                const tt = t.transactionType || t.type;
                if (tt === 'credit' || tt === 'initial_balance') currentBalance += a;
                else if (tt === 'debit') currentBalance -= a;
            });
        }

        if (maxBalance > 0 && (currentBalance + amount) > maxBalance) {
            throw new Error(`Max balance exceeded. Your current tier (${tier.name}) limit is ₦${maxBalance.toLocaleString()}`);
        }
    }

    return true;
};

// Transfer from merchant wallet to customer wallet
const transferToCustomer = async (req, res) => {
  try {
    const { customerId, amount, description, transactionType, type, paymentMethod } = req.body;
    const merchantId = req.user.id;

    // Validate required fields
    if (!customerId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID and valid amount are required'
      });
    }

    // Check if customer exists and has a wallet
    const { CustomerWallet, Customer } = require('../models');
    
    const customerWallet = await CustomerWallet.findOne({
      where: { 
        customerId,
        merchantId 
      },
      include: [{
        model: Customer,
        as: 'customer',
        attributes: ['id', 'fullName']
      }]
    });

    if (!customerWallet) {
      return res.status(404).json({
        success: false,
        message: 'Customer wallet not found'
      });
    }

    // Determine merchant-side transaction type
    const customerSideType = (type === 'credit' || type === 'debit') ? type : 'debit';
    const merchantSideType = customerSideType === 'credit' ? 'debit' : 'credit';

    // Enforce Tier Limits
    try {
        await checkMerchantTierLimits(merchantId, parseFloat(amount), merchantSideType);
    } catch (limitError) {
        return res.status(400).json({
            success: false,
            message: limitError.message
        });
    }

    // For merchant debit (payout) ensure sufficient merchant balance; skip for merchant credit (inflow)
    if (merchantSideType === 'debit') {
      const merchantTransactions = await WalletTransaction.findAll({
        where: { merchantId },
        attributes: ['type', 'transactionType', 'amount', 'status']
      });

      let merchantBalance = 0;
      merchantTransactions.forEach(transaction => {
        if (transaction.status === 'Completed') {
          // Use the same logic as getWalletBalance for consistency
          // Always deduct debit transactions, add credit transactions
          if (transaction.transactionType === 'credit') {
            // Credit increases merchant's wallet balance
            merchantBalance += parseFloat(transaction.amount);
          } else if (transaction.transactionType === 'debit') {
            // Debit decreases merchant's wallet balance
            merchantBalance -= parseFloat(transaction.amount);
          } else if (transaction.transactionType === 'initial_balance') {
            // Initial balance increases merchant's wallet
            merchantBalance += parseFloat(transaction.amount);
          } else {
            // Fallback to old logic for transactions without transactionType
            if (transaction.type === 'credit') {
              merchantBalance += parseFloat(transaction.amount);
            } else if (transaction.type === 'debit') {
              merchantBalance -= parseFloat(transaction.amount);
            }
          }
        }
      });

      if (merchantBalance < amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient balance in merchant wallet'
        });
      }
    }

    // Create debit transaction for merchant wallet
    const merchantTransaction = await WalletTransaction.create({
      merchantId,
      type: merchantSideType,
      transactionType: customerSideType,
      amount: parseFloat(amount),
      description: `Transfer ${customerSideType === 'credit' ? 'to' : 'from'} ${customerWallet.customer.fullName}: ${description || 'Wallet transaction'}`,
      reference: `TRF_${Date.now()}`,
      status: 'Completed',
      date: new Date(),
      relatedId: customerWallet.id,
      relatedType: 'customer_wallet',
      paymentMethod: paymentMethod || null
    });

    // Update customer wallet balance
    await customerWallet.update({
      balance: parseFloat(customerWallet.balance) + (customerSideType === 'credit' ? parseFloat(amount) : -parseFloat(amount)),
      lastTransactionDate: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Transfer completed successfully',
      transfer: {
        id: merchantTransaction.id,
        amount,
        customerName: customerWallet.customer.fullName,
        reference: merchantTransaction.reference,
        date: merchantTransaction.date
      }
    });
  } catch (error) {
    console.error('Error transferring to customer:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete transfer',
      error: error.message
    });
  }
};

module.exports = {
  getWalletBalance,
  createWalletTransaction,
  getWalletTransactions,
  getWalletTransactionById,
  updateTransactionStatus,
  getWalletStats,
  transferToCustomer
};

