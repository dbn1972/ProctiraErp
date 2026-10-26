import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { curriculumPlugin } from './plugin.js';
import { MAX_LESSON_PLAN_UNIT_IDS } from './schemas.js';
import { InMemoryCurriculumStore } from './store.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const SUBJECT = '11111111-1111-4111-8111-111111111111';
const GRADE = '22222222-2222-4222-8222-222222222222';
const PERIOD = '33333333-3333-4333-8333-333333333333';

describe('curriculum routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = TENANT;
    });
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
        sub: 'test-user',
        roles: ['teacher'],
      };
    });

    await app.register(curriculumPlugin, {
      store: new InMemoryCurriculumStore(),
      prefix: '/curriculum',
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lesson plan → mark taught → coverage %', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/curriculum/units',
      payload: {
        subjectId: SUBJECT,
        gradeId: GRADE,
        academicPeriodId: PERIOD,
        code: 'NS',
        name: 'Number systems',
      },
    });
    expect(created.statusCode).toBe(201);
    const unit = created.json() as { id: string };

    const plan = await app.inject({
      method: 'POST',
      url: `/curriculum/units/${unit.id}/lesson-plans`,
      payload: { title: 'Counting', plannedDate: '2026-06-02' },
    });
    expect(plan.statusCode).toBe(201);

    const taught = await app.inject({
      method: 'POST',
      url: `/curriculum/units/${unit.id}/mark-taught`,
      payload: {},
    });
    expect(taught.statusCode).toBe(200);

    const coverage = await app.inject({
      method: 'GET',
      url: `/curriculum/coverage?subjectId=${SUBJECT}&gradeId=${GRADE}&academicPeriodId=${PERIOD}`,
    });
    expect(coverage.statusCode).toBe(200);
    expect(coverage.json()).toMatchObject({ planned: 1, taught: 1, percent: 100 });
  });

  describe('PRC-H022 lesson-plan institution ownership', () => {
    const SCHOOL_A = '44444444-4444-4444-8444-444444444444';
    const SCHOOL_B = '55555555-5555-4555-8555-555555555555';
    async function planOfSchoolA(): Promise<string> {
      const unit = await app.inject({
        method: 'POST',
        url: '/curriculum/units',
        payload: {
          institutionId: SCHOOL_A,
          subjectId: SUBJECT,
          gradeId: GRADE,
          academicPeriodId: PERIOD,
          code: 'FR',
          name: 'Fractions',
        },
      });
      expect(unit.statusCode).toBe(201);
      const plan = await app.inject({
        method: 'POST',
        url: `/curriculum/units/${(unit.json() as { id: string }).id}/lesson-plans`,
        payload: { title: 'Halves' },
      });
      expect(plan.statusCode).toBe(201);
      return (plan.json() as { id: string }).id;
    }
    it('PATCH/DELETE without institutionId are rejected (400)', async () => {
      const id = await planOfSchoolA();
      const patch = await app.inject({
        method: 'PATCH',
        url: `/curriculum/lesson-plans/${id}`,
        payload: { title: 'x' },
      });
      expect(patch.statusCode).toBe(400);
      const del = await app.inject({ method: 'DELETE', url: `/curriculum/lesson-plans/${id}` });
      expect(del.statusCode).toBe(400);
    });
    it('PATCH/DELETE naming another institution 404 and leave the plan intact', async () => {
      const id = await planOfSchoolA();
      const patch = await app.inject({
        method: 'PATCH',
        url: `/curriculum/lesson-plans/${id}?institutionId=${SCHOOL_B}`,
        payload: { title: 'Hijacked' },
      });
      expect(patch.statusCode).toBe(404);
      const del = await app.inject({
        method: 'DELETE',
        url: `/curriculum/lesson-plans/${id}?institutionId=${SCHOOL_B}`,
      });
      expect(del.statusCode).toBe(404);
      const own = await app.inject({
        method: 'PATCH',
        url: `/curriculum/lesson-plans/${id}?institutionId=${SCHOOL_A}`,
        payload: { title: 'Quarters' },
      });
      expect(own.statusCode).toBe(200);
      expect(own.json()).toMatchObject({ title: 'Quarters' });
      const ownDelete = await app.inject({
        method: 'DELETE',
        url: `/curriculum/lesson-plans/${id}?institutionId=${SCHOOL_A}`,
      });
      expect(ownDelete.statusCode).toBe(204);
    });
  });
  describe('PRC-H004 school-bound caller, curriculum record addressed only by id', () => {
    it('a teacher of another school gets 404 on unit sub-routes and lesson-plan writes', async () => {
      await app.close();
      let caller: Record<string, unknown> = { sub: 'admin', roles: ['teacher'] };
      app = Fastify({ logger: false });
      app.addHook('onRequest', async (request) => {
        (request as { tenantId?: string }).tenantId = TENANT;
      });
      app.decorateRequest('user', undefined);
      app.addHook('onRequest', async (request) => {
        (request as typeof request & { user: unknown }).user = caller;
      });
      await app.register(curriculumPlugin, {
        store: new InMemoryCurriculumStore(),
        prefix: '/curriculum',
      });
      await app.ready();
      const SCHOOL_A = '66666666-6666-4666-8666-666666666666';
      const SCHOOL_B = '77777777-7777-4777-8777-777777777777';
      const unit = await app.inject({
        method: 'POST',
        url: '/curriculum/units',
        payload: {
          institutionId: SCHOOL_A,
          subjectId: SUBJECT,
          gradeId: GRADE,
          academicPeriodId: PERIOD,
          code: 'GE',
          name: 'Geometry',
        },
      });
      const unitId = (unit.json() as { id: string }).id;
      const plan = await app.inject({
        method: 'POST',
        url: `/curriculum/units/${unitId}/lesson-plans`,
        payload: { title: 'Angles' },
      });
      const planId = (plan.json() as { id: string }).id;
      caller = { sub: 't-b', roles: ['teacher'], institutions: [SCHOOL_B] };
      const create = await app.inject({
        method: 'POST',
        url: `/curriculum/units/${unitId}/lesson-plans`,
        payload: { title: 'Injected' },
      });
      expect(create.statusCode).toBe(404);
      const taught = await app.inject({
        method: 'POST',
        url: `/curriculum/units/${unitId}/mark-taught`,
        payload: {},
      });
      expect(taught.statusCode).toBe(404);
      const patch = await app.inject({
        method: 'PATCH',
        url: `/curriculum/lesson-plans/${planId}?institutionId=${SCHOOL_A}`,
        payload: { title: 'Hijacked' },
      });
      expect(patch.statusCode).toBe(404);
      caller = { sub: 't-a', roles: ['teacher'], institutions: [SCHOOL_A] };
      const own = await app.inject({
        method: 'PATCH',
        url: `/curriculum/lesson-plans/${planId}?institutionId=${SCHOOL_A}`,
        payload: { title: 'Right angles' },
      });
      expect(own.statusCode).toBe(200);
    });
  });
  describe('W1-SEC-02 package RBAC', () => {
    it('returns 403 when roles are empty (fail closed)', async () => {
      await app.close();
      app = Fastify({ logger: false });
      app.addHook('onRequest', async (request) => {
        (request as { tenantId?: string }).tenantId = TENANT;
      });
      app.decorateRequest('user', undefined);
      app.addHook('onRequest', async (request) => {
        (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
          sub: 'test-user',
          roles: [],
        };
      });
      await app.register(curriculumPlugin, {
        store: new InMemoryCurriculumStore(),
        prefix: '/curriculum',
      });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/curriculum/units',
        payload: {
          subjectId: SUBJECT,
          gradeId: GRADE,
          academicPeriodId: PERIOD,
          code: 'NS',
          name: 'Number systems',
        },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('SEC-2 tenant resolution', () => {
    it('rejects a request that only supplies x-tenant-id via header (no user.tenantId, no request.tenantId)', async () => {
      await app.close();
      app = Fastify({ logger: false });
      // Deliberately do NOT set request.tenantId here (unlike the outer beforeEach),
      // to simulate a request that never went through a trusted tenant-resolution hook.
      app.decorateRequest('user', undefined);
      app.addHook('onRequest', async (request) => {
        (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
          sub: 'test-user',
          roles: ['teacher'],
        };
      });
      await app.register(curriculumPlugin, {
        store: new InMemoryCurriculumStore(),
        prefix: '/curriculum',
      });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/curriculum/units',
        headers: { 'x-tenant-id': TENANT },
        payload: {
          subjectId: SUBJECT,
          gradeId: GRADE,
          academicPeriodId: PERIOD,
          code: 'NS',
          name: 'Number systems',
        },
      });

      // Must NOT resolve a tenant from the header and proceed (201) or leak
      // via any other success path; it must fail the tenant-context check.
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  // PRC-L288: PATCH bodies, :id params and list filters are validated (400, not a
  // Postgres 22P02/22007 500) and nullable fields can be cleared with `null`.
  describe('PRC-L288 input validation and clearing', () => {
    const SCHOOL = '88888888-8888-4888-8888-888888888888';
    let store: InMemoryCurriculumStore;

    beforeEach(async () => {
      await app.close();
      store = new InMemoryCurriculumStore();
      app = Fastify({ logger: false });
      app.addHook('onRequest', async (request) => {
        (request as { tenantId?: string }).tenantId = TENANT;
      });
      app.decorateRequest('user', undefined);
      app.addHook('onRequest', async (request) => {
        (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
          sub: 'test-user',
          roles: ['teacher'],
        };
      });
      await app.register(curriculumPlugin, { store, prefix: '/curriculum' });
      await app.ready();
    });

    async function createUnit(): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/curriculum/units',
        payload: {
          institutionId: SCHOOL,
          subjectId: SUBJECT,
          gradeId: GRADE,
          academicPeriodId: PERIOD,
          code: 'AL',
          name: 'Algebra',
        },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }

    async function createPlan(unitId: string): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: `/curriculum/units/${unitId}/lesson-plans`,
        payload: {
          title: 'Linear equations',
          objectives: 'Solve for x',
          plannedDate: '2026-07-01',
        },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }

    async function createOutcome(unitId: string): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/curriculum/outcomes',
        payload: { unitId, subjectId: SUBJECT, gradeId: GRADE, code: 'O1', statement: 'Solves' },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    }

    function expectValidation400(res: { statusCode: number; json: () => unknown }) {
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }

    it('rejects a non-UUID :id with 400 before any store lookup', async () => {
      const getUnit = vi.spyOn(store, 'getUnit');
      const getLessonPlan = vi.spyOn(store, 'getLessonPlan');
      const updateOutcome = vi.spyOn(store, 'updateOutcome');
      const deleteOutcome = vi.spyOn(store, 'deleteOutcome');
      const bad = 'not-a-uuid';
      const calls = [
        { method: 'GET', url: `/curriculum/units/${bad}/lesson-plans` },
        { method: 'POST', url: `/curriculum/units/${bad}/lesson-plans`, payload: { title: 'x' } },
        { method: 'POST', url: `/curriculum/units/${bad}/mark-taught`, payload: {} },
        { method: 'DELETE', url: `/curriculum/units/${bad}/coverage` },
        {
          method: 'PATCH',
          url: `/curriculum/lesson-plans/${bad}?institutionId=${SCHOOL}`,
          payload: { title: 'x' },
        },
        { method: 'DELETE', url: `/curriculum/lesson-plans/${bad}?institutionId=${SCHOOL}` },
        { method: 'PATCH', url: `/curriculum/outcomes/${bad}`, payload: { code: 'x' } },
        { method: 'DELETE', url: `/curriculum/outcomes/${bad}` },
      ] as const;
      for (const call of calls) {
        expectValidation400(await app.inject(call));
      }
      expect(getUnit).not.toHaveBeenCalled();
      expect(getLessonPlan).not.toHaveBeenCalled();
      expect(updateOutcome).not.toHaveBeenCalled();
      expect(deleteOutcome).not.toHaveBeenCalled();
    });

    it('validates lesson-plan PATCH bodies', async () => {
      const planId = await createPlan(await createUnit());
      const url = `/curriculum/lesson-plans/${planId}?institutionId=${SCHOOL}`;
      for (const payload of [
        { title: '' },
        { title: 42 },
        { plannedDate: 'tomorrow' },
        { objectives: { html: true } },
      ]) {
        expectValidation400(await app.inject({ method: 'PATCH', url, payload }));
      }
    });

    it('clears nullable lesson-plan fields with null and keeps omitted ones', async () => {
      const planId = await createPlan(await createUnit());
      const url = `/curriculum/lesson-plans/${planId}?institutionId=${SCHOOL}`;

      const renamed = await app.inject({ method: 'PATCH', url, payload: { title: 'Renamed' } });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({
        title: 'Renamed',
        objectives: 'Solve for x',
        plannedDate: '2026-07-01',
      });

      const cleared = await app.inject({
        method: 'PATCH',
        url,
        payload: { objectives: null, plannedDate: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({
        title: 'Renamed',
        objectives: null,
        plannedDate: null,
      });
    });

    it('validates outcome PATCH bodies and clears unitId/gradeId with null', async () => {
      const outcomeId = await createOutcome(await createUnit());
      const url = `/curriculum/outcomes/${outcomeId}`;
      for (const payload of [{ code: '' }, { statement: '' }, { unitId: 'bad' }, { gradeId: 7 }]) {
        expectValidation400(await app.inject({ method: 'PATCH', url, payload }));
      }

      const recoded = await app.inject({ method: 'PATCH', url, payload: { code: 'O2' } });
      expect(recoded.statusCode).toBe(200);
      expect(recoded.json()).toMatchObject({ code: 'O2', statement: 'Solves', gradeId: GRADE });

      const cleared = await app.inject({
        method: 'PATCH',
        url,
        payload: { unitId: null, gradeId: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({ code: 'O2', unitId: null, gradeId: null });
    });

    it('validates list and coverage filters', async () => {
      const listUnits = vi.spyOn(store, 'listUnits');
      expectValidation400(
        await app.inject({ method: 'GET', url: '/curriculum/units?subjectId=bad' }),
      );
      expectValidation400(
        await app.inject({ method: 'GET', url: '/curriculum/outcomes?unitId=bad' }),
      );
      expectValidation400(
        await app.inject({
          method: 'GET',
          url: `/curriculum/coverage?subjectId=bad&gradeId=${GRADE}&academicPeriodId=${PERIOD}`,
        }),
      );
      expectValidation400(
        await app.inject({ method: 'GET', url: '/curriculum/lesson-plans?unitIds=bad' }),
      );
      expect(listUnits).not.toHaveBeenCalled();

      const ok = await app.inject({
        method: 'GET',
        url: `/curriculum/units?subjectId=${SUBJECT}&institutionId=${SCHOOL}`,
      });
      expect(ok.statusCode).toBe(200);
    });

    it('caps unitIds on GET /lesson-plans and still serves a valid list', async () => {
      const unitId = await createUnit();
      await createPlan(unitId);
      const tooMany = Array.from(
        { length: MAX_LESSON_PLAN_UNIT_IDS + 1 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      expectValidation400(
        await app.inject({
          method: 'GET',
          url: `/curriculum/lesson-plans?unitIds=${tooMany.join(',')}`,
        }),
      );

      const ok = await app.inject({
        method: 'GET',
        url: `/curriculum/lesson-plans?unitIds=${unitId}`,
      });
      expect(ok.statusCode).toBe(200);
      expect((ok.json() as { data: unknown[] }).data).toHaveLength(1);
    });
  });
});
