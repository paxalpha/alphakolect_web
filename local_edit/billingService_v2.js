const { Merchant, Agent, WalletTransaction, Plan, Subscription, sequelize } = require('../models');
const { Op } = require('sequelize');

// Maps agent count to plan tier
const getPlanIdForAgentCount = (agentCount) => {
  if (agentCount <= 3)  return 1; // Starter Pack   - ₦5,000
  if (agentCount <= 6)  return 2; // Growth Pack    - ₦10,000
  if (agentCount <= 10) return 3; // Mid-level Pack - ₦15,000
  if (agentCount <= 20) return 4; // Large Pack     - ₦40,000
  return 5;                        // Enterprise Pack - Custom
};

const calculateStandardPlanFee = (agentCount) => {
  if (agentCount <= 3)  return 5000;
  if (agentCount <= 6)  return 10000;
  if (agentCount <= 10) return 15000;
  if (agentCount <= 20) return 40000;
  return 40000; // Enterprise defaults to Large until custom is set
};

/**
 * Recalculate and update a merchant's plan based on current agent count.
 * Called whenever agents are added/removed.
 */
const updateMerchantPlan = async (merchantId) => {
  try {
    const merchant = await Merchant.findByPk(merchantId, {
      include: [{ model: Agent, as: 'agents', attributes: ['id'] }]
    });
    if (!merchant) return;

    // Don't recalculate if merchant is on a custom fee
    if (merchant.isCustomFee) return;

    const agentCount = merchant.agents ? merchant.agents.length : 0;
    const newPlanId = getPlanIdForAgentCount(agentCount);

    if (merchant.planId !== newPlanId) {
      await merchant.update({ planId: newPlanId });
      console.log(`[Billing] Merchant ${merchantId} plan updated to planId=${newPlanId} (${agentCount} agents)`);
    }
  } catch (err) {
    console.error(`[Billing] updateMerchantPlan error for merchant ${merchantId}:`, err.message);
  }
};

const runBillingCycle = async () => {
  console.log('[Billing] --- Starting Billing Cycle ---');
  const now = new Date();

  const merchants = await Merchant.findAll({
    where: {
      nextBillingDate: { [Op.lte]: now },
      // Only bill merchants that are Active, Grace, or Blocked (not Suspended)
      subscriptionStatus: { [Op.in]: ['Active', 'Grace', 'Blocked'] }
    },
    include: [{ model: Agent, as: 'agents', attributes: ['id'] }]
  });

  console.log(`[Billing] Found ${merchants.length} merchants due for billing.`);

  for (const merchant of merchants) {
    const t = await sequelize.transaction();
    try {
      const inTrial = merchant.trialEndDate && new Date(merchant.trialEndDate) > now;

      // Calculate fee
      let fee = 0;
      let effectivePlanId = merchant.planId;

      if (!inTrial) {
        if (merchant.isCustomFee && merchant.customFee) {
          fee = parseFloat(merchant.customFee);
          // Custom fee merchants keep their current planId
        } else {
          const agentCount = merchant.agents ? merchant.agents.length : 0;
          fee = calculateStandardPlanFee(agentCount);
          effectivePlanId = getPlanIdForAgentCount(agentCount);
        }
      }

      // Advance next billing date by 30 days
      const currentBillingDate = merchant.nextBillingDate || now;
      const nextDate = new Date(currentBillingDate);
      nextDate.setDate(nextDate.getDate() + 30);

      if (!inTrial && fee > 0) {
        const newDebt = parseFloat(merchant.totalDebt || 0) + fee;

        // Create Subscription Invoice Record
        await Subscription.create({
          merchantId: merchant.id,
          planId: effectivePlanId,
          amount: fee,
          status: 'Pending',
          periodStart: merchant.nextBillingDate,
          periodEnd: nextDate
        }, { transaction: t });

        // Update merchant: accumulate debt, update plan, advance billing date
        // Status: if debt > 0 → Blocked; once paid → back to Active
        await merchant.update({
          totalDebt: newDebt,
          nextBillingDate: nextDate,
          planId: effectivePlanId,
          subscriptionStatus: 'Blocked'   // blocked until paid
        }, { transaction: t });

        console.log(`[Billing] Merchant ${merchant.id} billed ₦${fee}. Total debt: ₦${newDebt}.`);
      } else if (inTrial) {
        // Trial period — just advance billing date, no charge
        await merchant.update({ nextBillingDate: nextDate }, { transaction: t });
        console.log(`[Billing] Merchant ${merchant.id} in trial. Next billing: ${nextDate.toISOString()}`);
      } else {
        // fee === 0 (no agents) — advance billing date, stay active
        await merchant.update({
          nextBillingDate: nextDate,
          planId: effectivePlanId
        }, { transaction: t });
        console.log(`[Billing] Merchant ${merchant.id} — no agents, no charge. Next billing: ${nextDate.toISOString()}`);
      }

      await t.commit();

      // After committing, attempt to auto-pay from wallet
      if (!inTrial && fee > 0) {
        await attemptAutoPayment(merchant.id);
      }

    } catch (err) {
      await t.rollback();
      console.error(`[Billing] Failed to bill merchant ${merchant.id}:`, err.message);
    }
  }

  console.log('[Billing] --- Billing Cycle Finished ---');
};

const attemptAutoPayment = async (merchantId) => {
  const merchant = await Merchant.findByPk(merchantId);
  if (!merchant || parseFloat(merchant.totalDebt || 0) <= 0) return;

  const debt = parseFloat(merchant.totalDebt);

  // Calculate wallet balance from completed transactions
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

  console.log(`[Billing] Merchant ${merchantId} wallet balance: ₦${balance}, debt: ₦${debt}`);

  if (balance >= debt) {
    const t = await sequelize.transaction();
    try {
      // Debit wallet
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

      // Mark pending subscriptions as Paid
      await Subscription.update(
        { status: 'Paid', paymentDate: new Date() },
        { where: { merchantId: merchant.id, status: 'Pending' }, transaction: t }
      );

      // Clear debt, unlock dashboard
      await merchant.update({
        totalDebt: 0,
        subscriptionStatus: 'Active'
      }, { transaction: t });

      await t.commit();
      console.log(`[Billing] Merchant ${merchantId} auto-paid ₦${debt} successfully.`);
    } catch (err) {
      await t.rollback();
      console.error(`[Billing] Auto-payment failed for merchant ${merchantId}:`, err.message);
    }
  } else {
    console.log(`[Billing] Merchant ${merchantId} insufficient wallet balance (₦${balance} < ₦${debt}). Dashboard blocked.`);
  }
};

module.exports = { runBillingCycle, updateMerchantPlan, calculateStandardPlanFee, getPlanIdForAgentCount };
