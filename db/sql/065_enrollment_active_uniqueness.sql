-- W3-RACE-02 (B3): at most one ENROLLED enrollment per student per academic period.
-- TRANSFERRED / WITHDRAWN / GRADUATED rows are excluded so re-enroll and transfer
-- flows remain valid. Tenant-scoped partial unique index is the race-safe backstop;
-- EnrollmentService also checks before insert.

CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollments_active_student_period
  ON enrollments (tenant_id, student_id, academic_period_id)
  WHERE status = 'ENROLLED';
