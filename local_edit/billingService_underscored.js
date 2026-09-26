const { Merchant, Agent, WalletTransaction, Plan, Subscription, sequelize } = require('../models');
const { Op } = require('sequelize');

const calculateStandardPlanFee = (agentCount) => {
  if (agentCount <= 3) return 5000;
  if (agentCount <= 6) return 10000;
  if (agentCount <= 10) return 15000;
  if (agentCount <= 20) return 40000;
  return 40000; // Enterprise (Custom) - defaulting to Large if not set
};

const runBillingCycle = async () => {
  console.log('--- Starting Billing Cycle ---');
  const now = new Date();
  
  const merchants = await Merchant.findAll({
    where: {
      next_billing_date: { [Op.lte]: now }
    },
    include: [{ model: Agent, as: 'agents', attributes: ['id'] }]
  });

  console.log(`Found ${merchants.length} merchants due for billing.`);

  for (const merchant of merchants) {
    const t = await sequelize.transaction();
    try {
      const inTrial = merchant.trial_end_date && new Date(merchant.trial_end_date) > now;
      
      let fee = 0;
      if (!inTrial) {
        if (merchant.is_custom_fee && merchant.custom_fee) {
          fee = parseFloat(merchant.custom_fee);
        } else {
          const agentCount = merchant.agents ? merchant.agents.length : 0;
          fee = calculateStandardPlanFee(agentCount);
        }
      }

      // Update next billing date (add 30 days)
      const currentBillingDate = merchant.next_billing_date || now;
      const nextDate = new Date(currentBillingDate);
      nextDate.setDate(nextDate.getDate() + 30);

      if (!inTrial && fee > 0) {
        // Add to debt
        const newDebt = parseFloat(merchant.total_debt || 0) + fee;

        // Create Subscription Invoice Record
        await Subscription.create({
          merchantId: merchant.id,
          amount: fee,
          status: 'Pending',
          periodStart: merchant.next_billing_date,
          periodEnd: nextDate
        }, { transaction: t });

        await merchant.update({
          total_debt: newDebt,
          next_billing_date: nextDate,
          subscription_status: newDebt > 0 ? 'Blocked' : 'Active'
        }, { transaction: t });
        
        console.log(`Merchant ${merchant.id} billed ${fee}. Total debt: ${newDebt}.`);
      } else {
        // Just update the next billing date if in trial or zero fee
        await merchant.update({
          next_billing_date: nextDate
        }, { transaction: t });
        console.log(`Merchant ${merchant.id} skipped fee (In Trial or Fee=0). Next billing: ${nextDate.toISOString()}`);
      }

      await t.commit();

      if (!inTrial && fee > 0) {
        // Attempt automatic payment from wallet
        await attemptAutoPayment(merchant.id);
      }
      
    } catch (err) {
      await t.rollback();
      console.error(`Failed to bill merchant ${merchant.id}:`, err);
    }
  }
  console.log('--- Billing Cycle Finished ---');
};

const attemptAutoPayment = async (merchantId) => {
  const merchant = await Merchant.findByPk(merchantId);
  if (!merchant || parseFloat(merchant.total_debt) <= 0) return;

  const debt = parseFloat(merchant.total_debt);
  
  // Calculate balance (Simplified: using local transaction sum for now)
  const transactions = await WalletTransaction.findAll({
    where: { merchantId: merchant.id, status: 'Completed' },
    attributes: ['type', 'transactionType', 'amount']
  });

  let balance = 0;
  transactions.forEach(tx => {
    const amt = parseFloat(tx.amount);
    const type = tx.transactionType || tx.type;
    if (type === 'credit' || type === 'initial_balance') balance += amt;
    else if (type === 'debit') balance -= amt;
  });

  if (balance >= debt) {
    console.log(`Merchant ${merchantId} has enough balance (${balance}). Processing payment of ${debt}...`);
    
    const t = await sequelize.transaction();
    try {
      // Create Debit Transaction
      await WalletTransaction.create({
        merchantId: merchant.id,
        amount: debt,
        type: 'debit',
        transactionType: 'debit',
        status: 'Completed',
        description: 'Auto-renewal of subscription',
        reference: `SUB_PAY_${Date.now()}`,
        date: new Date()
      }, { transaction: t });

      // Update all Pending subscriptions to Paid
      await Subscription.update({ status: 'Paid', paymentDate: new Date() }, {
        where: { merchantId: merchant.id, status: 'Pending' },
        transaction: t
      });

      // Update Merchant
      await merchant.update({
        total_debt: 0,
        subscription_status: 'Active'
      }, { transaction: t });

      await t.commit();
      console.log(`Merchant ${merchantId} paid successfully.`);
    } catch (err) {
      await t.rollback();
      console.error(`Failed auto-payment for merchant ${merchantId}:`, err);
    }
  } else {
    console.log(`Merchant ${merchantId} insufficient balance (${balance} < ${debt}).`);
  }
};

module.exports = { runBillingCycle };
