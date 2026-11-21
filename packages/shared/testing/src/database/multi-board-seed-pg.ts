/**
 * Postgres persistence adapter for the multi-board seed (PRC-L497).
 *
 * {@link seedMultiBoardSchools} builds an in-memory fixture. This adapter
 * writes that fixture to the real onboarding tables (db/sql/001 plus later
 * migrations) through ONE transaction bound to the seed tenant:
 *
 * - `app.tenant_id` is set transaction-locally (`set_config(…, true)`) and
 *   `app.platform_admin` is never set, so every INSERT passes FORCE RLS only
 *   because its `tenant_id` equals the bound tenant. The tenant row itself is
 *   admitted by the `tenants` policy (`id = app.tenant_id`).
 * - Every fixture entity must carry the seed tenant id; a foreign or missing
 *   tenant fails closed before anything is written.
 * - Rows the schema needs but the fixture does not model are created in the
 *   same transaction for the same tenant: one grade, and one class per school
 *   (an `ENROLLED` enrollment requires a class, `enrollments_enrolled_requires_class`).
 *   The fixture's random `gradeId`/`classId` values are not used.
 * - On any error the transaction rolls back, so nothing partial is left.
 *
 * Use it with the runtime (non-owner, NOBYPASSRLS) role so the proof is real.
 * The adapter takes any `pg`-compatible pool; it adds no dependency here.
 */
import { randomUUID } from 'node:crypto';

import type { MultiBoardSeedResult } from './multi-board-seed.js';

/** Minimal `pg.PoolClient` surface used by the adapter. */
export interface SeedPgClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
  release(): void;
}

/** Minimal `pg.Pool` surface used by the adapter. */
export interface SeedPgPool {
  connect(): Promise<SeedPgClient>;
}

export interface PersistedMultiBoardSeed {
  tenantId: string;
  counts: {
    areas: number;
    boards: number;
    institutions: number;
    academicPeriods: number;
    grades: number;
    classes: number;
    students: number;
    staff: number;
    enrollments: number;
  };
}

export interface PersistMultiBoardSeedOptions {
  /** Rows per multi-row INSERT (default 500). */
  batchSize?: number;
}

/** Thrown when a fixture entity does not belong to the seed tenant. */
export class SeedTenantMismatchError extends Error {
  constructor(entity: string, id: string) {
    super(`multi-board seed: ${entity} ${id} does not belong to the seed tenant (PRC-L497)`);
    this.name = 'SeedTenantMismatchError';
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function assertSingleTenant(seed: MultiBoardSeedResult): string {
  const tenantId = seed.tenant.id;
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new SeedTenantMismatchError('tenant', String(tenantId));
  }
  const check = (entity: string, row: { id: string; tenantId: string }) => {
    if (row.tenantId !== tenantId) throw new SeedTenantMismatchError(entity, row.id);
  };
  seed.areas.forEach((a) => check('area', a));
  seed.boards.forEach((b) => check('board', b));
  for (const school of seed.schools) {
    check('institution', school.institution);
    check('academicPeriod', school.academicPeriod);
    school.students.forEach((s) => check('student', s));
    school.staff.forEach((s) => check('staff', s));
    school.enrollments.forEach((e) => check('enrollment', e));
  }
  return tenantId;
}

/** Nested-set + path values for the linear area chain produced by the factory. */
function areaRows(seed: MultiBoardSeedResult) {
  const byId = new Map(seed.areas.map((a) => [a.id, a]));
  const n = seed.areas.length;
  return seed.areas.map((a, index) => {
    const codes: string[] = [];
    let cursor: (typeof seed.areas)[number] | undefined = a;
    while (cursor) {
      codes.unshift(cursor.code);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return {
      id: a.id,
      tenant_id: a.tenantId,
      name: a.name,
      code: a.code,
      level: a.level,
      parent_id: a.parentId,
      path: codes.join('/'),
      lft: index + 1,
      rgt: 2 * n - index,
    };
  });
}

async function insertJson(
  client: SeedPgClient,
  sql: string,
  rows: Record<string, unknown>[],
  batchSize: number,
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const res = await client.query(sql, [JSON.stringify(chunk)]);
    inserted += Number(res.rowCount ?? 0);
  }
  return inserted;
}

/**
 * Persists `seed` under RLS for its own tenant and returns per-table counts
 * re-read inside the same tenant-bound transaction.
 */
export async function persistMultiBoardSeed(
  pool: SeedPgPool,
  seed: MultiBoardSeedResult,
  options: PersistMultiBoardSeedOptions = {},
): Promise<PersistedMultiBoardSeed> {
  const tenantId = assertSingleTenant(seed);
  const batchSize = options.batchSize ?? 500;
  const gradeId = randomUUID();
  const classIdBySchool = new Map(
    seed.schools.map((s) => [s.institution.id, randomUUID()] as const),
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

    await client.query(
      `INSERT INTO tenants (id, name, slug, config, status) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        tenantId,
        seed.tenant.name,
        seed.tenant.slug,
        JSON.stringify(seed.tenant.config ?? {}),
        seed.tenant.status.toLowerCase(),
      ],
    );

    await insertJson(
      client,
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       SELECT id, tenant_id, name, code, level, parent_id, path, lft, rgt
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, name text, code text,
         level smallint, parent_id uuid, path text, lft int, rgt int)`,
      areaRows(seed),
      batchSize,
    );

    await insertJson(
      client,
      `INSERT INTO boards (id, tenant_id, name, code, type, status)
       SELECT id, tenant_id, name, code, type::board_type, status
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, name text, code text,
         type text, status text)`,
      seed.boards.map((b) => ({
        id: b.id,
        tenant_id: b.tenantId,
        name: b.name,
        code: b.code,
        type: b.type,
        status: b.status,
      })),
      batchSize,
    );

    await insertJson(
      client,
      `INSERT INTO institutions (id, tenant_id, name, code, board_id, area_id, type, sector,
         ownership, status, custom_data)
       SELECT id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status,
         custom_data
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, name text, code text,
         board_id uuid, area_id uuid, type text, sector text, ownership text, status text,
         custom_data jsonb)`,
      seed.schools.map(({ institution: i }) => ({
        id: i.id,
        tenant_id: i.tenantId,
        name: i.name,
        code: i.code,
        board_id: i.boardId,
        area_id: i.areaId,
        type: i.typeId,
        sector: i.sectorId,
        ownership: i.ownershipId,
        status: i.status.toLowerCase(),
        custom_data: i.customData ?? {},
      })),
      batchSize,
    );

    await insertJson(
      client,
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       SELECT id, tenant_id, name, code, start_date, end_date, status
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, name text, code text,
         start_date date, end_date date, status text)`,
      seed.schools.map(({ academicPeriod: p }) => ({
        id: p.id,
        tenant_id: p.tenantId,
        name: p.name,
        code: p.code,
        start_date: isoDate(p.startDate),
        end_date: isoDate(p.endDate),
        status: p.status.toLowerCase(),
      })),
      batchSize,
    );

    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, $3, $4, 1)`,
      [gradeId, tenantId, 'Certification Grade', 'CERT-G1'],
    );

    await insertJson(
      client,
      `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name)
       SELECT id, tenant_id, institution_id, grade_id, academic_period_id, name
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, institution_id uuid,
         grade_id uuid, academic_period_id uuid, name text)`,
      seed.schools.map((s) => ({
        id: classIdBySchool.get(s.institution.id),
        tenant_id: tenantId,
        institution_id: s.institution.id,
        grade_id: gradeId,
        academic_period_id: s.academicPeriod.id,
        name: `${s.institution.code} Certification Class`,
      })),
      batchSize,
    );

    const students = seed.schools.flatMap((s) => s.students);
    await insertJson(
      client,
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender,
         national_id, custom_data)
       SELECT id, tenant_id, first_name, last_name, date_of_birth, gender, national_id,
         custom_data
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, first_name text,
         last_name text, date_of_birth date, gender text, national_id text, custom_data jsonb)`,
      students.map((s) => ({
        id: s.id,
        tenant_id: s.tenantId,
        first_name: s.firstName,
        last_name: s.lastName,
        date_of_birth: isoDate(s.dateOfBirth),
        gender: s.gender,
        national_id: s.nationalId,
        custom_data: s.customData ?? {},
      })),
      batchSize,
    );

    const staff = seed.schools.flatMap((s) => s.staff);
    await insertJson(
      client,
      `INSERT INTO staff (id, tenant_id, first_name, last_name, date_of_birth, identity_number,
         custom_data)
       SELECT id, tenant_id, first_name, last_name, date_of_birth, identity_number, custom_data
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, first_name text,
         last_name text, date_of_birth date, identity_number text, custom_data jsonb)`,
      staff.map((s) => ({
        id: s.id,
        tenant_id: s.tenantId,
        first_name: s.firstName,
        last_name: s.lastName,
        date_of_birth: isoDate(s.dateOfBirth),
        identity_number: s.identityNumber,
        custom_data: s.customData ?? {},
      })),
      batchSize,
    );

    await insertJson(
      client,
      `INSERT INTO enrollments (id, tenant_id, student_id, institution_id, grade_id, class_id,
         academic_period_id, status, enrolled_at)
       SELECT id, tenant_id, student_id, institution_id, grade_id, class_id, academic_period_id,
         status::enrollment_status, enrolled_at
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, tenant_id uuid, student_id uuid,
         institution_id uuid, grade_id uuid, class_id uuid, academic_period_id uuid,
         status text, enrolled_at date)`,
      seed.schools.flatMap((s) =>
        s.enrollments.map((e) => ({
          id: e.id,
          tenant_id: e.tenantId,
          student_id: e.studentId,
          institution_id: e.institutionId,
          grade_id: gradeId,
          class_id: classIdBySchool.get(s.institution.id),
          academic_period_id: e.academicPeriodId,
          status: e.status,
          enrolled_at: isoDate(e.startDate),
        })),
      ),
      batchSize,
    );

    // Re-read through the same RLS-bound connection: these counts are what the
    // tenant can actually see, not what the fixture claims.
    const count = async (table: string) => {
      const res = await client.query(
        `SELECT COUNT(*)::int AS c FROM ${table} WHERE tenant_id = $1`,
        [tenantId],
      );
      return Number((res.rows[0] as { c: number }).c);
    };
    const counts = {
      areas: await count('geographic_areas'),
      boards: await count('boards'),
      institutions: await count('institutions'),
      academicPeriods: await count('academic_periods'),
      grades: await count('grades'),
      classes: await count('classes'),
      students: await count('students'),
      staff: await count('staff'),
      enrollments: await count('enrollments'),
    };
    await client.query('COMMIT');
    return { tenantId, counts };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore: the original error is the one worth reporting
    }
    throw error;
  } finally {
    client.release();
  }
}
