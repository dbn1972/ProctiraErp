/**
 * Prisma Assessment Result Repository
 *
 * Production implementation of {@link AssessmentResultRepository} backed by
 * PostgreSQL via Prisma, RLS-safe through {@link withTenantTransaction}
 * (tenantId also kept in every `where` clause as defense-in-depth).
 *
 * Upsert key is the database unique constraint
 * `@@unique([tenantId, studentId, assessmentItemId])`; on update only the
 * score (and updatedAt) change — id and createdAt are preserved.
 */
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient, TenantTransactionClient } from '@proctira/database';

import type { AssessmentResultEntity, AssessmentResultRepository } from './result-repository.js';

interface AssessmentResultRow {
  id: string;
  tenantId: string;
  studentId: string;
  assessmentItemId: string;
  subjectId: string;
  academicPeriodId: string;
  score: number;
  createdAt: Date;
  updatedAt: Date;
}

function toEntity(row: AssessmentResultRow): AssessmentResultEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    assessmentItemId: row.assessmentItemId,
    subjectId: row.subjectId,
    academicPeriodId: row.academicPeriodId,
    score: row.score,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function upsertInTx(
  tx: TenantTransactionClient,
  data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>,
): Promise<AssessmentResultEntity> {
  const row = (await tx.assessmentResult.upsert({
    where: {
      tenantId_studentId_assessmentItemId: {
        tenantId: data.tenantId,
        studentId: data.studentId,
        assessmentItemId: data.assessmentItemId,
      },
    },
    create: {
      id: data.id,
      tenantId: data.tenantId,
      studentId: data.studentId,
      assessmentItemId: data.assessmentItemId,
      subjectId: data.subjectId,
      academicPeriodId: data.academicPeriodId,
      score: data.score,
    },
    update: {
      score: data.score,
    },
  })) as AssessmentResultRow;
  return toEntity(row);
}

/** PRC-M164: rows per UNNEST statement (keeps bind arrays bounded). */
export const BULK_UPSERT_CHUNK = 1000;

/**
 * PRC-M164: set-based upsert — one `INSERT ... SELECT FROM UNNEST(...) ON CONFLICT`
 * per chunk instead of one round-trip per row. Duplicate (student, item) keys in
 * the input keep the last value (ON CONFLICT cannot touch a row twice).
 * All values are bound parameters; tenant comes from the bound transaction.
 */
export async function bulkUpsertInTx(
  tx: TenantTransactionClient,
  tenantId: string,
  data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>[],
): Promise<AssessmentResultEntity[]> {
  const deduped = new Map<string, Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>>();
  for (const entry of data) {
    if (entry.tenantId !== tenantId) {
      throw new Error('bulkUpsert: all rows must belong to the same tenant');
    }
    deduped.set(`${entry.studentId}:${entry.assessmentItemId}`, entry);
  }
  const rows = [...deduped.values()];
  const out: AssessmentResultEntity[] = [];
  for (let i = 0; i < rows.length; i += BULK_UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + BULK_UPSERT_CHUNK);
    const returned = await tx.$queryRawUnsafe<AssessmentResultRow[]>(
      `INSERT INTO assessment_results
         (id, tenant_id, student_id, assessment_item_id, subject_id, academic_period_id, score, created_at, updated_at)
       SELECT u.id, $1::uuid, u.student_id, u.assessment_item_id, u.subject_id, u.academic_period_id, u.score, now(), now()
         FROM UNNEST($2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[], $7::float8[])
           AS u(id, student_id, assessment_item_id, subject_id, academic_period_id, score)
       ON CONFLICT (tenant_id, student_id, assessment_item_id)
         DO UPDATE SET score = EXCLUDED.score, updated_at = now()
       RETURNING id::text AS "id", tenant_id::text AS "tenantId", student_id::text AS "studentId",
                 assessment_item_id::text AS "assessmentItemId", subject_id::text AS "subjectId",
                 academic_period_id::text AS "academicPeriodId", score, created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      tenantId,
      chunk.map((r) => r.id),
      chunk.map((r) => r.studentId),
      chunk.map((r) => r.assessmentItemId),
      chunk.map((r) => r.subjectId),
      chunk.map((r) => r.academicPeriodId),
      chunk.map((r) => r.score),
    );
    out.push(...returned.map((r) => toEntity({ ...r, score: Number(r.score) })));
  }
  return out;
}

export class PrismaAssessmentResultRepository implements AssessmentResultRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(
    data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AssessmentResultEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => upsertInTx(tx, data));
  }

  async bulkUpsert(
    data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<AssessmentResultEntity[]> {
    if (data.length === 0) return [];
    const tenantId = data[0]!.tenantId;
    return withTenantTransaction(this.prisma, tenantId, async (tx) =>
      bulkUpsertInTx(tx, tenantId, data),
    );
  }

  async findByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.assessmentResult.findMany({
        where: { tenantId, studentId, subjectId, academicPeriodId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) as AssessmentResultRow[];
      return rows.map(toEntity);
    });
  }

  async findByStudentPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.assessmentResult.findMany({
        where: { tenantId, studentId, academicPeriodId },
        orderBy: [{ subjectId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })) as AssessmentResultRow[];
      return rows.map(toEntity);
    });
  }

  async findBySubjectPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.assessmentResult.findMany({
        where: { tenantId, subjectId, academicPeriodId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) as AssessmentResultRow[];
      return rows.map(toEntity);
    });
  }

  async findByAssessmentItem(
    tenantId: string,
    assessmentItemId: string,
  ): Promise<AssessmentResultEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.assessmentResult.findMany({
        where: { tenantId, assessmentItemId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) as AssessmentResultRow[];
      return rows.map(toEntity);
    });
  }

  async deleteByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<number> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.assessmentResult.deleteMany({
        where: { tenantId, studentId, subjectId, academicPeriodId },
      });
      return result.count;
    });
  }
}
