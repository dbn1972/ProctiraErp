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

// Malware scanning (topic 18: uploads are unusable until scanned clean)
export type {
  MalwareScanner,
  ScanResult,
  ScanStatus,
  ClamdScannerOptions,
} from './malware-scanner.js';
export {
  ClamdMalwareScanner,
  NoopMalwareScanner,
  UnavailableMalwareScanner,
  createMalwareScannerFromEnv,
  isUsableScanStatus,
  parseClamdReply,
} from './malware-scanner.js';

// Tenant namespace utilities
export {
  buildTenantKey,
  buildTenantPrefix,
  assertSafeTenantSegment,
  assertSafeObjectPath,
  extractTenantId,
  validateTenantOwnership,
  TenantScopeError,
  assertTenantId,
  assertTenantScopedObjectKey,
  assertTenantScopedObjectKeyIfRequired,
  assertTenantOwnedObjectKey,
  isTenantScopedObjectKey,
  isProductionEnv,
  isUnscopedTenantNamespaceAllowed,
  shouldRequireTenantScopedObjectKeys,
  clampSignedUrlExpiry,
  MAX_SIGNED_URL_EXPIRY_SECONDS,
  MIN_SIGNED_URL_EXPIRY_SECONDS,
} from './tenant-namespace.js';
