import { InMemoryWebhookSigningSecretStore } from '@proctira/backend-developer-portal';
import { describe, expect, it } from 'vitest';

import {
  WEBHOOK_SIGNING_LOCAL_STUB_KEY_REF,
  createWebhookSigningSecretsFromEnv,
} from './webhook-signing-secrets-wiring.js';

const webhook = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  tenantId: '11111111-1111-4111-8111-111111111111',
  accountId: 'acct',
  url: 'https://example.test/hook',
  events: ['*'],
  secretHash: 'hash',
  description: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PRC-M211 webhook signing secrets wiring', () => {
  it('production without WEBHOOK_SIGNING_KMS_KEY_ID wires nothing (fail closed) and warns', async () => {
    const warnings: string[] = [];
    const secrets = await createWebhookSigningSecretsFromEnv(
      { NODE_ENV: 'production' },
      { store: new InMemoryWebhookSigningSecretStore(), warn: (m) => warnings.push(m) },
    );
    expect(secrets).toBeUndefined();
    expect(warnings.join('\n')).toMatch(/WEBHOOK_SIGNING_KMS_KEY_ID/);
  });

  it('non-production defaults to the shared deterministic local-stub KMS', async () => {
    const store = new InMemoryWebhookSigningSecretStore();
    const writer = await createWebhookSigningSecretsFromEnv({ NODE_ENV: 'test' }, { store });
    await writer!.storeSigningSecret(webhook, 'whsec_stub');
    expect(store.rows[0]!.kmsKeyRef).toBe(WEBHOOK_SIGNING_LOCAL_STUB_KEY_REF);
    // A second replica built from the same env opens the same envelope.
    const reader = await createWebhookSigningSecretsFromEnv({ NODE_ENV: 'test' }, { store });
    expect(await reader!.resolveSigningSecret(webhook)).toBe('whsec_stub');
  });

  it('production local-stub requires the explicit ALLOW_WEBHOOK_KMS_STUB opt-in', async () => {
    const env = {
      NODE_ENV: 'production',
      WEBHOOK_SIGNING_KMS_KEY_ID: 'alias/webhooks',
      WEBHOOK_SIGNING_KMS_CLIENT: 'local-stub',
    };
    const store = new InMemoryWebhookSigningSecretStore();
    await expect(createWebhookSigningSecretsFromEnv(env, { store })).rejects.toThrow(
      /ALLOW_WEBHOOK_KMS_STUB/,
    );
    const secrets = await createWebhookSigningSecretsFromEnv(
      { ...env, ALLOW_WEBHOOK_KMS_STUB: '1' },
      { store },
    );
    await secrets!.storeSigningSecret(webhook, 'whsec_prod_stub');
    expect(store.rows[0]!.kmsKeyRef).toBe('alias/webhooks');
    expect(await secrets!.resolveSigningSecret(webhook)).toBe('whsec_prod_stub');
  });
});
