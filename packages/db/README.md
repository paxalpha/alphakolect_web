# @alphakolect/db

Database infrastructure only (RESTRUCTURING_MAP §1): the Prisma schema, migrations, the SQL that PostgreSQL enforces (row-level security, ledger triggers, grants), role bootstrap, and **test-only** fixtures. No business logic lives here.

## Roles (TARGET_ARCHITECTURE §19)

| Role                   | Used by                                | Can                                                                                                                                                                      |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `alphakolect_migrator` | `prisma migrate deploy` (release step) | Owns every schema, table and function. Not a superuser.                                                                                                                  |
| `alphakolect_app`      | API                                    | Data access only, per-table grants. Always subject to row-level security (`NOBYPASSRLS`, owns nothing). Journal entries, journal lines and audit events are INSERT-only. |
| `alphakolect_worker`   | Background worker                      | Only the worker's functions (P9-R1): what a provider confirmed is recorded through them, and the API cannot call them. No table privileges.                              |
| `alphakolect_readonly` | Reporting/support                      | SELECT only, across tenants.                                                                                                                                             |

Roles are cluster-level, so they are created by `sql/bootstrap/roles.sql` (then `database.sql` per database), run by a superuser **before** migrations. Local compose does this automatically on first start. Anywhere else:

```bash
psql -v ON_ERROR_STOP=1 -d <database> \
  -v migrator_password=... -v app_password=... -v worker_password=... -v readonly_password=... \
  -f packages/db/sql/bootstrap/bootstrap.psql
```

Re-running is safe and rotates the passwords.

## Tenant context

The application sets the tenant per transaction, from the session's membership (never from input):

```sql
SELECT set_config('app.merchant_id', '<merchant uuid>', true);  -- transaction-local
```

With no tenant context the app sees **no rows**; a malformed value is an error.

## Invariants PostgreSQL enforces

- Every tenant table has `merchant_id NOT NULL`, composite `(merchant_id, id)` foreign keys, RLS enabled and an app policy (a catalog test fails otherwise).
- Journal entries balance at COMMIT (≥ 2 lines, Σdebits = Σcredits, same ledger and currency).
- Journal entries, journal lines and audit events cannot be updated, deleted or truncated — by any role, including the owner.
- Amounts are `bigint` kobo > 0; currency is `NGN` only (ADR-11).

## Local development

```bash
docker compose -f infrastructure/compose.yaml up -d --wait   # needs infrastructure/.env
pnpm --filter @alphakolect/db test
```

The tests create a throwaway database, apply every migration from zero as the migrator (`prisma migrate deploy`), load deterministic fixtures, connect **as the real roles** to attempt what must be allowed and what must be refused, and drop the database. Passwords come from `infrastructure/.env` (CI sets them in the workflow).

## Adding a migration

1. Change `prisma/schema.prisma`.
2. Generate the SQL with a shadow database (local superuser URL):
   `SHADOW_DATABASE_URL=... DATABASE_MIGRATOR_URL=... pnpm exec prisma migrate dev --create-only --name <name>`
   or `pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`.
3. **In the same migration, for every new table:**
   - grant the app/readonly only what they need (there are no default grants — a table is invisible until granted);
   - if it is tenant-owned: `merchant_id NOT NULL`, composite `(merchant_id, id)` keys, `ENABLE ROW LEVEL SECURITY` and policies;
   - CHECK constraints for enums, amounts and currency.
4. Add tests that connect as the app role. The drift test fails if the schema and migrations disagree; the RLS guard fails if a tenant table lacks RLS.

Never edit a migration that has been merged; add a new one.
