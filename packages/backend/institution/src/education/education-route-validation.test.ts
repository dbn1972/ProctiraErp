/**
 * PRC-M283 — academic (grade / class / subject / institution-subject) routes
 * validate request bodies, :id params and query strings via their TypeBox
 * schemas. Previously the schemas were dead code and malformed input reached
 * the service / Prisma, surfacing as a 500 (22P02) instead of a 400.
 *
 * These tests fail without the route-level validation: a bad UUID or a
 * missing/invalid body would call the (spied) service and/or return 500.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerClassRoutes } from './class-routes.js';
import { registerGradeRoutes } from './grade-routes.js';
import { registerSubjectRoutes } from './subject-routes.js';

const TENANT_ID = randomUUID();

function makeApp(register: (app: FastifyInstance) => Promise<void>): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
  });
  return register(app).then(async () => {
    await app.ready();
    return app;
  });
}

describe('PRC-M283 class route validation', () => {
  let app: FastifyInstance;
  const service = {
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp((a) => registerClassRoutes(a, { service: service as never }));
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects a non-uuid :id with 400 and never calls the service', async () => {
    const res = await app.inject({ method: 'GET', url: '/classes/not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(service.getById).not.toHaveBeenCalled();
  });

  it('rejects a create body with a non-uuid gradeId with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/classes',
      payload: {
        institutionId: randomUUID(),
        gradeId: 'nope',
        academicPeriodId: randomUUID(),
        name: 'A',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects a list query with a missing institutionId with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/classes' });
    expect(res.statusCode).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('rejects a list query with a non-uuid institutionId with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/classes?institutionId=bad' });
    expect(res.statusCode).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
  });
});

describe('PRC-M283 grade route validation', () => {
  let app: FastifyInstance;
  const service = {
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp((a) => registerGradeRoutes(a, { service: service as never }));
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects a non-uuid :id on delete with 400', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/grades/bad' });
    expect(res.statusCode).toBe(400);
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('rejects a create body missing required code with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/grades',
      payload: { name: 'Grade 1', order: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects a create body with non-integer order with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/grades',
      payload: { name: 'Grade 1', code: 'G1', order: 'first' },
    });
    expect(res.statusCode).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('PRC-M283 subject route validation', () => {
  let app: FastifyInstance;
  const service = {
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    linkToGrade: vi.fn(),
    listInstitutionSubjects: vi.fn(),
    unlinkFromGrade: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await makeApp((a) => registerSubjectRoutes(a, { service: service as never }));
  });
  afterEach(async () => {
    await app.close();
  });

  it('rejects a non-uuid subject :id with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/subjects/bad' });
    expect(res.statusCode).toBe(400);
    expect(service.getById).not.toHaveBeenCalled();
  });

  it('rejects an institution-subject link with a non-uuid gradeId with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/institution-subjects',
      payload: { institutionId: randomUUID(), subjectId: randomUUID(), gradeId: 'bad' },
    });
    expect(res.statusCode).toBe(400);
    expect(service.linkToGrade).not.toHaveBeenCalled();
  });

  it('rejects an institution-subject list with a non-uuid institutionId with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/institution-subjects?institutionId=bad' });
    expect(res.statusCode).toBe(400);
    expect(service.listInstitutionSubjects).not.toHaveBeenCalled();
  });
});
