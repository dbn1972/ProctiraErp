/**
 * @proctira/database - Singleton PrismaClient factory
 *
 * Provides a single PrismaClient instance per process to avoid
 * connection pool exhaustion in serverless/hot-reload environments.
 */
import { PrismaClient } from '@prisma/client';

export type { PrismaClient } from '@prisma/client';

/**
 * PRC-M357: clients are cached per resolved datasource URL in ALL environments
 * (the old guard only cached outside production, so every call in production
 * opened a new 10-connection pool). Stored on globalThis so dev hot-reloads
 * reuse them too.
 */
const globalForPrisma = globalThis as unknown as {
  prismaClients: Map<string, PrismaClient> | undefined;
};

function clientCache(): Map<string, PrismaClient> {
  if (!globalForPrisma.prismaClients) {
    globalForPrisma.prismaClients = new Map();
  }
  return globalForPrisma.prismaClients;
}

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
 * Creates or returns the PrismaClient for the (resolved) datasource URL.
 * One client - one pool - per URL per process, in every environment.
 */
export function createPrismaClient(options?: {
  datasourceUrl?: string;
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
}): PrismaClient {
  // Apply connection pool configuration to the datasource URL
  const datasourceUrl = withPoolConfig(options?.datasourceUrl ?? process.env['DATABASE_URL']);
  const key = datasourceUrl ?? '';
  const cache = clientCache();
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const client = new PrismaClient({
    datasourceUrl,
    log:
      options?.log ??
      (process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error']),
  });

  cache.set(key, client);
  return client;
}

/**
 * Returns the existing singleton PrismaClient or creates a new one.
 */
export function getPrismaClient(): PrismaClient {
  return createPrismaClient();
}

/**
 * Disconnects the client for one datasource URL (as passed to createPrismaClient).
 */
export async function disconnectPrismaFor(datasourceUrl: string | undefined): Promise<void> {
  const key = withPoolConfig(datasourceUrl) ?? '';
  const cache = clientCache();
  const client = cache.get(key);
  if (client) {
    cache.delete(key);
    await client.$disconnect();
  }
}

/**
 * Disconnects EVERY cached PrismaClient (graceful shutdown / test cleanup).
 */
export async function disconnectPrisma(): Promise<void> {
  const cache = clientCache();
  const clients = [...cache.values()];
  cache.clear();
  await Promise.all(clients.map((c) => c.$disconnect()));
}
