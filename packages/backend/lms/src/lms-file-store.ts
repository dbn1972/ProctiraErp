/**
 * G-915 — LMS file store: StorageAdapter when a bucket is configured,
 * otherwise a local-disk fallback. HMAC download tokens stay tenant-bound.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import {
  createStorageAdapter,
  type StorageAdapter,
  type StorageAdapterConfig,
} from '@proctira/storage';

const MAX_BYTES = 5 * 1024 * 1024;

export const LMS_ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4',
]);

export function assertAllowedUpload(mimeType: string, byteSize: number): void {
  if (byteSize > MAX_BYTES) {
    throw Object.assign(new Error('File exceeds 5 MB'), { code: 'FILE_TOO_LARGE' });
  }
  if (byteSize <= 0) {
    throw Object.assign(new Error('Empty file'), { code: 'FILE_EMPTY' });
  }
  if (!LMS_ALLOWED_MIME.has(mimeType)) {
    throw Object.assign(new Error(`MIME type not allowed: ${mimeType}`), {
      code: 'MIME_NOT_ALLOWED',
    });
  }
}

function signingSecret(): string {
  return (
    process.env.LMS_FILE_SIGNING_SECRET ??
    process.env.SIS_BOARD_EXPORT_SIGNING_SECRET ??
    process.env.JWT_SECRET ??
    'lms-file-dev-secret-change-me'
  );
}

function payload(tenantId: string, fileId: string, expUnix: number): string {
  return `${tenantId}:${fileId}:${expUnix}`;
}

export function createLmsFileDownloadToken(
  tenantId: string,
  fileId: string,
  expiresInSeconds = 300,
): { token: string; expiresAt: string; expiresInSeconds: number } {
  const expUnix = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = payload(tenantId, fileId, expUnix);
  const sig = createHmac('sha256', signingSecret()).update(body).digest('hex');
  return {
    token: `${expUnix}.${sig}`,
    expiresAt: new Date(expUnix * 1000).toISOString(),
    expiresInSeconds,
  };
}

export function verifyLmsFileDownloadToken(
  tenantId: string,
  fileId: string,
  token: string,
): { ok: true } | { ok: false; reason: string } {
  const [expRaw, sig] = token.split('.');
  if (!expRaw || !sig) return { ok: false, reason: 'Malformed token' };
  const expUnix = Number(expRaw);
  if (!Number.isFinite(expUnix)) return { ok: false, reason: 'Invalid expiry' };
  if (expUnix < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'Token expired' };
  const expected = createHmac('sha256', signingSecret())
    .update(payload(tenantId, fileId, expUnix))
    .digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Invalid signature' };
    }
  } catch {
    return { ok: false, reason: 'Invalid signature' };
  }
  return { ok: true };
}

function fileRoot(): string {
  return process.env.LMS_FILE_ROOT?.trim() || join(tmpdir(), 'proctira-lms-files');
}

export function buildLmsStorageKey(tenantId: string, fileId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
  return `tenants/${tenantId}/lms/${fileId}/${safe}`;
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

let cachedAdapter: StorageAdapter | null | undefined;

function getAdapter(): StorageAdapter | null {
  if (cachedAdapter !== undefined) return cachedAdapter;
  const config = storageConfigFromEnv();
  if (!config) {
    cachedAdapter = null;
    return null;
  }
  try {
    cachedAdapter = createStorageAdapter(config);
  } catch {
    cachedAdapter = null;
  }
  return cachedAdapter;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

export async function putLmsFile(
  tenantId: string,
  fileId: string,
  filename: string,
  bytes: Buffer,
): Promise<{ storageKey: string; byteSize: number }> {
  const key = buildLmsStorageKey(tenantId, fileId, filename);
  const adapter = getAdapter();
  if (adapter) {
    const result = await adapter.upload(key, bytes, {
      tenantId,
      contentType: 'application/octet-stream',
      lifecycle: 'permanent',
    });
    return { storageKey: result.key, byteSize: bytes.length };
  }
  const dest = resolve(fileRoot(), key);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return { storageKey: key, byteSize: bytes.length };
}

export async function getLmsFile(storageKey: string): Promise<Buffer> {
  const adapter = getAdapter();
  if (adapter) {
    const stream = await adapter.download(storageKey);
    return streamToBuffer(stream);
  }
  const dest = resolve(fileRoot(), storageKey);
  const root = resolve(fileRoot());
  if (!dest.startsWith(root + '/') && dest !== root) {
    throw Object.assign(new Error('Invalid storage key'), { code: 'INVALID_KEY' });
  }
  return readFile(dest);
}

export function decodeBase64Payload(contentBase64: string): Buffer {
  const stripped = contentBase64.replace(/^data:[^;]+;base64,/, '');
  return Buffer.from(stripped, 'base64');
}
