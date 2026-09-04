-- Persist enrollment status history and student transfers.

CREATE TABLE "enrollment_history" (
    "id"                 UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"          UUID         NOT NULL,
    "enrollment_id"      UUID         NOT NULL,
    "previous_status"    VARCHAR(20),
    "new_status"         VARCHAR(20)  NOT NULL,
    "effective_date"     DATE         NOT NULL,
    "institution_id"     UUID         NOT NULL,
    "academic_period_id" UUID         NOT NULL,
    "reason"             VARCHAR(500),
    "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "enrollment_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "enrollment_history_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
    CONSTRAINT "enrollment_history_enrollment_fkey"
        FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE
);

CREATE INDEX "enrollment_history_tenant_enrollment_idx"
    ON "enrollment_history" ("tenant_id", "enrollment_id");

CREATE TABLE "student_transfers" (
    "id"                         UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"                  UUID         NOT NULL,
    "student_id"                 UUID         NOT NULL,
    "source_institution_id"      UUID         NOT NULL,
    "source_enrollment_id"       UUID         NOT NULL,
    "destination_institution_id" UUID         NOT NULL,
    "destination_enrollment_id"  UUID         NOT NULL,
    "transfer_date"              DATE         NOT NULL,
    "reason"                     VARCHAR(500) NOT NULL,
    "created_at"                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "student_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "student_transfers_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
);

CREATE INDEX "student_transfers_tenant_student_idx"
    ON "student_transfers" ("tenant_id", "student_id");

ALTER TABLE "enrollment_history" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "enrollment_history"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "enrollment_history"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON "enrollment_history"
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "enrollment_history"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE "student_transfers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_select ON "student_transfers"
  FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "student_transfers"
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON "student_transfers"
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "student_transfers"
  FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
