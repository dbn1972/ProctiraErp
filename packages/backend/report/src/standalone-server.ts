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
import { observabilityPlugin } from '@proctira/observability';
import Fastify from 'fastify';

import { InMemoryReportRepository } from './in-memory-repository.js';
import { reportPlugin } from './report-plugin.js';
import type { ReportDataSource } from './report-repository.js';

const PORT = parseInt(process.env['PORT'] || '3028', 10);
const HOST = process.env['HOST'] || '0.0.0.0';
const LOG_LEVEL = process.env['LOG_LEVEL'] || 'info';
const SERVICE_NAME = 'report';

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

  // Register the report domain plugin with repository
  const repository = new InMemoryReportRepository();
  // The standalone binary has no domain data source of its own (the gateway
  // wires PG-backed aggregates); until one is injected every report resolves
  // to an empty, well-typed result rather than crashing on a missing method.
  const emptyDataSource: ReportDataSource = {
    async fetchData(tenantId, reportType) {
      app.log.warn(
        { tenantId, reportType },
        'report standalone: no data source configured — returning empty result set',
      );
      return { rows: [], columns: [], totalRows: 0 };
    },
  };
  await app.register(reportPlugin, {
    prefix: '/reports',
    repository,
    dataSource: emptyDataSource,
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
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      void app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          app.log.error(err);
          process.exit(1);
        },
      );
    });
  }
}

start();
