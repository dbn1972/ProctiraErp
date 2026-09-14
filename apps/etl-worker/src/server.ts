/**
 * ETL Worker Server
 *
 * Standalone Fastify application that hosts the ETL service.
 * Provides pipeline management API and executes ETL pipelines.
 *
 * Health probes (align with k8s/helm):
 *   GET /health       — legacy combined check (compat)
 *   GET /health/live  — liveness
 *   GET /health/ready — readiness (+ persistence mode, DB probe when configured)
 *
 * Persistence (P0-05 / P0-10 / W3-C2):
 *   DATABASE_URL set  → Postgres pipeline store (fail-closed if pool unavailable)
 *   DATABASE_URL unset → in-memory (local / unit tests only; not for production)
 */
import { pathToFileURL } from 'node:url';

import {
  createPipelineRepository,
  etlPlugin,
  type PipelineRepository,
} from '@proctira/backend-etl';
import {
  readPersistencePolicyEnv,
  runReadinessProbe,
  type PersistencePolicyEnv,
  type ReadinessProbeOptions,
} from '@proctira/database';
import { initTracing, observabilityPlugin, shutdownTracing } from '@proctira/observability';
import Fastify, { type FastifyInstance } from 'fastify';

const PORT = parseInt(process.env['ETL_WORKER_PORT'] ?? '3010', 10);
const HOST = process.env['ETL_WORKER_HOST'] ?? '0.0.0.0';

const HEALTH_IGNORE = ['/health', '/health/live', '/health/ready'];

export type EtlPersistenceMode = 'postgres' | 'memory';

export interface BuildEtlWorkerOptions {
  /** Override repository (tests). Default: createPipelineRepository(). */
  repository?: PipelineRepository;
  /** Override DB probe (tests). */
  probeDatabase?: ReadinessProbeOptions['probeDatabase'];
  /** Override env read (tests). */
  env?: PersistencePolicyEnv;
  /** DB probe timeout in ms (default 3000). */
  probeTimeoutMs?: number;
}

function resolveEtlPersistenceMode(env: PersistencePolicyEnv = readPersistencePolicyEnv()): EtlPersistenceMode {
  return env.DATABASE_URL?.trim() ? 'postgres' : 'memory';
}

function readinessOptions(
  options: BuildEtlWorkerOptions,
): Pick<ReadinessProbeOptions, 'probeDatabase' | 'env' | 'probeTimeoutMs'> {
  return {
    probeDatabase: options.probeDatabase,
    env: options.env,
    probeTimeoutMs: options.probeTimeoutMs,
  };
}

/** Build the Fastify app without listening (injectable for tests). */
export async function buildEtlWorkerApp(
  options: BuildEtlWorkerOptions = {},
): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  await fastify.register(observabilityPlugin, {
    serviceName: 'etl-worker',
    ignorePaths: HEALTH_IGNORE,
  });

  const repository = options.repository ?? createPipelineRepository();
  const env = options.env ?? readPersistencePolicyEnv();
  const persistence = resolveEtlPersistenceMode(env);
  const probeOpts = readinessOptions(options);

  await fastify.register(etlPlugin, {
    repository,
    config: {
      defaultRetryPolicy: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    },
    prefix: '/api/v1/pipelines',
  });

  fastify.get('/health', async (_request, reply) => {
    const readiness = await runReadinessProbe(probeOpts);
    return reply.status(readiness.ready ? 200 : 503).send({
      status: readiness.ready ? 'ok' : 'degraded',
      service: 'etl-worker',
      persistence,
      dependencies: readiness.dependencies,
      ...(readiness.message ? { message: readiness.message } : {}),
    });
  });

  fastify.get('/health/live', (_request, reply) =>
    reply.send({ status: 'up', service: 'etl-worker' }),
  );

  fastify.get('/health/ready', async (_request, reply) => {
    const readiness = await runReadinessProbe(probeOpts);
    const body = {
      status: readiness.ready ? 'up' : 'down',
      service: 'etl-worker',
      persistence,
      dependencies: readiness.dependencies,
      ...(readiness.message ? { message: readiness.message } : {}),
      ...(readiness.latencyMs !== undefined ? { latencyMs: readiness.latencyMs } : {}),
    };

    if (!readiness.ready) {
      return reply.status(503).send(body);
    }

    return reply.status(200).send(body);
  });

  return fastify;
}

async function start() {
  // W1-OPS-13: tracer provider before listen (noop when OTLP unset).
  const tracing = initTracing({ serviceName: 'etl-worker' });
  const fastify = await buildEtlWorkerApp();

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(
      `ETL Worker listening on ${HOST}:${PORT} (persistence=${resolveEtlPersistenceMode()})`,
    );
    if (tracing.enabled) {
      fastify.log.info({ tracingMode: tracing.mode }, 'OpenTelemetry tracing export enabled');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, () => {
      void (async () => {
        fastify.log.info(`Received ${signal}, shutting down gracefully...`);
        await fastify.close();
        await shutdownTracing();
        process.exit(0);
      })();
    });
  }
}

// Auto-listen only when this file is the process entry (not when imported by tests).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void start();
}
