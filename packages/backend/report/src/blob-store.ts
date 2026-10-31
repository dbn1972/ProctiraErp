/**
 * Artifact bytes: object storage when S3_* is configured, else local disk
 * (REPORT_ARTIFACT_DIR), else in-memory for tests.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';
import type { Readable } from 'node:stream';

export interface ReportBlobStore {
  /**
   * Store artifact bytes.
   *
   * @param contentType - The real MIME type of the artifact (PRC-L342). When
   *   omitted, implementations fall back to a safe binary default.
   */
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

/**
 * PRC-L342: a report blob read that failed for any reason other than a genuine
 * not-found. Callers must treat this as a hard failure (500), never as a
 * missing artifact (404) — masking a decrypt/permission/network fault as
 * not-found hides tampering and access-control regressions.
 */
export class ReportBlobReadError extends Error {
  constructor(
    readonly key: string,
    readonly cause: unknown,
  ) {
    super(`Report blob read failed for key: ${key}`);
    this.name = 'ReportBlobReadError';
  }
}

export class InMemoryReportBlobStore implements ReportBlobStore {
  private readonly items = new Map<string, Buffer>();

  async put(key: string, bytes: Buffer): Promise<void> {
    this.items.set(key, Buffer.from(bytes));
  }

  async get(key: string): Promise<Buffer | null> {
    const found = this.items.get(key);
    return found ? Buffer.from(found) : null;
  }
}

export function defaultReportArtifactDir(): string {
  return process.env.REPORT_ARTIFACT_DIR ?? join(tmpdir(), 'proctira-report-artifacts');
}

export class FilesystemReportBlobStore implements ReportBlobStore {
  constructor(private readonly rootDir: string = defaultReportArtifactDir()) {}

  private resolve(key: string): string {
    const safeKey = key.replace(/^[/\\]+/, '');
    const full = normalize(join(this.rootDir, safeKey));
    const root = normalize(this.rootDir).replace(/[/\\]+$/, '');
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`Artifact key escapes storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, bytes: Buffer, _contentType?: string): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

function isS3Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.S3_BUCKET?.trim() && env.S3_ACCESS_KEY?.trim() && env.S3_SECRET_KEY?.trim());
}

async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Minimal surface of `@proctira/storage` that the report blob store drives.
 * Declared locally so the S3 store can be unit-tested with a fake adapter
 * without a live bucket (PRC-L342).
 */
export interface S3BlobStoreAdapter {
  upload(
    key: string,
    data: Buffer,
    options: {
      tenantId: string;
      contentType?: string;
      encryption?: 'AES256' | 'aws:kms';
      kmsKeyId?: string;
      /** Lifecycle class; report artifacts use 'temporary'. */
      lifecycle?: string;
    },
  ): Promise<unknown>;
  download(key: string, callerTenantId: string): Promise<Readable>;
}

const DEFAULT_REPORT_CONTENT_TYPE = 'application/octet-stream';

/**
 * PRC-L342: decide whether a storage-adapter error means "the object does not
 * exist" (safe to surface as a 404) versus any other fault — decrypt failure,
 * permission denial, throttling, network error — which must fail closed.
 */
function isGenuineNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name ?? '';
  if (name === 'NoSuchKey' || name === 'NotFound' || name === 'NotFoundException') {
    return true;
  }
  const status =
    (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ??
    (error as { statusCode?: number }).statusCode ??
    (error as { code?: unknown }).code;
  return status === 404;
}

function resolveReportBlobEncryption(env: NodeJS.ProcessEnv = process.env): {
  encryption: 'AES256' | 'aws:kms';
  kmsKeyId?: string;
} {
  const kmsKeyId = env.S3_SSE_KMS_KEY_ID?.trim();
  if (kmsKeyId) {
    return { encryption: 'aws:kms', kmsKeyId };
  }
  return { encryption: 'AES256' };
}

/**
 * S3/MinIO-backed report blob store. Exposed for unit testing with a fake
 * adapter (PRC-L342). Objects are written with server-side encryption and the
 * artifact's real content-type; reads fail closed on any non-not-found fault.
 */
export function createS3ReportBlobStore(
  adapter: S3BlobStoreAdapter,
  deps: {
    buildTenantKey: (tenantId: string, key: string) => string;
    env?: NodeJS.ProcessEnv;
  },
): ReportBlobStore;
export function createS3ReportBlobStore(adapter: S3BlobStoreAdapter): ReportBlobStore;
export function createS3ReportBlobStore(
  adapter: S3BlobStoreAdapter,
  deps?: {
    buildTenantKey?: (tenantId: string, key: string) => string;
    env?: NodeJS.ProcessEnv;
  },
): ReportBlobStore {
  const env = deps?.env ?? process.env;
  const buildTenantKey =
    deps?.buildTenantKey ?? ((tenantId: string, rest: string) => `${tenantId}/${rest}`);
  const splitKey = (key: string): { tenantId: string; objectKey: string } => {
    const tenantId = key.split('/')[0] ?? 'unknown';
    const rest = key.split('/').slice(1).join('/') || key;
    return { tenantId, objectKey: buildTenantKey(tenantId, rest) };
  };
  return {
    async put(key: string, bytes: Buffer, contentType?: string) {
      const { tenantId, objectKey } = splitKey(key);
      const { encryption, kmsKeyId } = resolveReportBlobEncryption(env);
      await adapter.upload(objectKey, bytes, {
        tenantId,
        contentType: contentType?.trim() || DEFAULT_REPORT_CONTENT_TYPE,
        encryption,
        ...(kmsKeyId ? { kmsKeyId } : {}),
        lifecycle: 'temporary',
      });
    },
    async get(key: string) {
      const { tenantId, objectKey } = splitKey(key);
      try {
        return await collectStream(await adapter.download(objectKey, tenantId));
      } catch (error) {
        if (isGenuineNotFound(error)) return null;
        // Fail closed: never mask a decrypt/permission/network fault as a 404.
        throw new ReportBlobReadError(key, error);
      }
    },
  };
}

export async function createReportBlobStore(): Promise<ReportBlobStore> {
  if (process.env.REPORT_ARTIFACT_STORE === 'memory') {
    return new InMemoryReportBlobStore();
  }
  if (isS3Configured()) {
    const { createStorageAdapter, buildTenantKey } = await import('@proctira/storage');
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const bucket = process.env.S3_BUCKET!.trim();
    const accessKey = process.env.S3_ACCESS_KEY!.trim();
    const secretKey = process.env.S3_SECRET_KEY!.trim();
    const region = process.env.S3_REGION?.trim() || 'us-east-1';
    const adapter = endpoint
      ? createStorageAdapter({
          adapter: 'minio',
          config: { bucket, endpoint, accessKey, secretKey, region },
        })
      : createStorageAdapter({
          adapter: 's3',
          config: { bucket, region, accessKeyId: accessKey, secretAccessKey: secretKey },
        });
    return createS3ReportBlobStore(adapter as unknown as S3BlobStoreAdapter, { buildTenantKey });
  }
  return new FilesystemReportBlobStore();
}
