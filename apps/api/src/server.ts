import { AccessTokens } from './modules/identity/access-tokens.js';
import { IdentityRepository } from './modules/identity/repository.js';
import { ConfigError, loadConfig, type Config } from './platform/config.js';
import { createDb } from './platform/db.js';
import { createApp } from './platform/http/app.js';
import { createLogger } from './platform/logger.js';

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // The logger depends on configuration, so report directly. Messages never contain values.
      process.stderr.write(`${err.message}\nRefusing to start. See apps/api/.env.example.\n`);
      process.exit(1);
    }
    throw err;
  }
}

const config = readConfig();
const logger = createLogger(config);
const db = createDb(config.databaseUrl);
const app = createApp({
  logger,
  auth: {
    accessTokens: await AccessTokens.create(config.auth),
    identity: new IdentityRepository(db),
    webOrigins: config.webOrigins,
  },
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'API listening');
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  server.close((err) => {
    void db.close();
    if (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
    process.exit(0);
  });
  // Do not hang forever on open keep-alive connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
