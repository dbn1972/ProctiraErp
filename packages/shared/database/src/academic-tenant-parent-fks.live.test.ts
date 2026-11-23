/**
 * PR B1 (FKB-009..FKB-105, academic) — live proof that academic child rows can
 * only reference parents in their own tenant at the database layer
 * (db/sql/306 parent (tenant_id, id) keys + db/sql/307 composite FKs).
 *
 * Runs as the runtime role (DATABASE_URL = proctira_app, NOSUPERUSER
 * NOBYPASSRLS). The migration cases use MIGRATOR_DATABASE_URL (table owner)
 * inside transactions that are always rolled back; the insert probes are
 * rolled back too, so a RED run leaves no cross-tenant rows behind.
 *
 * Before (RED, origin/main): every edge below is id-only. A direct INSERT under
 * tenant A with tenant B's board, area, student, bell period, room, section or
 * subject id is accepted, deleting tenant B's section cascades into tenant A's
 * meeting, no `<child>_<col>_tenant_fk` twin exists and 306/307 are absent.
 * After (GREEN): the composite twins reject each cross-tenant parent with 23503
 * on `<child>_<col>_tenant_fk`, own parents are accepted, the cascade cannot
 * reach another tenant, every edge has a validated twin with the id-only FK's
 * ON DELETE, FORCE RLS is back, and 307 is idempotent, fails closed on a
 * violating row and refuses unbounded timeouts. The 306 assert names the manual
 * recovery when an interrupted build left an INVALID parent key (MIG-B1-001).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveTestsRequired, requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withPgTenant } from './pg-tenant.js';
import { bindTenantGuc } from './tenant-guc.js';
import { ensurePgTestStudent, ensurePgTestTenant } from './test-fixtures.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'academic-tenant-parent-fks.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim() ?? '';
if (DATABASE_URL && !MIGRATOR_DATABASE_URL && liveTestsRequired()) {
  throw new Error(
    'academic-tenant-parent-fks.live.test requires MIGRATOR_DATABASE_URL (no silent skip)',
  );
}

const MIGRATION_306 = '306_academic_tenant_parent_uidx.sql';
const MIGRATION_307 = '307_academic_tenant_parent_fks.sql';

function loadMigration(name: string): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', name), 'utf8');
}

/** pr-b1/edges.csv: finding, child, column, parent, id-only FK ON DELETE (confdeltype). */
const EDGES: readonly (readonly [string, string, string, string, 'a' | 'r' | 'c' | 'n'])[] = [
  ['FKB-009', 'assessment_items', 'grading_scheme_id', 'grading_schemes', 'r'],
  ['FKB-010', 'assessment_results', 'assessment_item_id', 'assessment_items', 'r'],
  ['FKB-011', 'bell_periods', 'bell_schedule_id', 'bell_schedules', 'c'],
  ['FKB-012', 'board_codes', 'board_id', 'boards', 'a'],
  ['FKB-013', 'board_export_jobs', 'board_id', 'boards', 'a'],
  ['FKB-015', 'credit_rules', 'board_id', 'boards', 'a'],
  ['FKB-017', 'enrollment_history', 'enrollment_id', 'enrollments', 'r'],
  ['FKB-019', 'exam_invigilators', 'session_id', 'exam_sessions', 'c'],
  ['FKB-020', 'exam_seating', 'session_id', 'exam_sessions', 'n'],
  ['FKB-021', 'examination_publication_versions', 'examination_id', 'examinations', 'a'],
  ['FKB-025', 'geographic_areas', 'parent_id', 'geographic_areas', 'a'],
  ['FKB-026', 'grade_change_audit', 'grade_entry_id', 'grade_entries', 'r'],
  ['FKB-027', 'grade_entries', 'section_id', 'sections', 'a'],
  ['FKB-028', 'grading_scale_bands', 'grading_scale_id', 'grading_scales', 'c'],
  ['FKB-029', 'grading_scales', 'board_id', 'boards', 'a'],
  ['FKB-045', 'institution_infrastructure', 'parent_id', 'institution_infrastructure', 'r'],
  [
    'FKB-046',
    'institution_repair_requests',
    'infrastructure_id',
    'institution_infrastructure',
    'c',
  ],
  ['FKB-047', 'institutions', 'area_id', 'geographic_areas', 'a'],
  ['FKB-048', 'institutions', 'board_id', 'boards', 'a'],
  ['FKB-082', 'report_card_jobs', 'student_id', 'students', 'a'],
  ['FKB-083', 'report_card_jobs', 'template_id', 'report_card_templates', 'r'],
  ['FKB-090', 'section_enrollments', 'section_id', 'sections', 'c'],
  ['FKB-091', 'section_meetings', 'bell_period_id', 'bell_periods', 'a'],
  ['FKB-092', 'section_meetings', 'room_id', 'rooms', 'a'],
  ['FKB-093', 'section_meetings', 'section_id', 'sections', 'c'],
  ['FKB-094', 'section_meetings', 'subject_id', 'subjects', 'a'],
  ['FKB-095', 'section_meetings', 'teacher_staff_id', 'staff', 'a'],
  ['FKB-096', 'sections', 'default_room_id', 'rooms', 'a'],
  ['FKB-101', 'student_consents', 'supersedes_id', 'student_consents', 'a'],
  ['FKB-102', 'substitutions', 'section_meeting_id', 'section_meetings', 'c'],
  ['FKB-103', 'transcript_issuances', 'signing_key_id', 'transcript_signing_keys', 'a'],
  ['FKB-104', 'transfer_records', 'destination_enrollment_id', 'enrollments', 'a'],
  ['FKB-105', 'transfer_records', 'source_enrollment_id', 'enrollments', 'a'],
];

const TWIN_NAMES = EDGES.map(([, child, col]) => `${child}_${col}_tenant_fk`);
const INVOLVED_TABLES = [
  ...new Set(EDGES.flatMap(([, child, , parent]) => [child, parent])),
].sort();
/** Parents that had no (tenant_id, id) unique key before db/sql/306. */
const NEW_PARENT_KEYS = [
  'assessment_items',
  'bell_periods',
  'bell_schedules',
  'boards',
  'enrollments',
  'exam_sessions',
  'examinations',
  'geographic_areas',
  'grade_entries',
  'grading_scales',
  'grading_schemes',
  'institution_infrastructure',
  'report_card_templates',
  'rooms',
  'section_meetings',
  'sections',
  'student_consents',
  'transcript_signing_keys',
];

interface Fx {
  tenantId: string;
  areaId: string;
  boardId: string;
  institutionId: string;
  academicPeriodId: string;
  roomId: string;
  subjectId: string;
  bellScheduleId: string;
  bellPeriodId: string;
  sectionId: string;
  studentId: string;
  templateId: string;
}

async function seedTenant(pool: pg.Pool): Promise<Fx> {
  const tenantId = randomUUID();
  const s = tenantId.slice(0, 8);
  const fx: Fx = {
    tenantId,
    areaId: randomUUID(),
    boardId: randomUUID(),
    institutionId: randomUUID(),
    academicPeriodId: randomUUID(),
    roomId: randomUUID(),
    subjectId: randomUUID(),
    bellScheduleId: randomUUID(),
    bellPeriodId: randomUUID(),
    sectionId: randomUUID(),
    studentId: randomUUID(),
    templateId: randomUUID(),
  };
  await ensurePgTestTenant(pool, tenantId);
  await ensurePgTestStudent(pool, tenantId, fx.studentId);
  await withPgTenant(pool, tenantId, async (client) => {
    const q = (sql: string, params: unknown[]) => client.query(sql, params);
    await q(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'B1 root', $3, 0, NULL, '/', 1, 2)`,
      [fx.areaId, tenantId, `B1-AREA-${s}`],
    );
    await q(
      `INSERT INTO boards (id, tenant_id, name, code, type) VALUES ($1, $2, 'B1 board', $3, 'STATE')`,
      [fx.boardId, tenantId, `B1-BRD-${s}`],
    );
    await q(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership)
       VALUES ($1, $2, 'B1 school', $3, $4, 'school', 'public', 'government')`,
      [fx.institutionId, tenantId, `B1-SCH-${s}`, fx.areaId],
    );
    await q(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, valid_from, valid_to)
       VALUES ($1, $2, 'B1 2031', $3, '2031-04-01', '2032-03-31', '2031-04-01', '2032-03-31')`,
      [fx.academicPeriodId, tenantId, `B1-AY-${s}`],
    );
    await q(
      `INSERT INTO rooms (id, tenant_id, institution_id, code, name) VALUES ($1, $2, $3, $4, 'B1 room')`,
      [fx.roomId, tenantId, fx.institutionId, `B1-R-${s}`],
    );
    await q(`INSERT INTO subjects (id, tenant_id, name, code) VALUES ($1, $2, 'B1 subject', $3)`, [
      fx.subjectId,
      tenantId,
      `B1-S-${s}`,
    ]);
    await q(
      `INSERT INTO bell_schedules (id, tenant_id, institution_id, academic_period_id, code, name)
       VALUES ($1, $2, $3, $4, $5, 'B1 bells')`,
      [fx.bellScheduleId, tenantId, fx.institutionId, fx.academicPeriodId, `B1-BS-${s}`],
    );
    await q(
      `INSERT INTO bell_periods (id, tenant_id, bell_schedule_id, code, name, period_order, start_time, end_time)
       VALUES ($1, $2, $3, 'P1', 'Period 1', 1, '09:00', '09:45')`,
      [fx.bellPeriodId, tenantId, fx.bellScheduleId],
    );
    await q(
      `INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, code, name)
       VALUES ($1, $2, $3, $4, $5, 'B1 section')`,
      [fx.sectionId, tenantId, fx.institutionId, fx.academicPeriodId, `B1-SEC-${s}`],
    );
    await q(
      `INSERT INTO report_card_templates (id, tenant_id, name, template_content)
       VALUES ($1, $2, 'B1 template', '<p>b1</p>')`,
      [fx.templateId, tenantId],
    );
  });
  return fx;
}

/** Statement + params for one VULNERABLE edge, parent id supplied per probe. */
interface VulnerableCase {
  finding: string;
  child: string;
  col: string;
  parent: keyof Fx;
  sql: string;
  params: (fx: Fx, parentId: string) => unknown[];
}

const MEETING_SQL = `INSERT INTO section_meetings (id, tenant_id, section_id, bell_period_id, day_of_week, room_id, subject_id)
  VALUES ($1, $2, $3, $4, 2, $5, $6)`;

const VULNERABLE: VulnerableCase[] = [
  {
    finding: 'FKB-015',
    child: 'credit_rules',
    col: 'board_id',
    parent: 'boardId',
    sql: `INSERT INTO credit_rules (id, tenant_id, board_id, code, name) VALUES ($1, $2, $3, $4, 'db-case')`,
    params: (fx, p) => [randomUUID(), fx.tenantId, p, `CR-${randomUUID().slice(0, 8)}`],
  },
  {
    finding: 'FKB-047',
    child: 'institutions',
    col: 'area_id',
    parent: 'areaId',
    sql: `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership)
          VALUES ($1, $2, 'db-case', $3, $4, 'school', 'public', 'government')`,
    params: (fx, p) => [randomUUID(), fx.tenantId, `I-${randomUUID().slice(0, 8)}`, p],
  },
  {
    finding: 'FKB-082',
    child: 'report_card_jobs',
    col: 'student_id',
    parent: 'studentId',
    sql: `INSERT INTO report_card_jobs (id, tenant_id, student_id, academic_period_id, template_id, institution_id)
          VALUES ($1, $2, $3, $4, $5, $6)`,
    params: (fx, p) => [
      randomUUID(),
      fx.tenantId,
      p,
      fx.academicPeriodId,
      fx.templateId,
      fx.institutionId,
    ],
  },
  {
    finding: 'FKB-091',
    child: 'section_meetings',
    col: 'bell_period_id',
    parent: 'bellPeriodId',
    sql: MEETING_SQL,
    params: (fx, p) => [randomUUID(), fx.tenantId, fx.sectionId, p, fx.roomId, fx.subjectId],
  },
  {
    finding: 'FKB-092',
    child: 'section_meetings',
    col: 'room_id',
    parent: 'roomId',
    sql: MEETING_SQL,
    params: (fx, p) => [randomUUID(), fx.tenantId, fx.sectionId, fx.bellPeriodId, p, fx.subjectId],
  },
  {
    finding: 'FKB-093',
    child: 'section_meetings',
    col: 'section_id',
    parent: 'sectionId',
    sql: MEETING_SQL,
    params: (fx, p) => [randomUUID(), fx.tenantId, p, fx.bellPeriodId, fx.roomId, fx.subjectId],
  },
  {
    finding: 'FKB-094',
    child: 'section_meetings',
    col: 'subject_id',
    parent: 'subjectId',
    sql: MEETING_SQL,
    params: (fx, p) => [randomUUID(), fx.tenantId, fx.sectionId, fx.bellPeriodId, fx.roomId, p],
  },
  {
    finding: 'FKB-096',
    child: 'sections',
    col: 'default_room_id',
    parent: 'roomId',
    sql: `INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, code, name, default_room_id)
          VALUES ($1, $2, $3, $4, $5, 'db-case', $6)`,
    params: (fx, p) => [
      randomUUID(),
      fx.tenantId,
      fx.institutionId,
      fx.academicPeriodId,
      `SEC-${randomUUID().slice(0, 8)}`,
      p,
    ],
  },
];

describe.skipIf(!DATABASE_URL || !MIGRATOR_DATABASE_URL)(
  'PR B1 academic tenant-parent FKs (live Postgres)',
  () => {
    let pool: pg.Pool;
    let migrator: pg.Pool;
    let a: Fx;
    let b: Fx;

    /** Run one statement as proctira_app bound to `tenantId`; always rolled back. */
    async function probe(tenantId: string, sql: string, params: unknown[]): Promise<unknown> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await bindTenantGuc(client, tenantId);
        try {
          await client.query(sql, params);
          return null;
        } catch (error) {
          return error;
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    async function inMigratorTx(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
      const client = await migrator.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL lock_timeout = '10s'`);
        await client.query(`SET LOCAL statement_timeout = '5min'`);
        await fn(client);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    async function compositeState(client: pg.Pool | pg.PoolClient) {
      const fks = await client.query<{ n: number; valid: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE convalidated)::int AS valid
           FROM pg_constraint
          WHERE contype = 'f' AND conname = ANY ($1::text[])`,
        [TWIN_NAMES],
      );
      const forced = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relname = ANY ($1::text[])
            AND relforcerowsecurity`,
        [INVOLVED_TABLES],
      );
      return { fks: fks.rows[0]!.n, valid: fks.rows[0]!.valid, forced: forced.rows[0]!.n };
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL });
      a = await seedTenant(pool);
      b = await seedTenant(pool);
    });

    afterAll(async () => {
      await pool?.end();
      await migrator?.end();
    });

    describe('database: composite FKs reject cross-tenant parents (VULNERABLE edges)', () => {
      for (const c of VULNERABLE) {
        it(`${c.finding} ${c.child}.${c.col}: own parent accepted, tenant B's rejected by ${c.child}_${c.col}_tenant_fk`, async () => {
          expect(await probe(a.tenantId, c.sql, c.params(a, a[c.parent]))).toBeNull();
          const err = await probe(a.tenantId, c.sql, c.params(a, b[c.parent]));
          expect(err, 'cross-tenant insert must be rejected').not.toBeNull();
          expect(err).toMatchObject({ code: '23503', constraint: `${c.child}_${c.col}_tenant_fk` });
        });
      }
    });

    it("FKB-093 cascade: deleting tenant B's section cannot remove tenant A's meetings", async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const sectionB2 = randomUUID();
        await bindTenantGuc(client, b.tenantId);
        await client.query(
          `INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, code, name)
           VALUES ($1, $2, $3, $4, $5, 'B1 cascade section')`,
          [
            sectionB2,
            b.tenantId,
            b.institutionId,
            b.academicPeriodId,
            `B1-C-${sectionB2.slice(0, 8)}`,
          ],
        );
        await bindTenantGuc(client, a.tenantId);
        await client.query(MEETING_SQL, [
          randomUUID(),
          a.tenantId,
          a.sectionId,
          a.bellPeriodId,
          a.roomId,
          a.subjectId,
        ]);
        // A hangs a meeting off B's section with the service bypassed (no room or
        // subject, so it cannot clash with A's own meeting above).
        await client.query('SAVEPOINT cross_row');
        const crossErr = await client
          .query(MEETING_SQL, [randomUUID(), a.tenantId, sectionB2, a.bellPeriodId, null, null])
          .then(
            () => null,
            (error: unknown) => error,
          );
        if (crossErr) {
          expect(crossErr).toMatchObject({ code: '23503' });
          await client.query('ROLLBACK TO SAVEPOINT cross_row');
        }
        const countA = async () =>
          (
            await client.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM section_meetings WHERE tenant_id = $1`,
              [a.tenantId],
            )
          ).rows[0]!.n;
        const before = await countA();
        await bindTenantGuc(client, b.tenantId);
        await client.query(`DELETE FROM sections WHERE id = $1 AND tenant_id = $2`, [
          sectionB2,
          b.tenantId,
        ]);
        await bindTenantGuc(client, a.tenantId);
        expect(await countA()).toBe(before);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    });

    describe('catalog', () => {
      it('every pr-b1 edge has a validated (tenant_id, col) twin mirroring the id-only FK', async () => {
        const { rows } = await pool.query<{
          child: string;
          col: string;
          parent: string;
          id_only_del: string | null;
          id_only_upd: string | null;
          twin_del: string | null;
          twin_upd: string | null;
          twin_valid: boolean | null;
          twin_cols: string | null;
          twin_ref: string | null;
          twin_setnull: string | null;
        }>(
          `WITH e(child, col, parent) AS (
             SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
           )
           SELECT e.child, e.col, e.parent,
                  io.confdeltype::text AS id_only_del, io.confupdtype::text AS id_only_upd,
                  t.confdeltype::text AS twin_del, t.confupdtype::text AS twin_upd,
                  t.convalidated AS twin_valid,
                  (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                     FROM unnest(t.conkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = t.conrelid AND a.attnum = k.attnum) AS twin_cols,
                  t.confrelid::regclass::text || '(' ||
                  (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                     FROM unnest(t.confkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = t.confrelid AND a.attnum = k.attnum) || ')' AS twin_ref,
                  (SELECT string_agg(a.attname, ',')
                     FROM unnest(t.confdelsetcols) k(attnum)
                     JOIN pg_attribute a ON a.attrelid = t.conrelid AND a.attnum = k.attnum) AS twin_setnull
             FROM e
             LEFT JOIN LATERAL (
               SELECT c.confdeltype, c.confupdtype
                 FROM pg_constraint c
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
                  AND c.conrelid = format('public.%I', e.child)::regclass
                  AND c.confrelid = format('public.%I', e.parent)::regclass
                  AND a.attname = e.col
                ORDER BY c.conname LIMIT 1
             ) io ON true
             LEFT JOIN pg_constraint t
               ON t.contype = 'f'
              AND t.conrelid = format('public.%I', e.child)::regclass
              AND t.conname = e.child || '_' || e.col || '_tenant_fk'
            ORDER BY 1, 2`,
          [EDGES.map((e) => e[1]), EDGES.map((e) => e[2]), EDGES.map((e) => e[3])],
        );
        expect(rows).toHaveLength(EDGES.length);
        const expectedDel = new Map(EDGES.map((e) => [`${e[1]}.${e[2]}`, e[4]]));
        for (const r of rows) {
          const key = `${r.child}.${r.col}`;
          expect(r.id_only_del, `${key} id-only FK`).toBe(expectedDel.get(key));
          expect(r, `${key} -> ${r.parent}`).toMatchObject({
            twin_del: r.id_only_del,
            twin_upd: r.id_only_upd,
            twin_valid: true,
            twin_cols: `tenant_id,${r.col}`,
            twin_ref: `${r.parent}(tenant_id,id)`,
            // SET NULL nulls only the reference column, never tenant_id.
            twin_setnull: r.id_only_del === 'n' ? r.col : null,
          });
        }
      });

      it('every new parent has a valid UNIQUE (tenant_id, id) index', async () => {
        const { rows } = await pool.query<{ relname: string }>(
          `SELECT t.relname::text AS relname
             FROM pg_index i
             JOIN pg_class ic ON ic.oid = i.indexrelid
             JOIN pg_class t ON t.oid = i.indrelid
            WHERE t.relnamespace = 'public'::regnamespace
              AND t.relname = ANY ($1::text[])
              AND ic.relname = t.relname || '_tenant_id_id_uidx'
              AND i.indisvalid AND i.indisunique AND i.indnkeyatts = 2`,
          [NEW_PARENT_KEYS],
        );
        expect(rows.map((r) => r.relname).sort()).toEqual([...NEW_PARENT_KEYS].sort());
      });

      it('FORCE ROW LEVEL SECURITY is on for every involved table', async () => {
        const { rows } = await pool.query<{ relname: string }>(
          `SELECT relname::text AS relname FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relname = ANY ($1::text[])
              AND relforcerowsecurity`,
          [INVOLVED_TABLES],
        );
        expect(rows.map((r) => r.relname).sort()).toEqual(INVOLVED_TABLES);
      });

      it('306 and 307 are recorded as applied', async () => {
        const { rows } = await pool.query<{ migration_name: string; migration_applied: boolean }>(
          `SELECT migration_name, migration_applied
             FROM public.proctira_runtime_migration_status($1::text[])
            ORDER BY migration_name`,
          [[MIGRATION_306, MIGRATION_307]],
        );
        expect(rows).toEqual([
          { migration_name: MIGRATION_306, migration_applied: true },
          { migration_name: MIGRATION_307, migration_applied: true },
        ]);
      });
    });

    describe('migration 306 (owner)', () => {
      it('an INVALID leftover from an interrupted build fails the assert with the recovery HINT', async () => {
        const parent = 'transcript_signing_keys';
        const uidx = `${parent}_tenant_id_id_uidx`;
        const scratch = 'b1_test_interrupted_uidx';
        const tag = `$assert_${uidx}$`;
        const sql306 = loadMigration(MIGRATION_306);
        const start = sql306.indexOf(`DO ${tag}`);
        const end = sql306.indexOf(`${tag};`, start + tag.length + 3);
        expect(start, `306 assert phase for ${parent}`).toBeGreaterThanOrEqual(0);
        const assertPhase = sql306.slice(start, end + tag.length + 1);
        // Interrupt a real CREATE INDEX CONCURRENTLY: it waits for the open
        // ROW EXCLUSIVE holder, lock_timeout fires and an INVALID index is left.
        const holder = await migrator.connect();
        const builder = await migrator.connect();
        let error: (Error & { hint?: string }) | null = null;
        try {
          await holder.query('BEGIN');
          await holder.query(`LOCK TABLE public.${parent} IN ROW EXCLUSIVE MODE`);
          await builder.query(`SET lock_timeout = '300ms'`);
          await builder.query(`SET statement_timeout = '10s'`);
          const buildErr = await builder
            .query(
              `CREATE UNIQUE INDEX CONCURRENTLY ${scratch} ON public.${parent} (tenant_id, id)`,
            )
            .then(
              () => null,
              (e: unknown) => e,
            );
          expect(buildErr, 'the build must be interrupted').toMatchObject({ code: '55P03' });
          await holder.query('ROLLBACK');
          const left = await migrator.query<{ indisvalid: boolean }>(
            `SELECT i.indisvalid FROM pg_index i
               JOIN pg_class c ON c.oid = i.indexrelid
              WHERE c.relnamespace = 'public'::regnamespace AND c.relname = $1`,
            [scratch],
          );
          expect(left.rows).toEqual([{ indisvalid: false }]);
          // Put the INVALID index under the 306 name (rolled back), as a resumed
          // apply-sql.sh run sees it after the build phase no-ops and is ledgered.
          await inMigratorTx(async (client) => {
            await client.query(`ALTER INDEX public.${uidx} RENAME TO b1_test_valid_uidx`);
            await client.query(`ALTER INDEX public.${scratch} RENAME TO ${uidx}`);
            await client.query('SAVEPOINT run_assert');
            error = await client.query(assertPhase).then(
              () => null,
              (e: Error & { hint?: string }) => e,
            );
          });
        } finally {
          await holder.query('ROLLBACK').catch(() => undefined);
          holder.release();
          await builder.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${scratch}`);
          builder.release();
        }
        const failure = error as (Error & { hint?: string }) | null;
        expect(failure, 'the assert must refuse an INVALID index').not.toBeNull();
        expect(String(failure?.message)).toBe(
          `B1: ${uidx} is INVALID (interrupted CREATE INDEX CONCURRENTLY); the ledgered build phase will not rebuild it`,
        );
        expect(String(failure?.hint)).toBe(
          `Run DROP INDEX CONCURRENTLY IF EXISTS public.${uidx}; then CREATE UNIQUE INDEX CONCURRENTLY ${uidx} ON public.${parent} (tenant_id, id); then re-run tools/scripts/apply-sql.sh. See "Interrupted build / operator remediation" in the db/sql/306 header.`,
        );
        // The rename was rolled back: the valid 306 key is in place again.
        const kept = await migrator.query<{ indisvalid: boolean }>(
          `SELECT i.indisvalid FROM pg_index i
             JOIN pg_class c ON c.oid = i.indexrelid
            WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1::text[])`,
          [[uidx, scratch, 'b1_test_valid_uidx']],
        );
        expect(kept.rows).toEqual([{ indisvalid: true }]);
      });
    });
    describe('migration 307 (owner, rolled back)', () => {
      it('re-running 307 is a no-op', async () => {
        const sql = loadMigration(MIGRATION_307);
        await inMigratorTx(async (client) => {
          await client.query(sql);
          expect(await compositeState(client)).toEqual({
            fks: EDGES.length,
            valid: EDGES.length,
            forced: INVOLVED_TABLES.length,
          });
        });
      });

      it('fails closed on an existing cross-tenant row with the documented message and changes nothing', async () => {
        const sql = loadMigration(MIGRATION_307);
        const violating = randomUUID();
        const outcome: { error: (Error & { hint?: string }) | null } = { error: null };
        await inMigratorTx(async (client) => {
          await client.query(
            `ALTER TABLE public.section_meetings DROP CONSTRAINT section_meetings_section_id_tenant_fk`,
          );
          await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
          await client.query(MEETING_SQL, [
            violating,
            a.tenantId,
            b.sectionId,
            a.bellPeriodId,
            a.roomId,
            a.subjectId,
          ]);
          await client.query(`SELECT set_config('app.tenant_id', '', true)`);
          await client.query('SAVEPOINT run_307');
          outcome.error = await client.query(sql).then(
            () => null,
            (error: Error & { hint?: string }) => error,
          );
          await client.query('ROLLBACK TO SAVEPOINT run_307');
          // Nothing deleted or re-parented, nothing added, FORCE unchanged.
          await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
          const kept = await client.query<{ section_id: string }>(
            `SELECT section_id::text AS section_id FROM section_meetings WHERE id = $1`,
            [violating],
          );
          expect(kept.rows).toEqual([{ section_id: b.sectionId }]);
          expect(await compositeState(client)).toEqual({
            fks: EDGES.length - 1,
            valid: EDGES.length - 1,
            forced: INVOLVED_TABLES.length,
          });
        });
        expect(outcome.error, '307 must refuse to run over a violating row').not.toBeNull();
        expect(String(outcome.error?.message)).toMatch(
          /B1: cross-tenant or dangling parent references block academic tenant-composite FKs: .*section_meetings_section_id_tenant_fk=1 cross-tenant\/0 dangling/,
        );
        expect(String(outcome.error?.hint)).toMatch(
          /Nothing was changed\. Follow the operator remediation in the db\/sql\/307 header/,
        );
        expect(await compositeState(migrator)).toEqual({
          fks: EDGES.length,
          valid: EDGES.length,
          forced: INVOLVED_TABLES.length,
        });
      });

      it('refuses to run without lock_timeout', async () => {
        const sql = loadMigration(MIGRATION_307);
        let failure: unknown = null;
        await inMigratorTx(async (client) => {
          await client.query(`SET LOCAL lock_timeout = 0`);
          failure = await client.query(sql).then(
            () => null,
            (error: unknown) => error,
          );
        });
        expect(failure).not.toBeNull();
        expect(String((failure as Error).message)).toMatch(/lock_timeout/);
      });
    });
  },
);
