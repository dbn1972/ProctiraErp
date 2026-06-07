import { describe, it, expect, vi } from 'vitest';
import { VaultSecretAdapter } from './vault-adapter.js';
import type { VaultHttpClient, VaultResponse } from './vault-adapter.js';
import type { VaultConfig } from '../types.js';
import { SecretAccessError } from './aws-kms-adapter.js';

function createMockVaultClient(
  handler?: (options: { method: string; path: string; body?: unknown }) => VaultResponse
): VaultHttpClient {
  return {
    request: vi.fn().mockImplementation((options) => {
      if (handler) {
        return Promise.resolve(handler(options));
      }
      return Promise.resolve({ status: 200, data: {} });
    }),
  };
}

const defaultConfig: VaultConfig = {
  address: 'http://localhost:8200',
  token: 'test-token',
  mountPath: 'secret',
};

describe('VaultSecretAdapter', () => {
  describe('getSecret', () => {
    it('should return the secret value from Vault KV v2', async () => {
      const client = createMockVaultClient(() => ({
        status: 200,
        data: {
          data: {
            data: { value: 'my-vault-secret' },
            metadata: {
              version: 3,
              created_time: '2024-01-15T10:00:00Z',
              destroyed: false,
            },
          },
        },
      }));
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const result = await adapter.getSecret('app/database');

      expect(result).not.toBeNull();
      expect(result!.value).toBe('my-vault-secret');
      expect(result!.metadata.key).toBe('app/database');
      expect(result!.metadata.version).toBe('3');
      expect(client.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/v1/secret/data/app/database',
        headers: {
          'X-Vault-Token': 'test-token',
          'Content-Type': 'application/json',
        },
      });
    });

    it('should return null when secret is not found (404)', async () => {
      const client = createMockVaultClient(() => ({
        status: 404,
        data: null,
      }));
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const result = await adapter.getSecret('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when secret is destroyed', async () => {
      const client = createMockVaultClient(() => ({
        status: 200,
        data: {
          data: {
            data: { value: 'destroyed-secret' },
            metadata: { version: 1, destroyed: true },
          },
        },
      }));
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const result = await adapter.getSecret('destroyed-key');
      expect(result).toBeNull();
    });

    it('should include namespace header when configured', async () => {
      const configWithNs: VaultConfig = {
        ...defaultConfig,
        namespace: 'my-org',
      };
      const client = createMockVaultClient(() => ({
        status: 200,
        data: { data: { data: { value: 'ns-secret' }, metadata: { version: 1 } } },
      }));
      const adapter = new VaultSecretAdapter(configWithNs, client);

      await adapter.getSecret('key');

      expect(client.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Vault-Namespace': 'my-org',
          }),
        })
      );
    });

    it('should throw SecretAccessError on non-404 errors', async () => {
      const client = createMockVaultClient(() => ({
        status: 500,
        data: { errors: ['internal error'] },
      }));
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      await expect(adapter.getSecret('key')).rejects.toThrow(SecretAccessError);
    });

    it('should throw SecretAccessError on network errors', async () => {
      const client: VaultHttpClient = {
        request: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      await expect(adapter.getSecret('key')).rejects.toThrow(SecretAccessError);
    });
  });

  describe('setSecret', () => {
    it('should write a secret to Vault KV v2', async () => {
      const client = createMockVaultClient((options) => {
        if (options.method === 'POST') {
          return {
            status: 200,
            data: { data: { version: 2, created_time: '2024-01-15T12:00:00Z' } },
          };
        }
        return { status: 200, data: {} };
      });
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const metadata = await adapter.setSecret('app/api-key', 'new-api-key', {
        description: 'API key for external service',
        tags: { service: 'payment' },
      });

      expect(metadata.key).toBe('app/api-key');
      expect(metadata.version).toBe('2');
      expect(client.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/v1/secret/data/app/api-key',
          body: {
            data: {
              value: 'new-api-key',
              _description: 'API key for external service',
              _tags: { service: 'payment' },
            },
          },
        })
      );
    });

    it('should throw SecretAccessError on write failure', async () => {
      const client = createMockVaultClient(() => ({
        status: 403,
        data: { errors: ['permission denied'] },
      }));
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      await expect(adapter.setSecret('key', 'value')).rejects.toThrow(SecretAccessError);
    });
  });

  describe('rotateSecret', () => {
    it('should rotate the secret and return version info', async () => {
      let callCount = 0;
      const client = createMockVaultClient((options) => {
        callCount++;
        if (options.method === 'GET' && options.path.includes('/data/')) {
          return {
            status: 200,
            data: {
              data: {
                data: { value: 'old-value' },
                metadata: { version: 1, created_time: '2024-01-01T00:00:00Z' },
              },
            },
          };
        }
        if (options.method === 'POST' && options.path.includes('/data/')) {
          return {
            status: 200,
            data: { data: { version: 2, created_time: '2024-01-15T12:00:00Z' } },
          };
        }
        return { status: 200, data: {} };
      });
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const result = await adapter.rotateSecret('my-key', { newValue: 'rotated-value' });

      expect(result.newVersion).toBe('2');
      expect(result.previousVersion).toBe('1');
      expect(result.rotatedAt).toBeInstanceOf(Date);
    });

    it('should destroy previous version when invalidatePrevious is true', async () => {
      const client = createMockVaultClient((options) => {
        if (options.method === 'GET' && options.path.includes('/data/')) {
          return {
            status: 200,
            data: {
              data: {
                data: { value: 'old' },
                metadata: { version: 5 },
              },
            },
          };
        }
        if (options.method === 'POST' && options.path.includes('/data/')) {
          return { status: 200, data: { data: { version: 6 } } };
        }
        if (options.method === 'POST' && options.path.includes('/destroy/')) {
          return { status: 204, data: {} };
        }
        return { status: 200, data: {} };
      });
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      await adapter.rotateSecret('my-key', {
        newValue: 'new-value',
        invalidatePrevious: true,
      });

      // Verify destroy was called
      expect(client.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/v1/secret/destroy/my-key',
          body: { versions: [5] },
        })
      );
    });

    it('should throw when no newValue is provided', async () => {
      const client = createMockVaultClient();
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      await expect(adapter.rotateSecret('key')).rejects.toThrow(SecretAccessError);
      await expect(adapter.rotateSecret('key')).rejects.toThrow(
        /Cannot rotate secret.*without a new value/
      );
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when Vault responds with 200', async () => {
      const client = createMockVaultClient((options) => {
        if (options.path === '/v1/sys/health') {
          return { status: 200, data: { initialized: true, sealed: false } };
        }
        return { status: 200, data: {} };
      });
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.adapter).toBe('vault');
    });

    it('should return healthy when Vault responds with 429 (standby)', async () => {
      const client = createMockVaultClient((options) => {
        if (options.path === '/v1/sys/health') {
          return { status: 429, data: { initialized: true, sealed: false, standby: true } };
        }
        return { status: 200, data: {} };
      });
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it('should return unhealthy when Vault is sealed (503)', async () => {
      const client = createMockVaultClient((options) => {
        if (options.path === '/v1/sys/health') {
          return { status: 503, data: { initialized: true, sealed: true } };
        }
        return { status: 200, data: {} };
      });
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.error).toContain('503');
    });

    it('should return unhealthy on connection errors', async () => {
      const client: VaultHttpClient = {
        request: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };
      const adapter = new VaultSecretAdapter(defaultConfig, client);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.error).toBe('ECONNREFUSED');
    });
  });
});
