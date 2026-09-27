/**
 * HMAC-signed download tokens for board export artifacts (G-305) and
 * W1-DATA-08 transcript authenticity signatures.
 *
 * Board-export download tokens may still use SIS_BOARD_EXPORT_SIGNING_SECRET
 * (with JWT/dev fallbacks for that path only).
 *
 * Transcript authenticity MUST use a dedicated rotated KMS/PKI-backed key
 * (TRANSCRIPT_SIGNING_SECRET material + TRANSCRIPT_SIGNING_KMS_KEY_REF).
 * Never JWT_SECRET, never board-export secrets, never a committed private key.
 *
 * Outside production, a missing secret uses a process-local ephemeral HMAC key
 * generated at startup (see prepareTranscriptSigningAtStartup). Production
 * fail-closes with TranscriptSigningKeyMissingError.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { createLogger } from '@proctira/logging';

export type BoardExportSignedDownload = {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export type TranscriptSigningScope = {
  tenantId: string;
  /** When omitted, derives a tenant-wide key (`institutionId = "tenant"`). */
  institutionId?: string | null;
};

export type TranscriptSigningMaterial = {
  /** Logical key id / kid recorded on the issuance. */
  keyId: string;
  /** KMS/PKI locator (never a JWT secret name). */
  kmsKeyRef: string;
  algorithm: 'HMAC-SHA256';
  /** Per tenant/institution derived HMAC key bytes. */
  hmacKey: Buffer;
};

/** Logical ref stamped on issuances signed with the non-production ephemeral key. */
export const DEV_EPHEMERAL_TRANSCRIPT_KMS_REF = 'dev:ephemeral-in-memory';

/** Key id stamped on issuances signed with the non-production ephemeral key. */
export const DEV_EPHEMERAL_TRANSCRIPT_KEY_ID = 'transcript-dev-ephemeral';

export const TRANSCRIPT_SIGNING_KEY_MISSING_MESSAGE =
  'Dedicated transcript signing key is not configured. Set TRANSCRIPT_SIGNING_SECRET ' +
  '(KMS-unwrapped HMAC material) and TRANSCRIPT_SIGNING_KMS_KEY_REF ' +
  '(arn:aws:kms:… / pkcs11:… / vault:… / env:TRANSCRIPT_SIGNING_SECRET). ' +
  'JWT_SECRET and SIS_BOARD_EXPORT_SIGNING_SECRET must not be reused. ' +
  'Issuance stays blocked until both are set. See .env.example.';

export type TranscriptSigningLog = {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

let fallbackLog: TranscriptSigningLog | null = null;

function getFallbackLog(): TranscriptSigningLog {
  if (!fallbackLog) {
    const logger = createLogger({ name: 'transcript-signing', level: 'warn' });
    fallbackLog = {
      warn: (obj, msg) => {
        logger.warn(obj, msg);
      },
      error: (obj, msg) => {
        logger.error(obj, msg);
      },
    };
  }
  return fallbackLog;
}

type EphemeralDevKey = { secret: string; logged: boolean };

/** Process-local only. Never written to disk and never used when NODE_ENV=production. */
let ephemeralDevKey: EphemeralDevKey | null = null;

export class TranscriptSigningKeyMissingError extends Error {
  readonly code = 'TRANSCRIPT_SIGNING_KEY_MISSING' as const;
  readonly statusCode = 503;

  constructor(detail?: string) {
    super(detail ?? TRANSCRIPT_SIGNING_KEY_MISSING_MESSAGE);
    this.name = 'TranscriptSigningKeyMissingError';
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

export function isTranscriptSigningKeyMissingError(
  error: unknown,
): error is TranscriptSigningKeyMissingError {
  return (
    error instanceof TranscriptSigningKeyMissingError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'TRANSCRIPT_SIGNING_KEY_MISSING' &&
      typeof (error as { toJSON?: unknown }).toJSON === 'function')
  );
}

/** Test hook. Production code must not call this. */
export function resetDevTranscriptSigningForTests(): void {
  ephemeralDevKey = null;
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

function ensureEphemeralDevKey(env: NodeJS.ProcessEnv, log: TranscriptSigningLog): string {
  if (!ephemeralDevKey) {
    ephemeralDevKey = { secret: randomBytes(32).toString('base64url'), logged: false };
  }
  if (!ephemeralDevKey.logged) {
    ephemeralDevKey.logged = true;
    log.warn(
      {
        event: 'transcript_signing_dev_ephemeral_key',
        nodeEnv: env.NODE_ENV ?? 'undefined',
        kmsKeyRef: DEV_EPHEMERAL_TRANSCRIPT_KMS_REF,
        keyId: DEV_EPHEMERAL_TRANSCRIPT_KEY_ID,
      },
      'TRANSCRIPT_SIGNING_SECRET is unset outside production. Using an ephemeral in-memory HMAC key for this process only. It is not persisted, is not valid across restarts, and must not be used for real transcripts. Set TRANSCRIPT_SIGNING_SECRET and TRANSCRIPT_SIGNING_KMS_KEY_REF before production.',
    );
  }
  return ephemeralDevKey.secret;
}

/**
 * Startup hook for the gradebook plugin.
 * Outside production, generates the ephemeral key once when the secret is unset and logs it.
 * In production, logs an actionable error and leaves issuance fail-closed (no key is invented).
 */
export function prepareTranscriptSigningAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  log: TranscriptSigningLog = getFallbackLog(),
): void {
  const secret = env.TRANSCRIPT_SIGNING_SECRET?.trim();
  const kmsKeyRef = env.TRANSCRIPT_SIGNING_KMS_KEY_REF?.trim();
  if (isProduction(env)) {
    if (!secret || !kmsKeyRef) {
      log.error(
        {
          event: 'transcript_signing_key_missing',
          missing: [
            !secret ? 'TRANSCRIPT_SIGNING_SECRET' : null,
            !kmsKeyRef ? 'TRANSCRIPT_SIGNING_KMS_KEY_REF' : null,
          ].filter((name): name is string => Boolean(name)),
        },
        TRANSCRIPT_SIGNING_KEY_MISSING_MESSAGE,
      );
    }
    return;
  }
  if (!secret) {
    ensureEphemeralDevKey(env, log);
  }
}

function boardExportSigningSecret(): string {
  return (
    process.env.SIS_BOARD_EXPORT_SIGNING_SECRET ??
    process.env.JWT_SECRET ??
    'sis-board-export-dev-secret-change-me'
  );
}

function payload(tenantId: string, jobId: string, expUnix: number): string {
  return `${tenantId}:${jobId}:${expUnix}`;
}

export function createBoardExportDownloadToken(
  tenantId: string,
  jobId: string,
  expiresInSeconds = 300,
): BoardExportSignedDownload {
  const expUnix = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = payload(tenantId, jobId, expUnix);
  const sig = createHmac('sha256', boardExportSigningSecret()).update(body).digest('hex');
  return {
    token: `${expUnix}.${sig}`,
    expiresAt: new Date(expUnix * 1000).toISOString(),
    expiresInSeconds,
  };
}

export function verifyBoardExportDownloadToken(
  tenantId: string,
  jobId: string,
  token: string,
): { ok: true } | { ok: false; reason: string } {
  const [expRaw, sig] = token.split('.');
  if (!expRaw || !sig) return { ok: false, reason: 'Malformed token' };
  const expUnix = Number(expRaw);
  if (!Number.isFinite(expUnix)) return { ok: false, reason: 'Invalid expiry' };
  if (expUnix < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'Token expired' };
  }
  const expected = createHmac('sha256', boardExportSigningSecret())
    .update(payload(tenantId, jobId, expUnix))
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

const FORBIDDEN_TRANSCRIPT_ENV_REUSE = new Set([
  'JWT_SECRET',
  'JWT_SECRET_PREVIOUS',
  'SIS_BOARD_EXPORT_SIGNING_SECRET',
  'REPORT_DOWNLOAD_SIGNING_SECRET',
  'COOKIE_SECRET',
]);

function assertDedicatedKmsRef(kmsKeyRef: string): void {
  const ref = kmsKeyRef.trim();
  if (!ref) {
    throw new TranscriptSigningKeyMissingError('TRANSCRIPT_SIGNING_KMS_KEY_REF is empty');
  }
  const lower = ref.toLowerCase();
  for (const name of FORBIDDEN_TRANSCRIPT_ENV_REUSE) {
    if (lower.includes(name.toLowerCase()) || lower === `env:${name.toLowerCase()}`) {
      throw new TranscriptSigningKeyMissingError(
        `TRANSCRIPT_SIGNING_KMS_KEY_REF must not reference ${name} (no JWT/board-export reuse)`,
      );
    }
  }
}

/**
 * Resolve dedicated transcript signing material for a tenant/institution scope.
 * Production fail-closes when the dedicated secret or KMS/PKI ref is missing.
 * Other environments generate one ephemeral in-memory key per process.
 */
export function resolveTranscriptSigningMaterial(
  scope: TranscriptSigningScope,
  env: NodeJS.ProcessEnv = process.env,
  log: TranscriptSigningLog = getFallbackLog(),
): TranscriptSigningMaterial {
  const configuredSecret = env.TRANSCRIPT_SIGNING_SECRET?.trim();
  const ephemeral = !configuredSecret && !isProduction(env);
  const secret = configuredSecret || (ephemeral ? ensureEphemeralDevKey(env, log) : '');
  if (!secret) {
    throw new TranscriptSigningKeyMissingError();
  }

  // Guard against operators copying JWT into the dedicated slot by aliasing env names.
  if (env.JWT_SECRET?.trim() && secret === env.JWT_SECRET.trim()) {
    throw new TranscriptSigningKeyMissingError(
      'TRANSCRIPT_SIGNING_SECRET must not equal JWT_SECRET',
    );
  }
  if (
    env.SIS_BOARD_EXPORT_SIGNING_SECRET?.trim() &&
    secret === env.SIS_BOARD_EXPORT_SIGNING_SECRET.trim()
  ) {
    throw new TranscriptSigningKeyMissingError(
      'TRANSCRIPT_SIGNING_SECRET must not equal SIS_BOARD_EXPORT_SIGNING_SECRET',
    );
  }

  const configuredKms = env.TRANSCRIPT_SIGNING_KMS_KEY_REF?.trim() ?? '';
  let kmsKeyRef = configuredKms;
  let keyId = env.TRANSCRIPT_SIGNING_KEY_ID?.trim() || 'transcript-default';
  if (ephemeral) {
    // Do not stamp a real KMS locator on material that was never unwrapped from it.
    kmsKeyRef = DEV_EPHEMERAL_TRANSCRIPT_KMS_REF;
    keyId = DEV_EPHEMERAL_TRANSCRIPT_KEY_ID;
  } else if (!kmsKeyRef) {
    if (isProduction(env)) {
      throw new TranscriptSigningKeyMissingError(
        'TRANSCRIPT_SIGNING_KMS_KEY_REF is required in production. ' +
          TRANSCRIPT_SIGNING_KEY_MISSING_MESSAGE,
      );
    }
    kmsKeyRef = 'env:TRANSCRIPT_SIGNING_SECRET';
  }
  assertDedicatedKmsRef(kmsKeyRef);

  const institution = scope.institutionId?.trim() || 'tenant';
  const hmacKey = createHmac('sha256', secret)
    .update(`transcript:v1:${scope.tenantId}:${institution}`, 'utf8')
    .digest();

  return {
    keyId,
    kmsKeyRef,
    algorithm: 'HMAC-SHA256',
    hmacKey,
  };
}

/** Boot / issue guard — throws when dedicated key material is missing. */
export function assertTranscriptSigningConfigured(env: NodeJS.ProcessEnv = process.env): void {
  resolveTranscriptSigningMaterial({ tenantId: '00000000-0000-4000-8000-000000000000' }, env);
}

/**
 * Sign transcript checksum with a dedicated tenant/institution key.
 * @throws TranscriptSigningKeyMissingError when no dedicated key is configured
 */
export function signTranscriptChecksum(
  checksumSha256: string,
  tenantId: string,
  institutionId?: string | null,
): string {
  const material = resolveTranscriptSigningMaterial({ tenantId, institutionId });
  return createHmac('sha256', material.hmacKey)
    .update(`transcript:${tenantId}:${checksumSha256}`)
    .digest('hex');
}

/** Same as {@link signTranscriptChecksum} but also returns key provenance for metadata. */
export function signTranscriptChecksumWithMaterial(
  checksumSha256: string,
  scope: TranscriptSigningScope,
): { signature: string; material: TranscriptSigningMaterial } {
  const material = resolveTranscriptSigningMaterial(scope);
  const signature = createHmac('sha256', material.hmacKey)
    .update(`transcript:${scope.tenantId}:${checksumSha256}`)
    .digest('hex');
  return { signature, material };
}

export function verifyTranscriptSignature(
  checksumSha256: string,
  tenantId: string,
  signature: string,
  institutionId?: string | null,
): boolean {
  let expected: string;
  try {
    expected = signTranscriptChecksum(checksumSha256, tenantId, institutionId);
  } catch {
    return false;
  }
  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
