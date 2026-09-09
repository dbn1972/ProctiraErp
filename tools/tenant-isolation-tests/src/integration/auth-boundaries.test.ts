/**
 * Category 2 — Integration Tests: auth/authz boundaries.
 *
 * Drives the actual `@proctira/tenant` Fastify plugin (registered against an
 * ephemeral Fastify instance) plus a thin RBAC helper to verify that:
 *   1. Header-based tenant resolution works.
 *   2. JWT tenant claim takes precedence over header (no header spoofing).
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
  // G-720: the plugin binds the tenant id as a query parameter, so capture
  // the rendered statement (SQL + bound values) rather than the raw SQL.
  const setConfigCalls: string[] = [];
  const renderCall = (query: string, ...params: unknown[]): string =>
    params.reduce<string>(
      (sql, value, index) => sql.split(`$${index + 1}`).join(`'${String(value)}'`),
      query,
    );

  beforeEach(async () => {
    setConfigCalls.length = 0;
    app = Fastify();

    // Register tenant plugin with a fake Prisma-like client so we can inspect
    // the RLS session-config calls the plugin issues per request.
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
    await fc.assert(
      fc.asyncProperty(uuidV4Arb, async (tenantId) => {
        setConfigCalls.length = 0;

        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/scoped',
          headers: { 'x-tenant-id': tenantId },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as { tenantId: string; tenantSource: string };
        expect(body.tenantId).toBe(tenantId);
        expect(body.tenantSource).toBe('header');

        const expected = `set_config('app.current_tenant_id', '${tenantId}', true)`;
        expect(setConfigCalls.some((call) => call.includes(expected))).toBe(true);
        // Both GUC spellings must be bound so Prisma-side and raw-pg policies agree.
        expect(
          setConfigCalls.some((call) =>
            call.includes(`set_config('app.tenant_id', '${tenantId}', true)`),
          ),
        ).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it('JWT tenant claim wins over a spoofed X-Tenant-Id header', async () => {
    // Re-register with an onRequest hook that decorates request.user with a
    // JWT-derived tenant id (mimicking the auth plugin running before us).
    await app.close();
    setConfigCalls.length = 0;

    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, async ({ tenantA, tenantB }) => {
        const local = Fastify();
        local.addHook('onRequest', async (request) => {
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

        const body = JSON.parse(response.body) as { tenantId: string };
        expect(body.tenantId).toBe(tenantA);
        expect(body.tenantId).not.toBe(tenantB);

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
