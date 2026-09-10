/**
 * LMS routes — Fastify inject tests (G-801 / G-802 / G-805).
 *
 * Covers board-vs-school visibility, cross-school IDOR, learner self-binding,
 * quiz auto-grading feeding the Spiral PAL ledger, and manual grading.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { lmsPlugin } from './lms-plugin.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const BOARD = randomUUID();
const SCHOOL_1 = randomUUID();
const SCHOOL_2 = randomUUID();
const STUDENT = randomUUID();
const OTHER_STUDENT = randomUUID();

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string }>;
  institutions: string[];
}

const boardAdmin: Principal = {
  sub: randomUUID(),
  roles: [{ roleId: 'admin', roleName: 'Admin', areaId: 'root' }],
  institutions: [],
};
const teacherSchool1: Principal = {
  sub: randomUUID(),
  roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: 'root' }],
  institutions: [SCHOOL_1],
};
const teacherSchool2: Principal = {
  sub: randomUUID(),
  roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: 'root' }],
  institutions: [SCHOOL_2],
};
const student: Principal = {
  sub: STUDENT,
  roles: [{ roleId: 'student', roleName: 'Student', areaId: 'root' }],
  institutions: [SCHOOL_1],
};

function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    const tenant = request.headers['x-tenant-id'];
    (request as unknown as { tenantId: string }).tenantId =
      typeof tenant === 'string' ? tenant : TENANT_A;
    const principal = request.headers['x-test-principal'];
    (request as unknown as { user: Principal | null }).user =
      typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
  });
  return app;
}

function as(principal: Principal, tenantId = TENANT_A) {
  return {
    'x-tenant-id': tenantId,
    'x-test-principal': JSON.stringify(principal),
  };
}

describe('LMS routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryLmsRepository;

  beforeEach(async () => {
    repository = new InMemoryLmsRepository();
    app = createApp();
    await app.register(lmsPlugin, { repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createSkill(code: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/lms/skills',
      headers: as(boardAdmin),
      payload: { scope: 'board', boardId: BOARD, code, name: code, subject: 'Maths', ...extra },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  describe('skills', () => {
    it('creates a board skill and rejects duplicates', async () => {
      await createSkill('FRAC');
      const dup = await app.inject({
        method: 'POST',
        url: '/lms/skills',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          code: 'frac',
          name: 'Fractions',
          subject: 'Maths',
        },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('requires boardId for board scope (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/lms/skills',
        headers: as(boardAdmin),
        payload: { scope: 'board', code: 'X', name: 'X', subject: 'Maths' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('students cannot create skills (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/lms/skills',
        headers: as(student),
        payload: {
          scope: 'school',
          institutionId: SCHOOL_1,
          code: 'X',
          name: 'X',
          subject: 'Maths',
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('assignments: board vs school scope', () => {
    it('school teacher sees own-school + board rows but not another school', async () => {
      const boardHw = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'homework',
          title: 'Board homework',
          subject: 'Maths',
          publish: true,
        },
      });
      expect(boardHw.statusCode).toBe(201);
      expect(boardHw.json()).toMatchObject({ status: 'published', scope: 'board', maxScore: 100 });

      const s1 = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(teacherSchool1),
        payload: {
          scope: 'school',
          institutionId: SCHOOL_1,
          kind: 'assignment',
          title: 'School 1 essay',
          subject: 'English',
        },
      });
      expect(s1.statusCode).toBe(201);

      const s2 = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(teacherSchool2),
        payload: {
          scope: 'school',
          institutionId: SCHOOL_2,
          kind: 'assignment',
          title: 'School 2 essay',
          subject: 'English',
        },
      });
      expect(s2.statusCode).toBe(201);

      const list = await app.inject({
        method: 'GET',
        url: `/lms/assignments?institutionId=${SCHOOL_1}&boardId=${BOARD}`,
        headers: as(teacherSchool1),
      });
      expect(list.statusCode).toBe(200);
      const titles = (list.json() as { data: Array<{ title: string }> }).data.map((a) => a.title);
      expect(titles.sort()).toEqual(['Board homework', 'School 1 essay']);

      // Without an explicit institution the school-bound teacher is pinned to
      // their own school (never sees School 2 rows).
      const implicit = await app.inject({
        method: 'GET',
        url: `/lms/assignments?boardId=${BOARD}`,
        headers: as(teacherSchool1),
      });
      const implicitTitles = (implicit.json() as { data: Array<{ title: string }> }).data.map(
        (a) => a.title,
      );
      expect(implicitTitles).not.toContain('School 2 essay');

      // Board admin without filters sees everything in the tenant.
      const all = await app.inject({
        method: 'GET',
        url: '/lms/assignments',
        headers: as(boardAdmin),
      });
      expect((all.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(3);
    });

    it('school teacher cannot author for another school or board-wide (403)', async () => {
      const other = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(teacherSchool1),
        payload: {
          scope: 'school',
          institutionId: SCHOOL_2,
          kind: 'assignment',
          title: 'Sneaky',
          subject: 'Maths',
        },
      });
      expect(other.statusCode).toBe(403);

      const board = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(teacherSchool1),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'assignment',
          title: 'Sneaky',
          subject: 'Maths',
        },
      });
      expect(board.statusCode).toBe(403);
    });

    it('cross-school IDOR by UUID returns 404 and cross-tenant returns 404', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(teacherSchool1),
        payload: {
          scope: 'school',
          institutionId: SCHOOL_1,
          kind: 'assignment',
          title: 'Private',
          subject: 'Maths',
        },
      });
      const id = (created.json() as { id: string }).id;

      const idor = await app.inject({
        method: 'GET',
        url: `/lms/assignments/${id}`,
        headers: as(teacherSchool2),
      });
      expect(idor.statusCode).toBe(404);

      const crossTenant = await app.inject({
        method: 'GET',
        url: `/lms/assignments/${id}`,
        headers: as(boardAdmin, TENANT_B),
      });
      expect(crossTenant.statusCode).toBe(404);

      const own = await app.inject({
        method: 'GET',
        url: `/lms/assignments/${id}`,
        headers: as(teacherSchool1),
      });
      expect(own.statusCode).toBe(200);
    });

    it('rejects questions on non-quiz kinds and enforces status transitions', async () => {
      const bad = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'homework',
          title: 'HW',
          subject: 'Maths',
          questions: [{ prompt: 'x', options: ['a', 'b'], correctOptionIndex: 0 }],
        },
      });
      expect(bad.statusCode).toBe(400);

      const draft = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'homework',
          title: 'HW',
          subject: 'Maths',
        },
      });
      const id = (draft.json() as { id: string }).id;

      const close = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${id}/close`,
        headers: as(boardAdmin),
      });
      expect(close.statusCode).toBe(422);

      const publish = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${id}/publish`,
        headers: as(boardAdmin),
      });
      expect(publish.statusCode).toBe(200);
      expect((publish.json() as { publishedAt: string | null }).publishedAt).not.toBeNull();

      const del = await app.inject({
        method: 'DELETE',
        url: `/lms/assignments/${id}`,
        headers: as(boardAdmin),
      });
      expect(del.statusCode).toBe(422);
    });

    it('a quiz cannot be published without questions', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'quiz',
          title: 'Q',
          subject: 'Maths',
          publish: true,
        },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('quiz submission → auto-grade → Spiral PAL', () => {
    async function createQuiz() {
      const frac = await createSkill('FRAC');
      const dec = await createSkill('DEC', { prerequisiteSkillIds: [frac.id] });
      const quiz = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'quiz',
          title: 'Fractions quiz',
          subject: 'Maths',
          publish: true,
          skillIds: [frac.id],
          questions: [
            {
              prompt: '1/2 + 1/2',
              options: ['1', '2', '1/4'],
              correctOptionIndex: 0,
              skillId: frac.id,
              points: 2,
            },
            {
              prompt: '0.5 as fraction',
              options: ['1/2', '1/5'],
              correctOptionIndex: 0,
              skillId: dec.id,
            },
            { prompt: 'no skill', options: ['a', 'b'], correctOptionIndex: 1 },
          ],
        },
      });
      expect(quiz.statusCode).toBe(201);
      const body = quiz.json() as {
        id: string;
        maxScore: number;
        questions: Array<{ id: string }>;
      };
      expect(body.maxScore).toBe(4);
      return { quiz: body, frac, dec };
    }

    it('hides the answer key from learners', async () => {
      const { quiz } = await createQuiz();
      const res = await app.inject({
        method: 'GET',
        url: `/lms/assignments/${quiz.id}`,
        headers: as(student),
      });
      expect(res.statusCode).toBe(200);
      const qs = (res.json() as { questions: Array<{ correctOptionIndex: number }> }).questions;
      expect(qs.every((q) => q.correctOptionIndex === -1)).toBe(true);
    });

    it('auto-grades, scales to maxScore, and updates mastery + attempts', async () => {
      const { quiz, frac, dec } = await createQuiz();
      const [q1, q2, q3] = quiz.questions;
      const res = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${quiz.id}/submissions`,
        headers: as(student),
        payload: {
          studentId: STUDENT,
          answers: [
            { questionId: q1!.id, selectedOptionIndex: 0 },
            { questionId: q2!.id, selectedOptionIndex: 1 },
            { questionId: q3!.id, selectedOptionIndex: 1 },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: 'graded', autoGraded: true, score: 3 });

      const progress = await app.inject({
        method: 'GET',
        url: `/lms/pal/students/${STUDENT}/progress`,
        headers: as(student),
      });
      expect(progress.statusCode).toBe(200);
      const rows = (
        progress.json() as {
          skills: Array<{
            skill: { id: string };
            mastery: { mastery: number; streak: number } | null;
          }>;
        }
      ).skills;
      const fracRow = rows.find((r) => r.skill.id === frac.id)!;
      const decRow = rows.find((r) => r.skill.id === dec.id)!;
      expect(fracRow.mastery?.mastery).toBeGreaterThan(0);
      expect(fracRow.mastery?.streak).toBe(1);
      expect(decRow.mastery?.mastery).toBe(0);
      expect(decRow.mastery?.streak).toBe(0);

      const attempts = await app.inject({
        method: 'GET',
        url: `/lms/pal/students/${STUDENT}/attempts`,
        headers: as(student),
      });
      expect((attempts.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(2);

      const dup = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${quiz.id}/submissions`,
        headers: as(student),
        payload: { studentId: STUDENT, answers: [{ questionId: q1!.id, selectedOptionIndex: 0 }] },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('students cannot submit or view plans as someone else (403)', async () => {
      const { quiz } = await createQuiz();
      const res = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${quiz.id}/submissions`,
        headers: as(student),
        payload: {
          studentId: OTHER_STUDENT,
          answers: [{ questionId: quiz.questions[0]!.id, selectedOptionIndex: 0 }],
        },
      });
      expect(res.statusCode).toBe(403);

      const plan = await app.inject({
        method: 'GET',
        url: `/lms/pal/students/${OTHER_STUDENT}/plan`,
        headers: as(student),
      });
      expect(plan.statusCode).toBe(403);
    });

    it('builds a spiral plan: due review first, blocked prerequisite excluded', async () => {
      const { frac, dec } = await createQuiz();
      // Miss FRAC → due tomorrow, low mastery; DEC blocked until FRAC mastered.
      const miss = await app.inject({
        method: 'POST',
        url: `/lms/pal/students/${STUDENT}/attempts`,
        headers: as(student),
        payload: { skillId: frac.id, correct: false },
      });
      expect(miss.statusCode).toBe(201);
      const plan = await app.inject({
        method: 'GET',
        url: `/lms/pal/students/${STUDENT}/plan?boardId=${BOARD}`,
        headers: as(student),
      });
      expect(plan.statusCode).toBe(200);
      const body = plan.json() as {
        items: Array<{ type: string; skillId: string }>;
        blockedSkillIds: string[];
        summary: { blocked: number };
      };
      expect(body.blockedSkillIds).toEqual([dec.id]);
      expect(body.items.map((i) => i.skillId)).not.toContain(dec.id);
      // FRAC has mastery 0 (<0.4) and is not yet due → reinforce.
      expect(body.items[0]).toMatchObject({ type: 'reinforce', skillId: frac.id });
    });
  });

  describe('homework submission and manual grading', () => {
    it('late submission is flagged, grading feeds PAL for linked skills, learner sees only own', async () => {
      const skill = await createSkill('ESSAY');
      const hw = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(teacherSchool1),
        payload: {
          scope: 'school',
          institutionId: SCHOOL_1,
          kind: 'homework',
          title: 'Essay',
          subject: 'English',
          maxScore: 10,
          skillIds: [skill.id],
          dueAt: '2000-01-01T00:00:00Z',
          publish: true,
        },
      });
      expect(hw.statusCode).toBe(201);
      const id = (hw.json() as { id: string }).id;

      const sub = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${id}/submissions`,
        headers: as(student),
        payload: { studentId: STUDENT, content: 'My essay' },
      });
      expect(sub.statusCode).toBe(201);
      expect((sub.json() as { status: string }).status).toBe('late');
      const submissionId = (sub.json() as { id: string }).id;

      const tooHigh = await app.inject({
        method: 'POST',
        url: `/lms/submissions/${submissionId}/grade`,
        headers: as(teacherSchool1),
        payload: { score: 11 },
      });
      expect(tooHigh.statusCode).toBe(400);

      const studentGrade = await app.inject({
        method: 'POST',
        url: `/lms/submissions/${submissionId}/grade`,
        headers: as(student),
        payload: { score: 10 },
      });
      expect(studentGrade.statusCode).toBe(403);

      const otherSchool = await app.inject({
        method: 'POST',
        url: `/lms/submissions/${submissionId}/grade`,
        headers: as(teacherSchool2),
        payload: { score: 9 },
      });
      expect(otherSchool.statusCode).toBe(404);

      const graded = await app.inject({
        method: 'POST',
        url: `/lms/submissions/${submissionId}/grade`,
        headers: as(teacherSchool1),
        payload: { score: 8, feedback: 'Good work', returnToStudent: true },
      });
      expect(graded.statusCode).toBe(200);
      expect(graded.json()).toMatchObject({
        status: 'returned',
        score: 8,
        gradedBy: teacherSchool1.sub,
      });

      const mastery = await repository.findMastery(TENANT_A, STUDENT, skill.id);
      expect(mastery?.correct).toBe(1);

      const own = await app.inject({
        method: 'GET',
        url: '/lms/submissions',
        headers: as({ ...student, sub: OTHER_STUDENT }),
      });
      expect((own.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(0);
    });

    it('blocks late submission when allowLate=false and unpublished drafts', async () => {
      const strict = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'assignment',
          title: 'Strict',
          subject: 'Maths',
          dueAt: '2000-01-01T00:00:00Z',
          allowLate: false,
          publish: true,
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${(strict.json() as { id: string }).id}/submissions`,
        headers: as(student),
        payload: { studentId: STUDENT, content: 'late' },
      });
      expect(res.statusCode).toBe(422);

      const draft = await app.inject({
        method: 'POST',
        url: '/lms/assignments',
        headers: as(boardAdmin),
        payload: {
          scope: 'board',
          boardId: BOARD,
          kind: 'assignment',
          title: 'Draft',
          subject: 'Maths',
        },
      });
      const hidden = await app.inject({
        method: 'GET',
        url: `/lms/assignments/${(draft.json() as { id: string }).id}`,
        headers: as(student),
      });
      expect(hidden.statusCode).toBe(404);
    });
  });

  it('returns 400 without tenant context', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/lms/assignments',
      headers: { 'x-tenant-id': '', 'x-test-principal': JSON.stringify(boardAdmin) },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('TENANT_REQUIRED');
  });
});
