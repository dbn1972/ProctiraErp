/**
 * Test-only KMS double + envelope wiring for developer-portal tests.
 * Mirrors `LocalStubPhiKmsClient` (@proctira/backend-health) without adding a package edge.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  EnvelopeWebhookSigningSecrets,
  InMemoryWebhookSigningSecretStore,
  type WebhookSecretKmsClient,
} from './webhook-signing-secrets.js';

export class FakeWebhookKms implements WebhookSecretKmsClient {
  readonly calls = { generate: 0, decrypt: 0 };
  private readonly key: Buffer;

  constructor(seed = 'developer-portal-test-kms') {
    this.key = createHash('sha256').update(seed, 'utf8').digest();
  }

  async generateDataKey(): Promise<{ Plaintext: Uint8Array; CiphertextBlob: Uint8Array }> {
    this.calls.generate += 1;
    const plain = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    const wrapped = Buffer.concat([iv, Buffer.alloc(16), cipher.update(plain), cipher.final()]);
    cipher.getAuthTag().copy(wrapped, 12);
    return { Plaintext: new Uint8Array(plain), CiphertextBlob: new Uint8Array(wrapped) };
  }

  async decrypt(params: { CiphertextBlob: Uint8Array }): Promise<{ Plaintext: Uint8Array }> {
    this.calls.decrypt += 1;
    const buf = Buffer.from(params.CiphertextBlob);
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12), {
      authTagLength: 16,
    });
    decipher.setAuthTag(buf.subarray(12, 28));
    return {
      Plaintext: new Uint8Array(
        Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]),
      ),
    };
  }
}

export function createTestWebhookSigningSecrets(
  kms: WebhookSecretKmsClient = new FakeWebhookKms(),
) {
  const store = new InMemoryWebhookSigningSecretStore();
  const secrets = new EnvelopeWebhookSigningSecrets({
    store,
    kms,
    kmsKeyRef: 'alias/test-webhook-signing',
  });
  return { store, kms, secrets };
}
