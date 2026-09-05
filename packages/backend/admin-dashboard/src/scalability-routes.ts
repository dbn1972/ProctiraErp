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
  /** Optional authorization check — receives the request, returns true if admin */
  isAdmin?: (request: FastifyRequest) => boolean | Promise<boolean>;
}

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
  const { cache, queue, isAdmin } = options;

  const prefix = '/api/v1/admin/scalability';

  /**
   * GET /api/v1/admin/scalability/cache
   * Returns cache metrics: hits, misses, errors, hit rate.
   */
  app.get(`${prefix}/cache`, async (_request: FastifyRequest, reply: FastifyReply) => {
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
  app.get(`${prefix}/queue`, async (_request: FastifyRequest, reply: FastifyReply) => {
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
  app.get(`${prefix}/health`, async (_request: FastifyRequest, reply: FastifyReply) => {
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
    // Authorization check
    if (isAdmin) {
      const authorized = await isAdmin(request);
      if (!authorized) {
        return reply.status(403).send({ error: 'Forbidden: admin access required' });
      }
    }

    const body = request.body as { tenantId?: string } | undefined;
    const tenantId = body?.tenantId;

    if (!tenantId || typeof tenantId !== 'string') {
      return reply.status(400).send({ error: 'tenantId is required in request body' });
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
