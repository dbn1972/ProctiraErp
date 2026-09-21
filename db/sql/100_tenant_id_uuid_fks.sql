-- W1-DATA-06 residual: 23 tables carried tenant_id as text and therefore no
-- foreign key to tenants(id). A row could reference a tenant that never existed
-- or has since been deleted, and nothing in the database objected.
--
-- Why a cast inside the FK is not an option: Postgres refuses it outright.
--
--     ALTER TABLE health_allergies
--       ADD CONSTRAINT ... FOREIGN KEY (tenant_id) REFERENCES tenants (id);
--     ERROR: Key columns "tenant_id" and "id" are of incompatible types:
--            text and uuid.
--
-- There is no expression-based foreign key in Postgres, so the only route to real
-- referential integrity is migrating the column to uuid. That is what this does.
--
-- Scope: the full contents of tools/scripts/tenant-fk-text-column-allowlist.json,
-- which that file describes as debt to be cleared exactly this way ("migrate
-- tenant_id to uuid, add FOREIGN KEY ... VALIDATE it, then delete the line").
-- The allowlist is emptied in the same change, so W1-DATA-06 now enforces the
-- rule for every tenant-owned table instead of tolerating 23 exceptions.
--
--   phi-health-records (13)  counselling_sessions, health_accommodation_plans,
--                            health_allergies, health_conditions,
--                            health_diagnoses, health_insurance,
--                            health_measurements, health_phi_access_log,
--                            health_phi_break_glass, health_referrals,
--                            health_screening_programs,
--                            health_special_needs_assessments,
--                            health_vaccinations
--   audit-trail (4)          audit_chain_heads, audit_log_archive,
--                            audit_log_entries, audit_retention_configs
--   control-plane (1)        control_plane_documents
--   ui-projections (5)       insights_ui_import_jobs, insights_ui_runs,
--                            workflow_ui_approvals, workflow_ui_definitions,
--                            workflow_ui_instances
--
-- Verified before writing this, against the evaluation database:
--   * every non-null tenant_id is a canonical lowercase uuid string, so
--     tenant_id::uuid is lossless and the audit tables' stored hashes -- which
--     were computed over the text form -- keep matching, since uuid::text
--     reproduces that same canonical form
--   * no dependent views or materialized views (0)
--   * no incoming foreign keys to these tables (0), so no rewrite ordering problem
--   * none of the 23 are Prisma-mapped, so there is no prisma/sql drift to settle
--
-- ---------------------------------------------------------------------------
-- Policies: why the predicate gains ::text rather than losing it
-- ---------------------------------------------------------------------------
-- All 23 carry one PERMISSIVE policy named tenant_isolation, FOR ALL, role public,
-- with_check identical to qual. Changing the column type breaks every one of them:
-- `uuid = text` has no operator, so the policy would error rather than filter.
--
-- The obvious repair -- comparing `tenant_id = current_setting(...)::uuid` -- is
-- precisely the pattern 099 has just finished removing from 56 policies, because
-- `::uuid` on a malformed GUC raises `invalid input syntax for type uuid` instead
-- of denying. Reintroducing it here would undo that work on 23 more tables.
--
-- So these adopt the canonical form already used by staff, fee_*, parent_fee_* and
-- the rest of the uuid tenant tables:
--
--     tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
--
-- Comparing as text is deliberate: a missing GUC yields NULL and a malformed one
-- yields a non-match, and both deny instead of raising. It does forgo the uuid
-- index for this predicate, which is the same tradeoff every other uuid tenant
-- table in this schema already makes; diverging here would be a local
-- optimisation that breaks a schema-wide convention.
--
-- Each table keeps its own variant. The three are preserved exactly:
--   plain            16 tables
--   + platform_admin  5 tables (audit_* and control_plane_documents)
--   + legacy fallback 2 tables (insights_ui_*), which 099 explicitly marked as
--                     already-correct and not to be rewritten -- they are touched
--                     here only to add ::text, semantics unchanged
--
-- The `app.platform_admin = '1'` escape is carried over verbatim. It is a known P0
-- (docs/audits/SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md) being closed separately;
-- widening or narrowing it inside a type migration would hide that work.

-- ---------------------------------------------------------------------------
-- 1. Preflight: refuse to run against unreconciled data
-- ---------------------------------------------------------------------------
-- Adding a validated FK to a table holding orphan tenant_ids can only end two
-- ways: fail, or destroy data. This fails, early and specifically, naming every
-- offending table and count so an operator can reconcile before deploying. It
-- deletes nothing -- deciding the fate of rows belonging to a vanished tenant is
-- not a migration's call, least of all for audit_* tables.
--
-- The evaluation database hit this on 6 tables; all of it was residue from live
-- test runs using random tenant ids, cleaned outside this file.
--
-- The scan itself has to run with FORCE RLS lifted, on the table being checked and
-- on tenants. The first version of this block did not, and it passed a database
-- that VALIDATE then rejected two statements later: as the owner under FORCE RLS
-- with no app.tenant_id bound, `SELECT count(*) FROM audit_chain_heads` returned 0
-- while a superuser saw 36. A preflight that cannot see the rows it is judging is
-- worse than no preflight, because it reports all-clear. tenants is FORCE RLS too,
-- so the NOT EXISTS subquery was equally blind and would have called every row an
-- orphan had the outer table been visible.
--
-- Everything happens in this one transaction, so the lifts roll back on the RAISE
-- below, and no table is left unforced.
DO $tenant_uuid_preflight$
DECLARE
  t text;
  n bigint;
  was_forced boolean;
  tenants_forced boolean;
  offenders text[] := ARRAY[]::text[];
  tables text[] := ARRAY[
    'audit_chain_heads', 'audit_log_archive', 'audit_log_entries',
    'audit_retention_configs', 'control_plane_documents', 'counselling_sessions',
    'health_accommodation_plans', 'health_allergies', 'health_conditions',
    'health_diagnoses', 'health_insurance', 'health_measurements',
    'health_phi_access_log', 'health_phi_break_glass', 'health_referrals',
    'health_screening_programs', 'health_special_needs_assessments',
    'health_vaccinations', 'insights_ui_import_jobs', 'insights_ui_runs',
    'workflow_ui_approvals', 'workflow_ui_definitions', 'workflow_ui_instances'
  ];
BEGIN
  SELECT relforcerowsecurity INTO tenants_forced
    FROM pg_class WHERE oid = 'public.tenants'::regclass;
  IF tenants_forced THEN
    ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
  END IF;

  FOREACH t IN ARRAY tables LOOP
    SELECT relforcerowsecurity INTO was_forced
      FROM pg_class WHERE oid = format('public.%I', t)::regclass;
    IF was_forced THEN
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    END IF;

    -- Non-castable values would break the type change itself. Only meaningful
    -- while the column is still text.
    IF (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) <> 'uuid' THEN
      EXECUTE format(
        $q$SELECT count(*) FROM %I x
            WHERE x.tenant_id IS NOT NULL
              AND x.tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'$q$,
        t) INTO n;
      IF n > 0 THEN
        offenders := offenders || format('%s: %s tenant_id value(s) are not uuids', t, n);
      END IF;
    END IF;

    -- Orphans would break the VALIDATE. Compared as text on both sides so this
    -- holds whether or not the column has already been converted by a partial run.
    EXECUTE format(
      $q$SELECT count(*) FROM %I x
          WHERE x.tenant_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM tenants tn WHERE tn.id::text = x.tenant_id::text)$q$,
      t) INTO n;
    IF n > 0 THEN
      offenders := offenders || format('%s: %s row(s) reference a tenant that does not exist', t, n);
    END IF;

    IF was_forced THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;

  IF tenants_forced THEN
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
  END IF;

  IF array_length(offenders, 1) > 0 THEN
    RAISE EXCEPTION E'100_tenant_id_uuid_fks cannot proceed:\n  %\n\nReconcile these rows, then re-run. To list them:\n  SELECT * FROM <table> x WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id::text = x.tenant_id);',
      array_to_string(offenders, E'\n  ');
  END IF;
END
$tenant_uuid_preflight$;

-- ---------------------------------------------------------------------------
-- 2. Convert tenant_id to uuid, restore the policy, attach the FK
-- ---------------------------------------------------------------------------
-- Per table, in one transaction so a failure cannot leave a table with its
-- isolation policy dropped:
--   drop tenant_isolation  ->  ALTER COLUMN ... TYPE uuid  ->  recreate the
--   policy in its own variant  ->  attach the FK as NOT VALID
--
-- The FK is added NOT VALID here and validated in step 3, so the scan is not held
-- inside the same lock window as the rewrite.
--
-- ALTER COLUMN ... TYPE rewrites the table under ACCESS EXCLUSIVE. Unavoidable for
-- a type change, and the reason this file declares a maintenance window to
-- W1-DATA-17 rather than pretending to be online.
DO $tenant_uuid_convert$
DECLARE
  t text;
  predicate text;
  plain_tables text[] := ARRAY[
    'counselling_sessions', 'health_accommodation_plans', 'health_allergies',
    'health_conditions', 'health_diagnoses', 'health_insurance',
    'health_measurements', 'health_phi_access_log', 'health_phi_break_glass',
    'health_referrals', 'health_screening_programs',
    'health_special_needs_assessments', 'health_vaccinations',
    'workflow_ui_approvals', 'workflow_ui_definitions', 'workflow_ui_instances'
  ];
  platform_tables text[] := ARRAY[
    'audit_chain_heads', 'audit_log_archive', 'audit_log_entries',
    'audit_retention_configs', 'control_plane_documents'
  ];
  legacy_tables text[] := ARRAY['insights_ui_import_jobs', 'insights_ui_runs'];
  all_tables text[] := plain_tables || platform_tables || legacy_tables;

  canonical text := $p$tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')$p$;
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    CONTINUE WHEN (
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) = 'uuid';

    IF t = ANY (platform_tables) THEN
      predicate := format(
        $p$(%s) OR current_setting('app.platform_admin', true) = '1'$p$, canonical);
    ELSIF t = ANY (legacy_tables) THEN
      predicate := $p$tenant_id::text = COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), NULLIF(current_setting('app.current_tenant_id', true), ''))$p$;
    ELSE
      predicate := canonical;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id TYPE uuid USING tenant_id::uuid', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO public USING (%s) WITH CHECK (%s)',
      t, predicate, predicate);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass
        AND conname = format('%s_tenant_fk', t)
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants (id) NOT VALID',
        t, format('%s_tenant_fk', t));
    END IF;
  END LOOP;
END
$tenant_uuid_convert$;

-- ---------------------------------------------------------------------------
-- 3. Validate the 23 foreign keys with FORCE RLS briefly lifted
-- ---------------------------------------------------------------------------
-- Without this, all 23 would validate vacuously and be worthless.
--
-- These tables are FORCE ROW LEVEL SECURITY, which applies the tenant policy to
-- the table owner as well. Postgres runs the FK validation scan under that policy,
-- and a migration session has no app.tenant_id bound, so the policy denies, the
-- scan sees zero rows, and VALIDATE reports success without comparing anything --
-- leaving convalidated = true over data it never read. That was demonstrated while
-- fixing 098: one planted orphan row, VALIDATE returned success.
--
-- So the scan runs with FORCE lifted and restored in the same transaction. A
-- failure rolls the lift back with it, so no table can be left unforced, and FORCE
-- is only restored where it was actually set.
--
-- FORCE must come off tenants as well, not just the child table. An FK validation
-- scan reads the parent to confirm each key exists, and tenants is itself FORCE
-- RLS, so with only the child lifted the parent side returns nothing and every row
-- looks like an orphan. That is not hypothetical: an earlier version of this file
-- lifted only the child and VALIDATE failed on audit_chain_heads claiming a tenant
-- was absent, while the preflight -- which does lift both -- reported that table
-- clean. A spurious failure here is less dangerous than a spurious success, but it
-- is still wrong.
DO $tenant_uuid_validate$
DECLARE
  t text;
  was_forced boolean;
  tenants_forced boolean;
  tables text[] := ARRAY[
    'audit_chain_heads', 'audit_log_archive', 'audit_log_entries',
    'audit_retention_configs', 'control_plane_documents', 'counselling_sessions',
    'health_accommodation_plans', 'health_allergies', 'health_conditions',
    'health_diagnoses', 'health_insurance', 'health_measurements',
    'health_phi_access_log', 'health_phi_break_glass', 'health_referrals',
    'health_screening_programs', 'health_special_needs_assessments',
    'health_vaccinations', 'insights_ui_import_jobs', 'insights_ui_runs',
    'workflow_ui_approvals', 'workflow_ui_definitions', 'workflow_ui_instances'
  ];
BEGIN
  SELECT relforcerowsecurity INTO tenants_forced
    FROM pg_class WHERE oid = 'public.tenants'::regclass;
  IF tenants_forced THEN
    ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
  END IF;

  FOREACH t IN ARRAY tables LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass
        AND conname = format('%s_tenant_fk', t)
        AND NOT convalidated
    );

    SELECT relforcerowsecurity INTO was_forced
      FROM pg_class WHERE oid = format('public.%I', t)::regclass;

    IF was_forced THEN
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    END IF;

    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t, format('%s_tenant_fk', t));

    IF was_forced THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;

  IF tenants_forced THEN
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
  END IF;
END
$tenant_uuid_validate$;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than assuming it
-- ---------------------------------------------------------------------------
DO $tenant_uuid_assert$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(detail, E'\n  ') INTO bad FROM (
    SELECT format('%s: tenant_id is still %s', c.table_name, c.data_type) AS detail
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
       AND c.data_type <> 'uuid'
    UNION ALL
    SELECT format('%s: tenant FK missing or NOT VALID', t.relname)
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
      JOIN information_schema.columns c
        ON c.table_name = t.relname AND c.table_schema = 'public'
       AND c.column_name = 'tenant_id' AND c.data_type = 'uuid'
     WHERE t.relkind = 'r'
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint k
          WHERE k.conrelid = t.oid AND k.contype = 'f' AND k.convalidated
            AND k.confrelid = 'public.tenants'::regclass
            AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                   FROM pg_attribute a
                  WHERE a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey))
                = ARRAY['tenant_id']::text[]
       )
       AND t.relname <> 'tenants'
    UNION ALL
    -- A dropped policy would mean an unisolated table, which is worse than the
    -- integrity gap this file set out to close.
    SELECT format('%s: tenant_isolation policy is missing', x.t)
      FROM unnest(ARRAY[
        'audit_chain_heads', 'audit_log_archive', 'audit_log_entries',
        'audit_retention_configs', 'control_plane_documents', 'counselling_sessions',
        'health_accommodation_plans', 'health_allergies', 'health_conditions',
        'health_diagnoses', 'health_insurance', 'health_measurements',
        'health_phi_access_log', 'health_phi_break_glass', 'health_referrals',
        'health_screening_programs', 'health_special_needs_assessments',
        'health_vaccinations', 'insights_ui_import_jobs', 'insights_ui_runs',
        'workflow_ui_approvals', 'workflow_ui_definitions', 'workflow_ui_instances'
      ]) AS x(t)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = x.t
          AND p.policyname = 'tenant_isolation'
     )
  ) s;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'100_tenant_id_uuid_fks did not reach the intended state:\n  %', bad;
  END IF;
END
$tenant_uuid_assert$;
