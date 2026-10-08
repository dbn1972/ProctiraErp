-- PRC-H071: durable storage for notification rules, templates and the
-- notification recipient directory.
--
-- Previously HybridNotificationRepository kept rules/templates/recipients in
-- process memory even with DATABASE_URL set, so admin-created templates and
-- rules vanished on restart or differed per replica, and queued notifications
-- referenced template ids that no longer existed. These tables make them
-- durable and tenant-isolated. The notification directory is this service's
-- own projection of (user -> roles/areas/institutions) used only for recipient
-- resolution; it is populated via seed/SCIM, never by joining another
-- service's tables (no cross-service DB read).
--
-- Idempotent; apply-sql.sh phase ledger records completion. Forward-only.

-- 1) Notification templates ------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  name       TEXT NOT NULL,
  channel    TEXT NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  variables  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_templates_tenant_idx
  ON notification_templates (tenant_id, created_at DESC);

ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_templates;
CREATE POLICY tenant_isolation ON notification_templates
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- 2) Notification rules -----------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_rules (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  name            TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  event           TEXT NOT NULL,
  conditions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id     UUID NOT NULL,
  channels        JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipient_query JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  schedule        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_rules_event_idx
  ON notification_rules (tenant_id, entity_type, event)
  WHERE is_active;

ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_rules;
CREATE POLICY tenant_isolation ON notification_rules
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- 3) Notification recipient directory --------------------------------------
-- Service-local projection used only for recipient resolution. Role/area/
-- institution membership stored as arrays. Populated via seed/SCIM upserts.
CREATE TABLE IF NOT EXISTS notification_directory_users (
  tenant_id       UUID NOT NULL,
  user_id         TEXT NOT NULL,
  role_ids        TEXT[] NOT NULL DEFAULT '{}',
  area_ids        TEXT[] NOT NULL DEFAULT '{}',
  institution_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS notification_directory_role_idx
  ON notification_directory_users USING GIN (role_ids);
CREATE INDEX IF NOT EXISTS notification_directory_area_idx
  ON notification_directory_users USING GIN (area_ids);
CREATE INDEX IF NOT EXISTS notification_directory_institution_idx
  ON notification_directory_users USING GIN (institution_ids);

ALTER TABLE notification_directory_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_directory_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_directory_users;
CREATE POLICY tenant_isolation ON notification_directory_users
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- W1-DATA-06: every uuid tenant_id table must carry a validated FK to
-- tenants(id). These tables are created empty in this migration, so the
-- constraints validate against zero rows (additive, non-destructive). Added
-- NOT VALID then validated with FORCE RLS lifted on tenants so the owner-side
-- validation scan is not blinded by the tenant_isolation policies.
DO $h071_tenant_fk$
DECLARE
  t text;
  tenants_forced boolean;
  tables text[] := ARRAY[
    'notification_templates', 'notification_rules', 'notification_directory_users'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass
        AND conname = format('%s_tenant_fk', t)
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants (id) NOT VALID',
        t, format('%s_tenant_fk', t));
    END IF;
  END LOOP;

  SELECT relforcerowsecurity INTO tenants_forced
    FROM pg_class WHERE oid = 'public.tenants'::regclass;
  IF tenants_forced THEN
    ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
  END IF;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t, format('%s_tenant_fk', t));
  END LOOP;

  IF tenants_forced THEN
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
  END IF;
END
$h071_tenant_fk$;

COMMENT ON TABLE notification_rules IS
  'PRC-H071 durable notification rules (replaces in-memory hybrid residual).';
COMMENT ON TABLE notification_templates IS
  'PRC-H071 durable notification templates (replaces in-memory hybrid residual).';
COMMENT ON TABLE notification_directory_users IS
  'PRC-H071 service-local recipient directory for role/area/institution resolution. No cross-service DB read.';

DO $h071_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE notification_templates, notification_rules, notification_directory_users
      TO proctira_app;
  END IF;
END
$h071_grant$;
