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
      package: packageNameRaw, 
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

    // Find customer
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
        orFilters.push({ fullName: nameLike }, { name: nameLike }, { alias: nameLike });
      }
      if (phoneNumber) orFilters.push({ phoneNumber });
      if (email) orFilters.push({ email });
      if (orFilters.length > 0) {
        customerRecord = await Customer.findOne({ where: { ...whereClause, [Op.or]: orFilters } });
      }
    }

    if (!customerRecord) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const investedAmount = parseFloat(amount);
    const packageName = packageNameRaw || '';

    // Find the package
    const investmentPackage = await Package.findOne({
      where: {
        name: packageName,
        merchantId: merchantId,
        packageCategory: 'Investment'
      }
    });

    if (!investmentPackage) {
      return res.status(404).json({ success: false, message: 'Investment package not found' });
    }

    // Find associated application
    let application = await InvestmentApplication.findOne({
      where: {
        customerId: customerRecord.id,
        merchantId,
        status: { [Op.in]: ['Approved', 'Closed'] }
      },
      order: [['createdAt', 'DESC']]
    });

    if (!application) {
      return res.status(400).json({ success: false, message: 'No active or approved investment application found for this customer.' });
    }

    // Check for dormancy/default logic
    if (application.status !== 'Closed') {
      const lastTransaction = await InvestmentTransaction.findOne({
        where: {
          customerId: customerRecord.id,
          package: packageName,
          merchantId,
          status: 'completed'
        },
        order: [['transactionDate', 'DESC']]
      });

      const referenceDate = lastTransaction ? new Date(lastTransaction.transactionDate) : new Date(application.approvedAt || application.createdAt);
      const daysSinceLastPost = Math.floor((new Date() - referenceDate) / (1000 * 60 * 60 * 24));

      const defaultDays = investmentPackage.defaultDays || 20; // Default to 20 if not specified
      if (daysSinceLastPost >= defaultDays) {
        await application.update({ status: 'Closed' });
        // Refresh application state
        application.status = 'Closed';
      }
    }

    // Block transactions on CLOSED applications
    if (application.status === 'Closed' && transactionType !== 'withdrawal') {
      return res.status(400).json({
        success: false,
        message: 'Application is CLOSED due to default/dormancy. No transaction posting allowed.'
      });
    }

    // Withdrawal Constraints
    if (transactionType === 'withdrawal') {
      const approvalDate = new Date(application.approvedAt || application.createdAt);
      const daysSinceApproval = Math.floor((new Date() - approvalDate) / (1000 * 60 * 60 * 24));
      const requiredDuration = investmentPackage.duration || 50; // Default to 50 as per example

      if (daysSinceApproval < requiredDuration) {
        return res.status(400).json({
          success: false,
          message: `Withdrawal not allowed. Investment days not fulfilled. Required: ${requiredDuration} days, Current: ${daysSinceApproval} days since approval.`
        });
      }
    }

    // If logged in as agent, auto-populate agent name and branch unless provided
    let agentName = agent || '';
    let branchName = branch || '';
    if (req.user?.type === 'agent') {
      const agentRecord = await Agent.findByPk(req.user.id);
      if (agentRecord) {
        if (!agentName) agentName = agentRecord.fullName || agentRecord.name || '';
        if (!branchName) branchName = agentRecord.branch || '';
      }
    }

    // Process Transaction(s)
    const transactions = [];
    const dailyAmount = parseFloat(investmentPackage.amount);
    
    // Handle advance payment logic for deposits
    if (transactionType === 'deposit' && dailyAmount > 0) {
      const daysCovered = Math.floor(investedAmount / dailyAmount);
      const remainingAmount = investedAmount % dailyAmount;

      if (daysCovered > 0) {
        // ... (Existing advance payment logic refactored for clarity)
        const lastTx = await InvestmentTransaction.findOne({
          where: { customerId: customerRecord.id, package: packageName, transactionType: 'deposit', merchantId, status: 'completed' },
          order: [['transactionDate', 'DESC']]
        });

        let nextDate = new Date();
        nextDate.setHours(0, 0, 0, 0);
        if (lastTx) {
          const lastDate = new Date(lastTx.transactionDate);
          lastDate.setHours(0, 0, 0, 0);
          nextDate = new Date(lastDate);
          nextDate.setDate(nextDate.getDate() + 1);
          if (nextDate < new Date()) nextDate = new Date();
        }

        for (let i = 0; i < daysCovered; i++) {
          const txDate = new Date(nextDate);
          txDate.setDate(nextDate.getDate() + i);
          
          const tx = await InvestmentTransaction.create({
            customerId: customerRecord.id,
            customer: customerRecord.fullName,
            accountNumber: customerRecord.accountNumber,
            package: packageName,
            amount: dailyAmount,
            branch: branchName,
            agent: agentName,
            transactionType: 'deposit',
            notes: notes || `Day ${i + 1} of payment`,
            merchantId,
            status: 'completed',
            transactionDate: txDate
          });
          transactions.push(tx);

          // INTEREST GENERATION
          if (investmentPackage.interestRate > 0) {
            const interestAmount = dailyAmount * (parseFloat(investmentPackage.interestRate) / 100);
            const interestTx = await InvestmentTransaction.create({
              customerId: customerRecord.id,
              customer: customerRecord.fullName,
              accountNumber: customerRecord.accountNumber,
              package: packageName,
              amount: interestAmount,
              branch: branchName,
              agent: agentName,
              transactionType: 'interest',
              notes: `Interest for deposit on ${txDate.toLocaleDateString()}`,
              merchantId,
              status: 'completed',
              transactionDate: txDate
            });
            transactions.push(interestTx);
          }
        }

        if (remainingAmount > 0) {
          const remDate = new Date(nextDate);
          remDate.setDate(nextDate.getDate() + daysCovered);
          const remTx = await InvestmentTransaction.create({
            customerId: customerRecord.id,
            customer: customerRecord.fullName,
            accountNumber: customerRecord.accountNumber,
            package: packageName,
            amount: remainingAmount,
            branch: branchName,
            agent: agentName,
            transactionType: 'deposit',
            notes: `Remainder payment`,
            merchantId,
            status: 'completed',
            transactionDate: remDate
          });
          transactions.push(remTx);
        }

        // Update Wallet Investment Balance
        const { CustomerWallet } = require('../models');
        let wallet = await CustomerWallet.findOne({ where: { customerId: customerRecord.id, merchantId } });
        if (wallet) {
          const allTx = await InvestmentTransaction.findAll({ 
            where: { customerId: customerRecord.id, merchantId, status: 'completed' } 
          });
          const totalInvested = allTx.reduce((sum, tx) => {
            if (tx.transactionType === 'deposit' || tx.transactionType === 'interest') return sum + parseFloat(tx.amount || 0);
            if (tx.transactionType === 'withdrawal') return sum - parseFloat(tx.amount || 0);
            return sum;
          }, 0);
          await wallet.update({ investmentBalance: Math.max(totalInvested, 0) });
        }

        return res.status(201).json({ success: true, message: 'Transactions created', transactions });
      }
    }

    // Default single transaction
    const mainTx = await InvestmentTransaction.create({
      customerId: customerRecord.id,
      customer: customerRecord.fullName,
      accountNumber: customerRecord.accountNumber,
      package: packageName,
      amount: investedAmount,
      branch: branchName,
      agent: agentName,
      transactionType,
      notes: notes || '',
      merchantId,
      status: 'completed',
      transactionDate: new Date()
    });
    transactions.push(mainTx);

    // Interest for single deposit
    if (transactionType === 'deposit' && investmentPackage.interestRate > 0) {
      const interestAmount = investedAmount * (parseFloat(investmentPackage.interestRate) / 100);
      const interestTx = await InvestmentTransaction.create({
        customerId: customerRecord.id,
        customer: customerRecord.fullName,
        accountNumber: customerRecord.accountNumber,
        package: packageName,
        amount: interestAmount,
        branch: branchName,
        agent: agentName,
        transactionType: 'interest',
        notes: `Interest for deposit`,
        merchantId,
        status: 'completed',
        transactionDate: new Date()
      });
      transactions.push(interestTx);
    }

  } catch (error) {
    console.error('Error creating investment transaction:', error);
    res.status(500).json({ success: false, message: 'Failed to create investment transaction', error: error.message });
  }
};

// ... (Rest of the controller functions: getInvestmentTransactions, getInvestmentTransactionById, etc.)

const getInvestmentTransactions = async (req, res) => {
  try {
    let merchantId = req.user?.merchantId;
    if (!merchantId) {
      if (req.user?.type === 'merchant') merchantId = req.user.id;
      else if (req.user?.type === 'agent') {
        const agentOwner = await Agent.findByPk(req.user.id);
        merchantId = agentOwner ? agentOwner.merchantId : undefined;
      }
    }
    const { status, search, fromDate, toDate, page = 1, limit = 10, agentId, branch, transactionType } = req.query;
    const whereClause = { merchantId };
    if (status) whereClause.status = status;
    if (transactionType) whereClause.transactionType = transactionType;
    if (branch) whereClause.branch = { [Op.iLike]: `%${branch}%` };
    if (agentId) whereClause.agent = { [Op.iLike]: `%${agentId}%` };
    if (search) {
      whereClause[Op.or] = [
        { customer: { [Op.iLike]: `%${search}%` } },
        { accountNumber: { [Op.iLike]: `%${search}%` } },
        { package: { [Op.iLike]: `%${search}%` } }
      ];
    }
    if (fromDate && toDate) {
      whereClause.transactionDate = { [Op.between]: [new Date(fromDate), new Date(toDate)] };
    }
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows: transactions } = await InvestmentTransaction.findAndCountAll({
      where: whereClause,
      include: [{ model: Customer, attributes: ['id', 'fullName', 'email', 'phoneNumber'] }],
      order: [['transactionDate', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });
    res.json({ success: true, transactions, total: count, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(count / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch investment transactions', error: error.message });
  }
};

const getInvestmentTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    let merchantId = req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null);
    const transaction = await InvestmentTransaction.findOne({
      where: { id, merchantId },
      include: [{ model: Customer, attributes: ['id', 'fullName', 'email', 'phoneNumber'] }]
    });
    if (!transaction) return res.status(404).json({ success: false, message: 'Investment transaction not found' });
    res.json({ success: true, transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch investment transaction', error: error.message });
  }
};

const updateInvestmentTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    let merchantId = req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null);
    const transaction = await InvestmentTransaction.findOne({ where: { id, merchantId } });
    if (!transaction) return res.status(404).json({ success: false, message: 'Investment transaction not found' });
    await transaction.update(req.body);
    res.json({ success: true, message: 'Investment transaction updated successfully', transaction });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update investment transaction', error: error.message });
  }
};

const deleteInvestmentTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    let merchantId = req.user?.merchantId || (req.user?.type === 'merchant' ? req.user.id : null);
    const transaction = await InvestmentTransaction.findOne({ where: { id, merchantId } });
    if (!transaction) return res.status(404).json({ success: false, message: 'Investment transaction not found' });
    await transaction.destroy();
    res.json({ success: true, message: 'Investment transaction deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete investment transaction', error: error.message });
  }
};

module.exports = {
  createInvestmentTransaction,
  getInvestmentTransactions,
  getInvestmentTransactionById,
  updateInvestmentTransaction,
  deleteInvestmentTransaction
};
