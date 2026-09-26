/**
 * Transaction Mapping Configuration
 * 
 * Maps system transaction types to their double-entry accounting rules.
 * Uses the existing account codes from the seeded Chart of Accounts.
 * 
 * Account Code Reference:
 *   100200 = Wallet
 *   100300 = Bank (Cash at Bank)
 *   100400 = Cash
 *   200100 = Customer Collection - Savings
 *   200200 = Customer Collection - Target Savings
 *   200300 = Customer Collection - Investment
 *   200500 = Customer Loans
 *   200550 = Loan Repayment
 *   400100 = Commission on Collection
 *   400200 = Charges - Collection
 *   400600 = Interest Loan
 *   400700 = Subscription Revenue
 *   500200 = Interest Target Savings
 */

const { bookDoubleEntry } = require('./doubleEntry');

/**
 * TRANSACTION_MAPPING:
 * Each key maps to { debitCode, creditCode, description }
 * 
 *  ┌─────────────────────────────────────────────┬───────────────────────────┬─────────────────────────────┐
 *  │ Transaction Type                            │ Dr                        │ Cr                         │
 *  ├─────────────────────────────────────────────┼───────────────────────────┼─────────────────────────────┤
 *  │ Collection                                  │ Cash                      │ Customer Collection - Savings│
 *  │ Collection Commission                       │ Customer Collection - Savings │ Cash                     │
 *  │ First Saving (Collection Charge)            │ Cash                      │ Charges - Collection        │
 *  │ Move fund Collection wallet → Loan wallet   │ Customer Collection - Savings │ Customer Loans           │
 *  │ Collection Withdrawal                       │ Customer Collection - Savings │ Cash                     │
 *  │ Loan disbursed                              │ Customer Loans            │ Cash                       │
 *  │ Loan repayment                              │ Cash                      │ Loan Repayment             │
 *  │ Loan Interest                               │ Cash                      │ Interest - Loan            │
 *  │ Investment Collection                       │ Cash                      │ Customer Collection - Target Savings │
 *  │ Interest on Investment                      │ Interest - Target Savings │ Cash                       │
 *  │ Investment Withdrawal to Cash               │ Customer Collection - Target Savings │ Cash            │
 *  │ Load Wallet                                 │ Bank                      │ Wallet                     │
 *  │ Wallet → Customer transfer                  │ Wallet                    │ Customer Collection - Savings│
 *  │ Subscription Payment                        │ Cash                      │ Subscription Revenue       │
 *  │ Subscription Payment using platform wallet  │ Wallet                    │ Subscription Revenue       │
 *  └─────────────────────────────────────────────┴───────────────────────────┴─────────────────────────────┘
 */
const TRANSACTION_MAPPING = {
  COLLECTION_RECEIVED: {
    debitCode: '100400',
    creditCode: '200100',
    label: 'Collection'
  },
  COLLECTION_COMMISSION: {
    debitCode: '200100',
    creditCode: '100400',
    label: 'Collection Commission'
  },
  CHARGE_DEDUCTION: {
    debitCode: '100400',
    creditCode: '400200',
    label: 'First Saving (Collection Charge)'
  },
  LOAN_WALLET_TRANSFER: {
    debitCode: '200100',
    creditCode: '200500',
    label: 'Move Fund from Collection Wallet to Loan Wallet'
  },
  COLLECTION_WITHDRAWAL: {
    debitCode: '200100',
    creditCode: '100400',
    label: 'Collection Withdrawal'
  },
  LOAN_DISBURSEMENT: {
    debitCode: '200500',
    creditCode: '100400',
    label: 'Loan Disbursed'
  },
  LOAN_REPAYMENT_PRINCIPAL: {
    debitCode: '100400',
    creditCode: '200550',
    label: 'Loan Repayment'
  },
  LOAN_INTEREST_REPAYMENT: {
    debitCode: '100400',
    creditCode: '400600',
    label: 'Loan Interest'
  },
  INVESTMENT_DEPOSIT: {
    debitCode: '100400',
    creditCode: '200200',
    label: 'Investment Collection'
  },
  INVESTMENT_RETURNS: {
    debitCode: '500200',
    creditCode: '100400',
    label: 'Interest on Investment'
  },
  INVESTMENT_WITHDRAWAL: {
    debitCode: '200200',
    creditCode: '100400',
    label: 'Investment Withdrawal to Cash'
  },
  WALLET_DEPOSIT: {
    debitCode: '100300',
    creditCode: '100200',
    label: 'Load Wallet'
  },
  WALLET_TRANSFER_TO_CUSTOMER: {
    debitCode: '100200',
    creditCode: '200100',
    label: 'Wallet - Wallet Transfer to Customer'
  },
  SUBSCRIPTION_PAYMENT: {
    debitCode: '100400',
    creditCode: '400700',
    label: 'Subscription Payment'
  },
  SUBSCRIPTION_PAYMENT_WALLET: {
    debitCode: '100200',
    creditCode: '400700',
    label: 'Subscription Payment using Platform Wallet'
  },
  WALLET_WITHDRAWAL: {
    debitCode: '100200',
    creditCode: '100400',
    label: 'Wallet Withdrawal'
  },
  TRANSACTION_FEE: {
    debitCode: '100200',
    creditCode: '400200',
    label: 'Transaction Fee'
  },
  REMITTANCE_SENT: {
    debitCode: '200100',
    creditCode: '200550',
    label: 'Remittance Created (Sent)'
  },
  REMITTANCE_RECEIVED: {
    debitCode: '200550',
    creditCode: '100300',
    label: 'Remittance Payout (Received)'
  }
};

/**
 * Post a journal entry for a system transaction.
 * This is NON-BLOCKING — if it fails, it logs a warning but does NOT
 * interrupt the main transaction flow.
 *
 * @param {string} txType     - One of the TRANSACTION_MAPPING keys
 * @param {number} amount     - Transaction amount
 * @param {number} merchantId - Merchant ID
 * @param {string} refDesc    - Optional reference description (e.g. "Loan #12")
 * @param {object} [dbTransaction=null] - Optional Sequelize transaction object
 * @returns {Promise<void>}
 */
const postJournalForTransaction = async (txType, amount, merchantId, refDesc = '', dbTransaction = null) => {
  const mapping = TRANSACTION_MAPPING[txType];
  if (!mapping) {
    console.warn(`⚠️ No transaction mapping found for type: ${txType}`);
    return;
  }

  const description = refDesc
    ? `${mapping.label} — ${refDesc}`
    : mapping.label;

  try {
    await bookDoubleEntry(merchantId, {
      date: new Date(),
      description,
      debitCode: mapping.debitCode,
      creditCode: mapping.creditCode,
      amount,
      transaction: dbTransaction
    });
  } catch (err) {
    // Non-blocking: warn but don't crash the calling controller
    console.warn(`⚠️ Journal entry skipped for [${txType}]: ${err.message}`);
  }
};

/**
 * Post a reversal journal entry when a transaction is deleted.
 * Swaps debit and credit accounts to reverse the original transaction's accounting effect.
 *
 * @param {string} txType     - One of the TRANSACTION_MAPPING keys
 * @param {number} amount     - Transaction amount
 * @param {number} merchantId - Merchant ID
 * @param {string} refDesc    - Optional reference description containing original transaction audit details
 * @param {object} [dbTransaction=null] - Optional Sequelize transaction object
 * @returns {Promise<void>}
 */
const postReversalForTransaction = async (txType, amount, merchantId, refDesc = '', dbTransaction = null) => {
  const mapping = TRANSACTION_MAPPING[txType];
  if (!mapping) {
    console.warn(`⚠️ No transaction mapping found for type: ${txType}`);
    return;
  }

  const description = `REVERSAL (DELETED) — ${mapping.label}${refDesc ? ` — ${refDesc}` : ''}`;

  try {
    // Swap debitCode and creditCode to book the reversal
    await bookDoubleEntry(merchantId, {
      date: new Date(),
      description,
      debitCode: mapping.creditCode,
      creditCode: mapping.debitCode,
      amount,
      transaction: dbTransaction
    });
  } catch (err) {
    console.warn(`⚠️ Reversal journal entry skipped for [${txType}]: ${err.message}`);
  }
};

module.exports = {
  postJournalForTransaction,
  postReversalForTransaction,
  TRANSACTION_MAPPING
};
