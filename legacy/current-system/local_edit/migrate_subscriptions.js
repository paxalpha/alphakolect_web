const db = require('./models');

async function migrate() {
  try {
    const queryInterface = db.sequelize.getQueryInterface();
    const { Merchant } = db;

    console.log('Adding subscription columns to merchants table...');

    // Add subscriptionStatus ENUM if it doesn't exist
    try {
      await db.sequelize.query(`
        DO $$ BEGIN
          CREATE TYPE "enum_merchants_subscription_status" AS ENUM('Active', 'Grace', 'Suspended', 'Blocked');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      console.log('ENUM type created.');
    } catch (e) {
      console.log('ENUM already exists, skipping.');
    }

    const columns = [
      { name: 'subscription_status', type: "enum_merchants_subscription_status", default: 'Active' },
      { name: 'plan_id', type: 'INTEGER', allowNull: true },
      { name: 'is_custom_fee', type: 'BOOLEAN', default: false },
      { name: 'custom_fee', type: 'DECIMAL(10, 2)', allowNull: true },
      { name: 'next_billing_date', type: 'TIMESTAMP WITH TIME ZONE', allowNull: true },
      { name: 'total_debt', type: 'DECIMAL(10, 2)', default: 0 },
      { name: 'trial_end_date', type: 'TIMESTAMP WITH TIME ZONE', allowNull: true },
    ];

    for (const col of columns) {
      try {
        await queryInterface.addColumn('merchants', col.name, {
          type: col.type, // simplified for raw SQL addition or queryInterface
          allowNull: col.allowNull === undefined ? false : col.allowNull,
          defaultValue: col.default,
        });
        console.log(`Column ${col.name} added.`);
      } catch (err) {
        console.log(`Column ${col.name} likely already exists, skipping.`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
