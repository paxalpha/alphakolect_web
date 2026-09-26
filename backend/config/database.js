// Single source of database connection settings for the backend and its scripts.
//
// The connection comes ONLY from the environment (see backend/.env.example):
//   - DATABASE_URL, or
//   - DB_HOST + DB_NAME + DB_USER (+ DB_PASSWORD, DB_PORT)
// TLS is enabled only when DB_SSL=true. No hosts, users or passwords are hardcoded here.

const isSslEnabled = (env = process.env) => String(env.DB_SSL || '').toLowerCase() === 'true';

// Sequelize `dialectOptions` fragment (also usable as pg Pool `ssl` via `.ssl`).
// rejectUnauthorized:false preserves the legacy behaviour; see follow-ups before tightening.
const sslDialectOptions = (env = process.env) =>
  isSslEnabled(env) ? { ssl: { require: true, rejectUnauthorized: false } } : {};

const getDbSettings = (env = process.env) => {
  const ssl = isSslEnabled(env);

  if (env.DATABASE_URL) {
    return { url: env.DATABASE_URL, ssl };
  }

  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER'].filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(
      `Database is not configured: set DATABASE_URL or ${missing.join(', ')} (see backend/.env.example)`
    );
  }

  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 5432,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD || '',
    ssl,
  };
};

// Build a Sequelize instance from the environment. `options` are merged over the defaults;
// `options.dialectOptions` is merged with the SSL fragment.
const createSequelize = (Sequelize, options = {}, env = process.env) => {
  const settings = getDbSettings(env);
  const { dialectOptions = {}, ...rest } = options;
  const common = {
    dialect: 'postgres',
    logging: false,
    ...rest,
    dialectOptions: { ...sslDialectOptions(env), ...dialectOptions },
  };

  if (settings.url) {
    return new Sequelize(settings.url, { protocol: 'postgres', ...common });
  }
  return new Sequelize(settings.database, settings.username, settings.password, {
    host: settings.host,
    port: settings.port,
    ...common,
  });
};

module.exports = { isSslEnabled, sslDialectOptions, getDbSettings, createSequelize };
