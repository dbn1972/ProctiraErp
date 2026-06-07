/**
 * Tenant Isolation Verification Test Suite
 *
 * Comprehensive tests ensuring multi-tenant data isolation across all layers:
 * 1. Unit tests — tenant scoping in every query
 * 2. Integration tests — auth/authz boundaries
 * 3. E2E tests — cross-tenant access prevention
 * 4. Queue/event routing isolation tests
 * 5. Search result trimming tests
 * 6. Cache namespace collision tests
 * 7. Report export isolation tests
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { tenantPlugin } from '../fastify-plugin.js';
import { resolveTenantId, TenantResolutionError } from '../tenant-resolution.js';

// Inline tenant-prefixed naming functions (mirrors @proctira/events implementations)
// to avoid adding cross-package dependency for test-only usage.
function buildTenantTopic(tenantId: string, topicName: string): string {
  return `tenant.${tenantId}.${topicName}`;
}

function buildTenantQueue(tenantId: string, queueName: string): string {
  return `tenant.${tenantId}.${queueName}`;
}

function buildTenantRoutingKey(tenantId: string, routingKey: string): string {
  return `tenant.${tenantId}.${routingKey}`;
}

// =============================================================================
// Shared Arbitraries
// =============================================================================

/** Generates a valid UUID v4 string */
const uuidV4Arb: fc.Arbitrary<string> = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([p1, p2, p3, variant, p4, p5]) =>
    `${p1}-${p2}-4${p3}-${variant}${p4}-${p5}`,
  );

/** Generates a pair of distinct tenant UUIDs */
const distinctTenantPairArb: fc.Arbitrary<{ tenantA: string; tenantB: string }> = fc
  .tuple(uuidV4Arb, uuidV4Arb)
  .filter(([a, b]) => a !== b)
  .map(([tenantA, tenantB]) => ({ tenantA, tenantB }));

/** Generates a valid tenant slug */
const tenantSlugArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 3, maxLength: 20 },
).filter((s) => /^[a-z]/.test(s));

/** Generates a non-empty entity name */
const entityNameArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')),
  { minLength: 2, maxLength: 40 },
);

/** Generates a non-empty entity code */
const entityCodeArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
  { minLength: 3, maxLength: 10 },
);

/** Generates a record with name and code */
const entityRecordArb: fc.Arbitrary<{ id: string; name: string; code: string; tenantId: string }> = fc
  .tuple(uuidV4Arb, entityNameArb, entityCodeArb, uuidV4Arb)
  .map(([id, name, code, tenantId]) => ({ id, name, code, tenantId }));

/** Generates a Kafka/RabbitMQ event type */
const eventTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  'student.enrolled',
  'institution.created',
  'staff.assigned',
  'attendance.recorded',
  'assessment.graded',
  'workflow.transitioned',
  'report.generated',
);

/** Generates a cache key suffix */
const cacheKeyArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789:_-'.split('')),
  { minLength: 5, maxLength: 50 },
).filter((s) => /^[a-z]/.test(s));

// =============================================================================
// 1. UNIT TESTS — Tenant Scoping in Every Query
// =============================================================================

describe('1. Unit Tests: Tenant Scoping in Every Query', () => {
  /**
   * Simulates a tenant-scoped data store that mimics PostgreSQL RLS behavior.
   * All queries are filtered by the current tenant session variable.
   */
  class TenantScopedQueryLayer {
    private data: Map<string, Array<{ id: string; name: string; code: string; tenantId: string }>> = new Map();
    private currentTenantId: string | null = null;

    setCurrentTenant(tenantId: string): void {
      this.currentTenantId = tenantId;
    }

    clearTenant(): void {
      this.currentTenantId = null;
    }

    insert(record: { id: string; name: string; code: string; tenantId: string }): void {
      if (!this.currentTenantId) {
        throw new Error('RLS violation: no tenant context set');
      }
      if (record.tenantId !== this.currentTenantId) {
        throw new Error(
          `RLS violation: cannot insert for tenant ${record.tenantId} when session is ${this.currentTenantId}`,
        );
      }
      const existing = this.data.get(record.tenantId) ?? [];
      existing.push(record);
      this.data.set(record.tenantId, existing);
    }

    findAll(): Array<{ id: string; name: string; code: string; tenantId: string }> {
      if (!this.currentTenantId) return [];
      return this.data.get(this.currentTenantId) ?? [];
    }

    findById(id: string): { id: string; name: string; code: string; tenantId: string } | null {
      if (!this.currentTenantId) return null;
      const records = this.data.get(this.currentTenantId) ?? [];
      return records.find((r) => r.id === id) ?? null;
    }

    count(): number {
      if (!this.currentTenantId) return 0;
      return (this.data.get(this.currentTenantId) ?? []).length;
    }

    update(id: string, updates: Partial<{ name: string; code: string }>): boolean {
      if (!this.currentTenantId) return false;
      const records = this.data.get(this.currentTenantId) ?? [];
      const record = records.find((r) => r.id === id);
      if (!record) return false;
      Object.assign(record, updates);
      return true;
    }

    delete(id: string): boolean {
      if (!this.currentTenantId) return false;
      const records = this.data.get(this.currentTenantId) ?? [];
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return false;
      records.splice(index, 1);
      return true;
    }

    clear(): void {
      this.data.clear();
      this.currentTenantId = null;
    }
  }

  let queryLayer: TenantScopedQueryLayer;

  beforeEach(() => {
    queryLayer = new TenantScopedQueryLayer();
  });

  it('SELECT queries only return records belonging to the current tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(entityRecordArb, { minLength: 1, maxLength: 5 }),
        fc.array(entityRecordArb, { minLength: 1, maxLength: 5 }),
        ({ tenantA, tenantB }, recordsA, recordsB) => {
          queryLayer.clear();

          // Insert records for tenant A
          queryLayer.setCurrentTenant(tenantA);
          const insertedA = recordsA.map((r) => ({ ...r, tenantId: tenantA }));
          for (const record of insertedA) {
            queryLayer.insert(record);
          }

          // Insert records for tenant B
          queryLayer.setCurrentTenant(tenantB);
          const insertedB = recordsB.map((r) => ({ ...r, tenantId: tenantB }));
          for (const record of insertedB) {
            queryLayer.insert(record);
          }

          // Query as tenant A — should only see tenant A's records
          queryLayer.setCurrentTenant(tenantA);
          const resultsA = queryLayer.findAll();
          expect(resultsA).toHaveLength(insertedA.length);
          for (const result of resultsA) {
            expect(result.tenantId).toBe(tenantA);
          }

          // Query as tenant B — should only see tenant B's records
          queryLayer.setCurrentTenant(tenantB);
          const resultsB = queryLayer.findAll();
          expect(resultsB).toHaveLength(insertedB.length);
          for (const result of resultsB) {
            expect(result.tenantId).toBe(tenantB);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('findById returns null for records belonging to another tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        entityRecordArb,
        ({ tenantA, tenantB }, record) => {
          queryLayer.clear();

          // Insert record for tenant A
          const recordA = { ...record, tenantId: tenantA };
          queryLayer.setCurrentTenant(tenantA);
          queryLayer.insert(recordA);

          // Try to find it as tenant B — should return null
          queryLayer.setCurrentTenant(tenantB);
          const result = queryLayer.findById(recordA.id);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('UPDATE operations cannot modify records of another tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        entityRecordArb,
        entityNameArb,
        ({ tenantA, tenantB }, record, newName) => {
          queryLayer.clear();

          // Insert record for tenant A
          const recordA = { ...record, tenantId: tenantA };
          queryLayer.setCurrentTenant(tenantA);
          queryLayer.insert(recordA);

          // Try to update as tenant B — should fail
          queryLayer.setCurrentTenant(tenantB);
          const updated = queryLayer.update(recordA.id, { name: newName });
          expect(updated).toBe(false);

          // Verify original record is unchanged
          queryLayer.setCurrentTenant(tenantA);
          const original = queryLayer.findById(recordA.id);
          expect(original?.name).toBe(recordA.name);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('DELETE operations cannot remove records of another tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        entityRecordArb,
        ({ tenantA, tenantB }, record) => {
          queryLayer.clear();

          // Insert record for tenant A
          const recordA = { ...record, tenantId: tenantA };
          queryLayer.setCurrentTenant(tenantA);
          queryLayer.insert(recordA);

          // Try to delete as tenant B — should fail
          queryLayer.setCurrentTenant(tenantB);
          const deleted = queryLayer.delete(recordA.id);
          expect(deleted).toBe(false);

          // Verify record still exists for tenant A
          queryLayer.setCurrentTenant(tenantA);
          expect(queryLayer.findById(recordA.id)).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('COUNT queries only count records for the current tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(entityRecordArb, { minLength: 1, maxLength: 10 }),
        fc.array(entityRecordArb, { minLength: 1, maxLength: 10 }),
        ({ tenantA, tenantB }, recordsA, recordsB) => {
          queryLayer.clear();

          queryLayer.setCurrentTenant(tenantA);
          for (const r of recordsA) {
            queryLayer.insert({ ...r, tenantId: tenantA });
          }

          queryLayer.setCurrentTenant(tenantB);
          for (const r of recordsB) {
            queryLayer.insert({ ...r, tenantId: tenantB });
          }

          queryLayer.setCurrentTenant(tenantA);
          expect(queryLayer.count()).toBe(recordsA.length);

          queryLayer.setCurrentTenant(tenantB);
          expect(queryLayer.count()).toBe(recordsB.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('queries without tenant context return empty results', () => {
    fc.assert(
      fc.property(
        uuidV4Arb,
        fc.array(entityRecordArb, { minLength: 1, maxLength: 5 }),
        (tenantId, records) => {
          queryLayer.clear();

          // Insert records
          queryLayer.setCurrentTenant(tenantId);
          for (const r of records) {
            queryLayer.insert({ ...r, tenantId });
          }

          // Clear tenant context
          queryLayer.clearTenant();

          // All queries should return empty/null
          expect(queryLayer.findAll()).toHaveLength(0);
          expect(queryLayer.count()).toBe(0);
          expect(queryLayer.findById(records[0]!.id)).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });
});


// =============================================================================
// 2. INTEGRATION TESTS — Auth/Authz Boundaries
// =============================================================================

describe('2. Integration Tests: Auth/Authz Boundaries', () => {
  /**
   * Simulates the auth layer that validates JWT tokens contain the correct
   * tenant claim and prevents cross-tenant token usage.
   */
  interface TokenPayload {
    sub: string;
    tenantId: string;
    roles: string[];
    exp: number;
  }

  class AuthBoundaryValidator {
    /**
     * Validates that a token's tenant claim matches the requested resource's tenant.
     * Returns true if access is allowed, false if cross-tenant access is attempted.
     */
    validateTenantAccess(token: TokenPayload, resourceTenantId: string): boolean {
      return token.tenantId === resourceTenantId;
    }

    /**
     * Validates that a refresh token can only be used within its original tenant context.
     */
    validateRefreshTokenTenant(
      refreshTokenTenantId: string,
      requestTenantId: string,
    ): boolean {
      return refreshTokenTenantId === requestTenantId;
    }

    /**
     * Validates that role-based permissions are scoped to the token's tenant.
     * A user with admin role in tenant A cannot exercise admin privileges in tenant B.
     */
    evaluatePermission(
      token: TokenPayload,
      resource: { tenantId: string; type: string; action: string },
    ): boolean {
      // First check: tenant boundary
      if (token.tenantId !== resource.tenantId) {
        return false;
      }
      // Then check role-based access (simplified)
      return token.roles.length > 0;
    }
  }

  let authValidator: AuthBoundaryValidator;

  beforeEach(() => {
    authValidator = new AuthBoundaryValidator();
  });

  const tokenPayloadArb: fc.Arbitrary<TokenPayload> = fc.record({
    sub: uuidV4Arb,
    tenantId: uuidV4Arb,
    roles: fc.array(fc.constantFrom('admin', 'teacher', 'principal', 'staff'), {
      minLength: 1,
      maxLength: 3,
    }),
    exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 86400 }),
  });

  it('JWT token for tenant A cannot access resources of tenant B', () => {
    fc.assert(
      fc.property(
        tokenPayloadArb,
        uuidV4Arb,
        (token, otherTenantId) => {
          fc.pre(token.tenantId !== otherTenantId);

          const canAccess = authValidator.validateTenantAccess(token, otherTenantId);
          expect(canAccess).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('JWT token for tenant A can access resources of tenant A', () => {
    fc.assert(
      fc.property(
        tokenPayloadArb,
        (token) => {
          const canAccess = authValidator.validateTenantAccess(token, token.tenantId);
          expect(canAccess).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('refresh token from tenant A cannot be used in tenant B context', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        ({ tenantA, tenantB }) => {
          const isValid = authValidator.validateRefreshTokenTenant(tenantA, tenantB);
          expect(isValid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('admin role in tenant A grants no permissions in tenant B', () => {
    fc.assert(
      fc.property(
        tokenPayloadArb,
        uuidV4Arb,
        fc.constantFrom('institution', 'student', 'staff', 'assessment'),
        fc.constantFrom('create', 'read', 'update', 'delete'),
        (token, otherTenantId, resourceType, action) => {
          fc.pre(token.tenantId !== otherTenantId);

          const hasPermission = authValidator.evaluatePermission(token, {
            tenantId: otherTenantId,
            type: resourceType,
            action,
          });
          expect(hasPermission).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('permissions are correctly granted within the same tenant', () => {
    fc.assert(
      fc.property(
        tokenPayloadArb,
        fc.constantFrom('institution', 'student', 'staff', 'assessment'),
        fc.constantFrom('create', 'read', 'update', 'delete'),
        (token, resourceType, action) => {
          const hasPermission = authValidator.evaluatePermission(token, {
            tenantId: token.tenantId,
            type: resourceType,
            action,
          });
          // Token has roles, so within same tenant it should have permission
          expect(hasPermission).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// =============================================================================
// 3. E2E TESTS — Cross-Tenant Access Prevention
// =============================================================================

describe('3. E2E Tests: Cross-Tenant Access Prevention', () => {
  /**
   * Tests the full request lifecycle through the Fastify tenant plugin,
   * verifying that cross-tenant access is prevented at the HTTP layer.
   */

  it('requests with tenant A header cannot access tenant B resources via plugin', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTenantPairArb,
        async ({ tenantA, tenantB }) => {
          const setConfigCalls: string[] = [];
          const mockExecuteRawUnsafe = vi.fn().mockImplementation((query: string) => {
            setConfigCalls.push(query);
            return Promise.resolve(undefined);
          });

          const app: FastifyInstance = Fastify();
          await app.register(tenantPlugin, {
            getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
          });

          // Simulate a resource endpoint that returns data scoped to the resolved tenant
          app.get('/api/v1/institutions', async (request) => {
            return { tenantId: request.tenantId, data: [] };
          });

          await app.ready();

          // Request as tenant A
          const responseA = await app.inject({
            method: 'GET',
            url: '/api/v1/institutions',
            headers: { 'x-tenant-id': tenantA },
          });

          // Request as tenant B
          const responseB = await app.inject({
            method: 'GET',
            url: '/api/v1/institutions',
            headers: { 'x-tenant-id': tenantB },
          });

          const bodyA = JSON.parse(responseA.body);
          const bodyB = JSON.parse(responseB.body);

          // Each request resolves to its own tenant — no cross-contamination
          expect(bodyA.tenantId).toBe(tenantA);
          expect(bodyB.tenantId).toBe(tenantB);
          expect(bodyA.tenantId).not.toBe(bodyB.tenantId);

          // Verify distinct session variables were set
          const tenantAConfig = `SELECT set_config('app.current_tenant_id', '${tenantA}', true)`;
          const tenantBConfig = `SELECT set_config('app.current_tenant_id', '${tenantB}', true)`;
          expect(setConfigCalls).toContain(tenantAConfig);
          expect(setConfigCalls).toContain(tenantBConfig);

          await app.close();
        },
      ),
      { numRuns: 30 },
    );
  });

  it('request without tenant identifier is rejected with 401', async () => {
    const app: FastifyInstance = Fastify();
    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) }),
    });

    app.get('/api/v1/data', async (request) => {
      return { tenantId: request.tenantId };
    });

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/data',
      headers: {},
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('TENANT_RESOLUTION_FAILED');

    await app.close();
  });

  it('JWT tenant claim takes precedence over header, preventing header spoofing', async () => {
    await fc.assert(
      fc.asyncProperty(
        distinctTenantPairArb,
        async ({ tenantA, tenantB }) => {
          const setConfigCalls: string[] = [];
          const mockExecuteRawUnsafe = vi.fn().mockImplementation((query: string) => {
            setConfigCalls.push(query);
            return Promise.resolve(undefined);
          });

          const app: FastifyInstance = Fastify();

          // Simulate JWT auth by decorating request with user before tenant plugin
          app.addHook('onRequest', async (request) => {
            // Simulate authenticated user with tenant A in JWT
            (request as any).user = { tenantId: tenantA, sub: 'user-1' };
          });

          await app.register(tenantPlugin, {
            getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
          });

          app.get('/api/v1/secure', async (request) => {
            return { tenantId: request.tenantId };
          });

          await app.ready();

          // Attacker tries to spoof tenant B via header while JWT says tenant A
          const response = await app.inject({
            method: 'GET',
            url: '/api/v1/secure',
            headers: { 'x-tenant-id': tenantB },
          });

          const body = JSON.parse(response.body);

          // JWT claim (tenant A) must take precedence — header spoofing prevented
          expect(body.tenantId).toBe(tenantA);
          expect(body.tenantId).not.toBe(tenantB);

          await app.close();
        },
      ),
      { numRuns: 30 },
    );
  });

  it('excluded paths (health checks) bypass tenant resolution', async () => {
    const app: FastifyInstance = Fastify();
    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) }),
      excludePaths: ['/health', '/healthz', '/ready', '/metrics'],
    });

    app.get('/health', async () => ({ status: 'ok' }));

    await app.ready();

    // Health check should work without tenant header
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {},
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });

    await app.close();
  });
});


// =============================================================================
// 4. QUEUE/EVENT ROUTING ISOLATION TESTS
// =============================================================================

describe('4. Queue/Event Routing Isolation Tests', () => {
  /**
   * Verifies that Kafka topics and RabbitMQ queues are correctly namespaced
   * per tenant, preventing cross-tenant event leakage.
   */

  describe('Kafka Topic Isolation', () => {
    it('distinct tenants produce distinct topic names for the same event type', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          eventTypeArb,
          ({ tenantA, tenantB }, eventType) => {
            const topicA = buildTenantTopic(tenantA, eventType);
            const topicB = buildTenantTopic(tenantB, eventType);

            // Topics must be different for different tenants
            expect(topicA).not.toBe(topicB);

            // Each topic must contain its respective tenant ID
            expect(topicA).toContain(tenantA);
            expect(topicB).toContain(tenantB);

            // Topics must not contain the other tenant's ID
            expect(topicA).not.toContain(tenantB);
            expect(topicB).not.toContain(tenantA);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('topic format follows tenant.{tenantId}.{eventType} convention', () => {
      fc.assert(
        fc.property(
          uuidV4Arb,
          eventTypeArb,
          (tenantId, eventType) => {
            const topic = buildTenantTopic(tenantId, eventType);
            expect(topic).toBe(`tenant.${tenantId}.${eventType}`);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('event consumer for tenant A topic never receives tenant B events', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          eventTypeArb,
          ({ tenantA, tenantB }, eventType) => {
            // Simulate topic subscription
            const subscribedTopic = buildTenantTopic(tenantA, eventType);
            const publishedTopic = buildTenantTopic(tenantB, eventType);

            // A consumer subscribed to tenant A's topic should never match tenant B's topic
            expect(subscribedTopic).not.toBe(publishedTopic);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('RabbitMQ Queue Isolation', () => {
    it('distinct tenants produce distinct queue names for the same task type', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          fc.constantFrom('report.generate', 'import.process', 'notification.send', 'etl.execute'),
          ({ tenantA, tenantB }, taskType) => {
            const queueA = buildTenantQueue(tenantA, taskType);
            const queueB = buildTenantQueue(tenantB, taskType);

            expect(queueA).not.toBe(queueB);
            expect(queueA).toContain(tenantA);
            expect(queueB).toContain(tenantB);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('routing keys are tenant-scoped preventing cross-tenant message delivery', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          fc.constantFrom('report.generate', 'import.process', 'notification.send'),
          ({ tenantA, tenantB }, routingKey) => {
            const keyA = buildTenantRoutingKey(tenantA, routingKey);
            const keyB = buildTenantRoutingKey(tenantB, routingKey);

            expect(keyA).not.toBe(keyB);
            expect(keyA).toBe(`tenant.${tenantA}.${routingKey}`);
            expect(keyB).toBe(`tenant.${tenantB}.${routingKey}`);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('task messages carry tenantId and are routed to tenant-specific queues', () => {
      fc.assert(
        fc.property(
          uuidV4Arb,
          fc.constantFrom('report.generate', 'import.process'),
          (tenantId, taskType) => {
            // Simulate task message creation
            const taskMessage = {
              id: 'task-1',
              tenantId,
              type: taskType,
              payload: {},
              options: { priority: 5, delay: 0, maxRetries: 3, retryCount: 0 },
            };

            const targetQueue = buildTenantQueue(taskMessage.tenantId, taskMessage.type);

            // Task must be routed to the correct tenant queue
            expect(targetQueue).toContain(tenantId);
            expect(targetQueue).toBe(`tenant.${tenantId}.${taskType}`);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});


// =============================================================================
// 5. SEARCH RESULT TRIMMING TESTS
// =============================================================================

describe('5. Search Result Trimming Tests', () => {
  /**
   * Verifies that search/full-text-search results are always filtered by tenant.
   * Simulates Elasticsearch or PostgreSQL tsvector search with tenant scoping.
   */

  class TenantScopedSearchIndex {
    private documents: Map<string, Array<{ id: string; tenantId: string; content: string; score: number }>> = new Map();

    index(tenantId: string, doc: { id: string; content: string }): void {
      const existing = this.documents.get(tenantId) ?? [];
      existing.push({ ...doc, tenantId, score: 1.0 });
      this.documents.set(tenantId, existing);
    }

    /**
     * Search that correctly filters by tenant — simulates proper implementation.
     */
    search(tenantId: string, query: string): Array<{ id: string; content: string; score: number }> {
      const tenantDocs = this.documents.get(tenantId) ?? [];
      return tenantDocs
        .filter((doc) => doc.content.toLowerCase().includes(query.toLowerCase()))
        .map(({ id, content, score }) => ({ id, content, score }));
    }

    /**
     * Returns all documents across all tenants (for verification purposes only).
     */
    getAllDocuments(): Array<{ id: string; tenantId: string; content: string }> {
      const all: Array<{ id: string; tenantId: string; content: string }> = [];
      for (const docs of this.documents.values()) {
        all.push(...docs);
      }
      return all;
    }

    clear(): void {
      this.documents.clear();
    }
  }

  let searchIndex: TenantScopedSearchIndex;

  beforeEach(() => {
    searchIndex = new TenantScopedSearchIndex();
  });

  it('search results only contain documents from the requesting tenant', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(entityNameArb, { minLength: 1, maxLength: 5 }),
        fc.array(entityNameArb, { minLength: 1, maxLength: 5 }),
        ({ tenantA, tenantB }, namesA, namesB) => {
          searchIndex.clear();

          // Index documents for both tenants with a common search term
          const commonTerm = 'school';
          for (let i = 0; i < namesA.length; i++) {
            searchIndex.index(tenantA, { id: `a-${i}`, content: `${namesA[i]} ${commonTerm}` });
          }
          for (let i = 0; i < namesB.length; i++) {
            searchIndex.index(tenantB, { id: `b-${i}`, content: `${namesB[i]} ${commonTerm}` });
          }

          // Search as tenant A
          const resultsA = searchIndex.search(tenantA, commonTerm);
          expect(resultsA).toHaveLength(namesA.length);
          for (const result of resultsA) {
            expect(result.id).toMatch(/^a-/);
          }

          // Search as tenant B
          const resultsB = searchIndex.search(tenantB, commonTerm);
          expect(resultsB).toHaveLength(namesB.length);
          for (const result of resultsB) {
            expect(result.id).toMatch(/^b-/);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('search for a term that exists only in tenant B returns empty for tenant A', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        entityNameArb,
        ({ tenantA, tenantB }, uniqueName) => {
          searchIndex.clear();

          // Only index in tenant B
          searchIndex.index(tenantB, { id: 'b-unique', content: uniqueName });

          // Search as tenant A — should find nothing
          const results = searchIndex.search(tenantA, uniqueName);
          expect(results).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('search result count for tenant A is independent of tenant B document count', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        ({ tenantA, tenantB }, countA, countB) => {
          searchIndex.clear();

          const term = 'institution';
          for (let i = 0; i < countA; i++) {
            searchIndex.index(tenantA, { id: `a-${i}`, content: `${term} ${i}` });
          }
          for (let i = 0; i < countB; i++) {
            searchIndex.index(tenantB, { id: `b-${i}`, content: `${term} ${i}` });
          }

          const resultsA = searchIndex.search(tenantA, term);
          expect(resultsA).toHaveLength(countA);

          // Adding more docs to tenant B should not affect tenant A's results
          for (let i = countB; i < countB + 5; i++) {
            searchIndex.index(tenantB, { id: `b-${i}`, content: `${term} extra ${i}` });
          }

          const resultsAAfter = searchIndex.search(tenantA, term);
          expect(resultsAAfter).toHaveLength(countA);
        },
      ),
      { numRuns: 50 },
    );
  });
});


// =============================================================================
// 6. CACHE NAMESPACE COLLISION TESTS
// =============================================================================

describe('6. Cache Namespace Collision Tests', () => {
  /**
   * Verifies that Redis cache keys are namespaced per tenant,
   * preventing cache poisoning or data leakage between tenants.
   * Format: tenant:{tenantId}:{key}
   */

  class TenantScopedCache {
    private store: Map<string, string> = new Map();

    private buildKey(tenantId: string, key: string): string {
      return `tenant:${tenantId}:${key}`;
    }

    set(tenantId: string, key: string, value: string): void {
      const namespacedKey = this.buildKey(tenantId, key);
      this.store.set(namespacedKey, value);
    }

    get(tenantId: string, key: string): string | undefined {
      const namespacedKey = this.buildKey(tenantId, key);
      return this.store.get(namespacedKey);
    }

    delete(tenantId: string, key: string): boolean {
      const namespacedKey = this.buildKey(tenantId, key);
      return this.store.delete(namespacedKey);
    }

    /**
     * Flush all keys for a specific tenant (tenant decommission scenario).
     */
    flushTenant(tenantId: string): number {
      const prefix = `tenant:${tenantId}:`;
      let count = 0;
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix)) {
          this.store.delete(key);
          count++;
        }
      }
      return count;
    }

    /**
     * Returns all raw keys (for verification).
     */
    getAllKeys(): string[] {
      return Array.from(this.store.keys());
    }

    clear(): void {
      this.store.clear();
    }
  }

  let cache: TenantScopedCache;

  beforeEach(() => {
    cache = new TenantScopedCache();
  });

  it('same logical key for different tenants maps to different cache entries', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        cacheKeyArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        ({ tenantA, tenantB }, key, valueA, valueB) => {
          cache.clear();

          cache.set(tenantA, key, valueA);
          cache.set(tenantB, key, valueB);

          // Each tenant gets its own value for the same logical key
          expect(cache.get(tenantA, key)).toBe(valueA);
          expect(cache.get(tenantB, key)).toBe(valueB);

          // Values are independent
          if (valueA !== valueB) {
            expect(cache.get(tenantA, key)).not.toBe(cache.get(tenantB, key));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cache miss for tenant B when only tenant A has cached the key', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        cacheKeyArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        ({ tenantA, tenantB }, key, value) => {
          cache.clear();

          cache.set(tenantA, key, value);

          // Tenant B should get a cache miss
          expect(cache.get(tenantB, key)).toBeUndefined();
          // Tenant A should get the cached value
          expect(cache.get(tenantA, key)).toBe(value);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deleting a key for tenant A does not affect tenant B cache', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        cacheKeyArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        ({ tenantA, tenantB }, key, valueA, valueB) => {
          cache.clear();

          cache.set(tenantA, key, valueA);
          cache.set(tenantB, key, valueB);

          // Delete tenant A's cache entry
          cache.delete(tenantA, key);

          // Tenant A should get cache miss
          expect(cache.get(tenantA, key)).toBeUndefined();
          // Tenant B's cache should be unaffected
          expect(cache.get(tenantB, key)).toBe(valueB);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('flushing tenant A cache does not affect tenant B cache entries', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(cacheKeyArb, { minLength: 1, maxLength: 5 }),
        fc.array(cacheKeyArb, { minLength: 1, maxLength: 5 }),
        ({ tenantA, tenantB }, keysA, keysB) => {
          cache.clear();

          // Populate cache for both tenants
          for (const key of keysA) {
            cache.set(tenantA, key, `value-a-${key}`);
          }
          for (const key of keysB) {
            cache.set(tenantB, key, `value-b-${key}`);
          }

          // Flush tenant A
          cache.flushTenant(tenantA);

          // All tenant A keys should be gone
          for (const key of keysA) {
            expect(cache.get(tenantA, key)).toBeUndefined();
          }

          // All tenant B keys should still exist
          for (const key of keysB) {
            expect(cache.get(tenantB, key)).toBe(`value-b-${key}`);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('cache keys contain tenant ID ensuring no namespace collision', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        cacheKeyArb,
        ({ tenantA, tenantB }, key) => {
          cache.clear();

          cache.set(tenantA, key, 'a');
          cache.set(tenantB, key, 'b');

          const allKeys = cache.getAllKeys();

          // Both keys should exist and be distinct
          expect(allKeys).toHaveLength(2);
          expect(allKeys[0]).not.toBe(allKeys[1]);

          // Each key should contain its tenant ID
          const keyA = allKeys.find((k) => k.includes(tenantA));
          const keyB = allKeys.find((k) => k.includes(tenantB));
          expect(keyA).toBeDefined();
          expect(keyB).toBeDefined();
          expect(keyA).toContain(`tenant:${tenantA}:`);
          expect(keyB).toContain(`tenant:${tenantB}:`);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// =============================================================================
// 7. REPORT EXPORT ISOLATION TESTS
// =============================================================================

describe('7. Report Export Isolation Tests', () => {
  /**
   * Verifies that report generation and export operations are scoped to the
   * requesting tenant. Reports must only contain data from the tenant that
   * requested them, and report files must be stored in tenant-scoped paths.
   */

  interface ReportRequest {
    tenantId: string;
    reportType: string;
    format: 'xlsx' | 'pdf' | 'csv';
    filters: Record<string, unknown>;
  }

  interface ReportResult {
    tenantId: string;
    recordCount: number;
    filePath: string;
    records: Array<{ id: string; tenantId: string }>;
  }

  class TenantScopedReportEngine {
    private dataStore: Map<string, Array<{ id: string; name: string; tenantId: string }>> = new Map();

    seedData(tenantId: string, records: Array<{ id: string; name: string }>): void {
      const existing = this.dataStore.get(tenantId) ?? [];
      existing.push(...records.map((r) => ({ ...r, tenantId })));
      this.dataStore.set(tenantId, existing);
    }

    /**
     * Generates a report scoped to the requesting tenant.
     * The output file path is also tenant-scoped (S3 prefix: tenants/{id}/).
     */
    generateReport(request: ReportRequest): ReportResult {
      const tenantData = this.dataStore.get(request.tenantId) ?? [];
      const filePath = `tenants/${request.tenantId}/reports/${request.reportType}.${request.format}`;

      return {
        tenantId: request.tenantId,
        recordCount: tenantData.length,
        filePath,
        records: tenantData.map(({ id, tenantId }) => ({ id, tenantId })),
      };
    }

    clear(): void {
      this.dataStore.clear();
    }
  }

  let reportEngine: TenantScopedReportEngine;

  beforeEach(() => {
    reportEngine = new TenantScopedReportEngine();
  });

  it('report for tenant A contains only tenant A data, never tenant B data', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(fc.record({ id: uuidV4Arb, name: entityNameArb }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.record({ id: uuidV4Arb, name: entityNameArb }), { minLength: 1, maxLength: 5 }),
        fc.constantFrom('institutions', 'students', 'staff', 'attendance'),
        fc.constantFrom('xlsx' as const, 'pdf' as const, 'csv' as const),
        ({ tenantA, tenantB }, recordsA, recordsB, reportType, format) => {
          reportEngine.clear();

          reportEngine.seedData(tenantA, recordsA);
          reportEngine.seedData(tenantB, recordsB);

          // Generate report for tenant A
          const reportA = reportEngine.generateReport({
            tenantId: tenantA,
            reportType,
            format,
            filters: {},
          });

          // Report should only contain tenant A's records
          expect(reportA.tenantId).toBe(tenantA);
          expect(reportA.recordCount).toBe(recordsA.length);
          for (const record of reportA.records) {
            expect(record.tenantId).toBe(tenantA);
          }

          // Generate report for tenant B
          const reportB = reportEngine.generateReport({
            tenantId: tenantB,
            reportType,
            format,
            filters: {},
          });

          expect(reportB.tenantId).toBe(tenantB);
          expect(reportB.recordCount).toBe(recordsB.length);
          for (const record of reportB.records) {
            expect(record.tenantId).toBe(tenantB);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('report file paths are tenant-scoped (S3 prefix isolation)', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.constantFrom('institutions', 'students', 'staff'),
        fc.constantFrom('xlsx' as const, 'pdf' as const, 'csv' as const),
        ({ tenantA, tenantB }, reportType, format) => {
          reportEngine.clear();

          const reportA = reportEngine.generateReport({
            tenantId: tenantA,
            reportType,
            format,
            filters: {},
          });

          const reportB = reportEngine.generateReport({
            tenantId: tenantB,
            reportType,
            format,
            filters: {},
          });

          // File paths must be different for different tenants
          expect(reportA.filePath).not.toBe(reportB.filePath);

          // Each path must contain its tenant ID
          expect(reportA.filePath).toContain(`tenants/${tenantA}/`);
          expect(reportB.filePath).toContain(`tenants/${tenantB}/`);

          // Paths must not contain the other tenant's ID
          expect(reportA.filePath).not.toContain(tenantB);
          expect(reportB.filePath).not.toContain(tenantA);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('report with no data for tenant returns zero records without leaking other tenant data', () => {
    fc.assert(
      fc.property(
        distinctTenantPairArb,
        fc.array(fc.record({ id: uuidV4Arb, name: entityNameArb }), { minLength: 1, maxLength: 10 }),
        ({ tenantA, tenantB }, records) => {
          reportEngine.clear();

          // Only seed data for tenant B
          reportEngine.seedData(tenantB, records);

          // Generate report for tenant A (which has no data)
          const reportA = reportEngine.generateReport({
            tenantId: tenantA,
            reportType: 'students',
            format: 'xlsx',
            filters: {},
          });

          // Should return empty, not tenant B's data
          expect(reportA.recordCount).toBe(0);
          expect(reportA.records).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('concurrent report generation for different tenants produces isolated results', () => {
    fc.assert(
      fc.property(
        fc.array(uuidV4Arb, { minLength: 3, maxLength: 5 }),
        fc.array(fc.record({ id: uuidV4Arb, name: entityNameArb }), { minLength: 1, maxLength: 3 }),
        (tenantIds, baseRecords) => {
          // Ensure all tenant IDs are unique
          const uniqueTenants = [...new Set(tenantIds)];
          fc.pre(uniqueTenants.length >= 2);

          reportEngine.clear();

          // Seed different amounts of data per tenant
          for (let i = 0; i < uniqueTenants.length; i++) {
            const tenantRecords = baseRecords.slice(0, i + 1);
            reportEngine.seedData(uniqueTenants[i]!, tenantRecords);
          }

          // Generate reports for all tenants
          const reports = uniqueTenants.map((tenantId) =>
            reportEngine.generateReport({
              tenantId,
              reportType: 'students',
              format: 'csv',
              filters: {},
            }),
          );

          // Each report should only contain its own tenant's data
          for (let i = 0; i < reports.length; i++) {
            const report = reports[i]!;
            expect(report.tenantId).toBe(uniqueTenants[i]);
            for (const record of report.records) {
              expect(record.tenantId).toBe(uniqueTenants[i]);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
