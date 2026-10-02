import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { curriculumPlugin } from './plugin.js';
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
});
