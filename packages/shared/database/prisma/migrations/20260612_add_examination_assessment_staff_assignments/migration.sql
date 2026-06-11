-- Migration: examination, assessment & staff-assignment persistence
--
-- Converts three more in-memory domains to durable Postgres storage:
--   * staff_assignments                    — teaching assignments (Req 7.2)
--   * examinations + 6 satellite tables    — exams, candidates, results,
--                                            publications, analyses, academic
--                                            records, document jobs (Req 10.x)
--   * grading_schemes / assessment_items /
--     assessment_outcomes / assessment_results — continuous assessment (Req 8.x)
--
-- All tables are tenant-scoped and protected by the standard
-- `tenant_isolation` RLS policies filtering on
-- current_setting('app.current_tenant_id'), same as every other tenant table.
-- Aggregates that are only ever read/written whole (examination publication
-- payloads, result analyses, exam subject/center/session/scheme collections)
-- are stored as JSONB, mirroring the established __profile envelope strategy.


-- ============================================================================
-- STAFF_ASSIGNMENTS
-- ============================================================================
CREATE TABLE "staff_assignments" (
    "id"                    UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"             UUID         NOT NULL,
    "staff_id"              UUID         NOT NULL,
    "institution_id"        UUID         NOT NULL,
    "subject_id"            UUID         NOT NULL,
    "class_id"              UUID         NOT NULL,
    "role"                  VARCHAR(100) NOT NULL,
    "allocation_percentage" SMALLINT     NOT NULL,
    "start_date"            DATE         NOT NULL,
    "end_date"              DATE,
    "status"                VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    "created_at"            TIMESTAMP    NOT NULL DEFAULT NOW(),
    "updated_at"            TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_assignments_tenant_staff_status_idx"
    ON "staff_assignments" ("tenant_id", "staff_id", "status");
CREATE INDEX "staff_assignments_tenant_institution_idx"
    ON "staff_assignments" ("tenant_id", "institution_id");
CREATE INDEX "staff_assignments_tenant_combo_idx"
    ON "staff_assignments" ("tenant_id", "staff_id", "institution_id", "subject_id", "class_id");

ALTER TABLE "staff_assignments"
    ADD CONSTRAINT "staff_assignments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "staff_assignments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "staff_assignments"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "staff_assignments"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "staff_assignments"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "staff_assignments"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- EXAMINATIONS
-- ============================================================================
CREATE TABLE "examinations" (
    "id"                 UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"          UUID         NOT NULL,
    "name"               VARCHAR(255) NOT NULL,
    "code"               VARCHAR(50)  NOT NULL,
    "description"        TEXT,
    "academic_period_id" UUID         NOT NULL,
    "start_date"         DATE         NOT NULL,
    "end_date"           DATE         NOT NULL,
    "status"             VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
    "subjects"           JSONB        NOT NULL DEFAULT '[]',
    "centers"            JSONB        NOT NULL DEFAULT '[]',
    "sessions"           JSONB        NOT NULL DEFAULT '[]',
    "grading_schemes"    JSONB        NOT NULL DEFAULT '[]',
    "created_at"         TIMESTAMP    NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT "examinations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "examinations_tenant_id_code_key"
    ON "examinations" ("tenant_id", "code");
CREATE INDEX "examinations_tenant_period_idx"
    ON "examinations" ("tenant_id", "academic_period_id");
CREATE INDEX "examinations_tenant_status_idx"
    ON "examinations" ("tenant_id", "status");

ALTER TABLE "examinations"
    ADD CONSTRAINT "examinations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "examinations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "examinations"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "examinations"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "examinations"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "examinations"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- EXAMINATION_CANDIDATE_REGISTRATIONS
-- ============================================================================
CREATE TABLE "examination_candidate_registrations" (
    "id"             UUID        NOT NULL,
    "tenant_id"      UUID        NOT NULL,
    "examination_id" UUID        NOT NULL,
    "student_id"     UUID        NOT NULL,
    "center_id"      UUID        NOT NULL,
    "subject_ids"    JSONB       NOT NULL DEFAULT '[]',
    "status"         VARCHAR(20) NOT NULL DEFAULT 'REGISTERED',
    "registered_at"  TIMESTAMP   NOT NULL,

    CONSTRAINT "examination_candidate_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "examination_candidate_registrations_tenant_exam_student_key"
    ON "examination_candidate_registrations" ("tenant_id", "examination_id", "student_id");

ALTER TABLE "examination_candidate_registrations"
    ADD CONSTRAINT "examination_candidate_registrations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "examination_candidate_registrations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "examination_candidate_registrations"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "examination_candidate_registrations"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "examination_candidate_registrations"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "examination_candidate_registrations"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- EXAMINATION_CANDIDATES
-- ============================================================================
CREATE TABLE "examination_candidates" (
    "id"              UUID        NOT NULL,
    "tenant_id"       UUID        NOT NULL,
    "examination_id"  UUID        NOT NULL,
    "student_id"      UUID        NOT NULL,
    "center_id"       UUID        NOT NULL,
    "gender"          VARCHAR(10) NOT NULL,
    "area_id"         UUID        NOT NULL,
    "subject_results" JSONB       NOT NULL DEFAULT '[]',

    CONSTRAINT "examination_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "examination_candidates_tenant_exam_student_key"
    ON "examination_candidates" ("tenant_id", "examination_id", "student_id");
CREATE INDEX "examination_candidates_tenant_exam_center_idx"
    ON "examination_candidates" ("tenant_id", "examination_id", "center_id");

ALTER TABLE "examination_candidates"
    ADD CONSTRAINT "examination_candidates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "examination_candidates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "examination_candidates"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "examination_candidates"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "examination_candidates"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "examination_candidates"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- EXAMINATION_PUBLICATIONS
-- ============================================================================
CREATE TABLE "examination_publications" (
    "examination_id" UUID      NOT NULL,
    "tenant_id"      UUID      NOT NULL,
    "published_at"   TIMESTAMP NOT NULL,
    "payload"        JSONB     NOT NULL,

    CONSTRAINT "examination_publications_pkey" PRIMARY KEY ("tenant_id", "examination_id")
);

ALTER TABLE "examination_publications"
    ADD CONSTRAINT "examination_publications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "examination_publications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "examination_publications"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "examination_publications"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "examination_publications"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "examination_publications"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- EXAMINATION_RESULT_ANALYSES
-- ============================================================================
CREATE TABLE "examination_result_analyses" (
    "examination_id" UUID      NOT NULL,
    "tenant_id"      UUID      NOT NULL,
    "generated_at"   TIMESTAMP NOT NULL,
    "payload"        JSONB     NOT NULL,

    CONSTRAINT "examination_result_analyses_pkey" PRIMARY KEY ("tenant_id", "examination_id")
);

ALTER TABLE "examination_result_analyses"
    ADD CONSTRAINT "examination_result_analyses_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "examination_result_analyses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "examination_result_analyses"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "examination_result_analyses"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "examination_result_analyses"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "examination_result_analyses"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- EXAMINATION_ACADEMIC_RECORDS
-- ============================================================================
CREATE TABLE "examination_academic_records" (
    "id"             UUID             NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"      UUID             NOT NULL,
    "student_id"     UUID             NOT NULL,
    "examination_id" UUID             NOT NULL,
    "subject_id"     UUID             NOT NULL,
    "score"          DOUBLE PRECISION NOT NULL,
    "grade"          VARCHAR(20)      NOT NULL,
    "passed"         BOOLEAN          NOT NULL,
    "published_at"   TIMESTAMP        NOT NULL,

    CONSTRAINT "examination_academic_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "examination_academic_records_tenant_student_idx"
    ON "examination_academic_records" ("tenant_id", "student_id");
CREATE INDEX "examination_academic_records_tenant_exam_idx"
    ON "examination_academic_records" ("tenant_id", "examination_id");

ALTER TABLE "examination_academic_records"
    ADD CONSTRAINT "examination_academic_records_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "examination_academic_records" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "examination_academic_records"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "examination_academic_records"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "examination_academic_records"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "examination_academic_records"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- EXAMINATION_DOCUMENT_JOBS
-- ============================================================================
CREATE TABLE "examination_document_jobs" (
    "id"               UUID        NOT NULL,
    "tenant_id"        UUID        NOT NULL,
    "examination_id"   UUID        NOT NULL,
    "document_type"    VARCHAR(30) NOT NULL,
    "status"           VARCHAR(20) NOT NULL DEFAULT 'queued',
    "candidate_ids"    JSONB       NOT NULL DEFAULT '[]',
    "total_candidates" INTEGER     NOT NULL,
    "processed_count"  INTEGER     NOT NULL DEFAULT 0,
    "failed_count"     INTEGER     NOT NULL DEFAULT 0,
    "error_message"    TEXT,
    "output_path"      TEXT,
    "duration_ms"      INTEGER,
    "created_at"       TIMESTAMP   NOT NULL,
    "started_at"       TIMESTAMP,
    "completed_at"     TIMESTAMP,

    CONSTRAINT "examination_document_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "examination_document_jobs_tenant_exam_idx"
    ON "examination_document_jobs" ("tenant_id", "examination_id");

ALTER TABLE "examination_document_jobs"
    ADD CONSTRAINT "examination_document_jobs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "examination_document_jobs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "examination_document_jobs"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "examination_document_jobs"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "examination_document_jobs"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "examination_document_jobs"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- GRADING_SCHEMES
-- ============================================================================
CREATE TABLE "grading_schemes" (
    "id"         UUID             NOT NULL,
    "tenant_id"  UUID             NOT NULL,
    "name"       VARCHAR(255)     NOT NULL,
    "type"       VARCHAR(20)      NOT NULL,
    "min_value"  DOUBLE PRECISION NOT NULL,
    "max_value"  DOUBLE PRECISION NOT NULL,
    "thresholds" JSONB            NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP        NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP        NOT NULL DEFAULT NOW(),

    CONSTRAINT "grading_schemes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grading_schemes_tenant_name_idx"
    ON "grading_schemes" ("tenant_id", "name");
CREATE INDEX "grading_schemes_tenant_type_idx"
    ON "grading_schemes" ("tenant_id", "type");

ALTER TABLE "grading_schemes"
    ADD CONSTRAINT "grading_schemes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "grading_schemes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "grading_schemes"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "grading_schemes"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "grading_schemes"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "grading_schemes"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- ASSESSMENT_ITEMS
-- ============================================================================
CREATE TABLE "assessment_items" (
    "id"                 UUID             NOT NULL,
    "tenant_id"          UUID             NOT NULL,
    "subject_id"         UUID             NOT NULL,
    "academic_period_id" UUID             NOT NULL,
    "grading_scheme_id"  UUID             NOT NULL,
    "name"               VARCHAR(255)     NOT NULL,
    "weight"             DOUBLE PRECISION NOT NULL,
    "max_score"          DOUBLE PRECISION NOT NULL,
    "min_score"          DOUBLE PRECISION NOT NULL,
    "outcome_ids"        JSONB            NOT NULL DEFAULT '[]',
    "created_at"         TIMESTAMP        NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMP        NOT NULL DEFAULT NOW(),

    CONSTRAINT "assessment_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assessment_items_tenant_subject_period_idx"
    ON "assessment_items" ("tenant_id", "subject_id", "academic_period_id");

ALTER TABLE "assessment_items"
    ADD CONSTRAINT "assessment_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "assessment_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "assessment_items"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "assessment_items"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "assessment_items"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "assessment_items"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- ASSESSMENT_OUTCOMES
-- ============================================================================
CREATE TABLE "assessment_outcomes" (
    "id"          UUID         NOT NULL,
    "tenant_id"   UUID         NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "code"        VARCHAR(50)  NOT NULL,
    "description" TEXT,
    "subject_id"  UUID         NOT NULL,
    "created_at"  TIMESTAMP    NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT "assessment_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assessment_outcomes_tenant_subject_idx"
    ON "assessment_outcomes" ("tenant_id", "subject_id");

ALTER TABLE "assessment_outcomes"
    ADD CONSTRAINT "assessment_outcomes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "assessment_outcomes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "assessment_outcomes"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "assessment_outcomes"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "assessment_outcomes"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "assessment_outcomes"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- ASSESSMENT_RESULTS
-- ============================================================================
CREATE TABLE "assessment_results" (
    "id"                 UUID             NOT NULL,
    "tenant_id"          UUID             NOT NULL,
    "student_id"         UUID             NOT NULL,
    "assessment_item_id" UUID             NOT NULL,
    "subject_id"         UUID             NOT NULL,
    "academic_period_id" UUID             NOT NULL,
    "score"              DOUBLE PRECISION NOT NULL,
    "created_at"         TIMESTAMP        NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMP        NOT NULL DEFAULT NOW(),

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assessment_results_tenant_student_item_key"
    ON "assessment_results" ("tenant_id", "student_id", "assessment_item_id");
CREATE INDEX "assessment_results_tenant_subject_period_idx"
    ON "assessment_results" ("tenant_id", "subject_id", "academic_period_id");
CREATE INDEX "assessment_results_tenant_item_idx"
    ON "assessment_results" ("tenant_id", "assessment_item_id");

ALTER TABLE "assessment_results"
    ADD CONSTRAINT "assessment_results_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");


ALTER TABLE "assessment_results" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "assessment_results"
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "assessment_results"
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "assessment_results"
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON "assessment_results"
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
