const fs = require('fs');
const path = require('path');
const db = require('../models');

async function runSql(fileName) {
  try {
    await db.sequelize.authenticate();
    const sqlPath = path.join(__dirname, '..', 'migrations', fileName);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Running SQL migration:', fileName);
    await db.sequelize.query(sql);
    console.log('SQL migration completed:', fileName);
    process.exit(0);
  } catch (err) {
    console.error('SQL migration failed:', err);
    process.exit(1);
  }
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/run_sql_migration.js <file.sql>');
  process.exit(2);
}

runSql(file);


