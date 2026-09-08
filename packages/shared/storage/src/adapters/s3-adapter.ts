/**
 * AWS S3 storage adapter implementation.
 * Provides tenant-aware object storage with encryption and lifecycle support.
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
  S3AdapterConfig,
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
 * AWS S3 adapter implementing the StorageAdapter interface.
 * Supports standard S3 features: encryption (AES-256, KMS), signed URLs,
 * lifecycle tagging, and tenant-aware key namespacing.
 */
export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly defaultEncryption?: EncryptionType;
  private readonly defaultKmsKeyId?: string;
  private readonly signedUrlExpiry: number;

  constructor(config: S3AdapterConfig) {
    this.bucket = config.bucket;
    this.defaultEncryption = config.defaultEncryption;
    this.defaultKmsKeyId = config.defaultKmsKeyId;
    this.signedUrlExpiry = config.signedUrlExpiry ?? 3600;

    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...(config.forcePathStyle && { forcePathStyle: config.forcePathStyle }),
      ...(config.accessKeyId &&
        config.secretAccessKey && {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }),
    });
  }

  async upload(
    key: string,
    data: Buffer | Readable,
    options: UploadOptions,
  ): Promise<StorageResult> {
    const namespacedKey = buildTenantKey(options.tenantId, key);
    const encryption = options.encryption ?? this.defaultEncryption;
    const kmsKeyId = options.kmsKeyId ?? this.defaultKmsKeyId;

    const metadata: Record<string, string> = {
      ...options.metadata,
    };

    if (options.lifecycle) {
      metadata[LIFECYCLE_TAG_KEY] = options.lifecycle;
    }

    // Use multipart upload for streams, simple put for buffers
    if (Buffer.isBuffer(data)) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: namespacedKey,
        Body: data,
        ContentType: options.contentType,
        Metadata: metadata,
        ...this.getEncryptionParams(encryption, kmsKeyId),
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
        ...this.getEncryptionParams(encryption, kmsKeyId),
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

    // AWS SDK v3 returns a web ReadableStream; convert to Node.js Readable
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
        message: `S3 bucket '${this.bucket}' is accessible`,
        latencyMs: Date.now() - start,
        adapter: 's3',
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        message: `S3 health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        latencyMs: Date.now() - start,
        adapter: 's3',
        checkedAt: new Date(),
      };
    }
  }

  /**
   * Build S3 encryption parameters based on the encryption type.
   */
  private getEncryptionParams(
    encryption?: EncryptionType,
    kmsKeyId?: string,
  ): Record<string, string | undefined> {
    if (!encryption) {
      return {};
    }

    if (encryption === 'AES256') {
      return { ServerSideEncryption: 'AES256' };
    }

    if (encryption === 'aws:kms') {
      return {
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: kmsKeyId,
      };
    }

    return {};
  }
}
