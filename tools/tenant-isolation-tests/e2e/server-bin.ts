/**
 * Entry point for the E2E Fastify server, executed via tsx by Playwright's
 * `webServer` config. Running it as a separate process keeps Playwright's
 * own loader out of the workspace's TS source graph and lets the real
 * `@proctira/tenant` plugin load through tsx exactly as it would in any
 * other dev/test scenario.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */

import { startIsolationServer } from './server.js';

async function main(): Promise<void> {
  const { app, baseUrl } = await startIsolationServer();
  // eslint-disable-next-line no-console
  console.log(`[tenant-isolation-e2e] server listening at ${baseUrl}`);

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[tenant-isolation-e2e] received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[tenant-isolation-e2e] failed to start:', error);
  process.exit(1);
});
