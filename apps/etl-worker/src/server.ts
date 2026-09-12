/**
 * ETL Worker Server
 *
 * Standalone Fastify application that hosts the ETL service.
 * Provides pipeline management API and executes ETL pipelines.
 *
 * Health probes (align with k8s/helm):
 *   GET /health       — legacy combined check (compat)
 *   GET /health/live  — liveness
 *   GET /health/ready — readiness (+ persistence mode)
 *
 * Persistence (P0-05 / P0-10):
 *   DATABASE_URL set  → Postgres pipeline store (fail-closed if pool unavailable)
 *   DATABASE_URL unset → in-memory (local / unit tests only; not for production)
 */
import { pathToFileURL } from 'node:url';

import {
  createPipelineRepository,
  etlPlugin,
  type PipelineRepository,
} from '@proctira/backend-etl';
import { observabilityPlugin } from '@proctira/observability';
import Fastify, { type FastifyInstance } from 'fastify';

const PORT = parseInt(process.env['ETL_WORKER_PORT'] ?? '3010', 10);
const HOST = process.env['ETL_WORKER_HOST'] ?? '0.0.0.0';

const HEALTH_IGNORE = ['/health', '/health/live', '/health/ready'];

export type EtlPersistenceMode = 'postgres' | 'memory';

export interface BuildEtlWorkerOptions {
  /** Override repository (tests). Default: createPipelineRepository(). */
  repository?: PipelineRepository;
}

function resolvePersistenceMode(): EtlPersistenceMode {
  return process.env['DATABASE_URL']?.trim() ? 'postgres' : 'memory';
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
  const persistence = resolvePersistenceMode();

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

  fastify.get('/health', (_request, reply) =>
    reply.send({ status: 'ok', service: 'etl-worker', persistence }),
  );

  fastify.get('/health/live', (_request, reply) =>
    reply.send({ status: 'up', service: 'etl-worker' }),
  );

  fastify.get('/health/ready', (_request, reply) =>
    reply.status(200).send({
      status: 'up',
      service: 'etl-worker',
      persistence,
    }),
  );

  return fastify;
}

async function start() {
  const fastify = await buildEtlWorkerApp();

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(
      `ETL Worker listening on ${HOST}:${PORT} (persistence=${resolvePersistenceMode()})`,
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Auto-listen only when this file is the process entry (not when imported by tests).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void start();
}
