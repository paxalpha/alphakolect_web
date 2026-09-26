const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const db = require('../models');

// Use shared Sequelize instance configured via .env
const sequelize = db.sequelize;

async function runAllMigrations() {
  try {
    console.log('🚀 Starting database migration...');

    // Test connection
    await sequelize.authenticate();
    console.log('✅ Database connection established.');

    const migrationsDir = path.join(__dirname);
    
    // Phase 1: run core base JS migrations first (ensure dependencies exist before SQL FKs)
    // Includes basic tables and roles/staff (referenced by early SQL migrations)
    const coreJsFirstList = [
      // Ensure base tables exist first
      '016_create_basic_tables.js',
      // Normalize/ensure snake_case columns used by SQL migrations
      '015_ensure_sql_prereqs.js',
      // Ensure roles/staff exist for FKs in SQL migrations
      '023_create_roles_and_staff_tables.js',
      // Accounting tables
      '20240209-create-accounting-tables.js',
    ];
    const jsAll = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.js') && file !== 'migrate.js' && file !== 'run-all-migrations.js')
      .sort();

    for (const coreJsFirst of coreJsFirstList) {
      if (jsAll.includes(coreJsFirst)) {
        console.log(`\n📦 Running core JavaScript migration first: ${coreJsFirst}`);
        try {
          const coreMigration = require(path.join(migrationsDir, coreJsFirst));
          if (coreMigration.up) {
            await coreMigration.up(sequelize.getQueryInterface(), Sequelize);
            console.log(`✅ JavaScript migration ${coreJsFirst} completed successfully`);
          }
        } catch (error) {
          if (String(error.message).includes('already exists')) {
            console.log(`⚠️  Core migration ${coreJsFirst} skipped (already exists): ${error.message}`);
          } else {
            throw error;
          }
        }
      }
    }

    // Phase 2: run SQL migrations next
    console.log('\n📄 Running SQL migrations...');
    // Extra guard: ensure agents has required snake_case columns before SQL scripts
    try {
      console.log('\n🛡️  Ensuring agents has required columns before SQL migrations...');
      await sequelize.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'agents'
          ) THEN
            -- merchant_id
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'merchant_id'
            ) THEN
              EXECUTE 'ALTER TABLE agents ADD COLUMN merchant_id INTEGER';
            END IF;
            -- branch
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'branch'
            ) THEN
              EXECUTE 'ALTER TABLE agents ADD COLUMN branch VARCHAR(100)';
            END IF;
          END IF;
        END$$;
      `);
    } catch (guardErr) {
      console.log('⚠️  Pre-SQL agents guard skipped:', guardErr.message);
    }
    const sqlMigrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log(`Found ${sqlMigrationFiles.length} SQL migration files`);

    for (const file of sqlMigrationFiles) {
      console.log(`\n🔄 Running SQL migration: ${file}`);
      const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        await sequelize.query(sqlContent);
        console.log(`  ✅ Executed SQL migration: ${file}`);
      } catch (error) {
        if (String(error.message).includes('already exists') ||
            String(error.message).includes('duplicate key') ||
            (String(error.message).includes('relation') && String(error.message).includes('already exists'))) {
          console.log(`  ⚠️  Skipped (already exists): ${file}`);
        } else {
          throw error;
        }
      }
      console.log(`✅ SQL migration ${file} completed successfully`);
    }

    // Phase 3: run remaining JS migrations (excluding core already run)
    console.log('\n📦 Running remaining JavaScript migrations...');
    const jsRemainder = jsAll.filter(f => !coreJsFirstList.includes(f));
    for (const file of jsRemainder) {
      console.log(`\n🔄 Running JavaScript migration: ${file}`);
      const migration = require(path.join(migrationsDir, file));
      if (migration.up) {
        try {
          await migration.up(sequelize.getQueryInterface(), Sequelize);
          console.log(`✅ JavaScript migration ${file} completed successfully`);
        } catch (error) {
          if (String(error.message).includes('already exists') || 
              String(error.message).includes('duplicate key') ||
              (String(error.message).includes('column') && String(error.message).includes('already exists'))) {
            console.log(`⚠️  JavaScript migration ${file} skipped (already exists): ${error.message}`);
          } else {
            throw error;
          }
        }
      }
    }


    console.log('\n🎉 All migrations completed successfully!');
    console.log('\n📊 Database tables created:');
    console.log('  - investment_applications');
    console.log('  - loan_applications');
    console.log('  - loans');
    console.log('  - repayments');
    console.log('  - accounts (Accounting)');
    console.log('  - journal_entries (Accounting)');
    console.log('  - journal_lines (Accounting)');
    console.log('  - fiscal_periods (Accounting)');
    console.log('  - Plus any existing tables from JavaScript migrations');
    
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nError details:', error.message);
    process.exit(1);
  }
}

// Run migrations
runAllMigrations();
