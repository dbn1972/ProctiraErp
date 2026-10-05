/**
 * Scholarship document bytes. Reuses `@proctira/storage` (S3 / MinIO) when
 * S3_BUCKET is set — the same env contract as student photos — and a local
 * disk driver otherwise. In-memory is for unit tests.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';

import {
  createStorageAdapter,
  type StorageAdapter,
  type StorageAdapterConfig,
} from '@proctira/storage';

export interface ScholarshipDocumentBlobStore {
  put(key: string, data: Buffer, contentType: string, tenantId: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Present when the backend can mint a provider signed URL (S3/MinIO). */
  getSignedUrl?(key: string, expiresIn?: number): Promise<string | null>;
}

export class InMemoryScholarshipDocumentBlobStore implements ScholarshipDocumentBlobStore {
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

export class LocalDiskScholarshipDocumentBlobStore implements ScholarshipDocumentBlobStore {
  constructor(
    private readonly root = process.env['SCHOLARSHIP_DOCUMENT_DIR'] ??
      join(tmpdir(), 'proctira-scholarship-documents'),
  ) {}

  private pathFor(key: string): string {
    const safe = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (safe.split('/').some((seg) => seg === '..' || seg === '')) {
      throw new Error('Invalid document key');
    }
    return join(this.root, safe);
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
    } catch (error) {
      if (isMissingObjectError(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { rm } = await import('node:fs/promises');
    try {
      await rm(this.pathFor(key), { force: true });
    } catch {
      // Missing file is already deleted.
    }
  }
}

export class StorageAdapterScholarshipDocumentBlobStore implements ScholarshipDocumentBlobStore {
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
    } catch (error) {
      // PRC-M356: only a genuinely missing object is "no longer available";
      // provider/network failures propagate so callers answer 503, not 404.
      if (isMissingObjectError(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.adapter.delete(key);
  }

  async getSignedUrl(key: string, expiresIn = 120): Promise<string | null> {
    try {
      return await this.adapter.getSignedUrl(key, expiresIn);
    } catch {
      return null;
    }
  }
}

/** True for "object does not exist" errors from S3, MinIO, or local disk. */
export function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    name?: unknown;
    code?: unknown;
    Code?: unknown;
    message?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const codes = [e.name, e.code, e.Code].map((v) => (typeof v === 'string' ? v : ''));
  if (codes.some((c) => c === 'NoSuchKey' || c === 'NotFound' || c === 'ENOENT')) return true;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return typeof e.message === 'string' && e.message.startsWith('Object not found:');
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

export function createScholarshipDocumentBlobStore(): ScholarshipDocumentBlobStore {
  const config = storageConfigFromEnv();
  if (config) {
    try {
      return new StorageAdapterScholarshipDocumentBlobStore(createStorageAdapter(config));
    } catch {
      return new LocalDiskScholarshipDocumentBlobStore();
    }
  }
  return new LocalDiskScholarshipDocumentBlobStore();
}
