const { runBillingCycle } = require('../services/billingService');

async function main() {
  try {
    await runBillingCycle();
    process.exit(0);
  } catch (err) {
    console.error('Billing script failed:', err);
    process.exit(1);
  }
}

main();
