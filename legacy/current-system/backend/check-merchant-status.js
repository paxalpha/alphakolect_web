const { sequelize } = require('./models');

async function checkMerchantStatus() {
  try {
    // Check if status column exists and what type it is
    const [results] = await sequelize.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns 
      WHERE table_name = 'merchants' AND column_name = 'status';
    `);
    
    console.log('Merchant status column info:');
    console.log(JSON.stringify(results, null, 2));
    console.log('');
    
    // If it's an enum, get the enum values
    if (results.length > 0 && results[0].data_type === 'USER-DEFINED') {
      const [enumValues] = await sequelize.query(`
        SELECT enumlabel 
        FROM pg_enum 
        WHERE enumtypid = (
          SELECT oid 
          FROM pg_type 
          WHERE typname = '${results[0].udt_name}'
        );
      `);
      
      console.log('Valid enum values for status:');
      console.log(enumValues.map(e => e.enumlabel));
    }
    
    // Check actual status values in the table
    const [merchants] = await sequelize.query(`
      SELECT DISTINCT status FROM merchants;
    `);
    
    console.log('\nActual status values in merchants table:');
    console.log(merchants);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkMerchantStatus();
