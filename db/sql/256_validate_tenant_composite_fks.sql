-- PRC-M195 / PRC-M208 / PRC-L095 / PRC-M548 / PRC-L289: validate the
-- tenant-composite FKs added NOT VALID by db/sql/255.
--
-- W1-DATA-18: under FORCE ROW LEVEL SECURITY the tenant policy applies to the
-- table owner and a migration session has no app.tenant_id bound, so a plain
-- VALIDATE (or an owner SELECT) can see zero rows and prove nothing. This file
-- therefore, in ONE transaction (one DO block):
--   1. records relforcerowsecurity for every child and parent involved and
--      lifts FORCE on each (NO FORCE ROW LEVEL SECURITY);
--   2. counts orphans per constraint: child rows whose (tenant_id, <col>) has no
--      parent row with the same tenant_id and id (a cross-tenant or dangling
--      reference);
--   3. if ANY count is > 0, RAISEs with the constraint/count pairs. Fail-closed:
--      a cross-tenant reference is an isolation defect, and this migration never
--      deletes or rewrites tenant data. The RAISE aborts the transaction, so the
--      FORCE lift is rolled back with it;
--   4. VALIDATE CONSTRAINT for each;
--   5. restores FORCE ROW LEVEL SECURITY on every table that had it;
--   6. asserts zero unvalidated composite tenant FKs remain and FORCE is back.
--
-- Locks (PR rollout note): lifting FORCE takes ACCESS EXCLUSIVE on each lifted
-- table until COMMIT; VALIDATE scans each child. Run the step-2 query read-only
-- in staging first and schedule accordingly. Bounded by apply-sql.sh's
-- lock_timeout (a blocked lock fails the deploy instead of queuing traffic).
--
-- Idempotent: only NOT VALID constraints are targeted; a re-run finds none.
-- Rollback: none needed (validation only; nothing is created or changed).

DO $prc_m195_validate_tenant_composite_fks$
DECLARE
  parents CONSTANT text[] := ARRAY[
    'students', 'staff', 'institutions', 'fee_structures', 'parent_fee_invoices',
    'classes', 'grades', 'academic_periods', 'subjects', 'syllabus_units'
  ];
  children text[];
  parent_of text[];
  connames text[];
  cols text[];
  rel text;
  i int;
  orphan_count bigint;
  orphans text := '';
  lifted text[] := ARRAY[]::text[];
  remaining text;
BEGIN
  SELECT coalesce(array_agg(ch.relname::text ORDER BY ch.relname, k2.attname), ARRAY[]::text[]),
         coalesce(array_agg(p.relname::text ORDER BY ch.relname, k2.attname), ARRAY[]::text[]),
         coalesce(array_agg(c.conname::text ORDER BY ch.relname, k2.attname), ARRAY[]::text[]),
         coalesce(array_agg(k2.attname::text ORDER BY ch.relname, k2.attname), ARRAY[]::text[])
    INTO children, parent_of, connames, cols
    FROM pg_constraint c
    JOIN pg_class ch ON ch.oid = c.conrelid
    JOIN pg_namespace chn ON chn.oid = ch.relnamespace AND chn.nspname = 'public'
    JOIN pg_class p ON p.oid = c.confrelid
    JOIN pg_attribute k1 ON k1.attrelid = c.conrelid AND k1.attnum = c.conkey[1]
    JOIN pg_attribute k2 ON k2.attrelid = c.conrelid AND k2.attnum = c.conkey[2]
    JOIN pg_attribute f1 ON f1.attrelid = c.confrelid AND f1.attnum = c.confkey[1]
    JOIN pg_attribute f2 ON f2.attrelid = c.confrelid AND f2.attnum = c.confkey[2]
   WHERE c.contype = 'f'
     AND NOT c.convalidated
     AND c.conname LIKE '%\_tenant\_fk'
     AND array_length(c.conkey, 1) = 2
     AND p.relname = ANY (parents)
     AND k1.attname = 'tenant_id'
     AND f1.attname = 'tenant_id'
     AND f2.attname = 'id';

  -- 1) Lift FORCE on every involved table (children and parents), remembering
  --    which ones were forced so exactly those are restored.
  FOR rel IN
    SELECT DISTINCT x FROM unnest(children || parent_of) AS u(x) ORDER BY x
  LOOP
    IF (SELECT relforcerowsecurity FROM pg_class
         WHERE oid = format('public.%I', rel)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rel);
      lifted := lifted || rel;
    END IF;
  END LOOP;

  -- 2) Orphan preflight (owner scan with FORCE lifted sees every row).
  FOR i IN 1 .. coalesce(array_length(children, 1), 0) LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c '
      'WHERE c.tenant_id IS NOT NULL AND c.%I IS NOT NULL '
      'AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = c.%I AND p.tenant_id = c.tenant_id)',
      children[i], cols[i], parent_of[i], cols[i]
    ) INTO orphan_count;
    IF orphan_count > 0 THEN
      orphans := orphans || format('%s=%s; ', connames[i], orphan_count);
    END IF;
  END LOOP;

  -- 3) Fail closed on any cross-tenant / dangling reference.
  IF orphans <> '' THEN
    RAISE EXCEPTION
      'PRC-M195: cross-tenant or dangling references block tenant-composite FK validation: % '
      '(reconcile those rows, never delete tenant data blindly, then re-run)',
      orphans;
  END IF;

  -- 4) Validate.
  FOR i IN 1 .. coalesce(array_length(children, 1), 0) LOOP
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', children[i], connames[i]);
  END LOOP;

  -- 5) Restore FORCE on exactly the tables that had it.
  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
  END LOOP;

  -- 6) Assert: no unvalidated composite tenant FK into the parent set remains,
  --    and FORCE is back on every table this block lifted.
  SELECT string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ')
    INTO remaining
    FROM pg_constraint c
    JOIN pg_class p ON p.oid = c.confrelid
   WHERE c.contype = 'f'
     AND NOT c.convalidated
     AND c.conname LIKE '%\_tenant\_fk'
     AND array_length(c.conkey, 1) = 2
     AND p.relname = ANY (parents);
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M195: unvalidated tenant-composite FKs remain: %', remaining;
  END IF;
  SELECT string_agg(c.relname, ', ')
    INTO remaining
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname = ANY (lifted)
     AND NOT c.relforcerowsecurity;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-M195: FORCE ROW LEVEL SECURITY not restored on: %', remaining;
  END IF;
  RAISE NOTICE 'PRC-M195: % tenant-composite FK(s) validated; FORCE restored on % table(s)',
    coalesce(array_length(children, 1), 0), cardinality(lifted);
END
$prc_m195_validate_tenant_composite_fks$;
