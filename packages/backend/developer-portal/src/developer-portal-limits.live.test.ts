/**
 * PRC-L299 — live proof that developer-portal limit checks and unique checks
 * hold under concurrency in Postgres (no migration; existing unique indexes
 * from db/sql/089 and 134).
 *
 * Before: the service counts, then inserts in a separate transaction, so five
 * concurrent API-key creates with a limit of 2 all succeed, and a concurrent
 * duplicate email surfaces as a raw 23505 (500) (RED). After: a per-account
 * advisory xact lock serializes count + insert (exactly 2 succeed, 3 get
 * BusinessRuleError) and the unique violation maps to ConflictError (GREEN).
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ConflictError } from '@proctira/common';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, DeveloperPortalService } from './developer-portal-service.js';
import { HybridDeveloperPortalRepository } from './hybrid-repository.js';
import { PgApiKeyStore } from './pg-api-key-store.js';
import { PgDeveloperPortalDurableStore } from './pg-durable-store.js';
import { createTestWebhookSigningSecrets } from './webhook-signing-secrets.test-support.js';

const CONNECTION = process.env['DATABASE_URL'] ?? process.env['MIGRATOR_DATABASE_URL'] ?? '';
if (!CONNECTION && (process.env['CI'] === 'true' || process.env['REQUIRE_LIVE_TESTS'] === '1')) {
  throw new Error('developer-portal-limits.live.test requires DATABASE_URL (no silent skip)');
}

describe.skipIf(!CONNECTION)('developer-portal limits (live)', () => {
  let pool: pg.Pool;
  let service: DeveloperPortalService;
  const tenantId = randomUUID();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: CONNECTION, max: 10 });
    await ensurePgTestTenant(pool, tenantId);
    service = new DeveloperPortalService(
      new HybridDeveloperPortalRepository(
        new PgApiKeyStore(pool),
        new PgDeveloperPortalDurableStore(pool),
      ),
      {
        ...DEFAULT_CONFIG,
        maxApiKeysPerAccount: 2,
        maxWebhooksPerAccount: 2,
        maxSandboxesPerAccount: 1,
      },
      {
        signingSecretResolver: createTestWebhookSigningSecrets().secrets,
        signingSecretWriter: { async storeSigningSecret() {} },
        validateWebhookUrl: async () => undefined,
      },
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('five concurrent API-key creates with a limit of 2: exactly 2 succeed', async () => {
    const account = await service.createAccount({
      name: 'Limits',
      email: `limits-${randomUUID()}@example.test`,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        service.createApiKey(account.id, tenantId, { name: `k${i}`, scopes: ['read'] }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(3);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(BusinessRuleError);
    const listed = await service.listApiKeys(account.id, tenantId, 1, 10, 'active');
    expect(listed.total).toBe(2);
  });

  it('four concurrent webhook creates with a limit of 2: exactly 2 succeed', async () => {
    const account = await service.createAccount({
      name: 'Limits',
      email: `limits-${randomUUID()}@example.test`,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        service.createWebhook(account.id, tenantId, {
          url: 'https://hooks.example.test/limits',
          events: ['student.enrolled'],
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(BusinessRuleError);
    }
  });

  it('three concurrent sandbox creates with a limit of 1: exactly 1 succeeds', async () => {
    const account = await service.createAccount({
      name: 'Limits',
      email: `limits-${randomUUID()}@example.test`,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, (_, i) => service.createSandbox(account.id, { name: `s${i}` })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(BusinessRuleError);
    }
  });

  it('concurrent duplicate email: one account, the other a ConflictError (not a 500)', async () => {
    const email = `dup-${randomUUID()}@example.test`;
    const results = await Promise.allSettled([
      service.createAccount({ name: 'Dup A', email }),
      service.createAccount({ name: 'Dup B', email }),
      service.createAccount({ name: 'Dup C', email }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(ConflictError);
  });
});
