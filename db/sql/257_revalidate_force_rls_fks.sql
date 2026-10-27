-- PRC-M216: re-prove the cross-domain FKs that 086 / 087 / 093 left unproven
-- under FORCE ROW LEVEL SECURITY.
--
-- Problem:
--   * db/sql/087 added six FKs NOT VALID (student_attendance,
--     assessment_results, examination_candidate_registrations,
--     examination_candidates, examination_academic_records -> students;
--     staff_attendance -> staff) and shipped no VALIDATE companion.
--   * db/sql/086 (the 085 staff/HR/transport-fee set) and db/sql/093
--     (developer-portal tenant FKs) ran VALIDATE CONSTRAINT with FORCE RLS
--     still on (hazard waiver validate_under_force_rls). Under FORCE the
--     owner's validation scan is filtered by the tenant policy and a migration
--     session has no tenant bound, so it can read zero rows and "validate"
--     nothing. convalidated = true is therefore not proof for those names.
--
-- Fix (one transaction, one DO block):
--   1. Resolve the closed set of constraint names below from the catalog
--      (a name that does not exist is skipped with a NOTICE, as 085/086/087 do).
--   2. Record relforcerowsecurity for every child and parent table involved and
--      lift FORCE on each (NO FORCE ROW LEVEL SECURITY).
--   3. Explicit anti-join orphan count for EVERY listed constraint, validated or
--      not (MATCH SIMPLE: rows with a NULL key column are not checked). VALIDATE
--      on an already-valid constraint is a no-op, so this count is the real
--      proof for the 086/093 names.
--   4. Any orphan -> RAISE EXCEPTION with constraint=count pairs. Fail-closed:
--      this migration never deletes or rewrites tenant data, and the RAISE rolls
--      back the FORCE lift with everything else.
--   5. VALIDATE CONSTRAINT for each one still NOT VALID (the six 087 names).
--   6. Restore FORCE on exactly the tables that had it.
--   7. Assert every listed constraint that exists is convalidated and FORCE is
--      back on every lifted table.
--
-- Locks (PR rollout note): lifting FORCE takes ACCESS EXCLUSIVE on each lifted
-- table until COMMIT (about 20 tables, including students, staff, tenants,
-- fee_structures, parent_fee_invoices); the orphan counts and VALIDATE scan
-- each child. Run the step-3 queries read-only in staging first and schedule
-- the deploy in a quiet window. apply-sql.sh's lock_timeout (5s) fails the
-- deploy instead of queuing traffic behind a blocked lock.
--
-- Idempotent: a re-run recounts orphans (read-only), finds nothing NOT VALID,
-- and restores FORCE as before. Ledgered by apply-sql.sh as usual.
-- Rollback: none needed (proof + validation only; nothing is created).

DO $prc_m216_revalidate_force_rls_fks$
DECLARE
  names CONSTANT text[] := ARRAY[
    -- 087 (NOT VALID, never validated)
    'student_attendance_student_id_fkey',
    'assessment_results_student_id_fkey',
    'examination_candidate_registrations_student_id_fkey',
    'examination_candidates_student_id_fkey',
    'examination_academic_records_student_id_fkey',
    'staff_attendance_staff_id_fkey',
    -- 085 / 086 (validated under FORCE RLS)
    'staff_leave_requests_staff_id_fkey',
    'staff_leave_balances_staff_id_fkey',
    'staff_contracts_staff_id_fkey',
    'staff_qualifications_staff_id_fkey',
    'staff_hr_attendance_staff_id_fkey',
    'staff_payroll_lines_staff_id_fkey',
    'hr_appraisals_staff_id_fkey',
    'hr_training_attendance_staff_id_fkey',
    'hr_certifications_staff_id_fkey',
    'timetable_teacher_absences_staff_id_fkey',
    'exam_invigilators_staff_id_fkey',
    'transport_fee_links_fees_invoice_id_fkey',
    'transport_fee_links_fees_structure_id_fkey',
    'transport_fee_structures_fees_structure_id_fkey',
    -- 093 (validated under FORCE RLS)
    'developer_portal_webhooks_tenant_fk',
    'developer_portal_webhook_deliveries_tenant_fk'
  ];
  r record;
  rel text;
  join_pred text;
  notnull_pred text;
  orphan_count bigint;
  orphans text := '';
  found_names text[] := ARRAY[]::text[];
  tables text[] := ARRAY[]::text[];
  lifted text[] := ARRAY[]::text[];
  validated_count int := 0;
  remaining text;
BEGIN
  -- 1) Resolve names; collect every child and parent table.
  FOR r IN
    SELECT n AS conname, c.oid
      FROM unnest(names) AS n
      LEFT JOIN pg_constraint c
        ON c.conname = n AND c.contype = 'f'
       AND c.connamespace = 'public'::regnamespace
  LOOP
    IF r.oid IS NULL THEN
      RAISE NOTICE 'PRC-M216 skip % (constraint not present)', r.conname;
      CONTINUE;
    END IF;
    found_names := found_names || r.conname;
  END LOOP;

  SELECT coalesce(array_agg(DISTINCT t), ARRAY[]::text[])
    INTO tables
    FROM (
      SELECT c.conrelid::regclass::text AS t FROM pg_constraint c
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
         AND c.conname = ANY (found_names)
      UNION
      SELECT c.confrelid::regclass::text FROM pg_constraint c
       WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
         AND c.conname = ANY (found_names)
    ) s;

  -- 2) Lift FORCE, remembering which tables had it.
  FOREACH rel IN ARRAY tables LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = rel::regclass) THEN
      EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', rel);
      lifted := lifted || rel;
    END IF;
  END LOOP;

  -- 3) Orphan count per constraint (multi-column safe, MATCH SIMPLE).
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
           c.conkey, c.confkey, c.conrelid, c.confrelid
      FROM pg_constraint c
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
       AND c.conname = ANY (found_names)
     ORDER BY c.conname
  LOOP
    SELECT string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' AND ' ORDER BY k.ord),
           string_agg(format('c.%I IS NOT NULL', ca.attname), ' AND ' ORDER BY k.ord)
      INTO join_pred, notnull_pred
      FROM unnest(r.conkey, r.confkey) WITH ORDINALITY AS k(child_att, parent_att, ord)
      JOIN pg_attribute ca ON ca.attrelid = r.conrelid AND ca.attnum = k.child_att
      JOIN pg_attribute pa ON pa.attrelid = r.confrelid AND pa.attnum = k.parent_att;
    EXECUTE format(
      'SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)',
      r.child, notnull_pred, r.parent, join_pred
    ) INTO orphan_count;
    IF orphan_count > 0 THEN
      orphans := orphans || format('%s=%s; ', r.conname, orphan_count);
    END IF;
  END LOOP;

  -- 4) Fail closed.
  IF orphans <> '' THEN
    RAISE EXCEPTION
      'PRC-M216: dangling references block FK re-validation: % '
      '(reconcile those rows, never delete tenant data blindly, then re-run)',
      orphans;
  END IF;

  -- 5) Validate whatever is still NOT VALID (the 087 six).
  FOR r IN
    SELECT c.conname, c.conrelid::regclass::text AS child
      FROM pg_constraint c
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
       AND c.conname = ANY (found_names)
       AND NOT c.convalidated
     ORDER BY c.conname
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', r.child, r.conname);
    validated_count := validated_count + 1;
  END LOOP;

  -- 6) Restore FORCE on exactly the lifted tables.
  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
  END LOOP;

  -- 7) Assert.
  SELECT string_agg(c.conname, ', ')
    INTO remaining
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
     AND c.conname = ANY (found_names)
     AND NOT c.convalidated;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M216: constraints still NOT VALID: %', remaining;
  END IF;
  SELECT string_agg(c.oid::regclass::text, ', ')
    INTO remaining
    FROM pg_class c
   WHERE c.oid::regclass::text = ANY (lifted)
     AND NOT c.relforcerowsecurity;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M216: FORCE ROW LEVEL SECURITY not restored on: %', remaining;
  END IF;
  RAISE NOTICE 'PRC-M216: % FK(s) orphan-checked, % validated now, FORCE restored on % table(s)',
    cardinality(found_names), validated_count, cardinality(lifted);
END
$prc_m216_revalidate_force_rls_fks$;
