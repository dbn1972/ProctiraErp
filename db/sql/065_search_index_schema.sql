-- W3-D2: Tenant-scoped search index foundation (Postgres backing store).
-- Durable documents for global search / command palette entity lookup.
-- Wave 3 ships schema + RLS; application adapters wire in a follow-up slice.

CREATE TABLE IF NOT EXISTS search_index_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'B')
  ) STORED,
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS search_index_documents_tenant_idx
  ON search_index_documents (tenant_id, indexed_at DESC);

CREATE INDEX IF NOT EXISTS search_index_documents_vector_idx
  ON search_index_documents USING GIN (search_vector);

ALTER TABLE search_index_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON search_index_documents;
CREATE POLICY tenant_isolation ON search_index_documents
  FOR ALL
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_admin', true), '') = '1'
  )
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_admin', true), '') = '1'
  );
