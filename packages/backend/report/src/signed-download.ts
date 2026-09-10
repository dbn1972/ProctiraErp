/**
 * HMAC-signed download tokens for report artifacts (same shape as gradebook
 * board-export tokens in packages/backend/gradebook/src/signed-download.ts).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type ReportSignedDownload = {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
};

function signingSecret(): string {
  return (
    process.env.REPORT_DOWNLOAD_SIGNING_SECRET ??
    process.env.SIS_BOARD_EXPORT_SIGNING_SECRET ??
    process.env.JWT_SECRET ??
    'sis-board-export-dev-secret-change-me'
  );
}

function payload(tenantId: string, artifactId: string, expUnix: number): string {
  return `${tenantId}:${artifactId}:${expUnix}`;
}

export function createReportDownloadToken(
  tenantId: string,
  artifactId: string,
  expiresInSeconds = 300,
): ReportSignedDownload {
  const expUnix = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = payload(tenantId, artifactId, expUnix);
  const sig = createHmac('sha256', signingSecret()).update(body).digest('hex');
  return {
    token: `${expUnix}.${sig}`,
    expiresAt: new Date(expUnix * 1000).toISOString(),
    expiresInSeconds,
  };
}

export function verifyReportDownloadToken(
  tenantId: string,
  artifactId: string,
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
    .update(payload(tenantId, artifactId, expUnix))
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
