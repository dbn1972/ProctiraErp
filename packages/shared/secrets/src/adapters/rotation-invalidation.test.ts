/**
 * PRC-L495: requested invalidation of the previous secret version must not be
 * silently swallowed (Vault) or ignored (AWS); Vault keys cannot traverse paths.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AwsKmsConfig, VaultConfig } from '../types.js';

import {
  AwsKmsSecretAdapter,
  SecretAccessError,
  type AwsSecretsManagerClient,
} from './aws-kms-adapter.js';
import { VaultSecretAdapter, assertSafeVaultKey, type VaultResponse } from './vault-adapter.js';

const vaultConfig: VaultConfig = {
  address: 'http://localhost:8200',
  token: 'test-token',
  mountPath: 'secret',
};
const awsConfig: AwsKmsConfig = { region: 'us-east-1', keyId: 'k' } as AwsKmsConfig;

function vaultClient(destroy: () => VaultResponse | Promise<VaultResponse>) {
  return {
    request: vi.fn(async (o: { method: string; path: string }) => {
      if (o.method === 'GET' && o.path.includes('/data/')) {
        return {
          status: 200,
          data: { data: { data: { value: 'old' }, metadata: { version: 5 } } },
        };
      }
      if (o.method === 'POST' && o.path.includes('/data/')) {
        return { status: 200, data: { data: { version: 6 } } };
      }
      if (o.path.includes('/destroy/')) return destroy();
      return { status: 200, data: {} };
    }),
  };
}

describe('Vault rotation invalidation (PRC-L495)', () => {
  it('throws when the destroy request rejects', async () => {
    const adapter = new VaultSecretAdapter(
      vaultConfig,
      vaultClient(() => Promise.reject(new Error('network down'))),
    );
    await expect(
      adapter.rotateSecret('my-key', { newValue: 'n', invalidatePrevious: true }),
    ).rejects.toThrow(/destroying previous version 5 failed/);
  });

  it('throws when the destroy request returns a non-2xx status', async () => {
    const adapter = new VaultSecretAdapter(
      vaultConfig,
      vaultClient(() => ({ status: 403, data: {} })),
    );
    const err = await adapter
      .rotateSecret('my-key', { newValue: 'super-secret-new', invalidatePrevious: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecretAccessError);
    expect(String((err as Error).message)).toContain('status 403');
    expect(String((err as Error).message)).not.toContain('super-secret-new');
  });

  it('reports previousInvalidated=true on success', async () => {
    const adapter = new VaultSecretAdapter(
      vaultConfig,
      vaultClient(() => ({ status: 204, data: {} })),
    );
    const result = await adapter.rotateSecret('my-key', {
      newValue: 'n',
      invalidatePrevious: true,
    });
    expect(result.previousInvalidated).toBe(true);
  });

  it('leaves previousInvalidated unset when invalidation was not requested', async () => {
    const adapter = new VaultSecretAdapter(
      vaultConfig,
      vaultClient(() => ({ status: 204, data: {} })),
    );
    const result = await adapter.rotateSecret('my-key', { newValue: 'n' });
    expect(result.previousInvalidated).toBeUndefined();
  });
});

describe('Vault key validation (PRC-L495)', () => {
  it.each(['app/db', 'app/db.v2', 'a_b-c/d'])('accepts %s', (key) => {
    expect(() => assertSafeVaultKey(key)).not.toThrow();
  });

  it.each(['../sys/seal', 'app/../sys', 'app//db', '/app', 'app/', 'a b', 'a?x=1', 'a%2e', '.'])(
    'rejects %s',
    (key) => {
      expect(() => assertSafeVaultKey(key)).toThrow(SecretAccessError);
    },
  );

  it('rejects traversal keys before any request is made', async () => {
    const client = vaultClient(() => ({ status: 204, data: {} }));
    const adapter = new VaultSecretAdapter(vaultConfig, client);
    await expect(adapter.getSecret('../../sys/seal')).rejects.toThrow(SecretAccessError);
    await expect(adapter.setSecret('../x', 'v')).rejects.toThrow(SecretAccessError);
    expect(client.request).not.toHaveBeenCalled();
  });
});

function awsClient(overrides: Partial<AwsSecretsManagerClient> = {}): AwsSecretsManagerClient {
  return {
    getSecretValue: vi.fn(),
    createSecret: vi.fn(),
    putSecretValue: vi.fn().mockResolvedValue({ VersionId: 'v2' }),
    updateSecret: vi.fn(),
    describeSecret: vi.fn().mockResolvedValue({ VersionIdsToStages: { v1: ['AWSCURRENT'] } }),
    ...overrides,
  } as AwsSecretsManagerClient;
}

describe('AWS rotation invalidation (PRC-L495)', () => {
  it('removes AWSPREVIOUS from the old version when invalidatePrevious is set', async () => {
    const updateSecretVersionStage = vi.fn().mockResolvedValue({});
    const client = awsClient({ updateSecretVersionStage });
    const adapter = new AwsKmsSecretAdapter(awsConfig, client);
    const result = await adapter.rotateSecret('k', { newValue: 'n', invalidatePrevious: true });
    expect(updateSecretVersionStage).toHaveBeenCalledWith({
      SecretId: 'k',
      VersionStage: 'AWSPREVIOUS',
      RemoveFromVersionId: 'v1',
    });
    expect(result.previousInvalidated).toBe(true);
  });

  it('throws when stage removal fails', async () => {
    const client = awsClient({
      updateSecretVersionStage: vi.fn().mockRejectedValue(new Error('denied')),
    });
    const adapter = new AwsKmsSecretAdapter(awsConfig, client);
    await expect(
      adapter.rotateSecret('k', { newValue: 'n', invalidatePrevious: true }),
    ).rejects.toThrow(/invalidating previous version v1 failed/);
  });

  it('refuses before writing when the client cannot invalidate', async () => {
    const client = awsClient();
    const adapter = new AwsKmsSecretAdapter(awsConfig, client);
    await expect(
      adapter.rotateSecret('k', { newValue: 'n', invalidatePrevious: true }),
    ).rejects.toThrow(SecretAccessError);
    expect(client.putSecretValue).not.toHaveBeenCalled();
  });
});
