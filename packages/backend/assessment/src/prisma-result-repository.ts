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

import type {
  AssessmentResultEntity,
  AssessmentResultRepository,
} from './result-repository.js';

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

export class PrismaAssessmentResultRepository implements AssessmentResultRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(
    data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AssessmentResultEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) =>
      upsertInTx(tx, data),
    );
  }

  async bulkUpsert(
    data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<AssessmentResultEntity[]> {
    if (data.length === 0) return [];
    const tenantId = data[0]!.tenantId;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const results: AssessmentResultEntity[] = [];
      for (const entry of data) {
        results.push(await upsertInTx(tx, entry));
      }
      return results;
    });
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
