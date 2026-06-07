/**
 * Standalone server for the Notification service.
 *
 * This entry point boots the notification Fastify plugin as an independent
 * microservice. Used when deploying backend services individually rather
 * than through the unified API gateway.
 *
 * All configuration is read from environment variables:
 *   PORT          - HTTP port (default: 3027)
 *   HOST          - Bind address (default: 0.0.0.0)
 *   LOG_LEVEL     - Pino log level (default: info)
 *   DATABASE_URL  - PostgreSQL connection string
 *   REDIS_URL     - Redis connection string
 *   KAFKA_BROKERS - Comma-separated Kafka broker list
 *   RABBITMQ_URL  - RabbitMQ connection string
 *   JWT_SECRET    - JWT verification secret
 *   SMTP_HOST     - SMTP server host
 *   SMTP_PORT     - SMTP server port
 *   SMTP_USER     - SMTP username
 *   SMTP_PASSWORD - SMTP password
 *   SMTP_FROM     - Default sender email
 *   FCM_PROJECT_ID - Firebase Cloud Messaging project ID
 */
import Fastify from 'fastify';
import { notificationPlugin } from './notification-plugin.js';
import { InMemoryNotificationRepository } from './in-memory-repository.js';

const PORT = parseInt(process.env['PORT'] || '3027', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const SERVICE_NAME = 'notification';

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

  // Register the notification domain plugin with repository
  const repository = new InMemoryNotificationRepository();
  await app.register(notificationPlugin, {
    prefix: '/notifications',
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
