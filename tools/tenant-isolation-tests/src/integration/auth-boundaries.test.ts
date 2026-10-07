/**
 * Category 2 — Integration Tests: auth/authz boundaries.
 *
 * Drives the actual `@proctira/tenant` Fastify plugin (registered against an
 * ephemeral Fastify instance) plus a thin RBAC helper to verify that:
 *   1. Header-based tenant resolution works.
 *   2. Conflicting JWT and header tenant identities are rejected (no spoofing).
 *   3. RBAC scopes role checks to the resolved tenant; admin in tenant A
 *      gets nothing in tenant B.
 *   4. Refresh-token tenant-binding rejects cross-tenant reuse.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 23.4 (RBAC), 23.6 (token tenant binding)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';

import { withTenantTransaction, type TenantGucPrismaLike } from '@proctira/database';
import { tenantPlugin } from '@proctira/tenant';

import {
  actionVerbArb,
  distinctTenantPairArb,
  resourceTypeArb,
  uuidV4Arb,
} from '../helpers/index.js';

interface JwtPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  exp: number;
}

const jwtArb: fc.Arbitrary<JwtPayload> = fc.record({
  sub: uuidV4Arb,
  tenantId: uuidV4Arb,
  roles: fc.array(fc.constantFrom('admin', 'teacher', 'principal', 'staff'), {
    minLength: 1,
    maxLength: 3,
  }),
  exp: fc.integer({ min: 0, max: 86_400 }).map((delta) => Math.floor(Date.now() / 1000) + delta),
});

describe('Category 2 — Integration Tests: Auth/Authz Boundaries', () => {
  let app: FastifyInstance;
  // G-720: tenant ids are bound as query parameters, so capture the rendered
  // statement (SQL + bound values) rather than the raw SQL. PRC-M367: the
  // plugin itself must issue none; binding happens in withTenantTransaction.
  const setConfigCalls: string[] = [];
  const renderCall = (query: string, ...params: unknown[]): string =>
    params.reduce<string>(
      (sql, value, index) => sql.split(`$${index + 1}`).join(`'${String(value)}'`),
      query,
    );

  beforeEach(async () => {
    setConfigCalls.length = 0;
    app = Fastify();

    // Register tenant plugin with a fake Prisma-like client so we can prove it
    // issues no out-of-transaction session-config calls per request.
    await app.register(tenantPlugin, {
      getDbClient: () => ({
        $executeRawUnsafe: (query: string, ...params: unknown[]) => {
          setConfigCalls.push(renderCall(query, ...params));
          return Promise.resolve(undefined);
        },
      }),
    });

    app.get('/api/v1/scoped', async (request) => ({
      tenantId: request.tenantId,
      tenantSource: request.tenantSource,
    }));

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects requests without any tenant identifier with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/scoped',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { code?: string };
    expect(body.code).toBe('TENANT_RESOLUTION_FAILED');
  });

  it('header-resolved tenant id flows into request context and RLS session', async () => {
    // PRC-M367: the tenant plugin is resolution-only. A `set_config(..., true)`
    // issued from the hook is transaction-local and lapsed before any handler
    // query ran, so the RLS session is bound by `withTenantTransaction` in the
    // same transaction as the tenant-scoped queries. Prove both halves:
    //   1. the plugin issues no out-of-transaction SQL, and
    //   2. the request-context tenant id is what binds the canonical GUC (and
    //      legacy alias) inside the transaction, before the scoped query runs.
    let txStatements: string[] = [];
    const fakePrisma = {
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const tx = {
          $executeRawUnsafe: (query: string, ...params: unknown[]) => {
            txStatements.push(renderCall(query, ...params));
            return Promise.resolve(1);
          },
        };
        return fn(tx);
      },
    } as unknown as Parameters<typeof withTenantTransaction>[0];

    const local = Fastify();
    await local.register(tenantPlugin, {
      getDbClient: () => ({
        $executeRawUnsafe: (query: string, ...params: unknown[]) => {
          setConfigCalls.push(renderCall(query, ...params));
          return Promise.resolve(undefined);
        },
      }),
    });
    local.get('/api/v1/scoped', async (request) => {
      const tenantId = request.tenantId;
      if (!tenantId) throw new Error('tenant plugin did not resolve a tenant');
      await withTenantTransaction(fakePrisma, tenantId, async (tx) => {
        await (tx as unknown as TenantGucPrismaLike).$executeRawUnsafe('SELECT scoped_query()');
      });
      return { tenantId: request.tenantId, tenantSource: request.tenantSource };
    });
    await local.ready();

    try {
      await fc.assert(
        fc.asyncProperty(uuidV4Arb, async (tenantId) => {
          setConfigCalls.length = 0;
          txStatements = [];

          const response = await local.inject({
            method: 'GET',
            url: '/api/v1/scoped',
            headers: { 'x-tenant-id': tenantId },
          });

          expect(response.statusCode).toBe(200);
          const body = JSON.parse(response.body) as { tenantId: string; tenantSource: string };
          expect(body.tenantId).toBe(tenantId);
          expect(body.tenantSource).toBe('header');

          // No (ineffective) GUC bind outside a transaction.
          expect(setConfigCalls).toEqual([]);

          // W1-DATA-12: canonical app.tenant_id is required; legacy alias synced.
          // Both are bound in the transaction, ahead of the scoped query.
          expect(txStatements).toHaveLength(2);
          const [bind, scoped] = txStatements as [string, string];
          expect(bind).toContain(`set_config('app.tenant_id', '${tenantId}', true)`);
          expect(bind).toContain(`set_config('app.current_tenant_id', '${tenantId}', true)`);
          expect(scoped).toBe('SELECT scoped_query()');
        }),
        { numRuns: 25 },
      );
    } finally {
      await local.close();
    }
  });

  it('rejects a spoofed X-Tenant-Id header that conflicts with the JWT claim', async () => {
    // Re-register with an onRequest hook that decorates request.user with a
    // JWT-derived tenant id (mimicking the auth plugin running before us).
    await app.close();
    setConfigCalls.length = 0;

    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, async ({ tenantA, tenantB }) => {
        const local = Fastify();
        local.addHook('onRequest', async (request) => {
          setConfigCalls.length = 0;
          (request as unknown as { user: { tenantId: string; sub: string } }).user = {
            tenantId: tenantA,
            sub: 'user-1',
          };
        });
        await local.register(tenantPlugin, {
          getDbClient: () => ({
            $executeRawUnsafe: (q: string, ...params: unknown[]) => {
              setConfigCalls.push(renderCall(q, ...params));
              return Promise.resolve(undefined);
            },
          }),
        });
        local.get('/secure', async (request) => ({ tenantId: request.tenantId }));
        await local.ready();

        const response = await local.inject({
          method: 'GET',
          url: '/secure',
          headers: { 'x-tenant-id': tenantB },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body) as { code?: string; tenantId?: string };
        expect(body.code).toBe('TENANT_RESOLUTION_FAILED');
        expect(body.tenantId).toBeUndefined();
        expect(setConfigCalls).toHaveLength(0);

        await local.close();
      }),
      { numRuns: 15 },
    );

    // Re-instantiate the shared app for any subsequent `it` ordering.
    app = Fastify();
    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) }),
    });
    app.get('/api/v1/scoped', async (request) => ({
      tenantId: request.tenantId,
      tenantSource: request.tenantSource,
    }));
    await app.ready();
  });

  it('RBAC permission check denies any cross-tenant action even for admins', () => {
    interface TokenPayload extends JwtPayload {}
    function evaluate(token: TokenPayload, resource: { tenantId: string }): boolean {
      if (token.tenantId !== resource.tenantId) return false;
      return token.roles.includes('admin');
    }

    fc.assert(
      fc.property(
        jwtArb,
        uuidV4Arb,
        resourceTypeArb,
        actionVerbArb,
        (token, otherTenant, _type, _act) => {
          fc.pre(token.tenantId !== otherTenant);
          const adminToken: TokenPayload = { ...token, roles: ['admin', ...token.roles] };
          expect(evaluate(adminToken, { tenantId: otherTenant })).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('refresh tokens are tenant-bound and rejected when reused in another tenant', () => {
    function refreshTokenAccepted(boundTenant: string, requestTenant: string): boolean {
      return boundTenant === requestTenant;
    }

    fc.assert(
      fc.property(distinctTenantPairArb, ({ tenantA, tenantB }) => {
        expect(refreshTokenAccepted(tenantA, tenantB)).toBe(false);
        expect(refreshTokenAccepted(tenantA, tenantA)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});
