/**
 * Integration tests for Workflow Engine routes.
 *
 * Tests the Fastify HTTP layer including request validation,
 * response formatting, and error handling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { workflowPlugin } from './workflow-plugin.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';

const TENANT_ID = 'tenant-001';

function createApp(): FastifyInstance {
  const app = Fastify();

  // Simulate tenant resolution middleware
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
  });

  return app;
}

const validDefinitionBody = {
  name: 'Test Workflow',
  entityType: 'student_transfer',
  states: [
    { id: 'draft', name: 'Draft', type: 'INITIAL', assigneeType: 'user', assigneeId: 'creator' },
    { id: 'review', name: 'Review', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'admin' },
    { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
  ],
  transitions: [
    { id: 't1', fromStateId: 'draft', toStateId: 'review', action: 'submit' },
    { id: 't2', fromStateId: 'review', toStateId: 'done', action: 'approve' },
  ],
};

describe('Workflow Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryWorkflowRepository;

  beforeEach(async () => {
    repository = new InMemoryWorkflowRepository();
    app = createApp();
    await app.register(workflowPlugin, { repository });
    await app.ready();
  });

  // ─── Definition Routes ─────────────────────────────────────────────────

  describe('POST /workflows', () => {
    it('should create a workflow definition and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workflows',
        payload: validDefinitionBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Test Workflow');
      expect(body.entityType).toBe('student_transfer');
      expect(body.states).toHaveLength(3);
      expect(body.transitions).toHaveLength(2);
      expect(body.createdAt).toBeDefined();
    });

    it('should return 400 for invalid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workflows',
        payload: { name: '' }, // Missing required fields
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid workflow structure', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workflows',
        payload: {
          ...validDefinitionBody,
          states: [
            // No INITIAL state
            { id: 'review', name: 'Review', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'admin' },
            { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /workflows', () => {
    it('should list workflow definitions', async () => {
      await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      await app.inject({ method: 'POST', url: '/workflows', payload: { ...validDefinitionBody, name: 'WF 2' } });

      const response = await app.inject({ method: 'GET', url: '/workflows' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.totalItems).toBe(2);
    });
  });

  describe('GET /workflows/:id', () => {
    it('should return a workflow definition by ID', async () => {
      const createRes = await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      const created = createRes.json();

      const response = await app.inject({ method: 'GET', url: `/workflows/${created.id}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(created.id);
    });

    it('should return 404 for non-existent definition', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/workflows/00000000-0000-4000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /workflows/:id', () => {
    it('should update a workflow definition', async () => {
      const createRes = await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      const created = createRes.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/workflows/${created.id}`,
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Updated Name');
    });
  });

  describe('DELETE /workflows/:id', () => {
    it('should delete a workflow definition and return 204', async () => {
      const createRes = await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      const created = createRes.json();

      const response = await app.inject({ method: 'DELETE', url: `/workflows/${created.id}` });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await app.inject({ method: 'GET', url: `/workflows/${created.id}` });
      expect(getRes.statusCode).toBe(404);
    });
  });

  // ─── Instance Routes ───────────────────────────────────────────────────

  describe('POST /workflows/instances', () => {
    it('should create a workflow instance', async () => {
      const createRes = await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      const definition = createRes.json();

      const response = await app.inject({
        method: 'POST',
        url: '/workflows/instances',
        payload: {
          workflowDefinitionId: definition.id,
          entityType: 'student_transfer',
          entityId: 'student-001',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.workflowDefinitionId).toBe(definition.id);
      expect(body.entityId).toBe('student-001');
      expect(body.currentStateId).toBe('draft');
      expect(body.status).toBe('ACTIVE');
    });
  });

  describe('POST /workflows/instances/:instanceId/transition', () => {
    it('should transition a workflow instance', async () => {
      const createDefRes = await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      const definition = createDefRes.json();

      const createInstRes = await app.inject({
        method: 'POST',
        url: '/workflows/instances',
        payload: {
          workflowDefinitionId: definition.id,
          entityType: 'student_transfer',
          entityId: 'student-001',
        },
      });
      const instance = createInstRes.json();

      const response = await app.inject({
        method: 'POST',
        url: `/workflows/instances/${instance.id}/transition`,
        payload: {
          action: 'submit',
          actorId: 'user-001',
          comments: 'Ready for review',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.currentStateId).toBe('review');
    });

    it('should return 422 for invalid transition', async () => {
      const createDefRes = await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      const definition = createDefRes.json();

      const createInstRes = await app.inject({
        method: 'POST',
        url: '/workflows/instances',
        payload: {
          workflowDefinitionId: definition.id,
          entityType: 'student_transfer',
          entityId: 'student-001',
        },
      });
      const instance = createInstRes.json();

      const response = await app.inject({
        method: 'POST',
        url: `/workflows/instances/${instance.id}/transition`,
        payload: {
          action: 'approve', // Not valid from 'draft' state
          actorId: 'user-001',
        },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe('BUSINESS_RULE_ERROR');
    });
  });

  describe('GET /workflows/instances/:instanceId/audit', () => {
    it('should return transition audit history', async () => {
      const createDefRes = await app.inject({ method: 'POST', url: '/workflows', payload: validDefinitionBody });
      const definition = createDefRes.json();

      const createInstRes = await app.inject({
        method: 'POST',
        url: '/workflows/instances',
        payload: {
          workflowDefinitionId: definition.id,
          entityType: 'student_transfer',
          entityId: 'student-001',
        },
      });
      const instance = createInstRes.json();

      // Perform a transition
      await app.inject({
        method: 'POST',
        url: `/workflows/instances/${instance.id}/transition`,
        payload: { action: 'submit', actorId: 'user-001', comments: 'Submitting' },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/workflows/instances/${instance.id}/audit`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].fromStateId).toBe('draft');
      expect(body.data[0].toStateId).toBe('review');
      expect(body.data[0].actorId).toBe('user-001');
      expect(body.data[0].comments).toBe('Submitting');
      expect(body.data[0].timestamp).toBeDefined();
    });
  });
});
