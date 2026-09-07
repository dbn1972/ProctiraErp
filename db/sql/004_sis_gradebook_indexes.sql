-- WS3 gradebook indexes + upsert uniqueness (idempotent)
-- Applied via psql against live Postgres — no Prisma.

\set ON_ERROR_STOP on

-- Unique natural key for grade upsert (NULL-safe via COALESCE sentinel)
CREATE UNIQUE INDEX IF NOT EXISTS grade_entries_upsert_uidx
  ON grade_entries (
    tenant_id,
    student_id,
    COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(assessment_code, '')
  );

CREATE INDEX IF NOT EXISTS gpa_snapshots_tenant_period_idx
  ON gpa_snapshots (tenant_id, academic_period_id);

CREATE INDEX IF NOT EXISTS transcript_issuances_tenant_status_idx
  ON transcript_issuances (tenant_id, status);
