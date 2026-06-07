/**
 * @proctira/database - Read Replica PrismaClient factory
 *
 * Creates a read-only PrismaClient connected to the read replica.
 * Falls back to the primary if POSTGRES_READ_REPLICA_URL is not set.
 *
 * Use this client for heavy read queries (reports, dashboards, search)
 * to offload traffic from the primary database.
 */
import { PrismaClient } from '@prisma/client';

/**
 * Appends connection pool parameters to a database URL if not already present.
 * Mirrors the pool config from the primary client for consistency.
 */
function withPoolConfig(url: string | undefined): string | undefined {
  if (!url) return url;

  if (url.includes('connection_limit') || url.includes('pool_timeout')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=10&pool_timeout=30`;
}

const globalForReadReplica = globalThis as unknown as {
  prismaReadReplica: PrismaClient | undefined;
};

/**
 * Creates a read-only PrismaClient connected to the read replica.
 * Falls back to the primary if POSTGRES_READ_REPLICA_URL is not set.
 *
 * The client is stored as a singleton to avoid connection pool exhaustion.
 */
export function createReadReplicaClient(): PrismaClient {
  if (globalForReadReplica.prismaReadReplica) {
    return globalForReadReplica.prismaReadReplica;
  }

  const replicaUrl = process.env['POSTGRES_READ_REPLICA_URL'] || process.env['DATABASE_URL'];
  const datasourceUrl = withPoolConfig(replicaUrl);

  const client = new PrismaClient({
    datasourceUrl,
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForReadReplica.prismaReadReplica = client;
  }

  return client;
}

/**
 * Returns the existing read replica PrismaClient singleton or creates a new one.
 */
export function getReadReplicaClient(): PrismaClient {
  return createReadReplicaClient();
}

/**
 * Disconnects the read replica PrismaClient.
 * Useful for graceful shutdown and test cleanup.
 */
export async function disconnectReadReplica(): Promise<void> {
  if (globalForReadReplica.prismaReadReplica) {
    await globalForReadReplica.prismaReadReplica.$disconnect();
    globalForReadReplica.prismaReadReplica = undefined;
  }
}
