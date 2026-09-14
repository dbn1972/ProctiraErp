-- W1-DATA-16: leading tenant_id indexes for tenant-scoped tables that lacked them.
-- Additive / idempotent — applied via tools/scripts/apply-sql.sh.
--
-- Gaps closed:
--   1. report_schedules — only had (enabled, next_run_at); no tenant predicate index
--   2. control_plane_documents — had (collection, tenant_id) which is NOT leading
--      on tenant_id (RLS / tenant filters need tenant_id first)

CREATE INDEX IF NOT EXISTS report_schedules_tenant_idx
  ON report_schedules (tenant_id, enabled, next_run_at);

CREATE INDEX IF NOT EXISTS control_plane_documents_tenant_id_idx
  ON control_plane_documents (tenant_id, collection);

INSERT INTO schema_migrations (filename)
VALUES ('071_tenant_id_leading_indexes.sql')
ON CONFLICT (filename) DO NOTHING;
