import { describe, it, expect, vi } from 'vitest';
import { createSecretManager } from './factory.js';
import { EnvSecretAdapter } from './adapters/env-adapter.js';
import { AwsKmsSecretAdapter } from './adapters/aws-kms-adapter.js';
import { VaultSecretAdapter } from './adapters/vault-adapter.js';
import type { AwsSecretsManagerClient } from './adapters/aws-kms-adapter.js';
import type { VaultHttpClient } from './adapters/vault-adapter.js';

describe('createSecretManager', () => {
  it('should create an EnvSecretAdapter for "env" adapter', () => {
    const manager = createSecretManager({ adapter: 'env' });
    expect(manager).toBeInstanceOf(EnvSecretAdapter);
  });

  it('should create an EnvSecretAdapter with custom config', () => {
    const manager = createSecretManager({
      adapter: 'env',
      env: { prefix: 'CUSTOM_' },
    });
    expect(manager).toBeInstanceOf(EnvSecretAdapter);
  });

  it('should create an AwsKmsSecretAdapter for "aws-kms" adapter', () => {
    const mockClient: AwsSecretsManagerClient = {
      getSecretValue: vi.fn(),
      createSecret: vi.fn(),
      putSecretValue: vi.fn(),
      updateSecret: vi.fn(),
      describeSecret: vi.fn(),
    };

    const manager = createSecretManager(
      {
        adapter: 'aws-kms',
        awsKms: { region: 'us-east-1', keyId: 'test-key' },
      },
      { awsClient: mockClient },
    );
    expect(manager).toBeInstanceOf(AwsKmsSecretAdapter);
  });

  it('should throw when aws-kms config is missing', () => {
    expect(() => createSecretManager({ adapter: 'aws-kms' })).toThrow(
      /AWS KMS configuration is required/,
    );
  });

  it('should throw when aws-kms client dependency is missing', () => {
    expect(() =>
      createSecretManager({
        adapter: 'aws-kms',
        awsKms: { region: 'us-east-1', keyId: 'test-key' },
      }),
    ).toThrow(/AWS Secrets Manager client must be provided/);
  });

  it('should create a VaultSecretAdapter for "vault" adapter', () => {
    const mockClient: VaultHttpClient = {
      request: vi.fn(),
    };

    const manager = createSecretManager(
      {
        adapter: 'vault',
        vault: { address: 'http://localhost:8200', token: 'test-token' },
      },
      { vaultHttpClient: mockClient },
    );
    expect(manager).toBeInstanceOf(VaultSecretAdapter);
  });

  it('should throw when vault config is missing', () => {
    expect(() => createSecretManager({ adapter: 'vault' })).toThrow(
      /Vault configuration is required/,
    );
  });

  it('should throw when vault client dependency is missing', () => {
    expect(() =>
      createSecretManager({
        adapter: 'vault',
        vault: { address: 'http://localhost:8200', token: 'test-token' },
      }),
    ).toThrow(/Vault HTTP client must be provided/);
  });

  it('should throw for unsupported adapter', () => {
    expect(() => createSecretManager({ adapter: 'unknown' as 'env' })).toThrow(
      /Unsupported secret manager adapter/,
    );
  });
});
