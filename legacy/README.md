# legacy/ — quarantined AlphaKolect application (read-only reference)

`current-system/` is the application that runs in production today (Next.js 15 frontend + Express 4 / Sequelize backend), moved here unchanged by ADR-13 (see `docs/architecture/TARGET_ARCHITECTURE.md` §0, §26).

## Rules

- **Reference only.** Read it to understand behaviour, then rebuild in `apps/` and `packages/`. Do not import from it, and do not copy code without reviewing it against `docs/business/BUSINESS_RULES.md` and the target architecture.
- **Not built, linted, type-checked or tested by the workspace or CI.** It is outside the pnpm workspace (`pnpm-workspace.yaml`) and ignored by the workspace ESLint config.
- **Nothing deploys from this repository.** Production runs from the old server checkout, which is frozen (security containment track, `docs/architecture/RESTRUCTURING_MAP.md` §6).
- **No legacy security remediation here** (SEC-B is frozen). Exception: if real customers or real money turn out to be using the legacy system, dangerous financial paths are contained immediately.
- Delete `legacy/` once the new system has passed UAT and run in production for an agreed period (TARGET_ARCHITECTURE §26 step 5).

## Classification of what is inside

`docs/architecture/RESTRUCTURING_MAP.md` §2–§5 classifies every area (PORT / REF / REBUILD / QUAR / PURGE). In short:

| Path under `current-system/` | What it is |
|---|---|
| `src/`, `components/`, `services/`, `context/`, `libs/`, `interface/`, `public/` | Legacy frontend — screens to be ported in P13 |
| `backend/` | Legacy API; `backend/old_project/` is an even older TypeScript/Prisma attempt |
| `local_edit/`, `backend_files/`, root `live_*.js`, `server_*.js`, `services_api.*` | Stale snapshots of files once edited on the server |
| `nginx*`, `*.conf`, `deploy.sh`, `setup-env.sh`, `prepare-production.sh`, `ecosystem.config.js`, `Dockerfile.*`, `docker-compose.yml` | Old VPS runtime — record only; never run against production |
| Root `*.md` | Old status notes and how-tos (historical; some describe the retired Render setup) |

## Running it locally (reference and regression checks only)

Local recovery database only — never a shared or production database.

```bash
# backend (reads legacy/current-system/backend/.env; see .env.example there)
cd legacy/current-system/backend
npm ci
node server.js                                   # GET /health
node --test scripts/test-superadmin-recovery.js  # needs Mailpit, see the script header

# frontend
cd legacy/current-system
npm ci
npm run dev
```

Never run `backend/migrations/run-all-migrations.js` or `migrate.js`: they replay every migration and some drop columns.
