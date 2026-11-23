/**
 * PRC-M194: curriculum writes are scoped to the subjects a teacher teaches.
 * A teacher-only caller cannot create or change units, lesson plans, coverage
 * or outcomes of another subject; coordinators act across subjects.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CurriculumTeachingScope } from './curriculum-access.js';
import { curriculumPlugin } from './plugin.js';
import { InMemoryCurriculumStore } from './store.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const TEACHER = '99999999-9999-4999-8999-999999999999';
const MATHS = '11111111-1111-4111-8111-111111111111';
const HISTORY = '44444444-4444-4444-8444-444444444444';
const GRADE = '22222222-2222-4222-8222-222222222222';
const PERIOD = '33333333-3333-4333-8333-333333333333';

/** The teacher teaches maths only. */
const teachingScope: CurriculumTeachingScope = {
  teachesSubject: async (_t, principals, subjectId) =>
    principals.includes(TEACHER) && subjectId === MATHS,
};

describe('curriculum teacher -> subject ownership (PRC-M194)', () => {
  let app: FastifyInstance;
  let roles: unknown[] = ['curriculum_coordinator'];
  let historyUnit = '';
  let historyPlan = '';
  let historyOutcome = '';

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = TENANT;
      (request as unknown as { user: unknown }).user = { sub: TEACHER, roles };
    });
    await app.register(curriculumPlugin, {
      store: new InMemoryCurriculumStore(),
      prefix: '/curriculum',
      teachingScope,
    });
    await app.ready();
    // A coordinator authors history content.
    roles = ['curriculum_coordinator'];
    const unit = await app.inject({
      method: 'POST',
      url: '/curriculum/units',
      payload: unitBody(HISTORY, 'H1'),
    });
    expect(unit.statusCode).toBe(201);
    historyUnit = (unit.json() as { id: string }).id;
    const plan = await app.inject({
      method: 'POST',
      url: `/curriculum/units/${historyUnit}/lesson-plans`,
      payload: { title: 'Empires' },
    });
    historyPlan = (plan.json() as { id: string }).id;
    const outcome = await app.inject({
      method: 'POST',
      url: '/curriculum/outcomes',
      payload: { subjectId: HISTORY, code: 'H-O1', statement: 'Explains causes' },
    });
    expect(outcome.statusCode).toBe(201);
    historyOutcome = (outcome.json() as { id: string }).id;
    roles = ['teacher'];
  });

  afterEach(async () => {
    await app.close();
  });

  function unitBody(subjectId: string, code: string) {
    return { subjectId, gradeId: GRADE, academicPeriodId: PERIOD, code, name: code };
  }

  it('a teacher cannot create a unit or outcome for a subject they do not teach', async () => {
    const unit = await app.inject({
      method: 'POST',
      url: '/curriculum/units',
      payload: unitBody(HISTORY, 'H2'),
    });
    expect(unit.statusCode).toBe(403);
    const outcome = await app.inject({
      method: 'POST',
      url: '/curriculum/outcomes',
      payload: { subjectId: HISTORY, code: 'H-O2', statement: 'x' },
    });
    expect(outcome.statusCode).toBe(403);
  });

  it("a teacher cannot plan, mark taught, edit or delete another subject's records", async () => {
    const attempts = [
      {
        method: 'POST' as const,
        url: `/curriculum/units/${historyUnit}/lesson-plans`,
        payload: { title: 'X' },
      },
      { method: 'POST' as const, url: `/curriculum/units/${historyUnit}/mark-taught`, payload: {} },
      { method: 'DELETE' as const, url: `/curriculum/units/${historyUnit}/coverage` },
      {
        method: 'PATCH' as const,
        url: `/curriculum/lesson-plans/${historyPlan}`,
        payload: { title: 'Y' },
      },
      { method: 'DELETE' as const, url: `/curriculum/lesson-plans/${historyPlan}` },
      {
        method: 'PATCH' as const,
        url: `/curriculum/outcomes/${historyOutcome}`,
        payload: { statement: 'Z' },
      },
      { method: 'DELETE' as const, url: `/curriculum/outcomes/${historyOutcome}` },
    ];
    for (const attempt of attempts) {
      const res = await app.inject(attempt);
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
    }
    const plans = await app.inject({
      method: 'GET',
      url: `/curriculum/units/${historyUnit}/lesson-plans`,
    });
    expect(plans.statusCode).toBe(200);
    expect((plans.json() as { data: Array<{ title: string }> }).data[0]?.title).toBe('Empires');
  });

  it('a teacher writes freely in the subject they teach', async () => {
    const unit = await app.inject({
      method: 'POST',
      url: '/curriculum/units',
      payload: unitBody(MATHS, 'M1'),
    });
    expect(unit.statusCode).toBe(201);
    const unitId = (unit.json() as { id: string }).id;
    const plan = await app.inject({
      method: 'POST',
      url: `/curriculum/units/${unitId}/lesson-plans`,
      payload: { title: 'Fractions' },
    });
    expect(plan.statusCode).toBe(201);
    const taught = await app.inject({
      method: 'POST',
      url: `/curriculum/units/${unitId}/mark-taught`,
      payload: {},
    });
    expect(taught.statusCode).toBe(200);
  });

  it('a roleName of "Curriculum Coordinator" on a teacher roleId stays bound', async () => {
    roles = [{ roleId: 'teacher', roleName: 'curriculum_coordinator' }];
    const res = await app.inject({
      method: 'POST',
      url: '/curriculum/units',
      payload: unitBody(HISTORY, 'H3'),
    });
    expect(res.statusCode).toBe(403);
  });
});
