const { sequelize } = require('./models');

async function checkSchema() {
  try {
    const [results] = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'merchants' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Merchants table columns:');
    console.log(JSON.stringify(results, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkSchema();
