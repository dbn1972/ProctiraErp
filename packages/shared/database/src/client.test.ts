/**
 * PRC-M357: PrismaClient is cached per datasource URL in every environment and
 * disconnectPrisma()/closeDatabaseResources() close every cached client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const instances: Array<{ url: string | undefined; $disconnect: ReturnType<typeof vi.fn> }> = [];

vi.mock('@prisma/client', () => {
  class PrismaClient {
    url: string | undefined;
    $disconnect = vi.fn(async () => undefined);
    constructor(opts: { datasourceUrl?: string }) {
      this.url = opts.datasourceUrl;
      instances.push(this as never);
    }
  }
  return { PrismaClient, Prisma: {} };
});

const { createPrismaClient, getPrismaClient, disconnectPrisma } = await import('./client');
const { createReadReplicaClient } = await import('./read-replica');
const { closeDatabaseResources } = await import('./close-database-resources');

describe('createPrismaClient cache (PRC-M357)', () => {
  beforeEach(async () => {
    await disconnectPrisma();
    instances.length = 0;
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://app@db/primary');
    vi.stubEnv('POSTGRES_READ_REPLICA_URL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the same instance per URL in production', () => {
    const a = createPrismaClient();
    const b = createPrismaClient();
    const c = getPrismaClient();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toContain('connection_limit=10');
  });

  it('a different URL gets its own client (not silently the first DB)', () => {
    const a = createPrismaClient();
    const other = createPrismaClient({ datasourceUrl: 'postgresql://app@db/other' });
    expect(other).not.toBe(a);
    expect(createPrismaClient({ datasourceUrl: 'postgresql://app@db/other' })).toBe(other);
    expect(instances).toHaveLength(2);
  });

  it('read replica shares the primary client when no replica URL is set', () => {
    expect(createReadReplicaClient()).toBe(createPrismaClient());
    vi.stubEnv('POSTGRES_READ_REPLICA_URL', 'postgresql://app@replica/primary');
    const replica = createReadReplicaClient();
    expect(replica).not.toBe(createPrismaClient());
    expect(createReadReplicaClient()).toBe(replica);
  });

  it('closeDatabaseResources() disconnects every client', async () => {
    createPrismaClient();
    createPrismaClient({ datasourceUrl: 'postgresql://app@db/other' });
    vi.stubEnv('POSTGRES_READ_REPLICA_URL', 'postgresql://app@replica/primary');
    createReadReplicaClient();
    expect(instances).toHaveLength(3);
    await closeDatabaseResources();
    for (const i of instances) expect(i.$disconnect).toHaveBeenCalledTimes(1);
    // cache cleared: next call creates a fresh client
    createPrismaClient();
    expect(instances).toHaveLength(4);
  });
});
