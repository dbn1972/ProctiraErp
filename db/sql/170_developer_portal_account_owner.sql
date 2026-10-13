-- NEW-g7_platform-009 / PRC-M507: bind each developer-portal account to the
-- authenticated principal that created it.
--
-- developer_portal_accounts (089) is platform-scoped (no tenant_id;
-- platform_admin_only RLS). Account/sandbox/submission routes previously had no
-- owner binding, so one tenant admin could read/modify another developer's
-- account by guessing the accountId (horizontal privilege / IDOR across the
-- global developer namespace). This adds a nullable owner_user_id (JWT `sub`);
-- the application binds operations to this owner (platform-staff bypass).
--
-- Data safety: ADD COLUMN without a default is metadata-only (no table rewrite).
-- Existing rows get owner_user_id = NULL and are therefore accessible only to
-- platform-staff (fail-closed). The existing platform_admin_only RLS policy and
-- the dml privilege class already cover the new column. Idempotent.
--
-- Rollback: forward-only; a later migration may DROP COLUMN owner_user_id.
ALTER TABLE developer_portal_accounts
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT;

ALTER TABLE developer_portal_accounts
  DROP CONSTRAINT IF EXISTS developer_portal_accounts_owner_user_id_check;
ALTER TABLE developer_portal_accounts
  ADD CONSTRAINT developer_portal_accounts_owner_user_id_check
  CHECK (
    owner_user_id IS NULL
    OR (length(btrim(owner_user_id)) > 0 AND length(owner_user_id) <= 255)
  ) NOT VALID;
-- FORCE RLS would make the owner's validation scan see zero rows; lift it for
-- the scan and restore it in the same transaction (db/sql/100 pattern).
ALTER TABLE developer_portal_accounts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_accounts
  VALIDATE CONSTRAINT developer_portal_accounts_owner_user_id_check;
ALTER TABLE developer_portal_accounts FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN developer_portal_accounts.owner_user_id IS
  'NEW-g7_platform-009 / PRC-M507: JWT sub of the account owner; account-scoped routes bind to this owner (platform-staff bypass). NULL legacy rows are platform-staff-only.';
