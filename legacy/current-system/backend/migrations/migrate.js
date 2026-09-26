const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Database configuration: environment only (DATABASE_URL or DB_*), TLS only when DB_SSL=true.
// WARNING: replays every migration file; never run against a shared or production database.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createSequelize } = require('../config/database');
const sequelize = createSequelize(Sequelize);

async function runMigrations() {
  try {
    console.log('Starting database migration...');

    // Test connection
    await sequelize.authenticate();
    console.log('Database connection established.');

    // Read migration files
    const migrationsDir = path.join(__dirname);
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.js') && file !== 'migrate.js')
      .sort();

    console.log(`Found ${migrationFiles.length} migration files`);

    // Run each migration
    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const migration = require(path.join(migrationsDir, file));

      if (migration.up) {
        await migration.up(sequelize.getQueryInterface(), Sequelize);
        console.log(`✅ Migration ${file} completed successfully`);
      }
    }

    console.log('All migrations completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migrations
runMigrations();
