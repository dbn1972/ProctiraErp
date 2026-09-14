/**
 * W1-SEC-04 COMPLETE — PHI envelope provider fail-closed + rotatable DEKs.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertPhiEnvelopeConfigured,
  createPhiEnvelopeProvider,
  encryptPhi,
  decryptPhi,
  LocalStubPhiKmsClient,
  PhiEnvelopeMisconfiguredError,
  PhiKeyMissingError,
  resetPhiEnvelopeProviderForTests,
  setPhiEnvelopeProviderForTests,
  type PhiCryptoScope,
} from './phi-crypto.js';
import { EnvHmacPhiEnvelopeProvider, KmsPhiEnvelopeProvider } from './phi-envelope.js';

describe('W1-SEC-04 COMPLETE PHI envelope provider', () => {
  const prev: Record<string, string | undefined> = {};

  function snapshotEnv(...keys: string[]) {
    for (const k of keys) prev[k] = process.env[k];
  }
  function restoreEnv() {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetPhiEnvelopeProviderForTests();
  }

  afterEach(() => {
    restoreEnv();
  });

  it('fails closed in production when only PHI_ENCRYPTION_KEY is set (no KMS)', () => {
    snapshotEnv(
      'NODE_ENV',
      'PHI_ENCRYPTION_KEY',
      'PHI_ENVELOPE_PROVIDER',
      'PHI_KMS_KEY_ID',
      'PHI_KMS_WRAPPED_ROOT_KEY',
      'ALLOW_PLAINTEXT_PHI',
      'ALLOW_PHI_KMS_STUB',
    );
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PLAINTEXT_PHI;
    delete process.env.PHI_ENVELOPE_PROVIDER;
    delete process.env.PHI_KMS_KEY_ID;
    delete process.env.PHI_KMS_WRAPPED_ROOT_KEY;
    delete process.env.ALLOW_PHI_KMS_STUB;
    process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(64);
    expect(() => assertPhiEnvelopeConfigured()).toThrow(PhiEnvelopeMisconfiguredError);
  });

  it('allows env-hmac outside production', async () => {
    snapshotEnv('NODE_ENV', 'PHI_ENCRYPTION_KEY', 'PHI_ENVELOPE_PROVIDER');
    process.env.NODE_ENV = 'test';
    process.env.PHI_ENCRYPTION_KEY = 'unit-env-hmac-master';
    delete process.env.PHI_ENVELOPE_PROVIDER;
    expect(() => assertPhiEnvelopeConfigured()).not.toThrow();
    const provider = await createPhiEnvelopeProvider();
    expect(provider?.kind).toBe('env-hmac');
  });

  it('local-stub KMS round-trips enc:v3 without calling AWS', async () => {
    snapshotEnv(
      'NODE_ENV',
      'PHI_ENVELOPE_PROVIDER',
      'PHI_KMS_KEY_ID',
      'PHI_KMS_WRAPPED_ROOT_KEY',
      'PHI_KMS_KEY_VERSION',
      'PHI_ENCRYPTION_KEY',
      'ALLOW_PHI_KMS_STUB',
    );
    process.env.NODE_ENV = 'production';
    process.env.PHI_ENVELOPE_PROVIDER = 'local-stub';
    process.env.ALLOW_PHI_KMS_STUB = '1';
    process.env.PHI_KMS_KEY_ID = 'alias/proctira-phi-test';
    process.env.PHI_KMS_KEY_VERSION = 'rotate-2';
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_KMS_WRAPPED_ROOT_KEY;

    const provider = await createPhiEnvelopeProvider();
    expect(provider?.kind).toBe('local-stub');
    setPhiEnvelopeProviderForTests(provider);

    const scope: PhiCryptoScope = {
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      institutionId: '11111111-1111-4111-8111-111111111111',
    };
    const cipher = encryptPhi('kms-backed note', scope);
    expect(cipher).toMatch(/^enc:v3:rotate-2:/);
    expect(decryptPhi(cipher, scope)).toBe('kms-backed note');
  });

  it('KmsPhiEnvelopeProvider unwraps via injected client', async () => {
    snapshotEnv('NODE_ENV');
    process.env.NODE_ENV = 'test';
    const stub = new LocalStubPhiKmsClient('inject-test');
    const root = Buffer.from('b'.repeat(32));
    const wrapped = stub.wrapRootKey(root);
    const provider = new KmsPhiEnvelopeProvider(stub, 'alias/x', wrapped, {
      kind: 'kms',
      keyVersion: 'k1',
    });
    await provider.unwrapRootKey();
    expect(provider.resolveRootKey().equals(root)).toBe(true);
  });

  it('EnvHmacPhiEnvelopeProvider derives a stable root', () => {
    const a = new EnvHmacPhiEnvelopeProvider('same-master');
    const b = new EnvHmacPhiEnvelopeProvider('same-master');
    expect(a.resolveRootKey().equals(b.resolveRootKey())).toBe(true);
  });

  it('production without any key still throws PhiKeyMissingError', () => {
    snapshotEnv(
      'NODE_ENV',
      'PHI_ENCRYPTION_KEY',
      'PHI_ENVELOPE_PROVIDER',
      'PHI_KMS_KEY_ID',
      'ALLOW_PLAINTEXT_PHI',
    );
    process.env.NODE_ENV = 'production';
    delete process.env.PHI_ENCRYPTION_KEY;
    delete process.env.PHI_ENVELOPE_PROVIDER;
    delete process.env.PHI_KMS_KEY_ID;
    delete process.env.ALLOW_PLAINTEXT_PHI;
    expect(() => assertPhiEnvelopeConfigured()).toThrow(PhiKeyMissingError);
  });
});
