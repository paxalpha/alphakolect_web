import pino from 'pino';
import { FakeProvider } from '../../src/integrations/payments/fake-provider.js';
import { PaymentsWorker } from '../../src/modules/payments/worker-tasks.js';
import { createDb } from '../../src/platform/db.js';

// A real worker process for worker.test.ts to kill (P9 money-flow matrix, G1 to G3): it claims a row on a two-second lease,
// says so when its provider call is in flight, and that call never ends. The parent kills it there.

const inFlight = () => {
  process.stdout.write('in-flight\n');
  return new Promise<never>(() => {});
};
const worker = new PaymentsWorker({
  db: createDb(process.env.CHILD_WORKER_DATABASE_URL!),
  provider: Object.assign(new FakeProvider(), {
    findVirtualAccountByAlias: inFlight,
    getTransaction: inFlight,
    transfer: inFlight,
  }),
  logger: pino({ level: 'silent' }),
  leaseSeconds: 2,
});
const tasks = {
  wallet: () => worker.provisionWallets(),
  event: () => worker.confirmEvents(),
  order: () => worker.settleOrders(),
};
await tasks[process.argv[2] as keyof typeof tasks]();
