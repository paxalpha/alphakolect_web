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

// Connection settings come only from the environment; TLS only when DB_SSL=true
const { getDbSettings, sslDialectOptions } = require('./config/database');
const db = getDbSettings();
const { ssl } = sslDialectOptions();

let targetInfo = { usingDatabaseUrl: !!db.url, loadedEnvPath, ssl: db.ssl };
if (db.url) {
  try {
    const url = new URL(db.url);
    targetInfo.host = url.hostname;
    targetInfo.port = Number(url.port || 5432);
    targetInfo.database = url.pathname.replace(/^\//, '') || undefined;
  } catch {
    targetInfo.host = '(unparsed DATABASE_URL)';
  }
} else {
  targetInfo.host = db.host;
  targetInfo.port = db.port;
  targetInfo.database = db.database;
}

const pool = db.url
  ? new Pool({
      connectionString: db.url,
      ssl,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
    })
  : new Pool({
      host: db.host,
      user: db.username,
      password: db.password,
      database: db.database,
      port: db.port,
      ssl,
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
