/**
 * Prisma Document Repository
 *
 * Production implementation of {@link DocumentRepository} backed by
 * PostgreSQL via Prisma, RLS-safe through {@link withTenantTransaction}
 * (tenantId also kept in every `where` clause as defense-in-depth).
 *
 * Job persistence maps 1:1 onto `examination_document_jobs`.
 *
 * The three document read-models (candidates, seating, results) have no
 * dedicated source tables — the in-memory implementation is test-seeded.
 * This implementation derives them conservatively from what is persisted:
 * - {@link getDocumentCandidates}: `examination_candidates` joined with the
 *   examination's JSONB `centers`/`subjects` and the `students` table for
 *   names; subject ids come from the candidate's registration when present,
 *   otherwise from the candidate's `subject_results`.
 * - {@link getSeatingAssignments}: persisted `exam_seating` rows (G-908) when
 *   an ops store is wired; otherwise [].
 * - {@link getCandidateResults}: derived from the persisted publication
 *   payload's gradeResults.
 */
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  CandidateResultData,
  DocumentCandidate,
  DocumentGenerationJob,
  DocumentRepository,
  SeatingAssignment,
} from './document-repository.js';
import type { ExaminationCenter, ExaminationSubject } from './examination-repository.js';
import type { ExamOpsStore } from './ops-store.js';
import type {
  CandidateGradeResult,
  CandidateSubjectResult,
  PublicationResult,
} from './result-repository.js';

interface JobRow {
  id: string;
  tenantId: string;
  examinationId: string;
  documentType: string;
  status: string;
  candidateIds: unknown;
  totalCandidates: number;
  processedCount: number;
  failedCount: number;
  errorMessage: string | null;
  outputPath: string | null;
  durationMs: number | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toJob(row: JobRow): DocumentGenerationJob {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examinationId: row.examinationId,
    documentType: row.documentType as DocumentGenerationJob['documentType'],
    status: row.status as DocumentGenerationJob['status'],
    candidateIds: jsonArray<string>(row.candidateIds),
    totalCandidates: row.totalCandidates,
    processedCount: row.processedCount,
    failedCount: row.failedCount,
    errorMessage: row.errorMessage ?? undefined,
    outputPath: row.outputPath ?? undefined,
    durationMs: row.durationMs ?? undefined,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
  };
}

export class PrismaDocumentRepository implements DocumentRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly seatingStore?: ExamOpsStore,
  ) {}

  /**
   * Derived read-model: `examination_candidates` joined with the parent
   * examination's JSONB `centers`/`subjects` and the `students` table.
   *
   * Mapping choices (documented, conservative):
   * - studentName: `Student.firstName + ' ' + Student.lastName`; falls back
   *   to the studentId if the student row is missing (cross-domain read).
   * - rollNumber: no roll-number source exists in the schema, so the
   *   candidate id is used as a stable, unique stand-in.
   * - subjectIds: from the candidate's registration (`subject_ids`) when one
   *   exists, otherwise derived from the candidate's `subject_results`.
   * - photoUrl: no source — omitted.
   */
  async getDocumentCandidates(
    examinationId: string,
    tenantId: string,
    candidateIds?: string[],
  ): Promise<DocumentCandidate[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { examinationId, tenantId };
      if (candidateIds && candidateIds.length > 0) {
        where['id'] = { in: candidateIds };
      }

      const [examination, candidates] = await Promise.all([
        tx.examination.findFirst({ where: { id: examinationId, tenantId } }),
        tx.examinationCandidate.findMany({ where }),
      ]);
      if (candidates.length === 0) return [];

      const centers = jsonArray<ExaminationCenter>(examination?.centers);
      const subjects = jsonArray<ExaminationSubject>(examination?.subjects);
      const centerNameById = new Map(centers.map((c) => [c.id, c.name]));
      const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

      const studentIds = [...new Set(candidates.map((c) => c.studentId))];
      const [students, registrations] = await Promise.all([
        tx.student.findMany({
          where: { tenantId, id: { in: studentIds }, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.examinationCandidateRegistration.findMany({
          where: { tenantId, examinationId, studentId: { in: studentIds } },
        }),
      ]);
      const studentById = new Map(students.map((s) => [s.id, s]));
      const registrationByStudentId = new Map(registrations.map((r) => [r.studentId, r]));

      return candidates.map((candidate) => {
        const student = studentById.get(candidate.studentId);
        const registration = registrationByStudentId.get(candidate.studentId);
        const subjectIds = registration
          ? jsonArray<string>(registration.subjectIds)
          : jsonArray<CandidateSubjectResult>(candidate.subjectResults).map((r) => r.subjectId);
        return {
          id: candidate.id,
          studentId: candidate.studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : candidate.studentId,
          rollNumber: candidate.id,
          centerId: candidate.centerId,
          centerName: centerNameById.get(candidate.centerId) ?? candidate.centerId,
          subjectIds,
          subjectNames: subjectIds.map((id) => subjectNameById.get(id) ?? id),
          gender: candidate.gender,
        };
      });
    });
  }

  /**
   * G-908: seating is persisted in `exam_seating` (db/sql/036) via ExamOpsStore.
   */
  async getSeatingAssignments(
    examinationId: string,
    tenantId: string,
    centerId?: string,
  ): Promise<SeatingAssignment[]> {
    if (!this.seatingStore) {
      return withTenantTransaction(this.prisma, tenantId, async () => []);
    }
    const seats = await this.seatingStore.listSeating(tenantId, examinationId);
    const mapped: SeatingAssignment[] = seats.map((row) => ({
      candidateId: row.candidateId,
      studentName: row.studentName,
      rollNumber: row.rollNumber,
      centerId: row.centerId,
      centerName: row.centerName,
      roomNumber: row.roomNumber,
      seatNumber: row.seatNumber,
      subjectNames: row.subjectNames,
    }));
    return centerId ? mapped.filter((a) => a.centerId === centerId) : mapped;
  }

  /**
   * Derived read-model: built from the persisted publication snapshot
   * (`examination_publications.payload.gradeResults`) joined with
   * `examination_candidates`, the examination's JSONB `subjects` (names and
   * maxScore) and the `students` table for names. Returns [] when no
   * publication exists yet (certificates require published results).
   *
   * Mapping choices (documented, conservative):
   * - rollNumber: candidate id (no roll-number source — same as
   *   getDocumentCandidates).
   * - maxPossibleScore: sum of `maxScore` of the subjects the candidate has
   *   grade results for.
   * - overallPassed: every graded subject passed.
   * - overallGrade: no per-candidate aggregate grade is computed or stored by
   *   result publication, so this is the coarse 'PASS' / 'FAIL' derived from
   *   overallPassed.
   */
  async getCandidateResults(
    examinationId: string,
    tenantId: string,
    candidateIds?: string[],
  ): Promise<CandidateResultData[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const publication = await tx.examinationPublication.findFirst({
        where: { examinationId, tenantId },
      });
      if (!publication) return [];

      const payload = publication.payload as unknown as PublicationResult;
      let gradeResults: CandidateGradeResult[] = Array.isArray(payload.gradeResults)
        ? payload.gradeResults
        : [];
      if (candidateIds && candidateIds.length > 0) {
        const wanted = new Set(candidateIds);
        gradeResults = gradeResults.filter((r) => wanted.has(r.candidateId));
      }
      if (gradeResults.length === 0) return [];

      const examination = await tx.examination.findFirst({
        where: { id: examinationId, tenantId },
      });
      const subjects = jsonArray<ExaminationSubject>(examination?.subjects);
      const subjectById = new Map(subjects.map((s) => [s.id, s]));

      const studentIds = [...new Set(gradeResults.map((r) => r.studentId))];
      const students = await tx.student.findMany({
        where: { tenantId, id: { in: studentIds }, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      });
      const studentById = new Map(students.map((s) => [s.id, s]));

      const byCandidate = new Map<string, CandidateGradeResult[]>();
      for (const result of gradeResults) {
        const group = byCandidate.get(result.candidateId);
        if (group) group.push(result);
        else byCandidate.set(result.candidateId, [result]);
      }

      return [...byCandidate.entries()].map(([candidateId, results]) => {
        const studentId = results[0]!.studentId;
        const student = studentById.get(studentId);
        const subjectRows = results.map((r) => {
          const subject = subjectById.get(r.subjectId);
          return {
            name: subject?.name ?? r.subjectId,
            score: r.score,
            grade: r.grade,
            passed: r.passed,
            maxScore: subject?.maxScore ?? 0,
          };
        });
        const overallPassed = subjectRows.every((s) => s.passed);
        return {
          candidateId,
          studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : studentId,
          rollNumber: candidateId,
          subjects: subjectRows.map(({ name, score, grade, passed }) => ({
            name,
            score,
            grade,
            passed,
          })),
          overallGrade: overallPassed ? 'PASS' : 'FAIL',
          overallPassed,
          totalScore: subjectRows.reduce((sum, s) => sum + s.score, 0),
          maxPossibleScore: subjectRows.reduce((sum, s) => sum + s.maxScore, 0),
        };
      });
    });
  }

  async createJob(job: DocumentGenerationJob): Promise<DocumentGenerationJob> {
    return withTenantTransaction(this.prisma, job.tenantId, async (tx) => {
      const row = (await tx.examinationDocumentJob.create({
        data: {
          id: job.id,
          tenantId: job.tenantId,
          examinationId: job.examinationId,
          documentType: job.documentType,
          status: job.status,
          candidateIds: job.candidateIds as unknown as Prisma.InputJsonValue,
          totalCandidates: job.totalCandidates,
          processedCount: job.processedCount,
          failedCount: job.failedCount,
          errorMessage: job.errorMessage ?? null,
          outputPath: job.outputPath ?? null,
          durationMs: job.durationMs ?? null,
          createdAt: job.createdAt,
          startedAt: job.startedAt ?? null,
          completedAt: job.completedAt ?? null,
        },
      })) as JobRow;
      return toJob(row);
    });
  }

  async updateJob(
    jobId: string,
    tenantId: string,
    updates: Partial<DocumentGenerationJob>,
  ): Promise<DocumentGenerationJob | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.examinationDocumentJob.findFirst({
        where: { id: jobId, tenantId },
      })) as JobRow | null;
      if (!existing) return null;

      // Merge semantics (same as in-memory): only provided fields overwrite.
      const merged: DocumentGenerationJob = { ...toJob(existing) };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId') continue;
        mergedRecord[key] = value;
      }

      const row = (await tx.examinationDocumentJob.update({
        where: { id: jobId },
        data: {
          examinationId: merged.examinationId,
          documentType: merged.documentType,
          status: merged.status,
          candidateIds: merged.candidateIds as unknown as Prisma.InputJsonValue,
          totalCandidates: merged.totalCandidates,
          processedCount: merged.processedCount,
          failedCount: merged.failedCount,
          errorMessage: merged.errorMessage ?? null,
          outputPath: merged.outputPath ?? null,
          durationMs: merged.durationMs ?? null,
          createdAt: merged.createdAt,
          startedAt: merged.startedAt ?? null,
          completedAt: merged.completedAt ?? null,
        },
      })) as JobRow;
      return toJob(row);
    });
  }

  async getJob(jobId: string, tenantId: string): Promise<DocumentGenerationJob | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.examinationDocumentJob.findFirst({
        where: { id: jobId, tenantId },
      })) as JobRow | null;
      return row ? toJob(row) : null;
    });
  }

  async listJobs(examinationId: string, tenantId: string): Promise<DocumentGenerationJob[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.examinationDocumentJob.findMany({
        where: { examinationId, tenantId },
        orderBy: { createdAt: 'asc' },
      })) as JobRow[];
      return rows.map(toJob);
    });
  }
}
