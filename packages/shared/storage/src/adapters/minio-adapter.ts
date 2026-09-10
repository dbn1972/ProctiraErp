/**
 * MinIO storage adapter implementation.
 * MinIO is S3-compatible, so this adapter uses the AWS S3 SDK with
 * MinIO-specific configuration (path-style, custom endpoint).
 */

import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';

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
import { buildTenantKey } from '../tenant-namespace.js';

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
  private readonly signedUrlExpiry: number;
  private readonly endpoint: string;

  constructor(config: MinIOAdapterConfig) {
    this.bucket = config.bucket;
    this.defaultEncryption = config.defaultEncryption;
    this.signedUrlExpiry = config.signedUrlExpiry ?? 3600;
    this.endpoint = config.endpoint;

    const useSSL = config.useSSL ?? false;
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

    if (Buffer.isBuffer(data)) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: namespacedKey,
        Body: data,
        ContentType: options.contentType,
        Metadata: metadata,
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

  async download(key: string): Promise<Readable> {
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

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async getSignedUrl(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return awsGetSignedUrl(this.client, command, {
      expiresIn: expiresIn ?? this.signedUrlExpiry,
    });
  }

  async listObjects(prefix: string, options?: ListOptions): Promise<ListResult> {
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
      // MinIO supports SSE-KMS with its built-in KMS or external KMS
      return { ServerSideEncryption: 'aws:kms' };
    }

    return {};
  }
}
