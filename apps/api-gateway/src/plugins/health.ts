/**
 * Health Check Plugin
 *
 * Provides /health endpoint reporting readiness and liveness status.
 * - Liveness: The gateway process is running and can handle requests (cheap)
 * - Readiness: Critical dependencies (Postgres / Redis when configured) must be reachable
 */

import {
  assertDatabaseSchemaReady,
  DATABASE_SCHEMA_CONTRACTS,
  getSharedPgPool,
} from '@proctira/database';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';

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
  /**
   * PRC-M024: reuse a readiness result for this many ms and coalesce
   * concurrent probes into one (default 2000; 0 disables caching).
   */
  readinessCacheMs?: number;
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

/** Race `work` against a timeout and always clear the timer (PRC-M024). */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} probe timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function defaultProbeDatabase(databaseUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  // PRC-M024: reuse the process-wide shared pool instead of a new pool per request.
  const pool = getSharedPgPool(databaseUrl);
  const start = Date.now();
  if (!pool) return { ok: false, message: 'Database pool unavailable', latencyMs: 0 };
  try {
    await withTimeout(
      assertDatabaseSchemaReady(pool, 'api gateway readiness', GATEWAY_SCHEMA_READINESS_RELATIONS),
      timeoutMs,
      'Database',
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  }
}

/** PRC-M024: one long-lived probe client per Redis URL (not one per request). */
const probeRedisClients = new Map<string, Redis>();

function sharedProbeRedis(redisUrl: string, timeoutMs: number): Redis {
  let client = probeRedisClients.get(redisUrl);
  if (!client) {
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: timeoutMs,
    });
    client.on('error', () => undefined);
    probeRedisClients.set(redisUrl, client);
  }
  return client;
}

/** Close shared probe clients (app shutdown / tests). */
export async function closeHealthProbeClients(): Promise<void> {
  const clients = [...probeRedisClients.values()];
  probeRedisClients.clear();
  await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
}

async function defaultProbeRedis(redisUrl: string, timeoutMs: number): Promise<ProbeOutcome> {
  const client = sharedProbeRedis(redisUrl, timeoutMs);
  const start = Date.now();
  try {
    const connect =
      client.status === 'wait' || client.status === 'end' ? client.connect() : Promise.resolve();
    await withTimeout(
      connect.then(() => client.ping()),
      timeoutMs,
      'Redis',
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * PRC-M024: public health bodies never carry raw dependency error text (it can
 * contain hostnames, ports, user names). Only the failing dependency names.
 */
export function publicReadinessMessage(readiness: ReadinessProbeResult): string | undefined {
  if (readiness.ready) return undefined;
  const failing = Object.entries(readiness.dependencies)
    .filter(([, status]) => status === 'down' || status === 'required-missing')
    .map(([name]) => name);
  return failing.length > 0 ? `Dependency unavailable: ${failing.join(', ')}` : 'Not ready';
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

  // PRC-M024: cache + coalesce readiness so a burst of probes opens at most one
  // dependency check; raw failure detail is logged, never returned.
  const cacheMs = Math.max(0, options.readinessCacheMs ?? 2000);
  let cached: { at: number; result: ReadinessProbeResult } | undefined;
  let inFlight: Promise<ReadinessProbeResult> | undefined;
  const readinessOnce = async (): Promise<ReadinessProbeResult> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.result;
    inFlight ??= runReadinessProbe(probeOptions())
      .then((result) => {
        if (!result.ready) {
          fastify.log.warn(
            { dependencies: result.dependencies, detail: result.message },
            'gateway readiness probe failed',
          );
        }
        if (cacheMs > 0) cached = { at: Date.now(), result };
        return result;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
  fastify.addHook('onClose', async () => {
    await closeHealthProbeClients();
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
      const readiness = await readinessOnce();

      const readinessDetails: Record<string, string> = {
        database: readiness.dependencies.database,
        redis: readiness.dependencies.redis,
      };
      const publicMessage = publicReadinessMessage(readiness);
      if (publicMessage) {
        readinessDetails.message = publicMessage;
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
      const readiness = await readinessOnce();
      const publicMessage = publicReadinessMessage(readiness);

      const body = {
        status: readiness.ready ? 'up' : 'down',
        dependencies: readiness.dependencies,
        ...(publicMessage ? { message: publicMessage } : {}),
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
