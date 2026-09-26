const db = require('./models');
const sequelize = db.sequelize;

async function fixPlansTable() {
  try {
    console.log('🔧 Fixing plans table - making merchant_id nullable...');

    await sequelize.query(`
      ALTER TABLE plans ALTER COLUMN merchant_id DROP NOT NULL
    `);
    console.log('✅ Made merchant_id nullable');

    console.log('\n🎉 Plans table fixed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing plans table:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

fixPlansTable();
