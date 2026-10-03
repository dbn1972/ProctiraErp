/**
 * ETL Routes Unit Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerETLRoutes } from './routes.js';
import { ETLService } from './etl-service.js';
import { memoryConnectorFactory } from './test-support/memory-connector-factory.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';
import { REDACTED_SECRET } from './secret-redaction.js';

interface TestRole {
  roleId: string;
  roleName: string;
  areaId: string | null;
}

describe('ETL Routes', () => {
  let app: FastifyInstance;
  let etlService: ETLService;
  // PRC-H050: ETL routes now require an ETL/admin role. Default the harness to an ETL engineer
  // so the functional route tests exercise the authorized path; individual tests override it.
  let principalRoles: TestRole[] = [
    { roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null },
  ];
  const tenantId = '550e8400-e29b-41d4-a716-446655440000';

  const validPipelineBody = {
    name: 'Test Pipeline',
    description: 'A test pipeline',
    source: {
      type: 'csv',
      fileContent: 'name,age\nJohn,30\nJane,25',
      hasHeader: true,
    },
    destination: {
      type: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      username: 'user',
      password: 'pass',
      table: 'users',
    },
    fieldMappings: [
      { sourceField: 'name', destinationField: 'full_name' },
      {
        sourceField: 'age',
        destinationField: 'age',
        transformation: 'type_cast',
        transformConfig: { targetType: 'integer' },
      },
    ],
  };

  beforeEach(async () => {
    app = Fastify();
    const repository = new InMemoryPipelineRepository();
    etlService = new ETLService(repository, {
      connectorFactory: memoryConnectorFactory(),
      defaultRetryPolicy: { maxRetries: 3, backoffMs: 1000 },
    });

    principalRoles = [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }];

    // Add tenant + JWT-actor context hook for testing (getActor reads request.user).
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
      (request as unknown as { user: unknown }).user = {
        sub: 'etl-user',
        tenantId,
        roles: principalRoles,
      };
    });

    await registerETLRoutes(app, { etlService, prefix: '/pipelines' });
    await app.ready();
  });

  describe('POST /pipelines', () => {
    it('should create a pipeline', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Test Pipeline');
      expect(body.source.type).toBe('csv');
      expect(body.destination.type).toBe('postgresql');
      expect(body.fieldMappings).toHaveLength(2);
      expect(body.enabled).toBe(true);
    });

    it('should return 400 for invalid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: { name: '' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /pipelines', () => {
    it('should list pipelines', async () => {
      // Create a pipeline first
      await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/pipelines',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBe(1);
      expect(body.meta.page).toBe(1);
    });

    it('should return empty list when no pipelines exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/pipelines',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(0);
      expect(body.meta.total).toBe(0);
    });
  });

  describe('GET /pipelines/:pipelineId', () => {
    it('should get a pipeline by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Test Pipeline');
    });

    it('should return 404 for non-existent pipeline', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/pipelines/00000000-0000-4000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /pipelines/:pipelineId', () => {
    it('should update a pipeline', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'PUT',
        url: `/pipelines/${created.id}`,
        payload: { name: 'Updated Pipeline' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('Updated Pipeline');
      expect(body.description).toBe('A test pipeline');
    });
  });

  describe('DELETE /pipelines/:pipelineId', () => {
    it('should delete a pipeline', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'DELETE',
        url: `/pipelines/${created.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getResponse = await app.inject({
        method: 'GET',
        url: `/pipelines/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });

  describe('POST /pipelines/:pipelineId/execute', () => {
    it('should execute a pipeline', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      const created = JSON.parse(createResponse.payload);

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${created.id}/execute`,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.payload);
      expect(body.id).toBeDefined();
      expect(body.pipelineId).toBe(created.id);
      expect(body.status).toBe('completed');
      expect(body.startedAt).toBeDefined();
    });

    it('returns 503 when execute is refused during shutdown (W1-ARCH-07)', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      const created = JSON.parse(createResponse.payload);

      await etlService.stopAcceptingAndDrain();

      const response = await app.inject({
        method: 'POST',
        url: `/pipelines/${created.id}/execute`,
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  // PRC-H050: pipeline definitions carry connector credentials and execution error rows carry
  // source records. Only ETL/admin roles may touch pipelines; report-readers must not.
  describe('etl.manage for connector config (PRC-H115)', () => {
    const operator: TestRole[] = [
      { roleId: 'etl_operator', roleName: 'ETL Operator', areaId: null },
    ];
    async function createAsEngineer() {
      principalRoles = [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }];
      const res = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      expect(res.statusCode).toBe(201);
      return JSON.parse(res.payload) as { id: string; destination: Record<string, unknown> };
    }

    it('manager sees redacted config; operator sees connector type only', async () => {
      const created = await createAsEngineer();
      expect(created.destination).toMatchObject({ host: 'localhost', password: '__REDACTED__' });
      principalRoles = operator;
      const one = await app.inject({ method: 'GET', url: `/pipelines/${created.id}` });
      expect(one.statusCode).toBe(200);
      expect(JSON.parse(one.payload).destination).toEqual({ type: 'postgresql' });
      const list = await app.inject({ method: 'GET', url: '/pipelines' });
      expect(JSON.parse(list.payload).data[0].destination).toEqual({ type: 'postgresql' });
    });

    it('operator cannot create or update pipelines (403)', async () => {
      const created = await createAsEngineer();
      principalRoles = operator;
      const post = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      expect(post.statusCode).toBe(403);
      const put = await app.inject({
        method: 'PUT',
        url: `/pipelines/${created.id}`,
        payload: { name: 'x' },
      });
      expect(put.statusCode).toBe(403);
    });

    it('redacted password placeholder restores on an unchanged-target update', async () => {
      const created = await createAsEngineer();
      const put = await app.inject({
        method: 'PUT',
        url: `/pipelines/${created.id}`,
        payload: { destination: { ...validPipelineBody.destination, password: '__REDACTED__' } },
      });
      expect(put.statusCode).toBe(200);
      const stored = await etlService.getPipeline(tenantId, created.id);
      expect((stored.destination as { password: string }).password).toBe('pass');
    });
  });

  describe('ETL access control (PRC-H050)', () => {
    const denied: TestRole[][] = [
      [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
      [{ roleId: 'guardian', roleName: 'Guardian', areaId: null }],
      [{ roleId: 'student', roleName: 'Student', areaId: null }],
      [{ roleId: 'teacher', roleName: 'Teacher', areaId: null }],
      [{ roleId: 'staff', roleName: 'Staff', areaId: null }],
      [],
    ];

    for (const roles of denied) {
      const label = roles.length ? roles[0]!.roleId : 'no-role';
      it(`denies GET /pipelines for ${label} (403)`, async () => {
        principalRoles = roles;
        const response = await app.inject({ method: 'GET', url: '/pipelines' });
        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.payload).code).toBe('FORBIDDEN');
      });

      it(`denies POST /pipelines for ${label} (403)`, async () => {
        principalRoles = roles;
        const response = await app.inject({
          method: 'POST',
          url: '/pipelines',
          payload: validPipelineBody,
        });
        expect(response.statusCode).toBe(403);
      });
    }

    it('denies GET /pipelines/:id/executions for a report-reader (403)', async () => {
      // Create as ETL staff, then attempt to read executions as a parent.
      principalRoles = [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }];
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      const created = JSON.parse(createResponse.payload);

      principalRoles = [{ roleId: 'parent', roleName: 'Parent', areaId: null }];
      const response = await app.inject({
        method: 'GET',
        url: `/pipelines/${created.id}/executions`,
      });
      expect(response.statusCode).toBe(403);
    });

    it('does not echo raw source records in execution error rows', async () => {
      principalRoles = [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }];
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      const created = JSON.parse(createResponse.payload);
      const execResponse = await app.inject({
        method: 'POST',
        url: `/pipelines/${created.id}/execute`,
      });
      expect(execResponse.statusCode).toBe(202);
      const execution = JSON.parse(execResponse.payload);
      // The response shape must expose only a presence flag, never the raw source record.
      for (const err of execution.errors ?? []) {
        expect(err).not.toHaveProperty('data');
        expect(err).toHaveProperty('hasData');
      }
    });

    it('allows an ETL engineer to list pipelines', async () => {
      principalRoles = [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }];
      const response = await app.inject({ method: 'GET', url: '/pipelines' });
      expect(response.statusCode).toBe(200);
    });

    it('allows an admin to list pipelines', async () => {
      principalRoles = [{ roleId: 'admin', roleName: 'Admin', areaId: null }];
      const response = await app.inject({ method: 'GET', url: '/pipelines' });
      expect(response.statusCode).toBe(200);
    });

    it('redacts connector credentials in the pipeline response', async () => {
      principalRoles = [{ roleId: 'etl_engineer', roleName: 'ETL Engineer', areaId: null }];
      const createResponse = await app.inject({
        method: 'POST',
        url: '/pipelines',
        payload: validPipelineBody,
      });
      expect(createResponse.statusCode).toBe(201);
      const created = JSON.parse(createResponse.payload);
      // destination is postgresql with a password — it must not be echoed verbatim.
      expect(created.destination.password).not.toBe('pass');
      expect(created.destination.password).toBe(REDACTED_SECRET);
      // Non-secret fields are preserved.
      expect(created.destination.host).toBe('localhost');
      expect(created.destination.database).toBe('testdb');

      const getResponse = await app.inject({ method: 'GET', url: `/pipelines/${created.id}` });
      expect(JSON.parse(getResponse.payload).destination.password).toBe(REDACTED_SECRET);
    });
  });
});
