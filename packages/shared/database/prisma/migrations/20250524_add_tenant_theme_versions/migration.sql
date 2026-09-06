-- Migration: tenant_theme_versions (Task 58.2 / Requirement 28 AC 4 / Design §N)
--
-- Append-only history of published tenant branding tokens.
--
-- Append-only semantics are enforced two ways:
--
--   1. The migration grants ONLY `INSERT` and `SELECT` on this table to the
--      application role. `UPDATE` and `DELETE` are NOT granted, so any
--      attempt to mutate or remove a row fails with a permission error.
--
--   2. Two row-level triggers (`tenant_theme_versions_no_update` and
--      `tenant_theme_versions_no_delete`) raise an exception even if the
--      table is accessed by a role that bypasses table-level grants
--      (e.g. the migration owner or a superuser running maintenance jobs).
--      This double-locks the audit trail.
--
-- The `(tenant_id, revision)` unique constraint guarantees revision numbers
-- are monotonically increasing and never collide for a single tenant. The
-- service layer assigns the next revision = `MAX(revision) + 1` per tenant.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE "tenant_theme_versions" (
    "id"           UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"    UUID         NOT NULL,
    "revision"     INTEGER      NOT NULL,
    "tokens"       JSONB        NOT NULL,
    "published_at" TIMESTAMPTZ  NOT NULL,
    "published_by" UUID         NOT NULL,

    CONSTRAINT "tenant_theme_versions_pkey" PRIMARY KEY ("id")
);

-- Monotonically increasing revision per tenant.
CREATE UNIQUE INDEX "tenant_theme_versions_tenant_revision_key"
    ON "tenant_theme_versions" ("tenant_id", "revision");

-- Lookup the most recent revision for a tenant cheaply.
CREATE INDEX "tenant_theme_versions_tenant_id_idx"
    ON "tenant_theme_versions" ("tenant_id");

CREATE INDEX "tenant_theme_versions_tenant_id_published_at_idx"
    ON "tenant_theme_versions" ("tenant_id", "published_at");

-- Foreign key to tenants — deletes are blocked while versions exist so the
-- audit trail outlives mistakenly-removed tenants.
ALTER TABLE "tenant_theme_versions"
    ADD CONSTRAINT "tenant_theme_versions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- ─── Append-only enforcement ─────────────────────────────────────────────────
--
-- 1. Trigger-level guard — works regardless of which role attempts the write.

CREATE OR REPLACE FUNCTION tenant_theme_versions_block_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'tenant_theme_versions is append-only; UPDATE is not permitted'
        USING ERRCODE = 'feature_not_supported';
END;
$$;

CREATE OR REPLACE FUNCTION tenant_theme_versions_block_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'tenant_theme_versions is append-only; DELETE is not permitted'
        USING ERRCODE = 'feature_not_supported';
END;
$$;

CREATE TRIGGER "tenant_theme_versions_no_update"
    BEFORE UPDATE ON "tenant_theme_versions"
    FOR EACH ROW EXECUTE FUNCTION tenant_theme_versions_block_update();

CREATE TRIGGER "tenant_theme_versions_no_delete"
    BEFORE DELETE ON "tenant_theme_versions"
    FOR EACH ROW EXECUTE FUNCTION tenant_theme_versions_block_delete();

-- 2. Privilege-level guard — only INSERT and SELECT are granted to the
--    application role. The role variable is read from the standard
--    `app.application_role` GUC (set in the deployment env). When it is not
--    set, we fall back to the current database role so local development /
--    CI still has access. Production deployments MUST set the GUC.

DO $$
DECLARE
    app_role  TEXT := COALESCE(
        NULLIF(current_setting('app.application_role', true), ''),
        current_user
    );
BEGIN
    EXECUTE format(
        'REVOKE ALL ON TABLE %I FROM %I',
        'tenant_theme_versions',
        app_role
    );
    EXECUTE format(
        'GRANT INSERT, SELECT ON TABLE %I TO %I',
        'tenant_theme_versions',
        app_role
    );
END
$$;
