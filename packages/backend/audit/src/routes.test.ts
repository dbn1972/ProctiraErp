/**
 * Audit Routes Integration Tests
 *
 * Tests the HTTP routes for the audit service using Fastify's inject method.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { auditPlugin } from './audit-plugin.js';
import { InMemoryAuditRepository } from './in-memory-repository.js';

describe('Audit Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryAuditRepository;

  beforeEach(async () => {
    repository = new InMemoryAuditRepository();
    app = Fastify();

    // Mock tenant and user context
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = 'test-tenant';
      (request as unknown as { user: { sub: string; name: string; roles: string[] } }).user = {
        sub: 'test-user-id',
        name: 'Test User',
        // PRC-L280: default test principal holds an audit-write role.
        roles: ['admin'],
      };
    });

    await app.register(auditPlugin, {
      repository,
      prefix: '/audit',
    });

    await app.ready();
  });

  describe('POST /audit', () => {
    it('should create an audit entry for a CREATE operation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'student',
          entityId: 'student-123',
          operation: 'CREATE',
          afterValues: { name: 'John Doe', grade: '10' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.entityType).toBe('student');
      expect(body.entityId).toBe('student-123');
      expect(body.operation).toBe('CREATE');
      expect(body.userId).toBe('test-user-id');
      expect(body.userName).toBe('Test User');
      expect(body.tenantId).toBe('test-tenant');
      expect(body.beforeValues).toBeNull();
      expect(body.afterValues).toEqual({ name: 'John Doe', grade: '10' });
      expect(body.timestamp).toBeDefined();
    });

    it('should create an audit entry for an UPDATE operation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'institution',
          entityId: 'inst-456',
          operation: 'UPDATE',
          beforeValues: { name: 'Old Name' },
          afterValues: { name: 'New Name' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.operation).toBe('UPDATE');
      expect(body.beforeValues).toEqual({ name: 'Old Name' });
      expect(body.afterValues).toEqual({ name: 'New Name' });
    });

    it('should return 400 for invalid input', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: '',
          entityId: 'student-123',
          operation: 'INVALID',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for CREATE with beforeValues', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'student',
          entityId: 'student-123',
          operation: 'CREATE',
          beforeValues: { name: 'should not be here' },
          afterValues: { name: 'John' },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /audit/batch', () => {
    it('should create multiple audit entries', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/audit/batch',
        payload: {
          entries: [
            {
              entityType: 'student',
              entityId: 'student-1',
              operation: 'CREATE',
              afterValues: { name: 'Student 1' },
            },
            {
              entityType: 'student',
              entityId: 'student-2',
              operation: 'CREATE',
              afterValues: { name: 'Student 2' },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.count).toBe(2);
    });
  });

  describe('GET /audit', () => {
    beforeEach(async () => {
      // Seed entries
      await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'student',
          entityId: 'student-1',
          operation: 'CREATE',
          afterValues: { name: 'Student 1' },
        },
      });
      await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'institution',
          entityId: 'inst-1',
          operation: 'UPDATE',
          beforeValues: { name: 'Old' },
          afterValues: { name: 'New' },
        },
      });
    });

    it('should return all audit entries for the tenant', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.totalItems).toBe(2);
    });

    it('should filter by entity type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit?entityType=student',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].entityType).toBe('student');
    });

    it('should filter by operation', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit?operation=UPDATE',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].operation).toBe('UPDATE');
    });

    it('should support pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit?page=1&pageSize=1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta.page).toBe(1);
      expect(body.meta.pageSize).toBe(1);
      expect(body.meta.totalItems).toBe(2);
      expect(body.meta.totalPages).toBe(2);
    });
  });

  describe('GET /audit/:id', () => {
    it('should return a single audit entry', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'student',
          entityId: 'student-1',
          operation: 'CREATE',
          afterValues: { name: 'Test' },
        },
      });

      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/audit/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(created.id);
      expect(body.entityType).toBe('student');
    });

    it('should return 404 for non-existent entry', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /audit/retention', () => {
    it('should return default retention config', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit/retention',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tenantId).toBe('test-tenant');
      expect(body.retentionMonths).toBe(84);
      expect(body.archivalEnabled).toBe(false);
    });
  });

  describe('PUT /audit/retention', () => {
    it('should set retention configuration', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/audit/retention',
        payload: {
          retentionMonths: 24,
          archivalEnabled: true,
          archivalDestination: 's3://audit-archive/',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.retentionMonths).toBe(24);
      expect(body.archivalEnabled).toBe(true);
      expect(body.archivalDestination).toBe('s3://audit-archive/');
    });

    it('should return 400 for invalid retention config', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/audit/retention',
        payload: {
          retentionMonths: 0,
          archivalEnabled: false,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /audit/archival/execute', () => {
    it('should return error when no config exists', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/audit/archival/execute',
      });

      expect(response.statusCode).toBe(422);
    });

    it('should execute archival when configured', async () => {
      // Set retention config
      await app.inject({
        method: 'PUT',
        url: '/audit/retention',
        payload: {
          retentionMonths: 1,
          archivalEnabled: true,
          archivalDestination: 's3://archive/',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/audit/archival/execute',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.archivedCount).toBeDefined();
      expect(body.cutoffDate).toBeDefined();
      expect(body.destination).toBe('s3://archive/');
      expect(body.executedAt).toBeDefined();
    });
  });

  describe('GET /audit/archival/candidates', () => {
    it('should return candidate count', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit/archival/candidates',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.count).toBe(0);
    });
  });

  describe('GET /audit/dsar/:subjectId (G-734)', () => {
    it('exports audit entries where the subject is the entity or the actor', async () => {
      const subjectId = 'subject-dsar-001';

      await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'student',
          entityId: subjectId,
          operation: 'CREATE',
          afterValues: { name: 'Ada Lovelace' },
        },
      });

      await app.inject({
        method: 'POST',
        url: '/audit',
        payload: {
          entityType: 'institution',
          entityId: 'other-entity',
          operation: 'UPDATE',
          beforeValues: { name: 'A' },
          afterValues: { name: 'B' },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/audit/dsar/${subjectId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.subjectId).toBe(subjectId);
      expect(body.tenantId).toBe('test-tenant');
      expect(body.entryCount).toBeGreaterThanOrEqual(1);
      expect(body.truncated).toBe(false);
      expect(body.entries.some((e: { entityId: string }) => e.entityId === subjectId)).toBe(true);
      // Acting-user match: the inject hook sets user.sub = test-user-id, so only
      // entityId matches are required for this subject id.
      expect(body.exportedAt).toBeDefined();
    });

    it('PRC-M084: each export (POST and GET) records an audit row with actor and subject', async () => {
      const subjectId = 'subject-dsar-audited';
      const first = await app.inject({ method: 'POST', url: `/audit/dsar/${subjectId}/export` });
      expect(first.statusCode).toBe(200);
      expect(first.json().entryCount).toBe(0);
      const second = await app.inject({ method: 'GET', url: `/audit/dsar/${subjectId}` });
      const entries = second.json().entries as Array<{
        entityType: string;
        entityId: string;
        userId: string;
        afterValues: Record<string, unknown> | null;
      }>;
      const exportsLogged = entries.filter((e) => e.entityType === 'dsar_export');
      expect(exportsLogged).toHaveLength(1);
      expect(exportsLogged[0]).toMatchObject({ entityId: subjectId, userId: 'test-user-id' });
      expect(exportsLogged[0]?.afterValues).toMatchObject({ subjectId, entryCount: 0 });
    });
    it('returns an empty package when the subject has no audit trail', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/audit/dsar/nobody-here',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.entryCount).toBe(0);
      expect(body.entries).toEqual([]);
    });
  });

  // PRC-L279: no cross-tenant 'default' fallback — missing tenant context fails closed.
  describe('tenant context required (PRC-L279)', () => {
    it('rejects any audit route when tenant context is missing (400)', async () => {
      const bare = Fastify();
      bare.decorateRequest('tenantId', '');
      bare.addHook('onRequest', async (request) => {
        // No tenantId set; grant a write role so only the tenant guard can block.
        (request as unknown as { user: { sub: string; roles: string[] } }).user = {
          sub: 'u',
          roles: ['admin'],
        };
      });
      await bare.register(auditPlugin, { repository: new InMemoryAuditRepository(), prefix: '/audit' });
      await bare.ready();

      const post = await bare.inject({
        method: 'POST',
        url: '/audit',
        payload: { entityType: 'student', entityId: 's1', operation: 'CREATE' },
      });
      expect(post.statusCode).toBe(400);
      expect(post.json().code).toBe('TENANT_REQUIRED');

      const get = await bare.inject({ method: 'GET', url: '/audit' });
      expect(get.statusCode).toBe(400);
      await bare.close();
    });
  });

  // PRC-L280: writing audit evidence requires an audit/security/admin role.
  describe('audit write authorization (PRC-L280)', () => {
    async function appWithRoles(roles: string[]): Promise<FastifyInstance> {
      const scoped = Fastify();
      scoped.decorateRequest('tenantId', '');
      scoped.addHook('onRequest', async (request) => {
        (request as unknown as { tenantId: string }).tenantId = 'test-tenant';
        (request as unknown as { user: { sub: string; roles: string[] } }).user = {
          sub: 'u',
          roles,
        };
      });
      await scoped.register(auditPlugin, {
        repository: new InMemoryAuditRepository(),
        prefix: '/audit',
      });
      await scoped.ready();
      return scoped;
    }

    it('rejects a non-privileged caller writing an audit entry (403)', async () => {
      const scoped = await appWithRoles(['teacher']);
      const res = await scoped.inject({
        method: 'POST',
        url: '/audit',
        payload: { entityType: 'student', entityId: 's1', operation: 'CREATE' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
      await scoped.close();
    });

    it('allows a non-privileged caller to READ audit logs (200)', async () => {
      const scoped = await appWithRoles(['teacher']);
      const res = await scoped.inject({ method: 'GET', url: '/audit' });
      expect(res.statusCode).toBe(200);
      await scoped.close();
    });

    it('allows an auditor role to write (201)', async () => {
      const scoped = await appWithRoles(['auditor']);
      const res = await scoped.inject({
        method: 'POST',
        url: '/audit',
        payload: { entityType: 'student', entityId: 's1', operation: 'CREATE' },
      });
      expect(res.statusCode).toBe(201);
      await scoped.close();
    });
  });
});
