/**
 * Standalone server for the Examination service.
 *
 * This entry point boots the examination Fastify plugin as an independent
 * microservice. Used when deploying backend services individually rather
 * than through the unified API gateway.
 *
 * All configuration is read from environment variables:
 *   PORT          - HTTP port (default: 3025)
 *   HOST          - Bind address (default: 0.0.0.0)
 *   LOG_LEVEL     - Pino log level (default: info)
 *   DATABASE_URL  - PostgreSQL connection string
 *   REDIS_URL     - Redis connection string
 *   KAFKA_BROKERS - Comma-separated Kafka broker list
 *   RABBITMQ_URL  - RabbitMQ connection string
 *   JWT_SECRET    - JWT verification secret
 */
import Fastify from 'fastify';
import { examinationPlugin } from './examination-plugin.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { InMemoryResultRepository } from './in-memory-result-repository.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';

const PORT = parseInt(process.env['PORT'] || '3025', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const SERVICE_NAME = 'examination';

async function start() {
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport:
        process.env['NODE_ENV'] === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
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

  // Register the examination domain plugin with repositories
  await app.register(examinationPlugin, {
    prefix: '/examinations',
    repository: new InMemoryExaminationRepository(),
    resultRepository: new InMemoryResultRepository(),
    documentRepository: new InMemoryDocumentRepository(),
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
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }
}

start();
