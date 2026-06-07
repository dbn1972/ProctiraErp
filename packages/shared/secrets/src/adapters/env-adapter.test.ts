import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvSecretAdapter } from './env-adapter.js';

describe('EnvSecretAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean up test env vars
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('SECRET_') || key.startsWith('TEST_PREFIX_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('SECRET_') || key.startsWith('TEST_PREFIX_')) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  describe('getSecret', () => {
    it('should return null when env var does not exist', async () => {
      const adapter = new EnvSecretAdapter();
      const result = await adapter.getSecret('nonexistent_key');
      expect(result).toBeNull();
    });

    it('should return the value when env var exists', async () => {
      process.env['SECRET_DATABASE_PASSWORD'] = 'my-db-pass';
      const adapter = new EnvSecretAdapter();
      const result = await adapter.getSecret('database_password');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('my-db-pass');
      expect(result!.metadata.key).toBe('database_password');
      expect(result!.metadata.version).toBe('env');
    });

    it('should normalize dots and dashes to underscores', async () => {
      process.env['SECRET_APP_JWT_SECRET'] = 'jwt-value';
      const adapter = new EnvSecretAdapter();
      const result = await adapter.getSecret('app.jwt.secret');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('jwt-value');
    });

    it('should normalize forward slashes to underscores', async () => {
      process.env['SECRET_AUTH_OAUTH_CLIENT_ID'] = 'client-123';
      const adapter = new EnvSecretAdapter();
      const result = await adapter.getSecret('auth/oauth/client-id');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('client-123');
    });

    it('should use custom prefix', async () => {
      process.env['TEST_PREFIX_MY_KEY'] = 'custom-value';
      const adapter = new EnvSecretAdapter({ prefix: 'TEST_PREFIX_' });
      const result = await adapter.getSecret('my_key');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('custom-value');
    });
  });

  describe('setSecret', () => {
    it('should set the environment variable', async () => {
      const adapter = new EnvSecretAdapter();
      const metadata = await adapter.setSecret('new_key', 'new-value');
      expect(process.env['SECRET_NEW_KEY']).toBe('new-value');
      expect(metadata.key).toBe('new_key');
      expect(metadata.version).toBe('env');
      expect(metadata.createdAt).toBeInstanceOf(Date);
    });

    it('should overwrite existing values', async () => {
      process.env['SECRET_EXISTING'] = 'old-value';
      const adapter = new EnvSecretAdapter();
      await adapter.setSecret('existing', 'new-value');
      expect(process.env['SECRET_EXISTING']).toBe('new-value');
    });
  });

  describe('rotateSecret', () => {
    it('should update the value when newValue is provided', async () => {
      process.env['SECRET_ROTATE_ME'] = 'old-value';
      const adapter = new EnvSecretAdapter();
      const result = await adapter.rotateSecret('rotate_me', { newValue: 'rotated-value' });
      expect(process.env['SECRET_ROTATE_ME']).toBe('rotated-value');
      expect(result.newVersion).toBe('env');
      expect(result.rotatedAt).toBeInstanceOf(Date);
    });

    it('should be a no-op when no newValue is provided', async () => {
      process.env['SECRET_KEEP_ME'] = 'original';
      const adapter = new EnvSecretAdapter();
      const result = await adapter.rotateSecret('keep_me');
      expect(process.env['SECRET_KEEP_ME']).toBe('original');
      expect(result.newVersion).toBe('env');
    });
  });

  describe('healthCheck', () => {
    it('should always return healthy', async () => {
      const adapter = new EnvSecretAdapter();
      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.adapter).toBe('env');
      expect(health.latencyMs).toBe(0);
    });
  });
});
