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
