/**
 * Policy Routes Integration Tests
 *
 * Tests the Fastify routes for policy CRUD, activation/deactivation,
 * versioning, and evaluation endpoints.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { policyPlugin } from './policy-plugin.js';
import { InMemoryPolicyRepository } from './in-memory-repository.js';

describe('Policy Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryPolicyRepository;
  const tenantId = 'tenant-001';

  beforeEach(async () => {
    repository = new InMemoryPolicyRepository();
    app = Fastify();

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
    });

    await app.register(policyPlugin, { repository });
    await app.ready();
  });

  const validPolicyBody = {
    name: 'Test Password Policy',
    description: 'A test policy',
    type: 'password_complexity',
    scope: 'tenant',
    rules: {
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: false,
    },
    priority: 100,
  };

  // ─── POST /policies ────────────────────────────────────────────────────────

  describe('POST /policies', () => {
    it('should create a policy and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Test Password Policy');
      expect(body.type).toBe('password_complexity');
      expect(body.status).toBe('draft');
      expect(body.version).toBe(1);
    });

    it('should return 400 for invalid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: { name: '' }, // Missing required fields
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate name', async () => {
      await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });

      expect(response.statusCode).toBe(409);
    });
  });

  // ─── PUT /policies/:id ─────────────────────────────────────────────────────

  describe('PUT /policies/:id', () => {
    it('should update a policy and return 200', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      const response = await app.inject({
        method: 'PUT',
        url: `/policies/${policyId}`,
        payload: { name: 'Updated Policy Name' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Updated Policy Name');
    });

    it('should return 404 for non-existent policy', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/policies/00000000-0000-4000-8000-000000000000',
        payload: { name: 'X' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should bump version when rules are updated', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      const response = await app.inject({
        method: 'PUT',
        url: `/policies/${policyId}`,
        payload: { rules: { minLength: 12, requireUppercase: true } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().version).toBe(2);
    });
  });

  // ─── POST /policies/:id/activate ───────────────────────────────────────────

  describe('POST /policies/:id/activate', () => {
    it('should activate a policy and return 200', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('active');
    });

    it('should return 422 if already active', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      expect(response.statusCode).toBe(422);
    });
  });

  // ─── POST /policies/:id/deactivate ─────────────────────────────────────────

  describe('POST /policies/:id/deactivate', () => {
    it('should deactivate an active policy and return 200', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/deactivate`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('inactive');
    });
  });

  // ─── GET /policies ─────────────────────────────────────────────────────────

  describe('GET /policies', () => {
    it('should list policies with pagination', async () => {
      await app.inject({ method: 'POST', url: '/policies', payload: validPolicyBody });
      await app.inject({
        method: 'POST',
        url: '/policies',
        payload: {
          ...validPolicyBody,
          name: 'Another Policy',
          type: 'data_retention',
          rules: { retentionDays: 90 },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/policies',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.totalItems).toBe(2);
    });

    it('should filter by type', async () => {
      await app.inject({ method: 'POST', url: '/policies', payload: validPolicyBody });
      await app.inject({
        method: 'POST',
        url: '/policies',
        payload: {
          ...validPolicyBody,
          name: 'Retention',
          type: 'data_retention',
          rules: { retentionDays: 90 },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/policies?type=data_retention',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].type).toBe('data_retention');
    });
  });

  // ─── GET /policies/:id ─────────────────────────────────────────────────────

  describe('GET /policies/:id', () => {
    it('should return a policy by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/policies/${policyId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(policyId);
    });

    it('should return 404 for non-existent policy', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/policies/00000000-0000-4000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── GET /policies/:id/versions ────────────────────────────────────────────

  describe('GET /policies/:id/versions', () => {
    it('should return version history', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      // Update rules to create v2
      await app.inject({
        method: 'PUT',
        url: `/policies/${policyId}`,
        payload: { rules: { minLength: 12 } },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/policies/${policyId}/versions`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].version).toBe(2);
      expect(body.data[1].version).toBe(1);
    });
  });

  // ─── POST /policies/evaluate ───────────────────────────────────────────────

  describe('POST /policies/evaluate', () => {
    it('should evaluate and return effective policy', async () => {
      // Create and activate a policy
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      // Assign to tenant
      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/assignments`,
        payload: {
          policyId,
          targetType: 'tenant',
          targetId: tenantId,
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/policies/evaluate',
        payload: { type: 'password_complexity' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.effectivePolicy).not.toBeNull();
      expect(body.effectivePolicy.name).toBe('Test Password Policy');
      expect(body.inheritanceChain).toHaveLength(3);
    });

    it('should return null when no policies match', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/policies/evaluate',
        payload: { type: 'session_timeout' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().effectivePolicy).toBeNull();
    });
  });

  // ─── Assignments ───────────────────────────────────────────────────────────

  describe('POST /policies/:id/assignments', () => {
    it('should create an assignment for an active policy', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/assignments`,
        payload: {
          policyId,
          targetType: 'tenant',
          targetId: tenantId,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().policyId).toBe(policyId);
      expect(response.json().targetType).toBe('tenant');
    });
  });

  describe('GET /policies/:id/assignments', () => {
    it('should list assignments for a policy', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/assignments`,
        payload: { policyId, targetType: 'tenant', targetId: tenantId },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/policies/${policyId}/assignments`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
    });
  });

  describe('DELETE /policies/:id/assignments/:assignmentId', () => {
    it('should remove an assignment', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/policies',
        payload: validPolicyBody,
      });
      const policyId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/activate`,
      });

      const assignRes = await app.inject({
        method: 'POST',
        url: `/policies/${policyId}/assignments`,
        payload: { policyId, targetType: 'tenant', targetId: tenantId },
      });
      const assignmentId = assignRes.json().id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/policies/${policyId}/assignments/${assignmentId}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
