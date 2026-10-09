/**
 * MinIO storage adapter implementation.
 * MinIO is S3-compatible, so this adapter uses the AWS S3 SDK with
 * MinIO-specific configuration (path-style, custom endpoint).
 */

import type { Readable } from 'node:stream';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  assertTenantOwnedObjectKey,
  assertTenantScopedObjectKeyIfRequired,
  buildTenantKey,
  clampSignedUrlExpiry,
  isProductionEnv,
} from '../tenant-namespace.js';
import type {
  StorageAdapter,
  MinIOAdapterConfig,
  UploadOptions,
  StorageResult,
  ListOptions,
  ListResult,
  StorageObject,
  AdapterHealth,
  EncryptionType,
} from '../types.js';

/**
 * Lifecycle metadata tag key used to classify objects.
 */
const LIFECYCLE_TAG_KEY = 'x-proctira-lifecycle';

/**
 * MinIO adapter implementing the StorageAdapter interface.
 * Uses the AWS S3 SDK with path-style addressing and custom endpoint
 * to communicate with MinIO servers.
 */
export class MinIOAdapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultEncryption?: EncryptionType;
  private readonly defaultKmsKeyId?: string;
  private readonly signedUrlExpiry: number;
  private readonly endpoint: string;

  constructor(config: MinIOAdapterConfig) {
    this.bucket = config.bucket;
    this.defaultEncryption = config.defaultEncryption;
    this.defaultKmsKeyId = config.defaultKmsKeyId;
    this.signedUrlExpiry = config.signedUrlExpiry ?? 3600;
    this.endpoint = config.endpoint;

    const useSSL = config.useSSL ?? false;
    // PRC-M542: never ship tenant objects / credentials over plaintext HTTP in
    // production. useSSL defaults to false for local dev; refuse that default
    // (and an explicit false) when NODE_ENV is production.
    if (isProductionEnv() && !useSSL && !config.endpoint.startsWith('https')) {
      throw new Error(
        'MinIOAdapter: TLS is required in production — set useSSL=true or an https endpoint (PRC-M542)',
      );
    }
    const protocol = useSSL ? 'https' : 'http';
    const endpoint = config.endpoint.startsWith('http')
      ? config.endpoint
      : `${protocol}://${config.endpoint}`;

    this.client = new S3Client({
      region: config.region ?? 'us-east-1',
      endpoint,
      forcePathStyle: true, // Required for MinIO
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async upload(
    key: string,
    data: Buffer | Readable,
    options: UploadOptions,
  ): Promise<StorageResult> {
    const namespacedKey = buildTenantKey(options.tenantId, key);
    const encryption = options.encryption ?? this.defaultEncryption;

    const metadata: Record<string, string> = {
      ...options.metadata,
    };

    if (options.lifecycle) {
      metadata[LIFECYCLE_TAG_KEY] = options.lifecycle;
    }

    // PRC-M366: lifecycle (ILM) rules filter on object tags, not metadata. Set
    // the class as a tag so a MinIO/S3 ILM rule can expire/transition it.
    const tagging = options.lifecycle
      ? `${encodeURIComponent(LIFECYCLE_TAG_KEY)}=${encodeURIComponent(options.lifecycle)}`
      : undefined;

    if (Buffer.isBuffer(data)) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: namespacedKey,
        Body: data,
        ContentType: options.contentType,
        Metadata: metadata,
        ...(tagging ? { Tagging: tagging } : {}),
        ...this.getEncryptionParams(encryption),
      });

      const response = await this.client.send(command);

      return {
        key: namespacedKey,
        bucket: this.bucket,
        etag: response.ETag?.replace(/"/g, ''),
        versionId: response.VersionId,
        encryption,
        lifecycle: options.lifecycle,
      };
    }

    // Multipart upload for streams
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: namespacedKey,
        Body: data,
        ContentType: options.contentType,
        Metadata: metadata,
        ...(tagging ? { Tagging: tagging } : {}),
        ...this.getEncryptionParams(encryption),
      },
    });

    const response = await upload.done();

    return {
      key: namespacedKey,
      bucket: this.bucket,
      etag: response.ETag?.replace(/"/g, ''),
      versionId: response.VersionId,
      encryption,
      lifecycle: options.lifecycle,
    };
  }

  async download(key: string, callerTenantId?: string): Promise<Readable> {
    assertTenantScopedObjectKeyIfRequired(key, { surface: 'storage.download' });
    assertTenantOwnedObjectKey(key, callerTenantId, 'storage.download');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Object not found: ${key}`);
    }

    return response.Body as unknown as Readable;
  }

  async delete(key: string, callerTenantId?: string): Promise<void> {
    assertTenantScopedObjectKeyIfRequired(key, { surface: 'storage.delete' });
    assertTenantOwnedObjectKey(key, callerTenantId, 'storage.delete');
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async getSignedUrl(key: string, expiresIn?: number, callerTenantId?: string): Promise<string> {
    assertTenantScopedObjectKeyIfRequired(key, { surface: 'storage.getSignedUrl' });
    assertTenantOwnedObjectKey(key, callerTenantId, 'storage.getSignedUrl');
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return awsGetSignedUrl(this.client, command, {
      expiresIn: clampSignedUrlExpiry(expiresIn, this.signedUrlExpiry),
    });
  }

  async listObjects(
    prefix: string,
    options?: ListOptions,
    callerTenantId?: string,
  ): Promise<ListResult> {
    assertTenantScopedObjectKeyIfRequired(prefix, { surface: 'storage.listObjects' });
    assertTenantOwnedObjectKey(prefix, callerTenantId, 'storage.listObjects');
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: options?.maxKeys ?? 1000,
      ContinuationToken: options?.continuationToken,
      Delimiter: options?.delimiter,
    });

    const response = await this.client.send(command);

    const objects: StorageObject[] = (response.Contents ?? []).map((item) => ({
      key: item.Key ?? '',
      size: item.Size ?? 0,
      lastModified: item.LastModified ?? new Date(),
      etag: item.ETag?.replace(/"/g, ''),
      storageClass: item.StorageClass,
    }));

    return {
      objects,
      isTruncated: response.IsTruncated ?? false,
      nextContinuationToken: response.NextContinuationToken,
      commonPrefixes: response.CommonPrefixes?.map((p) => p.Prefix ?? '').filter(Boolean),
    };
  }

  async healthCheck(): Promise<AdapterHealth> {
    const start = Date.now();
    try {
      const command = new HeadBucketCommand({ Bucket: this.bucket });
      await this.client.send(command);

      return {
        healthy: true,
        message: `MinIO bucket '${this.bucket}' is accessible at ${this.endpoint}`,
        latencyMs: Date.now() - start,
        adapter: 'minio',
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        message: `MinIO health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        latencyMs: Date.now() - start,
        adapter: 'minio',
        checkedAt: new Date(),
      };
    }
  }

  /**
   * Build encryption parameters for MinIO.
   * MinIO supports SSE-S3 (AES-256) but KMS support depends on configuration.
   */
  private getEncryptionParams(encryption?: EncryptionType): Record<string, string | undefined> {
    if (!encryption) {
      return {};
    }

    if (encryption === 'AES256') {
      return { ServerSideEncryption: 'AES256' };
    }

    if (encryption === 'aws:kms') {
      // PRC-M542: SSE-KMS without a key id falls back to the bucket/default key
      // (or, on misconfigured MinIO, to no real KMS envelope at all). Forward the
      // configured key so KMS encryption actually uses the tenant-platform CMK,
      // matching the S3 adapter.
      return {
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: this.defaultKmsKeyId,
      };
    }

    return {};
  }
}
