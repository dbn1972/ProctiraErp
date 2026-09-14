/**
 * W1-SEC-04 — createPhiKmsClientFromEnv factory.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createPhiKmsClientFromEnv, AwsKmsPhiClient } from './aws-kms-phi-client.js';
import { LocalStubPhiKmsClient, PhiEnvelopeMisconfiguredError } from './phi-envelope.js';

describe('createPhiKmsClientFromEnv (W1-SEC-04)', () => {
  const previous: Record<string, string | undefined> = {};

  function snap(...keys: string[]): void {
    for (const key of keys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
  }

  function restore(): void {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  afterEach(() => {
    restore();
  });

  it('returns undefined for non-kms providers', async () => {
    snap('PHI_ENVELOPE_PROVIDER', 'PHI_KMS_KEY_ID', 'PHI_KMS_WRAPPED_ROOT_KEY');
    process.env.PHI_ENVELOPE_PROVIDER = 'env-hmac';
    process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(32);
    await expect(createPhiKmsClientFromEnv()).resolves.toBeUndefined();
  });

  it('returns LocalStubPhiKmsClient when PHI_KMS_CLIENT=local-stub and ALLOW_PHI_KMS_STUB=1', async () => {
    snap(
      'PHI_ENVELOPE_PROVIDER',
      'PHI_KMS_CLIENT',
      'ALLOW_PHI_KMS_STUB',
      'PHI_KMS_KEY_ID',
      'PHI_KMS_WRAPPED_ROOT_KEY',
      'PHI_KMS_STUB_SECRET',
    );
    process.env.PHI_ENVELOPE_PROVIDER = 'kms';
    process.env.PHI_KMS_CLIENT = 'local-stub';
    process.env.ALLOW_PHI_KMS_STUB = '1';
    process.env.PHI_KMS_KEY_ID = 'alias/test';
    process.env.PHI_KMS_WRAPPED_ROOT_KEY = 'dGVzdA==';
    process.env.PHI_KMS_STUB_SECRET = 'stub-secret';

    const client = await createPhiKmsClientFromEnv();
    expect(client).toBeInstanceOf(LocalStubPhiKmsClient);
  });

  it('refuses local-stub client without ALLOW_PHI_KMS_STUB', async () => {
    snap('PHI_ENVELOPE_PROVIDER', 'PHI_KMS_CLIENT', 'ALLOW_PHI_KMS_STUB');
    process.env.PHI_ENVELOPE_PROVIDER = 'kms';
    process.env.PHI_KMS_CLIENT = 'local-stub';
    delete process.env.ALLOW_PHI_KMS_STUB;

    await expect(createPhiKmsClientFromEnv()).rejects.toBeInstanceOf(PhiEnvelopeMisconfiguredError);
  });

  it('constructs AwsKmsPhiClient when SDK is available', async () => {
    snap(
      'PHI_ENVELOPE_PROVIDER',
      'PHI_KMS_CLIENT',
      'ALLOW_PHI_KMS_STUB',
      'AWS_REGION',
      'PHI_KMS_REGION',
    );
    process.env.PHI_ENVELOPE_PROVIDER = 'kms';
    process.env.AWS_REGION = 'us-east-1';
    delete process.env.PHI_KMS_CLIENT;

    const client = await createPhiKmsClientFromEnv();
    expect(client).toBeInstanceOf(AwsKmsPhiClient);
  });
});
