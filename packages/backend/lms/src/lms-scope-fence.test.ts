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
