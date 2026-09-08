/**
 * HashiCorp Vault Secret Manager Adapter
 *
 * Uses Vault's KV v2 secrets engine for secret storage with versioning.
 * Supports token-based authentication and optional TLS configuration.
 *
 * This adapter:
 * - Reads/writes secrets via Vault's KV v2 HTTP API
 * - Supports secret versioning (each write creates a new version)
 * - Supports secret rotation with optional previous version invalidation
 * - Uses the configured mount path (default: 'secret')
 */

import type {
  SecretManager,
  SecretValue,
  SecretMetadata,
  SetSecretOptions,
  RotateSecretOptions,
  RotateSecretResult,
  SecretManagerHealth,
  VaultConfig,
} from '../types.js';
import { SecretAccessError } from './aws-kms-adapter.js';

/**
 * Minimal HTTP client interface for Vault API calls.
 * Allows dependency injection for testing without requiring a real HTTP client.
 */
export interface VaultHttpClient {
  request(options: VaultRequestOptions): Promise<VaultResponse>;
}

export interface VaultRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface VaultResponse {
  status: number;
  data: unknown;
}

/**
 * Vault KV v2 read response shape.
 */
interface VaultKvReadResponse {
  data?: {
    data?: Record<string, unknown>;
    metadata?: {
      version?: number;
      created_time?: string;
      destroyed?: boolean;
      deletion_time?: string;
    };
  };
}

/**
 * Vault KV v2 write response shape.
 */
interface VaultKvWriteResponse {
  data?: {
    version?: number;
    created_time?: string;
  };
}

export class VaultSecretAdapter implements SecretManager {
  private readonly config: VaultConfig;
  private readonly client: VaultHttpClient;
  private readonly mountPath: string;

  constructor(config: VaultConfig, client: VaultHttpClient) {
    this.config = config;
    this.client = client;
    this.mountPath = config.mountPath ?? 'secret';
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Vault-Token': this.config.token,
      'Content-Type': 'application/json',
    };
    if (this.config.namespace) {
      headers['X-Vault-Namespace'] = this.config.namespace;
    }
    return headers;
  }

  private buildPath(operation: 'data' | 'metadata' | 'destroy', key: string): string {
    return `/v1/${this.mountPath}/${operation}/${key}`;
  }

  async getSecret(key: string): Promise<SecretValue | null> {
    try {
      const response = await this.client.request({
        method: 'GET',
        path: this.buildPath('data', key),
        headers: this.buildHeaders(),
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status !== 200) {
        throw new SecretAccessError(`Vault returned status ${response.status} for secret '${key}'`);
      }

      const body = response.data as VaultKvReadResponse;
      const secretData = body?.data?.data;
      const metadata = body?.data?.metadata;

      if (!secretData || metadata?.destroyed) {
        return null;
      }

      // Convention: the secret value is stored under the 'value' key
      const value = secretData['value'];
      if (typeof value !== 'string') {
        return null;
      }

      return {
        value,
        metadata: {
          key,
          version: metadata?.version?.toString(),
          createdAt: metadata?.created_time ? new Date(metadata.created_time) : undefined,
        },
      };
    } catch (error: unknown) {
      if (error instanceof SecretAccessError) throw error;
      throw new SecretAccessError(`Failed to retrieve secret '${key}' from Vault`, {
        cause: error,
      });
    }
  }

  async setSecret(key: string, value: string, options?: SetSecretOptions): Promise<SecretMetadata> {
    try {
      const payload: Record<string, unknown> = {
        data: {
          value,
          ...(options?.description && { _description: options.description }),
          ...(options?.tags && { _tags: options.tags }),
        },
      };

      const response = await this.client.request({
        method: 'POST',
        path: this.buildPath('data', key),
        headers: this.buildHeaders(),
        body: payload,
      });

      if (response.status !== 200 && response.status !== 204) {
        throw new SecretAccessError(
          `Vault returned status ${response.status} when setting secret '${key}'`,
        );
      }

      const body = response.data as VaultKvWriteResponse;

      return {
        key,
        version: body?.data?.version?.toString(),
        createdAt: body?.data?.created_time ? new Date(body.data.created_time) : new Date(),
      };
    } catch (error: unknown) {
      if (error instanceof SecretAccessError) throw error;
      throw new SecretAccessError(`Failed to set secret '${key}' in Vault`, { cause: error });
    }
  }

  async rotateSecret(key: string, options?: RotateSecretOptions): Promise<RotateSecretResult> {
    // Get current version before rotation
    let previousVersion: string | undefined;
    try {
      const current = await this.getSecret(key);
      previousVersion = current?.metadata.version;
    } catch {
      // Continue with rotation even if we can't get the previous version
    }

    if (!options?.newValue) {
      throw new SecretAccessError(
        `Cannot rotate secret '${key}' without a new value (Vault adapter does not auto-generate secrets)`,
      );
    }

    // Write the new version
    const metadata = await this.setSecret(key, options.newValue);

    // Optionally destroy the previous version
    if (options?.invalidatePrevious && previousVersion) {
      try {
        await this.client.request({
          method: 'POST',
          path: this.buildPath('destroy', key),
          headers: this.buildHeaders(),
          body: { versions: [parseInt(previousVersion, 10)] },
        });
      } catch {
        // Non-fatal: rotation succeeded even if previous version destruction fails
      }
    }

    return {
      newVersion: metadata.version ?? 'unknown',
      previousVersion,
      rotatedAt: new Date(),
    };
  }

  async healthCheck(): Promise<SecretManagerHealth> {
    const start = Date.now();
    try {
      const response = await this.client.request({
        method: 'GET',
        path: '/v1/sys/health',
        headers: this.buildHeaders(),
      });

      const healthy = response.status === 200 || response.status === 429;

      return {
        healthy,
        adapter: 'vault',
        latencyMs: Date.now() - start,
        ...(!healthy && { error: `Vault health check returned status ${response.status}` }),
      };
    } catch (error: unknown) {
      return {
        healthy: false,
        adapter: 'vault',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
