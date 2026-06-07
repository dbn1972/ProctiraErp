-- Migration: tenant_theme_drafts (Task 58.3 / Requirement 28 AC 5 / Design §N)
--
-- Stores the in-progress branding-token edits a tenant administrator is
-- working on in Settings → Branding before publishing. Drafts are kept in
-- a sibling table (rather than as a column on `tenant_settings`) so the
-- existing tenant config / theme update paths stay independent of the
-- preview flow.
--
-- Cardinality: AT MOST ONE draft per tenant. Saving again UPSERTs and
-- replaces the prior draft. Discarding (DELETE) removes the row entirely.
-- The published theme remains in `tenant_theme_versions` (Task 58.2);
-- this table is the staging buffer for the preview cookie/header path.

CREATE TABLE "tenant_theme_drafts" (
    "tenant_id" UUID         NOT NULL,
    "tokens"    JSONB        NOT NULL,
    "saved_at"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "saved_by"  UUID         NOT NULL,

    CONSTRAINT "tenant_theme_drafts_pkey" PRIMARY KEY ("tenant_id")
);

-- Foreign key to tenants — drafts are useless without their tenant, so we
-- cascade on tenant delete. The audit trail in `tenant_theme_versions`
-- continues to outlive any draft (the version table uses ON DELETE
-- RESTRICT instead).
ALTER TABLE "tenant_theme_drafts"
    ADD CONSTRAINT "tenant_theme_drafts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- Lookup-by-saved_by for audit reports ("who has unpublished drafts?").
CREATE INDEX "tenant_theme_drafts_saved_by_idx"
    ON "tenant_theme_drafts" ("saved_by");
