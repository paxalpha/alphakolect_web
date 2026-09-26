const db = require('./models');
const sequelize = db.sequelize;

async function seedPlans() {
  try {
    console.log('🌱 Seeding sample plans...');

    // Check if plans already exist
    const [results] = await sequelize.query('SELECT COUNT(*) as count FROM plans');
    const count = parseInt(results[0].count);
    
    if (count > 0) {
      console.log(`⚠️  ${count} plans already exist. Skipping seed.`);
      console.log('To reseed, delete existing plans first.');
      process.exit(0);
      return;
    }

    // Insert plans using raw SQL with correct column names
    const plans = [
      {
        name: 'Basic',
        type: 'standard',
        billing_cycle: 'monthly',
        pricing: 5000,
        currency: 'NGN',
        max_agents: 5,
        max_customers: 100,
        max_transactions: 500,
        status: 'active',
        description: 'Perfect for small businesses just getting started',
        features: JSON.stringify([
          'Up to 5 agents',
          'Up to 100 customers',
          '500 transactions/month',
          'Basic reporting',
          'Email support'
        ])
      },
      {
        name: 'Professional',
        type: 'standard',
        billing_cycle: 'monthly',
        pricing: 15000,
        currency: 'NGN',
        max_agents: 20,
        max_customers: 500,
        max_transactions: 2000,
        status: 'active',
        description: 'Ideal for growing businesses',
        features: JSON.stringify([
          'Up to 20 agents',
          'Up to 500 customers',
          '2000 transactions/month',
          'Advanced reporting',
          'Priority email support',
          'API access'
        ])
      },
      {
        name: 'Enterprise',
        type: 'standard',
        billing_cycle: 'monthly',
        pricing: 50000,
        currency: 'NGN',
        max_agents: null,
        max_customers: null,
        max_transactions: null,
        status: 'active',
        description: 'For large organizations with advanced needs',
        features: JSON.stringify([
          'Unlimited agents',
          'Unlimited customers',
          'Unlimited transactions',
          'Custom reporting',
          '24/7 phone support',
          'Full API access',
          'Dedicated account manager',
          'Custom integrations'
        ])
      },
      {
        name: 'Starter',
        type: 'standard',
        billing_cycle: 'yearly',
        pricing: 50000,
        currency: 'NGN',
        max_agents: 5,
        max_customers: 100,
        max_transactions: 500,
        status: 'active',
        description: 'Annual plan for small businesses (2 months free)',
        features: JSON.stringify([
          'Up to 5 agents',
          'Up to 100 customers',
          '500 transactions/month',
          'Basic reporting',
          'Email support',
          'Save 17% with annual billing'
        ])
      }
    ];

    // Insert each plan - using snake_case for timestamps
    for (const plan of plans) {
      await sequelize.query(`
        INSERT INTO plans (name, type, billing_cycle, pricing, currency, max_agents, max_customers, max_transactions, status, description, features, created_at, updated_at)
        VALUES (:name, :type, :billing_cycle, :pricing, :currency, :max_agents, :max_customers, :max_transactions, :status, :description, :features, NOW(), NOW())
      `, {
        replacements: plan
      });
      console.log(`✅ Created plan: ${plan.name}`);
    }

    console.log('\n🎉 Sample plans seeded successfully!');
    console.log(`📊 Total plans created: ${plans.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding plans:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

seedPlans();
