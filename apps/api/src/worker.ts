import { createPaymentProvider } from './integrations/payments/index.js';
import { PaymentsWorker } from './modules/payments/worker-tasks.js';
import { ConfigError, loadConfig, type Config } from './platform/config.js';
import { createDb } from './platform/db.js';
import { createLogger } from './platform/logger.js';

// The background worker (P9 §3.7; TA-11): a second entry point of the API, connecting as alphakolect_app. The work is
// kept in the domain's own rows, claimed with a lease (P9-1), so several workers can run and a dead one loses nothing.

const PASS_MS = 30_000;
const RECONCILE_MS = 15 * 60_000;

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\nRefusing to start. See apps/api/.env.example.\n`);
      process.exit(1);
    }
    throw err;
  }
}

const config = readConfig();
const logger = createLogger(config);
const db = createDb(config.databaseUrl);
const worker = new PaymentsWorker({
  db,
  provider: createPaymentProvider(config),
  logger,
  customerLiveWallets: config.payments.customerLiveWallets,
});

let stopping = false;
const stop = (signal: NodeJS.Signals) => {
  logger.info({ signal }, 'Worker stopping');
  stopping = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

logger.info({ provider: config.payments.provider }, 'Worker running');
let lastReconcile = 0;
while (!stopping) {
  try {
    await worker.runOnce();
    if (Date.now() - lastReconcile >= RECONCILE_MS) {
      lastReconcile = Date.now();
      await worker.reconcile();
    }
  } catch (err) {
    logger.error({ err }, 'A worker pass failed');
  }
  await new Promise((resolve) => setTimeout(resolve, PASS_MS).unref());
}
await db.close();
process.exit(0);
