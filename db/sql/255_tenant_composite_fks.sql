-- PRC-M195 / PRC-M208 / PRC-L095 / PRC-M548 / PRC-L289: tenant-composite
-- foreign keys for every id-only FK into the core SIS / staff / fee parents.
--
-- Problem: cross-entity FKs into students, staff, institutions, fee_structures,
-- parent_fee_invoices, classes, grades, academic_periods, subjects and
-- syllabus_units are single-column (`<col> REFERENCES <parent>(id)`). The RI
-- check runs as the table owner without RLS, so a tenant-A child row can point
-- at a tenant-B parent id and the database accepts it (cross-tenant reference).
--
-- Fix: for each such FK add a twin
--   <child>_<col>_tenant_fk FOREIGN KEY (tenant_id, <col>)
--     REFERENCES <parent> (tenant_id, id) NOT VALID
-- backed by the db/sql/254 parent (tenant_id, id) unique indexes. NOT VALID
-- means new INSERT/UPDATE rows are checked immediately; existing rows are
-- validated by db/sql/256 with FORCE ROW LEVEL SECURITY lifted and restored in
-- the same transaction, after a fail-closed orphan preflight.
--
-- Semantics are mirrored from the original FK so no delete/update behaviour
-- changes: ON DELETE c -> CASCADE, r -> RESTRICT, a -> NO ACTION,
-- n -> SET NULL (<col>) (column list, PostgreSQL 15+, so tenant_id is never
-- nulled), d (SET DEFAULT) -> skipped with a NOTICE. ON UPDATE c/r/a mirrored;
-- n/d -> skipped with a NOTICE. Deferrability is mirrored. The original
-- single-column FKs are KEPT (nothing is dropped).
--
-- Explicit new edges (these columns had no FK at all):
--   syllabus_units (tenant_id, subject_id)         -> subjects         (PRC-L289)
--   syllabus_units (tenant_id, academic_period_id) -> academic_periods (PRC-L289)
--   learning_outcomes (tenant_id, subject_id)      -> subjects         (PRC-L289)
-- NO ACTION; subjects and academic_periods are soft-deleted only (no hard
-- DELETE path in packages/ or apps/), so delete behaviour is unchanged.
-- enrollments.class_id already has an id-only FK (db/sql/029), so its composite
-- twin comes from the sweep (PRC-M548).
--
-- Exclusions (Set B schema lane / parent-portal lane tables, deferred to a
-- later wave that reruns this generator with an empty list): every skipped
-- edge is printed as a NOTICE so the apply log is the residual list.
--
-- Locks: ADD FOREIGN KEY ... NOT VALID takes SHARE ROW EXCLUSIVE on child and
-- parent for the catalog change only (no scan), bounded by apply-sql.sh's
-- lock_timeout. Transactional file (per-file --single-transaction).
--
-- Idempotent: a twin whose name already exists, or an equivalent composite FK,
-- is skipped. Ledgered by apply-sql.sh as usual.
--
-- Rollback (forward-only repo; body of a future revert migration). Drops only
-- what this file created: two-column FKs named %_tenant_fk whose first key
-- column is tenant_id and whose parent is one of the ten parents above.
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT c.conrelid::regclass AS t, c.conname FROM pg_constraint c
--       WHERE c.contype = 'f' AND c.conname LIKE '%\_tenant\_fk'
--         AND array_length(c.conkey, 1) = 2
--         AND c.confrelid::regclass::text IN ('students','staff','institutions',
--           'fee_structures','parent_fee_invoices','classes','grades',
--           'academic_periods','subjects','syllabus_units')
--     LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.t, r.conname);
--     END LOOP; END $$;
-- Data loss on rollback: none (constraints only).

DO $prc_m195_tenant_composite_fks$
DECLARE
  parents CONSTANT text[] := ARRAY[
    'students', 'staff', 'institutions', 'fee_structures', 'parent_fee_invoices',
    'classes', 'grades', 'academic_periods', 'subjects', 'syllabus_units'
  ];
  excluded CONSTANT text[] := ARRAY[
    'admission_enquiries', 'admission_applications', 'control_plane_documents',
    'transport_driver_assignments', 'transport_student_assignments', 'transport_vehicles',
    'transport_routes', 'transport_stops', 'transport_gps_pings', 'transport_bus_attendance',
    'transport_vehicle_devices', 'exam_sessions', 'library_items', 'library_loans',
    'library_fines', 'report_card_jobs', 'section_meetings', 'bell_periods',
    'grading_schemes', 'grading_scale_bands', 'notifications', 'workflow_ui_approvals',
    'parent_consents'
  ];
  r record;
  fk_name text;
  base_name text;
  del_clause text;
  upd_clause text;
  defer_clause text;
  created_count int := 0;
  skipped_count int := 0;
BEGIN
  FOR r IN
    WITH candidate AS (
      -- Existing single-column FKs into a parent's id.
      SELECT ch.relname::text AS child,
             a.attname::text AS col,
             p.relname::text AS parent,
             c.confdeltype AS del_type,
             c.confupdtype AS upd_type,
             c.condeferrable AS deferrable,
             c.condeferred AS deferred,
             ch.relkind AS child_kind,
             'sweep'::text AS origin
        FROM pg_constraint c
        JOIN pg_class ch ON ch.oid = c.conrelid
        JOIN pg_namespace chn ON chn.oid = ch.relnamespace AND chn.nspname = 'public'
        JOIN pg_class p ON p.oid = c.confrelid
        JOIN pg_namespace pn ON pn.oid = p.relnamespace AND pn.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
       WHERE c.contype = 'f'
         AND c.conparentid = 0
         AND array_length(c.conkey, 1) = 1
         AND p.relname = ANY (parents)
         AND pa.attname = 'id'
      UNION
      -- Explicit new edges (no FK existed; PRC-L289).
      SELECT e.child, e.col, e.parent, 'a'::"char", 'a'::"char", false, false, ch.relkind,
             'explicit'::text
        FROM (VALUES
               ('syllabus_units', 'subject_id', 'subjects'),
               ('syllabus_units', 'academic_period_id', 'academic_periods'),
               ('learning_outcomes', 'subject_id', 'subjects')
             ) AS e(child, col, parent)
        JOIN pg_class ch ON ch.relname = e.child AND ch.relnamespace = 'public'::regnamespace
        JOIN pg_attribute a ON a.attrelid = ch.oid AND a.attname = e.col AND NOT a.attisdropped
    )
    SELECT cand.*,
           (SELECT format_type(t.atttypid, t.atttypmod)
              FROM pg_attribute t
             WHERE t.attrelid = format('public.%I', cand.child)::regclass
               AND t.attname = 'tenant_id' AND NOT t.attisdropped) AS child_tenant_type,
           (SELECT format_type(t.atttypid, t.atttypmod)
              FROM pg_attribute t
             WHERE t.attrelid = format('public.%I', cand.parent)::regclass
               AND t.attname = 'tenant_id' AND NOT t.attisdropped) AS parent_tenant_type
      FROM candidate cand
     ORDER BY cand.child, cand.col, cand.parent
  LOOP
    IF r.child = ANY (excluded) THEN
      RAISE NOTICE 'PRC-M195 skip %.% -> % (excluded: other lane owns the child table)',
        r.child, r.col, r.parent;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    IF r.child_kind <> 'r' THEN
      RAISE NOTICE 'PRC-M195 skip %.% -> % (relkind %, not a plain table)',
        r.child, r.col, r.parent, r.child_kind;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    IF r.col = 'tenant_id' THEN
      CONTINUE;
    END IF;
    IF r.child_tenant_type IS NULL OR r.parent_tenant_type IS NULL
       OR r.child_tenant_type <> r.parent_tenant_type THEN
      RAISE NOTICE 'PRC-M195 skip %.% -> % (tenant_id type mismatch: child %, parent %)',
        r.child, r.col, r.parent, coalesce(r.child_tenant_type, 'none'),
        coalesce(r.parent_tenant_type, 'none');
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    -- Equivalent composite FK already present (any name)?
    IF EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute k1 ON k1.attrelid = c.conrelid AND k1.attnum = c.conkey[1]
        JOIN pg_attribute k2 ON k2.attrelid = c.conrelid AND k2.attnum = c.conkey[2]
        JOIN pg_attribute f1 ON f1.attrelid = c.confrelid AND f1.attnum = c.confkey[1]
        JOIN pg_attribute f2 ON f2.attrelid = c.confrelid AND f2.attnum = c.confkey[2]
       WHERE c.contype = 'f'
         AND c.conrelid = format('public.%I', r.child)::regclass
         AND c.confrelid = format('public.%I', r.parent)::regclass
         AND array_length(c.conkey, 1) = 2
         AND k1.attname = 'tenant_id' AND k2.attname = r.col
         AND f1.attname = 'tenant_id' AND f2.attname = 'id'
    ) THEN
      CONTINUE;
    END IF;

    base_name := r.child || '_' || r.col;
    IF length(base_name || '_tenant_fk') > 63 THEN
      fk_name := left(base_name, 63 - length('_tenant_fk') - 9) || '_'
        || left(md5(r.child || '.' || r.col || '.' || r.parent), 8) || '_tenant_fk';
    ELSE
      fk_name := base_name || '_tenant_fk';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = format('public.%I', r.child)::regclass AND c.conname = fk_name
    ) THEN
      RAISE NOTICE 'PRC-M195 skip %.% -> % (constraint name % already taken)',
        r.child, r.col, r.parent, fk_name;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    del_clause := CASE r.del_type
      WHEN 'c' THEN ' ON DELETE CASCADE'
      WHEN 'r' THEN ' ON DELETE RESTRICT'
      WHEN 'a' THEN ''
      WHEN 'n' THEN CASE WHEN current_setting('server_version_num')::int >= 150000
                         THEN format(' ON DELETE SET NULL (%I)', r.col) END
      ELSE NULL
    END;
    IF del_clause IS NULL THEN
      RAISE NOTICE 'PRC-M195 skip %.% -> % (ON DELETE % cannot be mirrored on a composite FK here)',
        r.child, r.col, r.parent, r.del_type;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    upd_clause := CASE r.upd_type
      WHEN 'c' THEN ' ON UPDATE CASCADE'
      WHEN 'r' THEN ' ON UPDATE RESTRICT'
      WHEN 'a' THEN ''
      ELSE NULL
    END;
    IF upd_clause IS NULL THEN
      RAISE NOTICE 'PRC-M195 skip %.% -> % (ON UPDATE % cannot be mirrored on a composite FK)',
        r.child, r.col, r.parent, r.upd_type;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;
    defer_clause := CASE
      WHEN r.deferrable AND r.deferred THEN ' DEFERRABLE INITIALLY DEFERRED'
      WHEN r.deferrable THEN ' DEFERRABLE INITIALLY IMMEDIATE'
      ELSE ''
    END;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) '
      'REFERENCES public.%I (tenant_id, id)%s%s%s NOT VALID',
      r.child, fk_name, r.col, r.parent, del_clause, upd_clause, defer_clause
    );
    created_count := created_count + 1;
  END LOOP;

  RAISE NOTICE 'PRC-M195 tenant-composite FKs: % created, % skipped (see NOTICEs above)',
    created_count, skipped_count;
END
$prc_m195_tenant_composite_fks$;
