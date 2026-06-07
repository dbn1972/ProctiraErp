/**
 * @proctira/secrets - Secret Management Adapter Layer
 *
 * Provides a unified interface for secret management across multiple backends:
 * - AWS KMS / Secrets Manager (production)
 * - HashiCorp Vault (production)
 * - Environment variables (local development)
 *
 * Security guarantees:
 * - Secrets are wrapped in RedactedSecret to prevent accidental logging
 * - toString/toJSON/inspect on secret values return '[REDACTED]'
 * - Secret values are never included in error messages or stack traces
 * - Adapters do not cache plaintext secrets beyond immediate return
 *
 * Charter: Section 27.1 (Baseline Controls)
 */

// Core interface and types
export type {
  SecretManager,
  SecretValue,
  SecretMetadata,
  SetSecretOptions,
  RotateSecretOptions,
  RotateSecretResult,
  SecretManagerHealth,
  SecretManagerConfig,
  AwsKmsConfig,
  VaultConfig,
  EnvConfig,
} from './types.js';

// Redacted secret wrapper
export { RedactedSecret, redact, isRedactedSecret } from './redacted-secret.js';

// Factory
export { createSecretManager } from './factory.js';
export type { SecretManagerDependencies } from './factory.js';

// Adapters (for direct use or testing)
export { EnvSecretAdapter } from './adapters/env-adapter.js';
export { AwsKmsSecretAdapter, SecretAccessError } from './adapters/aws-kms-adapter.js';
export type { AwsSecretsManagerClient } from './adapters/aws-kms-adapter.js';
export { VaultSecretAdapter } from './adapters/vault-adapter.js';
export type { VaultHttpClient, VaultRequestOptions, VaultResponse } from './adapters/vault-adapter.js';
