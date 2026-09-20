-- Identity -> staff link, and referential integrity for the assignment records
-- that authorization now derives from.
--
-- Context: `docs/audits/TENANCY_IDENTITY_INVARIANT.md`.
--   A board is the tenant, a school is a row, and one identity belongs to exactly
--   one tenant. "Additional charge" — a headmaster also running a second school —
--   is therefore intra-tenant: one identity, one tenant, several institutions.
--
-- `apps/api-gateway/src/institution-scope.ts` already implements that via an
-- `institutions[]` claim, but `packages/backend/auth/src/keycloak/verify.ts`
-- hardcoded `institutions: []`, so nothing ever populated it. The data that should
-- drive it lives in `staff_assignments`, which already carries institution, role,
-- allocation_percentage and start/end dates. What was missing is a link from the
-- authenticated principal to the staff row.
--
-- Industry pattern followed (Ed-Fi staff/education-organization assignment,
-- OneRoster user-to-org association, and effective-dated HR assignment records in
-- general): keep identity and person as separate records joined by one link, put
-- temporal validity on the *assignment*, and derive access from assignments active
-- at request time rather than from a stored permission list.

-- ---------------------------------------------------------------------------
-- 1. Identity -> staff link
-- ---------------------------------------------------------------------------
-- Nullable because most staff never get a login, and a login can exist before the
-- staff record is created.
--
-- Intentionally NOT a foreign key. The authenticated principal is `auth.users`,
-- which is a logical collection inside `control_plane_documents` rather than a
-- relation — `to_regclass('auth.users')` returns NULL and no `auth` schema exists.
-- There is nothing to reference. If auth users are ever promoted to a real table,
-- add the FK in a forward migration at that point.
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS user_id UUID;

COMMENT ON COLUMN staff.user_id IS
  'Authenticated principal (auth.users document id) for this staff member. '
  'Nullable: most staff have no login. Not an FK because auth.users is a logical '
  'collection in control_plane_documents, not a relation. At most one staff row '
  'per principal per tenant — see uq_staff_user_id_per_tenant.';

-- One login maps to at most one staff record within a tenant. Partial, so the many
-- NULL rows do not collide. Per-tenant rather than global because the identity
-- invariant already guarantees a principal never spans tenants; scoping the index
-- to tenant_id keeps it consistent with every other constraint on this table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_user_id_per_tenant
  ON staff (tenant_id, user_id)
  WHERE user_id IS NOT NULL;

-- Lookup path for request-time resolution: principal -> staff -> assignments.
CREATE INDEX IF NOT EXISTS staff_user_id_idx
  ON staff (user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Referential integrity on staff_assignments
-- ---------------------------------------------------------------------------
-- This table already had a tenants(id) FK but none to staff or institutions, so a
-- row could reference a staff member or school that does not exist. That was
-- tolerable while the table was inert; it is not once authorization reads it.
--
-- NOT VALID then VALIDATE so the scan does not hold a long lock on a populated
-- table. Both validate immediately where the table is empty.
DO $staff_assignment_fks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.staff_assignments'::regclass
      AND conname = 'staff_assignments_staff_fk'
  ) THEN
    ALTER TABLE staff_assignments
      ADD CONSTRAINT staff_assignments_staff_fk
      FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.staff_assignments'::regclass
      AND conname = 'staff_assignments_institution_fk'
  ) THEN
    ALTER TABLE staff_assignments
      ADD CONSTRAINT staff_assignments_institution_fk
      FOREIGN KEY (institution_id) REFERENCES institutions (id) NOT VALID;
  END IF;
END
$staff_assignment_fks$;

ALTER TABLE staff_assignments VALIDATE CONSTRAINT staff_assignments_staff_fk;
ALTER TABLE staff_assignments VALIDATE CONSTRAINT staff_assignments_institution_fk;

-- An end_date before start_date would silently grant or deny access for a window
-- that cannot be reasoned about. Reject it.
DO $staff_assignment_dates$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.staff_assignments'::regclass
      AND conname = 'staff_assignments_date_order_check'
  ) THEN
    ALTER TABLE staff_assignments
      ADD CONSTRAINT staff_assignments_date_order_check
      CHECK (end_date IS NULL OR end_date >= start_date) NOT VALID;
  END IF;
END
$staff_assignment_dates$;

ALTER TABLE staff_assignments VALIDATE CONSTRAINT staff_assignments_date_order_check;

-- ---------------------------------------------------------------------------
-- 3. Administrative assignments have no subject or class
-- ---------------------------------------------------------------------------
-- `subject_id` and `class_id` were both NOT NULL, which silently assumed every
-- assignment is a teaching allocation. An administrative posting is not: a
-- headmaster holding additional charge of a second school teaches no particular
-- subject to no particular class, and neither does a principal, bursar or
-- librarian. There was no way to record one without inventing a subject, which
-- would have polluted the subject list and corrupted any per-subject reporting.
--
-- Neither column has a foreign key, and the table is empty, so relaxing them
-- affects no existing row.
--
-- This mirrors how the education standards separate the two ideas: a staff-to-
-- organization assignment (which school, which role, valid when) is distinct from a
-- staff-to-section assignment (which class, which subject). One table serves both
-- here, so the teaching columns must be optional.
--
-- Deliberately no CHECK requiring subject/class for teaching roles: the role
-- taxonomy is free text (`character varying`) and constraining it would need a
-- vocabulary this migration should not invent.
ALTER TABLE staff_assignments ALTER COLUMN subject_id DROP NOT NULL;
ALTER TABLE staff_assignments ALTER COLUMN class_id DROP NOT NULL;

COMMENT ON COLUMN staff_assignments.subject_id IS
  'Teaching allocation only. NULL for administrative assignments such as a '
  'principal or an additional-charge posting.';
COMMENT ON COLUMN staff_assignments.class_id IS
  'Teaching allocation only. NULL for administrative assignments.';

-- Resolution reads "assignments active for this staff member now", so index the
-- path it actually takes.
CREATE INDEX IF NOT EXISTS staff_assignments_active_lookup_idx
  ON staff_assignments (tenant_id, staff_id, status, start_date, end_date);

INSERT INTO schema_migrations (filename)
VALUES ('098_staff_identity_link.sql')
ON CONFLICT (filename) DO NOTHING;
