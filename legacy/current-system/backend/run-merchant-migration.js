const { sequelize } = require('./models');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const sqlFile = path.join(__dirname, 'migrations', '021_add_missing_merchant_columns.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    console.log('Running migration: 021_add_missing_merchant_columns.sql');
    await sequelize.query(sql);
    console.log('Migration completed successfully!');
    
    // Check the columns again
    const [results] = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'merchants' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\nMerchants table columns after migration:');
    console.log(JSON.stringify(results, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

runMigration();
