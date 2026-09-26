const fs = require('fs');
const path = require('path');

async function run() {
  const db = require('../models');
  const migrationPath = path.join(__dirname, '..', 'migrations', '009_alter_customers_add_packageId.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  try {
    await db.sequelize.query(sql);
    console.log('Migration 009 executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration 009 failed:', err.message);
    process.exit(1);
  }
}

run();


