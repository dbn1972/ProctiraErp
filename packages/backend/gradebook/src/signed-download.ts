/**
 * HMAC-signed download tokens for board export artifacts (G-305) and
 * W1-DATA-08 transcript authenticity signatures.
 *
 * Board-export download tokens may still use SIS_BOARD_EXPORT_SIGNING_SECRET
 * (with JWT/dev fallbacks for that path only).
 *
 * Transcript authenticity MUST use a dedicated rotated KMS/PKI-backed key
 * (TRANSCRIPT_SIGNING_SECRET material + TRANSCRIPT_SIGNING_KMS_KEY_REF).
 * Never JWT_SECRET, never board-export secrets, never hardcoded fallbacks.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

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

export class TranscriptSigningKeyMissingError extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        'Dedicated transcript signing key required: set TRANSCRIPT_SIGNING_SECRET ' +
          '(KMS-unwrapped HMAC material) and TRANSCRIPT_SIGNING_KMS_KEY_REF ' +
          '(arn:aws:kms:… / pkcs11:… / vault:… / env:TRANSCRIPT_SIGNING_SECRET). ' +
          'JWT_SECRET and SIS_BOARD_EXPORT_SIGNING_SECRET must not be reused.',
    );
    this.name = 'TranscriptSigningKeyMissingError';
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
 * Fail-closed when the dedicated secret or (in production) KMS/PKI ref is missing.
 */
export function resolveTranscriptSigningMaterial(
  scope: TranscriptSigningScope,
  env: NodeJS.ProcessEnv = process.env,
): TranscriptSigningMaterial {
  const secret = env.TRANSCRIPT_SIGNING_SECRET?.trim();
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

  const kmsKeyRef =
    env.TRANSCRIPT_SIGNING_KMS_KEY_REF?.trim() ||
    (env.NODE_ENV === 'production' ? '' : 'env:TRANSCRIPT_SIGNING_SECRET');
  if (!kmsKeyRef) {
    throw new TranscriptSigningKeyMissingError(
      'TRANSCRIPT_SIGNING_KMS_KEY_REF is required in production',
    );
  }
  assertDedicatedKmsRef(kmsKeyRef);

  const keyId = env.TRANSCRIPT_SIGNING_KEY_ID?.trim() || 'transcript-default';
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
export function assertTranscriptSigningConfigured(
  env: NodeJS.ProcessEnv = process.env,
): void {
  resolveTranscriptSigningMaterial(
    { tenantId: '00000000-0000-4000-8000-000000000000' },
    env,
  );
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
