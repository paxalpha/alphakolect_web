import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { healthHandlers } from '../../modules/health/routes.js';
import { errorHandler, notFoundHandler } from './error-handler.js';
import { resolveRequestId } from './request-id.js';
import { API_PREFIX, buildV1Router } from './routes.js';

export type AppDeps = {
  logger: Logger;
};

export function createApp({ logger }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: resolveRequestId,
      // Health probes are frequent and uninteresting.
      autoLogging: { ignore: (req) => req.url === '/v1/health' },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  // All endpoints are versioned (§17) and come from the contract registry (packages/contracts).
  app.use(API_PREFIX, buildV1Router({ ...healthHandlers }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
