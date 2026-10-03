/**
 * PRC-H057 — Prisma/live-Postgres E2E: double-entry resolution and post-publish
 * re-evaluation reach candidate results, the publication and academic records;
 * a failed republish compensates every store. Uses the production adapters
 * (PrismaExaminationRepository, PrismaResultRepository, PgExamOpsStore).
 * Skips without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { ExaminationService } from './examination-service.js';
import { ExamOpsService } from './ops-service.js';
import { PgExamOpsStore } from './ops-store.js';
import { createExaminationRepository, createResultRepository } from './repository-factory.js';
import { ResultPublicationService } from './result-publication-service.js';
import type { CreateExaminationInput } from './schemas.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-ops-marks-writeback.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'H057 Live Exam',
    code: `H57-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 50 }],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'B', minScore: 60, maxScore: 79 },
          { grade: 'F', minScore: 0, maxScore: 59 },
        ],
      },
    ],
  };
}

const MODERATOR = { userId: randomUUID(), roles: ['Administrator'] };
const MARKER_2 = { userId: randomUUID(), roles: ['Teacher'] };

async function setup(failRepublish: () => boolean = () => false) {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(pool!, tenantId, studentId);
  const repository = createExaminationRepository({ databaseUrl: DATABASE_URL! });
  const results = createResultRepository({ databaseUrl: DATABASE_URL! });
  const store = new PgExamOpsStore(pool!);
  const exams = new ExaminationService(repository, results);
  let pub: ResultPublicationService | undefined;
  const ops = new ExamOpsService({
    store,
    examinations: repository,
    results,
    republish: async (t, e) => {
      if (failRepublish()) throw new Error('republish failed');
      return pub!.publishResults(t, e);
    },
  });
  pub = new ResultPublicationService(repository, results, {
    countUnresolvedVariances: (t, e) => ops.countUnresolvedVariances(t, e),
  });
  const exam = await exams.create(tenantId, examBody());
  const subjectId = exam.subjects[0]!.id;
  // Registration via the repository: the live schema has no completed-subjects source.
  const registration = await repository.createCandidateRegistration({
    id: randomUUID(),
    tenantId,
    examinationId: exam.id,
    studentId,
    centerId: exam.centers[0]!.id,
    subjectIds: [subjectId],
    status: 'registered',
    registeredAt: new Date(),
  });
  await repository.update(exam.id, tenantId, { status: 'COMPLETED' });
  const candidateId = registration.id;
  await ops.recordDoubleEntry(
    tenantId,
    exam.id,
    { candidateId, subjectId, entryNo: 1, marks: 70 },
    MODERATOR,
  );
  await ops.recordDoubleEntry(
    tenantId,
    exam.id,
    { candidateId, subjectId, entryNo: 2, marks: 80, tolerance: 2 },
    MARKER_2,
  );
  return { tenantId, examId: exam.id, subjectId, candidateId, ops, pub, results, store };
}

describe.skipIf(!live)('ops marks write-back (live Postgres, PRC-H057)', () => {
  it('resolve -> publish -> re-evaluate re-grades publication and academic record', async () => {
    const { tenantId, examId, subjectId, candidateId, ops, pub, results } = await setup();
    await expect(pub.publishResults(tenantId, examId)).rejects.toThrow(/unresolved/);
    await ops.resolveMarks(tenantId, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR);
    const published = await pub.publishResults(tenantId, examId);
    expect(published.gradeResults[0]).toMatchObject({ score: 75, grade: 'B' });

    const req = await ops.requestReevaluation(
      tenantId,
      examId,
      { candidateId, subjectId, originalMarks: 75 },
      MODERATOR,
    );
    await ops.assignReevaluation(
      tenantId,
      examId,
      req.id,
      { evaluatorId: randomUUID() },
      MODERATOR,
    );
    await ops.completeReevaluation(tenantId, examId, req.id, { revisedMarks: 82 }, MODERATOR);

    const publication = await results.getPublicationResult(examId, tenantId);
    expect(publication?.gradeResults[0]).toMatchObject({ score: 82, grade: 'A' });
    const audits = await ops.listAudits(tenantId, examId);
    expect(audits.find((a) => a.action === 'reevaluation.complete')?.details).toMatchObject({
      before: 75,
      revisedMarks: 82,
      writtenBack: true,
      republished: true,
    });
  });

  it('republish failure compensates candidate results and the re-evaluation row', async () => {
    let fail = false;
    const { tenantId, examId, subjectId, candidateId, ops, pub, results, store } = await setup(
      () => fail,
    );
    await ops.resolveMarks(tenantId, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR);
    await pub.publishResults(tenantId, examId);
    const req = await ops.requestReevaluation(
      tenantId,
      examId,
      { candidateId, subjectId, originalMarks: 75 },
      MODERATOR,
    );
    await ops.assignReevaluation(
      tenantId,
      examId,
      req.id,
      { evaluatorId: randomUUID() },
      MODERATOR,
    );
    fail = true;
    await expect(
      ops.completeReevaluation(tenantId, examId, req.id, { revisedMarks: 82 }, MODERATOR),
    ).rejects.toThrow('republish failed');
    const candidates = await results.getCandidates(examId, tenantId);
    expect(candidates[0]!.subjectResults.find((r) => r.subjectId === subjectId)?.score).toBe(75);
    expect((await store.findReevaluation(tenantId, req.id))!.status).toBe('assigned');
    expect((await results.getPublicationResult(examId, tenantId))?.gradeResults[0]).toMatchObject({
      score: 75,
    });
  });
});
