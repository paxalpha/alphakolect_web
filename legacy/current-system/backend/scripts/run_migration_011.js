const fs = require('fs');
const path = require('path');

async function run() {
  const db = require('../models');
  const migrationPath = path.join(__dirname, '..', 'migrations', '011_alter_customers_add_alias_address_account.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  try {
    await db.sequelize.query(sql);
    console.log('Migration 011 executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration 011 failed:', err.message);
    process.exit(1);
  }
}

run();


