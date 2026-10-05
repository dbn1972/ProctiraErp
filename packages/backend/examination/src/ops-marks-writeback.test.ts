/**
 * PRC-H057 — double-entry resolution and re-evaluation completion must reach
 * candidate marks, publication and academic records; unresolved variances
 * block publication; audit reports before/after instead of `published: true`.
 */
import { randomUUID } from 'node:crypto';
import { BusinessRuleError } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { ExamOpsService } from './ops-service.js';
import { InMemoryExamOpsStore } from './ops-store.js';
import { ResultPublicationService } from './result-publication-service.js';
import type { CreateExaminationInput } from './schemas.js';

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function examBody(): CreateExaminationInput {
  return {
    name: 'Board Exam',
    code: `EX-${randomUUID().slice(0, 8).toUpperCase()}`,
    academicPeriodId: randomUUID(),
    startDate: futureDate(7),
    endDate: futureDate(9),
    subjects: [{ name: 'Mathematics', code: 'MATH', maxScore: 100 }],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: randomUUID(), capacity: 200 }],
    gradingSchemes: [
      {
        name: 'Standard',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'B', minScore: 60, maxScore: 79 },
          { grade: 'C', minScore: 40, maxScore: 59 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
  };
}

const TENANT = randomUUID();
const MODERATOR = { userId: randomUUID(), roles: ['Administrator'] };
const MARKER_2 = { userId: randomUUID(), roles: ['Teacher'] };

describe('ops marks write-back (PRC-H057)', () => {
  let repository: InMemoryExaminationRepository;
  let results: InMemoryResultRepository;
  let publisher: ResultPublicationService;
  let ops: ExamOpsService;
  let examId: string;
  let subjectId: string;
  let candidateId: string;
  let studentId: string;

  beforeEach(async () => {
    repository = new InMemoryExaminationRepository();
    results = new InMemoryResultRepository();
    const exams = new ExaminationService(repository);
    // Same wiring as examination-plugin.
    let pub: ResultPublicationService | undefined;
    ops = new ExamOpsService({
      store: new InMemoryExamOpsStore(),
      examinations: repository,
      results,
      republish: (t, e) => pub!.publishResults(t, e),
    });
    pub = new ResultPublicationService(repository, results, {
      countUnresolvedVariances: (t, e) => ops.countUnresolvedVariances(t, e),
    });
    publisher = pub;

    studentId = randomUUID();
    repository.setStudentEnrollment({
      studentId,
      status: 'enrolled',
      institutionId: randomUUID(),
      completedSubjectCodes: ['MATH'],
    });
    const exam = await exams.create(TENANT, examBody());
    examId = exam.id;
    subjectId = exam.subjects[0]!.id;
    const registration = await exams.registerCandidate(TENANT, examId, {
      studentId,
      centerId: exam.centers[0]!.id,
      subjectIds: [subjectId],
    });
    candidateId = registration.id;
    await repository.update(examId, TENANT, { status: 'COMPLETED' });
  });

  async function enterVariancePair(): Promise<void> {
    await ops.recordDoubleEntry(
      TENANT,
      examId,
      { candidateId, subjectId, entryNo: 1, marks: 70 },
      MODERATOR,
    );
    await ops.recordDoubleEntry(
      TENANT,
      examId,
      { candidateId, subjectId, entryNo: 2, marks: 80, tolerance: 2 },
      MARKER_2,
    );
  }

  it('blocks publication while a variance pair is unresolved', async () => {
    await enterVariancePair();
    await expect(publisher.publishResults(TENANT, examId)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('enter two marks, resolve, publish -> result equals the resolved value', async () => {
    await enterVariancePair();
    await ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR);

    const published = await publisher.publishResults(TENANT, examId);
    expect(published.gradeResults).toHaveLength(1);
    expect(published.gradeResults[0]).toMatchObject({
      studentId,
      subjectId,
      score: 75,
      grade: 'B',
    });

    const audit = (await ops.listAudits(TENANT, examId)).find((a) => a.action === 'marks.resolve');
    expect(audit?.details).toMatchObject({
      before: null,
      finalMarks: 75,
      writtenBack: true,
      republished: false,
    });
  });

  it('completing re-evaluation after publish re-grades publication and academic records', async () => {
    await enterVariancePair();
    await ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR);
    await publisher.publishResults(TENANT, examId);

    const req = await ops.requestReevaluation(
      TENANT,
      examId,
      { candidateId, subjectId, originalMarks: 75 },
      MODERATOR,
    );
    await ops.assignReevaluation(TENANT, examId, req.id, { evaluatorId: randomUUID() }, MODERATOR);
    await ops.completeReevaluation(TENANT, examId, req.id, { revisedMarks: 82 }, MODERATOR);

    const publication = await results.getPublicationResult(examId, TENANT);
    expect(publication?.gradeResults[0]).toMatchObject({ score: 82, grade: 'A' });

    const records = results.getAcademicRecordUpdates().filter((r) => r.studentId === studentId);
    expect(records.at(-1)).toMatchObject({ subjectId, score: 82, grade: 'A' });

    const audit = (await ops.listAudits(TENANT, examId)).find(
      (a) => a.action === 'reevaluation.complete',
    );
    expect(audit?.details).toMatchObject({
      before: 75,
      revisedMarks: 82,
      writtenBack: true,
      republished: true,
    });
    expect(audit?.details['published']).toBeUndefined();
  });

  /** Re-wire `ops` with a republish that can be made to fail, plus a certificate spy. */
  function rewire(opts: { failRepublish?: () => boolean } = {}) {
    const store = new InMemoryExamOpsStore();
    const certificateCalls: string[][] = [];
    let pub: ResultPublicationService | undefined;
    ops = new ExamOpsService({
      store,
      examinations: repository,
      results,
      republish: async (t, e) => {
        if (opts.failRepublish?.()) throw new Error('republish failed');
        return pub!.publishResults(t, e);
      },
      regenerateCertificates: async (_t, _e, ids) => {
        certificateCalls.push(ids);
      },
    });
    pub = new ResultPublicationService(repository, results, {
      countUnresolvedVariances: (t, e) => ops.countUnresolvedVariances(t, e),
    });
    publisher = pub;
    return { store, certificateCalls };
  }

  it('re-evaluation after publish requests certificate regeneration for that candidate', async () => {
    const { certificateCalls } = rewire();
    await enterVariancePair();
    await ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR);
    expect(certificateCalls).toEqual([]); // not yet published
    await publisher.publishResults(TENANT, examId);
    const req = await ops.requestReevaluation(
      TENANT,
      examId,
      { candidateId, subjectId, originalMarks: 75 },
      MODERATOR,
    );
    await ops.assignReevaluation(TENANT, examId, req.id, { evaluatorId: randomUUID() }, MODERATOR);
    await ops.completeReevaluation(TENANT, examId, req.id, { revisedMarks: 82 }, MODERATOR);
    // Certificates are keyed by the RESULT-STORE candidate id (what publication
    // gradeResults carry and the document repository filters by), not the
    // registration id.
    const [resultCandidate] = await results.getCandidates(examId, TENANT);
    const resultCandidateId = resultCandidate!.id;
    expect(resultCandidateId).not.toBe(candidateId);
    expect(certificateCalls).toEqual([[resultCandidateId]]);
    const publication = await results.getPublicationResult(examId, TENANT);
    const certificateTargets = publication!.gradeResults.filter((g) =>
      certificateCalls[0]!.includes(g.candidateId),
    );
    expect(certificateTargets).toHaveLength(1);
    expect(certificateTargets[0]).toMatchObject({ studentId, subjectId, score: 82 });
    const audit = (await ops.listAudits(TENANT, examId)).find(
      (a) => a.action === 'reevaluation.complete',
    );
    expect(audit?.details).toMatchObject({ certificates: 'requested' });
  });

  it('republish failure compensates: candidate marks, re-evaluation and publication unchanged', async () => {
    let fail = false;
    const { store, certificateCalls } = rewire({ failRepublish: () => fail });
    await enterVariancePair();
    await ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR);
    await publisher.publishResults(TENANT, examId);
    const req = await ops.requestReevaluation(
      TENANT,
      examId,
      { candidateId, subjectId, originalMarks: 75 },
      MODERATOR,
    );
    await ops.assignReevaluation(TENANT, examId, req.id, { evaluatorId: randomUUID() }, MODERATOR);

    fail = true;
    await expect(
      ops.completeReevaluation(TENANT, examId, req.id, { revisedMarks: 82 }, MODERATOR),
    ).rejects.toThrow('republish failed');

    const candidates = await results.getCandidates(examId, TENANT);
    expect(candidates[0]!.subjectResults.find((r) => r.subjectId === subjectId)?.score).toBe(75);
    expect((await store.findReevaluation(TENANT, req.id))!.status).toBe('assigned');
    const publication = await results.getPublicationResult(examId, TENANT);
    expect(publication?.gradeResults[0]).toMatchObject({ score: 75 });
    expect(certificateCalls).toEqual([]);
    const audits = await ops.listAudits(TENANT, examId);
    expect(audits.find((a) => a.action === 'reevaluation.complete')).toBeUndefined();
    expect(audits.find((a) => a.action === 'reevaluation.complete.failed')?.details).toMatchObject({
      rolledBack: true,
      revisedMarks: 82,
    });

    // Retry succeeds once the publisher recovers.
    fail = false;
    await ops.completeReevaluation(TENANT, examId, req.id, { revisedMarks: 82 }, MODERATOR);
    expect((await results.getPublicationResult(examId, TENANT))?.gradeResults[0]).toMatchObject({
      score: 82,
    });
  });

  it('re-evaluation write-back failure never marks the request completed (retryable)', async () => {
    const { store } = rewire();
    await enterVariancePair();
    await ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR);
    await publisher.publishResults(TENANT, examId);
    const req = await ops.requestReevaluation(
      TENANT,
      examId,
      { candidateId, subjectId, originalMarks: 75 },
      MODERATOR,
    );
    await ops.assignReevaluation(TENANT, examId, req.id, { evaluatorId: randomUUID() }, MODERATOR);

    // Write-back fails, and so would any compensating ops-store update.
    const originalUpsert = results.upsertCandidates.bind(results);
    const originalUpdate = store.updateReevaluation.bind(store);
    const statusWrites: string[] = [];
    results.upsertCandidates = async () => {
      throw new Error('result store down');
    };
    store.updateReevaluation = async (tenantId, id, patch) => {
      if (patch.status) statusWrites.push(patch.status);
      if (patch.status === 'assigned') throw new Error('ops store down');
      return originalUpdate(tenantId, id, patch);
    };
    await expect(
      ops.completeReevaluation(TENANT, examId, req.id, { revisedMarks: 82 }, MODERATOR),
    ).rejects.toThrow('result store down');
    expect(statusWrites).toEqual([]);
    expect((await store.findReevaluation(TENANT, req.id))!.status).toBe('assigned');

    // Retry succeeds once the result store recovers.
    results.upsertCandidates = originalUpsert;
    store.updateReevaluation = originalUpdate;
    const done = await ops.completeReevaluation(
      TENANT,
      examId,
      req.id,
      { revisedMarks: 82 },
      MODERATOR,
    );
    expect(done.status).toBe('completed');
    expect((await results.getPublicationResult(examId, TENANT))?.gradeResults[0]).toMatchObject({
      score: 82,
    });
  });

  it('compensation deletes a candidate row the unit created (no phantom candidate)', async () => {
    const { store } = rewire();
    // No resolved marks yet -> no result-store candidate row for this student.
    expect(await results.getCandidates(examId, TENANT)).toEqual([]);
    const req = await ops.requestReevaluation(
      TENANT,
      examId,
      { candidateId, subjectId },
      MODERATOR,
    );
    await ops.assignReevaluation(TENANT, examId, req.id, { evaluatorId: randomUUID() }, MODERATOR);

    const originalUpdate = store.updateReevaluation.bind(store);
    store.updateReevaluation = async (tenantId, id, patch) => {
      if (patch.status === 'completed') throw new Error('ops store down');
      return originalUpdate(tenantId, id, patch);
    };
    await expect(
      ops.completeReevaluation(TENANT, examId, req.id, { revisedMarks: 82 }, MODERATOR),
    ).rejects.toThrow('ops store down');
    store.updateReevaluation = originalUpdate;

    expect(await results.getCandidates(examId, TENANT)).toEqual([]);
    expect((await store.findReevaluation(TENANT, req.id))!.status).toBe('assigned');
  });

  it('resolve after publish: republish failure removes the newly created candidate row', async () => {
    let fail = false;
    const { store } = rewire({ failRepublish: () => fail });
    // Published with no marks rows yet (registration only -> incomplete).
    await publisher.publishResults(TENANT, examId);
    await enterVariancePair();
    fail = true;
    await expect(
      ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR),
    ).rejects.toThrow('republish failed');
    expect(await results.getCandidates(examId, TENANT)).toEqual([]);
    const pair = await store.findMarksPair(TENANT, examId, candidateId, subjectId);
    expect(pair.every((p) => p.finalMarks === null)).toBe(true);
  });

  it('write-back failure on resolve restores the marks pair to unresolved', async () => {
    const { store } = rewire();
    await enterVariancePair();
    const original = results.upsertCandidates.bind(results);
    results.upsertCandidates = async () => {
      throw new Error('result store down');
    };
    await expect(
      ops.resolveMarks(TENANT, examId, { candidateId, subjectId, finalMarks: 75 }, MODERATOR),
    ).rejects.toThrow('result store down');
    results.upsertCandidates = original;
    const pair = await store.findMarksPair(TENANT, examId, candidateId, subjectId);
    expect(pair.every((p) => p.finalMarks === null && p.resolvedBy === null)).toBe(true);
    expect(await ops.countUnresolvedVariances(TENANT, examId)).toBe(1);
  });
});
