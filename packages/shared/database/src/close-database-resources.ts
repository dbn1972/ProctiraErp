/**
 * W1-ARCH-07 — close all process-scoped database resources.
 *
 * Extends existing helpers (`disconnectPrisma`, `disconnectReadReplica`,
 * `closeSharedPgPools`) into one ordered call for graceful shutdown.
 */
import { disconnectPrisma } from './client.js';
import { closeSharedPgPools } from './pg-pool.js';
import { disconnectReadReplica } from './read-replica.js';

/**
 * Disconnect Prisma primary + read-replica singletons, then end shared node-pg
 * pools. Safe to call when none were opened (no-ops).
 */
export async function closeDatabaseResources(): Promise<void> {
  await disconnectPrisma();
  await disconnectReadReplica();
  await closeSharedPgPools();
}
