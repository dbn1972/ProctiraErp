/**
 * Tenant Routes Integration Tests
 *
 * Tests the HTTP API layer for tenant lifecycle management using Fastify inject.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { TenantService } from './tenant-service.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { registerTenantRoutes } from './routes.js';

describe('Tenant Routes', () => {
  let app: FastifyInstance;
  let service: TenantService;
  let repository: InMemoryTenantRepository;

  const validCreateBody = {
    name: 'Ministry of Education',
    slug: 'ministry-edu',
    plan: 'professional',
    region: 'us-east-1',
    admin: {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@ministry-edu.org',
      password: 'SecureP@ss123',
    },
  };

  beforeEach(async () => {
    repository = new InMemoryTenantRepository();
    service = new TenantService(repository);
    app = Fastify();
    await registerTenantRoutes(app, { tenantService: service });
    await app.ready();
  });

  // ─── POST /tenants ───────────────────────────────────────────────────────

  describe('POST /tenants', () => {
    it('should create a tenant and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('Ministry of Education');
      expect(body.slug).toBe('ministry-edu');
      expect(body.status).toBe('active');
      expect(body.id).toBeDefined();
    });

    it('should return 400 for invalid slug', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: { ...validCreateBody, slug: 'INVALID SLUG!' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate slug', async () => {
      await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: { ...validCreateBody, name: 'Different Name' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  // ─── GET /tenants ────────────────────────────────────────────────────────

  describe('GET /tenants', () => {
    it('should list tenants with pagination', async () => {
      await app.inject({ method: 'POST', url: '/tenants', payload: validCreateBody });
      await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: { ...validCreateBody, name: 'Second', slug: 'second-org' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/tenants',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.totalItems).toBe(2);
    });

    it('should filter by status', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/suspend`,
        payload: { reason: 'Test' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/tenants?status=suspended',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe('suspended');
    });
  });

  // ─── GET /tenants/:id ────────────────────────────────────────────────────

  describe('GET /tenants/:id', () => {
    it('should return a tenant by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/tenants/${tenantId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(tenantId);
    });

    it('should return 404 for non-existent tenant', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tenants/00000000-0000-4000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── PUT /tenants/:id ────────────────────────────────────────────────────

  describe('PUT /tenants/:id', () => {
    it('should update a tenant', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'PUT',
        url: `/tenants/${tenantId}`,
        payload: { name: 'Updated Ministry' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Updated Ministry');
    });
  });

  // ─── POST /tenants/:id/suspend ───────────────────────────────────────────

  describe('POST /tenants/:id/suspend', () => {
    it('should suspend a tenant', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/suspend`,
        payload: { reason: 'Non-payment' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('suspended');
      expect(response.json().suspendedReason).toBe('Non-payment');
    });

    it('should return 400 without reason', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/suspend`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── POST /tenants/:id/reactivate ────────────────────────────────────────

  describe('POST /tenants/:id/reactivate', () => {
    it('should reactivate a suspended tenant', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/suspend`,
        payload: { reason: 'Test' },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/reactivate`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('active');
    });
  });

  // ─── POST /tenants/:id/decommission ──────────────────────────────────────

  describe('POST /tenants/:id/decommission', () => {
    it('should decommission a tenant', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/decommission`,
        payload: { reason: 'Contract ended', retainDataDays: 60 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('decommissioned');
      expect(response.json().dataRetentionUntil).toBeDefined();
    });
  });

  // ─── Configuration Routes ──────────────────────────────────────────────

  describe('GET /tenants/:id/config', () => {
    it('should return tenant configuration', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/tenants/${tenantId}/config`,
      });

      expect(response.statusCode).toBe(200);
      const config = response.json();
      expect(config.locale.defaultLocale).toBe('en');
    });
  });

  describe('PUT /tenants/:id/config', () => {
    it('should update tenant configuration', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'PUT',
        url: `/tenants/${tenantId}/config`,
        payload: {
          branding: { primaryColor: '#003366' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().branding.primaryColor).toBe('#003366');
    });
  });

  // ─── Domain Routes ─────────────────────────────────────────────────────

  describe('POST /tenants/:id/domains', () => {
    it('should add a domain to a tenant', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/domains`,
        payload: { domain: 'edu.ministry.gov', primary: true },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().domain).toBe('edu.ministry.gov');
      expect(response.json().primary).toBe(true);
    });
  });

  describe('GET /tenants/:id/domains', () => {
    it('should list tenant domains', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/tenants/${tenantId}/domains`,
        payload: { domain: 'edu.ministry.gov' },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/tenants/${tenantId}/domains`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
    });
  });

  // ─── Usage Routes ──────────────────────────────────────────────────────

  describe('GET /tenants/:id/usage', () => {
    it('should return tenant usage dashboard', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/tenants',
        payload: validCreateBody,
      });
      const tenantId = createRes.json().id;

      const response = await app.inject({
        method: 'GET',
        url: `/tenants/${tenantId}/usage`,
      });

      expect(response.statusCode).toBe(200);
      const usage = response.json();
      expect(usage.tenantId).toBe(tenantId);
      expect(usage.storage).toBeDefined();
      expect(usage.users).toBeDefined();
      expect(usage.apiCalls).toBeDefined();
    });
  });
});
