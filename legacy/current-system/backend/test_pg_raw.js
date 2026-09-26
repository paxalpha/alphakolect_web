const { Client } = require('pg');
require('dotenv').config();

const { getDbSettings, sslDialectOptions } = require('./config/database');

console.log('Testing with raw pg client...');

// Connection settings come only from the environment; TLS only when DB_SSL=true
const db = getDbSettings();
const { ssl } = sslDialectOptions();
const client = new Client(db.url
  ? { connectionString: db.url, ssl }
  : { host: db.host, port: db.port, database: db.database, user: db.username, password: db.password, ssl });

client.connect()
  .then(() => {
    console.log('Connected successfully with raw pg!');
    return client.query('SELECT NOW()');
  })
  .then(res => {
    console.log('Query result:', res.rows[0]);
    return client.end();
  })
  .catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
  });
