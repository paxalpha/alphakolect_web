const db = require('./models');
async function run() {
  try {
    const tables = await db.sequelize.getQueryInterface().showAllTables();
    console.log('Tables from Sequelize:', tables.join(', '));
  } catch (e) { console.error(e); } finally { process.exit(0); }
}
run();
