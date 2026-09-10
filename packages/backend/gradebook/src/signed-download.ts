/**
 * HMAC-signed download tokens for board export artifacts (G-305).
 * Stub — not a full CDN signed URL; binds tenant + job + expiry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type BoardExportSignedDownload = {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
};

function signingSecret(): string {
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
  const sig = createHmac('sha256', signingSecret()).update(body).digest('hex');
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
  const expected = createHmac('sha256', signingSecret())
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

/** Transcript signing stub — HMAC over checksum (not a CA-sealed PDF). */
export function signTranscriptChecksum(checksumSha256: string, tenantId: string): string {
  return createHmac('sha256', signingSecret())
    .update(`transcript:${tenantId}:${checksumSha256}`)
    .digest('hex');
}

export function verifyTranscriptSignature(
  checksumSha256: string,
  tenantId: string,
  signature: string,
): boolean {
  const expected = signTranscriptChecksum(checksumSha256, tenantId);
  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
