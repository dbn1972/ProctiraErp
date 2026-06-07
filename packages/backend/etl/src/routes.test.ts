/**
 * ETL Routes Unit Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerETLRoutes } from './routes.js';
import { ETLService } from './etl-service.js';
import { InMemoryPipelineRepository } from './in-memory-repository.js';

describe('ETL Routes', () => {
  let app: FastifyInstance;
  let etlService: ETLService;
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
      defaultRetryPolicy: { maxRetries: 3, backoffMs: 1000 },
    });

    // Add tenant context hook for testing
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
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
  });
});
