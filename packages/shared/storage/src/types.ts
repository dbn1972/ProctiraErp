/**
 * Core type definitions for the Object Storage Adapter layer.
 * Supports AWS S3 and MinIO (S3-compatible) backends with
 * tenant-aware namespacing, encryption, and lifecycle management.
 */

import type { Readable } from 'node:stream';

/**
 * Encryption algorithms supported for object storage.
 */
export type EncryptionType = 'AES256' | 'aws:kms';

/**
 * Lifecycle classification for stored objects.
 * - temporary: Auto-deleted after configured TTL (e.g., upload previews)
 * - permanent: Standard storage, retained indefinitely
 * - archive: Moved to cold storage tier after configured period
 */
export type ObjectLifecycle = 'temporary' | 'permanent' | 'archive';

/**
 * Options for uploading an object to storage.
 */
export interface UploadOptions {
  /** MIME content type of the object */
  contentType?: string;
  /** Tenant ID — enforces tenant namespace prefix */
  tenantId: string;
  /** Server-side encryption algorithm */
  encryption?: EncryptionType;
  /** KMS key ID (required when encryption is 'aws:kms') */
  kmsKeyId?: string;
  /** Custom metadata key-value pairs */
  metadata?: Record<string, string>;
  /** Lifecycle classification for the object */
  lifecycle?: ObjectLifecycle;
}

/**
 * Result returned after a successful upload.
 */
export interface StorageResult {
  /** The full key (including tenant prefix) where the object was stored */
  key: string;
  /** The bucket name */
  bucket: string;
  /** ETag of the uploaded object */
  etag?: string;
  /** Version ID (if versioning is enabled) */
  versionId?: string;
  /** The encryption algorithm applied */
  encryption?: EncryptionType;
  /** The lifecycle classification applied */
  lifecycle?: ObjectLifecycle;
}

/**
 * Options for listing objects in storage.
 */
export interface ListOptions {
  /** Maximum number of objects to return (default: 1000) */
  maxKeys?: number;
  /** Continuation token for pagination */
  continuationToken?: string;
  /** Delimiter for grouping (e.g., '/') */
  delimiter?: string;
}

/**
 * Represents a single object in storage.
 */
export interface StorageObject {
  /** Object key (full path including tenant prefix) */
  key: string;
  /** Size in bytes */
  size: number;
  /** Last modified timestamp */
  lastModified: Date;
  /** ETag of the object */
  etag?: string;
  /** Storage class (STANDARD, GLACIER, etc.) */
  storageClass?: string;
}

/**
 * Result of listing objects, supporting pagination.
 */
export interface ListResult {
  /** Objects matching the prefix */
  objects: StorageObject[];
  /** Whether there are more results */
  isTruncated: boolean;
  /** Token to use for fetching the next page */
  nextContinuationToken?: string;
  /** Common prefixes (when delimiter is used) */
  commonPrefixes?: string[];
}

/**
 * Health check result for a storage adapter.
 */
export interface AdapterHealth {
  /** Whether the adapter is healthy and can serve requests */
  healthy: boolean;
  /** Human-readable status message */
  message: string;
  /** Response time in milliseconds */
  latencyMs: number;
  /** Adapter implementation name */
  adapter: string;
  /** Timestamp of the health check */
  checkedAt: Date;
}

/**
 * Configuration for the S3 adapter.
 */
export interface S3AdapterConfig {
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region: string;
  /** Optional custom endpoint URL (for S3-compatible services) */
  endpoint?: string;
  /** AWS access key ID (optional if using IAM roles) */
  accessKeyId?: string;
  /** AWS secret access key (optional if using IAM roles) */
  secretAccessKey?: string;
  /** Force path-style addressing (required for MinIO) */
  forcePathStyle?: boolean;
  /** Default encryption for all uploads */
  defaultEncryption?: EncryptionType;
  /** Default KMS key ID for KMS encryption */
  defaultKmsKeyId?: string;
  /** Signed URL expiration in seconds (default: 3600) */
  signedUrlExpiry?: number;
}

/**
 * Configuration for the MinIO adapter.
 */
export interface MinIOAdapterConfig {
  /** MinIO endpoint URL (e.g., 'http://localhost:9000') */
  endpoint: string;
  /** MinIO access key */
  accessKey: string;
  /** MinIO secret key */
  secretKey: string;
  /** Bucket name */
  bucket: string;
  /** Region (default: 'us-east-1') */
  region?: string;
  /** Use SSL/TLS (default: false for local dev) */
  useSSL?: boolean;
  /** Default encryption for all uploads */
  defaultEncryption?: EncryptionType;
  /** Signed URL expiration in seconds (default: 3600) */
  signedUrlExpiry?: number;
}

/**
 * Union configuration for creating a storage adapter via factory.
 */
export type StorageAdapterConfig =
  | { adapter: 's3'; config: S3AdapterConfig }
  | { adapter: 'minio'; config: MinIOAdapterConfig };

/**
 * The core StorageAdapter interface that all implementations must satisfy.
 * All operations are tenant-aware — objects are namespaced under tenants/{id}/.
 */
export interface StorageAdapter {
  /**
   * Upload an object to storage.
   * The key will be prefixed with the tenant namespace: tenants/{tenantId}/{key}
   */
  upload(key: string, data: Buffer | Readable, options: UploadOptions): Promise<StorageResult>;

  /**
   * Download an object from storage.
   * The key should be the full namespaced key (as returned by upload).
   */
  download(key: string): Promise<Readable>;

  /**
   * Delete an object from storage.
   * The key should be the full namespaced key.
   */
  delete(key: string): Promise<void>;

  /**
   * Generate a pre-signed URL for temporary access to an object.
   * @param key - The full namespaced key
   * @param expiresIn - Expiration time in seconds
   */
  getSignedUrl(key: string, expiresIn: number): Promise<string>;

  /**
   * List objects under a given prefix.
   * @param prefix - The prefix to list (should include tenant namespace)
   * @param options - Pagination and filtering options
   */
  listObjects(prefix: string, options?: ListOptions): Promise<ListResult>;

  /**
   * Check the health of the storage backend.
   */
  healthCheck(): Promise<AdapterHealth>;
}
