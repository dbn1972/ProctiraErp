/**
 * Postgres training repositories (G-717) on `hr_training_programs`,
 * `hr_training_sessions`, `hr_training_attendance`, `hr_certifications`
 * (db/sql/024). All access is tenant-bound via `withPgTenant` for RLS.
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';

import { ensureHrSchema, toDate, toDateStr, type PgPoolLike } from './pg-hr-schema.js';
import type {
  CertificationEntity,
  CertificationFilter,
  CertificationRepository,
  TrainingAttendanceEntity,
  TrainingAttendanceRepository,
  TrainingProgramEntity,
  TrainingProgramRepository,
  TrainingSessionEntity,
  TrainingSessionRepository,
} from './training-repository.js';

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null ? null : String(v));

function mapProgram(row: Row): TrainingProgramEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: str(row.description),
    startDate: toDateStr(row.start_date),
    endDate: toDateStr(row.end_date),
    provider: str(row.provider),
    certificationName: str(row.certification_name),
    certificationValidityDays:
      row.certification_validity_days == null ? null : Number(row.certification_validity_days),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapSession(row: Row): TrainingSessionEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    programId: String(row.program_id),
    title: String(row.title),
    date: toDateStr(row.session_date),
    startTime: str(row.start_time),
    endTime: str(row.end_time),
    location: str(row.location),
    instructorName: str(row.instructor_name),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAttendance(row: Row): TrainingAttendanceEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    sessionId: String(row.session_id),
    staffId: String(row.staff_id),
    status: String(row.status) as TrainingAttendanceEntity['status'],
    comment: str(row.comment),
    createdAt: toDate(row.created_at),
  };
}

function mapCertification(row: Row): CertificationEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    staffId: String(row.staff_id),
    programId: String(row.program_id),
    certificationName: String(row.certification_name),
    issuedDate: toDateStr(row.issued_date),
    expiryDate: row.expiry_date == null ? null : toDateStr(row.expiry_date),
    status: String(row.status) as CertificationEntity['status'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function paginate<T>(data: T[], totalItems: number, p: PaginationOptions): PaginatedResult<T> {
  return {
    data,
    meta: {
      page: p.page,
      pageSize: p.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / p.pageSize),
    },
  };
}

abstract class PgBase {
  constructor(protected readonly pool: PgPoolLike) {}

  protected async run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    await ensureHrSchema(this.pool);
    return withPgTenant(this.pool, tenantId, fn);
  }
}

export class PgTrainingProgramRepository extends PgBase implements TrainingProgramRepository {
  async create(
    data: Omit<TrainingProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TrainingProgramEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO hr_training_programs
           (id, tenant_id, name, description, start_date, end_date, provider,
            certification_name, certification_validity_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.name,
          data.description,
          data.startDate,
          data.endDate,
          data.provider,
          data.certificationName,
          data.certificationValidityDays,
        ],
      );
      return mapProgram(res.rows[0] as Row);
    });
  }

  async findById(id: string, tenantId: string): Promise<TrainingProgramEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_training_programs WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapProgram(row) : null;
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<TrainingProgramEntity>,
  ): Promise<TrainingProgramEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `UPDATE hr_training_programs SET
           name                        = COALESCE($3, name),
           description                 = CASE WHEN $4::boolean THEN $5 ELSE description END,
           start_date                  = COALESCE($6, start_date),
           end_date                    = COALESCE($7, end_date),
           provider                    = CASE WHEN $8::boolean THEN $9 ELSE provider END,
           certification_name          = CASE WHEN $10::boolean THEN $11 ELSE certification_name END,
           certification_validity_days = CASE WHEN $12::boolean THEN $13 ELSE certification_validity_days END
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [
          id,
          tenantId,
          data.name ?? null,
          data.description !== undefined,
          data.description ?? null,
          data.startDate ?? null,
          data.endDate ?? null,
          data.provider !== undefined,
          data.provider ?? null,
          data.certificationName !== undefined,
          data.certificationName ?? null,
          data.certificationValidityDays !== undefined,
          data.certificationValidityDays ?? null,
        ],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapProgram(row) : null;
    });
  }

  async list(
    tenantId: string,
    search: string | undefined,
    p: PaginationOptions,
  ): Promise<PaginatedResult<TrainingProgramEntity>> {
    return this.run(tenantId, async (c) => {
      const params: unknown[] = [tenantId];
      let where = 'tenant_id = $1';
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where += ` AND LOWER(name) LIKE $${params.length}`;
      }
      const total = await c.query(
        `SELECT COUNT(*)::int AS n FROM hr_training_programs WHERE ${where}`,
        params,
      );
      const rows = await c.query(
        `SELECT * FROM hr_training_programs WHERE ${where}
         ORDER BY start_date DESC, created_at DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, p.pageSize, (p.page - 1) * p.pageSize],
      );
      return paginate(
        (rows.rows as Row[]).map(mapProgram),
        Number((total.rows[0] as { n: number }).n),
        p,
      );
    });
  }
}

export class PgTrainingSessionRepository extends PgBase implements TrainingSessionRepository {
  async create(
    data: Omit<TrainingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TrainingSessionEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO hr_training_sessions
           (id, tenant_id, program_id, title, session_date, start_time, end_time, location, instructor_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.programId,
          data.title,
          data.date,
          data.startTime,
          data.endTime,
          data.location,
          data.instructorName,
        ],
      );
      return mapSession(res.rows[0] as Row);
    });
  }

  async findById(id: string, tenantId: string): Promise<TrainingSessionEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_training_sessions WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapSession(row) : null;
    });
  }

  async listByProgram(
    tenantId: string,
    programId: string,
    p: PaginationOptions,
  ): Promise<PaginatedResult<TrainingSessionEntity>> {
    return this.run(tenantId, async (c) => {
      const total = await c.query(
        `SELECT COUNT(*)::int AS n FROM hr_training_sessions WHERE tenant_id = $1 AND program_id = $2`,
        [tenantId, programId],
      );
      const rows = await c.query(
        `SELECT * FROM hr_training_sessions WHERE tenant_id = $1 AND program_id = $2
         ORDER BY session_date, start_time NULLS LAST, id LIMIT $3 OFFSET $4`,
        [tenantId, programId, p.pageSize, (p.page - 1) * p.pageSize],
      );
      return paginate(
        (rows.rows as Row[]).map(mapSession),
        Number((total.rows[0] as { n: number }).n),
        p,
      );
    });
  }
}

export class PgTrainingAttendanceRepository extends PgBase implements TrainingAttendanceRepository {
  async create(
    data: Omit<TrainingAttendanceEntity, 'createdAt'>,
  ): Promise<TrainingAttendanceEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO hr_training_attendance (id, tenant_id, session_id, staff_id, status, comment)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id, session_id, staff_id)
           DO UPDATE SET status = EXCLUDED.status, comment = EXCLUDED.comment
         RETURNING *`,
        [data.id, data.tenantId, data.sessionId, data.staffId, data.status, data.comment],
      );
      return mapAttendance(res.rows[0] as Row);
    });
  }

  async findBySessionAndStaff(
    sessionId: string,
    staffId: string,
    tenantId: string,
  ): Promise<TrainingAttendanceEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_training_attendance WHERE tenant_id = $1 AND session_id = $2 AND staff_id = $3`,
        [tenantId, sessionId, staffId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapAttendance(row) : null;
    });
  }

  async listBySession(tenantId: string, sessionId: string): Promise<TrainingAttendanceEntity[]> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_training_attendance WHERE tenant_id = $1 AND session_id = $2 ORDER BY created_at, id`,
        [tenantId, sessionId],
      );
      return (res.rows as Row[]).map(mapAttendance);
    });
  }

  async listByStaff(tenantId: string, staffId: string): Promise<TrainingAttendanceEntity[]> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_training_attendance WHERE tenant_id = $1 AND staff_id = $2 ORDER BY created_at, id`,
        [tenantId, staffId],
      );
      return (res.rows as Row[]).map(mapAttendance);
    });
  }
}

export class PgCertificationRepository extends PgBase implements CertificationRepository {
  async create(
    data: Omit<CertificationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CertificationEntity> {
    return this.run(data.tenantId, async (c) => {
      const res = await c.query(
        `INSERT INTO hr_certifications
           (id, tenant_id, staff_id, program_id, certification_name, issued_date, expiry_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.staffId,
          data.programId,
          data.certificationName,
          data.issuedDate,
          data.expiryDate,
          data.status,
        ],
      );
      return mapCertification(res.rows[0] as Row);
    });
  }

  async findById(id: string, tenantId: string): Promise<CertificationEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_certifications WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapCertification(row) : null;
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<CertificationEntity>,
  ): Promise<CertificationEntity | null> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `UPDATE hr_certifications SET
           certification_name = COALESCE($3, certification_name),
           issued_date        = COALESCE($4, issued_date),
           expiry_date        = CASE WHEN $5::boolean THEN $6 ELSE expiry_date END,
           status             = COALESCE($7, status)
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [
          id,
          tenantId,
          data.certificationName ?? null,
          data.issuedDate ?? null,
          data.expiryDate !== undefined,
          data.expiryDate ?? null,
          data.status ?? null,
        ],
      );
      const row = res.rows[0] as Row | undefined;
      return row ? mapCertification(row) : null;
    });
  }

  async list(
    tenantId: string,
    filter: CertificationFilter,
    p: PaginationOptions,
  ): Promise<PaginatedResult<CertificationEntity>> {
    return this.run(tenantId, async (c) => {
      const params: unknown[] = [tenantId];
      const where = ['tenant_id = $1'];
      if (filter.staffId) {
        params.push(filter.staffId);
        where.push(`staff_id = $${params.length}`);
      }
      if (filter.status) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      if (filter.programId) {
        params.push(filter.programId);
        where.push(`program_id = $${params.length}`);
      }
      const clause = where.join(' AND ');
      const total = await c.query(
        `SELECT COUNT(*)::int AS n FROM hr_certifications WHERE ${clause}`,
        params,
      );
      const rows = await c.query(
        `SELECT * FROM hr_certifications WHERE ${clause}
         ORDER BY issued_date DESC, created_at DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, p.pageSize, (p.page - 1) * p.pageSize],
      );
      return paginate(
        (rows.rows as Row[]).map(mapCertification),
        Number((total.rows[0] as { n: number }).n),
        p,
      );
    });
  }

  async findExpiredCertifications(
    tenantId: string,
    asOfDate: string,
  ): Promise<CertificationEntity[]> {
    return this.run(tenantId, async (c) => {
      const res = await c.query(
        `SELECT * FROM hr_certifications
         WHERE tenant_id = $1 AND status = 'ACTIVE' AND expiry_date IS NOT NULL AND expiry_date <= $2::date
         ORDER BY expiry_date, id`,
        [tenantId, asOfDate],
      );
      return (res.rows as Row[]).map(mapCertification);
    });
  }
}
