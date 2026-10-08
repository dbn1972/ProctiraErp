-- PRC-H049: durable storage for developer-portal plugin submissions and
-- marketplace listings.
--
-- HybridDeveloperPortalRepository persisted accounts/webhooks/deliveries/keys
-- in Postgres but kept submissions, marketplace listings (and sandboxes/docs/
-- analytics) in process memory even with DATABASE_URL set, so approved/published
-- plugins and review decisions vanished on restart and differed per replica.
-- This migration makes submissions and listings durable (the highest-impact
-- entities: "approved on pod 1, publish on pod 2 returns 404"). Sandboxes/docs/
-- analytics remain tracked residuals.
--
-- Platform-scoped (marketplace is global, keyed by account/plugin name), using
-- the same platform_admin_only RLS as developer_portal_accounts (db/sql/089).
-- Idempotent; apply-sql.sh phase ledger records completion. Forward-only.

CREATE TABLE IF NOT EXISTS developer_portal_submissions (
  id                         UUID PRIMARY KEY,
  account_id                 UUID NOT NULL,
  name                       TEXT NOT NULL,
  version                    TEXT NOT NULL,
  display_name               TEXT NOT NULL,
  description                TEXT NOT NULL,
  category                   TEXT NOT NULL,
  supported_product_versions TEXT NOT NULL,
  required_permissions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_url                 TEXT,
  documentation_url          TEXT,
  icon_url                   TEXT,
  screenshots                JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  license                    TEXT,
  status                     TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','in_review','approved','rejected','published')),
  review_notes               TEXT,
  reviewed_by                TEXT,
  reviewed_at                TIMESTAMPTZ,
  submitted_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS developer_portal_submissions_account_idx
  ON developer_portal_submissions (account_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS developer_portal_submissions_status_idx
  ON developer_portal_submissions (status);

ALTER TABLE developer_portal_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_admin_only ON developer_portal_submissions;
CREATE POLICY platform_admin_only ON developer_portal_submissions
  FOR ALL
  USING (current_setting('app.platform_admin', true) = '1')
  WITH CHECK (current_setting('app.platform_admin', true) = '1');

CREATE TABLE IF NOT EXISTS developer_portal_listings (
  name           TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  description    TEXT NOT NULL,
  category       TEXT NOT NULL,
  version        TEXT NOT NULL,
  author         TEXT NOT NULL,
  account_id     UUID NOT NULL,
  icon_url       TEXT,
  screenshots    JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags           JSONB NOT NULL DEFAULT '[]'::jsonb,
  license        TEXT,
  installs       INTEGER NOT NULL DEFAULT 0,
  average_rating DOUBLE PRECISION NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  published_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS developer_portal_listings_category_idx
  ON developer_portal_listings (category);

ALTER TABLE developer_portal_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_admin_only ON developer_portal_listings;
CREATE POLICY platform_admin_only ON developer_portal_listings
  FOR ALL
  USING (current_setting('app.platform_admin', true) = '1')
  WITH CHECK (current_setting('app.platform_admin', true) = '1');

COMMENT ON TABLE developer_portal_submissions IS
  'PRC-H049 durable plugin submissions (replaces in-memory residual).';
COMMENT ON TABLE developer_portal_listings IS
  'PRC-H049 durable marketplace listings (replaces in-memory residual).';

DO $h049_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE developer_portal_submissions, developer_portal_listings TO proctira_app;
  END IF;
END
$h049_grant$;
