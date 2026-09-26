const { Account, JournalEntry, JournalLine } = require('../models');

/**
 * Auto-seeds the default 19 Chart of Accounts for a merchant if they don't have any.
 */
const seedDefaultAccounts = async (merchantId, transaction = null) => {
  try {
    const defaultAccounts = [
      { code: '100200', name: 'Wallet', type: 'Asset', category: 'Current Assets', balance: 0, description: 'Customer electronic wallet' },
      { code: '100300', name: 'Bank', type: 'Asset', category: 'Current Assets', balance: 0, description: 'Main clearing bank account' },
      { code: '100400', name: 'Cash', type: 'Asset', category: 'Current Assets', balance: 0, description: 'Cash in vault' },
      { code: '100450', name: 'Petty Cash', type: 'Asset', category: 'Current Assets', balance: 0, description: 'Petty cash for office expenses' },
      { code: '200100', name: 'Customer Collection - Savings', type: 'Liability', category: 'Current Liabilities', balance: 0, description: 'Standard savings deposit' },
      { code: '200200', name: 'Customer Collection - Target Savings', type: 'Liability', category: 'Current Liabilities', balance: 0, description: 'Targeted savings deposits' },
      { code: '200300', name: 'Customer Collection - Investment', type: 'Liability', category: 'Current Liabilities', balance: 0, description: 'Investment deposit account' },
      { code: '200400', name: "Director's Current Account", type: 'Liability', category: 'Current Liabilities', balance: 0, description: 'Current account for directors' },
      { code: '200500', name: 'Customer Loans', type: 'Liability', category: 'Current Liabilities', balance: 0, description: 'Customer loan accounts' },
      { code: '200550', name: 'Loan Repayment', type: 'Liability', category: 'Current Liabilities', balance: 0, description: 'Holding account for repayments' },
      { code: '300100', name: 'Capital Account', type: 'Equity', category: 'Equity', balance: 0, description: "Owner's capital or equity" },
      { code: '400100', name: 'Commission on Collection', type: 'Revenue', category: 'Operating Revenue', balance: 0, description: 'Collection commissions' },
      { code: '400200', name: 'Charges - Collection', type: 'Revenue', category: 'Operating Revenue', balance: 0, description: 'Collection transaction fees' },
      { code: '400300', name: 'Charges - Loan Application', type: 'Revenue', category: 'Operating Revenue', balance: 0, description: 'Loan application fee income' },
      { code: '400400', name: 'General Charges (SMS charges, card charges etc.)', type: 'Revenue', category: 'Operating Revenue', balance: 0, description: 'SMS alerts and general fees' },
      { code: '400500', name: 'Charges for Target Savings', type: 'Revenue', category: 'Operating Revenue', balance: 0, description: 'Target savings administration fees' },
      { code: '400600', name: 'Interest Loan', type: 'Revenue', category: 'Operating Revenue', balance: 0, description: 'Interest income on customer loans' },
      { code: '400700', name: 'Subscription Revenue', type: 'Revenue', category: 'Operating Revenue', balance: 0, description: 'Income from platform subscription payments' },
      { code: '500200', name: 'Interest Target Savings', type: 'Expense', category: 'Operating Expenses', balance: 0, description: 'Interest paid on target savings' },
      { code: '500300', name: 'Interest Fixed Deposit', type: 'Expense', category: 'Operating Expenses', balance: 0, description: 'Interest paid on fixed deposits' },
      { code: '500400', name: 'Platform Subscription', type: 'Expense', category: 'Operating Expenses', balance: 0, description: 'Software platform subscription fees' }
    ];

    // Check which specific 6-digit codes are already present for this merchant.
    // This handles merchants who signed up before the accounting upgrade and already
    // have old-style short codes (e.g. 101, 102) — we add ONLY the missing 6-digit
    // accounts rather than skipping the whole seed because count > 0.
    const requiredCodes = defaultAccounts.map(a => a.code);
    const existingCodes = await Account.findAll({
      where: { merchantId, code: requiredCodes },
      attributes: ['code'],
      transaction
    }).then(rows => rows.map(r => r.code));

    const missingAccounts = defaultAccounts.filter(a => !existingCodes.includes(a.code));

    if (missingAccounts.length === 0) return; // All required accounts already present

    console.log(`🌱 Adding ${missingAccounts.length} missing accounting accounts for merchant #${merchantId}...`);

    for (const acc of missingAccounts) {
      await Account.create({
        ...acc,
        merchantId,
        currency: 'NGN',
        isActive: true
      }, { transaction });
    }

    console.log(`✅ Accounting accounts seeded for merchant #${merchantId} (${missingAccounts.length} added)`);
  } catch (error) {
    console.error(`❌ Failed to seed default accounts for merchant #${merchantId}:`, error);
  }
};

/**
 * Books a double-entry transaction by creating a posted Journal Entry,
 * creating corresponding debit and credit Journal Lines, and updating Account balances.
 */
const bookDoubleEntry = async (merchantId, { date, description, debitCode, creditCode, amount, transaction = null }) => {
  try {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return null;

    if (!merchantId) {
      console.warn('⚠️ bookDoubleEntry failed: merchantId is required');
      return null;
    }

    // Attempt to locate debit and credit accounts
    let debitAccount = await Account.findOne({ where: { code: debitCode, merchantId }, transaction });
    let creditAccount = await Account.findOne({ where: { code: creditCode, merchantId }, transaction });

    // Self-healing: if accounts are missing, auto-seed and reload
    if (!debitAccount || !creditAccount) {
      await seedDefaultAccounts(merchantId, transaction);
      debitAccount = await Account.findOne({ where: { code: debitCode, merchantId }, transaction });
      creditAccount = await Account.findOne({ where: { code: creditCode, merchantId }, transaction });
    }

    if (!debitAccount || !creditAccount) {
      console.warn(`⚠️ Double entry booking skipped because accounts do not exist. Debit: ${debitCode} (${!!debitAccount}), Credit: ${creditCode} (${!!creditAccount})`);
      return null;
    }

    // Generate a unique reference using timestamp + random suffix to avoid collisions
    const year = new Date().getFullYear();
    const ts   = Date.now().toString(36).toUpperCase(); // base-36 timestamp
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase(); // 4-char random
    const reference = `JE-${year}-${ts}${rand}`;

    // Create journal entry directly in posted status
    const journalEntry = await JournalEntry.create({
      reference,
      date: date || new Date(),
      description,
      totalDebit: parsedAmount,
      totalCredit: parsedAmount,
      status: 'posted',
      merchantId
    }, { transaction });

    // Create journal lines
    await JournalLine.create({
      journalEntryId: journalEntry.id,
      accountId: debitAccount.id,
      debit: parsedAmount,
      credit: 0,
      description
    }, { transaction });

    await JournalLine.create({
      journalEntryId: journalEntry.id,
      accountId: creditAccount.id,
      debit: 0,
      credit: parsedAmount,
      description
    }, { transaction });

    // Update account balances using ATOMIC increments so concurrent bookings
    // never lose updates (read-modify-write races below caused stale balances).
    // Debit Account: Assets and Expenses increase with debits; others decrease
    const debitChange = ['Asset', 'Expense'].includes(debitAccount.type) ? parsedAmount : -parsedAmount;
    await debitAccount.increment('balance', {
      by: debitChange,
      transaction
    });

    // Credit Account: Assets and Expenses decrease with credits; others increase
    const creditChange = ['Asset', 'Expense'].includes(creditAccount.type) ? -parsedAmount : parsedAmount;
    await creditAccount.increment('balance', {
      by: creditChange,
      transaction
    });

    console.log(`📝 Posted double-entry JE [${reference}]: Dr ${debitCode} / Cr ${creditCode} for ₦${parsedAmount.toLocaleString()}`);
    return journalEntry;
  } catch (error) {
    console.error('❌ Failed to book double entry:', error);
    throw error;
  }
};

module.exports = {
  seedDefaultAccounts,
  bookDoubleEntry
};
