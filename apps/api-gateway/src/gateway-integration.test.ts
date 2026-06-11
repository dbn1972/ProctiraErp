/**
 * API Gateway Integration Tests
 *
 * Validates:
 * - Requirement 2.2: Versioned RESTful APIs with URL path prefix versioning (/api/v1)
 * - Requirement 2.3: API request payload validation against schemas
 * - Requirement 2.4: Structured HTTP 400 error responses with field-level errors
 * - Requirement 2.7: API response time within 500ms at p95
 *
 * Tests cover:
 * - Route forwarding to backend services (method, path, headers)
 * - Rate limiting enforcement (per-tenant/client/IP, structured 429 response)
 * - Structured error responses for invalid payloads (field-level errors)
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';

// The generated Prisma client auto-loads packages/shared/database/.env as an
// import side effect, which sets DATABASE_URL and would flip the in-process
// domain repositories to Prisma (and fail without a running Postgres). Unset
// it so the gateway composes in-memory repositories, keeping tests hermetic.
delete process.env['DATABASE_URL'];

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestJwtPayload(overrides?: Record<string, unknown>) {
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
  } as any;
}

function createTestConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: {
      windowMs: 60000,
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
        // Auth is the only domain still proxied to a remote service — the
        // others below are superseded by in-process domain plugins (see
        // src/domain-plugins.ts). Tests that need a live upstream override
        // this target with a local stub server; the default refuses
        // connections deterministically.
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
      staff: {
        prefix: '/staff',
        target: 'http://localhost:3004',
        healthCheck: '/health',
      },
      assessments: {
        prefix: '/assessments',
        target: 'http://localhost:3005',
        healthCheck: '/health',
      },
    },
    ...overrides,
  };
}

// ─── Route Forwarding Tests (Requirement 2.2) ────────────────────────────────

describe('API Gateway Integration: Route Forwarding', () => {
  let app: FastifyInstance;
  let upstream: Server;
  /** Requests captured by the stub upstream backing the proxied 'auth' service. */
  const received: Array<{ method: string; url: string; body: string }> = [];

  beforeAll(async () => {
    // Stub upstream for the 'auth' service — the only domain still proxied
    // (institutions/students/staff/assessments are served in-process by the
    // domain plugins). It records every forwarded request so the tests can
    // assert that method, path, and query string were proxied intact.
    upstream = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.push({ method: req.method ?? '', url: req.url ?? '', body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ upstream: 'auth' }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const { port } = upstream.address() as AddressInfo;

    const config = createTestConfig();
    config.services['auth']!.target = `http://127.0.0.1:${port}`;
    app = await buildApp({ config });
    await app.ready();
  });

  beforeEach(() => {
    received.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((err) => (err ? reject(err) : resolve())),
    );
  });

  describe('URL prefix versioning (/api/v1)', () => {
    it('routes GET requests to the correct backend service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      // The upstream stub answered, proving the request was proxied.
      expect(response.statusCode).toBe(200);
      expect(response.json().upstream).toBe('auth');
      expect(received).toHaveLength(1);
      expect(received[0]!.method).toBe('GET');
      // /api/v1 prefix is stripped; the service prefix + sub-path are forwarded.
      expect(received[0]!.url).toBe('/auth/sessions');
    });

    it('routes POST requests to the correct backend service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
          'content-type': 'application/json',
        },
        payload: { email: 'test@example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]!.method).toBe('POST');
      expect(received[0]!.url).toBe('/auth/password-reset');
      // The JSON body is forwarded to the upstream unchanged.
      expect(JSON.parse(received[0]!.body)).toEqual({ email: 'test@example.com' });
    });

    it('routes PUT requests to the correct backend service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/auth/sessions/sess-456',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
          'content-type': 'application/json',
        },
        payload: { name: 'Updated Session' },
      });

      expect(response.statusCode).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]!.method).toBe('PUT');
      expect(received[0]!.url).toBe('/auth/sessions/sess-456');
      expect(JSON.parse(received[0]!.body)).toEqual({ name: 'Updated Session' });
    });

    it('routes DELETE requests to the correct backend service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/auth/sessions/sess-789',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]!.method).toBe('DELETE');
      expect(received[0]!.url).toBe('/auth/sessions/sess-789');
    });

    it('routes PATCH requests to the correct backend service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/auth/users/user-001',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
          'content-type': 'application/json',
        },
        payload: { status: 'inactive' },
      });

      expect(response.statusCode).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]!.method).toBe('PATCH');
      expect(received[0]!.url).toBe('/auth/users/user-001');
      expect(JSON.parse(received[0]!.body)).toEqual({ status: 'inactive' });
    });

    it('serves superseded prefixes in-process instead of proxying them', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      // Institutions and students are configured in SERVICE_ROUTES but are
      // superseded by in-process domain plugins, so they are answered by the
      // in-memory repositories and never reach a proxy upstream.
      for (const url of ['/api/v1/institutions', '/api/v1/students']) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: {
            authorization: `Bearer ${token}`,
            'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.data).toBeInstanceOf(Array);
        expect(body.meta.page).toBe(1);
      }

      // Nothing was forwarded to the proxy upstream.
      expect(received).toHaveLength(0);
    });
  });

  describe('Nested path routing', () => {
    it('routes deeply nested paths to the correct service', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/users/u-001/sessions/s-001/history',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]!.url).toBe('/auth/users/u-001/sessions/s-001/history');
    });

    it('preserves query parameters in the original URL', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/sessions?page=2&limit=20&status=active',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(received).toHaveLength(1);
      // The full query string is forwarded to the upstream.
      expect(received[0]!.url).toBe('/auth/sessions?page=2&limit=20&status=active');
    });
  });

  describe('Unregistered routes', () => {
    it('returns 404 for routes not matching any service prefix', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/nonexistent-service/resource',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toBeDefined();
      expect(body.statusCode).toBe(404);
    });

    it('returns 404 for routes without the /api/v1 prefix', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/institutions/123',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns 404 for /api/v2 routes (only v1 is supported)', async () => {
      const token = app.jwt.sign(createTestJwtPayload());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v2/institutions',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Service registry endpoint', () => {
    it('lists all registered services with their prefixes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/services',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.services).toBeInstanceOf(Array);
      expect(body.services.length).toBe(5);

      // Verify each service has required fields
      for (const service of body.services) {
        expect(service).toHaveProperty('name');
        expect(service).toHaveProperty('prefix');
        expect(service).toHaveProperty('target');
        expect(service.prefix).toMatch(/^\/api\/v1\//);
      }
    });

    it('services endpoint does not require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/services',
        // No authorization header
      });

      expect(response.statusCode).toBe(200);
    });
  });
});

// ─── Rate Limiting Tests (Requirement 2.7) ───────────────────────────────────

describe('API Gateway Integration: Rate Limiting Enforcement', () => {
  it('returns 429 with structured error when rate limit is exceeded', async () => {
    const app = await buildApp({
      config: createTestConfig({
        rateLimiting: { windowMs: 60000, maxRequests: 2 },
      }),
    });
    await app.ready();

    try {
      // Exhaust the rate limit
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({ method: 'GET', url: '/health' });
        expect(res.statusCode).toBe(200);
      }

      // Next request should be rate limited
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(429);

      const body = response.json();
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.message).toBeDefined();
      expect(body.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('includes rate limit headers in successful responses', async () => {
    const app = await buildApp({
      config: createTestConfig({
        rateLimiting: { windowMs: 60000, maxRequests: 50 },
      }),
    });
    await app.ready();

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);

      // Rate limit headers should be present
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();

      // Remaining should be less than limit after one request
      const limit = parseInt(response.headers['x-ratelimit-limit'] as string, 10);
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string, 10);
      expect(limit).toBe(50);
      expect(remaining).toBe(49);
    } finally {
      await app.close();
    }
  });

  it('includes retry-after header when rate limited', async () => {
    const app = await buildApp({
      config: createTestConfig({
        rateLimiting: { windowMs: 60000, maxRequests: 1 },
      }),
    });
    await app.ready();

    try {
      // First request succeeds
      await app.inject({ method: 'GET', url: '/health' });

      // Second request is rate limited
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('rate limits per tenant when tenant ID is provided', async () => {
    const tenantA = '550e8400-e29b-41d4-a716-446655440001';
    const tenantB = '550e8400-e29b-41d4-a716-446655440002';

    const app = await buildApp({
      config: createTestConfig({
        rateLimiting: { windowMs: 60000, maxRequests: 2 },
      }),
    });
    await app.ready();

    try {
      const token1 = app.jwt.sign(createTestJwtPayload({
        sub: 'user-1',
        tenantId: tenantA,
      }));
      const token2 = app.jwt.sign(createTestJwtPayload({
        sub: 'user-2',
        tenantId: tenantB,
      }));

      // Exhaust rate limit for tenantA/user-1
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/institutions',
          headers: {
            authorization: `Bearer ${token1}`,
            'x-tenant-id': tenantA,
          },
        });
        // Served by the in-process institution plugin (within quota)
        expect(res.statusCode).toBe(200);
      }

      // tenantA/user-1 should be rate limited
      const limitedResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: `Bearer ${token1}`,
          'x-tenant-id': tenantA,
        },
      });
      expect(limitedResponse.statusCode).toBe(429);

      // tenantB/user-2 should still have quota
      const otherTenantResponse = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions',
        headers: {
          authorization: `Bearer ${token2}`,
          'x-tenant-id': tenantB,
        },
      });
      expect(otherTenantResponse.statusCode).toBe(200); // Not rate limited
    } finally {
      await app.close();
    }
  });

  it('responds within 500ms for standard requests (p95 target)', async () => {
    const app = await buildApp({ config: createTestConfig() });
    await app.ready();

    try {
      const responseTimes: number[] = [];

      // Make 20 requests and measure response times
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        await app.inject({ method: 'GET', url: '/health' });
        const elapsed = performance.now() - start;
        responseTimes.push(elapsed);
      }

      // Sort and get p95
      responseTimes.sort((a, b) => a - b);
      const p95Index = Math.ceil(responseTimes.length * 0.95) - 1;
      const p95 = responseTimes[p95Index]!;

      // p95 should be under 500ms (Requirement 2.7)
      expect(p95).toBeLessThan(500);
    } finally {
      await app.close();
    }
  });
});

// ─── Structured Error Response Tests (Requirements 2.3, 2.4) ─────────────────

describe('API Gateway Integration: Structured Error Responses', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Use a standalone Fastify instance with error handler to test
    // schema validation error formatting in isolation
    app = Fastify();
    await app.register(errorHandlerPlugin);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Payload validation with field-level errors', () => {
    it('returns 400 with field-level errors for missing required fields', async () => {
      app.post('/api/v1/institutions', {
        schema: {
          body: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 255 }),
            code: Type.String({ minLength: 1, maxLength: 50 }),
            areaId: Type.String({ format: 'uuid' }),
            typeId: Type.String({ format: 'uuid' }),
            sectorId: Type.String({ format: 'uuid' }),
            ownershipId: Type.String({ format: 'uuid' }),
          }),
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/institutions',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();

      // Requirement 2.4: error code, human-readable message, field-level errors
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Request validation failed');
      expect(body.statusCode).toBe(400);
      expect(body.errors).toBeDefined();
      expect(Array.isArray(body.errors)).toBe(true);
      expect(body.errors.length).toBeGreaterThan(0);

      // Each error should identify field path and validation rule
      for (const error of body.errors) {
        expect(error).toHaveProperty('field');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('rule');
        expect(typeof error.field).toBe('string');
        expect(typeof error.message).toBe('string');
        expect(typeof error.rule).toBe('string');
      }
    });

    it('returns field-level errors for invalid field types', async () => {
      app.post('/api/v1/students', {
        schema: {
          body: Type.Object({
            name: Type.String({ minLength: 1 }),
            age: Type.Number({ minimum: 0, maximum: 150 }),
            email: Type.String({ format: 'email' }),
          }),
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/students',
        payload: {
          name: '',        // violates minLength
          age: -5,         // violates minimum
          email: 'not-an-email', // violates format
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThanOrEqual(1);

      // Verify field paths are present in errors
      const fields = body.errors.map((e: { field: string }) => e.field);
      // At least one of the invalid fields should be reported
      const hasRelevantField = fields.some(
        (f: string) => f.includes('name') || f.includes('age') || f.includes('email')
      );
      expect(hasRelevantField).toBe(true);
    });

    it('returns field-level errors for invalid nested object fields', async () => {
      app.post('/api/v1/institutions', {
        schema: {
          body: Type.Object({
            name: Type.String(),
            address: Type.Object({
              street: Type.String({ minLength: 1 }),
              city: Type.String({ minLength: 1 }),
              zipCode: Type.String({ pattern: '^[0-9]{5}$' }),
            }),
          }),
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/institutions',
        payload: {
          name: 'Test School',
          address: {
            street: '',
            city: '',
            zipCode: 'invalid',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThan(0);

      // Nested field paths should use dot notation
      const fields = body.errors.map((e: { field: string }) => e.field);
      const hasNestedField = fields.some(
        (f: string) => f.includes('address') || f.includes('street') ||
                       f.includes('city') || f.includes('zipCode')
      );
      expect(hasNestedField).toBe(true);
    });

    it('returns field-level errors for invalid array items', async () => {
      app.post('/api/v1/assessments/bulk', {
        schema: {
          body: Type.Object({
            results: Type.Array(
              Type.Object({
                studentId: Type.String({ format: 'uuid' }),
                score: Type.Number({ minimum: 0, maximum: 100 }),
              }),
              { minItems: 1 }
            ),
          }),
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/assessments/bulk',
        payload: {
          results: [],  // violates minItems
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThan(0);
    });

    it('returns field-level errors for invalid query parameters', async () => {
      app.get('/api/v1/institutions', {
        schema: {
          querystring: Type.Object({
            page: Type.Number({ minimum: 1 }),
            limit: Type.Number({ minimum: 1, maximum: 100 }),
          }),
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/institutions?page=0&limit=200',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.statusCode).toBe(400);
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Error response structure consistency', () => {
    it('all error responses contain code, message, and statusCode', async () => {
      app.post('/validate', {
        schema: {
          body: Type.Object({
            required_field: Type.String(),
          }),
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/validate',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();

      // Verify the three required fields per Requirement 2.4
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('statusCode');
      expect(typeof body.code).toBe('string');
      expect(typeof body.message).toBe('string');
      expect(typeof body.statusCode).toBe('number');
    });

    it('validation errors include the errors array with field details', async () => {
      app.post('/validate', {
        schema: {
          body: Type.Object({
            name: Type.String({ minLength: 3 }),
            email: Type.String({ format: 'email' }),
          }),
        },
      }, async () => ({ ok: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/validate',
        payload: { name: 'ab', email: 'bad' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.errors).toBeDefined();
      expect(Array.isArray(body.errors)).toBe(true);

      // Each field error must have field path and rule
      for (const err of body.errors) {
        expect(err.field).toBeDefined();
        expect(err.rule).toBeDefined();
        expect(err.message).toBeDefined();
      }
    });

    it('404 errors have consistent structure', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent-route',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toBe('Route not found');
      expect(body.statusCode).toBe(404);
    });

    it('500 errors have consistent structure without leaking internals', async () => {
      app.get('/crash', async () => {
        throw new Error('Unexpected internal failure');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/crash',
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.statusCode).toBe(500);
      // Should NOT leak internal error details
      expect(body.message).toBe('Internal server error');
      expect(body.message).not.toContain('Unexpected internal failure');
    });
  });

  describe('Full gateway validation flow', () => {
    it('validates request payloads before routing to backend services', async () => {
      // Build a full gateway app with a validated route
      const gatewayApp = await buildApp({ config: createTestConfig() });

      // Add a test route with schema validation to simulate a service endpoint
      gatewayApp.post('/api/v1/test/validated', {
        schema: {
          body: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 100 }),
            code: Type.String({ minLength: 1, maxLength: 20 }),
            areaId: Type.String({ format: 'uuid' }),
          }),
        },
      }, async () => ({ created: true }));

      await gatewayApp.ready();

      try {
        const token = gatewayApp.jwt.sign(createTestJwtPayload());

        // Send invalid payload
        const response = await gatewayApp.inject({
          method: 'POST',
          url: '/api/v1/test/validated',
          headers: {
            authorization: `Bearer ${token}`,
            'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
            'content-type': 'application/json',
          },
          payload: {
            name: '',           // violates minLength
            code: 'x'.repeat(25), // violates maxLength
            areaId: 'not-a-uuid', // violates format
          },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.message).toBe('Request validation failed');
        expect(body.errors).toBeDefined();
        expect(body.errors.length).toBeGreaterThan(0);
      } finally {
        await gatewayApp.close();
      }
    });

    it('valid payloads pass validation and reach the handler', async () => {
      const gatewayApp = await buildApp({ config: createTestConfig() });

      gatewayApp.post('/api/v1/test/validated', {
        schema: {
          body: Type.Object({
            name: Type.String({ minLength: 1, maxLength: 100 }),
            code: Type.String({ minLength: 1, maxLength: 20 }),
          }),
        },
      }, async () => ({ created: true }));

      await gatewayApp.ready();

      try {
        const token = gatewayApp.jwt.sign(createTestJwtPayload());

        const response = await gatewayApp.inject({
          method: 'POST',
          url: '/api/v1/test/validated',
          headers: {
            authorization: `Bearer ${token}`,
            'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
            'content-type': 'application/json',
          },
          payload: {
            name: 'Valid Name',
            code: 'VALID01',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.created).toBe(true);
      } finally {
        await gatewayApp.close();
      }
    });
  });
});
