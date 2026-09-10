/**
 * Artifact bytes: object storage when S3_* is configured, else local disk
 * (REPORT_ARTIFACT_DIR), else in-memory for tests.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';
import type { Readable } from 'node:stream';

export interface ReportBlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
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

  async put(key: string, bytes: Buffer): Promise<void> {
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
    return {
      async put(key: string, bytes: Buffer) {
        const tenantId = key.split('/')[0] ?? 'unknown';
        const rest = key.split('/').slice(1).join('/') || key;
        const objectKey = buildTenantKey(tenantId, rest);
        await adapter.upload(objectKey, bytes, {
          tenantId,
          contentType: 'application/octet-stream',
          lifecycle: 'temporary',
        });
      },
      async get(key: string) {
        try {
          const tenantId = key.split('/')[0] ?? 'unknown';
          const rest = key.split('/').slice(1).join('/') || key;
          const objectKey = buildTenantKey(tenantId, rest);
          return await collectStream(await adapter.download(objectKey));
        } catch {
          return null;
        }
      },
    };
  }
  return new FilesystemReportBlobStore();
}
