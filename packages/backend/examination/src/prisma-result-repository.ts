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
import { BusinessRuleError, ConflictError } from '@proctira/common';
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
import {
  MARKS_LOCKED_MESSAGE,
  fingerprintCandidates,
  mergeSubjectResults,
} from './result-repository.js';

type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];

/** PRC-M239: serialise marks entry and publication per examination. */
async function lockExamination(tx: Tx, tenantId: string, examinationId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT id FROM examinations WHERE id = $1::uuid AND tenant_id = $2::uuid FOR UPDATE',
    examinationId,
    tenantId,
  );
}

function rowToCandidate(row: {
  id: string;
  examinationId: string;
  studentId: string;
  centerId: string;
  gender: string;
  areaId: string;
  subjectResults: unknown;
}): ExaminationCandidate {
  return {
    id: row.id,
    examinationId: row.examinationId,
    studentId: row.studentId,
    centerId: row.centerId,
    gender: row.gender as ExaminationCandidate['gender'],
    areaId: row.areaId,
    subjectResults: Array.isArray(row.subjectResults)
      ? (row.subjectResults as unknown as CandidateSubjectResult[])
      : [],
  };
}

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

  async deleteCandidates(
    tenantId: string,
    examinationId: string,
    studentIds: string[],
  ): Promise<void> {
    if (studentIds.length === 0) return;
    await withTenantTransaction(this.prisma, tenantId, async (tx) => {
      await tx.examinationCandidate.deleteMany({
        where: { tenantId, examinationId, studentId: { in: studentIds } },
      });
    });
  }

  async mergeCandidateMarks(
    tenantId: string,
    examinationId: string,
    candidates: ExaminationCandidate[],
  ): Promise<void> {
    if (candidates.length === 0) return;
    await withTenantTransaction(this.prisma, tenantId, async (tx) => {
      // PRC-M239: lock first, then check publication inside the same transaction.
      await lockExamination(tx, tenantId, examinationId);
      const published = await tx.examinationPublication.findUnique({
        where: { tenantId_examinationId: { tenantId, examinationId } },
      });
      if (published) throw new BusinessRuleError(MARKS_LOCKED_MESSAGE);
      const stored = await tx.examinationCandidate.findMany({
        where: { tenantId, examinationId, studentId: { in: candidates.map((c) => c.studentId) } },
      });
      const storedByStudent = new Map(stored.map((r) => [r.studentId, rowToCandidate(r)]));
      for (const candidate of candidates) {
        const current = storedByStudent.get(candidate.studentId);
        const id = current?.id ?? candidate.id;
        const subjectResults = toJsonPayload(
          mergeSubjectResults(current?.subjectResults ?? [], candidate.subjectResults, id),
        );
        await tx.examinationCandidate.upsert({
          where: {
            tenantId_examinationId_studentId: {
              tenantId,
              examinationId,
              studentId: candidate.studentId,
            },
          },
          create: {
            id,
            tenantId,
            examinationId,
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

  async savePublicationResult(
    result: PublicationResult,
    options: { candidatesFingerprint?: string } = {},
  ): Promise<void> {
    await withTenantTransaction(this.prisma, result.tenantId, async (tx) => {
      if (options.candidatesFingerprint !== undefined) {
        // PRC-M239: marks entered after the snapshot would be silently excluded.
        await lockExamination(tx, result.tenantId, result.examinationId);
        const rows = await tx.examinationCandidate.findMany({
          where: { tenantId: result.tenantId, examinationId: result.examinationId },
        });
        if (fingerprintCandidates(rows.map(rowToCandidate)) !== options.candidatesFingerprint) {
          throw new ConflictError('Marks changed while results were being published; retry');
        }
      }
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
