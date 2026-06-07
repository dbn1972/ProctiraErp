/**
 * ETL Worker Server
 *
 * Standalone Fastify application that hosts the ETL service.
 * Provides pipeline management API and executes ETL pipelines.
 */
import Fastify from 'fastify';
import { etlPlugin } from '@proctira/backend-etl/plugin';
import { InMemoryPipelineRepository } from '@proctira/backend-etl';
import { observabilityPlugin } from '@proctira/observability';

const PORT = parseInt(process.env['ETL_WORKER_PORT'] ?? '3010', 10);
const HOST = process.env['ETL_WORKER_HOST'] ?? '0.0.0.0';

async function start() {
  const fastify = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  // Register Prometheus metrics + /metrics endpoint
  await fastify.register(observabilityPlugin, {
    serviceName: 'etl-worker',
    ignorePaths: ['/health'],
  });

  // Register ETL plugin with in-memory repository (swap for PostgreSQL in production)
  await fastify.register(etlPlugin, {
    repository: new InMemoryPipelineRepository(),
    config: {
      defaultRetryPolicy: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    },
    prefix: '/api/v1/pipelines',
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'etl-worker' };
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`ETL Worker listening on ${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
