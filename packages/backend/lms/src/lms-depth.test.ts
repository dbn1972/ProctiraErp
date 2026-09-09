import { randomUUID } from 'node:crypto';

import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { createLmsFileDownloadToken, verifyLmsFileDownloadToken } from './lms-file-store.js';
import { LmsService } from './lms-service.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SCHOOL = randomUUID();

const admin = { userId: randomUUID(), roles: ['admin'], institutions: [] as string[] };
const teacher = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };

function service() {
  return new LmsService(new InMemoryLmsRepository());
}

describe('LMS depth — question bank + quiz from bank', () => {
  it('assembles a mixed quiz, auto-grades objective items, rubric-grades essays, and reports item difficulty', async () => {
    const svc = service();
    const rubric = await svc.createRubric(
      TENANT_A,
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
          {
            name: 'Evidence',
            maxPoints: 4,
            levels: [
              { label: 'Thin', points: 1 },
              { label: 'Rich', points: 4 },
            ],
          },
        ],
      },
      teacher,
    );

    const mcq = await svc.createBankQuestion(
      TENANT_A,
      {
        scope: 'school',
        institutionId: SCHOOL,
        subject: 'Maths',
        gradeLevel: '7',
        tags: ['fractions', 'g915'],
        questionType: 'mcq',
        prompt: '1/2 + 1/2',
        payload: { options: ['1', '2'], correctOptionIndex: 0 },
        points: 1,
      },
      teacher,
    );
    const msq = await svc.createBankQuestion(
      TENANT_A,
      {
        scope: 'school',
        institutionId: SCHOOL,
        subject: 'Maths',
        gradeLevel: '7',
        tags: ['g915'],
        questionType: 'msq',
        prompt: 'Pick the even numbers',
        payload: { options: ['1', '2', '4'], correctOptionIndexes: [1, 2], partialCredit: true },
        points: 2,
      },
      teacher,
    );
    const essay = await svc.createBankQuestion(
      TENANT_A,
      {
        scope: 'school',
        institutionId: SCHOOL,
        subject: 'Maths',
        gradeLevel: '7',
        tags: ['g915'],
        questionType: 'essay',
        prompt: 'Explain equivalent fractions',
        payload: { rubricId: rubric.id },
        points: 8,
        rubricId: rubric.id,
      },
      teacher,
    );

    const tagged = await svc.listBankQuestions(
      TENANT_A,
      { institutionId: SCHOOL, tags: ['fractions'] },
      { page: 1, pageSize: 20 },
      teacher,
    );
    expect(tagged.data.map((q) => q.id)).toEqual([mcq.id]);

    const quiz = await svc.createAssignment(
      TENANT_A,
      {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'quiz',
        title: 'Depth quiz',
        subject: 'Maths',
        gradeLevel: '7A',
        publish: true,
        bankQuestionIds: [mcq.id, msq.id, essay.id],
      },
      teacher,
    );
    expect(quiz.questions).toHaveLength(3);

    const studentId = randomUUID();
    const submission = await svc.submit(
      TENANT_A,
      quiz.id,
      {
        studentId,
        institutionId: SCHOOL,
        answers: [
          { questionId: quiz.questions[0]!.id, selectedOptionIndex: 0 },
          { questionId: quiz.questions[1]!.id, selectedOptionIndexes: [1] },
          { questionId: quiz.questions[2]!.id, essayText: 'They name the same amount.' },
        ],
      },
      { userId: studentId, roles: ['student'], institutions: [SCHOOL] },
    );
    expect(submission.status).toBe('submitted');
    expect(submission.score).toBe(2);

    const graded = await svc.gradeWithRubric(
      TENANT_A,
      submission.id,
      {
        questionId: quiz.questions[2]!.id,
        scores: rubric.criteria.map((c) => ({
          criterionId: c.id,
          questionId: quiz.questions[2]!.id,
          levelIndex: 1,
          points: 4,
        })),
      },
      teacher,
    );
    expect(graded.status).toBe('graded');
    expect(graded.score).toBe(10);

    const analytics = await svc.getQuizAnalytics(TENANT_A, quiz.id, teacher);
    expect(analytics.submissionCount).toBe(1);
    expect(analytics.items[0]?.difficulty).toBe(1);
    expect(analytics.items[1]?.difficulty).toBe(0);
    expect(analytics.mean).toBe(10);

    const classAnalytics = await svc.getClassAnalytics(
      TENANT_A,
      { classKey: '7A', institutionId: SCHOOL },
      teacher,
    );
    expect(classAnalytics.assignmentCount).toBe(1);
    expect(classAnalytics.submissionCount).toBe(1);
    expect(classAnalytics.averageScore).toBe(10);
  });

  it('isolates bank questions across tenants', async () => {
    const svc = service();
    const created = await svc.createBankQuestion(
      TENANT_A,
      {
        scope: 'school',
        institutionId: SCHOOL,
        subject: 'Maths',
        questionType: 'numeric',
        prompt: 'π to 2 dp',
        payload: { correctValue: 3.14, tolerance: 0.01 },
      },
      admin,
    );
    await expect(svc.getBankQuestion(TENANT_B, created.id, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const foreign = await svc.listBankQuestions(
      TENANT_B,
      {},
      { page: 1, pageSize: 20 },
      admin,
    );
    expect(foreign.data).toEqual([]);
  });

  it('pins and locks discussion threads', async () => {
    const svc = service();
    const thread = await svc.createDiscussion(
      TENANT_A,
      { institutionId: SCHOOL, classKey: '7A', title: 'Fractions' },
      teacher,
    );
    const post = await svc.createPost(
      TENANT_A,
      thread.id,
      { body: 'How do I simplify 4/8?' },
      { userId: randomUUID(), roles: ['student'], institutions: [SCHOOL] },
    );
    const pinned = await svc.pinPost(TENANT_A, thread.id, post.id, true, teacher);
    expect(pinned.pinned).toBe(true);
    await svc.lockDiscussion(TENANT_A, thread.id, true, teacher);
    await expect(
      svc.createPost(
        TENANT_A,
        thread.id,
        { body: 'Nope' },
        { userId: randomUUID(), roles: ['student'], institutions: [SCHOOL] },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const hidden = await svc.hidePost(TENANT_A, thread.id, post.id, true, teacher);
    expect(hidden.hidden).toBe(true);
    const studentView = await svc.getDiscussion(TENANT_A, thread.id, {
      userId: randomUUID(),
      roles: ['student'],
      institutions: [SCHOOL],
    });
    expect(studentView.posts).toHaveLength(0);
  });

  it('publishes lessons for students and hides drafts', async () => {
    const svc = service();
    const draft = await svc.createLesson(
      TENANT_A,
      {
        scope: 'school',
        institutionId: SCHOOL,
        title: 'Draft notes',
        description: 'Not ready',
      },
      teacher,
    );
    const published = await svc.createLesson(
      TENANT_A,
      {
        scope: 'school',
        institutionId: SCHOOL,
        title: 'Fractions notes',
        description: 'A fraction is a part of a whole.',
        published: true,
      },
      teacher,
    );
    await svc.addLessonResource(
      TENANT_A,
      published.id,
      { kind: 'link', title: 'Khan Academy', url: 'https://example.edu/fractions' },
      teacher,
    );
    const student = { userId: randomUUID(), roles: ['student'], institutions: [SCHOOL] };
    const listed = await svc.listLessons(
      TENANT_A,
      { institutionId: SCHOOL },
      { page: 1, pageSize: 20 },
      student,
    );
    expect(listed.data.map((c) => c.id)).toEqual([published.id]);
    await expect(svc.getLesson(TENANT_A, draft.id, student)).rejects.toBeInstanceOf(NotFoundError);
    const detail = await svc.getLesson(TENANT_A, published.id, student);
    expect(detail.resources).toHaveLength(1);
  });
});

describe('LMS file signed download', () => {
  it('binds the HMAC token to tenant + file id', () => {
    const fileId = randomUUID();
    const token = createLmsFileDownloadToken(TENANT_A, fileId, 60);
    expect(verifyLmsFileDownloadToken(TENANT_A, fileId, token.token).ok).toBe(true);
    expect(verifyLmsFileDownloadToken(TENANT_B, fileId, token.token).ok).toBe(false);
  });
});
