/**
 * G-914 — photo blob store: StorageAdapter when a bucket is configured,
 * otherwise a local-disk fallback (and an in-memory impl for unit tests).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';

import { AppError } from '@proctira/common';
import {
  createStorageAdapter,
  type StorageAdapter,
  type StorageAdapterConfig,
} from '@proctira/storage';

/** PRC-L163: short-lived signed URLs for child documents/photos (5 minutes). */
export const SIGNED_URL_TTL_SECONDS = 300;

/**
 * PRC-L163: storage backend failure (not a missing object). Surfaces as 502
 * instead of being masked as 404. Message carries no object key (PII-safe).
 */
export class StudentBlobStorageError extends AppError {
  constructor(message = 'Document storage is unavailable') {
    super(message, 'STORAGE_UNAVAILABLE', 502);
  }
}

/** True when the adapter error means "object does not exist". */
export function isBlobNotFound(err: unknown): boolean {
  const e = err as {
    code?: string;
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e?.code === 'ENOENT' ||
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404 ||
    (typeof e?.message === 'string' && e.message.startsWith('Object not found'))
  );
}

export interface StudentBlobStore {
  put(key: string, data: Buffer, contentType: string, tenantId: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  getSignedUrl?(key: string, expiresIn?: number): Promise<string | null>;
  /**
   * PRC-M386: remove a blob (erasure / orphan compensation). Missing objects
   * are a no-op; backend failures throw {@link StudentBlobStorageError}.
   */
  delete(key: string): Promise<void>;
}

export class InMemoryStudentBlobStore implements StudentBlobStore {
  private readonly blobs = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<string> {
    this.blobs.set(key, Buffer.from(data));
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    const buf = this.blobs.get(key);
    return buf ? Buffer.from(buf) : null;
  }
  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}

export class LocalDiskStudentBlobStore implements StudentBlobStore {
  constructor(
    private readonly root = process.env['STUDENT_PHOTO_DIR'] ??
      join(tmpdir(), 'proctira-student-photos'),
  ) {}

  private pathFor(key: string): string {
    return join(this.root, key.replace(/\\/g, '/'));
  }

  async put(key: string, data: Buffer): Promise<string> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return key;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (err) {
      if (isBlobNotFound(err)) return null;
      throw new StudentBlobStorageError();
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key));
    } catch (err) {
      if (isBlobNotFound(err)) return;
      throw new StudentBlobStorageError();
    }
  }
}

export class StorageAdapterStudentBlobStore implements StudentBlobStore {
  constructor(private readonly adapter: StorageAdapter) {}

  async put(key: string, data: Buffer, contentType: string, tenantId: string): Promise<string> {
    const result = await this.adapter.upload(key, data, {
      tenantId,
      contentType,
      lifecycle: 'permanent',
    });
    return result.key;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const stream = await this.adapter.download(key);
      return await streamToBuffer(stream);
    } catch (err) {
      if (isBlobNotFound(err)) return null;
      throw new StudentBlobStorageError();
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.adapter.delete(key);
    } catch (err) {
      if (isBlobNotFound(err)) return;
      throw new StudentBlobStorageError();
    }
  }
  async getSignedUrl(key: string, expiresIn = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
    try {
      return await this.adapter.getSignedUrl(key, expiresIn);
    } catch {
      return null;
    }
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

function storageConfigFromEnv(): StorageAdapterConfig | null {
  const bucket = process.env['S3_BUCKET']?.trim();
  if (!bucket) return null;
  const endpoint = process.env['S3_ENDPOINT']?.trim();
  const accessKey = process.env['S3_ACCESS_KEY']?.trim() ?? '';
  const secretKey = process.env['S3_SECRET_KEY']?.trim() ?? '';
  const region = process.env['S3_REGION']?.trim() || 'us-east-1';
  if (endpoint) {
    return {
      adapter: 'minio',
      config: { endpoint, bucket, accessKey, secretKey, region },
    };
  }
  return {
    adapter: 's3',
    config: {
      bucket,
      region,
      accessKeyId: accessKey || undefined,
      secretAccessKey: secretKey || undefined,
    },
  };
}

export function createStudentBlobStore(): StudentBlobStore {
  const config = storageConfigFromEnv();
  if (config) {
    try {
      return new StorageAdapterStudentBlobStore(createStorageAdapter(config));
    } catch {
      return new LocalDiskStudentBlobStore();
    }
  }
  return new LocalDiskStudentBlobStore();
}
