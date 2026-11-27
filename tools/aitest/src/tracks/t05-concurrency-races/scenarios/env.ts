/**
 * Shared environment for the race scenarios: one API client per gateway,
 * principals for tenant S, a read-only bootstrap Postgres client for the
 * per-round SQL checks, and student/staff pools.
 *
 * Student pools:
 * - `students(n)`: n distinct seeded ENROLLED students of the largest S
 *   institution, handed out round-robin (fees, sections, library, marks
 *   allow the same student again in a new invoice/section/item).
 * - `examStudents(n)`: seeded ENROLLED students whose id is a version-4 UUID.
 *   The examination and hostel schemas accept only v4 ids, while the Sunrise
 *   seed uses v5 ids (finding AIT-T05 "seeded student ids rejected"), so the
 *   exam scenarios draw from the few v4 ones (candidates are per exam).
 * - `freshStudents(n)`: new students created through the API (v4 ids) for
 *   the hostel, where a student may hold only one active bed ever.
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';

import type { ApiClient, ApiResponse, Principal, StackContext } from '../../../foundation/index.js';
import { TENANTS } from '../../../foundation/index.js';
import { race, spread, type Check, type Timed } from '../race.js';
export const S = TENANTS.S.id;
/** Version-4 UUID, the pattern most module schemas enforce. */
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** One race variant; case ids are `race:<id>` (invariant) and `race:<id>:status`. */
export interface Variant {
  id: string;
  module: string;
  title: string;
  /** Set when the variant cannot run through the API (recorded as skip). */
  skip?: string;
  run(env: RaceEnv, round: number): Promise<VariantRound>;
}
export interface VariantRound {
  statuses: number[];
  invariant: Check;
  status: Check;
  entities: Record<string, string>;
}
export interface RaceEnv {
  ctx: StackContext;
  gateways: ApiClient[];
  /** Read-only bootstrap connection (RLS-free view for verification only). */
  db: pg.Client;
  /** S institution and active academic period that hold the student pool. */
  institutionId: string;
  academicPeriodId: string;
  students(n: number): string[];
  examStudents(n: number): string[];
  freshStudents(n: number): Promise<string[]>;
  /** Principal of role in S with a distinct sub (two "users" of one role). */
  user(role: string, name?: string): Principal;
  /** Linked guardian of `guardianStudentId` (seeded parent-child link). */
  guardian: Principal;
  guardianStudentId: string;
  /** Seeded S staff ids with v4 ids (invigilators). */
  staffIds: string[];
  /** Per-run day offset so date-bound allocations of a rerun never meet the last run's. */
  dayBase: number;
  /** Same request from `n` callers released together, spread over the gateways. */
  fire(
    n: number,
    call: (api: ApiClient, i: number) => Promise<ApiResponse>,
  ): Promise<Timed<ApiResponse>[]>;
  q<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}
export const statusesOf = (runs: readonly Timed<ApiResponse>[]) =>
  runs.map((r) => r.value?.status ?? 0);
export const okBodies = <T>(runs: readonly Timed<ApiResponse>[]) =>
  runs
    .filter((r) => r.value && r.value.status >= 200 && r.value.status < 300)
    .map((r) => r.value?.json as T);
export const uid = () => randomUUID().slice(0, 8);
/** Days from today as YYYY-MM-DD (UTC). */
export const isoDay = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
/** n distinct items of `pool` starting at cursor `at` (wrapping). */
export function rotate<T>(pool: readonly T[], at: number, n: number): T[] {
  if (n > pool.length) throw new Error(`pool too small: need ${n}, have ${pool.length}`);
  return Array.from({ length: n }, (_, k) => pool[(at + k) % pool.length] as T);
}
export async function createRaceEnv(ctx: StackContext): Promise<RaceEnv> {
  const db = new pg.Client({
    connectionString: ctx.db.bootstrapUrl(),
    application_name: 'proctira-aitest-t05',
  });
  await db.connect();
  await db.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows as T[];
  const guardian = ctx.fixtures.principals.guardians.S?.[0];
  if (!guardian) throw new Error('fixtures: no S guardian');
  const [link] = await q<{ student_id: string }>(
    `SELECT student_id::text AS student_id FROM parent_child_links
      WHERE tenant_id = $1 AND parent_user_id = $2 ORDER BY student_id LIMIT 1`,
    [S, guardian],
  );
  if (!link) throw new Error(`no parent_child_links row for ${guardian}`);
  // The largest S institution in the active period holds the student pool.
  const [home] = await q<{ institution_id: string; academic_period_id: string }>(
    `SELECT institution_id::text AS institution_id, academic_period_id::text AS academic_period_id
       FROM enrollments WHERE tenant_id = $1 AND status = 'ENROLLED'
      GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 1`,
    [S],
  );
  if (!home) throw new Error('no ENROLLED S students');
  const pool = (
    await q<{ id: string }>(
      `SELECT DISTINCT e.student_id::text AS id FROM enrollments e
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
        WHERE e.tenant_id = $1 AND e.status = 'ENROLLED'
          AND e.institution_id = $2 AND e.academic_period_id = $3
        ORDER BY 1`,
      [S, home.institution_id, home.academic_period_id],
    )
  ).map((r) => r.id);
  const examPool = pool.filter((id) => UUID_V4_RE.test(id));
  const staff = (
    await q<{ id: string }>(`SELECT id::text AS id FROM staff WHERE tenant_id = $1 ORDER BY id`, [
      S,
    ])
  )
    .map((r) => r.id)
    .filter((id) => UUID_V4_RE.test(id));
  let cursor = 0;
  let examCursor = 0;
  const gateways = ctx.state.urls.gateways.map((_, i) => ctx.api(i as 0 | 1));
  const user = (role: string, name?: string) =>
    ctx.tokens.principal(role, 'S', {
      sub: `aitest-t05-${role}-${name ?? 'a'}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
    });
  return {
    ctx,
    gateways,
    db,
    institutionId: home.institution_id,
    academicPeriodId: home.academic_period_id,
    students(n) {
      const out = rotate(pool, cursor, n);
      cursor = (cursor + n) % pool.length;
      return out;
    },
    examStudents(n) {
      const out = rotate(examPool, examCursor, n);
      examCursor = (examCursor + n) % examPool.length;
      return out;
    },
    async freshStudents(n) {
      const api = gateways[0]!.as(user('admin'));
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = await api.post('/api/v1/students', {
          firstName: 'Aitest',
          lastName: `T5Hostel${uid()}`,
          dateOfBirth: '2012-03-01',
          gender: i % 2 === 0 ? 'female' : 'male',
        });
        const id = (r.json as { id?: string } | undefined)?.id;
        if (r.status !== 201 || !id)
          throw new Error(`student create -> ${r.status} ${r.text.slice(0, 200)}`);
        out.push(id);
      }
      return out;
    },
    user,
    guardian: ctx.tokens.principal('guardian', 'S', { sub: guardian }),
    guardianStudentId: link.student_id,
    staffIds: staff,
    dayBase: 30 + Math.floor(Math.random() * 300),
    fire(n, call) {
      return race(n, (i) => call(spread(gateways, i), i));
    },
    q,
    close: () => db.end(),
  };
}
