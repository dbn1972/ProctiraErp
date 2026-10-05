/**
 * Standalone server for the Assessment service.
 *
 * This entry point boots the assessment Fastify plugin as an independent
 * microservice. Used when deploying backend services individually rather
 * than through the unified API gateway.
 *
 * All configuration is read from environment variables:
 *   PORT          - HTTP port (default: 3023)
 *   HOST          - Bind address (default: 0.0.0.0)
 *   LOG_LEVEL     - Pino log level (default: info)
 *   DATABASE_URL  - PostgreSQL connection string
 *   REDIS_URL     - Redis connection string
 *   KAFKA_BROKERS - Comma-separated Kafka broker list
 *   JWT_SECRET    - JWT verification secret (>= 32 chars, required)
 *   JWT_ISSUER / JWT_AUDIENCE - optional claim checks
 */
import { registerGracefulShutdown } from '@proctira/common';
import { closeDatabaseResources } from '@proctira/database';
import { observabilityPlugin } from '@proctira/observability';

import { buildStandaloneAssessmentApp, STANDALONE_SERVICE_NAME } from './standalone-app.js';

const PORT = parseInt(process.env['PORT'] || '3023', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const SERVICE_NAME = STANDALONE_SERVICE_NAME;

async function start() {
  // PRC-M167: repositories come from the shared factories (DATABASE_URL selects
  // Postgres with one PrismaClient per process); every domain route needs a
  // verified gateway JWT.
  const app = await buildStandaloneAssessmentApp({
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

start();
