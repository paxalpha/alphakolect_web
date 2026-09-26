import { Router } from 'express';

// GET /v1/health — liveness only. Readiness (database, provider) is added with the
// database foundation in P1.
export function healthRoutes(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return router;
}
