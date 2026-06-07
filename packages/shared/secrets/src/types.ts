/**
 * Core types for the Secret Management adapter layer.
 *
 * These types define the contract that all secret management backends
 * (AWS KMS, HashiCorp Vault, environment variables) must implement.
 */

/**
 * Metadata associated with a stored secret.
 */
export interface SecretMetadata {
  /** Unique identifier for the secret */
  key: string;
  /** Version identifier (backend-specific) */
  version?: string;
  /** When the secret was created */
  createdAt?: Date;
  /** When the secret was last rotated */
  rotatedAt?: Date;
  /** Optional tags for categorization */
  tags?: Record<string, string>;
}

/**
 * Result of a getSecret operation.
 */
export interface SecretValue {
  /** The secret value (plaintext) */
  value: string;
  /** Metadata about the secret */
  metadata: SecretMetadata;
}

/**
 * Options for setting a secret.
 */
export interface SetSecretOptions {
  /** Optional description for the secret */
  description?: string;
  /** Optional tags for categorization */
  tags?: Record<string, string>;
  /** Optional TTL in seconds (if supported by backend) */
  ttlSeconds?: number;
}

/**
 * Options for rotating a secret.
 */
export interface RotateSecretOptions {
  /** The new secret value. If not provided, the backend may auto-generate one. */
  newValue?: string;
  /** Whether to invalidate the previous version immediately */
  invalidatePrevious?: boolean;
}

/**
 * Result of a rotateSecret operation.
 */
export interface RotateSecretResult {
  /** The new version identifier */
  newVersion: string;
  /** The previous version identifier */
  previousVersion?: string;
  /** When the rotation occurred */
  rotatedAt: Date;
}

/**
 * Health check result for the secret manager backend.
 */
export interface SecretManagerHealth {
  /** Whether the backend is reachable and operational */
  healthy: boolean;
  /** Backend adapter name */
  adapter: string;
  /** Optional latency in milliseconds */
  latencyMs?: number;
  /** Optional error message if unhealthy */
  error?: string;
}

/**
 * Configuration for the secret manager factory.
 */
export interface SecretManagerConfig {
  /** Which adapter to use */
  adapter: 'env' | 'aws-kms' | 'vault';
  /** AWS KMS configuration (required when adapter is 'aws-kms') */
  awsKms?: AwsKmsConfig;
  /** HashiCorp Vault configuration (required when adapter is 'vault') */
  vault?: VaultConfig;
  /** Environment variable configuration (required when adapter is 'env') */
  env?: EnvConfig;
}

/**
 * AWS KMS adapter configuration.
 */
export interface AwsKmsConfig {
  /** AWS region */
  region: string;
  /** KMS key ID or ARN for encryption */
  keyId: string;
  /** Optional AWS access key (falls back to SDK credential chain) */
  accessKeyId?: string;
  /** Optional AWS secret key (falls back to SDK credential chain) */
  secretAccessKey?: string;
  /** Optional endpoint override (for LocalStack/testing) */
  endpoint?: string;
}

/**
 * HashiCorp Vault adapter configuration.
 */
export interface VaultConfig {
  /** Vault server address */
  address: string;
  /** Authentication token */
  token: string;
  /** Secret engine mount path (default: 'secret') */
  mountPath?: string;
  /** Namespace (for Vault Enterprise) */
  namespace?: string;
  /** TLS CA certificate path (optional) */
  caCertPath?: string;
}

/**
 * Environment variable adapter configuration.
 */
export interface EnvConfig {
  /** Prefix for environment variable names (default: 'SECRET_') */
  prefix?: string;
  /** Path to .env file to load (optional) */
  envFilePath?: string;
}

/**
 * The core SecretManager interface that all adapters must implement.
 *
 * Security guarantees:
 * - Secret values are NEVER logged (toString/toJSON return redacted placeholders)
 * - Secret values are not exposed in stack traces or error messages
 * - Adapters must not cache secrets in plain text beyond the immediate return
 */
export interface SecretManager {
  /**
   * Retrieve a secret by its key.
   * @param key - The secret identifier
   * @returns The secret value and metadata, or null if not found
   */
  getSecret(key: string): Promise<SecretValue | null>;

  /**
   * Store or update a secret.
   * @param key - The secret identifier
   * @param value - The secret value to store
   * @param options - Optional settings for the secret
   */
  setSecret(key: string, value: string, options?: SetSecretOptions): Promise<SecretMetadata>;

  /**
   * Rotate a secret to a new value.
   * @param key - The secret identifier
   * @param options - Rotation options
   * @returns Rotation result with version information
   */
  rotateSecret(key: string, options?: RotateSecretOptions): Promise<RotateSecretResult>;

  /**
   * Check the health of the secret management backend.
   */
  healthCheck(): Promise<SecretManagerHealth>;
}
