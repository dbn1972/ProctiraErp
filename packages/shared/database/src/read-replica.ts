/**
 * @proctira/database - Read Replica PrismaClient factory
 *
 * Creates a read-only PrismaClient connected to the read replica.
 * Falls back to the primary if POSTGRES_READ_REPLICA_URL is not set.
 *
 * Use this client for heavy read queries (reports, dashboards, search)
 * to offload traffic from the primary database.
 */
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient, disconnectPrismaFor } from './client.js';

function replicaUrl(): string | undefined {
  return process.env['POSTGRES_READ_REPLICA_URL'] || process.env['DATABASE_URL'];
}

/**
 * Creates a read-only PrismaClient connected to the read replica.
 * Falls back to the primary if POSTGRES_READ_REPLICA_URL is not set.
 *
 * PRC-M357: delegates to the per-URL client cache, so it is a real singleton in
 * every environment and shares the primary client when no replica is set.
 */
export function createReadReplicaClient(): PrismaClient {
  return createPrismaClient({ datasourceUrl: replicaUrl() });
}

/**
 * Returns the existing read replica client or creates a new one.
 */
export function getReadReplicaClient(): PrismaClient {
  return createReadReplicaClient();
}

/**
 * Disconnects the read replica client.
 */
export async function disconnectReadReplica(): Promise<void> {
  await disconnectPrismaFor(replicaUrl());
}
