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
  PublicationVersion,
  PublicationVersionReason,
  ResultAnalysis,
  ResultRepository,
  SavePublicationOptions,
} from './result-repository.js';
import {
  MARKS_LOCKED_MESSAGE,
  UNKNOWN_AREA_ID,
  fingerprintCandidates,
  mergeSubjectResults,
  nextPublicationVersion,
  publicationPayloadSha256,
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

/** PRC-M240: unknown demographics are stored as NULL, never as a synthesised value. */
export function genderColumn(gender: ExaminationCandidate['gender']): string | null {
  return gender === 'unknown' ? null : gender;
}

/** PRC-M240: the nil-UUID domain sentinel is stored as NULL. */
export function areaColumn(areaId: string): string | null {
  return !areaId || areaId === UNKNOWN_AREA_ID ? null : areaId;
}

function rowToCandidate(row: {
  id: string;
  examinationId: string;
  studentId: string;
  centerId: string;
  gender: string | null;
  areaId: string | null;
  subjectResults: unknown;
}): ExaminationCandidate {
  return {
    id: row.id,
    examinationId: row.examinationId,
    studentId: row.studentId,
    centerId: row.centerId,
    // PRC-H057 / PRC-M240: NULL columns are the 'unknown' analysis bucket.
    gender: (row.gender ?? 'unknown') as ExaminationCandidate['gender'],
    areaId: row.areaId ?? UNKNOWN_AREA_ID,
    subjectResults: Array.isArray(row.subjectResults)
      ? (row.subjectResults as unknown as CandidateSubjectResult[])
      : [],
  };
}

interface PublicationVersionRow {
  version: number;
  reason: PublicationVersionReason;
  supersedes_version: number | null;
  published_at: Date | string;
  published_by: string | null;
  payload: unknown;
  payload_sha256: string | null;
}

/**
 * PRC-H057: append the next immutable publication version on the caller's
 * transaction. The caller holds the examination row lock, which serialises
 * concurrent publishes so version numbers never collide; the PK
 * (tenant, exam, version) is the backstop.
 */
async function appendPublicationVersion(
  tx: Tx,
  result: PublicationResult,
  payload: Prisma.InputJsonValue,
  options: SavePublicationOptions,
): Promise<void> {
  const latest = await tx.$queryRawUnsafe<Array<{ version: number | null }>>(
    `SELECT max(version) AS version FROM examination_publication_versions
      WHERE tenant_id = $1::uuid AND examination_id = $2::uuid`,
    result.tenantId,
    result.examinationId,
  );
  const latestVersion = latest[0]?.version == null ? null : Number(latest[0].version);
  const next = nextPublicationVersion(latestVersion, options.reason);
  const payloadJson = JSON.stringify(payload);
  await tx.$executeRawUnsafe(
    `INSERT INTO examination_publication_versions
       (tenant_id, examination_id, version, reason, supersedes_version,
        published_at, published_by, payload, payload_sha256)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    result.tenantId,
    result.examinationId,
    next.version,
    next.reason,
    next.supersedesVersion,
    result.publishedAt,
    options.publishedBy ?? null,
    payloadJson,
    publicationPayloadSha256(payloadJson),
  );
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
      // PRC-H057 / PRC-M240: NULL gender/area_id read back as the 'unknown' bucket.
      return rows.map(rowToCandidate);
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
            gender: genderColumn(candidate.gender),
            areaId: areaColumn(candidate.areaId),
            subjectResults,
          },
          update: {
            centerId: candidate.centerId,
            gender: genderColumn(candidate.gender),
            areaId: areaColumn(candidate.areaId),
            subjectResults,
          },
        });
      }
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
            gender: genderColumn(candidate.gender),
            areaId: areaColumn(candidate.areaId),
            subjectResults,
          },
          update: {
            centerId: candidate.centerId,
            gender: genderColumn(candidate.gender),
            areaId: areaColumn(candidate.areaId),
            subjectResults,
          },
        });
      }
    });
  }

  async savePublicationResult(
    result: PublicationResult,
    options: SavePublicationOptions = {},
  ): Promise<void> {
    await withTenantTransaction(this.prisma, result.tenantId, async (tx) => {
      // PRC-M239 / PRC-H057: lock first — serialises marks entry, publish and
      // version numbering for this examination.
      await lockExamination(tx, result.tenantId, result.examinationId);
      if (options.candidatesFingerprint !== undefined) {
        // PRC-M239: marks entered after the snapshot would be silently excluded.
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
      await appendPublicationVersion(tx, result, payload, options);
    });
  }

  async listPublicationVersions(
    examinationId: string,
    tenantId: string,
  ): Promise<PublicationVersion[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<PublicationVersionRow[]>(
        `SELECT version, reason, supersedes_version, published_at, published_by,
                payload, payload_sha256
           FROM examination_publication_versions
          WHERE tenant_id = $1::uuid AND examination_id = $2::uuid
          ORDER BY version ASC`,
        tenantId,
        examinationId,
      );
      return rows.map((row) => {
        const payload = row.payload as unknown as PublicationResult;
        return {
          examinationId,
          tenantId,
          version: Number(row.version),
          reason: row.reason,
          supersedesVersion: row.supersedes_version == null ? null : Number(row.supersedes_version),
          publishedAt: new Date(row.published_at),
          publishedBy: row.published_by,
          payloadSha256: row.payload_sha256 ?? '',
          payload: { ...payload, publishedAt: new Date(payload.publishedAt) },
        };
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
