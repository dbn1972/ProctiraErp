import { describe, expect, it } from 'vitest';

import { DeveloperPortalService } from './developer-portal-service.js';
import type { WebhookEntity } from './developer-portal-repository.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import {
  PgWebhookSigningSecretStore,
  WebhookSigningSecretUnavailableError,
} from './webhook-signing-secrets.js';
import {
  FakeWebhookKms,
  createTestWebhookSigningSecrets,
} from './webhook-signing-secrets.test-support.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

function hook(id: string, tenantId = TENANT): WebhookEntity {
  return {
    id,
    tenantId,
    accountId: 'acct',
    url: 'https://example.test/hook',
    events: ['*'],
    secretHash: 'hash',
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('EnvelopeWebhookSigningSecrets (PRC-M211 / 113)', () => {
  it('round-trips through a KMS-wrapped data key and never stores plaintext', async () => {
    const { store, kms, secrets } = createTestWebhookSigningSecrets();
    const wh = hook('aaaaaaaa-0000-4000-8000-000000000001');
    await secrets.storeSigningSecret(wh, 'whsec_round_trip');
    const [row] = store.rows;
    expect(row).toMatchObject({ status: 'active', keyVersion: 1, algorithm: 'AES-256-GCM' });
    expect(row!.nonce).toHaveLength(12);
    expect(row!.authTag).toHaveLength(16);
    expect(row!.kmsKeyRef).toBe('alias/test-webhook-signing');
    expect(row!.ciphertext.toString('utf8')).not.toContain('whsec_round_trip');
    expect(await secrets.resolveSigningSecret(wh)).toBe('whsec_round_trip');
    expect((kms as FakeWebhookKms).calls).toEqual({ generate: 1, decrypt: 1 });
  });

  it('rotation retires the previous version and resolves the new secret', async () => {
    const { store, secrets } = createTestWebhookSigningSecrets();
    const wh = hook('aaaaaaaa-0000-4000-8000-000000000002');
    await secrets.storeSigningSecret(wh, 'whsec_v1');
    await secrets.storeSigningSecret(wh, 'whsec_v2');
    expect(store.rows.map((r) => [r.keyVersion, r.status])).toEqual([
      [1, 'retired'],
      [2, 'active'],
    ]);
    expect(store.rows[0]!.retiredAt).toBeInstanceOf(Date);
    expect(await secrets.resolveSigningSecret(wh)).toBe('whsec_v2');
  });

  it('fails closed on a missing row, tampered ciphertext, truncated tag or foreign webhook', async () => {
    const { store, secrets } = createTestWebhookSigningSecrets();
    const wh = hook('aaaaaaaa-0000-4000-8000-000000000003');
    await expect(secrets.resolveSigningSecret(wh)).rejects.toMatchObject({ reason: 'missing' });

    await secrets.storeSigningSecret(wh, 'whsec_tamper');
    const row = store.rows[0]!;
    const original = row.ciphertext;
    row.ciphertext = Buffer.from(original);
    row.ciphertext[0] = row.ciphertext[0]! ^ 0xff;
    await expect(secrets.resolveSigningSecret(wh)).rejects.toMatchObject({
      reason: 'undecryptable',
    });
    row.ciphertext = original;
    row.authTag = row.authTag.subarray(0, 8);
    await expect(secrets.resolveSigningSecret(wh)).rejects.toMatchObject({
      reason: 'undecryptable',
    });

    // AAD binds tenant + webhook + row id: a row copied under another webhook does not open.
    const { store: store2, secrets: secrets2 } = createTestWebhookSigningSecrets();
    await secrets2.storeSigningSecret(wh, 'whsec_bound');
    const copied = { ...store2.rows[0]!, webhookId: 'aaaaaaaa-0000-4000-8000-000000000004' };
    store2.rows.push(copied);
    store2.rows[0]!.status = 'retired';
    await expect(
      secrets2.resolveSigningSecret(hook('aaaaaaaa-0000-4000-8000-000000000004')),
    ).rejects.toMatchObject({ reason: 'undecryptable' });
  });

  it('fails closed when KMS cannot unwrap the data key', async () => {
    const writer = createTestWebhookSigningSecrets(new FakeWebhookKms('kms-a'));
    const wh = hook('aaaaaaaa-0000-4000-8000-000000000005');
    await writer.secrets.storeSigningSecret(wh, 'whsec_kms');
    const reader = createTestWebhookSigningSecrets(new FakeWebhookKms('kms-b'));
    reader.store.rows.push(...writer.store.rows);
    await expect(reader.secrets.resolveSigningSecret(wh)).rejects.toMatchObject({
      reason: 'kms_error',
    });
  });
});

describe('PgWebhookSigningSecretStore', () => {
  it('maps a missing 113 table to schema_not_ready (no runtime DDL)', async () => {
    const pool = {
      async query(sql: string) {
        if (/developer_portal_webhook_signing_secrets/.test(sql)) {
          throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
        }
        return { rows: [] };
      },
    };
    const store = new PgWebhookSigningSecretStore(pool);
    const err = await store
      .getActive(TENANT, 'aaaaaaaa-0000-4000-8000-000000000006')
      .catch((e) => e);
    expect(err).toBeInstanceOf(WebhookSigningSecretUnavailableError);
    expect(err).toMatchObject({ reason: 'schema_not_ready', statusCode: 503 });
  });

  it('binds the tenant and scopes rotation by tenant + webhook', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query(sql: string, values?: unknown[]) {
        calls.push({ sql, values });
        if (/^\s*INSERT INTO developer_portal_webhook_signing_secrets/.test(sql)) {
          return {
            rows: [
              {
                id: values![0],
                tenant_id: values![1],
                webhook_id: values![2],
                key_version: 3,
                ciphertext: values![4],
                nonce: values![5],
                auth_tag: values![6],
                wrapped_data_key: values![7],
                kms_key_ref: values![8],
                status: 'active',
                created_at: new Date(),
                retired_at: null,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const store = new PgWebhookSigningSecretStore(pool);
    const stored = await store.rotate({
      id: 'aaaaaaaa-0000-4000-8000-0000000000aa',
      tenantId: OTHER_TENANT,
      webhookId: 'aaaaaaaa-0000-4000-8000-000000000007',
      algorithm: 'AES-256-GCM',
      ciphertext: Buffer.alloc(16, 1),
      nonce: Buffer.alloc(12, 2),
      authTag: Buffer.alloc(16, 3),
      wrappedDataKey: Buffer.alloc(32, 4),
      kmsKeyRef: 'alias/k',
    });
    expect(stored.keyVersion).toBe(3);
    const text = calls.map((c) => c.sql).join('\n');
    expect(text).toMatch(/set_config\('app\.tenant_id'/);
    expect(text).toMatch(/pg_advisory_xact_lock/);
    expect(text).toMatch(/SET status = 'retired', retired_at = now\(\)/);
    const update = calls.find((c) => /SET status = 'retired'/.test(c.sql))!;
    expect(update.values).toEqual([OTHER_TENANT, 'aaaaaaaa-0000-4000-8000-000000000007']);
  });
});

describe('DeveloperPortalService mandatory signing (PRC-M211)', () => {
  it('stores the secret through the envelope on create and shows a generated secret once', async () => {
    const repository = new InMemoryDeveloperPortalRepository();
    const { store, secrets } = createTestWebhookSigningSecrets();
    const service = new DeveloperPortalService(repository, undefined, {
      signingSecretResolver: secrets,
    });
    const account = await service.createAccount({ name: 'A', email: 'a@example.com' });
    const created = await service.createWebhook(account.id, TENANT, {
      url: 'https://example.test/hook',
      events: ['*'],
    });
    expect(created.signingSecret).toBeTruthy();
    expect(await secrets.resolveSigningSecret(created)).toBe(created.signingSecret);
    expect(store.rows).toHaveLength(1);
    // Rotation through update retires the old version.
    await service.updateWebhook(account.id, TENANT, created.id, { secret: 'whsec_rotated_value' });
    expect(await secrets.resolveSigningSecret(created)).toBe('whsec_rotated_value');
    expect(store.rows.map((r) => r.status)).toEqual(['retired', 'active']);
  });

  it('refuses to register a webhook without secret storage (503) and leaves no row', async () => {
    const repository = new InMemoryDeveloperPortalRepository();
    const service = new DeveloperPortalService(repository);
    const account = await service.createAccount({ name: 'B', email: 'b@example.com' });
    await expect(
      service.createWebhook(account.id, TENANT, { url: 'https://example.test/h', events: ['*'] }),
    ).rejects.toMatchObject({ statusCode: 503, reason: 'not_configured' });
    expect(
      (await repository.listWebhooks({ accountId: account.id, tenantId: TENANT }, 1, 10)).total,
    ).toBe(0);
  });

  it('removes the webhook when storing the envelope fails', async () => {
    const repository = new InMemoryDeveloperPortalRepository();
    const service = new DeveloperPortalService(repository, undefined, {
      signingSecretResolver: { resolveSigningSecret: async () => undefined },
      signingSecretWriter: {
        storeSigningSecret: async () => {
          throw new WebhookSigningSecretUnavailableError('schema_not_ready', 'table missing');
        },
      },
    });
    const account = await service.createAccount({ name: 'C', email: 'c@example.com' });
    await expect(
      service.createWebhook(account.id, TENANT, { url: 'https://example.test/h', events: ['*'] }),
    ).rejects.toMatchObject({ reason: 'schema_not_ready' });
    expect(
      (await repository.listWebhooks({ accountId: account.id, tenantId: TENANT }, 1, 10)).total,
    ).toBe(0);
  });

  it('fails the attempt (never unsigned) when the secret cannot be resolved', async () => {
    const repository = new InMemoryDeveloperPortalRepository();
    const { secrets } = createTestWebhookSigningSecrets();
    let posts = 0;
    const service = new DeveloperPortalService(repository, undefined, {
      signingSecretResolver: secrets,
      httpFetch: async () => {
        posts += 1;
        return { status: 200, ok: true };
      },
    });
    const wh = await repository.createWebhook(hook('aaaaaaaa-0000-4000-8000-000000000008'));
    const delivery = await service.createDelivery(wh.id, 'student.created', { id: 's1' });
    await expect(
      service.processQueuedDelivery(TENANT, {
        deliveryId: delivery.id,
        webhookId: wh.id,
        tenantId: TENANT,
        url: wh.url,
        event: 'student.created',
        body: { id: 's1' },
        attempt: 0,
      }),
    ).rejects.toMatchObject({ reason: 'missing' });
    expect(posts).toBe(0);
    expect((await repository.getDeliveryById(delivery.id))?.status).toBe('failed');
  });
});
