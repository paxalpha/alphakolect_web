# @alphakolect/contracts

The API contract, defined once (TARGET_ARCHITECTURE §17, ADR-3): zod schemas, the endpoint registry and API primitives. **Shapes only** — no application behaviour, database access, Express handlers, authentication or business rules. A test enforces this (runtime dependencies are only `zod` and `openapi-fetch`; no imports of servers, databases, loggers, other workspace apps or Node built-ins).

```text
src/ (zod schemas, registry, primitives)
   │  scripts/openapi.ts (zod-openapi)
   ▼
openapi/v1.json  ── committed; CI fails if stale, fails on breaking changes vs. the base, publishes it as an artifact
   │  openapi-typescript
   ▼
src/generated/v1.ts (gitignored) + src/client.ts (openapi-fetch)
   ├─ consumer/  independent typecheck of the BUILT package
   └─ apps/api   mounts routes from the registry; parity + round-trip tests
```

## Conventions

- Paths are under `/v1`, grouped by audience (`/v1/platform/*`, `/v1/merchant/*`, `/v1/agent/*`, `/v1/customer/*`, …).
- Ids are UUIDv7 (`Id`).
- Money is `{ "amountMinor": "150000", "currency": "NGN" }`: kobo as an exact decimal digit string (never a JSON number), NGN only (`Money`).
- Errors use the envelope `{ error: { code, message, details?, requestId } }` (`ErrorResponse`); every endpoint documents it as its `default` response.
- Lists use cursor pagination (`CursorPageQuery`, `cursorPage()`); money-moving POSTs require `Idempotency-Key` (`IdempotencyKeyHeader`).

## Adding or changing an endpoint

1. Define it with `defineEndpoint()` in `src/endpoints/<module>.ts` and add it to `endpoints` in `src/index.ts`.
2. `pnpm --filter @alphakolect/contracts openapi:generate` and commit `openapi/v1.json` with the change.
3. Implement the handler in `apps/api` and add it to the handlers passed to `buildV1Router()` — it will not compile until you do.
4. `pnpm test` — the registry-parity test fails if Express and the registry disagree; conformance tests check real responses.

Breaking changes to a published endpoint (removing or retyping response fields, adding required request fields, …) fail CI. Make additive changes, or introduce a new endpoint/version deliberately.

## Packaging

`exports` resolve to `src/` under the `@alphakolect/source` condition (typecheck, tests and `dev` in this workspace) and to the compiled `dist/` otherwise, so production code runs on JavaScript. `pnpm build` compiles, then type-checks `consumer/` against `dist/`.
