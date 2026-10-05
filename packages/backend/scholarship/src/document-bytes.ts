/**
 * Scholarship supporting-document bytes: allow-list, magic-byte sniff,
 * filename sanitisation, and a stable placeholder PDF for seeds/tests.
 * No ClamAV client exists in this repo; callers pass an optional scan hook.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { AppError, ValidationError } from '@proctira/common';
import { isProductionNodeEnv } from '@proctira/common/node-env';
import { createLogger } from '@proctira/logging';

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

const PDF_SIG = Buffer.from('%PDF');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);

/** Stable tiny PDF used by the Sunrise seed and unit tests (not a scanned form). */
export const PLACEHOLDER_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

export const PLACEHOLDER_PDF_SHA256 =
  '7856c8e9ef203bbcac0d98630035fd1ced46f1bdd446c940d6411e183f6073ec';

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sniffDocumentMime(bytes: Buffer): AllowedDocumentMime | null {
  if (bytes.length >= 4 && bytes.subarray(0, 4).compare(PDF_SIG) === 0) return 'application/pdf';
  if (bytes.length >= 3 && bytes.subarray(0, 3).compare(JPEG_SIG) === 0) return 'image/jpeg';
  if (bytes.length >= 4 && bytes.subarray(0, 4).compare(PNG_SIG) === 0) return 'image/png';
  return null;
}

/**
 * Keep a single path segment. Strips directories, NUL, and characters that
 * are unsafe in Content-Disposition and object keys.
 */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/\0/g, '')
    .replace(/[^\w.\- ()]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : 'document';
}

export function assertDocumentBytes(
  bytes: Buffer,
  declaredMime: string | undefined,
): AllowedDocumentMime {
  if (bytes.length === 0) {
    throw new ValidationError('Document is empty', [
      { field: 'file', rule: 'minLength', message: 'Document is empty' },
    ]);
  }
  if (bytes.length > DOCUMENT_MAX_BYTES) {
    throw new ValidationError('Document exceeds 10 MB', [
      { field: 'file', rule: 'maxSize', message: 'Document must be 10 MB or smaller' },
    ]);
  }
  const sniffed = sniffDocumentMime(bytes);
  if (!sniffed) {
    throw new ValidationError('File must be a PDF, JPEG, or PNG', [
      {
        field: 'file',
        rule: 'magic',
        message: 'File content does not match PDF, JPEG, or PNG',
      },
    ]);
  }
  const declared = declaredMime?.split(';')[0]?.trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== sniffed) {
    throw new ValidationError('Document bytes do not match the declared MIME type', [
      {
        field: 'file',
        rule: 'magic',
        message: `Declared ${declared} but file content is ${sniffed}`,
      },
    ]);
  }
  if (!(ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(sniffed)) {
    throw new ValidationError('Unsupported document type', [
      { field: 'file', rule: 'enum', message: 'Document must be PDF, JPEG, or PNG' },
    ]);
  }
  return sniffed;
}

export interface MultipartFile {
  fieldName: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  file: MultipartFile | null;
}

/** Single-file multipart/form-data parser (documentType + file). */
export function parseMultipartForm(body: Buffer, contentType: string): ParsedMultipart {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) {
    throw new ValidationError('Upload must be multipart/form-data', [
      { field: 'file', rule: 'contentType', message: 'Missing multipart boundary' },
    ]);
  }
  const delim = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: MultipartFile | null = null;
  let cursor = body.indexOf(delim);
  if (cursor < 0) {
    throw new ValidationError('Upload must be multipart/form-data', [
      { field: 'file', rule: 'contentType', message: 'Malformed multipart body' },
    ]);
  }
  while (cursor >= 0) {
    const after = cursor + delim.length;
    if (body.subarray(after, after + 2).toString() === '--') break;
    let partStart = after;
    if (body.subarray(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
    const next = body.indexOf(delim, partStart);
    if (next < 0) break;
    let partEnd = next;
    if (body.subarray(partEnd - 2, partEnd).toString() === '\r\n') partEnd -= 2;
    const part = body.subarray(partStart, partEnd);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headerText = part.subarray(0, headerEnd).toString('utf8');
      const data = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/.exec(headerText);
      const mimeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
      const name = nameMatch?.[1] ?? '';
      if (filenameMatch) {
        file = {
          fieldName: name || 'file',
          filename: filenameMatch[1] ?? 'document',
          mimeType: mimeMatch?.[1]?.trim() ?? 'application/octet-stream',
          data,
        };
      } else if (name) {
        fields[name] = data.toString('utf8');
      }
    }
    cursor = next;
  }
  return { fields, file };
}

export interface DocumentDownloadClaims {
  tenantId: string;
  documentId: string;
  /** User the link was minted for (PRC-L344). Empty when minted without a session. */
  sub: string;
  /** Unique token id; each link is single-use (PRC-L344). */
  jti: string;
  exp: number;
}
/**
 * Single-use store for download-token jtis (PRC-L344). `consume` returns false when the jti was
 * already used; implementations must throw (not return true) when the store is unavailable so
 * the download fails closed.
 */
export interface DownloadTokenReplayStore {
  consume(jti: string, exp: number): boolean | Promise<boolean>;
}
/**
 * Process-local single-use guard (dev/test, single replica). Production uses
 * {@link RedisDownloadTokenReplayGuard} so single-use holds across gateway replicas.
 */
export class DownloadTokenReplayGuard implements DownloadTokenReplayStore {
  private readonly used = new Map<string, number>();
  constructor(private readonly maxEntries = 50_000) {}
  /** Returns false when the jti was already consumed. */
  consume(jti: string, exp: number, nowSeconds = Date.now() / 1000): boolean {
    for (const [key, keyExp] of this.used) {
      if (keyExp < nowSeconds) this.used.delete(key);
    }
    if (this.used.has(jti)) return false;
    if (this.used.size >= this.maxEntries) {
      const oldest = this.used.keys().next().value;
      if (oldest !== undefined) this.used.delete(oldest);
    }
    this.used.set(jti, exp);
    return true;
  }
}

/** Minimal ioredis-compatible surface for SET key NX EX ttl (PRC-L344). */
export interface RedisLikeForDownloadReplay {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    existenceMode: 'NX',
  ): Promise<string | null>;
}
/**
 * Shared single-use guard (PRC-L344): `SET scholarship:doc-jti:<jti> 1 EX <ttl> NX` so a link
 * consumed on one replica is rejected on every other. Redis errors propagate (fail closed).
 */
export class RedisDownloadTokenReplayGuard implements DownloadTokenReplayStore {
  constructor(
    private readonly redis: RedisLikeForDownloadReplay,
    private readonly keyPrefix = 'scholarship:doc-jti:',
  ) {}
  async consume(jti: string, exp: number, nowSeconds = Date.now() / 1000): Promise<boolean> {
    const ttlSeconds = Math.max(1, Math.ceil(exp - nowSeconds));
    const result = await this.redis.set(`${this.keyPrefix}${jti}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}
/**
 * Choose the jti replay store (PRC-L344): Redis when a shared client is injected; the
 * process-local guard only outside production. Production without Redis refuses to boot,
 * because a per-replica guard lets the same link be replayed once per replica.
 */
export function createDownloadTokenReplayGuard(env: {
  redis?: RedisLikeForDownloadReplay;
  NODE_ENV?: string;
}): DownloadTokenReplayStore {
  if (env.redis) return new RedisDownloadTokenReplayGuard(env.redis);
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    throw new Error(
      'Scholarship document downloads require a shared replay store in production: set REDIS_URL ' +
        'so single-use download links hold across gateway replicas (PRC-L344).',
    );
  }
  return new DownloadTokenReplayGuard();
}
/**
 * Context recorded for every served scholarship document download (PRC-L344). Persisted as the
 * single hash-chained access-log row via ScholarshipDocumentService.recordTokenDownload.
 */
export interface ScholarshipDocumentDownloadAuditEvent {
  tenantId: string;
  documentId: string;
  /** User the link was minted for; null for links minted without a session. */
  userId: string | null;
  /** Authenticated session user presenting the link, when any. */
  sessionUserId: string | null;
  jti: string;
  ipAddress: string;
  userAgent: string | null;
  requestId: string;
}
const DOC_SIGNING_KEY_MISSING_MESSAGE =
  'SCHOLARSHIP_DOC_URL_SECRET is required in production. Scholarship document download links ' +
  'are unauthenticated except for this signed token, so no key may be defaulted. Set a strong, ' +
  'dedicated SCHOLARSHIP_DOC_URL_SECRET (not JWT_SECRET) before serving downloads.';

/**
 * PRC-H082: the scholarship document download endpoint is exempt from JWT auth, so the signed
 * token is the *only* credential guarding applicants' income/caste/ID documents. A hard-coded
 * default secret let anyone who read the source forge a token for any (tenantId, documentId).
 * Issuance/verification now fail closed in production when the dedicated secret is unset.
 */
export class ScholarshipDocSigningKeyMissingError extends AppError {
  constructor(detail?: string) {
    super(detail ?? DOC_SIGNING_KEY_MISSING_MESSAGE, 'SCHOLARSHIP_DOC_SIGNING_KEY_MISSING', 503);
    this.name = 'ScholarshipDocSigningKeyMissingError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isScholarshipDocSigningKeyMissingError(
  error: unknown,
): error is ScholarshipDocSigningKeyMissingError {
  return (
    error instanceof ScholarshipDocSigningKeyMissingError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'SCHOLARSHIP_DOC_SIGNING_KEY_MISSING')
  );
}

/** Process-local ephemeral key for non-production only. Never persisted, never used in prod. */
let ephemeralDevSecret: { secret: string; logged: boolean } | null = null;

let docSigningLog: ReturnType<typeof createLogger> | null = null;
function getDocSigningLog(): ReturnType<typeof createLogger> {
  if (!docSigningLog)
    docSigningLog = createLogger({ name: 'scholarship-doc-signing', level: 'warn' });
  return docSigningLog;
}

/** Test hook. Production code must not call this. */
export function resetScholarshipDocSigningForTests(): void {
  ephemeralDevSecret = null;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return isProductionNodeEnv(env.NODE_ENV);
}

/**
 * Resolve the HMAC secret for scholarship document download tokens.
 * - Configured `SCHOLARSHIP_DOC_URL_SECRET` is always used when present.
 * - Production with no configured secret fails closed (503) — no key is invented.
 * - Non-production with no configured secret uses a per-process ephemeral random key
 *   (logged once) so local/dev/test flows work without shipping a guessable default.
 * - The dedicated secret must not be aliased to `JWT_SECRET`.
 */
function signingSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['SCHOLARSHIP_DOC_URL_SECRET']?.trim();
  if (configured) {
    const jwtSecret = env['JWT_SECRET']?.trim();
    if (jwtSecret && configured === jwtSecret) {
      throw new ScholarshipDocSigningKeyMissingError(
        'SCHOLARSHIP_DOC_URL_SECRET must not equal JWT_SECRET (use a dedicated document key)',
      );
    }
    return configured;
  }
  if (isProduction(env)) {
    throw new ScholarshipDocSigningKeyMissingError();
  }
  if (!ephemeralDevSecret) {
    ephemeralDevSecret = { secret: randomBytes(32).toString('base64url'), logged: false };
  }
  if (!ephemeralDevSecret.logged) {
    ephemeralDevSecret.logged = true;
    getDocSigningLog().warn(
      { event: 'scholarship_doc_signing_dev_ephemeral_key', nodeEnv: env.NODE_ENV ?? 'undefined' },
      'SCHOLARSHIP_DOC_URL_SECRET is unset outside production; using an ephemeral in-memory HMAC ' +
        'key for this process only. Tokens are not valid across restarts. Set ' +
        'SCHOLARSHIP_DOC_URL_SECRET before production.',
    );
  }
  return ephemeralDevSecret.secret;
}

export function signDocumentDownloadToken(
  claims: Omit<DocumentDownloadClaims, 'exp' | 'jti' | 'sub'> & {
    sub?: string;
    jti?: string;
    expiresInSeconds?: number;
    exp?: number;
  },
): { token: string; expiresAt: string } {
  const exp = claims.exp ?? Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? 120);
  const payload: DocumentDownloadClaims = {
    tenantId: claims.tenantId,
    documentId: claims.documentId,
    sub: claims.sub ?? '',
    jti: claims.jti ?? randomUUID(),
    exp,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyDocumentDownloadToken(
  token: string,
  nowSeconds = Date.now() / 1000,
): DocumentDownloadClaims {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  const expected = createHmac('sha256', signingSecret()).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  let claims: DocumentDownloadClaims;
  try {
    claims = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8'),
    ) as DocumentDownloadClaims;
  } catch {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  if (!claims.exp || claims.exp < nowSeconds) {
    throw new AppError('Download link has expired', 'UNAUTHORIZED', 401);
  }
  if (!claims.tenantId || !claims.documentId || typeof claims.jti !== 'string' || !claims.jti) {
    throw new AppError('Download link is invalid', 'UNAUTHORIZED', 401);
  }
  return claims;
}
