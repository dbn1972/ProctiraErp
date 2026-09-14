/**
 * W1-ARCH-01 COMPLETE: durable developer-portal state + production refusal.
 */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPersistenceWarnings } from '@proctira/database';

import {
  createDeveloperPortalRepository,
  isPgDeveloperPortalEnabled,
  resetDeveloperPortalRepositoryForTests,
} from './create-developer-portal-repository.js';
import { HybridDeveloperPortalRepository } from './hybrid-repository.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import type {
  DeveloperAccountEntity,
  WebhookDeliveryEntity,
  WebhookEntity,
} from './developer-portal-repository.js';
import {
  generateApiKey,
  hashApiKey,
} from './developer-portal-service.js';
import type { PgPoolLike } from './pg-api-key-store.js';
import { PgApiKeyStore } from './pg-api-key-store.js';
import {
  PgDeveloperPortalDurableStore,
  resetDeveloperPortalDurableSchemaMemoForTests,
} from './pg-durable-store.js';

function sha256Digest(raw: string): string {
  return `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
}

function buildAccount(overrides: Partial<DeveloperAccountEntity> = {}): DeveloperAccountEntity {
  const now = new Date();
  return {
    id: randomUUID(),
    name: 'Acme Dev',
    email: `dev-${randomUUID()}@example.com`,
    organization: 'Acme',
    website: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildWebhook(
  tenantId: string,
  accountId: string,
  overrides: Partial<WebhookEntity> = {},
): WebhookEntity {
  const now = new Date();
  const rawSecret = `whsec_${generateApiKey()}`;
  return {
    id: randomUUID(),
    tenantId,
    accountId,
    url: 'https://example.com/hooks',
    events: ['student.created'],
    secretHash: sha256Digest(rawSecret),
    description: 'test',
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Mock pool backed by in-memory row maps (simulates durable Postgres). */
function createMockPgPool(): {
  pool: PgPoolLike;
  accounts: Map<string, Record<string, unknown>>;
  webhooks: Map<string, Record<string, unknown>>;
  deliveries: Map<string, Record<string, unknown>>;
  apiKeys: Map<string, Record<string, unknown>>;
} {
  const accounts = new Map<string, Record<string, unknown>>();
  const webhooks = new Map<string, Record<string, unknown>>();
  const deliveries = new Map<string, Record<string, unknown>>();
  const apiKeys = new Map<string, Record<string, unknown>>();
  let boundTenant = '';
  let platformAdmin = false;

  const runQuery = async (text: string, values?: unknown[]) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT set_config')) {
      if (sql.includes('app.tenant_id')) boundTenant = String(values?.[0] ?? '');
      if (sql.includes('app.platform_admin')) platformAdmin = String(values?.[0] ?? '') === '1';
      return { rows: [], rowCount: 0 };
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    // Accounts
    if (sql.startsWith('INSERT INTO developer_portal_accounts')) {
      const row = {
        id: values![0],
        name: values![1],
        email: values![2],
        organization: values![3],
        website: values![4],
        status: values![5],
        created_at: values![6],
        updated_at: values![7],
      };
      accounts.set(String(row.id), row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM developer_portal_accounts WHERE id = $1')) {
      const found = accounts.get(String(values![0]));
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('FROM developer_portal_accounts WHERE lower(email)')) {
      const email = String(values![0]).toLowerCase();
      const found = [...accounts.values()].find((r) => String(r.email).toLowerCase() === email);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE developer_portal_accounts')) {
      const found = accounts.get(String(values![0]));
      if (!found) return { rows: [], rowCount: 0 };
      found.name = values![1];
      found.organization = values![2];
      found.website = values![3];
      found.status = values![4];
      found.updated_at = values![5];
      return { rows: [found], rowCount: 1 };
    }

    // Webhooks
    if (sql.startsWith('INSERT INTO developer_portal_webhooks')) {
      const row = {
        id: values![0],
        tenant_id: values![1],
        account_id: values![2],
        url: values![3],
        events: values![4],
        secret_hash: values![5],
        description: values![6],
        active: values![7],
        created_at: values![8],
        updated_at: values![9],
      };
      webhooks.set(String(row.id), row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM developer_portal_webhooks WHERE id = $1') && sql.startsWith('SELECT *')) {
      const found = webhooks.get(String(values![0]));
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('SELECT secret_hash FROM developer_portal_webhooks')) {
      const found = webhooks.get(String(values![0]));
      return {
        rows: found ? [{ secret_hash: found.secret_hash }] : [],
        rowCount: found ? 1 : 0,
      };
    }
    if (sql.includes('COUNT(*)') && sql.includes('developer_portal_webhooks')) {
      const accountId = String(values![0]);
      const count = [...webhooks.values()].filter(
        (r) => r.account_id === accountId && (!boundTenant || r.tenant_id === boundTenant),
      ).length;
      return { rows: [{ total: count }], rowCount: 1 };
    }
    if (sql.includes('SELECT * FROM developer_portal_webhooks')) {
      const accountId = String(values![0]);
      const matched = [...webhooks.values()].filter(
        (r) => r.account_id === accountId && (!boundTenant || r.tenant_id === boundTenant),
      );
      return { rows: matched, rowCount: matched.length };
    }
    if (sql.startsWith('UPDATE developer_portal_webhooks')) {
      const found = webhooks.get(String(values![0]));
      if (!found) return { rows: [], rowCount: 0 };
      found.url = values![1];
      found.events = values![2];
      found.secret_hash = values![3];
      found.description = values![4];
      found.active = values![5];
      found.updated_at = values![6];
      return { rows: [found], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM developer_portal_webhooks')) {
      const ok = webhooks.delete(String(values![0]));
      return { rows: [], rowCount: ok ? 1 : 0 };
    }

    // Deliveries
    if (sql.startsWith('INSERT INTO developer_portal_webhook_deliveries')) {
      const row = {
        id: values![0],
        tenant_id: values![1],
        webhook_id: values![2],
        event: values![3],
        payload: values![4],
        status: values![5],
        http_status: values![6],
        attempts: values![7],
        last_attempt_at: values![8],
        next_retry_at: values![9],
        created_at: values![10],
      };
      deliveries.set(String(row.id), row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('FROM developer_portal_webhook_deliveries WHERE id = $1')) {
      const found = deliveries.get(String(values![0]));
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('COUNT(*)') && sql.includes('developer_portal_webhook_deliveries')) {
      const webhookId = String(values![0]);
      const count = [...deliveries.values()].filter(
        (r) => r.webhook_id === webhookId && (!boundTenant || r.tenant_id === boundTenant),
      ).length;
      return { rows: [{ total: count }], rowCount: 1 };
    }
    if (sql.includes('SELECT * FROM developer_portal_webhook_deliveries')) {
      const webhookId = String(values![0]);
      const matched = [...deliveries.values()].filter(
        (r) => r.webhook_id === webhookId && (!boundTenant || r.tenant_id === boundTenant),
      );
      return { rows: matched, rowCount: matched.length };
    }
    if (sql.startsWith('UPDATE developer_portal_webhook_deliveries')) {
      const found = deliveries.get(String(values![0]));
      if (!found) return { rows: [], rowCount: 0 };
      found.status = values![1];
      found.http_status = values![2];
      found.attempts = values![3];
      found.last_attempt_at = values![4];
      found.next_retry_at = values![5];
      return { rows: [found], rowCount: 1 };
    }

    // API keys (reuse from prior tests)
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
      apiKeys.set(String(row.id), row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes('WHERE key_hash = $1') && sql.includes('developer_portal_api_keys')) {
      const hash = String(values![0]);
      const found = [...apiKeys.values()].find((r) => r.key_hash === hash);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (sql.includes('WHERE id = $1') && sql.includes('SELECT * FROM developer_portal_api_keys')) {
      const found = apiKeys.get(String(values![0]));
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }

    void platformAdmin;
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

  return { pool, accounts, webhooks, deliveries, apiKeys };
}

describe('createDeveloperPortalRepository fail-closed', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    resetPersistenceWarnings();
    resetDeveloperPortalRepositoryForTests();
    resetDeveloperPortalDurableSchemaMemoForTests();
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    resetPersistenceWarnings();
    resetDeveloperPortalRepositoryForTests();
  });

  it('falls back to in-memory when DATABASE_URL is unset (non-production)', () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'test';
    expect(isPgDeveloperPortalEnabled()).toBe(false);
    expect(createDeveloperPortalRepository()).toBeInstanceOf(InMemoryDeveloperPortalRepository);
  });

  it('refuses memory-only fallback when NODE_ENV=production and DATABASE_URL unset', () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'production';
    expect(() => createDeveloperPortalRepository()).toThrow(
      /in-memory store is not allowed when NODE_ENV=production|refusing in-memory/,
    );
  });

  it('refuses memory when DATABASE_URL is set but Postgres pool is unavailable', async () => {
    process.env.DATABASE_URL = 'postgres://example.invalid/proctira';
    process.env.NODE_ENV = 'test';
    const apiKeyStore = await import('./pg-api-key-store.js');
    const spy = vi.spyOn(apiKeyStore, 'getSharedDeveloperPortalPool').mockReturnValue(null);
    try {
      expect(() => createDeveloperPortalRepository()).toThrow(
        /DATABASE_URL is set but Postgres repository is unavailable|refusing in-memory/,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe('PgDeveloperPortalDurableStore (mock pool)', () => {
  it('persists accounts/webhooks/deliveries across new store instances', async () => {
    const { pool } = createMockPgPool();
    const tenantId = randomUUID();
    const account = buildAccount();
    const webhook = buildWebhook(tenantId, account.id);
    const delivery: WebhookDeliveryEntity = {
      id: randomUUID(),
      webhookId: webhook.id,
      event: 'student.created',
      payload: { studentId: 's1' },
      status: 'pending',
      httpStatus: null,
      attempts: 0,
      lastAttemptAt: null,
      nextRetryAt: new Date(),
      createdAt: new Date(),
    };

    const before = new PgDeveloperPortalDurableStore(pool);
    await before.createAccount(account);
    await before.createWebhook(webhook);
    await before.createDelivery(delivery);

    const after = new PgDeveloperPortalDurableStore(pool);
    expect((await after.getAccountById(account.id))?.email).toBe(account.email);
    expect((await after.getWebhookById(webhook.id))?.id).toBe(webhook.id);
    expect((await after.getDeliveryById(delivery.id))?.event).toBe('student.created');
  });

  it('persists only webhook secret digest, never the raw secret', async () => {
    const { pool, webhooks } = createMockPgPool();
    const rawSecret = `whsec_${generateApiKey()}`;
    const digest = sha256Digest(rawSecret);
    const webhook = buildWebhook(randomUUID(), randomUUID(), { secretHash: digest });

    const store = new PgDeveloperPortalDurableStore(pool);
    await store.createWebhook(webhook);

    const stored = webhooks.get(webhook.id)!;
    expect(String(stored.secret_hash)).toBe(digest);
    expect(String(stored.secret_hash)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(String(stored.secret_hash)).not.toContain(rawSecret);

    const readBack = await store.readRawWebhookSecretHash(webhook.id);
    expect(readBack).toBe(digest);
    expect(readBack).not.toBe(rawSecret);
  });

  it('hybrid routes durable entities to Postgres stores', async () => {
    const { pool } = createMockPgPool();
    const hybrid = new HybridDeveloperPortalRepository(
      new PgApiKeyStore(pool),
      new PgDeveloperPortalDurableStore(pool),
    );
    const account = buildAccount();
    await hybrid.createAccount(account);
    expect((await hybrid.getAccountById(account.id))?.id).toBe(account.id);

    const rawKey = generateApiKey();
    const key = {
      id: randomUUID(),
      tenantId: randomUUID(),
      accountId: account.id,
      name: 'k',
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.substring(0, 8),
      scopes: ['read:students'],
      status: 'active' as const,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    };
    await hybrid.createApiKey(key);
    expect((await hybrid.getApiKeyByHash(hashApiKey(rawKey)))?.id).toBe(key.id);
  });
});
