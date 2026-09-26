const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

async function runMigration() {
  try {
    console.log('🔄 Testing database connection...');
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    console.log('\n🔄 Running accounting tables migration...');
    
    const migration = require('./migrations/20240209-create-accounting-tables');
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    
    console.log('\n✅ Accounting migration completed successfully!');
    console.log('\n📊 Created tables:');
    console.log('  - accounts');
    console.log('  - journal_entries');
    console.log('  - journal_lines');
    console.log('  - fiscal_periods');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
