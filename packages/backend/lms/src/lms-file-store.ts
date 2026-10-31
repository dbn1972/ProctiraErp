/**
 * G-915 — LMS file store: StorageAdapter when a bucket is configured,
 * otherwise a local-disk fallback. HMAC download tokens stay tenant-bound.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';

import { isProductionLike } from '@proctira/common/node-env';
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

/** Base64 inflates by 4/3; this keeps a 5 MB file + JSON envelope under the route limit. */
export const LMS_UPLOAD_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

const ascii = (text: string): number[] => Array.from(text, (ch) => ch.charCodeAt(0));

/**
 * PRC-M099: the declared MIME type must match the file's magic bytes, so an
 * executable renamed/declared as PDF (or any other allow-listed type) is refused.
 */
export function contentMatchesMime(mimeType: string, bytes: Uint8Array): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return startsWith(bytes, ascii('%PDF-'));
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case 'video/mp4':
      return startsWith(bytes, ascii('ftyp'), 4);
    case 'text/plain': {
      // Text must not carry a known binary signature or NUL bytes in its head.
      if (startsWith(bytes, ascii('MZ')) || startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
        return false;
      }
      const head = bytes.subarray(0, Math.min(bytes.length, 8192));
      return !head.includes(0);
    }
    default:
      return false;
  }
}

export function assertAllowedUpload(mimeType: string, byteSize: number, bytes?: Uint8Array): void {
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
  if (bytes && !contentMatchesMime(mimeType, bytes)) {
    throw Object.assign(new Error(`File content does not match ${mimeType}`), {
      code: 'MIME_MISMATCH',
    });
  }
}

/**
 * PRC-L329 (topic 2): one secret per purpose. The LMS file download signing
 * key is a dedicated LMS_FILE_SIGNING_SECRET with no fallback to JWT_SECRET,
 * SIS_BOARD_EXPORT_SIGNING_SECRET or the old committed dev placeholder in a
 * deployed (production-like) environment. Mirrors the board-export fix
 * (gradebook signed-download.ts, PRC-L310).
 */
export const LMS_FILE_SIGNING_KEY_MISSING_MESSAGE =
  'LMS file download signing key is not configured. Set a dedicated ' +
  'LMS_FILE_SIGNING_SECRET (never reuse JWT_SECRET or SIS_BOARD_EXPORT_SIGNING_SECRET, ' +
  'and never the committed dev placeholder). LMS file downloads stay blocked until ' +
  'it is set. See .env.example.';

/** Committed dev-only placeholder that must never sign in a deployed environment. */
const LMS_FILE_DEV_PLACEHOLDER = 'lms-file-dev-secret-change-me';

export class LmsFileSigningKeyMissingError extends Error {
  readonly code = 'LMS_FILE_SIGNING_KEY_MISSING' as const;
  readonly statusCode = 503;

  constructor(detail?: string) {
    super(detail ?? LMS_FILE_SIGNING_KEY_MISSING_MESSAGE);
    this.name = 'LmsFileSigningKeyMissingError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

export function isLmsFileSigningKeyMissingError(
  error: unknown,
): error is LmsFileSigningKeyMissingError {
  return (
    error instanceof LmsFileSigningKeyMissingError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'LMS_FILE_SIGNING_KEY_MISSING' &&
      typeof (error as { toJSON?: unknown }).toJSON === 'function')
  );
}

export type LmsFileSigningLog = {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

function defaultLog(): LmsFileSigningLog {
  return {
    warn: (obj, msg) => {
      // eslint-disable-next-line no-console
      console.warn(msg ?? '', obj);
    },
    error: (obj, msg) => {
      // eslint-disable-next-line no-console
      console.error(msg ?? '', obj);
    },
  };
}

type EphemeralDevKey = { secret: string; logged: boolean };

/** Process-local only. Never written to disk and never used in a deployed env. */
let ephemeralLmsFileKey: EphemeralDevKey | null = null;

/** Test hook. Production code must not call this. */
export function resetDevLmsFileSigningForTests(): void {
  ephemeralLmsFileKey = null;
}

function ensureEphemeralLmsFileKey(env: NodeJS.ProcessEnv, log: LmsFileSigningLog): string {
  if (!ephemeralLmsFileKey) {
    ephemeralLmsFileKey = { secret: randomBytes(32).toString('base64url'), logged: false };
  }
  if (!ephemeralLmsFileKey.logged) {
    ephemeralLmsFileKey.logged = true;
    log.warn(
      {
        event: 'lms_file_signing_dev_ephemeral_key',
        nodeEnv: env.NODE_ENV ?? 'undefined',
      },
      'LMS_FILE_SIGNING_SECRET is unset outside production. Using an ephemeral in-memory HMAC key for this process only. It is not persisted, is not valid across restarts, and must not sign real LMS file downloads. Set LMS_FILE_SIGNING_SECRET before production.',
    );
  }
  return ephemeralLmsFileKey.secret;
}

/**
 * Startup hook for the LMS plugin. Outside production, generates the ephemeral
 * LMS file signing key once when the secret is unset and logs it. In a
 * production-like env, logs an actionable error and leaves signing fail-closed
 * (no key is invented; JWT_SECRET / board-export secrets are never adopted).
 */
export function prepareLmsFileSigningAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  log: LmsFileSigningLog = defaultLog(),
): void {
  const secret = env.LMS_FILE_SIGNING_SECRET?.trim();
  if (isProductionLike(env.NODE_ENV)) {
    if (!secret || secret === LMS_FILE_DEV_PLACEHOLDER) {
      log.error(
        {
          event: 'lms_file_signing_key_missing',
          missing: ['LMS_FILE_SIGNING_SECRET'],
        },
        LMS_FILE_SIGNING_KEY_MISSING_MESSAGE,
      );
    }
    return;
  }
  if (!secret) {
    ensureEphemeralLmsFileKey(env, log);
  }
}

/**
 * Resolve the dedicated LMS file signing secret.
 *
 * PRC-L329 (topic 2): a production-like environment (anything other than
 * `development` / `test`, so unset / staging fail closed) fail-closes when
 * LMS_FILE_SIGNING_SECRET is missing, equals JWT_SECRET or
 * SIS_BOARD_EXPORT_SIGNING_SECRET, or is the committed dev placeholder.
 * JWT_SECRET and the board-export secret are never a fallback. Outside
 * production, a process-local ephemeral key is used so local dev keeps working
 * without a committed literal.
 */
function signingSecret(
  env: NodeJS.ProcessEnv = process.env,
  log: LmsFileSigningLog = defaultLog(),
): string {
  const configured = env.LMS_FILE_SIGNING_SECRET?.trim();
  const jwt = env.JWT_SECRET?.trim();
  const boardExport = env.SIS_BOARD_EXPORT_SIGNING_SECRET?.trim();

  if (isProductionLike(env.NODE_ENV)) {
    if (!configured) {
      throw new LmsFileSigningKeyMissingError();
    }
    if (configured === LMS_FILE_DEV_PLACEHOLDER) {
      throw new LmsFileSigningKeyMissingError(
        'LMS_FILE_SIGNING_SECRET is still the committed dev placeholder. ' +
          LMS_FILE_SIGNING_KEY_MISSING_MESSAGE,
      );
    }
    if (jwt && configured === jwt) {
      throw new LmsFileSigningKeyMissingError(
        'LMS_FILE_SIGNING_SECRET must not equal JWT_SECRET (one secret per purpose).',
      );
    }
    if (boardExport && configured === boardExport) {
      throw new LmsFileSigningKeyMissingError(
        'LMS_FILE_SIGNING_SECRET must not equal SIS_BOARD_EXPORT_SIGNING_SECRET (one secret per purpose).',
      );
    }
    return configured;
  }

  // Development / test: prefer a configured dedicated secret, otherwise an
  // ephemeral in-memory key. Never fall back to JWT_SECRET, the board-export
  // secret, or a committed literal.
  if (configured && configured !== LMS_FILE_DEV_PLACEHOLDER) {
    return configured;
  }
  return ensureEphemeralLmsFileKey(env, log);
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

export async function getLmsFile(storageKey: string, callerTenantId: string): Promise<Buffer> {
  const adapter = getAdapter();
  if (adapter) {
    const stream = await adapter.download(storageKey, callerTenantId);
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
