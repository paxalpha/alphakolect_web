require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

async function check() {
  try {
    const [results] = await sequelize.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const tables = results.map(r => r.table_name);
    console.log('Tables:', tables.join(', '));
    
    for (const t of ['merchants', 'transactions', 'wallet_transactions']) {
      if (tables.includes(t)) {
        const [cols] = await sequelize.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${t}'`);
        console.log(`- ${t} columns:`, cols.map(c => c.column_name).join(', '));
      } else {
        console.log(`- ${t}: MISSING`);
      }
    }
  } catch (e) { console.error(e); } finally { await sequelize.close(); }
}
check();
