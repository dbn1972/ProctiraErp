/**
 * Tests for Entitlement Middleware
 *
 * Covers:
 * - Feature flag evaluation (plan-based, tenant-specific, percentage rollout)
 * - Rate limiting per tenant tier
 * - Error responses for quota exceeded and feature not entitled
 *
 * Charter: Section 10.2 (Required Controls)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { BillingService } from './billing-service.js';
import { InMemoryBillingRepository } from './in-memory-repository.js';
import {
  createEntitlementMiddleware,
  evaluateFeatureFlag,
  hashTenantFeature,
  InMemoryRateLimitStore,
  type FeatureFlagOverride,
} from './entitlement-middleware.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

async function buildTestApp(options?: {
  overrides?: FeatureFlagOverride[];
  rateLimits?: Record<string, { maxRequests: number; windowMs: number }>;
}) {
  const repository = new InMemoryBillingRepository();
  const billingService = new BillingService(repository);
  const rateLimitStore = new InMemoryRateLimitStore();

  const middleware = createEntitlementMiddleware({
    billingService,
    featureFlagOverrides: options?.overrides ?? [],
    rateLimits: options?.rateLimits,
    rateLimitStore,
    resolveTenantId: (request) => {
      return (request.headers['x-tenant-id'] as string) ?? undefined;
    },
  });

  const app = Fastify();

  // Route protected by feature flag
  app.get('/feature-protected', {
    preHandler: [middleware.requireFeature('custom_fields')],
  }, async () => ({ ok: true }));

  // Route protected by quota
  app.post('/quota-protected', {
    preHandler: [middleware.requireQuota('api_calls', 1)],
  }, async () => ({ ok: true }));

  // Route with rate limiting
  app.get('/rate-limited', {
    preHandler: [middleware.rateLimit()],
  }, async () => ({ ok: true }));

  await app.ready();

  return { app, repository, billingService, rateLimitStore, middleware };
}

/**
 * Helper to create a plan and subscribe a tenant.
 */
async function setupTenantWithPlan(
  billingService: BillingService,
  repository: InMemoryBillingRepository,
  tenantId: string,
  planConfig: {
    tier?: string;
    features?: { featureKey: string; enabled: boolean }[];
    quotas?: { metric: string; limit: number }[];
  } = {},
) {
  // Create a plan
  const plan = await billingService.createPlan({
    name: `Test Plan ${Date.now()}`,
    tier: (planConfig.tier ?? 'professional') as 'free' | 'starter' | 'professional' | 'enterprise' | 'custom',
    features: planConfig.features ?? [
      { featureKey: 'custom_fields', enabled: true },
      { featureKey: 'bulk_import', enabled: true },
      { featureKey: 'advanced_reports', enabled: false },
    ],
    quotas: planConfig.quotas ?? [
      { metric: 'api_calls', limit: 1000 },
      { metric: 'students', limit: 500 },
    ],
  });

  // Activate the plan
  await billingService.updatePlan(plan.id, { status: 'active' });

  // Subscribe the tenant
  const subscription = await billingService.subscribeTenant({
    tenantId,
    planId: plan.id,
  });

  return { plan, subscription };
}

// ─── Feature Flag Evaluation Unit Tests ──────────────────────────────────────

describe('evaluateFeatureFlag', () => {
  it('returns overridden=false when no overrides match', () => {
    const result = evaluateFeatureFlag('custom_fields', 'tenant-1', []);
    expect(result.overridden).toBe(false);
  });

  it('returns tenant-specific override when tenant matches', () => {
    const overrides: FeatureFlagOverride[] = [
      { featureKey: 'custom_fields', tenantIds: ['tenant-1', 'tenant-2'], enabled: true },
    ];
    const result = evaluateFeatureFlag('custom_fields', 'tenant-1', overrides);
    expect(result.overridden).toBe(true);
    expect(result.enabled).toBe(true);
  });

  it('returns tenant-specific override disabled when tenant matches', () => {
    const overrides: FeatureFlagOverride[] = [
      { featureKey: 'beta_feature', tenantIds: ['tenant-blocked'], enabled: false },
    ];
    const result = evaluateFeatureFlag('beta_feature', 'tenant-blocked', overrides);
    expect(result.overridden).toBe(true);
    expect(result.enabled).toBe(false);
  });

  it('does not match tenant-specific override for different tenant', () => {
    const overrides: FeatureFlagOverride[] = [
      { featureKey: 'custom_fields', tenantIds: ['tenant-1'], enabled: true },
    ];
    const result = evaluateFeatureFlag('custom_fields', 'tenant-other', overrides);
    expect(result.overridden).toBe(false);
  });

  it('applies percentage rollout consistently for same tenant+feature', () => {
    const overrides: FeatureFlagOverride[] = [
      { featureKey: 'new_ui', rolloutPercentage: 50, enabled: true },
    ];

    // Same tenant+feature should always get the same result
    const result1 = evaluateFeatureFlag('new_ui', 'tenant-abc', overrides);
    const result2 = evaluateFeatureFlag('new_ui', 'tenant-abc', overrides);
    expect(result1).toEqual(result2);
  });

  it('100% rollout enables for all tenants', () => {
    const overrides: FeatureFlagOverride[] = [
      { featureKey: 'new_ui', rolloutPercentage: 100, enabled: true },
    ];

    // All tenants should get the feature
    const results = ['t1', 't2', 't3', 't4', 't5'].map(
      (t) => evaluateFeatureFlag('new_ui', t, overrides),
    );
    expect(results.every((r) => r.overridden && r.enabled)).toBe(true);
  });

  it('0% rollout disables for all tenants', () => {
    const overrides: FeatureFlagOverride[] = [
      { featureKey: 'new_ui', rolloutPercentage: 0, enabled: true },
    ];

    // No tenants should get the feature via rollout
    const results = ['t1', 't2', 't3', 't4', 't5'].map(
      (t) => evaluateFeatureFlag('new_ui', t, overrides),
    );
    expect(results.every((r) => !r.overridden)).toBe(true);
  });

  it('does not match override for different feature key', () => {
    const overrides: FeatureFlagOverride[] = [
      { featureKey: 'other_feature', tenantIds: ['tenant-1'], enabled: true },
    ];
    const result = evaluateFeatureFlag('custom_fields', 'tenant-1', overrides);
    expect(result.overridden).toBe(false);
  });
});

describe('hashTenantFeature', () => {
  it('produces consistent results for same input', () => {
    const hash1 = hashTenantFeature('tenant-1', 'feature-a');
    const hash2 = hashTenantFeature('tenant-1', 'feature-a');
    expect(hash1).toBe(hash2);
  });

  it('produces different results for different inputs', () => {
    const hash1 = hashTenantFeature('tenant-1', 'feature-a');
    const hash2 = hashTenantFeature('tenant-2', 'feature-a');
    expect(hash1).not.toBe(hash2);
  });

  it('returns a non-negative number', () => {
    const hash = hashTenantFeature('any-tenant', 'any-feature');
    expect(hash).toBeGreaterThanOrEqual(0);
  });
});

// ─── InMemoryRateLimitStore Tests ────────────────────────────────────────────

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  it('returns null for unknown tenant', async () => {
    const entry = await store.get('unknown');
    expect(entry).toBeNull();
  });

  it('increments count within same window', async () => {
    const entry1 = await store.increment('tenant-1', 60_000);
    expect(entry1.count).toBe(1);

    const entry2 = await store.increment('tenant-1', 60_000);
    expect(entry2.count).toBe(2);
  });

  it('resets count when window expires', async () => {
    // Set an entry with an old window start
    await store.set('tenant-1', { count: 50, windowStart: Date.now() - 120_000 }, 60_000);

    // Increment should start a new window
    const entry = await store.increment('tenant-1', 60_000);
    expect(entry.count).toBe(1);
  });

  it('clears all entries', async () => {
    await store.increment('tenant-1', 60_000);
    store.clear();
    const entry = await store.get('tenant-1');
    expect(entry).toBeNull();
  });
});

// ─── Feature Guard Integration Tests ────────────────────────────────────────

describe('requireFeature preHandler', () => {
  let app: FastifyInstance;
  let billingService: BillingService;
  let repository: InMemoryBillingRepository;

  beforeEach(async () => {
    const result = await buildTestApp();
    app = result.app;
    billingService = result.billingService;
    repository = result.repository;
  });

  it('returns 401 when no tenant ID in request', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/feature-protected',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.code).toBe('UNAUTHORIZED');
    expect(body.message).toContain('Tenant context required');
  });

  it('returns 402 when tenant has no active subscription', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/feature-protected',
      headers: { 'x-tenant-id': 'tenant-no-sub' },
    });

    expect(response.statusCode).toBe(402);
    const body = response.json();
    expect(body.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('returns 403 when feature is disabled in plan', async () => {
    await setupTenantWithPlan(billingService, repository, 'tenant-1', {
      features: [
        { featureKey: 'custom_fields', enabled: false },
      ],
      quotas: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/feature-protected',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBe('FEATURE_NOT_ENTITLED');
    expect(body.feature).toBe('custom_fields');
  });

  it('allows request when feature is enabled in plan', async () => {
    await setupTenantWithPlan(billingService, repository, 'tenant-1', {
      features: [
        { featureKey: 'custom_fields', enabled: true },
      ],
      quotas: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/feature-protected',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('respects tenant-specific override (enable)', async () => {
    const { app: overrideApp } = await buildTestApp({
      overrides: [
        { featureKey: 'custom_fields', tenantIds: ['special-tenant'], enabled: true },
      ],
    });

    // Tenant has no subscription but has an override
    const response = await overrideApp.inject({
      method: 'GET',
      url: '/feature-protected',
      headers: { 'x-tenant-id': 'special-tenant' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('respects tenant-specific override (disable)', async () => {
    const { app: overrideApp, billingService: svc, repository: repo } = await buildTestApp({
      overrides: [
        { featureKey: 'custom_fields', tenantIds: ['blocked-tenant'], enabled: false },
      ],
    });

    // Even if tenant has the feature in their plan, override blocks it
    await setupTenantWithPlan(svc, repo, 'blocked-tenant', {
      features: [{ featureKey: 'custom_fields', enabled: true }],
      quotas: [],
    });

    const response = await overrideApp.inject({
      method: 'GET',
      url: '/feature-protected',
      headers: { 'x-tenant-id': 'blocked-tenant' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FEATURE_NOT_ENTITLED');
  });
});

// ─── Quota Guard Integration Tests ──────────────────────────────────────────

describe('requireQuota preHandler', () => {
  let app: FastifyInstance;
  let billingService: BillingService;
  let repository: InMemoryBillingRepository;

  beforeEach(async () => {
    const result = await buildTestApp();
    app = result.app;
    billingService = result.billingService;
    repository = result.repository;
  });

  it('returns 401 when no tenant ID in request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/quota-protected',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('returns 402 when tenant has no active subscription', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/quota-protected',
      headers: { 'x-tenant-id': 'tenant-no-sub' },
    });

    expect(response.statusCode).toBe(402);
    const body = response.json();
    expect(body.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('allows request when quota is available', async () => {
    await setupTenantWithPlan(billingService, repository, 'tenant-1', {
      features: [],
      quotas: [{ metric: 'api_calls', limit: 1000 }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/quota-protected',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 429 when quota is exceeded', async () => {
    await setupTenantWithPlan(billingService, repository, 'tenant-1', {
      features: [],
      quotas: [{ metric: 'api_calls', limit: 2 }],
    });

    // Use up the quota
    await billingService.enforceQuota('tenant-1', 'api_calls', 2);

    const response = await app.inject({
      method: 'POST',
      url: '/quota-protected',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(429);
    const body = response.json();
    expect(body.code).toBe('QUOTA_EXCEEDED');
    expect(body.metric).toBe('api_calls');
    expect(body.quota).toBeDefined();
    expect(body.quota.limit).toBe(2);
  });
});

// ─── Rate Limit Integration Tests ───────────────────────────────────────────

describe('rateLimit preHandler', () => {
  it('allows requests within rate limit', async () => {
    const { app, billingService, repository } = await buildTestApp({
      rateLimits: {
        free: { maxRequests: 5, windowMs: 60_000 },
        professional: { maxRequests: 100, windowMs: 60_000 },
      },
    });

    await setupTenantWithPlan(billingService, repository, 'tenant-1', {
      tier: 'professional',
      features: [],
      quotas: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/rate-limited',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBe('100');
    expect(response.headers['x-ratelimit-remaining']).toBe('99');
  });

  it('returns 429 when rate limit exceeded', async () => {
    const { app, billingService, repository } = await buildTestApp({
      rateLimits: {
        free: { maxRequests: 2, windowMs: 60_000 },
        starter: { maxRequests: 2, windowMs: 60_000 },
        professional: { maxRequests: 2, windowMs: 60_000 },
      },
    });

    await setupTenantWithPlan(billingService, repository, 'tenant-1', {
      tier: 'professional',
      features: [],
      quotas: [],
    });

    // Make requests up to the limit
    await app.inject({ method: 'GET', url: '/rate-limited', headers: { 'x-tenant-id': 'tenant-1' } });
    await app.inject({ method: 'GET', url: '/rate-limited', headers: { 'x-tenant-id': 'tenant-1' } });

    // Third request should be rate limited
    const response = await app.inject({
      method: 'GET',
      url: '/rate-limited',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(429);
    const body = response.json();
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.tier).toBe('professional');
    expect(body.limit).toBe(2);
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('uses free tier limits when tenant has no subscription', async () => {
    const { app } = await buildTestApp({
      rateLimits: {
        free: { maxRequests: 1, windowMs: 60_000 },
      },
    });

    // First request passes
    const response1 = await app.inject({
      method: 'GET',
      url: '/rate-limited',
      headers: { 'x-tenant-id': 'tenant-no-sub' },
    });
    expect(response1.statusCode).toBe(200);

    // Second request is rate limited
    const response2 = await app.inject({
      method: 'GET',
      url: '/rate-limited',
      headers: { 'x-tenant-id': 'tenant-no-sub' },
    });
    expect(response2.statusCode).toBe(429);
  });

  it('skips rate limiting when no tenant ID present', async () => {
    const { app } = await buildTestApp({
      rateLimits: {
        free: { maxRequests: 1, windowMs: 60_000 },
      },
    });

    // No tenant header — should pass without rate limiting
    const response = await app.inject({
      method: 'GET',
      url: '/rate-limited',
    });
    expect(response.statusCode).toBe(200);
  });

  it('applies different limits per tier', async () => {
    const { app, billingService, repository } = await buildTestApp({
      rateLimits: {
        free: { maxRequests: 1, windowMs: 60_000 },
        enterprise: { maxRequests: 100, windowMs: 60_000 },
      },
    });

    // Enterprise tenant gets higher limits
    await setupTenantWithPlan(billingService, repository, 'enterprise-tenant', {
      tier: 'enterprise',
      features: [],
      quotas: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/rate-limited',
      headers: { 'x-tenant-id': 'enterprise-tenant' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBe('100');
  });

  it('includes rate limit headers in response', async () => {
    const { app, billingService, repository } = await buildTestApp({
      rateLimits: {
        professional: { maxRequests: 50, windowMs: 60_000 },
      },
    });

    await setupTenantWithPlan(billingService, repository, 'tenant-1', {
      tier: 'professional',
      features: [],
      quotas: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/rate-limited',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });
});
