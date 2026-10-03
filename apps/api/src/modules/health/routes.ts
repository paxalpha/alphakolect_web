import type { HealthResponse } from '@alphakolect/contracts';
import type { RequestHandler } from 'express';

// GET /v1/health (contract: packages/contracts/src/endpoints/health.ts) — liveness only.
// Readiness (database, provider) is added when the API first uses the database.
const getHealth: RequestHandler = (_req, res) => {
  const body: HealthResponse = { status: 'ok' };
  res.json(body);
};

export const healthHandlers = { getHealth };
