-- PRC-L294: 9 residual tenant_isolation policies raise on a malformed GUC
-- instead of denying.
--
-- Confirmed live (pg_policies) on this worktree's shared Postgres before
-- writing this file: all 9 policies below still use the pre-095/099 shape
--
--     tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid
--
-- `NULLIF(current_setting(..., true), '')` already makes a missing GUC
-- evaluate to NULL instead of raising "unrecognized configuration parameter",
-- but the trailing `::uuid` cast still raises `invalid input syntax for type
-- uuid` (22P02) when the GUC is bound to any non-UUID string. That turns a
-- malformed tenant context into a 500 instead of a deny, and the error text
-- itself confirms the relation's column shape to an unauthenticated caller.
--
-- Fix (same safe-deny shape as 095/099): compare as text so a malformed GUC
-- compares as a non-matching string instead of failing a cast.
--
--     tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
--
-- Each policy's FOR clause and WITH CHECK presence is preserved exactly as
-- found (all are FOR ALL; 5 have WITH CHECK, 4 have USING only). ENABLE +
-- FORCE ROW LEVEL SECURITY are re-asserted defensively.

DO $prc_l294_rewrite$
DECLARE
  t text;
  predicate CONSTANT text :=
    '(tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), ''''))';
  -- Table -> (policy name, has with_check)
  specs jsonb := '[
    {"table": "fee_credit_notes", "policy": "tenant_isolation", "check": false},
    {"table": "fee_write_offs", "policy": "tenant_isolation", "check": false},
    {"table": "staff_payroll_ledger_entries", "policy": "tenant_isolation", "check": false},
    {"table": "staff_payroll_lines", "policy": "tenant_isolation", "check": false},
    {"table": "staff_payroll_runs", "policy": "tenant_isolation", "check": false},
    {"table": "fee_reminder_send_audits", "policy": "fee_reminder_send_audits_tenant", "check": true},
    {"table": "fee_reminder_suppressions", "policy": "fee_reminder_suppressions_tenant", "check": true},
    {"table": "student_admission_counters", "policy": "tenant_isolation", "check": true},
    {"table": "student_merges", "policy": "tenant_isolation", "check": true}
  ]'::jsonb;
  spec jsonb;
BEGIN
  FOR spec IN SELECT * FROM jsonb_array_elements(specs)
  LOOP
    t := spec->>'table';
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'PRC-L294: skipping %, relation absent', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', spec->>'policy', t);

    IF (spec->>'check')::boolean THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC USING %s WITH CHECK %s',
        spec->>'policy', t, predicate, predicate);
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC USING %s',
        spec->>'policy', t, predicate);
    END IF;
  END LOOP;
END
$prc_l294_rewrite$;

-- Fail loudly if any policy on these 9 relations still casts the GUC to
-- uuid, so a missed case (or a future regression) cannot ship silently.
DO $prc_l294_assert$
DECLARE
  leftover int;
BEGIN
  SELECT count(*) INTO leftover
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'fee_credit_notes', 'fee_write_offs', 'staff_payroll_ledger_entries',
       'staff_payroll_lines', 'staff_payroll_runs', 'fee_reminder_send_audits',
       'fee_reminder_suppressions', 'student_admission_counters', 'student_merges'
     )
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%::uuid%';
  IF leftover > 0 THEN
    RAISE EXCEPTION
      'PRC-L294: % policy/policies on the 9 named tables still cast the tenant '
      'GUC to ::uuid (malformed-GUC-raises regression)', leftover;
  END IF;
END
$prc_l294_assert$;

INSERT INTO schema_migrations (filename)
VALUES ('240_rls_malformed_guc_safe_deny.sql')
ON CONFLICT (filename) DO NOTHING;
