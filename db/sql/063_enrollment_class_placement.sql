-- W2-SIS-04: ENROLLED rows must carry a class/section placement.
-- Existing null class_id rows (if any) are left for an ops backfill; new writes
-- are rejected by the service. This CHECK only applies when status = ENROLLED.

ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_enrolled_requires_class;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_enrolled_requires_class
  CHECK (status <> 'ENROLLED' OR class_id IS NOT NULL);
