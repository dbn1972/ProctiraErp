/**
 * Environment Variable Secret Manager Adapter
 *
 * A simple adapter that reads secrets from environment variables.
 * Intended for local development and testing environments.
 *
 * Secret keys are mapped to environment variables using a configurable prefix.
 * For example, with prefix 'SECRET_', the key 'database_password' maps to
 * the environment variable 'SECRET_DATABASE_PASSWORD'.
 *
 * Limitations:
 * - rotateSecret is a no-op (env vars cannot be rotated at runtime)
 * - setSecret only updates the in-memory process.env (not persistent)
 * - No versioning support
 */

import type {
  SecretManager,
  SecretValue,
  SecretMetadata,
  SetSecretOptions,
  RotateSecretOptions,
  RotateSecretResult,
  SecretManagerHealth,
  EnvConfig,
} from '../types.js';

const DEFAULT_PREFIX = 'SECRET_';

export class EnvSecretAdapter implements SecretManager {
  private readonly prefix: string;

  constructor(config: EnvConfig = {}) {
    this.prefix = config.prefix ?? DEFAULT_PREFIX;
  }

  /**
   * Converts a secret key to the corresponding environment variable name.
   * Example: 'database.password' → 'SECRET_DATABASE_PASSWORD'
   */
  private toEnvKey(key: string): string {
    const normalized = key
      .replace(/[.\-/]/g, '_')
      .toUpperCase();
    return `${this.prefix}${normalized}`;
  }

  async getSecret(key: string): Promise<SecretValue | null> {
    const envKey = this.toEnvKey(key);
    const value = process.env[envKey];

    if (value === undefined) {
      return null;
    }

    return {
      value,
      metadata: {
        key,
        version: 'env',
      },
    };
  }

  async setSecret(key: string, value: string, _options?: SetSecretOptions): Promise<SecretMetadata> {
    const envKey = this.toEnvKey(key);
    process.env[envKey] = value;

    return {
      key,
      version: 'env',
      createdAt: new Date(),
    };
  }

  async rotateSecret(key: string, options?: RotateSecretOptions): Promise<RotateSecretResult> {
    if (options?.newValue) {
      await this.setSecret(key, options.newValue);
    }

    return {
      newVersion: 'env',
      previousVersion: 'env',
      rotatedAt: new Date(),
    };
  }

  async healthCheck(): Promise<SecretManagerHealth> {
    return {
      healthy: true,
      adapter: 'env',
      latencyMs: 0,
    };
  }
}
