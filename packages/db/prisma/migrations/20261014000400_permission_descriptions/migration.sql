-- P5.6: permission descriptions (P5 plan §10 P5.6, finding 2; O13, decided by the owner on 2026-10-14).
--
-- ADR-16's frozen PermissionCatalog contract (GET /v1/merchant/permissions) returns a description of each merchant
-- permission, shown to business owners when they choose what a role may do. The catalog — the only authority for
-- permissions — gains the column, seeded with the wording the owner approved word for word
-- (docs/business/P5_OWNER_REMAINING_QUESTIONS.md, A1). Every merchant permission must have one (a CHECK), so a
-- permission added later cannot reach the role screen undescribed; platform permissions have no description yet (no
-- contract shows them). The description explains a permission and decides nothing. It changes only by migration: the
-- app holds no privilege on the catalog, and the protection trigger keeps identifier, scope and grantability fixed.
--
-- tenancy.list_permission_catalog (the B1 read function, P5.5 step 4) returns the description too: replaced, same
-- signature, same grant. Forward-only; earlier migrations untouched.

ALTER TABLE identity.permission_catalog ADD COLUMN description text;

UPDATE identity.permission_catalog c SET description = d.description
  FROM (VALUES
    ('merchant.profile.read',       'See the business''s name and whether it is active.'),
    ('merchant.profile.update',     'Change the business''s name.'),
    ('merchant.branches.read',      'See the list of branches, including archived ones.'),
    ('merchant.branches.manage',    'Add branches, rename them, and archive or restore them.'),
    ('merchant.roles.read',         'See the roles and the permissions each role has.'),
    ('merchant.members.read',       'See the business''s members, with their email address, type (owner, staff or agent), role, branch and whether they are active.'),
    ('merchant.invitations.read',   'See the invitations sent, with the invited email address and whether each is pending, accepted, cancelled or expired.'),
    ('merchant.roles.manage',       'Create, rename, archive and restore roles, and choose each role''s permissions. Owner only.'),
    ('merchant.members.manage',     'Change a member''s role or branch, and deactivate or reactivate members. Owner only.'),
    ('merchant.invitations.manage', 'Invite new staff and agents, and cancel invitations. Owner only.'),
    ('merchant.audit.read',         'See everything that happened in the business, including refused attempts. Owner only.')
  ) AS d(identifier, description)
 WHERE c.identifier = d.identifier;

ALTER TABLE identity.permission_catalog
  ADD CONSTRAINT "permission_catalog_merchant_described"
    CHECK (scope <> 'merchant' OR (description IS NOT NULL AND char_length(btrim(description)) BETWEEN 1 AND 200)),
  ADD CONSTRAINT "permission_catalog_description_trimmed"
    CHECK (description IS NULL OR description = btrim(description));

DROP FUNCTION tenancy.list_permission_catalog(uuid);
CREATE FUNCTION tenancy.list_permission_catalog(p_session_id uuid)
 RETURNS TABLE(identifier text, description text, grantable boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT c.identifier, c.description, c.grantable
    FROM identity.session_authority(p_session_id) a
    JOIN identity.permission_catalog c ON c.scope = 'merchant' AND c.status = 'active'
   WHERE a.audience = 'merchant' AND 'merchant.roles.read' = ANY (a.permissions)
   ORDER BY c.identifier;
$function$;
REVOKE ALL ON FUNCTION tenancy.list_permission_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenancy.list_permission_catalog(uuid) TO alphakolect_app;
