const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { createSequelize } = require('./config/database');

const sequelize = createSequelize(Sequelize, { logging: console.log });

async function runMigration() {
  try {
    console.log('🔄 Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    console.log('\n🔄 Running accounting tables migration...');
    
    const migration = require('./migrations/20240209-create-accounting-tables');
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    
    console.log('\n✅ Accounting migration completed successfully!');
    console.log('\n📊 Created tables:');
    console.log('  - accounts');
    console.log('  - journal_entries');
    console.log('  - journal_lines');
    console.log('  - fiscal_periods');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
