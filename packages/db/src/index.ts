import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient } from './generated/prisma/client.js';

/**
 * Prisma client over node-postgres (Prisma 7 requires a driver adapter).
 * Services connect as alphakolect_app; tenant context (SET LOCAL app.merchant_id) is applied per
 * transaction by the tenancy layer in P4 — this package only provides the connection.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
