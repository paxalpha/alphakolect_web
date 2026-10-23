-- P5.4: the policy middleware's refusal event (TARGET_ARCHITECTURE ADR-16 §3.5; P5 plan §8.1 "authz.denied", §8.3,
-- P5.4).
--
-- When the API's early check refuses a permission endpoint, the refusal is recorded best effort as authz.denied/denied
-- (§8.2a rule 5: the refusal never waits on, or fails with, its event). Its summary names the refused operation (the
-- endpoint's contract id) and the permission it requires — never a request value. The actor, business and request id
-- are the row's own columns. Added with its writer, as §8.1 requires; no retention override (NULL = the D9 rule).
-- Forward-only; earlier migrations untouched.

INSERT INTO "audit"."event_catalog" ("identifier", "outcome", "class", "writer_pattern", "summary_allowlist") VALUES
  ('authz.denied', 'denied', 'best_effort', NULL, '{"operation": {"type": "string", "max": 64}, "permission": {"type": "string", "max": 100}}');
