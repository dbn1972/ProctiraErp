/**
 * Shared helpers for gateway `buildApp` integration tests (gw-mix1 batch).
 * Lives under `__tests__/` so it is excluded from the production build and is
 * not collected by vitest (no `.test.ts` suffix).
 */
import type { FastifyInstance } from 'fastify';

import type { GatewayConfig } from '../config.js';

export const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
export const OTHER_TENANT_ID = '660e8400-e29b-41d4-a716-446655440111';

export function createTestConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
    ...overrides,
  };
}

export type TestPrincipal = {
  sub?: string;
  tenantId?: string;
  roles?: string[];
  areas?: Array<{ areaId: string; level: number }>;
  institutions?: Array<Record<string, unknown>>;
};

export function signTestToken(app: FastifyInstance, principal: TestPrincipal = {}): string {
  const roles = principal.roles ?? ['admin'];
  const sub = principal.sub ?? `${roles[0] ?? 'user'}-user`;
  return app.jwt.sign({
    sub,
    tenantId: principal.tenantId ?? TEST_TENANT_ID,
    email: `${sub}@test.com`,
    displayName: sub,
    roles: roles.map((roleId) => ({ roleId, roleName: roleId, areaId: 'root' })),
    areas: principal.areas ?? [],
    institutions: principal.institutions ?? [],
    jti: `jti-${sub}`,
    sessionId: `sess-${sub}`,
  });
}

export function authHeaders(
  app: FastifyInstance,
  principal: TestPrincipal = {},
): Record<string, string> {
  return {
    authorization: `Bearer ${signTestToken(app, principal)}`,
    'x-tenant-id': principal.tenantId ?? TEST_TENANT_ID,
  };
}
