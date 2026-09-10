/**
 * Standalone server for the Student service.
 *
 * This entry point boots the student Fastify plugin as an independent
 * microservice. Used when deploying backend services individually rather
 * than through the unified API gateway.
 *
 * All configuration is read from environment variables:
 *   PORT          - HTTP port (default: 3021)
 *   HOST          - Bind address (default: 0.0.0.0)
 *   LOG_LEVEL     - Pino log level (default: info)
 *   DATABASE_URL  - PostgreSQL connection string
 *   REDIS_URL     - Redis connection string
 *   KAFKA_BROKERS - Comma-separated Kafka broker list
 *   RABBITMQ_URL  - RabbitMQ connection string
 *   JWT_SECRET    - JWT verification secret
 */
import { observabilityPlugin } from '@proctira/observability';
import Fastify from 'fastify';

import { createStudentRepository } from './repository-factory.js';
import { studentPlugin } from './student-plugin.js';

const PORT = parseInt(process.env['PORT'] || '3021', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const SERVICE_NAME = 'student';

async function start() {
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: process.env['NODE_ENV'] === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Prometheus metrics + GET /metrics (G-725): same plugin the gateway uses so
  // standalone deployments are scraped by infra/observability/prometheus.yml.
  await app.register(observabilityPlugin, {
    serviceName: SERVICE_NAME,
    ignorePaths: ['/health', '/ready'],
  });

  // Health check endpoint (liveness)
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'healthy',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env['npm_package_version'] || '0.1.0',
    });
  });

  // Readiness check
  app.get('/ready', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ready',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    });
  });

  // Register the student domain plugin with repository
  // Selects Prisma (+ optional Redis cache) when DATABASE_URL is configured,
  // otherwise an in-memory store for local development.
  const repository = createStudentRepository();
  app.log.info({ repository: repository.constructor.name }, 'Student repository initialized');
  await app.register(studentPlugin, {
    prefix: '/students',
    repository,
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`${SERVICE_NAME} service listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, () => {
      void (async () => {
        app.log.info(`Received ${signal}, shutting down gracefully...`);
        await app.close();
        process.exit(0);
      })();
    });
  }
}

void start();
