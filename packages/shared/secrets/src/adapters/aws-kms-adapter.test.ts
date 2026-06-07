import { describe, it, expect, vi } from 'vitest';
import { AwsKmsSecretAdapter, SecretAccessError } from './aws-kms-adapter.js';
import type { AwsSecretsManagerClient } from './aws-kms-adapter.js';
import type { AwsKmsConfig } from '../types.js';

function createMockClient(overrides: Partial<AwsSecretsManagerClient> = {}): AwsSecretsManagerClient {
  return {
    getSecretValue: vi.fn().mockResolvedValue({
      SecretString: 'test-secret',
      VersionId: 'v1',
      CreatedDate: new Date('2024-01-01'),
      Name: 'test-key',
    }),
    createSecret: vi.fn().mockResolvedValue({
      ARN: 'arn:aws:secretsmanager:us-east-1:123:secret:test',
      Name: 'test-key',
      VersionId: 'v1',
    }),
    putSecretValue: vi.fn().mockResolvedValue({
      VersionId: 'v2',
      Name: 'test-key',
    }),
    updateSecret: vi.fn().mockResolvedValue({
      VersionId: 'v2',
      Name: 'test-key',
    }),
    describeSecret: vi.fn().mockResolvedValue({
      Name: 'test-key',
      CreatedDate: new Date('2024-01-01'),
      VersionIdsToStages: { 'v1': ['AWSCURRENT'] },
    }),
    ...overrides,
  };
}

const defaultConfig: AwsKmsConfig = {
  region: 'us-east-1',
  keyId: 'arn:aws:kms:us-east-1:123:key/test-key-id',
};

describe('AwsKmsSecretAdapter', () => {
  describe('getSecret', () => {
    it('should return the secret value and metadata', async () => {
      const client = createMockClient();
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const result = await adapter.getSecret('my-secret');

      expect(result).not.toBeNull();
      expect(result!.value).toBe('test-secret');
      expect(result!.metadata.key).toBe('my-secret');
      expect(result!.metadata.version).toBe('v1');
      expect(client.getSecretValue).toHaveBeenCalledWith({
        SecretId: 'my-secret',
        VersionStage: 'AWSCURRENT',
      });
    });

    it('should return null when secret is not found', async () => {
      const client = createMockClient({
        getSecretValue: vi.fn().mockRejectedValue(
          Object.assign(new Error('Not found'), { name: 'ResourceNotFoundException' })
        ),
      });
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const result = await adapter.getSecret('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when SecretString is undefined', async () => {
      const client = createMockClient({
        getSecretValue: vi.fn().mockResolvedValue({
          VersionId: 'v1',
          CreatedDate: new Date(),
        }),
      });
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const result = await adapter.getSecret('binary-secret');
      expect(result).toBeNull();
    });

    it('should throw SecretAccessError on unexpected errors', async () => {
      const client = createMockClient({
        getSecretValue: vi.fn().mockRejectedValue(new Error('Network timeout')),
      });
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      await expect(adapter.getSecret('my-secret')).rejects.toThrow(SecretAccessError);
      await expect(adapter.getSecret('my-secret')).rejects.toThrow(
        /Failed to retrieve secret 'my-secret'/
      );
    });
  });

  describe('setSecret', () => {
    it('should update an existing secret', async () => {
      const client = createMockClient();
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const metadata = await adapter.setSecret('existing-key', 'new-value');

      expect(metadata.key).toBe('existing-key');
      expect(metadata.version).toBe('v2');
      expect(client.updateSecret).toHaveBeenCalledWith({
        SecretId: 'existing-key',
        SecretString: 'new-value',
        KmsKeyId: defaultConfig.keyId,
      });
    });

    it('should create a new secret when it does not exist', async () => {
      const client = createMockClient({
        updateSecret: vi.fn().mockRejectedValue(
          Object.assign(new Error('Not found'), { name: 'ResourceNotFoundException' })
        ),
      });
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const metadata = await adapter.setSecret('new-key', 'secret-value', {
        description: 'A test secret',
        tags: { env: 'test' },
      });

      expect(metadata.key).toBe('new-key');
      expect(client.createSecret).toHaveBeenCalledWith({
        Name: 'new-key',
        SecretString: 'secret-value',
        KmsKeyId: defaultConfig.keyId,
        Description: 'A test secret',
        Tags: [{ Key: 'env', Value: 'test' }],
      });
    });

    it('should throw SecretAccessError on unexpected errors', async () => {
      const client = createMockClient({
        updateSecret: vi.fn().mockRejectedValue(new Error('Access denied')),
      });
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      await expect(adapter.setSecret('key', 'value')).rejects.toThrow(SecretAccessError);
    });
  });

  describe('rotateSecret', () => {
    it('should rotate the secret with a new value', async () => {
      const client = createMockClient();
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const result = await adapter.rotateSecret('my-secret', { newValue: 'rotated-value' });

      expect(result.newVersion).toBe('v2');
      expect(result.previousVersion).toBe('v1');
      expect(result.rotatedAt).toBeInstanceOf(Date);
      expect(client.putSecretValue).toHaveBeenCalledWith({
        SecretId: 'my-secret',
        SecretString: 'rotated-value',
        VersionStages: ['AWSCURRENT'],
      });
    });

    it('should throw when no newValue is provided', async () => {
      const client = createMockClient();
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      await expect(adapter.rotateSecret('my-secret')).rejects.toThrow(SecretAccessError);
      await expect(adapter.rotateSecret('my-secret')).rejects.toThrow(
        /Cannot rotate secret.*without a new value/
      );
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when service is reachable (ResourceNotFoundException)', async () => {
      const client = createMockClient({
        describeSecret: vi.fn().mockRejectedValue(
          Object.assign(new Error('Not found'), { name: 'ResourceNotFoundException' })
        ),
      });
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.adapter).toBe('aws-kms');
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy on connection errors', async () => {
      const client = createMockClient({
        describeSecret: vi.fn().mockRejectedValue(new Error('Connection refused')),
      });
      const adapter = new AwsKmsSecretAdapter(defaultConfig, client);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.adapter).toBe('aws-kms');
      expect(health.error).toBe('Connection refused');
    });
  });
});
