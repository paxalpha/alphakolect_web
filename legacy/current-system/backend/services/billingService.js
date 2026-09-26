/**
 * billingService.js
 * 
 * Core billing logic for Alphakolect subscription system.
 * - Counts active agents for a merchant
 * - Maps agent count to the correct plan (Starter, Growth, Mid-level, Large, Enterprise)
 * - Deducts plan cost from wallet
 * - Creates Subscription and WalletTransaction records
 * - Updates merchant status and next_billing_date
 */

const PLAN_TIERS = [
  { minAgents: 1,  maxAgents: 3,  planId: 1, name: 'Starter Pack',  price: 5000  },
  { minAgents: 4,  maxAgents: 6,  planId: 2, name: 'Growth Pack',   price: 10000 },
  { minAgents: 7,  maxAgents: 10, planId: 3, name: 'Mid-level',     price: 15000 },
  { minAgents: 11, maxAgents: 20, planId: 4, name: 'Large',         price: 40000 },
  { minAgents: 21, maxAgents: Infinity, planId: 5, name: 'Enterprise', price: null }, // Custom / admin-managed
];

/**
 * Determine which plan a merchant should be on based on their active agent count.
 * @param {number} agentCount - Current number of active agents
 * @returns {{ planId, name, price, isCustom }} resolved plan info
 */
function resolvePlanByAgentCount(agentCount) {
  const count = Math.max(agentCount, 1); // treat 0 agents as 1

  for (const tier of PLAN_TIERS) {
    if (count >= tier.minAgents && count <= tier.maxAgents) {
      return {
        planId: tier.planId,
        name: tier.name,
        price: tier.price,
        isCustom: tier.price === null,
      };
    }
  }

  // Fallback: Starter Pack
  return { planId: 1, name: 'Starter Pack', price: 5000, isCustom: false };
}

/**
 * Bill a single merchant for their current subscription period.
 * - Determines plan from current active agent count
 * - Deducts wallet (records debt if insufficient balance)
 * - Creates Subscription + WalletTransaction records
 * - Updates merchant plan_id, subscription_status, next_billing_date
 *
 * @param {number} merchantId
 * @param {object} models - Sequelize models { Merchant, Agent, Plan, Subscription, WalletTransaction, sequelize }
 * @returns {{ success, merchantId, message, planName, price, newBalance }}
 */
async function billMerchant(merchantId, models) {
  const { Merchant, Agent, Plan, Subscription, WalletTransaction, sequelize } = models;

  const t = await sequelize.transaction();
  try {
    // Lock merchant row
    const merchant = await Merchant.findByPk(merchantId, { transaction: t, lock: true });
    if (!merchant) {
      await t.rollback();
      return { success: false, merchantId, message: 'Merchant not found' };
    }

    // Count active agents
    const agentCount = await Agent.count({
      where: { merchantId },
      transaction: t,
    });

    // Resolve plan from agent count
    const resolved = resolvePlanByAgentCount(agentCount);

    // Enterprise plans are admin-managed: flag them but don't auto-deduct
    if (resolved.isCustom) {
      merchant.plan_id = resolved.planId;
      merchant.subscription_status = 'Active';
      const nextBilling = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      merchant.next_billing_date = nextBilling;
      await merchant.save({ transaction: t });

      await Subscription.create({
        merchantId,
        planId: resolved.planId,
        amount: 0,
        status: 'Pending',
        periodStart: new Date(),
        periodEnd: nextBilling,
        paymentDate: null,
      }, { transaction: t });

      await t.commit();
      return {
        success: true,
        merchantId,
        message: `Enterprise plan - manual pricing required. No auto-deduction.`,
        planName: resolved.name,
        price: 0,
        agentCount,
      };
    }

    // Standard plan: deduct from wallet
    const price = resolved.price;
    const currentBalance = parseFloat(merchant.wallet_balance || 0);
    const newBalance = currentBalance - price;
    const now = new Date();
    const nextBilling = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // If insufficient balance → record debt, suspend
    let subscriptionStatus;
    let walletTxStatus;
    let debtAdded = 0;

    if (newBalance < 0) {
      subscriptionStatus = 'Suspended';
      walletTxStatus = 'Failed';
      debtAdded = Math.abs(newBalance);
      merchant.total_debt = parseFloat(merchant.total_debt || 0) + price;
    } else {
      subscriptionStatus = 'Active';
      walletTxStatus = 'Completed';
    }

    // Update merchant
    merchant.wallet_balance = newBalance < 0 ? currentBalance : newBalance;
    merchant.plan_id = resolved.planId;
    merchant.subscription_status = subscriptionStatus;
    merchant.next_billing_date = nextBilling;
    await merchant.save({ transaction: t });

    // Create subscription record
    await Subscription.create({
      merchantId,
      planId: resolved.planId,
      amount: price,
      status: walletTxStatus === 'Completed' ? 'Paid' : 'Overdue',
      periodStart: now,
      periodEnd: nextBilling,
      paymentDate: walletTxStatus === 'Completed' ? now : null,
    }, { transaction: t });

    // Create wallet transaction
    await WalletTransaction.create({
      merchantId,
      amount: price,
      type: 'debit',
      transactionType: 'subscription',
      category: 'subscription',
      description: `Monthly subscription - ${resolved.name} (${agentCount} agent${agentCount !== 1 ? 's' : ''})`,
      status: walletTxStatus,
      balanceBefore: currentBalance,
      balanceAfter: newBalance < 0 ? currentBalance : newBalance,
      date: now,
    }, { transaction: t });

    await t.commit();

    return {
      success: true,
      merchantId,
      message: walletTxStatus === 'Completed'
        ? `Billed ₦${price.toLocaleString()} for ${resolved.name}`
        : `Insufficient balance. Suspended. Debt: ₦${price.toLocaleString()}`,
      planName: resolved.name,
      price,
      newBalance: merchant.wallet_balance,
      subscriptionStatus,
      agentCount,
    };
  } catch (err) {
    await t.rollback();
    console.error(`[BillingService] Error billing merchant ${merchantId}:`, err.message);
    return { success: false, merchantId, message: err.message };
  }
}

/**
 * Run billing for all merchants whose next_billing_date has passed.
 * Skips trial periods (trial_end_date still in future) and Enterprise plans without custom pricing.
 *
 * @param {object} models - Sequelize models
 * @returns {Array} results
 */
async function runBillingCycle(models) {
  const { Merchant, Op } = models;
  const now = new Date();

  console.log(`[BillingCycle] Starting at ${now.toISOString()}`);

  // Find merchants whose billing date has passed and are not suspended/already billed
  const merchants = await Merchant.findAll({
    where: {
      next_billing_date: { [Op.lte]: now },
      subscription_status: { [Op.notIn]: ['Blocked'] },
      // Skip merchants still on free trial (trial_end_date in the future)
      [Op.or]: [
        { trial_end_date: null },
        { trial_end_date: { [Op.lte]: now } },
      ],
    },
    attributes: ['id', 'businessName', 'subscription_status', 'next_billing_date', 'trial_end_date'],
  });

  console.log(`[BillingCycle] Found ${merchants.length} merchants due for billing.`);

  const results = [];
  for (const merchant of merchants) {
    const result = await billMerchant(merchant.id, models);
    console.log(`[BillingCycle] Merchant ${merchant.id} (${merchant.businessName}): ${result.message}`);
    results.push(result);
  }

  console.log(`[BillingCycle] Done. ${results.filter(r => r.success).length}/${results.length} billed successfully.`);
  return results;
}

module.exports = {
  PLAN_TIERS,
  resolvePlanByAgentCount,
  billMerchant,
  runBillingCycle,
};
