'use strict';

const { Sequelize } = require('sequelize');
require('dotenv').config();

async function truncateDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const sequelize = new Sequelize(databaseUrl, {
    dialect: 'postgres',
    logging: console.log,
    dialectOptions: process.env.DB_SSL === 'true' ? { ssl: { require: true, rejectUnauthorized: false } } : {}
  });

  try {
    console.log('🚀 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected. Truncating public schema (DROP/CREATE)...');

    await sequelize.query('DROP SCHEMA IF EXISTS public CASCADE;');
    await sequelize.query('CREATE SCHEMA public;');
    await sequelize.query('GRANT ALL ON SCHEMA public TO public;');
    await sequelize.query('GRANT ALL ON SCHEMA public TO postgres;');

    console.log('✅ Database truncated (schema recreated).');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to truncate database:', err);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

truncateDb();


