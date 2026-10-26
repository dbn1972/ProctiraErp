/**
 * PRC-L397: workflow list routes validate their querystrings against the
 * declared WorkflowDefinitionListQuerySchema / WorkflowInstanceListQuerySchema.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { workflowPlugin } from './workflow-plugin.js';

const TENANT_ID = 'tenant-l397';
const headers = { 'x-test-user': 'admin-1' };

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    const sub = request.headers['x-test-user'] as string | undefined;
    if (sub) {
      (request as typeof request & { user: unknown }).user = {
        sub,
        roles: [{ roleId: 'admin', roleName: 'ADMIN', areaId: 'area-1' }],
      };
    }
  });
  await app.register(workflowPlugin, { repository: new InMemoryWorkflowRepository() });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /workflows (definitions list)', () => {
  it('rejects pageSize above the schema maximum', async () => {
    const res = await app.inject({ method: 'GET', url: '/workflows?pageSize=500', headers });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('converts valid string pagination to numbers', async () => {
    const res = await app.inject({ method: 'GET', url: '/workflows?page=2&pageSize=5', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 2, pageSize: 5 });
  });
});

describe('GET /workflows/instances (instances list)', () => {
  it('rejects an unknown status value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workflows/instances?status=BOGUS',
      headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects page below 1', async () => {
    const res = await app.inject({ method: 'GET', url: '/workflows/instances?page=0', headers });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid filters and pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/workflows/instances?status=ACTIVE&page=2&pageSize=5',
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 2, pageSize: 5 });
  });
});
