-- P5.8 (O9, decided by the owner, 2026-10-11): cursor pagination of the members and invitations lists (P5 plan §10
-- P5.8; ADR-16's frozen contracts: GET /v1/merchant/members, oldest first; GET /v1/merchant/invitations, newest first,
-- `status` open (the default: pending and unexpired) or all; `cursor`, `limit` 1–100).
--
-- tenancy.list_members and tenancy.list_invitations (the B1 readers of P5.5) take an optional page — its size and the
-- position the API decoded from a cursor — and return one row more than the page when another follows. A page is one
-- statement: the first page and a continuation are separate statements, so that a reused (generic) plan can use the
-- position as an index condition (the P5.7 measurement). Both stay lock-free merchant-scoped readers: the business comes
-- from the session only, and the merchant-scope guard (R19) checks every tenant table they read. Every existing call
-- keeps working: with no page they return every row as before, and list_invitations' status defaults to all (the API
-- applies the contract's default, open).
--
-- Indexes, chosen from recorded query plans (P5.8 evidence: a throwaway database with one business holding 30,000
-- invitations — 10% open, 10% expired and pending, 80% revoked — and 20,000 members, beside 2,000 small businesses;
-- generic plans): without an ordering index every invitations page sorts the business's invitations (all: 35–61 ms;
-- open: 4–6 ms); with (merchant_id, created_at, id) a page of all is a backward index scan of about one page (0.1 ms);
-- open pages need the partial index over pending invitations (0.15 ms, first or three quarters down), the full index
-- alone still sorting the first open page. Members already have (merchant_id, created_at, id) from P5.7 (0.25 ms).
-- Forward-only; earlier migrations untouched.

CREATE INDEX "invitations_merchant_id_created_at_id_idx"
  ON "tenancy"."invitations" ("merchant_id", "created_at", "id");
CREATE INDEX "invitations_pending_merchant_id_created_at_id_idx"
  ON "tenancy"."invitations" ("merchant_id", "created_at", "id") WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- ── members, oldest first ──
DROP FUNCTION tenancy.list_members(uuid, uuid);
CREATE FUNCTION tenancy.list_members(p_session_id uuid, p_membership_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(membership_id uuid, kind text, status text, role_id uuid, branch_id uuid, email text, created_at timestamp with time zone, deactivated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- One statement a page: the first page, or the rows after the cursor's position. One row more than the page tells
  -- the caller whether another follows; with no page, every row (LIMIT NULL).
  IF p_after_id IS NULL THEN
    RETURN QUERY
    SELECT mm.id, mm.kind, mm.status, mm.role_id, mm.branch_id, i.email, mm.created_at, mm.deactivated_at
      FROM identity.session_authority(p_session_id) a
      JOIN tenancy.merchant_memberships mm ON mm.merchant_id = a.merchant_id
      JOIN identity.identities i ON i.id = mm.identity_id
     WHERE a.audience = 'merchant' AND 'merchant.members.read' = ANY (a.permissions)
       AND (p_membership_id IS NULL OR mm.id = p_membership_id)
     ORDER BY mm.created_at, mm.id
     LIMIT p_limit + 1;
  ELSE
    RETURN QUERY
    SELECT mm.id, mm.kind, mm.status, mm.role_id, mm.branch_id, i.email, mm.created_at, mm.deactivated_at
      FROM identity.session_authority(p_session_id) a
      JOIN tenancy.merchant_memberships mm ON mm.merchant_id = a.merchant_id
      JOIN identity.identities i ON i.id = mm.identity_id
     WHERE a.audience = 'merchant' AND 'merchant.members.read' = ANY (a.permissions)
       AND (p_membership_id IS NULL OR mm.id = p_membership_id)
       AND (mm.created_at, mm.id) > (p_after_created_at, p_after_id)
     ORDER BY mm.created_at, mm.id
     LIMIT p_limit + 1;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.list_members(uuid, uuid, integer, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.list_members(uuid, uuid, integer, timestamp with time zone, uuid) TO alphakolect_app;

-- ── invitations, newest first; open (pending and unexpired) or all ──
DROP FUNCTION tenancy.list_invitations(uuid, uuid);
CREATE FUNCTION tenancy.list_invitations(p_session_id uuid, p_invitation_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'all'::text, p_limit integer DEFAULT NULL::integer, p_after_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, email text, kind text, role_id uuid, branch_id uuid, expires_at timestamp with time zone, accepted_at timestamp with time zone, revoked_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('open', 'all') THEN
    RAISE EXCEPTION 'unknown invitation status filter' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'page size out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (p_after_created_at IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'a cursor position has both its timestamp and its id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- One statement a page. "Open" is pending (neither accepted nor revoked) and unexpired; it has statements of its own,
  -- whose stated pending condition lets a reused plan use the partial index of pending invitations.
  IF p_status = 'open' AND p_after_id IS NULL THEN
    RETURN QUERY
    SELECT i.id, i.email, i.kind, i.role_id, i.branch_id, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
      FROM identity.session_authority(p_session_id) a
      JOIN tenancy.invitations i ON i.merchant_id = a.merchant_id
     WHERE a.audience = 'merchant' AND 'merchant.invitations.read' = ANY (a.permissions)
       AND (p_invitation_id IS NULL OR i.id = p_invitation_id)
       AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT p_limit + 1;
  ELSIF p_status = 'open' THEN
    RETURN QUERY
    SELECT i.id, i.email, i.kind, i.role_id, i.branch_id, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
      FROM identity.session_authority(p_session_id) a
      JOIN tenancy.invitations i ON i.merchant_id = a.merchant_id
     WHERE a.audience = 'merchant' AND 'merchant.invitations.read' = ANY (a.permissions)
       AND (p_invitation_id IS NULL OR i.id = p_invitation_id)
       AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       AND (i.created_at, i.id) < (p_after_created_at, p_after_id)
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT p_limit + 1;
  ELSIF p_after_id IS NULL THEN
    RETURN QUERY
    SELECT i.id, i.email, i.kind, i.role_id, i.branch_id, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
      FROM identity.session_authority(p_session_id) a
      JOIN tenancy.invitations i ON i.merchant_id = a.merchant_id
     WHERE a.audience = 'merchant' AND 'merchant.invitations.read' = ANY (a.permissions)
       AND (p_invitation_id IS NULL OR i.id = p_invitation_id)
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT p_limit + 1;
  ELSE
    RETURN QUERY
    SELECT i.id, i.email, i.kind, i.role_id, i.branch_id, i.expires_at, i.accepted_at, i.revoked_at, i.created_at
      FROM identity.session_authority(p_session_id) a
      JOIN tenancy.invitations i ON i.merchant_id = a.merchant_id
     WHERE a.audience = 'merchant' AND 'merchant.invitations.read' = ANY (a.permissions)
       AND (p_invitation_id IS NULL OR i.id = p_invitation_id)
       AND (i.created_at, i.id) < (p_after_created_at, p_after_id)
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT p_limit + 1;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION tenancy.list_invitations(uuid, uuid, text, integer, timestamp with time zone, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.list_invitations(uuid, uuid, text, integer, timestamp with time zone, uuid) TO alphakolect_app;
