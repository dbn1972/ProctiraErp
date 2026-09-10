-- Wave 7 (G-704) — durable control plane.
--
-- Replaces the in-memory audit / billing / tenant-lifecycle / invite / OTP /
-- IdP-identity / platform-admin stores with Postgres.
--
--   1. audit_log_entries          relational, append-only (UPDATE blocked; DELETE
--                                 only inside an archival run) + archive table +
--                                 per-tenant retention config
--   2. control_plane_documents    typed JSONB documents keyed by (collection, id)
--                                 used by billing, tenant lifecycle, invites, OTP,
--                                 Keycloak identities and the platform console
--
-- RLS: tenant rows are visible to their tenant (app.tenant_id); platform-scoped
-- rows (tenant_id NULL) and cross-tenant reads require app.platform_admin = '1'
-- (bound by @proctira/database withPlatformScope()).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Audit log (Requirements 21.1–21.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log_entries (
  id            UUID PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  operation     TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
  user_id       TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  ip_address    TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  before_values JSONB,
  after_values  JSONB,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_entries_tenant_time_idx
  ON audit_log_entries (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entries_tenant_entity_idx
  ON audit_log_entries (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_entries_tenant_user_idx
  ON audit_log_entries (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS audit_log_archive (
  LIKE audit_log_entries INCLUDING DEFAULTS,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  destination   TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_archive_tenant_time_idx
  ON audit_log_archive (tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_retention_configs (
  tenant_id            TEXT PRIMARY KEY,
  retention_months     INT NOT NULL CHECK (retention_months > 0),
  archival_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  archival_destination TEXT,
  last_archival_at     TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only guard: no UPDATE ever; DELETE only while app.audit_archival = '1'
-- (set by the archival routine inside its transaction).
CREATE OR REPLACE FUNCTION audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log_entries is append-only (UPDATE rejected)';
  END IF;
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('app.audit_archival', true), '') <> '1' THEN
    RAISE EXCEPTION 'audit_log_entries rows may only be removed by the archival routine';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log_entries;
CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log_entries', 'audit_log_archive', 'audit_retention_configs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')
                OR current_setting(''app.platform_admin'', true) = ''1'')
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')
                OR current_setting(''app.platform_admin'', true) = ''1'')',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Control-plane JSONB documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_plane_documents (
  collection  TEXT NOT NULL,
  id          TEXT NOT NULL,
  tenant_id   TEXT,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS control_plane_documents_tenant_idx
  ON control_plane_documents (collection, tenant_id);
CREATE INDEX IF NOT EXISTS control_plane_documents_data_gin
  ON control_plane_documents USING GIN (data jsonb_path_ops);

ALTER TABLE control_plane_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON control_plane_documents;
CREATE POLICY tenant_isolation ON control_plane_documents FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
         OR current_setting('app.platform_admin', true) = '1')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
         OR current_setting('app.platform_admin', true) = '1');

DROP TRIGGER IF EXISTS trg_set_updated_at ON control_plane_documents;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON control_plane_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO schema_migrations (filename)
VALUES ('022_control_plane_schema.sql')
ON CONFLICT (filename) DO NOTHING;
