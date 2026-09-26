# AlphaKolect

Platform for businesses (merchants) that collect customers' savings through staff and field agents, and manage their customers' savings, loans and wallets (NGN).

This repository is the **rebuild workspace** (ADR-13). The new system is built in `apps/` and `packages/` to the target architecture; the application currently running in production is kept, unchanged, in `legacy/current-system/` as a read-only behavioural reference.

## Start here

| Document                                                                                                                                                                               | Role                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`docs/business/BUSINESS_RULES.md`](docs/business/BUSINESS_RULES.md)                                                                                                                   | The specification: owner-approved business rules (BR-x.y)   |
| [`docs/architecture/TARGET_ARCHITECTURE.md`](docs/architecture/TARGET_ARCHITECTURE.md)                                                                                                 | Target design, ADRs, open decisions                         |
| [`docs/architecture/RESTRUCTURING_MAP.md`](docs/architecture/RESTRUCTURING_MAP.md)                                                                                                     | Build order (P0…P15), exit criteria, security track (SEC-*) |
| [`docs/architecture/CURRENT_SYSTEM_INVENTORY.md`](docs/architecture/CURRENT_SYSTEM_INVENTORY.md), [`ARCHITECTURE_RECONNAISSANCE.md`](docs/architecture/ARCHITECTURE_RECONNAISSANCE.md) | Evidence about the legacy system                            |
| [`legacy/README.md`](legacy/README.md)                                                                                                                                                 | What the quarantined app is and how to run it for reference |

## Layout

```text
apps/            deployables (api now; web ported in P13)
packages/        shared infrastructure only: config (now), contracts (P2), db (P1)
infrastructure/  local compose and, later, deploy manifests
docs/            business, architecture, operations
legacy/          quarantined legacy application — not built, linted or deployed
```

## Requirements

- Node.js 24 (`.nvmrc`)
- pnpm 11 (`corepack enable` or a global install)
- Docker (local PostgreSQL)

## Getting started

```bash
pnpm install

# local database for the new system (127.0.0.1:5436; not the legacy recovery DB)
cp infrastructure/.env.example infrastructure/.env        # set POSTGRES_PASSWORD
docker compose -f infrastructure/compose.yaml up -d --wait

# API (http://127.0.0.1:4000/v1/health)
cp apps/api/.env.example apps/api/.env                    # use the same password in DATABASE_URL
pnpm --filter @alphakolect/api dev
```

Checks (the same ones CI runs): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

Secret scan before committing:

```bash
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:v8.30.1 git /repo --redact --no-banner
```

## Rules

- No secrets in git. Configuration comes from the environment and is validated at startup; each app documents its variables in `.env.example`.
- Nothing deploys from this repository yet. Production is frozen on the old server.
