const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

// Database configuration
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
  const database = process.env.DB_NAME || 'alphacollect_db';
  const username = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT) || 5432;

  sequelize = new Sequelize(database, username, password, {
    host,
    port,
    dialect: 'postgres',
    logging: console.log,
    dialectOptions: useSsl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false
          }
        }
      : {}
  });
}

async function runBasicMigrations() {
  try {
    console.log('🚀 Starting basic database migration...');

    // Test connection
    await sequelize.authenticate();
    console.log('✅ Database connection established.');

    // Run the basic tables migration
    console.log('📦 Running basic tables migration...');
    const basicMigration = require('./backend/migrations/016_create_basic_tables.js');
    if (basicMigration.up) {
      await basicMigration.up(sequelize.getQueryInterface(), Sequelize);
      console.log('✅ Basic tables migration completed successfully');
    }

    console.log('\n🎉 Basic migrations completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nError details:', error.message);
    process.exit(1);
  }
}

// Run migrations
runBasicMigrations();
