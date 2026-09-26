const { Sequelize } = require('sequelize');
const migration = require('./migrations/016_create_basic_tables.js');
require('dotenv').config();

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true';
  
  let sequelize;
  if (databaseUrl) {
    const shouldForceSsl = useSsl || /render\.com/i.test(databaseUrl) || /sslmode=require/i.test(databaseUrl);
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      protocol: 'postgres',
      logging: console.log,
      dialectOptions: shouldForceSsl
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: false
            }
          }
        : {}
    });
  } else {
    throw new Error('DATABASE_URL not found in environment variables');
  }
  
  try {
    console.log('Starting migration...');
    
    const queryInterface = sequelize.getQueryInterface();
    
    await migration.up({
      sequelize,
      createTable: queryInterface.createTable.bind(queryInterface),
      addIndex: queryInterface.addIndex.bind(queryInterface),
      dropTable: queryInterface.dropTable.bind(queryInterface)
    }, Sequelize);
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sequelize.close();
  }
}

runMigration();
