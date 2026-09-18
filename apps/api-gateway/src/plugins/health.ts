/**
 * Health Check Plugin
 *
 * Provides /health endpoint reporting readiness and liveness status.
 * - Liveness: The gateway process is running and can handle requests (cheap)
 * - Readiness: Critical dependencies (Postgres / Redis when configured) must be reachable
 */

import { assertDatabaseSchemaReady, DATABASE_SCHEMA_CONTRACTS } from '@proctira/database';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import pg from 'pg';

import type { ServiceRoute } from '../config.js';

/** Mirrors @proctira/database persistence env without importing Prisma. */
export interface PersistencePolicyEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  REQUIRE_DATABASE?: string;
  ALLOW_IN_MEMORY_IN_PRODUCTION?: string;
  REDIS_URL?: string;
}

export interface HealthCheckOptions {
  /** Service routes (retained for plugin wiring; readiness no longer reports unknown). */
  services: Record<string, ServiceRoute>;
  /** Override DB probe (tests). */
  probeDatabase?: () => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
  /** Override Redis probe (tests). */
  probeRedis?: () => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
  /** Override env read (tests). */
  env?: PersistencePolicyEnv;
  /** Dependency probe timeout in ms (default 3000). */
  probeTimeoutMs?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    liveness: { status: 'up' | 'down' };
    readiness: {
      status: 'up' | 'down';
      details?: Record<string, string>;
    };
  };
}

export type DatabaseDependencyStatus = 'up' | 'down' | 'in-memory' | 'required-missing';
export type RedisDependencyStatus = 'up' | 'down' | 'not-configured';

export interface ReadinessProbeResult {
  ready: boolean;
  dependencies: {
    database: DatabaseDependencyStatus;
    redis: RedisDependencyStatus;
  };
  message?: string;
  latencyMs?: number;
}

type ProbeOutcome = { ok: boolean; message?: string; latencyMs?: number };

export const GATEWAY_SCHEMA_READINESS_RELATIONS = [
  ...new Set(Object.values(DATABASE_SCHEMA_CONTRACTS).flat()),
];

function readEnv(override?: PersistencePolicyEnv): PersistencePolicyEnv {
  if (override) return override;
  return {
    NODE_ENV: process.env['NODE_ENV'],
    DATABASE_URL: process.env['DATABASE_URL'],
    REQUIRE_DATABASE: process.env['REQUIRE_DATABASE'],
    ALLOW_IN_MEMORY_IN_PRODUCTION: process.env['ALLOW_IN_MEMORY_IN_PRODUCTION'],
    REDIS_URL: process.env['REDIS_URL'],
  };
}

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function databaseRequired(env: PersistencePolicyEnv): boolean {
  if (truthy(env.REQUIRE_DATABASE)) return true;
  // W1-SEC-12: production always requires Postgres — ALLOW_IN_MEMORY_IN_PRODUCTION
  // is obsolete and must not keep readiness green on in-memory stores.
  if (env.NODE_ENV === 'production') {
    return true;
  }
  return Boolean(env.DATABASE_URL?.trim());
}

async function defaultProbeDatabase(databaseUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const start = Date.now();
  try {
    await Promise.race([
      assertDatabaseSchemaReady(pool, 'api gateway readiness', GATEWAY_SCHEMA_READINESS_RELATIONS),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Database probe timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function defaultProbeRedis(redisUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: timeoutMs,
  });
  const start = Date.now();
  try {
    await Promise.race([
      client.connect().then(() => client.ping()),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Redis probe timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  } finally {
    await client.quit().catch(() => undefined);
  }
}

async function probeDatabaseDependency(
  env: PersistencePolicyEnv,
  options: Pick<HealthCheckOptions, 'probeDatabase' | 'probeTimeoutMs'>,
): Promise<{
  ready: boolean;
  status: DatabaseDependencyStatus;
  message?: string;
  latencyMs?: number;
}> {
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const timeoutMs = options.probeTimeoutMs ?? 3000;

  if (!databaseUrl) {
    if (databaseRequired(env)) {
      const obsoleteEscape =
        env.NODE_ENV === 'production' && truthy(env.ALLOW_IN_MEMORY_IN_PRODUCTION)
          ? ' (ALLOW_IN_MEMORY_IN_PRODUCTION is disabled — W1-SEC-12)'
          : '';
      return {
        ready: false,
        status: 'required-missing',
        message: `DATABASE_URL is required but not configured${obsoleteEscape}`,
      };
    }
    return {
      ready: true,
      status: 'in-memory',
      message: 'In-memory persistence (DATABASE_URL unset)',
    };
  }

  const probe = options.probeDatabase ?? (() => defaultProbeDatabase(databaseUrl, timeoutMs));
  const result = await probe();

  if (!result.ok) {
    return {
      ready: false,
      status: 'down',
      message: result.message ?? 'Database probe failed',
      latencyMs: result.latencyMs,
    };
  }

  return {
    ready: true,
    status: 'up',
    latencyMs: result.latencyMs,
  };
}

async function probeRedisDependency(
  env: PersistencePolicyEnv,
  options: Pick<HealthCheckOptions, 'probeRedis' | 'probeTimeoutMs'>,
): Promise<{
  ready: boolean;
  status: RedisDependencyStatus;
  message?: string;
  latencyMs?: number;
}> {
  const redisUrl = env.REDIS_URL?.trim() || null;
  const timeoutMs = options.probeTimeoutMs ?? 3000;

  if (!redisUrl) {
    return {
      ready: true,
      status: 'not-configured',
      message: 'Redis optional (REDIS_URL unset)',
    };
  }

  const probe = options.probeRedis ?? (() => defaultProbeRedis(redisUrl, timeoutMs));
  const result = await probe();

  if (!result.ok) {
    return {
      ready: false,
      status: 'down',
      message: result.message ?? 'Redis probe failed',
      latencyMs: result.latencyMs,
    };
  }

  return {
    ready: true,
    status: 'up',
    latencyMs: result.latencyMs,
  };
}

/** W1-OPS-03 / W3-C1: probe critical deps; fail closed when configured Postgres/Redis is unavailable. */
export async function runReadinessProbe(
  options: Pick<HealthCheckOptions, 'probeDatabase' | 'probeRedis' | 'env' | 'probeTimeoutMs'> = {},
): Promise<ReadinessProbeResult> {
  const env = readEnv(options.env);

  const [database, redis] = await Promise.all([
    probeDatabaseDependency(env, options),
    probeRedisDependency(env, options),
  ]);

  const ready = database.ready && redis.ready;
  const failures = [database, redis].filter((dep) => !dep.ready && dep.message);

  return {
    ready,
    dependencies: {
      database: database.status,
      redis: redis.status,
    },
    message: failures.length > 0 ? failures.map((dep) => dep.message).join('; ') : undefined,
    latencyMs: Math.max(database.latencyMs ?? 0, redis.latencyMs ?? 0) || undefined,
  };
}

const healthPlugin: FastifyPluginAsync<HealthCheckOptions> = async (
  fastify: FastifyInstance,
  options: HealthCheckOptions,
) => {
  const startTime = Date.now();

  const probeOptions = (): Pick<
    HealthCheckOptions,
    'probeDatabase' | 'probeRedis' | 'env' | 'probeTimeoutMs'
  > => ({
    probeDatabase: options.probeDatabase,
    probeRedis: options.probeRedis,
    env: options.env,
    probeTimeoutMs: options.probeTimeoutMs,
  });

  /**
   * GET /health - Combined health check endpoint
   *
   * W1-OPS-03: fail closed (503) when readiness is down so Dockerfile
   * HEALTHCHECK (`curl --fail /health`) and soft-skip clients cannot treat
   * an unready gateway as healthy.
   */
  fastify.get(
    '/health',
    {
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
    },
    async (_request, reply) => {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const readiness = await runReadinessProbe(probeOptions());

      const readinessDetails: Record<string, string> = {
        database: readiness.dependencies.database,
        redis: readiness.dependencies.redis,
      };
      if (readiness.message) {
        readinessDetails.message = readiness.message;
      }

      const healthStatus: HealthStatus = {
        status: readiness.ready ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime,
        checks: {
          liveness: { status: 'up' },
          readiness: {
            status: readiness.ready ? 'up' : 'down',
            details: readinessDetails,
          },
        },
      };

      if (!readiness.ready) {
        return reply.status(503).send(healthStatus);
      }

      return reply.status(200).send(healthStatus);
    },
  );

  /**
   * GET /health/live - Liveness probe (is the process running?)
   */
  fastify.get(
    '/health/live',
    {
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
    },
    async (_request, _reply) => {
      return { status: 'up' };
    },
  );

  /**
   * GET /health/ready - Readiness probe (can the gateway serve traffic?)
   */
  fastify.get(
    '/health/ready',
    {
      schema: {
        description:
          'Readiness probe - checks critical dependencies (Postgres and Redis when configured)',
        tags: ['Health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              dependencies: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
                  redis: { type: 'string' },
                },
              },
              message: { type: 'string' },
              latencyMs: { type: 'number' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              dependencies: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
                  redis: { type: 'string' },
                },
              },
              message: { type: 'string' },
              latencyMs: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const readiness = await runReadinessProbe(probeOptions());

      const body = {
        status: readiness.ready ? 'up' : 'down',
        dependencies: readiness.dependencies,
        ...(readiness.message ? { message: readiness.message } : {}),
        ...(readiness.latencyMs !== undefined ? { latencyMs: readiness.latencyMs } : {}),
      };

      if (!readiness.ready) {
        return reply.status(503).send(body);
      }

      return reply.status(200).send(body);
    },
  );
};

export default fp(healthPlugin, {
  name: 'health-check',
  fastify: '5.x',
});
