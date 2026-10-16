/**
 * Admin Scalability Dashboard Routes
 *
 * Provides monitoring and management endpoints for the scalability layer:
 * - Cache metrics (hits, misses, errors, hit rate)
 * - Queue depth, lag, and DLQ count
 * - Overall scalability health summary
 * - Cache flush for a specific tenant (admin only)
 */
import type { CacheClient } from '@proctira/cache';
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface ScalabilityRoutesOptions {
  /** CacheClient instance for metrics and flush operations */
  cache: CacheClient;
  /** QueueAdapter instance for queue health and depth info */
  queue: QueueAdapter;
  /**
   * Authorization check — receives the request, returns true if the caller is
   * a platform admin.
   *
   * PRC-M560: this is now REQUIRED and enforced on every route (reads and the
   * destructive flush). Previously it was optional, so if a mount site forgot
   * to pass it the routes failed open — any caller could read infra health or
   * flush another tenant's cache. Omitting it is a programming error.
   */
  isAdmin: (request: FastifyRequest) => boolean | Promise<boolean>;
  /**
   * PRC-M560: optional append-only audit sink for the destructive cache-flush
   * operation. When provided, the audit row MUST be written before the flush
   * is reported as successful (fail closed: a failed audit write aborts the
   * flush). The actor is derived from the authenticated request.
   */
  auditLog?: (entry: {
    action: 'admin.scalability.cache.flush';
    tenantId: string;
    request: FastifyRequest;
  }) => void | Promise<void>;
}

/** PRC-M560: strict UUID (v1–v5) matcher; rejects globs like `*` and `t:…`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Cache metrics response shape.
 */
interface CacheMetricsResponse {
  hits: number;
  misses: number;
  errors: number;
  hitRate: number;
  healthy: boolean;
}

/**
 * Queue metrics response shape.
 */
interface QueueMetricsResponse {
  connected: boolean;
  healthy: boolean;
  backend: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Overall scalability health response.
 */
interface ScalabilityHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  cache: CacheMetricsResponse;
  queue: QueueMetricsResponse;
  timestamp: string;
}

/**
 * Registers scalability monitoring and management routes under /api/v1/admin/scalability.
 */
export async function registerScalabilityRoutes(
  app: FastifyInstance,
  options: ScalabilityRoutesOptions,
): Promise<void> {
  const { cache, queue, isAdmin, auditLog } = options;

  // PRC-M560: fail closed at wiring time — a mount site that forgets the
  // authorization check must not silently expose these admin routes.
  if (typeof isAdmin !== 'function') {
    throw new Error(
      'registerScalabilityRoutes: `isAdmin` is required — admin scalability routes refuse to mount without an authorization check',
    );
  }

  const prefix = '/api/v1/admin/scalability';

  /**
   * PRC-M560: shared guard applied to every route (reads + flush). Returns
   * true when the caller is authorised; otherwise sends 403 and returns false.
   */
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const authorized = await isAdmin(request);
    if (!authorized) {
      await reply.status(403).send({ error: 'Forbidden: admin access required' });
      return false;
    }
    return true;
  };

  /**
   * GET /api/v1/admin/scalability/cache
   * Returns cache metrics: hits, misses, errors, hit rate.
   */
  app.get(`${prefix}/cache`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return reply;
    const metrics = cache.getMetrics();
    const total = metrics.hits + metrics.misses;
    const hitRate = total > 0 ? metrics.hits / total : 0;
    const healthy = await cache.isHealthy();

    const response: CacheMetricsResponse = {
      hits: metrics.hits,
      misses: metrics.misses,
      errors: metrics.errors,
      hitRate: Math.round(hitRate * 10000) / 10000, // 4 decimal places
      healthy,
    };

    return reply.status(200).send(response);
  });

  /**
   * GET /api/v1/admin/scalability/queue
   * Returns queue health, connection status, and latency.
   */
  app.get(`${prefix}/queue`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return reply;
    const healthCheck = await queue.healthCheck();

    const response: QueueMetricsResponse = {
      connected: queue.isConnected(),
      healthy: healthCheck.healthy,
      backend: healthCheck.backend,
      latencyMs: healthCheck.latencyMs,
      error: healthCheck.error,
    };

    return reply.status(200).send(response);
  });

  /**
   * GET /api/v1/admin/scalability/health
   * Returns overall scalability health summary combining cache and queue status.
   */
  app.get(`${prefix}/health`, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAdmin(request, reply))) return reply;
    const cacheMetrics = cache.getMetrics();
    const total = cacheMetrics.hits + cacheMetrics.misses;
    const hitRate = total > 0 ? cacheMetrics.hits / total : 0;
    const cacheHealthy = await cache.isHealthy();
    const queueHealth = await queue.healthCheck();

    const cacheResponse: CacheMetricsResponse = {
      hits: cacheMetrics.hits,
      misses: cacheMetrics.misses,
      errors: cacheMetrics.errors,
      hitRate: Math.round(hitRate * 10000) / 10000,
      healthy: cacheHealthy,
    };

    const queueResponse: QueueMetricsResponse = {
      connected: queue.isConnected(),
      healthy: queueHealth.healthy,
      backend: queueHealth.backend,
      latencyMs: queueHealth.latencyMs,
      error: queueHealth.error,
    };

    let status: ScalabilityHealthResponse['status'] = 'healthy';
    if (!cacheHealthy && !queueHealth.healthy) {
      status = 'unhealthy';
    } else if (!cacheHealthy || !queueHealth.healthy) {
      status = 'degraded';
    }

    const response: ScalabilityHealthResponse = {
      status,
      cache: cacheResponse,
      queue: queueResponse,
      timestamp: new Date().toISOString(),
    };

    return reply.status(200).send(response);
  });

  /**
   * POST /api/v1/admin/scalability/cache/flush
   * Flush cache for a specific tenant. Admin only.
   * Body: { tenantId: string }
   */
  app.post(`${prefix}/cache/flush`, async (request: FastifyRequest, reply: FastifyReply) => {
    // PRC-M560: authorization is mandatory (fail closed) on this destructive,
    // cross-tenant operation.
    if (!(await requireAdmin(request, reply))) return reply;

    const body = request.body as { tenantId?: unknown } | undefined;
    const tenantId = body?.tenantId;

    // PRC-M560: tenantId must be a well-formed UUID. This rejects the previous
    // injection vector where `tenantId='*'` (or `t:…`) would expand the
    // `invalidatePattern` glob and wipe EVERY tenant's cache.
    if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) {
      return reply.status(400).send({ error: 'tenantId must be a valid UUID' });
    }

    // PRC-M560: write the append-only audit row (with the actor derived from
    // the request) BEFORE flushing. A failed audit write aborts the flush so
    // the destructive action is never unaudited.
    if (auditLog) {
      await auditLog({ action: 'admin.scalability.cache.flush', tenantId, request });
    }

    // Flush all keys for the given tenant using pattern matching
    const deletedCount = await cache.invalidatePattern(`t:${tenantId}:*`);
    const listDeletedCount = await cache.invalidatePattern(`lst:${tenantId}:*`);
    const configDeletedCount = await cache.invalidatePattern(`cfg:${tenantId}:*`);

    return reply.status(200).send({
      success: true,
      tenantId,
      keysDeleted: deletedCount + listDeletedCount + configDeletedCount,
      timestamp: new Date().toISOString(),
    });
  });
}
