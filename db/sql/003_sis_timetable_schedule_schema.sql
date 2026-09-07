-- SIS foundation + timetable schema (WS0 / WS1) — raw SQL, no Prisma.
-- Reuses tenants, boards, institutions, academic_periods, grades, staff, students from 001.
-- Timetable-critical tables are fully constrained; gradebook/export tables are WS3 stubs.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE section_publish_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE substitution_status AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE export_job_status AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transcript_status AS ENUM ('DRAFT', 'ISSUED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Board codes + grading scales (WS0)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS board_codes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  board_id        UUID NOT NULL REFERENCES boards(id),
  institution_id  UUID REFERENCES institutions(id),
  code_type       VARCHAR(50) NOT NULL DEFAULT 'AFFILIATION',
  code_value      VARCHAR(100) NOT NULL,
  label           VARCHAR(255),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, board_id, code_type, code_value)
);
CREATE INDEX IF NOT EXISTS board_codes_tenant_board_idx
  ON board_codes (tenant_id, board_id);
CREATE INDEX IF NOT EXISTS board_codes_tenant_institution_idx
  ON board_codes (tenant_id, institution_id);

CREATE TABLE IF NOT EXISTS grading_scales (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  board_id    UUID NOT NULL REFERENCES boards(id),
  code        VARCHAR(50) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  scale_type  VARCHAR(50) NOT NULL DEFAULT 'PERCENT_BAND',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, board_id, code)
);
CREATE INDEX IF NOT EXISTS grading_scales_tenant_board_idx
  ON grading_scales (tenant_id, board_id);

CREATE TABLE IF NOT EXISTS grading_scale_bands (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  grading_scale_id  UUID NOT NULL REFERENCES grading_scales(id) ON DELETE CASCADE,
  label             VARCHAR(50) NOT NULL,
  min_percent       NUMERIC(5,2) NOT NULL,
  max_percent       NUMERIC(5,2) NOT NULL,
  grade_points      NUMERIC(4,2),
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_percent >= 0 AND max_percent <= 100 AND min_percent <= max_percent),
  UNIQUE (grading_scale_id, label)
);
CREATE INDEX IF NOT EXISTS grading_scale_bands_scale_idx
  ON grading_scale_bands (grading_scale_id, sort_order);

-- ---------------------------------------------------------------------------
-- Rooms + bell schedule (WS1 timetable-critical)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rooms (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  institution_id  UUID NOT NULL REFERENCES institutions(id),
  code            VARCHAR(50) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  capacity        INT NOT NULL DEFAULT 30 CHECK (capacity > 0),
  room_type       VARCHAR(50) NOT NULL DEFAULT 'CLASSROOM',
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, institution_id, code)
);
CREATE INDEX IF NOT EXISTS rooms_tenant_institution_idx
  ON rooms (tenant_id, institution_id);
CREATE INDEX IF NOT EXISTS rooms_tenant_status_idx
  ON rooms (tenant_id, status);

CREATE TABLE IF NOT EXISTS bell_schedules (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  institution_id      UUID NOT NULL REFERENCES institutions(id),
  academic_period_id  UUID NOT NULL REFERENCES academic_periods(id),
  code                VARCHAR(50) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  -- day_pattern: ISO weekday ints 1=Mon … 7=Sun, e.g. [1,2,3,4,5]
  day_pattern         JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  status              VARCHAR(20) NOT NULL DEFAULT 'active',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (tenant_id, institution_id, academic_period_id, code)
);
CREATE INDEX IF NOT EXISTS bell_schedules_tenant_institution_period_idx
  ON bell_schedules (tenant_id, institution_id, academic_period_id);

CREATE TABLE IF NOT EXISTS bell_periods (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  bell_schedule_id  UUID NOT NULL REFERENCES bell_schedules(id) ON DELETE CASCADE,
  code              VARCHAR(50) NOT NULL,
  name              VARCHAR(100) NOT NULL,
  period_order      SMALLINT NOT NULL CHECK (period_order > 0),
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  is_break          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  CHECK (start_time < end_time),
  UNIQUE (bell_schedule_id, code),
  UNIQUE (bell_schedule_id, period_order)
);
CREATE INDEX IF NOT EXISTS bell_periods_schedule_order_idx
  ON bell_periods (bell_schedule_id, period_order);

-- Compatibility view: plan/docs sometimes say "periods"; canonical table is bell_periods.
CREATE OR REPLACE VIEW periods AS
  SELECT
    id,
    tenant_id,
    bell_schedule_id,
    name,
    period_order,
    start_time::text AS start_time,
    end_time::text AS end_time,
    created_at,
    updated_at
  FROM bell_periods
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Sections / meetings / substitutions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sections (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  institution_id      UUID NOT NULL REFERENCES institutions(id),
  academic_period_id  UUID NOT NULL REFERENCES academic_periods(id),
  grade_id            UUID REFERENCES grades(id),
  code                VARCHAR(50) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  primary_teacher_id  UUID REFERENCES staff(id),
  default_room_id     UUID REFERENCES rooms(id),
  capacity            INT NOT NULL DEFAULT 40 CHECK (capacity > 0),
  status              section_publish_status NOT NULL DEFAULT 'DRAFT',
  published_at        TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (tenant_id, institution_id, academic_period_id, code)
);
CREATE INDEX IF NOT EXISTS sections_tenant_institution_period_idx
  ON sections (tenant_id, institution_id, academic_period_id);
CREATE INDEX IF NOT EXISTS sections_tenant_status_idx
  ON sections (tenant_id, status);

CREATE TABLE IF NOT EXISTS section_enrollments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES students(id),
  status       VARCHAR(20) NOT NULL DEFAULT 'ENROLLED',
  enrolled_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  withdrawn_at DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (section_id, student_id)
);
CREATE INDEX IF NOT EXISTS section_enrollments_tenant_section_idx
  ON section_enrollments (tenant_id, section_id);
CREATE INDEX IF NOT EXISTS section_enrollments_tenant_student_idx
  ON section_enrollments (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS section_meetings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  section_id          UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  bell_period_id      UUID NOT NULL REFERENCES bell_periods(id),
  -- ISO weekday: 1=Monday … 7=Sunday
  day_of_week         SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  room_id             UUID REFERENCES rooms(id),
  teacher_staff_id    UUID REFERENCES staff(id),
  effective_from      DATE,
  effective_to        DATE,
  status              VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  UNIQUE (section_id, bell_period_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS section_meetings_tenant_section_idx
  ON section_meetings (tenant_id, section_id);
CREATE INDEX IF NOT EXISTS section_meetings_teacher_day_idx
  ON section_meetings (tenant_id, teacher_staff_id, day_of_week)
  WHERE teacher_staff_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS section_meetings_room_day_idx
  ON section_meetings (tenant_id, room_id, day_of_week)
  WHERE room_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS substitutions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  section_meeting_id   UUID NOT NULL REFERENCES section_meetings(id) ON DELETE CASCADE,
  original_staff_id    UUID NOT NULL REFERENCES staff(id),
  substitute_staff_id  UUID NOT NULL REFERENCES staff(id),
  substitution_date    DATE NOT NULL,
  reason               TEXT,
  status               substitution_status NOT NULL DEFAULT 'SCHEDULED',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (original_staff_id <> substitute_staff_id),
  UNIQUE (section_meeting_id, substitution_date)
);
CREATE INDEX IF NOT EXISTS substitutions_tenant_date_idx
  ON substitutions (tenant_id, substitution_date);
CREATE INDEX IF NOT EXISTS substitutions_substitute_date_idx
  ON substitutions (tenant_id, substitute_staff_id, substitution_date);

-- ---------------------------------------------------------------------------
-- Gradebook / transcript / export stubs (WS3–WS4 scaffolding)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  board_id    UUID REFERENCES boards(id),
  code        VARCHAR(50) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  credits     NUMERIC(5,2) NOT NULL DEFAULT 1.00 CHECK (credits >= 0),
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS grade_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  section_id      UUID REFERENCES sections(id),
  student_id      UUID NOT NULL REFERENCES students(id),
  assessment_code VARCHAR(100),
  numeric_score   NUMERIC(7,2),
  letter_grade    VARCHAR(10),
  entered_by      UUID,
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at       TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grade_entries_tenant_section_idx
  ON grade_entries (tenant_id, section_id);
CREATE INDEX IF NOT EXISTS grade_entries_tenant_student_idx
  ON grade_entries (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS gpa_snapshots (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  student_id          UUID NOT NULL REFERENCES students(id),
  academic_period_id  UUID REFERENCES academic_periods(id),
  weighted_gpa        NUMERIC(5,3),
  unweighted_gpa      NUMERIC(5,3),
  credits_earned      NUMERIC(7,2),
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gpa_snapshots_tenant_student_idx
  ON gpa_snapshots (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS transcript_issuances (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  student_id      UUID NOT NULL REFERENCES students(id),
  version         INT NOT NULL DEFAULT 1 CHECK (version > 0),
  status          transcript_status NOT NULL DEFAULT 'DRAFT',
  issued_at       TIMESTAMPTZ,
  issued_by       UUID,
  artifact_uri    TEXT,
  checksum_sha256 VARCHAR(64),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, student_id, version)
);
CREATE INDEX IF NOT EXISTS transcript_issuances_tenant_student_idx
  ON transcript_issuances (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS board_export_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  board_id        UUID NOT NULL REFERENCES boards(id),
  institution_id  UUID REFERENCES institutions(id),
  job_type        VARCHAR(50) NOT NULL DEFAULT 'MARKSHEET_PACK',
  status          export_job_status NOT NULL DEFAULT 'QUEUED',
  requested_by    UUID,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  artifact_uri    TEXT,
  error_message   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS board_export_jobs_tenant_status_idx
  ON board_export_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS board_export_jobs_tenant_board_idx
  ON board_export_jobs (tenant_id, board_id);

GRANT ALL ON ALL TABLES IN SCHEMA public TO proctira;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO proctira;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO proctira;
