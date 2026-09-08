/**
 * API Gateway Integration Tests
 *
 * Tests the gateway application including:
 * - Health check endpoints
 * - Service routing with URL prefix versioning
 * - Rate limiting
 * - CORS headers
 * - Error handling
 * - Tenant resolution
 * - OpenAPI documentation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

// The generated Prisma client auto-loads packages/shared/database/.env as an
// import side effect, which sets DATABASE_URL and would flip the in-process
// domain repositories to Prisma (and fail without a running Postgres). Unset
// it so the gateway composes in-memory repositories, keeping tests hermetic.
delete process.env['DATABASE_URL'];

/** Creates a minimal JWT payload for testing. iat/exp are auto-added by jwt.sign() */
function createTestJwtPayload(overrides?: Record<string, unknown>) {
  // We omit iat/exp since jwt.sign() adds them automatically
  // Using 'as any' because the type system requires iat/exp but they're auto-generated
  return {
    sub: 'user-123',
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    displayName: 'Test User',
    // G-712: reads are RBAC-gated; default test principal is a tenant admin.
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    areas: [],
    institutions: [],
    jti: 'test-jti-123',
    sessionId: 'test-session-123',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function createTestConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: {
      windowMs: 60000,
      // G-731 keys every authenticated request by JWT tenant+sub, so the shared
      // test principal accumulates across this file; the 429 path is covered by
      // the dedicated Rate Limiting test that builds its own app with max 3.
      maxRequests: 100,
    },
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
    tenant: {
      baseDomain: 'proctira.org',
      headerName: 'x-tenant-id',
    },
    services: {
      auth: {
        // Auth is the only domain still proxied to a remote service (the
        // others are served in-process — see src/domain-plugins.ts). Point it
        // at a port that always refuses connections so proxy tests get a
        // deterministic 502 instead of hitting whatever runs on localhost:3001.
        prefix: '/auth',
        target: 'http://127.0.0.1:1',
        healthCheck: '/health',
      },
      institutions: {
        prefix: '/institutions',
        target: 'http://localhost:3002',
        healthCheck: '/health',
      },
      students: {
        prefix: '/students',
        target: 'http://localhost:3003',
        healthCheck: '/health',
      },
    },
    ...overrides,
  };
}

describe('API Gateway', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = createTestConfig();
    app = await buildApp({ config });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Check Endpoints', () => {
    it('GET /health returns healthy status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
      expect(body.timestamp).toBeDefined();
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.checks.liveness.status).toBe('up');
      expect(body.checks.readiness.status).toBe('up');
    });

    it('GET /health/live returns liveness status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('up');
    });

    it('GET /health/ready returns readiness status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('up');
      expect(body.services).toBeDefined();
    });

    it('health endpoints do not require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Service Routing', () => {
    it('GET /api/v1/services requires a JWT (G-713)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/services',
      });
      expect(response.statusCode).toBe(401);
    });

    it('GET /api/v1/services lists registered services', async () => {
      const token = app.jwt.sign(createTestJwtPayload());
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/services',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.services).toBeInstanceOf(Array);
      expect(body.services.length).toBe(3);
      // Upstream targets are hidden from non-platform-admins (G-713).
      expect(body.services[0]).not.toHaveProperty('target');

      const serviceNames = body.services.map((s: { name: string }) => s.name);
      expect(serviceNames).toContain('auth');
      expect(serviceNames).toContain('institutions');
      expect(serviceNames).toContain('students');
    });

    it('routes requests to proxied services via /api/v1/{service} prefix', async () => {
      // 'auth' is the only configured service still proxied (institutions and
      // students are served in-process). Its target refuses connections, so a
      // 502 BAD_GATEWAY proves the request was routed to the proxy handler.
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      // Should return 502 since no actual backend service is running
      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.code).toBe('BAD_GATEWAY');
      expect(body.message).toBe("Service 'auth' is unreachable.");
      expect(body.statusCode).toBe(502);
    });

    it('routes wildcard paths to the correct proxied service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions/abc-123/devices',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      // The nested path matched the auth service's wildcard proxy route.
      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.code).toBe('BAD_GATEWAY');
      expect(body.message).toBe("Service 'auth' is unreachable.");
    });

    it('serves in-process domains directly instead of proxying them', async () => {
      // Institutions are registered as an in-process domain plugin
      // (see src/domain-plugins.ts), so the request is answered by the
      // in-memory repository instead of the proxy.
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta.page).toBe(1);
    });

    it('returns 404 for unregistered service routes', async () => {
      // G-702: unmapped segments are default-denied for tenant roles; only a
      // platform admin gets far enough to see the 404.
      const token = app.jwt.sign(
        createTestJwtPayload({
          roles: [{ roleId: 'platform_admin', roleName: 'Platform Administrator', areaId: null }],
        }),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/unknown-service/something',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('Authentication', () => {
    it('rejects requests without JWT on protected routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('rejects requests with invalid JWT', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: 'Bearer invalid-token',
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('allows requests with valid JWT', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      // 200 means the request passed auth and was handled by the in-process
      // institution plugin (a broken JWT would have been rejected with 401,
      // as the tests above assert).
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toBeInstanceOf(Array);
    });
  });

  describe('Tenant Resolution', () => {
    it('resolves tenant from X-Tenant-ID header', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      // Request passed tenant resolution and was answered by the in-process
      // institution route (which itself requires a tenant context; a missing
      // tenant would have been rejected with 401 TENANT_RESOLUTION_FAILED).
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toBeInstanceOf(Array);
    });

    it('resolves tenant from JWT claim', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      // No X-Tenant-ID header, but JWT has tenantId claim
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      // Should pass tenant resolution via JWT claim and reach the in-process
      // institution route, which requires a resolved tenant to respond 200.
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toBeInstanceOf(Array);
    });
  });

  describe('Rate Limiting', () => {
    it('enforces rate limits and returns 429 when exceeded', async () => {
      // Create a fresh app with very low rate limit for this test
      const rateLimitApp = await buildApp({
        config: createTestConfig({
          rateLimiting: { windowMs: 60000, maxRequests: 3 },
        }),
      });
      await rateLimitApp.ready();

      try {
        // Make requests up to the limit
        for (let i = 0; i < 3; i++) {
          const response = await rateLimitApp.inject({
            method: 'GET',
            url: '/health',
          });
          expect(response.statusCode).toBe(200);
        }

        // Next request should be rate limited
        const response = await rateLimitApp.inject({
          method: 'GET',
          url: '/health',
        });
        expect(response.statusCode).toBe(429);
      } finally {
        await rateLimitApp.close();
      }
    });

    it('includes rate limit headers in responses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('includes CORS headers for allowed origins', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/institutions',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Error Handling', () => {
    it('returns structured 404 for unknown routes', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.statusCode).toBe(404);
    });

    it('accepts bodyless POST with Content-Type application/json', async () => {
      // Admin has communication:manage via gateway RBAC campus extensions (G-101)
      const token = app.jwt.sign(
        createTestJwtPayload({
          roles: [
            {
              roleId: 'admin',
              roleName: 'Administrator',
              areaId: 'root',
            },
          ],
        }),
      );
      const tenantId = '550e8400-e29b-41d4-a716-446655440000';

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/communication/emergency',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
        },
        payload: { reason: 'Empty-body dispatch probe', channels: ['sms'] },
      });
      expect(createRes.statusCode).toBe(201);
      const blast = createRes.json() as { id: string };

      await app.inject({
        method: 'POST',
        url: `/api/v1/communication/emergency/${blast.id}/confirm`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
        },
        payload: { actorId: 'actor-1' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/communication/emergency/${blast.id}/confirm`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
        },
        payload: { actorId: 'actor-2' },
      });

      const dispatch = await app.inject({
        method: 'POST',
        url: `/api/v1/communication/emergency/${blast.id}/dispatch`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': tenantId,
          'content-type': 'application/json',
        },
        // Explicit empty string body — reproduces FST_ERR_CTP_EMPTY_JSON_BODY
        // without the empty→{} content-type parser.
        payload: '',
      });

      expect(dispatch.statusCode).toBe(200);
      expect(dispatch.json().status).toBe('sent');
      expect(dispatch.json().delivery.mode).toBe('sandbox');
    });
  });

  describe('OpenAPI Documentation', () => {
    it('serves Swagger UI at /docs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.openapi).toBe('3.0.3');
      expect(body.info.title).toBe('ProctiraERP Unified Platform API');
      expect(body.info.version).toBe('1.0.0');
    });

    it('includes security schemes in OpenAPI spec', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs/json',
      });

      const body = response.json();
      expect(body.components.securitySchemes.bearerAuth).toBeDefined();
      expect(body.components.securitySchemes.bearerAuth.type).toBe('http');
      expect(body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
      expect(body.components.securitySchemes.tenantHeader).toBeDefined();
    });
  });
});
