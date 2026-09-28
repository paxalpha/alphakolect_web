import { defineConfig } from 'prisma/config';

// Migrations are applied as alphakolect_migrator (the schema owner), never as the app role or a superuser.
//   DATABASE_MIGRATOR_URL  postgresql://alphakolect_migrator:<password>@127.0.0.1:5436/alphakolect
//   SHADOW_DATABASE_URL    local `prisma migrate dev` only: a superuser URL, so Prisma can create its
//                          throwaway shadow database (the migrator has no CREATEDB, by design).
// Read with process.env (not prisma's env()) so `prisma generate` works without any database configured.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_MIGRATOR_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
