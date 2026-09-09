/**
 * G-914 — photo blob store: StorageAdapter when a bucket is configured,
 * otherwise a local-disk fallback (and an in-memory impl for unit tests).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

import {
  createStorageAdapter,
  type StorageAdapter,
  type StorageAdapterConfig,
} from '@proctira/storage';

export interface StudentBlobStore {
  put(key: string, data: Buffer, contentType: string, tenantId: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  getSignedUrl?(key: string, expiresIn?: number): Promise<string | null>;
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
    } catch {
      return null;
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
    } catch {
      return null;
    }
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string | null> {
    try {
      return await this.adapter.getSignedUrl(key, expiresIn);
    } catch {
      return null;
    }
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
