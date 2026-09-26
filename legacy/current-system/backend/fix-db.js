const { sequelize } = require('./models');

async function fixDb() {
  try {
    await sequelize.query('ALTER TABLE merchants ADD COLUMN IF NOT EXISTS "accountLevel" VARCHAR(255) DEFAULT \'Tier 0\';');
    console.log('Database fixed: accountLevel column added.');
    process.exit(0);
  } catch (err) {
    console.error('Failed to fix database:', err);
    process.exit(1);
  }
}

fixDb();
