/**
 * Standalone server for the Report Engine service.
 *
 * This entry point boots the report Fastify plugin as an independent
 * microservice. Used when deploying backend services individually rather
 * than through the unified API gateway.
 *
 * All configuration is read from environment variables:
 *   PORT          - HTTP port (default: 3028)
 *   HOST          - Bind address (default: 0.0.0.0)
 *   LOG_LEVEL     - Pino log level (default: info)
 *   DATABASE_URL  - PostgreSQL connection string
 *   REDIS_URL     - Redis connection string
 *   RABBITMQ_URL  - RabbitMQ connection string
 *   JWT_SECRET    - JWT verification secret
 *   S3_ENDPOINT   - S3-compatible storage endpoint
 *   S3_ACCESS_KEY - S3 access key
 *   S3_SECRET_KEY - S3 secret key
 *   S3_BUCKET     - S3 bucket name
 */
import Fastify from 'fastify';
import { reportPlugin } from './report-plugin.js';
import { createReportRepository } from './repository-factory.js';

const PORT = parseInt(process.env['PORT'] || '3028', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const SERVICE_NAME = 'report';

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

  // Selects Prisma when DATABASE_URL is set, otherwise in-memory for local/dev.
  const repository = createReportRepository();
  app.log.info(
    { repository: repository.constructor.name },
    'Report repository initialized',
  );
  await app.register(reportPlugin as any, {
    prefix: '/reports',
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
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      await app.close();
      process.exit(0);
    });
  }
}

start();
