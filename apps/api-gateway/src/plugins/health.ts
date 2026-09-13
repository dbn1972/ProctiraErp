/**
 * Health Check Plugin
 *
 * Provides /health endpoint reporting readiness and liveness status.
 * - Liveness: The gateway process is running and can handle requests (cheap)
 * - Readiness: Critical dependencies (Postgres when configured) must be reachable
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import pg from 'pg';

import type { ServiceRoute } from '../config.js';

/** Mirrors @proctira/database persistence env without importing Prisma. */
export interface PersistencePolicyEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  REQUIRE_DATABASE?: string;
  ALLOW_IN_MEMORY_IN_PRODUCTION?: string;
}

export interface HealthCheckOptions {
  /** Service routes (retained for plugin wiring; readiness no longer reports unknown). */
  services: Record<string, ServiceRoute>;
  /** Override DB probe (tests). */
  probeDatabase?: () => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
  /** Override env read (tests). */
  env?: PersistencePolicyEnv;
  /** DB probe timeout in ms (default 3000). */
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

export interface ReadinessProbeResult {
  ready: boolean;
  dependencies: { database: DatabaseDependencyStatus };
  message?: string;
  latencyMs?: number;
}

function readEnv(override?: PersistencePolicyEnv): PersistencePolicyEnv {
  if (override) return override;
  return {
    NODE_ENV: process.env['NODE_ENV'],
    DATABASE_URL: process.env['DATABASE_URL'],
    REQUIRE_DATABASE: process.env['REQUIRE_DATABASE'],
    ALLOW_IN_MEMORY_IN_PRODUCTION: process.env['ALLOW_IN_MEMORY_IN_PRODUCTION'],
  };
}

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function databaseRequired(env: PersistencePolicyEnv): boolean {
  if (truthy(env.REQUIRE_DATABASE)) return true;
  if (env.NODE_ENV === 'production' && !truthy(env.ALLOW_IN_MEMORY_IN_PRODUCTION)) {
    return true;
  }
  return Boolean(env.DATABASE_URL?.trim());
}

async function defaultProbeDatabase(
  databaseUrl: string,
  timeoutMs: number,
): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const start = Date.now();
  try {
    await Promise.race([
      pool.query('SELECT 1 AS ok'),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Database probe timed out after ${timeoutMs}ms`)), timeoutMs);
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

/** W1-OPS-03 (B5): probe critical deps; fail closed when Postgres is required but unavailable. */
export async function runReadinessProbe(
  options: Pick<HealthCheckOptions, 'probeDatabase' | 'env' | 'probeTimeoutMs'> = {},
): Promise<ReadinessProbeResult> {
  const env = readEnv(options.env);
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const timeoutMs = options.probeTimeoutMs ?? 3000;

  if (!databaseUrl) {
    if (databaseRequired(env)) {
      return {
        ready: false,
        dependencies: { database: 'required-missing' },
        message: 'DATABASE_URL is required but not configured',
      };
    }
    return {
      ready: true,
      dependencies: { database: 'in-memory' },
      message: 'In-memory persistence (DATABASE_URL unset)',
    };
  }

  const probe = options.probeDatabase ?? (() => defaultProbeDatabase(databaseUrl, timeoutMs));
  const result = await probe();

  if (!result.ok) {
    return {
      ready: false,
      dependencies: { database: 'down' },
      message: result.message ?? 'Database probe failed',
      latencyMs: result.latencyMs,
    };
  }

  return {
    ready: true,
    dependencies: { database: 'up' },
    latencyMs: result.latencyMs,
  };
}

const healthPlugin: FastifyPluginAsync<HealthCheckOptions> = async (
  fastify: FastifyInstance,
  options: HealthCheckOptions,
) => {
  const startTime = Date.now();

  const probeOptions = (): Pick<HealthCheckOptions, 'probeDatabase' | 'env' | 'probeTimeoutMs'> => ({
    probeDatabase: options.probeDatabase,
    env: options.env,
    probeTimeoutMs: options.probeTimeoutMs,
  });

  /**
   * GET /health - Combined health check endpoint
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
        },
      },
    },
    async (_request, _reply) => {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const readiness = await runReadinessProbe(probeOptions());

      const readinessDetails: Record<string, string> = {
        database: readiness.dependencies.database,
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

      return healthStatus;
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
        description: 'Readiness probe - checks critical dependencies (Postgres when configured)',
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
