const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load env: prefer backend/.env then project-root/.env
let loadedEnvPath = null;
const backendEnvPath = path.join(__dirname, '.env');
const rootEnvPath = path.join(__dirname, '..', '.env');
try {
  if (fs.existsSync(backendEnvPath)) {
    require('dotenv').config({ path: backendEnvPath });
    loadedEnvPath = backendEnvPath;
  } else if (fs.existsSync(rootEnvPath)) {
    require('dotenv').config({ path: rootEnvPath });
    loadedEnvPath = rootEnvPath;
  } else {
    require('dotenv').config();
    loadedEnvPath = '.env (default search)';
  }
} catch (_) {}

const databaseUrl = process.env.DATABASE_URL;
const dbHost = process.env.DB_HOST || process.env.PGHOST;
const dbUser = process.env.DB_USER || process.env.PGUSER;
const dbPassword = process.env.DB_PASSWORD || process.env.PGPASSWORD;
const dbName = process.env.DB_NAME || process.env.PGDATABASE;
const dbPort = Number(process.env.DB_PORT || process.env.PGPORT || 5432);
const useSsl = String(process.env.DB_SSL || process.env.PGSSLMODE || '').toLowerCase().includes('require');

let targetInfo = { usingDatabaseUrl: !!databaseUrl, loadedEnvPath };
if (databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    targetInfo.host = url.hostname;
    targetInfo.port = Number(url.port || 5432);
    targetInfo.database = url.pathname.replace(/^\//, '') || undefined;
    targetInfo.ssl = /render\.com|sslmode=require/i.test(databaseUrl) || useSsl;
  } catch {
    targetInfo.host = '(unparsed DATABASE_URL)';
  }
} else {
  targetInfo.host = dbHost || 'localhost';
  targetInfo.port = dbPort;
  targetInfo.database = dbName || 'alphacollect_db';
  targetInfo.ssl = !!useSsl;
}

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: /render\.com|sslmode=require/i.test(databaseUrl) || useSsl
        ? { require: true, rejectUnauthorized: false }
        : undefined,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
    })
  : new Pool({
      host: dbHost || 'localhost',
      user: dbUser || 'postgres',
      password: dbPassword || '',
      database: dbName || 'alphacollect_db',
      port: dbPort,
      ssl: useSsl ? { require: true, rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
    });

pool.on('error', (err) => {
  console.error('Pool error:', err);
});

async function runMigration() {
  try {
    console.log('Starting migration...');
    console.log('DB target:', targetInfo);
    // Pre-connection test
    const client = await pool.connect();
    try {
      const { rows } = await client.query('select version(), current_user');
      console.log(`Connected to Postgres as ${rows[0].current_user}`);
    } finally {
      client.release();
    }
    
    // First, create the customer_wallets table if it doesn't exist
    const createTableSQL = fs.readFileSync(path.join(__dirname, 'migrations', '008_create_customer_wallets_table.sql'), 'utf8');
    console.log('Creating customer_wallets table...');
    await pool.query(createTableSQL);
    console.log('Table created successfully');
    
    // Then, ensure all required columns exist
    const ensureColumnsSQL = fs.readFileSync(path.join(__dirname, 'migrations', '009_ensure_customer_wallets_columns.sql'), 'utf8');
    console.log('Ensuring all required columns exist...');
    await pool.query(ensureColumnsSQL);
    console.log('Columns ensured successfully');
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    await pool.end();
  }
}

runMigration();
