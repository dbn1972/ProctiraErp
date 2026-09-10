/**
 * AWS KMS / Secrets Manager Adapter
 *
 * Uses AWS Secrets Manager for secret storage and AWS KMS for encryption.
 * Supports automatic credential resolution via the AWS SDK credential chain
 * (environment variables, IAM roles, instance profiles, etc.).
 *
 * This adapter:
 * - Stores secrets in AWS Secrets Manager
 * - Encrypts secrets using the specified KMS key
 * - Supports secret versioning and rotation
 * - Falls back to AWS SDK default credential resolution
 */

import type {
  SecretManager,
  SecretValue,
  SecretMetadata,
  SetSecretOptions,
  RotateSecretOptions,
  RotateSecretResult,
  SecretManagerHealth,
  AwsKmsConfig,
} from '../types.js';

/**
 * Minimal interface for AWS Secrets Manager client operations.
 * This allows dependency injection for testing without requiring the full AWS SDK.
 */
export interface AwsSecretsManagerClient {
  getSecretValue(params: { SecretId: string; VersionStage?: string }): Promise<{
    SecretString?: string;
    VersionId?: string;
    CreatedDate?: Date;
    Name?: string;
  }>;
  createSecret(params: {
    Name: string;
    SecretString: string;
    KmsKeyId?: string;
    Description?: string;
    Tags?: Array<{ Key: string; Value: string }>;
  }): Promise<{ ARN?: string; Name?: string; VersionId?: string }>;
  putSecretValue(params: {
    SecretId: string;
    SecretString: string;
    VersionStages?: string[];
  }): Promise<{ VersionId?: string; Name?: string }>;
  updateSecret(params: {
    SecretId: string;
    SecretString: string;
    KmsKeyId?: string;
  }): Promise<{ VersionId?: string; Name?: string }>;
  describeSecret(params: { SecretId: string }): Promise<{
    Name?: string;
    LastRotatedDate?: Date;
    CreatedDate?: Date;
    VersionIdsToStages?: Record<string, string[]>;
  }>;
}

export class AwsKmsSecretAdapter implements SecretManager {
  private readonly config: AwsKmsConfig;
  private readonly client: AwsSecretsManagerClient;

  constructor(config: AwsKmsConfig, client: AwsSecretsManagerClient) {
    this.config = config;
    this.client = client;
  }

  async getSecret(key: string): Promise<SecretValue | null> {
    try {
      const response = await this.client.getSecretValue({
        SecretId: key,
        VersionStage: 'AWSCURRENT',
      });

      if (!response.SecretString) {
        return null;
      }

      return {
        value: response.SecretString,
        metadata: {
          key,
          version: response.VersionId,
          createdAt: response.CreatedDate,
        },
      };
    } catch (error: unknown) {
      if (isResourceNotFoundError(error)) {
        return null;
      }
      throw new SecretAccessError(`Failed to retrieve secret '${key}' from AWS Secrets Manager`, {
        cause: error,
      });
    }
  }

  async setSecret(key: string, value: string, options?: SetSecretOptions): Promise<SecretMetadata> {
    try {
      // Try to update existing secret first
      const response = await this.client.updateSecret({
        SecretId: key,
        SecretString: value,
        KmsKeyId: this.config.keyId,
      });

      return {
        key,
        version: response.VersionId,
        createdAt: new Date(),
      };
    } catch (error: unknown) {
      if (isResourceNotFoundError(error)) {
        // Secret doesn't exist, create it
        const tags = options?.tags
          ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value }))
          : undefined;

        const response = await this.client.createSecret({
          Name: key,
          SecretString: value,
          KmsKeyId: this.config.keyId,
          Description: options?.description,
          Tags: tags,
        });

        return {
          key,
          version: response.VersionId,
          createdAt: new Date(),
        };
      }
      throw new SecretAccessError(`Failed to set secret '${key}' in AWS Secrets Manager`, {
        cause: error,
      });
    }
  }

  async rotateSecret(key: string, options?: RotateSecretOptions): Promise<RotateSecretResult> {
    // Get current version before rotation
    let previousVersion: string | undefined;
    try {
      const description = await this.client.describeSecret({ SecretId: key });
      if (description.VersionIdsToStages) {
        previousVersion = Object.entries(description.VersionIdsToStages).find(([, stages]) =>
          stages.includes('AWSCURRENT'),
        )?.[0];
      }
    } catch {
      // If we can't get the previous version, continue with rotation
    }

    if (!options?.newValue) {
      throw new SecretAccessError(
        `Cannot rotate secret '${key}' without a new value (AWS KMS adapter does not auto-generate secrets)`,
      );
    }

    const response = await this.client.putSecretValue({
      SecretId: key,
      SecretString: options.newValue,
      VersionStages: ['AWSCURRENT'],
    });

    return {
      newVersion: response.VersionId ?? 'unknown',
      previousVersion,
      rotatedAt: new Date(),
    };
  }

  async healthCheck(): Promise<SecretManagerHealth> {
    const start = Date.now();
    try {
      // Use a lightweight operation to check connectivity
      await this.client.describeSecret({ SecretId: '__health_check_probe__' });
      return {
        healthy: true,
        adapter: 'aws-kms',
        latencyMs: Date.now() - start,
      };
    } catch (error: unknown) {
      // ResourceNotFoundException is expected — it means the service is reachable
      if (isResourceNotFoundError(error)) {
        return {
          healthy: true,
          adapter: 'aws-kms',
          latencyMs: Date.now() - start,
        };
      }
      return {
        healthy: false,
        adapter: 'aws-kms',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Error thrown when a secret operation fails.
 * Never includes the secret value in the error message.
 */
export class SecretAccessError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SecretAccessError';
  }
}

function isResourceNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { name?: string; code?: string; __type?: string };
    return (
      err.name === 'ResourceNotFoundException' ||
      err.code === 'ResourceNotFoundException' ||
      err.__type === 'ResourceNotFoundException'
    );
  }
  return false;
}
