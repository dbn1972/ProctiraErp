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
  auditPlugin,
  createAuditRepository,
  createRetentionScheduler,
  DEFAULT_RETENTION_INTERVAL_MS,
} from '@proctira/backend-audit';
import {
  authPlugin,
  createKeycloakIdentityStore,
  createOtpChallengeStore,
  createSmsProviderFromEnv,
  createUserInviteRepository,
  evaluatePermission,
  InMemoryAreaHierarchyResolver,
  InviteService,
  keycloakAuthPlugin,
  loadKeycloakAuthConfig,
  OtpService,
  rbacPlugin,
  registerInviteAndTenantDirectoryRoutes,
  registerKeycloakAuthRoutes,
  registerMfaRoutes,
} from '@proctira/backend-auth';
import { billingPlugin, createBillingRepository } from '@proctira/backend-billing';
import { createTenantRepository, tenantLifecyclePlugin } from '@proctira/backend-tenant';
import { loggingPlugin } from '@proctira/logging';
import { observabilityPlugin } from '@proctira/observability';
import { tenantPlugin } from '@proctira/tenant';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import type { GatewayConfig } from './config.js';
import { registerDomainPlugins } from './domain-plugins.js';
import { verifySecretCandidates } from './jwt-secrets.js';
import {
  buildAuditValues,
  entityIdFromPath,
  entityTypeForPath,
  operationForMethod,
  shouldAuditMutation,
} from './mutation-audit.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import healthPlugin from './plugins/health.js';
import idempotencyPlugin, { type RedisClient } from './plugins/idempotency.js';
import serviceRouterPlugin from './plugins/service-router.js';
import storageHealthPlugin from './plugins/storage-health.js';
import {
  actionForMethod,
  createGatewayRbacRegistry,
  PLATFORM_ADMIN_ROLE_IDS,
  resourceForApiPath,
  SELF_SERVICE_READ_RESOURCES,
  UNMAPPED_API_RESOURCE,
} from './rbac-registry.js';
import { isRequestTenantSuspended } from './tenant-entitlement.js';
import {
  decideInstitutionScope,
  extractInstitutionId,
  type InstitutionScopeUser,
} from './institution-scope.js';
import {
  missingFeatureForRequest,
  type FeaturesUser,
} from './tenant-features.js';
import { maxRequestsForTenant } from './tenant-plan-quotas.js';

export interface BuildAppOptions {
  config: GatewayConfig;
}

/**
 * Build and configure the API Gateway Fastify application.
 */
/**
 * Rate-limit bucket key (G-505 / G-731).
 *
 * Authenticated: `<jwt tenant>:<sub>` — the tenant comes from the verified
 * token (falling back to the host-resolved tenant), so a client cannot escape
 * its quota by rotating `x-tenant-id`. Anonymous: per source IP only; the raw
 * header is never used as a bucket.
 */
export function rateLimitKeyFor(request: FastifyRequest): string {
  const user = (request as unknown as { user?: { sub?: string; tenantId?: string } }).user;
  if (user?.sub) {
    const tenantId = user.tenantId ?? request.tenantId;
    return tenantId ? `${tenantId}:${user.sub}` : `user:${user.sub}`;
  }
  return `ip:${request.ip}`;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger:
      config.env !== 'test'
        ? {
            level: process.env['LOG_LEVEL'] || 'info',
            transport:
              config.env === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
          }
        : false,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Fastify's default JSON parser 500s on Content-Type: application/json with
  // an empty body (common for bodyless POSTs from clients that always set the
  // header). Treat empty payloads as {}.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : '';
    if (raw.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw) as unknown);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
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
      'X-CSRF-Token',
      'X-Transport-Device-Key',
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
  // G-505: max is plan-tier aware when tenant context is present; otherwise
  // falls back to gateway config.rateLimiting.maxRequests.
  // Use preHandler so JWT + tenant resolution (onRequest) have already run.
  await app.register(rateLimit, {
    hook: 'preHandler',
    max: (request) => {
      // G-731: plan-tier lookups trust the JWT tenant, never a caller-supplied
      // header. Anonymous requests get the gateway default.
      const user = (
        request as unknown as {
          user?: { tenantId?: string; planTier?: string; tier?: string };
        }
      ).user;
      const tenantId = user ? (user.tenantId ?? request.tenantId) : undefined;
      return maxRequestsForTenant(tenantId, user, config.rateLimiting.maxRequests);
    },
    timeWindow: config.rateLimiting.windowMs,
    keyGenerator: (request) => rateLimitKeyFor(request),
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

  // 5. Register health check (before auth, so it's always accessible)
  await app.register(healthPlugin, {
    services: config.services,
  });

  // 5b. Object storage health (install CLI / ops) — public probe, no JWT
  await app.register(storageHealthPlugin);

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
            description:
              'Unique key for idempotent POST/PUT/PATCH requests. If the same key is sent again within 24 hours, the cached response is returned without re-executing the operation. Used by the offline-first Sync_Queue to safely replay requests.',
            schema: {
              type: 'string',
              format: 'uuid',
              example: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        },
      },
      security: [{ bearerAuth: [] }, { tenantHeader: [] }],
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

  // Register Swagger UI. G-713: off in production unless DOCS_PUBLIC=1 so the
  // full route inventory is not served anonymously from a live tenant host.
  const docsEnabled = config.env !== 'production' || process.env['DOCS_PUBLIC'] === '1';
  if (docsEnabled) {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  }

  // 7. Register JWT authentication (local HS JWT) OR optional Keycloak RS256.
  // Keycloak activates only when KEYCLOAK_ISSUER + KEYCLOAK_CLIENT_ID are set.
  // Without those env vars, local JWT auth is unchanged.
  const keycloak = loadKeycloakAuthConfig();
  // G-713: the only anonymous surface is health probes, docs (non-prod), and the
  // pre-login auth flows. `/api/v1/services` and `/api/v1/auth/roles` require a JWT.
  const authExcludePaths = [
    '/health',
    '/health/live',
    '/health/ready',
    ...(docsEnabled ? ['/docs', '/docs/*'] : []),
    '/api/v1/auth/login',
    '/api/v1/auth/callback',
    '/api/v1/auth/password',
    '/api/v1/auth/ticket',
    '/api/v1/auth/logout',
    '/api/v1/auth/refresh',
    '/api/v1/auth/mfa/otp/send',
    '/api/v1/auth/mfa/otp/resend',
    '/api/v1/auth/mfa/resend',
    '/api/v1/auth/mfa/verify',
    '/auth/mfa/otp/send',
    '/auth/mfa/otp/resend',
    '/auth/mfa/resend',
    '/auth/mfa/verify',
    '/api/v1/storage/health',
  ];

  if (keycloak) {
    // G-704: identities persist in Postgres when DATABASE_URL is set.
    const identityStore = createKeycloakIdentityStore();
    await app.register(keycloakAuthPlugin, {
      config: keycloak,
      excludePaths: authExcludePaths,
      identityStore,
    });
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
          accessTokenExpiresIn: 900,
        },
        refreshToken: {
          maxLifetime: 30 * 24 * 60 * 60,
        },
        session: {
          duration: 8 * 60 * 60,
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

  // MFA OTP endpoints (Postgres challenges when DATABASE_URL is set — G-704;
  // console SMS unless TWILIO_* is set). Registered in both modes so clients
  // can exercise SMS OTP without Keycloak.
  // G-731: MFA_EXPOSE_OTP is a local-dev convenience only — refuse it in production.
  const exposeOtp = process.env['MFA_EXPOSE_OTP'] === 'true';
  if (exposeOtp && process.env['NODE_ENV'] === 'production') {
    throw new Error('MFA_EXPOSE_OTP=true is not allowed when NODE_ENV=production');
  }
  const otpService = new OtpService({
    store: createOtpChallengeStore(),
    sms: createSmsProviderFromEnv(),
    exposeCodeInResponse: exposeOtp,
  });
  await registerMfaRoutes(app, { otpService, prefix: '/api/v1/auth' });
  await registerMfaRoutes(app, { otpService, prefix: '/auth' });

  // Admin invites (Postgres when DATABASE_URL is set — G-704). Only useful when Keycloak (or another IdP) is on.
  if (keycloak) {
    const inviteService = new InviteService({
      repository: createUserInviteRepository(),
    });
    await registerInviteAndTenantDirectoryRoutes(app, { inviteService });
  }

  // G-504 — secrets accepted during rotation (current first, then previous).
  const jwtVerifySecrets = verifySecretCandidates({
    current: config.jwt.secret,
    previous: config.jwt.previousSecret,
    currentKid: 'current',
    previousKid: 'previous',
  });

  // 7b. Global auth enforcement via onRequest hook
  // This ensures JWT is verified before tenant resolution can read JWT claims
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]!;
    const isExcluded = authExcludePaths.some((excluded) => {
      if (excluded.endsWith('/*')) {
        return url.startsWith(excluded.slice(0, -2));
      }
      return url === excluded;
    });

    const authHeader = request.headers.authorization;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;

    // Local HS JWT — try current secret, then previous (rotation window G-504).
    // Use app.jwt.verify (not request.jwtVerify) so the previous key is not
    // overwritten by the plugin's secret callback.
    const verifyLocalBearer = (token: string): unknown => {
      for (const secret of jwtVerifySecrets) {
        try {
          return app.jwt.verify(token, {
            key: secret,
            allowedIss: config.jwt.issuer,
            allowedAud: config.jwt.audience,
          });
        } catch {
          // try next secret
        }
      }
      return undefined;
    };

    if (isExcluded) {
      // Public path: never 401, but if the caller presents a valid token, bind
      // the principal so downstream keying (rate limit, audit) is per-user
      // rather than per-IP (G-731). Invalid tokens are simply ignored here.
      if (bearer && !keycloak) {
        const payload = verifyLocalBearer(bearer);
        if (payload) request.user = payload as typeof request.user;
      }
      return;
    }

    // Keycloak mode: plugin decorates jwtVerify with JWKS validation.
    if (keycloak) {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired access token',
          statusCode: 401,
        });
      }
      return;
    }

    if (!bearer) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
        statusCode: 401,
      });
    }

    const payload = verifyLocalBearer(bearer);
    if (!payload) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
        statusCode: 401,
      });
    }
    request.user = payload as typeof request.user;
  });

  // 7c. Strip forgeable actor headers AFTER auth (G-102).
  // Clients must not be able to spoof identity via x-user-id / x-actor*.
  // Actor identity comes only from the verified JWT (request.user / getActor).
  const FORGEABLE_ACTOR_HEADERS = new Set(['x-user-id', 'x-actor', 'x-actor-id', 'x-userid']);
  app.addHook('onRequest', async (request) => {
    for (const key of Object.keys(request.headers)) {
      if (FORGEABLE_ACTOR_HEADERS.has(key.toLowerCase())) {
        delete request.headers[key];
      }
    }
  });

  // 8. Register tenant resolution (after auth, so JWT claims are available)
  await app.register(tenantPlugin, {
    baseDomain: config.tenant.baseDomain,
    headerName: config.tenant.headerName,
    excludePaths: [...authExcludePaths, '/api/v1/services'],
    resolveSlugToId: false, // Gateway doesn't have direct DB access
  });

  // 8a. G-106 — Suspended tenants cannot mutate /api/v1 (except /auth).
  const SUSPEND_MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  app.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (!SUSPEND_MUTATING.has(method)) return;

    const url = request.url.split('?')[0]!;
    if (!url.startsWith('/api/v1/')) return;
    if (url.startsWith('/api/v1/auth/') || url === '/api/v1/auth') return;

    const tenantId = request.tenantId ?? request.user?.tenantId;
    const userClaim = request.user as { tenantStatus?: string } | undefined;
    if (isRequestTenantSuspended(tenantId, userClaim)) {
      return reply.status(403).send({
        code: 'TENANT_SUSPENDED',
        message: 'Tenant is suspended; mutating requests are not allowed',
        statusCode: 403,
      });
    }
  });


  // 8a-bis. G-810 — Feature entitlements (optional modules). Absent feature maps allow.
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]!;
    if (!url.startsWith('/api/v1/')) return;
    if (url.startsWith('/api/v1/auth/') || url === '/api/v1/auth') return;
    const tenantId = request.tenantId ?? request.user?.tenantId;
    const user = request.user as FeaturesUser | undefined;
    const missing = missingFeatureForRequest(tenantId, user, url);
    if (missing) {
      return reply.status(403).send({
        code: 'FEATURE_NOT_ENTITLED',
        message: `Tenant is not entitled to feature '${missing}'`,
        feature: missing,
        statusCode: 403,
      });
    }
  });

  // 8a-ter. G-805 — School (institution) scope for school-bound principals.
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]!;
    if (!url.startsWith('/api/v1/')) return;
    if (url.startsWith('/api/v1/auth/') || url === '/api/v1/auth') return;
    const user = request.user as InstitutionScopeUser | undefined;
    if (!user) return;
    const institutionId = extractInstitutionId({
      query: request.query,
      params: request.params,
      body: request.body,
    });
    const decision = decideInstitutionScope(user, url, institutionId);
    if (decision.action === 'deny') {
      return reply.status(403).send({
        code: 'INSTITUTION_OUT_OF_SCOPE',
        message: 'Institution is outside the caller school scope',
        institutionId: decision.institutionId,
        statusCode: 403,
      });
    }
    if (decision.action === 'inject') {
      const current =
        request.query && typeof request.query === 'object'
          ? (request.query as Record<string, unknown>)
          : {};
      Object.defineProperty(request, 'query', {
        value: { ...current, institutionId: decision.institutionId },
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  });

  // 8b. Register Idempotency-Key support (after tenant, so tenant scoping works)
  // Connects to Redis via REDIS_URL env var; gracefully degrades if unavailable
  const redisUrl = process.env['REDIS_URL'];
  let redisClient: RedisClient | undefined;
  if (redisUrl) {
    // Dynamic import to avoid hard dependency when Redis is not configured
    try {
      const ioredisMod: unknown = await import('ioredis');
      const RedisCtor = (ioredisMod as { default: new (url: string) => RedisClient }).default;
      redisClient = new RedisCtor(redisUrl);
    } catch {
      // ioredis not available — idempotency will be disabled
    }
  }
  await app.register(idempotencyPlugin, {
    redis: redisClient,
    ttlSeconds: parseInt(process.env['IDEMPOTENCY_TTL_SECONDS'] || '86400', 10),
    lockTtlSeconds: parseInt(process.env['IDEMPOTENCY_LOCK_TTL_SECONDS'] || '60', 10),
    excludePaths: [...authExcludePaths, '/api/v1/services'],
  });

  // 8c. Mount RBAC (G-101) after tenant resolution and before domain plugins.
  const rbacRegistry = createGatewayRbacRegistry();
  const areaResolver = new InMemoryAreaHierarchyResolver([
    { id: 'root', parentId: null, level: 0, path: '/root' },
  ]);
  await app.register(rbacPlugin, {
    registry: rbacRegistry,
    areaResolver,
  });

  // 8d. Mount audit trail (G-105) — Postgres when DATABASE_URL is set (G-704).
  // Prefix avoids clash with platform-admin UI stub at GET /api/v1/audit.
  const { repository: auditRepository, persistence: auditPersistence } = createAuditRepository();
  app.log.info({ persistence: auditPersistence }, 'audit repository ready');
  await app.register(auditPlugin, {
    repository: auditRepository,
    prefix: '/api/v1/audit-logs',
  });

  // 8d'. G-913 — enforce per-tenant retention at runtime. Opt out with
  // AUDIT_RETENTION_SCHEDULER=0 (tests / one-off tooling); interval override in ms.
  if (process.env.AUDIT_RETENTION_SCHEDULER !== '0' && process.env.NODE_ENV !== 'test') {
    const intervalMs = Number(process.env.AUDIT_RETENTION_INTERVAL_MS) || DEFAULT_RETENTION_INTERVAL_MS;
    const retentionScheduler = createRetentionScheduler({
      service: app.auditService,
      intervalMs,
      logger: app.log,
    });
    retentionScheduler.start();
    app.addHook('onClose', async () => {
      retentionScheduler.stop();
    });
  }

  // 8e. Mount billing + tenant lifecycle (G-106). Tenant routes use a non-clashing
  // prefix because platform-admin UI owns `/api/v1/tenants`.
  await app.register(billingPlugin, {
    repository: createBillingRepository(),
    prefix: '/api/v1/billing',
  });
  await app.register(tenantLifecyclePlugin, {
    repository: createTenantRepository().repository,
    prefix: '/api/v1/tenant-lifecycle',
    branding: { disabled: true },
  });

  // Record mutating API calls (best-effort; never fail the request).
  app.addHook('onResponse', async (request, reply) => {
    if (!shouldAuditMutation(request.method, request.url)) return;
    // Skip unauthenticated / forbidden — still record validation failures (4xx)
    // so mutating attempts that passed RBAC leave an audit trail.
    if (reply.statusCode === 401 || reply.statusCode === 403) return;
    if (reply.statusCode >= 500) return;

    const user = request.user;
    if (!user) return;

    const path = request.url.split('?')[0]!;
    const operation = operationForMethod(request.method);
    const { beforeValues, afterValues } = buildAuditValues(operation, request);

    try {
      await app.auditService.recordAudit({
        tenantId: user.tenantId,
        entityType: entityTypeForPath(path),
        entityId: entityIdFromPath(path),
        operation,
        userId: user.sub,
        userName: user.displayName ?? user.email ?? user.sub,
        ipAddress: request.ip,
        beforeValues,
        afterValues,
        metadata: { method: request.method, path, statusCode: reply.statusCode },
      });
    } catch {
      // Audit must not break the primary request path.
    }
  });

  // G-702 / G-712: every /api/v1 request (reads included) is evaluated against
  // the RBAC registry. Unmapped segments are denied for non-platform-admins.
  app.addHook('onRequest', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return;

    const url = request.url.split('?')[0]!;
    if (!url.startsWith('/api/v1/')) return;
    if (url.startsWith('/api/v1/auth/') || url === '/api/v1/auth') return;

    const resource = resourceForApiPath(url);
    if (!resource) return;

    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        statusCode: 401,
      });
    }

    const roles = user.roles ?? [];
    const isPlatformAdmin = roles.some((r) => {
      const id = typeof r === 'string' ? r : r.roleId;
      return PLATFORM_ADMIN_ROLE_IDS.has(id);
    });

    // Platform control plane: platform_admin / super-admin role only (G-104/G-702).
    if (resource === 'platform') {
      if (isPlatformAdmin) return;
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Platform administrator role required',
        statusCode: 403,
      });
    }

    if (resource === UNMAPPED_API_RESOURCE) {
      if (isPlatformAdmin) return;
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'No RBAC resource is mapped for this path (default-deny)',
        statusCode: 403,
      });
    }

    const action = actionForMethod(method);
    // Self-service resources every authenticated principal may read (own scope
    // is enforced inside the domain plugin).
    if (action === 'read' && SELF_SERVICE_READ_RESOURCES.has(resource)) return;
    const authUser = {
      userId: user.sub,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      areas: user.areas,
      institutions: user.institutions,
    };

    const result = await evaluatePermission(authUser, resource, action, rbacRegistry, areaResolver);

    if (!result.granted) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: result.reason,
        statusCode: 403,
      });
    }
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
