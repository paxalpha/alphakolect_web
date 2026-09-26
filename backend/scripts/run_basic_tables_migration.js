const path = require('path');
const fs = require('fs');
const db = require('../models');

(async () => {
  try {
    console.log('Running 016_create_basic_tables.js migration...');
    await db.sequelize.authenticate();
    const dbName = db.sequelize.getDatabaseName();
    console.log('Connected. Target database:', dbName);
    const migration = require(path.join(__dirname, '..', 'migrations', '016_create_basic_tables.js'));
    if (!migration.up) {
      throw new Error('Migration file does not export an up function');
    }
    await migration.up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log('Basic tables migration completed.');
    process.exit(0);
  } catch (err) {
    console.error('Basic tables migration failed:', err);
    process.exit(1);
  }
})();


