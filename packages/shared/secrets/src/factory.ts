/**
 * Secret Manager factory — creates the appropriate adapter based on configuration.
 *
 * The adapter is selected at install/bootstrap time and remains consistent
 * throughout the application lifecycle.
 */

import type { SecretManager, SecretManagerConfig } from './types.js';
import type { AwsSecretsManagerClient } from './adapters/aws-kms-adapter.js';
import type { VaultHttpClient } from './adapters/vault-adapter.js';
import { EnvSecretAdapter } from './adapters/env-adapter.js';
import { AwsKmsSecretAdapter } from './adapters/aws-kms-adapter.js';
import { VaultSecretAdapter } from './adapters/vault-adapter.js';

/**
 * External dependencies that must be provided for production adapters.
 * This avoids hard dependencies on AWS SDK or HTTP clients.
 */
export interface SecretManagerDependencies {
  /** AWS Secrets Manager client instance (required for 'aws-kms' adapter) */
  awsClient?: AwsSecretsManagerClient;
  /** HTTP client for Vault API calls (required for 'vault' adapter) */
  vaultHttpClient?: VaultHttpClient;
}

/**
 * Creates a SecretManager instance based on the provided configuration.
 *
 * @param config - Adapter selection and configuration
 * @param deps - External dependencies (AWS client, HTTP client)
 * @returns A configured SecretManager instance
 *
 * @throws Error if required configuration or dependencies are missing
 */
export function createSecretManager(
  config: SecretManagerConfig,
  deps: SecretManagerDependencies = {}
): SecretManager {
  switch (config.adapter) {
    case 'env':
      return new EnvSecretAdapter(config.env);

    case 'aws-kms': {
      if (!config.awsKms) {
        throw new Error(
          'AWS KMS configuration is required when using the aws-kms adapter'
        );
      }
      if (!deps.awsClient) {
        throw new Error(
          'AWS Secrets Manager client must be provided in dependencies for the aws-kms adapter'
        );
      }
      return new AwsKmsSecretAdapter(config.awsKms, deps.awsClient);
    }

    case 'vault': {
      if (!config.vault) {
        throw new Error(
          'Vault configuration is required when using the vault adapter'
        );
      }
      if (!deps.vaultHttpClient) {
        throw new Error(
          'Vault HTTP client must be provided in dependencies for the vault adapter'
        );
      }
      return new VaultSecretAdapter(config.vault, deps.vaultHttpClient);
    }

    default:
      throw new Error(
        `Unsupported secret manager adapter: ${config.adapter as string}`
      );
  }
}
