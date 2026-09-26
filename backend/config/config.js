require('dotenv').config();
const { getDbSettings, sslDialectOptions } = require('./database');

// sequelize-cli configuration. Connection comes only from the environment
// (DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD); TLS only when DB_SSL=true.
const envConfig = () => {
  const settings = getDbSettings();
  const base = {
    dialect: 'postgres',
    dialectOptions: sslDialectOptions(),
    logging: false
  };

  if (settings.url) {
    return { ...base, use_env_variable: 'DATABASE_URL' };
  }
  return {
    ...base,
    host: settings.host,
    port: settings.port,
    database: settings.database,
    username: settings.username,
    password: settings.password
  };
};

module.exports = {
  development: envConfig(),
  test: envConfig(),
  production: envConfig()
};
