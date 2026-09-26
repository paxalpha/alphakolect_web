require('dotenv').config();
const { Sequelize } = require('sequelize');

const { createSequelize } = require('./config/database');

// Connection settings come only from the environment; TLS only when DB_SSL=true
const sequelize = createSequelize(Sequelize);

async function check() {
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');
    
    const [results] = await sequelize.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log('Tables in DB:', results.map(r => r.table_name).join(', '));
    
    // Check specifically for transactions and wallet_transactions
    const tables = results.map(r => r.table_name);
    console.log('Checking for critical tables:');
    ['transactions', 'wallet_transactions', 'merchants', 'wallet_tiers', 'wallet_upgrade_requests'].forEach(t => {
      console.log(`- ${t}: ${tables.includes(t) ? 'EXISTS' : 'MISSING'}`);
    });

  } catch (error) {
    console.error('Unable to connect to the database:', error);
  } finally {
    await sequelize.close();
  }
}

check();
