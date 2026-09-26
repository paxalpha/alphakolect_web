const db = require('./models');

const plans = [
  {
    name: 'Starter Pack',
    type: 'standard',
    billing_cycle: 'monthly',
    pricing: 5000,
    max_agents: 3,
    status: 'active',
  },
  {
    name: 'Growth Pack',
    type: 'standard',
    billing_cycle: 'monthly',
    pricing: 10000,
    max_agents: 6,
    status: 'active',
  },
  {
    name: 'Mid-level Pack',
    type: 'standard',
    billing_cycle: 'monthly',
    pricing: 15000,
    max_agents: 10,
    status: 'active',
  },
  {
    name: 'Large Pack',
    type: 'standard',
    billing_cycle: 'monthly',
    pricing: 40000,
    max_agents: 20,
    status: 'active',
  },
  {
    name: 'Enterprise Pack',
    type: 'custom',
    billing_cycle: 'monthly',
    pricing: 0,
    max_agents: 999999,
    status: 'active',
  },
];

async function seed() {
  try {
    for (const plan of plans) {
      const [p, created] = await db.Plan.findOrCreate({
        where: { name: plan.name },
        defaults: plan,
      });
      if (created) console.log(`Created plan: ${plan.name}`);
      else console.log(`Plan already exists: ${plan.name}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
