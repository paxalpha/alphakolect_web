const { InvestmentTransaction, Customer, Merchant, Agent, Package, Investment, InvestmentApplication, CustomerWallet } = require('../models');
const { Op } = require('sequelize');
const { postJournalForTransaction } = require('../utils/transactionMapping');

const sumTransactions = async (customerId, merchantId, packageName, transactionType) => {
  const txs = await InvestmentTransaction.findAll({
    where: {
      customerId,
      merchantId,
      package: packageName,
      transactionType,
      status: 'completed'
    }
  });
  return txs.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
};

const getActiveApplication = async (customerId, merchantId) => {
  return InvestmentApplication.findOne({
    where: {
      customerId,
      merchantId,
      status: { [Op.in]: ['Approved', 'Closed'] }
    },
    order: [['approvedAt', 'DESC']]
  });
};

const updateInvestmentWalletBalance = async (customerId, merchantId, delta) => {
  try {
    const wallet = await CustomerWallet.findOne({ where: { customerId, merchantId } });
    if (wallet) {
      const current = parseFloat(wallet.investmentBalance || 0);
      await wallet.update({ investmentBalance: Math.max(0, current + delta) });
    }
  } catch (err) {
    console.warn('Could not update investment wallet balance:', err.message);
  }
};

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
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
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

    // Centralized package/application validation for deposits and withdrawals
    if (packageName && (transactionType === 'deposit' || transactionType === 'withdrawal')) {
      const investmentPackage = await Package.findOne({
        where: { name: packageName, merchantId, packageCategory: 'Investment' }
      });

      if (investmentPackage) {
        const activeApplication = await getActiveApplication(customerRecord.id, merchantId);

        if (transactionType === 'deposit') {
          if (!activeApplication || activeApplication.status !== 'Approved') {
            return res.status(400).json({
              success: false,
              message: 'Transaction failed. Customer must have an approved investment application.'
            });
          }

          if (activeApplication.status === 'Closed') {
            return res.status(400).json({
              success: false,
              message: 'Transaction failed. This investment application is CLOSED and no further postings are allowed.'
            });
          }

          const defaultDays = parseInt(investmentPackage.defaultDays || 0);
          if (defaultDays > 0) {
            const lastTx = await InvestmentTransaction.findOne({
              where: {
                customerId: customerRecord.id,
                merchantId,
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
              await activeApplication.update({ status: 'Closed' });
              return res.status(400).json({
                success: false,
                message: `Transaction failed. No posting was made for ${daysSinceLastPost} days (limit: ${defaultDays} days). Application is now CLOSED.`
              });
            }
          }

          // No single-cycle cap — multi-cycle rollover is handled in the deposit loop below.
          }

        if (transactionType === 'withdrawal') {
          const application = activeApplication;
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

          const totalPrincipal = await sumTransactions(customerRecord.id, merchantId, packageName, 'deposit');
          const totalInterest = await sumTransactions(customerRecord.id, merchantId, packageName, 'interest');
          const totalWithdrawn = await sumTransactions(customerRecord.id, merchantId, packageName, 'withdrawal');
          const totalAvailable = totalPrincipal + totalInterest - totalWithdrawn;

          if (totalAvailable <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Withdrawal failed. No funds available for withdrawal.'
            });
          }

          if (investedAmount > totalAvailable) {
            return res.status(400).json({
              success: false,
              message: `Withdrawal failed. Maximum withdrawable amount (principal + interest) is ₦${totalAvailable.toLocaleString()}.`
            });
          }
        }
      }
    }

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
            const packageDuration = investmentPackage.duration ? parseInt(investmentPackage.duration) : 180;
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

              const totalDayNum = existingDays + i + 1;
              const cycleNum = Math.floor((totalDayNum - 1) / packageDuration) + 1;
              const dayInCycle = ((totalDayNum - 1) % packageDuration) + 1;
              
              const noteText = notes || (i === 0 
                ? `Advance payment covering ${daysCovered} days (Cycle ${cycleNum} - Day ${dayInCycle})` 
                : `Cycle ${cycleNum} - Day ${dayInCycle}`);

              const tx = await InvestmentTransaction.create({
                customerId: customerRecord.id,
                customer: customer || customerRecord.fullName || customerRecord.name,
                accountNumber: accountNumber || customerRecord.accountNumber,
                package: packageName,
                amount: dailyAmount,
                branch: branchName,
                agent: agentName,
                transactionType: 'deposit',
                notes: noteText,
                merchantId,
                status: 'completed',
                transactionDate: txDate
              });
              createdTransactions.push(tx);

              // Book double-entry for advance deposit
              try {
                await postJournalForTransaction(
                  'INVESTMENT_DEPOSIT',
                  dailyAmount,
                  merchantId,
                  `Investment Deposit (Advance Day ${i+1}) - Package: ${packageName} (Tx #${tx.id})`
                );
              } catch (deErr) {
                console.warn('⚠️ Double-entry skipped for advance deposit:', deErr.message);
              }

              // Generate interest transaction
              if (interestRate > 0) {
                const interestAmt = dailyAmount * (interestRate / 100);
                await InvestmentTransaction.create({
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
                });
                // Book double-entry for interest
                try {
                  await postJournalForTransaction(
                    'INVESTMENT_RETURNS',
                    interestAmt,
                    merchantId,
                    `Interest Accrued on Deposit #${tx.id}`
                  );
                } catch (deErr) {
                  console.warn('⚠️ Double-entry skipped for interest:', deErr.message);
                }
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
              });
              createdTransactions.push(remTx);

              // Book double-entry for remainder deposit
              try {
                await postJournalForTransaction(
                  'INVESTMENT_DEPOSIT',
                  remainingAmount,
                  merchantId,
                  `Investment Deposit Remainder - Package: ${packageName} (Tx #${remTx.id})`
                );
              } catch (deErr) {
                console.warn('⚠️ Double-entry skipped for remainder deposit:', deErr.message);
              }

              if (interestRate > 0) {
                const interestAmt = remainingAmount * (interestRate / 100);
                await InvestmentTransaction.create({
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
                });
                // Book double-entry for remainder interest
                try {
                  await postJournalForTransaction(
                    'INVESTMENT_RETURNS',
                    interestAmt,
                    merchantId,
                    `Interest Accrued on Remainder Deposit #${remTx.id}`
                  );
                } catch (deErr) {
                  console.warn('⚠️ Double-entry skipped for remainder interest:', deErr.message);
                }
              }
            }

            const totalDeposited = createdTransactions
              .filter(t => t.transactionType === 'deposit')
              .reduce((s, t) => s + parseFloat(t.amount), 0);
            await updateInvestmentWalletBalance(customerRecord.id, merchantId, totalDeposited);

            return res.status(201).json({
              success: true,
              message: `Investment transaction created successfully. Amount covers ${daysCovered} day(s).`,
              transactions: createdTransactions
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
    });

    // Book double-entry for single transaction
    try {
      if (transactionType === 'deposit') {
        await postJournalForTransaction(
          'INVESTMENT_DEPOSIT',
          investedAmount,
          merchantId,
          `Investment Deposit - Package: ${packageName} (Tx #${transaction.id})`
        );
      } else if (transactionType === 'withdrawal') {
        await postJournalForTransaction(
          'INVESTMENT_WITHDRAWAL',
          investedAmount,
          merchantId,
          `Investment Withdrawal - Package: ${packageName} (Tx #${transaction.id})`
        );
      }
    } catch (deErr) {
      console.warn('⚠️ Double-entry skipped for investment transaction:', deErr.message);
    }

    if (transactionType === 'deposit') {
      await updateInvestmentWalletBalance(customerRecord.id, merchantId, investedAmount);
    } else if (transactionType === 'withdrawal') {
      await updateInvestmentWalletBalance(customerRecord.id, merchantId, -investedAmount);
    }

    // Generate interest for single deposit
    if (transactionType === 'deposit' && packageName) {
      const investmentPackage = await Package.findOne({
        where: { name: packageName, merchantId: merchantId, packageCategory: 'Investment' }
      });
      if (investmentPackage && parseFloat(investmentPackage.interestRate) > 0) {
        const interestAmt = investedAmount * (parseFloat(investmentPackage.interestRate) / 100);
        await InvestmentTransaction.create({
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
        });
        // Book double-entry for generated interest
        try {
          await postJournalForTransaction(
            'INVESTMENT_RETURNS',
            interestAmt,
            merchantId,
            `Interest Accrued on Deposit #${transaction.id}`
          );
        } catch (deErr) {
          console.warn('⚠️ Double-entry skipped for interest accrual:', deErr.message);
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Investment transaction created successfully',
      transaction
    });
  } catch (error) {
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
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
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
      transactionType,
      customerId
    } = req.query;

    const whereClause = { merchantId };

    // Customer filter
    if (customerId) {
      whereClause.customerId = parseInt(customerId);
    }
    
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
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
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
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
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
      if (req.user?.type === 'merchant' || req.user?.type === 'collaborator' || req.user?.type === 'staff') {
        merchantId = req.user.merchantId || req.user.id;
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

    // Determine mapping type based on transactionType to post a reversal
    let mappingType = null;
    if (transaction.transactionType === 'deposit') {
      mappingType = 'INVESTMENT_DEPOSIT';
    } else if (transaction.transactionType === 'withdrawal') {
      mappingType = 'INVESTMENT_WITHDRAWAL';
    } else if (transaction.transactionType === 'interest') {
      mappingType = 'INVESTMENT_RETURNS';
    }

    if (mappingType) {
      try {
        const { postReversalForTransaction } = require('../utils/transactionMapping');
        await postReversalForTransaction(
          mappingType,
          transaction.amount,
          merchantId,
          `Original Tx ID: ${transaction.id}, Package: ${transaction.package || 'N/A'}, Customer: ${transaction.customer || 'N/A'}`
        );
      } catch (err) {
        console.warn(`⚠️ Reversal failed during investment transaction delete: ${err.message}`);
      }
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
