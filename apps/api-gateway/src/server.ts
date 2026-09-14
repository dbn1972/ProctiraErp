/**
 * API Gateway Server Entry Point
 *
 * Starts the Fastify API Gateway server.
 */

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

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, () => {
      void (async () => {
        app.log.info(`Received ${signal}, shutting down gracefully...`);
        await app.close();
        await shutdownTracing();
        process.exit(0);
      })();
    });
  }
}

main().catch((err) => {
  console.error('Failed to start API Gateway:', err);
  process.exit(1);
});
