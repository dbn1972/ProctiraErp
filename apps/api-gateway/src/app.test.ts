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

/** Creates a minimal JWT payload for testing. iat/exp are auto-added by jwt.sign() */
function createTestJwtPayload(overrides?: Record<string, unknown>) {
  // We omit iat/exp since jwt.sign() adds them automatically
  // Using 'as any' because the type system requires iat/exp but they're auto-generated
  return {
    sub: 'user-123',
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    displayName: 'Test User',
    roles: [],
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
      maxRequests: 10,
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
        prefix: '/auth',
        target: 'http://localhost:3001',
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
    it('GET /api/v1/services lists registered services', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/services',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.services).toBeInstanceOf(Array);
      expect(body.services.length).toBe(3);

      const serviceNames = body.services.map((s: { name: string }) => s.name);
      expect(serviceNames).toContain('auth');
      expect(serviceNames).toContain('institutions');
      expect(serviceNames).toContain('students');
    });

    it('routes requests to services via /api/v1/{service} prefix', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      // Should return 502 since no actual backend service is running
      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.routing.service).toBe('institutions');
    });

    it('routes wildcard paths to the correct service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/students/abc-123/enrollments',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.routing.service).toBe('students');
      expect(body.routing.target).toContain('/students/abc-123/enrollments');
    });

    it('returns 404 for unregistered service routes', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

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

      // 502 means the request passed auth and reached the proxy handler
      expect(response.statusCode).toBe(502);
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

      // Request should pass tenant resolution (502 = reached proxy)
      expect(response.statusCode).toBe(502);
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

      // Should pass tenant resolution via JWT claim
      expect(response.statusCode).toBe(502);
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
