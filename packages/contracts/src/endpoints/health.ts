import { z } from 'zod';
import { defineEndpoint } from '../registry.js';

export const HealthResponse = z
  .object({
    status: z.literal('ok'),
  })
  .meta({ id: 'HealthResponse' });

export type HealthResponse = z.infer<typeof HealthResponse>;

export const getHealth = defineEndpoint({
  id: 'getHealth',
  method: 'get',
  path: '/v1/health',
  authorization: { class: 'public' },
  audience: 'public',
  summary: 'Liveness check',
  responses: {
    200: { description: 'The API process is up', schema: HealthResponse },
  },
});
