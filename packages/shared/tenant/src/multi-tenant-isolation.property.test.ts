/**
 * Property-based tests for multi-tenant isolation.
 *
 * Property 6: Multi-Tenant Isolation
 *
 * For any two distinct tenants T1 and T2, data created by tenant A is never
 * visible to tenant B when querying through the tenant-scoped data access layer.
 * This tests the tenant resolution logic and RLS policy enforcement.
 *
 * **Validates: Requirements 4.7**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { tenantPlugin } from './fastify-plugin.js';
import { resolveTenantId, TenantResolutionError } from './tenant-resolution.js';

// --- Arbitraries ---

/**
 * Generates a valid UUID v4 string that passes the tenant resolution UUID validation.
 * The regex requires: version digit = 4, variant = [89ab].
 */
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

/**
 * Generates a pair of distinct tenant UUIDs (v4 format).
 * Ensures T1 !== T2 for isolation testing.
 */
const distinctTenantPairArb: fc.Arbitrary<{ tenantA: string; tenantB: string }> = fc
  .tuple(uuidV4Arb, uuidV4Arb)
  .filter(([a, b]) => a !== b)
  .map(([tenantA, tenantB]) => ({ tenantA, tenantB }));

/** Generates a non-empty array of institution-like records scoped to a tenant. */
const institutionRecordsArb: fc.Arbitrary<Array<{ name: string; code: string }>> = fc.array(
  fc.record({
    name: fc.stringOf(
      fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')),
      { minLength: 2, maxLength: 40 },
    ),
    code: fc.stringOf(
      fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
      { minLength: 3, maxLength: 10 },
    ),
  }),
  { minLength: 1, maxLength: 5 },
);

/** Generates a valid tenant slug for subdomain resolution. */
const tenantSlugArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  { minLength: 3, maxLength: 20 },
).filter((s) => /^[a-z]/.test(s));

/**
 * Generates a pair of distinct tenant slugs.
 */
const distinctSlugPairArb: fc.Arbitrary<{ slugA: string; slugB: string }> = fc
  .tuple(tenantSlugArb, tenantSlugArb)
  .filter(([a, b]) => a !== b)
  .map(([slugA, slugB]) => ({ slugA, slugB }));

// --- Simulated Tenant-Scoped Data Store ---

/**
 * Simulates a tenant-scoped data store that mimics PostgreSQL RLS behavior.
 * Data is stored per tenant, and queries only return data for the "current" tenant
 * (the one whose session variable is set).
 */
class TenantScopedStore {
  private data: Map<string, Array<{ name: string; code: string }>> = new Map();
  private currentTenantId: string | null = null;

  /** Simulates SET LOCAL app.current_tenant_id = '<id>' */
  setCurrentTenant(tenantId: string): void {
    this.currentTenantId = tenantId;
  }

  /** Simulates INSERT with RLS check (tenant_id must match current_setting) */
  insert(tenantId: string, record: { name: string; code: string }): void {
    if (tenantId !== this.currentTenantId) {
      throw new Error(
        `RLS violation: cannot insert for tenant ${tenantId} when session is set to ${this.currentTenantId}`,
      );
    }
    const existing = this.data.get(tenantId) ?? [];
    existing.push(record);
    this.data.set(tenantId, existing);
  }

  /** Simulates SELECT with RLS filter (only returns rows where tenant_id = current_setting) */
  query(): Array<{ name: string; code: string }> {
    if (!this.currentTenantId) {
      return [];
    }
    return this.data.get(this.currentTenantId) ?? [];
  }

  clear(): void {
    this.data.clear();
    this.currentTenantId = null;
  }
}

// --- Helper: Mock Fastify Request ---

function createMockRequest(overrides: {
  user?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
  hostname?: string;
} = {}): FastifyRequest {
  return {
    user: overrides.user,
    headers: overrides.headers ?? {},
    hostname: overrides.hostname ?? 'localhost',
    url: '/test',
  } as unknown as FastifyRequest;
}

// --- Property 6: Multi-Tenant Isolation ---

describe('Property 6: Multi-Tenant Isolation', () => {
  // Feature: proctira-unified-platform, Property 6: Multi-Tenant Isolation
  // **Validates: Requirements 4.7**

  describe('RLS Policy Enforcement: Data created by tenant A is never visible to tenant B', () => {
    let store: TenantScopedStore;

    beforeEach(() => {
      store = new TenantScopedStore();
    });

    it('querying as tenant B returns zero records from tenant A data', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          institutionRecordsArb,
          ({ tenantA, tenantB }, records) => {
            store.clear();

            // Seed data as tenant A (simulates RLS-enforced insert)
            store.setCurrentTenant(tenantA);
            for (const record of records) {
              store.insert(tenantA, record);
            }

            // Switch context to tenant B and query
            store.setCurrentTenant(tenantB);
            const tenantBResults = store.query();

            // Tenant B should see NO data from tenant A
            expect(tenantBResults).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('querying as tenant A returns only tenant A data when both tenants have data', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          institutionRecordsArb,
          institutionRecordsArb,
          ({ tenantA, tenantB }, recordsA, recordsB) => {
            store.clear();

            // Seed data for tenant A
            store.setCurrentTenant(tenantA);
            for (const record of recordsA) {
              store.insert(tenantA, record);
            }

            // Seed data for tenant B
            store.setCurrentTenant(tenantB);
            for (const record of recordsB) {
              store.insert(tenantB, record);
            }

            // Query as tenant A — should only see tenant A's data
            store.setCurrentTenant(tenantA);
            const tenantAResults = store.query();
            expect(tenantAResults).toEqual(recordsA);

            // Query as tenant B — should only see tenant B's data
            store.setCurrentTenant(tenantB);
            const tenantBResults = store.query();
            expect(tenantBResults).toEqual(recordsB);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('inserting data for a different tenant than the current session is rejected', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          institutionRecordsArb,
          ({ tenantA, tenantB }, records) => {
            store.clear();

            // Set session to tenant A
            store.setCurrentTenant(tenantA);

            // Attempting to insert data for tenant B should fail (RLS violation)
            for (const record of records) {
              expect(() => store.insert(tenantB, record)).toThrow('RLS violation');
            }

            // Verify no data leaked into tenant B
            store.setCurrentTenant(tenantB);
            expect(store.query()).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Tenant Resolution: Distinct tenants resolve to distinct identifiers', () => {
    it('two requests with different X-Tenant-ID headers resolve to different tenant IDs', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          ({ tenantA, tenantB }) => {
            const requestA = createMockRequest({
              headers: { 'x-tenant-id': tenantA },
            });
            const requestB = createMockRequest({
              headers: { 'x-tenant-id': tenantB },
            });

            const resultA = resolveTenantId(requestA);
            const resultB = resolveTenantId(requestB);

            // Distinct tenant IDs must resolve to distinct values
            expect(resultA.tenantId).toBe(tenantA);
            expect(resultB.tenantId).toBe(tenantB);
            expect(resultA.tenantId).not.toBe(resultB.tenantId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('two requests with different subdomains resolve to different tenant slugs', () => {
      fc.assert(
        fc.property(
          distinctSlugPairArb,
          ({ slugA, slugB }) => {
            const requestA = createMockRequest({
              hostname: `${slugA}.proctira.org`,
            });
            const requestB = createMockRequest({
              hostname: `${slugB}.proctira.org`,
            });

            const resultA = resolveTenantId(requestA, { baseDomain: 'proctira.org' });
            const resultB = resolveTenantId(requestB, { baseDomain: 'proctira.org' });

            expect(resultA.tenantId).toBe(slugA);
            expect(resultB.tenantId).toBe(slugB);
            expect(resultA.tenantId).not.toBe(resultB.tenantId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('JWT claim takes precedence: tenant A credentials never resolve to tenant B', () => {
      fc.assert(
        fc.property(
          distinctTenantPairArb,
          ({ tenantA, tenantB }) => {
            // Request has JWT for tenant A but header for tenant B
            const request = createMockRequest({
              user: { tenantId: tenantA },
              headers: { 'x-tenant-id': tenantB },
            });

            const result = resolveTenantId(request);

            // JWT claim (tenant A) must take precedence — never resolves to tenant B
            expect(result.tenantId).toBe(tenantA);
            expect(result.tenantId).not.toBe(tenantB);
            expect(result.source).toBe('jwt');
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Fastify Plugin: Session variable isolation per request', () => {
    it('sets distinct session variables for distinct tenants ensuring query isolation', async () => {
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

            app.get('/data', async (request) => {
              return { tenantId: request.tenantId ?? null };
            });

            await app.ready();

            // Request as tenant A
            const responseA = await app.inject({
              method: 'GET',
              url: '/data',
              headers: { 'x-tenant-id': tenantA },
            });

            // Request as tenant B
            const responseB = await app.inject({
              method: 'GET',
              url: '/data',
              headers: { 'x-tenant-id': tenantB },
            });

            const bodyA = JSON.parse(responseA.body);
            const bodyB = JSON.parse(responseB.body);

            // Each request should resolve to its own tenant
            expect(responseA.statusCode).toBe(200);
            expect(responseB.statusCode).toBe(200);
            expect(bodyA.tenantId).toBe(tenantA);
            expect(bodyB.tenantId).toBe(tenantB);
            expect(bodyA.tenantId).not.toBe(bodyB.tenantId);

            // Verify the SQL session variable was set correctly for each
            expect(setConfigCalls).toContain(
              `SELECT set_config('app.current_tenant_id', '${tenantA}', true)`,
            );
            expect(setConfigCalls).toContain(
              `SELECT set_config('app.current_tenant_id', '${tenantB}', true)`,
            );

            await app.close();
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
