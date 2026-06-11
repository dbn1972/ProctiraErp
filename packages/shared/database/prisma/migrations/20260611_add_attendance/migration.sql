-- Migration: attendance persistence (Requirement 9.1-9.3, 9.6, 9.7)
--
-- Adds durable storage for the attendance domain, previously in-memory only:
--   * student_attendance  — per-student, per-class, per-date records
--   * staff_attendance     — per-staff, per-date records
--   * attendance_audit     — append-only status-change trail
--
-- student_attendance and staff_attendance are tenant-scoped and protected by
-- the same `tenant_isolation` RLS policies as every other tenant table
-- (filtering on `current_setting('app.current_tenant_id')`). attendance_audit
-- intentionally carries no tenant_id and no RLS — its rows are keyed by the
-- unguessable parent student_attendance UUID, and the parent table is RLS
-- protected (see schema.prisma note on AttendanceAudit).

-- ============================================================================
-- STUDENT ATTENDANCE
-- ============================================================================
CREATE TABLE "student_attendance" (
    "id"                 UUID        NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"          UUID        NOT NULL,
    "student_id"         UUID        NOT NULL,
    "institution_id"     UUID        NOT NULL,
    "class_id"           UUID        NOT NULL,
    "academic_period_id" UUID        NOT NULL,
    "date"               DATE        NOT NULL,
    "subject_id"         UUID,
    "period_id"          UUID,
    "status"             VARCHAR(20) NOT NULL,
    "comment"            TEXT,
    "recorded_by"        UUID        NOT NULL,
    "created_at"         TIMESTAMP   NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT "student_attendance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "student_attendance"
    ADD CONSTRAINT "student_attendance_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");

CREATE INDEX "student_attendance_tenant_class_date_idx"
    ON "student_attendance" ("tenant_id", "class_id", "date");
CREATE INDEX "student_attendance_tenant_student_class_date_idx"
    ON "student_attendance" ("tenant_id", "student_id", "class_id", "date");
CREATE INDEX "student_attendance_tenant_institution_date_idx"
    ON "student_attendance" ("tenant_id", "institution_id", "date");
CREATE INDEX "student_attendance_tenant_student_date_idx"
    ON "student_attendance" ("tenant_id", "student_id", "date");

ALTER TABLE "student_attendance" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "student_attendance"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "student_attendance"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "student_attendance"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "student_attendance"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- STAFF ATTENDANCE
-- ============================================================================
CREATE TABLE "staff_attendance" (
    "id"             UUID        NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"      UUID        NOT NULL,
    "staff_id"       UUID        NOT NULL,
    "institution_id" UUID        NOT NULL,
    "date"           DATE        NOT NULL,
    "status"         VARCHAR(20) NOT NULL,
    "leave_type_id"  UUID,
    "comment"        TEXT,
    "recorded_by"    UUID        NOT NULL,
    "created_at"     TIMESTAMP   NOT NULL DEFAULT NOW(),
    "updated_at"     TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "staff_attendance"
    ADD CONSTRAINT "staff_attendance_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "staff_attendance_tenant_staff_date_key"
    ON "staff_attendance" ("tenant_id", "staff_id", "date");
CREATE INDEX "staff_attendance_tenant_institution_date_idx"
    ON "staff_attendance" ("tenant_id", "institution_id", "date");

ALTER TABLE "staff_attendance" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "staff_attendance"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "staff_attendance"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "staff_attendance"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "staff_attendance"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- ATTENDANCE AUDIT (append-only; no RLS — see schema.prisma note)
-- ============================================================================
CREATE TABLE "attendance_audit" (
    "id"              UUID        NOT NULL,
    "attendance_id"   UUID        NOT NULL,
    "previous_status" VARCHAR(20),
    "new_status"      VARCHAR(20) NOT NULL,
    "changed_by"      UUID        NOT NULL,
    "changed_at"      TIMESTAMP   NOT NULL,

    CONSTRAINT "attendance_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_audit_attendance_id_idx"
    ON "attendance_audit" ("attendance_id");
