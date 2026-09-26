const { InvestmentTransaction, Customer, Merchant, Agent, Package, Investment, InvestmentApplication } = require('../models');
const { Op } = require('sequelize');

/**
 * @swagger
 * tags:
 *   - name: Investment Transactions
 *     description: Investment transaction management
 * /investment-transactions:
 *   get:
 *     summary: List investment transactions
 *     tags: [Investment Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: transactionType
 *         schema: { type: string }
 *       - in: query
 *         name: branch
 *         schema: { type: string }
 *       - in: query
 *         name: agentId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Transactions list
 *   post:
 *     summary: Create investment transaction
 *     tags: [Investment Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer, amount, transactionType]
 *             properties:
 *               customer: { type: string }
 *               accountNumber: { type: string }
 *               package: { type: string }
 *               amount: { type: number, format: float }
 *               branch: { type: string }
 *               agent: { type: string }
 *               transactionType: { type: string }
 *               notes: { type: string }
 * /investment-transactions/{id}:
 *   get:
 *     summary: Get investment transaction by ID
 *     tags: [Investment Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Transaction retrieved
 *   put:
 *     summary: Update investment transaction
 *     tags: [Investment Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *   delete:
 *     summary: Delete investment transaction
 *     tags: [Investment Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Transaction deleted
 */

// Create a new investment transaction
const createInvestmentTransaction = async (req, res) => {
  try {
    const { 
      customer, 
      customerName, 
      phoneNumber,
      email,
      accountNumber, 
      package, 
      amount, 
      branch, 
      agent, 
      transactionType, 
      notes 
    } = req.body;
    
    // Resolve merchantId from authenticated context
    let merchantId = req.user?.merchantId || req.body.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant') {
        merchantId = req.user.id;
      } else if (req.user?.type === 'agent') {
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }

    // Find customer by accountNumber (preferred), or by case-insensitive name, or phone/email; always scoped to merchant
    const providedNameRaw = customer || customerName;
    const providedName = providedNameRaw ? String(providedNameRaw).trim() : undefined;
    const providedAccountNumber = accountNumber ? String(accountNumber).trim() : undefined;
    const whereClause = { merchantId };
    let customerRecord = null;
    if (providedAccountNumber) {
      customerRecord = await Customer.findOne({ where: { ...whereClause, accountNumber: providedAccountNumber } });
    }
    if (!customerRecord && (providedName || phoneNumber || email)) {
      const nameLike = providedName ? { [Op.iLike]: `%${providedName}%` } : undefined;
      const orFilters = [];
      if (providedName) {
        orFilters.push({ fullName: nameLike });
        orFilters.push({ name: nameLike });
        orFilters.push({ alias: nameLike });
      }
      if (phoneNumber) orFilters.push({ phoneNumber });
      if (email) orFilters.push({ email });
      if (orFilters.length > 0) {
        customerRecord = await Customer.findOne({ where: { ...whereClause, [Op.or]: orFilters } });
      }
    }

    if (!customerRecord) {
      // Secondary unscoped lookup to assist debugging merchant mismatches
      let hint = undefined;
      try {
        const unscopedFilters = [];
        if (providedAccountNumber) unscopedFilters.push({ accountNumber: providedAccountNumber });
        if (providedName) {
          const nameLikeAny = { [Op.iLike]: `%${providedName}%` };
          unscopedFilters.push({ fullName: nameLikeAny });
          unscopedFilters.push({ name: nameLikeAny });
          unscopedFilters.push({ alias: nameLikeAny });
        }
        if (phoneNumber) unscopedFilters.push({ phoneNumber });
        if (email) unscopedFilters.push({ email });
        if (unscopedFilters.length > 0) {
          const foundAny = await Customer.findOne({ where: { [Op.or]: unscopedFilters } });
          if (foundAny) {
            hint = {
              possibleMatchExists: true,
              customerId: foundAny.id,
              customerMerchantId: foundAny.merchantId,
              reason: 'A matching customer exists under a different merchant.'
            };
          }
        }
      } catch {}

      return res.status(404).json({
        success: false,
        message: 'Customer not found',
        details: {
          searched: {
            accountNumber: providedAccountNumber || null,
            name: providedName || null,
            phoneNumber: phoneNumber || null,
            email: email || null,
          },
          hint
        }
      });
    }

    // If logged in as agent, auto-populate agent name and branch unless provided
    let agentName = agent || '';
    let branchName = branch || '';
    if (req.user?.type === 'agent') {
      try {
        const agentRecord = await Agent.findByPk(req.user.id);
        if (agentRecord) {
          if (!agentName) agentName = agentRecord.fullName || agentRecord.name || '';
          if (!branchName) branchName = agentRecord.branch || '';
        }
      } catch {}
    }

    const investedAmount = parseFloat(amount);
    const packageName = package || '';

    const dbTransaction = await InvestmentTransaction.sequelize.transaction();

    // Handle advance payment logic for deposit transactions with investment packages
    if (transactionType === 'deposit' && packageName) {
      // Find the investment package
      const investmentPackage = await Package.findOne({
        where: {
          name: packageName,
          merchantId: merchantId,
          packageCategory: 'Investment'
        }
      });

      if (investmentPackage) {
        const dailyAmount = parseFloat(investmentPackage.amount);
        const interestRate = parseFloat(investmentPackage.interestRate || 0);
        const defaultDays = parseInt(investmentPackage.defaultDays || 0);

        // Check if customer has an approved investment application
        const activeApplication = await InvestmentApplication.findOne({
          where: {
            customerId: customerRecord.id,
            merchantId: merchantId,
            status: { [Op.in]: ['Approved', 'Closed'] }
          },
          order: [['approvedAt', 'DESC']]
        });

        if (activeApplication) {
          // Block if application is closed
          if (activeApplication.status === 'Closed') {
            return res.status(400).json({
              success: false,
              message: 'Transaction failed. This investment application is CLOSED and no further postings are allowed.'
            });
          }

          // Check for default closure (no post for defaultDays)
          if (defaultDays > 0) {
            const lastTx = await InvestmentTransaction.findOne({
              where: {
                customerId: customerRecord.id,
                merchantId: merchantId,
                transactionType: 'deposit',
                status: 'completed'
              },
              order: [['transactionDate', 'DESC']]
            });

            const referenceDate = lastTx
              ? new Date(lastTx.transactionDate)
              : (activeApplication.approvedAt ? new Date(activeApplication.approvedAt) : new Date(activeApplication.createdAt));
            const daysSinceLastPost = Math.floor((new Date() - referenceDate) / (1000 * 60 * 60 * 24));

            if (daysSinceLastPost >= defaultDays) {
              // Mark the application as Closed (InvestmentApplication ENUM supports 'Closed')
              await activeApplication.update({ status: 'Closed' });
              return res.status(400).json({
                success: false,
                message: `Transaction failed. No posting was made for ${daysSinceLastPost} days (limit: ${defaultDays} days). Application is now CLOSED.`
              });
            }
          }
        }

        if (dailyAmount > 0) {
          const daysCovered = Math.floor(investedAmount / dailyAmount);
          const remainingAmount = investedAmount % dailyAmount;

          if (daysCovered > 0) {
            // Check if it would exceed duration
            if (activeApplication) {
              const packageDuration = investmentPackage.duration ? parseInt(investmentPackage.duration) : null;
              if (packageDuration && packageDuration > 0) {
                const existingTxs = await InvestmentTransaction.findAll({
                  where: {
                    customerId: customerRecord.id,
                    package: packageName,
                    transactionType: 'deposit',
                    merchantId: merchantId,
                    status: 'completed'
                  }
                });
                
                let existingDays = 0;
                for (const tx of existingTxs) {
                  existingDays += Math.floor(parseFloat(tx.amount) / dailyAmount);
                }

                if (existingDays + daysCovered > packageDuration) {
                  return res.status(400).json({
                    success: false,
                    message: 'Transaction failed. Investment number of days exceeded.'
                  });
                }
              }
            }

            // Determine next available date
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            let nextDate = new Date(today);

            const lastTx = await InvestmentTransaction.findOne({
              where: {
                customerId: customerRecord.id,
                package: packageName,
                transactionType: 'deposit',
                merchantId: merchantId,
                status: 'completed'
              },
              order: [['transactionDate', 'DESC']]
            });

            if (lastTx) {
              const lastDate = new Date(lastTx.transactionDate);
              lastDate.setHours(0, 0, 0, 0);
              nextDate = new Date(lastDate);
              nextDate.setDate(nextDate.getDate() + 1);
              if (nextDate < today) nextDate = new Date(today);
            }

            const { bookDoubleEntry } = require('../utils/doubleEntry');
            const createdTransactions = [];
            for (let i = 0; i < daysCovered; i++) {
              const txDate = new Date(nextDate);
              txDate.setDate(nextDate.getDate() + i);
              
              const tx = await InvestmentTransaction.create({
                customerId: customerRecord.id,
                customer: customer || customerRecord.fullName || customerRecord.name,
                accountNumber: accountNumber || customerRecord.accountNumber,
                package: packageName,
                amount: dailyAmount,
                branch: branchName,
                agent: agentName,
                transactionType: 'deposit',
                notes: notes || (i === 0 ? `Advance payment covering ${daysCovered} days` : `Day ${i + 1} of advance payment`),
                merchantId,
                status: 'completed',
                transactionDate: txDate
              }, { transaction: dbTransaction });
              createdTransactions.push(tx);

              // Book double-entry for deposit
              await bookDoubleEntry(merchantId, {
                date: txDate,
                description: `Investment Deposit (Advance Day ${i+1}) - Package: ${packageName}`,
                debitCode: '100400',
                creditCode: '200300',
                amount: dailyAmount,
                transaction: dbTransaction
              });

              // Generate interest transaction
              if (interestRate > 0) {
                const interestAmt = dailyAmount * (interestRate / 100);
                const intTx = await InvestmentTransaction.create({
                  customerId: customerRecord.id,
                  customer: customer || customerRecord.fullName || customerRecord.name,
                  accountNumber: accountNumber || customerRecord.accountNumber,
                  package: packageName,
                  amount: interestAmt,
                  branch: branchName,
                  agent: agentName,
                  transactionType: 'interest',
                  notes: `% Interests transaction on deposit #${tx.id}`,
                  merchantId,
                  status: 'completed',
                  transactionDate: txDate
                }, { transaction: dbTransaction });

                // Book double-entry for interest
                await bookDoubleEntry(merchantId, {
                  date: txDate,
                  description: `Interest Accrued on Deposit #${tx.id}`,
                  debitCode: '500300',
                  creditCode: '200300',
                  amount: interestAmt,
                  transaction: dbTransaction
                });
              }
            }

            if (remainingAmount > 0) {
              const txDate = new Date(nextDate);
              txDate.setDate(nextDate.getDate() + daysCovered);
              const remTx = await InvestmentTransaction.create({
                customerId: customerRecord.id,
                customer: customer || customerRecord.fullName || customerRecord.name,
                accountNumber: accountNumber || customerRecord.accountNumber,
                package: packageName,
                amount: remainingAmount,
                branch: branchName,
                agent: agentName,
                transactionType: 'deposit',
                notes: notes || `Partial payment remainder`,
                merchantId,
                status: 'completed',
                transactionDate: txDate
              }, { transaction: dbTransaction });
              createdTransactions.push(remTx);

              // Book double-entry for remainder deposit
              await bookDoubleEntry(merchantId, {
                date: txDate,
                description: `Investment Deposit Remainder - Package: ${packageName}`,
                debitCode: '100400',
                creditCode: '200300',
                amount: remainingAmount,
                transaction: dbTransaction
              });

              if (interestRate > 0) {
                const interestAmt = remainingAmount * (interestRate / 100);
                const intRemTx = await InvestmentTransaction.create({
                  customerId: customerRecord.id,
                  customer: customer || customerRecord.fullName || customerRecord.name,
                  accountNumber: accountNumber || customerRecord.accountNumber,
                  package: packageName,
                  amount: interestAmt,
                  branch: branchName,
                  agent: agentName,
                  transactionType: 'interest',
                  notes: `% Interests transaction on remainder deposit #${remTx.id}`,
                  merchantId,
                  status: 'completed',
                  transactionDate: txDate
                }, { transaction: dbTransaction });

                // Book double-entry for remainder interest
                await bookDoubleEntry(merchantId, {
                  date: txDate,
                  description: `Interest Accrued on Remainder Deposit #${remTx.id}`,
                  debitCode: '500300',
                  creditCode: '200300',
                  amount: interestAmt,
                  transaction: dbTransaction
                });
              }
            }

            await dbTransaction.commit();
            return res.status(201).json({
              success: true,
              message: `Investment transaction created successfully. Amount covers ${daysCovered} day(s).`,
              transactions: createdTransactions
            });
          }
        }
      }
    }

    // Handle withdrawal conditions
    if (transactionType === 'withdrawal' && packageName) {
      const investmentPackage = await Package.findOne({
        where: { name: packageName, merchantId: merchantId, packageCategory: 'Investment' }
      });

      if (investmentPackage) {
        // Use InvestmentApplication to find approved/closed application and get approval date
        const application = await InvestmentApplication.findOne({
          where: { 
            customerId: customerRecord.id, 
            merchantId: merchantId, 
            status: { [Op.in]: ['Approved', 'Closed'] } 
          },
          order: [['approvedAt', 'DESC']]
        });

        if (application) {
          const investmentDaysRequired = parseInt(investmentPackage.duration || 0);
          const approvedDate = application.approvedAt
            ? new Date(application.approvedAt)
            : new Date(application.createdAt);
          const daysElapsed = Math.floor((new Date() - approvedDate) / (1000 * 60 * 60 * 24));

          if (investmentDaysRequired > 0 && daysElapsed < investmentDaysRequired) {
            return res.status(400).json({
              success: false,
              message: `Withdrawal failed. Investment period of ${investmentDaysRequired} days has not been reached. Only ${daysElapsed} days have elapsed since approval.`
            });
          }
        }
      }
    }

    // Default behavior (non-advance payment or withdrawal/interest/penalty)
    const transaction = await InvestmentTransaction.create({
      customerId: customerRecord.id,
      customer: customer || customerRecord.fullName || customerRecord.name,
      accountNumber: accountNumber || customerRecord.accountNumber,
      package: packageName,
      amount: investedAmount,
      branch: branchName,
      agent: agentName,
      transactionType,
      notes: notes || '',
      merchantId,
      status: 'completed'
    }, { transaction: dbTransaction });

    const { bookDoubleEntry } = require('../utils/doubleEntry');

    // Book double-entry for single transaction
    if (transactionType === 'deposit') {
      await bookDoubleEntry(merchantId, {
        date: transaction.transactionDate || new Date(),
        description: `Investment Deposit - Package: ${packageName}`,
        debitCode: '100400',
        creditCode: '200300',
        amount: investedAmount,
        transaction: dbTransaction
      });
    } else if (transactionType === 'withdrawal') {
      await bookDoubleEntry(merchantId, {
        date: transaction.transactionDate || new Date(),
        description: `Investment Withdrawal - Package: ${packageName}`,
        debitCode: '200300',
        creditCode: '100400',
        amount: investedAmount,
        transaction: dbTransaction
      });
    }

    // Generate interest for single deposit
    if (transactionType === 'deposit' && packageName) {
      const investmentPackage = await Package.findOne({
        where: { name: packageName, merchantId: merchantId, packageCategory: 'Investment' },
        transaction: dbTransaction
      });
      if (investmentPackage && parseFloat(investmentPackage.interestRate) > 0) {
        const interestAmt = investedAmount * (parseFloat(investmentPackage.interestRate) / 100);
        const intTx = await InvestmentTransaction.create({
          customerId: customerRecord.id,
          customer: customer || customerRecord.fullName || customerRecord.name,
          accountNumber: accountNumber || customerRecord.accountNumber,
          package: packageName,
          amount: interestAmt,
          branch: branchName,
          agent: agentName,
          transactionType: 'interest',
          notes: `% Interests transaction on deposit #${transaction.id}`,
          merchantId,
          status: 'completed',
          transactionDate: transaction.transactionDate
        }, { transaction: dbTransaction });

        // Book double-entry for interest
        await bookDoubleEntry(merchantId, {
          date: transaction.transactionDate || new Date(),
          description: `Interest Accrued on Deposit #${transaction.id}`,
          debitCode: '500300',
          creditCode: '200300',
          amount: interestAmt,
          transaction: dbTransaction
        });
      }
    }

    await dbTransaction.commit();

    res.status(201).json({
      success: true,
      message: 'Investment transaction created successfully',
      transaction
    });
  } catch (error) {
    if (typeof dbTransaction !== 'undefined' && dbTransaction) {
      try { await dbTransaction.rollback(); } catch(rErr) { console.error('Rollback error:', rErr); }
    }
    console.error('Error creating investment transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create investment transaction',
      error: error.message
    });
  }
};

// Get all investment transactions for a merchant
const getInvestmentTransactions = async (req, res) => {
  try {
    // Resolve merchantId for both merchants and agents
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant') {
        merchantId = req.user.id;
      } else if (req.user?.type === 'agent') {
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }
    if (!merchantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: merchant not identified' });
    }
    const { 
      status, 
      search, 
      fromDate, 
      toDate, 
      page = 1, 
      limit = 10,
      agentId,
      branch,
      transactionType
    } = req.query;

    const whereClause = { merchantId };
    
    // Add filters
    if (status) {
      whereClause.status = status;
    }
    
    if (transactionType) {
      whereClause.transactionType = transactionType;
    }
    
    if (branch) {
      whereClause.branch = { [Op.iLike]: `%${branch}%` };
    }
    
    if (agentId) {
      whereClause.agent = { [Op.iLike]: `%${agentId}%` };
    }
    
    if (search) {
      whereClause[Op.or] = [
        { customer: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } },
        { package: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (fromDate && toDate) {
      whereClause.transactionDate = {
        [Op.between]: [new Date(fromDate), new Date(toDate)]
      };
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const { count, rows: transactions } = await InvestmentTransaction.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Customer,
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        }
      ],
      order: [
        ['transactionDate', 'DESC'],
        ['id', 'DESC']
      ],
      limit: parseInt(limit),
      offset: offset
    });

    res.json({
      success: true,
      transactions,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / parseInt(limit))
    });
  } catch (error) {
    console.error('Error fetching investment transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch investment transactions',
      error: error.message
    });
  }
};

// Get investment transaction by ID
const getInvestmentTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    // Resolve merchantId for both merchants and agents
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant') {
        merchantId = req.user.id;
      } else if (req.user?.type === 'agent') {
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }

    const transaction = await InvestmentTransaction.findOne({
      where: { 
        id: id,
        merchantId: merchantId 
      },
      include: [
        {
          model: Customer,
          attributes: ['id', 'fullName', 'email', 'phoneNumber']
        }
      ]
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Investment transaction not found'
      });
    }

    res.json({
      success: true,
      transaction
    });
  } catch (error) {
    console.error('Error fetching investment transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch investment transaction',
      error: error.message
    });
  }
};

// Update investment transaction
const updateInvestmentTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    // Resolve merchantId for both merchants and agents
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant') {
        merchantId = req.user.id;
      } else if (req.user?.type === 'agent') {
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }
    const updateData = req.body;

    const transaction = await InvestmentTransaction.findOne({
      where: { 
        id: id,
        merchantId: merchantId 
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Investment transaction not found'
      });
    }

    // Update transaction
    await transaction.update(updateData);

    res.json({
      success: true,
      message: 'Investment transaction updated successfully',
      transaction
    });
  } catch (error) {
    console.error('Error updating investment transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update investment transaction',
      error: error.message
    });
  }
};

// Delete investment transaction
const deleteInvestmentTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    // Resolve merchantId for both merchants and agents
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant') {
        merchantId = req.user.id;
      } else if (req.user?.type === 'agent') {
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }

    const transaction = await InvestmentTransaction.findOne({
      where: { 
        id: id,
        merchantId: merchantId 
      }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Investment transaction not found'
      });
    }

    await transaction.destroy();

    res.json({
      success: true,
      message: 'Investment transaction deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting investment transaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete investment transaction',
      error: error.message
    });
  }
};

module.exports = {
  createInvestmentTransaction,
  getInvestmentTransactions,
  getInvestmentTransactionById,
  updateInvestmentTransaction,
  deleteInvestmentTransaction
};
