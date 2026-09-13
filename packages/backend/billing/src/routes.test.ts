/**
 * Billing Routes Integration Tests
 *
 * Tests the Fastify routes for plan management, subscriptions,
 * entitlements, and usage tracking.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { BillingService } from './billing-service.js';
import { InMemoryBillingRepository } from './in-memory-repository.js';
import { registerBillingRoutes } from './routes.js';

describe('Billing Routes', () => {
  let app: FastifyInstance;
  let service: BillingService;
  let repository: InMemoryBillingRepository;

  beforeEach(async () => {
    repository = new InMemoryBillingRepository();
    service = new BillingService(repository);
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as { user?: { roles?: unknown } }).user = {
        roles: [{ roleId: 'platform_admin', roleName: 'Platform Administrator' }],
      };
    });
    await registerBillingRoutes(app, { billingService: service, prefix: '/billing' });
    await app.ready();
  });

  const tenantId = '11111111-1111-4111-8111-111111111111';

  // ─── Plan Routes ───────────────────────────────────────────────────────

  describe('POST /billing/plans', () => {
    it('should create a plan', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/billing/plans',
        payload: {
          name: 'Starter Plan',
          tier: 'starter',
          features: [{ featureKey: 'reports', enabled: true }],
          quotas: [{ metric: 'students', limit: 500 }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Starter Plan');
      expect(body.tier).toBe('starter');
      expect(body.status).toBe('draft');
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/billing/plans',
        payload: {
          // Missing required fields
          tier: 'invalid_tier',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate plan name', async () => {
      const payload = {
        name: 'Duplicate Plan',
        tier: 'starter',
        features: [],
        quotas: [],
      };

      await app.inject({ method: 'POST', url: '/billing/plans', payload });
      const response = await app.inject({ method: 'POST', url: '/billing/plans', payload });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /billing/plans', () => {
    it('should list plans', async () => {
      await app.inject({
        method: 'POST',
        url: '/billing/plans',
        payload: {
          name: 'Plan A',
          tier: 'free',
          features: [],
          quotas: [],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/billing/plans',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.meta.totalItems).toBe(1);
    });
  });

  describe('GET /billing/plans/:id', () => {
    it('should get a plan by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/billing/plans',
        payload: {
          name: 'Test Plan',
          tier: 'professional',
          features: [{ featureKey: 'sso', enabled: true }],
          quotas: [],
        },
      });

      const created = JSON.parse(createResponse.body);
      const response = await app.inject({
        method: 'GET',
        url: `/billing/plans/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Test Plan');
    });

    it('should return 404 for non-existent plan', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/billing/plans/00000000-0000-4000-8000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Subscription Routes ───────────────────────────────────────────────

  describe('POST /billing/subscriptions', () => {
    it('should create a subscription', async () => {
      // Create and activate a plan first
      const plan = await service.createPlan({
        name: 'Active Plan',
        tier: 'professional',
        features: [{ featureKey: 'reports', enabled: true }],
        quotas: [{ metric: 'students', limit: 1000 }],
        trialDays: 14,
      });
      await service.updatePlan(plan.id, { status: 'active' });

      const response = await app.inject({
        method: 'POST',
        url: '/billing/subscriptions',
        payload: {
          tenantId,
          planId: plan.id,
          startTrial: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.tenantId).toBe(tenantId);
      expect(body.status).toBe('trial');
      expect(body.planName).toBe('Active Plan');
    });
  });

  describe('POST /billing/subscriptions/:id/activate', () => {
    it('should activate a trial subscription', async () => {
      const plan = await service.createPlan({
        name: 'Trial Plan',
        tier: 'starter',
        features: [],
        quotas: [],
        trialDays: 14,
      });
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
        startTrial: true,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/billing/subscriptions/${subscription.id}/activate`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('active');
    });
  });

  describe('POST /billing/subscriptions/:id/cancel', () => {
    it('should cancel a subscription', async () => {
      const plan = await service.createPlan({
        name: 'Cancel Plan',
        tier: 'starter',
        features: [],
        quotas: [],
      });
      await service.updatePlan(plan.id, { status: 'active' });

      const subscription = await service.subscribeTenant({
        tenantId,
        planId: plan.id,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/billing/subscriptions/${subscription.id}/cancel`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('cancelled');
      expect(body.cancelledAt).not.toBeNull();
    });
  });

  // ─── Entitlement Routes ────────────────────────────────────────────────

  describe('POST /billing/entitlements/check', () => {
    it('should check entitlement', async () => {
      const plan = await service.createPlan({
        name: 'Entitlement Plan',
        tier: 'professional',
        features: [{ featureKey: 'bulk_import', enabled: true }],
        quotas: [],
      });
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const response = await app.inject({
        method: 'POST',
        url: '/billing/entitlements/check',
        payload: {
          tenantId,
          feature: 'bulk_import',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.allowed).toBe(true);
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/billing/entitlements/check',
        payload: {
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── Usage Routes ──────────────────────────────────────────────────────

  describe('POST /billing/usage/record', () => {
    it('should record usage within quota', async () => {
      const plan = await service.createPlan({
        name: 'Usage Plan',
        tier: 'starter',
        features: [],
        quotas: [{ metric: 'api_calls', limit: 1000 }],
      });
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const response = await app.inject({
        method: 'POST',
        url: '/billing/usage/record',
        payload: {
          tenantId,
          metric: 'api_calls',
          increment: 5,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.allowed).toBe(true);
      expect(body.used).toBe(5);
      expect(body.remaining).toBe(995);
    });

    it('should return 429 when quota exceeded', async () => {
      const plan = await service.createPlan({
        name: 'Limited Plan',
        tier: 'free',
        features: [],
        quotas: [{ metric: 'api_calls', limit: 10 }],
      });
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });

      const response = await app.inject({
        method: 'POST',
        url: '/billing/usage/record',
        payload: {
          tenantId,
          metric: 'api_calls',
          increment: 11,
        },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.allowed).toBe(false);
    });
  });

  describe('POST /billing/usage/query', () => {
    it('should query usage', async () => {
      const plan = await service.createPlan({
        name: 'Query Plan',
        tier: 'starter',
        features: [],
        quotas: [{ metric: 'students', limit: 500 }],
      });
      await service.updatePlan(plan.id, { status: 'active' });
      await service.subscribeTenant({ tenantId, planId: plan.id });
      await service.enforceQuota(tenantId, 'students', 42);

      const response = await app.inject({
        method: 'POST',
        url: '/billing/usage/query',
        payload: {
          tenantId,
          metric: 'students',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.used).toBe(42);
      expect(body.limit).toBe(500);
    });
  });

  describe('RBAC deny proofs (W1-SEC-02 D1)', () => {
    it('returns 403 when tenant admin creates a plan', async () => {
      await app.close();
      repository = new InMemoryBillingRepository();
      service = new BillingService(repository);
      app = Fastify();
      app.addHook('onRequest', async (request) => {
        (request as { user?: { roles?: unknown } }).user = {
          roles: [{ roleId: 'admin', roleName: 'Administrator' }],
        };
      });
      await registerBillingRoutes(app, { billingService: service, prefix: '/billing' });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/billing/plans',
        payload: {
          name: 'Blocked Plan',
          tier: 'starter',
          features: [],
          quotas: [],
        },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).code).toBe('FORBIDDEN');
    });

    it('returns 403 when tenant admin lists plans', async () => {
      await app.close();
      repository = new InMemoryBillingRepository();
      service = new BillingService(repository);
      app = Fastify();
      app.addHook('onRequest', async (request) => {
        (request as { user?: { roles?: unknown } }).user = {
          roles: [{ roleId: 'admin', roleName: 'Administrator' }],
        };
      });
      await registerBillingRoutes(app, { billingService: service, prefix: '/billing' });
      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/billing/plans',
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).code).toBe('FORBIDDEN');
    });
  });
});
