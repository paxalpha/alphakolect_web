require('dotenv').config();
const db = require('../models');
const migration = require('../migrations/020_create_remittances_table');

(async () => {
  try {
    await db.sequelize.authenticate();
    console.log('DB connected. Running remittances migration...');
    await migration.up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log('✅ Remittances table created/ensured.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Remittances migration failed:', err);
    process.exit(1);
  }
})();


