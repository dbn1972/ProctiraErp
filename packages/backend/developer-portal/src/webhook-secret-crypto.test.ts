/** PRC-M211: sealed webhook signing secrets. */
import { describe, expect, it } from 'vitest';

import {
  WebhookSecretKeyMissingError,
  openWebhookSecret,
  resetEphemeralWebhookSecretKeyForTests,
  sealWebhookSecret,
} from './webhook-secret-crypto.js';

const KEY = { WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const scope = { webhookId: 'wh-1', tenantId: 't-1' };

describe('webhook secret sealing', () => {
  it('round-trips and never stores the plaintext', () => {
    const sealed = sealWebhookSecret('whsec_abc', scope, KEY);
    expect(sealed.startsWith('wsk:v1:')).toBe(true);
    expect(sealed).not.toContain('whsec_abc');
    expect(openWebhookSecret(sealed, scope, KEY)).toBe('whsec_abc');
  });

  it('is bound to the webhook and tenant (AAD)', () => {
    const sealed = sealWebhookSecret('whsec_abc', scope, KEY);
    expect(openWebhookSecret(sealed, { ...scope, webhookId: 'wh-2' }, KEY)).toBeNull();
    expect(openWebhookSecret(sealed, { ...scope, tenantId: 't-2' }, KEY)).toBeNull();
  });

  it('rejects a wrong key, tampering and legacy values', () => {
    const sealed = sealWebhookSecret('whsec_abc', scope, KEY);
    const other = { WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('hex') };
    expect(openWebhookSecret(sealed, scope, other)).toBeNull();
    expect(openWebhookSecret(`${sealed.slice(0, -4)}AAAA`, scope, KEY)).toBeNull();
    expect(openWebhookSecret(null, scope, KEY)).toBeNull();
    expect(openWebhookSecret('sha256:deadbeef', scope, KEY)).toBeNull();
  });

  it('fails closed in production without a key', () => {
    expect(() => sealWebhookSecret('x', scope, { NODE_ENV: 'production' })).toThrow(
      WebhookSecretKeyMissingError,
    );
    expect(() =>
      sealWebhookSecret('x', scope, { WEBHOOK_SECRET_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(/32 bytes/);
  });

  it('uses an ephemeral key outside production (lost on restart)', () => {
    const sealed = sealWebhookSecret('x', scope, {});
    expect(openWebhookSecret(sealed, scope, {})).toBe('x');
    resetEphemeralWebhookSecretKeyForTests();
    expect(openWebhookSecret(sealed, scope, {})).toBeNull();
  });
});
