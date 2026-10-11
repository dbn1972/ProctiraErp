import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { LmsService } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL_A = randomUUID();
const SCHOOL_B = randomUUID();

const teacherA = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL_A] };
const teacherB = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL_B] };
const student = { userId: randomUUID(), roles: ['student'], institutions: [SCHOOL_A] };
const admin = { userId: randomUUID(), roles: ['admin'], institutions: [] as string[] };

function svc() {
  return new LmsService(new InMemoryLmsRepository());
}

describe('PRC-M298 — school scope fence on list reads', () => {
  it("does not leak another school's skills when no institutionId is passed", async () => {
    const s = svc();
    await s.createSkill(
      TENANT,
      { scope: 'school', institutionId: SCHOOL_A, code: 'A1', name: 'A skill', subject: 'Maths' },
      teacherA,
    );
    await s.createSkill(
      TENANT,
      { scope: 'school', institutionId: SCHOOL_B, code: 'B1', name: 'B skill', subject: 'Maths' },
      teacherB,
    );
    // teacherB passes NO institutionId — must still only see their own school.
    const listed = await s.listSkills(TENANT, {}, { page: 1, pageSize: 50 }, teacherB);
    const codes = listed.data.map((x) => x.code);
    expect(codes).toContain('B1');
    expect(codes).not.toContain('A1');
    // Tenant admin is unfenced and sees both.
    const all = await s.listSkills(TENANT, {}, { page: 1, pageSize: 50 }, admin);
    expect(all.data.map((x) => x.code).sort()).toEqual(['A1', 'B1']);
  });

  it("does not leak another school's content items", async () => {
    const s = svc();
    await s.createContentItem(
      TENANT,
      { scope: 'school', institutionId: SCHOOL_B, title: 'Secret B', kind: 'text', body: 'x' },
      teacherB,
    );
    const listed = await s.listContentItems(TENANT, {}, { page: 1, pageSize: 50 }, teacherA);
    expect(listed.data.map((x) => x.title)).not.toContain('Secret B');
  });
});

describe('NEW-g5_academic-003 — question bank answer keys are staff-only', () => {
  it('forbids learners from listing or fetching bank questions (which carry the answer key)', async () => {
    const s = svc();
    const q = await s.createBankQuestion(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL_A,
        subject: 'Maths',
        questionType: 'mcq',
        prompt: '1+1',
        payload: { options: ['1', '2'], correctOptionIndex: 1 },
        points: 1,
      },
      teacherA,
    );
    await expect(
      s.listBankQuestions(TENANT, {}, { page: 1, pageSize: 10 }, student),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(s.getBankQuestion(TENANT, q.id, student)).rejects.toMatchObject({
      statusCode: 403,
    });
    // Staff can still read it.
    const staffList = await s.listBankQuestions(TENANT, {}, { page: 1, pageSize: 10 }, teacherA);
    expect(staffList.data).toHaveLength(1);
  });
});

describe('PRC-M297 — MCQ answer key is required', () => {
  it('rejects an MCQ created without a correctOptionIndex instead of storing -1', async () => {
    const s = svc();
    await expect(
      s.createAssignment(
        TENANT,
        {
          scope: 'school',
          institutionId: SCHOOL_A,
          kind: 'quiz',
          title: 'Bad quiz',
          subject: 'Maths',
          questions: [
            {
              prompt: 'Pick one',
              questionType: 'mcq',
              options: ['a', 'b', 'c'],
              // no correctOptionIndex
            },
          ],
        },
        teacherA,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts an MCQ with an explicit correctOptionIndex', async () => {
    const s = svc();
    const quiz = await s.createAssignment(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL_A,
        kind: 'quiz',
        title: 'Good quiz',
        subject: 'Maths',
        questions: [
          {
            prompt: 'Pick one',
            questionType: 'mcq',
            options: ['a', 'b', 'c'],
            correctOptionIndex: 1,
          },
        ],
      },
      teacherA,
    );
    expect(quiz.questions[0]!.correctOptionIndex).toBe(1);
  });
});

describe('PRC-M304 — module endpoints enforce authz, scope, existence', () => {
  it('forbids learners from creating modules', async () => {
    const s = svc();
    await expect(
      s.createModule(TENANT, student.userId, { title: 'M1', institutionId: SCHOOL_A }, student),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('hides unpublished modules from learners and other schools', async () => {
    const s = svc();
    await s.createModule(
      TENANT,
      teacherA.userId,
      { title: 'Unpublished A', institutionId: SCHOOL_A, published: false },
      teacherA,
    );
    await s.createModule(
      TENANT,
      teacherA.userId,
      { title: 'Published A', institutionId: SCHOOL_A, published: true },
      teacherA,
    );
    // A student in school A sees only the published module.
    const asStudent = await s.listModules(TENANT, {}, student);
    expect(asStudent.map((m) => m.title)).toEqual(['Published A']);
    // A teacher in school B sees neither (scope fence).
    const asTeacherB = await s.listModules(TENANT, {}, teacherB);
    expect(asTeacherB).toHaveLength(0);
  });

  it('rejects a module item that references a non-existent target', async () => {
    const s = svc();
    const mod = await s.createModule(
      TENANT,
      teacherA.userId,
      { title: 'M', institutionId: SCHOOL_A, published: true },
      teacherA,
    );
    await expect(
      s.addModuleItem(
        TENANT,
        mod.id,
        { itemType: 'assignment', itemId: randomUUID(), title: 'ghost' },
        teacherA,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
