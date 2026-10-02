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
 *   JWT_SECRET    - JWT verification secret (required, >= 32 chars; HS256)
 *   JWT_ISSUER    - Expected `iss` claim (optional)
 *   JWT_AUDIENCE  - Expected `aud` claim (optional)
 *
 * PRC-L502: every domain route requires a verified gateway JWT; tenant context
 * comes only from the verified token. /ready probes the database (503 when
 * down). In production the service refuses to boot without a legal-hold gate,
 * which this standalone entry does not wire — use the gateway in production.
 */
import { registerGracefulShutdown } from '@proctira/common';
import { closeDatabaseResources } from '@proctira/database';
import { observabilityPlugin } from '@proctira/observability';

import { createStudentRepository } from './repository-factory.js';
import { buildStandaloneStudentApp, STANDALONE_SERVICE_NAME } from './standalone-app.js';

const PORT = parseInt(process.env['PORT'] || '3021', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const SERVICE_NAME = STANDALONE_SERVICE_NAME;

async function start() {
  // Selects Prisma (+ optional Redis cache) when DATABASE_URL is configured,
  // otherwise an in-memory store for local development.
  const repository = createStudentRepository();
  const app = await buildStandaloneStudentApp({
    repository,
    jwt: {
      secret: process.env['JWT_SECRET'] ?? '',
      issuer: process.env['JWT_ISSUER'] || undefined,
      audience: process.env['JWT_AUDIENCE'] || undefined,
    },
    logger: {
      level: LOG_LEVEL,
      transport: process.env['NODE_ENV'] === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    // Prometheus metrics + GET /metrics (G-725): same plugin the gateway uses so
    // standalone deployments are scraped by infra/observability/prometheus.yml.
    beforeDomain: async (instance) => {
      await instance.register(observabilityPlugin, {
        serviceName: SERVICE_NAME,
        ignorePaths: ['/health', '/ready'],
      });
    },
  });
  app.log.info({ repository: repository.constructor.name }, 'Student repository initialized');
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`${SERVICE_NAME} service listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // W1-ARCH-07: ordered close — HTTP (plugin onClose) → DB pools → exit.
  registerGracefulShutdown({
    logger: {
      info: (obj, msg) => app.log.info(obj, msg),
      warn: (obj, msg) => app.log.warn(obj, msg),
      error: (obj, msg) => app.log.error(obj, msg),
    },
    steps: [
      {
        name: 'http',
        close: async () => {
          await app.close();
        },
      },
      {
        name: 'database',
        close: () => closeDatabaseResources(),
      },
    ],
  });
}

void start();
