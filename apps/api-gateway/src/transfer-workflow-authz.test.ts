/**
 * Gateway authz and state machine for cross-board transfers.
 * In-memory store (DATABASE_URL unset). Live Postgres completion is the e2e gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '550e8400-e29b-41d4-a716-446655440001';

const STUDENT = '00000000-0000-4000-8000-00000000d001';
const SOURCE_ENROLLMENT = '00000000-0000-4000-8000-00000000d011';
const SOURCE_SCHOOL = '00000000-0000-4000-8000-00000000d021';
const DEST_SCHOOL = '00000000-0000-4000-8000-00000000d022';
const GRADE = '00000000-0000-4000-8000-00000000d031';
const CLASS_ID = '00000000-0000-4000-8000-00000000d041';
const PERIOD = '00000000-0000-4000-8000-00000000d051';
const CBSE = '00000000-0000-4000-8000-00000000d061';
const ICSE = '00000000-0000-4000-8000-00000000d062';

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

function bearer(app: FastifyInstance, roleId: string, tenantId = TENANT_A, institutionId?: string) {
  return app.jwt.sign({
    sub: `${roleId}-user`,
    tenantId,
    email: `${roleId}@test.com`,
    displayName: roleId,
    roles: [{ roleId, roleName: roleId, areaId: 'root', institutionId }],
    areas: [],
    institutions: institutionId ? [institutionId] : [],
    jti: `jti-${roleId}-${tenantId}`,
    sessionId: `sess-${roleId}`,
  });
}

describe('cross-board transfer workflow authz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function createBody() {
    return {
      studentId: STUDENT,
      sourceEnrollmentId: SOURCE_ENROLLMENT,
      sourceInstitutionId: SOURCE_SCHOOL,
      destinationInstitutionId: DEST_SCHOOL,
      destinationGradeId: GRADE,
      destinationClassId: CLASS_ID,
      academicPeriodId: PERIOD,
      reason: 'Cross-board move',
      transferDate: '2026-09-01',
      sourceBoardId: CBSE,
      destinationBoardId: ICSE,
      sourceBoardCode: 'CBSE',
      destinationBoardCode: 'ICSE',
      studentName: 'Aarav Mehta',
      sourceInstitutionName: 'Sunrise Public School',
      destinationInstitutionName: 'ICSE Academy',
    };
  }

  it('denies anonymous and teacher writes, and runs the admin state machine', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/transfers/pending' });
    expect(anon.statusCode).toBe(401);

    const teacher = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: { authorization: `Bearer ${bearer(app, 'teacher')}` },
      payload: createBody(),
    });
    expect(teacher.statusCode).toBe(403);

    const parent = await app.inject({
      method: 'GET',
      url: '/api/v1/transfers/pending',
      headers: { authorization: `Bearer ${bearer(app, 'parent')}` },
    });
    expect(parent.statusCode).toBe(403);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: createBody(),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().transferId as string;
    expect(created.json().studentName).toBe('Aarav Mehta');

    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/transfers/${id}`,
      headers: { authorization: `Bearer ${bearer(app, 'admin', TENANT_B)}` },
    });
    expect(other.statusCode).toBe(404);

    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${id}/submit`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {},
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().workflowStatus).toBe('SUBMITTED');

    const sourcePrincipal = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${id}/review`,
      headers: { authorization: `Bearer ${bearer(app, 'principal', TENANT_A, SOURCE_SCHOOL)}` },
      payload: {},
    });
    expect(sourcePrincipal.statusCode).toBe(403);

    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${id}/review`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {},
    });
    expect(review.json().workflowStatus).toBe('UNDER_REVIEW');

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${id}/approve`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {},
    });
    expect(blocked.statusCode).toBe(422);

    const registrarRule = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers/equivalency',
      headers: { authorization: `Bearer ${bearer(app, 'registrar', TENANT_A, SOURCE_SCHOOL)}` },
      payload: {
        sourceBoardId: CBSE,
        targetBoardId: ICSE,
        sourceGradeCode: 'G9',
        targetGradeCode: 'G9',
        sourceSubject: 'Mathematics',
        targetSubject: 'Mathematics',
        sourceMarksMax: 100,
        targetMarksMax: 100,
        creditFactor: 1,
        mappingStatus: 'mapped',
      },
    });
    expect(registrarRule.statusCode).toBe(403);

    const rule = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers/equivalency',
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {
        sourceBoardId: CBSE,
        targetBoardId: ICSE,
        sourceGradeCode: 'G9',
        targetGradeCode: 'G9',
        sourceSubject: 'Mathematics',
        targetSubject: 'Mathematics',
        sourceMarksMax: 100,
        targetMarksMax: 100,
        creditFactor: 1,
        mappingStatus: 'mapped',
      },
    });
    expect(rule.statusCode).toBe(201);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${id}/approve`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: { comment: 'Rules checked' },
    });
    expect(approved.statusCode).toBe(200);

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${id}/complete`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {},
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().workflowStatus).toBe('COMPLETED');

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${id}/submit`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {},
    });
    expect(again.statusCode).toBe(409);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: { authorization: `Bearer ${bearer(app, 'registrar', TENANT_A, SOURCE_SCHOOL)}` },
      payload: {
        ...createBody(),
        studentName: 'Diya Sharma',
        sourceEnrollmentId: '00000000-0000-4000-8000-00000000d012',
      },
    });
    expect(second.statusCode).toBe(201);
    const rejectId = second.json().transferId as string;
    await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${rejectId}/submit`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${rejectId}/review`,
      headers: { authorization: `Bearer ${bearer(app, 'admin')}` },
      payload: {},
    });
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/transfers/${rejectId}/reject`,
      headers: { authorization: `Bearer ${bearer(app, 'principal', TENANT_A, DEST_SCHOOL)}` },
      payload: { comment: 'Section is full' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().workflowStatus).toBe('REJECTED');

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/transfers/pending',
      headers: { authorization: `Bearer ${bearer(app, 'teacher')}` },
    });
    expect(queue.statusCode).toBe(200);
    expect(JSON.stringify(queue.json())).not.toContain(rejectId);
  });
});
