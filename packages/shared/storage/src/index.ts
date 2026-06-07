/**
 * @proctira/storage - Object Storage Adapter Layer
 *
 * Provides a unified interface for object storage operations with support for:
 * - AWS S3 (native)
 * - MinIO (S3-compatible, self-hosted)
 * - Tenant-aware object namespacing (tenants/{id}/ prefix)
 * - Server-side encryption (AES-256, KMS)
 * - Lifecycle management (temporary, permanent, archive)
 * - Health checks for monitoring
 */

// Core types
export type {
  StorageAdapter,
  UploadOptions,
  StorageResult,
  ListOptions,
  ListResult,
  StorageObject,
  AdapterHealth,
  EncryptionType,
  ObjectLifecycle,
  S3AdapterConfig,
  MinIOAdapterConfig,
  StorageAdapterConfig,
} from './types.js';

// Adapter implementations
export { S3Adapter } from './adapters/s3-adapter.js';
export { MinIOAdapter } from './adapters/minio-adapter.js';

// Factory
export { createStorageAdapter } from './factory.js';

// Tenant namespace utilities
export {
  buildTenantKey,
  buildTenantPrefix,
  extractTenantId,
  validateTenantOwnership,
} from './tenant-namespace.js';
