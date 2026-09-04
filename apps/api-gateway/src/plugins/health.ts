/**
 * Health Check Plugin
 *
 * Provides /health endpoint reporting readiness and liveness status.
 * - Liveness: The gateway process is running and can handle requests
 * - Readiness: Lightweight dependency checks when configured:
 *   - Postgres via `@proctira/database` `$queryRaw\`SELECT 1\`` when DATABASE_URL is set
 *   - Redis PING via ioredis when REDIS_URL is set (ioredis is already a dependency)
 *   Checks that are not configured are skipped (not treated as failures).
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { PrismaClient } from '@proctira/database';
import Redis from 'ioredis';

import type { ServiceRoute } from '../config.js';

export interface HealthCheckOptions {
  /** Service routes to check for readiness */
  services: Record<string, ServiceRoute>;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    liveness: { status: 'up' | 'down' };
    readiness: { status: 'up' | 'down'; details?: Record<string, string> };
  };
}

type CheckResult = 'up' | 'down' | 'skipped';

async function checkPostgres(prisma: PrismaClient | undefined): Promise<CheckResult> {
  if (!prisma) {
    return 'skipped';
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'up';
  } catch {
    return 'down';
  }
}

async function checkRedis(redisUrl: string | undefined): Promise<CheckResult> {
  if (!redisUrl) {
    return 'skipped';
  }

  let redis: Redis | undefined;
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    await redis.connect();
    const pong = await redis.ping();
    return pong === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  } finally {
    if (redis) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
  }
}

async function collectDependencyChecks(
  prisma: PrismaClient | undefined,
  redisUrl: string | undefined,
): Promise<Record<string, string>> {
  const details: Record<string, string> = {};

  const [postgres, redis] = await Promise.all([
    checkPostgres(prisma),
    checkRedis(redisUrl),
  ]);

  if (postgres !== 'skipped') {
    details['postgres'] = postgres;
  }
  if (redis !== 'skipped') {
    details['redis'] = redis;
  }

  return details;
}

function isReady(details: Record<string, string>): boolean {
  return !Object.values(details).some((status) => status === 'down');
}

const healthPlugin: FastifyPluginAsync<HealthCheckOptions> = async (
  fastify: FastifyInstance,
  options: HealthCheckOptions,
) => {
  const startTime = Date.now();
  const redisUrl = process.env['REDIS_URL'];
  let prisma: PrismaClient | undefined;

  // Reuse one Prisma client for readiness probes when DATABASE_URL is configured.
  // createPrismaClient is not singleton-cached in production, so we own the lifecycle here.
  if (process.env['DATABASE_URL']) {
    const { createPrismaClient } = await import('@proctira/database');
    prisma = createPrismaClient();
    fastify.addHook('onClose', async () => {
      await prisma?.$disconnect();
    });
  }

  /**
   * GET /health - Combined health check endpoint
   */
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint reporting readiness and liveness',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
            checks: {
              type: 'object',
              properties: {
                liveness: {
                  type: 'object',
                  properties: { status: { type: 'string' } },
                },
                readiness: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    details: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number' },
            checks: {
              type: 'object',
              properties: {
                liveness: {
                  type: 'object',
                  properties: { status: { type: 'string' } },
                },
                readiness: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    details: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply: FastifyReply) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const details = await collectDependencyChecks(prisma, redisUrl);
    const ready = isReady(details);

    const healthStatus: HealthStatus = {
      status: ready ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime,
      checks: {
        liveness: { status: 'up' },
        readiness: { status: ready ? 'up' : 'down', details },
      },
    };

    return reply.status(ready ? 200 : 503).send(healthStatus);
  });

  /**
   * GET /health/live - Liveness probe (is the process running?)
   */
  fastify.get('/health/live', {
    schema: {
      description: 'Liveness probe - checks if the gateway process is running',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
  }, async (_request, _reply) => {
    return { status: 'up' };
  });

  /**
   * GET /health/ready - Readiness probe (can the gateway serve traffic?)
   */
  fastify.get('/health/ready', {
    schema: {
      description: 'Readiness probe - checks if the gateway can serve traffic',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const serviceStatuses: Record<string, string> = {};
    for (const [name] of Object.entries(options.services)) {
      serviceStatuses[name] = 'unknown';
    }

    const dependencyDetails = await collectDependencyChecks(prisma, redisUrl);
    Object.assign(serviceStatuses, dependencyDetails);

    const ready = isReady(dependencyDetails);
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'up' : 'down',
      services: serviceStatuses,
    });
  });
};

export default fp(healthPlugin, {
  name: 'health-check',
  fastify: '4.x',
});
