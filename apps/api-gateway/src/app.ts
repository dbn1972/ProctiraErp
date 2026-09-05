/**
 * API Gateway Application Builder
 *
 * Creates and configures the Fastify application with all plugins:
 * - CORS
 * - Rate limiting (per tenant/client/IP)
 * - JWT authentication
 * - Tenant resolution
 * - Service routing with URL prefix versioning
 * - OpenAPI documentation via @fastify/swagger
 * - Health check endpoints
 * - Global error handling
 * - Structured logging
 */

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  authPlugin,
  createPrismaKeycloakIdentityStore,
  createSmsProviderFromEnv,
  InMemoryOtpChallengeStore,
  keycloakAuthPlugin,
  loadKeycloakAuthConfig,
  OtpService,
  PrismaOtpChallengeStore,
  registerKeycloakAuthRoutes,
  registerMfaRoutes,
} from '@proctira/backend-auth';
import { loggingPlugin } from '@proctira/logging';
import { observabilityPlugin } from '@proctira/observability';
import { tenantPlugin } from '@proctira/tenant';
import Fastify, { type FastifyInstance } from 'fastify';

import type { GatewayConfig } from './config.js';
import { registerDomainPlugins } from './domain-plugins.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import healthPlugin from './plugins/health.js';
import idempotencyPlugin from './plugins/idempotency.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import serviceRouterPlugin from './plugins/service-router.js';

function buildOtpService(): OtpService {
  const sms = createSmsProviderFromEnv();
  const store = process.env['DATABASE_URL']
    ? new PrismaOtpChallengeStore()
    : new InMemoryOtpChallengeStore();
  return new OtpService({
    store,
    sms,
    exposeCodeInResponse: process.env['MFA_EXPOSE_OTP'] === 'true',
  });
}

export interface BuildAppOptions {
  config: GatewayConfig;
}

/**
 * Build and configure the API Gateway Fastify application.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger: config.env !== 'test' ? {
      level: process.env['LOG_LEVEL'] || 'info',
      transport: config.env === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    } : false,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // 1. Register global error handler (first, so it catches all errors)
  await app.register(errorHandlerPlugin, {
    includeStackTrace: config.env === 'development',
  });

  // 2. Register structured logging
  await app.register(loggingPlugin, {
    name: 'api-gateway',
    ignorePaths: ['/health', '/health/live', '/health/ready'],
  });

  // 2b. Register Prometheus metrics + /metrics endpoint
  await app.register(observabilityPlugin, {
    serviceName: 'api-gateway',
    ignorePaths: ['/health', '/health/live', '/health/ready'],
  });

  // 3. Register CORS
  await app.register(cors, {
    origin: config.cors.origins,
    methods: config.cors.methods,
    credentials: config.cors.credentials,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-ID',
      'X-Request-ID',
      'X-Correlation-ID',
      'Idempotency-Key',
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-Correlation-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Idempotency-Replay',
    ],
  });

  // 4. Register rate limiting (per tenant/client/IP).
  // Prefer Redis-backed distributed counters when REDIS_URL is set; otherwise
  // fall back to the in-memory @fastify/rate-limit store.
  const redisUrlForRateLimit = process.env['REDIS_URL'];
  if (redisUrlForRateLimit) {
    await app.register(rateLimitPlugin, {
      max: config.rateLimiting.maxRequests,
      timeWindow: config.rateLimiting.windowMs,
      redisUrl: redisUrlForRateLimit,
    });
  } else {
    await app.register(rateLimit, {
      max: config.rateLimiting.maxRequests,
      timeWindow: config.rateLimiting.windowMs,
      keyGenerator: (request) => {
        // Rate limit key priority: tenant ID > authenticated user > IP
        const tenantId = request.tenantId;
        const userId = (request as unknown as { user?: { sub?: string } }).user?.sub;

        if (tenantId && userId) {
          return `${tenantId}:${userId}`;
        }
        if (tenantId) {
          return `tenant:${tenantId}`;
        }
        return request.ip;
      },
      allowList: [],
      addHeadersOnExceeding: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
  }

  // 5. Register health check (before auth, so it's always accessible)
  await app.register(healthPlugin, {
    services: config.services,
  });

  // 6. Register OpenAPI documentation via @fastify/swagger
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'ProctiraERP Unified Platform API',
        description: 'API Gateway for the ProctiraERP education management platform',
        version: '1.0.0',
        contact: {
          name: 'ProctiraERP Team',
        },
      },
      servers: [
        {
          url: `http://localhost:${config.port}`,
          description: 'Local development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          tenantHeader: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Tenant-ID',
          },
        },
        parameters: {
          IdempotencyKey: {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description: 'Unique key for idempotent POST/PUT/PATCH requests. If the same key is sent again within 24 hours, the cached response is returned without re-executing the operation. Used by the offline-first Sync_Queue to safely replay requests.',
            schema: {
              type: 'string',
              format: 'uuid',
              example: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },
      security: [
        { bearerAuth: [] },
        { tenantHeader: [] },
      ],
      tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Gateway', description: 'Gateway management endpoints' },
        { name: 'auth', description: 'Authentication service' },
        { name: 'institutions', description: 'Institution management service' },
        { name: 'students', description: 'Student management service' },
        { name: 'staff', description: 'Staff management service' },
        { name: 'assessments', description: 'Assessment service' },
        { name: 'attendance', description: 'Attendance service' },
        { name: 'examinations', description: 'Examination service' },
      ],
    },
  });

  // Register Swagger UI
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // 7. Register JWT authentication
  const keycloak = loadKeycloakAuthConfig();
  const authExcludePaths = [
    '/health',
    '/health/live',
    '/health/ready',
    '/docs',
    '/docs/*',
    '/api/v1/auth/login',
    '/api/v1/auth/callback',
    '/api/v1/auth/password',
    '/api/v1/auth/ticket',
    '/api/v1/auth/logout',
    '/api/v1/auth/roles',
    '/api/v1/auth/refresh',
    '/api/v1/auth/mfa/otp/send',
    '/api/v1/auth/mfa/otp/resend',
    '/api/v1/auth/mfa/resend',
    '/api/v1/auth/mfa/verify',
    '/auth/mfa/otp/send',
    '/auth/mfa/otp/resend',
    '/auth/mfa/resend',
    '/auth/mfa/verify',
    '/api/v1/services',
  ];

  if (keycloak) {
    const identityStore = process.env['DATABASE_URL']
      ? createPrismaKeycloakIdentityStore()
      : undefined;
    await app.register(keycloakAuthPlugin, { config: keycloak, identityStore });
    await registerKeycloakAuthRoutes(app, {
      ...keycloak,
      identityStore,
      clientSecret: process.env['KEYCLOAK_CLIENT_SECRET'],
      redirectUri:
        process.env['KEYCLOAK_REDIRECT_URI'] ??
        `http://localhost:${config.port}/api/v1/auth/callback`,
      webOrigin: process.env['NEXT_PUBLIC_WEB_URL'] ?? 'http://localhost:3201',
    });
  } else {
    await app.register(authPlugin, {
      config: {
        jwt: {
          secret: config.jwt.secret,
          issuer: config.jwt.issuer,
          audience: config.jwt.audience,
          accessTokenExpiresIn: 900, // 15 minutes in seconds
        },
        refreshToken: {
          maxLifetime: 30 * 24 * 60 * 60, // 30 days in seconds
        },
        session: {
          duration: 8 * 60 * 60, // 8 hours in seconds
        },
        password: {
          saltRounds: 12,
        },
        lockout: {
          maxAttempts: 3,
          windowSeconds: 900,
          durationSeconds: 900,
        },
      },
      excludePaths: authExcludePaths,
    });
  }

  // MFA / SMS OTP challenge endpoints (legacy /auth + versioned /api/v1/auth).
  const otpService = buildOtpService();
  await registerMfaRoutes(app, { otpService, prefix: '/api/v1/auth' });
  await registerMfaRoutes(app, { otpService, prefix: '/auth' });

  // 7b. Global auth enforcement via onRequest hook
  // This ensures JWT is verified before tenant resolution can read JWT claims
  app.addHook('onRequest', async (request, reply) => {
    // Check if path is excluded from auth
    const url = request.url.split('?')[0]!;
    const isExcluded = authExcludePaths.some((excluded) => {
      if (excluded.endsWith('/*')) {
        return url.startsWith(excluded.slice(0, -2));
      }
      return url === excluded;
    });

    if (isExcluded) return;

    // Verify JWT token
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
        statusCode: 401,
      });
    }
  });

  // 8. Register tenant resolution (after auth, so JWT claims are available)
  await app.register(tenantPlugin, {
    baseDomain: config.tenant.baseDomain,
    headerName: config.tenant.headerName,
    excludePaths: [
      '/health',
      '/health/live',
      '/health/ready',
      '/docs',
      '/docs/*',
      '/api/v1/auth/login',
      '/api/v1/auth/callback',
      '/api/v1/auth/password',
      '/api/v1/auth/ticket',
      '/api/v1/auth/logout',
      '/api/v1/auth/roles',
      '/api/v1/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/mfa/otp/send',
      '/api/v1/auth/mfa/otp/resend',
      '/api/v1/auth/mfa/resend',
      '/api/v1/auth/mfa/verify',
      '/auth/mfa/otp/send',
      '/auth/mfa/otp/resend',
      '/auth/mfa/resend',
      '/auth/mfa/verify',
      '/api/v1/services',
    ],
    resolveSlugToId: false, // Gateway doesn't have direct DB access
  });

  // 8a. Fail closed: authenticated callers without a trusted JWT tenant must
  // not bind tenant context from attacker-controlled X-Tenant-ID alone.
  app.addHook('preHandler', async (request, reply) => {
    const user = request.user as { tenantId?: string } | undefined;
    if (!user) return;
    const jwtTenant = typeof user.tenantId === 'string' ? user.tenantId.trim() : '';
    const tenantSource = (request as typeof request & {
      tenantSource?: 'jwt' | 'header' | 'subdomain';
    }).tenantSource;
    if (!jwtTenant && tenantSource === 'header') {
      return reply.status(403).send({
        code: 'TENANT_UNTRUSTED',
        message:
          'Tenant context must come from a verified JWT claim. X-Tenant-ID alone is not accepted for authenticated sessions without a tenant claim.',
        statusCode: 403,
      });
    }
  });

  // 8b. Register Idempotency-Key support (after tenant, so tenant scoping works)
  // Connects to Redis via REDIS_URL env var; gracefully degrades if unavailable
  const redisUrl = process.env['REDIS_URL'];
  let redisClient: import('./plugins/idempotency.js').RedisClient | undefined;
  if (redisUrl) {
    // Dynamic import to avoid hard dependency when Redis is not configured
    try {
      const { default: Redis } = await import('ioredis' as string);
      redisClient = new Redis(redisUrl) as unknown as import('./plugins/idempotency.js').RedisClient;
    } catch {
      // ioredis not available — idempotency will be disabled
    }
  }
  await app.register(idempotencyPlugin, {
    redis: redisClient,
    ttlSeconds: parseInt(process.env['IDEMPOTENCY_TTL_SECONDS'] || '86400', 10),
    lockTtlSeconds: parseInt(process.env['IDEMPOTENCY_LOCK_TTL_SECONDS'] || '60', 10),
    excludePaths: [
      '/health',
      '/health/live',
      '/health/ready',
      '/docs',
      '/docs/*',
      '/api/v1/auth/login',
      '/api/v1/auth/callback',
      '/api/v1/auth/password',
      '/api/v1/auth/ticket',
      '/api/v1/auth/logout',
      '/api/v1/auth/roles',
      '/api/v1/auth/refresh',
    ],
  });

  // 9. Register in-process domain plugins (monolith mode). These serve their
  // routes directly (Prisma-backed, RLS-safe) rather than being proxied.
  const inProcessPrefixes = await registerDomainPlugins(app, config, '/api/v1');

  // 10. Register service router for the remaining domains (proxies to
  // standalone services via SERVICE_ROUTES). In-process prefixes are excluded
  // so they don't conflict with the handlers registered above.
  await app.register(serviceRouterPlugin, {
    services: config.services,
    versionPrefix: '/api/v1',
    excludePrefixes: keycloak ? [...inProcessPrefixes, '/auth'] : inProcessPrefixes,
  });

  return app;
}
