/**
 * Postgres-backed enrollment repository (raw `pg`, RLS via withPgTenant).
 *
 * G-701 — enrollments live in `enrollments` (db/sql/001); history and transfer
 * records live in `enrollment_history` / `transfer_records` (db/sql/021).
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withPgTenant, type PgQueryable } from '@proctira/database';

import type {
  EnrollmentEntity,
  EnrollmentFilter,
  EnrollmentHistoryEntity,
  EnrollmentRepository,
  InstitutionLookup,
  TransferRecordEntity,
} from './enrollment-repository.js';

export type EnrollmentPgPool = PgQueryable & { connect?: () => Promise<unknown> };

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapEnrollment(row: Record<string, unknown>): EnrollmentEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    institutionId: String(row.institution_id),
    gradeId: String(row.grade_id),
    classId: row.class_id == null ? null : String(row.class_id),
    academicPeriodId: String(row.academic_period_id),
    status: String(row.status) as EnrollmentEntity['status'],
    enrolledAt: toDate(row.enrolled_at),
    exitedAt: row.exited_at == null ? null : toDate(row.exited_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapHistory(row: Record<string, unknown>): EnrollmentHistoryEntity {
  return {
    id: String(row.id),
    enrollmentId: String(row.enrollment_id),
    previousStatus: row.previous_status == null ? null : String(row.previous_status),
    newStatus: String(row.new_status),
    effectiveDate: toDate(row.effective_date),
    institutionId: String(row.institution_id),
    academicPeriodId: String(row.academic_period_id),
    reason: row.reason == null ? null : String(row.reason),
    createdAt: toDate(row.created_at),
  };
}

function mapTransfer(row: Record<string, unknown>): TransferRecordEntity {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    studentId: String(row.student_id),
    sourceInstitutionId: String(row.source_institution_id),
    sourceEnrollmentId: String(row.source_enrollment_id),
    destinationInstitutionId: String(row.destination_institution_id),
    destinationEnrollmentId: String(row.destination_enrollment_id),
    transferDate: toDate(row.transfer_date),
    reason: String(row.reason),
    createdAt: toDate(row.created_at),
  };
}

export class PgEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly pool: EnrollmentPgPool) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async createEnrollment(
    data: Omit<EnrollmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<EnrollmentEntity> {
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO enrollments (
           id, tenant_id, student_id, institution_id, grade_id, class_id,
           academic_period_id, status, enrolled_at, exited_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::enrollment_status,$9::date,$10::date)
         RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.institutionId,
          data.gradeId,
          data.classId,
          data.academicPeriodId,
          data.status,
          data.enrolledAt,
          data.exitedAt,
        ],
      );
      return mapEnrollment(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateEnrollment(
    id: string,
    tenantId: string,
    data: Partial<EnrollmentEntity>,
  ): Promise<EnrollmentEntity | null> {
    return this.withTenant(tenantId, async (client) => {
      const existing = await client.query(
        `SELECT * FROM enrollments WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      const row = existing.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      const current = mapEnrollment(row);
      const next = { ...current, ...data, id: current.id, tenantId: current.tenantId };
      const result = await client.query(
        `UPDATE enrollments
           SET student_id = $3, institution_id = $4, grade_id = $5, class_id = $6,
               academic_period_id = $7, status = $8::enrollment_status,
               enrolled_at = $9::date, exited_at = $10::date, updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          next.studentId,
          next.institutionId,
          next.gradeId,
          next.classId,
          next.academicPeriodId,
          next.status,
          next.enrolledAt,
          next.exitedAt,
        ],
      );
      return mapEnrollment(result.rows[0] as Record<string, unknown>);
    });
  }

  async findEnrollmentById(id: string, tenantId: string): Promise<EnrollmentEntity | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM enrollments WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapEnrollment(row) : null;
    });
  }

  async listEnrollments(
    tenantId: string,
    filter: EnrollmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<EnrollmentEntity>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      const push = (clause: string, value: unknown) => {
        values.push(value);
        where.push(`${clause} $${values.length}`);
      };
      if (filter.studentId) push('student_id =', filter.studentId);
      if (filter.institutionId) push('institution_id =', filter.institutionId);
      if (filter.academicPeriodId) push('academic_period_id =', filter.academicPeriodId);
      if (filter.status) push('status =', filter.status);

      const whereSql = where.join(' AND ');
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS count FROM enrollments WHERE ${whereSql}`,
        values,
      );
      const totalItems = Number((countResult.rows[0] as { count: number }).count);
      const offset = (pagination.page - 1) * pagination.pageSize;
      const rows = await client.query(
        `SELECT * FROM enrollments WHERE ${whereSql}
         ORDER BY enrolled_at DESC, created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pagination.pageSize, offset],
      );
      return {
        data: rows.rows.map((r) => mapEnrollment(r as Record<string, unknown>)),
        meta: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pagination.pageSize) || 0,
        },
      };
    });
  }

  async createHistoryEntry(
    data: Omit<EnrollmentHistoryEntity, 'createdAt'>,
  ): Promise<EnrollmentHistoryEntity> {
    // History rows are tenant-scoped through the parent enrollment; look up the
    // tenant so RLS is bound before the insert.
    const tenantRow = await this.pool.query(
      `SELECT tenant_id FROM enrollments WHERE id = $1 LIMIT 1`,
      [data.enrollmentId],
    );
    const tenantId = String(
      (tenantRow.rows[0] as { tenant_id?: unknown } | undefined)?.tenant_id ?? '',
    );
    if (!tenantId) throw new Error(`Enrollment ${data.enrollmentId} not found for history entry`);
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO enrollment_history (
           id, tenant_id, enrollment_id, previous_status, new_status, effective_date,
           institution_id, academic_period_id, reason
         ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9) RETURNING *`,
        [
          data.id,
          tenantId,
          data.enrollmentId,
          data.previousStatus,
          data.newStatus,
          data.effectiveDate,
          data.institutionId,
          data.academicPeriodId,
          data.reason,
        ],
      );
      return mapHistory(result.rows[0] as Record<string, unknown>);
    });
  }

  async getEnrollmentHistory(
    tenantId: string,
    studentId: string,
  ): Promise<EnrollmentHistoryEntity[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT h.* FROM enrollment_history h
           JOIN enrollments e ON e.id = h.enrollment_id
         WHERE h.tenant_id = $1 AND e.student_id = $2
         ORDER BY h.created_at DESC`,
        [tenantId, studentId],
      );
      return result.rows.map((r) => mapHistory(r as Record<string, unknown>));
    });
  }

  async getHistoryByEnrollmentId(enrollmentId: string): Promise<EnrollmentHistoryEntity[]> {
    const tenantRow = await this.pool.query(
      `SELECT tenant_id FROM enrollments WHERE id = $1 LIMIT 1`,
      [enrollmentId],
    );
    const tenantId = String(
      (tenantRow.rows[0] as { tenant_id?: unknown } | undefined)?.tenant_id ?? '',
    );
    if (!tenantId) return [];
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM enrollment_history WHERE enrollment_id = $1 ORDER BY created_at DESC`,
        [enrollmentId],
      );
      return result.rows.map((r) => mapHistory(r as Record<string, unknown>));
    });
  }

  async createTransferRecord(
    data: Omit<TransferRecordEntity, 'createdAt'>,
  ): Promise<TransferRecordEntity> {
    return this.withTenant(data.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO transfer_records (
           id, tenant_id, student_id, source_institution_id, source_enrollment_id,
           destination_institution_id, destination_enrollment_id, transfer_date, reason
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9) RETURNING *`,
        [
          data.id,
          data.tenantId,
          data.studentId,
          data.sourceInstitutionId,
          data.sourceEnrollmentId,
          data.destinationInstitutionId,
          data.destinationEnrollmentId,
          data.transferDate,
          data.reason,
        ],
      );
      return mapTransfer(result.rows[0] as Record<string, unknown>);
    });
  }

  async getTransferRecords(tenantId: string, studentId: string): Promise<TransferRecordEntity[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM transfer_records WHERE tenant_id = $1 AND student_id = $2
         ORDER BY created_at DESC`,
        [tenantId, studentId],
      );
      return result.rows.map((r) => mapTransfer(r as Record<string, unknown>));
    });
  }

  async findInstitutionById(id: string, tenantId: string): Promise<InstitutionLookup | null> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, status FROM institutions WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      const row = result.rows[0] as { id: unknown; status: unknown } | undefined;
      return row ? { id: String(row.id), status: String(row.status) } : null;
    });
  }
}
