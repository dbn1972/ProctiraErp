/**
 * Scholarship document storage.
 *
 * Prefer MinIO via `@proctira/storage` when MINIO_* env is configured;
 * otherwise write under `uploads/scholarships/` on local disk and return a
 * stable URL path.
 */
import { createStorageAdapter, type StorageAdapter } from '@proctira/storage';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface StoredScholarshipDocument {
  id: string;
  tenantId: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileUrl: string;
  content: Buffer;
  createdAt: Date;
}

export interface ScholarshipDocumentStore {
  put(input: {
    tenantId: string;
    documentType: string;
    fileName: string;
    mimeType?: string;
    content: Buffer;
  }): Promise<StoredScholarshipDocument>;
  get(id: string, tenantId: string): Promise<StoredScholarshipDocument | null>;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'document.bin';
}

function createMinioAdapterOrNull(): StorageAdapter | null {
  const endPoint = process.env['MINIO_ENDPOINT'] ?? process.env['STORAGE_MINIO_ENDPOINT'];
  const accessKey = process.env['MINIO_ACCESS_KEY'] ?? process.env['STORAGE_MINIO_ACCESS_KEY'];
  const secretKey = process.env['MINIO_SECRET_KEY'] ?? process.env['STORAGE_MINIO_SECRET_KEY'];
  const bucket = process.env['MINIO_BUCKET'] ?? process.env['STORAGE_MINIO_BUCKET'] ?? 'proctira';
  if (!endPoint || !accessKey || !secretKey) return null;

  try {
    const normalized = endPoint.includes('://') ? endPoint : `http://${endPoint}`;
    return createStorageAdapter({
      adapter: 'minio',
      config: {
        endpoint: normalized,
        accessKey,
        secretKey,
        bucket,
        useSSL: normalized.startsWith('https://'),
      },
    });
  } catch {
    return null;
  }
}

/**
 * Disk-backed store under uploads/ (dev / when MinIO is not configured).
 */
export class LocalDiskScholarshipDocumentStore implements ScholarshipDocumentStore {
  private readonly rootDir: string;
  private readonly meta = new Map<string, Omit<StoredScholarshipDocument, 'content'>>();

  constructor(rootDir = join(process.cwd(), 'uploads', 'scholarships')) {
    this.rootDir = rootDir;
  }

  async put(input: {
    tenantId: string;
    documentType: string;
    fileName: string;
    mimeType?: string;
    content: Buffer;
  }): Promise<StoredScholarshipDocument> {
    const id = randomUUID();
    const safeName = sanitizeFileName(input.fileName);
    const relativeKey = `${input.tenantId}/${id}-${safeName}`;
    const absolutePath = join(this.rootDir, relativeKey);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.content);

    const fileUrl = `/uploads/scholarships/${relativeKey}`;
    const stored: StoredScholarshipDocument = {
      id,
      tenantId: input.tenantId,
      documentType: input.documentType,
      fileName: input.fileName,
      mimeType: input.mimeType ?? 'application/octet-stream',
      fileSize: input.content.byteLength,
      fileUrl,
      content: input.content,
      createdAt: new Date(),
    };
    this.meta.set(`${input.tenantId}:${id}`, {
      id: stored.id,
      tenantId: stored.tenantId,
      documentType: stored.documentType,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      fileUrl: stored.fileUrl,
      createdAt: stored.createdAt,
    });
    return stored;
  }

  async get(id: string, tenantId: string): Promise<StoredScholarshipDocument | null> {
    const meta = this.meta.get(`${tenantId}:${id}`);
    if (!meta) return null;
    const absolutePath = join(
      this.rootDir,
      meta.fileUrl.replace(/^\/uploads\/scholarships\//, ''),
    );
    try {
      const content = await readFile(absolutePath);
      return { ...meta, content };
    } catch {
      return null;
    }
  }
}

/**
 * MinIO-backed store using @proctira/storage.
 */
export class MinioScholarshipDocumentStore implements ScholarshipDocumentStore {
  private readonly adapter: StorageAdapter;
  private readonly meta = new Map<string, Omit<StoredScholarshipDocument, 'content'>>();

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  async put(input: {
    tenantId: string;
    documentType: string;
    fileName: string;
    mimeType?: string;
    content: Buffer;
  }): Promise<StoredScholarshipDocument> {
    const id = randomUUID();
    const safeName = sanitizeFileName(input.fileName);
    const key = `scholarships/${id}-${safeName}`;
    const result = await this.adapter.upload(key, input.content, {
      tenantId: input.tenantId,
      contentType: input.mimeType ?? 'application/octet-stream',
      lifecycle: 'permanent',
      metadata: {
        documentType: input.documentType,
        fileName: input.fileName,
      },
    });

    const publicBase =
      process.env['MINIO_PUBLIC_URL'] ??
      process.env['STORAGE_PUBLIC_URL'] ??
      '';
    const fileUrl = publicBase
      ? `${publicBase.replace(/\/$/, '')}/${result.key}`
      : `minio://${result.bucket}/${result.key}`;

    const stored: StoredScholarshipDocument = {
      id,
      tenantId: input.tenantId,
      documentType: input.documentType,
      fileName: input.fileName,
      mimeType: input.mimeType ?? 'application/octet-stream',
      fileSize: input.content.byteLength,
      fileUrl,
      content: input.content,
      createdAt: new Date(),
    };
    this.meta.set(`${input.tenantId}:${id}`, {
      id: stored.id,
      tenantId: stored.tenantId,
      documentType: stored.documentType,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      fileUrl: stored.fileUrl,
      createdAt: stored.createdAt,
    });
    return stored;
  }

  async get(id: string, tenantId: string): Promise<StoredScholarshipDocument | null> {
    const meta = this.meta.get(`${tenantId}:${id}`);
    if (!meta) return null;
    // Content retrieval via MinIO is optional for attach-only flows.
    return { ...meta, content: Buffer.alloc(0) };
  }
}

export class InMemoryScholarshipDocumentStore implements ScholarshipDocumentStore {
  private readonly docs = new Map<string, StoredScholarshipDocument>();

  async put(input: {
    tenantId: string;
    documentType: string;
    fileName: string;
    mimeType?: string;
    content: Buffer;
  }): Promise<StoredScholarshipDocument> {
    const id = randomUUID();
    const stored: StoredScholarshipDocument = {
      id,
      tenantId: input.tenantId,
      documentType: input.documentType,
      fileName: input.fileName,
      mimeType: input.mimeType ?? 'application/octet-stream',
      fileSize: input.content.byteLength,
      fileUrl: `/api/v1/scholarships/documents/${id}`,
      content: input.content,
      createdAt: new Date(),
    };
    this.docs.set(`${input.tenantId}:${id}`, stored);
    return stored;
  }

  async get(id: string, tenantId: string): Promise<StoredScholarshipDocument | null> {
    return this.docs.get(`${tenantId}:${id}`) ?? null;
  }
}

/**
 * Build the default document store for the current environment.
 */
export function createScholarshipDocumentStore(): ScholarshipDocumentStore {
  const minio = createMinioAdapterOrNull();
  if (minio) return new MinioScholarshipDocumentStore(minio);
  if (process.env['NODE_ENV'] === 'test') {
    return new InMemoryScholarshipDocumentStore();
  }
  return new LocalDiskScholarshipDocumentStore();
}

/** Shared default store used by the scholarship plugin routes. */
export const defaultScholarshipDocumentStore = createScholarshipDocumentStore();
