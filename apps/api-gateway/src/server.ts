/**
 * API Gateway Server Entry Point
 *
 * Starts the Fastify API Gateway server.
 */

import { registerGracefulShutdown } from '@proctira/common';
import { closeDatabaseResources } from '@proctira/database';
import { initTracing, shutdownTracing } from '@proctira/observability';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main() {
  // W1-OPS-13: tracer provider + HTTP instrumentation before listen.
  // No-op when OTEL_EXPORTER_OTLP_* unset (local/dev fail-safe).
  const tracing = initTracing({ serviceName: 'api-gateway' });

  const config = loadConfig();
  const app = await buildApp({ config });

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`🚀 API Gateway running at http://${config.host}:${config.port}`);
    console.log(`📚 API Docs available at http://${config.host}:${config.port}/docs`);
    if (tracing.enabled) {
      app.log.info({ tracingMode: tracing.mode }, 'OpenTelemetry tracing export enabled');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // W1-ARCH-07: ordered close — HTTP (queues/timers via onClose) → DB → tracing.
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
      {
        name: 'tracing',
        close: () => shutdownTracing(),
      },
    ],
  });
}

main().catch((err) => {
  console.error('Failed to start API Gateway:', err);
  process.exit(1);
});
