-- P5.2: the authorization resolver (TARGET_ARCHITECTURE ADR-16 §3.5 "Enforcement model"; P5 plan §4 invariants 2–5,
-- §7.1, P5.2).
--
-- identity.permissions_of(...) is the one place that turns a validated session's membership into its effective
-- permission set (plan §4). The API (through the resolver below) and the database's write-time re-check
-- (tenancy.assert_authority) both use it, so the two cannot disagree:
--   platform super admin   every active platform permission — a fixed set in code, not rows (rule 3)
--   platform staff         the active, grantable platform permissions granted to that platform membership (rule 5)
--   merchant owner         every active merchant permission (rule 3)
--   merchant staff         the active, grantable merchant permissions of the membership's role, and only while that
--                          role is active — an archived role grants nothing (rule 5, D6)
--   agents; any session that is not 'full' (MFA enrolment)   nothing
-- A reserved permission (grantable = false) is never resolved from a grant row, even if such a row existed, and a
-- retired permission is never resolved at all (§6). Whether the session, the membership and the merchant are still
-- active is decided by identity.validate_session, which every caller goes through first.
--
-- identity.session_authority(session) is the per-request resolver (§7.1): validate_session's row, the role's and
-- branch's state, and the effective permissions — one call, read without locks, never cached (rule 2). The API calls it
-- instead of validate_session on every authenticated request. A branch restriction narrows no permission: every P5
-- endpoint is merchant-wide (§7.6); the branch state is returned for the branch-scoped resources of P7/P8.
--
-- The containment switch (§11.1) is added to permissions_of when it is built, in P5.5. Forward-only; earlier migrations
-- untouched.

CREATE FUNCTION "identity"."permissions_of"(
  p_audience text, p_scope text, p_kind text, p_membership_id uuid, p_merchant_id uuid, p_role_id uuid
)
RETURNS text[]
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(array_agg(c."identifier" ORDER BY c."identifier"), '{}'::text[])
    FROM identity.permission_catalog c
   WHERE c."status" = 'active'
     AND p_scope = 'full'
     AND (
       (p_audience = 'platform' AND c."scope" = 'platform' AND (
          p_kind = 'super_admin'
          OR (c."grantable" AND EXISTS (
                SELECT 1 FROM identity.platform_membership_grants g
                 WHERE g."platform_membership_id" = p_membership_id AND g."permission" = c."identifier"))))
       OR
       (p_audience = 'merchant' AND c."scope" = 'merchant' AND (
          p_kind = 'owner'
          OR (p_kind = 'staff' AND c."grantable" AND EXISTS (
                SELECT 1 FROM tenancy.role_permissions rp
                  JOIN tenancy.roles r ON r."merchant_id" = rp."merchant_id" AND r."id" = rp."role_id"
                                      AND r."status" = 'active'
                 WHERE rp."merchant_id" = p_merchant_id AND rp."role_id" = p_role_id
                   AND rp."permission" = c."identifier"))))
     );
$fn$;
-- Inner function: called by the resolver and the re-check (both SECURITY DEFINER), never by the app.
REVOKE ALL ON FUNCTION "identity"."permissions_of"(text, text, text, uuid, uuid, uuid) FROM PUBLIC;

CREATE FUNCTION "identity"."session_authority"(p_session_id uuid)
RETURNS TABLE (
  identity_id uuid, audience text, membership_id uuid, merchant_id uuid, scope text,
  kind text, role_id uuid, branch_id uuid, role_status text, branch_status text, permissions text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.identity_id, v.audience, v.membership_id, v.merchant_id, v.scope, v.kind, v.role_id, v.branch_id,
         r."status", b."status",
         identity.permissions_of(v.audience, v.scope, v.kind, v.membership_id, v.merchant_id, v.role_id)
    FROM identity.validate_session(p_session_id) v
    LEFT JOIN tenancy.roles r ON r."merchant_id" = v.merchant_id AND r."id" = v.role_id
    LEFT JOIN tenancy.branches b ON b."merchant_id" = v.merchant_id AND b."id" = v.branch_id;
$fn$;

REVOKE ALL ON FUNCTION "identity"."session_authority"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "identity"."session_authority"(uuid) TO alphakolect_app;
