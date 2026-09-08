/**
 * @proctira/database - Singleton PrismaClient factory
 *
 * Provides a single PrismaClient instance per process to avoid
 * connection pool exhaustion in serverless/hot-reload environments.
 */
import { PrismaClient } from '@prisma/client';

export type { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Appends connection pool parameters to a DATABASE_URL if not already present.
 *
 * Why: Prisma's default pool size is 1 connection per CPU core, which is often
 * too low for multi-tenant workloads. Explicit pool configuration prevents
 * connection exhaustion under load and sets a reasonable timeout so requests
 * fail fast rather than queuing indefinitely.
 *
 * - connection_limit=10: Allows up to 10 concurrent connections per process
 * - pool_timeout=30: Fails after 30s if no connection is available
 */
function withPoolConfig(url: string | undefined): string | undefined {
  if (!url) return url;

  // Don't modify if pool params are already set
  if (url.includes('connection_limit') || url.includes('pool_timeout')) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=10&pool_timeout=30`;
}

/**
 * Creates or returns the singleton PrismaClient instance.
 * In development, the client is stored on `globalThis` to survive
 * hot-module reloads without leaking connections.
 */
export function createPrismaClient(options?: {
  datasourceUrl?: string;
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
}): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  // Apply connection pool configuration to the datasource URL
  const datasourceUrl = withPoolConfig(options?.datasourceUrl ?? process.env['DATABASE_URL']);

  const client = new PrismaClient({
    datasourceUrl,
    log:
      options?.log ??
      (process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error']),
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}

/**
 * Returns the existing singleton PrismaClient or creates a new one.
 */
export function getPrismaClient(): PrismaClient {
  return createPrismaClient();
}

/**
 * Disconnects the singleton PrismaClient.
 * Useful for graceful shutdown and test cleanup.
 */
export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect();
    globalForPrisma.prisma = undefined;
  }
}
