/**
 * PRC-M527 (failing-first, audit): LMS regulated mutations and file downloads emit exactly one
 * domain audit entry each through the injected `auditSink`, carrying tenantId, actorId,
 * entityType, entityId and action. Without a sink, behaviour is unchanged.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { LmsService, type LmsAuditEntry } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();
const teacher = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };

function harness() {
  const entries: LmsAuditEntry[] = [];
  const svc = new LmsService(new InMemoryLmsRepository(), {
    auditSink: async (entry) => {
      entries.push(entry);
    },
  });
  return { svc, entries };
}

function expectOne(entries: LmsAuditEntry[], action: string): LmsAuditEntry {
  const matching = entries.filter((e) => e.action === action);
  expect(matching, `audit entries for ${action}`).toHaveLength(1);
  const entry = matching[0]!;
  expect(entry.tenantId).toBe(TENANT);
  expect(entry.actorId).toBe(teacher.userId);
  expect(entry.entityType).toBeTruthy();
  expect(entry.entityId).toBeTruthy();
  return entry;
}

async function homework(svc: LmsService, publish: boolean) {
  return svc.createAssignment(
    TENANT,
    {
      scope: 'school',
      institutionId: SCHOOL,
      kind: 'homework',
      title: 'Reading log',
      subject: 'English',
      maxScore: 10,
      publish,
    },
    teacher,
  );
}

describe('PRC-M527 LMS domain audit', () => {
  it('audits publish and close of an assignment', async () => {
    const { svc, entries } = harness();
    const draft = await homework(svc, false);
    await svc.publishAssignment(TENANT, draft.id, teacher);
    await svc.closeAssignment(TENANT, draft.id, teacher);
    const published = expectOne(entries, 'assignment.publish');
    expect(published.entityId).toBe(draft.id);
    expect(published.before).toMatchObject({ status: 'draft' });
    expect(published.after).toMatchObject({ status: 'published' });
    const closed = expectOne(entries, 'assignment.close');
    expect(closed.after).toMatchObject({ status: 'closed' });
  });

  it('audits deleting a draft assignment', async () => {
    const { svc, entries } = harness();
    const draft = await homework(svc, false);
    await svc.deleteAssignment(TENANT, draft.id, teacher);
    const deleted = expectOne(entries, 'assignment.delete');
    expect(deleted.entityId).toBe(draft.id);
    expect(deleted.operation).toBe('DELETE');
  });

  it('audits a grade write with before/after score', async () => {
    const { svc, entries } = harness();
    const hw = await homework(svc, true);
    const studentId = randomUUID();
    const submission = await svc.submit(
      TENANT,
      hw.id,
      { studentId, institutionId: SCHOOL, content: 'done' },
      { userId: studentId, roles: ['student'], institutions: [SCHOOL] },
    );
    await svc.grade(TENANT, submission.id, { score: 8 }, teacher);
    const graded = expectOne(entries, 'submission.grade');
    expect(graded.entityId).toBe(submission.id);
    expect(graded.before).toMatchObject({ score: null });
    expect(graded.after).toMatchObject({ score: 8, status: 'graded' });
  });

  it('audits a rubric-score write with the per-criterion scores', async () => {
    const { svc, entries } = harness();
    const rubric = await svc.createRubric(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        name: 'Essay rubric',
        criteria: [
          {
            name: 'Argument',
            maxPoints: 4,
            levels: [
              { label: 'Weak', points: 1 },
              { label: 'Strong', points: 4 },
            ],
          },
        ],
      },
      teacher,
    );
    const essay = await svc.createBankQuestion(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        subject: 'English',
        questionType: 'essay',
        prompt: 'Argue a point',
        payload: { rubricId: rubric.id },
        points: 4,
        rubricId: rubric.id,
      },
      teacher,
    );
    const quiz = await svc.createAssignment(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'quiz',
        title: 'Essay quiz',
        subject: 'English',
        publish: true,
        maxScore: 4,
        bankQuestionIds: [essay.id],
      },
      teacher,
    );
    const studentId = randomUUID();
    const submission = await svc.submit(
      TENANT,
      quiz.id,
      {
        studentId,
        institutionId: SCHOOL,
        answers: [{ questionId: quiz.questions[0]!.id, essayText: 'Because.' }],
      },
      { userId: studentId, roles: ['student'], institutions: [SCHOOL] },
    );
    const criterion = rubric.criteria[0]!;
    await svc.gradeWithRubric(
      TENANT,
      submission.id,
      {
        questionId: quiz.questions[0]!.id,
        scores: [{ criterionId: criterion.id, levelIndex: 1, points: 4 }],
      },
      teacher,
    );
    const rubricGrade = expectOne(entries, 'submission.rubric_grade');
    expect(rubricGrade.entityId).toBe(submission.id);
    expect(rubricGrade.after).toMatchObject({
      score: 4,
      rubricScores: [{ criterionId: criterion.id, levelIndex: 1, points: 4 }],
    });
  });

  it('audits a file download as a read', async () => {
    const { svc, entries } = harness();
    const hw = await homework(svc, true);
    const file = await svc.uploadAssignmentFile(
      TENANT,
      hw.id,
      {
        filename: 'brief.pdf',
        mimeType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-1.4\n%test\n').toString('base64'),
      },
      teacher,
    );
    const signed = await svc.signedFileDownload(TENANT, file.id, teacher);
    await svc.downloadFile(TENANT, file.id, signed.token, teacher);
    const download = expectOne(entries, 'file.download');
    expect(download.entityId).toBe(file.id);
    expect(download.operation).toBe('CREATE');
    expect(download.metadata).toMatchObject({ read: true, assignmentId: hw.id });
  });

  it('without a sink, the same flows succeed unchanged', async () => {
    const svc = new LmsService(new InMemoryLmsRepository());
    const draft = await homework(svc, false);
    await svc.publishAssignment(TENANT, draft.id, teacher);
    const second = await homework(svc, false);
    await expect(svc.deleteAssignment(TENANT, second.id, teacher)).resolves.toBeUndefined();
  });
});
