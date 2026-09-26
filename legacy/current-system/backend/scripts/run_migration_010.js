const fs = require('fs');
const path = require('path');

async function run() {
  const db = require('../models');
  const migrationPath = path.join(__dirname, '..', 'migrations', '010_rename_customers_packageid_to_PackageId.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  try {
    await db.sequelize.query(sql);
    console.log('Migration 010 executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration 010 failed:', err.message);
    process.exit(1);
  }
}

run();


