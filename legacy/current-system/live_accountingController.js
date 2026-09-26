const { Account, JournalEntry, JournalLine, FiscalPeriod, Merchant, sequelize } = require('../models');
const { Op } = require('sequelize');

// ==================== ACCOUNT (COA) OPERATIONS ====================

// Create Account
const createAccount = async (req, res) => {
  try {
    const { code, name, type, category, balance, currency, description } = req.body;
    const merchantId = req.user.id;

    // Check if account code already exists for this merchant
    const existingAccount = await Account.findOne({
      where: { code, merchantId }
    });

    if (existingAccount) {
      return res.status(400).json({ message: 'Account code already exists' });
    }

    const account = await Account.create({
      code,
      name,
      type,
      category,
      balance: balance || 0,
      currency: currency || 'NGN',
      description,
      merchantId
    });

    res.status(201).json({
      message: 'Account created successfully',
      account
    });
  } catch (error) {
    console.error('Create account error:', error);
    res.status(500).json({ message: 'Failed to create account', error: error.message });
  }
};

// Get all accounts
const getAccounts = async (req, res) => {
  try {
    const merchantId = req.user.id;
    
    // Auto-seed default accounts if they don't exist yet
    const { seedDefaultAccounts } = require('../utils/doubleEntry');
    await seedDefaultAccounts(merchantId);

    const { type, category, isActive } = req.query;

    const where = { merchantId };
    if (type) where.type = type;
    if (category) where.category = category;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const accounts = await Account.findAll({
      where,
      order: [['code', 'ASC']]
    });

    res.json({ accounts });
  } catch (error) {
    console.error('Get accounts error:', error);
    res.status(500).json({ message: 'Failed to fetch accounts', error: error.message });
  }
};

// Get account by ID
const getAccountById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const account = await Account.findOne({
      where: { id, merchantId }
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    res.json({ account });
  } catch (error) {
    console.error('Get account error:', error);
    res.status(500).json({ message: 'Failed to fetch account', error: error.message });
  }
};

// Update Account
const updateAccount = async (req, res) => {
  try {
    const { id, code, name, type, category, balance, currency, description, isActive } = req.body;
    const merchantId = req.user.id;

    const account = await Account.findOne({
      where: { id, merchantId }
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Check if new code conflicts with another account
    if (code && code !== account.code) {
      const existingAccount = await Account.findOne({
        where: { code, merchantId, id: { [Op.ne]: id } }
      });

      if (existingAccount) {
        return res.status(400).json({ message: 'Account code already exists' });
      }
    }

    await account.update({
      code: code || account.code,
      name: name || account.name,
      type: type || account.type,
      category: category || account.category,
      balance: balance !== undefined ? balance : account.balance,
      currency: currency || account.currency,
      description: description !== undefined ? description : account.description,
      isActive: isActive !== undefined ? isActive : account.isActive
    });

    res.json({
      message: 'Account updated successfully',
      account
    });
  } catch (error) {
    console.error('Update account error:', error);
    res.status(500).json({ message: 'Failed to update account', error: error.message });
  }
};

// Delete Account
const deleteAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const account = await Account.findOne({
      where: { id, merchantId }
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Check if account has journal entries
    const journalLineCount = await JournalLine.count({
      where: { accountId: id }
    });

    if (journalLineCount > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete account with existing transactions. Please deactivate instead.' 
      });
    }

    await account.destroy();

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Failed to delete account', error: error.message });
  }
};

// ==================== JOURNAL ENTRY OPERATIONS ====================

// Generate unique journal reference
const generateJournalReference = async (merchantId) => {
  const count = await JournalEntry.count({ where: { merchantId } });
  const year = new Date().getFullYear();
  return `JE-${year}-${String(count + 1).padStart(5, '0')}`;
};

// Create Journal Entry
const createJournalEntry = async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { date, description, lines, attachments } = req.body;
    const merchantId = req.user.id;

    // Validate lines
    if (!lines || lines.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Journal entry must have at least one line' });
    }

    // Calculate totals
    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of lines) {
      totalDebit += parseFloat(line.debit || 0);
      totalCredit += parseFloat(line.credit || 0);
    }

    // Validate balanced entry
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      await transaction.rollback();
      return res.status(400).json({ 
        message: 'Journal entry is not balanced. Debits must equal credits.',
        totalDebit,
        totalCredit
      });
    }

    // Generate reference
    const reference = await generateJournalReference(merchantId);

    // Create journal entry
    const journalEntry = await JournalEntry.create({
      reference,
      date,
      description,
      totalDebit,
      totalCredit,
      status: 'draft',
      attachments,
      merchantId,
      createdBy: req.user.id
    }, { transaction });

    // Create journal lines
    for (const line of lines) {
      await JournalLine.create({
        journalEntryId: journalEntry.id,
        accountId: line.accountId,
        debit: parseFloat(line.debit || 0),
        credit: parseFloat(line.credit || 0),
        description: line.description
      }, { transaction });
    }

    await transaction.commit();

    // Fetch complete entry with lines
    const completeEntry = await JournalEntry.findByPk(journalEntry.id, {
      include: [{ 
        model: JournalLine, 
        as: 'lines',
        include: [{ model: Account }]
      }]
    });

    res.status(201).json({
      message: 'Journal entry created successfully',
      journalEntry: completeEntry
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Create journal entry error:', error);
    res.status(500).json({ message: 'Failed to create journal entry', error: error.message });
  }
};

// Get all journal entries
const getJournalEntries = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { status, dateFrom, dateTo } = req.query;

    const where = { merchantId };
    if (status) where.status = status;
    if (dateFrom && dateTo) {
      where.date = {
        [Op.between]: [dateFrom, dateTo]
      };
    }

    const journalEntries = await JournalEntry.findAll({
      where,
      include: [{ 
        model: JournalLine, 
        as: 'lines',
        include: [{ model: Account }]
      }],
      order: [['date', 'DESC'], ['id', 'DESC']]
    });

    res.json({ journalEntries });
  } catch (error) {
    console.error('Get journal entries error:', error);
    res.status(500).json({ message: 'Failed to fetch journal entries', error: error.message });
  }
};

// Get journal entry by ID
const getJournalEntryById = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const journalEntry = await JournalEntry.findOne({
      where: { id, merchantId },
      include: [{ 
        model: JournalLine, 
        as: 'lines',
        include: [{ model: Account }]
      }]
    });

    if (!journalEntry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    res.json({ journalEntry });
  } catch (error) {
    console.error('Get journal entry error:', error);
    res.status(500).json({ message: 'Failed to fetch journal entry', error: error.message });
  }
};

// Post journal entry (change status from draft to posted)
const postJournalEntry = async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const journalEntry = await JournalEntry.findOne({
      where: { id, merchantId },
      include: [{ model: JournalLine, as: 'lines' }]
    });

    if (!journalEntry) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    if (journalEntry.status !== 'draft') {
      await transaction.rollback();
      return res.status(400).json({ message: 'Only draft entries can be posted' });
    }

    // Update account balances
    for (const line of journalEntry.lines) {
      const account = await Account.findByPk(line.accountId);
      if (account) {
        const debit = parseFloat(line.debit || 0);
        const credit = parseFloat(line.credit || 0);
        
        // Update balance based on account type
        let balanceChange = 0;
        if (['Asset', 'Expense'].includes(account.type)) {
          balanceChange = debit - credit;
        } else {
          balanceChange = credit - debit;
        }

        await account.update({
          balance: parseFloat(account.balance) + balanceChange
        }, { transaction });
      }
    }

    // Update journal entry status
    await journalEntry.update({ status: 'posted' }, { transaction });

    await transaction.commit();

    res.json({
      message: 'Journal entry posted successfully',
      journalEntry
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Post journal entry error:', error);
    res.status(500).json({ message: 'Failed to post journal entry', error: error.message });
  }
};

// Reverse journal entry
const reverseJournalEntry = async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const originalEntry = await JournalEntry.findOne({
      where: { id, merchantId },
      include: [{ model: JournalLine, as: 'lines' }]
    });

    if (!originalEntry) {
      await transaction.rollback();
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    if (originalEntry.status !== 'posted') {
      await transaction.rollback();
      return res.status(400).json({ message: 'Only posted entries can be reversed' });
    }

    // Generate reference for reversing entry
    const reference = await generateJournalReference(merchantId);

    // Create reversing entry
    const reversingEntry = await JournalEntry.create({
      reference,
      date: new Date(),
      description: `Reversal of ${originalEntry.reference}: ${originalEntry.description}`,
      totalDebit: originalEntry.totalDebit,
      totalCredit: originalEntry.totalCredit,
      status: 'posted',
      merchantId,
      createdBy: req.user.id
    }, { transaction });

    // Create reversing lines (swap debit and credit)
    for (const line of originalEntry.lines) {
      await JournalLine.create({
        journalEntryId: reversingEntry.id,
        accountId: line.accountId,
        debit: line.credit,
        credit: line.debit,
        description: `Reversal: ${line.description || ''}`
      }, { transaction });

      // Update account balance
      const account = await Account.findByPk(line.accountId);
      if (account) {
        const debit = parseFloat(line.credit || 0);
        const credit = parseFloat(line.debit || 0);
        
        let balanceChange = 0;
        if (['Asset', 'Expense'].includes(account.type)) {
          balanceChange = debit - credit;
        } else {
          balanceChange = credit - debit;
        }

        await account.update({
          balance: parseFloat(account.balance) + balanceChange
        }, { transaction });
      }
    }

    // Mark original entry as reversed
    await originalEntry.update({
      status: 'reversed',
      reversedBy: reversingEntry.id
    }, { transaction });

    await transaction.commit();

    res.json({
      message: 'Journal entry reversed successfully',
      reversingEntry
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Reverse journal entry error:', error);
    res.status(500).json({ message: 'Failed to reverse journal entry', error: error.message });
  }
};

// Delete journal entry (only drafts)
const deleteJournalEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.id;

    const journalEntry = await JournalEntry.findOne({
      where: { id, merchantId }
    });

    if (!journalEntry) {
      return res.status(404).json({ message: 'Journal entry not found' });
    }

    if (journalEntry.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft entries can be deleted' });
    }

    // Delete journal lines first
    await JournalLine.destroy({ where: { journalEntryId: id } });
    
    // Delete journal entry
    await journalEntry.destroy();

    res.json({ message: 'Journal entry deleted successfully' });
  } catch (error) {
    console.error('Delete journal entry error:', error);
    res.status(500).json({ message: 'Failed to delete journal entry', error: error.message });
  }
};

// ==================== LEDGER OPERATIONS ====================

// Get general ledger
const getGeneralLedger = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { accountId, dateFrom, dateTo } = req.query;

    if (!accountId) {
      return res.status(400).json({ message: 'Account ID is required' });
    }

    // Fetch the account first
    const account = await Account.findOne({
      where: { id: accountId, merchantId }
    });

    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const where = { accountId };
    
    // Build query for journal entries
    const journalWhere = { merchantId, status: 'posted' };
    if (dateFrom && dateTo) {
      journalWhere.date = {
        [Op.between]: [dateFrom, dateTo]
      };
    }

    const journalLines = await JournalLine.findAll({
      where,
      include: [{
        model: JournalEntry,
        where: journalWhere,
        required: true
      }],
      order: [[JournalEntry, 'date', 'ASC'], [JournalEntry, 'id', 'ASC']]
    });

    // Calculate running balance
    let runningBalance = 0;
    const ledgerEntries = journalLines.map(line => {
      const debit = parseFloat(line.debit || 0);
      const credit = parseFloat(line.credit || 0);
      
      // Calculate balance change based on account type
      let balanceChange = 0;
      if (['Asset', 'Expense'].includes(account.type)) {
        balanceChange = debit - credit;
      } else {
        balanceChange = credit - debit;
      }
      
      runningBalance += balanceChange;

      return {
        date: line.JournalEntry.date,
        reference: line.JournalEntry.reference,
        description: line.description || line.JournalEntry.description,
        debit,
        credit,
        balance: runningBalance
      };
    });

    res.json({ 
      ledgerEntries,
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        category: account.category,
        balance: account.balance
      }
    });
  } catch (error) {
    console.error('Get general ledger error:', error);
    res.status(500).json({ message: 'Failed to fetch ledger', error: error.message });
  }
};

// ==================== FISCAL PERIOD OPERATIONS ====================

// Create fiscal period
const createFiscalPeriod = async (req, res) => {
  try {
    const { name, startDate, endDate } = req.body;
    const merchantId = req.user.id;

    const fiscalPeriod = await FiscalPeriod.create({
      name,
      startDate,
      endDate,
      status: 'open',
      merchantId
    });

    res.status(201).json({
      message: 'Fiscal period created successfully',
      fiscalPeriod
    });
  } catch (error) {
    console.error('Create fiscal period error:', error);
    res.status(500).json({ message: 'Failed to create fiscal period', error: error.message });
  }
};

// Get fiscal periods
const getFiscalPeriods = async (req, res) => {
  try {
    const merchantId = req.user.id;

    const fiscalPeriods = await FiscalPeriod.findAll({
      where: { merchantId },
      order: [['startDate', 'DESC']]
    });

    res.json({ fiscalPeriods });
  } catch (error) {
    console.error('Get fiscal periods error:', error);
    res.status(500).json({ message: 'Failed to fetch fiscal periods', error: error.message });
  }
};

// Update fiscal period
const updateFiscalPeriod = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, startDate, endDate, status } = req.body;
    const merchantId = req.user.id;

    const fiscalPeriod = await FiscalPeriod.findOne({
      where: { id, merchantId }
    });

    if (!fiscalPeriod) {
      return res.status(404).json({ message: 'Fiscal period not found' });
    }

    await fiscalPeriod.update({
      name: name || fiscalPeriod.name,
      startDate: startDate || fiscalPeriod.startDate,
      endDate: endDate || fiscalPeriod.endDate,
      status: status || fiscalPeriod.status
    });

    res.json({
      message: 'Fiscal period updated successfully',
      fiscalPeriod
    });
  } catch (error) {
    console.error('Update fiscal period error:', error);
    res.status(500).json({ message: 'Failed to update fiscal period', error: error.message });
  }
};

// ==================== REPORTS ====================

// Get trial balance
const getTrialBalance = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { asOfDate } = req.query;

    const accounts = await Account.findAll({
      where: { merchantId, isActive: true },
      order: [['code', 'ASC']]
    });

    let totalDebit = 0;
    let totalCredit = 0;

    const trialBalance = accounts.map(account => {
      const balance = parseFloat(account.balance || 0);
      let debit = 0;
      let credit = 0;

      if (balance > 0) {
        if (['Asset', 'Expense'].includes(account.type)) {
          debit = balance;
        } else {
          credit = balance;
        }
      } else if (balance < 0) {
        if (['Asset', 'Expense'].includes(account.type)) {
          credit = Math.abs(balance);
        } else {
          debit = Math.abs(balance);
        }
      }

      totalDebit += debit;
      totalCredit += credit;

      return {
        code: account.code,
        name: account.name,
        type: account.type,
        debit,
        credit
      };
    });

    res.json({
      trialBalance,
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit
    });
  } catch (error) {
    console.error('Get trial balance error:', error);
    res.status(500).json({ message: 'Failed to generate trial balance', error: error.message });
  }
};

// Get balance sheet
const getBalanceSheet = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { asOfDate } = req.query;

    const accounts = await Account.findAll({
      where: { merchantId, isActive: true },
      order: [['code', 'ASC']]
    });

    const balanceSheet = {
      assets: {
        current: [],
        fixed: [],
        total: 0
      },
      liabilities: {
        current: [],
        longTerm: [],
        total: 0
      },
      equity: {
        items: [],
        total: 0
      }
    };

    accounts.forEach(account => {
      const balance = parseFloat(account.balance || 0);
      const item = {
        code: account.code,
        name: account.name,
        category: account.category,
        balance
      };

      if (account.type === 'Asset') {
        if (account.category.toLowerCase().includes('current')) {
          balanceSheet.assets.current.push(item);
        } else {
          balanceSheet.assets.fixed.push(item);
        }
        balanceSheet.assets.total += balance;
      } else if (account.type === 'Liability') {
        if (account.category.toLowerCase().includes('current')) {
          balanceSheet.liabilities.current.push(item);
        } else {
          balanceSheet.liabilities.longTerm.push(item);
        }
        balanceSheet.liabilities.total += balance;
      } else if (account.type === 'Equity') {
        balanceSheet.equity.items.push(item);
        balanceSheet.equity.total += balance;
      }
    });

    res.json({ balanceSheet });
  } catch (error) {
    console.error('Get balance sheet error:', error);
    res.status(500).json({ message: 'Failed to generate balance sheet', error: error.message });
  }
};

// Get income statement (P&L)
const getIncomeStatement = async (req, res) => {
  try {
    const merchantId = req.user.id;
    const { dateFrom, dateTo } = req.query;

    const accounts = await Account.findAll({
      where: { 
        merchantId, 
        isActive: true,
        type: { [Op.in]: ['Revenue', 'Expense'] }
      },
      order: [['code', 'ASC']]
    });

    const incomeStatement = {
      revenue: {
        items: [],
        total: 0
      },
      expenses: {
        items: [],
        total: 0
      },
      netIncome: 0
    };

    accounts.forEach(account => {
      const balance = parseFloat(account.balance || 0);
      const item = {
        code: account.code,
        name: account.name,
        category: account.category,
        amount: Math.abs(balance)
      };

      if (account.type === 'Revenue') {
        incomeStatement.revenue.items.push(item);
        incomeStatement.revenue.total += Math.abs(balance);
      } else if (account.type === 'Expense') {
        incomeStatement.expenses.items.push(item);
        incomeStatement.expenses.total += Math.abs(balance);
      }
    });

    incomeStatement.netIncome = incomeStatement.revenue.total - incomeStatement.expenses.total;

    res.json({ incomeStatement });
  } catch (error) {
    console.error('Get income statement error:', error);
    res.status(500).json({ message: 'Failed to generate income statement', error: error.message });
  }
};

module.exports = {
  // Account operations
  createAccount,
  getAccounts,
  getAccountById,
  updateAccount,
  deleteAccount,
  
  // Journal entry operations
  createJournalEntry,
  getJournalEntries,
  getJournalEntryById,
  postJournalEntry,
  reverseJournalEntry,
  deleteJournalEntry,
  
  // Ledger operations
  getGeneralLedger,
  
  // Fiscal period operations
  createFiscalPeriod,
  getFiscalPeriods,
  updateFiscalPeriod,
  
  // Reports
  getTrialBalance,
  getBalanceSheet,
  getIncomeStatement
};