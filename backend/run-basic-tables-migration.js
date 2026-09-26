const { Sequelize } = require('sequelize');
const migration = require('./migrations/016_create_basic_tables.js');
require('dotenv').config();
const { createSequelize } = require('./config/database');

async function runMigration() {
  const sequelize = createSequelize(Sequelize, { logging: console.log });
  
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
