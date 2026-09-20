-- W1-DATA-02 residual: 14 tables whose RLS raises instead of denying.
--
-- 095_w1_data_02_rls_safe_deny.sql made RLS fail closed, but it only rewrote
-- policies that read the canonical `app.tenant_id`. These 14 tables read the LEGACY
-- `app.current_tenant_id`, so 095 never matched them (grep it: zero references).
--
-- Each of the 56 policies looked like:
--
--     tenant_id = (current_setting('app.current_tenant_id'::text))::uuid
--
-- Two independent failure modes, both of which raise rather than deny:
--
--   1. `current_setting(name)` without the missing-ok argument raises
--      `unrecognized configuration parameter` when the GUC was never set. An
--      unscoped query therefore ERRORS instead of returning zero rows. That is not
--      fail-closed — it is fail-noisy, it turns an authorization decision into a
--      500, and the error itself confirms the relation exists.
--
--   2. `::uuid` on a malformed value raises `invalid input syntax for type uuid`.
--      Same class of problem, different trigger.
--
-- Replaced with the pattern already used by `staff`, `fee_*`, `parent_fee_*`,
-- `admission_form_configurations` and the rest of the schema:
--
--     tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
--
--   * `true` makes a missing GUC return NULL instead of raising
--   * `NULLIF(..., '')` treats an empty string as absent
--   * comparing against NULL yields NULL, which RLS treats as false -> DENY
--   * comparing as text removes the uuid cast, so a malformed GUC also denies
--     instead of raising
--
-- This also moves these tables onto the canonical GUC. They previously depended on
-- the legacy alias that `set_app_tenant_id` syncs; if that sync were ever removed,
-- all 14 would have broken.
--
-- Affected (4 policies each: SELECT / INSERT / UPDATE / DELETE):
--   assessment_items, assessment_outcomes, assessment_results,
--   examination_academic_records, examination_candidate_registrations,
--   examination_candidates, examination_document_jobs, examination_publications,
--   examination_result_analyses, examinations, grading_schemes,
--   staff_assignments, staff_attendance, student_attendance
--
-- Behaviour change is intentional and narrow: a correctly scoped request is
-- unaffected, an unscoped one now sees no rows instead of an error.
--
-- Deliberately NOT touched. Five further policies mention the legacy GUC but are
-- already safe, and rewriting them would be a regression:
--
--   insights_ui_import_jobs, insights_ui_runs, tenant_theme_drafts,
--   tenant_theme_versions
--     COALESCE(NULLIF(current_setting('app.tenant_id', true), ''),
--              NULLIF(current_setting('app.current_tenant_id', true), ''))
--     Canonical GUC first, legacy only as a fallback, both with missing-ok. Correct.
--
--   attendance_audit
--     Has no tenant_id column of its own; it authorizes by EXISTS against
--     student_attendance / staff_attendance, already with missing-ok. Applying the
--     column predicate used below would fail with "column tenant_id does not exist".
--
-- The assertion below therefore matches the UNSAFE call shape — current_setting with
-- no second argument — rather than any mention of the legacy name. An earlier draft
-- matched the name and produced five false positives.

DO $w1_data_02_legacy_guc$
DECLARE
  t text;
  tables text[] := ARRAY[
    'assessment_items',
    'assessment_outcomes',
    'assessment_results',
    'examination_academic_records',
    'examination_candidate_registrations',
    'examination_candidates',
    'examination_document_jobs',
    'examination_publications',
    'examination_result_analyses',
    'examinations',
    'grading_schemes',
    'staff_assignments',
    'staff_attendance',
    'student_attendance'
  ];
  predicate CONSTANT text :=
    '(tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), ''''))';
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'W1-DATA-02: skipping %, relation absent', t;
      CONTINUE;
    END IF;

    -- Keep RLS on and forced; only the predicates change.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT USING %s', t, predicate);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON public.%I FOR INSERT WITH CHECK %s', t, predicate);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON public.%I FOR UPDATE USING %s WITH CHECK %s',
      t, predicate, predicate);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON public.%I FOR DELETE USING %s', t, predicate);
  END LOOP;

END
$w1_data_02_legacy_guc$;

-- Fail the migration if any policy anywhere still reads the legacy GUC, so this
-- cannot silently regress or be partially applied.
DO $w1_data_02_assert$
DECLARE
  leftover int;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE coalesce(qual, '') || coalesce(with_check, '')
         LIKE '%current_setting(''app.current_tenant_id''::text)%';
  IF leftover > 0 THEN
    RAISE EXCEPTION
      'W1-DATA-02: % policy/policies still call current_setting(app.current_tenant_id) '
      'without the missing-ok argument', leftover;
  END IF;
END
$w1_data_02_assert$;

INSERT INTO schema_migrations (filename)
VALUES ('099_w1_data_02_legacy_guc_safe_deny.sql')
ON CONFLICT (filename) DO NOTHING;
