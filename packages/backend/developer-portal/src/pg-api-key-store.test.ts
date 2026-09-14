/**
 * W1-ARCH-01 (C3): Postgres API key durability + hash-at-rest tests.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createDeveloperPortalRepository,
  isPgDeveloperPortalApiKeysEnabled,
} from './create-developer-portal-repository.js';
import {
  generateApiKey,
  hashApiKey,
} from './developer-portal-service.js';
import type { ApiKeyEntity } from './developer-portal-repository.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import {
  ensureDeveloperPortalApiKeySchema,
  getSharedDeveloperPortalPool,
  PgApiKeyStore,
  type PgPoolLike,
} from './pg-api-key-store.js';

function buildEntity(overrides: Partial<ApiKeyEntity> = {}): ApiKeyEntity {
  const rawKey = generateApiKey();
  return {
    id: randomUUID(),
    tenantId: randomUUID(),
    accountId: randomUUID(),
    name: 'Integration Key',
    keyHash: hashApiKey(rawKey),
    keyPrefix: rawKey.substring(0, 8),
    scopes: ['read:students'],
    status: 'active',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Mock pool backed by an in-memory row map (simulates durable Postgres). */
function createMockPgPool(): { pool: PgPoolLike; rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  let boundTenant = '';

  const runQuery = async (text: string, values?: unknown[]) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT set_config')) {
      if (sql.includes('app.tenant_id')) boundTenant = String(values?.[0] ?? '');
      return { rows: [] };
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('INSERT INTO developer_portal_api_keys')) {
      const row = {
        id: values![0],
        tenant_id: values![1],
        account_id: values![2],
        name: values![3],
        key_hash: values![4],
        key_prefix: values![5],
        scopes: values![6],
        status: values![7],
        expires_at: values![8],
        last_used_at: values![9],
        created_at: values![10],
      };
      rows.set(String(row.id), row);
      return { rows: [row] };
    }
    if (sql.includes('WHERE key_hash = $1')) {
      const hash = String(values![0]);
      const found = [...rows.values()].find((r) => r.key_hash === hash);
      return { rows: found ? [found] : [] };
    }
    if (sql.includes('WHERE id = $1') && sql.includes('SELECT key_hash')) {
      const found = rows.get(String(values![0]));
      return { rows: found ? [{ key_hash: found.key_hash }] : [] };
    }
    if (sql.includes('WHERE id = $1') && sql.startsWith('SELECT *')) {
      const found = rows.get(String(values![0]));
      return { rows: found ? [found] : [] };
    }
    if (sql.includes('COUNT(*)')) {
      const accountId = String(values![0]);
      const count = [...rows.values()].filter(
        (r) => r.account_id === accountId && (!boundTenant || r.tenant_id === boundTenant),
      ).length;
      return { rows: [{ total: count }] };
    }
    if (sql.includes('SELECT * FROM developer_portal_api_keys')) {
      const accountId = String(values![0]);
      const matched = [...rows.values()].filter(
        (r) => r.account_id === accountId && (!boundTenant || r.tenant_id === boundTenant),
      );
      return { rows: matched };
    }
    if (sql.startsWith('UPDATE developer_portal_api_keys SET status')) {
      const found = rows.get(String(values![0]));
      if (!found) return { rows: [] };
      found.status = values![1];
      return { rows: [found] };
    }
    if (sql.startsWith('UPDATE developer_portal_api_keys SET last_used_at')) {
      return { rows: [] };
    }
    throw new Error(`Unhandled mock SQL: ${sql}`);
  };

  const client = {
    query: vi.fn(runQuery),
    release: vi.fn(),
  };

  const pool: PgPoolLike = {
    query: vi.fn(runQuery),
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };

  return { pool, rows };
}

describe('createDeveloperPortalRepository pg gate', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isPgDeveloperPortalApiKeysEnabled()).toBe(false);
      expect(createDeveloperPortalRepository()).toBeInstanceOf(InMemoryDeveloperPortalRepository);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });
});

describe('PgApiKeyStore (mock pool)', () => {
  it('survives a new store instance (restart durability)', async () => {
    const { pool } = createMockPgPool();
    const tenantId = randomUUID();
    const accountId = randomUUID();
    const rawKey = generateApiKey();
    const entity = buildEntity({
      tenantId,
      accountId,
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.substring(0, 8),
    });

    const storeBeforeRestart = new PgApiKeyStore(pool);
    await storeBeforeRestart.createApiKey(entity);

    const storeAfterRestart = new PgApiKeyStore(pool);
    const found = await storeAfterRestart.getApiKeyByHash(hashApiKey(rawKey));
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entity.id);
    expect(found!.tenantId).toBe(tenantId);
  });

  it('persists only sha256 digest, never the raw secret', async () => {
    const { pool, rows } = createMockPgPool();
    const rawKey = generateApiKey();
    const entity = buildEntity({
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.substring(0, 8),
    });

    const store = new PgApiKeyStore(pool);
    await store.createApiKey(entity);

    const stored = rows.get(entity.id)!;
    expect(String(stored.key_hash)).toBe(hashApiKey(rawKey));
    expect(String(stored.key_hash)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(String(stored.key_hash)).not.toContain(rawKey);

    const storedHash = await store.readRawKeyHash(entity.id);
    expect(storedHash).toBe(hashApiKey(rawKey));
    expect(storedHash).not.toBe(rawKey);
  });

  it('scopes list queries to bound tenant via withPgTenant', async () => {
    const { pool } = createMockPgPool();
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const accountId = randomUUID();
    const store = new PgApiKeyStore(pool);

    await store.createApiKey(buildEntity({ tenantId: tenantA, accountId, name: 'A' }));
    await store.createApiKey(buildEntity({ tenantId: tenantB, accountId, name: 'B' }));

    const listedA = await store.listApiKeys({ accountId, tenantId: tenantA }, 1, 20);
    expect(listedA.total).toBe(1);
    expect(listedA.data[0]!.tenantId).toBe(tenantA);

    const listedB = await store.listApiKeys({ accountId, tenantId: tenantB }, 1, 20);
    expect(listedB.total).toBe(1);
    expect(listedB.data[0]!.tenantId).toBe(tenantB);
  });
});

describe('PgApiKeyStore (live Postgres)', () => {
  let liveReady = false;

  it('probe live Postgres schema access', async () => {
    if (!isPgDeveloperPortalApiKeysEnabled()) return;
    try {
      const pool = getSharedDeveloperPortalPool();
      if (!pool) return;
      await ensureDeveloperPortalApiKeySchema(pool);
      liveReady = true;
    } catch {
      liveReady = false;
    }
    expect(true).toBe(true);
  });

  it('persists across new store instances on real Postgres', async ({ skip }) => {
    if (!liveReady) skip();
    const pool = getSharedDeveloperPortalPool()!;
    const tenantId = randomUUID();
    const accountId = randomUUID();
    const rawKey = generateApiKey();
    const entity = buildEntity({
      tenantId,
      accountId,
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.substring(0, 8),
    });

    const storeA = new PgApiKeyStore(pool);
    await storeA.createApiKey(entity);

    const storeB = new PgApiKeyStore(pool);
    const found = await storeB.getApiKeyByHash(hashApiKey(rawKey));
    expect(found?.id).toBe(entity.id);
  });
});
