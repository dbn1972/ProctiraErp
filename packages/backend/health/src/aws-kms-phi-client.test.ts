/**
 * W1-SEC-04 — createPhiKmsClientFromEnv factory.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  // PRC-M517: independent call site from phi-envelope.ts's
  // assertPhiEnvelopeConfigured — PHI_KMS_CLIENT=local-stub must warn in
  // production too.
  it('PRC-M517: warns on console.warn when PHI_KMS_CLIENT=local-stub is active in production', async () => {
    snap(
      'NODE_ENV',
      'PHI_ENVELOPE_PROVIDER',
      'PHI_KMS_CLIENT',
      'ALLOW_PHI_KMS_STUB',
      'PHI_KMS_KEY_ID',
      'PHI_KMS_WRAPPED_ROOT_KEY',
      'PHI_KMS_STUB_SECRET',
    );
    process.env.NODE_ENV = 'production';
    process.env.PHI_ENVELOPE_PROVIDER = 'kms';
    process.env.PHI_KMS_CLIENT = 'local-stub';
    process.env.ALLOW_PHI_KMS_STUB = '1';
    process.env.PHI_KMS_KEY_ID = 'alias/test';
    process.env.PHI_KMS_WRAPPED_ROOT_KEY = 'dGVzdA==';
    process.env.PHI_KMS_STUB_SECRET = 'stub-secret';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const client = await createPhiKmsClientFromEnv();
      expect(client).toBeInstanceOf(LocalStubPhiKmsClient);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PRC-M517'));
    } finally {
      warnSpy.mockRestore();
    }
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

  // ─── PRC-L313 ────────────────────────────────────────────────────────────

  it('PRC-L313: warns when none of PHI_KMS_REGION/AWS_REGION/AWS_DEFAULT_REGION is set', async () => {
    snap(
      'PHI_ENVELOPE_PROVIDER',
      'PHI_KMS_CLIENT',
      'AWS_REGION',
      'PHI_KMS_REGION',
      'AWS_DEFAULT_REGION',
    );
    process.env.PHI_ENVELOPE_PROVIDER = 'kms';
    delete process.env.PHI_KMS_CLIENT;
    delete process.env.AWS_REGION;
    delete process.env.PHI_KMS_REGION;
    delete process.env.AWS_DEFAULT_REGION;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await createPhiKmsClientFromEnv();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PRC-L313'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('PRC-L313: throws PhiEnvelopeMisconfiguredError when PHI_KMS_MAX_ATTEMPTS is malformed', async () => {
    snap('PHI_ENVELOPE_PROVIDER', 'PHI_KMS_CLIENT', 'AWS_REGION', 'PHI_KMS_MAX_ATTEMPTS');
    process.env.PHI_ENVELOPE_PROVIDER = 'kms';
    process.env.AWS_REGION = 'us-east-1';
    process.env.PHI_KMS_MAX_ATTEMPTS = 'abc';
    delete process.env.PHI_KMS_CLIENT;

    await expect(createPhiKmsClientFromEnv()).rejects.toBeInstanceOf(PhiEnvelopeMisconfiguredError);
  });

  it('PRC-L313: constructs KMSClient with explicit maxAttempts and a requestHandler by default', async () => {
    snap('PHI_ENVELOPE_PROVIDER', 'PHI_KMS_CLIENT', 'AWS_REGION');
    process.env.PHI_ENVELOPE_PROVIDER = 'kms';
    process.env.AWS_REGION = 'us-east-1';
    delete process.env.PHI_KMS_CLIENT;

    vi.resetModules();
    const kmsClientSpy = vi.fn();
    vi.doMock('@aws-sdk/client-kms', async () => {
      const actual =
        await vi.importActual<typeof import('@aws-sdk/client-kms')>('@aws-sdk/client-kms');
      return {
        ...actual,
        KMSClient: class {
          constructor(config: unknown) {
            kmsClientSpy(config);
          }
        },
      };
    });
    const { createPhiKmsClientFromEnv: freshCreate } = await import('./aws-kms-phi-client.js');
    await freshCreate();
    expect(kmsClientSpy).toHaveBeenCalledTimes(1);
    const config = kmsClientSpy.mock.calls[0]?.[0] as {
      maxAttempts?: number;
      requestHandler?: unknown;
    };
    expect(config.maxAttempts).toBe(3);
    expect(config.requestHandler).toBeDefined();
    vi.doUnmock('@aws-sdk/client-kms');
    vi.resetModules();
  });
});
