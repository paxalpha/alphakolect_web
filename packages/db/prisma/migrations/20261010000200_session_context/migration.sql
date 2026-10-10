-- P4.4: the per-request session check returns the membership's kind, role and branch (TARGET_ARCHITECTURE ADR-15 T5).
--
-- The API builds its TenantContext from this — never from claims or client input — on every request, so a role or
-- branch change, like a deactivation, applies to the very next request. Same checks as before (identity active,
-- session live, membership active, merchant active via identity.active_membership); three more columns.
--
-- A changed result type requires DROP + CREATE; the grant is restored below. tenancy.set_merchant_status (P4.1) reads
-- identity_id, membership_id, audience and scope by name at run time and is unaffected.

DROP FUNCTION "identity"."validate_session"(uuid);

CREATE FUNCTION "identity"."validate_session"(p_session_id uuid)
RETURNS TABLE (
  identity_id uuid, audience text, membership_id uuid, merchant_id uuid, scope text,
  kind text, role_id uuid, branch_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.identity_id, s.audience, coalesce(s.platform_membership_id, s.merchant_membership_id), mm.merchant_id,
         s.scope,
         coalesce(mm.kind, pm.role), mm.role_id, mm.branch_id
    FROM identity.sessions s
    JOIN identity.identities i ON i.id = s.identity_id AND i.status = 'active'
    LEFT JOIN tenancy.merchant_memberships mm ON mm.id = s.merchant_membership_id
    LEFT JOIN identity.platform_memberships pm ON pm.id = s.platform_membership_id
   WHERE s.id = p_session_id
     AND s.revoked_at IS NULL
     AND s.absolute_expires_at > now()
     AND identity.active_membership(s.identity_id, s.audience, coalesce(s.platform_membership_id, s.merchant_membership_id)) IS NOT NULL;
$fn$;

REVOKE ALL ON FUNCTION "identity"."validate_session"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "identity"."validate_session"(uuid) TO alphakolect_app;
