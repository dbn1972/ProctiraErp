-- H-D3: tenant-composite foreign keys for every hostel child -> hostel parent
-- reference, validated with FORCE ROW LEVEL SECURITY lifted, after a
-- fail-closed preflight for existing cross-tenant rows.
--
-- Problem: the twelve hostel parent FKs below are id-only (`<col> REFERENCES
-- <parent>(id)`, db/sql/008 and 040). The RI check runs as the table owner and
-- ignores RLS, so a tenant-A row could reference a tenant-B hostel, block,
-- room, bed or mess plan (live probe: POST /hostel/blocks, /visitors, /leaves
-- with B's hostelId, /rooms with B's blockId, /beds with B's roomId -> 201).
-- The RI cascade also runs as the owner, so deleting tenant B's hostel would
-- CASCADE into tenant A's blocks, rooms, beds and mess plans.
--
-- Fix: for each edge add
--   <child>_<col>_tenant_fk FOREIGN KEY (tenant_id, <col>)
--     REFERENCES <parent> (tenant_id, id) NOT VALID
-- backed by the db/sql/303 parent (tenant_id, id) unique indexes, then
-- VALIDATE it in the same transaction. ON DELETE / ON UPDATE / deferrability
-- are mirrored from the existing id-only FK read from the catalog (as in
-- db/sql/255), so delete behaviour does not change within a tenant. The
-- id-only FKs are KEPT: once the composite twin is validated every child row's
-- (tenant_id, <col>) equals its parent's (tenant_id, id), so the id-only FK's
-- CASCADE can only reach rows of the parent's own tenant.
--
--   child                  column     parent         ON DELETE (mirrored)
--   hostel_blocks          hostel_id  hostels        CASCADE
--   hostel_rooms           block_id   hostel_blocks  CASCADE
--   hostel_beds            room_id    hostel_rooms   CASCADE
--   hostel_assignments     bed_id     hostel_beds    NO ACTION
--   hostel_leaves          hostel_id  hostels        NO ACTION
--   hostel_visitors        hostel_id  hostels        NO ACTION
--   mess_plans             hostel_id  hostels        CASCADE
--   mess_menu_items        plan_id    mess_plans     CASCADE
--   mess_subscriptions     plan_id    mess_plans     CASCADE
--   gate_passes            hostel_id  hostels        NO ACTION
--   hostel_fee_structures  hostel_id  hostels        CASCADE
--   hostel_attendance      block_id   hostel_blocks  CASCADE
-- (student_id edges already have <child>_student_id_tenant_fk from db/sql/255.)
--
-- One transaction (apply-sql.sh per-file --single-transaction), one DO block:
--   0. guards: lock_timeout and statement_timeout must be non-zero (apply-sql.sh
--      sets both via migration-timeouts.sh; a bare psql session with no
--      timeouts is refused), and the 303 indexes must be present and valid;
--   1. lift FORCE ROW LEVEL SECURITY on the 13 hostel tables, children first
--      (under FORCE the owner session has no app.tenant_id and would see zero
--      rows, so neither the preflight nor VALIDATE would read anything);
--   2. preflight: per edge, count child rows whose parent is missing or has a
--      different tenant_id;
--   3. if any count is > 0, RAISE with the constraint/count pairs. Fail-closed:
--      nothing is deleted or re-parented, and the RAISE rolls back the whole
--      transaction including the FORCE lift;
--   4. add the missing composite FKs NOT VALID;
--   5. VALIDATE every unvalidated two-column FK between hostel tables;
--   6. restore FORCE ROW LEVEL SECURITY on every table that had it;
--   7. assert all twelve composite FKs exist and are validated, and FORCE is back.
--
-- Locks (rollout note): NO FORCE ROW LEVEL SECURITY takes ACCESS EXCLUSIVE on
-- each of the 13 hostel tables until COMMIT (acquired children first, parents
-- last); VALIDATE scans the twelve child tables. Hostel reads and writes wait
-- for the duration of the file. Every lock wait is bounded by apply-sql.sh's
-- lock_timeout (default 5s): a blocked lock fails the deploy instead of queuing
-- traffic. A deadlock with a concurrent hostel write aborts the file with no
-- change; re-run apply-sql.sh. Schedule a quiet window for large hostel tables
-- and run the step-2 detection query in staging first.
--
-- Idempotent: an equivalent composite FK (any name) is not re-added, VALIDATE
-- only targets unvalidated constraints, the preflight is read-only. A re-run
-- after success changes nothing. Ledgered by apply-sql.sh as usual.
--
-- Existing data / operator remediation when step 3 fails
-- ("H-D3: cross-tenant or dangling parent references block hostel
-- tenant-composite FKs: <constraint>=<n> cross-tenant/<m> dangling; ..."):
--   (1) List the rows (read-only). As the table owner in a quiet window:
--         BEGIN;
--         -- lift FORCE on all 13 hostel tables inside this transaction
--         -- (ALTER TABLE <table> NO FORCE ROW LEVEL SECURITY, one per table),
--         -- or use a BYPASSRLS read-only ops role instead
--         SELECT * FROM (
--           SELECT 'hostel_blocks.hostel_id' AS edge, c.id, c.tenant_id, c.hostel_id AS parent_id, p.tenant_id AS parent_tenant FROM hostel_blocks c LEFT JOIN hostels p ON p.id = c.hostel_id
--           UNION ALL SELECT 'hostel_rooms.block_id', c.id, c.tenant_id, c.block_id, p.tenant_id FROM hostel_rooms c LEFT JOIN hostel_blocks p ON p.id = c.block_id
--           UNION ALL SELECT 'hostel_beds.room_id', c.id, c.tenant_id, c.room_id, p.tenant_id FROM hostel_beds c LEFT JOIN hostel_rooms p ON p.id = c.room_id
--           UNION ALL SELECT 'hostel_assignments.bed_id', c.id, c.tenant_id, c.bed_id, p.tenant_id FROM hostel_assignments c LEFT JOIN hostel_beds p ON p.id = c.bed_id
--           UNION ALL SELECT 'hostel_leaves.hostel_id', c.id, c.tenant_id, c.hostel_id, p.tenant_id FROM hostel_leaves c LEFT JOIN hostels p ON p.id = c.hostel_id
--           UNION ALL SELECT 'hostel_visitors.hostel_id', c.id, c.tenant_id, c.hostel_id, p.tenant_id FROM hostel_visitors c LEFT JOIN hostels p ON p.id = c.hostel_id
--           UNION ALL SELECT 'mess_plans.hostel_id', c.id, c.tenant_id, c.hostel_id, p.tenant_id FROM mess_plans c LEFT JOIN hostels p ON p.id = c.hostel_id
--           UNION ALL SELECT 'mess_menu_items.plan_id', c.id, c.tenant_id, c.plan_id, p.tenant_id FROM mess_menu_items c LEFT JOIN mess_plans p ON p.id = c.plan_id
--           UNION ALL SELECT 'mess_subscriptions.plan_id', c.id, c.tenant_id, c.plan_id, p.tenant_id FROM mess_subscriptions c LEFT JOIN mess_plans p ON p.id = c.plan_id
--           UNION ALL SELECT 'gate_passes.hostel_id', c.id, c.tenant_id, c.hostel_id, p.tenant_id FROM gate_passes c LEFT JOIN hostels p ON p.id = c.hostel_id
--           UNION ALL SELECT 'hostel_fee_structures.hostel_id', c.id, c.tenant_id, c.hostel_id, p.tenant_id FROM hostel_fee_structures c LEFT JOIN hostels p ON p.id = c.hostel_id
--           UNION ALL SELECT 'hostel_attendance.block_id', c.id, c.tenant_id, c.block_id, p.tenant_id FROM hostel_attendance c LEFT JOIN hostel_blocks p ON p.id = c.block_id
--         ) x WHERE parent_tenant IS DISTINCT FROM tenant_id;
--         ROLLBACK;
--   (2) Each listed row belongs to the tenant that wrote it (x.tenant_id). With
--       that tenant's sign-off, either re-point it to the correct parent in its
--       own tenant
--         UPDATE <child> SET <col> = '<own parent id>'
--          WHERE id = '<child id>' AND tenant_id = '<child tenant>';
--       or export it and delete the child together with its same-tenant
--       descendants (a block's rooms, beds, assignments and attendance).
--   (3) Never modify the parent tenant's rows. Record every action in the
--       incident ticket.
--   (4) Re-run tools/scripts/apply-sql.sh: 303 is already ledgered and is
--       skipped, 304 retries.
--
-- Rollback (forward-only repo; body of a future revert migration). Drops only
-- what this file created:
--   ALTER TABLE hostel_blocks DROP CONSTRAINT IF EXISTS hostel_blocks_hostel_id_tenant_fk;
--   ALTER TABLE hostel_rooms DROP CONSTRAINT IF EXISTS hostel_rooms_block_id_tenant_fk;
--   ALTER TABLE hostel_beds DROP CONSTRAINT IF EXISTS hostel_beds_room_id_tenant_fk;
--   ALTER TABLE hostel_assignments DROP CONSTRAINT IF EXISTS hostel_assignments_bed_id_tenant_fk;
--   ALTER TABLE hostel_leaves DROP CONSTRAINT IF EXISTS hostel_leaves_hostel_id_tenant_fk;
--   ALTER TABLE hostel_visitors DROP CONSTRAINT IF EXISTS hostel_visitors_hostel_id_tenant_fk;
--   ALTER TABLE mess_plans DROP CONSTRAINT IF EXISTS mess_plans_hostel_id_tenant_fk;
--   ALTER TABLE mess_menu_items DROP CONSTRAINT IF EXISTS mess_menu_items_plan_id_tenant_fk;
--   ALTER TABLE mess_subscriptions DROP CONSTRAINT IF EXISTS mess_subscriptions_plan_id_tenant_fk;
--   ALTER TABLE gate_passes DROP CONSTRAINT IF EXISTS gate_passes_hostel_id_tenant_fk;
--   ALTER TABLE hostel_fee_structures DROP CONSTRAINT IF EXISTS hostel_fee_structures_hostel_id_tenant_fk;
--   ALTER TABLE hostel_attendance DROP CONSTRAINT IF EXISTS hostel_attendance_block_id_tenant_fk;
-- Data loss on rollback: none (constraints only). Dropping them re-opens H-D3
-- at the database layer; the service-layer tenant checks stay in place.
DO $h_d3_hostel_tenant_parent_fks$
DECLARE
  -- child, column, parent, constraint name
  edges CONSTANT text[] := ARRAY[
    ['hostel_assignments', 'bed_id', 'hostel_beds', 'hostel_assignments_bed_id_tenant_fk'],
    ['hostel_attendance', 'block_id', 'hostel_blocks', 'hostel_attendance_block_id_tenant_fk'],
    ['gate_passes', 'hostel_id', 'hostels', 'gate_passes_hostel_id_tenant_fk'],
    ['hostel_leaves', 'hostel_id', 'hostels', 'hostel_leaves_hostel_id_tenant_fk'],
    ['hostel_visitors', 'hostel_id', 'hostels', 'hostel_visitors_hostel_id_tenant_fk'],
    ['hostel_fee_structures', 'hostel_id', 'hostels', 'hostel_fee_structures_hostel_id_tenant_fk'],
    ['mess_menu_items', 'plan_id', 'mess_plans', 'mess_menu_items_plan_id_tenant_fk'],
    ['mess_subscriptions', 'plan_id', 'mess_plans', 'mess_subscriptions_plan_id_tenant_fk'],
    ['hostel_beds', 'room_id', 'hostel_rooms', 'hostel_beds_room_id_tenant_fk'],
    ['hostel_rooms', 'block_id', 'hostel_blocks', 'hostel_rooms_block_id_tenant_fk'],
    ['mess_plans', 'hostel_id', 'hostels', 'mess_plans_hostel_id_tenant_fk'],
    ['hostel_blocks', 'hostel_id', 'hostels', 'hostel_blocks_hostel_id_tenant_fk']
  ];
  -- Children before parents, so the lock order matches the RI direction.
  lock_order CONSTANT text[] := ARRAY[
    'hostel_assignments', 'hostel_attendance', 'gate_passes', 'hostel_leaves',
    'hostel_visitors', 'hostel_fee_structures', 'mess_menu_items', 'mess_subscriptions',
    'hostel_beds', 'hostel_rooms', 'mess_plans', 'hostel_blocks', 'hostels'
  ];
  parents CONSTANT text[] := ARRAY[
    'hostels', 'hostel_blocks', 'hostel_rooms', 'hostel_beds', 'mess_plans'
  ];
  e text[];
  rel text;
  lifted text[] := ARRAY[]::text[];
  n_cross bigint;
  n_dangling bigint;
  orphans text := '';
  fk record;
  del_clause text;
  upd_clause text;
  defer_clause text;
  remaining text;
  created_count int := 0;
  validated_count int := 0;
BEGIN
  -- 0. guards
  IF current_setting('lock_timeout') IN ('0', '0ms')
     OR current_setting('statement_timeout') IN ('0', '0ms') THEN
    RAISE EXCEPTION 'H-D3: lock_timeout and statement_timeout must be non-zero (lock_timeout=%, statement_timeout=%); apply through tools/scripts/apply-sql.sh',
      current_setting('lock_timeout'), current_setting('statement_timeout');
  END IF;
  FOREACH rel IN ARRAY parents LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE ic.relnamespace = 'public'::regnamespace
         AND ic.relname = rel || '_tenant_id_id_uidx'
         AND i.indrelid = format('public.%I', rel)::regclass
         AND i.indisvalid
         AND i.indisunique
         AND i.indnkeyatts = 2
    ) THEN
      RAISE EXCEPTION 'H-D3: %_tenant_id_id_uidx missing or not valid/unique (apply db/sql/303 first)', rel;
    END IF;
  END LOOP;

  -- 1. lift FORCE (children first)
  FOREACH rel IN ARRAY lock_order LOOP
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = format('public.%I', rel)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rel);
      lifted := lifted || rel;
    END IF;
  END LOOP;

  -- 2. preflight (read-only)
  FOREACH e SLICE 1 IN ARRAY edges LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE p.id IS NOT NULL), count(*) FILTER (WHERE p.id IS NULL)
         FROM public.%I c
         LEFT JOIN public.%I p ON p.id = c.%I
        WHERE c.%I IS NOT NULL
          AND (p.id IS NULL OR p.tenant_id IS DISTINCT FROM c.tenant_id)',
      e[1], e[3], e[2], e[2]
    ) INTO n_cross, n_dangling;
    IF n_cross > 0 OR n_dangling > 0 THEN
      orphans := orphans || format('%s=%s cross-tenant/%s dangling; ', e[4], n_cross, n_dangling);
    END IF;
  END LOOP;

  -- 3. fail closed
  IF orphans <> '' THEN
    RAISE EXCEPTION 'H-D3: cross-tenant or dangling parent references block hostel tenant-composite FKs: %', orphans
      USING HINT = 'Nothing was changed. Follow the operator remediation in the db/sql/304 header, then re-run tools/scripts/apply-sql.sh.';
  END IF;

  -- 4. add missing composite FKs NOT VALID (mirroring the id-only FK)
  FOREACH e SLICE 1 IN ARRAY edges LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute k1 ON k1.attrelid = c.conrelid AND k1.attnum = c.conkey[1]
        JOIN pg_attribute k2 ON k2.attrelid = c.conrelid AND k2.attnum = c.conkey[2]
        JOIN pg_attribute f1 ON f1.attrelid = c.confrelid AND f1.attnum = c.confkey[1]
        JOIN pg_attribute f2 ON f2.attrelid = c.confrelid AND f2.attnum = c.confkey[2]
       WHERE c.contype = 'f'
         AND c.conrelid = format('public.%I', e[1])::regclass
         AND c.confrelid = format('public.%I', e[3])::regclass
         AND array_length(c.conkey, 1) = 2
         AND k1.attname = 'tenant_id' AND k2.attname = e[2]
         AND f1.attname = 'tenant_id' AND f2.attname = 'id'
    ) THEN
      CONTINUE;
    END IF;
    SELECT c.confdeltype, c.confupdtype, c.condeferrable, c.condeferred
      INTO fk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
     WHERE c.contype = 'f'
       AND c.conrelid = format('public.%I', e[1])::regclass
       AND c.confrelid = format('public.%I', e[3])::regclass
       AND array_length(c.conkey, 1) = 1
       AND a.attname = e[2]
       AND pa.attname = 'id'
     ORDER BY c.conname
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'H-D3: id-only FK %.% -> %(id) not found (schema drift)', e[1], e[2], e[3];
    END IF;
    del_clause := CASE fk.confdeltype
      WHEN 'c' THEN ' ON DELETE CASCADE'
      WHEN 'r' THEN ' ON DELETE RESTRICT'
      WHEN 'a' THEN ''
    END;
    upd_clause := CASE fk.confupdtype
      WHEN 'c' THEN ' ON UPDATE CASCADE'
      WHEN 'r' THEN ' ON UPDATE RESTRICT'
      WHEN 'a' THEN ''
    END;
    IF del_clause IS NULL OR upd_clause IS NULL THEN
      RAISE EXCEPTION 'H-D3: %.% -> % has ON DELETE % / ON UPDATE %, which this file does not mirror',
        e[1], e[2], e[3], fk.confdeltype, fk.confupdtype;
    END IF;
    defer_clause := CASE
      WHEN fk.condeferrable AND fk.condeferred THEN ' DEFERRABLE INITIALLY DEFERRED'
      WHEN fk.condeferrable THEN ' DEFERRABLE INITIALLY IMMEDIATE'
      ELSE ''
    END;
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = format('public.%I', e[1])::regclass AND c.conname = e[4]
    ) THEN
      RAISE EXCEPTION 'H-D3: constraint name % on % is taken by a non-equivalent constraint', e[4], e[1];
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) '
      'REFERENCES public.%I (tenant_id, id)%s%s%s NOT VALID',
      e[1], e[4], e[2], e[3], del_clause, upd_clause, defer_clause
    );
    created_count := created_count + 1;
  END LOOP;

  -- 5. validate (FORCE is lifted, so the scan reads every row)
  FOR fk IN
    SELECT ch.relname::text AS child, c.conname::text AS conname
      FROM pg_constraint c
      JOIN pg_class ch ON ch.oid = c.conrelid
      JOIN pg_class p ON p.oid = c.confrelid
     WHERE c.contype = 'f'
       AND NOT c.convalidated
       AND array_length(c.conkey, 1) = 2
       AND ch.relnamespace = 'public'::regnamespace
       AND p.relnamespace = 'public'::regnamespace
       AND ch.relname = ANY (lock_order)
       AND p.relname = ANY (lock_order)
     ORDER BY 1, 2
  LOOP
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', fk.child, fk.conname);
    validated_count := validated_count + 1;
  END LOOP;

  -- 6. restore FORCE
  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
  END LOOP;

  -- 7. assert
  remaining := NULL;
  FOREACH e SLICE 1 IN ARRAY edges LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
        JOIN pg_attribute k1 ON k1.attrelid = c.conrelid AND k1.attnum = c.conkey[1]
        JOIN pg_attribute k2 ON k2.attrelid = c.conrelid AND k2.attnum = c.conkey[2]
        JOIN pg_attribute f1 ON f1.attrelid = c.confrelid AND f1.attnum = c.confkey[1]
        JOIN pg_attribute f2 ON f2.attrelid = c.confrelid AND f2.attnum = c.confkey[2]
       WHERE c.contype = 'f'
         AND c.convalidated
         AND c.conrelid = format('public.%I', e[1])::regclass
         AND c.confrelid = format('public.%I', e[3])::regclass
         AND array_length(c.conkey, 1) = 2
         AND k1.attname = 'tenant_id' AND k2.attname = e[2]
         AND f1.attname = 'tenant_id' AND f2.attname = 'id'
    ) THEN
      remaining := concat_ws(', ', remaining, e[4]);
    END IF;
  END LOOP;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'H-D3: composite FKs missing or still NOT VALID: %', remaining;
  END IF;
  SELECT string_agg(relname, ', ') INTO remaining
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname = ANY (lifted)
     AND NOT relforcerowsecurity;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'H-D3: FORCE ROW LEVEL SECURITY not restored on: %', remaining;
  END IF;
  RAISE NOTICE 'H-D3 hostel tenant-composite FKs: % created, % validated, FORCE restored on % tables',
    created_count, validated_count, coalesce(array_length(lifted, 1), 0);
END
$h_d3_hostel_tenant_parent_fks$;
