/**
 * Prisma Result Repository
 *
 * Production implementation of {@link ResultRepository} backed by PostgreSQL
 * via Prisma, RLS-safe through {@link withTenantTransaction} (tenantId also
 * kept in every `where` clause as defense-in-depth — including the methods
 * whose in-memory counterparts ignored tenantId).
 *
 * Schema mapping:
 * - `examination_candidates`: scalar candidate fields + a `subject_results`
 *   JSONB array of {@link CandidateSubjectResult}.
 * - `examination_publications` / `examination_result_analyses`: one row per
 *   (tenant, examination); the whole {@link PublicationResult} /
 *   {@link ResultAnalysis} aggregate is stored as a JSONB `payload`, written
 *   and read whole. Date fields (publishedAt / generatedAt) serialize to ISO
 *   strings inside the payload and are revived to `Date` on read.
 * - `examination_academic_records`: one append-only row per update.
 */
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  AcademicRecordUpdate,
  CandidateSubjectResult,
  ExaminationCandidate,
  PublicationResult,
  ResultAnalysis,
  ResultRepository,
} from './result-repository.js';

/** Serialize an aggregate (with Date fields) to a JSON-safe payload. */
function toJsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaResultRepository implements ResultRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getCandidates(examinationId: string, tenantId: string): Promise<ExaminationCandidate[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = await tx.examinationCandidate.findMany({
        where: { examinationId, tenantId },
      });
      return rows.map((row) => ({
        id: row.id,
        examinationId: row.examinationId,
        studentId: row.studentId,
        centerId: row.centerId,
        gender: row.gender as ExaminationCandidate['gender'],
        areaId: row.areaId,
        subjectResults: Array.isArray(row.subjectResults)
          ? (row.subjectResults as unknown as CandidateSubjectResult[])
          : [],
      }));
    });
  }

  async upsertCandidates(tenantId: string, candidates: ExaminationCandidate[]): Promise<void> {
    if (candidates.length === 0) return;
    await withTenantTransaction(this.prisma, tenantId, async (tx) => {
      for (const candidate of candidates) {
        const subjectResults = toJsonPayload(candidate.subjectResults);
        await tx.examinationCandidate.upsert({
          where: {
            tenantId_examinationId_studentId: {
              tenantId,
              examinationId: candidate.examinationId,
              studentId: candidate.studentId,
            },
          },
          create: {
            id: candidate.id,
            tenantId,
            examinationId: candidate.examinationId,
            studentId: candidate.studentId,
            centerId: candidate.centerId,
            gender: candidate.gender,
            areaId: candidate.areaId,
            subjectResults,
          },
          update: {
            centerId: candidate.centerId,
            gender: candidate.gender,
            areaId: candidate.areaId,
            subjectResults,
          },
        });
      }
    });
  }

  async savePublicationResult(result: PublicationResult): Promise<void> {
    await withTenantTransaction(this.prisma, result.tenantId, async (tx) => {
      const payload = toJsonPayload(result);
      await tx.examinationPublication.upsert({
        where: {
          tenantId_examinationId: {
            tenantId: result.tenantId,
            examinationId: result.examinationId,
          },
        },
        create: {
          tenantId: result.tenantId,
          examinationId: result.examinationId,
          publishedAt: result.publishedAt,
          payload,
        },
        update: {
          publishedAt: result.publishedAt,
          payload,
        },
      });
    });
  }

  async getPublicationResult(
    examinationId: string,
    tenantId: string,
  ): Promise<PublicationResult | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.examinationPublication.findFirst({
        where: { examinationId, tenantId },
      });
      if (!row) return null;
      const payload = row.payload as unknown as PublicationResult;
      return { ...payload, publishedAt: new Date(payload.publishedAt) };
    });
  }

  async updateAcademicRecords(tenantId: string, updates: AcademicRecordUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    await withTenantTransaction(this.prisma, tenantId, async (tx) => {
      await tx.examinationAcademicRecord.createMany({
        data: updates.map((update) => ({
          tenantId,
          studentId: update.studentId,
          examinationId: update.examinationId,
          subjectId: update.subjectId,
          score: update.score,
          grade: update.grade,
          passed: update.passed,
          publishedAt: update.publishedAt,
        })),
      });
    });
  }

  async saveResultAnalysis(analysis: ResultAnalysis): Promise<void> {
    await withTenantTransaction(this.prisma, analysis.tenantId, async (tx) => {
      const payload = toJsonPayload(analysis);
      await tx.examinationResultAnalysis.upsert({
        where: {
          tenantId_examinationId: {
            tenantId: analysis.tenantId,
            examinationId: analysis.examinationId,
          },
        },
        create: {
          tenantId: analysis.tenantId,
          examinationId: analysis.examinationId,
          generatedAt: analysis.generatedAt,
          payload,
        },
        update: {
          generatedAt: analysis.generatedAt,
          payload,
        },
      });
    });
  }

  async getResultAnalysis(examinationId: string, tenantId: string): Promise<ResultAnalysis | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.examinationResultAnalysis.findFirst({
        where: { examinationId, tenantId },
      });
      if (!row) return null;
      const payload = row.payload as unknown as ResultAnalysis;
      return { ...payload, generatedAt: new Date(payload.generatedAt) };
    });
  }
}
