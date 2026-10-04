/**
 * PRC-H036 — read-only directory port used by report-card generation to
 * resolve the student's full name, subject names and the academic period name.
 *
 * Postgres implementation reads the student / institution tables through
 * `withPgTenant`, so RLS confines lookups to the job's tenant. A student that
 * is not visible in the tenant resolves to `null` and the job fails.
 */
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';

export interface ReportCardDirectory {
  /** Full display name, or null when the student does not exist in the tenant. */
  findStudentName(tenantId: string, studentId: string): Promise<string | null>;
  /** subjectId -> name for every id found in the tenant (missing ids omitted). */
  findSubjectNames(tenantId: string, subjectIds: readonly string[]): Promise<Map<string, string>>;
  /** Period display name, or null when the period does not exist in the tenant. */
  findAcademicPeriodName(tenantId: string, academicPeriodId: string): Promise<string | null>;
}

export class PgReportCardDirectory implements ReportCardDirectory {
  constructor(private readonly pool: PgQueryable & { connect?: () => Promise<unknown> }) {}

  async findStudentName(tenantId: string, studentId: string): Promise<string | null> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT first_name, last_name FROM students
          WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [studentId, tenantId],
      );
      const row = result.rows[0] as { first_name: string; last_name: string } | undefined;
      if (!row) return null;
      return `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || null;
    });
  }

  async findSubjectNames(
    tenantId: string,
    subjectIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (subjectIds.length === 0) return new Map();
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT id::text AS id, name FROM subjects
          WHERE tenant_id::text = $1 AND id::text = ANY($2::text[]) AND deleted_at IS NULL`,
        [tenantId, [...subjectIds]],
      );
      return new Map(
        (result.rows as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
      );
    });
  }

  async findAcademicPeriodName(tenantId: string, academicPeriodId: string): Promise<string | null> {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT name FROM academic_periods WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
        [academicPeriodId, tenantId],
      );
      const row = result.rows[0] as { name: string } | undefined;
      return row?.name ?? null;
    });
  }
}

/** Test / dev directory keyed by tenant. */
export class InMemoryReportCardDirectory implements ReportCardDirectory {
  private readonly students = new Map<string, string>();
  private readonly subjects = new Map<string, string>();
  private readonly periods = new Map<string, string>();

  addStudent(tenantId: string, id: string, fullName: string): this {
    this.students.set(`${tenantId}:${id}`, fullName);
    return this;
  }
  addSubject(tenantId: string, id: string, name: string): this {
    this.subjects.set(`${tenantId}:${id}`, name);
    return this;
  }
  addPeriod(tenantId: string, id: string, name: string): this {
    this.periods.set(`${tenantId}:${id}`, name);
    return this;
  }

  async findStudentName(tenantId: string, studentId: string): Promise<string | null> {
    return this.students.get(`${tenantId}:${studentId}`) ?? null;
  }
  async findSubjectNames(
    tenantId: string,
    subjectIds: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of subjectIds) {
      const name = this.subjects.get(`${tenantId}:${id}`);
      if (name) out.set(id, name);
    }
    return out;
  }
  async findAcademicPeriodName(tenantId: string, academicPeriodId: string): Promise<string | null> {
    return this.periods.get(`${tenantId}:${academicPeriodId}`) ?? null;
  }
}

/** Postgres directory when a shared pool is configured; otherwise null (jobs fail explicitly). */
export function createReportCardDirectory(databaseUrl?: string): ReportCardDirectory | null {
  const pool = getSharedPgPool(databaseUrl);
  return pool ? new PgReportCardDirectory(pool) : null;
}
